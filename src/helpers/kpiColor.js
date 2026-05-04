// Port of HomjeeVendor-main/src/screens/Performance.js getKpiColor.
// Single source of truth for "what bucket does this metric fall into".
// Used by:
//   - vendor app (FE) for badge colors
//   - slot filter (BE) to gate vendors whose KPIs are red
//
// Buckets returned: "red" | "orange" | "yellow" | "green" | "grey"
// Grey = ranges not configured (all zeros) OR value below the lowest
// threshold for a positive metric. Treated as failing the gate.

const RED = "red";
const ORANGE = "orange";
const YELLOW = "yellow";
const GREEN = "green";
const GREY = "grey";

const num = (v) => Number(v ?? 0);

/**
 * @param {number} value           computed KPI value (e.g. 4.2 rating, 65 response%)
 * @param {object} ranges          { a, b, c, d, e } from KPIParameters
 * @param {object} [opts]
 * @param {boolean} [opts.positive=true]  true = higher is better (rating, response%, ...)
 *                                       false = lower is better (strikes, cancellation%)
 * @returns {"red"|"orange"|"yellow"|"green"|"grey"}
 */
function getKpiBucket(value, ranges, opts = { positive: true }) {
  if (!ranges) return GREY;

  const a = num(ranges.a);
  const b = num(ranges.b);
  const c = num(ranges.c);
  const d = num(ranges.d);
  const e = num(ranges.e);
  const v = num(value);

  // Admin hasn't configured this metric — every threshold is the same.
  if (new Set([a, b, c, d, e]).size === 1) return GREY;

  const isDescending = a >= b && b >= c && c >= d && d >= e;

  if (opts.positive) {
    // Normalize descending input to ascending [A, B, C, D] (drops `a`/`e`
    // boundary same as FE).
    const [A, B, C, D] = isDescending ? [e, d, c, b] : [a, b, c, d];

    if (v >= A && v < B) return RED;
    if (v >= B && v < C) return ORANGE;
    if (v >= C && v < D) return YELLOW;
    if (v >= D) return GREEN;

    // Below the lowest threshold — worse than red. Gate treats as fail.
    return GREY;
  }

  // Negative metric (strikes, cancellation%). Controller forces these to
  // descending (a > b > c > d > e), so a is the worst tolerance.
  if (isDescending) {
    if (v >= b) return RED;
    if (v >= c) return ORANGE;
    if (v >= d) return YELLOW;
    return GREEN;
  }

  // Defensive fallback for ascending negative ranges.
  if (v >= a && v < b) return GREEN;
  if (v >= b && v < c) return YELLOW;
  if (v >= c && v < d) return ORANGE;
  if (v >= d) return RED;
  return GREY;
}

// True when the bucket is good enough to receive a lead. Grey = ranges not
// configured OR positive value below scale; both fail the gate so admins
// must configure ranges to opt vendors back in.
function isPassingBucket(bucket) {
  return bucket === ORANGE || bucket === YELLOW || bucket === GREEN;
}

module.exports = {
  getKpiBucket,
  isPassingBucket,
  BUCKETS: { RED, ORANGE, YELLOW, GREEN, GREY },
};
