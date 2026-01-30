const vendorAuthSchema = require("../../models/vendor/vendorAuth");
const otpSchema = require("../../models/user/otp");
const userBooking = require("../../models/user/userBookings");
const crypto = require("crypto");
const moment = require("moment");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const Vendor = require("../../models/vendor/vendorAuth"); // adjust path

function generateOTP() {
  return crypto.randomInt(1000, 10000);
}

const safeJson = (val) => {
  try {
    if (!val) return {};
    if (typeof val === "object") return val;
    return JSON.parse(val);
  } catch (e) {
    return {};
  }
};

const hasOwn = (obj, key) =>
  obj && Object.prototype.hasOwnProperty.call(obj, key);

// Your rule: "" means IGNORE (keep existing)
const isIgnorable = (v) => v === "" || v === undefined || v === null;

const setIfPresent = (update, obj, key, path, castFn) => {
  if (!hasOwn(obj, key)) return; // key not sent -> ignore
  const val = obj[key];
  if (isIgnorable(val)) return; // empty string -> ignore
  update[path] = castFn ? castFn(val) : val;
};

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

exports.updateVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const existing = await vendorAuthSchema.findById(vendorId);
    if (!existing) {
      return res
        .status(404)
        .json({ status: "fail", message: "Vendor not found" });
    }

    // JSON blocks coming from multipart/form-data
    const vendor = safeJson(req.body.vendor);
    const documents = safeJson(req.body.documents);
    const bankDetails = safeJson(req.body.bankDetails);
    const address = safeJson(req.body.address);

    const update = {};

    // ---------------- Vendor fields ----------------
    setIfPresent(update, vendor, "vendorName", "vendor.vendorName");
    setIfPresent(update, vendor, "mobileNumber", "vendor.mobileNumber");
    setIfPresent(update, vendor, "dateOfBirth", "vendor.dateOfBirth");
    setIfPresent(update, vendor, "yearOfWorking", "vendor.yearOfWorking");
    setIfPresent(update, vendor, "city", "vendor.city");
    setIfPresent(update, vendor, "serviceType", "vendor.serviceType");
    setIfPresent(update, vendor, "capacity", "vendor.capacity");
    setIfPresent(update, vendor, "serviceArea", "vendor.serviceArea");

    // ---------------- Documents fields ----------------
    setIfPresent(update, documents, "aadhaarNumber", "documents.aadhaarNumber");
    setIfPresent(update, documents, "panNumber", "documents.panNumber");

    // ---------------- Bank fields ----------------
    setIfPresent(
      update,
      bankDetails,
      "accountNumber",
      "bankDetails.accountNumber",
    );
    setIfPresent(update, bankDetails, "ifscCode", "bankDetails.ifscCode");
    setIfPresent(update, bankDetails, "bankName", "bankDetails.bankName");
    setIfPresent(update, bankDetails, "holderName", "bankDetails.holderName");
    setIfPresent(update, bankDetails, "accountType", "bankDetails.accountType");
    setIfPresent(update, bankDetails, "gstNumber", "bankDetails.gstNumber");

    // ---------------- Address fields ----------------
    setIfPresent(update, address, "location", "address.location");
    setIfPresent(update, address, "latitude", "address.latitude", Number);
    setIfPresent(update, address, "longitude", "address.longitude", Number);

    // ---------------- Files (only if uploaded) ----------------
    // Multer field names must match your frontend: profileImage, aadhaarfrontImage, ...
    const files = req.files || {};

    if (files.profileImage?.[0]) {
      update["vendor.profileImage"] = files.profileImage[0].path;
    }
    if (files.aadhaarfrontImage?.[0]) {
      update["documents.aadhaarfrontImage"] = files.aadhaarfrontImage[0].path;
    }
    if (files.aadhaarbackImage?.[0]) {
      update["documents.aadhaarbackImage"] = files.aadhaarbackImage[0].path;
    }
    if (files.panImage?.[0]) {
      update["documents.panImage"] = files.panImage[0].path;
    }
    if (files.otherPolicy?.[0]) {
      update["documents.otherPolicy"] = files.otherPolicy[0].path;
    }

    // If nothing to update, return existing safely
    if (Object.keys(update).length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No changes detected",
        vendor: existing,
      });
    }

    const updated = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      { $set: update },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      status: "success",
      message: "Vendor updated successfully",
      vendor: updated,
    });
  } catch (err) {
    console.error("updateVendor error:", err);
    return res.status(500).json({
      status: "fail",
      message: "Server error",
      error: err.message,
    });
  }
};

exports.addTeamMember = async (req, res) => {
  try {
    const vendorId = req.body.vendorId;

    if (!vendorId || !mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({ message: "Valid vendorId is required" });
    }

    // ✅ safer parse (won't crash)
    const member = safeJson(req.body.member);
    const documents = safeJson(req.body.documents);
    const bankDetails = safeJson(req.body.bankDetails);
    const addressDetails = safeJson(req.body.address);

    const profileImageUrl = req.files?.profileImage?.[0]?.path || "";

    const aadhaarfrontImageUrl = req.files?.aadhaarfrontImage?.[0]?.path || "";
    const aadhaarbackImageUrl = req.files?.aadhaarbackImage?.[0]?.path || "";

    // ✅ backward compatibility: if FE sends "aadhaarImage" only
    const aadhaarSingleUrl = req.files?.aadhaarImage?.[0]?.path || "";
    const finalAadhaarFront = aadhaarfrontImageUrl || aadhaarSingleUrl || "";
    const finalAadhaarBack = aadhaarbackImageUrl || aadhaarSingleUrl || "";

    const panImageUrl = req.files?.panImage?.[0]?.path || "";
    const otherPolicyUrl = req.files?.otherPolicy?.[0]?.path || "";

    const lat = parseFloat(addressDetails.latitude);
    const lng = parseFloat(addressDetails.longitude);

    const teamMember = {
      name: member.name || "",
      mobileNumber: member.mobileNumber || "",
      profileImage: profileImageUrl,
      dateOfBirth: member.dateOfBirth || "",
      city: member.city || "",
      serviceType: member.serviceType || "",
      serviceArea: member.serviceArea || "",

      documents: {
        aadhaarNumber: documents.aadhaarNumber || "",
        panNumber: documents.panNumber || "",
        aadhaarfrontImage: finalAadhaarFront,
        aadhaarbackImage: finalAadhaarBack,
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
        latitude: Number.isNaN(lat) ? 0 : lat,
        longitude: Number.isNaN(lng) ? 0 : lng,
      },

      // ✅ IMPORTANT: always empty at creation
      markedLeaves: [],
    };

    const vendor = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      { $push: { team: teamMember } },
      { new: true },
    );

    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    return res.status(200).json({
      message: "Team member added",
      team: vendor.team,
    });
  } catch (err) {
    console.error("addTeamMember error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

exports.updateTeamMember = async (req, res) => {
  try {
    const { vendorId, memberId } = req.body;

    if (!vendorId || !mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({ message: "Valid vendorId is required" });
    }
    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ message: "Valid memberId is required" });
    }

    // ✅ safer parse
    const member = safeJson(req.body.member);
    const documents = safeJson(req.body.documents);
    const bankDetails = safeJson(req.body.bankDetails);
    const addressDetails = safeJson(req.body.address);

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const teamMember = vendor.team.id(memberId);
    if (!teamMember) {
      return res.status(404).json({ message: "Team member not found" });
    }

    // Ensure nested objects exist
    teamMember.documents = teamMember.documents || {};
    teamMember.bankDetails = teamMember.bankDetails || {};
    teamMember.address = teamMember.address || {};

    // ✅ Update member fields only if key was sent AND not empty string
    if (hasOwn(member, "name") && !isIgnorable(member.name))
      teamMember.name = member.name;
    if (hasOwn(member, "mobileNumber") && !isIgnorable(member.mobileNumber))
      teamMember.mobileNumber = member.mobileNumber;
    if (hasOwn(member, "dateOfBirth") && !isIgnorable(member.dateOfBirth))
      teamMember.dateOfBirth = member.dateOfBirth;
    if (hasOwn(member, "city") && !isIgnorable(member.city))
      teamMember.city = member.city;
    if (hasOwn(member, "serviceType") && !isIgnorable(member.serviceType))
      teamMember.serviceType = member.serviceType;
    if (hasOwn(member, "serviceArea") && !isIgnorable(member.serviceArea))
      teamMember.serviceArea = member.serviceArea;

    // ✅ Images: only if uploaded
    const profileImageUrl = req.files?.profileImage?.[0]?.path;
    if (profileImageUrl) teamMember.profileImage = profileImageUrl;

    // ✅ Documents text fields (ignore "")
    if (
      hasOwn(documents, "aadhaarNumber") &&
      !isIgnorable(documents.aadhaarNumber)
    ) {
      teamMember.documents.aadhaarNumber = documents.aadhaarNumber;
    }
    if (hasOwn(documents, "panNumber") && !isIgnorable(documents.panNumber)) {
      teamMember.documents.panNumber = documents.panNumber;
    }

    // ✅ Documents images (only if uploaded)
    const aadhaarfrontImageUrl = req.files?.aadhaarfrontImage?.[0]?.path;
    const aadhaarbackImageUrl = req.files?.aadhaarbackImage?.[0]?.path;
    const panImageUrl = req.files?.panImage?.[0]?.path;
    const otherPolicyUrl = req.files?.otherPolicy?.[0]?.path;

    if (aadhaarfrontImageUrl)
      teamMember.documents.aadhaarfrontImage = aadhaarfrontImageUrl;
    if (aadhaarbackImageUrl)
      teamMember.documents.aadhaarbackImage = aadhaarbackImageUrl;

    // ✅ backward compat: if FE sends "aadhaarImage" only
    const aadhaarSingleUrl = req.files?.aadhaarImage?.[0]?.path;
    if (aadhaarSingleUrl && !aadhaarfrontImageUrl && !aadhaarbackImageUrl) {
      teamMember.documents.aadhaarfrontImage = aadhaarSingleUrl;
      teamMember.documents.aadhaarbackImage = aadhaarSingleUrl;
    }

    if (panImageUrl) teamMember.documents.panImage = panImageUrl;
    if (otherPolicyUrl) teamMember.documents.otherPolicy = otherPolicyUrl;

    // ✅ Bank details (ignore "")
    if (
      hasOwn(bankDetails, "accountNumber") &&
      !isIgnorable(bankDetails.accountNumber)
    )
      teamMember.bankDetails.accountNumber = bankDetails.accountNumber;
    if (hasOwn(bankDetails, "ifscCode") && !isIgnorable(bankDetails.ifscCode))
      teamMember.bankDetails.ifscCode = bankDetails.ifscCode;
    if (hasOwn(bankDetails, "bankName") && !isIgnorable(bankDetails.bankName))
      teamMember.bankDetails.bankName = bankDetails.bankName;
    if (
      hasOwn(bankDetails, "branchName") &&
      !isIgnorable(bankDetails.branchName)
    )
      teamMember.bankDetails.branchName = bankDetails.branchName;
    if (
      hasOwn(bankDetails, "holderName") &&
      !isIgnorable(bankDetails.holderName)
    )
      teamMember.bankDetails.holderName = bankDetails.holderName;
    if (
      hasOwn(bankDetails, "accountType") &&
      !isIgnorable(bankDetails.accountType)
    )
      teamMember.bankDetails.accountType = bankDetails.accountType;
    if (hasOwn(bankDetails, "gstNumber") && !isIgnorable(bankDetails.gstNumber))
      teamMember.bankDetails.gstNumber = bankDetails.gstNumber;

    // ✅ Address (ignore "" and don't force 0)
    if (
      hasOwn(addressDetails, "location") &&
      !isIgnorable(addressDetails.location)
    ) {
      teamMember.address.location = addressDetails.location;
    }
    if (
      hasOwn(addressDetails, "latitude") &&
      !isIgnorable(addressDetails.latitude)
    ) {
      const lat = parseFloat(addressDetails.latitude);
      if (!Number.isNaN(lat)) teamMember.address.latitude = lat;
    }
    if (
      hasOwn(addressDetails, "longitude") &&
      !isIgnorable(addressDetails.longitude)
    ) {
      const lng = parseFloat(addressDetails.longitude);
      if (!Number.isNaN(lng)) teamMember.address.longitude = lng;
    }

    // ✅ IMPORTANT: do NOT touch markedLeaves here (so it stays as-is)

    vendor.markModified("team");
    await vendor.save();

    return res.status(200).json({
      message: "Team member updated",
      team: vendor.team,
    });
  } catch (err) {
    console.error("updateTeamMember error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
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
      { new: true, runValidators: true },
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
      { new: true },
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
        projectDays.includes(leaveDate),
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

// exports.checkVendorAvailabilityRange = async (req, res) => {
//   try {
//     const { vendorId } = req.params;
//     const { startDate, endDate, daysRequired } = req.query;

//     if (!startDate || !endDate || !daysRequired) {
//       return res.status(400).json({
//         success: false,
//         message: "startDate, endDate and daysRequired are required",
//       });
//     }

//     const vendor = await vendorAuthSchema.findById(vendorId).lean();
//     if (!vendor) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Vendor not found" });
//     }

//     const results = {};
//     const requiredMembers = 2;
//     const capacity = vendor.vendor.capacity;

//     let current = moment(startDate);
//     const last = moment(endDate);

//     while (current.isSameOrBefore(last)) {
//       const projectDays = [];
//       for (let i = 0; i < Number(daysRequired); i++) {
//         projectDays.push(current.clone().add(i, "days").format("YYYY-MM-DD"));
//       }

//       const availableMembers = vendor.team.filter((member) => {
//         return !member.markedLeaves?.some((leaveDate) =>
//           projectDays.includes(leaveDate),
//         );
//       });

//       const isAvailable = availableMembers.length >= requiredMembers;

//       results[current.format("YYYY-MM-DD")] = {
//         canStart: isAvailable,
//         availableMembers: availableMembers.map((m) => ({
//           _id: m._id,
//           name: m.name,
//           markedLeaves: m.markedLeaves || [],
//         })),
//       };

//       current = current.add(1, "day");
//     }

//     return res.json({
//       success: true,
//       vendorId,
//       daysRequired: Number(daysRequired),
//       capacity,
//       availability: results, // keyed by date
//     });
//   } catch (err) {
//     console.error("Error checking availability:", err);
//     res
//       .status(500)
//       .json({ success: false, message: "Server error", error: err.message });
//   }
// };

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
      // find old bookings that overlap these project days
      const existingBookings = await userBooking
        .find({
          "assignedProfessional.professionalId": vendorId,
          "assignedProfessional.hiring.status": "active",
          "assignedProfessional.hiring.projectDate": { $in: projectDays },
        })
        .lean();

      const busyMemberIds = new Set();
      existingBookings.forEach((booking) => {
        const hiring = booking.assignedProfessional?.hiring;
        if (!hiring) return;

        const projectDates = hiring.projectDate || [];
        const overlaps = projectDates.some((d) => projectDays.includes(d));
        if (!overlaps) return;

        (hiring.teamMember || []).forEach((tm) => {
          busyMemberIds.add(String(tm.memberId));
        });
      });

      // console.log("Checking availability for projectDays:", projectDays);

      // console.log("Existing bookings count:", existingBookings.length);
      // existingBookings.forEach(b => {
      //   console.log("Booking projectDate:", b.assignedProfessional?.hiring?.projectDate);
      //   console.log("Booking teamMember:", b.assignedProfessional?.hiring?.teamMember);
      // });

      // console.log("busyMemberIds:", Array.from(busyMemberIds));
      const availableMembers = vendor.team.filter((member) => {
        const memberId = String(member._id);

        const hasLeaveOnProjectDays = member.markedLeaves?.some((leaveDate) =>
          projectDays.includes(leaveDate),
        );
        if (hasLeaveOnProjectDays) return false;

        if (busyMemberIds.has(memberId)) return false;

        return true;
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
    const vendor = await vendorAuthSchema.findById({
      _id: req.params.id,
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
    const page = Number.parseInt(req.query.page, 10);
    const limit = Number.parseInt(req.query.limit, 10);

    // ✅ No pagination → return all (latest first)
    if (!page || !limit) {
      const vendor = await vendorAuthSchema
        .find()
        .sort({ createdAt: -1, _id: -1 });

      if (!vendor.length) {
        return res.status(404).json({ message: "Vendor Not Found" });
      }

      return res.status(200).json({
        status: true,
        message: "Vendor Found",
        vendor,
        pagination: null,
      });
    }

    // ✅ Pagination enabled (latest first)
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const skip = (safePage - 1) * safeLimit;

    const [vendor, total] = await Promise.all([
      vendorAuthSchema
        .find()
        .sort({ createdAt: -1, _id: -1 }) // ✅ IMPORTANT: sort before skip/limit
        .skip(skip)
        .limit(safeLimit),
      vendorAuthSchema.countDocuments(),
    ]);

    if (!vendor.length) {
      return res.status(404).json({ message: "Vendor Not Found" });
    }

    return res.status(200).json({
      status: true,
      message: "Vendor Found",
      vendor,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    console.error("getAllVendors error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};


// ... (Other existing endpoints like loginWithMobile, verifyOTP, etc. remain unchanged)
// ✅ ADD COIN
exports.addCoin = async (req, res) => {
  try {
    const { vendorId, coins } = req.body;

    if (!vendorId || coins === undefined) {
      return res.status(400).json({
        success: false,
        message: "vendorId and coins are required",
      });
    }

    const coinVal = Number(coins);
    if (!Number.isFinite(coinVal) || coinVal <= 0) {
      return res.status(400).json({
        success: false,
        message: "coins must be a valid number > 0",
      });
    }

    // 1) First add coins to wallet + overallCoinPurchased
    const updatedVendor = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      {
        $inc: {
          "wallet.coins": coinVal,
          "wallet.overallCoinPurchased": coinVal,
        },
      },
      { new: true },
    );

    if (!updatedVendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    // 2) Now check updated wallet.coins and set canRespondLead accordingly
    const updatedCoins = Number(updatedVendor?.wallet?.coins || 0);
    const canRespondLead = updatedCoins > 100;

    // 3) Update canRespondLead based on threshold
    //    (Only if it needs change, but safe to set anyway)
    updatedVendor.wallet.canRespondLead = canRespondLead;
    await updatedVendor.save();

    return res.status(200).json({
      success: true,
      message: "Coins added successfully",
      wallet: updatedVendor.wallet,
    });
  } catch (error) {
    console.error("AddCoin error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ✅ REDUCE COIN
exports.reduceCoin = async (req, res) => {
  try {
    const { vendorId, coins } = req.body;

    if (!vendorId || coins === undefined) {
      return res.status(400).json({
        success: false,
        message: "vendorId and coins are required",
      });
    }

    const coinVal = Number(coins);
    if (!Number.isFinite(coinVal) || coinVal <= 0) {
      return res.status(400).json({
        success: false,
        message: "coins must be a valid number > 0",
      });
    }

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    const currentCoins = Number(vendor?.wallet?.coins || 0);
    if (currentCoins < coinVal) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coins",
      });
    }

    // ✅ Reduce from wallet.coins AND overallCoinPurchased
    // (Don't allow overallCoinPurchased to go negative)
    const currentOverall = Number(vendor?.wallet?.overallCoinPurchased || 0);

    vendor.wallet.coins = currentCoins - coinVal;
    vendor.wallet.overallCoinPurchased = Math.max(0, currentOverall - coinVal);

    // ✅ After reduction, set canRespondLead based on updated wallet.coins
    vendor.wallet.canRespondLead = vendor.wallet.coins > 100;

    await vendor.save();

    return res.status(200).json({
      success: true,
      message: "Coins reduced successfully",
      wallet: vendor.wallet,
    });
  } catch (error) {
    console.error("ReduceCoin error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.bulkUploadVendors = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Excel file is required" });
    }

    // 1️⃣ Read Excel
    const workbook = XLSX.read(req.file.buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (!rows.length) {
      return res.status(400).json({ message: "Excel is empty" });
    }

    // 2️⃣ Group by vendor mobile
    const vendorMap = {};

    for (const row of rows) {
      const vendorKey = row.vendorMobile;

      if (!vendorKey) continue;

      // Create vendor entry if not exists
      if (!vendorMap[vendorKey]) {
        vendorMap[vendorKey] = {
          vendor: {
            vendorName: row.vendorName,
            mobileNumber: row.vendorMobile,
            dateOfBirth: row.vendorDOB,
            yearOfWorking: row.vendorExperience,
            city: row.city,
            serviceType: row.serviceType,
            capacity: row.capacity || 1,
            serviceArea: row.serviceArea,
          },
          documents: {
            aadhaarNumber: row.vendorAadhaar,
            panNumber: row.vendorPAN,
          },
          bankDetails: {
            accountNumber: row.accountNumber,
            ifscCode: row.ifscCode,
            bankName: row.bankName,
            holderName: row.vendorName,
            accountType: row.accountType || "Savings",
          },
          address: {
            location: row.serviceArea,
            latitude: Number(row.vendorLat),
            longitude: Number(row.vendorLng),
          },
          team: [],
        };
      }

      // 3️⃣ Add team member (if exists)
      if (row.memberName) {
        vendorMap[vendorKey].team.push({
          name: row.memberName,
          mobileNumber: row.memberMobile,
          dateOfBirth: row.memberDOB,
          city: row.city,
          serviceType: row.serviceType,
          serviceArea: row.serviceArea,
          documents: {
            aadhaarNumber: row.memberAadhaar,
            panNumber: row.memberPAN,
          },
          bankDetails: {
            accountNumber: row.memberAccountNumber,
            ifscCode: row.ifscCode,
            bankName: row.bankName,
            holderName: row.memberName,
            accountType: "Savings",
          },
          address: {
            location: row.serviceArea,
            latitude: Number(row.memberLat),
            longitude: Number(row.memberLng),
          },
          markedLeaves: [],
        });
      }
    }

    // 4️⃣ Save vendors + team
    const createdVendors = [];

    for (const data of Object.values(vendorMap)) {
      const vendor = await Vendor.create({
        vendor: data.vendor,
        documents: data.documents,
        bankDetails: data.bankDetails,
        address: data.address,
        team: data.team,
        wallet: { coins: 0 },
      });

      createdVendors.push(vendor._id);
    }

    return res.status(201).json({
      message: "Bulk vendors uploaded successfully",
      totalVendors: createdVendors.length,
    });
  } catch (error) {
    console.error("Bulk upload error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ---------------------------------------
   Utils
--------------------------------------- */
function timeToMinutes(timeStr) {
  const [time, period] = timeStr.split(" ");
  let [h, m] = time.split(":").map(Number);

  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;

  return h * 60 + m;
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

exports.getAvailableVendors = async (req, res) => {
  try {
    const {
      lat,
      lng,
      slotDate,
      slotTime,
      serviceType,
      requiredTeamMembers = 1,
    } = req.body;

    if (!lat || !lng || !slotDate || !slotTime || !serviceType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid serviceType",
      });
    }

    const normalizedDate = slotDate.split("T")[0];
    const slotMinutes = timeToMinutes(slotTime);

    /* ================= SERVICE TYPE SAFE MATCH ================= */
    const serviceRegex =
      serviceType === "deep_cleaning"
        ? /deep\s*cleaning/i
        : /house\s*painting/i;

    /* ================= FETCH VENDORS ================= */
    const vendors = await Vendor.find({
      // activeStatus: true,
      "vendor.serviceType": serviceRegex,
    }).lean();

    /* ================= LOCATION FILTER ================= */
    const locationFiltered = vendors.filter((v) => {
      if (!v.address?.latitude || !v.address?.longitude) return false;

      return (
        getDistanceInMeters(
          lat,
          lng,
          v.address.latitude,
          v.address.longitude,
        ) <= 5000
      );
    });

    if (!locationFiltered.length) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const vendorIds = locationFiltered.map((v) => v._id.toString());

    /* ================= SLOT CONFLICT ================= */
    const bookings = await userBooking
      .find({
        isEnquiry: false,
        "assignedProfessional.professionalId": { $in: vendorIds },
        "selectedSlot.slotDate": normalizedDate,
        "bookingDetails.status": {
          $nin: ["Cancelled", "Admin Cancelled", "Customer Cancelled"],
        },
      })
      .lean();

    const blockedVendors = new Set();

    for (const booking of bookings) {
      if (!booking.selectedSlot?.slotTime) continue;

      const start = timeToMinutes(booking.selectedSlot.slotTime);
      const duration = Array.isArray(booking.service)
        ? booking.service.reduce((s, x) => s + (x.duration || 120), 0)
        : 120;

      if (slotMinutes >= start && slotMinutes < start + duration) {
        blockedVendors.add(booking.assignedProfessional.professionalId);
      }
    }

    const slotAvailable = locationFiltered.filter(
      (v) => !blockedVendors.has(v._id.toString()),
    );

    /* ================= TEAM VALIDATION ================= */
    const finalAvailable = [];

    for (const vendor of slotAvailable) {
      if (serviceType === "house_painting") {
        finalAvailable.push(vendor);
        continue;
      }

      const team = vendor.team || [];
      const availableCount = team.filter(
        (m) => !m.markedLeaves?.includes(normalizedDate),
      ).length;

      if (availableCount >= requiredTeamMembers) {
        finalAvailable.push(vendor);
      }
    }

    return res.json({
      success: true,
      count: finalAvailable.length,
      data: finalAvailable,
    });
  } catch (err) {
    console.error("Available vendor error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.getOverallCoinPurchasedTotal = async (req, res) => {
  try {
    const agg = await vendorAuthSchema.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$wallet.overallCoinPurchased", 0] } },
        },
      },
    ]);

    const total = agg?.[0]?.total || 0;

    return res.json({
      success: true,
      total,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message:
        err.message || "Failed to calculate overall coin purchased total",
    });
  }
};
