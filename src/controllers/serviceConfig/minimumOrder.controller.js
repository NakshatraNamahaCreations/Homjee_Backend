// controllers/minimumOrder.controller.js
const MinimumOrder = require("../../models/serviceConfig/MinimumOrder");

// uncommanded by kir
// exports.upsertMinimumOrder = async (req, res) => {
//   try {
//     const { amount } = req.body;
//     if (amount === undefined || amount === null)
//       return res.status(400).json({ success: false, message: "amount is required." });
//     if (typeof amount !== "number" || amount < 0)
//       return res.status(400).json({ success: false, message: "amount must be a non-negative number." });

//     const doc = await MinimumOrder.findOneAndUpdate(
//       { scope: "deep-cleaning" },
//       { $set: { amount } },
//       { new: true, upsert: true, runValidators: true }
//     );

//     res.status(201).json({ success: true, data: doc });
//   } catch (err) {
//     res.status(400).json({ success: false, message: err.message || "Failed to save minimum order." });
//   }
// };

exports.upsertMinimumOrder = async (req, res) => {
  try {
    const { amount, city } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        message: "amount is required.",
      });
    }

    if (!city || !city.trim()) {
      return res.status(400).json({
        success: false,
        message: "city is required.",
      });
    }

    const amountNum = Number(amount);

    if (Number.isNaN(amountNum) || amountNum < 0) {
      return res.status(400).json({
        success: false,
        message: "amount must be a non-negative number.",
      });
    }

    const doc = await MinimumOrder.findOneAndUpdate(
      { scope: "deep-cleaning", city: city.trim() },
      {
        $set: {
          amount: amountNum,
          city: city.trim(),
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Minimum order saved successfully.",
      data: doc,
    });
  } catch (err) {
    console.error("upsertMinimumOrder error:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to save minimum order.",
    });
  }
};

exports.getMinimumOrderByCity = async (req, res) => {
  try {
    const { city } = req.params;

    if (!city || !city.trim()) {
      return res.status(400).json({
        success: false,
        message: "city is required.",
      });
    }

    const doc = await MinimumOrder.findOne({
      scope: "deep-cleaning",
      city: { $regex: `^${city.trim()}$`, $options: "i" },
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Minimum order not found for this city.",
      });
    }

    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (err) {
    console.error("getMinimumOrderByCity error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch minimum order.",
    });
  }
};

// GET /api/minimum-orders
// returns the single deep-cleaning minimum order (404 if none set yet)
exports.getMinimumOrder = async (req, res) => {
  try {
    const doc = await MinimumOrder.findOne({ scope: "deep-cleaning" });
    if (!doc) return res.status(404).json({ success: false, message: "Minimum order not set." });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || "Failed to fetch minimum order." });
  }
};
