// models/Quote.js
const mongoose = require("mongoose");

const LineBreakdownItem = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Ceiling", "Wall", "Measurement"],
      required: true,
    },
    mode: { type: String, enum: ["REPAINT", "FRESH"] },
    sqft: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    paintId: { type: String }, // keep as string; cast client-side
    paintName: { type: String },
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
    status: { type: String, enum: ["draft", "finalized"], default: "draft" },
    finalizedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Quote", QuoteSchema);
