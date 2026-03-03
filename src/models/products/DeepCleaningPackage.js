// const mongoose = require("mongoose");
// const { isValidCombo } = require("../../data/deepCleaningCatalog");

// const DeepCleaningPackageSchema = new mongoose.Schema(
//   {
//     category: { type: String, required: true, trim: true },
//     subcategory: { type: String, required: true, trim: true },
//     service: { type: String, default: "", trim: true },

//     totalAmount: { type: Number, required: true, min: 0 },
//     coinsForVendor: { type: Number, required: true, min: 0 },

//     teamMembers: { type: Number, required: true, min: 1 },

//     // 🔥 REQUIRED FOR SLOT LOGIC
//     durationMinutes: {
//       type: Number,
//       required: true,
//       min: 30,
//     },

//     name: { type: String, trim: true }
//   },
//   { timestamps: true }
// );

// // validation stays SAME
// DeepCleaningPackageSchema.pre("validate", function (next) {
//   if (!isValidCombo(this.category, this.subcategory, this.service)) {
//     return next(new Error("Invalid category / subcategory / service combo"));
//   }

//   if (!this.name) {
//     this.name = this.service
//       ? `${this.subcategory} - ${this.service}`
//       : this.subcategory;
//   }

//   next();
// });

// DeepCleaningPackageSchema.index(
//   { category: 1, subcategory: 1, service: 1 },
//   { unique: true }
// );

// module.exports = mongoose.model(
//   "DeepCleaningPackage",
//   DeepCleaningPackageSchema
// );



const mongoose = require("mongoose");
const { isValidCombo } = require("../../data/deepCleaningCatalog");

const CityConfigSchema = new mongoose.Schema(
  {
    cityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
      required: true,
      // ✅ (optional) keep index here OR schema.index below — not both
      index: true,
    },

    // ✅ store display value for UI
    city: { type: String, required: true, trim: true },

    // ✅ per-city values
    totalAmount: { type: Number, required: true, min: 0 },
    coinsForVendor: { type: Number, required: true, min: 0 },
    teamMembers: { type: Number, required: true, min: 1 },
    durationMinutes: { type: Number, required: true, min: 30 },
  },
  { _id: false }
);

const DeepCleaningPackageSchema = new mongoose.Schema(
  {
    // ✅ package identity (never changes)
    category: { type: String, required: true, trim: true },
    subcategory: { type: String, required: true, trim: true },
    service: { type: String, default: "", trim: true },
    name: { type: String, trim: true },

    // ✅ city-specific configs
    cityConfigs: { type: [CityConfigSchema], default: [] },
  },
  { timestamps: true }
);

// ✅ identity validation
DeepCleaningPackageSchema.pre("validate", function (next) {
  try {
    if (!isValidCombo(this.category, this.subcategory, this.service)) {
      return next(new Error("Invalid category / subcategory / service combo"));
    }

    if (!this.name) {
      this.name = this.service
        ? `${this.subcategory} - ${this.service}`
        : this.subcategory;
    }

    // ✅ prevent duplicate cityId entries
    const ids = this.cityConfigs.map((c) => String(c.cityId));
    if (new Set(ids).size !== ids.length) {
      return next(new Error("Duplicate cityId inside cityConfigs"));
    }

    next();
  } catch (err) {
    next(err);
  }
});

// ✅ unique identity only once
DeepCleaningPackageSchema.index(
  { category: 1, subcategory: 1, service: 1 },
  { unique: true }
);


module.exports = mongoose.model("DeepCleaningPackage", DeepCleaningPackageSchema);