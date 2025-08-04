const vendorAuthSchema = require("../../models/vendor/vendorAuth");
const otpSchema = require("../../models/user/otp");

function generateOTP() {
  return Math.floor(1000 + Math.random() * 10000).toString();
}

exports.createVendor = async (req, res) => {
  try {
    const vendor = JSON.parse(req.body.vendor || "{}");
    const documents = JSON.parse(req.body.documents || "{}");
    const bankDetails = JSON.parse(req.body.bankDetails || "{}");
    const addressDetails = JSON.parse(req.body.address || "{}");

    const profileImageUrl = req.files["profileImage"]?.[0]?.path;
    const aadhaarImageUrl = req.files["aadhaarImage"]?.[0]?.path;
    const panImageUrl = req.files["panImage"]?.[0]?.path;
    const otherPolicyUrl = req.files["otherPolicy"]?.[0]?.path;

    const newVendor = new vendorAuthSchema({
      vendor: {
        vendorName: vendor.vendorName || "",
        mobileNumber: vendor.mobileNumber || "",
        profileImage: profileImageUrl || "",
        dateOfBirth: vendor.dateOfBirth || "",
        yearOfWorking: vendor.yearOfWorking || "",
        serviceType: vendor.serviceType || "",
        capacity: vendor.capacity || "",
        serviceArea: vendor.serviceArea || "",
        city: vendor.city || "",
      },
      documents: {
        aadhaarNumber: documents.aadhaarNumber || "",
        panNumber: documents.panNumber || "",
        aadhaarImage: aadhaarImageUrl,
        panImage: panImageUrl,
        otherPolicy: otherPolicyUrl,
      },
      bankDetails: {
        accountNumber: bankDetails.accountNumber || "",
        ifscCode: bankDetails.ifscCode || "",
        bankName: bankDetails.bankName || "",
        branchName: bankDetails.branchName || "",
        holderName: bankDetails.holderName || "",
        accountType: bankDetails.accountType || "",
        gstNumber: bankDetails.gstNumber || "",
      },
      address: {
        location: addressDetails.location || "",
        latitude: addressDetails.latitude || "",
        longitude: addressDetails.longitude || "",
      },
    });

    await newVendor.save();

    res.status(201).json({ message: "Vendor account created!", newVendor });
  } catch (error) {
    console.error("Error creating newVendor:");
    console.dir(error, { depth: null });

    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation error", error: error.errors });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.loginWithMobile = async (req, res) => {
  try {
    const { mobileNumber } = req.body;
    if (!mobileNumber) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const vendor = await vendorAuthSchema.findOne({
      "vendor.mobileNumber": mobileNumber,
    });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const otp = generateOTP();

    const expiry = new Date(Date.now() + 60 * 1000);

    await otpSchema.deleteMany({ mobileNumber: mobileNumber });

    await otpSchema.create({ mobileNumber: mobileNumber, otp, expiry });

    console.log(`OTP for ${mobileNumber}: ${otp}`);

    res
      .status(200)
      .json({ message: "OTP sent successfully", mobileNumber, otp: otp });
  } catch (error) {
    console.error("Error during vendor login:", error);
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation error", error: error.errors });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.verifyOTP = async (req, res) => {
  const { mobileNumber, otp } = req.body;

  try {
    const record = await otpSchema.findOne({ mobileNumber, otp });

    if (!record) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (record.expiry < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    await otpSchema.deleteMany({ mobileNumber });

    let user = await vendorAuthSchema.findOne({
      "vendor.mobileNumber": mobileNumber,
    });

    if (!user) {
      isNewUser = true;
      user = new vendorAuthSchema({
        mobileNumber,
      });
      await user.save();
    }

    res.status(200).json({
      message: "OTP verified successfully",
      data: user,
      status: "Online",
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.resendOTP = async (req, res) => {
  const { mobileNumber } = req.body;
  try {
    const user = await vendorAuthSchema.findOne({
      "vendor.mobileNumber": mobileNumber,
    });
    if (!user) {
      console.log("Mobile Number not match");
      return res.status(400).json({ message: "mobile number not match" });
    }

    const otp = generateOTP();

    const expiry = new Date(Date.now() + 60 * 1000);

    await otpSchema.deleteMany({ mobileNumber: mobileNumber });

    await otpSchema.create({ mobileNumber: mobileNumber, otp, expiry });

    res.status(200).json({
      message: "OTP Re-sent",
      user,
      otp: otp,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getVendorByVendorId = async (req, res) => {
  try {
    const vendor = await vendorAuthSchema.findOne({
      "vendor._id": req.params.id,
    });
    if (!vendor) {
      // console.log("Vendor Not Found");
      return res.status(400).json({ message: "Vendor Not Found" });
    }
    res.status(200).json({
      status: true,
      message: "Vendor Found",
      vendor,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error", error: error });
  }
};

exports.getAllVendors = async (req, res) => {
  try {
    const vendor = await vendorAuthSchema.find();
    if (vendor.length === 0) {
      return res.status(400).json({ message: "Vendor Not Found" });
    }
    res.status(200).json({
      status: true,
      message: "Vendor Found",
      vendor,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error", error: error });
  }
};
