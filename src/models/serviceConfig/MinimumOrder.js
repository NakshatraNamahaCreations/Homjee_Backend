// models/MinimumOrder.js
const mongoose = require("mongoose");

/**
 * Single-scope minimum order for Deep Cleaning.
 * We keep a fixed "scope" so it's extendable later if you add more categories.
 */
const MinimumOrderSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      default: "deep-cleaning",
      enum: ["deep-cleaning"],
      unique: true,
      required: true
    },
    amount: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

// Unique per scope (only one doc for deep-cleaning)
MinimumOrderSchema.index({ scope: 1 }, { unique: true });

module.exports = mongoose.model("MinimumOrder", MinimumOrderSchema);
