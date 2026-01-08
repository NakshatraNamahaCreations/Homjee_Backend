const userSchema = require("../../models/user/userAuth");
const otpSchema = require("../../models/user/otp");
const crypto = require("crypto");

exports.saveUser = async (req, res) => {
  try {
    const { mobileNumber } = req.body;

    if (!mobileNumber) {
      return res.status(400).json({ message: "Mobile number is required" });
    }

    // Generate OTP and expiry
    const otp = crypto.randomInt(1000, 10000);
    const expiry = new Date(Date.now() + 60 * 1000);
    await otpSchema.create({ mobileNumber, otp, expiry });

    // Just check if user exists, do not create
    const user = await userSchema.findOne({ mobileNumber });

    res.status(200).json({
      message: "OTP Sent successfully!",
      otp: otp,
      isNewUser: user ? false : true,
    });
  } catch (error) {
    console.error("Error generating OTP:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// exports.verifyOTP = async (req, res) => {
//   const { mobileNumber, otp, userName } = req.body;

//   try {
//     const record = await otpSchema.findOne({ mobileNumber, otp });

//     if (!record) {
//       return res.status(400).json({ message: "Invalid OTP" });
//     }

//     if (record.expiry < new Date()) {
//       return res.status(400).json({ message: "OTP expired" });
//     }

//     await otpSchema.deleteMany({ mobileNumber });

//     let user = await userSchema.findOne({ mobileNumber });

//     // If user does not exist, create after successful OTP
//     let isNewUser = false;
//     if (!user) {
//       isNewUser = true;
//       user = new userSchema({
//         mobileNumber,
//         userName: userName || "",
//       });
//       await user.save();
//     }

//     res.status(200).json({
//       message: "OTP verified successfully",
//       data: user,
//       status: "Online",
//       isNewUser: isNewUser,
//     });
//   } catch (error) {
//     console.error("OTP verification error:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.verifyOTP = async (req, res) => {
  const { mobileNumber, otp, userName } = req.body;

  try {
    const record = await otpSchema.findOne({ mobileNumber, otp });

    if (!record) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (record.expiry < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    await otpSchema.deleteMany({ mobileNumber });

    let user = await userSchema.findOne({ mobileNumber });

    let isNewUser = false;

    // ➤ USER DOES NOT EXIST → CREATE
    if (!user) {
      isNewUser = true;
      user = await userSchema.create({
        mobileNumber,
        userName: userName || "",
      });
    }

    // ➤ USER EXISTS → UPDATE NAME IF SENT
    else if (userName && userName.trim() !== "" && user.userName !== userName) {
      user.userName = userName;
      await user.save();
    }

    res.status(200).json({
      message: "OTP verified successfully",
      data: user,
      status: "Online",
      isNewUser,
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.resendOTP = async (req, res) => {
  const { mobileNumber } = req.body;
  try {
    const user = await userSchema.findOne({ mobileNumber });
    if (!user) {
      console.log("Mobile Number not match");
      return res.status(400).json({ message: "mobile number not match" });
    }

    const otp = crypto.randomInt(1000, 10000);
    const expiry = new Date(Date.now() + 60 * 1000);

    await otpSchema.create({ mobileNumber, otp, expiry });

    // console.log(`OTP Re-sent to ${mobileNumber}`);

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


exports.findingExistingUserWithMobileNumber = async (req, res) => {
  const { mobileNumber } = req.body;
  try {
    let user = await userSchema.findOne({ mobileNumber });
    // If user does not exist, create after new 
    if (user) {
      res.status(200).json({
        message: "User already exist",
        data: user,
        isNewUser: false,
      });
    } else {
      return res.status(200).json({ message: "User not exist", data: [], isNewUser: true })
    }
  } catch (error) {
    console.error("Error while check user state:", error);
    res.status(500).json({ message: "Server error" });
  }
};


exports.addAddress = async (req, res) => {
  const { savedAddress } = req.body;
  try {
    const user = await userSchema.findOne({ _id: req.params.id });
    if (!user) {
      console.log("User Not Found");
      return res.status(400).json({ message: "User Not Found" });
    }

    const updateData = await userSchema.findOneAndUpdate(
      { _id: req.params.id },
      // { $push: { savedAddress: savedAddress } }, //for array of object address
      { savedAddress },
      { new: true }
    );

    res.status(200).json({
      status: true,
      message: "Address saved successfully",
      address: updateData.savedAddress,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getUserAddressByUserId = async (req, res) => {
  try {
    const user = await userSchema.findOne({ _id: req.params.id });
    if (!user) {
      console.log("User Not Found");
      return res.status(400).json({ message: "User Not Found" });
    }
    res.status(200).json({
      status: true,
      message: "User Address Found",
      address: user.savedAddress,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error", error: error });
  }
};
