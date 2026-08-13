// #4 booking-confirmation WhatsApp for a freshly-confirmed lead.
//
// Single source of truth so EVERY path that turns a booking into a real
// lead (isEnquiry=false) sends the customer the same confirmation:
//   - createBooking          (direct website/no-online-payment lead)
//   - adminCreateBooking     (admin panel lead)
//   - payment.service.verify (enquiry -> lead after an online payment)
//
// Before this, only createBooking sent #4, so admin-created leads and
// leads confirmed via online payment silently skipped the confirmation.
//
// Best-effort: never throws. HP and DC use different templates + variables.

const { sendWhatsAppTemplate } = require("./finbiteWhatsapp");

async function sendBookingConfirmation(booking) {
  try {
    const c = booking?.customer || {};
    if (!c.phone) return { sent: false, reason: "no_phone" };

    const st = booking?.serviceType;
    const date = booking?.selectedSlot?.slotDate || "";
    const time = booking?.selectedSlot?.slotTime || "";
    const addr =
      booking?.address?.streetArea ||
      booking?.address?.houseFlatNumber ||
      "your address";

    if (st === "house_painting") {
      // HP #4 — {{1}} name, {{2}} time slot, {{3}} address.
      return await sendWhatsAppTemplate(c.phone, "hp_booking_confirmation_v1", {
        bodyParams: [
          c.name || "there",
          `${date} ${time}`.trim() || "your slot",
          addr,
        ],
      });
    }

    if (st === "deep_cleaning") {
      // DC #4 — {{1}} name, {{2}} date, {{3}} time, {{4}} location.
      return await sendWhatsAppTemplate(c.phone, "dc_booking_confirmation", {
        bodyParams: [
          c.name || "there",
          date || "your date",
          time || "your time",
          addr,
        ],
      });
    }

    return { sent: false, reason: "unsupported_service" };
  } catch (e) {
    console.error("[bookingWhatsapp] confirmation failed:", e?.message);
    return { sent: false, reason: "error", error: e?.message };
  }
}

module.exports = { sendBookingConfirmation };
