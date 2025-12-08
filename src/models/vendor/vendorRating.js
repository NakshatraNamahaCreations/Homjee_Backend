
const mongoose = require("mongoose");

const VendorRatingSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    rating: { type: Number, min: 1, max: 5, required: true },      // ⭐ 1–5
    feedback: { type: String, default: "" },        // only for 1–3 stars

    isLocked: { type: Boolean, default: false },    // ❗ prevents re-editing

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("VendorRating", VendorRatingSchema);