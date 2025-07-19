const express = require("express");
const router = express.Router();
const {
  createPricingConfig,
  getLatestPricing,
} = require("../../controllers/serviceConfig/PricingConfig");

router.post("/create", createPricingConfig);
router.get("/latest", getLatestPricing);

module.exports = router;
