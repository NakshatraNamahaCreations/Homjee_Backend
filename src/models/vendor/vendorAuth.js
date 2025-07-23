const mongoose = require("mongoose");

const vendorInfo = new mongoose.Schema({
  vendorName: String,
  phoneNumber: Number,
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

const vendorAuthSchema = new mongoose.Schema({
  vendor: vendorInfo,
  documents: documentInfo,
  bankDetails: accountInfo,
  activeStatus: Boolean,
});

module.exports = mongoose.model("vendor", vendorAuthSchema);
