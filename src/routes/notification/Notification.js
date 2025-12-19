const notificationSchema = require("../../models/notification/Notification");
const express = require('express');
const router = express.Router();

router.post('/fetch-all-notifications/admin', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const skip = (page - 1) * limit;

        const [notifications, total] = await Promise.all([
            notificationSchema
                .find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            notificationSchema.countDocuments()
        ]);

        res.json({
            data: notifications,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/mark-read/:notificationId", async (req, res) => {
    try {
        const { notificationId } = req.params; // Get notification ID from URL params

        // Find the notification by its ID
        const notification = await notificationSchema.findOne({
            _id: notificationId,
        });
        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        // Update the status to 'read'
        notification.status = "read";
        await notification.save();

        // Send the updated notification as a response
        res.status(200).json({
            message: "Notification marked as read successfully",
            notification,
        });
    } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;
