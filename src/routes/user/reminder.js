const express = require("express");
const router = express.Router();
const {
  createReminder,
  getPendingReminders,
  markReminderChecked,
} = require("../../controllers/user/reminder");

router.post("/create", createReminder);
router.get("/pending-reminder", getPendingReminders);
router.patch("/:id/check", markReminderChecked);

module.exports = router;
