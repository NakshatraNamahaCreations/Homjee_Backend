const crypto = require("crypto");

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
    try {
        const expected = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(`${orderId}|${paymentId}`)
            .digest("hex");

        return expected === signature;
    } catch (err) {
        console.error("verifyRazorpaySignature error:", err);
        return false;
    }
}

module.exports = { verifyRazorpaySignature };