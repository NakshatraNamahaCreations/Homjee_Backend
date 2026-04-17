// models/Quote.js
const mongoose = require("mongoose");

// models/Quote.js
const LineBreakdownItem = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Ceiling", "Wall", "Measurement"],
      required: true,
    },
    mode: { type: String, enum: ["REPAINT", "FRESH"] }, // optional for paint lines
    sqft: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    paintId: { type: String },
    paintName: { type: String },

    // NEW (non-breaking): lets us inject additional-services into breakdown safely
    source: { type: String, enum: ["BASE", "ADDN"], default: "BASE" }, // BASE = normal paint; ADDN = additional-service “shadow” row
    serviceType: { type: String }, // e.g., "POP", "Tile Grouting" (for display/debug)
  },
  { _id: false }
);

const AdditionalServiceItem = new mongoose.Schema(
  {
    // e.g. "Textures", "Chemical Waterproofing", "Terrace Waterproofing", "Tile Grouting", "POP", "Wood Polish", "Others"
    serviceType: { type: String, required: true },

    // If selected from your finishing paints table
    materialId: { type: String }, // keep as string, matches your FE
    materialName: { type: String },
    surfaceType: { type: String },
    // UX options
    withPaint: { type: Boolean, default: false },

    // Measurement & pricing
    areaSqft: { type: Number, default: 0 }, // for "Others", can be 0 if it's a flat item
    unitPrice: { type: Number, default: 0 }, // ₹/sqft (or flat if areaSqft==0)
    total: { type: Number, default: 0 }, // computed = areaSqft * unitPrice (or flat)

    // For free-form "Others"
    customName: { type: String, default: "" }, // user-entered name
    customNote: { type: String, default: "" }, // optional memo
  },
  { _id: false }
);

const QuoteLine = new mongoose.Schema(
  {
    roomName: { type: String, required: true },
    sectionType: {
      type: String,
      enum: ["Interior", "Exterior", "Others"],
      required: true,
    },
    subtotal: { type: Number, default: 0 },
    ceilingsTotal: { type: Number, default: 0 },
    wallsTotal: { type: Number, default: 0 },
    othersTotal: { type: Number, default: 0 },
    selectedPaints: mongoose.Schema.Types.Mixed,
    breakdown: [LineBreakdownItem],
    additionalServices: { type: [AdditionalServiceItem], default: [] },
    additionalTotal: { type: Number, default: 0 },
  },
  { _id: false }
);

const QuoteSchema = new mongoose.Schema(
  {
    quoteNo: String,
    leadId: { type: String, required: true },
    vendorId: String,
    measurementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Measurement",
      required: true,
    },
    currency: { type: String, default: "INR" },
    days: { type: Number, default: 1 },

    discount: {
      type: { type: String, enum: ["PERCENT", "FLAT"], default: "PERCENT" },
      value: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
    },

    lines: [QuoteLine],

    totals: {
      interior: Number,
      exterior: Number,
      others: Number,
      additionalServices: { type: Number, default: 0 },
      subtotal: Number,
      discountAmount: Number,
      finalPerDay: Number,
      grandTotal: Number,
    },

    comments: String,
    status: {
      type: String,
      enum: ["draft", "created", "finalized"],
      default: "draft",
    },
    finalizedAt: Date,
    locked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Quote", QuoteSchema);
