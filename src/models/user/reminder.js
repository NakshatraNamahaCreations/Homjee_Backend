const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserBookings",
      required: true,
      index: true,
    },

    reminderDate: {
      type: Date,
      required: true,
      index: true,
    },

    reminderTime: {
      type: String,
      required: true,
    },

    isChecked: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
  }
);

// Optimized for fast reminder checks
reminderSchema.index({ reminderDate: 1, isChecked: 1 });

module.exports = mongoose.model("Reminder", reminderSchema);
