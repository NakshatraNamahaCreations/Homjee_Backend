// middleware/authMiddleware.js
require("dotenv").config();
const jwt = require("jsonwebtoken");
const AdminAuth = require("../models/admin/AdminAuth");

const JWT_SECRET =
  process.env.JWT_SECRET || "your-super-secret-jwt-key-change-this";

// ✅ Extract token from multiple supported headers
const extractToken = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  // Authorization: Bearer <token>
  if (authHeader && typeof authHeader === "string") {
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.split(" ")[1];
    }
    // Some clients send token directly without Bearer
    return authHeader;
  }

  // x-auth-token: <token>
  if (req.headers["x-auth-token"]) return req.headers["x-auth-token"];

  // token: <token>
  if (req.headers.token) return req.headers.token;

  return null;
};

const authMiddleware = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Token missing.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid authentication token.",
        });
      }

      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Session expired. Please login again.",
        });
      }

      return res.status(401).json({
        success: false,
        message: "Authentication failed.",
      });
    }

    // ✅ Support multiple possible id keys
    const adminId = decoded.adminId || decoded._id || decoded.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload (missing admin id).",
      });
    }

    const admin = await AdminAuth.findById(adminId).select(
      "-otp -otpExpiresAt -__v"
    );

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin account not found or inactive.",
      });
    }

    req.admin = admin;
    req.adminId = admin._id;
    req.token = token;

    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Authentication middleware error.",
    });
  }
};

module.exports = authMiddleware;
