// controllers/reminderController.js
const mongoose = require("mongoose");
const Reminder = require("../../models/user/reminder");

// Combine a date string (YYYY-MM-DD) and a time string (HH:mm) into a Date,
// interpreting the input as Asia/Kolkata (IST, +05:30).
// All admins for this product are in India; treating the wall-clock input as
// IST avoids the old bug where the server (running in UTC) would apply its
// own TZ offset and drop the reminder 5h30 late.
// Returns null if either part is missing or malformed.
const IST_OFFSET_MINUTES = 5 * 60 + 30; // +05:30

const combineDateAndTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const [y, mo, day] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(timeStr).split(":").map(Number);
  if (![y, mo, day, hh, mm].every(Number.isFinite)) return null;

  // Build the UTC instant for that IST wall-clock: UTC = IST - 05:30
  const utcMs = Date.UTC(y, mo - 1, day, hh, mm, 0, 0) - IST_OFFSET_MINUTES * 60_000;
  const d = new Date(utcMs);
  return Number.isNaN(d.getTime()) ? null : d;
};

exports.createReminder = async (req, res) => {
  try {
    const {
      bookingId,
      reminderDate,
      reminderTime,
      reminderAt: reminderAtFromClient,
      adminId,
      note,
    } = req.body || {};

    if (!bookingId || !reminderDate || !reminderTime) {
      return res.status(400).json({
        success: false,
        message: "bookingId, reminderDate, and reminderTime are required",
      });
    }

    // Prefer the exact ISO instant from the client (admin's browser already
    // resolved "18:00" in their local TZ). Fall back to combining the
    // date+time strings as IST for older clients.
    let reminderAt = null;
    if (reminderAtFromClient) {
      const parsed = new Date(reminderAtFromClient);
      if (!Number.isNaN(parsed.getTime())) reminderAt = parsed;
    }
    if (!reminderAt) {
      reminderAt = combineDateAndTime(reminderDate, reminderTime);
    }
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

// Lightweight map of pending/sent reminders keyed by bookingId. Used by the
// Enquiries list page to highlight rows with an active reminder.
//
// Returns reminders regardless of whether their scheduled moment has arrived,
// so admins see the "Reminder" badge immediately after setting one. The entry
// remains visible through the cron firing (status: "sent") and disappears only
// when the admin dismisses it (status: "cancelled").
exports.getPendingReminderMap = async (req, res) => {
  try {
    const reminders = await Reminder.find({
      status: { $in: ["pending", "sent"] },
      reminderAt: { $ne: null },
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
