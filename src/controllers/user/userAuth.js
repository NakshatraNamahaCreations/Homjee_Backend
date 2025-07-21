const userSchema = require("../../models/user/userAuth");
const otpSchema = require("../../models/user/otp");
const crypto = require("crypto");

exports.saveUser = async (req, res) => {
  try {
    const { mobileNumber, userName } = req.body;

    if (!mobileNumber) {
      return res.status(400).json({ message: "Mobile number is required" });
    }

    // Generate OTP and expiry
    const otp = crypto.randomInt(100000, 999999);
    const expiry = new Date(Date.now() + 60 * 1000);
    await otpSchema.create({ mobileNumber, otp, expiry });

    // Find user by mobile number
    let user = await userSchema.findOne({ mobileNumber });

    if (user) {
      // ✅ Update userName if provided
      if (userName) {
        user.userName = userName;
        await user.save();
      }

      return res.status(200).json({
        message: "OTP Sent successfully!",
        data: user,
        otp: otp,
        isNewUser: false,
      });
    }

    // If user doesn't exist, create new user with userName
    const newUser = new userSchema({
      mobileNumber,
      userName: userName || "", // fallback if empty
    });

    await newUser.save();

    res.status(201).json({
      message: "OTP Sent successfully!",
      data: newUser,
      otp: otp,
      isNewUser: true,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.verifyOTP = async (req, res) => {
  const { mobileNumber, otp } = req.body;
  try {
    const record = await otpSchema.findOne({
      mobileNumber,
      otp,
    });
    if (!record) {
      return res.status(400).json({ message: "Invalid OTP" });
    }
    if (record.expiry < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }
    await otpSchema.deleteMany({ mobileNumber });

    const user = await userSchema.findOne({ mobileNumber });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "OTP verified successfully",
      data: user,
      status: "Online",
    });
  } catch (error) {
    console.error(error);
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

    const otp = crypto.randomInt(100000, 999999);
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
      { $push: { savedAddress: savedAddress } },
      { new: true }
    );

    res.status(200).json({
      status: true,
      message: "Address saved successfully",
      address: updateData,
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
