const crypto = require("crypto");
const mongoose = require("mongoose");
const userBookings = require("../models/user/userBookings");
const { getRazorpayClient } = require("./razorpay.client");

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function assertObjectId(id, name = "id") {
    try {
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            throw new Error(`Valid ${name} (Mongo ObjectId) is required`);
        }
        return true;
    } catch (e) {
        throw e;
    }
}

function hmacSignature(orderId, paymentId, secret) {
    const body = `${orderId}|${paymentId}`;
    return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function normalizePurpose({ purpose, booking }) {
    try {
        if (purpose) return purpose;
        const p = booking?.bookingDetails?.paymentLink?.purpose;
        return p || null;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------
// Create Razorpay Order for booking
// ---------------------------------------------------------
exports.createRazorpayOrderForBooking = async ({ bookingId, purpose }) => {
    try {
        assertObjectId(bookingId, "bookingId");
        if (!purpose) throw new Error("purpose is required");

        const booking = await userBookings.findById(bookingId).lean();
        if (!booking) throw new Error("Booking not found");

        // decide amount based on purpose
        let amount = 0;
        if (purpose === "dc_first") {
            amount = Number(booking?.bookingDetails?.firstPayment?.requestedAmount || 0);
            if (amount <= 0) {
                // fallback: use 20% from originalTotalAmount
                const orig = Number(booking?.bookingDetails?.originalTotalAmount || 0);
                amount = Math.round(orig * 0.2);
            }
        } else if (purpose === "site_visit") {
            amount = Number(booking?.bookingDetails?.siteVisitCharges || 0);
        } else {
            throw new Error("Invalid purpose");
        }

        let razorpay;
        try {
            razorpay = getRazorpayClient();
        } catch (e) {
            console.error(e.message);
            throw e;
        }

        if (amount <= 0) throw new Error("Amount must be > 0 for Razorpay order");

        const shortId = String(bookingId).slice(-6);          // last 6 chars
        const ts = String(Date.now()).slice(-6);              // last 6 digits
        const p = purpose === "dc_first" ? "D1" : "SV";       // 2 chars
        const receipt = `HJ${p}${shortId}${ts}`;

        // Razorpay expects amount in paise
        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100),
            currency: "INR",
            receipt: receipt,
            notes: {
                bookingId: String(bookingId),
                purpose,
            },
        });

        // return what frontend needs
        return {
            keyId: process.env.RAZORPAY_KEY_ID,
            orderId: order.id,
            amount, // in rupees
            currency: order.currency,
            purpose,
        };
    } catch (e) {
        throw e;
    }
};

// ---------------------------------------------------------
// Verify and record payment (MOST IMPORTANT)
// ---------------------------------------------------------
exports.verifyAndRecordBookingPayment = async ({
    bookingId,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    purpose, // optional
}) => {
    const session = await mongoose.startSession();

    try {
        assertObjectId(bookingId, "bookingId");

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            throw new Error("Missing Razorpay fields for verification");
        }

        // 1) Verify signature
        const expected = hmacSignature(
            razorpay_order_id,
            razorpay_payment_id,
            process.env.RAZORPAY_KEY_SECRET
        );

        if (expected !== razorpay_signature) {
            throw new Error("Invalid Razorpay signature");
        }

        let out = { alreadyRecorded: false, booking: null };

        await session.withTransaction(async () => {
            // 2) Load booking FOR UPDATE
            const booking = await userBookings.findById(bookingId).session(session);
            if (!booking) throw new Error("Booking not found");

            const effectivePurpose = normalizePurpose({ purpose, booking });

            // 3) Idempotency: if this payment already recorded, return early
            const existing = (booking.payments || []).some(
                (p) =>
                    String(p.providerRef || "") === String(razorpay_payment_id) ||
                    String(p.providerRef || "") === String(razorpay_order_id)
            );

            if (existing) {
                out.alreadyRecorded = true;
                out.booking = booking.toObject();
                return;
            }

            // 4) Decide amount to record
            let paidNow = 0;

            if (effectivePurpose === "site_visit") {
                paidNow = Number(booking?.bookingDetails?.siteVisitCharges || 0);
            } else if (effectivePurpose === "dc_first") {
                // record the requested installment amount
                paidNow = Number(booking?.bookingDetails?.firstPayment?.requestedAmount || 0);
                if (paidNow <= 0) {
                    const orig = Number(booking?.bookingDetails?.originalTotalAmount || 0);
                    paidNow = Math.round(orig * 0.2);
                }
            } else {
                // if purpose is missing, still try to infer using paymentLink
                const p2 = booking?.bookingDetails?.paymentLink?.purpose;
                if (p2 === "site_visit") {
                    paidNow = Number(booking?.bookingDetails?.siteVisitCharges || 0);
                } else if (p2 === "dc_first") {
                    paidNow = Number(booking?.bookingDetails?.firstPayment?.requestedAmount || 0);
                }
            }

            if (paidNow <= 0) {
                throw new Error("Could not derive paid amount for this payment");
            }

            // 5) Push payment record
            booking.payments = booking.payments || [];
            booking.payments.push({
                at: new Date(),
                method: "UPI",
                amount: paidNow,
                providerRef: razorpay_payment_id, // ✅ use payment_id as idempotency key
                purpose: effectivePurpose || booking?.bookingDetails?.paymentLink?.purpose || "",
                installment: effectivePurpose === "dc_first" ? "first" : undefined,
            });

            // 6) Update totals
            const prevPaid = Number(booking.bookingDetails.paidAmount || 0);
            booking.bookingDetails.paidAmount = prevPaid + paidNow;

            // amountYetToPay for deep_cleaning
            const origTotal = Number(booking.bookingDetails.originalTotalAmount || 0);
            if (origTotal > 0) {
                booking.bookingDetails.amountYetToPay = Math.max(
                    0,
                    origTotal - Number(booking.bookingDetails.paidAmount || 0)
                );
            }

            // 7) Update milestones based on purpose
            if (effectivePurpose === "dc_first") {
                // firstPayment -> paid
                booking.bookingDetails.firstPayment = booking.bookingDetails.firstPayment || {};
                booking.bookingDetails.firstPayment.status = "paid";
                booking.bookingDetails.firstPayment.amount = paidNow;
                booking.bookingDetails.firstPayment.paidAt = new Date();
                booking.bookingDetails.firstPayment.method = "UPI";
                booking.bookingDetails.firstPayment.remaining = 0;

                booking.bookingDetails.paymentStatus = "Partial Payment";
                // optional: mark hired if your flow needs it
                // booking.bookingDetails.status = "Hired";
            }

            if (effectivePurpose === "site_visit") {
                // for house_painting site visit => you can treat as paid lead
                booking.bookingDetails.paymentStatus = "Paid";
                // optional: update status
                // booking.bookingDetails.status = "Confirmed";
            }

            // 8) Convert enquiry -> booking AFTER successful payment
            booking.isEnquiry = false;

            // 9) Deactivate payment link after success
            if (booking.bookingDetails.paymentLink) {
                booking.bookingDetails.paymentLink.isActive = false;
                booking.bookingDetails.paymentLink.razorpayOrderId = razorpay_order_id; // store if you want
                booking.bookingDetails.paymentLink.providerRef = razorpay_payment_id;   // store last
            }

            await booking.save({ session });

            out.booking = booking.toObject();
        });

        session.endSession();
        return out;
    } catch (e) {
        try {
            await session.abortTransaction();
        } catch (_) { }
        session.endSession();
        throw e;
    }
};