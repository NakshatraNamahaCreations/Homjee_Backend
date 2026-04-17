const KPI = require("../../models/perfomance/kpiparameters");

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
   - strikes and cancellationPercentage accept DESCENDING ranges:
     a > b > c > d > e
   - other metrics expect ASCENDING ranges:
     a < b < c < d < e
============================================================ */
exports.updateRanges = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const incomingRanges = req.body.ranges || {};

    const allowedKeys = Object.keys(defaultRanges);
    const updateObj = {};

    // metrics that should be validated in descending order
    const descendingMetrics = new Set(["strikes", "cancellationPercentage"]);

    for (const metric of Object.keys(incomingRanges)) {
      if (!allowedKeys.includes(metric)) continue;

      const r = incomingRanges[metric];
      if (!r) continue;

      const { a, b, c, d, e } = r;

      // must be valid numbers
      if ([a, b, c, d, e].some((v) => typeof v !== "number" || Number.isNaN(v))) {
        return res.status(400).json({
          success: false,
          message: `${metric}: invalid numeric values`,
        });
      }

      if (descendingMetrics.has(metric)) {
        // descending validation: a > b > c > d > e
        if (!(a > b && b > c && c > d && d > e)) {
          return res.status(400).json({
            success: false,
            message: `${metric} must satisfy a > b > c > d > e (descending ranges)`,
          });
        }
      } else {
        // ascending validation: a < b < c < d < e
        if (!(a < b && b < c && c < d && d < e)) {
          return res.status(400).json({
            success: false,
            message: `${metric} must satisfy a < b < c < d < e (ascending ranges)`,
          });
        }
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


// old code
// const KPI = require("../../models/perfomance/kpiparameters");

// // Default range template
// const defaultRange = { a: 0, b: 0, c: 0, d: 0, e: 0 };

// const defaultRanges = {
//   surveyPercentage: { ...defaultRange },
//   hiringPercentage: { ...defaultRange },
//   avgGSV: { ...defaultRange },
//   rating: { ...defaultRange },
//   strikes: { ...defaultRange },
//   responsePercentage: { ...defaultRange },
//   cancellationPercentage: { ...defaultRange },
// };

// // Ensure KPI document exists
// async function ensureKPIExists(serviceType) {
//   return KPI.findOneAndUpdate(
//     { serviceType },
//     { $setOnInsert: { serviceType, ranges: defaultRanges } },
//     { new: true, upsert: true }
//   );
// }

// /* ============================================================
//    GET RANGES (House Painting or Deep Cleaning)
// ============================================================ */
// exports.getKPI = async (req, res) => {
//   try {
//     const { serviceType } = req.params;

//     const kpi = await ensureKPIExists(serviceType);

//     return res.status(200).json({
//       success: true,
//       data: {
//         ranges: kpi.ranges,
//       },
//     });
//   } catch (err) {
//     console.error("GET RANGES ERROR:", err);
//     return res.status(500).json({ success: false, message: "Server Error" });
//   }
// };

// /* ============================================================
//    UPDATE RANGES (partial allowed)
// ============================================================ */
// exports.updateRanges = async (req, res) => {
//   try {
//     const { serviceType } = req.params;
//     const incomingRanges = req.body.ranges || {};

//     const allowedKeys = Object.keys(defaultRanges);
//     const updateObj = {};

//     for (const metric of Object.keys(incomingRanges)) {
//       if (!allowedKeys.includes(metric)) continue;

//       const r = incomingRanges[metric];
//       if (!r) continue;

//       const { a, b, c, d, e } = r;

//       // must be valid numbers
//       if ([a, b, c, d, e].some(v => typeof v !== "number" || Number.isNaN(v))) {
//         return res.status(400).json({
//           success: false,
//           message: `${metric}: invalid numeric values`,
//         });
//       }

//       // must follow a < b < c < d < e
//       if (!(a < b && b < c && c < d && d < e)) {
//         return res.status(400).json({
//           success: false,
//           message: `${metric} must satisfy a < b < c < d < e`,
//         });
//       }

//       updateObj[`ranges.${metric}`] = { a, b, c, d, e };
//     }

//     if (Object.keys(updateObj).length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "No valid ranges provided",
//       });
//     }

//     await KPI.updateOne({ serviceType }, { $set: updateObj });
//     const updated = await KPI.findOne({ serviceType }).lean();

//     return res.status(200).json({
//       success: true,
//       message: "Ranges updated successfully",
//       data: updated.ranges,
//     });

//   } catch (err) {
//     console.error("UPDATE RANGES ERROR:", err);
//     return res.status(500).json({ success: false, message: "Server Error" });
//   }
// };
