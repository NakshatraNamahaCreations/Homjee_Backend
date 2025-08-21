// routes/adminAuthRoutes.js
const express = require("express");
const router = express.Router();
const {
  loginWithMobile,
  verifyOTP,
  resendOTP,
} = require("../../controllers/admin/adminAuthController");

// Only 3 endpoints needed
router.post("/login", loginWithMobile);      // request OTP
router.post("/verify-otp", verifyOTP);       // verify OTP
router.post("/resend-otp", resendOTP);       // resend OTP

module.exports = router;
