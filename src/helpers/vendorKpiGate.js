// Decides whether a vendor passes the KPI gate for a given service type.
// Returns: { pass: boolean, failedMetrics: string[], buckets: {} }
//
// Gating metrics (per spec + product confirmation):
//   deep_cleaning  : rating, strikes, responsePercentage, cancellationPercentage
//   house_painting : rating, strikes, surveyPercentage, hiringPercentage, avgGSV
//
// A vendor fails the gate if ANY single gating metric is in the RED bucket
// (or GREY for positive metrics — "below scale" is worse than red).

const { getKpiBucket, isPassingBucket } = require("./kpiColor");

const POSITIVE = { positive: true };
const NEGATIVE = { positive: false };

const GATE_DEFS = {
  deep_cleaning: [
    { metric: "rating",                 valueKey: "averageRating",      rangeKey: "rating",                 opts: POSITIVE },
    { metric: "responsePercentage",     valueKey: "responseRate",       rangeKey: "responsePercentage",     opts: POSITIVE },
    { metric: "cancellationPercentage", valueKey: "cancellationRate",   rangeKey: "cancellationPercentage", opts: NEGATIVE },
    { metric: "strikes",                valueKey: "strikes",            rangeKey: "strikes",                opts: NEGATIVE },
  ],
  house_painting: [
    { metric: "rating",            valueKey: "averageRating", rangeKey: "rating",            opts: POSITIVE },
    { metric: "surveyPercentage",  valueKey: "surveyRate",    rangeKey: "surveyPercentage",  opts: POSITIVE },
    { metric: "hiringPercentage",  valueKey: "hiringRate",    rangeKey: "hiringPercentage",  opts: POSITIVE },
    { metric: "avgGSV",            valueKey: "averageGsv",    rangeKey: "avgGSV",            opts: POSITIVE },
    { metric: "strikes",           valueKey: "strikes",       rangeKey: "strikes",           opts: NEGATIVE },
  ],
};

// HP perf metrics gated together: vendor's surveyRate / hiringRate / avgGSV
// only mean something once they've actually closed a job. Before that, all
// three are mechanically 0% and the gate would lock out every brand-new
// painter (observed live: 3/3 Pune painters were eligible-on-paper but
// failed the gate because hiredLeads === 0).
const HP_PERF_METRICS = new Set([
  "surveyPercentage",
  "hiringPercentage",
  "avgGSV",
]);

const DC_PERF_METRICS = new Set([
  "responsePercentage",
  "cancellationPercentage",
]);

function passesPerformanceGate(kpis, ranges, serviceType) {
  const defs = GATE_DEFS[serviceType];
  if (!defs) return { pass: true, failedMetrics: [], buckets: {} }; // unknown service, don't gate

  // No KPI ranges configured at all → don't gate (admin hasn't set thresholds yet,
  // gating would block every vendor on day one).
  if (!ranges) return { pass: true, failedMetrics: [], buckets: {} };

  // "No chance to perform yet" exemptions — same principle for every gating
  // metric: a 0% rate with a 0 denominator isn't a performance signal, it's
  // a brand-new vendor. Gate them once they've actually closed a job.
  //   rating / strikes  → exempt while totalRatings === 0
  //   HP perf metrics   → exempt while hiredLeads === 0
  //   DC perf metrics   → exempt while respondedLeads === 0
  const hasRatingHistory = (kpis?.totalRatings || 0) > 0;
  const hpHasPerfHistory = (kpis?.hiredLeads || 0) > 0;
  const dcHasPerfHistory = (kpis?.respondedLeads || 0) > 0;

  const buckets = {};
  const failedMetrics = [];

  for (const def of defs) {
    if (!hasRatingHistory && (def.metric === "rating" || def.metric === "strikes")) {
      buckets[def.metric] = "n/a";
      continue;
    }
    if (
      serviceType === "house_painting" &&
      HP_PERF_METRICS.has(def.metric) &&
      !hpHasPerfHistory
    ) {
      buckets[def.metric] = "n/a";
      continue;
    }
    if (
      serviceType === "deep_cleaning" &&
      DC_PERF_METRICS.has(def.metric) &&
      !dcHasPerfHistory
    ) {
      buckets[def.metric] = "n/a";
      continue;
    }

    const value = kpis?.[def.valueKey];
    const range = ranges?.[def.rangeKey];
    const bucket = getKpiBucket(value, range, def.opts);
    buckets[def.metric] = bucket;
    if (!isPassingBucket(bucket)) failedMetrics.push(def.metric);
  }

  return {
    pass: failedMetrics.length === 0,
    failedMetrics,
    buckets,
  };
}

module.exports = { passesPerformanceGate, GATE_DEFS };
