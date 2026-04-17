const mongoose = require("mongoose");

const rangeSchema = new mongoose.Schema(
  {
    a: { type: Number, default: 0 },
    b: { type: Number, default: 0 },
    c: { type: Number, default: 0 },
    d: { type: Number, default: 0 },
    e: { type: Number, default: 0 },
  },
  { _id: false }
);

const kpiParametersSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      enum: ["house_painting", "deep_cleaning"],
      required: true,
      unique: true,
    },

    // Only store RANGES
    ranges: {
      surveyPercentage: { type: rangeSchema, default: () => ({}) },
      hiringPercentage: { type: rangeSchema, default: () => ({}) },
      avgGSV: { type: rangeSchema, default: () => ({}) },
      rating: { type: rangeSchema, default: () => ({}) },
      strikes: { type: rangeSchema, default: () => ({}) },

      responsePercentage: { type: rangeSchema, default: () => ({}) },
      cancellationPercentage: { type: rangeSchema, default: () => ({}) },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KPIParameters", kpiParametersSchema);

