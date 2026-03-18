const express = require("express");
const router = express.Router();
const {
  createOrUpdatePricingConfig,
  getLatestPricing,
  getPricingConfigByCity,
} = require("../../controllers/serviceConfig/PricingConfig");

router.post("/pricing-config", createOrUpdatePricingConfig);
router.get("/latest", getLatestPricing);
router.get("/get-pricing-config/city/:city", getPricingConfigByCity);

module.exports = router;
