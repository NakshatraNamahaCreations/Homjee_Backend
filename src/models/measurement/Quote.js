// models/Quote.js
const { Schema, model, Types } = require("mongoose");

// Reuse your PricingBreakdownItem if you want; duplicating here for clarity:
const PricingBreakdownItem = new Schema(
  { type: String, sqft: Number, unitPrice: Number, price: Number },
  { _id: false }
);

const QuoteLine = new Schema(
  {
    roomName: String,
    sectionType: { type: String, enum: ["Interior", "Exterior", "Others"] },
    subtotal: Number, // room.pricing.total
    ceilingsTotal: Number, // sum of breakdown 'Ceiling'
    wallsTotal: Number, // sum of breakdown 'Wall'
    othersTotal: Number, // any other breakdown types (usually 0)
    selectedPaints: {
      ceiling: Schema.Types.Mixed, // room.pricing.selectedPaints.ceiling (or null)
      wall: Schema.Types.Mixed, // room.pricing.selectedPaints.wall
      measurements: Schema.Types.Mixed, // room.pricing.selectedPaints.measurements
    },
    breakdown: [PricingBreakdownItem], // copy of per-room lines
  },
  { _id: false }
);

const QuoteSchema = new Schema(
  {
    quoteNo: String, // e.g., Q1734412345678
    leadId: String,
    vendorId: String,
    measurementId: { type: Types.ObjectId, ref: "Measurement" },
    currency: { type: String, default: "INR" },

    // All rooms included in the quote
    lines: [QuoteLine],

    // Section totals + final totals
    totals: {
      interior: Number,
      exterior: Number,
      others: Number,
      additionalServices: Number,
      discount: Number,
      dayCharge: Number,
      totalBeforeDiscount: Number,
      grandTotal: Number,
    },

    // Meta coming from the UI
    days: Number,
    flatAmount: Number,
    comments: String,

    status: {
      type: String,
      enum: ["draft", "sent", "accepted", "rejected"],
      default: "draft",
    },
  },
  { timestamps: true }
);

module.exports = model("Quote", QuoteSchema);
