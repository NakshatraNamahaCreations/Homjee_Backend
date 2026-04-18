const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserBookings",
      required: true,
      index: true,
    },

    // Kept for backwards compatibility with older records / AllReminders UI
    reminderDate: {
      type: Date,
      required: true,
      index: true,
    },
    reminderTime: {
      type: String,
      required: true,
    },

    // Precise moment the reminder should fire (UTC). Cron uses this.
    reminderAt: {
      type: Date,
      index: true,
    },

    // Who set the reminder (admin), so cron knows who to notify.
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "admin",
    },

    // Optional note entered by the admin
    note: { type: String },

    // Pending → Sent | Cancelled. Replaces isChecked as the authoritative state.
    status: {
      type: String,
      enum: ["pending", "sent", "cancelled"],
      default: "pending",
      index: true,
    },
    sentAt: { type: Date },

    // Kept for backwards compatibility with AllReminders page
    isChecked: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Optimized for fast reminder checks
reminderSchema.index({ reminderDate: 1, isChecked: 1 });
// Cron-friendly lookup
reminderSchema.index({ status: 1, reminderAt: 1 });

// Auto-derive reminderAt from date+time if the caller didn't supply it.
reminderSchema.pre("validate", function (next) {
  try {
    if (!this.reminderAt && this.reminderDate && this.reminderTime) {
      const base = new Date(this.reminderDate);
      const [hh, mm] = String(this.reminderTime).split(":").map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        base.setHours(hh, mm, 0, 0);
        this.reminderAt = base;
      }
    }
  } catch (e) {
    // leave reminderAt untouched
  }
  next();
});

module.exports = mongoose.model("Reminder", reminderSchema);
