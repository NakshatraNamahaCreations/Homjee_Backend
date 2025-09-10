const UserBooking = require("../../models/user/userBookings");
const moment = require("moment");
const crypto = require("crypto");
const dayjs = require("dayjs");
const mongoose = require("mongoose");

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
    let slotDateUtc;

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
        paidAmount: bookingDetails.paidAmount,
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

// only for today
// exports.getBookingForNearByVendors = async (req, res) => {
//   try {
//     const { lat, long } = req.params;
//     if (!lat || !long) {
//       return res.status(400).json({ message: "Coordinates required" });
//     }
//     const now = new Date();
//     const todayStart = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate()
//     );
//     const todayEnd = new Date(
//       now.getFullYear(),
//       now.getMonth(),
//       now.getDate() + 2
//     );

//     const nearbyBookings = await UserBooking.find({
//       "address.location": {
//         $near: {
//           $geometry: {
//             type: "Point",
//             coordinates: [parseFloat(long), parseFloat(lat)],
//           },
//           $maxDistance: 5000, // 5 km
//         },
//       },
//       isEnquiry: false,
//       "bookingDetails.status": "Pending",
//       "selectedSlot.slotDate": {
//         $gte: todayStart,
//         $lt: todayEnd,
//       },
//     }).sort({ createdAt: -1 });

//     const filteredBookings = nearbyBookings.filter((booking) => {
//       const slotDate = moment(booking.selectedSlot.slotDate); // This is a Date object
//       const slotTimeStr = booking.selectedSlot.slotTime; // e.g., "01:00 PM"

//       // Combine slot date + slot time into one moment object
//       const slotDateTime = moment(
//         `${slotDate.format("YYYY-MM-DD")} ${slotTimeStr}`,
//         "YYYY-MM-DD hh:mm A"
//       );

//       // Keep only future slots
//       return slotDateTime.isAfter(moment());
//     });

//     if (!filteredBookings.length) {
//       return res
//         .status(404)
//         .json({ message: "No bookings found near this location" });
//     }

//     res.status(200).json({ bookings: filteredBookings });
//   } catch (error) {
//     console.error("Error finding nearby bookings:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.getBookingForNearByVendorsDeepCleaning = async (req, res) => {
  try {
    const { lat, long } = req.params;
    if (!lat || !long) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const now = new Date();
    // todayStart: "YYYY-MM-DD" string of today
    // const todayStart = now.toISOString().slice(0, 10);

    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);

    // dayAfterTomorrowStr: today + 2 days as "YYYY-MM-DD" string
    const dayAfterTomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)
    );

    // const dayAfterTomorrow = new Date(
    //   now.getFullYear(),
    //   now.getMonth(),
    //   now.getDate() + 2
    // );
    const dayAfterTomorrowStr = dayAfterTomorrow.toISOString().slice(0, 10);

    // console.log("todayStart:", todayStart);
    // console.log("dayAfterTomorrowStr:", dayAfterTomorrowStr);

    // Fetch bookings for today and tomorrow
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

    // console.log("Bookings found for date range:", nearbyBookings.length);

    // nearbyBookings.forEach((b) => {
    //   console.log(
    //     "Booking slotDate:",
    //     b.selectedSlot.slotDate,
    //     "slotTime:",
    //     b.selectedSlot.slotTime
    //   );
    // });

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

// exports.getDeepCleaningPerformance = async (req, res) => {
//   try {
//     const {
//       vendorId,
//       category = "Deep Cleaning",
//       scope = "month", // month | last | all | (range via start/end)
//       lastDays = 30,
//       start,
//       end,
//       debug,
//     } = req.query;

//     if (!vendorId)
//       return res.status(400).json({ message: "vendorId required" });

//     // ---- base match (by category and enquiry flag) ----
//     const baseMatch = {
//       isEnquiry: false,
//       "service.category": category,
//       // Important: denominator should include leads OFFERED to this vendor OR ASSIGNED to them
//       $or: [
//         { "assignedProfessional.professionalId": vendorId },
//         { "invitedVendors.professionalId": vendorId }, // will work if you add the schema field
//       ],
//     };

//     // ---- time window on metricDate (createdDate -> bookingDetails.bookingDate) ----
//     const window = (() => {
//       if (start && end) {
//         return {
//           $gte: dayjs(start).startOf("day").toDate(),
//           $lt: dayjs(end).endOf("day").toDate(),
//         };
//       }
//       if (scope === "all") return null;
//       if (scope === "last") {
//         const n = Number(lastDays) || 30;
//         return {
//           $gte: dayjs().subtract(n, "day").startOf("day").toDate(),
//           $lt: dayjs().endOf("day").toDate(),
//         };
//       }
//       // default month
//       return {
//         $gte: dayjs().startOf("month").toDate(),
//         $lt: dayjs().endOf("month").toDate(),
//       };
//     })();

//     const head = [
//       { $match: baseMatch },
//       {
//         $addFields: {
//           metricDate: {
//             $ifNull: ["$createdDate", "$bookingDetails.bookingDate"],
//           },

//           // pick this vendor's invite (if any)
//           vendorInvite: {
//             $first: {
//               $filter: {
//                 input: { $ifNull: ["$invitedVendors", []] },
//                 as: "iv",
//                 cond: { $eq: ["$$iv.professionalId", vendorId] },
//               },
//             },
//           },
//         },
//       },
//     ];

//     // ---- optional diagnostics to see counts/statuses ----
//     if (String(debug) === "1") {
//       const diagPipeline = [
//         ...head,
//         {
//           $facet: {
//             allForVendor: [{ $count: "n" }],
//             inWindow: [
//               ...(window ? [{ $match: { metricDate: window } }] : []),
//               { $count: "n" },
//             ],
//             byStatus: [
//               ...(window ? [{ $match: { metricDate: window } }] : []),
//               { $group: { _id: "$bookingDetails.status", count: { $sum: 1 } } },
//               { $sort: { count: -1 } },
//             ],
//             byInviteResp: [
//               ...(window ? [{ $match: { metricDate: window } }] : []),
//               {
//                 $group: {
//                   _id: "$vendorInvite.responseStatus",
//                   count: { $sum: 1 },
//                 },
//               },
//               { $sort: { count: -1 } },
//             ],
//             sample: [
//               ...(window ? [{ $match: { metricDate: window } }] : []),
//               {
//                 $project: {
//                   _id: 1,
//                   metricDate: 1,
//                   "bookingDetails.status": 1,
//                   "assignedProfessional.professionalId": 1,
//                   "vendorInvite.responseStatus": 1,
//                 },
//               },
//               { $limit: 10 },
//             ],
//           },
//         },
//       ];
//       const [diag] = await UserBooking.aggregate(diagPipeline);
//       return res.json({ scope, window, category, diag });
//     }

//     // ---- KPI pipeline ----
//     const pipeline = [
//       ...head,
//       ...(window ? [{ $match: { metricDate: window } }] : []),

//       // Compute KPIs per vendor perspective:
//       {
//         $addFields: {
//           // Responded if:
//           // - invite exists and responseStatus is not 'pending'
//           // - OR no invite recorded but booking status != Pending (fallback to your current behavior)
//           isResponded: {
//             $cond: [
//               {
//                 $gt: [
//                   { $ifNull: ["$vendorInvite.professionalId", null] },
//                   null,
//                 ],
//               },
//               {
//                 $ne: [
//                   { $ifNull: ["$vendorInvite.responseStatus", "pending"] },
//                   "pending",
//                 ],
//               },
//               { $ne: ["$bookingDetails.status", "Pending"] },
//             ],
//           },

//           // Treat these as cancellations for KPI (no vendor cancel timestamp in schema)
//           isCancelled: {
//             $in: [
//               {
//                 $ifNull: [
//                   "$vendorInvite.responseStatus",
//                   "$bookingDetails.status",
//                 ],
//               },
//               [
//                 "customer_cancelled",
//                 "unreachable",
//                 "Customer Cancelled",
//                 "Customer Unreachable",
//               ],
//             ],
//           },

//           // GSV fallback: paidAmount → Σ(service.price * quantity)
//           projectValue: {
//             $ifNull: [
//               "$bookingDetails.paidAmount",
//               {
//                 $sum: {
//                   $map: {
//                     input: { $ifNull: ["$service", []] },
//                     as: "s",
//                     in: {
//                       $multiply: [
//                         { $ifNull: ["$$s.price", 0] },
//                         { $ifNull: ["$$s.quantity", 1] },
//                       ],
//                     },
//                   },
//                 },
//               },
//             ],
//           },
//         },
//       },

//       // Collapse to KPIs
//       {
//         $group: {
//           _id: null,
//           totalLeads: { $sum: 1 }, // denominator = offered OR assigned in window
//           responded: { $sum: { $cond: ["$isResponded", 1, 0] } },
//           cancelled: { $sum: { $cond: ["$isCancelled", 1, 0] } },
//           totalGsv: { $sum: "$projectValue" },
//         },
//       },
//       {
//         $project: {
//           _id: 0,
//           totalLeads: 1,
//           response: {
//             count: "$responded",
//             percent: {
//               $cond: [
//                 { $gt: ["$totalLeads", 0] },
//                 {
//                   $round: [
//                     {
//                       $multiply: [
//                         { $divide: ["$responded", "$totalLeads"] },
//                         100,
//                       ],
//                     },
//                     2,
//                   ],
//                 },
//                 0,
//               ],
//             },
//           },
//           cancellation: {
//             count: "$cancelled",
//             percent: {
//               $cond: [
//                 { $gt: ["$responded", 0] },
//                 {
//                   $round: [
//                     {
//                       $multiply: [
//                         { $divide: ["$cancelled", "$responded"] },
//                         100,
//                       ],
//                     },
//                     2,
//                   ],
//                 },
//                 0,
//               ],
//             },
//           },
//           averageGsv: {
//             $cond: [
//               { $gt: ["$totalLeads", 0] },
//               { $round: [{ $divide: ["$totalGsv", "$totalLeads"] }, 0] },
//               0,
//             ],
//           },
//         },
//       },
//     ];

//     const out = await UserBooking.aggregate(pipeline);
//     const result = out[0] || {
//       totalLeads: 0,
//       response: { count: 0, percent: 0 },
//       cancellation: { count: 0, percent: 0 },
//       averageGsv: 0,
//     };

//     return res.json({
//       scope: start && end ? "range" : scope,
//       window: start && end ? { start, end } : undefined,
//       category,
//       ...result,
//     });
//   } catch (err) {
//     console.error("getDeepCleaningPerformance", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.getVendorPerformanceMetricsDeepCleaning = async (req, res) => {
//   try {
//     const { vendorId, lat, long, timeframe } = req.params;

//     if (!vendorId || !lat || !long || !timeframe) {
//       return res.status(400).json({
//         message: "Vendor ID, Latitude, Longitude, and Timeframe are required",
//       });
//     }

//     const baseQuery = {
//       "address.location": {
//         $near: {
//           $geometry: {
//             type: "Point",
//             coordinates: [parseFloat(long), parseFloat(lat)],
//           },
//           $maxDistance: 5000,
//         },
//       },
//       "service.category": "Deep Cleaning",
//       isEnquiry: false,
//     };

//     let query = { ...baseQuery };

//     if (timeframe === "month") {
//       const startOfMonth = moment().startOf("month").toDate();
//       query.createdDate = { $gte: startOfMonth };
//     }

//     let bookingsQuery = UserBooking.find(query);

//     if (timeframe === "last") {
//       bookingsQuery = bookingsQuery.sort({ createdDate: -1 }).limit(50);
//     }

//     const bookings = await bookingsQuery.exec();

//     if (!bookings.length) {
//       return res.status(200).json({
//         responseRate: 0,
//         cancellationRate: 0,
//         averageGsv: 0,
//         totalLeads: 0,
//         respondedLeads: 0,
//         cancelledLeads: 0,
//         timeframe: timeframe,
//       });
//     }

//     let totalLeads = 0;
//     let respondedLeads = 0;
//     let cancelledLeads = 0;
//     let totalGsv = 0;

//     bookings.forEach((booking) => {
//       totalLeads += 1;

//       // Calculate GSV for this booking
//       const bookingGsv = booking.service.reduce(
//         (sum, serviceItem) =>
//           sum + (serviceItem.price * serviceItem.quantity || 0),
//         0
//       );
//       totalGsv += bookingGsv;

//       const vendorInvitation = booking.invitedVendors.find(
//         (v) => v.professionalId === vendorId
//       );

//       if (vendorInvitation) {
//         if (vendorInvitation.responseStatus === "accepted") {
//           respondedLeads += 1;
//         }
//         if (
//           vendorInvitation.responseStatus === "customer_cancelled" || // change the status based on cancellation / vendor or customer
//           (vendorInvitation.responseStatus === "vendor_cancelled" &&
//             vendorInvitation.cancelledAt &&
//             vendorInvitation.respondedAt) // They must have accepted first
//         ) {
//           // Parse the booked slot time
//           const bookedSlot = moment(
//             `${booking.selectedSlot.slotDate} ${booking.selectedSlot.slotTime}`,
//             "YYYY-MM-DD hh:mm A"
//           );

//           const cancelledAt = moment(vendorInvitation.cancelledAt);
//           const respondedAt = moment(vendorInvitation.respondedAt);

//           // Calculate if cancellation happened within 3 hours of the booked slot
//           const hoursDiff = Math.abs(bookedSlot.diff(cancelledAt, "hours"));

//           if (hoursDiff <= 3) {
//             cancelledLeads += 1;
//           }
//         }
//       }
//     });

//     const responseRate =
//       totalLeads > 0 ? (respondedLeads / totalLeads) * 100 : 0;

//     const cancellationRate =
//       respondedLeads > 0 ? (cancelledLeads / respondedLeads) * 100 : 0;

//     // ✅ Calculate Average GSV
//     const averageGsv = totalLeads > 0 ? totalGsv / totalLeads : 0;

//     res.status(200).json({
//       responseRate: parseFloat(responseRate.toFixed(2)),
//       cancellationRate: parseFloat(cancellationRate.toFixed(2)),
//       averageGsv: parseFloat(averageGsv.toFixed(2)),
//       totalLeads,
//       respondedLeads,
//       cancelledLeads,
//       timeframe: timeframe,
//     });
//   } catch (error) {
//     console.error("Error calculating vendor performance metrics:", error);
//     res.status(500).json({ message: "Server error calculating performance" });
//   }
// };

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

    // bookings.forEach((booking) => {
    //   const vendorInvitation = booking.invitedVendors.find(
    //     (v) => v.professionalId === vendorId
    //   );

    //   // If no invitation for this vendor, skip
    //   if (!vendorInvitation) {
    //     return;
    //   }

    //   // ✅ Count every lead sent to this vendor
    //   totalLeads += 1;

    //   // Calculate GSV for this booking
    //   const bookingGsv = booking.service.reduce(
    //     (sum, serviceItem) =>
    //       sum + (serviceItem.price * serviceItem.quantity || 0),
    //     0
    //   );
    //   totalGsv += bookingGsv;

    //   // Count if vendor responded (accepted or cancelled)
    //   if (
    //     vendorInvitation.responseStatus === "accepted" ||
    //     vendorInvitation.responseStatus === "customer_cancelled"
    //   ) {
    //     respondedLeads += 1;

    //     // Check if cancelled by vendor within 3 hours
    //     if (
    //       vendorInvitation.responseStatus === "customer_cancelled" &&
    //       vendorInvitation.cancelledAt &&
    //       vendorInvitation.cancelledBy === "internal"
    //     ) {
    //       const bookedSlot = moment(
    //         `${booking.selectedSlot.slotDate} ${booking.selectedSlot.slotTime}`,
    //         "YYYY-MM-DD hh:mm A"
    //       );
    //       const cancelledAt = moment(vendorInvitation.cancelledAt);
    //       const hoursDiff = Math.abs(bookedSlot.diff(cancelledAt, "hours"));

    //       if (hoursDiff <= 3) {
    //         cancelledLeads += 1;
    //       }
    //     }
    //   }
    // });
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

// exports.respondConfirmJobVendorLine = async (req, res) => {
//   try {
//     const { bookingId, status, assignedProfessional, vendorId } = req.body;
//     // vendorId is the professional who is acting
//     if (!bookingId)
//       return res.status(400).json({ message: "bookingId is required" });
//     if (!vendorId)
//       return res
//         .status(400)
//         .json({ message: "vendorId (professionalId) is required" });

//     const updateFields = {};
//     if (status) updateFields["bookingDetails.status"] = status;
//     if (assignedProfessional)
//       updateFields.assignedProfessional = assignedProfessional;

//     // 1) Ensure invite exists (backfill if needed)
//     await UserBooking.updateOne(
//       { _id: bookingId, "invitedVendors.professionalId": { $ne: vendorId } },
//       {
//         $addToSet: {
//           invitedVendors: {
//             professionalId: vendorId,
//             invitedAt: new Date(),
//             responseStatus: "pending",
//           },
//         },
//       }
//     );

//     // 2) Update booking + invitedVendors entry atomically
//     const inviteStatus = mapStatusToInvite(status);
//     const result = await UserBooking.findOneAndUpdate(
//       { _id: bookingId },
//       {
//         $set: {
//           ...updateFields,
//           "invitedVendors.$[iv].responseStatus": inviteStatus,
//           "invitedVendors.$[iv].respondedAt": new Date(),
//         },
//       },
//       {
//         new: true,
//         arrayFilters: [{ "iv.professionalId": vendorId }],
//       }
//     );

//     if (!result) return res.status(404).json({ message: "Booking not found" });
//     return res
//       .status(200)
//       .json({ message: "Booking updated", booking: result });
//   } catch (error) {
//     console.error("Error updating booking:", error);
//     return res
//       .status(500)
//       .json({ message: "Server error", error: error.message });
//   }
// };

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

// old with unsorted slot date leads
// exports.getBookingExceptPending = async (req, res) => {
//   try {
//     const { professionalId } = req.params;
//     if (!professionalId) {
//       return res.status(400).json({ message: "Professional ID is required" });
//     }

//     // const now = new Date();
//     // const todayStart = now.toISOString().slice(0, 10);
//     // const todayEnd = new Date(
//     //   now.getFullYear(),
//     //   now.getMonth(),
//     //   now.getDate() + 2
//     // );

//     const bookings = await UserBooking.find({
//       "assignedProfessional.professionalId": professionalId,
//       "bookingDetails.status": { $ne: "Pending" },
//       // "selectedSlot.slotDate": {
//       //   $gte: todayStart,
//       //   $lt: todayEnd,
//       // },
//     }).sort().lean();

//     // const filtered = bookings.filter((booking) => {
//     //   const { slotDate, slotTime } = booking.selectedSlot || {};
//     //   if (!slotDate || !slotTime) return false;

//     //   // slotDate is Date, slotTime is string like '02:00 PM'
//     //   const dateStr = moment(slotDate).format("YYYY-MM-DD");
//     //   const slotDateTime = moment(
//     //     `${dateStr} ${slotTime}`,
//     //     "YYYY-MM-DD hh:mm A"
//     //   );

//     //   return slotDateTime.isSameOrAfter(moment());
//     // });

//     return res.status(200).json({ leadsList: bookings });
//   } catch (error) {
//     console.error("Error finding confirmed bookings:", error);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

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

    res.status(200).json({ message: "Job Completed", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const {
      bookingId,
      paidAmount,
      editedPrice,
      payToPay,
      reason,
      scope,
      hasPriceUpdated,
      paymentStatus,
    } = req.body;

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
    if (paidAmount) updateFields["bookingDetails.paidAmount"] = paidAmount;
    if (editedPrice) updateFields["bookingDetails.editedPrice"] = editedPrice;
    if (payToPay) updateFields["bookingDetails.amountYetToPay"] = payToPay;
    if (reason) updateFields["bookingDetails.reasonForChanging"] = reason;
    if (scope) updateFields["bookingDetails.scope"] = scope;
    if (hasPriceUpdated)
      updateFields["bookingDetails.hasPriceUpdated"] = hasPriceUpdated;
    if (paymentStatus)
      updateFields["bookingDetails.paymentStatus"] = paymentStatus;

    // Step 3: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true }
    );

    res.status(200).json({ message: "Price Updated", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating price:", error);
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

// // Delete booking
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
