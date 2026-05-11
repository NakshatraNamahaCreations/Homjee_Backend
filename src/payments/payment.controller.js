const {
    createRazorpayOrderForBooking,
    verifyAndRecordBookingPayment,
} = require("./payment.service");

exports.createOrder = async (req, res) => {
    try {
        const { bookingId, purpose } = req.body; // purpose: "dc_first" | "site_visit"
        const data = await createRazorpayOrderForBooking({ bookingId, purpose });
        return res.json({ success: true, data });
    } catch (err) {
        console.error("createOrder error:", err);
        return res.status(400).json({ success: false, message: err.message });
    }
};

exports.verify = async (req, res) => {
    try {
        const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const out = await verifyAndRecordBookingPayment({
            bookingId,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        });

        return res.json({
            success: true,
            message: out.alreadyRecorded ? "Already recorded" : "Payment success",
            booking: out.booking,
        });
    } catch (err) {
        console.error("verify error:", err);
        // Preserve 409 for slot-no-longer-available so the FE can show
        // the "pick another slot" UX instead of a generic failure.
        const status = err?.statusCode || 400;
        return res.status(status).json({ success: false, message: err.message });
    }
};