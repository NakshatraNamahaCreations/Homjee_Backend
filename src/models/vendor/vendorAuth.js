// const mongoose = require("mongoose");

// const vendorInfo = new mongoose.Schema({
//   vendorName: String,
//   mobileNumber: Number,
//   profileImage: String,
//   dateOfBirth: String,
//   yearOfWorking: String,
//   city: String,
//   serviceType: String,
//   capacity: Number,
//   serviceArea: String,
// });

// const documentInfo = new mongoose.Schema({
//   aadhaarNumber: String,
//   panNumber: String,
//   aadhaarImage: String,
//   panImage: String,
//   otherPolicy: String,
// });

// const accountInfo = new mongoose.Schema({
//   accountNumber: String,
//   ifscCode: String,
//   bankName: String,
//   branchName: String,
//   holderName: String,
//   accountType: String,
//   gstNumber: String,
// });
// const addressDetails = new mongoose.Schema({
//   location: String,
//   latitude: Number,
//   longitude: Number,
// });

// const vendorAuthSchema = new mongoose.Schema({
//   vendor: vendorInfo,
//   documents: documentInfo,
//   address: addressDetails,
//   bankDetails: accountInfo,
//   activeStatus: Boolean,

//    wallet: {
//     coins: {
//       type: Number,
//       default: 0,
//     },
//   },

//   team: {
//     type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vendor" }],
//     default: [],
//   },

// });

// module.exports = mongoose.model("vendor", vendorAuthSchema);

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
  }
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
  },
  team: {
    type: [teamMemberInfo], // Embed team member objects
    default: [],
  },
});

module.exports = mongoose.model("vendor", vendorAuthSchema);
