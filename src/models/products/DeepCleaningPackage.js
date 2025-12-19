const mongoose = require("mongoose");
const { isValidCombo } = require("../../data/deepCleaningCatalog");

const DeepCleaningPackageSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true },
    subcategory: { type: String, required: true, trim: true },
    service: { type: String, default: "", trim: true },

    totalAmount: { type: Number, required: true, min: 0 },
    coinsForVendor: { type: Number, required: true, min: 0 },

    teamMembers: { type: Number, required: true, min: 1 },

    // 🔥 REQUIRED FOR SLOT LOGIC
    durationMinutes: {
      type: Number,
      required: true,
      min: 30,
    },

    name: { type: String, trim: true }
  },
  { timestamps: true }
);

// validation stays SAME
DeepCleaningPackageSchema.pre("validate", function (next) {
  if (!isValidCombo(this.category, this.subcategory, this.service)) {
    return next(new Error("Invalid category / subcategory / service combo"));
  }

  if (!this.name) {
    this.name = this.service
      ? `${this.subcategory} - ${this.service}`
      : this.subcategory;
  }

  next();
});

DeepCleaningPackageSchema.index(
  { category: 1, subcategory: 1, service: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "DeepCleaningPackage",
  DeepCleaningPackageSchema
);


// // models/DeepCleaningPackage.js
// const mongoose = require("mongoose");
// const { isValidCombo } = require("../../data/deepCleaningCatalog");

// const DeepCleaningPackageSchema = new mongoose.Schema(
//   {
//     category: { type: String, required: true, trim: true },
//     subcategory: { type: String, required: true, trim: true },
//     // Some subcategories have no services; keep optional
//     service: { type: String, default: "" , trim: true},

//     totalAmount: { type: Number, required: true, min: 0 },
//     // bookingAmount: { type: Number, required: true, min: 0 },
//     coinsForVendor: { type: Number, required: true, min: 0 },
//     teamMembers: { type: Number, required: true, min: 1 },

//     // Computed helper (not required): name shown in UI table
//     name: { type: String, trim: true }
//   },
//   { timestamps: true }
// );

// // Cross-field validation (category, subcategory, service) combo
// DeepCleaningPackageSchema.pre("validate", function (next) {
//   const doc = this;
//   if (!isValidCombo(doc.category, doc.subcategory, doc.service)) {
//     return next(
//       new Error(
//         `Invalid combination: category="${doc.category}", subcategory="${doc.subcategory}", service="${doc.service || ""}"`
//       )
//     );
//   }

//   // Build a default display name if not provided
//   if (!doc.name || doc.isModified("category") || doc.isModified("subcategory") || doc.isModified("service")) {
//     doc.name = doc.service ? `${doc.subcategory} - ${doc.service}` : doc.subcategory;
//   }

//   // Optional guard: bookingAmount <= totalAmount (remove if not needed)
//   if (typeof doc.totalAmount === "number" && typeof doc.bookingAmount === "number" && doc.bookingAmount > doc.totalAmount) {
//     return next(new Error("Booking amount cannot exceed total amount."));
//   }

//   next();
// });

// // Optional unique constraint to prevent duplicates per combo (remove if you want multiples)
// // You can comment the index if you want to allow multiple different price points for same combo.
// DeepCleaningPackageSchema.index({ category: 1, subcategory: 1, service: 1 }, { unique: true });

// module.exports = mongoose.model("DeepCleaningPackage", DeepCleaningPackageSchema);
