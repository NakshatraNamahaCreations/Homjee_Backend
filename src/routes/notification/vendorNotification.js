const express = require("express");
const router = express.Router();
const vendorNotification = require("../../models/notification/vendorNotification");

router.get("/fetch-vendor-notifications/:vendorId", async (req, res) => {
    try {
        const { vendorId } = req.params;

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        if (!vendorId) {
            return res.status(400).json({ success: false, message: "vendorId is required" });
        }

        const baseFilter = { vendorId };

        const [notifications, unreadCount, total] = await Promise.all([
            vendorNotification
                .find(baseFilter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            vendorNotification.countDocuments({ ...baseFilter, isRead: false }),

            vendorNotification.countDocuments(baseFilter),
        ]);

        return res.status(200).json({
            success: true,
            data: notifications,
            unreadCount,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Error fetching vendor notifications:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});


router.post("/mark-notification-read/:notificationId", async (req, res) => {
    try {
        const { notificationId } = req.params;

        const updatedNotification = await vendorNotification.findOneAndUpdate(
            { _id: notificationId },
            { $set: { status: "read" } },
            { new: true }
        ).lean();

        if (!updatedNotification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        res.status(200).json({
            message: "Notification marked as read",
            notification: updatedNotification,
        });
    } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;

