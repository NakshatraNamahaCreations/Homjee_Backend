const Razorpay = require("razorpay");

function getRazorpayClient() {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
        throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing in env");
    }

    return new Razorpay({ key_id, key_secret });
}

module.exports = { getRazorpayClient };