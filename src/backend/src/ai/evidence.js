import { config } from "../common/config.js";
import { matchShipments } from "../logistics/matching.service.js";
import { detectExcursions } from "../coldchain/excursion.service.js";
import { coldchainRisk, combinedScore } from "../risk/risk.service.js";
import { recommendedAction, timeToDeliveryHours } from "../coldchain/evaluation.js";
import * as logisticsRepo from "../logistics/repository.js";
import * as coldchainRepo from "../coldchain/repository.js";
import * as recommendationRepo from "../audit/recommendation.repository.js";

export const EVIDENCE_LIMITS = {
  matchedDisruptions: 5,
  riskFactors: 8,
  triggeringSignals: 8,
  confidenceDrivers: 4,
};

const round3 = (value) => Math.round(Number(value) * 1000) / 1000;
const iso = (value) => (value == null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString());

export async function loadIncidentContext(db, now) {
  const [shipments, routes, segments, disruptions, policies, profiles] = await Promise.all([
    logisticsRepo.listShipments(db, { limit: 500 }),
    logisticsRepo.listRoutes(db, { limit: 500 }),
    logisticsRepo.listAllSegments(db),
    logisticsRepo.listActiveDisruptions(db, now),
    coldchainRepo.listTemperaturePolicies(db),
    coldchainRepo.listCargoProfiles(db),
  ]);

  const segmentsByRoute = new Map();
  for (const segment of segments) {
    segmentsByRoute.set(segment.route_id, [...(segmentsByRoute.get(segment.route_id) ?? []), segment]);
  }

  const matchingRows = matchShipments({ shipments, routes, segmentsByRoute, disruptions, now });

  return {
    matchingRows,
    policyByCargo: new Map(policies.map((policy) => [policy.cargo_type, policy])),
    sensitivityByCargo: new Map(profiles.map((profile) => [profile.cargo_type, profile.sensitivity_weight])),
  };
}

function riskFactors({ matchRow, disruptionRisk, cold, combined, confidence, worst, timeToDelivery }) {
  const factors = [
    `impact_status=${matchRow?.impact_status ?? "unaffected"}`,
    `disruption_risk=${round3(disruptionRisk)}`,
    `coldchain_risk=${round3(cold.risk_score)}`,
    `combined_score=${round3(combined)}`,
    `coldchain_severity=${cold.severity}`,
    `confidence_level=${confidence.level}`,
    `excursion_count=${cold.excursion_count}`,
  ];
  if (worst?.data_quality) factors.push(`excursion_data_quality=${worst.data_quality}`);
  if (timeToDelivery != null) factors.push(`time_to_delivery_hours=${timeToDelivery}`);
  return factors.slice(0, EVIDENCE_LIMITS.riskFactors);
}

function triggeringSignals({ matchRow, worst, reviewFlags }) {
  const signals = [];
  for (const entry of matchRow?.matched_disruptions ?? []) {
    signals.push(`disruption:${entry.disruption_id} severity=${entry.severity} status=${entry.status}`);
  }
  if (worst) {
    signals.push(
      `excursion:${worst.id} severity=${worst.severity} peak_deviation_c=${round3(worst.peak_deviation_c)} duration_min=${worst.duration_min}`,
    );
  }
  for (const flag of reviewFlags ?? []) signals.push(`review_flag:${flag}`);
  return signals.slice(0, EVIDENCE_LIMITS.triggeringSignals);
}

export async function buildIncidentEvidence(db, shipmentId, { now = new Date() } = {}) {
  const shipment = await logisticsRepo.getShipment(db, shipmentId);
  if (!shipment) return null;

  const context = await loadIncidentContext(db, now);
  const matchRow = context.matchingRows.find((row) => row.shipment.id === shipment.id) ?? null;
  const disruptionRisk = matchRow ? matchRow.impact_score : 0;

  let cold = { risk_score: 0, severity: "normal", worst_excursion_id: null, excursion_count: 0 };
  let reviewFlags = [];
  let worst = null;
  if (shipment.is_cold_chain) {
    const persisted = await coldchainRepo.listExcursions(db, { shipment_id: shipment.id, limit: 500 });
    const readings = await coldchainRepo.listReadingsByShipment(db, shipment.id);
    const policy = context.policyByCargo.get(shipment.cargo_type) ?? null;
    const cutoff = shipment.actual_arrival ? new Date(shipment.actual_arrival) : null;
    const detection = detectExcursions({ shipment, readings, policy, deliveryCutoff: cutoff, now });
    reviewFlags = detection.reviewFlags ?? [];
    const merged = [...persisted];
    for (const candidate of detection.excursions ?? []) {
      const start = new Date(candidate.start_time).getTime();
      if (!merged.some((row) => new Date(row.start_time).getTime() === start)) merged.push(candidate);
    }
    cold = coldchainRisk({ excursions: merged, reviewFlags });
    const open = merged.filter((row) => row.status !== "closed");
    worst = open.find((row) => row.severity === cold.severity) ?? open[0] ?? null;
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
  const timeToDelivery = timeToDeliveryHours(shipment, now);
  const action = recommendedAction(cold.severity);
  const humanReviewRequired = cold.severity !== "warning" && cold.severity !== "normal";

  const latestRecommendation = (
    await recommendationRepo.listRecommendations(db, { shipment_id: shipment.id, limit: 1 })
  )[0] ?? null;

  return {
    incident_id: shipment.id,
    incident_type: "shipment_risk",
    shipment: {
      id: shipment.id,
      status: shipment.status,
      cargo_type: shipment.cargo_type,
      is_cold_chain: shipment.is_cold_chain,
      cargo_value_usd: Number(shipment.cargo_value_usd),
      deadline: iso(shipment.deadline),
    },
    risk: {
      disruption_risk: round3(disruptionRisk),
      coldchain_risk: round3(cold.risk_score),
      combined_score: round3(combined),
      weights: { alpha: config.riskAlpha, beta: config.riskBeta },
    },
    disruption: {
      impact_status: matchRow?.impact_status ?? "unaffected",
      impact_score: round3(disruptionRisk),
      timing_basis: matchRow?.timing_basis ?? null,
      confidence: matchRow?.confidence ?? null,
      matched_disruptions: (matchRow?.matched_disruptions ?? [])
        .slice(0, EVIDENCE_LIMITS.matchedDisruptions)
        .map((entry) => ({
          disruption_id: entry.disruption_id,
          severity: entry.severity,
          status: entry.status,
          reason: entry.reason,
        })),
    },
    coldchain: {
      severity: cold.severity,
      worst_excursion: worst
        ? {
            id: worst.id ?? null,
            severity: worst.severity,
            status: worst.status,
            peak_deviation_c: Number(worst.peak_deviation_c),
            duration_min: worst.duration_min,
            data_quality: worst.data_quality,
            start_time: iso(worst.start_time),
            end_time: iso(worst.end_time),
          }
        : null,
      excursion_count: cold.excursion_count,
      data_quality: worst?.data_quality ?? null,
      confidence_level: confidence.level,
      confidence_drivers: confidence.drivers.slice(0, EVIDENCE_LIMITS.confidenceDrivers),
      recommended_action: action,
      human_review_required: humanReviewRequired,
      time_to_delivery_hours: timeToDelivery,
    },
    recommendation: latestRecommendation
      ? {
          id: latestRecommendation.id,
          type: latestRecommendation.type,
          target_id:
            latestRecommendation.route_id ?? latestRecommendation.carrier_id ?? latestRecommendation.asset_id ?? null,
          score: Number(latestRecommendation.score),
          status: latestRecommendation.status,
        }
      : null,
    risk_factors: riskFactors({ matchRow, disruptionRisk, cold, combined, confidence, worst, timeToDelivery }),
    triggering_signals: triggeringSignals({ matchRow, worst, reviewFlags }),
    generated_at: now.toISOString(),
  };
}
