const { Schema, model, Types } = require("mongoose");

const Opening = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
  },
  { _id: false }
);

const ceilingOpening = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
  },
  { _id: false }
);

const PricingBreakdownItem = new Schema(
  {
    // type: String,
    // sqft: Number,
    // unitPrice: Number,
    // price: Number,
    type: String, // 'Ceiling' | 'Wall' | 'Measurement'
    mode: String, // 'FRESH' | 'REPAINT'
    sqft: Number,
    unitPrice: Number,
    price: Number,
    paintId: String,
    paintName: String,
    displayIndex: Number,
  },
  { _id: false }
);

const Wall = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
    totalSqt: Number,
    mode: { type: String, enum: ["REPAINT", "FRESH"], default: "REPAINT" },
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
    totalSqt: Number,
    mode: { type: String, enum: ["REPAINT", "FRESH"], default: "REPAINT" },
    windows: [ceilingOpening],
    doors: [ceilingOpening],
    cupboards: [ceilingOpening],
  },
  { _id: false }
);

const otherMeasurements = new Schema(
  {
    width: Number,
    height: Number,
    area: Number,
    totalSqt: Number,
    mode: { type: String, enum: ["REPAINT", "FRESH"], default: "REPAINT" },
  },
  { _id: false }
);

const PaintSelection = new Schema(
  {
    id: String,
    name: String, // e.g., "Asian Paints (Normal)" or "Asian Paints SPL"
    isSpecial: Boolean, // true for SPL / special paints
    price: Number, // your single unit price (₹/sq ft)
    includePuttyOnFresh: Boolean, // flags that drive pricing
    includePuttyOnRepaint: Boolean,
  },
  { _id: false }
);

const PricingSchema = new Schema(
  {
    packageId: String,
    packageName: String,
    total: Number,
    breakdown: [PricingBreakdownItem],
    packages: [Opening], // (legacy) leave as-is for backwards compat
    selectedPaints: {
      // NEW
      ceiling: PaintSelection,
      wall: PaintSelection,
      measurements: PaintSelection, // used for "Others"
    },
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
