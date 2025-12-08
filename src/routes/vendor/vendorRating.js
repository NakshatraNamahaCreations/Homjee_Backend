
const express = require("express");
const router = express.Router();
const vendorRatingController = require("../../controllers/vendor/vendorRating");


router.post("/vendor-ratings/add", vendorRatingController.addVendorRating);
router.get("/vendor-ratings/get", vendorRatingController.getVendorRating);

module.exports = router;