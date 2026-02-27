// models/mobileRegistry.model.js
const mongoose = require("mongoose");

const mobileRegistrySchema = new mongoose.Schema(
  {
    mobileNumber: { type: String, required: true, unique: true, index: true }, // ✅ global unique
    ownerType: { type: String, enum: ["vendor", "team"], required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "vendor", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true }, // team subdoc id
  },
  { timestamps: true }
);

mobileRegistrySchema.index({ mobileNumber: 1 }, { unique: true });

module.exports = mongoose.model("MobileRegistry", mobileRegistrySchema);
