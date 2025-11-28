// models/perfomance/KPIParameters.js
const mongoose = require("mongoose");

const colorBandSchema = new mongoose.Schema(
  {
    red: { type: Number, default: 0 },
    orange: { type: Number, default: 0 },
    yellow: { type: Number, default: 0 },
    green: { type: Number, default: 0 },
  },
  { _id: false }
);

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

// metrics now store 4 color values per metric
const kpiparametersSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      enum: ["house_painting", "deep_cleaning"],
      required: true,
      unique: true,
    },

    metrics: {
      surveyPercentage: { type: colorBandSchema, default: () => ({}) },
      hiringPercentage: { type: colorBandSchema, default: () => ({}) },
      avgGSV: { type: colorBandSchema, default: () => ({}) },
      rating: { type: colorBandSchema, default: () => ({}) },
      strikes: { type: colorBandSchema, default: () => ({}) },

      responsePercentage: { type: colorBandSchema, default: () => ({}) },
      cancellationPercentage: { type: colorBandSchema, default: () => ({}) },
    },

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

module.exports = mongoose.model("KPIParameters", kpiparametersSchema);
