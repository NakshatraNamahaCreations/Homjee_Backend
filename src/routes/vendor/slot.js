// // routes/slots.js
// const express = require('express');
// const router = express.Router();
// const Vendor = require('../../models/vendor/vendorAuth');
// const UserBooking = require('../../models/user/userBookings');
// const moment = require("moment");
// router.post('/vendor/reschedule-booking/available-slots/:vendorId', async (req, res) => {
//     try {
//         const { vendorId } = req.params;
//         const { bookingId, targetDate } = req.body;

//         if (!vendorId || !bookingId || !targetDate) {
//             return res.status(400).json({ message: "Missing required fields" });
//         }

//         /* ----------------------------------------------------
//            1. Load booking being rescheduled (Customer A)
//         ---------------------------------------------------- */
//         const currentBooking = await UserBooking.findById(bookingId);
//         if (!currentBooking) {
//             return res.status(404).json({ message: "Booking not found" });
//         }
//         console.log("bookingId", bookingId)
//         const service = currentBooking.service[0];
//         const serviceDuration = service.duration; // hours
//         const teamRequired = service.teamMembersRequired;
//         // console.log("service", service)
//         /* ----------------------------------------------------
//            2. Load vendor & team
//         ---------------------------------------------------- */
//         const vendor = await Vendor.findById(vendorId);
//         if (!vendor) {
//             return res.status(404).json({ message: "Vendor not found" });
//         }

//         /* ----------------------------------------------------
//            3. Check team availability (leave check only)
//         ---------------------------------------------------- */
//         const availableTeamCount = vendor.team.filter(
//             (m) => !m.markedLeaves?.includes(targetDate)
//         ).length;

//         if (availableTeamCount < teamRequired) {
//             return res.json({ availableSlots: [] });
//         }

//         /* ----------------------------------------------------
//            4. Fetch FUTURE bookings of vendor (exclude current)
//         ---------------------------------------------------- */
//         const futureBookings = await UserBooking.find({
//             "assignedProfessional.professionalId": vendorId,
//             "selectedSlot.slotDate": targetDate,
//             "_id": { $ne: bookingId },
//             "bookingDetails.status": {
//                 $nin: ["Cancelled", "Customer Cancelled", "Admin Cancelled"],
//             },
//         });

//         /* ----------------------------------------------------
//            5. Build blocked time ranges
//            Rule: 30 min before + service + 30 min after
//         ---------------------------------------------------- */
//         const blockedRanges = futureBookings.map((b) => {
//             const start = moment(
//                 `${b.selectedSlot.slotDate} ${b.selectedSlot.slotTime}`,
//                 "YYYY-MM-DD h:mm A"
//             );

//             const duration = b.service[0].duration;

//             return {
//                 start: start.clone().subtract(30, "minutes"),
//                 end: start
//                     .clone()
//                     .add(duration, "hours")
//                     .add(30, "minutes"),
//             };
//         });

//         /* ----------------------------------------------------
//            6. Define working window
//         ---------------------------------------------------- */
//         const dayStart = moment(`${targetDate} 8:00 AM`, "YYYY-MM-DD h:mm A");
//         const dayEnd = moment(`${targetDate} 8:30 PM`, "YYYY-MM-DD h:mm A");

//         const maxServiceEnd = moment(
//             `${targetDate} 8:00 PM`,
//             "YYYY-MM-DD h:mm A"
//         );

//         const requiredTotalMinutes =
//             serviceDuration * 60 + 60; // 30 + service + 30

//         // console.log("requiredTotalMinutes", requiredTotalMinutes)
//         // console.log("availableTeamCount", availableTeamCount)
//         // console.log("teamRequired", teamRequired)
//         /* ----------------------------------------------------
//            7. Generate slots
//         ---------------------------------------------------- */
//         const availableSlots = [];
//         const now = moment();
//         const isToday = moment(targetDate, "YYYY-MM-DD").isSame(now, "day");

//         let cursor = dayStart.clone();

//         if (isToday) {
//             // Round current time to next 30-minute slot
//             const roundedNow = now.clone()
//                 .add(30 - (now.minute() % 30), "minutes")
//                 .startOf("minute");

//             if (roundedNow.isAfter(cursor)) {
//                 cursor = roundedNow;
//             }
//         }

//         while (cursor.isBefore(dayEnd)) {
//             const serviceStart = cursor.clone();
//             const serviceEnd = serviceStart
//                 .clone()
//                 .add(serviceDuration, "hours");

//             // Do not allow past slots
//             if (isToday && serviceStart.isSameOrBefore(now)) {
//                 cursor.add(30, "minutes");
//                 continue;
//             }

//             // Rule: service must end by 8:00 PM
//             if (serviceEnd.isAfter(maxServiceEnd)) break;

//             const teamBlockStart = serviceStart.clone().subtract(30, "minutes");
//             const teamBlockEnd = serviceEnd.clone().add(30, "minutes");

//             const overlaps = blockedRanges.some(
//                 (range) =>
//                     teamBlockStart.isBefore(range.end) &&
//                     teamBlockEnd.isAfter(range.start)
//             );

//             if (!overlaps) {
//                 availableSlots.push(serviceStart.format("h:mm A"));
//             }

//             cursor.add(30, "minutes");
//         }

//         return res.json({
//             date: targetDate,
//             availableSlots,
//             requiredTotalMinutes,
//             availableTeamCount
//         });
//     } catch (error) {
//         console.error("Reschedule slot error:", error);
//         return res.status(500).json({ message: "Server error" });
//     }
// });
// module.exports = router;

const express = require("express");
const router = express.Router();
const Vendor = require("../../models/vendor/vendorAuth");
const UserBooking = require("../../models/user/userBookings");
const moment = require("moment");
const mongoose = require("mongoose");

router.post(
  "/vendor/reschedule-booking/available-slots/:vendorId",
  async (req, res) => {
    try {
      const { vendorId } = req.params;
      const { bookingId, targetDate } = req.body;

      if (!vendorId || !bookingId || !targetDate) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      /* 1️⃣ Load booking being rescheduled */
      const currentBooking = await UserBooking.findById(bookingId);
      if (!currentBooking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      // ✅ Sum service durations (safe for future)
      const serviceDuration = currentBooking.service.reduce(
        (sum, s) => sum + s.duration,
        0
      );

      const teamRequired = Math.max(
        ...currentBooking.service.map((s) => s.teamMembersRequired)
      );

      /* 2️⃣ Load vendor */
      const vendor = await Vendor.findById(vendorId);
      if (!vendor) {
        return res.status(404).json({ message: "Vendor not found" });
      }

      /* 3️⃣ Team availability (leave check) */
      const availableTeamCount = vendor.team.filter(
        (m) => !m.markedLeaves?.includes(targetDate)
      ).length;

      if (availableTeamCount < teamRequired) {
        return res.json({ availableSlots: [], availableTeamCount });
      }

      /* 4️⃣ Fetch future bookings (exclude current) */
      const futureBookings = await UserBooking.find({
        "assignedProfessional.professionalId": vendorId,
        "selectedSlot.slotDate": targetDate,
        _id: { $ne: bookingId },
        "bookingDetails.status": {
          $nin: ["Cancelled", "Customer Cancelled", "Admin Cancelled"],
        },
      });

      /* 5️⃣ Build blocked ranges */
      const blockedRanges = futureBookings.map((b) => {
        const start = moment(
          `${b.selectedSlot.slotDate} ${b.selectedSlot.slotTime}`,
          "YYYY-MM-DD h:mm A"
        );

        const duration = b.service.reduce((s, x) => s + x.duration, 0);

        return {
          start: start.clone().subtract(30, "minutes"),
          end: start.clone().add(duration, "hours").add(30, "minutes"),
        };
      });

      /* 6️⃣ Working window */
      const WORK_START = moment(`${targetDate} 8:00 AM`, "YYYY-MM-DD h:mm A");
      const WORK_END = moment(`${targetDate} 8:30 PM`, "YYYY-MM-DD h:mm A");
      const SERVICE_END_LIMIT = moment(
        `${targetDate} 8:00 PM`,
        "YYYY-MM-DD h:mm A"
      );

      const requiredTotalMinutes = serviceDuration * 60 + 60;

      /* 7️⃣ Slot generation */
      const availableSlots = [];
      const now = moment();
      const isToday = moment(targetDate).isSame(now, "day");

      let cursor = WORK_START.clone();

      if (isToday) {
        const roundedNow = now
          .clone()
          .add(30 - (now.minute() % 30), "minutes")
          .startOf("minute");

        if (roundedNow.isAfter(cursor)) cursor = roundedNow;
      }

      while (cursor.isBefore(WORK_END)) {
        const serviceStart = cursor.clone();
        const serviceEnd = serviceStart.clone().add(serviceDuration, "hours");

        const teamBlockStart = serviceStart.clone().subtract(30, "minutes");
        const teamBlockEnd = serviceEnd.clone().add(30, "minutes");

        // ⛔ HARD RULES
        if (
          serviceEnd.isAfter(SERVICE_END_LIMIT) ||
          teamBlockStart.isBefore(WORK_START) ||
          teamBlockEnd.isAfter(WORK_END)
        ) {
          cursor.add(30, "minutes");
          continue;
        }

        const overlaps = blockedRanges.some(
          (range) =>
            teamBlockStart.isBefore(range.end) &&
            teamBlockEnd.isAfter(range.start)
        );

        if (!overlaps) {
          availableSlots.push(serviceStart.format("h:mm A"));
        }

        cursor.add(30, "minutes");
      }

      return res.json({
        date: targetDate,
        availableSlots,
        requiredTotalMinutes,
        availableTeamCount,
      });
    } catch (error) {
      console.error("Reschedule slot error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.put("/admin/reschedule-booking/:bookingId", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const { slotDate, slotTime } = req.query; // ✅ FROM QUERY

    if (!bookingId || !slotDate || !slotTime) {
      return res.status(400).json({
        success: false,
        message: "bookingId, slotDate and slotTime are required",
      });
    }

    const booking = await UserBooking.findById(bookingId).lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    /* --------------------------------------------------
       CHECK IF BOOKING IS ALREADY RESPONDED
    -------------------------------------------------- */

    const isAssigned = Boolean(booking.assignedProfessional?.professionalId);

    const isAcceptedVendor = booking.invitedVendors?.some(
      (v) => v.responseStatus === "accepted"
    );

    const isResponded = isAssigned || isAcceptedVendor;

    /* --------------------------------------------------
       CASE 1: NOT RESPONDED → UPDATE SAME BOOKING
    -------------------------------------------------- */

    if (!isResponded) {
      await UserBooking.updateOne(
        { _id: bookingId },
        {
          $set: {
            "selectedSlot.slotDate": slotDate,
            "selectedSlot.slotTime": slotTime,
          },
        },
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success: true,
        message: "Slot updated on existing booking",
        mode: "same-booking",
      });
    }

    /* --------------------------------------------------
       CASE 2: RESPONDED → CLONE (NO _IDs)
    -------------------------------------------------- */

    const newBooking = {
      customer: {
        customerId: booking.customer.customerId,
        name: booking.customer.name,
        phone: booking.customer.phone,
      },

      serviceType: booking.serviceType,
      isEnquiry: booking.isEnquiry,
      isRead: booking.isRead,
      isDismmised: false,
      formName: booking.formName,
      parentBookingId: booking._id,

      address: { ...booking.address },

      service: booking.service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: s.price,
        quantity: s.quantity,
        teamMembersRequired: s.teamMembersRequired,
        packageId: s.packageId,
        duration: s.duration,
      })),

      payments: (booking.payments || []).map((p) => ({
        at: p.at,
        method: p.method,
        amount: p.amount,
        providerRef: p.providerRef,
      })),

      bookingDetails: {
        ...booking.bookingDetails,
        status: "Pending",
        isJobStarted: false,
      },

      selectedSlot: {
        slotDate,
        slotTime,
      },

      invitedVendors: [],
      createdDate: new Date(),
    };

    await UserBooking.create([newBooking], { session });

    await UserBooking.updateOne(
      { _id: booking._id },
      {
        $set: {
          "bookingDetails.status": "Cancelled Rescheduled",
          isDismmised: true,
        },
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: "Booking rescheduled successfully",
      mode: "new-booking",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Reschedule booking error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reschedule booking",
    });
  }
});

module.exports = router;
