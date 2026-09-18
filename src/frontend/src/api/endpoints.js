// One thin wrapper per frozen REST endpoint (api-contract.md). Pass-through only:
// the frontend never computes scores, severities, rankings or durations.

import { request } from "./client.js";

export const api = {
  // 1
  health: () => request("/health"),

  // 2/3/4 — disruptions
  listDisruptions: (query) => request("/disruptions", { query }),
  createDisruption: (body) => request("/disruptions", { method: "POST", body }),
  updateDisruption: (id, body) => request(`/disruptions/${id}`, { method: "PATCH", body }),

  // 5 — affected shipments
  affectedShipments: (disruptionId, query) =>
    request(`/disruptions/${disruptionId}/affected-shipments`, { query }),

  // 6/7 — shipments
  listShipments: (query) => request("/shipments", { query }),
  getShipment: (id) => request(`/shipments/${id}`),

  // 8/9 — alternatives
  routeAlternatives: (shipmentId, query) =>
    request(`/shipments/${shipmentId}/route-alternatives`, { query }),
  carrierAlternatives: (shipmentId, query) =>
    request(`/shipments/${shipmentId}/carrier-alternatives`, { query }),

  // 10/11 — fleet
  idleAssets: (query) => request("/fleet/idle", { query }),
  redeploymentCandidates: (shipmentId, query) =>
    request(`/shipments/${shipmentId}/redeployment-candidates`, { query }),

  // 12/13 — sensor readings
  ingestReadings: (body) => request("/sensor-readings", { method: "POST", body }),
  sensorReadings: (shipmentId, query) =>
    request(`/shipments/${shipmentId}/sensor-readings`, { query }),

  // 14/15 — excursions and alerts
  listExcursions: (query) => request("/excursions", { query }),
  alerts: () => request("/alerts/coldchain"),

  // 16/17 — temperature policies
  listPolicies: (query) => request("/temperature-policies", { query }),
  updatePolicy: (id, body) => request(`/temperature-policies/${id}`, { method: "PUT", body }),

  // 18/19 — risk
  shipmentRisk: (shipmentId, query) => request(`/shipments/${shipmentId}/risk`, { query }),
  riskOverview: (query) => request("/risk/overview", { query }),

  // 20/21/24/25 — recommendations
  listRecommendations: (query) => request("/recommendations", { query }),
  decideRecommendation: (id, body) =>
    request(`/recommendations/${id}/decision`, { method: "POST", body }),
  createRecommendation: (body) => request("/recommendations", { method: "POST", body }),
  recommendRedeployment: (body) =>
    request("/fleet/redeployments/recommend", { method: "POST", body }),

  // 22/23 — audit and Bob
  audit: (query) => request("/audit", { query }),
  bobQuery: (body) => request("/bob/query", { method: "POST", body }),

  // Grounded AI incident brief (feature-flagged server-side; deterministic fallback otherwise)
  incidentBrief: (body) => request("/ai/incident-brief", { method: "POST", body }),

  // AI Incident Commander (feature-flagged server-side; proposal stops at pending approval)
  incidentCommand: (body) => request("/ai/incident-command", { method: "POST", body }),

  // 26/27/28 — fleet view, carriers, excursion review
  fleet: (query) => request("/fleet", { query }),
  carriers: (query) => request("/carriers", { query }),
  patchExcursion: (id, body) => request(`/excursions/${id}`, { method: "PATCH", body }),
};
