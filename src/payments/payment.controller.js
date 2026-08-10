const {
    createRazorpayOrderForBooking,
    verifyAndRecordBookingPayment,
} = require("./payment.service");
const { sendWhatsAppTemplate } = require("../helpers/finbiteWhatsapp");
const moment = require("moment");

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

        // WhatsApp #15 — booking (advance) payment confirmation. Best-effort.
        // Only for a fresh FIRST-installment payment: first paid, but second &
        // final not yet paid. {{1}} name, {{2}} booking amount, {{3}} start date.
        try {
            const b = out?.booking;
            const d = b?.bookingDetails || {};
            const firstPaid = d?.firstPayment?.status === "paid";
            const secondPaid = d?.secondPayment?.status === "paid";
            const finalPaid = d?.finalPayment?.status === "paid";
            const c = b?.customer || {};
            if (!out?.alreadyRecorded && firstPaid && !secondPaid && !finalPaid && c.phone) {
                const amt = d?.firstPayment?.amount || d?.firstPayment?.requestedAmount || 0;
                const slot = b?.selectedSlot?.slotDate
                    ? moment(b.selectedSlot.slotDate).format("DD MMM YYYY")
                    : "your start date";
                // #15's "Call Project Manager" button is static — no button param.
                await sendWhatsAppTemplate(c.phone, "hp_booking_payment_confirmation", {
                    bodyParams: [c.name || "there", String(amt), slot],
                });
            }
        } catch (e) {
            console.error("[verify] WA payment confirmation failed:", e?.message);
        }

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