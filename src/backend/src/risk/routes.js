// Risk endpoints (18/19) — combined priority score (P2), nested factors (RC-3).
// Reuses the frozen matching + excursion + risk services; no formula changes.

import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { notFound } from "../common/errors.js";
import { nextEntityId } from "../common/ids.js";
import { config } from "../common/config.js";
import { parse, riskQuerySchema, overviewQuerySchema } from "../common/validation.js";
import * as repo from "./repository.js";
import * as logisticsRepo from "../logistics/repository.js";
import * as coldchainRepo from "../coldchain/repository.js";
import { matchShipments } from "../logistics/matching.service.js";
import { detectExcursions } from "../coldchain/excursion.service.js";
import { coldchainRisk, combinedScore } from "./risk.service.js";
import { refreshExcursions, recommendedAction, timeToDeliveryHours } from "../coldchain/evaluation.js";

const ACTIONABLE_STATUSES = ["planned", "in_transit", "delayed"];

// Key-sorted stringify so jsonb key reordering by PostgreSQL cannot cause
// false "changed" comparisons during the Phase 6 snapshot write-throttle.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameAssessment(stored, fresh) {
  return (
    Number(stored.disruption_risk) === fresh.disruption_risk &&
    Number(stored.coldchain_risk) === fresh.coldchain_risk &&
    Number(stored.combined_score) === fresh.combined_score &&
    stableStringify(stored.factors) === stableStringify(fresh.factors)
  );
}

export function createRiskRouter(db) {
  const router = Router();

  async function loadContext() {
    const [shipments, routes, segments, disruptions, policies, profiles] = await Promise.all([
      logisticsRepo.listShipments(db, { limit: 500 }),
      logisticsRepo.listRoutes(db, { limit: 500 }),
      logisticsRepo.listAllSegments(db),
      logisticsRepo.listActiveDisruptions(db, new Date()),
      coldchainRepo.listTemperaturePolicies(db),
      coldchainRepo.listCargoProfiles(db),
    ]);
    const segmentsByRoute = new Map();
    for (const segment of segments) {
      segmentsByRoute.set(segment.route_id, [...(segmentsByRoute.get(segment.route_id) ?? []), segment]);
    }
    // Matching runs over the whole network so impact scores are normalised across the
    // full affected set (frozen formula) — identical to the generated ground truth.
    const matchingRows = matchShipments({
      shipments,
      routes,
      segmentsByRoute,
      disruptions,
      now: new Date(),
    });
    return {
      shipments,
      routes,
      segmentsByRoute,
      disruptions,
      matchingRows,
      policyByCargo: new Map(policies.map((policy) => [policy.cargo_type, policy])),
      sensitivityByCargo: new Map(profiles.map((profile) => [profile.cargo_type, profile.sensitivity_weight])),
    };
  }

  async function computeRisk(shipment, context, now, previous = null) {
    // Disruption risk — frozen rule: impact_score when affected, else 0.
    const matchRow =
      context.matchingRows.find((row) => row.shipment.id === shipment.id) ?? null;
    const disruptionRisk = matchRow ? matchRow.impact_score : 0;

    // Cold-chain risk — worst open excursion, review flags score 0.5.
    let cold = { risk_score: 0, severity: "normal", worst_excursion_id: null, excursion_count: 0 };
    let reviewFlags = [];
    let worst = null;
    if (shipment.is_cold_chain) {
      await refreshExcursions(db, { shipmentId: shipment.id, now });
      const persisted = await coldchainRepo.listExcursions(db, {
        shipment_id: shipment.id,
        limit: 500,
      });
      const readings = await coldchainRepo.listReadingsByShipment(db, shipment.id);
      const policy = context.policyByCargo.get(shipment.cargo_type) ?? null;
      const cutoff = shipment.actual_arrival ? new Date(shipment.actual_arrival) : null;
      const detection = detectExcursions({ shipment, readings, policy, deliveryCutoff: cutoff, now });
      reviewFlags = detection.reviewFlags ?? [];
      cold = coldchainRisk({ excursions: persisted, reviewFlags });
      worst = persisted.find((row) => row.severity === cold.severity) ?? persisted[0] ?? null;
    }

    const confidence =
      reviewFlags.length > 0
        ? { level: "low", drivers: reviewFlags }
        : worst && worst.data_quality !== "complete"
          ? { level: "low", drivers: [`data_quality:${worst.data_quality}`] }
          : { level: "high", drivers: [] };

    const combined = combinedScore({
      disruptionRisk,
      coldchainRisk: cold.risk_score,
      alpha: config.riskAlpha,
      beta: config.riskBeta,
    });

    const factors = {
      disruption: {
        impact_score: disruptionRisk,
        affected_disruption_ids: matchRow
          ? [...new Set(matchRow.matched_disruptions.map((entry) => entry.disruption_id))]
          : [],
        impact_status: matchRow?.impact_status ?? "unaffected",
      },
      coldchain: {
        worst_excursion_id: worst?.id ?? null,
        severity: cold.severity,
        peak_deviation_c: worst?.peak_deviation_c ?? null,
        duration_min: worst?.duration_min ?? null,
        time_to_delivery_hours: timeToDeliveryHours(shipment, now),
        data_quality: worst?.data_quality ?? null,
        cargo_sensitivity: context.sensitivityByCargo.get(shipment.cargo_type) ?? null,
        excursion_count: cold.excursion_count,
        confidence_level: confidence.level,
        confidence_drivers: confidence.drivers,
        recommended_action: recommendedAction(cold.severity),
        human_review_required: cold.severity !== "warning" && cold.severity !== "normal",
      },
      weights: { alpha: config.riskAlpha, beta: config.riskBeta },
    };

    const fresh = {
      shipment_id: shipment.id,
      disruption_risk: disruptionRisk,
      coldchain_risk: cold.risk_score,
      combined_score: combined,
      factors,
      computed_at: now.toISOString(),
    };

    // Phase 6 F5 write-throttle: snapshot rows are history, so a recomputed
    // assessment that equals the latest stored one is not persisted again.
    // The response always carries the freshly computed values (same formulas).
    if (previous && sameAssessment(previous, fresh)) return fresh;

    const id = await nextEntityId(db, "riskAssessment");
    const assessment = await repo.insertRiskAssessment(db, {
      id,
      shipment_id: shipment.id,
      disruption_risk: disruptionRisk,
      coldchain_risk: cold.risk_score,
      combined_score: combined,
      factors,
      computed_at: now,
    });

    return {
      shipment_id: assessment.shipment_id,
      disruption_risk: Number(assessment.disruption_risk),
      coldchain_risk: Number(assessment.coldchain_risk),
      combined_score: Number(assessment.combined_score),
      factors: assessment.factors,
      computed_at: assessment.computed_at,
    };
  }

  // 18 — combined risk for one shipment
  router.get(
    "/shipments/:id/risk",
    asyncHandler(async (req, res) => {
      const query = parse(riskQuerySchema, req.query);
      const shipment = await logisticsRepo.getShipment(db, req.params.id);
      if (!shipment) throw notFound("Shipment", req.params.id);

      if (!query.refresh) {
        const stored = await repo.getLatestRiskAssessment(db, shipment.id);
        if (!stored) throw notFound("Risk assessment for shipment", shipment.id);
        res.json({
          shipment_id: stored.shipment_id,
          disruption_risk: Number(stored.disruption_risk),
          coldchain_risk: Number(stored.coldchain_risk),
          combined_score: Number(stored.combined_score),
          factors: stored.factors,
          computed_at: stored.computed_at,
        });
        return;
      }

      const context = await loadContext();
      const previous = await repo.getLatestRiskAssessment(db, shipment.id);
      res.json(await computeRisk(shipment, context, new Date(), previous));
    }),
  );

  // 19 — ranked worklist across actionable shipments
  router.get(
    "/risk/overview",
    asyncHandler(async (req, res) => {
      const query = parse(overviewQuerySchema, req.query);
      const now = new Date();
      const [shipments, context, latestSnapshots] = await Promise.all([
        logisticsRepo.listShipments(db, { limit: 500 }),
        loadContext(),
        repo.listRiskAssessments(db, { limit: 1000 }),
      ]);
      const latestByShipment = new Map(latestSnapshots.map((row) => [row.shipment_id, row]));

      const results = [];
      for (const shipment of shipments.filter((row) => ACTIONABLE_STATUSES.includes(row.status))) {
        const assessment = await computeRisk(shipment, context, now, latestByShipment.get(shipment.id) ?? null);
        if (!query.include_zero && assessment.combined_score === 0) continue;
        results.push({
          shipment: {
            id: shipment.id,
            cargo_type: shipment.cargo_type,
            is_cold_chain: shipment.is_cold_chain,
            status: shipment.status,
            deadline: shipment.deadline,
          },
          ...assessment,
        });
      }

      results.sort(
        (a, b) =>
          b.combined_score - a.combined_score || a.shipment.id.localeCompare(b.shipment.id),
      );
      const data = results.slice(0, query.limit);
      res.json({ data, count: data.length, computed_at: now.toISOString() });
    }),
  );

  return router;
}
