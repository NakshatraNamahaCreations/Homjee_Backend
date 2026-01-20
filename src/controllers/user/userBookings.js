const UserBooking = require("../../models/user/userBookings");
const Quote = require("../../models/measurement/Quote");
const moment = require("moment");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const dayjs = require("dayjs");
const mongoose = require("mongoose");
const { unlockRelatedQuotesByHiring } = require("../../helpers/quotes");
const notificationSchema = require("../../models/notification/Notification");
const userSchema = require("../../models/user/userAuth");
const VendorRating = require("../../models/vendor/vendorRating");

const vendorAuthSchema = require("../../models/vendor/vendorAuth"); // adjust path
const walletTransaction = require("../../models/vendor/wallet"); // adjust path

// const redirectionUrl = "http://localhost:5173/checkout/payment/";
const redirectionUrl = "https://websitehomjee.netlify.app/checkout/payment/";
const vendorRatingURL = "https://websitehomjee.netlify.app/vendor-ratings";

const citiesObj = {
  Bangalore: "Bengaluru",
  Pune: "Pune",
};

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .trim();

function generateProviderRef() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // e.g. "20251120"
  // Generate a random 4-digit number or pull last count from DB for uniqueness
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `OMO${dateStr}${rand}`;
}

function generateBookingId() {
  // Use today's date in YYYYMMDD format
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // e.g. "20251120"
  // Generate a random 4-digit number or pull last count from DB for uniqueness
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `HJ-${dateStr}-${rand}`;
}

function generateOTP() {
  return crypto.randomInt(1000, 10000);
  // return Math.floor(1000 + Math.random() * 10000).toString();
}
const ymdLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

function recalculateInstallments(d) {
  const total = d.finalTotal;

  // First: 40%
  if (d.firstPayment?.status === "pending") {
    d.firstPayment.amount = Math.round(total * 0.4);
  }

  // Second: next 40% (total 80%)
  if (d.secondPayment?.status === "pending") {
    const firstAmt = d.firstPayment?.amount || Math.round(total * 0.4);
    d.secondPayment.amount = Math.round(total * 0.8) - firstAmt;
  }

  // Final: remainder
  if (d.finalPayment?.status === "pending") {
    const paidSoFar =
      (d.firstPayment?.status === "paid" ? d.firstPayment.amount : 0) +
      (d.secondPayment?.status === "paid" ? d.secondPayment.amount : 0);
    d.finalPayment.amount = total - paidSoFar;
  }

  // Also update amountYetToPay if needed (for legacy)
  d.amountYetToPay = total - (d.paidAmount || 0);
}

// const mapStatusToInvite = (status) => {
//   switch (status) {
//     case "Confirmed":
//       return "accepted";
//     case "Ongoing":
//       return "started";
//     case "Completed":
//       return "completed";
//     case "Customer Unreachable":
//       return "unreachable";
//     case "Customer Cancelled":
//       return "customer_cancelled";
//     // return "vendor_cancelled";
//     // if vendor explicitly declines (no booking status change), you’ll pass status='Declined' from UI
//     case "Declined":
//       return "declined";
//     default:
//       return "pending";
//   }
// };

function mapStatusToInvite(status, cancelledByFromClient) {
  switch (status) {
    case "Confirmed":
      return { responseStatus: "accepted" };

    case "Survey Ongoing":
      return { responseStatus: "started" };

    case "Survey Completed":
      return { responseStatus: "survey completed" };

    case "Customer Unreachable":
      return { responseStatus: "unreachable" };

    case "Customer Cancelled": {
      // keep your current enum; or use "vendor_cancelled" if you add it later
      const allowed = ["internal", "external"];
      const cancelledBy = allowed.includes(cancelledByFromClient)
        ? cancelledByFromClient
        : "internal"; // safer default when called from vendor app
      return {
        responseStatus: "customer_cancelled",
        cancelledBy,
        cancelledAt: new Date(),
      };
    }

    case "Declined":
      return { responseStatus: "declined" };

    default:
      return { responseStatus: "pending" };
  }
}

function buildAutoCancelAtUTC(yyyyMmDd) {
  const [Y, M, D] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, 2, 0, 0)); // 07:30 IST == 02:00 UTC
}

function computeFinalTotal(details) {
  // If already locked, use it
  if (Number.isFinite(details.finalTotal)) return Number(details.finalTotal);

  // Prefer explicit state
  const state =
    details.priceApprovalState ||
    (details.priceApprovalStatus
      ? "approved"
      : details.hasPriceUpdated
        ? "pending"
        : "approved");

  if (state === "approved" && Number.isFinite(details.newTotal)) {
    return Number(details.newTotal);
  }
  // Rejected or no edit → fall back to original bookingAmount
  return Number(details.bookingAmount || 0);
}

function syncDerivedFields(details, finalTotal) {
  const paid = Number(details.paidAmount || 0);
  details.amountYetToPay = Math.max(0, Number(finalTotal) - paid);

  // Keep legacy field in sync (so existing UI using currentTotalAmount won't break)
  details.currentTotalAmount = Number(finalTotal);
}

// -----------------------------
// works for ALL combinations: cash + online + mixed
// -----------------------------

const isFinalRequested = (d) => {
  const linkFinalActive =
    d?.paymentLink?.isActive === true &&
    String(d?.paymentLink?.installmentStage || "").toLowerCase() === "final";

  const anyFinalMoney =
    Number(d?.finalPayment?.amount || 0) > 0 ||
    Number(d?.finalPayment?.prePayment || 0) > 0;

  const finalMarked = !!d?.finalPayment?.paidAt;

  return linkFinalActive || anyFinalMoney || finalMarked;
};

const ensureMilestoneDefaults = (m = {}) => {
  m.status = m.status || "pending";
  m.amount = Number(m.amount || 0);
  m.requestedAmount = Number(m.requestedAmount || 0);
  m.remaining = Number(m.remaining || 0);
  m.method = m.method || "None";
  m.prePayment = Number(m.prePayment || 0);
  return m;
};

const syncMilestone = (m) => {
  const req = Number(m.requestedAmount || 0);
  const amt = Math.max(0, Number(m.amount || 0));
  const pre = Math.max(0, Number(m.prePayment || 0));

  const effectivePaid = Math.min(req, amt + pre);
  m.remaining = Math.max(0, req - effectivePaid);

  if (req <= 0) m.status = "pending";
  else if (effectivePaid === 0) m.status = "pending";
  else if (m.remaining === 0) m.status = "paid";
  else m.status = "partial";
};

const fixFinalTargetIfStale = (d, syncMilestone) => {
  try {
    if (!d) return;

    // ✅ DO NOTHING until final is requested
    if (!isFinalRequested(d)) return;

    d.firstPayment = d.firstPayment || {};
    d.secondPayment = d.secondPayment || {};
    d.finalPayment = d.finalPayment || {};

    const total = Number(
      d.finalTotal || d.currentTotalAmount || d.bookingAmount || 0,
    );

    const firstReq = Number(d.firstPayment.requestedAmount || 0);
    const secondReq = Number(d.secondPayment.requestedAmount || 0);

    const computedFinalTarget = Math.max(0, total - firstReq - secondReq);

    const finalNotStarted =
      Number(d.finalPayment.amount || 0) === 0 &&
      Number(d.finalPayment.prePayment || 0) === 0;

    if (finalNotStarted && total > 0 && firstReq > 0) {
      const currentFinalReq = Number(d.finalPayment.requestedAmount || 0);

      if (currentFinalReq !== computedFinalTarget) {
        d.finalPayment.requestedAmount = computedFinalTarget;
      }

      syncMilestone(d.finalPayment);
    }
  } catch (e) {
    console.error("fixFinalTargetIfStale error:", e);
  }
};

// helper to check exact paid using amount+prePayment
const isStageExactlyPaid = (m) => {
  const req = Number(m?.requestedAmount || 0);
  const amt = Number(m?.amount || 0);
  const pre = Number(m?.prePayment || 0);
  if (!(req > 0)) return false;
  return Math.min(req, amt + pre) === req;
};

// const ensureInstallmentTargets = (d, finalTotal, serviceType) => {
//   try {
//     if (!d) return;

//     // init objects
//     d.firstPayment = d.firstPayment || {
//       status: "pending",
//       amount: 0,
//       method: "None",
//       requestedAmount: 0,
//       remaining: 0,
//       prePayment: 0,
//     };

//     d.secondPayment = d.secondPayment || {
//       status: "pending",
//       amount: 0,
//       method: "None",
//       requestedAmount: 0,
//       remaining: 0,
//       prePayment: 0,
//     };

//     d.finalPayment = d.finalPayment || {
//       status: "pending",
//       amount: 0,
//       method: "None",
//       requestedAmount: 0,
//       remaining: 0,
//       prePayment: 0,
//     };

//     // store "planned targets" separately (DO NOT touch requestedAmount yet)
//     d.installmentPlan = d.installmentPlan || {};

//     const isDeepCleaning = String(serviceType).toLowerCase() === "deep_cleaning";

//     if (isDeepCleaning) {
//       // Deep cleaning: first + final
//       const firstTarget =
//         Number(d.firstPayment.requestedAmount) > 0
//           ? Number(d.firstPayment.requestedAmount)
//           : Math.round(finalTotal * 0.4); // example; use your existing formula
//       const finalTarget = Math.max(0, finalTotal - firstTarget);

//       d.installmentPlan.firstTarget = firstTarget;
//       d.installmentPlan.secondTarget = 0;
//       d.installmentPlan.finalTarget = finalTarget;

//       // ✅ keep second/final requestedAmount & remaining 0 until requested
//       if (!(Number(d.secondPayment.requestedAmount) > 0)) d.secondPayment.requestedAmount = 0;
//       if (!(Number(d.secondPayment.remaining) > 0)) d.secondPayment.remaining = 0;

//       if (d.finalPayment.status !== "paid" && !(Number(d.finalPayment.requestedAmount) > 0)) {
//         d.finalPayment.requestedAmount = 0;
//         d.finalPayment.remaining = 0;
//       }
//     } else {
//       // House painting: first + second + final
//       // Use your existing split logic here. Below is just an example.
//       const firstTarget = Math.round(finalTotal * 0.4);
//       const secondTarget = Math.round(finalTotal * 0.3);
//       const finalTarget = Math.max(0, finalTotal - firstTarget - secondTarget);

//       d.installmentPlan.firstTarget = firstTarget;
//       d.installmentPlan.secondTarget = secondTarget;
//       d.installmentPlan.finalTarget = finalTarget;

//       // ✅ keep second/final requestedAmount & remaining 0 until requested
//       if (d.secondPayment.status !== "paid" && !(Number(d.secondPayment.requestedAmount) > 0)) {
//         d.secondPayment.requestedAmount = 0;
//         d.secondPayment.remaining = 0;
//       }

//       if (d.finalPayment.status !== "paid" && !(Number(d.finalPayment.requestedAmount) > 0)) {
//         d.finalPayment.requestedAmount = 0;
//         d.finalPayment.remaining = 0;
//       }
//     }
//     // ✅ HARD RULE: finalPayment must stay 0 until requested
//     if (!isFinalRequested(d)) {
//       d.finalPayment.requestedAmount = 0;
//       d.finalPayment.remaining = 0;
//       d.finalPayment.amount = 0;     // important: prevents admin UI confusion
//       if (d.finalPayment.status !== "paid") d.finalPayment.status = "pending";
//       if (!d.finalPayment.method || d.finalPayment.method === "None") {
//         d.finalPayment.method = "None";
//       }
//     }
//   } catch (e) {
//     console.error("ensureInstallmentTargets error:", e);
//   }
// };

const ensureInstallmentTargets = (d, finalTotal, serviceType) => {
  try {
    if (!d) return;

    // init objects
    d.firstPayment = d.firstPayment || {
      status: "pending",
      amount: 0,
      method: "None",
      requestedAmount: 0,
      remaining: 0,
      prePayment: 0,
    };

    d.secondPayment = d.secondPayment || {
      status: "pending",
      amount: 0,
      method: "None",
      requestedAmount: 0,
      remaining: 0,
      prePayment: 0,
    };

    d.finalPayment = d.finalPayment || {
      status: "pending",
      amount: 0,
      method: "None",
      requestedAmount: 0,
      remaining: 0,
      prePayment: 0,
    };

    d.installmentPlan = d.installmentPlan || {};

    const isDeepCleaning =
      String(serviceType).toLowerCase() === "deep_cleaning";

    if (isDeepCleaning) {
      // Deep cleaning: first + final (keep your logic)
      const firstTarget =
        Number(d.firstPayment.requestedAmount) > 0
          ? Number(d.firstPayment.requestedAmount)
          : Math.round(finalTotal * 0.4);

      const finalTarget = Math.max(0, finalTotal - firstTarget);

      d.installmentPlan.firstTarget = firstTarget;
      d.installmentPlan.secondTarget = 0;
      d.installmentPlan.finalTarget = finalTarget;

      // keep second/final requestedAmount 0 until requested
      if (!(Number(d.secondPayment.requestedAmount) > 0)) {
        d.secondPayment.requestedAmount = 0;
        d.secondPayment.remaining = 0;
      }

      if (
        d.finalPayment.status !== "paid" &&
        !(Number(d.finalPayment.requestedAmount) > 0)
      ) {
        d.finalPayment.requestedAmount = 0;
        d.finalPayment.remaining = 0;
      }
    } else {
      // ✅ House painting: 40% / 40% / 20%
      const firstTarget =
        Number(d.firstPayment.requestedAmount) > 0
          ? Number(d.firstPayment.requestedAmount)
          : Math.round(finalTotal * 0.4);

      const secondTarget =
        Number(d.secondPayment.requestedAmount) > 0
          ? Number(d.secondPayment.requestedAmount)
          : Math.round(finalTotal * 0.4);

      const finalTarget = Math.max(0, finalTotal - firstTarget - secondTarget);

      d.installmentPlan.firstTarget = firstTarget;
      d.installmentPlan.secondTarget = secondTarget;
      d.installmentPlan.finalTarget = finalTarget;

      // keep second/final requestedAmount 0 until requested
      if (
        d.secondPayment.status !== "paid" &&
        !(Number(d.secondPayment.requestedAmount) > 0)
      ) {
        d.secondPayment.requestedAmount = 0;
        d.secondPayment.remaining = 0;
      }

      if (
        d.finalPayment.status !== "paid" &&
        !(Number(d.finalPayment.requestedAmount) > 0)
      ) {
        d.finalPayment.requestedAmount = 0;
        d.finalPayment.remaining = 0;
      }
    }
  } catch (e) {
    console.error("ensureInstallmentTargets error:", e);
  }
};

const activateInstallmentStage = (d, stage) => {
  try {
    if (!d || !stage) return;
    d.installmentPlan = d.installmentPlan || {};

    const s = String(stage).toLowerCase();

    const setTarget = (obj, planTarget) => {
      const alreadyRequested = Number(obj?.requestedAmount || 0);
      const target =
        alreadyRequested > 0
          ? alreadyRequested
          : Math.max(0, Number(planTarget || 0));

      const paid =
        Math.max(0, Number(obj.amount || 0)) +
        Math.max(0, Number(obj.prePayment || 0));

      obj.requestedAmount = target;
      obj.remaining = Math.max(0, target - paid);

      if (target <= 0) obj.status = "pending";
      else if (obj.remaining === 0) obj.status = "paid";
      else if (paid > 0) obj.status = "partial";
      else obj.status = "pending";
    };

    if (s === "first") setTarget(d.firstPayment, d.installmentPlan.firstTarget);
    if (s === "second")
      setTarget(d.secondPayment, d.installmentPlan.secondTarget);
    if (s === "final") setTarget(d.finalPayment, d.installmentPlan.finalTarget);
  } catch (e) {
    console.error("activateInstallmentStage error:", e);
  }
};

// const activateInstallmentStage = (d, stage) => {
//   try {
//     if (!d || !stage) return;
//     d.installmentPlan = d.installmentPlan || {};

//     const s = String(stage).toLowerCase();

//     const setTarget = (obj, target) => {
//       const paid = Number(obj.amount || 0) + Number(obj.prePayment || 0);
//       const t = Math.max(0, Number(target || 0));

//       obj.requestedAmount = t;
//       obj.remaining = Math.max(0, t - paid);

//       // keep status consistent
//       if (obj.remaining === 0 && t > 0) obj.status = "paid";
//       else if (t > 0) obj.status = obj.status === "paid" ? "paid" : "pending";
//     };

//     if (s === "first") setTarget(d.firstPayment, d.installmentPlan.firstTarget);
//     if (s === "second") setTarget(d.secondPayment, d.installmentPlan.secondTarget);
//     if (s === "final") setTarget(d.finalPayment, d.installmentPlan.finalTarget);
//   } catch (e) {
//     console.error("error:", e);
//   }
// };

const resyncMilestonesFromLedger = (
  d,
  paymentMethodForThisTxn,
  serviceType = "house_painting",
) => {
  const firstReq = Number(d.firstPayment.requestedAmount || 0);
  const secondReq = isDeepCleaning(serviceType)
    ? 0
    : Number(d.secondPayment.requestedAmount || 0);
  const finalReq = Number(d.finalPayment.requestedAmount || 0);

  // prePayment is already part of booking.paidAmount; subtract so it won't inflate amount buckets
  const prePay = Math.max(0, Number(d.finalPayment.prePayment || 0));
  let remainingPaid = Math.max(0, Number(d.paidAmount || 0) - prePay);

  const prevFirstStatus = d.firstPayment.status;
  const prevSecondStatus = d.secondPayment.status;
  const prevFinalStatus = d.finalPayment.status;

  // Allocate sequentially
  const firstPaid = Math.min(firstReq, remainingPaid);
  remainingPaid -= firstPaid;

  let secondPaid = 0;
  if (!isDeepCleaning(serviceType)) {
    secondPaid = Math.min(secondReq, remainingPaid);
    remainingPaid -= secondPaid;
  }

  const finalPaid = Math.min(finalReq, remainingPaid);

  d.firstPayment.amount = firstPaid;
  if (!isDeepCleaning(serviceType)) d.secondPayment.amount = secondPaid;
  d.finalPayment.amount = finalPaid;

  syncMilestone(d.firstPayment);
  syncMilestone(d.secondPayment);
  syncMilestone(d.finalPayment);

  // ✅ Keep your stale fix; but for deep cleaning, secondReq = 0 naturally
  fixFinalTargetIfStale(d, syncMilestone);

  const now = new Date();

  if (prevFirstStatus !== "paid" && d.firstPayment.status === "paid") {
    d.firstPayment.paidAt = d.firstPayment.paidAt || now;
    if (!d.firstPayment.method || d.firstPayment.method === "None") {
      d.firstPayment.method = paymentMethodForThisTxn;
    }
  }

  if (!isDeepCleaning(serviceType)) {
    if (prevSecondStatus !== "paid" && d.secondPayment.status === "paid") {
      d.secondPayment.paidAt = d.secondPayment.paidAt || now;
      if (!d.secondPayment.method || d.secondPayment.method === "None") {
        d.secondPayment.method = paymentMethodForThisTxn;
      }
    }
  }

  if (prevFinalStatus !== "paid" && d.finalPayment.status === "paid") {
    d.finalPayment.paidAt = d.finalPayment.paidAt || now;
    if (!d.finalPayment.method || d.finalPayment.method === "None") {
      d.finalPayment.method = paymentMethodForThisTxn;
    }
  }

  return { prevFinalStatus };
};

const settlePrePaymentIntoAmountIfPaid = (m) => {
  if (!m) return;

  const req = Number(m.requestedAmount || 0);
  if (!(req > 0)) return;

  const amt = Math.max(0, Number(m.amount || 0));
  const pre = Math.max(0, Number(m.prePayment || 0));

  // only settle when fully covered
  if (Math.min(req, amt + pre) !== req) return;

  // ✅ lock canonical representation
  m.amount = req; // store full target as amount
  m.prePayment = 0; // prevent double counting later
  m.remaining = 0;
  m.status = "paid";
};

const finalizeIfFullyPaid = ({ booking, bookingId, finalTotal }) => {
  try {
    const d = booking.bookingDetails || (booking.bookingDetails = {});
    const total = Number(finalTotal || d.finalTotal || 0);
    const paid = Number(d.paidAmount || 0);

    if (!(total > 0)) return false;

    const fullyPaid = paid >= total || Number(d.amountYetToPay || 0) === 0;
    if (!fullyPaid) return false;

    // ✅ Always correct paymentStatus when fully paid
    d.paymentStatus = "Paid";
    d.amountYetToPay = 0;

    // ✅ Ensure finalPayment is consistent
    d.finalPayment = d.finalPayment || {};
    if (d.finalPayment.status !== "paid") d.finalPayment.status = "paid";
    if (!d.finalPayment.paidAt) d.finalPayment.paidAt = new Date();
    if (!d.finalPayment.method || d.finalPayment.method === "None") {
      if (d.paymentMethod) d.finalPayment.method = d.paymentMethod;
    }

    // ✅ THE KEY FIX: merge prePayment into amount once fully paid
    try {
      settlePrePaymentIntoAmountIfPaid(d.finalPayment);
    } catch (e) {
      console.error("finalize settle error:", e);
    }

    // ✅ Move job status if waiting
    // if (String(d.status) === "Waiting for final payment") {
    if (
      ["Waiting for final payment", "Project Ongoing", "Job Ongoing"].includes(
        String(d.status),
      )
    ) {
      d.status = "Project Completed";
      const now = new Date();

      if (booking.assignedProfessional) {
        booking.assignedProfessional.completedDate = now;
        booking.assignedProfessional.completedTime = moment().format("LT");
      }
      d.jobEndedAt = d.jobEndedAt || now;
    }

    // ✅ Vendor rating URL (safe, idempotent)
    const customerId = booking.customer?.customerId;
    const vendorId = booking.assignedProfessional?.professionalId;
    const vendorName = booking.assignedProfessional?.name;
    const vendorPhoto = booking.assignedProfessional?.profile;

    if (vendorId && customerId && bookingId) {
      booking.vendorRatingUrl =
        booking.vendorRatingUrl ||
        `${vendorRatingURL}?vendorId=${vendorId}&bookingId=${bookingId}&customerId=${customerId}&vendorName=${vendorName}&vendorPhoto=${vendorPhoto}`;
    }

    // Maintain hiring info
    if (booking.assignedProfessional?.hiring) {
      booking.assignedProfessional.hiring.status = "active";
      if (!booking.assignedProfessional.hiring.hiredDate) {
        booking.assignedProfessional.hiring.hiredDate = new Date();
        booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
      }
    }

    return true;
  } catch (e) {
    console.error("finalizeIfFullyPaid error:", e);
    return false;
  }
};

const getServiceTypeFromBooking = (booking) =>
  String(booking?.serviceType || "").toLowerCase();

const isDeepCleaning = (serviceType) => serviceType === "deep_cleaning";

const normalizeStage = (rawStage, serviceType, d) => {
  const s = String(rawStage || "").toLowerCase();

  if (isDeepCleaning(serviceType)) {
    // deep cleaning supports only: first, final
    if (s === "first" || s === "final") return s;
    // derive safely if missing/wrong
    return d?.firstPayment?.status === "paid" ? "final" : "first";
  }

  // house painting: first, second, final
  if (["first", "second", "final"].includes(s)) return s;

  // derive safely if missing
  if (d?.secondPayment?.status === "paid") return "final";
  if (d?.firstPayment?.status === "paid") return "second";
  return "first";
};

// .........................................
function detectServiceType(formName, services) {
  const formLower = (formName || "").toLowerCase();
  const serviceCategories = services.map((s) =>
    (s.category || "").toLowerCase(),
  );

  if (
    formLower.includes("Deep Cleaning") ||
    serviceCategories.some((cat) => cat.includes("cleaning"))
  ) {
    return "deep_cleaning";
  }
  if (
    formLower.includes("House Painting") ||
    serviceCategories.some((cat) => cat.includes("painting"))
  ) {
    return "house_painting";
  }
  if (
    formLower.includes("Home Interior") ||
    serviceCategories.some((cat) => cat.includes("Interior"))
  ) {
    return "home_interior";
  }
  if (
    formLower.includes("Packers & Movers") ||
    serviceCategories.some((cat) => cat.includes("packers"))
  ) {
    return "packers_&_movers";
  }
  // Default to deep_cleaning if unsure, or throw error
  return "deep_cleaning"; // or "other" if you prefer
}

const CANCELLED_STATUSES = Object.freeze([
  "Customer Cancelled",
  "Admin Cancelled",
  "Cancelled",
]);

// ..........................API's.......................................
// BOOKED FROM THE WEBSITE
exports.createBooking = async (req, res) => {
  try {
    const {
      customer,
      service,
      bookingDetails,
      assignedProfessional,
      address,
      selectedSlot,
      isEnquiry,
      formName,
    } = req.body;

    let checkUserIsExistOrNot = await userSchema.findOne({
      mobileNumber: customer.phone,
    });
    if (!checkUserIsExistOrNot) {
      checkUserIsExistOrNot = new userSchema({
        userName: customer.name,
        mobileNumber: customer.phone,
        savedAddress: {
          uniqueCode: `ADDR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          address: address.streetArea,
          houseNumber: address.houseFlatNumber,
          landmark: address.landMark,
          latitude: address.location.coordinates[1],
          longitude: address.location.coordinates[0],
          city: address.city,
        },
      });
      await checkUserIsExistOrNot.save();
    }
    // Validation
    if (!service || !Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ message: "Service list cannot be empty." });
    }

    // Address coords validation
    let coords = [0, 0];
    if (
      address?.location?.coordinates &&
      Array.isArray(address.location.coordinates) &&
      address.location.coordinates.length === 2 &&
      typeof address.location.coordinates[0] === "number" &&
      typeof address.location.coordinates[1] === "number"
    ) {
      coords = address.location.coordinates;
    } else {
      return res
        .status(400)
        .json({ message: "Invalid or missing address coordinates." });
    }

    // Service type detection
    const serviceType = detectServiceType(formName, service);

    // Deep Cleaning: Amounts calculated from cart and packages
    let bookingAmount = 0,
      originalTotalAmount = 0,
      paidAmount = 0,
      amountYetToPay = 0,
      siteVisitCharges = 0;
    let firstPayment = {},
      finalPayment = {},
      secondPayment = {};

    if (serviceType === "deep_cleaning") {
      // Find package booking amounts by cart item name
      // const result = service.map((cartItem) => {
      //   const pkg = packageMaster.find((p) => p.name === cartItem.serviceName);
      //   return pkg ? pkg.bookingAmount : 0;
      // });
      // const result = service.reduce((acc, val) => acc + val.price * (val.quantity || 1), 0)

      // bookingAmount = result.reduce((sum, amt) => sum + Number(amt || 0), 0);
      originalTotalAmount = service.reduce(
        (sum, itm) => sum + Number(itm.price) * (itm.quantity || 1),
        0,
      );
      bookingAmount = Math.round(originalTotalAmount * 0.2); //originalTotalAmount    // 20%
      // bookingAmount = Math.round(originalTotalAmount * 0.2); //originalTotalAmount    // 20%

      paidAmount = bookingAmount; // Math.round(originalTotalAmount * 0.2); // Or assign from bookingDetails if user paid already
      amountYetToPay = originalTotalAmount - paidAmount;

      firstPayment = {
        status: paidAmount > 0 ? "paid" : "pending",
        amount: paidAmount,
        paidAt: paidAmount > 0 ? new Date() : null,
        method: "UPI",
        requestedAmount: paidAmount || bookingAmount,
        remaining: paidAmount || bookingAmount,
        prePayment: 0,
      };
      finalPayment = {
        status: "pending",
        amount: 0,
        // amount: Math.max(0, originalTotalAmount - paidAmount),
      };
    }

    if (serviceType === "house_painting") {
      siteVisitCharges = Number(bookingDetails?.siteVisitCharges || 0);
      bookingAmount = 0; //siteVisitCharges; [change incase need. siteVisitCharges is website and 0 for admin panel]
      paidAmount = siteVisitCharges;
      originalTotalAmount = 0;
      amountYetToPay = 0;

      firstPayment = { status: "pending", amount: 0 };
      secondPayment = { status: "pending", amount: 0 };
      finalPayment = { status: "pending", amount: 0 };
    }

    const bookingDetailsConfig = {
      booking_id: generateBookingId(),
      bookingDate: bookingDetails?.bookingDate
        ? new Date(bookingDetails.bookingDate)
        : new Date(),
      bookingTime: bookingDetails?.bookingTime || "10:30 AM",
      status: "Pending",
      bookingAmount,
      originalTotalAmount,
      finalTotal: originalTotalAmount,
      paidAmount,
      amountYetToPay,
      paymentMethod: bookingDetails?.paymentMethod || "Cash",
      paymentStatus: paidAmount > 0 ? "Partial Payment" : "Unpaid",
      otp: generateOTP(),
      siteVisitCharges,
      paymentLink: {
        isActive: false,
      },
      firstPayment,
      finalPayment,
      // add secondPayment only for house painting
      ...(serviceType === "house_painting" ? { secondPayment } : {}),
    };

    // Track payment line-item for all service

    const payments = [
      {
        at: new Date(),
        method: bookingDetailsConfig.paymentMethod, // "UPI" / "Cash" etc
        amount:
          serviceType === "house_painting" ? siteVisitCharges : paidAmount,
        providerRef: generateProviderRef(),
        ...(serviceType === "house_painting" ? { purpose: "site_visit" } : {}),

        ...(serviceType === "deep_cleaning" ? { installment: "first" } : {}), // ✅ only deep_cleaning
      },
    ];

    // const payments = [
    //   {
    //     at: new Date(),
    //     method: bookingDetailsConfig.paymentMethod,
    //     amount:
    //       serviceType === "house_painting" ? siteVisitCharges : paidAmount,
    //     providerRef: generateProviderRef(),
    //   },
    // ];
    // untrack of hp site amt
    // const payments =
    //   serviceType === "house_painting"
    //     ? []
    //     : [
    //       {
    //         at: new Date(),
    //         method: bookingDetailsConfig.paymentMethod,
    //         amount: paidAmount,
    //         providerRef: generateProviderRef(),
    //       },
    //     ];

    // 📦 Create booking

    const booking = new UserBooking({
      customer: {
        customerId: customer?.customerId,
        name: customer?.name,
        phone: customer?.phone,
      },
      service: service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: Number(s.price),
        quantity: Number(s.quantity) || 1,
        teamMembersRequired: Number(s.teamMembersRequired) || 0,
        duration: Number(s.duration) || 0,
        coinDeduction: Number(s.coinsForVendor) || 0,
      })),
      serviceType,
      bookingDetails: bookingDetailsConfig,
      assignedProfessional: assignedProfessional
        ? {
            professionalId: assignedProfessional.professionalId,
            name: assignedProfessional.name,
            phone: assignedProfessional.phone,
          }
        : undefined,
      address: {
        houseFlatNumber: address?.houseFlatNumber || "",
        streetArea: address?.streetArea || "",
        landMark: address?.landMark || "",
        city: address?.city || "",
        location: {
          type: "Point",
          coordinates: coords,
        },
      },
      selectedSlot: {
        slotDate: selectedSlot?.slotDate || moment().format("YYYY-MM-DD"),
        slotTime: selectedSlot?.slotTime || "10:00 AM",
      },
      payments,
      isEnquiry: Boolean(isEnquiry),
      formName: formName || "Unknown",
      createdDate: new Date(),
    });

    await booking.save();

    // now generate and store payment link
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${
      booking._id
    }/${Date.now()}/${pay_type}`;

    booking.bookingDetails.paymentLink = {
      url: paymentLinkUrl,
      isActive: false, // make it true once payment gateway impl and each makePayment make it false - once payment done
      providerRef: generateProviderRef(),
    };
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      booking._id,
      {
        $set: {
          "bookingDetails.paymentLink": {
            url: paymentLinkUrl,
            isActive: false,
            providerRef: generateProviderRef(),
          },
        },
      },
      { new: true },
    );

    const newBookingNotification = {
      bookingId: booking._id,
      notificationType: "NEW_LEAD_CREATED",
      thumbnailTitle: "New Booking Scheduled",
      notifyTo: "admin",
      message: `New ${service[0]?.category} booking scheduled for ${moment(
        selectedSlot?.slotDate,
      ).format("DD-MM-YYYY")} at ${selectedSlot?.slotTime}`,
      // metadata: { user_id, order_status },
      status: "unread",
      created_at: new Date(),
    };
    await notificationSchema.create(newBookingNotification);

    res.status(201).json({
      message: "Booking created successfully",
      bookingId: updatedBooking._id,
      serviceType,
      booking,
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// add requestedAmount = amount, remaining = amount, prePayment=0 in the firstPayment obj
// exports.adminCreateBooking = async (req, res) => {
//   try {
//     const {
//       customer,
//       service,
//       bookingDetails = {},
//       assignedProfessional,
//       address,
//       selectedSlot,
//       formName,
//       isEnquiry,
//     } = req.body;

//     // ***************************************
//     // 🟢 CHECK USER EXISTS OR CREATE NEW USER
//     // ***************************************
//     let checkUser = await userSchema.findOne({
//       mobileNumber: customer.phone,
//     });

//     if (!checkUser) {
//       checkUser = new userSchema({
//         userName: customer.name,
//         mobileNumber: customer.phone,
//         savedAddress: {
//           uniqueCode: `ADDR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
//           address: address.streetArea,
//           houseNumber: address.houseFlatNumber,
//           landmark: address.landMark,
//           latitude: address.location.coordinates[1],
//           longitude: address.location.coordinates[0],
//           city: address.city,
//         },
//       });

//       await checkUser.save();
//     }

//     // -----------------------
//     // Basic validations
//     // -----------------------
//     if (!service || !Array.isArray(service) || service.length === 0) {
//       return res.status(400).json({ message: "Service list cannot be empty." });
//     }

//     if (
//       !address ||
//       !address.location ||
//       !Array.isArray(address.location.coordinates) ||
//       address.location.coordinates.length !== 2
//     ) {
//       return res.status(400).json({ message: "Invalid address coordinates." });
//     }

//     // detect service type
//     const serviceType = detectServiceType(formName, service);

//     // Extract fields & default values
//     let bookingAmount = Number(bookingDetails?.bookingAmount ?? 0);
//     let paidAmount = Number(bookingDetails?.paidAmount ?? 0);
//     let originalTotalAmount = Number(
//       bookingDetails?.originalTotalAmount ?? bookingDetails?.finalTotal ?? 0
//     );
//     let finalTotal =
//       Number(bookingDetails?.finalTotal ?? 0) || originalTotalAmount;

//     let amountYetToPay = 0;
//     let siteVisitCharges = 0;

//     let firstPayment = {};
//     let secondPayment = {};
//     let finalPayment = {};

//     // -----------------------
//     // Deep cleaning logic
//     // -----------------------
//     if (serviceType === "deep_cleaning") {
//       if (isEnquiry && bookingAmount > 0) {
//         amountYetToPay = Math.max(0, finalTotal - bookingAmount);

//         firstPayment = {
//           status: paidAmount > 0 ? "paid" : "pending",
//           amount: bookingAmount,
//           paidAt: paidAmount > 0 ? new Date() : null,
//           method:
//             paidAmount > 0
//               ? bookingDetails?.paymentMethod || "None"
//               : undefined,
//           //below added by kir
//           requestedAmount: bookingAmount,
//           remaining: bookingAmount,
//           prePayment: 0,
//         };

//         finalPayment = {
//           status: amountYetToPay > 0 ? "pending" : "paid",
//           amount: amountYetToPay,
//         };
//       } else {
//         paidAmount = Number(bookingDetails?.paidAmount ?? bookingAmount);
//         amountYetToPay = Math.max(0, finalTotal - paidAmount);

//         firstPayment = {
//           status: paidAmount > 0 ? "paid" : "No Payment",
//           amount: paidAmount,
//           paidAt: paidAmount > 0 ? new Date() : null,
//           method:
//             paidAmount > 0 ? bookingDetails?.paymentMethod || "None" : "None",
//         };

//         finalPayment = {
//           status: amountYetToPay > 0 ? "pending" : "paid",
//           amount: amountYetToPay,
//         };
//       }
//     }

//     // -----------------------
//     // House painting logic
//     // -----------------------
//     if (serviceType === "house_painting") {
//       siteVisitCharges = Number(bookingDetails?.bookingAmount || 0);

//       if (isEnquiry && siteVisitCharges > 0) {
//         bookingAmount = 0;
//         paidAmount = 0;
//         originalTotalAmount = 0;
//         finalTotal = 0;
//         amountYetToPay = 0;

//         firstPayment = { status: "pending", amount: 0 };
//         secondPayment = { status: "pending", amount: 0 };
//         finalPayment = { status: "pending", amount: 0 };
//       } else {
//         bookingAmount = 0;
//         paidAmount = 0;
//         originalTotalAmount = 0;
//         finalTotal = 0;
//         amountYetToPay = 0;

//         firstPayment = { status: "No Payment", amount: 0 };
//         secondPayment = { status: "pending", amount: 0 };
//         finalPayment = { status: "pending", amount: 0 };
//       }
//     }

//     // -----------------------
//     // Booking ID (display)
//     // -----------------------
//     const bookingId = generateBookingId();

//     // -----------------------
//     // Payment link (added after save)
//     // -----------------------
//     let paymentLink = {}; // 🔥 Keep empty until booking is saved

//     // -----------------------
//     // Build bookingDetails config
//     // -----------------------
//     const bookingDetailsConfig = {
//       booking_id: bookingId,
//       bookingDate: bookingDetails?.bookingDate
//         ? new Date(bookingDetails.bookingDate)
//         : new Date(),
//       bookingTime: new Date().toLocaleTimeString([], {
//         hour: "2-digit",
//         minute: "2-digit",
//         hour12: true,
//       }),
//       status: "Pending",
//       bookingAmount,
//       originalTotalAmount,
//       finalTotal:
//         finalTotal === 0 && serviceType === "deep_cleaning"
//           ? originalTotalAmount
//           : finalTotal,
//       paidAmount,
//       amountYetToPay,
//       paymentMethod: bookingDetails?.paymentMethod || "Cash",
//       paymentStatus: "Unpaid",
//       otp: generateOTP(),
//       siteVisitCharges,
//       firstPayment,
//       secondPayment,
//       finalPayment,
//       paymentLink, // initially empty
//     };

//     // -----------------------
//     // Payments array
//     // -----------------------
//     let payments = [];
//     if (!isEnquiry && paidAmount > 0) {
//       payments.push({
//         at: new Date(),
//         method: bookingDetailsConfig.paymentMethod,
//         amount: paidAmount,
//         providerRef: generateProviderRef(),

//       });
//     }

//     // -----------------------
//     // Create booking object
//     // -----------------------
//     const booking = new UserBooking({
//       customer: {
//         customerId: checkUser._id,
//         name: checkUser.userName,
//         phone: checkUser.mobileNumber,
//       },
//       service: service.map((s) => ({
//         category: s.category,
//         subCategory: s.subCategory,
//         serviceName: s.serviceName,
//         price: Number(s.price || 0),
//         quantity: Number(s.quantity || 1),
//         teamMembersRequired: Number(s.teamMembersRequired || 0),
//         duration: s.duration,
//         packageId: s.packageId,
//       })),
//       serviceType,
//       bookingDetails: bookingDetailsConfig,
//       assignedProfessional: assignedProfessional
//         ? {
//             professionalId: assignedProfessional.professionalId,
//             name: assignedProfessional.name,
//             phone: assignedProfessional.phone,
//           }
//         : undefined,
//       address: {
//         houseFlatNumber: address?.houseFlatNumber || "",
//         streetArea: address?.streetArea || "",
//         landMark: address?.landMark || "",
//         city: address?.city || "",
//         location: {
//           type: "Point",
//           coordinates: address.location.coordinates,
//         },
//       },
//       selectedSlot: {
//         slotDate:
//           selectedSlot?.slotDate || new Date().toISOString().slice(0, 10),
//         slotTime: selectedSlot?.slotTime || "10:00 AM",
//       },
//       payments,
//       isEnquiry: Boolean(isEnquiry),
//       formName: formName || "admin panel",
//       createdDate: new Date(),
//     });

//     // Save booking
//     await booking.save();

//     // --------------------------------------------
//     // 🔥 CREATE REAL PAYMENT LINK AFTER SAVE
//     // --------------------------------------------
//     // const redirectionUrl = "http://localhost:5173/checkout/payment";
//     const pay_type = "auto-pay";

//     const paymentLinkUrl = `${redirectionUrl}${
//       booking._id
//     }/${Date.now()}/${pay_type}`;

//     booking.bookingDetails.paymentLink = {
//       url: paymentLinkUrl,
//       isActive: true,
//       providerRef: generateProviderRef(),
//     };

//     await booking.save();

//     return res.status(201).json({
//       message: "Admin booking created successfully",
//       bookingId: booking._id,
//       booking,
//     });
//   } catch (error) {
//     console.error("Admin Create Booking Error:", error);
//     return res
//       .status(500)
//       .json({ message: "Server error", error: error.message });
//   }
// };

exports.adminCreateBooking = async (req, res) => {
  try {
    const {
      customer,
      service,
      bookingDetails = {},
      assignedProfessional,
      address,
      selectedSlot,
      formName,
      isEnquiry,
    } = req.body;

    // ***************************************
    // 🟢 CHECK USER EXISTS OR CREATE NEW USER
    // ***************************************
    let checkUser = await userSchema.findOne({
      mobileNumber: customer.phone,
    });

    if (!checkUser) {
      checkUser = new userSchema({
        userName: customer.name,
        mobileNumber: customer.phone,
        savedAddress: {
          uniqueCode: `ADDR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          address: address.streetArea,
          houseNumber: address.houseFlatNumber,
          landmark: address.landMark,
          latitude: address.location.coordinates[1],
          longitude: address.location.coordinates[0],
          city: address.city,
        },
      });

      await checkUser.save();
    }

    // -----------------------
    // Basic validations
    // -----------------------
    if (!service || !Array.isArray(service) || service.length === 0) {
      return res.status(400).json({ message: "Service list cannot be empty." });
    }

    if (
      !address ||
      !address.location ||
      !Array.isArray(address.location.coordinates) ||
      address.location.coordinates.length !== 2
    ) {
      return res.status(400).json({ message: "Invalid address coordinates." });
    }

    // detect service type
    const serviceType = detectServiceType(formName, service);

    // Extract fields & default values
    let bookingAmount = Number(bookingDetails?.bookingAmount ?? 0);
    let paidAmount = Number(bookingDetails?.paidAmount ?? 0);
    let originalTotalAmount = Number(
      bookingDetails?.originalTotalAmount ?? bookingDetails?.finalTotal ?? 0,
    );
    let finalTotal =
      Number(bookingDetails?.finalTotal ?? 0) || originalTotalAmount;

    let amountYetToPay = 0;
    let siteVisitCharges = 0;

    let firstPayment = {};
    let secondPayment = {};
    let finalPayment = {};

    // -----------------------
    // Deep cleaning logic
    // -----------------------
    if (serviceType === "deep_cleaning") {
      if (isEnquiry && bookingAmount > 0) {
        amountYetToPay = Math.max(0, finalTotal - bookingAmount);

        firstPayment = {
          status: paidAmount > 0 ? "paid" : "pending",
          // amount: bookingAmount,
          amount: 0,
          paidAt: paidAmount > 0 ? new Date() : null,
          method:
            paidAmount > 0
              ? bookingDetails?.paymentMethod || "None"
              : undefined,
          //below added by kir
          requestedAmount: bookingAmount,
          remaining: bookingAmount,
          prePayment: 0,
        };

        // finalPayment = {
        //   status: amountYetToPay > 0 ? "pending" : "paid",
        //   amount: amountYetToPay,
        // };
      } else {
        paidAmount = Number(bookingDetails?.paidAmount ?? bookingAmount);
        amountYetToPay = Math.max(0, finalTotal - paidAmount);

        firstPayment = {
          status: paidAmount > 0 ? "paid" : "No Payment",
          amount: 0,
          paidAt: paidAmount > 0 ? new Date() : null,
          method:
            paidAmount > 0 ? bookingDetails?.paymentMethod || "None" : "None",
        };

        // finalPayment = {
        //   status: amountYetToPay > 0 ? "pending" : "paid",
        //   amount: amountYetToPay,
        // };
      }
    }

    // -----------------------
    // House painting logic
    // -----------------------
    if (serviceType === "house_painting") {
      siteVisitCharges = Number(bookingDetails?.bookingAmount || 0);

      if (isEnquiry && siteVisitCharges > 0) {
        bookingAmount = 0;
        paidAmount = 0;
        originalTotalAmount = 0;
        finalTotal = 0;
        amountYetToPay = 0;

        firstPayment = { status: "pending", amount: 0 };
        secondPayment = { status: "pending", amount: 0 };
        finalPayment = { status: "pending", amount: 0 };
      } else {
        bookingAmount = 0;
        paidAmount = 0;
        originalTotalAmount = 0;
        finalTotal = 0;
        amountYetToPay = 0;
        firstPayment = { status: "pending", amount: 0 };
        secondPayment = { status: "pending", amount: 0 };
        finalPayment = { status: "pending", amount: 0 };
      }
    }

    // -----------------------
    // Booking ID (display)
    // -----------------------
    const bookingId = generateBookingId();

    // -----------------------
    // Payment link (added after save)
    // -----------------------
    let paymentLink = {}; // 🔥 Keep empty until booking is saved

    // -----------------------
    // Build bookingDetails config
    // -----------------------
    const bookingDetailsConfig = {
      booking_id: bookingId,
      bookingDate: bookingDetails?.bookingDate
        ? new Date(bookingDetails.bookingDate)
        : new Date(),
      bookingTime: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      status: "Pending",
      bookingAmount,
      originalTotalAmount,
      finalTotal:
        finalTotal === 0 && serviceType === "deep_cleaning"
          ? originalTotalAmount
          : finalTotal,
      paidAmount,
      amountYetToPay,
      paymentMethod: bookingDetails?.paymentMethod || "Cash",
      paymentStatus: "Unpaid",
      otp: generateOTP(),
      siteVisitCharges,
      firstPayment,
      secondPayment,
      finalPayment,
      paymentLink, // initially empty
    };

    // -----------------------
    // Payments array
    // -----------------------
    let payments = [];
    if (!isEnquiry && paidAmount > 0) {
      payments.push({
        at: new Date(),
        method: bookingDetailsConfig.paymentMethod,
        amount: paidAmount,
        providerRef: generateProviderRef(),
      });
    }

    // -----------------------
    // Create booking object
    // -----------------------
    const booking = new UserBooking({
      customer: {
        customerId: checkUser._id,
        name: checkUser.userName,
        phone: checkUser.mobileNumber,
      },
      service: service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: Number(s.price || 0),
        quantity: Number(s.quantity || 1),
        teamMembersRequired: Number(s.teamMembersRequired || 0),
        duration: s.duration,
        packageId: s.packageId,
        coinDeduction: Number(s.coinDeduction || 0),
      })),
      serviceType,
      bookingDetails: bookingDetailsConfig,
      assignedProfessional: assignedProfessional
        ? {
            professionalId: assignedProfessional.professionalId,
            name: assignedProfessional.name,
            phone: assignedProfessional.phone,
          }
        : undefined,
      address: {
        houseFlatNumber: address?.houseFlatNumber || "",
        streetArea: address?.streetArea || "",
        landMark: address?.landMark || "",
        city: address?.city || "",
        location: {
          type: "Point",
          coordinates: address.location.coordinates,
        },
      },
      selectedSlot: {
        slotDate:
          selectedSlot?.slotDate || new Date().toISOString().slice(0, 10),
        slotTime: selectedSlot?.slotTime || "10:00 AM",
      },
      payments,
      isEnquiry: Boolean(isEnquiry),
      formName: formName || "admin panel",
      createdDate: new Date(),
    });

    // Save booking
    await booking.save();

    // --------------------------------------------
    // 🔥 CREATE REAL PAYMENT LINK AFTER SAVE
    // --------------------------------------------
    // const redirectionUrl = "http://localhost:5173/checkout/payment";
    const pay_type = "auto-pay";

    const paymentLinkUrl = `${redirectionUrl}${
      booking._id
    }/${Date.now()}/${pay_type}`;

    booking.bookingDetails.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: generateProviderRef(),
      ...(serviceType === "deep_cleaning" ? { installmentStage: "first" } : {}),
    };

    await booking.save();

    return res.status(201).json({
      message: "Admin booking created successfully",
      bookingId: booking._id,
      booking,
    });
  } catch (error) {
    console.error("Admin Create Booking Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
// exports.getAllBookings = async (req, res) => {
//   try {
//     const { service, city, timePeriod, startDate, endDate } = req.query;
//     console.log({ service, city, timePeriod, startDate, endDate });

//     const filter = buildFilter({ service, city, startDate, endDate });
//     const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });

//     res.status(200).json({ bookings });
//   } catch (error) {
//     console.error("Error fetching bookings:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.getAllLeadsBookings = async (req, res) => {
//   try {
//     const { service, city, timePeriod, startDate, endDate } = req.query;
//     console.log({ service, city, timePeriod, startDate, endDate });

//     const filter = buildFilter({
//       service,
//       city,
//       startDate,
//       endDate,
//       isEnquiry: false,
//     });

//     const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
//     res.status(200).json({ allLeads: bookings });
//   } catch (error) {
//     console.error("Error fetching all leads:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// exports.getAllEnquiries = async (req, res) => {
//   try {
//     const { service, city, timePeriod, startDate, endDate } = req.query;
//     console.log({ service, city, timePeriod, startDate, endDate });

//     const filter = buildFilter({
//       service,
//       city,
//       startDate,
//       endDate,
//       isEnquiry: true,
//     });

//     const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
//     res.status(200).json({ allEnquies: bookings });
//   } catch (error) {
//     console.error("Error fetching all enquiries:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.getAllBookings = async (req, res) => {
  try {
    const filter = buildFilter(req.query);

    const bookings = await UserBooking.find(filter)
      .sort({ createdAt: -1 })
      .lean(); // 🚀 performance boost for large datasets

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllLeadsBookings = async (req, res) => {
  try {
    const filter = buildFilter({
      ...req.query,
      isEnquiry: false,
    });

    const bookings = await UserBooking.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllEnquiries = async (req, res) => {
  try {
    const filter = buildFilter({
      ...req.query,
      isEnquiry: true,
    });

    const bookings = await UserBooking.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ allEnquies: bookings });
  } catch (error) {
    console.error("Error fetching all enquiries:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getPendingLeads = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;

    const filter = buildFilter({
      service,
      city,
      startDate,
      endDate,
      timePeriod,
      isEnquiry: false,
    });

    // Apply Pending filter
    filter["bookingDetails.status"] = "Pending";

    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });

    // IMPORTANT → Return same key as old API so frontend works
    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching pending leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getNonPendingLeads = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;

    const filter = buildFilter({
      service,
      city,
      timePeriod,
      startDate,
      endDate,
      isEnquiry: false,
    });

    // Exclude Pending status
    filter["bookingDetails.status"] = { $ne: "Pending" };

    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });

    // IMPORTANT → Return same key as /get-all-leads
    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching non-pending leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------
// 🔧 Shared Helper Function: buildFilter()
// ---------------------------------------
// exports.getNonPendingLeads = async (req, res) => {
//   try {
//     const { service, city, timePeriod, startDate, endDate } = req.query;

//     const filter = buildFilter({
//       service,
//       city,
//       timePeriod,
//       startDate,
//       endDate,
//       isEnquiry: false,
//     });

//     /* ------------------ STATUS FILTER ------------------ */
//     filter["bookingDetails.status"] = {
//       $nin: ["Pending", ...CANCELLED_STATUSES],
//     };

//     const bookings = await UserBooking
//       .find(filter)
//       .sort({ createdAt: -1 })
//       .lean(); // 🚀 large DB optimization

//     // IMPORTANT → keep same response key
//     res.status(200).json({ allLeads: bookings });
//   } catch (error) {
//     console.error("Error fetching non-pending leads:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

function buildFilter({ service, city, startDate, endDate, isEnquiry }) {
  const filter = {};

  if (typeof isEnquiry === "boolean") {
    filter.isEnquiry = isEnquiry;
  }

  // ✅ Filter by service
  if (service && service !== "All Services") {
    filter["service.category"] = service;
  }

  // ✅ Filter by city (using both address.city and fallback regex)
  if (city && city !== "All Cities") {
    const dbCity = citiesObj?.[city] || city;
    filter.$or = [
      { "address.city": { $regex: new RegExp(`^${dbCity}$`, "i") } },
      { "address.streetArea": { $regex: dbCity, $options: "i" } },
    ];
  }

  // ✅ Filter by date range
  if (startDate || endDate) {
    filter["bookingDetails.bookingDate"] = {};
    if (startDate) {
      filter["bookingDetails.bookingDate"].$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter["bookingDetails.bookingDate"].$lte = end;
    }
  }

  return filter;
}

exports.getBookingsByBookingId = async (req, res) => {
  try {
    const booking = await UserBooking.findById({ _id: req.params.id });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ booking });
  } catch (error) {
    console.error("Error fetching booking by bookingId:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingsByCustomerId = async (req, res) => {
  try {
    const { customerId } = req.params;

    const bookings = await UserBooking.find({
      "customer.customerId": customerId,
    }).sort({ createdAt: -1 });

    if (!bookings || bookings.length === 0) {
      return res
        .status(404)
        .json({ message: "No bookings found for this customer" });
    }

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings by customerId:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingForNearByVendorsDeepCleaning = async (req, res) => {
  try {
    const { lat, long } = req.params;
    if (!lat || !long) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const now = new Date();

    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);

    const dayAfterTomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2),
    );
    const dayAfterTomorrowStr = dayAfterTomorrow.toISOString().slice(0, 10);

    const nearbyBookings = await UserBooking.find({
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000,
        },
      },
      isEnquiry: false,
      "service.category": "Deep Cleaning",
      "bookingDetails.status": "Pending",
      "selectedSlot.slotDate": {
        $gte: todayStart,
        $lt: dayAfterTomorrowStr,
      },
    }).sort({ createdAt: -1 });

    const nowMoment = moment();
    const filteredBookings = nearbyBookings.filter((booking) => {
      const slotDateObj = booking.selectedSlot?.slotDate;
      const slotTimeStr = booking.selectedSlot?.slotTime;
      if (!slotDateObj || !slotTimeStr) return false;

      const slotDateMoment = moment(slotDateObj);
      const slotDateStr = slotDateMoment.format("YYYY-MM-DD");
      const slotDateTime = moment(
        `${slotDateStr} ${slotTimeStr}`,
        "YYYY-MM-DD hh:mm A",
      );

      // Today: keep only future-times
      if (slotDateMoment.isSame(nowMoment, "day")) {
        return slotDateTime.isAfter(nowMoment);
      }
      // Tomorrow: keep all
      if (slotDateMoment.isSame(nowMoment.clone().add(1, "day"), "day")) {
        return true;
      }
      // Should not reach here due to date range, but just in case
      return false;
    });

    if (!filteredBookings.length) {
      return res
        .status(404)
        .json({ message: "No bookings found near this location" });
    }

    res.status(200).json({ bookings: filteredBookings });
  } catch (error) {
    console.error("Error finding nearby bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// deep cleaning performance metrics
// exports.getVendorPerformanceMetricsDeepCleaning = async (req, res) => {
//   try {
//     const { vendorId, lat, long, timeframe } = req.params;

//     if (!vendorId || !lat || !long || !timeframe) {
//       return res.status(400).json({
//         message: "Vendor ID, Latitude, Longitude, and Timeframe are required",
//       });
//     }

//     const baseQuery = {
//       "address.location": {
//         $near: {
//           $geometry: {
//             type: "Point",
//             coordinates: [parseFloat(long), parseFloat(lat)], //(within 5km).
//           },
//           $maxDistance: 5000,
//         },
//       },
//       "service.category": "Deep Cleaning",
//       isEnquiry: false,
//     };

//     let query = { ...baseQuery };
//     //["month", filter for bookings created in the current month, last 50 leads sorted by most recent]
//     if (timeframe === "month") {
//       const startOfMonth = moment().startOf("month").toDate();
//       query.createdDate = { $gte: startOfMonth };
//     }

//     let bookingsQuery = UserBooking.find(query);

//     if (timeframe === "last") {
//       bookingsQuery = bookingsQuery.sort({ createdDate: -1 }).limit(50);
//     }

//     const bookings = await bookingsQuery.exec();
//     let totalLeads = bookings.length; // count ALL geo-filtered leads shown to vendor
//     let respondedLeads = 0;
//     let cancelledLeads = 0;
//     let totalGsv = 0;

//     // .Runs the Mongo query for filtered bookings.
//     // .If none found, responds with zeros for all metrics.
//     if (!bookings.length) {
//       return res.status(200).json({
//         responseRate: 0,
//         cancellationRate: 0,
//         averageGsv: 0,
//         totalLeads: 0,
//         respondedLeads: 0,
//         cancelledLeads: 0,
//         timeframe: timeframe,
//       });
//     }

//     for (const booking of bookings) {
//       // GSV of every lead (not just responded)
//       const bookingGsv = (booking.service || []).reduce(
//         (sum, s) => sum + (s.price || 0) * (s.quantity || 0),
//         0
//       );
//       totalGsv += bookingGsv;

//       const vendorInvitation = (booking.invitedVendors || []).find(
//         (v) => String(v.professionalId) === String(vendorId)
//       );
//       if (!vendorInvitation) continue;

//       // considered "responded" = accepted (or your special “customer_cancelled” flag)
//       if (
//         vendorInvitation.responseStatus === "accepted" ||
//         vendorInvitation.responseStatus === "customer_cancelled"
//       ) {
//         respondedLeads += 1;
//       }

//       // “cancelled within 3 hours” logic
//       if (
//         vendorInvitation.responseStatus === "customer_cancelled" &&
//         vendorInvitation.cancelledAt &&
//         vendorInvitation.cancelledBy === "internal"
//       ) {
//         const bookedSlot = moment(
//           `${booking.selectedSlot.slotDate} ${booking.selectedSlot.slotTime}`,
//           "YYYY-MM-DD hh:mm A"
//         );
//         const hoursDiff = Math.abs(
//           bookedSlot.diff(moment(vendorInvitation.cancelledAt), "hours", true)
//         );
//         if (hoursDiff <= 3) cancelledLeads += 1;
//       }
//     }

//     const responseRate =
//       totalLeads > 0 ? (respondedLeads / totalLeads) * 100 : 0;

//     const cancellationRate =
//       respondedLeads > 0 ? (cancelledLeads / respondedLeads) * 100 : 0;

//     const averageGsv = totalLeads > 0 ? totalGsv / totalLeads : 0;

//     res.status(200).json({
//       responseRate: parseFloat(responseRate.toFixed(2)),
//       cancellationRate: parseFloat(cancellationRate.toFixed(2)),
//       averageGsv: parseFloat(averageGsv.toFixed(2)),
//       totalLeads,
//       respondedLeads,
//       cancelledLeads,
//       timeframe: timeframe,
//     });
//   } catch (error) {
//     console.error("Error calculating vendor performance metrics:", error);
//     res.status(500).json({ message: "Server error calculating performance" });
//   }
// };

//metric

exports.getVendorPerformanceMetricsDeepCleaning = async (req, res) => {
  try {
    const { vendorId, lat, long, timeframe } = req.params;

    if (!vendorId || !lat || !long || !timeframe) {
      return res.status(400).json({
        message: "Vendor ID, Latitude, Longitude, and Timeframe are required",
      });
    }

    // -------------------------------
    //  BASE GEO + CATEGORY FILTER
    // -------------------------------
    const baseQuery = {
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000, // 5km radius
        },
      },
      "service.category": "Deep Cleaning",
      isEnquiry: false,
    };

    // -------------------------------
    //  TIMEFRAME FILTER
    // -------------------------------
    let query = { ...baseQuery };

    // .................Average Rating..........star
    let ratingMatch = { vendorId: new mongoose.Types.ObjectId(vendorId) };

    if (timeframe === "month") {
      const startOfMonth = moment().startOf("month").toDate();
      query.createdDate = { $gte: startOfMonth };
    }
    // pipeline for "month" (all ratings in month) or "last" (last 50 ratings)
    let ratingPipeline = [
      { $match: ratingMatch },
      { $sort: { createdAt: -1 } },
    ];

    if (timeframe === "last") {
      ratingPipeline.push({ $limit: 50 }); // last 50 ratings
    }

    // then group to compute average and countx`
    ratingPipeline.push({
      $group: {
        _id: null,
        totalRatings: { $sum: 1 },
        sumRatings: { $sum: "$rating" },
        // NEW: strikes count (1-star or 2-star)
        strikes: {
          $sum: {
            $cond: [{ $lte: ["$rating", 2] }, 1, 0],
          },
        },
      },
    });

    const ratingStats = await VendorRating.aggregate(ratingPipeline);

    let averageRating = 0;
    let totalRatings = 0;
    let strikes = 0;

    if (ratingStats.length > 0 && ratingStats[0].totalRatings > 0) {
      totalRatings = ratingStats[0].totalRatings;
      averageRating = ratingStats[0].sumRatings / ratingStats[0].totalRatings;
      strikes = ratingStats[0].strikes || 0;
    }
    // ...........
    let bookingsQuery = UserBooking.find(query);

    if (timeframe === "last") {
      bookingsQuery = bookingsQuery.sort({ createdDate: -1 }).limit(50);
    }

    const bookings = await bookingsQuery.exec();

    // If no bookings found
    if (!bookings.length) {
      return res.status(200).json({
        responseRate: 0,
        cancellationRate: 0,
        averageGsv: 0,
        totalLeads: 0,
        respondedLeads: 0,
        cancelledLeads: 0,
        timeframe,
        // new fields
        averageRating: 0,
        totalRatings: 0,
        strikes: 0,
      });
    }

    // -------------------------------
    //  METRIC COUNTERS
    // -------------------------------
    let totalLeads = bookings.length;
    let respondedLeads = 0;
    let cancelledLeads = 0;
    let totalGsv = 0;

    // -------------------------------
    //  PROCESS EACH BOOKING
    // -------------------------------
    for (const booking of bookings) {
      // 1️⃣ Calculate GSV
      const bookingGsv = (booking.service || []).reduce(
        (sum, s) => sum + (s.price || 0) * (s.quantity || 0),
        0,
      );
      totalGsv += bookingGsv;

      // 2️⃣ Get vendor invitation
      const vendorInvitation = (booking.invitedVendors || []).find(
        (v) => String(v.professionalId) === String(vendorId),
      );

      if (!vendorInvitation) continue;

      const status = vendorInvitation.responseStatus;

      // 3️⃣ Responded logic:
      // accepted = responded
      // customer_cancelled = vendor cancelled (this counts as responded)
      if (status === "accepted" || status === "customer_cancelled") {
        respondedLeads += 1;
      }

      // 4️⃣ Vendor cancellation KPI logic
      if (
        status === "customer_cancelled" && // vendor cancelled on behalf of customer
        vendorInvitation.cancelledBy === "internal" && // done through vendor app
        vendorInvitation.cancelledAt
      ) {
        const bookedSlot = moment(
          `${booking.selectedSlot.slotDate} ${booking.selectedSlot.slotTime}`,
          "YYYY-MM-DD hh:mm A",
        );

        const cancelledAt = moment(vendorInvitation.cancelledAt);

        // HOURS difference BEFORE slot
        // diff must be >= 0 (vendor cancelled BEFORE slot)
        // diff must be <= 3 (within 3 hours)
        const diffHours = bookedSlot.diff(cancelledAt, "hours", true);

        if (diffHours >= 0 && diffHours <= 3) {
          cancelledLeads += 1;
        }
      }
    }

    // -------------------------------
    //  FINAL METRICS
    // -------------------------------
    const responseRate =
      totalLeads > 0 ? (respondedLeads / totalLeads) * 100 : 0;

    const cancellationRate =
      respondedLeads > 0 ? (cancelledLeads / respondedLeads) * 100 : 0;

    const averageGsv = totalLeads > 0 ? totalGsv / totalLeads : 0;

    // -------------------------------
    //  RESPONSE
    // -------------------------------

    const RESPONSE_DATA = {
      responseRate: parseFloat(responseRate.toFixed(2)),
      cancellationRate: parseFloat(cancellationRate.toFixed(2)),
      averageGsv: parseFloat(averageGsv.toFixed(2)),
      totalLeads,
      respondedLeads,
      cancelledLeads,
      timeframe,
    };
    console.log("RESPONSE_DATA_DEEP_CLEANING_PERFORMANCE", RESPONSE_DATA);

    return res.status(200).json({
      responseRate: parseFloat(responseRate.toFixed(2)),
      cancellationRate: parseFloat(cancellationRate.toFixed(2)),
      averageGsv: parseFloat(averageGsv.toFixed(2)),
      totalLeads,
      respondedLeads,
      cancelledLeads,
      timeframe,
      // ava.rating..
      averageRating: parseFloat(averageRating.toFixed(2)),
      totalRatings,
      strikes, // total 1★ + 2★ ratings in the selected timeframe
    });
  } catch (error) {
    console.error("Error calculating vendor performance metrics:", error);
    return res.status(500).json({
      message: "Server error calculating performance",
      error: error.message,
    });
  }
};

// house painting performance metrics
exports.getVendorPerformanceMetricsHousePainting = async (req, res) => {
  try {
    const { vendorId, lat, long, timeframe } = req.params;

    if (!vendorId || !lat || !long || !timeframe) {
      return res.status(400).json({
        message: "Vendor ID, Latitude, Longitude, and Timeframe are required",
      });
    }

    // Geo, category, enquiry filter
    const baseQuery = {
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000,
        },
      },
      "service.category": "House Painting",
      isEnquiry: false,
    };
    let query = { ...baseQuery };

    // .................Average Rating..........star
    let ratingMatch = { vendorId: new mongoose.Types.ObjectId(vendorId) };

    // timeframe filter for ratings
    if (timeframe === "month") {
      const startOfMonth = moment().startOf("month").toDate();
      ratingMatch.createdAt = { $gte: startOfMonth };
    }

    // pipeline for "month" (all ratings in month) or "last" (last 50 ratings)
    let ratingPipeline = [
      { $match: ratingMatch },
      { $sort: { createdAt: -1 } },
    ];

    if (timeframe === "last") {
      ratingPipeline.push({ $limit: 50 }); // last 50 ratings
    }

    // then group to compute average and countx`
    ratingPipeline.push({
      $group: {
        _id: null,
        totalRatings: { $sum: 1 },
        sumRatings: { $sum: "$rating" },
        // NEW: strikes count (1-star or 2-star)
        strikes: {
          $sum: {
            $cond: [{ $lte: ["$rating", 2] }, 1, 0],
          },
        },
      },
    });

    const ratingStats = await VendorRating.aggregate(ratingPipeline);

    let averageRating = 0;
    let totalRatings = 0;
    let strikes = 0;

    if (ratingStats.length > 0 && ratingStats[0].totalRatings > 0) {
      totalRatings = ratingStats[0].totalRatings;
      averageRating = ratingStats[0].sumRatings / ratingStats[0].totalRatings;
      strikes = ratingStats[0].strikes || 0;
    }

    // .................................
    // Month filter
    if (timeframe === "month") {
      const startOfMonth = moment().startOf("month").toDate();
      query.createdDate = { $gte: startOfMonth };
    }

    let bookingsQuery = UserBooking.find(query);
    if (timeframe === "last") {
      bookingsQuery = bookingsQuery.sort({ createdDate: -1 }).limit(50);
    }
    const bookings = await bookingsQuery.exec();

    // Metrics
    let totalLeads = bookings.length;
    let surveyLeads = 0;
    let hiredLeads = 0;
    let totalGsv = 0;

    if (totalLeads === 0) {
      return res.status(200).json({
        surveyRate: 0,
        hiringRate: 0,
        averageGsv: 0,
        totalLeads: 0,
        surveyLeads: 0,
        hiredLeads: 0,
        timeframe,
        // new fields
        averageRating: 0,
        totalRatings: 0,
        strikes: 0,
      });
    }

    for (const booking of bookings) {
      // Only count leads for THIS vendor (use invitedVendors or assignedProfessional)
      const invited = (booking.invitedVendors || []).find(
        (v) => String(v.professionalId) === String(vendorId),
      );
      if (!invited) continue;

      // ------ SURVEY LOGIC ------
      // "vendor has actually started the job"
      if (
        booking.bookingDetails &&
        (booking.bookingDetails.status === "Project Ongoing" || // actively started
          booking.bookingDetails.status === "Survey Ongoing" || // survey started
          (booking.assignedProfessional &&
            booking.assignedProfessional.startedDate))
      ) {
        surveyLeads++;
      }

      // ------ HIRING LOGIC ------
      // "customer paid, project confirmed"
      if (
        booking.bookingDetails &&
        (booking.bookingDetails.status === "Hired" || // status marks hired
          booking.bookingDetails.status === "Project Ongoing" || // project in progress
          (booking.bookingDetails.firstPayment &&
            booking.bookingDetails.firstPayment.status === "paid")) // milestone paid
      ) {
        hiredLeads++;
      }

      // ------ GSV LOGIC ------
      // Use finalTotal (the actual job value)
      totalGsv += booking.bookingDetails
        ? booking.bookingDetails.finalTotal || 0
        : 0;
    }

    // KPIs
    const surveyRate = totalLeads > 0 ? (surveyLeads / totalLeads) * 100 : 0;
    const hiringRate = totalLeads > 0 ? (hiredLeads / totalLeads) * 100 : 0;
    const averageGsv = totalLeads > 0 ? totalGsv / totalLeads : 0;

    res.status(200).json({
      surveyRate: parseFloat(surveyRate.toFixed(2)),
      hiringRate: parseFloat(hiringRate.toFixed(2)),
      averageGsv: parseFloat(averageGsv.toFixed(2)),
      totalLeads,
      surveyLeads,
      hiredLeads,
      timeframe,
      // ava.rating..
      averageRating: parseFloat(averageRating.toFixed(2)),
      totalRatings,
      strikes, // total 1★ + 2★ ratings in the selected timeframe
    });
  } catch (error) {
    console.error("Error calculating house painters vendor metrics:", error);
    res.status(500).json({ message: "Server error calculating performance" });
  }
};

// Helper function to calculate ratings for a vendor
const calculateVendorRatings = async (vendorId, timeframe) => {
  let ratingMatch = { vendorId: new mongoose.Types.ObjectId(vendorId) };

  // Add timeframe filter for ratings
  if (timeframe === "month") {
    const startOfMonth = moment().startOf("month").toDate();
    ratingMatch.createdAt = { $gte: startOfMonth };
  }

  let ratingPipeline = [{ $match: ratingMatch }, { $sort: { createdAt: -1 } }];

  if (timeframe === "last") {
    ratingPipeline.push({ $limit: 50 });
  }

  ratingPipeline.push({
    $group: {
      _id: null,
      totalRatings: { $sum: 1 },
      sumRatings: { $sum: "$rating" },
      strikes: {
        $sum: {
          $cond: [{ $lte: ["$rating", 2] }, 1, 0],
        },
      },
    },
  });

  const ratingStats = await VendorRating.aggregate(ratingPipeline);

  let averageRating = 0;
  let totalRatings = 0;
  let strikes = 0;

  if (ratingStats.length > 0 && ratingStats[0].totalRatings > 0) {
    totalRatings = ratingStats[0].totalRatings;
    averageRating = ratingStats[0].sumRatings / ratingStats[0].totalRatings;
    strikes = ratingStats[0].strikes || 0;
  }

  return { averageRating, totalRatings, strikes };
};

exports.getOverallPerformance = async (req, res) => {
  try {
    const { city = "All", period = "all" } = req.query;

    /* -----------------------------
        1. PREPARE DATE FILTER
    ----------------------------- */
    let dateFilter = {};

    if (period === "this_month") {
      dateFilter.createdDate = {
        $gte: moment().startOf("month").toDate(),
      };
    }

    if (period === "last_month") {
      dateFilter.createdDate = {
        $gte: moment().subtract(1, "month").startOf("month").toDate(),
        $lte: moment().subtract(1, "month").endOf("month").toDate(),
      };
    }

    /* -----------------------------
        2. CITY FILTER
    ----------------------------- */
    let cityFilter = {};
    if (city !== "All") {
      cityFilter["address.city"] = city;
    }

    /* -----------------------------
        3. FETCH ALL LEADS
    ----------------------------- */
    const leads = await UserBooking.find({
      ...dateFilter,
      ...cityFilter,
      isEnquiry: false,
    });

    const normalize = (v) => (v ?? "").toString().trim().toLowerCase();
    const isHP = (lead) =>
      lead.service?.some((s) => normalize(s.category) === "house painting");
    const isDC = (lead) =>
      lead.service?.some((s) => normalize(s.category) === "deep cleaning");

    const hpLeads = leads.filter(isHP);
    const dcLeads = leads.filter(isDC);

    /* -----------------------------
        4. CALCULATE GSV
    ----------------------------- */
    const calcGSV = (arr) => {
      let total = 0;
      arr.forEach((l) => {
        l.service?.forEach((s) => {
          total += (s.price || 0) * (s.quantity || 1);
        });
      });
      return total;
    };

    /* -----------------------------
        5. HOUSE PAINTING METRICS
    ----------------------------- */
    let hpResponded = 0;
    let hpSurvey = 0;
    let hpHiring = 0;
    let hpVendorRatings = new Map(); // Store ratings by vendor for aggregation

    // Process house painting leads
    for (const lead of hpLeads) {
      const prof = lead.assignedProfessional;
      if (!prof) continue;

      if (prof.acceptedDate) hpResponded++;
      if (prof.startedDate) hpSurvey++;

      const status = normalize(lead.bookingDetails?.status);

      const isHired =
        status === "hired" ||
        status === "project ongoing" ||
        lead.bookingDetails?.firstPayment?.status === "paid";

      if (isHired) hpHiring++;

      // Collect vendor IDs for rating calculation
      const vendorId = prof.professionalId;
      if (vendorId && !hpVendorRatings.has(vendorId)) {
        // Calculate ratings for this vendor
        const ratings = await calculateVendorRatings(
          vendorId,
          period === "this_month" ? "month" : "last",
        );
        hpVendorRatings.set(vendorId, ratings);
      }
    }

    const hpTotalGsv = calcGSV(hpLeads);
    const hpAvgGsv = hpLeads.length ? hpTotalGsv / hpLeads.length : 0;

    // Calculate overall ratings for house painting category
    let hpTotalRatingsSum = 0;
    let hpTotalRatingsCount = 0;
    let hpTotalStrikes = 0;

    hpVendorRatings.forEach((ratingData) => {
      hpTotalRatingsSum += ratingData.averageRating * ratingData.totalRatings;
      hpTotalRatingsCount += ratingData.totalRatings;
      hpTotalStrikes += ratingData.strikes;
    });

    const hpAverageRating =
      hpTotalRatingsCount > 0 ? hpTotalRatingsSum / hpTotalRatingsCount : 0;

    /* -----------------------------
        6. DEEP CLEANING METRICS
    ----------------------------- */
    let dcResponded = 0;
    let dcCancelled = 0;
    let dcVendorRatings = new Map();

    // Process deep cleaning leads
    for (const lead of dcLeads) {
      const invited = lead.invitedVendors?.[0];
      if (!invited) continue;

      if (invited.responseStatus === "accepted") dcResponded++;

      // FIX: Proper cancellation counting logic
      if (invited.responseStatus === "customer_cancelled") {
        const slot = moment(
          `${lead.selectedSlot.slotDate} ${lead.selectedSlot.slotTime}`,
          "YYYY-MM-DD hh:mm A",
        );
        const cancelled = moment(invited.cancelledAt);
        const diff = slot.diff(cancelled, "hours", true);

        if (diff >= 0 && diff <= 3) {
          dcCancelled++;
        }
      }

      // Collect vendor ID for rating calculation
      const vendorId = invited.professionalId;
      if (vendorId && !dcVendorRatings.has(vendorId)) {
        const ratings = await calculateVendorRatings(
          vendorId,
          period === "this_month" ? "month" : "last",
        );
        dcVendorRatings.set(vendorId, ratings);
      }
    }

    const dcTotalGsv = calcGSV(dcLeads);
    const dcAvgGsv = dcLeads.length ? dcTotalGsv / dcLeads.length : 0;

    // Calculate overall ratings for deep cleaning category
    let dcTotalRatingsSum = 0;
    let dcTotalRatingsCount = 0;
    let dcTotalStrikes = 0;

    dcVendorRatings.forEach((ratingData) => {
      dcTotalRatingsSum += ratingData.averageRating * ratingData.totalRatings;
      dcTotalRatingsCount += ratingData.totalRatings;
      dcTotalStrikes += ratingData.strikes;
    });

    const dcAverageRating =
      dcTotalRatingsCount > 0 ? dcTotalRatingsSum / dcTotalRatingsCount : 0;

    /* -----------------------------
        7. VENDOR-WISE METRICS
    ----------------------------- */
    const getVendorStats = async (arr, type) => {
      const map = {};

      for (const lead of arr) {
        let vendorId;
        let prof;

        if (type === "hp") {
          prof = lead.assignedProfessional;
          if (!prof) continue;
          vendorId = prof.professionalId;
        } else {
          // For DC, find the vendor in invitedVendors
          const invited = lead.invitedVendors?.find(
            (iv) => String(iv.professionalId) === String(vendorId),
          );
          if (!invited) continue;
          prof = invited;
          vendorId = invited.professionalId;
        }

        if (!vendorId) continue;

        if (!map[vendorId]) {
          // Get vendor ratings
          const ratings = await calculateVendorRatings(
            vendorId,
            period === "this_month" ? "month" : "last",
          );

          map[vendorId] = {
            vendorId: vendorId,
            name: prof.name || "Unknown",
            totalLeads: 0,
            responded: 0,
            survey: 0,
            hired: 0,
            cancelled: 0,
            gsv: 0,
            ratingSum:
              ratings.totalRatings > 0
                ? ratings.averageRating * ratings.totalRatings
                : 0,
            ratingCount: ratings.totalRatings,
            strikes: ratings.strikes,
          };
        }

        const v = map[vendorId];

        v.totalLeads++;

        if (prof.acceptedDate) v.responded++;
        if (prof.startedDate) v.survey++;

        const status = normalize(lead.bookingDetails?.status);
        const isHired =
          status === "hired" ||
          status === "project ongoing" ||
          lead.bookingDetails?.firstPayment?.status === "paid";

        if (isHired) v.hired++;

        if (type === "dc") {
          if (prof.responseStatus === "customer_cancelled") {
            const slot = moment(
              `${lead.selectedSlot.slotDate} ${lead.selectedSlot.slotTime}`,
              "YYYY-MM-DD hh:mm A",
            );
            const cancelled = moment(prof.cancelledAt);
            const diff = slot.diff(cancelled, "hours", true);

            if (diff >= 0 && diff <= 3) {
              v.cancelled++;
            }
          }
        }

        lead.service?.forEach((s) => {
          v.gsv += (s.price || 0) * (s.quantity || 1);
        });
      }

      // Convert map to array and calculate final metrics
      return Object.values(map).map((v) => ({
        ...v,
        responseRate: v.totalLeads
          ? parseFloat(((v.responded / v.totalLeads) * 100).toFixed(2))
          : 0,
        surveyRate: v.responded
          ? parseFloat(((v.survey / v.responded) * 100).toFixed(2))
          : 0,
        hiringRate: v.responded
          ? parseFloat(((v.hired / v.responded) * 100).toFixed(2))
          : 0,
        cancellationRate: v.responded
          ? parseFloat(((v.cancelled / v.responded) * 100).toFixed(2))
          : 0,
        avgRating:
          v.ratingCount > 0
            ? parseFloat((v.ratingSum / v.ratingCount).toFixed(2))
            : 0,
        strikes: v.strikes,
      }));
    };

    const hpVendorStats = await getVendorStats(hpLeads, "hp");
    const dcVendorStats = await getVendorStats(dcLeads, "dc");

    /* -----------------------------
        8. SEND RESPONSE
    ----------------------------- */
    return res.status(200).json({
      housePainting: {
        totalLeads: hpLeads.length,
        surveyPercentage: hpResponded
          ? Math.min((hpSurvey / hpResponded) * 100, 100)
          : 0,
        hiringPercentage: hpResponded
          ? Math.min((hpHiring / hpResponded) * 100, 100)
          : 0,
        averageGsv: parseFloat(hpAvgGsv.toFixed(2)),
        averageRating: parseFloat(hpAverageRating.toFixed(2)),
        strikes: hpTotalStrikes,
        totalRatings: hpTotalRatingsCount,
        cancellationPercentage: 0, // House painting doesn't have cancellation in your current logic
      },

      deepCleaning: {
        totalLeads: dcLeads.length,
        responsePercentage: dcLeads.length
          ? Math.min((dcResponded / dcLeads.length) * 100, 100)
          : 0,
        cancellationPercentage: dcResponded
          ? Math.min((dcCancelled / dcResponded) * 100, 100)
          : 0,
        averageGsv: parseFloat(dcAvgGsv.toFixed(2)),
        averageRating: parseFloat(dcAverageRating.toFixed(2)),
        strikes: dcTotalStrikes,
        totalRatings: dcTotalRatingsCount,
      },

      vendors: {
        housePainting: hpVendorStats,
        deepCleaning: dcVendorStats,
      },
    });
  } catch (err) {
    console.error("Performance error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getBookingForNearByVendorsHousePainting = async (req, res) => {
  try {
    const { lat, long } = req.params;
    if (!lat || !long) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const now = new Date();
    const todayStr = ymdLocal(now);
    const tomorrowStr = ymdLocal(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    );

    const nearbyBookings = await UserBooking.find({
      "address.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(long), parseFloat(lat)],
          },
          $maxDistance: 5000, // meters
        },
      },
      isEnquiry: false,
      "service.category": "House Painting", // matches any array element's category
      "bookingDetails.status": "Pending",
      "selectedSlot.slotDate": { $gte: todayStr, $lte: tomorrowStr }, // today & tomorrow inclusive
    }).sort({ createdAt: -1 });

    // Keep future times for today, keep all for tomorrow
    const nowMoment = moment();
    const filteredBookings = nearbyBookings.filter((booking) => {
      const slotDateStr = booking.selectedSlot?.slotDate; // "YYYY-MM-DD"
      const slotTimeStr = booking.selectedSlot?.slotTime; // "hh:mm AM/PM"
      if (!slotDateStr || !slotTimeStr) return false;

      const slotDateMoment = moment(slotDateStr, "YYYY-MM-DD");
      const slotDateTime = moment(
        `${slotDateStr} ${slotTimeStr}`,
        "YYYY-MM-DD hh:mm A",
      );

      if (slotDateMoment.isSame(nowMoment, "day")) {
        return slotDateTime.isAfter(nowMoment); // only future times today
      }
      if (slotDateMoment.isSame(nowMoment.clone().add(1, "day"), "day")) {
        return true; // keep all tomorrow
      }
      return false;
    });

    if (!filteredBookings.length) {
      return res
        .status(404)
        .json({ message: "No bookings found near this location" });
    }

    res.status(200).json({ bookings: filteredBookings });
  } catch (error) {
    console.error("Error finding nearby bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// exports.respondConfirmJobVendorLine = async (req, res) => {
//   try {
//     const { bookingId, status, assignedProfessional, vendorId, cancelledBy } =
//       req.body;
//     if (!bookingId)
//       return res.status(400).json({ message: "bookingId is required" });
//     if (!vendorId)
//       return res
//         .status(400)
//         .json({ message: "vendorId (professionalId) is required" });

//     const updateFields = {};
//     if (status) updateFields["bookingDetails.status"] = status;
//     if (assignedProfessional)
//       updateFields.assignedProfessional = assignedProfessional;

//     // 1) ensure invite exists
//     await UserBooking.updateOne(
//       {
//         _id: bookingId,
//         "invitedVendors.professionalId": { $ne: String(vendorId) },
//       },
//       {
//         $addToSet: {
//           invitedVendors: {
//             professionalId: String(vendorId),
//             invitedAt: new Date(),
//             responseStatus: "pending",
//           },
//         },
//       }
//     );

//     // 2) build $set from the patch object (DO NOT assign the object to the string path)
//     const patch = mapStatusToInvite(status, cancelledBy);
//     const setOps = {
//       ...updateFields,
//       "invitedVendors.$[iv].respondedAt": new Date(),
//     };
//     if (patch.responseStatus)
//       setOps["invitedVendors.$[iv].responseStatus"] = patch.responseStatus;
//     if (patch.cancelledAt)
//       setOps["invitedVendors.$[iv].cancelledAt"] = patch.cancelledAt;
//     if (patch.cancelledBy)
//       setOps["invitedVendors.$[iv].cancelledBy"] = patch.cancelledBy;

//     const result = await UserBooking.findOneAndUpdate(
//       { _id: bookingId },
//       { $set: setOps },
//       {
//         new: true,
//         runValidators: true,
//         arrayFilters: [{ "iv.professionalId": String(vendorId) }],
//       }
//     );

//     if (!result) return res.status(404).json({ message: "Booking not found" });
//     res.status(200).json({ message: "Booking updated", booking: result });
//   } catch (error) {
//     console.error("Error updating booking:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

exports.respondConfirmJobVendorLine = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { bookingId, status, assignedProfessional, vendorId, cancelledBy } =
      req.body;

    if (!bookingId)
      return res
        .status(400)
        .json({ success: false, message: "bookingId is required" });
    if (!vendorId)
      return res
        .status(400)
        .json({
          success: false,
          message: "vendorId (professionalId) is required",
        });

    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };

    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .trim();
    const normalizedStatus = norm(status);

    // ✅ only these statuses should charge coins
    const shouldChargeCoins = ["confirmed", "accepted"].includes(
      normalizedStatus,
    );

    let updatedBooking = null;

    await session.withTransaction(async () => {
      // 0) Load booking
      const booking = await UserBooking.findById(bookingId).session(session);
      if (!booking) {
        const err = new Error("Booking not found");
        err.statusCode = 404;
        throw err;
      }

      // 1) Ensure invite exists (so arrayFilters always find something)
      await UserBooking.updateOne(
        {
          _id: bookingId,
          "invitedVendors.professionalId": { $ne: String(vendorId) },
        },
        {
          $addToSet: {
            invitedVendors: {
              professionalId: String(vendorId),
              invitedAt: new Date(),
              responseStatus: "pending",
              coinsDeducted: false,
            },
          },
        },
        { session },
      );

      // Re-fetch booking after ensuring invite exists (so we can read coinsDeducted reliably)
      const booking2 = await UserBooking.findById(bookingId).session(session);
      if (!booking2) {
        const err = new Error("Booking not found");
        err.statusCode = 404;
        throw err;
      }

      const inviteEntry = (booking2.invitedVendors || []).find(
        (iv) => String(iv.professionalId) === String(vendorId),
      );
      const alreadyDeducted = !!inviteEntry?.coinsDeducted;

      // 2) Compute required coins (✅ coinDeduction already includes quantity)
      let requiredCoins = 0;
      if (shouldChargeCoins) {
        requiredCoins = (booking2.service || []).reduce(
          (sum, s) => sum + n(s.coinDeduction),
          0,
        );

        // ✅ If coin deduction is not configured properly, do NOT allow Confirm/Accept
        if (requiredCoins <= 0) {
          const err = new Error(
            "Coin deduction not configured for this booking.",
          );
          err.statusCode = 400;
          throw err;
        }
      }

      // 3) HARD BLOCK: If confirming/accepting, vendor must have enough coins (unless already deducted)
      // ✅ Use atomic deduction to prevent race conditions
      if (shouldChargeCoins && !alreadyDeducted) {
        const deductRes = await vendorAuthSchema.updateOne(
          { _id: vendorId, "wallet.coins": { $gte: requiredCoins } },
          { $inc: { "wallet.coins": -requiredCoins } },
          { session },
        );

        // matchedCount === 0 => either vendor not found OR insufficient coins
        if (deductRes.matchedCount === 0) {
          const vendorNow = await vendorAuthSchema
            .findById(vendorId)
            .session(session);
          const available = n(vendorNow?.wallet?.coins);

          const err = new Error(
            `Insufficient wallet coins. Required ${requiredCoins}, available ${available}.`,
          );
          err.statusCode = 400;
          throw err; // ✅ abort transaction => booking will NOT be confirmed
        }

        // Update canRespondLead after deduction
        const vendorAfter = await vendorAuthSchema
          .findById(vendorId)
          .session(session);
        const newCoins = n(vendorAfter?.wallet?.coins);

        await vendorAuthSchema.updateOne(
          { _id: vendorId },
          { $set: { "wallet.canRespondLead": newCoins > 0 } },
          { session },
        );

        // Log transaction
        await walletTransaction.create(
          [
            {
              vendorId,
              title: "Lead response",
              coin: requiredCoins,
              transactionType: "lead response",
              amount: 0,
              gst18Perc: 0,
              totalPaid: 0,
              type: "deduct",
              date: new Date(),
              metaData: {
                bookingId,
                bookingCode: booking2?.bookingDetails?.booking_id,
                serviceType: booking2?.serviceType,
              },
            },
          ],
          { session },
        );

        // Mark coins deducted on invite entry
        // (done via setOps below)
      }

      // 4) Build booking update ops
      const patch = mapStatusToInvite(status, cancelledBy); // your helper (case-sensitive)

      const setOps = {
        // ⚠️ Only update bookingDetails.status when client sends status
        ...(status ? { "bookingDetails.status": status } : {}),
        ...(assignedProfessional ? { assignedProfessional } : {}),
        "invitedVendors.$[iv].respondedAt": new Date(),
      };

      if (patch.responseStatus)
        setOps["invitedVendors.$[iv].responseStatus"] = patch.responseStatus;
      if (patch.cancelledAt)
        setOps["invitedVendors.$[iv].cancelledAt"] = patch.cancelledAt;
      if (patch.cancelledBy)
        setOps["invitedVendors.$[iv].cancelledBy"] = patch.cancelledBy;

      // If we charged coins in this call, mark deducted fields
      if (shouldChargeCoins && !alreadyDeducted) {
        // requiredCoins will be > 0 here (validated above)
        setOps["invitedVendors.$[iv].coinsDeducted"] = true;
        setOps["invitedVendors.$[iv].coinsDeductedAt"] = new Date();
        setOps["invitedVendors.$[iv].coinsDeductedValue"] = requiredCoins;
      }

      // 5) Apply booking update (invite status + maybe booking status)
      updatedBooking = await UserBooking.findOneAndUpdate(
        { _id: bookingId },
        { $set: setOps },
        {
          new: true,
          runValidators: true,
          session,
          arrayFilters: [{ "iv.professionalId": String(vendorId) }],
        },
      );

      if (!updatedBooking) {
        const err = new Error("Booking not found");
        err.statusCode = 404;
        throw err;
      }
    });

    return res.status(200).json({
      success: true,
      message: "Booking updated",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error?.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

exports.getBookingExceptPendingAndCancelled = async (req, res) => {
  try {
    const { professionalId } = req.params;
    if (!professionalId) {
      return res.status(400).json({ message: "Professional ID is required" });
    }

    const q = {
      "assignedProfessional.professionalId": professionalId,
      "bookingDetails.status": {
        $ne: "Pending",
        $ne: "Cancelled",
        $ne: "Cancelled Rescheduled",
      },
    };

    // Descending by date (reverse: 29, 28, 27...), then most recent created
    const leadsList = await UserBooking.find(q)
      .sort({ "selectedSlot.slotDate": -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ leadsList });
  } catch (error) {
    console.error("Error finding confirmed bookings:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// exports.startJob = async (req, res) => {
//   try {
//     const { bookingId, status, assignedProfessional, otp } = req.body;

//     if (!bookingId) {
//       return res.status(400).json({ message: "bookingId is required" });
//     }
//     if (!otp) {
//       return res.status(400).json({ message: "OTP is required" });
//     }

//     // Step 1: Find the booking
//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }

//     // Step 2: Compare OTP
//     const storedOtp = booking.bookingDetails?.otp;
//     if (parseInt(storedOtp) !== parseInt(otp)) {
//       return res.status(401).json({ message: "Invalid OTP" });
//     }

//     // Step 3: Prepare update fields
//     const updateFields = {};
//     if (status) updateFields["bookingDetails.status"] = status;
//     if (assignedProfessional)
//       updateFields.assignedProfessional = assignedProfessional;

//     // Step 4: Update the booking
//     const updatedBooking = await UserBooking.findByIdAndUpdate(
//       bookingId,
//       { $set: updateFields },
//       { new: true }
//     );

//     res.status(200).json({ message: "Job Started", booking: updatedBooking });
//   } catch (error) {
//     console.error("Error updating booking:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

exports.startJob = async (req, res) => {
  try {
    const {
      bookingId,
      startDate, // e.g., "2025-10-03"
      daysRequired = 1, // default to 1 day
      status,
      assignedProfessional,
      otp,
      teamMembers = [], // Array of { _id, name }
    } = req.body;

    // === Validation ===
    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }
    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }

    // === Fetch booking ===
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // === Validate OTP ===
    const storedOtp = booking.bookingDetails?.otp;
    if (!storedOtp || parseInt(storedOtp) !== parseInt(otp)) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // === Determine service type ===
    // Adjust this logic based on how you identify Deep Cleaning vs House Painting
    const isHousePainter = booking.service.some(
      (s) =>
        s.category?.toLowerCase().includes("paint") ||
        s.serviceName?.toLowerCase().includes("paint"),
    );

    // === Prepare hiring data (for Deep Cleaning only) ===
    const hiringUpdate = {};
    if (!isHousePainter && teamMembers.length > 0 && startDate) {
      // Generate project dates array
      const projectDates = [];
      const startMoment = moment(startDate, "YYYY-MM-DD");
      for (let i = 0; i < daysRequired; i++) {
        projectDates.push(
          startMoment.clone().add(i, "days").format("YYYY-MM-DD"),
        );
      }

      hiringUpdate["assignedProfessional.hiring"] = {
        markedDate: new Date(),
        markedTime: moment().format("LT"),
        teamMember: teamMembers.map((m) => ({
          memberId: m._id,
          memberName: m.name,
        })),
        projectDate: projectDates,
        noOfDay: daysRequired,
        status: "active",
        autoCancelAt: moment(startDate, "YYYY-MM-DD").add(1, "days").toDate(), // optional
      };
    }

    // === Prepare full update object ===
    const updateFields = {
      "bookingDetails.status":
        status || (isHousePainter ? "Survey Ongoing" : "Job Ongoing"),

      "bookingDetails.isJobStarted": isHousePainter ? false : true,
      "bookingDetails.startProject": isHousePainter ? false : true,

      "assignedProfessional.professionalId":
        assignedProfessional.professionalId,
      "assignedProfessional.name": assignedProfessional.name,
      "assignedProfessional.phone": assignedProfessional.phone,
      "assignedProfessional.acceptedDate": assignedProfessional.acceptedDate,
      "assignedProfessional.acceptedTime": assignedProfessional.acceptedTime,
      "assignedProfessional.startedDate": new Date(),
      "assignedProfessional.startedTime":
        assignedProfessional.startedTime || moment().format("LT"),
      ...hiringUpdate, // Only populated for Deep Cleaning
    };

    // === Update booking ===
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      message: "Job started successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error in startJob:", error);
    return res.status(500).json({
      message: "Failed to start job",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.completeSurvey = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    // Step 1: Find the booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // Step 2: Prepare update fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // Step 3: Update the booking
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true },
    );

    res.status(200).json({ message: "Completed", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// exports.updatePricing = async (req, res) => {
//   try {
//     const { bookingId } = req.params;
//     const { amount, scopeType, reasonForEditing, comment } = req.body;
//     // amount: number to add/reduce; scopeType: 'Added' | 'Reduced'

//     if (
//       !bookingId ||
//       amount == null ||
//       !["Added", "Reduced"].includes(scopeType)
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "bookingId, amount, and scopeType (Added|Reduced) are required",
//       });
//     }

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking)
//       return res
//         .status(404)
//         .json({ success: false, message: "Booking not found." });

//     const d = booking.bookingDetails || (booking.bookingDetails = {});
//     const lastApproved = (d.priceChanges || [])
//       .filter((c) => String(c.state).toLowerCase() === "approved")
//       .slice(-1)[0];

//     const kind = (booking.service[0].category || "").toLowerCase();
//     const isDeepCleaning = kind.includes("clean");

//     const state =
//       d.priceApprovalState ??
//       (d.priceApprovalStatus
//         ? "approved"
//         : d.hasPriceUpdated
//         ? "pending"
//         : "approved");

//     if (d.hasPriceUpdated && String(state).toLowerCase() === "pending") {
//       return res.status(409).json({
//         success: false,
//         message:
//           "A previous price change is awaiting approval. You cannot make another edit until it is approved or rejected.",
//       });
//     }
//     const paid = Number(d.paidAmount || 0);

//     let effectiveBase;
//     if (lastApproved && Number.isFinite(lastApproved.proposedTotal)) {
//       effectiveBase = Number(lastApproved.proposedTotal);
//     } else if (isDeepCleaning) {
//       // Deep Cleaning: base is the booking package total
//       effectiveBase = Number(d.bookingAmount || 0);
//     } else {
//       // House Painting and others
//       effectiveBase = Number(
//         (Number.isFinite(d.finalTotal) && d.finalTotal > 0
//           ? d.finalTotal
//           : null) ??
//           (Number.isFinite(d.currentTotalAmount) && d.currentTotalAmount > 0
//             ? d.currentTotalAmount
//             : null) ??
//           d.bookingAmount ??
//           0
//       );
//     }

//     // 🔑 Effective base is the latest approved total; if none, use original
//     // this one checking only for house painting
//     // const effectiveBase = Number(
//     //   d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0
//     // );

//     // now checking with both case: DC and HP
//     // With this safer version
//     // const effectiveBase = Number(
//     //   d.finalTotal && d.finalTotal > 0
//     //     ? d.finalTotal
//     //     : d.currentTotalAmount && d.currentTotalAmount > 0
//     //     ? d.currentTotalAmount
//     //     : d.bookingAmount
//     // );

//     // Signed delta (+ for Added, - for Reduced)
//     const signedDelta =
//       (scopeType === "Reduced" ? -1 : 1) * Math.abs(Number(amount));

//     const proposedTotalRaw = effectiveBase + signedDelta;

//     // Guardrails
//     if (proposedTotalRaw < paid) {
//       return res.status(400).json({
//         success: false,
//         message: `This change would make the total ₹${proposedTotalRaw}, which is less than already paid ₹${paid}. Please enter a valid amount.`,
//       });
//     }
//     if (!(proposedTotalRaw >= 0)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Proposed total would be negative." });
//     }

//     // Mark as new pending proposal
//     d.hasPriceUpdated = true;
//     d.priceApprovalState = "pending";
//     d.priceApprovalStatus = false; // legacy sync
//     d.scopeType = scopeType;
//     d.editedPrice = signedDelta; // store SIGNED delta (e.g., +500, -250)
//     d.newTotal = proposedTotalRaw; // always server-computed
//     d.priceEditedDate = new Date();
//     d.priceEditedTime = moment().format("LT");
//     d.reasonForEditing = reasonForEditing || d.reasonForEditing;
//     // d.editComment = comment || d.editComment;
//     d.approvedBy = null;
//     d.rejectedBy = null;

//     // Live preview values
//     // d.amountYetToPay = Math.max(0, d.newTotal - paid);

//     await booking.save();
//     return res.status(200).json({
//       success: true,
//       message: "Price change proposed and awaiting approval.",
//       base: effectiveBase,
//       delta: signedDelta,
//       proposedTotal: d.newTotal,
//       paidAmount: paid,
//       amountYetToPay: d.amountYetToPay,
//     });
//   } catch (error) {
//     console.error("updatePricing error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error while updating price.",
//       error: error.message,
//     });
//   }
// };

exports.requestPriceChange = async (req, res) => {
  const { bookingId } = req.params;
  const { adjustmentAmount, proposedTotal, reason, scopeType, requestedBy } =
    req.body;

  const booking = await UserBooking.findById(bookingId);
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const pendingChange = booking.bookingDetails.priceChanges.find(
    (c) => c.status === "pending",
  );
  if (pendingChange) {
    return res
      .status(400)
      .json({ error: "A price change is already pending approval" });
  }

  if (scopeType === "Added") {
    booking.bookingDetails.priceUpdateRequestedToUser = true;
  } else {
    booking.bookingDetails.priceUpdateRequestedToAdmin = true;
  }

  booking.bookingDetails.hasPriceUpdated = true;

  const newChange = {
    adjustmentAmount,
    proposedTotal: Number(proposedTotal),
    reason,
    scopeType,
    requestedBy,
    status: "pending",
    requestedAt: new Date(),
  };

  booking.bookingDetails.priceChanges.push(newChange);
  await booking.save();

  res.json({
    success: true,
    message: "Price change requested",
    change: newChange,
  });
};

exports.approvePriceChange = async (req, res) => {
  const { bookingId } = req.params;
  const { approvedBy } = req.body; // "admin" or "customer"

  const booking = await UserBooking.findById(bookingId);
  const d = booking.bookingDetails;

  const pendingChange = d.priceChanges
    .slice() // copy
    .reverse() // get latest first
    .find((c) => c.status === "pending");

  if (!pendingChange) {
    return res
      .status(400)
      .json({ error: "No pending price change to approve" });
  }
  d.priceUpdateRequestedToUser = false;
  d.priceUpdateRequestedToAdmin = false;
  // Approve it
  pendingChange.status = "approved";
  pendingChange.approvedBy = approvedBy;
  pendingChange.approvedAt = new Date();

  // Update finalTotal
  d.finalTotal = pendingChange.proposedTotal;

  // Recalculate unpaid installments
  recalculateInstallments(d);

  await booking.save();
  res.json({ success: true, finalTotal: d.finalTotal });
};

exports.rejectPriceChange = async (req, res) => {
  const { bookingId } = req.params;
  const { rejectedBy } = req.body;

  const booking = await UserBooking.findById(bookingId);
  const d = booking.bookingDetails;

  const pendingChange = d.priceChanges
    .slice()
    .reverse()
    .find((c) => c.status === "pending");

  if (!pendingChange) {
    return res.status(400).json({ error: "No pending price change to reject" });
  }
  d.priceUpdateRequestedToUser = false;
  d.priceUpdateRequestedToAdmin = false;
  pendingChange.status = "rejected";
  pendingChange.rejectedBy = rejectedBy;
  pendingChange.rejectedAt = new Date();

  await booking.save();
  res.json({ success: true, message: "Price change rejected" });
};

exports.cancelJob = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      { new: true },
    );

    res.status(200).json({ message: "Job Cancelled", booking: updatedBooking });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { bookingId, status, vendorId, reasonForCancelled, cancelledBy } =
      req.body;
    if (!bookingId)
      return res.status(400).json({ message: "bookingId is required" });

    const booking = await UserBooking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const actingVendorId =
      vendorId || booking?.assignedProfessional?.professionalId;
    if (!actingVendorId)
      return res.status(400).json({
        message: "vendorId is required (or assign a professional first)",
      });

    // "Customer Cancelled"
    // booking-level fields
    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (reasonForCancelled)
      updateFields["bookingDetails.reasonForCancelled"] = reasonForCancelled;

    // ensure invite exists
    await UserBooking.updateOne(
      {
        _id: bookingId,
        "invitedVendors.professionalId": { $ne: String(actingVendorId) },
      },
      {
        $addToSet: {
          invitedVendors: {
            professionalId: String(actingVendorId),
            invitedAt: new Date(),
            responseStatus: "pending",
          },
        },
      },
    );

    // build invite patch
    const patch = mapStatusToInvite(status, cancelledBy);

    const setOps = {
      ...updateFields,
      "invitedVendors.$[iv].respondedAt": new Date(),
    };
    if (patch.responseStatus)
      setOps["invitedVendors.$[iv].responseStatus"] = patch.responseStatus;
    if (patch.cancelledAt)
      setOps["invitedVendors.$[iv].cancelledAt"] = patch.cancelledAt;
    if (patch.cancelledBy)
      setOps["invitedVendors.$[iv].cancelledBy"] = patch.cancelledBy;

    const updated = await UserBooking.findOneAndUpdate(
      { _id: bookingId },
      { $set: setOps },
      {
        new: true,
        runValidators: true,
        arrayFilters: [{ "iv.professionalId": String(actingVendorId) }],
      },
    );

    if (!updated)
      return res
        .status(404)
        .json({ message: "Booking not found after update" });

    const vendorName = booking?.assignedProfessional?.name;
    const ID = booking?.bookingDetails.booking_id;

    await notificationSchema.create({
      bookingId: booking._id,
      notificationType: "VENDOR_CANCEL_REQUESTED",
      thumbnailTitle: "Vendor Cancel Requested",
      message: `Vendor ${vendorName} marked Lead #${ID} as cancelled.`,
      status: "unread",
      created_at: new Date(),
      notifyTo: "admin",
    });

    res.status(200).json({ message: "Status Updated", booking: updated });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// reschedule booking by vendor
exports.rescheduleBooking = async (req, res) => {
  try {
    const { bookingId, vendorId, slotDate, slotTime } = req.body;

    if (!bookingId || !slotDate || !slotTime) {
      return res.status(400).json({
        message: "bookingId, slotDate and slotTime are required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const actingVendorId =
      vendorId || booking.assignedProfessional?.professionalId;

    if (!actingVendorId) {
      return res.status(400).json({ message: "vendorId is required" });
    }

    // ✅ Update booking safely
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      {
        $set: {
          "bookingDetails.status": "Rescheduled",
          "selectedSlot.slotDate": slotDate,
          "selectedSlot.slotTime": slotTime,
        },
      },
      { new: true },
    );

    return res.status(200).json({
      message: "Booking rescheduled successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error rescheduling booking:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// cancellling by customer from the website
// won't count this in Vendor's performance, this lead will vanish from the android app
exports.cancelLeadFromWebsite = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { bookingId, status } = req.body;

    if (!bookingId)
      return res
        .status(400)
        .json({ success: false, message: "bookingId is required" });

    if (!status)
      return res
        .status(400)
        .json({ success: false, message: "status is required" });

    await session.withTransaction(async () => {
      const booking = await UserBooking.findById(bookingId).session(session);
      if (!booking) {
        const err = new Error("Booking not found");
        err.statusCode = 404;
        throw err;
      }

      // 1) Update booking status
      const updateFields = {
        "bookingDetails.status": status,
        "bookingDetails.updatedAt": new Date(),
      };

      // 2) Refund logic only when vendor already accepted (and booking is deep_cleaning if needed)
      // Decide which statuses should trigger refund
      const refundTriggerStatuses = [
        "customer cancelled",
        "cancelled",
        "canceled",
      ];
      const shouldRefund = refundTriggerStatuses.includes(norm(status));

      // Find accepted vendor from invitedVendors
      const acceptedInvite = (booking.invitedVendors || []).find(
        (v) => norm(v.responseStatus) === "accepted",
      );

      if (shouldRefund && acceptedInvite?.professionalId) {
        const vendorId = String(acceptedInvite.professionalId);

        // ✅ Prevent double refund
        if (!acceptedInvite.coinsRefunded) {
          // 3) Compute refund coins
          // Based on your latest clarification: coinDeduction already includes quantity.
          // So sum directly, do NOT multiply with quantity.
          const coinsToRefund = (booking.service || []).reduce((sum, s) => {
            return sum + Number(s.coinDeduction || 0);
          }, 0);

          if (coinsToRefund > 0) {
            // 4) Add coins back to vendor wallet
            const vendor = await vendorAuthSchema
              .findById(vendorId)
              .session(session);
            if (!vendor) {
              const err = new Error("Vendor not found for refund");
              err.statusCode = 404;
              throw err;
            }

            const currentCoins = Number(vendor?.wallet?.coins || 0);
            vendor.wallet.coins = currentCoins + coinsToRefund;
            vendor.wallet.canRespondLead = vendor.wallet.coins > 0;

            await vendor.save({ session });

            // 5) Store transaction history (refund)
            await walletTransaction.create(
              [
                {
                  vendorId: vendorId,
                  title: `Lead cancellation refund`,
                  amount: 0,
                  coin: coinsToRefund,
                  gst18Perc: 0,
                  totalPaid: 0,
                  transactionType: "cancellation refund",
                  type: "added",
                  date: new Date(),
                  meta: {
                    bookingId: String(booking._id),
                    bookingCode: booking?.bookingDetails?.booking_id,
                    reason: status,
                    serviceType: booking?.serviceType,
                  },
                },
              ],
              { session },
            );

            // 6) Mark refunded in invitedVendors entry (idempotency)
            // We'll update via arrayFilters
            updateFields["invitedVendors.$[iv].coinsRefunded"] = true;
            updateFields["invitedVendors.$[iv].coinsRefundedAt"] = new Date();
            updateFields["invitedVendors.$[iv].coinsRefundedValue"] =
              coinsToRefund;
          }
        }
      }

      const updated = await UserBooking.findByIdAndUpdate(
        bookingId,
        { $set: updateFields },
        {
          new: true,
          runValidators: true,
          session,
          arrayFilters: acceptedInvite?.professionalId
            ? [{ "iv.professionalId": String(acceptedInvite.professionalId) }]
            : undefined,
        },
      );

      if (!updated) {
        const err = new Error("Booking not found after update");
        err.statusCode = 404;
        throw err;
      }

      // 7) Notification to admin (your existing logic)
      const customerName = booking?.customer?.name;
      const customer_id = booking?.customer?.customerId;
      const ID = booking?.bookingDetails?.booking_id;

      await notificationSchema.create(
        [
          {
            bookingId: booking._id,
            notificationType: "CUSTOMER_CANCEL_REQUESTED",
            thumbnailTitle: "Lead Cancel Requested",
            message: `Customer ${customerName} has requested cancellation for Lead #${ID}.`,
            metaData: {
              customer_id,
              customerMsg: `Your booking #${ID} has been cancelled.`,
            },
            status: "unread",
            created_at: new Date(),
            notifyTo: "admin",
          },
        ],
        { session },
      );

      res.locals.updatedBooking = updated;
    });

    return res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      booking: res.locals.updatedBooking,
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};
// exports.cancelLeadFromWebsite = async (req, res) => {
//   try {
//     const { bookingId, status } = req.body;

//     if (!bookingId)
//       return res.status(400).json({ message: "bookingId is required" });

//     if (!status) return res.status(400).json({ message: "status is required" });

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) return res.status(404).json({ message: "Booking not found" });

//     // booking-level fields
//     const updateFields = {
//       "bookingDetails.status": status,
//       "bookingDetails.updatedAt": new Date(), // track when status changed
//     };

//     const updated = await UserBooking.findByIdAndUpdate(
//       bookingId,
//       { $set: updateFields },
//       {
//         new: true,
//         runValidators: true,
//       }
//     );

//     if (!updated)
//       return res
//         .status(404)
//         .json({ message: "Booking not found after update" });

//     const customerName = booking?.customer.name;
//     const customer_id = booking?.customer.customerId;
//     const ID = booking?.bookingDetails.booking_id;
//     const newBookingNotification = {
//       bookingId: booking._id,
//       notificationType: "CUSTOMER_CANCEL_REQUESTED",
//       thumbnailTitle: "Lead Cancel Requested",
//       message: `Customer ${customerName} has requested cancellation for Lead #${ID}.`,
//       metaData: {
//         customer_id,
//         customerMsg: `Your booking #${ID} has been cancelled.`,
//       },
//       status: "unread",
//       created_at: new Date(),
//       notifyTo: "admin",
//     };
//     await notificationSchema.create(newBookingNotification);

//     res.status(200).json({
//       message: "Booking cancelled successfully",
//       booking: updated,
//     });
//   } catch (error) {
//     console.error("Error cancelling booking:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

exports.bookingCancelledbyAdmin = async (req, res) => {
  try {
    const { bookingId, refundAmount = 0 } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "bookingId is required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const d = booking.bookingDetails;
    d.status = "Admin Cancelled";
    // ===============================
    // REFUND LOGIC
    // ===============================
    if (refundAmount > 0) {
      d.refundAmount = refundAmount;
      d.paymentStatus = "Refunded";
      d.refundedAt = new Date();
    }

    d.cancelApprovedAt = new Date();

    await booking.save();

    // ===============================
    // NOTIFICATION
    // ===============================
    const message =
      refundAmount > 0
        ? `A refund of Rs.${refundAmount} has been initiated.`
        : "Your cancellation request has been approved.";

    await notificationSchema.create({
      bookingId: booking._id,
      notificationType: "CANCEL_REQUEST_ACCEPTED",
      thumbnailTitle: "Cancel Request Approved",
      message,
      status: "unread",
      created_at: new Date(),
      notifyTo: "customer",
    });

    return res.status(200).json({
      success: true,
      message: "Booking cancelled by admin successfully",
      refundAmount,
    });
  } catch (error) {
    console.error("Error while approving cancellation request:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.approveCancelRequestAndRefund = async (req, res) => {
  try {
    const { bookingId, refundAmount = 0 } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "bookingId is required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const cancelledStatuses = ["Cancelled", "Customer Cancelled"];

    // Booking must already be cancelled
    if (!cancelledStatuses.includes(booking.bookingDetails?.status)) {
      return res.status(400).json({
        success: false,
        message: "Booking is not in cancelled state",
      });
    }

    const d = booking.bookingDetails;
    const cancelRequestedBy =
      booking.bookingDetails?.status === "Cancelled" ? "customer" : "vendor";

    // ===============================
    // REFUND LOGIC
    // ===============================
    if (refundAmount > 0) {
      d.refundAmount = refundAmount;
      d.paymentStatus = "Refunded";
      d.refundedAt = new Date();
    }
    d.hasLeadLocked = cancelRequestedBy === "vendor" ? true : false;
    d.cancelApprovedAt = new Date();
    // d.cancelApprovedBy = "admin";

    await booking.save();

    // ===============================
    // NOTIFICATION
    // ===============================
    const message =
      refundAmount > 0
        ? `A refund of Rs.${refundAmount} has been initiated.`
        : "Your cancellation request has been approved.";

    await notificationSchema.create({
      bookingId: booking._id,
      notificationType: "CANCEL_REQUEST_ACCEPTED",
      thumbnailTitle: "Cancel Request Approved",
      message,
      status: "unread",
      created_at: new Date(),
      notifyTo: "customer",
    });

    return res.status(200).json({
      success: true,
      message: "Cancellation approved successfully",
      refundAmount,
    });
  } catch (error) {
    console.error("Error while approving cancellation request:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// HOUSE PAINTING - FIRST PAYMENT REQUESTED - LINK SENT
exports.markPendingHiring = async (req, res) => {
  try {
    const { bookingId, startDate, teamMembers, noOfDays, quotationId } =
      req.body;
    const quotationObjectId = new mongoose.Types.ObjectId(quotationId);
    // Find booking
    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      // console.log("Booking not found");
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    // Update bookingDetails status
    booking.bookingDetails.status = "Pending Hiring";
    booking.bookingDetails.startProject = true;

    const quoteDoc = await Quote.findById(quotationId).lean();
    if (!quoteDoc) {
      return res
        .status(400)
        .json({ success: false, message: "Quotation not found" });
    }

    console.log("Attempting to lock quotation:", quotationId);

    // ✅ Calculate TOTAL AMOUNT from quote (or fallback to service total)
    const totalAmount = booking.bookingDetails.bookingAmount;

    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Finalize quote first.",
      });
    }
    console.log("Finalized total amount:", totalAmount);
    booking.bookingDetails.currentTotalAmount = totalAmount;

    const d = booking.bookingDetails;

    // If we already have an approved total, keep it; else adopt the booking/quote amount
    const approvedTotal = Number(
      d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0,
    );

    d.finalTotal = approvedTotal > 0 ? approvedTotal : Number(totalAmount || 0);

    // Keep mirror in sync
    d.currentTotalAmount = d.finalTotal;
    // booking.service[0].price = finalTotal;  added by sonali
    d.paymentStatus = "Unpaid";
    d.paidAmount = 0;
    d.amountYetToPay = d.finalTotal;
    // booking.bookingDetails.amountYetToPay =  firstInstallment; // old line check with below

    // ✅ Calculate 40% for first installment...................
    const firstInstallment = Math.round(d.finalTotal * 0.4);
    d.firstPayment.amount = 0; //firstInstallment || Math.round(finalTotal * 0.4);
    d.firstPayment.status = "pending";
    // presever installment amt
    d.firstPayment.requestedAmount =
      firstInstallment || Math.round(finalTotal * 0.4);
    d.firstPayment.remaining = firstInstallment;
    // ..........................

    const updatedQuote = await Quote.updateOne(
      { _id: quotationObjectId, status: "finalized" }, // Make sure you're selecting the finalized quote
      { $set: { locked: true } }, // Lock the quotation
    );

    if (!mongoose.Types.ObjectId.isValid(quotationId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid quotation ID" });
    }

    // console.log("Updated quotation:", updatedQuote);

    if (updatedQuote.nModified === 0) {
      console.log("Failed to lock the quotation, no rows modified.");
    } else {
      console.log("Quotation locked successfully.");
    }

    // 1. Build project dates (as before)
    const projectDate = Array.from({ length: noOfDays }, (_, i) =>
      moment(startDate).add(i, "days").format("YYYY-MM-DD"),
    );

    // 2. Create a proper Date object for "first project day at 10:30 AM"
    const projectStartDateTime = moment(projectDate[0], "YYYY-MM-DD")
      .set({ hour: 10, minute: 30, second: 0, millisecond: 0 })
      .toDate();

    // 3. Update selectedSlot to reflect the project start (not booking time)
    booking.selectedSlot.slotDate = projectDate[0]; // e.g., "2025-09-25"
    booking.selectedSlot.slotTime = "10:30 AM"; // Fixed per client requirement

    // 4. Store the full datetime in bookingDetails for UI display (if needed)
    booking.bookingDetails.projectStartDate = projectStartDateTime; // This should be a Date

    // 5. Auto-cancel logic (unchanged)
    const firstDay = projectDate[0]; // no need to sort — it's already in order
    const autoCancelAt = buildAutoCancelAtUTC(firstDay);
    booking.assignedProfessional.hiring.autoCancelAt = autoCancelAt;

    // 4) Auto-cancel time = 07:30 IST of first project day (store UTC Date)
    // "firstDay" is 'YYYY-MM-DD' in IST
    // const autoCancelAt = moment(`${firstDay} 07:30`, 'YYYY-MM-DD HH:mm')
    //   .subtract(5, 'hours')
    //   .subtract(30, 'minutes')
    //   .toDate(); // this Date represents the same instant (02:00 UTC)

    // 5) Hiring block
    booking.assignedProfessional.hiring = {
      markedDate: new Date(),
      markedTime: moment().format("LT"),
      projectDate: Array.from({ length: noOfDays }, (_, i) =>
        moment(startDate).add(i, "days").format("YYYY-MM-DD"),
      ),
      noOfDay: noOfDays,
      teamMember: teamMembers.map((m) => ({
        memberId: m._id,
        memberName: m.name,
      })),
      quotationId: quotationObjectId,
      status: "active",
      autoCancelAt,
    };

    if (!booking?.assignedProfessional?.hiring?.quotationId) {
      console.warn("[unlockQuotes] No quotationId found, skipping unlock");
      return;
    }
    // Carry over leadId if missing
    if (!booking.leadId && quoteDoc.leadId) {
      booking.leadId = quoteDoc.leadId;
    }

    console.log("firstInstallment", firstInstallment);

    // ✅ UPDATE PAYMENT FIELDS FOR 40% INSTALLMENT
    booking.bookingDetails.status = "Pending Hiring";
    booking.bookingDetails.startProject = true;

    booking.bookingDetails.paymentStatus = "Unpaid";
    booking.bookingDetails.paidAmount = 0; // nothing paid yet
    // booking.bookingDetails.amountYetToPay = firstInstallment; // 40% due now
    booking.bookingDetails.amountYetToPay = d.finalTotal; // 40% due now

    // 6) Payment link (change to razor pay)
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${bookingId}/${Date.now()}/${pay_type}`;
    booking.bookingDetails.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: generateProviderRef(), // fill if you have gateway id
      installmentStage: "first",
    };

    // console.log("paymentLinkUrl", paymentLinkUrl);

    if (process.env.NODE_ENV !== "production") {
      booking.assignedProfessional.hiring.autoCancelAt = new Date(
        Date.now() + 2 * 60 * 1000,
      ); // +2 mins
    }
    const USE_REAL_AUTO_CANCEL = true; // 👈 set to true for real-time test

    if (!USE_REAL_AUTO_CANCEL && process.env.NODE_ENV !== "production") {
      booking.assignedProfessional.hiring.autoCancelAt = new Date(
        Date.now() + 2 * 60 * 1000,
      );
      console.log(
        "DEV: autoCancelAt set to",
        booking.assignedProfessional.hiring.autoCancelAt.toISOString(),
      );
    } else {
      // Use real auto-cancel time
      const firstDay = projectDate[0]; // e.g., "2025-09-25"
      const autoCancelAt = buildAutoCancelAtUTC(firstDay);
      booking.assignedProfessional.hiring.autoCancelAt = autoCancelAt;
    }

    await booking.save();
    // await unlockRelatedQuotesByHiring(booking, "auto-unpaid");

    // await booking.save();
    // await Quote.updateMany(
    //   { _id: { $in: booking.quotationId }, locked: true },
    //   { $set: { locked: false } }
    // );

    // TODO: Send SMS/Email/WhatsApp to customer with paymentLink

    res.json({
      success: true,
      message:
        "Booking updated to Pending Hiring. Payment link sent to customer.",
      bookingId,
      paymentLink: paymentLinkUrl,
      amountDue: firstInstallment,
      totalAmount: totalAmount,
      firstPayment: d.firstPayment.status,
    });
  } catch (err) {
    console.error("Error marking pending hiring:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

exports.requestStartProjectOtp = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    if (booking.bookingDetails.status !== "Hired") {
      return res.status(400).json({
        success: false,
        message: "Only 'Hired' bookings can request to start project",
      });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // ✅ Hash OTP before saving (SECURITY BEST PRACTICE)
    const hashedOtp = await bcrypt.hash(otp, 10);

    booking.bookingDetails.startProjectOtp = hashedOtp;
    booking.bookingDetails.startProjectOtpExpiry = expiry;
    booking.bookingDetails.startProjectRequestedAt = new Date();

    await booking.save();

    // ✅ Send OTP via SMS/WhatsApp (mock here)
    console.log(
      `[OTP SENT] Booking ${bookingId} - OTP: ${otp} (expires at ${expiry})`,
    );
    // In real: await sendSms(customer.phone, `Your project start OTP: ${otp}. Valid for 10 mins.`);

    res.json({
      success: true,
      message: "OTP sent to customer. Await verification to start project.",
      otp: otp,
    });
  } catch (err) {
    console.error("Error requesting start-project OTP:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.verifyStartProjectOtp = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { otp } = req.body;

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    const details = booking.bookingDetails;

    if (details.status !== "Hired") {
      return res.status(400).json({
        success: false,
        message: "Booking must be 'Hired' to start project",
      });
    }

    if (!details.startProjectOtp || !details.startProjectOtpExpiry) {
      return res
        .status(400)
        .json({ success: false, message: "No OTP requested" });
    }

    if (new Date() > details.startProjectOtpExpiry) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    const isValid = await bcrypt.compare(otp, details.startProjectOtp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // ✅ ONLY: Start the job
    details.status = "Project Ongoing";
    details.isJobStarted = true;

    details.startProjectApprovedAt = new Date();

    if (booking.assignedProfessional) {
      booking.assignedProfessional.startedDate = new Date();
      booking.assignedProfessional.startedTime = moment().format("LT");
    }

    // Clear OTP
    details.startProjectOtp = undefined;
    details.startProjectOtpExpiry = undefined;

    // ✅ DO NOT generate any payment link here

    await booking.save();

    res.json({
      success: true,
      message:
        "Project started successfully. Status updated to 'Project Ongoing'.",
      bookingId: booking._id,
      status: "Project Ongoing",
    });
  } catch (err) {
    console.error("Error verifying start-project OTP:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// HOUSE PAINTING - SECOND PAYMENT REQUESTED - LINK SENT
exports.requestSecondPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const d = booking.bookingDetails;

    // 🔒 Must be "Project Ongoing"
    if (d.status !== "Project Ongoing") {
      return res.status(400).json({
        success: false,
        message: "Can only request 2nd payment during 'Project Ongoing'",
      });
    }

    // 🔒 Service must be house_painting (deep cleaning doesn't have second payment)
    if (booking.serviceType !== "house_painting") {
      return res.status(400).json({
        success: false,
        message: "Second payment only applies to House Painting jobs",
      });
    }

    // 🔒 Block if there's a PENDING price change
    const hasPendingPriceChange = d.priceChanges.some(
      (change) => change.status === "pending",
    );
    if (hasPendingPriceChange) {
      return res.status(400).json({
        success: false,
        message:
          "Pending price approval. Please approve or reject the edited amount first.",
      });
    }

    // 🔒 First payment must be PAID
    if (d.firstPayment.status !== "paid") {
      return res.status(400).json({
        success: false,
        message:
          "First payment must be completed before requesting second payment",
      });
    }

    // 🔒 Second payment must NOT already be paid
    if (d.secondPayment.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Second payment has already been completed",
      });
    }

    // 💰 Use finalTotal (which reflects latest approved price)
    const finalTotal = Number(d.finalTotal);
    if (!finalTotal || finalTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: "Final total amount not set. Please finalize the quote first.",
      });
    }

    // 🧮 Calculate 80% target and second installment
    const eightyTarget = Math.round(finalTotal * 0.8);
    const paidSoFar = Number(d.paidAmount || 0);
    const secondInstallment = Math.max(0, eightyTarget - paidSoFar);

    console.log("secondInstallment", secondInstallment);

    if (secondInstallment <= 0) {
      return res.status(400).json({
        success: false,
        message: "Second installment is not due (already paid or overpaid)",
      });
    }

    // ✅ Update second payment milestone...........
    d.secondPayment.status = "pending";
    d.secondPayment.amount = 0; //secondInstallment
    // presever installment amt
    d.secondPayment.requestedAmount = secondInstallment;
    d.secondPayment.remaining = secondInstallment;
    // ......................................
    // 🔗 Generate payment link
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${
      booking._id
    }/${Date.now()}/${pay_type}`;
    d.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: generateProviderRef(),
      installmentStage: "second",
    };

    // 🏷 Update legacy paymentStatus for compatibility (optional)
    d.paymentStatus = "Partial Payment";

    await booking.save();

    return res.json({
      success: true,
      message: "Second payment link generated.",
      paymentLink: paymentLinkUrl,
      amountDue: secondInstallment,
      finalTotal,
      paidSoFar,
      secondPaymentStatus: d.secondPayment.status,
    });
  } catch (err) {
    console.error("Error requesting second payment:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// HOUSE PAINTING, DEEP CLEANING - FINAL PAYMENT REQUESTED - LINK WILL SENT

exports.requestingFinalPaymentEndProject = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await UserBooking.findById(bookingId);

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const details = booking.bookingDetails || (booking.bookingDetails = {});
    const serviceType = (booking.serviceType || "").toLowerCase();

    // ✅ Only allow ending if job is ongoing
    if (
      !["project ongoing", "job ongoing"].includes(
        String(details.status || "").toLowerCase(),
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Only 'Project Ongoing' bookings can be requested to end",
      });
    }

    // ✅ Payment validation logic
    const firstPaid = details.firstPayment?.status === "paid";
    const secondPaid = details.secondPayment?.status === "paid";

    if (serviceType === "deep_cleaning") {
      if (!firstPaid) {
        return res.status(400).json({
          success: false,
          message:
            "First payment must be completed before requesting final payment.",
        });
      }
    } else {
      if (!(firstPaid && secondPaid)) {
        return res.status(400).json({
          success: false,
          message:
            "At least 80% payment (First and Second installments) required before requesting to end job",
        });
      }
    }

    // ✅ Latest total
    const approvedPriceChange = details.priceChanges
      ?.filter((p) => p.status === "approved")
      .slice(-1)[0];

    const totalExpected =
      Number(approvedPriceChange?.proposedTotal) ||
      Number(details.finalTotal) ||
      Number(details.currentTotalAmount) ||
      Number(details.bookingAmount) ||
      0;

    if (!(totalExpected > 0)) {
      return res.status(400).json({
        success: false,
        message: "Final total not set. Cannot generate final payment link.",
      });
    }

    // ✅ Ensure milestone objects
    details.firstPayment = details.firstPayment || {};
    details.secondPayment = details.secondPayment || {};
    details.finalPayment = details.finalPayment || {};

    const firstReq = Number(details.firstPayment.requestedAmount || 0);
    const secondReq = Number(details.secondPayment.requestedAmount || 0);

    // ✅ Preserve prePayment already collected
    const pre = Number(details.finalPayment.prePayment || 0);

    // ✅ Preserve original final release target
    const finalTarget = Math.max(0, totalExpected - firstReq - secondReq);

    // ✅ Amount customer should pay now
    const amountDue = Math.max(0, finalTarget - pre);

    // ✅ Set finalPayment fields (do NOT overwrite requestedAmount to reduced value)
    details.finalPayment.requestedAmount = finalTarget; // e.g., 2543 (fixed)
    details.finalPayment.prePayment = pre; // e.g., 3
    details.finalPayment.amount = 0; // Number(details.finalPayment.amount || 0); // paid in final stage (usually 0)
    details.finalPayment.remaining = amountDue; // e.g., 2540
    // details.finalPayment.status = amountDue === 0 ? "paid" : "pending";
    details.finalPayment.status = pre === 0 ? "pending" : "partial";

    details.jobEndRequestedAt = new Date();

    // ✅ If already covered by prePayment, finish immediately
    if (amountDue === 0) {
      details.paymentStatus = "Paid";
      details.status = "Project Completed";
      details.jobEndedAt = details.jobEndedAt || new Date();

      await booking.save();

      return res.json({
        success: true,
        message:
          "Final payment already covered by prePayment. Job marked completed.",
        bookingId: booking._id,
        totalExpected,
        finalTarget,
        prePayment: pre,
        amountDue,
        status: details.status,
        paymentStatus: details.paymentStatus,
        finalPayment: details.finalPayment,
      });
    }

    // ✅ Generate payment link
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${
      booking._id
    }/${Date.now()}/${pay_type}`;

    details.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: generateProviderRef(),
      installmentStage: "final",
    };

    // ✅ Update status and payment status
    details.paymentStatus = "Waiting for final payment";
    details.status = "Waiting for final payment";

    await booking.save();

    return res.json({
      success: true,
      message:
        "Final payment link generated. Awaiting customer payment to complete job.",
      bookingId: booking._id,
      status: details.status,
      paymentStatus: details.paymentStatus,
      paymentLink: paymentLinkUrl,
      amountDue, // ✅ customer pays this (2540)
      finalTarget, // ✅ preserved original (2543)
      prePayment: pre,
      finalPayment: details.finalPayment,
      serviceType,
    });
  } catch (err) {
    console.error("Error requesting job end:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// controllers/payment.controller.js
exports.makePayment = async (req, res) => {
  try {
    const {
      bookingId,
      paymentMethod,
      paidAmount,
      providerRef,
      installmentStage,
    } = req.body;

    if (!bookingId || !paymentMethod || paidAmount == null) {
      return res.status(400).json({
        success: false,
        message: "bookingId, paymentMethod, and paidAmount are required",
      });
    }

    const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
    if (!validPaymentMethods.includes(String(paymentMethod))) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }

    const amount = Number(paidAmount);
    if (!(amount > 0)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Paid amount must be greater than zero",
        });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const d = booking.bookingDetails;
    if (!d) {
      return res
        .status(400)
        .json({ success: false, message: "bookingDetails missing" });
    }

    // ✅ IMPORTANT: providerRef must be unique per payment (razorpay_order_id)
    // If you keep razorpay_order_xyz for all, idempotency will block updates.
    if (providerRef) {
      booking.payments = booking.payments || [];
      d.paymentLink.providerRef = providerRef;
      const already = booking.payments.some(
        (p) => p.providerRef === providerRef,
      );
      if (already) {
        // Return current state (do NOT mutate again)
        return res.status(200).json({
          success: true,
          message: "Payment already recorded (idempotent).",
          bookingId: booking._id,
          bookingDetails: d,
        });
      }
    }

    const serviceType = getServiceTypeFromBooking(booking);
    const isDeepCleaningSvc =
      String(serviceType).toLowerCase() === "deep_cleaning";

    // ---------- finalTotal ----------
    let finalTotal = Number(d.finalTotal || 0);
    if (!(finalTotal > 0)) {
      return res.status(400).json({
        success: false,
        message: "Final total not set. Finalize quote first.",
      });
    }

    // ---------- Ensure milestone objects ----------
    d.firstPayment = ensureMilestoneDefaults(d.firstPayment || {});
    d.secondPayment = ensureMilestoneDefaults(d.secondPayment || {});
    d.finalPayment = ensureMilestoneDefaults(d.finalPayment || {});

    // ---------- Determine stage ----------
    let stage = null;

    // 1) Strongest: gateway callback reference matches current link
    if (
      providerRef &&
      d.paymentLink?.providerRef &&
      d.paymentLink.providerRef === providerRef
    ) {
      stage = normalizeStage(d.paymentLink.installmentStage, serviceType, d);
    }
    // 2) Website caller may send installmentStage (ok)
    else if (installmentStage) {
      stage = normalizeStage(installmentStage, serviceType, d);
    }
    // 3) Active link stage
    else if (d.paymentLink?.isActive && d.paymentLink?.installmentStage) {
      stage = normalizeStage(d.paymentLink.installmentStage, serviceType, d);
    }
    // 4) Fallback derive
    else {
      stage = normalizeStage(null, serviceType, d);
    }

    if (!stage) {
      return res.status(400).json({
        success: false,
        message: "installmentStage is required for this payment.",
      });
    }

    // ---------- Stage key ----------
    const instKey =
      stage === "first"
        ? "firstPayment"
        : stage === "second"
          ? "secondPayment"
          : "finalPayment";

    // ✅ BLOCK paying any stage that is not requested yet
    const requestedAmt = Number(d[instKey]?.requestedAmount || 0);
    if (!(requestedAmt > 0)) {
      return res.status(400).json({
        success: false,
        message: `${stage} payment is not requested yet.`,
        stage,
        requestedAmount: requestedAmt,
      });
    }

    // ---------- Safe activate (does NOT wipe requestedAmount to 0) ----------
    const safeActivate = (milestone) => {
      const reqAmt = Number(milestone.requestedAmount || 0);
      const paidSoFar =
        Number(milestone.amount || 0) + Number(milestone.prePayment || 0);
      milestone.remaining = Math.max(0, reqAmt - paidSoFar);

      // status consistency
      if (reqAmt <= 0) milestone.status = "pending";
      else if (paidSoFar <= 0) milestone.status = "pending";
      else if (milestone.remaining === 0) milestone.status = "paid";
      else milestone.status = "partial";
    };

    safeActivate(d[instKey]);

    // ---------- Due cap ----------
    const installmentDue = Number(d[instKey]?.remaining || 0);
    if (!(installmentDue > 0)) {
      return res.status(400).json({
        success: false,
        message: `No payable amount found for ${stage} installment.`,
        stage,
        installmentDue,
        milestone: d[instKey],
      });
    }

    if (amount > installmentDue) {
      return res.status(400).json({
        success: false,
        message: `Paid amount cannot exceed remaining for ${stage} installment (${installmentDue}).`,
      });
    }

    // ---------- Booking-level cap ----------
    const currentPaid = Number(d.paidAmount || 0);
    const bookingRemaining = Math.max(0, finalTotal - currentPaid);
    if (amount > bookingRemaining) {
      return res.status(400).json({
        success: false,
        message: "Paid amount cannot exceed remaining balance",
      });
    }

    // ---------- Apply payment ----------
    d.paymentMethod = String(paymentMethod);
    d.paidAmount = currentPaid + amount;

    // log payment
    booking.payments = booking.payments || [];
    booking.payments.push({
      at: new Date(),
      method: d.paymentMethod,
      amount,
      providerRef: providerRef || undefined,
      installment: stage,
    });

    // ✅ deactivate link because payment is recorded
    if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

    // ✅ Resync milestones from ledger (your function)
    const { prevFinalStatus } = resyncMilestonesFromLedger(
      d,
      d.paymentMethod,
      serviceType,
    );

    // derived fields (your function)
    syncDerivedFields(d, finalTotal);

    // mark job hired etc (your existing logic)
    const finalIsExactlyPaid = isStageExactlyPaid(d.finalPayment);
    const finalJustPaidNow = prevFinalStatus !== "paid" && finalIsExactlyPaid;

    if (finalJustPaidNow) {
      d.paymentStatus = "Paid";
      if (
        [
          "Waiting for final payment",
          "Project Ongoing",
          "Job Ongoing",
        ].includes(String(d.status))
      ) {
        d.status = "Project Completed";
        d.jobEndedAt = d.jobEndedAt || new Date();
      }
    } else {
      const ratio = finalTotal > 0 ? Number(d.paidAmount || 0) / finalTotal : 0;
      d.paymentStatus =
        ratio >= 0.799 ? "Partially Completed" : "Partial Payment";
      const statusNorm = (d.status || "").trim().toLowerCase();
      if (["pending hiring", "pending"].includes(statusNorm))
        d.status = "Hired";
    }

    booking.isEnquiry = false;

    finalizeIfFullyPaid({ booking, bookingId, finalTotal });

    // ✅ Force nested save (fixes “API hits but DB not updated” cases)
    booking.markModified("bookingDetails");
    booking.markModified("payments");

    await booking.save();

    return res.json({
      success: true,
      message: finalJustPaidNow
        ? "Final payment completed. Job marked as ended."
        : "Payment received.",
      bookingId: booking._id,
      finalTotal,
      totalPaid: d.paidAmount,
      remainingAmount: Math.max(0, finalTotal - d.paidAmount),
      status: d.status,
      paymentStatus: d.paymentStatus,
      firstPayment: d.firstPayment,
      secondPayment: d.secondPayment,
      finalPayment: d.finalPayment,
      paymentLink: d.paymentLink,
      finalJustPaidNow,
    });
  } catch (err) {
    console.error("makePayment error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while processing payment",
      error: err.message,
    });
  }
};
exports.updateManualPayment = async (req, res) => {
  try {
    const {
      bookingId,
      paymentMethod,
      paidAmount,
      providerRef,
      isAdditionalAmount,
    } = req.body;

    if (!bookingId || !paymentMethod || paidAmount == null) {
      return res.status(400).json({
        success: false,
        message: "bookingId, paymentMethod, and paidAmount are required",
      });
    }

    const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
    if (!validPaymentMethods.includes(String(paymentMethod))) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    const currentPaid = Number(paidAmount || 0);
    if (!(currentPaid > 0)) {
      return res.status(400).json({
        success: false,
        message: "paidAmount must be greater than 0",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const serviceType = getServiceTypeFromBooking(booking);
    const isDeepCleaning =
      String(serviceType).toLowerCase() === "deep_cleaning";

    const d = booking.bookingDetails || (booking.bookingDetails = {});
    const finalTotal = Number(d.finalTotal || 0);

    // ensureInstallmentTargets(d, finalTotal, serviceType);

    // const stage = normalizeStage(
    //   req.body.installmentStage, serviceType, d
    // );
    // activateInstallmentStage(d, stage);
    ensureInstallmentTargets(d, finalTotal, serviceType);
    const stage = normalizeStage(req.body.installmentStage, serviceType, d);
    activateInstallmentStage(d, stage);

    // ✅ stage due lock
    const key =
      stage === "first"
        ? "firstPayment"
        : stage === "second"
          ? "secondPayment"
          : "finalPayment";
    const due = Number(d[key]?.remaining || 0);
    if (!(due > 0)) {
      return res.status(400).json({
        success: false,
        message: `No payable amount found for ${stage} installment.`,
      });
    }

    if (currentPaid > due) {
      return res.status(400).json({
        success: false,
        message: `Paid amount cannot exceed remaining for ${stage} installment (${due}).`,
      });
    }
    // ---------- BOOKING-LEVEL NUMBERS (BEFORE THIS PAYMENT) ----------
    const existingPaid = Number(d.paidAmount || 0);
    const prevAmountYetToPay = Number(d.amountYetToPay || 0);

    if (currentPaid > prevAmountYetToPay) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds total pending amount (${prevAmountYetToPay})`,
      });
    }

    // ---------- Helpers ----------
    const disablePaymentLinkIfFullyPaid = () => {
      if (Number(d.amountYetToPay || 0) === 0 && d.paymentLink?.isActive) {
        d.paymentLink.isActive = false;
      }
    };

    const logPayment = (note) => {
      booking.payments = booking.payments || [];
      booking.payments.push({
        at: new Date(),
        method: String(paymentMethod),
        amount: currentPaid,
        providerRef: providerRef || undefined,
        ...(note ? { note } : {}),
        installment: stage || undefined,
      });
    };

    const updateBookingLevel = () => {
      d.paidAmount = existingPaid + currentPaid;
      d.paymentMethod = String(paymentMethod);

      const remainingBookingAmount = Math.max(
        0,
        prevAmountYetToPay - currentPaid,
      );
      d.amountYetToPay = remainingBookingAmount;

      d.paymentStatus =
        remainingBookingAmount === 0 ? "Paid" : "Partial Payment";

      disablePaymentLinkIfFullyPaid();
      return remainingBookingAmount;
    };

    // ✅ amount = paid so far, prePayment = extra collected, requestedAmount = target
    const syncMilestone = (m) => {
      const req = Number(m.requestedAmount || 0);
      const amt = Math.max(0, Number(m.amount || 0));
      const pre = Math.max(0, Number(m.prePayment || 0));

      const effectivePaid = Math.min(req, amt + pre);
      m.remaining = Math.max(0, req - effectivePaid);

      if (req <= 0) m.status = "pending";
      else if (effectivePaid === 0) m.status = "pending";
      else if (m.remaining === 0) m.status = "paid";
      else m.status = "partial";
    };

    // ---------- ENSURE PAYMENT OBJECTS ----------
    d.firstPayment = d.firstPayment || {};
    d.secondPayment = d.secondPayment || {};
    d.finalPayment = d.finalPayment || {};

    const ensureDefaults = (m) => {
      m.status = m.status || "pending";
      m.amount = Number(m.amount || 0);
      m.requestedAmount = Number(m.requestedAmount || 0);
      m.remaining = Number(m.remaining || 0);
      m.method = m.method || "None";
      m.prePayment = Number(m.prePayment || 0);
    };

    ensureDefaults(d.firstPayment);
    ensureDefaults(d.secondPayment);
    ensureDefaults(d.finalPayment);

    // ---------- Total ----------
    const totalBookingAmt = Number(
      d.finalTotal || existingPaid + prevAmountYetToPay || 0,
    );
    if (!(totalBookingAmt > 0)) {
      return res.status(400).json({
        success: false,
        message: "Final total not set. Finalize quote first.",
      });
    }

    const firstReq = Number(d.firstPayment.requestedAmount || 0);
    const secondReq = isDeepCleaning
      ? 0
      : Number(d.secondPayment.requestedAmount || 0);
    const finalReq = Number(d.finalPayment.requestedAmount || 0);

    // ✅ Allocate existingPaid into milestone buckets
    // IMPORTANT: prePayment already exists inside paidAmount,
    // subtract it to avoid double-counting in amount buckets.
    const prePay = Math.max(0, Number(d.finalPayment?.prePayment || 0));
    let remainingPaid = Math.max(0, existingPaid - prePay);

    const firstPaidSoFar = Math.max(0, Math.min(firstReq, remainingPaid));
    remainingPaid -= firstPaidSoFar;

    let secondPaidSoFar = 0;
    if (!isDeepCleaning) {
      secondPaidSoFar = Math.max(0, Math.min(secondReq, remainingPaid));
      remainingPaid -= secondPaidSoFar;
    }

    const finalPaidSoFar = Math.max(0, Math.min(finalReq, remainingPaid));

    d.firstPayment.amount = firstPaidSoFar;
    if (!isDeepCleaning) d.secondPayment.amount = secondPaidSoFar;
    else d.secondPayment.amount = 0; // ✅ deep cleaning hard-lock
    d.finalPayment.amount = finalPaidSoFar;

    syncMilestone(d.firstPayment);
    syncMilestone(d.secondPayment);
    syncMilestone(d.finalPayment);

    // ---------- ADDITIONAL AMOUNT (round-off / extra) ----------
    const gateCompleted = isDeepCleaning
      ? firstReq > 0 &&
        d.firstPayment.status === "paid" &&
        isStageExactlyPaid(d.firstPayment)
      : secondReq > 0 &&
        d.secondPayment.status === "paid" &&
        isStageExactlyPaid(d.secondPayment);

    if (isAdditionalAmount === true && !gateCompleted) {
      return res.status(400).json({
        success: false,
        message: isDeepCleaning
          ? "Extra amount can be added only after First installment is fully paid."
          : "Extra amount can be added only after Second installment is fully paid.",
        stage,
        firstPayment: d.firstPayment,
        secondPayment: d.secondPayment,
        finalPayment: d.finalPayment,
      });
    }

    if (isAdditionalAmount === true && gateCompleted) {
      const extra = currentPaid;

      d.finalPayment.prePayment =
        Number(d.finalPayment.prePayment || 0) + extra;

      if (!d.finalPayment.method || d.finalPayment.method === "None") {
        d.finalPayment.method = String(paymentMethod);
      }

      syncMilestone(d.finalPayment);

      const remainingBookingAmount = updateBookingLevel();
      logPayment(
        isDeepCleaning
          ? "deep_cleaning_additional_amount_prePayment"
          : "additional_amount_prePayment",
      );
      if (d.paymentLink?.isActive) d.paymentLink.isActive = false;
      await booking.save();

      return res.status(200).json({
        success: true,
        message:
          "Additional amount stored in finalPayment.prePayment (requestedAmount preserved).",
        paidAmount: d.paidAmount,
        amountYetToPay: d.amountYetToPay,
        stage,
        firstPayment: d.firstPayment,
        secondPayment: d.secondPayment,
        finalPayment: d.finalPayment,
        extraStoredAsPrePayment: extra,
        remainingBookingAmount,
      });
    }

    // ---------- NORMAL PAYMENT APPLY ----------
    const prevFinalStatus = d.finalPayment.status;
    let overflowAppliedToFinal = 0;

    if (stage === "final") {
      // Pay FINAL directly
      const finalPaidNow = Number(d.finalPayment.amount || 0);
      const pendingFinal = Math.max(
        0,
        finalReq - (finalPaidNow + Number(d.finalPayment.prePayment || 0)),
      );

      const appliedToFinal = Math.min(currentPaid, pendingFinal);
      overflowAppliedToFinal = appliedToFinal;

      if (appliedToFinal > 0) {
        d.finalPayment.amount = finalPaidNow + appliedToFinal;

        if (!d.finalPayment.method || d.finalPayment.method === "None") {
          d.finalPayment.method = String(paymentMethod);
        }
        syncMilestone(d.finalPayment);
      }
    } else if (isDeepCleaning) {
      // ✅ Deep cleaning: pay FIRST (NOT second)
      const firstPaidNow = Number(d.firstPayment.amount || 0);
      const pendingFirst = Math.max(0, firstReq - firstPaidNow);

      const appliedToFirst = Math.min(currentPaid, pendingFirst);

      if (appliedToFirst > 0) {
        d.firstPayment.amount = firstPaidNow + appliedToFirst;

        if (!d.firstPayment.method || d.firstPayment.method === "None") {
          d.firstPayment.method = String(paymentMethod);
        }
        syncMilestone(d.firstPayment);
      }

      overflowAppliedToFinal = 0;
    } else {
      // House painting: pay SECOND
      const secondPaidNow = Number(d.secondPayment.amount || 0);
      const pendingSecond = Math.max(0, secondReq - secondPaidNow);

      const appliedToSecond = Math.min(currentPaid, pendingSecond);

      if (appliedToSecond > 0) {
        d.secondPayment.amount = secondPaidNow + appliedToSecond;

        if (!d.secondPayment.method || d.secondPayment.method === "None") {
          d.secondPayment.method = String(paymentMethod);
        }
        syncMilestone(d.secondPayment);
      }

      overflowAppliedToFinal = 0;
    }

    // if second installment is fully paid by cash/manual, deactivate payment link
    if (d.paymentLink?.isActive) {
      const linkStage = String(
        d.paymentLink.installmentStage || "",
      ).toLowerCase();

      if (linkStage === "second" && isStageExactlyPaid(d.secondPayment)) {
        d.paymentLink.isActive = false;
      }
    }

    const remainingBookingAmount = updateBookingLevel();

    // ✅ Stage auto-move
    if (d.paymentLink?.installmentStage) {
      if (isDeepCleaning) {
        if (d.firstPayment.remaining === 0 && firstReq > 0) {
          d.paymentLink.installmentStage = "final";
        }
      } else {
        if (d.secondPayment.remaining === 0 && secondReq > 0) {
          d.paymentLink.installmentStage = "final";
        }
      }
    }

    // ✅ COMPLETE ONLY WHEN FINAL is exactly paid (amount + prePayment)
    const finalIsExactlyPaid =
      stage === "final" && isStageExactlyPaid(d.finalPayment);
    const finalJustPaidNow = prevFinalStatus !== "paid" && finalIsExactlyPaid;

    if (finalJustPaidNow) {
      const customerId = booking.customer?.customerId;
      const vendorId = booking.assignedProfessional?.professionalId;
      const vendorName = booking.assignedProfessional?.name;
      const vendorPhoto = booking.assignedProfessional?.profile;

      d.paymentStatus = "Paid";
      booking.vendorRatingUrl = `${vendorRatingURL}?vendorId=${vendorId}&bookingId=${bookingId}&customerId=${customerId}&vendorName=${vendorName}&vendorPhoto=${vendorPhoto}`;

      if (
        [
          "Waiting for final payment",
          "Project Ongoing",
          "Job Ongoing",
        ].includes(String(d.status))
      ) {
        d.status = "Project Completed";
        const now = new Date();

        if (booking.assignedProfessional) {
          booking.assignedProfessional.completedDate = now;
          booking.assignedProfessional.completedTime = moment().format("LT");
        }
        d.jobEndedAt = now;
      }
    }

    logPayment();
    disablePaymentLinkIfFullyPaid();

    // idempotent finalize (keeps Paid + Project Completed consistent, settles prePayment too)
    finalizeIfFullyPaid({
      booking,
      bookingId,
      finalTotal: Number(
        d.finalTotal || existingPaid + prevAmountYetToPay || 0,
      ),
    });

    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Payment updated successfully",
      paidAmount: d.paidAmount,
      amountYetToPay: d.amountYetToPay,
      stage,
      firstPayment: d.firstPayment,
      secondPayment: d.secondPayment,
      finalPayment: d.finalPayment,
      overflowAppliedToFinal,
      remainingBookingAmount,
      finalJustPaidNow,
    });
  } catch (error) {
    console.log("updateManualPayment error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// exports.updateManualPayment = async (req, res) => {
//   try {
//     const {
//       bookingId,
//       paymentMethod,
//       paidAmount,
//       providerRef,
//       isAdditionalAmount,
//     } = req.body;

//     if (!bookingId || !paymentMethod || paidAmount == null) {
//       return res.status(400).json({
//         success: false,
//         message: "bookingId, paymentMethod, and paidAmount are required",
//       });
//     }

//     const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
//     if (!validPaymentMethods.includes(String(paymentMethod))) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid payment method",
//       });
//     }

//     const currentPaid = Number(paidAmount || 0);
//     if (!(currentPaid > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "paidAmount must be greater than 0",
//       });
//     }

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({
//         success: false,
//         message: "Booking not found",
//       });
//     }

//     const serviceType = getServiceTypeFromBooking(booking);
//     const isDeepCleaning =
//       String(serviceType).toLowerCase() === "deep_cleaning";

//     const d = booking.bookingDetails || (booking.bookingDetails = {});
//     const finalTotal = Number(d.finalTotal || 0);

//     // ensureInstallmentTargets(d, finalTotal, serviceType);

//     // const stage = normalizeStage(
//     //   req.body.installmentStage, serviceType, d
//     // );
//     // activateInstallmentStage(d, stage);
//     ensureInstallmentTargets(d, finalTotal, serviceType);
//     const stage = normalizeStage(req.body.installmentStage, serviceType, d);
//     activateInstallmentStage(d, stage);

//     // ✅ stage due lock
//     const key = stage === "first" ? "firstPayment" : stage === "second" ? "secondPayment" : "finalPayment";
//     const due = Number(d[key]?.remaining || 0);
//     if (!(due > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: `No payable amount found for ${stage} installment.`,
//       });
//     }

//     if (currentPaid > due) {
//       return res.status(400).json({
//         success: false,
//         message: `Paid amount cannot exceed remaining for ${stage} installment (${due}).`,
//       });
//     }
//     // ---------- BOOKING-LEVEL NUMBERS (BEFORE THIS PAYMENT) ----------
//     const existingPaid = Number(d.paidAmount || 0);
//     const prevAmountYetToPay = Number(d.amountYetToPay || 0);

//     if (currentPaid > prevAmountYetToPay) {
//       return res.status(400).json({
//         success: false,
//         message: `Amount exceeds total pending amount (${prevAmountYetToPay})`,
//       });
//     }

//     // ---------- Helpers ----------
//     const disablePaymentLinkIfFullyPaid = () => {
//       if (Number(d.amountYetToPay || 0) === 0 && d.paymentLink?.isActive) {
//         d.paymentLink.isActive = false;
//       }
//     };

//     const logPayment = (note) => {
//       booking.payments = booking.payments || [];
//       booking.payments.push({
//         at: new Date(),
//         method: String(paymentMethod),
//         amount: currentPaid,
//         providerRef: providerRef || undefined,
//         ...(note ? { note } : {}),
//         installment: stage || undefined,
//       });
//     };

//     const updateBookingLevel = () => {
//       d.paidAmount = existingPaid + currentPaid;
//       d.paymentMethod = String(paymentMethod);

//       const remainingBookingAmount = Math.max(
//         0,
//         prevAmountYetToPay - currentPaid
//       );
//       d.amountYetToPay = remainingBookingAmount;

//       d.paymentStatus =
//         remainingBookingAmount === 0 ? "Paid" : "Partial Payment";

//       disablePaymentLinkIfFullyPaid();
//       return remainingBookingAmount;
//     };

//     // ✅ amount = paid so far, prePayment = extra collected, requestedAmount = target
//     const syncMilestone = (m) => {
//       const req = Number(m.requestedAmount || 0);
//       const amt = Math.max(0, Number(m.amount || 0));
//       const pre = Math.max(0, Number(m.prePayment || 0));

//       const effectivePaid = Math.min(req, amt + pre);
//       m.remaining = Math.max(0, req - effectivePaid);

//       if (req <= 0) m.status = "pending";
//       else if (effectivePaid === 0) m.status = "pending";
//       else if (m.remaining === 0) m.status = "paid";
//       else m.status = "partial";
//     };

//     // ---------- ENSURE PAYMENT OBJECTS ----------
//     d.firstPayment = d.firstPayment || {};
//     d.secondPayment = d.secondPayment || {};
//     d.finalPayment = d.finalPayment || {};

//     const ensureDefaults = (m) => {
//       m.status = m.status || "pending";
//       m.amount = Number(m.amount || 0);
//       m.requestedAmount = Number(m.requestedAmount || 0);
//       m.remaining = Number(m.remaining || 0);
//       m.method = m.method || "None";
//       m.prePayment = Number(m.prePayment || 0);
//     };

//     ensureDefaults(d.firstPayment);
//     ensureDefaults(d.secondPayment);
//     ensureDefaults(d.finalPayment);

//     // ---------- Total ----------
//     const totalBookingAmt = Number(
//       d.finalTotal || existingPaid + prevAmountYetToPay || 0
//     );
//     if (!(totalBookingAmt > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "Final total not set. Finalize quote first.",
//       });
//     }

//     const firstReq = Number(d.firstPayment.requestedAmount || 0);
//     const secondReq = isDeepCleaning
//       ? 0
//       : Number(d.secondPayment.requestedAmount || 0);
//     const finalReq = Number(d.finalPayment.requestedAmount || 0);

//     // ✅ Allocate existingPaid into milestone buckets
//     // IMPORTANT: prePayment already exists inside paidAmount,
//     // subtract it to avoid double-counting in amount buckets.
//     const prePay = Math.max(0, Number(d.finalPayment?.prePayment || 0));
//     let remainingPaid = Math.max(0, existingPaid - prePay);

//     const firstPaidSoFar = Math.max(0, Math.min(firstReq, remainingPaid));
//     remainingPaid -= firstPaidSoFar;

//     let secondPaidSoFar = 0;
//     if (!isDeepCleaning) {
//       secondPaidSoFar = Math.max(0, Math.min(secondReq, remainingPaid));
//       remainingPaid -= secondPaidSoFar;
//     }

//     const finalPaidSoFar = Math.max(0, Math.min(finalReq, remainingPaid));

//     d.firstPayment.amount = firstPaidSoFar;
//     if (!isDeepCleaning) d.secondPayment.amount = secondPaidSoFar;
//     else d.secondPayment.amount = 0; // ✅ deep cleaning hard-lock
//     d.finalPayment.amount = finalPaidSoFar;

//     syncMilestone(d.firstPayment);
//     syncMilestone(d.secondPayment);
//     syncMilestone(d.finalPayment);

//     // ---------- ADDITIONAL AMOUNT (round-off / extra) ----------
//     const gateCompleted = isDeepCleaning
//       ? firstReq > 0 &&
//       d.firstPayment.status === "paid" &&
//       isStageExactlyPaid(d.firstPayment)
//       : secondReq > 0 &&
//       d.secondPayment.status === "paid" &&
//       isStageExactlyPaid(d.secondPayment);

//     if (isAdditionalAmount === true && !gateCompleted) {
//       return res.status(400).json({
//         success: false,
//         message: isDeepCleaning
//           ? "Extra amount can be added only after First installment is fully paid."
//           : "Extra amount can be added only after Second installment is fully paid.",
//         stage,
//         firstPayment: d.firstPayment,
//         secondPayment: d.secondPayment,
//         finalPayment: d.finalPayment,
//       });
//     }

//     if (isAdditionalAmount === true && gateCompleted) {
//       const extra = currentPaid;

//       d.finalPayment.prePayment =
//         Number(d.finalPayment.prePayment || 0) + extra;

//       if (!d.finalPayment.method || d.finalPayment.method === "None") {
//         d.finalPayment.method = String(paymentMethod);
//       }

//       syncMilestone(d.finalPayment);

//       const remainingBookingAmount = updateBookingLevel();
//       logPayment(
//         isDeepCleaning
//           ? "deep_cleaning_additional_amount_prePayment"
//           : "additional_amount_prePayment"
//       );
//       if (d.paymentLink?.isActive) d.paymentLink.isActive = false;
//       await booking.save();

//       return res.status(200).json({
//         success: true,
//         message:
//           "Additional amount stored in finalPayment.prePayment (requestedAmount preserved).",
//         paidAmount: d.paidAmount,
//         amountYetToPay: d.amountYetToPay,
//         stage,
//         firstPayment: d.firstPayment,
//         secondPayment: d.secondPayment,
//         finalPayment: d.finalPayment,
//         extraStoredAsPrePayment: extra,
//         remainingBookingAmount,
//       });
//     }

//     // ---------- NORMAL PAYMENT APPLY ----------
//     const prevFinalStatus = d.finalPayment.status;
//     let overflowAppliedToFinal = 0;

//     if (stage === "final") {
//       // Pay FINAL directly
//       const finalPaidNow = Number(d.finalPayment.amount || 0);
//       const pendingFinal = Math.max(
//         0,
//         finalReq - (finalPaidNow + Number(d.finalPayment.prePayment || 0))
//       );

//       const appliedToFinal = Math.min(currentPaid, pendingFinal);
//       overflowAppliedToFinal = appliedToFinal;

//       if (appliedToFinal > 0) {
//         d.finalPayment.amount = finalPaidNow + appliedToFinal;

//         if (!d.finalPayment.method || d.finalPayment.method === "None") {
//           d.finalPayment.method = String(paymentMethod);
//         }
//         syncMilestone(d.finalPayment);
//       }
//     } else if (isDeepCleaning) {
//       // ✅ Deep cleaning: pay FIRST (NOT second)
//       const firstPaidNow = Number(d.firstPayment.amount || 0);
//       const pendingFirst = Math.max(0, firstReq - firstPaidNow);

//       const appliedToFirst = Math.min(currentPaid, pendingFirst);

//       if (appliedToFirst > 0) {
//         d.firstPayment.amount = firstPaidNow + appliedToFirst;

//         if (!d.firstPayment.method || d.firstPayment.method === "None") {
//           d.firstPayment.method = String(paymentMethod);
//         }
//         syncMilestone(d.firstPayment);
//       }

//       overflowAppliedToFinal = 0;
//     } else {
//       // House painting: pay SECOND
//       const secondPaidNow = Number(d.secondPayment.amount || 0);
//       const pendingSecond = Math.max(0, secondReq - secondPaidNow);

//       const appliedToSecond = Math.min(currentPaid, pendingSecond);

//       if (appliedToSecond > 0) {
//         d.secondPayment.amount = secondPaidNow + appliedToSecond;

//         if (!d.secondPayment.method || d.secondPayment.method === "None") {
//           d.secondPayment.method = String(paymentMethod);
//         }
//         syncMilestone(d.secondPayment);
//       }

//       overflowAppliedToFinal = 0;
//     }

//     // if second installment is fully paid by cash/manual, deactivate payment link
//     if (d.paymentLink?.isActive) {
//       const linkStage = String(d.paymentLink.installmentStage || "").toLowerCase();

//       if (linkStage === "second" && isStageExactlyPaid(d.secondPayment)) {
//         d.paymentLink.isActive = false;
//       }
//     }

//     const remainingBookingAmount = updateBookingLevel();

//     // ✅ Stage auto-move
//     if (d.paymentLink?.installmentStage) {
//       if (isDeepCleaning) {
//         if (d.firstPayment.remaining === 0 && firstReq > 0) {
//           d.paymentLink.installmentStage = "final";
//         }
//       } else {
//         if (d.secondPayment.remaining === 0 && secondReq > 0) {
//           d.paymentLink.installmentStage = "final";
//         }
//       }
//     }

//     // ✅ COMPLETE ONLY WHEN FINAL is exactly paid (amount + prePayment)
//     const finalIsExactlyPaid =
//       stage === "final" && isStageExactlyPaid(d.finalPayment);
//     const finalJustPaidNow = prevFinalStatus !== "paid" && finalIsExactlyPaid;

//     if (finalJustPaidNow) {
//       const customerId = booking.customer?.customerId;
//       const vendorId = booking.assignedProfessional?.professionalId;
//       const vendorName = booking.assignedProfessional?.name;
//       const vendorPhoto = booking.assignedProfessional?.profile;

//       d.paymentStatus = "Paid";
//       booking.vendorRatingUrl = `${vendorRatingURL}?vendorId=${vendorId}&bookingId=${bookingId}&customerId=${customerId}&vendorName=${vendorName}&vendorPhoto=${vendorPhoto}`;

//       if (
//         [
//           "Waiting for final payment",
//           "Project Ongoing",
//           "Job Ongoing",
//         ].includes(String(d.status))
//       ) {
//         d.status = "Project Completed";
//         const now = new Date();

//         if (booking.assignedProfessional) {
//           booking.assignedProfessional.completedDate = now;
//           booking.assignedProfessional.completedTime = moment().format("LT");
//         }
//         d.jobEndedAt = now;
//       }
//     }

//     logPayment();
//     disablePaymentLinkIfFullyPaid();

//     // idempotent finalize (keeps Paid + Project Completed consistent, settles prePayment too)
//     finalizeIfFullyPaid({
//       booking,
//       bookingId,
//       finalTotal: Number(
//         d.finalTotal || existingPaid + prevAmountYetToPay || 0
//       ),
//     });

//     await booking.save();

//     return res.status(200).json({
//       success: true,
//       message: "Payment updated successfully",
//       paidAmount: d.paidAmount,
//       amountYetToPay: d.amountYetToPay,
//       stage,
//       firstPayment: d.firstPayment,
//       secondPayment: d.secondPayment,
//       finalPayment: d.finalPayment,
//       overflowAppliedToFinal,
//       remainingBookingAmount,
//       finalJustPaidNow,
//     });
//   } catch (error) {
//     console.log("updateManualPayment error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };

exports.adminToCustomerPayment = async (req, res) => {
  try {
    const { bookingId, paymentMethod, paidAmount, providerRef } = req.body;

    if (!bookingId || !paymentMethod || paidAmount == null) {
      return res.status(400).json({
        success: false,
        message: "bookingId, paymentMethod, and paidAmount are required",
      });
    }

    const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }

    const amount = Number(paidAmount);
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Paid amount must be greater than zero",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });

    const d = booking.bookingDetails || (booking.bookingDetails = {});
    const serviceType = (booking.serviceType || "").toLowerCase();

    // ======================================================
    // 🟢 1. UPDATE FIRST PAYMENT
    // ======================================================
    if (!d.firstPayment) d.firstPayment = {};

    if (serviceType === "house_painting") {
      d.firstPayment = {};
    } else {
      d.firstPayment.status = "paid";
      d.firstPayment.amount = amount;
      d.firstPayment.paidAt = new Date();
      d.firstPayment.method = paymentMethod;
    }

    // ======================================================
    // 🟢 2. UPDATE TOTALS
    // ======================================================
    // const finalTotal = d.finalTotal || d.originalTotalAmount || 0;

    // Update paid amount
    d.paidAmount = (d.paidAmount || 0) + amount;

    // Remaining amount
    // d.amountYetToPay = finalTotal - d.paidAmount;

    // ======================================================
    // 🟢 3. DISABLE PAYMENT LINKS
    // ======================================================
    if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

    // ======================================================
    // 🟢 4. IF ENQUIRY → CONVERT TO LEAD
    // ======================================================
    if (booking.isEnquiry) booking.isEnquiry = false;

    // ======================================================
    // 🟢 5. PUSH PAYMENT ENTRY INTO payments[] HISTORY
    // ======================================================
    if (!booking.payments) booking.payments = [];
    // ======================================================
    // 🟢 6. UPDATE STATUS
    // ======================================================
    if (d.paymentStatus) d.paymentStatus = "Partial Payment";
    if (d.paymentMethod) d.paymentMethod = "UPI";

    const stage = normalizeStage(
      d.paymentLink?.installmentStage,
      serviceType,
      d,
    );

    booking.payments.push({
      at: new Date(),
      method: paymentMethod,
      amount,
      providerRef: providerRef || undefined,
      installment: stage || undefined,
      purpose: "site_visit" || undefined,
    });

    await booking.save();

    return res.json({
      success: true,
      message: "Payment recorded successfully",
      bookingId: booking._id,
      paidAmount: d.paidAmount,
      amountYetToPay: d.amountYetToPay,
    });
  } catch (err) {
    console.error("making Payment error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while processing payment",
      error: err.message,
    });
  }
};

// Update address and reset selected slots
exports.updateAddressAndResetSlots = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: "Address data is required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Update address and reset selected slots
    booking.address = {
      houseFlatNumber:
        address.houseFlatNumber || booking.address.houseFlatNumber,
      streetArea: address.streetArea || booking.address.streetArea,
      landMark: address.landMark || booking.address.landMark,
      city: address.city || booking.address.city,
      location: address.location || booking.address.location,
    };

    // Reset selected slots as requested
    booking.selectedSlot = {
      slotTime: "",
      slotDate: "",
    };

    await booking.save();

    res.json({
      success: true,
      message: "Address updated and slots reset successfully",
      booking: booking,
    });
  } catch (error) {
    console.error("Error updating address and slots:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Update selected slot only
exports.updateSelectedSlot = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { selectedSlot } = req.body;

    if (!selectedSlot) {
      return res.status(400).json({
        success: false,
        message: "Selected slot data is required",
      });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Update selected slot
    booking.selectedSlot = {
      slotTime: selectedSlot.slotTime || "",
      slotDate: selectedSlot.slotDate || "",
    };

    await booking.save();

    res.json({
      success: true,
      message: "Selected slot updated successfully",
      booking: booking,
    });
  } catch (error) {
    console.error("Error updating selected slot:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// sonali updates....
// new 08-01 requestedAmount + remaning
// exports.updateUserBooking = async (req, res) => {
//   try {
//     const { bookingId } = req.params;
//     const {
//       customer,
//       service,
//       bookingDetails,
//       address,
//       selectedSlot,
//       formName,
//     } = req.body;

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Booking not found" });
//     }

//     const serviceType = booking.serviceType;
//     const isDeepCleaning = serviceType === "deep_cleaning";
//     const isHousePainting = serviceType === "house_painting";

//     // ---------------- helpers ----------------
//     const n = (v) => {
//       const x = Number(v);
//       return Number.isFinite(x) ? x : 0;
//     };

//     const normStatus = (s) =>
//       String(s || "")
//         .toLowerCase()
//         .trim();

//     const calcRemaining = (reqAmt, paidAmt) =>
//       Math.max(0, n(reqAmt) - n(paidAmt));

//     /**
//      * ✅ Your final rule:
//      * pending  -> requestedAmount=new, amount=new, remaining=0
//      * partial  -> requestedAmount=new, amount untouched, remaining=requested-amount
//      * paid     -> don't touch
//      * status   -> NEVER change
//      */
//     const applyInstallmentUpdate = (inst, requestedAmountNew) => {
//       if (!inst) return;

//       const st = normStatus(inst.status);
//       const req = n(requestedAmountNew);

//       // Never touch paid installment
//       if (st === "paid") return;

//       if (st === "pending") {
//         inst.requestedAmount = req;
//         inst.amount = req;
//         inst.remaining = 0;
//         return;
//       }

//       if (st === "partial") {
//         inst.requestedAmount = req;
//         inst.amount = n(inst.amount); // keep as-is, just ensure numeric
//         inst.remaining = calcRemaining(inst.requestedAmount, inst.amount);
//         return;
//       }

//       // fallback safe behavior (if some unknown status appears)
//       inst.requestedAmount = req;
//       inst.amount = n(inst.amount);
//       inst.remaining = calcRemaining(inst.requestedAmount, inst.amount);
//     };

//     // ---------------- UPDATE CUSTOMER ----------------
//     if (customer) {
//       booking.customer = booking.customer || {};
//       booking.customer.name = customer.name ?? booking.customer.name;
//       booking.customer.phone = customer.phone ?? booking.customer.phone;
//       booking.customer.customerId =
//         customer.customerId ?? booking.customer.customerId;
//     }

//     // ---------------- UPDATE ADDRESS ----------------
//     if (address) {
//       booking.address = booking.address || {};
//       booking.address.houseFlatNumber =
//         address.houseFlatNumber ?? booking.address.houseFlatNumber;
//       booking.address.streetArea =
//         address.streetArea ?? booking.address.streetArea;
//       booking.address.landMark = address.landMark ?? booking.address.landMark;
//       booking.address.city = address.city ?? booking.address.city;
//       booking.address.location = address.location ?? booking.address.location;
//     }

//     // ---------------- UPDATE SLOT ----------------
//     if (selectedSlot) {
//       booking.selectedSlot = booking.selectedSlot || {};
//       booking.selectedSlot.slotDate =
//         selectedSlot.slotDate ?? booking.selectedSlot.slotDate;
//       booking.selectedSlot.slotTime =
//         selectedSlot.slotTime ?? booking.selectedSlot.slotTime;
//     }

//     // ---------------- UPDATE SERVICES (Deep Cleaning ONLY) ----------------
//     if (isDeepCleaning && Array.isArray(service)) {
//       booking.service = service.map((s) => ({
//         category: s.category,
//         subCategory: s.subCategory,
//         serviceName: s.serviceName,
//         price: n(s.price),
//         quantity: s.quantity || 1,
//         teamMembersRequired: s.teamMembersRequired || 0,
//         duration: s.duration || 0,
//         packageId: s.packageId,
//       }));
//     }

//     // ---------------- PAYMENT/TOTAL UPDATE (NO PAYMENT) ----------------
//     if (bookingDetails) {
//       booking.bookingDetails = booking.bookingDetails || {};
//       booking.bookingDetails.firstPayment =
//         booking.bookingDetails.firstPayment || {};
//       booking.bookingDetails.secondPayment =
//         booking.bookingDetails.secondPayment || {};
//       booking.bookingDetails.finalPayment =
//         booking.bookingDetails.finalPayment || {};

//       const incomingFinalTotal =
//         bookingDetails.finalTotal !== undefined
//           ? n(bookingDetails.finalTotal)
//           : n(booking.bookingDetails.finalTotal);

//       const incomingBookingAmount = n(bookingDetails.bookingAmount);
//       const incomingPaidAmount = n(bookingDetails.paidAmount);
//       const incomingRefundAmount = n(bookingDetails.refundAmount);

//       const prevFinalTotal = n(booking.bookingDetails.finalTotal);

//       // update totals (only what you are passing)
//       if (bookingDetails.finalTotal !== undefined) {
//         booking.bookingDetails.finalTotal = incomingFinalTotal;
//       }
//       if (bookingDetails.refundAmount !== undefined) {
//         booking.bookingDetails.refundAmount = incomingRefundAmount;
//       }
//       if (bookingDetails.bookingAmount !== undefined) {
//         booking.bookingDetails.bookingAmount = incomingBookingAmount;
//       }
//       if (bookingDetails.paidAmount !== undefined) {
//         booking.bookingDetails.paidAmount = incomingPaidAmount;
//       }

//       // HP site visit charges
//       if (bookingDetails.siteVisitCharges !== undefined && isHousePainting) {
//         booking.bookingDetails.siteVisitCharges = n(
//           bookingDetails.siteVisitCharges
//         );
//       }

//       // price changes log
//       if (!booking.bookingDetails.priceChanges)
//         booking.bookingDetails.priceChanges = [];
//       if (bookingDetails.priceChange) {
//         booking.bookingDetails.priceChanges.push(bookingDetails.priceChange);
//       }

//       // booking-level AYTP (always finalTotal - paidAmount)
//       const paidAmountDB = n(booking.bookingDetails.paidAmount);
//       const finalTotalDB = n(booking.bookingDetails.finalTotal);

//       booking.bookingDetails.amountYetToPay = Math.max(
//         0,
//         finalTotalDB - paidAmountDB
//       );

//       // only recalc installment requestedAmount if finalTotal changed
//       const finalTotalChanged = finalTotalDB !== prevFinalTotal;

//       if (finalTotalChanged) {
//         const fp = booking.bookingDetails.firstPayment;
//         const sp = booking.bookingDetails.secondPayment;
//         const fip = booking.bookingDetails.finalPayment;

//         const fpStatus = normStatus(fp.status);
//         const spStatus = normStatus(sp.status);
//         const fipStatus = normStatus(fip.status);

//         // ---------- HOUSE PAINTING: 3 installments ----------
//         if (isHousePainting) {
//           // 1) First installment due (first not paid)
//           if (fpStatus !== "paid") {
//             const req = Math.round(finalTotalDB * 0.4);
//             applyInstallmentUpdate(fp, req);
//           }
//           // 2) Second installment due (first paid, second not paid)
//           else if (fpStatus === "paid" && spStatus !== "paid") {
//             const firstReqDB = n(fp.requestedAmount);
//             const req = Math.max(
//               0,
//               Math.round(finalTotalDB * 0.8) - firstReqDB
//             );
//             applyInstallmentUpdate(sp, req);
//           }
//           // 3) Final installment due (first+second paid, final not paid)
//           else if (
//             fpStatus === "paid" &&
//             spStatus === "paid" &&
//             fipStatus !== "paid"
//           ) {
//             const firstReqDB = n(fp.requestedAmount);
//             const secondReqDB = n(sp.requestedAmount);
//             const req = Math.max(0, finalTotalDB - (firstReqDB + secondReqDB));
//             applyInstallmentUpdate(fip, req);
//           }
//         }

//         // ---------- DEEP CLEANING: 2 installments ----------
//         if (isDeepCleaning) {
//           const fp = booking.bookingDetails.firstPayment;
//           const fip = booking.bookingDetails.finalPayment;

//           const fpStatus = normStatus(fp.status);
//           const fipStatus = normStatus(fip.status);

//           // 1) First installment due
//           if (fpStatus !== "paid") {
//             const req = Math.round(finalTotalDB * 0.2);
//             applyInstallmentUpdate(fp, req);
//           }
//           // 2) Final installment due (first paid)
//           else if (fpStatus === "paid" && fipStatus !== "paid") {
//             const firstReqDB = n(fp.requestedAmount);
//             const req = Math.max(0, finalTotalDB - firstReqDB);
//             applyInstallmentUpdate(fip, req);
//           }
//         }
//       }

//       // ✅ IMPORTANT: Do not touch statuses. Do not modify other installments.
//       // ✅ Only the due installment gets updated when finalTotal changes.
//     }

//     if (formName) booking.formName = formName;

//     await booking.save();

//     return res.json({
//       success: true,
//       message: "Booking updated successfully",
//       booking,
//     });
//   } catch (err) {
//     console.error("UPDATE BOOKING ERROR:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Internal server error" });
//   }
// };

exports.updateUserBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const {
      customer,
      service,
      bookingDetails,
      address,
      selectedSlot,
      formName,
    } = req.body;

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const serviceType = booking.serviceType;
    const isDeepCleaning = serviceType === "deep_cleaning";
    const isHousePainting = serviceType === "house_painting";

    // ---------------- helpers ----------------
    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };

    const normStatus = (s) =>
      String(s || "")
        .toLowerCase()
        .trim();

    /**
     * ✅ Updated as per your requirement:
     *
     * - NEVER touch if status = "paid"
     * - NEVER change status anywhere
     *
     * - If status = "pending" AND requestedAmount (DB) is 0  -> DON'T TOUCH (vendor will request later)
     * - If status = "pending" AND requestedAmount (DB) > 0  -> update:
     *      requestedAmount = newReq
     *      amount = 0
     *      remaining = newReq   (or newReq - prePayment for final stage)
     *
     * - If status = "partial" AND requestedAmount (DB) > 0 -> update:
     *      requestedAmount = newReq
     *      remaining = newReq - amount  (and if final stage: newReq - prePayment - amount)
     *
     * - Safety fallback: if unknown status, behave like partial-style calc
     */
    const applyInstallmentUpdate = (
      inst,
      newRequestedAmount,
      { isFinalStage = false } = {},
    ) => {
      if (!inst) return;

      const st = normStatus(inst.status);
      const newReq = Math.max(0, n(newRequestedAmount));

      // never touch paid
      if (st === "paid") return;

      const existingReq = n(inst.requestedAmount);

      // ✅ if pending and not requested yet (req=0), do not update anything
      if (st === "pending" && existingReq === 0) return;

      // prePayment only matters in final stage as per your rule
      const prePayment = isFinalStage ? n(inst.prePayment) : 0;
      const paidAmount = n(inst.amount);

      if (st === "pending") {
        // requested already exists (>0) -> update it
        inst.requestedAmount = newReq;
        inst.amount = 0; // ✅ as you said
        inst.remaining = Math.max(0, newReq - prePayment); // ✅ final stage considers prepayment
        return;
      }

      if (st === "partial") {
        // if somehow partial but requestedAmount=0, skip (safe)
        if (existingReq === 0) return;

        inst.requestedAmount = newReq;
        // keep amount as-is (already partially paid)
        inst.amount = paidAmount;
        inst.remaining = Math.max(0, newReq - prePayment - paidAmount);
        return;
      }

      // fallback safe behavior (unknown status)
      if (existingReq === 0) return; // still respect "vendor will request later"
      inst.requestedAmount = newReq;
      inst.amount = paidAmount;
      inst.remaining = Math.max(0, newReq - prePayment - paidAmount);
    };

    // ---------------- UPDATE CUSTOMER ----------------
    if (customer) {
      booking.customer = booking.customer || {};
      booking.customer.name = customer.name ?? booking.customer.name;
      booking.customer.phone = customer.phone ?? booking.customer.phone;
      booking.customer.customerId =
        customer.customerId ?? booking.customer.customerId;
    }

    // ---------------- UPDATE ADDRESS ----------------
    if (address) {
      booking.address = booking.address || {};
      booking.address.houseFlatNumber =
        address.houseFlatNumber ?? booking.address.houseFlatNumber;
      booking.address.streetArea =
        address.streetArea ?? booking.address.streetArea;
      booking.address.landMark = address.landMark ?? booking.address.landMark;
      booking.address.city = address.city ?? booking.address.city;
      booking.address.location = address.location ?? booking.address.location;
    }

    // ---------------- UPDATE SLOT ----------------
    if (selectedSlot) {
      booking.selectedSlot = booking.selectedSlot || {};
      booking.selectedSlot.slotDate =
        selectedSlot.slotDate ?? booking.selectedSlot.slotDate;
      booking.selectedSlot.slotTime =
        selectedSlot.slotTime ?? booking.selectedSlot.slotTime;
    }

    // ---------------- UPDATE SERVICES (Deep Cleaning ONLY) ----------------
    if (isDeepCleaning && Array.isArray(service)) {
      booking.service = service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: n(s.price),
        quantity: s.quantity || 1,
        teamMembersRequired: s.teamMembersRequired || 0,
        duration: s.duration || 0,
        packageId: s.packageId,
        coinDeduction: Number(s.coinDeduction) || 0,
      }));
    }

    // ---------------- PAYMENT/TOTAL UPDATE (NO PAYMENT) ----------------
    if (bookingDetails) {
      booking.bookingDetails = booking.bookingDetails || {};
      booking.bookingDetails.firstPayment =
        booking.bookingDetails.firstPayment || {};
      booking.bookingDetails.secondPayment =
        booking.bookingDetails.secondPayment || {};
      booking.bookingDetails.finalPayment =
        booking.bookingDetails.finalPayment || {};

      const incomingFinalTotal =
        bookingDetails.finalTotal !== undefined
          ? n(bookingDetails.finalTotal)
          : n(booking.bookingDetails.finalTotal);

      const incomingBookingAmount = n(bookingDetails.bookingAmount);
      const incomingPaidAmount = n(bookingDetails.paidAmount);
      const incomingRefundAmount = n(bookingDetails.refundAmount);

      const prevFinalTotal = n(booking.bookingDetails.finalTotal);

      // update totals (only what you are passing)
      if (bookingDetails.finalTotal !== undefined) {
        booking.bookingDetails.finalTotal = incomingFinalTotal;
      }
      if (bookingDetails.refundAmount !== undefined) {
        booking.bookingDetails.refundAmount = incomingRefundAmount;
      }
      if (bookingDetails.bookingAmount !== undefined) {
        booking.bookingDetails.bookingAmount = incomingBookingAmount;
      }
      if (bookingDetails.paidAmount !== undefined) {
        booking.bookingDetails.paidAmount = incomingPaidAmount;
      }

      // HP site visit charges
      if (bookingDetails.siteVisitCharges !== undefined && isHousePainting) {
        booking.bookingDetails.siteVisitCharges = n(
          bookingDetails.siteVisitCharges,
        );
      }

      // price changes log
      if (!booking.bookingDetails.priceChanges)
        booking.bookingDetails.priceChanges = [];
      if (bookingDetails.priceChange) {
        booking.bookingDetails.priceChanges.push(bookingDetails.priceChange);
      }

      // booking-level AYTP (always finalTotal - paidAmount)
      const paidAmountDB = n(booking.bookingDetails.paidAmount);
      const finalTotalDB = n(booking.bookingDetails.finalTotal);

      booking.bookingDetails.amountYetToPay = Math.max(
        0,
        finalTotalDB - paidAmountDB,
      );

      // only recalc installment requestedAmount if finalTotal changed
      const finalTotalChanged = finalTotalDB !== prevFinalTotal;

      if (finalTotalChanged) {
        const fp = booking.bookingDetails.firstPayment;
        const sp = booking.bookingDetails.secondPayment;
        const fip = booking.bookingDetails.finalPayment;

        const fpStatus = normStatus(fp.status);
        const spStatus = normStatus(sp.status);
        const fipStatus = normStatus(fip.status);

        // ---------- HOUSE PAINTING: 3 installments ----------
        if (isHousePainting) {
          // 1) First installment due (first not paid)
          if (fpStatus !== "paid") {
            const req = Math.round(finalTotalDB * 0.4);
            applyInstallmentUpdate(fp, req, { isFinalStage: false });
          }
          // 2) Second installment due (first paid, second not paid)
          else if (fpStatus === "paid" && spStatus !== "paid") {
            const firstReqDB = n(fp.requestedAmount);
            const req = Math.max(
              0,
              Math.round(finalTotalDB * 0.8) - firstReqDB,
            );
            applyInstallmentUpdate(sp, req, { isFinalStage: false });
          }
          // 3) Final installment due (first+second paid, final not paid)
          else if (
            fpStatus === "paid" &&
            spStatus === "paid" &&
            fipStatus !== "paid"
          ) {
            const firstReqDB = n(fp.requestedAmount);
            const secondReqDB = n(sp.requestedAmount);
            const req = Math.max(0, finalTotalDB - (firstReqDB + secondReqDB));
            applyInstallmentUpdate(fip, req, { isFinalStage: true }); // ✅ prepayment handled here
          }
        }

        // ---------- DEEP CLEANING: 2 installments ----------
        if (isDeepCleaning) {
          const fp2 = booking.bookingDetails.firstPayment;
          const fip2 = booking.bookingDetails.finalPayment;

          const fp2Status = normStatus(fp2.status);
          const fip2Status = normStatus(fip2.status);

          // 1) First installment due
          if (fp2Status !== "paid") {
            const req = Math.round(finalTotalDB * 0.2);
            applyInstallmentUpdate(fp2, req, { isFinalStage: false });
          }
          // 2) Final installment due (first paid)
          else if (fp2Status === "paid" && fip2Status !== "paid") {
            const firstReqDB = n(fp2.requestedAmount);
            const req = Math.max(0, finalTotalDB - firstReqDB);
            applyInstallmentUpdate(fip2, req, { isFinalStage: true }); // ✅ prepayment handled here
          }
        }
      }

      // ✅ IMPORTANT: Do not touch statuses. Do not modify other installments.
      // ✅ Only the due installment gets updated when finalTotal changes.
      // ✅ And even then: pending + requestedAmount=0 stays untouched (vendor will request later).
    }

    if (formName) booking.formName = formName;

    await booking.save();

    return res.json({
      success: true,
      message: "Booking updated successfully",
      booking,
    });
  } catch (err) {
    console.error("UPDATE BOOKING ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// new 08-01 requestedAmount
exports.updateEnquiry = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const data = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    const booking = await UserBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!booking.isEnquiry) {
      return res.status(400).json({ message: "Booking is not an enquiry" });
    }

    const { address, selectedSlot, formName, service } = data;

    //---------------------------------------------
    // DETECT SERVICE TYPE
    //---------------------------------------------
    const serviceType =
      booking.serviceType ||
      detectServiceType(formName, service || booking.service);

    //========================================================
    // 📌 RULE: HOUSE PAINTING — ONLY UPDATE ADDRESS + SLOT
    //========================================================
    if (serviceType === "house_painting") {
      console.log("Updating ONLY address & slot for house painting enquiry");

      // Update Address
      if (address) {
        booking.address.houseFlatNumber =
          address.houseFlatNumber ?? booking.address.houseFlatNumber;

        booking.address.streetArea =
          address.streetArea ?? booking.address.streetArea;

        booking.address.landMark = address.landMark ?? booking.address.landMark;

        booking.address.city = address.city ?? booking.address.city;

        booking.address.location = address.location ?? booking.address.location;
      }

      // Update Slot
      if (selectedSlot) {
        booking.selectedSlot.slotDate =
          selectedSlot.slotDate ?? booking.selectedSlot.slotDate;

        booking.selectedSlot.slotTime =
          selectedSlot.slotTime ?? booking.selectedSlot.slotTime;
      }

      if (formName) booking.formName = formName;

      // ✅ ADD THIS
      const { bookingDetails = {} } = data;
      booking.bookingDetails = booking.bookingDetails || {};
      if (
        bookingDetails.siteVisitCharges !== undefined &&
        bookingDetails.siteVisitCharges !== null
      ) {
        booking.bookingDetails.siteVisitCharges = Number(
          bookingDetails.siteVisitCharges || 0,
        );
      }
      await booking.save();

      return res.status(200).json({
        success: true,
        message: "House painting enquiry updated (address & slot only)",
        booking,
      });
    }

    //========================================================
    // 📌 DEEP CLEANING — FULL UPDATE LOGIC
    //========================================================

    const { bookingDetails = {}, isEnquiry } = data;

    // Ensure nested structures
    booking.bookingDetails = booking.bookingDetails || {};
    booking.bookingDetails.firstPayment =
      booking.bookingDetails.firstPayment || {};
    booking.bookingDetails.finalPayment =
      booking.bookingDetails.finalPayment || {};

    //----------------------------
    // SERVICE UPDATE
    //----------------------------
    if (service?.length) {
      booking.service = service.map((s) => ({
        category: s.category || "",
        subCategory: s.subCategory || "",
        serviceName: s.serviceName || "",
        price: Number(s.price || 0),
        quantity: Number(s.quantity || 0),
        teamMembersRequired: Number(s.teamMembersRequired || 0),
        duration: s.duration || 0,
        packageId: s.packageId,
        coinDeduction: Number(s.coinDeduction) || 0,
      }));
    }

    //----------------------------
    // BACKEND CONTROLLED AMOUNT LOGIC
    //----------------------------
    const bookingAmount = Number(bookingDetails.bookingAmount || 0);
    const finalTotal = Number(bookingDetails.finalTotal || 0);
    const paidAmount = Number(bookingDetails.paidAmount || 0);

    // ✅ Deep cleaning enquiry AYTP should be based on FinalTotal - BookingAmount (your existing logic)
    const amountYetToPay = Math.max(0, finalTotal - bookingAmount);

    booking.bookingDetails.finalTotal = finalTotal;
    booking.bookingDetails.bookingAmount = bookingAmount;
    booking.bookingDetails.paidAmount = paidAmount;
    booking.bookingDetails.amountYetToPay = amountYetToPay;

    //----------------------------
    // PAYMENT MILESTONE LOGIC
    //----------------------------
    // ✅ FIRST PAYMENT: requestedAmount = bookingAmount, amount = 0, remaining = bookingAmount
    booking.bookingDetails.firstPayment.requestedAmount = bookingAmount;
    booking.bookingDetails.firstPayment.amount = 0;
    booking.bookingDetails.firstPayment.remaining = bookingAmount;
    booking.bookingDetails.firstPayment.method = "None";
    booking.bookingDetails.firstPayment.status = "pending";
    booking.bookingDetails.firstPayment.paidAt = null;

    // ✅ FINAL PAYMENT (always reset)
    booking.bookingDetails.finalPayment.amount = 0;
    booking.bookingDetails.finalPayment.status = "pending";
    booking.bookingDetails.finalPayment.paidAt = null;
    booking.bookingDetails.finalPayment.requestedAmount = 0;
    booking.bookingDetails.finalPayment.remaining = 0;
    booking.bookingDetails.finalPayment.method = "None";

    /* ==================================
         🔥 PRICE CHANGES UPDATE
         ================================== */
    // Initialize priceChanges array if it doesn't exist
    if (!booking.bookingDetails.priceChanges) {
      booking.bookingDetails.priceChanges = [];
    }

    // Append new price change if provided (from frontend)
    if (bookingDetails.priceChange) {
      booking.bookingDetails.priceChanges.push(bookingDetails.priceChange);
    }

    //----------------------------
    // ADDRESS UPDATE
    //----------------------------
    if (address) {
      booking.address = {
        ...booking.address,
        ...address,
      };
    }

    //----------------------------
    // SLOT UPDATE
    //----------------------------
    if (selectedSlot) {
      booking.selectedSlot = {
        ...booking.selectedSlot,
        ...selectedSlot,
      };
    }

    if (typeof isEnquiry === "boolean") booking.isEnquiry = isEnquiry;
    if (formName) booking.formName = formName;

    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Enquiry updated successfully",
      booking,
    });
  } catch (error) {
    console.error("Error updating enquiry:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// exports.updateEnquiry = async (req, res) => {
//   try {
//     const { bookingId } = req.params;
//     const data = req.body;

//     if (!bookingId) {
//       return res.status(400).json({ message: "bookingId is required" });
//     }

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({ message: "Booking not found" });
//     }

//     if (!booking.isEnquiry) {
//       return res.status(400).json({ message: "Booking is not an enquiry" });
//     }

//     const { address, selectedSlot, formName, service } = data;

//     //---------------------------------------------
//     // DETECT SERVICE TYPE
//     //---------------------------------------------
//     const serviceType =
//       booking.serviceType ||
//       detectServiceType(formName, service || booking.service);

//     //========================================================
//     // 📌 RULE: HOUSE PAINTING — ONLY UPDATE ADDRESS + SLOT
//     //========================================================
//     if (serviceType === "house_painting") {
//       console.log("Updating ONLY address & slot for house painting enquiry");

//       // Update Address
//       if (address) {
//         booking.address.houseFlatNumber =
//           address.houseFlatNumber ?? booking.address.houseFlatNumber;

//         booking.address.streetArea =
//           address.streetArea ?? booking.address.streetArea;

//         booking.address.landMark = address.landMark ?? booking.address.landMark;

//         booking.address.city = address.city ?? booking.address.city;

//         booking.address.location = address.location ?? booking.address.location;
//       }

//       // Update Slot
//       if (selectedSlot) {
//         booking.selectedSlot.slotDate =
//           selectedSlot.slotDate ?? booking.selectedSlot.slotDate;

//         booking.selectedSlot.slotTime =
//           selectedSlot.slotTime ?? booking.selectedSlot.slotTime;
//       }

//       if (formName) booking.formName = formName;

//       await booking.save();

//       return res.status(200).json({
//         success: true,
//         message: "House painting enquiry updated (address & slot only)",
//         booking,
//       });
//     }

//     //========================================================
//     // 📌 DEEP CLEANING — FULL UPDATE LOGIC
//     //========================================================

//     const { bookingDetails = {}, isEnquiry } = data;

//     // Ensure nested structures
//     booking.bookingDetails = booking.bookingDetails || {};
//     booking.bookingDetails.firstPayment =
//       booking.bookingDetails.firstPayment || {};
//     booking.bookingDetails.finalPayment =
//       booking.bookingDetails.finalPayment || {};

//     //----------------------------
//     // SERVICE UPDATE
//     //----------------------------
//     if (service?.length) {
//       booking.service = service.map((s) => ({
//         category: s.category || "",
//         subCategory: s.subCategory || "",
//         serviceName: s.serviceName || "",
//         price: Number(s.price || 0),
//         quantity: Number(s.quantity || 0),
//         teamMembersRequired: Number(s.teamMembersRequired || 0),
//         duration: s.duration || 0,
//         packageId: s.packageId,
//       }));
//     }

//     //----------------------------
//     // BACKEND CONTROLLED AMOUNT LOGIC
//     //----------------------------
//     const bookingAmount = Number(bookingDetails.bookingAmount || 0);
//     const finalTotal = Number(bookingDetails.finalTotal || 0);
//     const paidAmount = Number(bookingDetails.paidAmount || 0);

//     const amountYetToPay = Math.max(0, finalTotal - bookingAmount);

//     booking.bookingDetails.finalTotal = finalTotal;
//     booking.bookingDetails.bookingAmount = bookingAmount;
//     booking.bookingDetails.paidAmount = paidAmount;
//     booking.bookingDetails.amountYetToPay = amountYetToPay;

//     //----------------------------
//     // PAYMENT MILESTONE LOGIC
//     //----------------------------
//     // FIRST PAYMENT
//     booking.bookingDetails.firstPayment.amount = bookingAmount;
//     booking.bookingDetails.firstPayment.status = "pending";
//     booking.bookingDetails.firstPayment.paidAt = null;

//     // FINAL PAYMENT (always reset)
//     booking.bookingDetails.finalPayment.amount = 0;
//     booking.bookingDetails.finalPayment.status = "pending";
//     booking.bookingDetails.finalPayment.paidAt = null;

//     /* ==================================
//          🔥 PRICE CHANGES UPDATE
//          ================================== */
//     // Initialize priceChanges array if it doesn't exist
//     if (!booking.bookingDetails.priceChanges) {
//       booking.bookingDetails.priceChanges = [];
//     }

//     // Append new price change if provided (from frontend)
//     if (bookingDetails.priceChange) {
//       booking.bookingDetails.priceChanges.push(bookingDetails.priceChange);
//     }

//     //----------------------------
//     // ADDRESS UPDATE
//     //----------------------------
//     if (address) {
//       booking.address = {
//         ...booking.address,
//         ...address,
//       };
//     }

//     //----------------------------
//     // SLOT UPDATE
//     //----------------------------
//     if (selectedSlot) {
//       booking.selectedSlot = {
//         ...booking.selectedSlot,
//         ...selectedSlot,
//       };
//     }

//     if (typeof isEnquiry === "boolean") booking.isEnquiry = isEnquiry;
//     if (formName) booking.formName = formName;

//     await booking.save();

//     return res.status(200).json({
//       success: true,
//       message: "Enquiry updated successfully",
//       booking,
//     });
//   } catch (error) {
//     console.error("Error updating enquiry:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };

exports.updateBookingField = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { field, value } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "bookingId is required",
      });
    }

    // ✅ Allowed fields
    const allowedFields = ["isRead", "isDismmised", "isEnquiry"];
    if (!field || !allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: `field must be one of: ${allowedFields.join(", ")}`,
      });
    }

    // ✅ All must be boolean
    if (typeof value !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "value must be boolean",
      });
    }

    const updateObj = { [field]: value };

    // ✅ If dismissing, always mark read too
    if (field === "isDismmised" && value === true) {
      updateObj.isRead = true;
    }

    // ✅ If un-dismissing, do nothing extra (keep isRead as is)

    const updatedBooking = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateObj },
      { new: true, runValidators: true },
    );

    if (!updatedBooking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Updated ${field}`,
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Error in updateBookingField:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// > { issues while updating remaining amt after successful partial payment [cash/UPI]
// makePayment API not updating remaining amt to the second installment.amt.
// status jneed to change paid, update payments array, remainig should 0, update method based on current paymentMethod[UPI,Cash]}
// > {releasing final payment fron vendor app, the remaining gets overriding - need to preserve }
// > need to keep single controller . either makePayment or updateManualPayment
