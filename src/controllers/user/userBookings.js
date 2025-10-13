const UserBooking = require("../../models/user/userBookings");
const Quote = require("../../models/measurement/Quote");
const moment = require("moment");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const dayjs = require("dayjs");
const mongoose = require("mongoose");
const { unlockRelatedQuotesByHiring } = require("../../helpers/quotes");

function generateOTP() {
  return crypto.randomInt(1000, 10000);
  // return Math.floor(1000 + Math.random() * 10000).toString();
}
const ymdLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

// const mapStatusToInvite = (status) => {
//   switch (status) {
//     case "Confirmed":
//       return "accepted";
//     case "Ongoing":
//       return "started";
//     case "Completed":
//       return "completed";
//     case "Customer Unreachable":
//       return "unreachable";
//     case "Customer Cancelled":
//       return "customer_cancelled";
//     // return "vendor_cancelled";
//     // if vendor explicitly declines (no booking status change), you’ll pass status='Declined' from UI
//     case "Declined":
//       return "declined";
//     default:
//       return "pending";
//   }
// };

function mapStatusToInvite(status, cancelledByFromClient) {
  switch (status) {
    case "Confirmed":
      return { responseStatus: "accepted" };

    case "Survey Ongoing":
      return { responseStatus: "started" };

    case "Survey Completed":
      return { responseStatus: "survey completed" };

    case "Customer Unreachable":
      return { responseStatus: "unreachable" };

    case "Customer Cancelled": {
      // keep your current enum; or use "vendor_cancelled" if you add it later
      const allowed = ["internal", "external"];
      const cancelledBy = allowed.includes(cancelledByFromClient)
        ? cancelledByFromClient
        : "internal"; // safer default when called from vendor app
      return {
        responseStatus: "customer_cancelled",
        cancelledBy,
        cancelledAt: new Date(),
      };
    }

    case "Declined":
      return { responseStatus: "declined" };

    default:
      return { responseStatus: "pending" };
  }
}

function buildAutoCancelAtUTC(yyyyMmDd) {
  const [Y, M, D] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, 2, 0, 0)); // 07:30 IST == 02:00 UTC
}

function computeFinalTotal(details) {
  // If already locked, use it
  if (Number.isFinite(details.finalTotal)) return Number(details.finalTotal);

  // Prefer explicit state
  const state =
    details.priceApprovalState ||
    (details.priceApprovalStatus
      ? "approved"
      : details.hasPriceUpdated
      ? "pending"
      : "approved");

  if (state === "approved" && Number.isFinite(details.newTotal)) {
    return Number(details.newTotal);
  }
  // Rejected or no edit → fall back to original bookingAmount
  return Number(details.bookingAmount || 0);
}

function setPaymentStatus(details, finalTotal) {
  const paid = Number(details.paidAmount || 0);
  if (paid >= finalTotal) {
    details.paymentStatus = "Paid";
    return;
  }
  const ratio = finalTotal > 0 ? paid / finalTotal : 0;
  details.paymentStatus =
    ratio >= 0.799 ? "Partially Completed" : "Partial Payment";
}

function syncDerivedFields(details, finalTotal) {
  const paid = Number(details.paidAmount || 0);
  details.amountYetToPay = Math.max(0, Number(finalTotal) - paid);

  // Keep legacy field in sync (so existing UI using currentTotalAmount won't break)
  details.currentTotalAmount = Number(finalTotal);
}

function roundMoney(n) {
  // choose your policy: Math.ceil/Math.round to rupees
  return Math.round(Number(n || 0));
}

function ensureFirstMilestone(details) {
  if (!details.firstMilestone) details.firstMilestone = {};
  const fm = details.firstMilestone;

  if (fm.baseTotal == null) {
    // choose baseline: if user hasn't paid yet, you might choose details.finalTotal
    // but in your flow you want ORIGINAL for the 40% hurdle:
    const base = Number(
      details.bookingAmount ||
        details.finalTotal ||
        details.currentTotalAmount ||
        0
    );
    fm.baseTotal = base;
    fm.requiredAmount = roundMoney(base * 0.4);
  }

  // mark completed if already satisfied
  const paid = Number(details.paidAmount || 0);
  if (!fm.completedAt && paid >= Number(fm.requiredAmount || 0)) {
    fm.completedAt = new Date();
  }
  return fm;
}

function hasCompletedFirstMilestone(details) {
  const fm = ensureFirstMilestone(details);
  return Boolean(fm.completedAt);
}

exports.createBooking = async (req, res) => {
  try {
    const {
      customer,
      service,
      bookingDetails,
      assignedProfessional,
      address,
      selectedSlot,
      isEnquiry,
      formName,
    } = req.body;

    if (!service || !Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ message: "Service list cannot be empty." });
    }

    let coords = [0, 0];

    if (
      address.location &&
      Array.isArray(address.location.coordinates) &&
      address.location.coordinates.length === 2 &&
      typeof address.location.coordinates[0] === "number" &&
      typeof address.location.coordinates[1] === "number"
    ) {
      coords = address.location.coordinates;
    } else {
      throw new Error("Invalid or missing address.location.coordinates");
    }

    const booking = new UserBooking({
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
      },
      isEnquiry,
      service: service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: s.price,
        quantity: s.quantity,
        teamMembersRequired: s.teamMembersRequired,
      })),

      bookingDetails: {
        bookingDate: bookingDetails.bookingDate,
        bookingTime: bookingDetails.bookingTime,
        status: bookingDetails.status || "Pending",
        paymentMethod: bookingDetails.paymentMethod || "Cash",
        paymentStatus: bookingDetails.paymentStatus || "Unpaid",
        bookingAmount: bookingDetails.bookingAmount,
        siteVisitCharges: bookingDetails.bookingAmount,
        paidAmount: bookingDetails.paidAmount || 0,
        amountYetToPay: bookingDetails.amountYetToPay,
        otp: generateOTP(),
      },
      assignedProfessional: assignedProfessional
        ? {
            professionalId: assignedProfessional.professionalId,
            name: assignedProfessional.name,
            phone: assignedProfessional.phone,
          }
        : undefined,
      address: {
        houseFlatNumber: address.houseFlatNumber,
        streetArea: address.streetArea,
        landMark: address.landMark,
        location: {
          type: "Point",
          coordinates: coords,
        },
      },

      selectedSlot: {
        slotDate: selectedSlot.slotDate,
        slotTime: selectedSlot.slotTime,
      },
      formName,
    });

    await booking.save();

    res.status(201).json({ message: "Booking created successfully", booking });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const bookings = await UserBooking.find().sort({ createdAt: -1 });
    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllLeadsBookings = async (req, res) => {
  try {
    const bookings = await UserBooking.find({ isEnquiry: false }).sort({
      createdAt: -1,
    });
    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllEnquiries = async (req, res) => {
  try {
    const bookings = await UserBooking.find({ isEnquiry: true }).sort({
      createdAt: -1,
    });
    res.status(200).json({ allEnquies: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingsByBookingId = async (req, res) => {
  try {
    const booking = await UserBooking.findById({ _id: req.params.id });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ booking });
  } catch (error) {
    console.error("Error fetching booking by bookingId:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingsByCustomerId = async (req, res) => {
  try {
    const { customerId } = req.params;

    const bookings = await UserBooking.find({
      "customer.customerId": customerId,
    }).sort({ createdAt: -1 });

    if (!bookings || bookings.length === 0) {
      return res
        .status(404)
        .json({ message: "No bookings found for this customer" });
    }

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings by customerId:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingForNearByVendorsDeepCleaning = async (req, res) => {
  try {
    const { lat, long } = req.params;
    if (!lat || !long) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const now = new Date();

    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);

    const dayAfterTomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)
    );
    const dayAfterTomorrowStr = dayAfterTomorrow.toISOString().slice(0, 10);

    const nearbyBookings = await UserBooking.find({
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000,
        },
      },
      isEnquiry: false,
      "service.category": "Deep Cleaning",
      "bookingDetails.status": "Pending",
      "selectedSlot.slotDate": {
        $gte: todayStart,
        $lt: dayAfterTomorrowStr,
      },
    }).sort({ createdAt: -1 });

    const nowMoment = moment();
    const filteredBookings = nearbyBookings.filter((booking) => {
      const slotDateObj = booking.selectedSlot?.slotDate;
      const slotTimeStr = booking.selectedSlot?.slotTime;
      if (!slotDateObj || !slotTimeStr) return false;

      const slotDateMoment = moment(slotDateObj);
      const slotDateStr = slotDateMoment.format("YYYY-MM-DD");
      const slotDateTime = moment(
        `${slotDateStr} ${slotTimeStr}`,
        "YYYY-MM-DD hh:mm A"
      );

      // Today: keep only future-times
      if (slotDateMoment.isSame(nowMoment, "day")) {
        return slotDateTime.isAfter(nowMoment);
      }
      // Tomorrow: keep all
      if (slotDateMoment.isSame(nowMoment.clone().add(1, "day"), "day")) {
        return true;
      }
      // Should not reach here due to date range, but just in case
      return false;
    });

    if (!filteredBookings.length) {
      return res
        .status(404)
        .json({ message: "No bookings found near this location" });
    }

    res.status(200).json({ bookings: filteredBookings });
  } catch (error) {
    console.error("Error finding nearby bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getVendorPerformanceMetricsDeepCleaning = async (req, res) => {
  try {
    const { vendorId, lat, long, timeframe } = req.params;

    if (!vendorId || !lat || !long || !timeframe) {
      return res.status(400).json({
        message: "Vendor ID, Latitude, Longitude, and Timeframe are required",
      });
    }

    const baseQuery = {
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000,
        },
      },
      "service.category": "Deep Cleaning",
      isEnquiry: false,
    };

    let query = { ...baseQuery };

    if (timeframe === "month") {
      const startOfMonth = moment().startOf("month").toDate();
      query.createdDate = { $gte: startOfMonth };
    }

    let bookingsQuery = UserBooking.find(query);

    if (timeframe === "last") {
      bookingsQuery = bookingsQuery.sort({ createdDate: -1 }).limit(50);
    }

    const bookings = await bookingsQuery.exec();
    let totalLeads = bookings.length; // count ALL geo-filtered leads shown to vendor
    let respondedLeads = 0;
    let cancelledLeads = 0;
    let totalGsv = 0;

    if (!bookings.length) {
      return res.status(200).json({
        responseRate: 0,
        cancellationRate: 0,
        averageGsv: 0,
        totalLeads: 0,
        respondedLeads: 0,
        cancelledLeads: 0,
        timeframe: timeframe,
      });
    }

    for (const booking of bookings) {
      // GSV of every lead (not just responded)
      const bookingGsv = (booking.service || []).reduce(
        (sum, s) => sum + (s.price || 0) * (s.quantity || 0),
        0
      );
      totalGsv += bookingGsv;

      const vendorInvitation = (booking.invitedVendors || []).find(
        (v) => String(v.professionalId) === String(vendorId)
      );
      if (!vendorInvitation) continue;

      // considered "responded" = accepted (or your special “customer_cancelled” flag)
      if (
        vendorInvitation.responseStatus === "accepted" ||
        vendorInvitation.responseStatus === "customer_cancelled"
      ) {
        respondedLeads += 1;
      }

      // “cancelled within 3 hours” logic
      if (
        vendorInvitation.responseStatus === "customer_cancelled" &&
        vendorInvitation.cancelledAt &&
        vendorInvitation.cancelledBy === "internal"
      ) {
        const bookedSlot = moment(
          `${booking.selectedSlot.slotDate} ${booking.selectedSlot.slotTime}`,
          "YYYY-MM-DD hh:mm A"
        );
        const hoursDiff = Math.abs(
          bookedSlot.diff(moment(vendorInvitation.cancelledAt), "hours", true)
        );
        if (hoursDiff <= 3) cancelledLeads += 1;
      }
    }

    const responseRate =
      totalLeads > 0 ? (respondedLeads / totalLeads) * 100 : 0;

    const cancellationRate =
      respondedLeads > 0 ? (cancelledLeads / respondedLeads) * 100 : 0;

    const averageGsv = totalLeads > 0 ? totalGsv / totalLeads : 0;

    res.status(200).json({
      responseRate: parseFloat(responseRate.toFixed(2)),
      cancellationRate: parseFloat(cancellationRate.toFixed(2)),
      averageGsv: parseFloat(averageGsv.toFixed(2)),
      totalLeads,
      respondedLeads,
      cancelledLeads,
      timeframe: timeframe,
    });
  } catch (error) {
    console.error("Error calculating vendor performance metrics:", error);
    res.status(500).json({ message: "Server error calculating performance" });
  }
};

exports.getBookingForNearByVendorsHousePainting = async (req, res) => {
  try {
    const { lat, long } = req.params;
    if (!lat || !long) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const now = new Date();
    const todayStr = ymdLocal(now);
    const tomorrowStr = ymdLocal(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    );

    const nearbyBookings = await UserBooking.find({
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000, // meters
        },
      },
      isEnquiry: false,
      "service.category": "House Painting", // matches any array element's category
      "bookingDetails.status": "Pending",
      "selectedSlot.slotDate": { $gte: todayStr, $lte: tomorrowStr }, // today & tomorrow inclusive
    }).sort({ createdAt: -1 });

    // Keep future times for today, keep all for tomorrow
    const nowMoment = moment();
    const filteredBookings = nearbyBookings.filter((booking) => {
      const slotDateStr = booking.selectedSlot?.slotDate; // "YYYY-MM-DD"
      const slotTimeStr = booking.selectedSlot?.slotTime; // "hh:mm AM/PM"
      if (!slotDateStr || !slotTimeStr) return false;

      const slotDateMoment = moment(slotDateStr, "YYYY-MM-DD");
      const slotDateTime = moment(
        `${slotDateStr} ${slotTimeStr}`,
        "YYYY-MM-DD hh:mm A"
      );

      if (slotDateMoment.isSame(nowMoment, "day")) {
        return slotDateTime.isAfter(nowMoment); // only future times today
      }
      if (slotDateMoment.isSame(nowMoment.clone().add(1, "day"), "day")) {
        return true; // keep all tomorrow
      }
      return false;
    });

    if (!filteredBookings.length) {
      return res
        .status(404)
        .json({ message: "No bookings found near this location" });
    }

    res.status(200).json({ bookings: filteredBookings });
  } catch (error) {
    console.error("Error finding nearby bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.respondConfirmJobVendorLine = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional, vendorId, cancelledBy } =
      req.body;
    if (!bookingId)
      return res.status(400).json({ message: "bookingId is required" });
    if (!vendorId)
      return res
        .status(400)
        .json({ message: "vendorId (professionalId) is required" });

    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // 1) ensure invite exists
    await UserBooking.updateOne(
      {
        _id: bookingId,
        "invitedVendors.professionalId": { $ne: String(vendorId) },
      },
      {
        $addToSet: {
          invitedVendors: {
            professionalId: String(vendorId),
            invitedAt: new Date(),
            responseStatus: "pending",
          },
        },
      }
    );

    // 2) build $set from the patch object (DO NOT assign the object to the string path)
    const patch = mapStatusToInvite(status, cancelledBy);
    const setOps = {
      ...updateFields,
      "invitedVendors.$[iv].respondedAt": new Date(),
    };
    if (patch.responseStatus)
      setOps["invitedVendors.$[iv].responseStatus"] = patch.responseStatus;
    if (patch.cancelledAt)
      setOps["invitedVendors.$[iv].cancelledAt"] = patch.cancelledAt;
    if (patch.cancelledBy)
      setOps["invitedVendors.$[iv].cancelledBy"] = patch.cancelledBy;

    const result = await UserBooking.findOneAndUpdate(
      { _id: bookingId },
      { $set: setOps },
      {
        new: true,
        runValidators: true,
        arrayFilters: [{ "iv.professionalId": String(vendorId) }],
      }
    );

    if (!result) return res.status(404).json({ message: "Booking not found" });
    res.status(200).json({ message: "Booking updated", booking: result });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getBookingExceptPending = async (req, res) => {
  try {
    const { professionalId } = req.params;
    if (!professionalId) {
      return res.status(400).json({ message: "Professional ID is required" });
    }

    const q = {
      "assignedProfessional.professionalId": professionalId,
      "bookingDetails.status": { $ne: "Pending" },
    };

    // Descending by date (reverse: 29, 28, 27...), then most recent created
    const leadsList = await UserBooking.find(q)
      .sort({ "selectedSlot.slotDate": -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ leadsList });
  } catch (error) {
    console.error("Error finding confirmed bookings:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// exports.startJob = async (req, res) => {
//   try {
//     const { bookingId, status, assignedProfessional, otp } = req.body;

//     if (!bookingId) {
//       return res.status(400).json({ message: "bookingId is required" });
//     }
//     if (!otp) {
//       return res.status(400).json({ message: "OTP is required" });
//     }

//     // Step 1: Find the booking
//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }

//     // Step 2: Compare OTP
//     const storedOtp = booking.bookingDetails?.otp;
//     if (parseInt(storedOtp) !== parseInt(otp)) {
//       return res.status(401).json({ message: "Invalid OTP" });
//     }

//     // Step 3: Prepare update fields
//     const updateFields = {};
//     if (status) updateFields["bookingDetails.status"] = status;
//     if (assignedProfessional)
//       updateFields.assignedProfessional = assignedProfessional;

//     // Step 4: Update the booking
//     const updatedBooking = await UserBooking.findByIdAndUpdate(
//       bookingId,
//       { $set: updateFields },
//       { new: true }
//     );

//     res.status(200).json({ message: "Job Started", booking: updatedBooking });
//   } catch (error) {
//     console.error("Error updating booking:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

exports.startJob = async (req, res) => {
  try {
    const {
      bookingId,
      startDate, // e.g., "2025-10-03"
      daysRequired = 1, // default to 1 day
      status,
      assignedProfessional,
      otp,
      teamMembers = [], // Array of { _id, name }
    } = req.body;

    // === Validation ===
    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }
    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }

    // === Fetch booking ===
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // === Validate OTP ===
    const storedOtp = booking.bookingDetails?.otp;
    if (!storedOtp || parseInt(storedOtp) !== parseInt(otp)) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // === Determine service type ===
    // Adjust this logic based on how you identify Deep Cleaning vs House Painting
    const isHousePainter = booking.service.some(
      (s) =>
        s.category?.toLowerCase().includes("paint") ||
        s.serviceName?.toLowerCase().includes("paint")
    );

    // === Prepare hiring data (for Deep Cleaning only) ===
    const hiringUpdate = {};
    if (!isHousePainter && teamMembers.length > 0 && startDate) {
      // Generate project dates array
      const projectDates = [];
      const startMoment = moment(startDate, "YYYY-MM-DD");
      for (let i = 0; i < daysRequired; i++) {
        projectDates.push(
          startMoment.clone().add(i, "days").format("YYYY-MM-DD")
        );
      }

      hiringUpdate["assignedProfessional.hiring"] = {
        markedDate: new Date(),
        markedTime: moment().format("LT"),
        teamMember: teamMembers.map((m) => ({
          memberId: m._id,
          memberName: m.name,
        })),
        projectDate: projectDates,
        noOfDay: daysRequired,
        status: "active",
        autoCancelAt: moment(startDate, "YYYY-MM-DD").add(1, "days").toDate(), // optional
      };
    }

    // === Prepare full update object ===
    const updateFields = {
      "bookingDetails.status":
        status || (isHousePainter ? "Survey Ongoing" : "Job Ongoing"),
      "assignedProfessional.professionalId":
        assignedProfessional.professionalId,
      "assignedProfessional.name": assignedProfessional.name,
      "assignedProfessional.phone": assignedProfessional.phone,
      "assignedProfessional.acceptedDate": assignedProfessional.acceptedDate,
      "assignedProfessional.acceptedTime": assignedProfessional.acceptedTime,
      "assignedProfessional.startedDate": new Date(),
      "assignedProfessional.startedTime":
        assignedProfessional.startedTime || moment().format("LT"),
      ...hiringUpdate, // Only populated for Deep Cleaning
    };

    // === Update booking ===
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: "Job started successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error in startJob:", error);
    return res.status(500).json({
      message: "Failed to start job",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.completeSurvey = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // Step 2: Prepare update fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // Step 3: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Completed", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// exports.updatePricing = async (req, res) => {
//   try {
//     const { bookingId } = req.params;
//     const { newTotal, editedPrice, reasonForEditing, scopeType } = req.body;

//     // Step 1: Validate required data
//     if (!bookingId) {
//       return res.status(400).json({ message: "Booking ID is required." });
//     }

//     // Step 2: Find the booking
//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found." });
//     }

//     // Step 3: Prepare update fields
//     const updateFields = {
//       "bookingDetails.priceEditedDate": new Date(),
//       "bookingDetails.priceEditedTime": new Date().toLocaleTimeString(),
//       "bookingDetails.hasPriceUpdated": true,
//       "bookingDetails.priceApprovalStatus": false,
//       "bookingDetails.priceApprovalState": "pending",
//     };

//     if (typeof newTotal === "number")
//       updateFields["bookingDetails.newTotal"] = newTotal;

//     if (typeof editedPrice === "number")
//       updateFields["bookingDetails.editedPrice"] = editedPrice;

//     if (reasonForEditing)
//       updateFields["bookingDetails.reasonForEditing"] = reasonForEditing;

//     if (scopeType) updateFields["bookingDetails.scopeType"] = scopeType;

//     // Step 4: Update and return latest
//     const updatedBooking = await UserBooking.findByIdAndUpdate(
//       bookingId,
//       { $set: updateFields },
//       { new: true }
//     );

//     return res.status(200).json({
//       message: "Booking price updated successfully.",
//       booking: updatedBooking,
//     });
//   } catch (error) {
//     console.error("Error updating price:", error);
//     res.status(500).json({
//       message: "Server error while updating price.",
//       error: error.message,
//     });
//   }
// };

exports.updatePricing = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { amount, scopeType, reasonForEditing, comment } = req.body;
    // amount: number to add/reduce; scopeType: 'Added' | 'Reduced'

    if (
      !bookingId ||
      amount == null ||
      !["Added", "Reduced"].includes(scopeType)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "bookingId, amount, and scopeType (Added|Reduced) are required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found." });

    const d = booking.bookingDetails || (booking.bookingDetails = {});
    const lastApproved = (d.priceChanges || [])
      .filter((c) => String(c.state).toLowerCase() === "approved")
      .slice(-1)[0];

    const kind = (booking.service[0].category || "").toLowerCase();
    const isDeepCleaning = kind.includes("clean");

    const state =
      d.priceApprovalState ??
      (d.priceApprovalStatus
        ? "approved"
        : d.hasPriceUpdated
        ? "pending"
        : "approved");

    if (d.hasPriceUpdated && String(state).toLowerCase() === "pending") {
      return res.status(409).json({
        success: false,
        message:
          "A previous price change is awaiting approval. You cannot make another edit until it is approved or rejected.",
      });
    }
    const paid = Number(d.paidAmount || 0);

    let effectiveBase;
    if (lastApproved && Number.isFinite(lastApproved.proposedTotal)) {
      effectiveBase = Number(lastApproved.proposedTotal);
    } else if (isDeepCleaning) {
      // Deep Cleaning: base is the booking package total
      effectiveBase = Number(d.bookingAmount || 0);
    } else {
      // House Painting and others
      effectiveBase = Number(
        (Number.isFinite(d.finalTotal) && d.finalTotal > 0
          ? d.finalTotal
          : null) ??
          (Number.isFinite(d.currentTotalAmount) && d.currentTotalAmount > 0
            ? d.currentTotalAmount
            : null) ??
          d.bookingAmount ??
          0
      );
    }

    // 🔑 Effective base is the latest approved total; if none, use original
    // this one checking only for house painting
    // const effectiveBase = Number(
    //   d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0
    // );

    // now checking with both case: DC and HP
    // With this safer version
    // const effectiveBase = Number(
    //   d.finalTotal && d.finalTotal > 0
    //     ? d.finalTotal
    //     : d.currentTotalAmount && d.currentTotalAmount > 0
    //     ? d.currentTotalAmount
    //     : d.bookingAmount
    // );

    // Signed delta (+ for Added, - for Reduced)
    const signedDelta =
      (scopeType === "Reduced" ? -1 : 1) * Math.abs(Number(amount));

    const proposedTotalRaw = effectiveBase + signedDelta;

    // Guardrails
    if (proposedTotalRaw < paid) {
      return res.status(400).json({
        success: false,
        message: `This change would make the total ₹${proposedTotalRaw}, which is less than already paid ₹${paid}. Please enter a valid amount.`,
      });
    }
    if (!(proposedTotalRaw >= 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Proposed total would be negative." });
    }

    // Mark as new pending proposal
    d.hasPriceUpdated = true;
    d.priceApprovalState = "pending";
    d.priceApprovalStatus = false; // legacy sync
    d.scopeType = scopeType;
    d.editedPrice = signedDelta; // store SIGNED delta (e.g., +500, -250)
    d.newTotal = proposedTotalRaw; // always server-computed
    d.priceEditedDate = new Date();
    d.priceEditedTime = moment().format("LT");
    d.reasonForEditing = reasonForEditing || d.reasonForEditing;
    // d.editComment = comment || d.editComment;
    d.approvedBy = null;
    d.rejectedBy = null;

    // Live preview values
    // d.amountYetToPay = Math.max(0, d.newTotal - paid);

    await booking.save();
    return res.status(200).json({
      success: true,
      message: "Price change proposed and awaiting approval.",
      base: effectiveBase,
      delta: signedDelta,
      proposedTotal: d.newTotal,
      paidAmount: paid,
      amountYetToPay: d.amountYetToPay,
    });
  } catch (error) {
    console.error("updatePricing error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating price.",
      error: error.message,
    });
  }
};

exports.approvePrice = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { by } = req.body; // 'admin' | 'customer'

    if (
      !bookingId ||
      !["admin", "customer"].includes(String(by || "").toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "bookingId and valid 'by' (admin|customer) are required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    const d = booking.bookingDetails || (booking.bookingDetails = {});

    // Mark approved (tri-state + legacy)
    d.priceApprovalState = "approved";
    d.priceApprovalStatus = true;
    d.approvedBy = String(by).toLowerCase();
    d.priceApprovedDate = new Date();
    d.priceApprovedTime = moment().format("LT");
    d.rejectedBy = null;
    d.priceRejectedDate = undefined;
    d.priceRejectedTime = undefined;

    d.finalTotal = Number(d.newTotal ?? d.finalTotal ?? d.bookingAmount ?? 0);
    d.hasPriceUpdated = false;

    // Lock final total to newTotal (fallback bookingAmount)
    // const finalTotal = Number(d.newTotal ?? d.bookingAmount ?? 0);
    // d.finalTotal = finalTotal;

    // Make sure milestone base does not move (helper only sets if missing)
    ensureFirstMilestone(d);

    // Derived fields
    // syncDerivedFields(d, finalTotal);
    // setPaymentStatus(d, finalTotal);
    syncDerivedFields(d, d.finalTotal); // sets amountYetToPay + mirrors currentTotalAmount
    setPaymentStatus(d, d.finalTotal);

    await booking.save();
    return res.json({
      success: true,
      message: "Price approved.",
      bookingId: booking._id,
      finalTotal: d.finalTotal,
      amountYetToPay: d.amountYetToPay,
      paymentStatus: d.paymentStatus,
      approvedBy: d.approvedBy,
      approvedAt: d.priceApprovedDate,
    });
  } catch (err) {
    console.error("approvePrice error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during approval",
      error: err.message,
    });
  }
};

exports.rejectPrice = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { by, reason } = req.body; // 'admin' | 'customer'

    if (
      !bookingId ||
      !["admin", "customer"].includes(String(by || "").toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "bookingId and valid 'by' (admin|customer) are required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    const d = booking.bookingDetails || (booking.bookingDetails = {});
    const decidedBy = String(by).toLowerCase();

    // (Optional) Append to history for audit
    d.priceChanges = d.priceChanges || [];
    d.priceChanges.push({
      proposedAt: d.priceEditedDate || new Date(),
      proposedBy: "vendor", // or from auth/user
      scopeType: d.scopeType,
      delta: d.editedPrice, // signed (+/-)
      proposedTotal: d.newTotal,
      state: "rejected",
      decidedAt: new Date(),
      decidedBy,
      reason: reason || undefined,
      baseAtProposal: Number(d.finalTotal ?? d.bookingAmount ?? 0),
    });

    // Mark rejected (tri-state + legacy)
    d.priceApprovalState = "rejected";
    d.priceApprovalStatus = false;
    d.rejectedBy = decidedBy;
    d.priceRejectedDate = new Date();
    d.priceRejectedTime = moment().format("LT");
    if (reason) d.rejectionReason = String(reason);

    // ✅ Clear proposal fields so UI doesn't show stale pending values
    d.hasPriceUpdated = false; // unlocks new edits
    d.approvedBy = null;
    d.editedPrice = undefined;
    d.newTotal = undefined;
    d.scopeType = undefined;
    d.priceEditedDate = undefined;
    d.priceEditedTime = undefined;

    // ✅ Keep the last approved total (no change on reject)
    // const finalTotal = Number(d.finalTotal ?? d.bookingAmount ?? 0);

    // Derived fields recomputed from the actual finalTotal
    // syncDerivedFields(d, finalTotal);
    // setPaymentStatus(d, finalTotal);

    const effective = Number(
      d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0
    );
    syncDerivedFields(d, effective);
    setPaymentStatus(d, effective);

    await booking.save();
    return res.json({
      success: true,
      message: "Price disapproved. Previous approved total remains in effect.",
      bookingId: booking._id,
      finalTotal: d.finalTotal, // unchanged
      amountYetToPay: d.amountYetToPay, // recomputed from finalTotal
      paymentStatus: d.paymentStatus,
      rejectedBy: d.rejectedBy,
      rejectedAt: d.priceRejectedDate,
      reason: d.rejectionReason,
    });
  } catch (err) {
    console.error("rejectPrice error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during disapproval",
      error: err.message,
    });
  }
};

exports.cancelJob = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Job Cancelled", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { bookingId, status, vendorId, reasonForCancelled, cancelledBy } =
      req.body;
    if (!bookingId)
      return res.status(400).json({ message: "bookingId is required" });

    const booking = await UserBooking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const actingVendorId =
      vendorId || booking?.assignedProfessional?.professionalId;
    if (!actingVendorId)
      return res.status(400).json({
        message: "vendorId is required (or assign a professional first)",
      });

    // booking-level fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (reasonForCancelled)
      updateFields["bookingDetails.reasonForCancelled"] = reasonForCancelled;

    // ensure invite exists
    await UserBooking.updateOne(
      {
        _id: bookingId,
        "invitedVendors.professionalId": { $ne: String(actingVendorId) },
      },
      {
        $addToSet: {
          invitedVendors: {
            professionalId: String(actingVendorId),
            invitedAt: new Date(),
            responseStatus: "pending",
          },
        },
      }
    );

    // build invite patch
    const patch = mapStatusToInvite(status, cancelledBy);

    const setOps = {
      ...updateFields,
      "invitedVendors.$[iv].respondedAt": new Date(),
    };
    if (patch.responseStatus)
      setOps["invitedVendors.$[iv].responseStatus"] = patch.responseStatus;
    if (patch.cancelledAt)
      setOps["invitedVendors.$[iv].cancelledAt"] = patch.cancelledAt;
    if (patch.cancelledBy)
      setOps["invitedVendors.$[iv].cancelledBy"] = patch.cancelledBy;

    const updated = await UserBooking.findOneAndUpdate(
      { _id: bookingId },
      { $set: setOps },
      {
        new: true,
        runValidators: true,
        arrayFilters: [{ "iv.professionalId": String(actingVendorId) }],
      }
    );

    if (!updated)
      return res
        .status(404)
        .json({ message: "Booking not found after update" });
    res.status(200).json({ message: "Status Updated", booking: updated });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.markPendingHiring = async (req, res) => {
  try {
    const { bookingId, startDate, teamMembers, noOfDays, quotationId } =
      req.body;
    const quotationObjectId = new mongoose.Types.ObjectId(quotationId);
    // Find booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      // console.log("Booking not found");
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    // Update bookingDetails status
    booking.bookingDetails.status = "Pending Hiring";
    booking.bookingDetails.startProject = true;

    const quoteDoc = await Quote.findById(quotationId).lean();
    if (!quoteDoc) {
      return res
        .status(400)
        .json({ success: false, message: "Quotation not found" });
    }

    console.log("Attempting to lock quotation:", quotationId);

    // ✅ Calculate TOTAL AMOUNT from quote (or fallback to service total)
    const totalAmount = booking.bookingDetails.bookingAmount;

    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Finalize quote first.",
      });
    }
    console.log("Finalized total amount:", totalAmount);
    booking.bookingDetails.currentTotalAmount = totalAmount;

    const d = booking.bookingDetails;

    // If we already have an approved total, keep it; else adopt the booking/quote amount
    const approvedTotal = Number(
      d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0
    );

    d.finalTotal = approvedTotal > 0 ? approvedTotal : Number(totalAmount || 0);

    // Keep mirror in sync
    d.currentTotalAmount = d.finalTotal;

    // ✅ Calculate 40% for first installment
    const firstInstallment = Math.round(d.finalTotal * 0.4);
    d.paymentStatus = "Unpaid";
    d.paidAmount = 0;

    booking.bookingDetails.amountYetToPay = firstInstallment;

    const updatedQuote = await Quote.updateOne(
      { _id: quotationObjectId, status: "finalized" }, // Make sure you're selecting the finalized quote
      { $set: { locked: true } } // Lock the quotation
    );

    if (!mongoose.Types.ObjectId.isValid(quotationId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid quotation ID" });
    }

    // console.log("Updated quotation:", updatedQuote);

    if (updatedQuote.nModified === 0) {
      console.log("Failed to lock the quotation, no rows modified.");
    } else {
      console.log("Quotation locked successfully.");
    }

    // 1. Build project dates (as before)
    const projectDate = Array.from({ length: noOfDays }, (_, i) =>
      moment(startDate).add(i, "days").format("YYYY-MM-DD")
    );

    // 2. Create a proper Date object for "first project day at 10:30 AM"
    const projectStartDateTime = moment(projectDate[0], "YYYY-MM-DD")
      .set({ hour: 10, minute: 30, second: 0, millisecond: 0 })
      .toDate();

    // 3. Update selectedSlot to reflect the project start (not booking time)
    booking.selectedSlot.slotDate = projectDate[0]; // e.g., "2025-09-25"
    booking.selectedSlot.slotTime = "10:30 AM"; // Fixed per client requirement

    // 4. Store the full datetime in bookingDetails for UI display (if needed)
    booking.bookingDetails.projectStartDate = projectStartDateTime; // This should be a Date

    // 5. Auto-cancel logic (unchanged)
    const firstDay = projectDate[0]; // no need to sort — it's already in order
    const autoCancelAt = buildAutoCancelAtUTC(firstDay);
    booking.assignedProfessional.hiring.autoCancelAt = autoCancelAt;

    // 4) Auto-cancel time = 07:30 IST of first project day (store UTC Date)
    // "firstDay" is 'YYYY-MM-DD' in IST
    // const autoCancelAt = moment(`${firstDay} 07:30`, 'YYYY-MM-DD HH:mm')
    //   .subtract(5, 'hours')
    //   .subtract(30, 'minutes')
    //   .toDate(); // this Date represents the same instant (02:00 UTC)

    // 5) Hiring block
    booking.assignedProfessional.hiring = {
      markedDate: new Date(),
      markedTime: moment().format("LT"),
      projectDate: Array.from({ length: noOfDays }, (_, i) =>
        moment(startDate).add(i, "days").format("YYYY-MM-DD")
      ),
      noOfDay: noOfDays,
      teamMember: teamMembers.map((m) => ({
        memberId: m._id,
        memberName: m.name,
      })),
      quotationId: quotationObjectId,
      status: "active",
      autoCancelAt,
    };

    if (!booking?.assignedProfessional?.hiring?.quotationId) {
      console.warn("[unlockQuotes] No quotationId found, skipping unlock");
      return;
    }
    // Carry over leadId if missing
    if (!booking.leadId && quoteDoc.leadId) {
      booking.leadId = quoteDoc.leadId;
    }

    console.log("firstInstallment", firstInstallment);

    // ✅ UPDATE PAYMENT FIELDS FOR 40% INSTALLMENT
    booking.bookingDetails.status = "Pending Hiring";
    booking.bookingDetails.startProject = true;

    booking.bookingDetails.paymentStatus = "Unpaid";
    booking.bookingDetails.paidAmount = 0; // nothing paid yet
    booking.bookingDetails.amountYetToPay = firstInstallment; // 40% due now

    // 6) Payment link (change to razor pay)
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-${Date.now()}`;
    booking.bookingDetails.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz", // fill if you have gateway id
    };

    if (process.env.NODE_ENV !== "production") {
      booking.assignedProfessional.hiring.autoCancelAt = new Date(
        Date.now() + 2 * 60 * 1000
      ); // +2 mins
    }
    const USE_REAL_AUTO_CANCEL = true; // 👈 set to true for real-time test

    if (!USE_REAL_AUTO_CANCEL && process.env.NODE_ENV !== "production") {
      booking.assignedProfessional.hiring.autoCancelAt = new Date(
        Date.now() + 2 * 60 * 1000
      );
      console.log(
        "DEV: autoCancelAt set to",
        booking.assignedProfessional.hiring.autoCancelAt.toISOString()
      );
    } else {
      // Use real auto-cancel time
      const firstDay = projectDate[0]; // e.g., "2025-09-25"
      const autoCancelAt = buildAutoCancelAtUTC(firstDay);
      booking.assignedProfessional.hiring.autoCancelAt = autoCancelAt;
    }

    await booking.save();
    // await unlockRelatedQuotesByHiring(booking, "auto-unpaid");

    // await booking.save();
    // await Quote.updateMany(
    //   { _id: { $in: booking.quotationId }, locked: true },
    //   { $set: { locked: false } }
    // );

    // TODO: Send SMS/Email/WhatsApp to customer with paymentLink

    res.json({
      success: true,
      message:
        "Booking updated to Pending Hiring. Payment link sent to customer.",
      bookingId,
      paymentLink: paymentLinkUrl,
      amountDue: firstInstallment,
      totalAmount: totalAmount,
    });
  } catch (err) {
    console.error("Error marking pending hiring:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.requestStartProjectOtp = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    if (booking.bookingDetails.status !== "Hired") {
      return res.status(400).json({
        success: false,
        message: "Only 'Hired' bookings can request to start project",
      });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // ✅ Hash OTP before saving (SECURITY BEST PRACTICE)
    const hashedOtp = await bcrypt.hash(otp, 10);

    booking.bookingDetails.startProjectOtp = hashedOtp;
    booking.bookingDetails.startProjectOtpExpiry = expiry;
    booking.bookingDetails.startProjectRequestedAt = new Date();

    await booking.save();

    // ✅ Send OTP via SMS/WhatsApp (mock here)
    console.log(
      `[OTP SENT] Booking ${bookingId} - OTP: ${otp} (expires at ${expiry})`
    );
    // In real: await sendSms(customer.phone, `Your project start OTP: ${otp}. Valid for 10 mins.`);

    res.json({
      success: true,
      message: "OTP sent to customer. Await verification to start project.",
      otp: otp,
    });
  } catch (err) {
    console.error("Error requesting start-project OTP:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.verifyStartProjectOtp = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { otp } = req.body;

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    const details = booking.bookingDetails;

    if (details.status !== "Hired") {
      return res.status(400).json({
        success: false,
        message: "Booking must be 'Hired' to start project",
      });
    }

    if (!details.startProjectOtp || !details.startProjectOtpExpiry) {
      return res
        .status(400)
        .json({ success: false, message: "No OTP requested" });
    }

    if (new Date() > details.startProjectOtpExpiry) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    const isValid = await bcrypt.compare(otp, details.startProjectOtp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // ✅ ONLY: Start the job
    details.status = "Project Ongoing";
    details.isJobStarted = true;

    details.startProjectApprovedAt = new Date();

    if (booking.assignedProfessional) {
      booking.assignedProfessional.startedDate = new Date();
      booking.assignedProfessional.startedTime = moment().format("LT");
    }

    // Clear OTP
    details.startProjectOtp = undefined;
    details.startProjectOtpExpiry = undefined;

    // ✅ DO NOT generate any payment link here

    await booking.save();

    res.json({
      success: true,
      message:
        "Project started successfully. Status updated to 'Project Ongoing'.",
      bookingId: booking._id,
      status: "Project Ongoing",
    });
  } catch (err) {
    console.error("Error verifying start-project OTP:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.requestSecondPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const d = booking.bookingDetails || (booking.bookingDetails = {});

    // Must be Project Ongoing
    if ((d.status || "").trim() !== "Project Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Can only request 2nd payment during 'Project Ongoing'",
      });
    }

    // Price-edit gate: block ONLY while pending
    const approvalState =
      d.priceApprovalState ??
      (d.priceApprovalStatus
        ? "approved"
        : d.hasPriceUpdated
        ? "pending"
        : "approved");

    if (d.hasPriceUpdated && approvalState === "pending") {
      return res.status(400).json({
        success: false,
        message:
          "Pending price approval. Please approve/reject the edited amount first.",
      });
    }

    // Decide final total to 80%-target against
    const finalTotal = Number(d.finalTotal ?? computeFinalTotal(d));
    if (!(finalTotal > 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Booking amount not set" });
    }

    // Ensure milestone is initialized (locks baseTotal for 40%)
    ensureFirstMilestone(d);

    // First milestone must be completed (based on bookingAmount baseline)
    if (!hasCompletedFirstMilestone(d)) {
      return res.status(400).json({
        success: false,
        message:
          "First payment (40%) must be completed before requesting second",
      });
    }

    const paidSoFar = Number(d.paidAmount || 0);
    const eightyTarget = roundMoney(finalTotal * 0.8);
    const secondInstallment = Math.max(0, eightyTarget - paidSoFar);

    if (secondInstallment <= 0) {
      return res.status(400).json({
        success: false,
        message: "Second installment already paid or not due",
      });
    }

    console.log("secondInstallment:", secondInstallment);

    // Generate payment link
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-installment2-${Date.now()}`;
    d.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
    };

    // Keep/normalize paymentStatus
    d.paymentStatus = "Partial Payment";

    await booking.save();

    return res.json({
      success: true,
      message: "Second payment link generated.",
      paymentLink: paymentLinkUrl,
      amountDue: secondInstallment,
      finalTotal,
      paidSoFar,
      eightyTarget,
    });
  } catch (err) {
    console.error("Error requesting second payment:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.endingFinalJob = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const details = booking.bookingDetails;

    // Only allow ending if job is ongoing
    if (details.status !== "Project Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Only 'Project Ongoing' bookings can be requested to end",
      });
    }

    const totalExpected =
      details.currentTotalAmount || details.bookingAmount || 0;
    const paidSoFar = details.paidAmount || 0;
    const paidRatio = totalExpected > 0 ? paidSoFar / totalExpected : 0;

    // ✅ Require at least 80% paid to even request ending
    if (paidRatio < 0.79) {
      return res.status(400).json({
        success: false,
        message: "At least 80% payment required before requesting to end job",
      });
    }

    const now = new Date();

    // Record that vendor requested to end (optional: add a flag)
    details.jobEndRequestedAt = now;

    // 💡 DO NOT change status to "Project Completed" yet!
    // Keep status as "Project Ongoing" until final payment

    const finalAmount = totalExpected - paidSoFar;

    console.log("finalAmount", finalAmount);

    // Generate final payment link
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-final-${Date.now()}`;
    details.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
    };

    // Update payment status to indicate final payment is pending
    details.paymentStatus = "Waiting for final payment";
    details.status = "Waiting for final payment";

    await booking.save();

    res.json({
      success: true,
      message:
        "Final payment link generated. Awaiting customer payment to complete job.",
      bookingId: booking._id,
      status: details.status, // still "Project Ongoing"
      paymentStatus: details.paymentStatus,
      paymentLink: paymentLinkUrl,
      amountDue: finalAmount,
    });
  } catch (err) {
    console.error("Error requesting job end:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

exports.makePayment = async (req, res) => {
  try {
    const { bookingId, paymentMethod, paidAmount, providerRef } = req.body;

    if (!bookingId || !paymentMethod || paidAmount == null) {
      return res.status(400).json({
        success: false,
        message: "bookingId, paymentMethod, and paidAmount are required",
      });
    }

    const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
    if (!validPaymentMethods.includes(String(paymentMethod))) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }

    const amount = Number(paidAmount);
    if (!(amount > 0)) {
      return res.status(400).json({
        success: false,
        message: "Paid amount must be greater than zero",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    const d = booking.bookingDetails || (booking.bookingDetails = {});

    // Compute/lock final total
    const finalTotal = Number(d.finalTotal ?? computeFinalTotal(d));
    if (!(finalTotal > 0)) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Finalize quote first.",
      });
    }

    // Idempotency by providerRef
    if (providerRef) {
      booking.payments = booking.payments || [];
      const already = booking.payments.some(
        (p) => p.providerRef === providerRef
      );
      if (already) {
        return res.status(200).json({
          success: true,
          message: "Payment already recorded (idempotent).",
          bookingId: booking._id,
        });
      }
    }

    const currentPaid = Number(d.paidAmount || 0);
    const remaining = Math.max(0, finalTotal - currentPaid);
    if (amount > remaining) {
      return res.status(400).json({
        success: false,
        message: "Paid amount cannot exceed remaining balance",
      });
    }

    // Apply payment
    d.paymentMethod = String(paymentMethod);
    d.paidAmount = currentPaid + amount;

    // Deactivate any active link
    if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

    // Track payment line-item (optional)
    booking.payments = booking.payments || [];
    booking.payments.push({
      at: new Date(),
      method: d.paymentMethod,
      amount,
      providerRef: providerRef || undefined,
    });

    // Milestone: set/complete first 40% baseline (bookingAmount)
    ensureFirstMilestone(d);
    if (
      !d.firstMilestone.completedAt &&
      d.paidAmount >= Number(d.firstMilestone.requiredAmount || 0)
    ) {
      d.firstMilestone.completedAt = new Date();
    }

    // Derived fields + statuses
    syncDerivedFields(d, finalTotal);

    const fullyPaid = d.paidAmount >= finalTotal;
    if (fullyPaid) {
      d.paymentStatus = "Paid";

      // Move to completed if was ongoing or waiting
      if (
        ["Waiting for final payment", "Project Ongoing"].includes(
          String(d.status)
        )
      ) {
        d.status = "Project Completed";
        const now = new Date();
        if (booking.assignedProfessional) {
          booking.assignedProfessional.completedDate = now;
          booking.assignedProfessional.completedTime = moment().format("LT");
        }
        d.jobEndedAt = now;
      }

      // Hiring coherence
      if (booking.assignedProfessional?.hiring) {
        booking.assignedProfessional.hiring.status = "active";
        if (!booking.assignedProfessional.hiring.hiredDate) {
          booking.assignedProfessional.hiring.hiredDate = new Date();
          booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
        }
      }
    } else {
      // Partial payment thresholds
      const ratio = d.paidAmount / finalTotal;
      d.paymentStatus =
        ratio >= 0.799 ? "Partially Completed" : "Partial Payment";

      // Promote Pending → Hired on first payment
      const statusNorm = (d.status || "").trim().toLowerCase();
      if (["pending hiring", "pending"].includes(statusNorm)) {
        d.status = "Hired";
      }

      // Hiring coherence
      if (booking.assignedProfessional?.hiring) {
        booking.assignedProfessional.hiring.status = "active";
        if (!booking.assignedProfessional.hiring.hiredDate) {
          booking.assignedProfessional.hiring.hiredDate = new Date();
          booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
        }
      }
    }

    await booking.save();

    return res.json({
      success: true,
      message: fullyPaid
        ? "Final payment completed. Job marked as ended."
        : "Payment received.",
      bookingId: booking._id,
      finalTotal,
      totalPaid: d.paidAmount,
      remainingAmount: d.amountYetToPay,
      status: d.status,
      paymentStatus: d.paymentStatus,
      firstMilestone: d.firstMilestone, // helpful for UI
    });
  } catch (err) {
    console.error("makePayment error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while processing payment",
      error: err.message,
    });
  }
};
