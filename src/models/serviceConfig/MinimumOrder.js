const mongoose = require("mongoose");
const MinimumOrderSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      default: "deep-cleaning",
      enum: ["deep-cleaning"],
      unique: true,
      required: true
    },
    amount: { type: Number, required: true, min: 0 },
    city: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MinimumOrder", MinimumOrderSchema);
