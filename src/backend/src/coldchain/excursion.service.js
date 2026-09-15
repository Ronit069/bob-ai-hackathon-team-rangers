// Temperature excursion detection (R5) and severity classification (R6)
// Frozen rules: scope-freeze.md §1.2 + Phase 1A B-3/B-5/B-6/B-8.
// Pure functions: inputs are injected; no database access.

export const DEFAULT_INTERVAL_MIN = 15;
export const DEFAULT_GROUP_GAP_MIN = 30;

export const IMPLAUSIBLE_MIN_C = -40;
export const IMPLAUSIBLE_MAX_C = 60;

export function isBreach(temperature, policy) {
  return temperature < Number(policy.min_c) || temperature > Number(policy.max_c);
}

// Dedupe by (sensor_id, timestamp), detect out-of-order ingestion, then order by timestamp.
export function normalizeReadings(readings) {
  const seen = new Set();
  const deduped = [];
  let duplicates = 0;

  for (const reading of readings) {
    const key = `${reading.sensor_id}|${new Date(reading.timestamp).toISOString()}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    deduped.push(reading);
  }

  const outOfOrder = deduped.some(
    (reading, index) => index > 0 && new Date(reading.timestamp) < new Date(deduped[index - 1].timestamp),
  );
  deduped.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return { readings: deduped, duplicates, outOfOrder };
}

// Quality flags: gaps (>2x interval), failures (>=4x interval), implausible values.
export function computeQuality(readings, { intervalMin = DEFAULT_INTERVAL_MIN } = {}) {
  const { readings: ordered, duplicates, outOfOrder } = normalizeReadings(readings);
  const gaps = [];
  const failures = [];
  const implausible = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const deltaMinutes = (new Date(ordered[i].timestamp) - new Date(ordered[i - 1].timestamp)) / 60_000;
    if (deltaMinutes >= intervalMin * 4) {
      failures.push({ since: ordered[i - 1].timestamp, until: ordered[i].timestamp, minutes: Math.round(deltaMinutes) });
    } else if (deltaMinutes > intervalMin * 2) {
      gaps.push({ after: ordered[i - 1].timestamp, before: ordered[i].timestamp, minutes: Math.round(deltaMinutes) });
    }
  }

  for (const reading of ordered) {
    if (reading.temperature_c < IMPLAUSIBLE_MIN_C || reading.temperature_c > IMPLAUSIBLE_MAX_C) {
      implausible.push(reading.id ?? reading.timestamp);
    }
  }

  return { readings: ordered, duplicates, outOfOrder, gaps, failures, implausible };
}

export function sensorStatus(quality, now = new Date(), intervalMin = DEFAULT_INTERVAL_MIN) {
  const last = quality.readings.at(-1);
  if (!last) {
    return {
      sensor_id: null,
      status: "unknown",
      expected_interval_min: intervalMin,
      last_reading_at: null,
      minutes_since_last: null,
      readings_count: 0,
      gap_count: quality.gaps.length,
      failure_since: null,
    };
  }
  const minutes = Math.round((now.getTime() - new Date(last.timestamp).getTime()) / 60_000);
  const status = minutes >= intervalMin * 4 ? "failed" : minutes > intervalMin * 2 ? "delayed" : "reporting";
  return {
    sensor_id: last.sensor_id,
    status,
    expected_interval_min: intervalMin,
    last_reading_at: last.timestamp,
    minutes_since_last: minutes,
    readings_count: quality.readings.length,
    gap_count: quality.gaps.length,
    failure_since: status === "failed" ? last.timestamp : null,
  };
}

// Severity ladder (B-8 reordered — approved Phase 1A).
export function classifySeverity({ durationMin, magnitude, policy, dataQuality }) {
  if (dataQuality === "missing_readings" || dataQuality === "sensor_failure" || dataQuality === "implausible") {
    return { severity: "unknown_review", rationale: `data_quality:${dataQuality}` };
  }
  if (durationMin <= Number(policy.max_excursion_minutes) && magnitude <= Number(policy.minor_deviation_c)) {
    return { severity: "warning", rationale: "duration<=tolerance;magnitude<=minor" };
  }
  if (magnitude > Number(policy.major_deviation_c) || durationMin > Number(policy.critical_duration_minutes)) {
    return {
      severity: "critical",
      rationale: magnitude > Number(policy.major_deviation_c) ? "magnitude>major" : "duration>critical",
    };
  }
  if (magnitude <= Number(policy.major_deviation_c)) {
    return { severity: "major", rationale: "duration>tolerance;magnitude<=major" };
  }
  return { severity: "warning", rationale: "default" };
}

// B-3 grouping. Two consecutive breaching readings belong to the same excursion when:
//   - they are <= groupGap minutes apart (observed in-range readings between them are short), OR
//   - there are NO readings between them (a data gap: the cargo was unobserved, so the breach
//     is treated as continuous — "missing data is not safe").
// A split happens only when observed in-range readings separate the breaches by more than groupGap.
function groupBreaches(breaches, evaluatedReadings, groupGapMin) {
  const groups = [];
  for (const breach of breaches) {
    const last = groups.at(-1);
    if (last) {
      const previous = last.at(-1);
      const deltaMinutes = (new Date(breach.timestamp) - new Date(previous.timestamp)) / 60_000;
      const hasReadingsBetween = evaluatedReadings.some(
        (reading) =>
          new Date(reading.timestamp) > new Date(previous.timestamp) &&
          new Date(reading.timestamp) < new Date(breach.timestamp),
      );
      if (deltaMinutes <= groupGapMin || !hasReadingsBetween) {
        last.push(breach);
        continue;
      }
    }
    groups.push([breach]);
  }
  return groups;
}

function peakDeviation(breaches, policy) {
  return breaches.reduce((peak, reading) => {
    const deviation =
      reading.temperature_c < Number(policy.min_c)
        ? Number(policy.min_c) - reading.temperature_c
        : reading.temperature_c - Number(policy.max_c);
    return Math.max(peak, deviation);
  }, 0);
}

// Detection pipeline. Returns excursions, review flags, quality summary and sensor status.
export function detectExcursions({
  shipment,
  readings,
  policy,
  deliveryCutoff = null,
  now = new Date(),
  config = {},
}) {
  const intervalMin = config.sensorIntervalMin ?? DEFAULT_INTERVAL_MIN;
  const groupGapMin = config.excursionGroupGapMinutes ?? DEFAULT_GROUP_GAP_MIN;
  const quality = computeQuality(readings, { intervalMin });
  const status = sensorStatus(quality, now, intervalMin);

  if (!policy) {
    return { excursions: [], reviewFlags: ["policy_missing"], quality, sensorStatus: status };
  }

  const cutoff = deliveryCutoff ? new Date(deliveryCutoff) : null;
  const evaluated = quality.readings.filter((reading) => !cutoff || new Date(reading.timestamp) <= cutoff);
  const breaches = evaluated.filter((reading) => isBreach(reading.temperature_c, policy));

  if (breaches.length === 0) {
    return { excursions: [], reviewFlags: [], quality, sensorStatus: status };
  }

  const groups = groupBreaches(breaches, evaluated, groupGapMin);
  const implausibleSet = new Set(quality.implausible);

  const excursions = groups.map((group) => {
    const first = group[0];
    const last = group.at(-1);
    const startTime = first.timestamp;
    const endTime = last.timestamp;
    const durationMin = Math.round((new Date(endTime) - new Date(startTime)) / 60_000);
    const magnitude = peakDeviation(group, policy);

    const gapInside = quality.gaps.some(
      (gap) => new Date(gap.after) >= new Date(startTime) && new Date(gap.before) <= new Date(endTime),
    );
    const failureOverlap = quality.failures.some(
      (failure) =>
        new Date(failure.since) <= new Date(endTime) && new Date(failure.until) >= new Date(startTime),
    );
    const implausibleSole = group.every((reading) => implausibleSet.has(reading.id ?? reading.timestamp));

    let dataQuality = "complete";
    if (implausibleSole) dataQuality = "implausible";
    else if (gapInside) dataQuality = "missing_readings";
    else if (failureOverlap) dataQuality = "sensor_failure";
    else if (quality.outOfOrder) dataQuality = "out_of_order";

    const recovered = evaluated.some(
      (reading) => new Date(reading.timestamp) > new Date(endTime) && !isBreach(reading.temperature_c, policy),
    );
    const classification = classifySeverity({ durationMin, magnitude, policy, dataQuality });

    return {
      shipment_id: shipment.id,
      policy_id: policy.id,
      start_time: startTime,
      end_time: recovered ? endTime : null,
      duration_min: durationMin,
      peak_deviation_c: Math.round(magnitude * 10) / 10,
      severity: classification.severity,
      severity_rationale: classification.rationale,
      data_quality: dataQuality,
      status: "open",
      post_delivery: cutoff ? new Date(startTime) > cutoff : false,
    };
  });

  return { excursions, reviewFlags: [], quality, sensorStatus: status };
}
