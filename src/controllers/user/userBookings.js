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

    case "Ongoing":
      return { responseStatus: "started" };

    case "Completed":
      return { responseStatus: "completed" };

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
      })),

      bookingDetails: {
        bookingDate: bookingDetails.bookingDate,
        bookingTime: bookingDetails.bookingTime,
        status: bookingDetails.status || "Pending",
        paymentMethod: bookingDetails.paymentMethod || "Cash",
        paymentStatus: bookingDetails.paymentStatus || "Unpaid",
        bookingAmount: bookingDetails.bookingAmount,
        siteVisitCharges: bookingDetails.bookingAmount,
        // paidAmount: bookingDetails.paidAmount,
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

exports.startJob = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional, otp } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }
    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Step 2: Compare OTP
    const storedOtp = booking.bookingDetails?.otp;
    if (parseInt(storedOtp) !== parseInt(otp)) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // Step 3: Prepare update fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // Step 4: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Job Started", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.endJob = async (req, res) => {
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
//     const {
//       bookingId,
//       paidAmount,
//       editedPrice,
//       payToPay,
//       reason,
//       scope,
//       hasPriceUpdated,
//       paymentStatus,
//     } = req.body;

//     if (!bookingId) {
//       return res.status(400).json({ message: "bookingId is required" });
//     }

//     // Step 1: Find the booking
//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }
//     // Step 2: Prepare update fields
//     const updateFields = {};
//     if (paidAmount) updateFields["bookingDetails.paidAmount"] = paidAmount;
//     if (editedPrice) updateFields["bookingDetails.editedPrice"] = editedPrice;
//     if (payToPay) updateFields["bookingDetails.amountYetToPay"] = payToPay;
//     if (reason) updateFields["bookingDetails.reasonForChanging"] = reason;
//     if (scope) updateFields["bookingDetails.scope"] = scope;
//     if (hasPriceUpdated)
//       updateFields["bookingDetails.hasPriceUpdated"] = hasPriceUpdated;
//     if (paymentStatus)
//       updateFields["bookingDetails.paymentStatus"] = paymentStatus;

//     // Step 3: Update the booking
//     const updatedBooking = await UserBooking.findByIdAndUpdate(
//       bookingId,
//       { $set: updateFields },
//       { new: true }
//     );

//     res.status(200).json({ message: "Price Updated", booking: updatedBooking });
//   } catch (error) {
//     console.error("Error updating price:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

exports.updatePricing = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { amountChange, reason } = req.body;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    // Validate amountChange
    if (typeof amountChange !== "number" || Math.abs(amountChange) < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount change" });
    }

    // Calculate new total
    const newTotal = booking.bookingDetails.currentTotalAmount + amountChange;

    // Record scope change
    booking.bookingDetails.scopeChanges =
      booking.bookingDetails.scopeChanges || [];
    booking.bookingDetails.scopeChanges.push({
      amount: amountChange,
      reason,
      changedAt: new Date(),
      changedBy: req.user.professionalId, // assuming you have auth
    });

    // Update current total
    booking.bookingDetails.currentTotalAmount = newTotal;

    // Optional: Notify customer
    // await notifyCustomer(...);

    await booking.save();

    res.json({
      success: true,
      message: "Scope updated successfully",
      newTotalAmount: newTotal,
      amountChange,
      reason,
    });
  } catch (err) {
    console.error("Error editing scope:", err);
    res.status(500).json({ success: false, message: "Server error" });
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

    // ✅ Calculate 40% for first installment
    const firstInstallment = Math.round(totalAmount * 0.4);

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

    // 3) Build project dates
    const projectDate = Array.from({ length: noOfDays }, (_, i) =>
      require("moment")(startDate).add(i, "days").format("YYYY-MM-DD")
    );

    const firstDay = projectDate.slice().sort()[0];
    const autoCancelAt = buildAutoCancelAtUTC(firstDay);

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

      console.log(
        "DEV: autoCancelAt set to",
        booking.assignedProfessional.hiring.autoCancelAt.toISOString()
      );
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

exports.makePayment = async (req, res) => {
  try {
    const { bookingId, paymentMethod, paidAmount } = req.body;

    // ✅ Validate required fields
    if (!bookingId || !paymentMethod || paidAmount == null) {
      return res.status(400).json({
        success: false,
        message: "bookingId, paymentMethod, and paidAmount are required",
      });
    }

    // ✅ Validate paymentMethod enum
    const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    // ✅ Find booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // ✅ Get current total (can be changed by scope edits)
    const totalExpected = booking.bookingDetails.currentTotalAmount || 0;

    // ✅ Get total expected amount (finalized quote)
    // const totalExpected = booking.bookingDetails.bookingAmount || 0;

    if (totalExpected <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Finalize quote first.",
      });
    }

    // ✅ Validate paidAmount
    if (paidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Paid amount must be greater than zero",
      });
    }

    const currentRemainingTotal =
      totalExpected - (booking.bookingDetails.paidAmount || 0);
    if (paidAmount > currentRemainingTotal) {
      return res.status(400).json({
        success: false,
        message: "Paid amount cannot exceed total remaining balance",
      });
    }

    booking.bookingDetails.paymentMethod = paymentMethod;
    booking.bookingDetails.paidAmount =
      (booking.bookingDetails.paidAmount || 0) + paidAmount;
    booking.bookingDetails.amountYetToPay =
      totalExpected - booking.bookingDetails.paidAmount;

    if (booking.bookingDetails.paidAmount >= totalExpected) {
      booking.bookingDetails.paymentStatus = "Paid";

      if (booking.bookingDetails.paymentLink) {
        booking.bookingDetails.paymentLink.isActive = false;
      }

      if (booking.assignedProfessional?.hiring) {
        booking.assignedProfessional.hiring.status = "active";
        if (!booking.assignedProfessional.hiring.hiredDate) {
          booking.assignedProfessional.hiring.hiredDate = new Date();
          booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
        }
      }
    } else {
      const paidRatio = booking.bookingDetails.paidAmount / totalExpected;
      console.log("Paid ratio:", paidRatio);

      if (paidRatio >= 0.799) {
        booking.bookingDetails.paymentStatus = "Partially Completed";
      } else if (paidRatio >= 0.4) {
        booking.bookingDetails.paymentStatus = "Partial Payment";
      } else {
        booking.bookingDetails.paymentStatus = "Partial Payment";
      }
      if (booking.bookingDetails.status !== "Job Ongoing") {
        booking.bookingDetails.status = "Hired";
      }
    }

    console.log(`paidAmount: ${booking.bookingDetails.paidAmount}`);
    console.log(`totalExpected: ${totalExpected}`);
    console.log(`80% of total: ${totalExpected * 0.8}`);

    let nextAction = "none";

    await booking.save();

    res.json({
      success: true,
      message:
        booking.bookingDetails.paidAmount >= totalExpected
          ? "Final payment completed. Awaiting vendor to end job."
          : "Payment received. Thank you!",
      bookingId: booking._id,
      remainingAmount: booking.bookingDetails.amountYetToPay,
      totalPaid: booking.bookingDetails.paidAmount,
      totalExpected: totalExpected,
      nextAction: nextAction,
    });
  } catch (err) {
    console.error("Error processing payment:", err);
    res.status(500).json({
      success: false,
      message: "Server error while processing payment",
      error: err.message,
    });
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

    // ✅ Validate state
    if (details.status !== "Hired") {
      return res.status(400).json({
        success: false,
        message: "Booking must be 'Hired' to start project",
      });
    }

    // ✅ Check if OTP exists and not expired
    if (!details.startProjectOtp || !details.startProjectOtpExpiry) {
      return res
        .status(400)
        .json({ success: false, message: "No OTP requested" });
    }

    if (new Date() > details.startProjectOtpExpiry) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    // ✅ Verify OTP
    const isValid = await bcrypt.compare(otp, details.startProjectOtp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // ✅ Update status to "Job Ongoing"
    details.status = "Job Ongoing";
    details.startProjectApprovedAt = new Date();

    // ✅ Record start time for assigned professional
    if (booking.assignedProfessional) {
      booking.assignedProfessional.startedDate = new Date();
      booking.assignedProfessional.startedTime = moment().format("LT");
    }

    // ✅ Clear OTP after use
    details.startProjectOtp = undefined;
    details.startProjectOtpExpiry = undefined;

    // ✅ GENERATE 2ND INSTALLMENT (40% — bringing total paid to 80%)
    const totalExpected =
      details.currentTotalAmount || details.bookingAmount || 0;
    const paidSoFar = details.paidAmount || 0;

    if (totalExpected <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Cannot generate payment link.",
      });
    }

    // Calculate 80% of total
    const eightyPercent = Math.round(totalExpected * 0.8);
    const secondInstallment = Math.max(0, eightyPercent - paidSoFar);

    console.log("secondInstallment", secondInstallment);

    // ✅ Set paymentStatus based on total paid % (consistent with makePayment)
    // const paidRatio = paidSoFar / totalExpected;
    details.paymentStatus = "Partial Payment";
    // if (paidRatio >= 0.8) {
    //   details.paymentStatus = "Waiting for final payment";
    // } else {
    //   details.paymentStatus = "Partial Payment";
    // }

    // ✅ Generate new payment link for 2nd installment
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-installment2-${Date.now()}`;
    details.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
    };

    await booking.save();

    res.json({
      success: true,
      message: "Project started successfully. Status updated to 'Job Ongoing'.",
      showPaymentAdjustment: true,
      paymentLink: paymentLinkUrl,
      amountDue: secondInstallment,
      totalExpected: totalExpected,
      paidSoFar: paidSoFar,
      remainingTotal: totalExpected - paidSoFar, // 👈 Real remaining balance
    });
  } catch (err) {
    console.error("Error verifying start-project OTP:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.requestFinalPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const details = booking.bookingDetails;

    // ✅ Validate state
    if (details.status !== "Job Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Only 'Job Ongoing' bookings can request final payment",
      });
    }

    // ✅ Validate payment progress
    const paidRatio = details.paidAmount / (details.currentTotalAmount || 1);
    if (paidRatio < 0.8) {
      return res.status(400).json({
        success: false,
        message: "At least 80% must be paid before requesting final payment",
      });
    }

    if (details.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "Booking is already fully paid",
      });
    }

    // ✅ Update payment status
    details.paymentStatus = "Waiting for final payment";

    // ✅ Generate final payment link
    const finalAmount =
      (details.currentTotalAmount || 0) - (details.paidAmount || 0);
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-final-${Date.now()}`;

    details.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
    };

    await booking.save();

    res.json({
      success: true,
      message: "Final payment link generated and sent to customer.",
      paymentLink: paymentLinkUrl,
      amountDue: finalAmount,
    });
  } catch (err) {
    console.error("Error requesting final payment:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.endingFinalJob = async (req, res) => {
  try {
    const { bookingId } = req.params;

    // ✅ Find booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const details = booking.bookingDetails;

    // ✅ Validate current status
    if (details.status !== "Job Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Only 'Job Ongoing' bookings can be ended",
      });
    }

    // ✅ CRITICAL: Validate payment is fully completed
    if (details.paymentStatus !== "Paid") {
      return res.status(400).json({
        success: false,
        message: "Final payment must be completed before ending job",
      });
    }

    // ✅ Record end time
    const now = new Date();
    if (booking.assignedProfessional) {
      booking.assignedProfessional.completedDate = now;
      booking.assignedProfessional.completedTime = moment().format("LT");
    }

    // ✅ Update status to "Job End"
    details.status = "Job Ended";

    // ✅ Optional: Add job end timestamp for audit
    details.jobEndedAt = now;

    await booking.save();

    res.json({
      success: true,
      message: "Job ended successfully.",
      bookingId: booking._id,
      status: details.status,
      paymentStatus: details.paymentStatus,
      endedAt: now,
    });
  } catch (err) {
    console.error("Error ending job:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};


exports.updateBooking = async (req, res) => {
  try {
    const { id } = req.params;

    
    const booking = await UserBooking.findById(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

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

    // ✅ Update customer
    if (customer) {
      booking.customer = {
        ...booking.customer,
        customerId: customer.customerId ?? booking.customer.customerId,
        name: customer.name ?? booking.customer.name,
        phone: customer.phone ?? booking.customer.phone,
      };
    }

    // ✅ Update services
    if (service && Array.isArray(service)) {
      booking.service = service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: s.price,
        quantity: s.quantity,
      }));
    }

    // ✅ Update booking details
    if (bookingDetails) {
      booking.bookingDetails = {
        ...booking.bookingDetails.toObject(),
        ...bookingDetails,
      };
    }

    // ✅ Update assigned professional
    if (assignedProfessional) {
      booking.assignedProfessional = {
        professionalId: assignedProfessional.professionalId,
        name: assignedProfessional.name,
        phone: assignedProfessional.phone,
      };
    }

    // ✅ Update address
    if (address) {
      if (
        address.location &&
        Array.isArray(address.location.coordinates) &&
        address.location.coordinates.length === 2
      ) {
        booking.address = {
          ...booking.address,
          houseFlatNumber: address.houseFlatNumber,
          streetArea: address.streetArea,
          landMark: address.landMark,
          location: {
            type: "Point",
            coordinates: address.location.coordinates,
          },
        };
      }
    }

    // ✅ Update slot
    if (selectedSlot) {
      booking.selectedSlot = {
        slotDate: selectedSlot.slotDate,
        slotTime: selectedSlot.slotTime,
      };
    }

    // ✅ Update isEnquiry & formName
    if (typeof isEnquiry === "boolean") booking.isEnquiry = isEnquiry;
    if (formName) booking.formName = formName;

    await booking.save();

    res.status(200).json({ message: "Booking updated successfully", booking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};



exports.updateAssignedProfessional = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { professionalId, name, phone } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: "bookingId is required" });
    }


    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      {
        $set: {
          "assignedProfessional.professionalId": professionalId,
          "assignedProfessional.name": name,
          "assignedProfessional.phone": phone,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    res.status(200).json({
      success: true,
      message: "Assigned professional updated successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error updating assigned professional:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


// Delete booking
// exports.deleteBooking = async (req, res) => {
//   try {
//     const booking = await UserBookingSchema.findByIdAndDelete(req.params.id);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }
//     res.status(200).json({ message: "Booking deleted" });
//   } catch (error) {
//     console.error("Error deleting booking:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };
