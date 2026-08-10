const cron = require("node-cron");
const moment = require("moment");
const UserBooking = require("../models/user/userBookings");
const VendorRating = require("../models/vendor/vendorRating");
const { sendWhatsAppTemplate } = require("../helpers/finbiteWhatsapp");

// Automated WhatsApp follow-ups for the House Painting flow.
//
// Each RULE is one approved template + when to send it. The cron runs every
// minute; for each rule it finds matching bookings, sends the template once,
// and marks waFollowups.<id> = true so it never repeats.
//
// Two anchor types:
//   "enquiry"  → time since the enquiry was created (createdDate). Only open
//                enquiries (isEnquiry:true, not dismissed, status Pending).
//   "startjob" → time since the vendor started the survey
//                (assignedProfessional.startedDate). Skipped once the lead has
//                moved on (hired / paying / ongoing / completed / denied).
//
// A dynamic-URL button (e.g. "Call Project Manager") passes its {{1}} suffix
// via buttons(): [{ type:"button", sub_type:"url", text:"<suffix>" }].
const EXCLUDE_STARTJOB_STATUS = [
  "Customer Denied",
  "Customer Cancelled",
  "Admin Cancelled",
  "Cancelled",
  "Pending Hiring",
  "Hired",
  "Project Ongoing",
  "Waiting for final payment",
  "Waiting for Final Payment",
  "Project Completed",
  "Job Completed",
  "Completed",
];

const RULES = [
  {
    id: "enquiryFollowup1",
    anchor: "enquiry",
    template: "hp_enquiry_followup_1",
    afterMins: 5,
    capMins: 180,
    bodyParams: () => [],
  },
  {
    id: "enquiryFollowup2",
    anchor: "enquiry",
    template: "hp_enquiry_followup_2",
    afterMins: 60,
    capMins: 6 * 60,
    bodyParams: (b) => [b?.customer?.name || "there"],
  },
  {
    id: "enquiryFollowup3",
    anchor: "enquiry",
    template: "hp_enquiry_followup_3",
    afterMins: 24 * 60,
    capMins: 48 * 60,
    bodyParams: (b) => [b?.customer?.name || "there"],
  },
  {
    // #10 — 24 h after Start Job (survey). Don't nag if they've moved forward.
    id: "followupStartJob1",
    anchor: "startjob",
    template: "hp_followup_startjob_1",
    afterMins: 24 * 60,
    capMins: 36 * 60,
    bodyParams: (b) => [b?.customer?.name || "there"],
    // "Call Project Manager" dynamic URL → homjee.com/<bookingId>
    buttons: (b) => [
      { type: "button", sub_type: "url", text: String(b._id) },
    ],
  },
  {
    // #11 — 48 h after Start Job.
    id: "followupStartJob2",
    anchor: "startjob",
    template: "hp_followup_startjob_2",
    afterMins: 48 * 60,
    capMins: 60 * 60,
    bodyParams: (b) => [b?.customer?.name || "there"],
    buttons: (b) => [
      { type: "button", sub_type: "url", text: String(b._id) },
    ],
  },
  {
    // #13 — 1 h after hiring, only if still Pending Hiring & unpaid.
    id: "bookingPaymentReminder1",
    anchor: "hiring",
    template: "hp_booking_payment_reminder_1",
    afterMins: 60,
    capMins: 6 * 60,
    bodyParams: (b) => [
      b?.customer?.name || "there",
      b?.selectedSlot?.slotDate
        ? moment(b.selectedSlot.slotDate).format("DD MMM YYYY")
        : "your date",
      String(b?.bookingDetails?.firstPayment?.requestedAmount || 0),
    ],
    // Pay Now dynamic URL = the payment page path; Call PM is a static phone.
    buttons: (b) => [
      {
        type: "button",
        sub_type: "url",
        text: String(b?.bookingDetails?.paymentLink?.url || "").replace(
          /^https?:\/\/[^/]+\//,
          "",
        ),
      },
    ],
  },
  {
    // #14 — 24 h after hiring, final reminder, still Pending Hiring & unpaid.
    id: "bookingPaymentReminder2",
    anchor: "hiring",
    template: "hp_booking_payment_reminder_2",
    afterMins: 24 * 60,
    capMins: 36 * 60,
    bodyParams: (b) => [
      b?.customer?.name || "there",
      b?.selectedSlot?.slotDate
        ? moment(b.selectedSlot.slotDate).format("DD MMM YYYY")
        : "your date",
    ],
    buttons: (b) => [
      {
        type: "button",
        sub_type: "url",
        text: String(b?.bookingDetails?.paymentLink?.url || "").replace(
          /^https?:\/\/[^/]+\//,
          "",
        ),
      },
    ],
  },
  {
    // #20 — 24 h after the 2nd-partial request, if still unpaid.
    id: "secondPartialReminder",
    anchor: "secondpartial",
    template: "hp_second_partial_reminder",
    afterMins: 24 * 60,
    capMins: 48 * 60,
    bodyParams: (b) => [
      b?.customer?.name || "there",
      String(b?.bookingDetails?.secondPayment?.requestedAmount || 0),
    ],
    buttons: (b) => [
      {
        type: "button",
        sub_type: "url",
        text: String(b?.bookingDetails?.paymentLink?.url || "").replace(
          /^https?:\/\/[^/]+\//,
          "",
        ),
      },
    ],
  },
  {
    // #22 — deep-cleaning cross-sell, ~5 min after the 2nd partial was paid.
    id: "deepCleaningCrossSell",
    anchor: "secondpaid",
    template: "hp_deep_cleaning_crosssell",
    afterMins: 5,
    capMins: 180,
    bodyParams: (b) => [b?.customer?.name || "there"],
    // Book Deep Cleaning is a static URL + Call Us is a phone → no button param.
  },
  {
    // #24 — 1 h after End Job, if the final payment is still pending.
    id: "finalPaymentReminder1",
    anchor: "endjob",
    template: "hp_final_payment_reminder_1",
    afterMins: 60,
    capMins: 12 * 60,
    guard: (b) => b?.bookingDetails?.finalPayment?.status !== "paid",
    bodyParams: (b) => [
      b?.customer?.name || "there",
      String(b?.bookingDetails?.finalPayment?.remaining || 0),
    ],
    buttons: (b) => [
      {
        type: "button",
        sub_type: "url",
        text: String(b?.bookingDetails?.paymentLink?.url || "").replace(
          /^https?:\/\/[^/]+\//,
          "",
        ),
      },
    ],
  },
  {
    // #25 — 24 h after End Job, if the final payment is still pending.
    id: "finalPaymentReminder2",
    anchor: "endjob",
    template: "hp_final_payment_reminder_2",
    afterMins: 24 * 60,
    capMins: 48 * 60,
    guard: (b) => b?.bookingDetails?.finalPayment?.status !== "paid",
    bodyParams: (b) => [
      b?.customer?.name || "there",
      String(b?.bookingDetails?.finalPayment?.remaining || 0),
    ],
    buttons: (b) => [
      {
        type: "button",
        sub_type: "url",
        text: String(b?.bookingDetails?.paymentLink?.url || "").replace(
          /^https?:\/\/[^/]+\//,
          "",
        ),
      },
    ],
  },
  {
    // #27 — 24 h after End Job, if the customer hasn't rated the vendor yet.
    id: "feedbackReminder1",
    anchor: "endjob",
    template: "hp_feedback_reminder_1",
    afterMins: 24 * 60,
    capMins: 72 * 60,
    // Async guard: skip if a rating already exists for this booking.
    guardAsync: async (b) => !(await VendorRating.exists({ bookingId: b._id })),
    bodyParams: (b) => [b?.customer?.name || "there"],
    // Rate Our Service dynamic URL → homjee.com/<bookingId>.
    buttons: (b) => [
      { type: "button", sub_type: "url", text: String(b._id) },
    ],
  },
];

function buildQuery(rule, notBefore, notAfter) {
  // Every hp_ template is House Painting only — never send to a Deep Cleaning
  // (or other) booking that shares the same flow.
  const HP = { serviceType: "house_painting" };

  if (rule.anchor === "secondpaid") {
    // #22 cross-sell: shortly after the 2nd partial was PAID.
    return {
      ...HP,
      "bookingDetails.secondPayment.paidAt": { $exists: true, $ne: null },
      [`waFollowups.${rule.id}`]: { $ne: true },
    };
  }
  if (rule.anchor === "endjob") {
    // #24/#25/#27: after End Job (jobEndRequestedAt). Extra per-rule guards
    // (final unpaid / not rated) are applied in runRule.
    return {
      ...HP,
      "bookingDetails.jobEndRequestedAt": { $exists: true, $ne: null },
      [`waFollowups.${rule.id}`]: { $ne: true },
    };
  }
  if (rule.anchor === "secondpartial") {
    // 2nd-partial reminder: anchored on when the vendor requested it. Only
    // while the second payment is still pending (not paid). Age checked in JS.
    return {
      ...HP,
      "bookingDetails.secondPayment.requestedAt": { $exists: true, $ne: null },
      "bookingDetails.secondPayment.status": { $ne: "paid" },
      [`waFollowups.${rule.id}`]: { $ne: true },
    };
  }
  if (rule.anchor === "hiring") {
    // Payment reminders: anchored on when the vendor marked hiring. Only while
    // the lead is still Pending Hiring and the advance is unpaid. Age checked
    // in JS (markedDate is a real Date, but we keep the pattern consistent).
    return {
      ...HP,
      "assignedProfessional.hiring.markedDate": { $exists: true, $ne: null },
      "bookingDetails.status": "Pending Hiring",
      $or: [
        { "bookingDetails.paidAmount": { $lte: 0 } },
        { "bookingDetails.paidAmount": { $exists: false } },
      ],
      [`waFollowups.${rule.id}`]: { $ne: true },
    };
  }
  if (rule.anchor === "startjob") {
    // Time-window on a date field can't be done reliably in Mongo when the
    // value is a "YYYY-MM-DD" string, so we fetch candidates and check the
    // age in JS (see runRule). Here we just narrow to relevant leads.
    return {
      ...HP,
      isEnquiry: false,
      "assignedProfessional.startedDate": { $exists: true, $ne: null },
      "bookingDetails.status": { $nin: EXCLUDE_STARTJOB_STATUS },
      [`waFollowups.${rule.id}`]: { $ne: true },
    };
  }
  // enquiry
  return {
    ...HP,
    isEnquiry: true,
    isDismmised: { $ne: true },
    "bookingDetails.status": "Pending",
    [`waFollowups.${rule.id}`]: { $ne: true },
    createdDate: { $gte: notBefore, $lte: notAfter },
  };
}

function anchorTime(rule, b) {
  if (rule.anchor === "secondpaid") {
    const d = b?.bookingDetails?.secondPayment?.paidAt;
    return d ? moment(d).valueOf() : null;
  }
  if (rule.anchor === "endjob") {
    const d = b?.bookingDetails?.jobEndRequestedAt;
    return d ? moment(d).valueOf() : null;
  }
  if (rule.anchor === "secondpartial") {
    const d = b?.bookingDetails?.secondPayment?.requestedAt;
    return d ? moment(d).valueOf() : null;
  }
  if (rule.anchor === "hiring") {
    const d = b?.assignedProfessional?.hiring?.markedDate;
    return d ? moment(d).valueOf() : null;
  }
  if (rule.anchor === "startjob") {
    const d = b?.assignedProfessional?.startedDate;
    return d ? moment(d).valueOf() : null;
  }
  const c = b?.createdDate || b?.createdAt;
  return c ? new Date(c).getTime() : null;
}

async function runRule(rule) {
  const now = Date.now();
  const notBefore = new Date(now - rule.capMins * 60 * 1000);
  const notAfter = new Date(now - rule.afterMins * 60 * 1000);

  const bookings = await UserBooking.find(buildQuery(rule, notBefore, notAfter))
    .limit(50)
    .lean();

  for (const b of bookings) {
    // The enquiry anchor is time-windowed in Mongo (createdDate); every other
    // anchor (startjob, hiring) enforces the window here in JS.
    if (rule.anchor !== "enquiry") {
      const t = anchorTime(rule, b);
      if (t == null) continue;
      const ageMin = (now - t) / 60000;
      if (ageMin < rule.afterMins || ageMin > rule.capMins) continue;
    }

    // Per-rule extra guards (e.g. final still unpaid, not yet rated).
    if (rule.guard && !rule.guard(b)) continue;
    if (rule.guardAsync && !(await rule.guardAsync(b))) continue;

    const phone = b?.customer?.phone;
    if (!phone) continue;
    try {
      const opts = { bodyParams: rule.bodyParams(b) };
      if (rule.buttons) opts.buttons = rule.buttons(b);
      const r = await sendWhatsAppTemplate(phone, rule.template, opts);
      if (r?.sent) {
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
