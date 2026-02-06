
// const mongoose = require("mongoose");

// const paintSchema = new mongoose.Schema({
//   name: { type: String },
//   price: { type: Number },
//   description: { type: String, default: "" },
//   isSpecial: { type: Boolean },
//   type: {
//     type: String,
//     enum: ["Normal", "Special"],
//     default: "Normal",
//   },
//   includePuttyOnFresh: {
//     type: Boolean,
//     default: function () {
//       return this.type === "Normal" && this.productType === "Paints";
//     },
//   },
//   includePuttyOnRepaint: {
//     type: Boolean,
//     default: false,
//   },
//   productType: { type: String },
//   city: { type: String },
// });

// const packageList = new mongoose.Schema({
//   itemName: String,
//   paintName: String,
//   paintPrice: Number,
//   category: String,
 
//   includePuttyOnFresh: {
//     type: Boolean,
//     default: true,
//   },
//   includePuttyOnRepaint: {
//     type: Boolean,
//     default: false,
//   },
//   city:{type:String}
// });

// const packageSchema = new mongoose.Schema({
//   packageName: String,
//   packagePrice: Number,
//   details: [packageList],
//   productType: { type: String, default: "Packages" },
// });

// const finishingType = new mongoose.Schema({
//   paintName: String,
//   paintPrice: Number,
//   description: String,
//   productType: {
//     type: String,
//     enum: [
//       "Texture",
//       "Chemical Waterproofing",
//       "Terrace Waterproofing",
//       "Tile Grouting",
//       "POP",
//       "Wood Polish",
//     ],
//   },
//   city:{type:String}
// });

// const ProductSchema = new mongoose.Schema(
//   {
//     paint: [paintSchema],
//     package: [packageSchema],
//     additionalPaints: [finishingType],
//   },
//   { timestamps: true },
// );

// module.exports = mongoose.model("Product", ProductSchema);


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
      return this.type === "Normal" && this.productType === "Paints";
    },
  },
  includePuttyOnRepaint: {
    type: Boolean,
    default: false,
  },
  productType: { type: String },
  city: { type: String },
  order: { type: Number, default: 0 }, // Add this line
});

const packageList = new mongoose.Schema({
  itemName: String,
  paintName: String,
  paintPrice: Number,
  category: String,
  includePuttyOnFresh: {
    type: Boolean,
    default: true,
  },
  includePuttyOnRepaint: {
    type: Boolean,
    default: false,
  },
  city: { type: String }
});

const packageSchema = new mongoose.Schema({
  packageName: String,
  packagePrice: Number,
  details: [packageList],
  productType: { type: String, default: "Packages" },
  order: { type: Number, default: 0 }, // Add this line
});

const finishingType = new mongoose.Schema({
  paintName: String,
  paintPrice: Number,
  description: String,
  productType: {
    type: String,
    enum: [
      "Texture",
      "Chemical Waterproofing",
      "Terrace Waterproofing",
      "Tile Grouting",
      "POP",
      "Wood Polish",
    ],
  },
  city: { type: String },
  order: { type: Number, default: 0 }, // Add this line
});

const ProductSchema = new mongoose.Schema(
  {
    paint: [paintSchema],
    package: [packageSchema],
    additionalPaints: [finishingType],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", ProductSchema);