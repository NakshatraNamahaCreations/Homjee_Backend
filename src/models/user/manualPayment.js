// const mongoose = require("mongoose");

// const ManualPaymentSchema = new mongoose.Schema(
//   {
//     type: {
//       type: String,
//       required: true,
//     },

//     name: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     phone: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     amount: {
//       type: Number,
//       required: true,
//     },

//     service: {
//       type: String,
//       required: true,
//     },

//     city: {
//       type: String,
//       required: true,
//     },

//     context: {
//       type: String,
//       default: "others",
//     },

//     payment: {
//       status: {
//         type: String,
//         enum: ["Pending", "Paid", "Failed"],
//         default: "Pending",
//       },
//       url: {
//         // <-- updated
//         type: String,
//         default: "",
//       },
//       isActive: {
//         // <-- updated
//         type: Boolean,
//         default: true,
//       },
//       providerRef: {
//         // <-- new field
//         type: String,
//         default: "",
//       },
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// module.exports = mongoose.model("ManualPayment", ManualPaymentSchema);


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

      method: {
        // ✅ payment method
        type: String,
        enum: [
          "Cash",
          "Bank Transfer",
          "UPI",
          "Card",
          "Other",
        ],
        default: "UPI",
      },

      url: {
        type: String,
        default: "",
      },

      isActive: {
        type: Boolean,
        default: true,
      },

      providerRef: {
        type: String,
        default: "",
      },

      paidAt: {
        // optional but very useful
        type: Date,
      },
    },
  },
  {
    timestamps: true,
  }
);
// ManualPaymentSchema
ManualPaymentSchema.index({ type: 1, context: 1, "payment.status": 1, createdAt: 1 });

module.exports = mongoose.model("ManualPayment", ManualPaymentSchema);
