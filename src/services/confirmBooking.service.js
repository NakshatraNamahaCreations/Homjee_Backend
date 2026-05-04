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
const { toMinutes } = require("./slotAvailability.service");

const TRAVEL_MIN = 30;
const HP_DURATION = 30;

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
  const endMin = startMin + Number(durationMinutes) + TRAVEL_MIN;

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
    const bEnd = bStart + bDur + TRAVEL_MIN;

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
  holdId,
  excludeBookingId,
}) {
  await validateVendorSlotAvailable({
    vendorId,
    date,
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
