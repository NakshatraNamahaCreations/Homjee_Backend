const ManualPayment = require("../../models/user/manualPayment.js");

const redirectionUrl = "http://localhost:5173/checkout/payment";

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

    const payment = await ManualPayment.findById(id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Manual payment record not found.",
      });
    }

    payment.payment.status = "Paid";
    payment.payment.activeUrl = false;

    await payment.save();

    res.status(200).json({
      success: true,
      message: "Payment marked as Paid successfully.",
      data: payment,
    });
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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
