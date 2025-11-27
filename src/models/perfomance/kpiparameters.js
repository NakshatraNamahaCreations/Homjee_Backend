const mongoose = require("mongoose");

const kpiBandSchema = new mongoose.Schema(
  {
    red: { type: Number, default: 0 },
    orange: { type: Number, default: 0 },
    yellow: { type: Number, default: 0 },
    green: { type: Number, default: 0 },
  },
  { _id: false }
);

const kpiparametersSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      enum: ["house_painting", "deep_cleaning"],
      required: true,
    },

    metrics: {
      // House Painting Metrics
      surveyPercentage: { type: kpiBandSchema, required: false },
      hiringPercentage: { type: kpiBandSchema, required: false },
      avgGSV: { type: kpiBandSchema, required: false },
      rating: { type: kpiBandSchema, required: false },
      strikes: { type: kpiBandSchema, required: false },

      // Deep Cleaning Metrics
      responsePercentage: { type: kpiBandSchema, required: false },
      cancellationPercentage: { type: kpiBandSchema, required: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KPIParameters", kpiparametersSchema);
