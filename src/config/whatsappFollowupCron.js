const cron = require("node-cron");
const UserBooking = require("../models/user/userBookings");
const { sendWhatsAppTemplate } = require("../helpers/finbiteWhatsapp");

// Automated WhatsApp follow-ups for the House Painting enquiry flow.
//
// Each entry below is one approved WhatsApp template + when to send it. The
// cron runs every minute and, for each rule, finds bookings that:
//   - are still an open enquiry (isEnquiry:true, not dismissed, status Pending
//     — i.e. the customer hasn't booked/paid yet), AND
//   - are old enough (age >= afterMins) but not ancient (age <= capMins, so a
//     fresh deploy never blasts weeks-old enquiries), AND
//   - haven't already received this follow-up (waFollowups.<id> not set).
// It sends the template, then marks waFollowups.<id> = true so it never repeats.
//
// To add follow-ups 2 and 3 once their templates are APPROVED, just add rows —
// nothing else changes. Keep bodyParams in the same order as {{1}},{{2}}… in
// the approved template.
const RULES = [
  {
    id: "enquiryFollowup1",
    template: "hp_enquiry_followup_1",
    afterMins: 5, // send 5 min after the enquiry
    capMins: 180, // ...but only for enquiries from the last 3 h
    // Template #1 has no body variables and only static buttons.
    bodyParams: () => [],
  },
  // Approve these templates, then uncomment:
  // {
  //   id: "enquiryFollowup2",
  //   template: "hp_enquiry_followup_2",
  //   afterMins: 60,
  //   capMins: 180,
  //   bodyParams: (b) => [b?.customer?.name || "there"], // {{1}} customer name
  // },
  // {
  //   id: "enquiryFollowup3",
  //   template: "hp_enquiry_followup_3",
  //   afterMins: 24 * 60,
  //   capMins: 48 * 60,
  //   bodyParams: (b) => [b?.customer?.name || "there"],
  // },
];

async function runRule(rule) {
  const now = Date.now();
  const notBefore = new Date(now - rule.capMins * 60 * 1000); // oldest allowed
  const notAfter = new Date(now - rule.afterMins * 60 * 1000); // youngest allowed

  const bookings = await UserBooking.find({
    isEnquiry: true,
    isDismmised: { $ne: true },
    "bookingDetails.status": "Pending",
    [`waFollowups.${rule.id}`]: { $ne: true },
    createdDate: { $gte: notBefore, $lte: notAfter },
  })
    .limit(50)
    .lean();

  for (const b of bookings) {
    const phone = b?.customer?.phone;
    if (!phone) continue;
    try {
      const r = await sendWhatsAppTemplate(phone, rule.template, {
        bodyParams: rule.bodyParams(b),
      });
      if (r?.sent) {
        // Mark sent so we never repeat, even if a later tick overlaps.
        await UserBooking.updateOne(
          { _id: b._id },
          { $set: { [`waFollowups.${rule.id}`]: true } },
        );
        console.log(
          `[waFollowup] ${rule.id} -> ${phone} (${b?.bookingDetails?.booking_id})`,
        );
      } else {
        console.warn(`[waFollowup] ${rule.id} not sent to ${phone}:`, r?.reason);
      }
    } catch (e) {
      console.error(`[waFollowup] ${rule.id} failed for ${b._id}:`, e?.message);
    }
  }
}

function startWhatsappFollowupCron() {
  try {
    cron.schedule("* * * * *", async () => {
      for (const rule of RULES) {
        try {
          await runRule(rule);
        } catch (e) {
          console.error(`[waFollowup] rule ${rule.id} tick error:`, e?.message);
        }
      }
    });
    console.log("[waFollowup] cron started —", RULES.length, "rule(s)");
  } catch (e) {
    console.error("[waFollowup] start error:", e?.message);
  }
}

module.exports = { startWhatsappFollowupCron };
