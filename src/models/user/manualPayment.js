const mongoose = require("mongoose");

const ManualPaymentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    service: {
      type: String,
      required: true,
    },

    city: {
      type: String,
      required: true,
    },

    context: {
      type: String,
      default: "others",
    },

    payment: {
      status: {
        type: String,
        enum: ["Pending", "Paid", "Failed"],
        default: "Pending",
      },
      url: {
        // <-- updated
        type: String,
        default: "",
      },
      isActive: {
        // <-- updated
        type: Boolean,
        default: true,
      },
      providerRef: {
        // <-- new field
        type: String,
        default: "",
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ManualPayment", ManualPaymentSchema);
