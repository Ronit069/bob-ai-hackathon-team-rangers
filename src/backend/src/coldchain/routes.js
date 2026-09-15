// Cold-chain REST endpoints (12–17, 28) — exactly per docs/phase-0/api-contract.md.
// Reuses the Phase 2 deterministic detection/severity services; no formula changes.

import { Router } from "express";
import { asyncHandler, sendList } from "../common/http.js";
import { conflict, notFound, validationError } from "../common/errors.js";
import { nextEntityId } from "../common/ids.js";
import { config } from "../common/config.js";
import {
  parse,
  sensorReadingsEnvelopeSchema,
  sensorReadingInputSchema,
  sensorReadingsQuerySchema,
  excursionsQuerySchema,
  policiesQuerySchema,
  excursionStatusInputSchema,
  policyUpdateInputSchema,
} from "../common/validation.js";
import * as repo from "./repository.js";
import * as logisticsRepo from "../logistics/repository.js";
import { appendAuditRecord } from "../audit/repository.js";
import { computeQuality, sensorStatus } from "./excursion.service.js";
import { refreshExcursions, recommendedAction, timeToDeliveryHours } from "./evaluation.js";

export function createColdchainRouter(db) {
  const router = Router();

  // -------------------------------------------------------------------------
  // 12 — ingest sensor readings (R4)
  // -------------------------------------------------------------------------
  router.post(
    "/sensor-readings",
    asyncHandler(async (req, res) => {
      const envelope = parse(sensorReadingsEnvelopeSchema, req.body);
      const now = new Date();
      const shipmentCache = new Map();
      const accepted = [];
      const rejected = [];

      for (let index = 0; index < envelope.readings.length; index += 1) {
        const parsed = sensorReadingInputSchema.safeParse(envelope.readings[index]);
        if (!parsed.success) {
          rejected.push({
            index,
            reason: "invalid_reading",
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
          continue;
        }
        const reading = parsed.data;
        if (!shipmentCache.has(reading.shipment_id)) {
          shipmentCache.set(reading.shipment_id, await logisticsRepo.getShipment(db, reading.shipment_id));
        }
        const shipment = shipmentCache.get(reading.shipment_id);
        if (!shipment) {
          rejected.push({ index, reason: "shipment_not_found", shipment_id: reading.shipment_id });
          continue;
        }
        accepted.push({ ...reading, _cold: shipment.is_cold_chain });
      }

      // Decision D5: an all-invalid batch is a client error.
      if (accepted.length === 0) {
        throw validationError("No valid readings in the batch", { rejected });
      }

      const byShipment = new Map();
      for (const reading of accepted) {
        byShipment.set(reading.shipment_id, [...(byShipment.get(reading.shipment_id) ?? []), reading]);
      }

      const toInsert = [];
      const qualityFlags = [];
      for (const [shipmentId, readings] of byShipment) {
        const existing = await repo.listReadingsByShipment(db, shipmentId);
        const existingKeys = new Set(
          existing.map((row) => `${row.sensor_id}|${new Date(row.timestamp).toISOString()}`),
        );
        let maxTimestamp = existing.length
          ? new Date(existing[existing.length - 1].timestamp).getTime()
          : null;

        const ordered = [...readings].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        for (const reading of ordered) {
          const id = await nextEntityId(db, "sensorReading");
          const key = `${reading.sensor_id}|${new Date(reading.timestamp).toISOString()}`;
          const timestamp = new Date(reading.timestamp).getTime();
          const flags = [];
          if (existingKeys.has(key)) flags.push("duplicate");
          existingKeys.add(key);
          if (maxTimestamp !== null && timestamp < maxTimestamp) flags.push("out_of_order");
          maxTimestamp = maxTimestamp === null ? timestamp : Math.max(maxTimestamp, timestamp);
          if (reading.temperature_c < -40 || reading.temperature_c > 60) flags.push("implausible");
          if (!reading._cold) flags.push("non_cold_shipment");

          toInsert.push({
            id,
            shipment_id: reading.shipment_id,
            sensor_id: reading.sensor_id,
            timestamp: reading.timestamp,
            temperature_c: reading.temperature_c,
            humidity_pct: reading.humidity_pct ?? null,
            source: reading.source,
          });
          qualityFlags.push({ reading_id: id, flags });
        }
      }

      await repo.insertSensorReadingsBatch(db, toInsert);

      // Approved design: detection runs on ingestion and persists excursions.
      // No audit row per reading (deliberate boundary — see member-2 data design §7).
      for (const shipmentId of new Set(toInsert.map((row) => row.shipment_id))) {
        await refreshExcursions(db, { shipmentId, now });
      }

      res.status(201).json({ ingested: toInsert.length, rejected, quality_flags: qualityFlags });
    }),
  );

  // -------------------------------------------------------------------------
  // 13 — readings + quality + sensor health (R4)
  // -------------------------------------------------------------------------
  router.get(
    "/shipments/:id/sensor-readings",
    asyncHandler(async (req, res) => {
      const query = parse(sensorReadingsQuerySchema, req.query);
      const shipment = await logisticsRepo.getShipment(db, req.params.id);
      if (!shipment) throw notFound("Shipment", req.params.id);

      const now = new Date();
      await refreshExcursions(db, { shipmentId: shipment.id, now });

      const readings = await repo.listReadingsByShipment(db, shipment.id, {
        from: query.from,
        to: query.to,
      });
      const quality = computeQuality(readings);
      const status = sensorStatus(quality, now);
      const policy = await repo.getLatestPolicyForCargo(db, shipment.cargo_type);

      const data = readings.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        temperature_c: row.temperature_c,
      }));
      if (query.order === "desc") data.reverse();

      res.json({
        data,
        count: data.length,
        quality: {
          gaps: quality.gaps.length,
          duplicates: quality.duplicates,
          out_of_order: quality.outOfOrder ? 1 : 0,
          implausible: quality.implausible.length,
          sensor_status: status.status,
        },
        sensor: status,
        policy: policy ? { id: policy.id, min_c: policy.min_c, max_c: policy.max_c } : null,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // 14 — excursions (R5)
  // -------------------------------------------------------------------------
  router.get(
    "/excursions",
    asyncHandler(async (req, res) => {
      const query = parse(excursionsQuerySchema, req.query);
      const now = new Date();

      if (query.shipment_id) {
        const shipment = await logisticsRepo.getShipment(db, query.shipment_id);
        if (!shipment) throw notFound("Shipment", query.shipment_id);
        await refreshExcursions(db, { shipmentId: query.shipment_id, now });
      } else {
        await refreshExcursions(db, { now });
      }

      const rows = await repo.listExcursions(db, {
        shipment_id: query.shipment_id,
        severity: query.severity,
        status: query.status,
        active_only: query.active_only,
        limit: query.limit,
      });

      const shipmentCache = new Map();
      for (const row of rows) {
        if (!shipmentCache.has(row.shipment_id)) {
          shipmentCache.set(row.shipment_id, await logisticsRepo.getShipment(db, row.shipment_id));
        }
      }

      const data = rows.map((row) => ({
        ...row,
        time_to_delivery_hours: timeToDeliveryHours(shipmentCache.get(row.shipment_id), now),
        recommended_action: recommendedAction(row.severity),
      }));
      sendList(res, data);
    }),
  );

  // -------------------------------------------------------------------------
  // 15 — cold-chain alerts (R5)
  // -------------------------------------------------------------------------
  router.get(
    "/alerts/coldchain",
    asyncHandler(async (_req, res) => {
      const now = new Date();
      await refreshExcursions(db, { now });

      const [excursions, shipments, latestReadings] = await Promise.all([
        repo.listExcursions(db, { active_only: true, limit: 500 }),
        logisticsRepo.listShipments(db, { is_cold_chain: true, limit: 500 }),
        repo.listLatestReadingsByShipment(db),
      ]);

      const latestByShipment = new Map(latestReadings.map((row) => [row.shipment_id, row]));
      const data = [];

      for (const excursion of excursions) {
        data.push({
          type: "excursion",
          severity: excursion.severity,
          shipment_id: excursion.shipment_id,
          excursion_id: excursion.id,
          summary: `Peak deviation ${excursion.peak_deviation_c}°C, ${excursion.duration_min} min${
            excursion.data_quality !== "complete" ? `, data quality: ${excursion.data_quality}` : ""
          }`,
          human_review_required: excursion.severity !== "warning",
        });
      }

      for (const shipment of shipments) {
        const latest = latestByShipment.get(shipment.id);
        const minutes = latest
          ? Math.round((now.getTime() - new Date(latest.timestamp).getTime()) / 60_000)
          : null;
        if (minutes === null || minutes >= config.sensorIntervalMin * 4) {
          data.push({
            type: "sensor_failure",
            shipment_id: shipment.id,
            sensor_id: latest?.sensor_id ?? null,
            summary: minutes === null ? "No readings received" : `No readings for ${minutes} minutes`,
            human_review_required: true,
          });
        }
      }

      sendList(res, data);
    }),
  );

  // -------------------------------------------------------------------------
  // 16/17 — temperature policies (R6)
  // -------------------------------------------------------------------------
  router.get(
    "/temperature-policies",
    asyncHandler(async (req, res) => {
      const query = parse(policiesQuerySchema, req.query);
      const rows = await repo.listTemperaturePolicies(db, {
        includeHistory: query.include_history,
      });
      sendList(res, rows);
    }),
  );

  router.put(
    "/temperature-policies/:id",
    asyncHandler(async (req, res) => {
      const body = parse(policyUpdateInputSchema, req.body);
      const existing = await repo.getTemperaturePolicy(db, req.params.id);
      if (!existing) throw notFound("Temperature policy", req.params.id);

      const latest = await repo.getLatestPolicyForCargo(db, existing.cargo_type);
      const version = (latest?.version ?? existing.version) + 1;
      const cargoKey = existing.cargo_type.toUpperCase();
      const id = version === 1 ? `TP-${cargoKey}` : `TP-${cargoKey}_V${version}`;

      const created = await repo.insertTemperaturePolicy(db, {
        id,
        cargo_type: existing.cargo_type,
        ...body,
        version,
        effective_from: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await appendAuditRecord(db, {
        entity_type: "temperature_policy",
        entity_id: id,
        action: "policy_updated",
        actor: body.updated_by,
        details: {
          cargo_type: existing.cargo_type,
          before: {
            min_c: existing.min_c,
            max_c: existing.max_c,
            max_excursion_minutes: existing.max_excursion_minutes,
            minor_deviation_c: existing.minor_deviation_c,
            major_deviation_c: existing.major_deviation_c,
            critical_duration_minutes: existing.critical_duration_minutes,
            version: existing.version,
          },
          after: {
            min_c: body.min_c,
            max_c: body.max_c,
            max_excursion_minutes: body.max_excursion_minutes,
            minor_deviation_c: body.minor_deviation_c,
            major_deviation_c: body.major_deviation_c,
            critical_duration_minutes: body.critical_duration_minutes,
            version,
          },
        },
      });

      res.json(created);
    }),
  );

  // -------------------------------------------------------------------------
  // 28 — excursion review lifecycle (B-7)
  // -------------------------------------------------------------------------
  router.patch(
    "/excursions/:id",
    asyncHandler(async (req, res) => {
      const body = parse(excursionStatusInputSchema, req.body);
      const excursion = await repo.getTemperatureExcursion(db, req.params.id);
      if (!excursion) throw notFound("Excursion", req.params.id);

      const allowed =
        (excursion.status === "open" && body.status === "acknowledged") ||
        ((excursion.status === "open" || excursion.status === "acknowledged") &&
          body.status === "closed");
      if (!allowed) {
        throw conflict(`Cannot transition excursion from ${excursion.status} to ${body.status}`, {
          from: excursion.status,
          to: body.status,
        });
      }
      if (body.status === "closed" && excursion.severity === "critical" && !body.note?.trim()) {
        throw validationError("Closing a critical excursion requires a note", { field: "note" });
      }

      const updated = await repo.updateExcursionStatus(db, req.params.id, body);
      const audit = await appendAuditRecord(db, {
        entity_type: "temperature_excursion",
        entity_id: excursion.id,
        action: body.status,
        actor: body.actor,
        details: { from: excursion.status, to: body.status, note: body.note ?? null },
      });
      res.json({ ...updated, audit_record_id: audit.id });
    }),
  );

  return router;
}


