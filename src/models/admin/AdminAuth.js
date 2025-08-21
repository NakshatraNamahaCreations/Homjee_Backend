// models/AdminAuth.js
const mongoose = require("mongoose");

const AdminAuthSchema = new mongoose.Schema(
  {
    mobileNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: [/^\d{10,15}$/, "Invalid mobile number"], // digits only, 10–15 length
    },
    name: { type: String, trim: true }, // optional

    // OTP state (latest OTP for this admin)
    otp: { type: String, default: null },            // 6-digit string
    otpExpiresAt: { type: Date, default: null },     // expiry timestamp
  },
  { timestamps: true }
);



module.exports = mongoose.model("AdminAuth", AdminAuthSchema);
