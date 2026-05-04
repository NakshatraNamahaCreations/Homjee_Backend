// Pure compute of a vendor's performance KPIs from bookings + ratings.
//
// Extracted verbatim from the formulas in
//   controllers/user/userBookings.js
//     getVendorPerformanceMetricsDeepCleaning  (~line 2388)
//     getVendorPerformanceMetricsHousePainting (~line 2586)
//
// so the existing /deep-cleaning-vendor-performance-metrics and
// /house-painting-vendor-performance-metrics endpoints AND the slot
// filter pipeline both call the same code. Any formula change happens
// here once.

const mongoose = require("mongoose");
const moment = require("moment");
const VendorRating = require("../models/vendor/vendorRating");
const UserBooking = require("../models/user/userBookings");

const FETCH_WINDOW_LIMIT = 500; // safe cap when we need to walk recent bookings

/* ============================================================
   Shared: rating + strike aggregation
============================================================ */
async function computeRatingStats(vendorId, timeframe) {
  const match = { vendorId: new mongoose.Types.ObjectId(vendorId) };

  if (timeframe === "month") {
    match.createdAt = { $gte: moment().startOf("month").toDate() };
  }

  const pipeline = [{ $match: match }, { $sort: { createdAt: -1 } }];
  if (timeframe === "last") pipeline.push({ $limit: 50 });

  pipeline.push({
    $group: {
      _id: null,
      totalRatings: { $sum: 1 },
      sumRatings: { $sum: "$rating" },
      strikes: { $sum: { $cond: [{ $lte: ["$rating", 2] }, 1, 0] } },
    },
  });

  const stats = await VendorRating.aggregate(pipeline);
  if (!stats.length || !stats[0].totalRatings) {
    return { averageRating: 0, totalRatings: 0, strikes: 0 };
  }

  return {
    averageRating: stats[0].sumRatings / stats[0].totalRatings,
    totalRatings: stats[0].totalRatings,
    strikes: stats[0].strikes || 0,
  };
}

/* ============================================================
   Deep Cleaning KPIs
   Returns: { responseRate, cancellationRate, averageGsv, totalLeads,
              respondedLeads, cancelledLeads, averageRating,
              totalRatings, strikes }
============================================================ */
async function computeDeepCleaningKpis({ vendorId, lat, long, timeframe }) {
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

  if (timeframe === "month") {
    baseQuery.createdDate = { $gte: moment().startOf("month").toDate() };
  }

  const ratingTask = computeRatingStats(vendorId, timeframe);

  let bookingsQuery = UserBooking.find(baseQuery);
  if (timeframe === "last") {
    bookingsQuery = bookingsQuery.sort({ createdDate: -1 }).limit(50);
  }
  const bookings = await bookingsQuery.exec();

  const { averageRating, totalRatings, strikes } = await ratingTask;

  if (!bookings.length) {
    return {
      responseRate: 0,
      cancellationRate: 0,
      averageGsv: 0,
      totalLeads: 0,
      respondedLeads: 0,
      cancelledLeads: 0,
      averageRating,
      totalRatings,
      strikes,
    };
  }

  // Per PDF: "Total Leads = leads sent to the vendor's New Leads page",
  // i.e. bookings where this vendor was actually invited. The legacy
  // controller (controllers/user/userBookings.js getVendorPerformanceMetricsDeepCleaning)
  // counts `bookings.length` here, which inflates the denominator with
  // nearby leads the vendor was never offered — punishing brand-new
  // vendors with responseRate = 0/N. We count invited only.
  let totalLeads = 0;
  let respondedLeads = 0;
  let cancelledLeads = 0;
  let totalRespondedGsv = 0;

  for (const booking of bookings) {
    const invite = (booking.invitedVendors || []).find(
      (v) => String(v.professionalId) === String(vendorId),
    );
    if (!invite) continue;

    totalLeads += 1;

    const status = invite.responseStatus;
    const isResponded =
      status === "accepted" || status === "customer_cancelled";

    const bookingGsv = (booking.service || []).reduce(
      (sum, s) => sum + Number(s.price || 0) * Number(s.quantity || 0),
      0,
    );

    if (isResponded) {
      respondedLeads += 1;
      totalRespondedGsv += bookingGsv;
    }

    // Vendor-cancelled within 3 hours of the booked slot — counts as a strike.
    if (
      status === "customer_cancelled" &&
      invite.cancelledBy === "internal" &&
      invite.cancelledAt
    ) {
      const bookedSlot = moment(
        `${booking?.selectedSlot?.slotDate} ${booking?.selectedSlot?.slotTime}`,
        "YYYY-MM-DD hh:mm A",
      );
      const diffHours = bookedSlot.diff(moment(invite.cancelledAt), "hours", true);
      if (diffHours >= 0 && diffHours <= 3) cancelledLeads += 1;
    }
  }

  const responseRate = totalLeads > 0 ? (respondedLeads / totalLeads) * 100 : 0;
  const cancellationRate =
    respondedLeads > 0 ? (cancelledLeads / respondedLeads) * 100 : 0;
  const averageGsv =
    respondedLeads > 0 ? totalRespondedGsv / respondedLeads : 0;

  return {
    responseRate: round2(responseRate),
    cancellationRate: round2(cancellationRate),
    averageGsv: round2(averageGsv),
    totalLeads,
    respondedLeads,
    cancelledLeads,
    averageRating: round2(averageRating),
    totalRatings,
    strikes,
  };
}

/* ============================================================
   House Painting KPIs
   Returns: { surveyRate, hiringRate, averageGsv, totalLeads,
              surveyLeads, hiredLeads, averageRating, totalRatings,
              strikes, selectedHiredCount }
============================================================ */
async function computeHousePaintingKpis({ vendorId, lat, long, timeframe }) {
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
    "service.category": "House Painting",
    isEnquiry: false,
  };

  if (timeframe === "month") {
    baseQuery.createdDate = { $gte: moment().startOf("month").toDate() };
  }

  const ratingTask = computeRatingStats(vendorId, timeframe);

  const bookings = await UserBooking.find(baseQuery)
    .sort({ createdDate: -1 })
    .limit(FETCH_WINDOW_LIMIT)
    .exec();

  const { averageRating, totalRatings, strikes } = await ratingTask;

  if (!bookings.length) {
    return {
      surveyRate: 0,
      hiringRate: 0,
      averageGsv: 0,
      totalLeads: 0,
      surveyLeads: 0,
      hiredLeads: 0,
      averageRating,
      totalRatings,
      strikes,
      selectedHiredCount: 0,
    };
  }

  let totalLeads = 0;
  let surveyLeads = 0;
  let hiredLeads = 0;
  let selectedHiredCount = 0;
  let totalSelectedHiredGsv = 0;

  for (const booking of bookings) {
    const invited = (booking.invitedVendors || []).find(
      (v) => String(v.professionalId) === String(vendorId),
    );
    const assignedToVendor =
      String(booking?.assignedProfessional?.professionalId || "") ===
      String(vendorId);

    if (!invited && !assignedToVendor) continue;
    totalLeads += 1;

    const bd = booking?.bookingDetails;
    const isSurvey =
      bd &&
      (bd.status === "Project Ongoing" ||
        bd.status === "Survey Ongoing" ||
        bd.status === "Survey Completed" ||
        !!booking?.assignedProfessional?.startedDate ||
        !!bd.isSurveyStarted);
    if (isSurvey) surveyLeads += 1;

    const isHired =
      bd &&
      (bd.status === "Hired" ||
        bd.status === "Project Ongoing" ||
        bd.status === "Waiting for final payment" ||
        bd.status === "Project Completed" ||
        (bd.firstPayment && bd.firstPayment.status === "paid") ||
        !!booking?.assignedProfessional?.hiring?.hiredDate);

    if (isHired) {
      hiredLeads += 1;
      if (selectedHiredCount < 50) {
        totalSelectedHiredGsv += Number(bd?.finalTotal || 0);
        selectedHiredCount += 1;
      }
      if (selectedHiredCount >= 50) break;
    }
  }

  const surveyRate = totalLeads > 0 ? (surveyLeads / totalLeads) * 100 : 0;
  const hiringRate = totalLeads > 0 ? (hiredLeads / totalLeads) * 100 : 0;
  const averageGsv =
    selectedHiredCount > 0 ? totalSelectedHiredGsv / selectedHiredCount : 0;

  return {
    surveyRate: round2(surveyRate),
    hiringRate: round2(hiringRate),
    averageGsv: round2(averageGsv),
    totalLeads,
    surveyLeads,
    hiredLeads,
    averageRating: round2(averageRating),
    totalRatings,
    strikes,
    selectedHiredCount,
  };
}

/* ============================================================
   Slot-filter convenience: compute KPIs for a vendor against their
   own base location. Always uses timeframe="last" (50-lead window) —
   more stable than month-to-date which is volatile early in the month.
============================================================ */
async function computeKpisForGate(vendor, serviceType) {
  const lat = vendor?.address?.latitude;
  const long = vendor?.address?.longitude;
  if (lat == null || long == null) return null;

  const params = { vendorId: vendor._id, lat, long, timeframe: "last" };
  return serviceType === "house_painting"
    ? computeHousePaintingKpis(params)
    : computeDeepCleaningKpis(params);
}

function round2(n) {
  return parseFloat(Number(n || 0).toFixed(2));
}

module.exports = {
  computeDeepCleaningKpis,
  computeHousePaintingKpis,
  computeKpisForGate,
  computeRatingStats,
};
