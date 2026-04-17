// // routes/adminAuthRoutes.js
// const express = require("express");
// const router = express.Router();
// const {
//   loginWithMobile,
//   verifyOTP,
//   resendOTP,
// } = require("../../controllers/admin/adminAuthController");

// // Only 3 endpoints needed
// router.post("/login", loginWithMobile);      // request OTP
// router.post("/verify-otp", verifyOTP);       // verify OTP
// router.post("/resend-otp", resendOTP);       // resend OTP

// module.exports = router;

// routes/adminAuthRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/authMiddleware"); // Import middleware

const {
  loginWithMobile,
  verifyOTP,
  resendOTP,
  createAdmin,
  deleteAdmin,
  getAllAdmins,
  logout
} = require("../../controllers/admin/adminAuthController");

// Public endpoints (no auth required)
router.post("/login", loginWithMobile);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);
// routes/adminAuthRoutes.js
router.post("/logout",  logout);
// Protected endpoints (require authentication)
router.post("/create",  createAdmin);
router.delete("/:id",  deleteAdmin);
router.get("/list",  getAllAdmins);

module.exports = router;
