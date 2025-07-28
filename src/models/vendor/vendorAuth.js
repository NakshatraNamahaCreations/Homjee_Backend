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
  aadhaarImage: String,
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
const vendorAuthSchema = new mongoose.Schema({
  vendor: vendorInfo,
  documents: documentInfo,
  address: addressDetails,
  bankDetails: accountInfo,
  activeStatus: Boolean,
});

module.exports = mongoose.model("vendor", vendorAuthSchema);
