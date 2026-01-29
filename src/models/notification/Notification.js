const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      index: true, // optional but useful for booking-related queries
    },

    notificationType: {
      type: String,
      index: true,
    },

    thumbnailTitle: String,

    message: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["unread", "read"],
      default: "unread",
      index: true,
    },

    metaData: {
      type: Object,
      default: {},
    },

    notifyTo: {
      type: String,
      enum: ["admin", "customer", "vendor"],
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/* ------------------ INDEXES ------------------ */

// 🚀 Fast fetch for admin/vendor/customer notifications
notificationSchema.index({ notifyTo: 1, createdAt: -1 });

// 🚀 TTL index: auto-delete after 30 days
notificationSchema.index(
  { createdAt: 1 },
  { expires: 60 * 60 * 24 * 30 }
);

module.exports = mongoose.model("InAppNotification", notificationSchema);


// NEW_LEAD_CREATED - from website
// CUSTOMER_CANCEL_REQUESTED - from website
//  VENDOR_CANCEL_REQUESTED - from VA
// CANCEL_REQUEST_ACCEPTED
// PRICE_CHANGES_REQUEST - from VA