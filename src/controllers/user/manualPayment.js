const ManualPayment = require("../../models/user/manualPayment.js");
const { sendWhatsAppTemplate } = require("../../helpers/finbiteWhatsapp");

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

exports.markManualPaymentPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { method, providerRef } = req.body; // 👈 from payload

    const payment = await ManualPayment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Manual payment record not found.",
      });
    }

    // Update payment details
    payment.payment.status = "Paid";
    payment.payment.method = method ;
    payment.payment.providerRef = providerRef ;
    payment.payment.isActive = false;
    payment.payment.paidAt = new Date();

    await payment.save();
  
    res.status(200).json({
      success: true,
      message: "Payment marked as Paid successfully.",
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
