const mongoose = require("mongoose");

const vendorNotification = new mongoose.Schema(
    {
        vendorId: {
            type: String,
            index: true,
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
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("vendorNotification", vendorNotification);

