// controllers/reminderController.js
const mongoose = require("mongoose");
const Reminder = require("../../models/user/reminder");

// Combine a date string (YYYY-MM-DD) and a time string (HH:mm) into a Date.
// Returns null if either part is missing or malformed.
const combineDateAndTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const [hh, mm] = String(timeStr).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  d.setHours(hh, mm, 0, 0);
  return d;
};

exports.createReminder = async (req, res) => {
  try {
    const { bookingId, reminderDate, reminderTime, adminId, note } =
      req.body || {};

    if (!bookingId || !reminderDate || !reminderTime) {
      return res.status(400).json({
        success: false,
        message: "bookingId, reminderDate, and reminderTime are required",
      });
    }

    const reminderAt = combineDateAndTime(reminderDate, reminderTime);
    if (!reminderAt) {
      return res.status(400).json({
        success: false,
        message: "Invalid reminderDate or reminderTime",
      });
    }

    // 🔒 Must be in the future
    if (reminderAt.getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Reminder date and time must be in the future",
      });
    }

    // Upsert: if a pending reminder for this booking already exists, replace
    // its schedule rather than stacking duplicates.
    const existing = await Reminder.findOne({
      bookingId,
      status: "pending",
    });

    let reminder;
    if (existing) {
      existing.reminderDate = reminderAt;
      existing.reminderTime = reminderTime;
      existing.reminderAt = reminderAt;
      existing.note = note || existing.note;
      existing.isChecked = false;
      if (adminId && mongoose.Types.ObjectId.isValid(adminId)) {
        existing.adminId = adminId;
      }
      reminder = await existing.save();
    } else {
      reminder = await Reminder.create({
        bookingId,
        reminderDate: reminderAt,
        reminderTime,
        reminderAt,
        adminId:
          adminId && mongoose.Types.ObjectId.isValid(adminId)
            ? adminId
            : undefined,
        note: note || undefined,
        status: "pending",
      });
    }

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

// Lightweight map of DUE reminders keyed by bookingId. Used by the
// Enquiries list page to highlight rows.
//
// A reminder is returned only when its scheduled moment has arrived — i.e.
// reminderAt <= now — so the list stays clean until the exact set time. After
// the cron fires (status flips to "sent") the entry remains visible until the
// admin dismisses it (status: cancelled).
exports.getPendingReminderMap = async (req, res) => {
  try {
    const now = new Date();

    const reminders = await Reminder.find({
      status: { $in: ["pending", "sent"] },
      reminderAt: { $ne: null, $lte: now },
    })
      .select("bookingId reminderAt reminderDate reminderTime note status")
      .lean();

    const map = {};
    for (const r of reminders) {
      if (!r.bookingId) continue;
      map[String(r.bookingId)] = {
        _id: String(r._id),
        reminderAt: r.reminderAt || null,
        reminderDate: r.reminderDate || null,
        reminderTime: r.reminderTime || null,
        note: r.note || null,
        status: r.status || "pending",
      };
    }

    res.json({ success: true, reminders: map, count: reminders.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get the pending reminder (if any) for a specific booking, so the UI can
// display "Reminder set for ..." on the enquiry/lead detail page.
exports.getReminderByBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid bookingId" });
    }

    const reminder = await Reminder.findOne({
      bookingId,
      status: "pending",
    }).sort({ reminderAt: 1 });

    res.json({ success: true, reminder: reminder || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Allow an admin to cancel/remove a pending reminder for a booking.
exports.cancelReminderByBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid bookingId" });
    }

    const updated = await Reminder.findOneAndUpdate(
      { bookingId, status: { $in: ["pending", "sent"] } },
      { $set: { status: "cancelled", isChecked: true } },
      { new: true }
    );

    res.json({ success: true, reminder: updated || null });
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
