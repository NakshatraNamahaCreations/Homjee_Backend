// models/PhoneRegistry.js
const mongoose = require("mongoose");

const phoneRegistrySchema = new mongoose.Schema(
  {
    phone: { type: Number, required: true, unique: true, index: true }, // ✅ Number unique
    ownerType: { type: String, enum: ["VENDOR", "TEAM"], required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "vendor", required: true },
    memberId: { type: mongoose.Schema.Types.ObjectId }, // TEAM only
  },
  { timestamps: true }
);

module.exports = mongoose.model("PhoneRegistry", phoneRegistrySchema);