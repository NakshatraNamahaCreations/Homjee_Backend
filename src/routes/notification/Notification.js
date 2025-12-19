const express = require("express");
const router = express.Router();
const InAppNotification = require("../../models/notification/Notification");

/**
 * FETCH ADMIN NOTIFICATIONS (LOAD MORE)
 */
router.get("/fetch-admin-notifications", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 50);
    const skip = (page - 1) * limit;

    const baseFilter = { notifyTo: "admin" };
    const unreadFilter = { notifyTo: "admin", status: "unread" };

    const [notifications, total, unreadCount] = await Promise.all([
      InAppNotification.find(baseFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // 🚀 faster reads

      InAppNotification.countDocuments(baseFilter),

      InAppNotification.countDocuments(unreadFilter), // 🔥 unread badge count
    ]);

    res.status(200).json({
      data: notifications,
      unreadCount, // ✅ NEW
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: skip + notifications.length < total,
      },
    });
  } catch (error) {
    console.error("Error fetching admin notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
});


/**
 * MARK NOTIFICATION AS READ
 */
router.post("/mark-notification-read/:notificationId", async (req, res) => {
  try {
    const { notificationId } = req.params;

    const updatedNotification = await InAppNotification.findOneAndUpdate(
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


// const notificationSchema = require("../../models/notification/Notification");
// const express = require('express');
// const router = express.Router();

// router.post('/fetch-all-notifications/admin', async (req, res) => {
//     try {
//         const page = parseInt(req.query.page, 10) || 1;
//         const limit = parseInt(req.query.limit, 10) || 20;
//         const skip = (page - 1) * limit;

//         const [notifications, total] = await Promise.all([
//             notificationSchema
//                 .find()
//                 .sort({ createdAt: -1 })
//                 .skip(skip)
//                 .limit(limit),
//             notificationSchema.countDocuments()
//         ]);

//         res.json({
//             data: notifications,
//             page,
//             limit,
//             total,
//             totalPages: Math.ceil(total / limit),
//             hasNextPage: page * limit < total
//         });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Server error" });
//     }
// });

// router.post("/mark-read/:notificationId", async (req, res) => {
//     try {
//         const { notificationId } = req.params; // Get notification ID from URL params

//         // Find the notification by its ID
//         const notification = await notificationSchema.findOne({
//             _id: notificationId,
//         });
//         if (!notification) {
//             return res.status(404).json({ message: "Notification not found" });
//         }

//         // Update the status to 'read'
//         notification.status = "read";
//         await notification.save();

//         // Send the updated notification as a response
//         res.status(200).json({
//             message: "Notification marked as read successfully",
//             notification,
//         });
//     } catch (error) {
//         console.error("Error marking notification as read:", error);
//         res.status(500).json({ message: "Server error" });
//     }
// });


// module.exports = router;
