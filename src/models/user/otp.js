const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  mobileNumber: { type: Number },
  otp: { type: Number, required: true },
  expiry: { type: Date, required: true, index: { expires: 0 } },
});

otpSchema.index({ expiry: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("Otp", otpSchema);
