const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        bookingId: String,
        notificationType: String,
        thumbnailTitle: String,
        message: String,
        status: String,
        metaData: Object,
        notifyTo: {
            type: String,
            enum: ["admin", "customer", "vendor"]
        }
    },
    {
        timestamps: true,
    }

);
// TTL index: delete docs 30 days after createdAt
notificationSchema.index({ createdAt: 1 }, { expires: 60 * 60 * 24 * 30 });

module.exports = mongoose.model("InAppNotification", notificationSchema);

// NEW_LEAD_CREATED - from website
// CUSTOMER_CANCEL_REQUESTED - from website
//  VENDOR_CANCEL_REQUESTED - from VA
// CANCEL_REQUEST_ACCEPTED 