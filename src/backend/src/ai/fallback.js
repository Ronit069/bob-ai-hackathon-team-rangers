const displayCargo = (cargoType) => String(cargoType ?? "").replace(/_/g, " ");

export function buildDeterministicBrief(evidence) {
  const { risk, disruption, coldchain, shipment } = evidence;
  const matchedIds = disruption.matched_disruptions.map((entry) => entry.disruption_id);

  const summary =
    `Shipment ${evidence.incident_id} (${displayCargo(shipment.cargo_type)}) has a combined risk score of ` +
    `${risk.combined_score}: disruption risk ${risk.disruption_risk}, cold-chain risk ${risk.coldchain_risk}. ` +
    `Impact status is ${disruption.impact_status}.`;

  const whyParts = [];
  if (matchedIds.length > 0) {
    whyParts.push(`Matched active disruptions: ${matchedIds.join(", ")}.`);
  } else {
    whyParts.push("No active disruption match is recorded for this shipment.");
  }
  if (coldchain.worst_excursion) {
    const excursion = coldchain.worst_excursion;
    whyParts.push(
      `Worst open excursion${excursion.id ? ` ${excursion.id}` : ""} is ${coldchain.severity} with peak deviation ` +
        `${excursion.peak_deviation_c} °C and duration ${excursion.duration_min} min.`,
    );
  } else if (shipment.is_cold_chain) {
    whyParts.push("No open temperature excursion is recorded for this cold-chain shipment.");
  }
  if (coldchain.human_review_required) {
    whyParts.push("The deterministic system requires human review before acting on this incident.");
  }
  if (coldchain.time_to_delivery_hours != null) {
    whyParts.push(`Time to the shipment deadline is ${coldchain.time_to_delivery_hours} hours.`);
  }

  const evidenceUsed = [
    `combined_score=${risk.combined_score}`,
    `disruption_risk=${risk.disruption_risk}`,
    `coldchain_risk=${risk.coldchain_risk}`,
    `impact_status=${disruption.impact_status}`,
    `coldchain_severity=${coldchain.severity}`,
    `confidence_level=${coldchain.confidence_level}`,
  ];
  if (coldchain.worst_excursion) {
    const excursion = coldchain.worst_excursion;
    evidenceUsed.push(
      excursion.id
        ? `worst_excursion=${excursion.id} severity=${excursion.severity}`
        : `worst_excursion_severity=${excursion.severity} peak_deviation_c=${excursion.peak_deviation_c}`,
    );
  }

  const limitations = [
    "This brief was generated deterministically from stored evidence; no language model was used.",
  ];
  if (coldchain.confidence_level === "low") {
    const drivers = coldchain.confidence_drivers.length > 0 ? ` (${coldchain.confidence_drivers.join(", ")})` : "";
    limitations.push(`Confidence in the cold-chain risk inputs is low${drivers}.`);
  }
  if (coldchain.worst_excursion && coldchain.worst_excursion.data_quality !== "complete") {
    limitations.push(`Excursion data quality is ${coldchain.worst_excursion.data_quality}.`);
  }
  if (!coldchain.worst_excursion && shipment.is_cold_chain) {
    limitations.push("Absence of a recorded excursion is not proof of cargo safety.");
  }

  return {
    summary,
    whyItMatters: whyParts.join(" "),
    evidenceUsed,
    recommendedNextStep: coldchain.recommended_action,
    limitations,
  };
}
