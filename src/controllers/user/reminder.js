// controllers/reminderController.js
const Reminder = require("../../models/user/reminder");

exports.createReminder = async (req, res) => {
  try {
    const { bookingId, reminderDate, reminderTime } = req.body;

    if (!bookingId || !reminderDate || !reminderTime) {
      return res.status(400).json({
        success: false,
        message: "bookingId, reminderDate, and reminderTime are required",
      });
    }

    const reminder = await Reminder.create({
      bookingId,
      reminderDate,
      reminderTime,
    });

    res.json({
      success: true,
      message: "Reminder created successfully",
      reminder,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getPendingReminders = async (req, res) => {
  try {
    const reminders = await Reminder.find({ isChecked: false })
      .sort({ reminderDate: 1 })
      .populate({
        path: "bookingId",
        select: "customer selectedSlot serviceType address.streetArea",
      });

    res.json({
      success: true,
      reminders,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



exports.markReminderChecked = async (req, res) => {
  try {
    const { id } = req.params;

    const reminder = await Reminder.findByIdAndUpdate(
      id,
      { isChecked: true },
      { new: true }
    );

    if (!reminder) {
      return res.status(404).json({ success: false, message: "Reminder not found" });
    }

    res.json({
      success: true,
      message: "Reminder marked as checked",
      reminder,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
