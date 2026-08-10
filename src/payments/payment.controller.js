const {
    createRazorpayOrderForBooking,
    verifyAndRecordBookingPayment,
} = require("./payment.service");
const { sendWhatsAppTemplate } = require("../helpers/finbiteWhatsapp");
const moment = require("moment");
const UserBooking = require("../models/user/userBookings");

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

        // WhatsApp payment confirmations (House Painting only, best-effort).
        // Which milestone just got paid decides the template:
        //   final  -> #26 hp_final_payment_confirmation
        //   second -> #21 hp_second_partial_confirmation
        //   first  -> #15 hp_booking_payment_confirmation
        try {
            const b = out?.booking;
            const d = b?.bookingDetails || {};
            const c = b?.customer || {};
            const isHP = b?.serviceType === "house_painting";
            const firstPaid = d?.firstPayment?.status === "paid";
            const secondPaid = d?.secondPayment?.status === "paid";
            const finalPaid = d?.finalPayment?.status === "paid";
            const rateBtn = [{ type: "button", sub_type: "url", text: String(b?._id) }];

            if (!out?.alreadyRecorded && isHP && c.phone) {
                if (finalPaid) {
                    // #26 — Rate Our Service dynamic-URL button.
                    await sendWhatsAppTemplate(c.phone, "hp_final_payment_confirmation", {
                        bodyParams: [c.name || "there"],
                        buttons: rateBtn,
                    });
                } else if (secondPaid) {
                    // #21 — Call PM dynamic-URL button.
                    await sendWhatsAppTemplate(c.phone, "hp_second_partial_confirmation", {
                        bodyParams: [c.name || "there", String(d?.secondPayment?.amount || 0)],
                        buttons: [{ type: "button", sub_type: "url", text: String(b._id) }],
                    });
                    // Stamp paidAt so the #22 deep-cleaning cross-sell cron can
                    // fire ~5 min later (service doesn't set this).
                    if (!d?.secondPayment?.paidAt) {
                        await UserBooking.updateOne(
                            { _id: b._id },
                            { $set: { "bookingDetails.secondPayment.paidAt": new Date() } },
                        );
                    }
                } else if (firstPaid) {
                    // #15 — Call PM button is static → no button param.
                    const slot = b?.selectedSlot?.slotDate
                        ? moment(b.selectedSlot.slotDate).format("DD MMM YYYY")
                        : "your start date";
                    await sendWhatsAppTemplate(c.phone, "hp_booking_payment_confirmation", {
                        bodyParams: [c.name || "there", String(d?.firstPayment?.amount || 0), slot],
                    });
                }
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