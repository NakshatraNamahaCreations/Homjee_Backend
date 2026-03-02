const mongoose = require("mongoose");

const citySchema = new mongoose.Schema(
  {
    city: { type: String, required: true, trim: true },
    feedbackLink: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("City", citySchema);
