const UserBooking = require("../../models/user/userBookings");
const Quote = require("../../models/measurement/Quote");
const moment = require("moment");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const dayjs = require("dayjs");
const mongoose = require("mongoose");
const { unlockRelatedQuotesByHiring } = require("../../helpers/quotes");
const userBookings = require("../../models/user/userBookings");

const citiesObj = {
  Bangalore: "Bengaluru",
  Pune: "Pune",
};

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

function recalculateInstallments(d) {
  const total = d.finalTotal;

  // First: 40%
  if (d.firstPayment?.status === "pending") {
    d.firstPayment.amount = Math.round(total * 0.4);
  }

  // Second: next 40% (total 80%)
  if (d.secondPayment?.status === "pending") {
    const firstAmt = d.firstPayment?.amount || Math.round(total * 0.4);
    d.secondPayment.amount = Math.round(total * 0.8) - firstAmt;
  }

  // Final: remainder
  if (d.finalPayment?.status === "pending") {
    const paidSoFar =
      (d.firstPayment?.status === "paid" ? d.firstPayment.amount : 0) +
      (d.secondPayment?.status === "paid" ? d.secondPayment.amount : 0);
    d.finalPayment.amount = total - paidSoFar;
  }

  // Also update amountYetToPay if needed (for legacy)
  d.amountYetToPay = total - (d.paidAmount || 0);
}

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

function detectServiceType(formName, services) {
  const formLower = (formName || "").toLowerCase();
  const serviceCategories = services.map((s) =>
    (s.category || "").toLowerCase()
  );

  if (
    formLower.includes("Deep Cleaning") ||
    serviceCategories.some((cat) => cat.includes("cleaning"))
  ) {
    return "deep_cleaning";
  }
  if (
    formLower.includes("House Painting") ||
    serviceCategories.some((cat) => cat.includes("painting"))
  ) {
    return "house_painting";
  }
  if (
    formLower.includes("Home Interior") ||
    serviceCategories.some((cat) => cat.includes("Interior"))
  ) {
    return "home_interior";
  }
  if (
    formLower.includes("Packers & Movers") ||
    serviceCategories.some((cat) => cat.includes("packers"))
  ) {
    return "packers_&_movers";
  }
  // Default to deep_cleaning if unsure, or throw error
  return "deep_cleaning"; // or "other" if you prefer
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
    console.log("req.body", req.body);

    // Validation
    if (!service || !Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ message: "Service list cannot be empty." });
    }

    // Parse coordinates
    let coords = [0, 0];
    if (
      address?.location?.coordinates &&
      Array.isArray(address.location.coordinates) &&
      address.location.coordinates.length === 2 &&
      typeof address.location.coordinates[0] === "number" &&
      typeof address.location.coordinates[1] === "number"
    ) {
      coords = address.location.coordinates;
    } else {
      return res
        .status(400)
        .json({ message: "Invalid or missing address coordinates." });
    }

    // 🔍 Detect service type
    const serviceType = detectServiceType(formName, service);

    // 💰 Calculate total from services
    const originalTotalAmount = service.reduce((sum, s) => {
      return sum + Number(s.price) * Number(s.quantity || 1);
    }, 0);

    console.log("bookingDetails", bookingDetails);

    // Booking amount from frontend (paid on website)
    const bookingAmount = Number(bookingDetails?.bookingAmount) || 0;

    // ✅ Prepare bookingDetails with correct installments
    let bookingDetailsConfig = {
      bookingDate: bookingDetails?.bookingDate
        ? new Date(bookingDetails.bookingDate)
        : new Date(),
      bookingTime: bookingDetails?.bookingTime || "10:30 AM",
      status: "Pending",
      bookingAmount: 0,
      originalTotalAmount: 0,
      finalTotal: 0,
      paidAmount: bookingDetails.paidAmount,
      amountYetToPay: 0,
      paymentMethod: bookingDetails?.paymentMethod || "Cash",
      paymentStatus: bookingAmount > 0 ? "Partial Payment" : "Unpaid",
      otp: generateOTP(), // 4-digit OTP
      siteVisitCharges: 0,
      paymentLink: { isActive: false },
    };

    if (serviceType === "deep_cleaning") {
      // ✅ Deep Cleaning: total is known at booking
      const bookingAmount = Number(bookingDetails?.bookingAmount) || 0;
      const originalTotal = originalTotalAmount; // computed from service prices

      bookingDetailsConfig.bookingAmount = bookingAmount;
      bookingDetailsConfig.originalTotalAmount = originalTotal;
      bookingDetailsConfig.finalTotal = bookingAmount;
      bookingDetailsConfig.paidAmount = bookingDetails.paidAmount;
      bookingDetailsConfig.amountYetToPay = Math.max(
        0,
        bookingAmount - bookingDetails.paidAmount
      );
      bookingDetailsConfig.paymentStatus =
        bookingAmount > 0 ? "Partial Payment" : "Unpaid";

      // Installments
      bookingDetailsConfig.firstPayment = {
        status: bookingAmount > 0 ? "paid" : "pending",
        amount: bookingDetails.paidAmount,
        paidAt: bookingAmount > 0 ? new Date() : null,
        method: bookingDetails?.paymentMethod || "Cash",
      };
      bookingDetailsConfig.finalPayment = {
        status: "pending",
        amount: Math.max(0, originalTotal - bookingAmount),
      };
    } else if (serviceType === "house_painting") {
      // 🏠 House Painting: ONLY site visit charges (if any) collected now
      const siteVisitCharges = Number(bookingDetails?.siteVisitCharges) || 0;

      // All main amounts are 0 — will be set later during quotation
      bookingDetailsConfig.siteVisitCharges = siteVisitCharges;
      bookingDetailsConfig.bookingAmount = siteVisitCharges; // this is the only "advance"
      bookingDetailsConfig.paidAmount = siteVisitCharges;
      bookingDetailsConfig.paymentStatus =
        siteVisitCharges > 0 ? "Partial Payment" : "Unpaid";
      bookingDetailsConfig.amountYetToPay = 0; // because total is unknown

      // Installments: only firstPayment may have site visit amount (but usually 0)
      // We'll leave all as pending with 0 — they'll be updated in `markPendingHiring`
      bookingDetailsConfig.firstPayment = { status: "pending", amount: 0 };
      bookingDetailsConfig.secondPayment = { status: "pending", amount: 0 };
      bookingDetailsConfig.finalPayment = { status: "pending", amount: 0 };

      // originalTotalAmount & finalTotal remain 0 until quote is finalized
    }
    // Track payment line-item
    const payments =
      serviceType === "house_painting"
        ? [] // empty array for house painting
        : [
            {
              at: new Date(),
              method: "UPI", // You can replace this dynamically later once payment integration
              amount: bookingDetails.paidAmount,
              providerRef: "razorpay_order_xyz" || undefined,
            },
          ];

    // 📦 Create booking
    const booking = new UserBooking({
      customer: {
        customerId: customer?.customerId,
        name: customer?.name,
        phone: customer?.phone,
      },
      service: service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: Number(s.price),
        quantity: Number(s.quantity) || 1,
        teamMembersRequired: Number(s.teamMembersRequired) || 1,
      })),
      serviceType, // NEW FIELD
      bookingDetails: bookingDetailsConfig,
      assignedProfessional: assignedProfessional
        ? {
            professionalId: assignedProfessional.professionalId,
            name: assignedProfessional.name,
            phone: assignedProfessional.phone,
          }
        : undefined,
      address: {
        houseFlatNumber: address?.houseFlatNumber || "",
        streetArea: address?.streetArea || "",
        landMark: address?.landMark || "",
        city: address?.city || "",
        location: {
          type: "Point",
          coordinates: coords,
        },
      },
      selectedSlot: {
        slotDate: selectedSlot?.slotDate || moment().format("YYYY-MM-DD"),
        slotTime: selectedSlot?.slotTime || "10:00 AM",
      },
      payments,
      isEnquiry: Boolean(isEnquiry),
      formName: formName || "Unknown",
      createdDate: new Date(),
    });

    await booking.save();

    res.status(201).json({
      message: "Booking created successfully",
      bookingId: booking._id,
      serviceType,
      booking,
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// exports.getAllBookings = async (req, res) => {
//   try {
//     const { service, city, timePeriod, startDate, endDate } = req.query;
//     console.log({ service, city, timePeriod, startDate, endDate })

//     // Build filter
//     let filter = {};

//     // Filter by service if not 'All Services'
//     if (service && service !== 'All Services') {
//       filter['service.category'] = service; // assuming your service schema has a field like serviceName
//     }

//     // // Filter by city if not 'All Cities'
//     // if (city && city !== 'All Cities') {
//     //   filter['address.city'] = city; // assuming you have city field inside address
//     // }

//     // Filter by city if not 'All Cities'
//     if (city && city !== 'All Cities') {
//       // Get the actual city name from the map, default to user input if not found
//       const dbCity = citiesObj[city] || city;

//       // Use regex to match inside streetArea
//       filter['address.streetArea'] = { $regex: dbCity, $options: 'i' };
//     }

//     // Add date filter if provided
//     if (startDate || endDate) {
//       filter["bookingDetails.bookingDate"] = {};
//       if (startDate) {
//         filter["bookingDetails.bookingDate"].$gte = new Date(startDate);
//       }
//       if (endDate) {
//         const end = new Date(endDate);
//         end.setHours(23, 59, 59, 999); // include the whole day
//         filter["bookingDetails.bookingDate"].$lte = end;
//       }
//     }

//     console.log("filter:", filter)
//     const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
//     res.status(200).json({ bookings });
//   } catch (error) {
//     console.error("Error fetching bookings:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.getAllLeadsBookings = async (req, res) => {
//   try {
//     const { service, city, timePeriod, startDate, endDate } = req.query;
//     console.log({ service, city, timePeriod, startDate, endDate })

//     // Build filter
//     let filter = { isEnquiry: false };

//     // Filter by service if not 'All Services'
//     if (service && service !== 'All Services') {
//       filter['service.category'] = service; // assuming your service schema has a field like serviceName
//     }

//     // // Filter by city if not 'All Cities'
//     // if (city && city !== 'All Cities') {
//     //   filter['address.city'] = city; // assuming you have city field inside address
//     // }

//     // Filter by city if not 'All Cities'
//     if (city && city !== 'All Cities') {
//       // Get the actual city name from the map, default to user input if not found
//       const dbCity = citiesObj[city] || city;

//       // Use regex to match inside streetArea
//       filter['address.streetArea'] = { $regex: dbCity, $options: 'i' };
//     }

//     // Add date filter if provided
//     if (startDate || endDate) {
//       filter["bookingDetails.bookingDate"] = {};
//       if (startDate) {
//         filter["bookingDetails.bookingDate"].$gte = new Date(startDate);
//       }
//       if (endDate) {
//         const end = new Date(endDate);
//         end.setHours(23, 59, 59, 999); // include the whole day
//         filter["bookingDetails.bookingDate"].$lte = end;
//       }
//     }

//     console.log("filter:", filter)
//     const bookings = await UserBooking.find(filter).sort({
//       createdAt: -1,
//     });
//     res.status(200).json({ allLeads: bookings });
//   } catch (error) {
//     console.error("Error fetching all leads:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.getAllEnquiries = async (req, res) => {
//   try {

//     const { service, city, timePeriod, startDate, endDate } = req.query;
//     console.log({ service, city, timePeriod, startDate, endDate })

//     // Build filter
//     let filter = { isEnquiry: true };

//     // Filter by service if not 'All Services'
//     if (service && service !== 'All Services') {
//       filter['service.category'] = service; // assuming your service schema has a field like serviceName
//     }

//     // // Filter by city if not 'All Cities'
//     // if (city && city !== 'All Cities') {
//     //   filter['address.city'] = city; // assuming you have city field inside address
//     // }

//     // Filter by city if not 'All Cities'
//     if (city && city !== 'All Cities') {
//       // Get the actual city name from the map, default to user input if not found
//       const dbCity = citiesObj[city] || city;

//       // Use regex to match inside streetArea
//       filter['address.streetArea'] = { $regex: dbCity, $options: 'i' };
//     }

//     // Add date filter if provided
//     if (startDate || endDate) {
//       filter["bookingDetails.bookingDate"] = {};
//       if (startDate) {
//         filter["bookingDetails.bookingDate"].$gte = new Date(startDate);
//       }
//       if (endDate) {
//         const end = new Date(endDate);
//         end.setHours(23, 59, 59, 999); // include the whole day
//         filter["bookingDetails.bookingDate"].$lte = end;
//       }
//     }

//     console.log("filter:", filter)

//     const bookings = await UserBooking.find(filter).sort({
//       createdAt: -1,
//     });
//     res.status(200).json({ allEnquies: bookings });
//   } catch (error) {
//     console.error("Error fetching all leads:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// -----------------------------
// 📦 User Booking Controllers
// -----------------------------

exports.getAllBookings = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;
    console.log({ service, city, timePeriod, startDate, endDate });

    const filter = buildFilter({ service, city, startDate, endDate });
    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllLeadsBookings = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;
    console.log({ service, city, timePeriod, startDate, endDate });

    const filter = buildFilter({
      service,
      city,
      startDate,
      endDate,
      isEnquiry: false,
    });

    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllEnquiries = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;
    console.log({ service, city, timePeriod, startDate, endDate });

    const filter = buildFilter({
      service,
      city,
      startDate,
      endDate,
      isEnquiry: true,
    });

    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ allEnquies: bookings });
  } catch (error) {
    console.error("Error fetching all enquiries:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------
// 🔧 Shared Helper Function: buildFilter()
// ---------------------------------------

function buildFilter({ service, city, startDate, endDate, isEnquiry }) {
  const filter = {};

  if (typeof isEnquiry === "boolean") {
    filter.isEnquiry = isEnquiry;
  }

  // ✅ Filter by service
  if (service && service !== "All Services") {
    filter["service.category"] = service;
  }

  // ✅ Filter by city (using both address.city and fallback regex)
  if (city && city !== "All Cities") {
    const dbCity = citiesObj?.[city] || city;
    filter.$or = [
      { "address.city": { $regex: new RegExp(`^${dbCity}$`, "i") } },
      { "address.streetArea": { $regex: dbCity, $options: "i" } },
    ];
  }

  // ✅ Filter by date range
  if (startDate || endDate) {
    filter["bookingDetails.bookingDate"] = {};
    if (startDate) {
      filter["bookingDetails.bookingDate"].$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter["bookingDetails.bookingDate"].$lte = end;
    }
  }

  return filter;
}

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

      "bookingDetails.isJobStarted": isHousePainter ? false : true,
      "bookingDetails.startProject": isHousePainter ? false : true,

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
//     const { amount, scopeType, reasonForEditing, comment } = req.body;
//     // amount: number to add/reduce; scopeType: 'Added' | 'Reduced'

//     if (
//       !bookingId ||
//       amount == null ||
//       !["Added", "Reduced"].includes(scopeType)
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "bookingId, amount, and scopeType (Added|Reduced) are required",
//       });
//     }

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking)
//       return res
//         .status(404)
//         .json({ success: false, message: "Booking not found." });

//     const d = booking.bookingDetails || (booking.bookingDetails = {});
//     const lastApproved = (d.priceChanges || [])
//       .filter((c) => String(c.state).toLowerCase() === "approved")
//       .slice(-1)[0];

//     const kind = (booking.service[0].category || "").toLowerCase();
//     const isDeepCleaning = kind.includes("clean");

//     const state =
//       d.priceApprovalState ??
//       (d.priceApprovalStatus
//         ? "approved"
//         : d.hasPriceUpdated
//         ? "pending"
//         : "approved");

//     if (d.hasPriceUpdated && String(state).toLowerCase() === "pending") {
//       return res.status(409).json({
//         success: false,
//         message:
//           "A previous price change is awaiting approval. You cannot make another edit until it is approved or rejected.",
//       });
//     }
//     const paid = Number(d.paidAmount || 0);

//     let effectiveBase;
//     if (lastApproved && Number.isFinite(lastApproved.proposedTotal)) {
//       effectiveBase = Number(lastApproved.proposedTotal);
//     } else if (isDeepCleaning) {
//       // Deep Cleaning: base is the booking package total
//       effectiveBase = Number(d.bookingAmount || 0);
//     } else {
//       // House Painting and others
//       effectiveBase = Number(
//         (Number.isFinite(d.finalTotal) && d.finalTotal > 0
//           ? d.finalTotal
//           : null) ??
//           (Number.isFinite(d.currentTotalAmount) && d.currentTotalAmount > 0
//             ? d.currentTotalAmount
//             : null) ??
//           d.bookingAmount ??
//           0
//       );
//     }

//     // 🔑 Effective base is the latest approved total; if none, use original
//     // this one checking only for house painting
//     // const effectiveBase = Number(
//     //   d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0
//     // );

//     // now checking with both case: DC and HP
//     // With this safer version
//     // const effectiveBase = Number(
//     //   d.finalTotal && d.finalTotal > 0
//     //     ? d.finalTotal
//     //     : d.currentTotalAmount && d.currentTotalAmount > 0
//     //     ? d.currentTotalAmount
//     //     : d.bookingAmount
//     // );

//     // Signed delta (+ for Added, - for Reduced)
//     const signedDelta =
//       (scopeType === "Reduced" ? -1 : 1) * Math.abs(Number(amount));

//     const proposedTotalRaw = effectiveBase + signedDelta;

//     // Guardrails
//     if (proposedTotalRaw < paid) {
//       return res.status(400).json({
//         success: false,
//         message: `This change would make the total ₹${proposedTotalRaw}, which is less than already paid ₹${paid}. Please enter a valid amount.`,
//       });
//     }
//     if (!(proposedTotalRaw >= 0)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Proposed total would be negative." });
//     }

//     // Mark as new pending proposal
//     d.hasPriceUpdated = true;
//     d.priceApprovalState = "pending";
//     d.priceApprovalStatus = false; // legacy sync
//     d.scopeType = scopeType;
//     d.editedPrice = signedDelta; // store SIGNED delta (e.g., +500, -250)
//     d.newTotal = proposedTotalRaw; // always server-computed
//     d.priceEditedDate = new Date();
//     d.priceEditedTime = moment().format("LT");
//     d.reasonForEditing = reasonForEditing || d.reasonForEditing;
//     // d.editComment = comment || d.editComment;
//     d.approvedBy = null;
//     d.rejectedBy = null;

//     // Live preview values
//     // d.amountYetToPay = Math.max(0, d.newTotal - paid);

//     await booking.save();
//     return res.status(200).json({
//       success: true,
//       message: "Price change proposed and awaiting approval.",
//       base: effectiveBase,
//       delta: signedDelta,
//       proposedTotal: d.newTotal,
//       paidAmount: paid,
//       amountYetToPay: d.amountYetToPay,
//     });
//   } catch (error) {
//     console.error("updatePricing error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error while updating price.",
//       error: error.message,
//     });
//   }
// };

exports.requestPriceChange = async (req, res) => {
  const { bookingId } = req.params;
  const { adjustmentAmount, proposedTotal, reason, scopeType, requestedBy } =
    req.body;

  const booking = await UserBooking.findById(bookingId);
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const pendingChange = booking.bookingDetails.priceChanges.find(
    (c) => c.status === "pending"
  );
  if (pendingChange) {
    return res
      .status(400)
      .json({ error: "A price change is already pending approval" });
  }
  booking.bookingDetails.hasPriceUpdated = true;

  const newChange = {
    adjustmentAmount,
    proposedTotal: Number(proposedTotal),
    reason,
    scopeType,
    requestedBy,
    status: "pending",
    requestedAt: new Date(),
  };

  booking.bookingDetails.priceChanges.push(newChange);
  await booking.save();

  res.json({
    success: true,
    message: "Price change requested",
    change: newChange,
  });
};

exports.approvePriceChange = async (req, res) => {
  const { bookingId } = req.params;
  const { approvedBy } = req.body; // "admin" or "customer"

  const booking = await UserBooking.findById(bookingId);
  const d = booking.bookingDetails;

  const pendingChange = d.priceChanges
    .slice() // copy
    .reverse() // get latest first
    .find((c) => c.status === "pending");

  if (!pendingChange) {
    return res
      .status(400)
      .json({ error: "No pending price change to approve" });
  }

  // Approve it
  pendingChange.status = "approved";
  pendingChange.approvedBy = approvedBy;
  pendingChange.approvedAt = new Date();

  // Update finalTotal
  d.finalTotal = pendingChange.proposedTotal;

  // Recalculate unpaid installments
  recalculateInstallments(d);

  await booking.save();
  res.json({ success: true, finalTotal: d.finalTotal });
};

exports.rejectPriceChange = async (req, res) => {
  const { bookingId } = req.params;
  const { rejectedBy } = req.body;

  const booking = await UserBooking.findById(bookingId);
  const d = booking.bookingDetails;

  const pendingChange = d.priceChanges
    .slice()
    .reverse()
    .find((c) => c.status === "pending");

  if (!pendingChange) {
    return res.status(400).json({ error: "No pending price change to reject" });
  }

  pendingChange.status = "rejected";
  pendingChange.rejectedBy = rejectedBy;
  pendingChange.rejectedAt = new Date();

  await booking.save();
  res.json({ success: true, message: "Price change rejected" });
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
    booking.bookingDetails.firstPayment.status = "pending";
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
    booking.bookingDetails.firstPayment.amount =
      firstInstallment || Math.round(finalTotal * 0.4);

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
      firstPayment: d.firstPayment.status,
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

    const d = booking.bookingDetails;

    // 🔒 Must be "Project Ongoing"
    if (d.status !== "Project Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Can only request 2nd payment during 'Project Ongoing'",
      });
    }

    // 🔒 Service must be house_painting (deep cleaning doesn't have second payment)
    if (booking.serviceType !== "house_painting") {
      return res.status(400).json({
        success: false,
        message: "Second payment only applies to House Painting jobs",
      });
    }

    // 🔒 Block if there's a PENDING price change
    const hasPendingPriceChange = d.priceChanges.some(
      (change) => change.status === "pending"
    );
    if (hasPendingPriceChange) {
      return res.status(400).json({
        success: false,
        message:
          "Pending price approval. Please approve or reject the edited amount first.",
      });
    }

    // 🔒 First payment must be PAID
    if (d.firstPayment.status !== "paid") {
      return res.status(400).json({
        success: false,
        message:
          "First payment must be completed before requesting second payment",
      });
    }

    // 🔒 Second payment must NOT already be paid
    if (d.secondPayment.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Second payment has already been completed",
      });
    }

    // 💰 Use finalTotal (which reflects latest approved price)
    const finalTotal = Number(d.finalTotal);
    if (!finalTotal || finalTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: "Final total amount not set. Please finalize the quote first.",
      });
    }

    // 🧮 Calculate 80% target and second installment
    const eightyTarget = Math.round(finalTotal * 0.8);
    const paidSoFar = Number(d.paidAmount || 0);
    const secondInstallment = Math.max(0, eightyTarget - paidSoFar);

    console.log("secondInstallment", secondInstallment);

    if (secondInstallment <= 0) {
      return res.status(400).json({
        success: false,
        message: "Second installment is not due (already paid or overpaid)",
      });
    }

    // ✅ Update second payment milestone
    d.secondPayment.status = "pending";
    d.secondPayment.amount = secondInstallment;

    // 🔗 Generate payment link
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-installment2-${Date.now()}`;
    d.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
    };

    // 🏷 Update legacy paymentStatus for compatibility (optional)
    d.paymentStatus = "Partial Payment";

    await booking.save();

    return res.json({
      success: true,
      message: "Second payment link generated.",
      paymentLink: paymentLinkUrl,
      amountDue: secondInstallment,
      finalTotal,
      paidSoFar,
      secondPaymentStatus: d.secondPayment.status,
    });
  } catch (err) {
    console.error("Error requesting second payment:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// exports.requestingFinalPaymentEndProject = async (req, res) => {
//   try {
//     const { bookingId } = req.params;
//     const booking = await UserBooking.findById(bookingId);
//     if (!booking)
//       return res.status(404).json({ success: false, message: "Booking not found" });

//     const details = booking.bookingDetails;

//     // Only allow ending if job is ongoing
//     if (details.status !== "Project Ongoing") {
//       return res.status(400).json({
//         success: false,
//         message: "Only 'Project Ongoing' bookings can be requested to end",
//       });
//     }

//     // ✅ Ensure both first and second payments are paid
//     const firstPaid = details.firstPayment?.status === "paid";
//     const secondPaid = details.secondPayment?.status === "paid";

//     if (!firstPaid || !secondPaid) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "At least 80% payment (First and Second installments) required before requesting to end job",
//       });
//     }

//     // ✅ Compute latest approved total
//     const approvedPriceChange = details.priceChanges
//       ?.filter((p) => p.status === "approved")
//       .slice(-1)[0];
//     const totalExpected =
//       approvedPriceChange?.proposedTotal ||
//       details.finalTotal ||
//       details.currentTotalAmount ||
//       details.bookingAmount ||
//       0;

//     const paidSoFar = details.paidAmount || 0;
//     const finalAmount = totalExpected - paidSoFar;

//     // Record final payment setup
//     details.finalPayment.status = "pending";
//     details.finalPayment.amount = finalAmount;
//     details.jobEndRequestedAt = new Date();

//     console.log("finalAmount: ", finalAmount)

//     const paymentLinkUrl = `https://pay.example.com/${bookingId}-final-${Date.now()}`;
//     details.paymentLink = {
//       url: paymentLinkUrl,
//       isActive: true,
//       providerRef: "razorpay_order_xyz",
//     };

//     details.paymentStatus = "Waiting for final payment";
//     details.status = "Waiting for final payment";

//     await booking.save();

//     return res.json({
//       success: true,
//       message:
//         "Final payment link generated. Awaiting customer payment to complete job.",
//       bookingId: booking._id,
//       status: details.status,
//       paymentStatus: details.paymentStatus,
//       paymentLink: paymentLinkUrl,
//       amountDue: finalAmount,
//       finalPayment: details.finalPayment.status,
//     });
//   } catch (err) {
//     console.error("Error requesting job end:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: err.message,
//     });
//   }
// };

exports.requestingFinalPaymentEndProject = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await UserBooking.findById(bookingId);

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const details = booking.bookingDetails;
    const serviceType = (booking.serviceType || "").toLowerCase();

    // ✅ Only allow ending if job is ongoing
    if (
      !["project ongoing", "job ongoing"].includes(details.status.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "Only 'Project Ongoing' bookings can be requested to end",
      });
    }

    // ✅ Payment validation logic based on service type
    const firstPaid = details.firstPayment?.status === "paid";
    const secondPaid = details.secondPayment?.status === "paid";

    let allowRequest = false;
    if (serviceType === "deep_cleaning") {
      // Deep Cleaning → only first payment required
      allowRequest = firstPaid;
      if (!allowRequest) {
        return res.status(400).json({
          success: false,
          message:
            "First payment must be completed before requesting final payment.",
        });
      }
    } else {
      // House Painting → first + second payment required
      allowRequest = firstPaid && secondPaid;
      if (!allowRequest) {
        return res.status(400).json({
          success: false,
          message:
            "At least 80% payment (First and Second installments) required before requesting to end job",
        });
      }
    }

    // ✅ Compute the latest approved or final total
    const approvedPriceChange = details.priceChanges
      ?.filter((p) => p.status === "approved")
      .slice(-1)[0];

    const totalExpected =
      approvedPriceChange?.proposedTotal ||
      details.finalTotal ||
      details.currentTotalAmount ||
      details.bookingAmount ||
      0;

    const paidSoFar = details.paidAmount || 0;
    const finalAmount = totalExpected - paidSoFar;

    // ✅ Record final payment setup
    details.finalPayment = {
      status: "pending",
      amount: finalAmount,
    };

    console.log("finalAmount", finalAmount);
    details.jobEndRequestedAt = new Date();

    // ✅ Generate a fake payment link (replace later with real Razorpay call)
    const paymentLinkUrl = `https://pay.example.com/${bookingId}-final-${Date.now()}`;
    details.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
    };

    // ✅ Update status and payment status
    details.paymentStatus = "Waiting for final payment";
    details.status = "Waiting for final payment";

    await booking.save();

    return res.json({
      success: true,
      message:
        "Final payment link generated. Awaiting customer payment to complete job.",
      bookingId: booking._id,
      status: details.status,
      paymentStatus: details.paymentStatus,
      paymentLink: paymentLinkUrl,
      amountDue: finalAmount,
      finalPayment: details.finalPayment.status,
      serviceType,
    });
  } catch (err) {
    console.error("Error requesting job end:", err);
    return res.status(500).json({
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
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
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

    const serviceType = (booking.serviceType || "").toLowerCase();
    const d = booking.bookingDetails || (booking.bookingDetails = {});

    // ✅ Payment step detection
    if (
      d.firstPayment?.status === "pending" &&
      amount >= d.firstPayment.amount
    ) {
      d.firstPayment.status = "paid";
      d.firstPayment.paidAt = new Date();
      d.firstPayment.method = paymentMethod;
    } else if (
      serviceType !== "deep_cleaning" &&
      d.secondPayment?.status === "pending" &&
      amount >= d.secondPayment.amount
    ) {
      // Second payment only applies to house painting
      d.secondPayment.status = "paid";
      d.secondPayment.paidAt = new Date();
      d.secondPayment.method = paymentMethod;
    } else if (d.finalPayment?.status === "pending") {
      d.finalPayment.status = "paid";
      d.finalPayment.paidAt = new Date();
      d.finalPayment.method = paymentMethod;
    }

    // 🧠 Compute / lock final total
    let finalTotal = Number(d.finalTotal ?? 0);

    // 🧩 Deep Cleaning fallback logic
    if (serviceType === "deep_cleaning" && !(finalTotal > 0)) {
      finalTotal = Number(d.bookingAmount ?? d.siteVisitCharges ?? 0);
      if (finalTotal > 0) {
        d.finalTotal = finalTotal;
        console.log(
          `✅ Auto-updated finalTotal for Deep Cleaning: ₹${finalTotal}`
        );
      }
    }

    // 🧩 Fallback for House Painting and others
    if (!(finalTotal > 0)) {
      finalTotal = computeFinalTotal(d);
      if (finalTotal > 0) d.finalTotal = finalTotal;
    }

    if (!(finalTotal > 0)) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Finalize quote first.",
      });
    }

    // 🧩 Idempotency
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

    // ✅ Payment logic
    const currentPaid = Number(d.paidAmount || 0);
    const remaining = Math.max(0, finalTotal - currentPaid);
    if (amount > remaining) {
      return res.status(400).json({
        success: false,
        message: "Paid amount cannot exceed remaining balance",
      });
    }

    d.paymentMethod = String(paymentMethod);
    d.paidAmount = currentPaid + amount;

    // 🧩 Disable any active payment link
    if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

    // 🧾 Record payment
    booking.payments = booking.payments || [];
    booking.payments.push({
      at: new Date(),
      method: d.paymentMethod,
      amount,
      providerRef: providerRef || undefined,
    });

    // 🧩 Update milestones (only for house painting)
    if (serviceType !== "deep_cleaning") {
      ensureFirstMilestone(d);
      if (
        !d.firstMilestone.completedAt &&
        d.paidAmount >= Number(d.firstMilestone.requiredAmount || 0)
      ) {
        d.firstMilestone.completedAt = new Date();
      }
    }

    // 🧩 Recalculate derived fields
    syncDerivedFields(d, finalTotal);

    const fullyPaid = d.paidAmount >= finalTotal;
    if (fullyPaid) {
      d.paymentStatus = "Paid";

      // Mark project as completed if ongoing
      if (
        [
          "Waiting for final payment",
          "Project Ongoing",
          "Job Ongoing",
        ].includes(String(d.status))
      ) {
        d.status = "Project Completed";
        const now = new Date();
        if (booking.assignedProfessional) {
          booking.assignedProfessional.completedDate = now;
          booking.assignedProfessional.completedTime = moment().format("LT");
        }
        d.jobEndedAt = now;
      }

      // Maintain hiring info
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

      // Keep hiring active
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
      remainingAmount: Math.max(0, finalTotal - d.paidAmount),
      status: d.status,
      paymentStatus: d.paymentStatus,
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

// exports.updateBooking = async (req, res) => {
//   try {
//     const bookingId = req.params.bookingId;
//     const updateData = req.body;

//     console.log("Incoming update:", updateData);

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }

//     /* -------------------------------------------------------------
//      🧩 1. CUSTOMER UPDATE
//     ------------------------------------------------------------- */
//     if (updateData.customer) {
//       booking.customer = {
//         ...booking.customer,
//         ...updateData.customer,
//       };
//     }

//     /* -------------------------------------------------------------
//      🧩 2. SERVICE UPDATE (if service array sent)
//         Recalculate total automatically
//     ------------------------------------------------------------- */
//     if (Array.isArray(updateData.service)) {
//       booking.service = updateData.service.map((s) => ({
//         category: s.category,
//         subCategory: s.subCategory,
//         serviceName: s.serviceName,
//         price: Number(s.price || 0),
//         quantity: Number(s.quantity || 1),
//         teamMembersRequired: Number(s.teamMembersRequired || 1),
//       }));

//       // Auto recalc original total
//       const newTotal = booking.service.reduce((sum, s) => {
//         return sum + Number(s.price) * Number(s.quantity);
//       }, 0);

//       booking.bookingDetails.originalTotalAmount = newTotal;

//       // if deep cleaning → finalTotal = bookingAmount
//       if (booking.serviceType === "deep_cleaning") {
//         booking.bookingDetails.finalTotal =
//           booking.bookingDetails.bookingAmount || 0;
//       }
//     }

//     /* -------------------------------------------------------------
//      🧩 3. BOOKING DETAILS (deep merge)
//     ------------------------------------------------------------- */
//     if (updateData.bookingDetails) {
//       booking.bookingDetails = {
//         ...booking.bookingDetails,
//         ...updateData.bookingDetails,
//       };
//     }

//     /* -------------------------------------------------------------
//      🧩 4. ADDRESS UPDATE
//     ------------------------------------------------------------- */
//     if (updateData.address) {
//       booking.address = {
//         ...booking.address,
//         ...updateData.address,
//       };

//       // Validate coordinates if provided
//       if (
//         updateData.address.location &&
//         Array.isArray(updateData.address.location.coordinates)
//       ) {
//         const [lng, lat] = updateData.address.location.coordinates;

//         if (typeof lng === "number" && typeof lat === "number") {
//           booking.address.location = {
//             type: "Point",
//             coordinates: [lng, lat],
//           };
//         }
//       }
//     }

//     /* -------------------------------------------------------------
//      🧩 5. ASSIGNED PROFESSIONAL
//     ------------------------------------------------------------- */
//     if (updateData.assignedProfessional) {
//       booking.assignedProfessional = {
//         ...booking.assignedProfessional,
//         ...updateData.assignedProfessional,
//       };
//     }

//     /* -------------------------------------------------------------
//      🧩 6. SELECTED SLOT
//     ------------------------------------------------------------- */
//     if (updateData.selectedSlot) {
//       booking.selectedSlot = {
//         ...booking.selectedSlot,
//         ...updateData.selectedSlot,
//       };
//     }

//     /* -------------------------------------------------------------
//      🧩 7. PAYMENT UPDATE (append new payment)
//     ------------------------------------------------------------- */
//     if (updateData.newPayment) {
//       booking.payments.push({
//         at: new Date(),
//         amount: updateData.newPayment.amount,
//         method: updateData.newPayment.method,
//         providerRef: updateData.newPayment.providerRef || null,
//         installment: updateData.newPayment.installment || null,
//       });
//     }

//     /* -------------------------------------------------------------
//      🧩 8. isEnquiry / formName / simple flags
//     ------------------------------------------------------------- */
//     if (typeof updateData.isEnquiry === "boolean") {
//       booking.isEnquiry = updateData.isEnquiry;
//     }

//     if (updateData.formName) {
//       booking.formName = updateData.formName;
//     }

//     /* -------------------------------------------------------------
//      💾 SAVE BOOKING
//     ------------------------------------------------------------- */
//     await booking.save();

//     res.status(200).json({
//       message: "Booking updated successfully",
//       booking,
//     });

//   } catch (err) {
//     console.error("Error updating booking:", err);
//     res.status(500).json({
//       message: "Server error",
//       error: err.message,
//     });
//   }
// };


// Update address and reset selected slots
exports.updateAddressAndResetSlots = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address data is required'
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update address and reset selected slots
    booking.address = {
      houseFlatNumber: address.houseFlatNumber || booking.address.houseFlatNumber,
      streetArea: address.streetArea || booking.address.streetArea,
      landMark: address.landMark || booking.address.landMark,
      city: address.city || booking.address.city,
      location: address.location || booking.address.location
    };

    // Reset selected slots as requested
    booking.selectedSlot = {
      slotTime: "",
      slotDate: ""
    };

    await booking.save();

    res.json({
      success: true,
      message: 'Address updated and slots reset successfully',
      booking: booking
    });

  } catch (error) {
    console.error('Error updating address and slots:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update selected slot only
exports.updateSelectedSlot = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { selectedSlot } = req.body;

    if (!selectedSlot) {
      return res.status(400).json({
        success: false,
        message: 'Selected slot data is required'
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update selected slot
    booking.selectedSlot = {
      slotTime: selectedSlot.slotTime || "",
      slotDate: selectedSlot.slotDate || ""
    };

    await booking.save();

    res.json({
      success: true,
      message: 'Selected slot updated successfully',
      booking: booking
    });

  } catch (error) {
    console.error('Error updating selected slot:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update user booking (existing - modified to handle service updates properly)
exports.updateUserBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const {
      customer,
      service,
      bookingDetails,
      address,
      selectedSlot,
      isEnquiry,
      formName
    } = req.body;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update customer info
    if (customer) {
      booking.customer = {
        customerId: customer.customerId || booking.customer.customerId,
        name: customer.name || booking.customer.name,
        phone: customer.phone || booking.customer.phone
      };
    }

    // Update services and recalculate total
    if (service && Array.isArray(service)) {
      booking.service = service.map(s => ({
        category: s.category || '',
        subCategory: s.subCategory || '',
        serviceName: s.serviceName || '',
        price: s.price || 0,
        quantity: s.quantity || 1,
        teamMembersRequired: s.teamMembersRequired || 1
      }));

      // Recalculate total amount
      const totalAmount = service.reduce((sum, s) => sum + (s.price || 0), 0);
      
      // Update booking details with new total
      booking.bookingDetails.finalTotal = totalAmount;
      booking.bookingDetails.originalTotalAmount = totalAmount;
    }

    // Update booking details
    if (bookingDetails) {
      if (bookingDetails.status) booking.bookingDetails.status = bookingDetails.status;
      if (bookingDetails.paymentMethod) booking.bookingDetails.paymentMethod = bookingDetails.paymentMethod;
      if (bookingDetails.paymentStatus) booking.bookingDetails.paymentStatus = bookingDetails.paymentStatus;
      
      // Handle paid amount updates
      if (bookingDetails.paidAmount !== undefined) {
        booking.bookingDetails.paidAmount = bookingDetails.paidAmount;
        booking.bookingDetails.amountYetToPay = booking.bookingDetails.finalTotal - bookingDetails.paidAmount;
      }
    }

    // Update address
    if (address) {
      booking.address = {
        houseFlatNumber: address.houseFlatNumber || booking.address.houseFlatNumber,
        streetArea: address.streetArea || booking.address.streetArea,
        landMark: address.landMark || booking.address.landMark,
        city: address.city || booking.address.city,
        location: address.location || booking.address.location
      };
    }

    // Update selected slot
    if (selectedSlot) {
      booking.selectedSlot = {
        slotTime: selectedSlot.slotTime || "",
        slotDate: selectedSlot.slotDate || ""
      };
    }

    // Update other fields
    if (isEnquiry !== undefined) booking.isEnquiry = isEnquiry;
    if (formName) booking.formName = formName;

    await booking.save();

    res.json({
      success: true,
      message: 'Booking updated successfully',
      booking: booking
    });

  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// controllers/bookingController.js

exports.updateMarkReadStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { markRead } = req.body;

    // Validate bookingId
    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required"
      });
    }

    // Validate markRead is boolean
    if (typeof markRead !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "markRead must be a boolean value (true or false)"
      });
    }

    // Find the booking and update isRead field
    const updatedBooking = await mongoose.model("UserBookings").findByIdAndUpdate(
      bookingId,
      { 
        $set: { 
          isRead: markRead 
        } 
      },
      { 
        new: true, // Return updated document
        runValidators: true 
      }
    );

    // Check if booking exists
    if (!updatedBooking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    res.status(200).json({
      success: true,
      message: `Booking marked as ${markRead ? 'read' : 'unread'} successfully`,
      booking: updatedBooking
    });

  } catch (error) {
    console.error("Error updating markRead status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};




// exports.makePayment = async (req, res) => {
//   try {
//     const { bookingId, paymentMethod, paidAmount, providerRef } = req.body;

//     if (!bookingId || !paymentMethod || paidAmount == null) {
//       return res.status(400).json({
//         success: false,
//         message: "bookingId, paymentMethod, and paidAmount are required",
//       });
//     }

//     const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
//     if (!validPaymentMethods.includes(String(paymentMethod))) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid payment method" });
//     }

//     const amount = Number(paidAmount);
//     if (!(amount > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "Paid amount must be greater than zero",
//       });
//     }

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking)
//       return res
//         .status(404)
//         .json({ success: false, message: "Booking not found" });

//     const d = booking.bookingDetails || (booking.bookingDetails = {});

//     if (
//       d.firstPayment.status === "pending" &&
//       amount >= d.firstPayment.amount
//     ) {
//       d.firstPayment.status = "paid";
//       d.firstPayment.paidAt = new Date();
//       d.firstPayment.method = paymentMethod;
//     } else if (
//       d.secondPayment.status === "pending" &&
//       amount >= d.secondPayment.amount
//     ) {
//       d.secondPayment.status = "paid";
//       d.secondPayment.paidAt = new Date();
//       d.secondPayment.method = paymentMethod;
//     } else if (d.finalPayment.status === "pending") {
//       d.finalPayment.status = "paid";
//       d.finalPayment.paidAt = new Date();
//       d.finalPayment.method = paymentMethod;
//     }
//     // Compute/lock final total
//     const finalTotal = Number(d.finalTotal ?? computeFinalTotal(d));
//     if (!(finalTotal > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "Booking amount not set. Finalize quote first.",
//       });
//     }

//     // Idempotency by providerRef
//     if (providerRef) {
//       booking.payments = booking.payments || [];
//       const already = booking.payments.some(
//         (p) => p.providerRef === providerRef
//       );
//       if (already) {
//         return res.status(200).json({
//           success: true,
//           message: "Payment already recorded (idempotent).",
//           bookingId: booking._id,
//         });
//       }
//     }

//     const currentPaid = Number(d.paidAmount || 0);
//     const remaining = Math.max(0, finalTotal - currentPaid);
//     if (amount > remaining) {
//       return res.status(400).json({
//         success: false,
//         message: "Paid amount cannot exceed remaining balance",
//       });
//     }

//     // Apply payment
//     d.paymentMethod = String(paymentMethod);
//     d.paidAmount = currentPaid + amount;

//     // Deactivate any active link
//     if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

//     // Track payment line-item (optional)
//     booking.payments = booking.payments || [];
//     booking.payments.push({
//       at: new Date(),
//       method: d.paymentMethod,
//       amount,
//       providerRef: providerRef || undefined,
//     });

//     // Milestone: set/complete first 40% baseline (bookingAmount)
//     ensureFirstMilestone(d);
//     if (
//       !d.firstMilestone.completedAt &&
//       d.paidAmount >= Number(d.firstMilestone.requiredAmount || 0)
//     ) {
//       d.firstMilestone.completedAt = new Date();
//     }

//     // Derived fields + statuses
//     syncDerivedFields(d, finalTotal);

//     const fullyPaid = d.paidAmount >= finalTotal;
//     if (fullyPaid) {
//       d.paymentStatus = "Paid";

//       // Move to completed if was ongoing or waiting
//       if (
//         ["Waiting for final payment", "Project Ongoing"].includes(
//           String(d.status)
//         )
//       ) {
//         d.status = "Project Completed";
//         const now = new Date();
//         if (booking.assignedProfessional) {
//           booking.assignedProfessional.completedDate = now;
//           booking.assignedProfessional.completedTime = moment().format("LT");
//         }
//         d.jobEndedAt = now;
//       }

//       // Hiring coherence
//       if (booking.assignedProfessional?.hiring) {
//         booking.assignedProfessional.hiring.status = "active";
//         if (!booking.assignedProfessional.hiring.hiredDate) {
//           booking.assignedProfessional.hiring.hiredDate = new Date();
//           booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
//         }
//       }
//     } else {
//       // Partial payment thresholds
//       const ratio = d.paidAmount / finalTotal;
//       d.paymentStatus =
//         ratio >= 0.799 ? "Partially Completed" : "Partial Payment";

//       // Promote Pending → Hired on first payment
//       const statusNorm = (d.status || "").trim().toLowerCase();
//       if (["pending hiring", "pending"].includes(statusNorm)) {
//         d.status = "Hired";
//       }

//       // Hiring coherence
//       if (booking.assignedProfessional?.hiring) {
//         booking.assignedProfessional.hiring.status = "active";
//         if (!booking.assignedProfessional.hiring.hiredDate) {
//           booking.assignedProfessional.hiring.hiredDate = new Date();
//           booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
//         }
//       }
//     }

//     await booking.save();

//     return res.json({
//       success: true,
//       message: fullyPaid
//         ? "Final payment completed. Job marked as ended."
//         : "Payment received.",
//       bookingId: booking._id,
//       finalTotal,
//       totalPaid: d.paidAmount,
//       remainingAmount: d.amountYetToPay,
//       status: d.status,
//       paymentStatus: d.paymentStatus,
//       // firstMilestone: d.firstMilestone, // helpful for UI
//     });
//   } catch (err) {
//     console.error("makePayment error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error while processing payment",
//       error: err.message,
//     });
//   }
// };
