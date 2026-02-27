const mongoose = require("mongoose");

const toCityDisplay = (v = "") =>
  String(v).trim().replace(/\s+/g, " ")
    .toLowerCase().split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const toCityKey = (v = "") =>
  String(v).trim().replace(/\s+/g, " ").toLowerCase();

const citySchema = new mongoose.Schema(
  {
    city: { type: String, required: true, trim: true }, // "Bengaluru"
    cityKey: { type: String, required: true, unique: true, index: true }, // "bengaluru"
    feedbackLink: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

citySchema.pre("validate", function (next) {
  this.city = toCityDisplay(this.city);
  this.cityKey = toCityKey(this.city);
  next();
});

module.exports = mongoose.model("City", citySchema);
