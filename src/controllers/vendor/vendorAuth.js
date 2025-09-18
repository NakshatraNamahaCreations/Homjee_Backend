const vendorAuthSchema = require("../../models/vendor/vendorAuth");
const otpSchema = require("../../models/user/otp");
const userBooking = require("../../models/user/userBookings");
const crypto = require("crypto");
const moment = require("moment");

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
        aadhaarbackImage: aadhaarbackImageUrl,

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
        aadhaarbackImage: aadhaarbackImageUrl,
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

// seperate.......quick....................
exports.addSmallTeamMember = async (req, res) => {
  try {
    const vendorId = req.params.vendorId;
    const member = JSON.parse(req.body.member || "{}");

    if (!vendorId) {
      return res.status(400).json({ message: "vendorId is required" });
    }

    const teamMember = {
      name: member.name || "",
      mobileNumber: member.mobileNumber || "",
      dateOfBirth: member.dateOfBirth || "",
      city: member.city || "",
      serviceType: member.serviceType || "",
      serviceArea: member.serviceArea || "",
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

exports.getTeamByVendorID = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const findVendor = await vendorAuthSchema.findOne({ _id: vendorId });
    if (!findVendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // Assuming `team` is a field/array in vendorAuthSchema
    return res.status(200).json({ team: findVendor.team });
  } catch (err) {
    console.error("Error fetching vendor team:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
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

exports.updateTeamMemberLeaves = async (req, res) => {
  try {
    const { vendorId, teamMemberId } = req.params;
    const { leaveDates } = req.body; // ["2025-09-16", "2025-09-17"]

    if (!Array.isArray(leaveDates)) {
      return res
        .status(400)
        .json({ success: false, message: "leaveDates must be an array" });
    }

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor)
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });

    const member = vendor.team.id(teamMemberId);
    if (!member)
      return res
        .status(404)
        .json({ success: false, message: "Team member not found" });

    // Save new leave dates
    member.markedLeaves = leaveDates;
    await vendor.save();

    res.json({
      success: true,
      message: "Leaves updated successfully",
      results: member,
    });
  } catch (err) {
    console.error("Error updating leaves:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.teamMemberById = async (req, res) => {
  try {
    const { vendorId, teamMemberId } = req.params;

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor)
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });

    const member = vendor.team.id(teamMemberId);
    if (!member)
      return res
        .status(404)
        .json({ success: false, message: "Team member not found" });

    res.json({
      success: true,
      message: "Leaves updated successfully",
      results: member,
    });
  } catch (err) {
    console.error("Error fetching team:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.getTeamMemberBusyDates = async (req, res) => {
  try {
    const { vendorId, teamMemberId } = req.params;

    // find all bookings for this vendor where this team member is in hiring
    const bookings = await userBooking
      .find({
        "assignedProfessional.professionalId": vendorId,
        "assignedProfessional.hiring.teamMember.memberId": teamMemberId,
      })
      .lean();

    // collect busy dates
    const busyDates = [];
    bookings.forEach((b) => {
      const projectDates = b.assignedProfessional?.hiring?.projectDate || [];
      busyDates.push(...projectDates);
    });

    res.json({
      success: true,
      busyDates: [...new Set(busyDates)], // remove duplicates
    });
  } catch (err) {
    console.error("Error fetching busy dates:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.getVendorTeamStatuses = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const today = moment().format("YYYY-MM-DD");
    const getVendor = await vendorAuthSchema.findById(vendorId);
    // console.log("getVendor", getVendor);

    const vendor = await vendorAuthSchema
      .findById(vendorId)
      .select("team._id team.markedLeaves team.name")
      .lean();

    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }

    const team = vendor.team || [];
    const teamIdStrs = team.map((m) => String(m._id));

    // find all bookings where this vendor has a project running TODAY
    const bookingsToday = await userBooking
      .find({
        "assignedProfessional.professionalId": vendorId,
        "assignedProfessional.hiring.projectDate": today,
      })
      .select("assignedProfessional.hiring.teamMember.memberId")
      .lean();

    // build a set of memberIds that are working today
    const workingSet = new Set();
    for (const b of bookingsToday) {
      const members = b?.assignedProfessional?.hiring?.teamMember || [];
      for (const tm of members) workingSet.add(String(tm.memberId));
    }

    const statuses = {};
    for (const member of team) {
      const id = String(member._id);
      const isLeave =
        Array.isArray(member.markedLeaves) &&
        member.markedLeaves.includes(today);
      const isWorking = workingSet.has(id);

      // Business rule: if a conflict exists (shouldn’t happen), treat as Working.
      let status = "Available";
      if (isWorking) status = "Working";
      else if (isLeave) status = "On Leave";

      statuses[id] = { status };
    }

    return res.json({ success: true, date: today, statuses, getVendor });
  } catch (err) {
    console.error("getVendorTeamStatuses error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.checkVendorAvailability = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { startDate, daysRequired } = req.query;

    if (!startDate || !daysRequired) {
      return res.status(400).json({
        success: false,
        message: "startDate and daysRequired are required",
      });
    }

    const vendor = await vendorAuthSchema.findById(vendorId).lean();
    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }

    const projectDays = [];
    for (let i = 0; i < Number(daysRequired); i++) {
      projectDays.push(moment(startDate).add(i, "days").format("YYYY-MM-DD"));
    }

    // Check team availability for each project day
    const availableMembers = vendor.team.filter((member) => {
      return !member.markedLeaves?.some((leaveDate) =>
        projectDays.includes(leaveDate)
      );
    });

    const requiredMembers = 2; // house painters need 2
    const isAvailable = availableMembers.length >= requiredMembers;

    return res.json({
      success: true,
      vendorId,
      startDate,
      daysRequired: Number(daysRequired),
      availableMembers,
      capacity: vendor.vendor.capacity,
      canStart: isAvailable,
    });
  } catch (err) {
    console.error("Error checking availability:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.checkVendorAvailabilityRange = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { startDate, endDate, daysRequired } = req.query;

    if (!startDate || !endDate || !daysRequired) {
      return res.status(400).json({
        success: false,
        message: "startDate, endDate and daysRequired are required",
      });
    }

    const vendor = await vendorAuthSchema.findById(vendorId).lean();
    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }

    const results = {};
    const requiredMembers = 2;
    const capacity = vendor.vendor.capacity;

    let current = moment(startDate);
    const last = moment(endDate);

    while (current.isSameOrBefore(last)) {
      const projectDays = [];
      for (let i = 0; i < Number(daysRequired); i++) {
        projectDays.push(current.clone().add(i, "days").format("YYYY-MM-DD"));
      }

      const availableMembers = vendor.team.filter((member) => {
        return !member.markedLeaves?.some((leaveDate) =>
          projectDays.includes(leaveDate)
        );
      });

      const isAvailable = availableMembers.length >= requiredMembers;

      results[current.format("YYYY-MM-DD")] = {
        canStart: isAvailable,
        availableMembers: availableMembers.map((m) => ({
          _id: m._id,
          name: m.name,
          markedLeaves: m.markedLeaves || [],
        })),
      };

      current = current.add(1, "day");
    }

    return res.json({
      success: true,
      vendorId,
      daysRequired: Number(daysRequired),
      capacity,
      availability: results, // keyed by date
    });
  } catch (err) {
    console.error("Error checking availability:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
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
