const mongoose = require("mongoose");

const PricingConfigSchema = new mongoose.Schema(
  {
    siteVisitCharge: { type: Number, required: true },
    vendorCoins: { type: Number, required: true },
    puttyPrice: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PricingConfig", PricingConfigSchema);
