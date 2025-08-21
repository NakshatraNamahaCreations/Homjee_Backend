const mongoose = require("mongoose");

const paintSchema = new mongoose.Schema({
  name: { type: String },
  price: { type: Number },
  description: { type: String, default: "" },
  isSpecial: { type: Boolean },
  type: {
    type: String,
    enum: ["Normal", "Special"],
    default: "Normal",
  },
  includePuttyOnFresh: {
    type: Boolean,
    default: function () {
      return this.type === "Normal" && this.parent().productType === "Paints";
    },
  },
  includePuttyOnRepaint: {
    type: Boolean,
    default: function () {
      return false;
    },
  },
});

const packageList = new mongoose.Schema({
  itemName: String,
  paintName: String,
  paintPrice: Number,
  category: String,
  paintType: String,
  includePuttyOnFresh: Boolean,
  includePuttyOnRepaint: Boolean,
});

const packageSchema = new mongoose.Schema({
  packageName: String,
  packagePrice: Number,
  details: [packageList],
});
const ProductSchema = new mongoose.Schema(
  {
    paint: [paintSchema],
    package: [packageSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", ProductSchema);
