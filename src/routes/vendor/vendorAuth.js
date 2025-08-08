const express = require("express");
const router = express.Router();
const vendorAuthController = require("../../controllers/vendor/vendorAuth");
const parser = require("../../middleware/cloudinaryStorage");

router.post(
  "/create-vendor",
  (req, res, next) => {
    req.folder = "vendorDocs";
    next();
  },
  parser.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadhaarImage", maxCount: 1 },
    { name: "panImage", maxCount: 1 },
    { name: "otherPolicy", maxCount: 1 },
  ]),
  vendorAuthController.createVendor
);
router.post("/login-with-mobile", vendorAuthController.loginWithMobile);
router.post("/verify-otp", vendorAuthController.verifyOTP);
router.post("/resent-otp", vendorAuthController.resendOTP);
router.get(
  "/get-vendor-by-vendorId/:id",
  vendorAuthController.getVendorByVendorId
);
router.get("/get-all-vendor", vendorAuthController.getAllVendors);

module.exports = router;
