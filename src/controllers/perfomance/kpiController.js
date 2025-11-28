// controllers/perfomance/kpiController.js
const KPI = require("../../models/perfomance/KPIParameters");

// template helpers
const defaultColorBand = { red: 0, orange: 0, yellow: 0, green: 0 };
const defaultRange = { a: 0, b: 0, c: 0, d: 0, e: 0 };

const defaultMetrics = {
  surveyPercentage: defaultColorBand,
  hiringPercentage: defaultColorBand,
  avgGSV: defaultColorBand,
  rating: defaultColorBand,
  strikes: defaultColorBand,
  responsePercentage: defaultColorBand,
  cancellationPercentage: defaultColorBand,
};

const defaultRanges = {
  surveyPercentage: defaultRange,
  hiringPercentage: defaultRange,
  avgGSV: defaultRange,
  rating: defaultRange,
  strikes: defaultRange,
  responsePercentage: defaultRange,
  cancellationPercentage: defaultRange,
};

function ensureKPIExists(serviceType) {
  return KPI.findOneAndUpdate(
    { serviceType },
    {
      $setOnInsert: {
        serviceType,
        metrics: defaultMetrics,
        ranges: defaultRanges,
      },
    },
    { new: true, upsert: true }
  );
}

// GET KPI: returns metrics + ranges
exports.getKPI = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const kpi = await ensureKPIExists(serviceType);
    return res.status(200).json({ success: true, data: { metrics: kpi.metrics, ranges: kpi.ranges } });
  } catch (err) {
    console.error("GET KPI ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// Update ranges (partial allowed). Only metrics provided are validated & updated.
exports.updateRanges = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const incomingRanges = req.body.ranges || {};

    const allowedMetricKeys = Object.keys(defaultRanges);
    const updateObj = {};

    for (const metric of Object.keys(incomingRanges)) {
      if (!allowedMetricKeys.includes(metric)) continue;
      const rng = incomingRanges[metric];
      if (!rng) continue;

      const { a, b, c, d, e } = rng;

      // require numeric for provided values and full set
      if ([a, b, c, d, e].some((v) => typeof v !== "number" || Number.isNaN(v))) {
        return res.status(400).json({ success: false, message: `Invalid numeric values for ${metric}` });
      }

      if (!(a < b && b < c && c < d && d < e)) {
        return res.status(400).json({ success: false, message: `${metric} must satisfy a < b < c < d < e` });
      }

      updateObj[`ranges.${metric}`] = { a, b, c, d, e };
    }

    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({ success: false, message: "No valid ranges provided" });
    }

    await KPI.updateOne({ serviceType }, { $set: updateObj }, { upsert: true });
    const updated = await KPI.findOne({ serviceType }).lean();
    return res.status(200).json({ success: true, message: "Ranges updated", data: updated });
  } catch (err) {
    console.error("UPDATE RANGES ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// Helper to check if ranges are configured (non-zero)
function rangesConfigured(range) {
  if (!range) return false;
  const arr = [range.a, range.b, range.c, range.d, range.e];
  return arr.some((v) => typeof v === "number" && v !== 0);
}

// Validate a numeric value against stored range (a..e inclusive)
function isValueInRange(value, range) {
  if (!range) return true;
  if (!rangesConfigured(range)) return true;
  return value >= range.a && value <= range.e;
}

// Update metrics: accepts partial updates. For each metric provided, expect object with color keys.
exports.updateMetrics = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const incoming = req.body.metrics || {}; // e.g. { surveyPercentage: { red: 10, green: 40 }, rating: { green: 4.2 } }

    const kpi = await ensureKPIExists(serviceType);

    const allowedMetricKeys = Object.keys(defaultMetrics);
    const allowedColorKeys = ["red", "orange", "yellow", "green"];

    const errors = [];
    const setObj = {};

    for (const metric of Object.keys(incoming)) {
      if (!allowedMetricKeys.includes(metric)) continue;
      const colors = incoming[metric];
      if (!colors || typeof colors !== "object") continue;

      for (const color of Object.keys(colors)) {
        if (!allowedColorKeys.includes(color)) continue;
        const val = Number(colors[color]);
        if (Number.isNaN(val)) {
          errors.push({ metric, color, reason: "Not a number" });
          continue;
        }

        const range = kpi.ranges?.[metric];
        const cfg = rangesConfigured(range);
        if (cfg && !isValueInRange(val, range)) {
          errors.push({
            metric,
            color,
            value: val,
            allowed: [range.a, range.e],
          });
          continue;
        }

        setObj[`metrics.${metric}.${color}`] = val;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    if (Object.keys(setObj).length === 0) {
      return res.status(400).json({ success: false, message: "No valid metrics provided to update" });
    }

    await KPI.updateOne({ serviceType }, { $set: setObj });
    const updated = await KPI.findOne({ serviceType }).lean();
    return res.status(200).json({ success: true, message: "Metrics updated", data: updated });
  } catch (err) {
    console.error("UPDATE METRICS ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
