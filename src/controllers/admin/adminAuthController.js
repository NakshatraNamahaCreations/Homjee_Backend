// const AdminAuth = require("../../models/admin/AdminAuth");

// // ====== Config (env or defaults) ======
// const OTP_TTL_MS = parseInt(process.env.ADMIN_OTP_TTL_MS || "120000", 10); // 2 minutes
// const RESEND_COOLDOWN_MS = parseInt(
//   process.env.ADMIN_OTP_RESEND_COOLDOWN_MS || "45000",
//   10
// ); // 45s
// const isTrue = (v) => /^(1|true|yes|on)$/i.test(String(v).trim());
// const SHOW_DEBUG_OTP = isTrue(process.env.ADMIN_AUTH_DEBUG_OTP); // For logging only

// // ====== Helpers ======
// const normalizeMobile = (n) => String(n || "").replace(/\D/g, "");

// const generateOTP = (digits = 6) => {
//   const min = Math.pow(10, digits - 1);
//   const max = Math.pow(10, digits) - 1;
//   return String(Math.floor(min + Math.random() * (max - min + 1))).padStart(
//     digits,
//     "0"
//   );
// };

// // Mock SMS provider (replace with real provider like Twilio/MSG91 in production)
// async function sendOtpSMS(mobileNumber, otp) {
//   if (SHOW_DEBUG_OTP) {
//     console.log(`[DEBUG][ADMIN OTP] Sending OTP to ${mobileNumber}: ${otp}`);
//   }
//   // Add your SMS provider integration here
//   // Example: await twilio.messages.create({ to: mobileNumber, body: `Your OTP is ${otp}` });
// }

// // ====== Controllers ======

// /**
//  * POST /api/admin/auth/login
//  * body: { mobileNumber }
//  * - Auto-creates admin if not found
//  * - Generates a 6-digit OTP and sets expiry
//  * - Throttles rapid resends using RESEND_COOLDOWN_MS (based on updatedAt)
//  */
// exports.loginWithMobile = async (req, res) => {
//   try {
//     const raw = req.body?.mobileNumber;
//     const mobileNumber = normalizeMobile(raw);

//     if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
//       return res
//         .status(400)
//         .json({ message: "Phone number is required (10-15 digits)" });
//     }

//     // Find or create admin
//     let admin = await AdminAuth.findOne({ mobileNumber });
//     if (!admin) {
//       admin = new AdminAuth({ mobileNumber });
//     } else {
//       // Check cooldown for resending OTP
//       if (admin.updatedAt) {
//         const diff = Date.now() - new Date(admin.updatedAt).getTime();
//         if (diff < RESEND_COOLDOWN_MS) {
//           return res.status(429).json({
//             message: `Please wait ${Math.ceil(
//               (RESEND_COOLDOWN_MS - diff) / 1000
//             )}s before requesting another OTP`,
//           });
//         }
//       }
//     }

//     const otp = generateOTP(6);
//     const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

//     admin.otp = otp;
//     admin.otpExpiresAt = otpExpiresAt;
//     await admin.save();

//     await sendOtpSMS(mobileNumber, otp);

//     return res.status(200).json({
//       message: "OTP sent successfully",
//       mobileNumber,
//       expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
//       otp, // Always include OTP
//     });
//   } catch (error) {
//     console.error("Admin loginWithMobile error:", error);
//     return res
//       .status(500)
//       .json({ message: "Server error", error: error.message });
//   }
// };

// exports.verifyOTP = async (req, res) => {
//   try {
//     const mobileNumber = normalizeMobile(req.body?.mobileNumber);
//     const otp = String(req.body?.otp || "").trim();

//     if (
//       !mobileNumber ||
//       !/^\d{10,15}$/.test(mobileNumber) ||
//       !/^\d{6}$/.test(otp)
//     ) {
//       return res
//         .status(400)
//         .json({ message: "Invalid mobile number or 6-digit OTP" });
//     }

//     const admin = await AdminAuth.findOne({ mobileNumber });
//     if (!admin || !admin.otp || !admin.otpExpiresAt) {
//       return res
//         .status(400)
//         .json({ message: "No active OTP. Please request a new OTP." });
//     }

//     if (admin.otpExpiresAt < new Date()) {
//       admin.otp = null;
//       admin.otpExpiresAt = null;
//       await admin.save();
//       return res
//         .status(400)
//         .json({ message: "OTP expired. Please request a new OTP." });
//     }

//     if (admin.otp !== otp) {
//       return res.status(400).json({ message: "Invalid OTP" });
//     }

//     // OTP valid → clear it
//     admin.otp = null;
//     admin.otpExpiresAt = null;
//     await admin.save();

//     return res.status(200).json({
//       message: "OTP verified successfully",
//       data: {
//         _id: admin._id,
//         mobileNumber: admin.mobileNumber,
//         name: admin.name || null,
//       },
//       status: "Online",
//     });
//   } catch (error) {
//     console.error("Admin verifyOTP error:", error);
//     return res
//       .status(500)
//       .json({ message: "Server error", error: error.message });
//   }
// };

// exports.resendOTP = async (req, res) => {
//   try {
//     const mobileNumber = normalizeMobile(req.body?.mobileNumber);
//     if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
//       return res
//         .status(400)
//         .json({ message: "Invalid mobile number (10-15 digits)" });
//     }

//     let admin = await AdminAuth.findOne({ mobileNumber });
//     if (!admin) {
//       admin = new AdminAuth({ mobileNumber });
//     } else {
//       // Check cooldown
//       if (admin.updatedAt) {
//         const diff = Date.now() - new Date(admin.updatedAt).getTime();
//         if (diff < RESEND_COOLDOWN_MS) {
//           return res.status(429).json({
//             message: `Please wait ${Math.ceil(
//               (RESEND_COOLDOWN_MS - diff) / 1000
//             )}s before requesting another OTP`,
//           });
//         }
//       }
//     }

//     const otp = generateOTP(6);
//     const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

//     admin.otp = otp;
//     admin.otpExpiresAt = otpExpiresAt;
//     await admin.save();

//     await sendOtpSMS(mobileNumber, otp);

//     return res.status(200).json({
//       message: "OTP re-sent successfully",
//       mobileNumber,
//       expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
//       otp, // Always include OTP
//     });
//   } catch (error) {
//     console.error("Admin resendOTP error:", error);
//     return res
//       .status(500)
//       .json({ message: "Server error", error: error.message });
//   }
// };


// controllers/admin/adminAuthController.js

// Load environment variables at the top
require('dotenv').config();

const AdminAuth = require("../../models/admin/AdminAuth");
const jwt = require('jsonwebtoken');

// ====== JWT Configuration ======
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// ====== OTP Configuration ======
const OTP_TTL_MS = parseInt(process.env.ADMIN_OTP_TTL_MS || "120000", 10);
const RESEND_COOLDOWN_MS = parseInt(
  process.env.ADMIN_OTP_RESEND_COOLDOWN_MS || "45000",
  10
);

// ====== Debug OTP Configuration ======
// FIXED: Proper debug OTP handling
const shouldShowDebugOTP = () => {
  const envValue = process.env.ADMIN_AUTH_DEBUG_OTP;
  
  // Check if explicitly set
  if (envValue !== undefined && envValue !== null) {
    const strValue = String(envValue).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(strValue);
  }
  
  // Default to true in development
  return process.env.NODE_ENV === 'development';
};

const SHOW_DEBUG_OTP = shouldShowDebugOTP();

// Log configuration for debugging
console.log(`[AUTH CONFIG] JWT Secret: ${JWT_SECRET ? 'Set' : 'Not Set'}`);
console.log(`[AUTH CONFIG] Debug OTP: ${SHOW_DEBUG_OTP ? 'ENABLED' : 'DISABLED'}`);
console.log(`[AUTH CONFIG] NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

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

// FIXED: Send OTP SMS function (always logs, but only sends SMS when configured)
async function sendOtpSMS(mobileNumber, otp) {
  try {
    // Always log OTP to console for debugging (but only show in response if debug mode is on)
    console.log(`[OTP GENERATED] For ${mobileNumber}: ${otp}`);
    
    // Only send actual SMS if SMS provider is configured
    if (process.env.SMS_PROVIDER_ENABLED === 'true') {
      // Add your SMS provider integration here (Twilio, MSG91, etc.)
      // Example with Twilio:
      // const accountSid = process.env.TWILIO_ACCOUNT_SID;
      // const authToken = process.env.TWILIO_AUTH_TOKEN;
      // const client = require('twilio')(accountSid, authToken);
      // 
      // await client.messages.create({
      //   body: `Your OTP is: ${otp}. Valid for ${Math.floor(OTP_TTL_MS/60000)} minutes.`,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   to: `+91${mobileNumber}`
      // });
      
      console.log(`[SMS SENT] OTP sent to ${mobileNumber} via SMS provider`);
    } else {
      console.log(`[SMS SKIPPED] SMS provider not enabled. OTP: ${otp}`);
    }
  } catch (error) {
    console.error("[SMS ERROR] Failed to send OTP:", error);
    // Don't throw error - we still want to return OTP in debug mode
  }
}

// ====== Admin Management ======

/**
 * POST /api/admin/auth/create
 * Create new admin (should be used by super admin)
 */
exports.createAdmin = async (req, res) => {
  try {
    const { mobileNumber: rawMobile, name, canBeDeleted = true } = req.body;
    
    const mobileNumber = normalizeMobile(rawMobile);

    // Validation
    if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
      return res.status(400).json({ 
        success: false,
        message: "Valid mobile number is required (10-15 digits)" 
      });
    }

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ 
        success: false,
        message: "Admin name is required (minimum 2 characters)" 
      });
    }

    // Check if admin already exists
    const existingAdmin = await AdminAuth.findOne({ mobileNumber });

    if (existingAdmin) {
      return res.status(409).json({ 
        success: false,
        message: "Admin with this mobile number already exists" 
      });
    }

    // Create new admin
    const admin = new AdminAuth({
      mobileNumber,
      name: name.trim(),
      canBeDeleted
    });
    
    await admin.save();

    return res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: {
        _id: admin._id,
        mobileNumber: admin.mobileNumber,
        name: admin.name,
        canBeDeleted: admin.canBeDeleted,
        createdAt: admin.createdAt
      }
    });
  } catch (error) {
    console.error("Create admin error:", error);
    
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false,
        message: "Admin with this mobile number already exists" 
      });
    }
    
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};

/**
 * DELETE /api/admin/auth/:id
 * Delete admin account (if allowed)
 */
exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await AdminAuth.findById(id);

    if (!admin) {
      return res.status(404).json({ 
        success: false,
        message: "Admin not found" 
      });
    }

    // Check if admin can be deleted
    if (!admin.canBeDeleted) {
      return res.status(403).json({ 
        success: false,
        message: "This admin account cannot be deleted" 
      });
    }

    // Delete permanently
    await AdminAuth.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Admin deleted successfully"
    });
  } catch (error) {
    console.error("Delete admin error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};

/**
 * GET /api/admin/auth/list
 * Get all admins
 */
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await AdminAuth.find()
      .select('-otp -otpExpiresAt -__v')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Admins retrieved successfully",
      data: admins,
      count: admins.length
    });
  } catch (error) {
    console.error("Get admins error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};

// ====== Authentication ======

/**
 * POST /api/admin/auth/login
 * Only existing admins can login
 */
exports.loginWithMobile = async (req, res) => {
  try {
    const raw = req.body?.mobileNumber;
    const mobileNumber = normalizeMobile(raw);

    console.log(`[LOGIN DEBUG] Request received for mobile: ${mobileNumber}`);

    if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
      return res.status(400).json({ 
        success: false,
        message: "Phone number is required (10-15 digits)" 
      });
    }

    // Check if admin exists
    const admin = await AdminAuth.findOne({ mobileNumber });
    console.log(`[LOGIN DEBUG] Admin found: ${admin ? 'YES' : 'NO'}`);

    if (!admin) {
      return res.status(404).json({ 
        success: false,
        message: "Admin account not found. Please contact administrator." 
      });
    }

    // Check cooldown for resending OTP
    if (admin.updatedAt) {
      const diff = Date.now() - new Date(admin.updatedAt).getTime();
      console.log(`[LOGIN DEBUG] Time since last OTP: ${diff}ms, cooldown: ${RESEND_COOLDOWN_MS}ms`);
      if (diff < RESEND_COOLDOWN_MS) {
        return res.status(429).json({
          success: false,
          message: `Please wait ${Math.ceil(
            (RESEND_COOLDOWN_MS - diff) / 1000
          )}s before requesting another OTP`,
        });
      }
    }

    const otp = generateOTP(6);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    console.log(`[LOGIN DEBUG] Generated OTP: ${otp}, Expires at: ${otpExpiresAt}`);

    admin.otp = otp;
    admin.otpExpiresAt = otpExpiresAt;
    
    // Save and verify
    await admin.save();
    
    // Double-check that OTP was saved
    const updatedAdmin = await AdminAuth.findOne({ mobileNumber });
    console.log(`[LOGIN DEBUG] After save - OTP: ${updatedAdmin.otp}, Expires: ${updatedAdmin.otpExpiresAt}`);

    // Send OTP (function handles both SMS and console logging)
    await sendOtpSMS(mobileNumber, otp);

    // Prepare response
    const response = {
      success: true,
      message: "OTP sent successfully",
      mobileNumber,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };

    // Add OTP to response only in debug mode
    if (SHOW_DEBUG_OTP) {
      response.otp = otp;
      response.debug = true;
      response.note = "OTP shown in debug mode only";
    }

    console.log(`[LOGIN DEBUG] Response sent:`, response);
    return res.status(200).json(response);
  } catch (error) {
    console.error("Admin loginWithMobile error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};

/**
 * POST /api/admin/auth/verify-otp
 */
exports.verifyOTP = async (req, res) => {
  try {
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    const otp = String(req.body?.otp || "").trim();

    console.log(`[VERIFY DEBUG] Request received for mobile: ${mobileNumber}, OTP: ${otp}`);

    if (
      !mobileNumber ||
      !/^\d{10,15}$/.test(mobileNumber) ||
      !/^\d{6}$/.test(otp)
    ) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid mobile number or 6-digit OTP" 
      });
    }

    const admin = await AdminAuth.findOne({ mobileNumber });
    console.log(`[VERIFY DEBUG] Admin found: ${admin ? 'YES' : 'NO'}`);
    
    if (!admin) {
      return res.status(404).json({ 
        success: false,
        message: "Admin account not found" 
      });
    }

    console.log(`[VERIFY DEBUG] Stored OTP: ${admin.otp}, Expires: ${admin.otpExpiresAt}`);
    console.log(`[VERIFY DEBUG] Current time: ${new Date()}, OTP expiry: ${admin.otpExpiresAt}`);

    if (!admin.otp || !admin.otpExpiresAt) {
      console.log(`[VERIFY DEBUG] No active OTP found. OTP: ${admin.otp}, Expires: ${admin.otpExpiresAt}`);
      return res.status(400).json({ 
        success: false,
        message: "No active OTP. Please request a new OTP." 
      });
    }

    if (admin.otpExpiresAt < new Date()) {
      console.log(`[VERIFY DEBUG] OTP expired. Current: ${new Date()}, OTP expiry: ${admin.otpExpiresAt}`);
      admin.otp = null;
      admin.otpExpiresAt = null;
      await admin.save();
      return res.status(400).json({ 
        success: false,
        message: "OTP expired. Please request a new OTP." 
      });
    }

    if (admin.otp !== otp) {
      console.log(`[VERIFY DEBUG] OTP mismatch. Expected: ${admin.otp}, Received: ${otp}`);
      return res.status(400).json({ 
        success: false,
        message: "Invalid OTP" 
      });
    }

    console.log(`[VERIFY DEBUG] OTP matched successfully!`);

    // OTP valid → clear it
    admin.otp = null;
    admin.otpExpiresAt = null;
    await admin.save();

    // Generate JWT token
    const token = jwt.sign(
      {
        adminId: admin._id,
        mobileNumber: admin.mobileNumber,
        name: admin.name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    console.log(`[VERIFY DEBUG] JWT Token generated successfully`);

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      data: {
        _id: admin._id,
        mobileNumber: admin.mobileNumber,
        name: admin.name,
        canBeDeleted: admin.canBeDeleted
      },
      token: token,  // Send JWT token to frontend
      expiresIn: JWT_EXPIRES_IN,
      status: "Online"
    });
  } catch (error) {
    console.error("Admin verifyOTP error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};


/**
 * POST /api/admin/auth/resend-otp
 */
exports.resendOTP = async (req, res) => {
  try {
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    if (!mobileNumber || !/^\d{10,15}$/.test(mobileNumber)) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid mobile number (10-15 digits)" 
      });
    }

    const admin = await AdminAuth.findOne({ mobileNumber });

    if (!admin) {
      return res.status(404).json({ 
        success: false,
        message: "Admin account not found" 
      });
    }

    // Check cooldown
    if (admin.updatedAt) {
      const diff = Date.now() - new Date(admin.updatedAt).getTime();
      if (diff < RESEND_COOLDOWN_MS) {
        return res.status(429).json({
          success: false,
          message: `Please wait ${Math.ceil(
            (RESEND_COOLDOWN_MS - diff) / 1000
          )}s before requesting another OTP`,
        });
      }
    }

    const otp = generateOTP(6);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    admin.otp = otp;
    admin.otpExpiresAt = otpExpiresAt;
    await admin.save();

    // Send OTP
    await sendOtpSMS(mobileNumber, otp);

    // Prepare response
    const response = {
      success: true,
      message: "OTP re-sent successfully",
      mobileNumber,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };

    // Add OTP to response only in debug mode
    if (SHOW_DEBUG_OTP) {
      response.otp = otp;
      response.debug = true;
      response.note = "OTP shown in debug mode only";
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("Admin resendOTP error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};

/**
 * POST /api/admin/auth/logout
 * Logout endpoint
 */
exports.logout = async (req, res) => {
  try {
    // Note: JWT is stateless, so we don't need to do anything on the server
    // If you want to implement token blacklisting, you can add it here
    
    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Admin logout error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Server error", 
      error: error.message 
    });
  }
};

// Export middleware if needed elsewhere
// exports.authMiddleware = require('../../middleware/authMiddleware');