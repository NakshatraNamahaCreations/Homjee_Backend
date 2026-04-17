const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  userName: String,
  mobileNumber: Number,
  savedAddress: Object,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("user", userSchema);
