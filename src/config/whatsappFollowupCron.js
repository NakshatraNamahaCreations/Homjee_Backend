const cron = require("node-cron");
const moment = require("moment");
const UserBooking = require("../models/user/userBookings");
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
];

function buildQuery(rule, notBefore, notAfter) {
  if (rule.anchor === "startjob") {
    // Time-window on a date field can't be done reliably in Mongo when the
    // value is a "YYYY-MM-DD" string, so we fetch candidates and check the
    // age in JS (see runRule). Here we just narrow to relevant leads.
    return {
      isEnquiry: false,
      "assignedProfessional.startedDate": { $exists: true, $ne: null },
      "bookingDetails.status": { $nin: EXCLUDE_STARTJOB_STATUS },
      [`waFollowups.${rule.id}`]: { $ne: true },
    };
  }
  // enquiry
  return {
    isEnquiry: true,
    isDismmised: { $ne: true },
    "bookingDetails.status": "Pending",
    [`waFollowups.${rule.id}`]: { $ne: true },
    createdDate: { $gte: notBefore, $lte: notAfter },
  };
}

function anchorTime(rule, b) {
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
    // For the startjob anchor the time window is enforced here in JS.
    if (rule.anchor === "startjob") {
      const t = anchorTime(rule, b);
      if (t == null) continue;
      const ageMin = (now - t) / 60000;
      if (ageMin < rule.afterMins || ageMin > rule.capMins) continue;
    }

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
