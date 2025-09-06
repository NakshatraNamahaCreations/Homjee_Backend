// // const vendorAuthSchema = require("../../models/vendor/vendorAuth");
// const otpSchema = require("../../models/user/otp");
// const crypto = require("crypto");

// function generateOTP() {
//   // return Math.floor(1000 + Math.random() * 10000).toString();
//   return crypto.randomInt(1000, 10000);
// }

// exports.createVendor = async (req, res) => {
//   try {
//     const vendor = JSON.parse(req.body.vendor || "{}");
//     const documents = JSON.parse(req.body.documents || "{}");
//     const bankDetails = JSON.parse(req.body.bankDetails || "{}");
//     const addressDetails = JSON.parse(req.body.address || "{}");

//     const profileImageUrl = req.files["profileImage"]?.[0]?.path;
//     const aadhaarImageUrl = req.files["aadhaarImage"]?.[0]?.path;
//     const panImageUrl = req.files["panImage"]?.[0]?.path;
//     const otherPolicyUrl = req.files["otherPolicy"]?.[0]?.path;

//     const newVendor = new vendorAuthSchema({
//       vendor: {
//         vendorName: vendor.vendorName || "",
//         mobileNumber: vendor.mobileNumber || "",
//         profileImage: profileImageUrl || "",
//         dateOfBirth: vendor.dateOfBirth || "",
//         yearOfWorking: vendor.yearOfWorking || "",
//         serviceType: vendor.serviceType || "",
//         capacity: vendor.capacity || "",
//         serviceArea: vendor.serviceArea || "",
//         city: vendor.city || "",
//       },
//       documents: {
//         aadhaarNumber: documents.aadhaarNumber || "",
//         panNumber: documents.panNumber || "",
//         aadhaarImage: aadhaarImageUrl,
//         panImage: panImageUrl,
//         otherPolicy: otherPolicyUrl,
//       },
//       bankDetails: {
//         accountNumber: bankDetails.accountNumber || "",
//         ifscCode: bankDetails.ifscCode || "",
//         bankName: bankDetails.bankName || "",
//         branchName: bankDetails.branchName || "",
//         holderName: bankDetails.holderName || "",
//         accountType: bankDetails.accountType || "",
//         gstNumber: bankDetails.gstNumber || "",
//       },
//       address: {
//         location: addressDetails.location || "",
//         latitude: addressDetails.latitude || "",
//         longitude: addressDetails.longitude || "",
//       },
//     });

//     await newVendor.save();

//     res.status(201).json({ message: "Vendor account created!", newVendor });
//   } catch (error) {
//     console.error("Error creating newVendor:");
//     console.dir(error, { depth: null });

//     if (error.name === "ValidationError") {
//       return res
//         .status(400)
//         .json({ message: "Validation error", error: error.errors });
//     }
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// exports.loginWithMobile = async (req, res) => {
//   try {
//     const { mobileNumber } = req.body;
//     if (!mobileNumber) {
//       return res.status(400).json({ message: "Phone number is required" });
//     }

//     const vendor = await vendorAuthSchema.findOne({
//       "vendor.mobileNumber": mobileNumber,
//     });
//     if (!vendor) {
//       return res.status(404).json({ message: "Vendor not found" });
//     }

//     const otp = generateOTP();

//     const expiry = new Date(Date.now() + 60 * 1000);

//     await otpSchema.deleteMany({ mobileNumber: mobileNumber });

//     await otpSchema.create({ mobileNumber: mobileNumber, otp, expiry });

//     console.log(`OTP for ${mobileNumber}: ${otp}`);

//     res
//       .status(200)
//       .json({ message: "OTP sent successfully", mobileNumber, otp: otp });
//   } catch (error) {
//     console.error("Error during vendor login:", error);
//     if (error.name === "ValidationError") {
//       return res
//         .status(400)
//         .json({ message: "Validation error", error: error.errors });
//     }
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// exports.verifyOTP = async (req, res) => {
//   const { mobileNumber, otp } = req.body;

//   try {
//     const record = await otpSchema.findOne({ mobileNumber, otp });

//     if (!record) {
//       return res.status(400).json({ message: "Invalid OTP" });
//     }

//     if (record.expiry < new Date()) {
//       return res.status(400).json({ message: "OTP expired" });
//     }

//     await otpSchema.deleteMany({ mobileNumber });

//     let user = await vendorAuthSchema.findOne({
//       "vendor.mobileNumber": mobileNumber,
//     });

//     if (!user) {
//       isNewUser = true;
//       user = new vendorAuthSchema({
//         mobileNumber,
//       });
//       await user.save();
//     }

//     res.status(200).json({
//       message: "OTP verified successfully",
//       data: user,
//       status: "Online",
//     });
//   } catch (error) {
//     console.error("OTP verification error:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.resendOTP = async (req, res) => {
//   const { mobileNumber } = req.body;
//   try {
//     const user = await vendorAuthSchema.findOne({
//       "vendor.mobileNumber": mobileNumber,
//     });
//     if (!user) {
//       console.log("Mobile Number not match");
//       return res.status(400).json({ message: "mobile number not match" });
//     }

//     const otp = generateOTP();

//     const expiry = new Date(Date.now() + 60 * 1000);

//     await otpSchema.deleteMany({ mobileNumber: mobileNumber });

//     await otpSchema.create({ mobileNumber: mobileNumber, otp, expiry });

//     res.status(200).json({
//       message: "OTP Re-sent",
//       user,
//       otp: otp,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.getVendorByVendorId = async (req, res) => {
//   try {
//     const vendor = await vendorAuthSchema.findOne({
//       "vendor._id": req.params.id,
//     });
//     if (!vendor) {
//       // console.log("Vendor Not Found");
//       return res.status(400).json({ message: "Vendor Not Found" });
//     }
//     res.status(200).json({
//       status: true,
//       message: "Vendor Found",
//       vendor,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ message: "Server error", error: error });
//   }
// };

// exports.getAllVendors = async (req, res) => {
//   try {
//     const vendor = await vendorAuthSchema.find();
//     if (vendor.length === 0) {
//       return res.status(400).json({ message: "Vendor Not Found" });
//     }
//     res.status(200).json({
//       status: true,
//       message: "Vendor Found",
//       vendor,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ message: "Server error", error: error });
//   }
// };

// // Add coins
// exports.addCoin = async (req, res) => {
//   try {
//     const { vendorId, coins } = req.body;
//     if (!vendorId || !coins) {
//       return res.status(400).json({ message: "vendorId and coins required" });
//     }

//     const vendor = await vendorAuthSchema.findByIdAndUpdate(
//       vendorId,
//       { $inc: { "wallet.coins": coins } }, // increment coins
//       { new: true }
//     );

//     if (!vendor) return res.status(404).json({ message: "Vendor not found" });

//     res.status(200).json({ message: "Coins added successfully", wallet: vendor.wallet });
//   } catch (error) {
//     console.error("AddCoin error:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// // Reduce coins
// exports.reduceCoin = async (req, res) => {
//   try {
//     const { vendorId, coins } = req.body;
//     if (!vendorId || !coins) {
//       return res.status(400).json({ message: "vendorId and coins required" });
//     }

//     const vendor = await vendorAuthSchema.findById(vendorId);
//     if (!vendor) return res.status(404).json({ message: "Vendor not found" });

//     if (vendor.wallet.coins < coins) {
//       return res.status(400).json({ message: "Insufficient coins" });
//     }

//     vendor.wallet.coins -= coins;
//     await vendor.save();

//     res.status(200).json({ message: "Coins reduced successfully", wallet: vendor.wallet });
//   } catch (error) {
//     console.error("ReduceCoin error:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// // controllers/vendor/vendorAuth.js

// exports.addTeamMember = async (req, res) => {
//   try {
//     const { vendorId, name } = req.body;

//     if (!vendorId || !name?.trim()) {
//       return res.status(400).json({ message: "vendorId and name are required" });
//     }

//     const vendor = await vendorAuthSchema.findByIdAndUpdate(
//       vendorId,
//       { $push: { team: { name: name.trim() } } },
//       { new: true }
//     );

//     if (!vendor) return res.status(404).json({ message: "Vendor not found" });

//     res.status(200).json({
//       message: "Team member added",
//       team: vendor.team,
//     });
//   } catch (err) {
//     console.error("addTeamMember error:", err);
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// };
// exports.removeTeamMember = async (req, res) => {
//   try {
//     const { vendorId, memberId } = req.body;
//     if (!vendorId || !memberId) {
//       return res.status(400).json({ message: "vendorId and memberId are required" });
//     }
//     const vendor = await vendorAuthSchema.findByIdAndUpdate(
//       vendorId,
//       { $pull: { team: { _id: memberId } } },
//       { new: true }
//     );
//     if (!vendor) return res.status(404).json({ message: "Vendor not found" });
//     res.status(200).json({ message: "Team member removed", team: vendor.team });
//   } catch (err) {
//     console.error("removeTeamMember error:", err);
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// };

const vendorAuthSchema = require("../../models/vendor/vendorAuth");
const otpSchema = require("../../models/user/otp");
const crypto = require("crypto");

function generateOTP() {
  return crypto.randomInt(1000, 10000);
}

exports.createVendor = async (req, res) => {
  try {
    const vendor = JSON.parse(req.body.vendor || "{}");
    const documents = JSON.parse(req.body.documents || "{}");
    const bankDetails = JSON.parse(req.body.bankDetails || "{}");
    const addressDetails = JSON.parse(req.body.address || "{}");

    const profileImageUrl = req.files["profileImage"]?.[0]?.path;
    const aadhaarfrontImageUrl = req.files["aadhaarfrontImage"]?.[0]?.path;
    const aadhaarbackImageUrl = req.files["aadhaarbackImage"]?.[0]?.path;

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
        aadhaarfrontImage: aadhaarfrontImageUrl,
        aadhaarbackImage:aadhaarbackImageUrl ,

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

exports.addTeamMember = async (req, res) => {
  try {
    const vendorId = req.body.vendorId;
    const member = JSON.parse(req.body.member || "{}");
    const documents = JSON.parse(req.body.documents || "{}");
    const bankDetails = JSON.parse(req.body.bankDetails || "{}");
    const addressDetails = JSON.parse(req.body.address || "{}");

    const profileImageUrl = req.files["profileImage"]?.[0]?.path;
   const aadhaarfrontImageUrl = req.files["aadhaarfrontImage"]?.[0]?.path;
    const aadhaarbackImageUrl = req.files["aadhaarbackImage"]?.[0]?.path;
    const panImageUrl = req.files["panImage"]?.[0]?.path;
    const otherPolicyUrl = req.files["otherPolicy"]?.[0]?.path;

    if (!vendorId) {
      return res.status(400).json({ message: "vendorId is required" });
    }

    const teamMember = {
      name: member.name || "",
      mobileNumber: member.mobileNumber || "",
      profileImage: profileImageUrl || "",
      dateOfBirth: member.dateOfBirth || "",
      city: member.city || "",
      serviceType: member.serviceType || "",
      serviceArea: member.serviceArea || "",
      documents: {
        aadhaarNumber: documents.aadhaarNumber || "",
        panNumber: documents.panNumber || "",
       aadhaarfrontImage: aadhaarfrontImageUrl,
        aadhaarbackImage:aadhaarbackImageUrl ,
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
    };

    const vendor = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      { $push: { team: teamMember } },
      { new: true, runValidators: true }
    );

    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    res.status(200).json({
      message: "Team member added",
      team: vendor.team,
    });
  } catch (err) {
    console.error("addTeamMember error:", err);
    if (err.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation error", error: err.errors });
    }
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.removeTeamMember = async (req, res) => {
  try {
    const { vendorId, memberId } = req.body;
    if (!vendorId || !memberId) {
      return res
        .status(400)
        .json({ message: "vendorId and memberId are required" });
    }
    const vendor = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      { $pull: { team: { _id: memberId } } },
      { new: true }
    );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.status(200).json({ message: "Team member removed", team: vendor.team });
  } catch (err) {
    console.error("removeTeamMember error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
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

// ... (Other existing endpoints like loginWithMobile, verifyOTP, etc. remain unchanged)

exports.addCoin = async (req, res) => {
  try {
    const { vendorId, coins } = req.body;
    if (!vendorId || !coins) {
      return res.status(400).json({ message: "vendorId and coins required" });
    }

    const vendor = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      { $inc: { "wallet.coins": coins } },
      { new: true }
    );

    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    res
      .status(200)
      .json({ message: "Coins added successfully", wallet: vendor.wallet });
  } catch (error) {
    console.error("AddCoin error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.reduceCoin = async (req, res) => {
  try {
    const { vendorId, coins } = req.body;
    if (!vendorId || !coins) {
      return res.status(400).json({ message: "vendorId and coins required" });
    }

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    if (vendor.wallet.coins < coins) {
      return res.status(400).json({ message: "Insufficient coins" });
    }

    vendor.wallet.coins -= coins;
    await vendor.save();

    res
      .status(200)
      .json({ message: "Coins reduced successfully", wallet: vendor.wallet });
  } catch (error) {
    console.error("ReduceCoin error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
