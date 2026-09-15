// Logistics REST endpoints (2–11, 24–27) — exactly per docs/phase-0/api-contract.md.
// Reuses the Phase 2 deterministic services; no formula changes.

import { Router } from "express";
import { asyncHandler, sendList } from "../common/http.js";
import { conflict, notFound } from "../common/errors.js";
import { nextEntityId } from "../common/ids.js";
import {
  parse,
  createDisruptionInputSchema,
  disruptionListQuerySchema,
  disruptionPatchSchema,
  affectedShipmentsQuerySchema,
  shipmentListQuerySchema,
  alternativesQuerySchema,
  idleQuerySchema,
  fleetQuerySchema,
  carrierListQuerySchema,
  recommendationCreateInputSchema,
  fleetRedeploymentInputSchema,
} from "../common/validation.js";
import * as repo from "./repository.js";
import * as recommendationRepo from "../audit/recommendation.repository.js";
import { appendAuditRecord } from "../audit/repository.js";
import { matchShipments, isDisruptionActive } from "./matching.service.js";
import { routeAlternatives, carrierAlternatives, routeCapacity } from "./alternatives.service.js";
import {
  idleAssets,
  redeploymentCandidates,
  computeContention,
  deriveOperationalState,
  detectAssetAnomalies,
} from "./fleet.service.js";
import { routeReasons, carrierReasons, redeploymentReasons } from "./explanations.js";

const ACTIONABLE_STATUSES = ["planned", "in_transit", "delayed"];
const FAR_FUTURE = new Date(8_640_000_000_000_000);

export function createLogisticsRouter(db) {
  const router = Router();
  const now = () => new Date();

  async function loadSegmentsByRoute() {
    const segments = await repo.listAllSegments(db);
    const map = new Map();
    for (const segment of segments) {
      map.set(segment.route_id, [...(map.get(segment.route_id) ?? []), segment]);
    }
    return map;
  }

  async function loadNetwork() {
    const [shipments, routes, segmentsByRoute, carriers, disruptions] = await Promise.all([
      repo.listShipments(db, { limit: 500 }),
      repo.listRoutes(db, { limit: 500 }),
      loadSegmentsByRoute(),
      repo.listCarriers(db, { limit: 200 }),
      repo.listActiveDisruptions(db, now()),
    ]);
    return { shipments, routes, segmentsByRoute, carriers, disruptions };
  }

  function triggeringRegions(segments, activeDisruptions) {
    return [
      ...new Set(
        activeDisruptions
          .filter((disruption) =>
            segments.some((segment) => segment.region_code === disruption.region_code),
          )
          .map((disruption) => disruption.region_code),
      ),
    ];
  }

  function notActionable(res, shipment) {
    return res.json({
      data: [],
      rejected: [],
      count: 0,
      not_actionable: true,
      not_actionable_reason: shipment.status,
    });
  }

  async function contentionForAffectedShipments(network, assets, assignments, current) {
    const affected = matchShipments({
      shipments: network.shipments,
      routes: network.routes,
      segmentsByRoute: network.segmentsByRoute,
      disruptions: network.disruptions,
      now: current,
    });
    const idle = idleAssets({ assets, assignments, now: current });
    const candidateSets = [];
    for (const row of affected) {
      const segments = network.segmentsByRoute.get(row.shipment.route_id) ?? [];
      const result = redeploymentCandidates({
        shipment: row.shipment,
        routeSegments: segments,
        idle,
        now: current,
      });
      if (result.data.length > 0) candidateSets.push(result.data);
    }
    return computeContention(candidateSets);
  }

  // -------------------------------------------------------------------------
  // 2/3/4 — disruptions
  // -------------------------------------------------------------------------
  router.get(
    "/disruptions",
    asyncHandler(async (req, res) => {
      const query = parse(disruptionListQuerySchema, req.query);
      const rows = await repo.listDisruptions(db, query);
      const current = now();
      sendList(
        res,
        rows.map((row) => ({ ...row, is_currently_active: isDisruptionActive(row, current) })),
      );
    }),
  );

  router.post(
    "/disruptions",
    asyncHandler(async (req, res) => {
      const body = parse(createDisruptionInputSchema, req.body);
      const existing = await repo.listDisruptions(db, {
        status: "active",
        region_code: body.region_code,
      });
      const start = new Date(body.start_time);
      const end = body.end_time ? new Date(body.end_time) : null;
      const overlapping = existing.find((row) => {
        const rowStart = new Date(row.start_time);
        const rowEnd = row.end_time ? new Date(row.end_time) : null;
        return start <= (rowEnd ?? FAR_FUTURE) && (end ?? FAR_FUTURE) >= rowStart;
      });
      if (overlapping) {
        throw conflict("An identical active disruption already exists for this region and window", {
          disruption_id: overlapping.id,
        });
      }
      const id = await nextEntityId(db, "disruption");
      const created = await repo.insertDisruption(db, { ...body, id });
      await appendAuditRecord(db, {
        entity_type: "disruption",
        entity_id: id,
        action: body.status === "active" ? "activated" : "created",
        actor: body.created_by,
        details: { type: body.type, region_code: body.region_code, severity: body.severity },
      });
      res.status(201).json(created);
    }),
  );

  router.patch(
    "/disruptions/:id",
    asyncHandler(async (req, res) => {
      const patch = parse(disruptionPatchSchema, req.body);
      const disruption = await repo.getDisruption(db, req.params.id);
      if (!disruption) throw notFound("Disruption", req.params.id);

      if (patch.status) {
        const allowed =
          (disruption.status === "scheduled" && patch.status === "active") ||
          (disruption.status === "active" && patch.status === "resolved");
        if (!allowed) {
          throw conflict(`Cannot transition disruption from ${disruption.status} to ${patch.status}`, {
            from: disruption.status,
            to: patch.status,
          });
        }
      }

      const updated = await repo.updateDisruption(db, req.params.id, patch);
      if (patch.status === "active") {
        await appendAuditRecord(db, {
          entity_type: "disruption",
          entity_id: disruption.id,
          action: "activated",
          actor: "operator-1",
          details: { from: disruption.status, to: "active" },
        });
      }
      if (patch.status === "resolved") {
        await appendAuditRecord(db, {
          entity_type: "disruption",
          entity_id: disruption.id,
          action: "deactivated",
          actor: "operator-1",
          details: { from: disruption.status, to: "resolved" },
        });
      }
      res.json(updated);
    }),
  );

  // -------------------------------------------------------------------------
  // 5 — affected shipments (R1)
  // -------------------------------------------------------------------------
  router.get(
    "/disruptions/:id/affected-shipments",
    asyncHandler(async (req, res) => {
      const query = parse(affectedShipmentsQuerySchema, req.query);
      const disruption = await repo.getDisruption(db, req.params.id);
      if (!disruption) throw notFound("Disruption", req.params.id);

      const network = await loadNetwork();
      const rows = matchShipments({
        shipments: network.shipments,
        routes: network.routes,
        segmentsByRoute: network.segmentsByRoute,
        disruptions: [disruption],
        now: now(),
        includeDelivered: query.include_delivered,
      });
      res.json({
        data: rows,
        count: rows.length,
        disruption_id: disruption.id,
        computed_at: now().toISOString(),
      });
    }),
  );

  // -------------------------------------------------------------------------
  // 6/7 — shipments
  // -------------------------------------------------------------------------
  router.get(
    "/shipments",
    asyncHandler(async (req, res) => {
      const query = parse(shipmentListQuerySchema, req.query);

      if (query.disruption_id) {
        const disruption = await repo.getDisruption(db, query.disruption_id);
        if (!disruption) throw notFound("Disruption", query.disruption_id);
        const network = await loadNetwork();
        const rows = matchShipments({
          shipments: network.shipments,
          routes: network.routes,
          segmentsByRoute: network.segmentsByRoute,
          disruptions: [disruption],
          now: now(),
        });
        sendList(res, rows.map((row) => row.shipment));
        return;
      }

      const rows = await repo.listShipments(db, {
        status: query.status,
        is_cold_chain: query.is_cold_chain,
        region_code: query.region_code,
        limit: query.limit,
      });
      sendList(res, rows);
    }),
  );

  router.get(
    "/shipments/:id",
    asyncHandler(async (req, res) => {
      const shipment = await repo.getShipment(db, req.params.id);
      if (!shipment) throw notFound("Shipment", req.params.id);

      const [route, segments] = await Promise.all([
        repo.getRoute(db, shipment.route_id),
        repo.listSegmentsByRoute(db, shipment.route_id),
      ]);
      const carrier = route ? await repo.getCarrier(db, route.carrier_id) : null;
      const current = segments.find((segment) => segment.id === shipment.current_segment_id) ?? null;
      const next = current
        ? segments.find((segment) => segment.seq === current.seq + 1) ?? null
        : null;

      res.json({
        ...shipment,
        route,
        carrier,
        segments,
        current_segment: current,
        next_segment: next,
        route_capacity: segments.length > 0 ? routeCapacity(segments) : null,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // 8/9 — alternatives (R2)
  // -------------------------------------------------------------------------
  router.get(
    "/shipments/:id/route-alternatives",
    asyncHandler(async (req, res) => {
      const query = parse(alternativesQuerySchema, req.query);
      const shipment = await repo.getShipment(db, req.params.id);
      if (!shipment) throw notFound("Shipment", req.params.id);
      if (!ACTIONABLE_STATUSES.includes(shipment.status)) return notActionable(res, shipment);

      const network = await loadNetwork();
      const currentRoute = network.routes.find((route) => route.id === shipment.route_id);
      if (!currentRoute) throw conflict("Shipment route data is missing", { shipment_id: shipment.id });
      const segments = network.segmentsByRoute.get(currentRoute.id) ?? [];
      const regions = triggeringRegions(segments, network.disruptions);

      const result = routeAlternatives({
        shipment,
        currentRoute,
        routes: network.routes,
        segmentsByRoute: network.segmentsByRoute,
        carriers: network.carriers,
        triggeringRegions: regions,
        otherDisruptions: network.disruptions.filter((d) => !regions.includes(d.region_code)),
        limit: query.limit,
      });

      res.json({
        data: result.data.map((option) => ({ ...option, reasons: routeReasons(option) })),
        rejected: query.include_rejected ? result.rejected : [],
        count: result.count,
        not_actionable: false,
      });
    }),
  );

  router.get(
    "/shipments/:id/carrier-alternatives",
    asyncHandler(async (req, res) => {
      const query = parse(alternativesQuerySchema, req.query);
      const shipment = await repo.getShipment(db, req.params.id);
      if (!shipment) throw notFound("Shipment", req.params.id);
      if (!ACTIONABLE_STATUSES.includes(shipment.status)) return notActionable(res, shipment);

      const network = await loadNetwork();
      const currentRoute = network.routes.find((route) => route.id === shipment.route_id);
      if (!currentRoute) throw conflict("Shipment route data is missing", { shipment_id: shipment.id });
      const segments = network.segmentsByRoute.get(currentRoute.id) ?? [];
      const regions = triggeringRegions(segments, network.disruptions);

      const result = carrierAlternatives({
        shipment,
        currentRoute,
        routes: network.routes,
        segmentsByRoute: network.segmentsByRoute,
        carriers: network.carriers,
        triggeringRegions: regions,
        otherDisruptions: network.disruptions.filter((d) => !regions.includes(d.region_code)),
        limit: query.limit,
      });

      res.json({
        data: result.data.map((option) => ({ ...option, reasons: carrierReasons(option) })),
        rejected: query.include_rejected ? result.rejected : [],
        count: result.count,
        not_actionable: false,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // 10/11 — fleet idle + redeployment (R3)
  // -------------------------------------------------------------------------
  router.get(
    "/fleet/idle",
    asyncHandler(async (req, res) => {
      const query = parse(idleQuerySchema, req.query);
      const [assets, assignments] = await Promise.all([
        repo.listFleetAssets(db, { limit: 500 }),
        repo.listAllAssignments(db),
      ]);
      const idle = idleAssets({ assets, assignments, now: now() });
      let data = idle.data;
      if (query.region_code) {
        data = data.filter((item) => item.asset.current_region_code === query.region_code);
      }
      if (query.min_idle_minutes > 0) {
        data = data.filter((item) => item.idle_minutes >= query.min_idle_minutes);
      }
      data = data.slice(0, query.limit);
      res.json({ data, excluded: idle.excluded, count: data.length });
    }),
  );

  router.get(
    "/shipments/:id/redeployment-candidates",
    asyncHandler(async (req, res) => {
      const query = parse(alternativesQuerySchema, req.query);
      const shipment = await repo.getShipment(db, req.params.id);
      if (!shipment) throw notFound("Shipment", req.params.id);

      const network = await loadNetwork();
      const [assets, assignments] = await Promise.all([
        repo.listFleetAssets(db, { limit: 500 }),
        repo.listAllAssignments(db),
      ]);
      const current = now();
      const idle = idleAssets({ assets, assignments, now: current });
      const contention = await contentionForAffectedShipments(network, assets, assignments, current);
      const segments = network.segmentsByRoute.get(shipment.route_id) ?? [];

      const result = redeploymentCandidates({
        shipment,
        routeSegments: segments,
        idle,
        now: current,
        contentionCounts: contention,
      });

      res.json({
        data: result.data.map((candidate) => ({
          ...candidate,
          reasons: redeploymentReasons(candidate),
        })),
        rejected: query.include_rejected ? result.rejected : [],
        excluded: result.excluded,
        count: result.count,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // 26/27 — fleet utilisation + carriers
  // -------------------------------------------------------------------------
  router.get(
    "/fleet",
    asyncHandler(async (req, res) => {
      const query = parse(fleetQuerySchema, req.query);
      const [assets, assignments] = await Promise.all([
        repo.listFleetAssets(db, {
          region_code: query.region_code,
          type: query.type,
          limit: query.limit,
        }),
        repo.listAllAssignments(db),
      ]);
      const current = now();

      const byAsset = new Map();
      for (const assignment of assignments) {
        byAsset.set(assignment.asset_id, [...(byAsset.get(assignment.asset_id) ?? []), assignment]);
      }

      let data = assets.map((asset) => {
        const list = byAsset.get(asset.id) ?? [];
        const state = deriveOperationalState(asset, list, current);
        const idleMinutes =
          state === "available" && asset.available_since
            ? Math.round((current.getTime() - new Date(asset.available_since).getTime()) / 60_000)
            : null;
        const nextAssignment =
          list
            .filter(
              (assignment) =>
                new Date(assignment.end_time) >= current && assignment.status !== "cancelled",
            )
            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0] ?? null;
        return {
          asset,
          operational_state: state,
          idle_minutes: idleMinutes,
          next_assignment: nextAssignment
            ? {
                assignment_id: nextAssignment.id,
                shipment_id: nextAssignment.shipment_id,
                start_time: nextAssignment.start_time,
                reserved: nextAssignment.reserved,
              }
            : null,
          anomalies: detectAssetAnomalies(asset, list, current),
        };
      });

      if (query.state) data = data.filter((row) => row.operational_state === query.state);
      res.json({ data, count: data.length, computed_at: current.toISOString() });
    }),
  );

  router.get(
    "/carriers",
    asyncHandler(async (req, res) => {
      const query = parse(carrierListQuerySchema, req.query);
      const rows = await repo.listCarriers(db, query);
      sendList(res, rows);
    }),
  );

  // -------------------------------------------------------------------------
  // 24 — create recommendation (server-side recompute; A-5)
  // -------------------------------------------------------------------------
  router.post(
    "/recommendations",
    asyncHandler(async (req, res) => {
      const body = parse(recommendationCreateInputSchema, req.body);
      const shipment = await repo.getShipment(db, body.shipment_id);
      if (!shipment) throw notFound("Shipment", body.shipment_id);
      if (!ACTIONABLE_STATUSES.includes(shipment.status)) {
        throw conflict("Shipment is not actionable", {
          reason: "shipment_not_actionable",
          status: shipment.status,
        });
      }

      const network = await loadNetwork();
      const current = now();
      let option = null;
      let rejected = [];
      let target = null;

      if (body.type === "reroute") {
        const targetRoute = network.routes.find((route) => route.id === body.route_id);
        if (!targetRoute) throw notFound("Route", body.route_id);
        const currentRoute = network.routes.find((route) => route.id === shipment.route_id);
        if (!currentRoute) throw conflict("Shipment route data is missing", { shipment_id: shipment.id });
        const segments = network.segmentsByRoute.get(currentRoute.id) ?? [];
        const regions = triggeringRegions(segments, network.disruptions);
        const result = routeAlternatives({
          shipment,
          currentRoute,
          routes: network.routes,
          segmentsByRoute: network.segmentsByRoute,
          carriers: network.carriers,
          triggeringRegions: regions,
          otherDisruptions: network.disruptions.filter((d) => !regions.includes(d.region_code)),
          limit: 20,
        });
        option = result.data.find((item) => item.route.id === body.route_id) ?? null;
        rejected = result.rejected;
        if (!option) {
          throw conflict("Selected route is not currently feasible", {
            reason: "target_not_eligible",
            rejected,
          });
        }
        target = { route_id: body.route_id };
      } else if (body.type === "carrier_change") {
        const targetCarrier = network.carriers.find((carrier) => carrier.id === body.carrier_id);
        if (!targetCarrier) throw notFound("Carrier", body.carrier_id);
        const currentRoute = network.routes.find((route) => route.id === shipment.route_id);
        if (!currentRoute) throw conflict("Shipment route data is missing", { shipment_id: shipment.id });
        const segments = network.segmentsByRoute.get(currentRoute.id) ?? [];
        const regions = triggeringRegions(segments, network.disruptions);
        const result = carrierAlternatives({
          shipment,
          currentRoute,
          routes: network.routes,
          segmentsByRoute: network.segmentsByRoute,
          carriers: network.carriers,
          triggeringRegions: regions,
          otherDisruptions: network.disruptions.filter((d) => !regions.includes(d.region_code)),
          limit: 20,
        });
        option = result.data.find((item) => item.carrier.id === body.carrier_id) ?? null;
        rejected = result.rejected;
        if (!option) {
          throw conflict("Selected carrier is not currently feasible", {
            reason: "target_not_eligible",
            rejected,
          });
        }
        target = { carrier_id: body.carrier_id };
      } else {
        const asset = await repo.getFleetAsset(db, body.asset_id);
        if (!asset) throw notFound("Fleet asset", body.asset_id);
        const [assets, assignments] = await Promise.all([
          repo.listFleetAssets(db, { limit: 500 }),
          repo.listAllAssignments(db),
        ]);
        const idle = idleAssets({ assets, assignments, now: current });
        const segments = network.segmentsByRoute.get(shipment.route_id) ?? [];
        const result = redeploymentCandidates({
          shipment,
          routeSegments: segments,
          idle,
          now: current,
        });
        option = result.data.find((item) => item.asset.id === body.asset_id) ?? null;
        rejected = result.rejected;
        if (!option) {
          throw conflict("Selected asset is not currently eligible", {
            reason: "target_not_eligible",
            rejected,
          });
        }
        target = { asset_id: body.asset_id };
      }

      const duplicate = await recommendationRepo.findPendingDuplicate(db, {
        shipment_id: body.shipment_id,
        type: body.type,
        route_id: target.route_id,
        carrier_id: target.carrier_id,
        asset_id: target.asset_id,
      });
      if (duplicate) {
        throw conflict("A pending recommendation already exists for this shipment and target", {
          recommendation_id: duplicate.id,
        });
      }

      const id = await nextEntityId(db, "recommendation");
      const created = await recommendationRepo.insertRecommendation(db, {
        id,
        type: body.type,
        shipment_id: body.shipment_id,
        ...target,
        score: option.score,
        factors: option.factors,
        constraints_checked: option.constraints_checked,
        rejected_alternatives: rejected,
        status: "pending",
      });
      const audit = await appendAuditRecord(db, {
        entity_type: "recommendation",
        entity_id: id,
        action: "created",
        actor: body.actor,
        details: { type: body.type, ...target, notes: body.notes ?? null },
      });
      res.status(201).json({ ...created, audit_record_id: audit.id });
    }),
  );

  // -------------------------------------------------------------------------
  // 25 — create fleet redeployment recommendation (convenience; A-5)
  // -------------------------------------------------------------------------
  router.post(
    "/fleet/redeployments/recommend",
    asyncHandler(async (req, res) => {
      const body = parse(fleetRedeploymentInputSchema, req.body);
      const shipment = await repo.getShipment(db, body.shipment_id);
      if (!shipment) throw notFound("Shipment", body.shipment_id);
      const asset = await repo.getFleetAsset(db, body.asset_id);
      if (!asset) throw notFound("Fleet asset", body.asset_id);
      if (!ACTIONABLE_STATUSES.includes(shipment.status)) {
        throw conflict("Shipment is not actionable", {
          reason: "shipment_not_actionable",
          status: shipment.status,
        });
      }

      const network = await loadNetwork();
      const [assets, assignments] = await Promise.all([
        repo.listFleetAssets(db, { limit: 500 }),
        repo.listAllAssignments(db),
      ]);
      const current = now();
      const idle = idleAssets({ assets, assignments, now: current });
      const segments = network.segmentsByRoute.get(shipment.route_id) ?? [];
      const result = redeploymentCandidates({
        shipment,
        routeSegments: segments,
        idle,
        now: current,
      });
      const option = result.data.find((item) => item.asset.id === body.asset_id) ?? null;
      if (!option) {
        throw conflict("Asset is no longer eligible for this shipment", {
          reason: "asset_not_eligible",
          rejected: result.rejected,
        });
      }

      const duplicate = await recommendationRepo.findPendingDuplicate(db, {
        shipment_id: body.shipment_id,
        type: "fleet_redeployment",
        asset_id: body.asset_id,
      });
      if (duplicate) {
        throw conflict("A pending recommendation already exists for this shipment and asset", {
          recommendation_id: duplicate.id,
        });
      }

      const id = await nextEntityId(db, "recommendation");
      const created = await recommendationRepo.insertRecommendation(db, {
        id,
        type: "fleet_redeployment",
        shipment_id: body.shipment_id,
        asset_id: body.asset_id,
        score: option.score,
        factors: option.factors,
        constraints_checked: option.constraints_checked,
        rejected_alternatives: result.rejected,
        status: "pending",
      });
      const audit = await appendAuditRecord(db, {
        entity_type: "recommendation",
        entity_id: id,
        action: "created",
        actor: body.actor,
        details: { type: "fleet_redeployment", asset_id: body.asset_id, notes: body.notes ?? null },
      });
      res.status(201).json({ ...created, audit_record_id: audit.id });
    }),
  );

  return router;
}
