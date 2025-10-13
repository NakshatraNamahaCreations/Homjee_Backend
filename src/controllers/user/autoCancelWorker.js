// autoCancelWorker.js
const moment = require("moment");
const UserBooking = require("../../models/user/userBookings");
const { unlockRelatedQuotesByHiring } = require("../../helpers/quotes");

// async function cancelHiringBooking(booking, reason = "auto-unpaid") {
//   try {
//     // 1) Guard: only unpaid + active hiring
//     if (booking.bookingDetails?.paymentStatus === "Paid") return;
//     if (booking.assignedProfessional?.hiring?.status === "cancelled") return;

//     // 2) Invalidate link
//     if (booking.bookingDetails?.paymentLink) {
//       booking.bookingDetails.paymentLink.isActive = false;
//     }

//     // 3) Flip statuses
//     booking.bookingDetails.status = "Completed";
//     booking.assignedProfessional.hiring.status = "cancelled";
//     booking.assignedProfessional.hiring.cancelReason = reason;
//     booking.assignedProfessional.hiring.cancelledAt = new Date();

//     // 4) (Optional) free team members for those dates
//     // await freeTeamMembersForDates(booking.assignedProfessional, booking.assignedProfessional.hiring.projectDate);

//     await booking.save();
//     await unlockRelatedQuotesByHiring(booking, reason);
//     // 5) Notify both parties (best-effort)
//     // notifyCustomer(booking.customer, 'Your booking was cancelled due to non-payment before start time. The payment link has been closed.');
//     // notifyVendor(booking.assignedProfessional.professionalId, 'Customer did not pay by 07:30 AM. Hiring cancelled automatically.');
//   } catch (e) {
//     console.error("cancelHiringBooking error", e);
//   }
// }

async function cancelHiringBooking(booking, reason = "auto-unpaid") {
  try {
    const details = booking.bookingDetails || {};
    const hiring = booking.assignedProfessional?.hiring || {};

    // ✅ GUARD 1: Skip if already cancelled
    if (hiring.status === "cancelled") return;

    // ✅ GUARD 2: Skip if ANY payment received (even partial)
    if (details.paidAmount > 0) {
      console.log(
        `[auto-cancel] Skipping booking ${booking._id} — payment received: ₹${details.paidAmount}`
      );
      return;
    }

    // ✅ GUARD 3: Skip if paymentStatus is "Paid" (redundant but safe)
    if (details.paymentStatus === "Paid") return;

    // ✅ Proceed to cancel only if truly unpaid
    console.log(
      `[auto-cancel] Cancelling booking ${booking._id} — no payment received`
    );

    // Invalidate link
    if (details.paymentLink) {
      details.paymentLink.isActive = false;
    }

    // Flip statuses
    details.status = "Survey Completed"; // or "Customer Cancelled"
    hiring.status = "cancelled";
    hiring.cancelReason = reason;
    hiring.cancelledAt = new Date();

    await booking.save();
    await unlockRelatedQuotesByHiring(booking, reason);
  } catch (e) {
    console.error("cancelHiringBooking error", e);
  }
}

async function runAutoCancelSweep() {
  try {
    const now = new Date();
    // Find bookings past autoCancelAt, still unpaid, still active hiring
    const toCancel = await UserBooking.find({
      "assignedProfessional.hiring.status": "active",
      "assignedProfessional.hiring.autoCancelAt": { $lte: now },
      "bookingDetails.paymentStatus": { $ne: "Paid" },
    }).limit(200); // batch size

    for (const booking of toCancel) {
      await cancelHiringBooking(booking, "auto-unpaid");
    }
  } catch (e) {
    console.error("runAutoCancelSweep error", e);
  }
}

// Start polling every minute
function startAutoCancelWorker() {
  runAutoCancelSweep(); // run once on boot
  setInterval(runAutoCancelSweep, 10_000); // every 10s
}

module.exports = { startAutoCancelWorker };
