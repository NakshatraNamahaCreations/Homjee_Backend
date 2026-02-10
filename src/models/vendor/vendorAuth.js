const mongoose = require("mongoose");

const vendorInfo = new mongoose.Schema({
  vendorName: String,
  mobileNumber: Number,
  profileImage: String,
  dateOfBirth: String,
  yearOfWorking: String,
  city: String,
  serviceType: String,
  capacity: Number,
  serviceArea: String,
});

const documentInfo = new mongoose.Schema({
  aadhaarNumber: String,
  panNumber: String,
  aadhaarfrontImage: String,
  aadhaarbackImage: String,
  panImage: String,
  otherPolicy: String,
});

const accountInfo = new mongoose.Schema({
  accountNumber: String,
  ifscCode: String,
  bankName: String,
  branchName: String,
  holderName: String,
  accountType: String,
  gstNumber: String,
});

const addressDetails = new mongoose.Schema({
  location: String,
  latitude: Number,
  longitude: Number,
  geo: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
  },
});

// Define team member schema to match vendor structure
const teamMemberInfo = new mongoose.Schema(
  {
    name: String,
    mobileNumber: Number,
    profileImage: String,
    dateOfBirth: String,
    city: String,
    serviceType: String,
    serviceArea: String,
    documents: documentInfo,
    bankDetails: accountInfo,
    address: addressDetails,
    markedLeaves: [
      { type: String }, // e.g. "2025-09-16"
    ],
  },
  {
    timestamps: Date,
  },
);

const vendorAuthSchema = new mongoose.Schema({
  vendor: vendorInfo,
  documents: documentInfo,
  address: addressDetails,
  bankDetails: accountInfo,
  activeStatus: Boolean,
  wallet: {
    coins: {
      type: Number,
      default: 0,
    },

    overallCoinPurchased: {
      type: Number,
      default: 0,
    },

    paymentLink: {
      type: String,
    },
    linkExpiry: {
      type: Date,
    },
    isLinkActive: {
      type: Boolean,
      default: false, // Set default as false
    },
    canRespondLead: {
      type: Boolean,
    },
  },
  team: {
    type: [teamMemberInfo], // Embed team member objects
    default: [],
  },
  markedLeaves: [{ type: String }],
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    ratingsBreakdown: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 },
    },
  },
},
  {
    timestamps: true, // ✅ added for vendor document (createdAt, updatedAt)
  }
);

// ✅ GEO index for location search (5km radius)
vendorAuthSchema.index({ "address.geo": "2dsphere" });

vendorAuthSchema.pre("save", function (next) {
  try {
    const lat = this.address?.latitude;
    const lng = this.address?.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.address.geo = { type: "Point", coordinates: [lng, lat] };
    }
  } catch (e) { }
  next();
});

// ✅ Service type + active filter
vendorAuthSchema.index({ "vendor.serviceType": 1, activeStatus: 1 });

// Middleware to check if the link has expired and set isLinkActive accordingly
vendorAuthSchema.wallet?.pre("save", function (next) {
  // If linkExpiry is set, check if it has expired
  if (this.linkExpiry && this.linkExpiry < new Date()) {
    this.isLinkActive = false; // Set the link as inactive if the expiry date has passed
  }
  next();
});

module.exports = mongoose.model("vendor", vendorAuthSchema);
