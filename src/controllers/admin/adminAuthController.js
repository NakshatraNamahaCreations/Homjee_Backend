// controllers/adminAuthController.js
const AdminAuth = require("../../models/admin/AdminAuth");

// ====== Config (env or defaults) ======
const OTP_TTL_MS = parseInt(process.env.ADMIN_OTP_TTL_MS || `${2 * 60 * 1000}`, 10); // 2 minutes
const RESEND_COOLDOWN_MS = parseInt(process.env.ADMIN_OTP_RESEND_COOLDOWN_MS || "45000", 10); // 45s

// ====== Helpers ======
const normalizeMobile = (n) => String(n || "").replace(/\D/g, "");
const generateOTP = (digits = 6) => {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

// Plug your SMS provider here (MSG91/Twilio/etc.)
async function sendOtpSMS(mobileNumber, otp) {
  console.log(`[DEBUG][ADMIN OTP] ${mobileNumber} -> ${otp}`);
}

// ====== Controllers ======

/**
 * POST /api/admin/auth/login
 * body: { mobileNumber }
 * - Auto-creates admin if not found
 * - Generates a 6-digit OTP and sets expiry
 * - Throttles rapid resends using RESEND_COOLDOWN_MS (based on updatedAt)
 */
exports.loginWithMobile = async (req, res) => {
  try {
    const raw = req.body?.mobileNumber;
    const mobileNumber = normalizeMobile(raw);

    if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
      return res.status(400).json({ message: "Phone number is required/invalid" });
    }

    // Find or create admin
    let admin = await AdminAuth.findOne({ mobileNumber });
    if (!admin) {
      admin = await AdminAuth.create({ mobileNumber });
    } else {
      // Basic cooldown (based on last update time)
      if (admin.updatedAt) {
        const diff = Date.now() - new Date(admin.updatedAt).getTime();
        if (diff < RESEND_COOLDOWN_MS) {
          return res.status(429).json({
            message: `Please wait ${Math.ceil(
              (RESEND_COOLDOWN_MS - diff) / 1000
            )}s before requesting another OTP.`,
          });
        }
      }
    }

    const otp = generateOTP(6);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    admin.otp = otp;
    admin.otpExpiresAt = otpExpiresAt;
    await admin.save();

    await sendOtpSMS(mobileNumber, otp);

    return res.status(200).json({
      message: "OTP sent successfully",
      mobileNumber,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      ...(process.env.NODE_ENV !== "production" ? { debugOtp: otp } : {}),
    });
  } catch (error) {
    console.error("Admin loginWithMobile error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/auth/verify-otp
 * body: { mobileNumber, otp }
 */
exports.verifyOTP = async (req, res) => {
  try {
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    const otp = String(req.body?.otp || "").trim();

    if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber) || !/^\d{4,8}$/.test(otp)) {
      return res.status(400).json({ message: "Invalid mobile/otp" });
    }

    const admin = await AdminAuth.findOne({ mobileNumber });
    if (!admin || !admin.otp || !admin.otpExpiresAt) {
      return res.status(400).json({ message: "No active OTP. Please request a new OTP." });
    }

    if (admin.otpExpiresAt < new Date()) {
      // Clear stale OTP
      admin.otp = null;
      admin.otpExpiresAt = null;
      await admin.save();
      return res.status(400).json({ message: "OTP expired. Please request a new OTP." });
    }

    if (admin.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // OTP valid → clear it
    admin.otp = null;
    admin.otpExpiresAt = null;
    await admin.save();

    return res.status(200).json({
      message: "OTP verified successfully",
      data: {
        _id: admin._id,
        mobileNumber: admin.mobileNumber,
        name: admin.name || null,
      },
      status: "Online",
    });
  } catch (error) {
    console.error("Admin verifyOTP error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/auth/resend-otp
 * body: { mobileNumber }
 */
exports.resendOTP = async (req, res) => {
  try {
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
      return res.status(400).json({ message: "Invalid mobile number" });
    }

    let admin = await AdminAuth.findOne({ mobileNumber });
    if (!admin) {
      // keep behavior consistent with login: auto-create
      admin = await AdminAuth.create({ mobileNumber });
    } else {
      // Cooldown
      if (admin.updatedAt) {
        const diff = Date.now() - new Date(admin.updatedAt).getTime();
        if (diff < RESEND_COOLDOWN_MS) {
          return res.status(429).json({
            message: `Please wait ${Math.ceil(
              (RESEND_COOLDOWN_MS - diff) / 1000
            )}s before requesting another OTP.`,
          });
        }
      }
    }

    const otp = generateOTP(6);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    admin.otp = otp;
    admin.otpExpiresAt = otpExpiresAt;
    await admin.save();

    await sendOtpSMS(mobileNumber, otp);

    return res.status(200).json({
      message: "OTP re-sent",
      mobileNumber,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      ...(process.env.NODE_ENV !== "production" ? { debugOtp: otp } : {}),
    });
  } catch (error) {
    console.error("Admin resendOTP error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
