const ManualPayment = require("../../models/user/manualPayment.js");
const { sendWhatsAppTemplate } = require("../../helpers/finbiteWhatsapp");
const { getRazorpayClient } = require("../../payments/razorpay.client");
const { verifyRazorpaySignature } = require("../../payments/razorpay.util");

// #6d/#7d: a manual / buy-coins payment link is valid for 24h from creation.
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const isLinkExpired = (doc) => {
  if (!doc) return true;
  if (doc.payment?.status === "Failed") return true;
  if (doc.payment?.isActive === false) return true;
  const ageMs = Date.now() - new Date(doc.createdAt).getTime();
  return Number.isFinite(ageMs) && ageMs > LINK_TTL_MS;
};

// #11 — Finbite template for the "Create Payment Link" WhatsApp. It shows the
// "Homjee has requested a payment" text and a Pay Now URL button whose base URL
// is the site root; the dynamic suffix is the payment-page path.
// NOTE: confirm this matches the APPROVED template name/params on Finbite.
const MANUAL_PAYMENT_TEMPLATE = "payment_link_request";

// const redirectionUrl = "http://localhost:5173/checkout/payment";
// Hardcoded to the final production site (same page the main booking flow uses)
// so a stale USER_PAYMENT env value can't point customers at an old domain.
const redirectionUrl = "https://homjee-website.netlify.app/checkout/payment";

exports.createManualPayment = async (req, res) => {
  try {
    const { type, name, phone, amount, service, city, context } = req.body;

    if (!type || !name || !phone || !amount || !service || !city) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields.",
      });
    }

    // 1️⃣ Step 1 — Create document WITHOUT URL
    let manualPayment = await ManualPayment.create({
      type,
      name,
      phone,
      amount: Number(amount),
      service,
      city,
      context: type === "vendor" ? context : "others",
      payment: {
        status: "Pending",
        url: "", // temporary empty
        isActive: true,
        providerRef: "", // future payment gateway ref
      },
    });

    const bookingId = manualPayment._id;
    const pay_type = "manual-pay";
    const paymentLinkUrl = `${redirectionUrl}/${bookingId}/${Date.now()}/${pay_type}`;

    // 3️⃣ Step 3 — Update the record with generated URL
    manualPayment.payment.url = paymentLinkUrl;
    manualPayment.payment.providerRef = `razorpay_${bookingId}`;

    await manualPayment.save();

    // #11 — send the payment link to the customer over WhatsApp with a Pay Now
    // button that opens the payment page. The template's URL button base is the
    // site root, so the dynamic suffix is the path after the domain.
    // Best-effort: never block link creation on a WhatsApp hiccup.
    try {
      if (phone) {
        const payPath = paymentLinkUrl.replace(/^https?:\/\/[^/]+\//, "");
        await sendWhatsAppTemplate(phone, MANUAL_PAYMENT_TEMPLATE, {
          bodyParams: [name || "there", String(Number(amount))],
          buttons: [{ type: "button", sub_type: "url", text: payPath }],
        });
      }
    } catch (e) {
      console.error("[createManualPayment] WA payment link failed:", e?.message);
    }

    return res.status(201).json({
      success: true,
      message: "Manual payment created successfully.",
      data: manualPayment,
    });
  } catch (error) {
    console.error("Error creating manual payment:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// #5c/#7d — STEP 1: create a Razorpay order for a manual / buy-coins payment
// link. The customer opens the WhatsApp link, this creates the order, and the
// Razorpay checkout modal collects real money. (Previously the "Pay Now" button
// on the website just marked the record paid without charging anything, so no
// real payment id was ever captured and nothing reached the paid list.)
exports.createManualPaymentOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await ManualPayment.findById(id);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Manual payment record not found." });
    }
    if (doc.payment?.status === "Paid") {
      return res
        .status(400)
        .json({ success: false, message: "This payment has already been paid." });
    }
    // #6d/#7d — reject expired links so money can't be collected on a dead link.
    if (isLinkExpired(doc)) {
      return res.status(410).json({
        success: false,
        message: "This payment link has expired. Please request a new one.",
      });
    }
    const amount = Number(doc.amount || 0);
    if (!(amount > 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment amount." });
    }

    const rzp = getRazorpayClient();
    let order;
    try {
      order = await rzp.orders.create({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        receipt: `man_${String(id).slice(-12)}`,
        notes: {
          manualPaymentId: String(id),
          context: doc.context || "others",
        },
      });
    } catch (e) {
      console.error("[createManualPaymentOrder] rzp order failed:", e?.error || e);
      return res.status(400).json({
        success: false,
        message: "Razorpay order creation failed",
        razorpay: e?.error || e?.message || "unknown_error",
      });
    }

    // Store the order id until the payment is verified (overwritten with the
    // real pay_ id on success). This also lets verify reject an order mismatch.
    doc.payment.providerRef = order.id;
    await doc.save();

    return res.status(200).json({
      success: true,
      action: "PAYMENT_ORDER_CREATED",
      razorpayOrder: {
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount, // rupees — payWithRazorpay converts to paise
        currency: "INR",
      },
    });
  } catch (error) {
    console.error("createManualPaymentOrder error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// #5c/#5a/#7d — STEP 2: verify the Razorpay signature and record the payment.
// Only a genuinely verified payment flips the record to "Paid" and stores the
// REAL razorpay payment id (pay_...) in providerRef, so it shows in the money
// dashboard paid list with the correct payment id (not the order id).
exports.markManualPaymentPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      method,
    } = req.body;

    const payment = await ManualPayment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Manual payment record not found.",
      });
    }

    // Idempotent: already paid is a success, not an error.
    if (payment.payment?.status === "Paid") {
      return res.status(200).json({
        success: true,
        message: "Payment already recorded.",
        data: payment,
      });
    }

    // #6d/#7d — do not accept payment on an expired link.
    if (isLinkExpired(payment)) {
      return res.status(410).json({
        success: false,
        message: "This payment link has expired. Please request a new one.",
      });
    }

    // Require a verifiable Razorpay payload (the old fake "mark paid" path is
    // removed — a link must be genuinely paid to be recorded).
    if (!(razorpay_order_id && razorpay_payment_id && razorpay_signature)) {
      return res.status(400).json({
        success: false,
        message: "Razorpay verification details are required.",
      });
    }

    const ok = verifyRazorpaySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Razorpay signature verification failed.",
      });
    }

    // If we created an order for this record, the paid order must match it.
    if (
      payment.payment?.providerRef &&
      payment.payment.providerRef.startsWith("order_") &&
      payment.payment.providerRef !== razorpay_order_id
    ) {
      return res.status(400).json({
        success: false,
        message: "Order mismatch for this payment link.",
      });
    }

    payment.payment.status = "Paid";
    payment.payment.method = method || "UPI";
    payment.payment.providerRef = razorpay_payment_id; // real pay_ id (#5a)
    payment.payment.isActive = false;
    payment.payment.paidAt = new Date();

    await payment.save();

    res.status(200).json({
      success: true,
      message: "Payment verified & recorded successfully.",
      data: payment,
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.getManualPayments = async (req, res) => {
  try {
    const { status } = req.query;

    const filter = {};
    if (status) {
      filter["payment.status"] = status === "pending" ? "Pending" : "Paid";
    }

    const list = await ManualPayment.find(filter).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: list,
    });
  } catch (err) {
    console.error("getManualPayments Err:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getManualPaymentById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID",
      });
    }

    const payment = await ManualPayment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Manual payment not found",
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error("Error fetching manual payment:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
