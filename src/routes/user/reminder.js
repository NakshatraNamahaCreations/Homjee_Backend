const express = require("express");
const router = express.Router();
const {
  createReminder,
  getPendingReminders,
  markReminderChecked,
  getReminderByBooking,
  cancelReminderByBooking,
  getPendingReminderMap,
} = require("../../controllers/user/reminder");

router.post("/create", createReminder);
router.get("/pending-reminder", getPendingReminders);
router.patch("/:id/check", markReminderChecked);

// Bulk lookup: { bookingId: reminder } for all pending reminders
router.get("/pending-map", getPendingReminderMap);

// Fetch / cancel the pending reminder for a specific booking
router.get("/by-booking/:bookingId", getReminderByBooking);
router.delete("/by-booking/:bookingId", cancelReminderByBooking);

module.exports = router;
