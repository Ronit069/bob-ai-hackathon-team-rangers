# Problem Statement

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Event:** Bobathon 2026 — Logistics & Ports, Problem L2

---

## Official Challenge

Supply-chain disruptions — weather events, port strikes, geopolitical crises — cascade across hundreds of active shipments in ways that are impossible to track manually. Fleet assets (trucks, containers, vessels) sit idle while other routes are overloaded. Cold-chain shipments (vaccines, perishables) are especially vulnerable: a single temperature excursion across any leg can spoil a high-value cargo, but breaches are often discovered only at delivery, when it is too late to act.

The official L2 challenge is to build a Bob-powered solution that:

1. Identifies which shipments are affected by an active disruption.
2. Recommends rerouting or alternative carrier options.
3. Identifies idle fleet assets for redeployment.
4. Monitors cold-chain IoT sensor logs to detect temperature excursions and classify their severity before delivery.

---

## The Deeper Problem

Mid-size freight and 3PL operators face three correlated risk problems that are typically managed in separate tools or spreadsheets:

**Disruption impact** — When a port strike or weather event is declared, operators have no fast way to know which shipments are affected, how urgently, or what alternatives exist. Matching shipments to disruptions requires cross-referencing route segments, carrier status, and timing windows — work that is manual and error-prone under time pressure.

**Fleet idle capacity** — Fleet assets that could cover disrupted routes sit idle without visibility. Identifying available, compatible assets (correct capacity, refrigeration, proximity) and ranking them for redeployment requires combining assignment state, operational status, and location data that does not currently live in one place.

**Cold-chain integrity** — Temperature-sensitive cargo (vaccines, biologics, produce) requires continuous monitoring across transit. Excursions outside policy limits need to be detected, classified by severity, and surfaced to compliance officers while there is still time to intervene. Currently, breaches are frequently found at delivery — after the cargo is already a write-off.

These three problems are **correlated**: a disruption can delay a cold-chain shipment whose sensor data simultaneously shows a developing excursion, compounding risk in ways no single-domain tool can detect.

---

## Limitations of the Current State

- No single view across disruption, fleet, and cold-chain risk.
- Affected-shipment identification is manual and does not account for timing windows or multi-disruption exposure.
- Fleet idle detection is decoupled from shipment needs and compatibility rules.
- Cold-chain monitoring happens after the fact; severity classification is applied by lab tests at destination.
- Decision support is absent: operators work from data but have no ranked, explainable action plan.

---

## Synthetic Data Notice

This project uses entirely synthetic data. No real shipment, carrier, sensor, or regulatory dataset is used or claimed. All policy thresholds, impact scores, and carrier details are configurable illustrative values, not production or regulatory benchmarks.
