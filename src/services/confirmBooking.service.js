// Slot-conflict guard for booking writes. Two helpers:
//
//   validateVendorSlotAvailable({ vendorId, date, slotTime, durationMinutes,
//                                excludeBookingId, session })
//     Throws { status: 409, message } if the vendor already has another
//     booking whose time window overlaps. Pure read; safe to call inside
//     a Mongo transaction (pass `session` so the read joins the txn).
//
//   consumeHold({ vendorId, date, slotTime, holdId })
//     Best-effort cleanup after a successful booking commit: deletes the
//     Redis hold and invalidates the slot-availability cache. Non-blocking.
//
//   confirmAndConsumeHold(args)
//     Convenience wrapper for non-transactional callers — validates then
//     cleans up.
//
// Use validateVendorSlotAvailable INSIDE your transaction (so the find
// joins the same MVCC snapshot as your update) and consumeHold AFTER
// commit. Calling confirmAndConsumeHold is fine for simple controllers
// that aren't running their own session.

const Booking = require("../models/user/userBookings");
const { releaseHold } = require("./slotHold.service");
const { invalidateForDate } = require("./slotCache.service");
const {
  toMinutes,
  HP_TRAVEL_MIN,
  DC_TRAVEL_MIN,
} = require("./slotAvailability.service");

// Per-service-type travel buffer. Mirrors slotAvailability.service so
// the slot picker, the confirm-time guard, and the cancellation guard
// all use the same clash math. HP uses 60 min (so a 2 PM HP booking
// blocks 1 PM and 3 PM as well), DC uses 30 min.
const HP_DURATION = 30;
function travelForServiceType(serviceType) {
  return serviceType === "house_painting" ? HP_TRAVEL_MIN : DC_TRAVEL_MIN;
}

const CANCELLED_STATUSES = [
  "Customer Cancelled",
  "Admin Cancelled",
  "Cancelled",
  "Cancelled Rescheduled",
];

/**
 * Compute the time window (minutes) a booking occupies, including the
 * post-service travel buffer. Mirrors the model used by the slot engine.
 */
function computeBookingDuration(booking) {
  if (!booking) return 0;
  if (booking.serviceType === "house_painting") return HP_DURATION;
  // DC: prefer per-service `duration` array if present, else
  // bookingDetails.serviceDurationMinutes (legacy field).
  const fromServices = (booking.service || []).reduce(
    (sum, s) => sum + Number(s.duration || 0),
    0,
  );
  if (fromServices > 0) return fromServices;
  return Number(booking?.bookingDetails?.serviceDurationMinutes || 0);
}

async function validateVendorSlotAvailable({
  vendorId,
  date,
  slotTime,
  durationMinutes,
  serviceType = null,
  excludeBookingId = null,
  session = null,
}) {
  if (!vendorId || !date || !slotTime || !durationMinutes) {
    throw {
      status: 400,
      message: "vendorId, date, slotTime, durationMinutes required",
    };
  }

  const startMin = toMinutes(slotTime);
  if (startMin == null) throw { status: 400, message: `Invalid slotTime: ${slotTime}` };
  // Candidate buffer uses the REQUESTED service type. Falls back to DC
  // travel for legacy callsites that don't pass serviceType — same as
  // before this change, so no behavior regression for DC.
  const endMin = startMin + Number(durationMinutes) + travelForServiceType(serviceType);

  const query = {
    "assignedProfessional.professionalId": String(vendorId),
    "selectedSlot.slotDate": date,
    "bookingDetails.status": { $nin: CANCELLED_STATUSES },
  };
  if (excludeBookingId) query._id = { $ne: excludeBookingId };

  const cursor = Booking.find(query).select(
    "selectedSlot serviceType bookingDetails service",
  );
  const existing = session ? await cursor.session(session).lean() : await cursor.lean();

  for (const b of existing) {
    const bStart = toMinutes(b.selectedSlot?.slotTime);
    if (bStart == null) continue;
    const bDur = computeBookingDuration(b);
    if (!bDur) continue;
    // Existing booking uses ITS OWN service type's buffer so an HP
    // booking always gets the wider 60-min window even when the
    // candidate is DC, and vice-versa.
    const bEnd = bStart + bDur + travelForServiceType(b.serviceType);

    // Strict-< clash: touching boundaries are OK (matches the slot engine's
    // one-sided buffer model).
    if (startMin < bEnd && endMin > bStart) {
      throw {
        status: 409,
        message:
          "This slot was just booked by another customer. Please pick another slot.",
      };
    }
  }
}

async function consumeHold({ vendorId, date, slotTime, holdId }) {
  if (!vendorId || !date || !slotTime) return;
  await releaseHold({ vendorId, date, slotTime, holdId });
  await invalidateForDate(date);
}

async function confirmAndConsumeHold({
  vendorId,
  date,
  slotTime,
  durationMinutes,
  serviceType,
  holdId,
  excludeBookingId,
}) {
  await validateVendorSlotAvailable({
    vendorId,
    date,
    serviceType,
    slotTime,
    durationMinutes,
    excludeBookingId,
  });
  await consumeHold({ vendorId, date, slotTime, holdId });
}

module.exports = {
  computeBookingDuration,
  validateVendorSlotAvailable,
  consumeHold,
  confirmAndConsumeHold,
};
