// Fan out a freshly-paid lead to every eligible vendor in the area so
// they see it in their app feed without admin having to push manually.
//
// Triggered from payment.service after isEnquiry flips to false. Uses
// the same eligibility pipeline as the website slot picker (radius +
// coins + KPI + team gates) so the pool we notify matches the "N vendors
// available" count the customer saw when picking the slot.
//
// First vendor to accept wins (handled in respondConfirmJobVendorLine).
// This function only pushes invites + in-app notifications; it never
// throws, so a fan-out hiccup can't roll back a successful payment.

const Vendor = require("../models/vendor/vendorAuth");
const UserBooking = require("../models/user/userBookings");
const vendorNotification = require("../models/notification/vendorNotification");
const { filterEligibleVendors, extractPincode } = require("../helpers/vendorEligibility");
const { buildCityMatchRegex } = require("../helpers/serviceCity");
const { computeBookingCoinPolicy } = require("../helpers/bookingCoinPolicy");
const { sendPushToVendors } = require("./pushNotification.service");

function maxTeamRequired(services) {
  return (services || []).reduce(
    (max, s) => Math.max(max, Number(s?.teamMembersRequired || 0)),
    1,
  );
}

async function fanOutLeadToEligibleVendors(booking) {
  try {
    if (!booking) return { notified: 0, reason: "no_booking" };
    if (booking.isEnquiry !== false) {
      return { notified: 0, reason: "still_enquiry" };
    }

    const bookingId = String(booking._id);
    const serviceType = booking.serviceType;
    // Read coords from BOTH the legacy flat fields and the GeoJSON
    // `address.location.coordinates: [lng, lat]`. Newer bookings only
    // populate the GeoJSON pair (no flat latitude/longitude on the
    // address subdoc), so the old `address.latitude` lookup silently
    // returned undefined and the fanout aborted with "missing_geo" —
    // which left admin's New Leads detail page stuck on the fallback
    // list, no Vendor Received timestamps.
    const flatLat = booking.address?.latitude;
    const flatLng = booking.address?.longitude;
    const geoCoords = Array.isArray(booking.address?.location?.coordinates)
      ? booking.address.location.coordinates
      : null;
    const lat =
      flatLat != null
        ? Number(flatLat)
        : geoCoords && geoCoords.length === 2
          ? Number(geoCoords[1])
          : null;
    const lng =
      flatLng != null
        ? Number(flatLng)
        : geoCoords && geoCoords.length === 2
          ? Number(geoCoords[0])
          : null;
    const city = booking.address?.city;

    if (!serviceType || lat == null || lng == null) {
      console.warn("[fanout] missing serviceType/lat/lng for booking", bookingId);
      return { notified: 0, reason: "missing_geo" };
    }

    // Same vendor pool query as buildSlotResponse — keeps the fan-out
    // pool aligned with the slot-availability pool the customer saw.
    const vendorQuery = {
      "vendor.serviceType":
        serviceType === "deep_cleaning" ? /clean/i : /paint/i,
    };
    if (city) {
      const cityRegex = buildCityMatchRegex(city);
      if (cityRegex) vendorQuery["vendor.city"] = cityRegex;
    }
    const vendors = await Vendor.find(vendorQuery).lean();
    if (!vendors.length) {
      console.warn("[fanout] no vendors matched query for booking", bookingId);
      return { notified: 0, reason: "no_vendors_in_city" };
    }

    const { requiredCoins } = await computeBookingCoinPolicy(booking);
    const minTeamMembers =
      serviceType === "deep_cleaning" ? maxTeamRequired(booking.service) : 1;

    const { eligibleVendors } = await filterEligibleVendors({
      vendors,
      lat,
      lng,
      requiredCoins,
      serviceType,
      minTeamMembers,
      bookingPincode: extractPincode(booking?.address?.streetArea),
      includeDebug: false,
    });

    if (!eligibleVendors.length) {
      console.warn("[fanout] no eligible vendors for booking", bookingId);
      return { notified: 0, reason: "no_eligible_vendors" };
    }

    // Skip vendors already invited (admin may have pre-notified some
    // before the auto-fanout fires, or this is a retry).
    const existingInvites = new Set(
      (booking.invitedVendors || []).map((iv) => String(iv?.professionalId)),
    );
    const newInvites = eligibleVendors
      .filter((v) => !existingInvites.has(String(v._id)))
      .map((v) => ({
        professionalId: String(v._id),
        invitedAt: new Date(),
        responseStatus: "pending",
      }));

    if (newInvites.length) {
      await UserBooking.updateOne(
        { _id: bookingId },
        { $push: { invitedVendors: { $each: newInvites } } },
      );
    }

    // Always create a fresh notification per eligible vendor (including
    // ones already invited) so the lead surfaces in their app even if
    // the earlier notification was read/dismissed.
    const notificationDocs = eligibleVendors.map((v) => ({
      vendorId: String(v._id),
      notificationType: "LEAD",
      thumbnailTitle: "New Lead Available",
      message:
        "A new lead has been shared with you. Open the app to view & respond.",
      status: "unread",
      metaData: {
        bookingId,
        notifiedBy: "auto",
      },
    }));
    await vendorNotification.insertMany(notificationDocs, { ordered: false });

    // Push notification with sound — the Ola/Uber-style alert (#3). Best-effort
    // and non-blocking: if Firebase isn't configured the service no-ops, and we
    // never let a push failure break the fanout. The app builds a high-priority,
    // sound-on "lead-alerts" channel notification from this.
    try {
      const pushVendorIds = eligibleVendors.map((v) => String(v._id));
      const serviceLabel =
        serviceType === "deep_cleaning" ? "Deep Cleaning" : "House Painting";
      await sendPushToVendors(pushVendorIds, {
        title: "New Lead Available 🔔",
        body: `A new ${serviceLabel} lead is waiting. Open the app to respond.`,
        channelId: "lead-alerts-v2",
        data: {
          type: "LEAD",
          bookingId: String(bookingId),
          serviceType: String(serviceType || ""),
        },
      });
    } catch (e) {
      console.error("[fanout] push send failed (non-blocking):", e?.message);
    }

    console.log(
      "[fanout] booking",
      bookingId,
      "→ invited",
      newInvites.length,
      "newly,",
      eligibleVendors.length,
      "total notifications",
    );
    return { notified: eligibleVendors.length, newInvites: newInvites.length };
  } catch (e) {
    console.error("[fanout] failed:", e?.message, e?.stack);
    return { notified: 0, reason: "error", error: e?.message };
  }
}

module.exports = { fanOutLeadToEligibleVendors };
