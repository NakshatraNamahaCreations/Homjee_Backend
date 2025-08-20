const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    productType: {
      type: String,
      enum: [
        "Paints",
        "Texture",
        "Chemical Waterproofing",
        "Terrace Waterproofing",
        "Tile Grouting",
        "POP",
        "Wood Polish",
        "Packages",
      ],
      required: true,
    },
    products: [
      {
        name: { type: String, },
        price: { type: Number, },
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
        // Fields specific to Packages
        interiorCeiling: {
          type: String,
          default: "",
        },
        interiorWalls: {
          type: String,
          default: "",
        },
        exteriorCeiling: {
          type: String,
          default: "",
        },
        exteriorWalls: {
          type: String,
          default: "",
        },
        others: {
          type: String,
          default: "",
        },
      },
    ],
  },
  { timestamps: true }
);

// Pre-save hook remains the same
ProductSchema.pre("save", function (next) {
  if (this.productType === "Paints") {
    this.products.forEach((product) => {
      if (product.type === "Normal") {
        product.includePuttyOnFresh = true;
        product.includePuttyOnRepaint = false;
      } else if (product.type === "Special") {
        product.includePuttyOnFresh = false;
        product.includePuttyOnRepaint = false;
      }
    });
  } else {
    this.products.forEach((product) => {
      product.includePuttyOnFresh = false;
      product.includePuttyOnRepaint = false;
    });
  }
  next();
});

module.exports = mongoose.model("Product", ProductSchema);