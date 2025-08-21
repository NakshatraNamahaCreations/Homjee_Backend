const AdminAuth = require("../../models/admin/AdminAuth");

// ====== Config (env or defaults) ======
const OTP_TTL_MS = parseInt(process.env.ADMIN_OTP_TTL_MS || "120000", 10); // 2 minutes
const RESEND_COOLDOWN_MS = parseInt(
  process.env.ADMIN_OTP_RESEND_COOLDOWN_MS || "45000",
  10
); // 45s
const isTrue = (v) => /^(1|true|yes|on)$/i.test(String(v).trim());
const SHOW_DEBUG_OTP = isTrue(process.env.ADMIN_AUTH_DEBUG_OTP); // For logging only

// ====== Helpers ======
const normalizeMobile = (n) => String(n || "").replace(/\D/g, "");

const generateOTP = (digits = 6) => {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1))).padStart(
    digits,
    "0"
  );
};

// Mock SMS provider (replace with real provider like Twilio/MSG91 in production)
async function sendOtpSMS(mobileNumber, otp) {
  if (SHOW_DEBUG_OTP) {
    console.log(`[DEBUG][ADMIN OTP] Sending OTP to ${mobileNumber}: ${otp}`);
  }
  // Add your SMS provider integration here
  // Example: await twilio.messages.create({ to: mobileNumber, body: `Your OTP is ${otp}` });
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
      return res
        .status(400)
        .json({ message: "Phone number is required (10-15 digits)" });
    }

    // Find or create admin
    let admin = await AdminAuth.findOne({ mobileNumber });
    if (!admin) {
      admin = new AdminAuth({ mobileNumber });
    } else {
      // Check cooldown for resending OTP
      if (admin.updatedAt) {
        const diff = Date.now() - new Date(admin.updatedAt).getTime();
        if (diff < RESEND_COOLDOWN_MS) {
          return res.status(429).json({
            message: `Please wait ${Math.ceil(
              (RESEND_COOLDOWN_MS - diff) / 1000
            )}s before requesting another OTP`,
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
      otp, // Always include OTP
    });
  } catch (error) {
    console.error("Admin loginWithMobile error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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

    if (
      !mobileNumber ||
      !/^\d{10,15}$/.test(mobileNumber) ||
      !/^\d{6}$/.test(otp)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid mobile number or 6-digit OTP" });
    }

    const admin = await AdminAuth.findOne({ mobileNumber });
    if (!admin || !admin.otp || !admin.otpExpiresAt) {
      return res
        .status(400)
        .json({ message: "No active OTP. Please request a new OTP." });
    }

    if (admin.otpExpiresAt < new Date()) {
      admin.otp = null;
      admin.otpExpiresAt = null;
      await admin.save();
      return res
        .status(400)
        .json({ message: "OTP expired. Please request a new OTP." });
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
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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
      return res
        .status(400)
        .json({ message: "Invalid mobile number (10-15 digits)" });
    }

    let admin = await AdminAuth.findOne({ mobileNumber });
    if (!admin) {
      admin = new AdminAuth({ mobileNumber });
    } else {
      // Check cooldown
      if (admin.updatedAt) {
        const diff = Date.now() - new Date(admin.updatedAt).getTime();
        if (diff < RESEND_COOLDOWN_MS) {
          return res.status(429).json({
            message: `Please wait ${Math.ceil(
              (RESEND_COOLDOWN_MS - diff) / 1000
            )}s before requesting another OTP`,
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
      message: "OTP re-sent successfully",
      mobileNumber,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      otp, // Always include OTP
    });
  } catch (error) {
    console.error("Admin resendOTP error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
