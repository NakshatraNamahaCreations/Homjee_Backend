const UserBooking = require("../../models/user/userBookings");
const Quote = require("../../models/measurement/Quote");
const moment = require("moment");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const dayjs = require("dayjs");
const mongoose = require("mongoose");
const { unlockRelatedQuotesByHiring } = require("../../helpers/quotes");
const DeepCleaningPackageModel = require("../../models/products/DeepCleaningPackage");
const userSchema = require("../../models/user/userAuth");
const VendorRating = require("../../models/vendor/vendorRating");

// const redirectionUrl = "http://localhost:5173/checkout/payment/";
const redirectionUrl = "https://websitehomjee.netlify.app/checkout/payment/";
const vendorRatingURL = "https://websitehomjee.netlify.app/vendor-ratings";

const citiesObj = {
  Bangalore: "Bengaluru",
  Pune: "Pune",
};

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

function setPaymentStatus(details, finalTotal) {
  const paid = Number(details.paidAmount || 0);
  if (paid >= finalTotal) {
    details.paymentStatus = "Paid";
    return;
  }
  const ratio = finalTotal > 0 ? paid / finalTotal : 0;
  details.paymentStatus =
    ratio >= 0.799 ? "Partially Completed" : "Partial Payment";
}

function syncDerivedFields(details, finalTotal) {
  const paid = Number(details.paidAmount || 0);
  details.amountYetToPay = Math.max(0, Number(finalTotal) - paid);

  // Keep legacy field in sync (so existing UI using currentTotalAmount won't break)
  details.currentTotalAmount = Number(finalTotal);
}

function roundMoney(n) {
  // choose your policy: Math.ceil/Math.round to rupees
  return Math.round(Number(n || 0));
}

function ensureFirstMilestone(details) {
  if (!details.firstMilestone) details.firstMilestone = {};
  const fm = details.firstMilestone;

  if (fm.baseTotal == null) {
    // choose baseline: if user hasn't paid yet, you might choose details.finalTotal
    // but in your flow you want ORIGINAL for the 40% hurdle:
    const base = Number(
      details.bookingAmount ||
        details.finalTotal ||
        details.currentTotalAmount ||
        0
    );
    fm.baseTotal = base;
    fm.requiredAmount = roundMoney(base * 0.4);
  }

  // mark completed if already satisfied
  const paid = Number(details.paidAmount || 0);
  if (!fm.completedAt && paid >= Number(fm.requiredAmount || 0)) {
    fm.completedAt = new Date();
  }
  return fm;
}

function hasCompletedFirstMilestone(details) {
  const fm = ensureFirstMilestone(details);
  return Boolean(fm.completedAt);
}

function detectServiceType(formName, services) {
  const formLower = (formName || "").toLowerCase();
  const serviceCategories = services.map((s) =>
    (s.category || "").toLowerCase()
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

    const packageMaster = await DeepCleaningPackageModel.find({});

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
        0
      );
      bookingAmount = Math.round(originalTotalAmount * 0.2); //originalTotalAmount    // 20%
      bookingAmount = Math.round(originalTotalAmount * 0.2); //originalTotalAmount    // 20%

      paidAmount = bookingAmount; // Math.round(originalTotalAmount * 0.2); // Or assign from bookingDetails if user paid already
      amountYetToPay = originalTotalAmount - paidAmount;

      firstPayment = {
        status: paidAmount > 0 ? "paid" : "pending",
        amount: paidAmount,
        paidAt: paidAmount > 0 ? new Date() : null,
        method: bookingDetails?.paymentMethod || "UPI",
      };
      finalPayment = {
        status: "pending",
        amount: Math.max(0, originalTotalAmount - paidAmount),
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

    // Track payment line-item
    const payments =
      serviceType === "house_painting"
        ? []
        : [
            {
              at: new Date(),
              method: bookingDetailsConfig.paymentMethod,
              amount: paidAmount,
              providerRef: "razorpay_order_xyz",
            },
          ];

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
      providerRef: "razorpay_order_xyz",
    };
    const updatedBooking = await UserBooking.findByIdAndUpdate(
      booking._id,
      {
        $set: {
          "bookingDetails.paymentLink": {
            url: paymentLinkUrl,
            isActive: true,
            providerRef: "razorpay_order_xyz",
          },
        },
      },
      { new: true }
    );
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
//       // Create new user
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

//     // bookingAmount coming from admin UI (Option A expects siteVisitCharges separate)
//     // Use let because we may adjust bookingAmount for house painting case
//     // Use client-provided values whenever present (admin decides these)
//     let bookingAmount = Number(bookingDetails?.bookingAmount ?? 0);
//     // Accept paidAmount from payload — admin may pass 0 or existing paid values
//     let paidAmount = Number(bookingDetails?.paidAmount ?? 0);
//     // originalTotalAmount must come from client/frontend. Do NOT compute it server-side.
//     // Fall back to finalTotal or 0 if client didn't provide it explicitly.
//     let originalTotalAmount = Number(
//       bookingDetails?.originalTotalAmount ?? bookingDetails?.finalTotal ?? 0
//     );
//     let finalTotal =
//       Number(bookingDetails?.finalTotal ?? 0) || originalTotalAmount;
//     let amountYetToPay = 0;
//     let siteVisitCharges = 0;
//     // When true, skip any updates to pricing/payment fields for this request
//     let skipPriceUpdate = false;

//     let firstPayment = {};
//     let secondPayment = {};
//     let finalPayment = {};

//     // -----------------------
//     // Deep cleaning logic
//     // -----------------------
//     if (serviceType === "deep_cleaning") {
//       if (isEnquiry && bookingAmount > 0) {
//         // ADMIN ENQUIRY rules (Deep Cleaning)
//         // Use bookingAmount/finalTotal/paidAmount provided by client — do not overwrite
//         amountYetToPay = Math.max(0, finalTotal - bookingAmount);

//         firstPayment = {
//           status: paidAmount > 0 ? "paid" : "pending",
//           amount: bookingAmount,
//           paidAt: paidAmount > 0 ? new Date() : null,
//           method:
//             paidAmount > 0
//               ? bookingDetails?.paymentMethod || "None"
//               : undefined,
//         };

//         finalPayment = {
//           status: amountYetToPay > 0 ? "pending" : "paid",
//           amount: Math.max(0, finalTotal - bookingAmount),
//         };
//       } else {
//         // Normal (customer-like) behavior: derive booking amount from package master
//         // const packageMaster = await DeepCleaningPackageModel.find({}).lean();
//         // const result = service.map((cartItem) => {
//         //   const pkg = packageMaster.find((p) => p.name === cartItem.serviceName);
//         //   return pkg ? Number(pkg.bookingAmount || 0) : 0;
//         // });

//         // bookingAmount = result.reduce((sum, amt) => sum + Number(amt || 0), 0);
//         // Non-enquiry path: use provided paidAmount (if any) — otherwise treat bookingAmount as paid
//         paidAmount = Number(bookingDetails?.paidAmount ?? bookingAmount);
//         // If client hasn't provided finalTotal, fallback already handled above
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
//           amount: Math.max(0, finalTotal - paidAmount),
//         };
//       }
//     }

//     // -----------------------
//     // House painting logic (Option A)
//     // -----------------------
//     if (serviceType === "house_painting") {
//       // As per Option A: admin passes bookingAmount which we treat as siteVisitCharges
//       siteVisitCharges = Number(bookingDetails?.bookingAmount || 0);

//       if (isEnquiry && siteVisitCharges > 0) {
//         // ADMIN ENQUIRY (Option A): store siteVisitCharges separately,
//         // bookingAmount and payment values should be 0
//         bookingAmount = 0;
//         // For house painting enquiries we keep paidAmount 0 as per requirement
//         paidAmount = 0;
//         originalTotalAmount = 0;
//         finalTotal = 0;
//         amountYetToPay = 0;

//         firstPayment = { status: "pending", amount: 0 };
//         secondPayment = { status: "pending", amount: 0 };
//         finalPayment = { status: "pending", amount: 0 };
//       } else {
//         // Normal customer-style booking for site visit: bookingAmount stays 0,
//         // paidAmount equals siteVisitCharges (if your flow collects it)
//         bookingAmount = 0;
//         // For house painting non-enquiry admin flow we currently do not accept paid amount here (keep 0)
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
//     // Payment link and bookingId
//     // -----------------------
//     const bookingId = generateBookingId();

//     let paymentLink = { isActive: false };
//     if (bookingAmount > 0) {
//       const paymentLinkUrl = `https://pay.example.com/${bookingId}-${Date.now()}`;
//       paymentLink = {
//         url: paymentLinkUrl,
//         isActive: true,
//         providerRef: "razorpay_order_xyz", // optional
//       };
//     }

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
//       paymentLink,
//     };

//     // -----------------------
//     // Payments array: only add actual payment entries when not an enquiry and there is a paidAmount
//     // -----------------------
//     let payments = [];
//     if (!isEnquiry && paidAmount > 0) {
//       payments.push({
//         at: new Date(),
//         method: bookingDetailsConfig.paymentMethod,
//         amount: paidAmount,
//         providerRef: "razorpay_order_xyz",
//       });
//     }

//     // -----------------------
//     // Create booking object
//     // -----------------------
//     const booking = new UserBooking({
//       // customer: {
//       //   customerId: customer?.customerId,
//       //   name: customer?.name,
//       //   phone: customer?.phone,
//       // },

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
//       })),
//       serviceType,
//       bookingDetails: bookingDetailsConfig,
//       assignedProfessional: assignedProfessional
//         ? {
//           professionalId: assignedProfessional.professionalId,
//           name: assignedProfessional.name,
//           phone: assignedProfessional.phone,
//         }
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
      bookingDetails?.originalTotalAmount ?? bookingDetails?.finalTotal ?? 0
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
          amount: bookingAmount,
          paidAt: paidAmount > 0 ? new Date() : null,
          method:
            paidAmount > 0
              ? bookingDetails?.paymentMethod || "None"
              : undefined,
        };

        finalPayment = {
          status: amountYetToPay > 0 ? "pending" : "paid",
          amount: amountYetToPay,
        };
      } else {
        paidAmount = Number(bookingDetails?.paidAmount ?? bookingAmount);
        amountYetToPay = Math.max(0, finalTotal - paidAmount);

        firstPayment = {
          status: paidAmount > 0 ? "paid" : "No Payment",
          amount: paidAmount,
          paidAt: paidAmount > 0 ? new Date() : null,
          method:
            paidAmount > 0 ? bookingDetails?.paymentMethod || "None" : "None",
        };

        finalPayment = {
          status: amountYetToPay > 0 ? "pending" : "paid",
          amount: amountYetToPay,
        };
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

        firstPayment = { status: "No Payment", amount: 0 };
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
        providerRef: "razorpay_order_xyz",
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
      providerRef: "razorpay_order_xyz",
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

exports.getAllBookings = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;
    console.log({ service, city, timePeriod, startDate, endDate });

    const filter = buildFilter({ service, city, startDate, endDate });
    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllLeadsBookings = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;
    console.log({ service, city, timePeriod, startDate, endDate });

    const filter = buildFilter({
      service,
      city,
      startDate,
      endDate,
      isEnquiry: false,
    });

    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ allLeads: bookings });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllEnquiries = async (req, res) => {
  try {
    const { service, city, timePeriod, startDate, endDate } = req.query;
    console.log({ service, city, timePeriod, startDate, endDate });

    const filter = buildFilter({
      service,
      city,
      startDate,
      endDate,
      isEnquiry: true,
    });

    const bookings = await UserBooking.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ allEnquies: bookings });
  } catch (error) {
    console.error("Error fetching all enquiries:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------------------------------
// 🔧 Shared Helper Function: buildFilter()
// ---------------------------------------

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
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);

    const dayAfterTomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)
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
        "YYYY-MM-DD hh:mm A"
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
        0
      );
      totalGsv += bookingGsv;

      // 2️⃣ Get vendor invitation
      const vendorInvitation = (booking.invitedVendors || []).find(
        (v) => String(v.professionalId) === String(vendorId)
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
          "YYYY-MM-DD hh:mm A"
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
        (v) => String(v.professionalId) === String(vendorId)
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
          period === "this_month" ? "month" : "last"
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
          "YYYY-MM-DD hh:mm A"
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
          period === "this_month" ? "month" : "last"
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
            (iv) => String(iv.professionalId) === String(vendorId)
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
            period === "this_month" ? "month" : "last"
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
              "YYYY-MM-DD hh:mm A"
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
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
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
        "YYYY-MM-DD hh:mm A"
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

exports.respondConfirmJobVendorLine = async (req, res) => {
  try {
    const { bookingId, status, assignedProfessional, vendorId, cancelledBy } =
      req.body;
    if (!bookingId)
      return res.status(400).json({ message: "bookingId is required" });
    if (!vendorId)
      return res
        .status(400)
        .json({ message: "vendorId (professionalId) is required" });

    const updateFields = {};
    if (status) updateFields["bookingDetails.status"] = status;
    if (assignedProfessional)
      updateFields.assignedProfessional = assignedProfessional;

    // 1) ensure invite exists
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
          },
        },
      }
    );

    // 2) build $set from the patch object (DO NOT assign the object to the string path)
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

    const result = await UserBooking.findOneAndUpdate(
      { _id: bookingId },
      { $set: setOps },
      {
        new: true,
        runValidators: true,
        arrayFilters: [{ "iv.professionalId": String(vendorId) }],
      }
    );

    if (!result) return res.status(404).json({ message: "Booking not found" });
    res.status(200).json({ message: "Booking updated", booking: result });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
      "bookingDetails.status": { $ne: "Pending", $ne: "Cancelled" },
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
        s.serviceName?.toLowerCase().includes("paint")
    );

    // === Prepare hiring data (for Deep Cleaning only) ===
    const hiringUpdate = {};
    if (!isHousePainter && teamMembers.length > 0 && startDate) {
      // Generate project dates array
      const projectDates = [];
      const startMoment = moment(startDate, "YYYY-MM-DD");
      for (let i = 0; i < daysRequired; i++) {
        projectDates.push(
          startMoment.clone().add(i, "days").format("YYYY-MM-DD")
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
      { new: true, runValidators: true }
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
      { new: true }
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
    (c) => c.status === "pending"
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
      { new: true }
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
      }
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
      }
    );

    if (!updated)
      return res
        .status(404)
        .json({ message: "Booking not found after update" });
    res.status(200).json({ message: "Status Updated", booking: updated });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// cancellling by customer from the website
// won't count this in Vendor's performance, this lead will vanish from the android app
exports.cancelLeadFromWebsite = async (req, res) => {
  try {
    const { bookingId, status } = req.body;

    if (!bookingId)
      return res.status(400).json({ message: "bookingId is required" });

    if (!status) return res.status(400).json({ message: "status is required" });

    const booking = await UserBooking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // booking-level fields
    const updateFields = {
      "bookingDetails.status": status,
      "bookingDetails.updatedAt": new Date(), // track when status changed
    };

    const updated = await UserBooking.findByIdAndUpdate(
      bookingId,
      { $set: updateFields },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updated)
      return res
        .status(404)
        .json({ message: "Booking not found after update" });

    res.status(200).json({
      message: "Booking cancelled successfully",
      booking: updated,
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
    booking.bookingDetails.firstPayment.status = "pending";
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
      d.finalTotal ?? d.currentTotalAmount ?? d.bookingAmount ?? 0
    );

    d.finalTotal = approvedTotal > 0 ? approvedTotal : Number(totalAmount || 0);

    // Keep mirror in sync
    d.currentTotalAmount = d.finalTotal;
    // booking.service[0].price = finalTotal;  added by sonali

    // ✅ Calculate 40% for first installment
    const firstInstallment = Math.round(d.finalTotal * 0.4);
    d.paymentStatus = "Unpaid";
    d.paidAmount = 0;

    booking.bookingDetails.amountYetToPay = firstInstallment;
    booking.bookingDetails.firstPayment.amount =
      firstInstallment || Math.round(finalTotal * 0.4);

    const updatedQuote = await Quote.updateOne(
      { _id: quotationObjectId, status: "finalized" }, // Make sure you're selecting the finalized quote
      { $set: { locked: true } } // Lock the quotation
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
      moment(startDate).add(i, "days").format("YYYY-MM-DD")
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
        moment(startDate).add(i, "days").format("YYYY-MM-DD")
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
    booking.bookingDetails.amountYetToPay = firstInstallment; // 40% due now

    // 6) Payment link (change to razor pay)
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${bookingId}/${Date.now()}/${pay_type}`;
    booking.bookingDetails.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz", // fill if you have gateway id
      installmentStage: "first",
    };

    // console.log("paymentLinkUrl", paymentLinkUrl);

    if (process.env.NODE_ENV !== "production") {
      booking.assignedProfessional.hiring.autoCancelAt = new Date(
        Date.now() + 2 * 60 * 1000
      ); // +2 mins
    }
    const USE_REAL_AUTO_CANCEL = true; // 👈 set to true for real-time test

    if (!USE_REAL_AUTO_CANCEL && process.env.NODE_ENV !== "production") {
      booking.assignedProfessional.hiring.autoCancelAt = new Date(
        Date.now() + 2 * 60 * 1000
      );
      console.log(
        "DEV: autoCancelAt set to",
        booking.assignedProfessional.hiring.autoCancelAt.toISOString()
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
      `[OTP SENT] Booking ${bookingId} - OTP: ${otp} (expires at ${expiry})`
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
      (change) => change.status === "pending"
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

    // ✅ Update second payment milestone
    d.secondPayment.status = "pending";
    d.secondPayment.amount = secondInstallment;

    // 🔗 Generate payment link
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${
      booking._id
    }/${Date.now()}/${pay_type}`;
    d.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
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

// HOUSE PAINTING, DEEP CLEANING - FINAL PAYMENT REQUESTED - LINK SENT
exports.requestingFinalPaymentEndProject = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await UserBooking.findById(bookingId);

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    const details = booking.bookingDetails;
    const serviceType = (booking.serviceType || "").toLowerCase();

    // ✅ Only allow ending if job is ongoing
    if (
      !["project ongoing", "job ongoing"].includes(details.status.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "Only 'Project Ongoing' bookings can be requested to end",
      });
    }

    // ✅ Payment validation logic based on service type
    const firstPaid = details.firstPayment?.status === "paid";
    const secondPaid = details.secondPayment?.status === "paid";

    let allowRequest = false;
    if (serviceType === "deep_cleaning") {
      // Deep Cleaning → only first payment required
      allowRequest = firstPaid;
      if (!allowRequest) {
        return res.status(400).json({
          success: false,
          message:
            "First payment must be completed before requesting final payment.",
        });
      }
    } else {
      // House Painting → first + second payment required
      allowRequest = firstPaid && secondPaid;
      if (!allowRequest) {
        return res.status(400).json({
          success: false,
          message:
            "At least 80% payment (First and Second installments) required before requesting to end job",
        });
      }
    }

    // ✅ Compute the latest approved or final total
    const approvedPriceChange = details.priceChanges
      ?.filter((p) => p.status === "approved")
      .slice(-1)[0];

    const totalExpected =
      approvedPriceChange?.proposedTotal ||
      details.finalTotal ||
      details.currentTotalAmount ||
      details.bookingAmount ||
      0;

    const paidSoFar = details.paidAmount || 0;
    const finalAmount = totalExpected - paidSoFar;

    // ✅ Record final payment setup
    details.finalPayment = {
      status: "pending",
      amount: finalAmount,
    };

    console.log("finalAmount", finalAmount);
    details.jobEndRequestedAt = new Date();

    // now generate and store payment link
    const pay_type = "auto-pay";
    const paymentLinkUrl = `${redirectionUrl}${
      booking._id
    }/${Date.now()}/${pay_type}`;

    details.paymentLink = {
      url: paymentLinkUrl,
      isActive: true,
      providerRef: "razorpay_order_xyz",
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
      amountDue: finalAmount,
      finalPayment: details.finalPayment.status,
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

// THREE INSTALLMENT PAY API
exports.makePayment = async (req, res) => {
  try {
    const { bookingId, paymentMethod, paidAmount, providerRef } = req.body;

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

    const amount = Number(paidAmount);
    if (!(amount > 0)) {
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

    const customerId = booking.customer?.customerId;
    const vendorId = booking.assignedProfessional?.professionalId;
    const vendorName = booking.assignedProfessional?.name;
    const vendorPhoto = booking.assignedProfessional?.profile;

    const serviceType = (booking.serviceType || "").toLowerCase();
    const d = booking.bookingDetails || (booking.bookingDetails = {});

    // ✅ Payment step detection
    if (
      d.firstPayment?.status === "pending" &&
      amount >= d.firstPayment.amount
    ) {
      d.firstPayment.status = "paid";
      d.firstPayment.paidAt = new Date();
      d.firstPayment.method = paymentMethod;
    } else if (
      serviceType !== "deep_cleaning" &&
      d.secondPayment?.status === "pending" &&
      amount >= d.secondPayment.amount
    ) {
      // Second payment only applies to house painting
      d.secondPayment.status = "paid";
      d.secondPayment.paidAt = new Date();
      d.secondPayment.method = paymentMethod;
    } else if (d.finalPayment?.status === "pending") {
      d.finalPayment.status = "paid";
      d.finalPayment.paidAt = new Date();
      d.finalPayment.method = paymentMethod;
    }

    // 🧠 Compute / lock final total
    let finalTotal = Number(d.finalTotal ?? 0);

    // 🧩 Deep Cleaning fallback logic
    if (serviceType === "deep_cleaning" && !(finalTotal > 0)) {
      finalTotal = Number(d.bookingAmount ?? d.siteVisitCharges ?? 0);
      if (finalTotal > 0) {
        d.finalTotal = finalTotal;
        console.log(
          `✅ Auto-updated finalTotal for Deep Cleaning: ₹${finalTotal}`
        );
      }
    }

    // 🧩 Fallback for House Painting and others
    if (!(finalTotal > 0)) {
      finalTotal = computeFinalTotal(d);
      if (finalTotal > 0) d.finalTotal = finalTotal;
    }

    if (!(finalTotal > 0)) {
      return res.status(400).json({
        success: false,
        message: "Booking amount not set. Finalize quote first.",
      });
    }

    // 🧩 Idempotency
    if (providerRef) {
      booking.payments = booking.payments || [];
      const already = booking.payments.some(
        (p) => p.providerRef === providerRef
      );
      if (already) {
        return res.status(200).json({
          success: true,
          message: "Payment already recorded (idempotent).",
          bookingId: booking._id,
        });
      }
    }

    // ✅ Payment logic
    const currentPaid = Number(d.paidAmount || 0);
    const remaining = Math.max(0, finalTotal - currentPaid);
    if (amount > remaining) {
      return res.status(400).json({
        success: false,
        message: "Paid amount cannot exceed remaining balance",
      });
    }

    d.paymentMethod = String(paymentMethod);
    d.paidAmount = currentPaid + amount;

    // 🧩 Disable any active payment link
    if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

    // 🧾 Record payment
    booking.payments = booking.payments || [];
    booking.payments.push({
      at: new Date(),
      method: d.paymentMethod,
      amount,
      providerRef: providerRef || undefined,
    });

    // 🧩 Update milestones (only for house painting)
    if (serviceType !== "deep_cleaning") {
      ensureFirstMilestone(d);
      if (
        !d.firstMilestone.completedAt &&
        d.paidAmount >= Number(d.firstMilestone.requiredAmount || 0)
      ) {
        d.firstMilestone.completedAt = new Date();
      }
    }

    // 🧩 Recalculate derived fields
    syncDerivedFields(d, finalTotal);

    const fullyPaid = d.paidAmount >= finalTotal;
    if (fullyPaid) {
      d.paymentStatus = "Paid";
      booking.vendorRatingUrl = `${vendorRatingURL}?vendorId=${vendorId}&bookingId=${bookingId}&customerId=${customerId}&vendorName=${vendorName}&vendorPhoto=${vendorPhoto}`;
      // Mark project as completed if ongoing
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

      // Maintain hiring info
      if (booking.assignedProfessional?.hiring) {
        booking.assignedProfessional.hiring.status = "active";
        if (!booking.assignedProfessional.hiring.hiredDate) {
          booking.assignedProfessional.hiring.hiredDate = new Date();
          booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
        }
      }
    } else {
      // Partial payment thresholds
      const ratio = d.paidAmount / finalTotal;
      d.paymentStatus =
        ratio >= 0.799 ? "Partially Completed" : "Partial Payment";

      // Promote Pending → Hired on first payment
      const statusNorm = (d.status || "").trim().toLowerCase();
      if (["pending hiring", "pending"].includes(statusNorm)) {
        d.status = "Hired";
      }

      // Keep hiring active
      if (booking.assignedProfessional?.hiring) {
        booking.assignedProfessional.hiring.status = "active";
        if (!booking.assignedProfessional.hiring.hiredDate) {
          booking.assignedProfessional.hiring.hiredDate = new Date();
          booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
        }
      }
    }
    booking.isEnquiry = false;
    await booking.save();

    return res.json({
      success: true,
      message: fullyPaid
        ? "Final payment completed. Job marked as ended."
        : "Payment received.",
      bookingId: booking._id,
      finalTotal,
      totalPaid: d.paidAmount,
      remainingAmount: Math.max(0, finalTotal - d.paidAmount),
      status: d.status,
      paymentStatus: d.paymentStatus,
      ratingURL: fullyPaid
        ? `${vendorRatingURL}?vendorId=${vendorId}&bookingId=${bookingId}&customerId=${customerId}&vendorName=${vendorName}&vendorPhoto=${vendorPhoto}`
        : "",
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

// Update user booking (existing - modified to handle service updates properly)
// exports.updateUserBooking = async (req, res) => {
//   try {
//     const { bookingId } = req.params;
//     const {
//       customer,
//       service,
//       bookingDetails,
//       address,
//       selectedSlot,
//       isEnquiry,
//       formName,
//     } = req.body;

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking) {
//       return res.status(404).json({
//         success: false,
//         message: "Booking not found",
//       });
//     }

//     // Detect service type early so we can enforce enquiry rules
//     const serviceType = detectServiceType(formName, service || booking.service || []);

//     // Special rule: when this booking is an enquiry and the service is house_painting,
//     // only allow updating the address and selectedSlot — do NOT change price/payment/customer/service.
//     if (booking.isEnquiry && serviceType === "house_painting") {
//       // Update address only
//       if (address) {
//         booking.address = {
//           houseFlatNumber:
//             address.houseFlatNumber || booking.address.houseFlatNumber,
//           streetArea: address.streetArea || booking.address.streetArea,
//           landMark: address.landMark || booking.address.landMark,
//           city: address.city || booking.address.city,
//           location: address.location || booking.address.location,
//         };
//       }

//       // Update selected slot only
//       if (selectedSlot) {
//         booking.selectedSlot = {
//           slotTime: selectedSlot.slotTime || booking.selectedSlot.slotTime,
//           slotDate: selectedSlot.slotDate || booking.selectedSlot.slotDate,
//         };
//       }

//       // Respect explicit isEnquiry/formName toggles only if provided
//       if (isEnquiry !== undefined) booking.isEnquiry = isEnquiry;
//       if (formName) booking.formName = formName;

//       await booking.save();

//       return res.json({
//         success: true,
//         message:
//           "Booking updated (enquiry - house_painting). Only address & selectedSlot were changed.",
//         booking,
//       });
//     }

//     // Update customer info
//     if (customer) {
//       booking.customer = {
//         customerId: customer.customerId || booking.customer.customerId,
//         name: customer.name || booking.customer.name,
//         phone: customer.phone || booking.customer.phone,
//       };
//     }

//     // Update services and recalculate total
//     if (service && Array.isArray(service)) {
//       booking.service = service.map((s) => ({
//         category: s.category || "",
//         subCategory: s.subCategory || "",
//         serviceName: s.serviceName || "",
//         price: s.price || 0,
//         quantity: s.quantity || 1,
//         teamMembersRequired: s.teamMembersRequired || 1,
//       }));

//       // Recalculate total amount
//       const totalAmount = service.reduce((sum, s) => sum + (s.price || 0), 0);

//       // Update booking details with new total
//       booking.bookingDetails.finalTotal = totalAmount;
//       booking.bookingDetails.originalTotalAmount = totalAmount;
//     }

//     // Update booking details
//     if (bookingDetails) {
//       if (bookingDetails.status)
//         booking.bookingDetails.status = bookingDetails.status;
//       if (bookingDetails.paymentMethod)
//         booking.bookingDetails.paymentMethod = bookingDetails.paymentMethod;
//       if (bookingDetails.paymentStatus)
//         booking.bookingDetails.paymentStatus = bookingDetails.paymentStatus;

//       // Handle paid amount updates
//       if (bookingDetails.paidAmount !== undefined) {
//         booking.bookingDetails.paidAmount = bookingDetails.paidAmount;
//         booking.bookingDetails.amountYetToPay =
//           booking.bookingDetails.finalTotal - bookingDetails.paidAmount;
//       }
//     }

//     // Update address
//     if (address) {
//       booking.address = {
//         houseFlatNumber:
//           address.houseFlatNumber || booking.address.houseFlatNumber,
//         streetArea: address.streetArea || booking.address.streetArea,
//         landMark: address.landMark || booking.address.landMark,
//         city: address.city || booking.address.city,
//         location: address.location || booking.address.location,
//       };
//     }

//     // Update selected slot
//     if (selectedSlot) {
//       booking.selectedSlot = {
//         slotTime: selectedSlot.slotTime || "",
//         slotDate: selectedSlot.slotDate || "",
//       };
//     }

//     // Update other fields
//     if (isEnquiry !== undefined) booking.isEnquiry = isEnquiry;
//     if (formName) booking.formName = formName;

//     await booking.save();

//     res.json({
//       success: true,
//       message: "Booking updated successfully",
//       booking: booking,
//     });
//   } catch (error) {
//     console.error("Error updating booking:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

// sonali updates....
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

    /* ---------------------------------- */
    /* UPDATE CUSTOMER                    */
    /* ---------------------------------- */
    if (customer) {
      booking.customer.name = customer.name ?? booking.customer.name;
      booking.customer.phone = customer.phone ?? booking.customer.phone;
      booking.customer.customerId =
        customer.customerId ?? booking.customer.customerId;
    }

    /* ---------------------------------- */
    /* UPDATE ADDRESS                     */
    /* ---------------------------------- */
    if (address) {
      booking.address.houseFlatNumber =
        address.houseFlatNumber ?? booking.address.houseFlatNumber;
      booking.address.streetArea =
        address.streetArea ?? booking.address.streetArea;
      booking.address.landMark = address.landMark ?? booking.address.landMark;
      booking.address.city = address.city ?? booking.address.city;
      booking.address.location = address.location ?? booking.address.location;
    }

    /* ---------------------------------- */
    /* UPDATE SLOT                        */
    /* ---------------------------------- */
    if (selectedSlot) {
      booking.selectedSlot.slotDate =
        selectedSlot.slotDate ?? booking.selectedSlot.slotDate;
      booking.selectedSlot.slotTime =
        selectedSlot.slotTime ?? booking.selectedSlot.slotTime;
    }

    /* ---------------------------------- */
    /* UPDATE SERVICES (Deep cleaning ONLY) */
    /* ---------------------------------- */
    if (isDeepCleaning && Array.isArray(service)) {
      booking.service = service.map((s) => ({
        category: s.category,
        subCategory: s.subCategory,
        serviceName: s.serviceName,
        price: s.price,
        quantity: s.quantity || 1,
        teamMembersRequired: s.teamMembersRequired || 0,
      }));
    }

    /* ---------------------------------- */
    /* PAYMENT UPDATE (COMMON RULES)      */
    /* ---------------------------------- */
    if (bookingDetails) {
      const finalTotal = Number(bookingDetails.finalTotal || 0);
      const amountYetToPay = Number(bookingDetails.amountYetToPay || 0);
      const refundAmount = Number(bookingDetails.refundAmount || 0);

      // Update ONLY these three
      booking.bookingDetails.finalTotal = finalTotal;
      // booking.bookingDetails.originalTotalAmount = finalTotal; // for kiru changes
      booking.bookingDetails.amountYetToPay = amountYetToPay;
      booking.bookingDetails.refundAmount = refundAmount;

      // Set Payment Status
      if (refundAmount > 0) booking.bookingDetails.paymentStatus = "Refunded";
      else if (amountYetToPay > 0)
        booking.bookingDetails.paymentStatus = "Partial Payment";
      else booking.bookingDetails.paymentStatus = "Paid";

      /* ==================================
         🔥 DEEP CLEANING INSTALLMENT LOGIC
         ================================== */
      if (isDeepCleaning) {
        const firstPaid = booking.bookingDetails.firstPayment.status === "paid";

        if (!firstPaid) {
          // Update firstPayment.amount only
          booking.bookingDetails.firstPayment.amount = amountYetToPay;
        } else {
          // First is already paid → update finalPayment.amount
          booking.bookingDetails.finalPayment.amount = amountYetToPay;
        }
      }

      /* ==================================
         🔥 HOUSE PAINTING INSTALLMENT LOGIC
         ================================== */
      if (isHousePainting) {
        const fPaid = booking.bookingDetails.firstPayment.status === "paid";
        const sPaid = booking.bookingDetails.secondPayment.status === "paid";

        if (!fPaid) {
          booking.bookingDetails.firstPayment.amount = amountYetToPay;
        } else if (fPaid && !sPaid) {
          booking.bookingDetails.secondPayment.amount = amountYetToPay;
        } else if (fPaid && sPaid) {
          booking.bookingDetails.finalPayment.amount = amountYetToPay;
        }
      }
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
        quantity: Number(s.quantity || 1),
        teamMembersRequired: Number(s.teamMembersRequired || 1),
      }));
    }

    //----------------------------
    // BACKEND CONTROLLED AMOUNT LOGIC
    //----------------------------
    const bookingAmount = Number(bookingDetails.bookingAmount || 0);
    const finalTotal = Number(bookingDetails.finalTotal || 0);
    const paidAmount = Number(bookingDetails.paidAmount || 0);

    const amountYetToPay = Math.max(0, finalTotal - bookingAmount);

    booking.bookingDetails.finalTotal = finalTotal;
    booking.bookingDetails.bookingAmount = bookingAmount;
    booking.bookingDetails.paidAmount = paidAmount;
    booking.bookingDetails.amountYetToPay = amountYetToPay;

    //----------------------------
    // PAYMENT MILESTONE LOGIC
    //----------------------------
    // FIRST PAYMENT
    booking.bookingDetails.firstPayment.amount = bookingAmount;
    booking.bookingDetails.firstPayment.status = "pending";
    booking.bookingDetails.firstPayment.paidAt = null;

    // FINAL PAYMENT (always reset)
    booking.bookingDetails.finalPayment.amount = 0;
    booking.bookingDetails.finalPayment.status = "pending";
    booking.bookingDetails.finalPayment.paidAt = null;

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

// 10-12-25 by sonali
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

//       // FORM NAME update allowed
//       if (formName) {
//         booking.formName = formName;
//       }

//       await booking.save();

//       return res.status(200).json({
//         success: true,
//         message: "House painting enquiry updated (address & slot only)",
//         booking,
//       });
//     }

//     //========================================================
//     // 📌 DEEP CLEANING OR OTHER SERVICE TYPES
//     // → Normal full update logic
//     //========================================================

//     const { bookingDetails = {}, isEnquiry } = data;

//     // Ensure nested objects
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
//         quantity: Number(s.quantity || 1),
//         teamMembersRequired: Number(s.teamMembersRequired || 1),
//       }));
//     }

//     //----------------------------
//     // BOOKING DETAILS UPDATE
//     //----------------------------
//     const bookingAmount = Number(bookingDetails.bookingAmount || 0);
//     const finalTotal = Number(bookingDetails.finalTotal || 0);
//     const paidAmount = Number(bookingDetails.paidAmount || 0);

//     booking.bookingDetails.finalTotal = finalTotal;
//     booking.bookingDetails.bookingAmount = bookingAmount;
//     booking.bookingDetails.paidAmount = paidAmount;
//     booking.bookingDetails.amountYetToPay = Math.max(
//       0,
//       finalTotal - bookingAmount
//     );

//     //----------------------------
//     // ADDRESS UPDATE (deep cleaning)
//     //----------------------------
//     if (address) {
//       booking.address = {
//         ...booking.address,
//         ...address,
//       };
//     }

//     //----------------------------
//     // SLOT UPDATE (deep cleaning)
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

// controllers/bookingController.js

exports.updateBookingField = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { field, value } = req.body;

    // Validate bookingId
    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required",
      });
    }

    // Validate field
    const allowedFields = ["isRead", "isDismmised"];
    if (!field || !allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: `field is required and must be one of: ${allowedFields.join(
          ", "
        )}`,
      });
    }

    // Validate value is boolean
    if (typeof value !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "value must be a boolean (true or false)",
      });
    }

    // Prepare update object
    const updateObj = { [field]: value };

    // If dismissing, ensure isRead is also set true
    if (field === "isDismmised" && value === true) {
      updateObj.isRead = true;
    }

    const BookingModel = mongoose.model("UserBookings");

    const updatedBooking = await BookingModel.findByIdAndUpdate(
      bookingId,
      { $set: updateObj },
      { new: true, runValidators: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `${field} set to ${value}`,
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

// exports.makePayment = async (req, res) => {
//   try {
//     const { bookingId, paymentMethod, paidAmount, providerRef } = req.body;

//     if (!bookingId || !paymentMethod || paidAmount == null) {
//       return res.status(400).json({
//         success: false,
//         message: "bookingId, paymentMethod, and paidAmount are required",
//       });
//     }

//     const validPaymentMethods = ["Cash", "Card", "UPI", "Wallet"];
//     if (!validPaymentMethods.includes(String(paymentMethod))) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid payment method" });
//     }

//     const amount = Number(paidAmount);
//     if (!(amount > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "Paid amount must be greater than zero",
//       });
//     }

//     const booking = await UserBooking.findById(bookingId);
//     if (!booking)
//       return res
//         .status(404)
//         .json({ success: false, message: "Booking not found" });

//     const d = booking.bookingDetails || (booking.bookingDetails = {});

//     if (
//       d.firstPayment.status === "pending" &&
//       amount >= d.firstPayment.amount
//     ) {
//       d.firstPayment.status = "paid";
//       d.firstPayment.paidAt = new Date();
//       d.firstPayment.method = paymentMethod;
//     } else if (
//       d.secondPayment.status === "pending" &&
//       amount >= d.secondPayment.amount
//     ) {
//       d.secondPayment.status = "paid";
//       d.secondPayment.paidAt = new Date();
//       d.secondPayment.method = paymentMethod;
//     } else if (d.finalPayment.status === "pending") {
//       d.finalPayment.status = "paid";
//       d.finalPayment.paidAt = new Date();
//       d.finalPayment.method = paymentMethod;
//     }
//     // Compute/lock final total
//     const finalTotal = Number(d.finalTotal ?? computeFinalTotal(d));
//     if (!(finalTotal > 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "Booking amount not set. Finalize quote first.",
//       });
//     }

//     // Idempotency by providerRef
//     if (providerRef) {
//       booking.payments = booking.payments || [];
//       const already = booking.payments.some(
//         (p) => p.providerRef === providerRef
//       );
//       if (already) {
//         return res.status(200).json({
//           success: true,
//           message: "Payment already recorded (idempotent).",
//           bookingId: booking._id,
//         });
//       }
//     }

//     const currentPaid = Number(d.paidAmount || 0);
//     const remaining = Math.max(0, finalTotal - currentPaid);
//     if (amount > remaining) {
//       return res.status(400).json({
//         success: false,
//         message: "Paid amount cannot exceed remaining balance",
//       });
//     }

//     // Apply payment
//     d.paymentMethod = String(paymentMethod);
//     d.paidAmount = currentPaid + amount;

//     // Deactivate any active link
//     if (d.paymentLink?.isActive) d.paymentLink.isActive = false;

//     // Track payment line-item (optional)
//     booking.payments = booking.payments || [];
//     booking.payments.push({
//       at: new Date(),
//       method: d.paymentMethod,
//       amount,
//       providerRef: providerRef || undefined,
//     });

//     // Milestone: set/complete first 40% baseline (bookingAmount)
//     ensureFirstMilestone(d);
//     if (
//       !d.firstMilestone.completedAt &&
//       d.paidAmount >= Number(d.firstMilestone.requiredAmount || 0)
//     ) {
//       d.firstMilestone.completedAt = new Date();
//     }

//     // Derived fields + statuses
//     syncDerivedFields(d, finalTotal);

//     const fullyPaid = d.paidAmount >= finalTotal;
//     if (fullyPaid) {
//       d.paymentStatus = "Paid";

//       // Move to completed if was ongoing or waiting
//       if (
//         ["Waiting for final payment", "Project Ongoing"].includes(
//           String(d.status)
//         )
//       ) {
//         d.status = "Project Completed";
//         const now = new Date();
//         if (booking.assignedProfessional) {
//           booking.assignedProfessional.completedDate = now;
//           booking.assignedProfessional.completedTime = moment().format("LT");
//         }
//         d.jobEndedAt = now;
//       }

//       // Hiring coherence
//       if (booking.assignedProfessional?.hiring) {
//         booking.assignedProfessional.hiring.status = "active";
//         if (!booking.assignedProfessional.hiring.hiredDate) {
//           booking.assignedProfessional.hiring.hiredDate = new Date();
//           booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
//         }
//       }
//     } else {
//       // Partial payment thresholds
//       const ratio = d.paidAmount / finalTotal;
//       d.paymentStatus =
//         ratio >= 0.799 ? "Partially Completed" : "Partial Payment";

//       // Promote Pending → Hired on first payment
//       const statusNorm = (d.status || "").trim().toLowerCase();
//       if (["pending hiring", "pending"].includes(statusNorm)) {
//         d.status = "Hired";
//       }

//       // Hiring coherence
//       if (booking.assignedProfessional?.hiring) {
//         booking.assignedProfessional.hiring.status = "active";
//         if (!booking.assignedProfessional.hiring.hiredDate) {
//           booking.assignedProfessional.hiring.hiredDate = new Date();
//           booking.assignedProfessional.hiring.hiredTime = moment().format("LT");
//         }
//       }
//     }

//     await booking.save();

//     return res.json({
//       success: true,
//       message: fullyPaid
//         ? "Final payment completed. Job marked as ended."
//         : "Payment received.",
//       bookingId: booking._id,
//       finalTotal,
//       totalPaid: d.paidAmount,
//       remainingAmount: d.amountYetToPay,
//       status: d.status,
//       paymentStatus: d.paymentStatus,
//       // firstMilestone: d.firstMilestone, // helpful for UI
//     });
//   } catch (err) {
//     console.error("makePayment error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error while processing payment",
//       error: err.message,
//     });
//   }
// };
