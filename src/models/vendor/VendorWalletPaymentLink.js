const mongoose = require("mongoose");

const vendorWalletPaymentLinkSchema = new mongoose.Schema(
    {
        vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "vendor", required: true, index: true },

        provider: { type: String, default: "razorpay" },
        providerRef: { type: String, required: true, unique: true }, // razorpay order_id (idempotency)

        receipt: { type: String },
        purpose: { type: String, default: "vendor_wallet_recharge" },

        coin: { type: Number, required: true },
        amount: { type: Number, required: true },
        gst18Perc: { type: Number, required: true },
        totalPaid: { type: Number, required: true },

        isActive: { type: Boolean, default: true },
        expiresAt: { type: Date, required: true },

        // optional for debugging
        createdAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

vendorWalletPaymentLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// ✅ auto delete doc after expiresAt

module.exports = mongoose.model("VendorWalletPaymentLink", vendorWalletPaymentLinkSchema);