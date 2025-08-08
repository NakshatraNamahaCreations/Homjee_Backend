// models/Measurement.js
const mongoose = require("mongoose");

const surfaceSchema = new mongoose.Schema({
  area: { type: Number, required: true },
  repaint: { type: Boolean, default: false },
  fresh: { type: Boolean, default: false },
  label: { type: String }, // only for 'items'
});

const roomSchema = new mongoose.Schema({
  ceilings: [surfaceSchema],
  walls: [surfaceSchema],
  items: [surfaceSchema],
});

const measurementSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    leadId: { type: String, required: true },
    category: { type: String, default: "House Painting" },
    rooms: { type: Map, of: roomSchema },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Measurement", measurementSchema);
