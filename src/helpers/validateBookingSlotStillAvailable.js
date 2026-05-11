// Re-validates that a booking's selected slot still has vendor capacity
// before we record a successful Razorpay payment. Defends against the
// "stale-tab" scenario: customer A picks 5 PM, walks away, hold expires;
// customer B grabs 5 PM and pays; customer A returns and tries to pay
// using the stale slot in their sessionStorage.
//
// Rule (concurrency-safe, single counter):
//   otherPaidBookingsForSameSlot >= eligibleVendorCount  → reject
//
// Why "paid bookings" specifically:
//   The website slot engine only blocks vendors via (a) bookings WITH
//   assignedProfessional set, or (b) Redis holds. Between "customer paid"
//   and "vendor accepted", the booking has neither. Other customers'
//   slot-fetches will still see the slot as free unless we count paid-but-
//   unassigned bookings here as commitments against vendor capacity.
//
// Why count vs slot-engine-replay:
//   Cheaper (1 countDocuments + 1 vendor query + 1 PricingConfig query),
//   and semantically equivalent for this gate: "are all eligible vendors
//   already committed to OTHER customers at this exact slot?"

const userBookings = require("../models/user/userBookings");
const Vendor = require("../models/vendor/vendorAuth");
const PricingConfig = require("../models/serviceConfig/PricingConfig");
const { filterEligibleVendors } = require("./vendorEligibility");

const CANCELLED_STATUSES = [
  "Customer Cancelled",
  "Admin Cancelled",
  "Cancelled",
];

function escapeRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ciExact(s) {
  return { $regex: new RegExp(`^${escapeRegex(s)}$`, "i") };
}

function getLatLng(booking) {
  // Mongoose stores Point coords as [lng, lat]
  const coords = booking?.address?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return { lat: null, lng: null };
  return { lng: Number(coords[0]), lat: Number(coords[1]) };
}

/**
 * Throws { statusCode: 409, message } if the slot is over-capacity.
 *
 * @param {object} booking          - Mongoose doc (or lean) of the booking being paid
 * @param {string} excludeBookingId - usually `booking._id` to exclude self
 * @param {mongoose.ClientSession} [session] - so the read joins the same MVCC snapshot
 */
async function validateBookingSlotStillAvailable({
  booking,
  excludeBookingId,
  session = null,
}) {
  const slotDate = booking?.selectedSlot?.slotDate;
  const slotTime = booking?.selectedSlot?.slotTime;
  // Legacy bookings without a stamped slot — nothing to validate.
  if (!slotDate || !slotTime) return;

  const serviceType = booking?.serviceType;
  const city = booking?.address?.city;
  // Slot-engine-driven flows only — DC + HP. Other services (interior,
  // packers) skip the gate since they don't go through the slot picker.
  if (!["deep_cleaning", "house_painting"].includes(serviceType)) return;
  if (!city) return; // can't resolve PricingConfig / vendor pool without city

  // ---- 1) Count other PAID bookings competing for the same slot ----
  // Idempotent rerun of payment-verify: exclude self via $ne.
  const otherPaidQuery = {
    _id: { $ne: excludeBookingId },
    "selectedSlot.slotDate": slotDate,
    "selectedSlot.slotTime": slotTime,
    serviceType,
    "address.city": ciExact(city),
    isEnquiry: false, // payment.service flips this to false on success
    "bookingDetails.status": { $nin: CANCELLED_STATUSES },
  };
  let cursor = userBookings.countDocuments(otherPaidQuery);
  if (session) cursor = cursor.session(session);
  const otherPaidCount = await cursor;

  if (otherPaidCount === 0) return; // no competition — definitely OK

  // ---- 2) Compute eligible vendor count for this (city, lat, lng) ----
  const { lat, lng } = getLatLng(booking);
  if (lat == null || lng == null) {
    // No usable coords on the booking — fall back to coarse "all city
    // vendors of this service type" count. Conservative against the gap.
    const total = await Vendor.countDocuments({
      "vendor.serviceType":
        serviceType === "deep_cleaning" ? /clean/i : /paint/i,
      "vendor.city": new RegExp(escapeRegex(city), "i"),
      isArchived: { $ne: true },
    });
    if (otherPaidCount >= total) {
      const err = new Error(
        "This slot is no longer available. Please choose another slot.",
      );
      err.statusCode = 409;
      throw err;
    }
    return;
  }

  // Resolve requiredCoins / minTeamMembers same way the slot controller does
  let requiredCoins = 0;
  let minTeamMembers = 1;
  if (serviceType === "house_painting") {
    const pricing = await PricingConfig.findOne({ city: ciExact(city) }).lean();
    requiredCoins = Number(pricing?.vendorCoins || 0);
  } else if (serviceType === "deep_cleaning") {
    minTeamMembers = (booking?.service || []).reduce(
      (m, s) => Math.max(m, Number(s.teamMembersRequired || 1)),
      1,
    );
    requiredCoins = (booking?.service || []).reduce(
      (s, x) => s + Number(x.coinDeduction || 0),
      0,
    );
  }

  const vendors = await Vendor.find({
    "vendor.serviceType":
      serviceType === "deep_cleaning" ? /clean/i : /paint/i,
    "vendor.city": new RegExp(escapeRegex(city), "i"),
  }).lean();

  const { eligibleVendors } = await filterEligibleVendors({
    vendors,
    lat,
    lng,
    requiredCoins,
    serviceType,
    minTeamMembers,
  });

  if (otherPaidCount >= eligibleVendors.length) {
    const err = new Error(
      "This slot is no longer available. Please choose another slot.",
    );
    err.statusCode = 409;
    throw err;
  }
}

module.exports = { validateBookingSlotStillAvailable };
