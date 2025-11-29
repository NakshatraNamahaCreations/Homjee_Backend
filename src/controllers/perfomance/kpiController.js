// // controllers/perfomance/kpiController.js
// const KPI = require("../../models/perfomance/KPIParameters");

// // template helpers
// const defaultColorBand = { red: 0, orange: 0, yellow: 0, green: 0 };
// const defaultRange = { a: 0, b: 0, c: 0, d: 0, e: 0 };

// const defaultMetrics = {
//   surveyPercentage: defaultColorBand,
//   hiringPercentage: defaultColorBand,
//   avgGSV: defaultColorBand,
//   rating: defaultColorBand,
//   strikes: defaultColorBand,
//   responsePercentage: defaultColorBand,
//   cancellationPercentage: defaultColorBand,
// };

// const defaultRanges = {
//   surveyPercentage: defaultRange,
//   hiringPercentage: defaultRange,
//   avgGSV: defaultRange,
//   rating: defaultRange,
//   strikes: defaultRange,
//   responsePercentage: defaultRange,
//   cancellationPercentage: defaultRange,
// };

// function ensureKPIExists(serviceType) {
//   return KPI.findOneAndUpdate(
//     { serviceType },
//     {
//       $setOnInsert: {
//         serviceType,
//         metrics: defaultMetrics,
//         ranges: defaultRanges,
//       },
//     },
//     { new: true, upsert: true }
//   );
// }

// // GET KPI: returns metrics + ranges
// exports.getKPI = async (req, res) => {
//   try {
//     const { serviceType } = req.params;
//     const kpi = await ensureKPIExists(serviceType);
//     return res.status(200).json({ success: true, data: { metrics: kpi.metrics, ranges: kpi.ranges } });
//   } catch (err) {
//     console.error("GET KPI ERROR:", err);
//     return res.status(500).json({ success: false, message: "Server Error" });
//   }
// };

// // Update ranges (partial allowed). Only metrics provided are validated & updated.
// exports.updateRanges = async (req, res) => {
//   try {
//     const { serviceType } = req.params;
//     const incomingRanges = req.body.ranges || {};

//     const allowedMetricKeys = Object.keys(defaultRanges);
//     const updateObj = {};

//     for (const metric of Object.keys(incomingRanges)) {
//       if (!allowedMetricKeys.includes(metric)) continue;
//       const rng = incomingRanges[metric];
//       if (!rng) continue;

//       const { a, b, c, d, e } = rng;

//       // require numeric for provided values and full set
//       if ([a, b, c, d, e].some((v) => typeof v !== "number" || Number.isNaN(v))) {
//         return res.status(400).json({ success: false, message: `Invalid numeric values for ${metric}` });
//       }

//       if (!(a < b && b < c && c < d && d < e)) {
//         return res.status(400).json({ success: false, message: `${metric} must satisfy a < b < c < d < e` });
//       }

//       updateObj[`ranges.${metric}`] = { a, b, c, d, e };
//     }

//     if (Object.keys(updateObj).length === 0) {
//       return res.status(400).json({ success: false, message: "No valid ranges provided" });
//     }

//     await KPI.updateOne({ serviceType }, { $set: updateObj }, { upsert: true });
//     const updated = await KPI.findOne({ serviceType }).lean();
//     return res.status(200).json({ success: true, message: "Ranges updated", data: updated });
//   } catch (err) {
//     console.error("UPDATE RANGES ERROR:", err);
//     return res.status(500).json({ success: false, message: "Server Error" });
//   }
// };

// // Helper to check if ranges are configured (non-zero)
// function rangesConfigured(range) {
//   if (!range) return false;
//   const arr = [range.a, range.b, range.c, range.d, range.e];
//   return arr.some((v) => typeof v === "number" && v !== 0);
// }

// // Validate a numeric value against stored range (a..e inclusive)
// function isValueInRange(value, range) {
//   if (!range) return true;
//   if (!rangesConfigured(range)) return true;
//   return value >= range.a && value <= range.e;
// }

// // Update metrics: partial updates, only changed values are updated.
// exports.updateMetrics = async (req, res) => {
//   try {
//     const { serviceType } = req.params;
//     const incoming = req.body.metrics || {};  

//     // Ensure KPI exists
//     const kpi = await ensureKPIExists(serviceType);

//     const allowedMetricKeys = Object.keys(defaultMetrics);
//     const allowedColorKeys = ["red", "orange", "yellow", "green"];

//     const errors = [];
//     const setObj = {}; // only edited fields will go here

//     for (const metric of Object.keys(incoming)) {
//       if (!allowedMetricKeys.includes(metric)) continue;

//       const incomingColors = incoming[metric];
//       const existingColors = kpi.metrics?.[metric] || {};

//       for (const color of Object.keys(incomingColors)) {
//         if (!allowedColorKeys.includes(color)) continue;

//         const newVal = incomingColors[color];

//         // If frontend sends "", undefined, null → ignore
//         if (newVal === "" || newVal === undefined || newVal === null) continue;

//         const numericVal = Number(newVal);

//         // If NOT a number → skip and record error
//         if (Number.isNaN(numericVal)) {
//           errors.push({ metric, color, reason: "Not a number" });
//           continue;
//         }

//         // 🚀 IMPORTANT FIX:
//         // If user didn’t modify value (newVal === oldVal) → skip it
//         if (numericVal === existingColors[color]) continue;

//         // Range validation
//         const range = kpi.ranges?.[metric];
//         const rangeExists = rangesConfigured(range);

//         if (rangeExists && !isValueInRange(numericVal, range)) {
//           errors.push({
//             metric,
//             color,
//             value: numericVal,
//             allowed: [range.a, range.e],
//           });
//           continue;
//         }

//         // VALID → Push only changed fields
//         setObj[`metrics.${metric}.${color}`] = numericVal;
//       }
//     }

//     if (errors.length > 0) {
//       return res.status(400).json({ success: false, message: "Validation failed", errors });
//     }

//     if (Object.keys(setObj).length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "No changes detected. Modify a value before saving.",
//       });
//     }

//     await KPI.updateOne({ serviceType }, { $set: setObj });
//     const updated = await KPI.findOne({ serviceType }).lean();

//     return res.status(200).json({
//       success: true,
//       message: "Metrics updated successfully",
//       data: updated,
//     });

//   } catch (err) {
//     console.error("UPDATE METRICS ERROR:", err);
//     return res.status(500).json({ success: false, message: "Server Error" });
//   }
// };




// controllers/perfomance/kpiController.js
const KPI = require("../../models/perfomance/KPIParameters");

// Default range template
const defaultRange = { a: 0, b: 0, c: 0, d: 0, e: 0 };

const defaultRanges = {
  surveyPercentage: { ...defaultRange },
  hiringPercentage: { ...defaultRange },
  avgGSV: { ...defaultRange },
  rating: { ...defaultRange },
  strikes: { ...defaultRange },
  responsePercentage: { ...defaultRange },
  cancellationPercentage: { ...defaultRange },
};

// Ensure KPI document exists
async function ensureKPIExists(serviceType) {
  return KPI.findOneAndUpdate(
    { serviceType },
    { $setOnInsert: { serviceType, ranges: defaultRanges } },
    { new: true, upsert: true }
  );
}

/* ============================================================
   GET RANGES (House Painting or Deep Cleaning)
============================================================ */
exports.getKPI = async (req, res) => {
  try {
    const { serviceType } = req.params;

    const kpi = await ensureKPIExists(serviceType);

    return res.status(200).json({
      success: true,
      data: {
        ranges: kpi.ranges,
      },
    });
  } catch (err) {
    console.error("GET RANGES ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ============================================================
   UPDATE RANGES (partial allowed)
============================================================ */
exports.updateRanges = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const incomingRanges = req.body.ranges || {};

    const allowedKeys = Object.keys(defaultRanges);
    const updateObj = {};

    for (const metric of Object.keys(incomingRanges)) {
      if (!allowedKeys.includes(metric)) continue;

      const r = incomingRanges[metric];
      if (!r) continue;

      const { a, b, c, d, e } = r;

      // must be valid numbers
      if ([a, b, c, d, e].some(v => typeof v !== "number" || Number.isNaN(v))) {
        return res.status(400).json({
          success: false,
          message: `${metric}: invalid numeric values`,
        });
      }

      // must follow a < b < c < d < e
      if (!(a < b && b < c && c < d && d < e)) {
        return res.status(400).json({
          success: false,
          message: `${metric} must satisfy a < b < c < d < e`,
        });
      }

      updateObj[`ranges.${metric}`] = { a, b, c, d, e };
    }

    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid ranges provided",
      });
    }

    await KPI.updateOne({ serviceType }, { $set: updateObj });
    const updated = await KPI.findOne({ serviceType }).lean();

    return res.status(200).json({
      success: true,
      message: "Ranges updated successfully",
      data: updated.ranges,
    });

  } catch (err) {
    console.error("UPDATE RANGES ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
