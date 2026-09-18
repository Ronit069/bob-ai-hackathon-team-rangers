// AI Incident Commander — deterministic explanation fallback (Feature 2).
// Shaped exactly like the grounded brief so the same renderer/grounding rules apply.
// Only values present in the command evidence are referenced.

const displayCargo = (value) => String(value ?? "unknown cargo").replace(/_/g, " ");

export function buildDeterministicCommandExplanation(evidence) {
  const { incident, incident_summary: counts, priority_shipment: priority, coldchain, proposal } = evidence;

  const summaryParts = [];
  if (incident) {
    summaryParts.push(
      `I investigated incident ${incident.disruption_id} (${displayCargo(incident.type)} in ${incident.region_code}): ${incident.description}`,
    );
  } else {
    summaryParts.push("I reviewed the available ChainSentinel data for this request.");
  }
  if (evidence.affected_shipments.length > 0) {
    summaryParts.push(
      `${counts.affected_count} affected shipment(s) are recorded in the current evidence, ` +
        `of which ${counts.cold_chain_count} cold-chain and ${counts.critical_count} with critical impact status.`,
    );
  } else if (incident) {
    summaryParts.push("No affected shipments are currently recorded for this incident.");
  }
  if (priority) {
    const score =
      priority.combined_score != null
        ? ` with a ChainSentinel combined risk score of ${priority.combined_score}`
        : "";
    summaryParts.push(
      `The highest-priority shipment is ${priority.shipment_id} (${displayCargo(priority.cargo_type)}` +
        `${priority.is_cold_chain ? ", cold chain" : ""})${score}.`,
    );
  }
  if (proposal) {
    summaryParts.push(`Recovery proposal ${proposal.id} is pending human approval.`);
  }

  const whyParts = [];
  if (priority) {
    whyParts.push(
      `The ChainSentinel risk engine classifies ${priority.shipment_id} with impact status ${priority.impact_status}.`,
    );
    if (coldchain?.severity) whyParts.push(`The cold-chain severity is ${coldchain.severity}.`);
    if (coldchain?.worst_excursion) {
      const excursion = coldchain.worst_excursion;
      whyParts.push(
        `The worst open excursion${excursion.id ? ` ${excursion.id}` : ""} has peak deviation ` +
          `${excursion.peak_deviation_c} °C over ${excursion.duration_min} min with data quality ${excursion.data_quality}.`,
      );
    }
    if (coldchain?.recommended_action) {
      whyParts.push(`The deterministic recommended action is: ${coldchain.recommended_action}.`);
    }
    if (coldchain?.human_review_required) {
      whyParts.push("The deterministic system requires human review before acting on this incident.");
    }
  }
  whyParts.push(
    counts.available_assets_count > 0
      ? `There are ${counts.available_assets_count} idle fleet assets, of which ${counts.refrigerated_assets_count} are refrigerated.`
      : "No idle fleet assets were returned by the fleet service.",
  );
  if (evidence.recommendation) {
    whyParts.push(
      `Existing recommendation ${evidence.recommendation.id} (${displayCargo(evidence.recommendation.type)}) has status ${evidence.recommendation.status}.`,
    );
  }

  const evidenceUsed = [
    `affected_count=${counts.affected_count}`,
    `cold_chain_count=${counts.cold_chain_count}`,
    `critical_count=${counts.critical_count}`,
    `available_assets_count=${counts.available_assets_count}`,
    `refrigerated_assets_count=${counts.refrigerated_assets_count}`,
  ];
  if (incident) evidenceUsed.push(`incident=${incident.disruption_id}`);
  if (priority) {
    evidenceUsed.push(
      `priority_shipment=${priority.shipment_id}`,
      `impact_status=${priority.impact_status}`,
    );
    if (priority.combined_score != null) evidenceUsed.push(`combined_score=${priority.combined_score}`);
  }
  if (coldchain?.severity) evidenceUsed.push(`coldchain_severity=${coldchain.severity}`);
  if (evidence.recommendation) evidenceUsed.push(`recommendation=${evidence.recommendation.id}`);
  if (proposal) evidenceUsed.push(`proposal=${proposal.id}`);

  let recommendedNextStep;
  if (proposal) {
    recommendedNextStep =
      `Recovery proposal ${proposal.id} is pending human approval; an authorized operator must decide in the dashboard.`;
  } else if (coldchain?.recommended_action) {
    recommendedNextStep = coldchain.recommended_action;
  } else if (evidence.recommendation) {
    recommendedNextStep =
      `Existing recommendation ${evidence.recommendation.id} requires a human decision in the dashboard.`;
  } else {
    recommendedNextStep = "Monitor the incident through the dashboard; no action has been taken.";
  }

  const limitations = [];
  if (evidence.missing_tools.length > 0) {
    limitations.push(
      `The following operations failed or were unavailable and are excluded from the analysis: ` +
        `${evidence.missing_tools.join(", ")}. This result is partial.`,
    );
  }
  if (evidence.affected_shipments.length === 0 && incident) {
    limitations.push(
      "No affected shipments appear in the current evidence; absence of matches is not proof that no shipment is exposed.",
    );
  }
  if (evidence.proposal_status && !evidence.proposal && evidence.proposal_status !== "not_created") {
    limitations.push("A recovery proposal was requested but could not be prepared; no recommendation was created.");
  }
  limitations.push("This response is advisory: no operational action has been executed.");
  if (proposal) {
    limitations.push(
      "Proposal creation records a pending recommendation only; approval and execution remain human actions in the dashboard.",
    );
  }

  return {
    summary: summaryParts.join(" "),
    whyItMatters: whyParts.join(" "),
    evidenceUsed,
    recommendedNextStep,
    limitations,
  };
}
