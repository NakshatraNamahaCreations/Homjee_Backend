
const express = require("express");
const router = express.Router();
const vendorRatingController = require("../../controllers/vendor/vendorRating");


router.post("/vendor-ratings/add", vendorRatingController.addVendorRating);
router.get("/vendor-ratings/get", vendorRatingController.getVendorRating);

// GET /api/ratings/vendor/:vendorId/latest?limit=50
router.get("/vendor-ratings/:vendorId/latest", vendorRatingController.getLatestRatingsByVendorId);

module.exports = router;