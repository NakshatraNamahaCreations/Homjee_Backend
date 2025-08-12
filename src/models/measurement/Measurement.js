// // models/Measurement.js
// const mongoose = require("mongoose");

// const surfaceSchema = new mongoose.Schema({
//   area: { type: Number, required: true },
//   repaint: { type: Boolean, default: false },
//   fresh: { type: Boolean, default: false },
//   label: { type: String }, // only for 'items'
// });

// const roomSchema = new mongoose.Schema({
//   ceilings: [surfaceSchema],
//   walls: [surfaceSchema],
//   items: [surfaceSchema],
// });

// const measurementSchema = new mongoose.Schema(
//   {
//     vendorId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Vendor",
//       required: true,
//     },
//     leadId: { type: String, required: true },
//     category: { type: String, default: "House Painting" },
//     rooms: { type: Map, of: roomSchema },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Measurement", measurementSchema);

const { Schema, model, Types } = require("mongoose");

const Opening = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
  },
  { _id: false }
);

const PricingBreakdownItem = new Schema(
  {
    type: String, // "Ceiling", "Wall", "Package", etc.
    sqft: Number,
    unitPrice: Number,
    price: Number,
  },
  { _id: false }
);

const PricingSchema = new Schema(
  {
    packageId: String,
    packageName: String,
    total: Number,
    breakdown: [PricingBreakdownItem],
    packages: [Opening],
  },
  { _id: false }
);

const Wall = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
    windows: [Opening],
    doors: [Opening],
    cupboards: [Opening],
  },
  { _id: false }
);

const Ceiling = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
  },
  { _id: false }
);

const otherMeasurements = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
  },
  { _id: false }
);

const Room = new Schema(
  {
    mode: { type: String, enum: ["REPAINT", "FRESH"], default: "REPAINT" },
    unit: { type: String, enum: ["FT", "M"], default: "FT" },
    sectionType: { type: String, enum: ["Interior", "Exterior", "Others"] },
    ceilings: [Ceiling],
    walls: [Wall],
    measurements: [otherMeasurements],
    packages: [Opening],
    pricing: PricingSchema,
  },
  { _id: false }
);

const MeasurementSchema = new Schema(
  {
    vendorId: String,
    leadId: String,
    rooms: { type: Map, of: Room, default: {} },
    totals: {
      wallsArea: Number,
      ceilingsArea: Number,
      measurementsArea: Number,
    },
  },
  { timestamps: true }
);

module.exports = model("Measurement", MeasurementSchema);
