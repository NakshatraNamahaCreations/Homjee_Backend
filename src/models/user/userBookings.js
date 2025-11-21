const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  customerId: String,
  name: String,
  phone: String,
});
const serviceSchema = new mongoose.Schema({
  // serviceId: String,
  category: String,
  subCategory: String,
  serviceName: String,
  price: Number,
  quantity: Number,
  teamMembersRequired: Number,
});
const PriceChangeSchema = new mongoose.Schema(
  {
    adjustmentAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    proposedTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      // required: true, // enable it when production
      // trim: true,
    },
    scopeType: {
      type: String,
      trim: true, // e.g., "Add Room", "Upgrade Paint", etc.
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    requestedBy: {
      type: String,
      enum: ["admin", "vendor", "customer"],
      required: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },

    // Approval
    approvedBy: {
      type: String,
      enum: ["admin", "customer"],
    },
    approvedAt: Date,

    // Rejection
    rejectedBy: {
      type: String,
      enum: ["admin", "customer"],
    },
    rejectedAt: Date,
  },
  { _id: false }
);

const PaymentMilestoneSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "paid", "failed","No Payment"],
      default: "pending",
    },
    amount: {
      type: Number,
      default: 0,
    },
    paidAt: Date,
    method: {
      type: String,
      enum: ["None", "Cash", "Card", "UPI", "Wallet"],
      default: "None"
    },

  },
  { _id: false }
);

const bookingDetailsSchema = new mongoose.Schema(
  {
    bookingDate: Date,
    bookingTime: String,
    booking_id: String,
    status: {
      type: String,
      enum: [
        "Pending",
        "Confirmed", //accepted or responded
        "Job Ongoing", // started - deep cleaning
        "Survey Ongoing", //started - house painting
        "Survey Completed", //ended - house painting
        "Job Completed", //ended - deep cleaning
        "Customer Cancelled",
        "Customer Unreachable",
        "Admin Cancelled",
        "Pending Hiring", // mark hiring
        "Hired", // first payment done
        "Project Ongoing", // project started house painting
        "Waiting for final payment",
        "Project Completed", // project completed
        "Negotiation",
        "Set Remainder",
      ],
      default: "Pending",
    },
    isJobStarted: { type: Boolean, default: false },

    // 🔁 Price Change Tracking
    priceChanges: {
      type: [PriceChangeSchema],
      default: [],
    },
    hasPriceUpdated: { type: Boolean, default: false },

    // 💰 Core Amounts (never change original)
    originalTotalAmount: {
      type: Number,
      required: true,
    },
    finalTotal: {
      type: Number,
      required: true, // will be set to originalTotalAmount initially
    },

    // 💳 Installment Tracking (clear & explicit)
    firstPayment: {
      type: PaymentMilestoneSchema,
      default: () => ({}),
    },
    secondPayment: {
      type: PaymentMilestoneSchema,
      default: () => ({}),
    },
    finalPayment: {
      type: PaymentMilestoneSchema,
      default: () => ({}),
    },

    // 🧾 Legacy / Derived Fields (optional for compatibility)
    paidAmount: { type: Number, default: 0 }, // total paid so far
    amountYetToPay: { type: Number, default: 0 },
    bookingAmount: Number, // initial payment from website

    // 💳 Payment method (last used)
    paymentMethod: {
      type: String,
      enum: ["Cash", "Card", "UPI", "Wallet","None"],
      
    },

    // 🔗 Payment Link
    paymentLink: {
      url: String,
      isActive: { type: Boolean, default: true },
      providerRef: String,
    },
    paymentStatus: {
      type: String,
      enum: [
        "Paid",
        "Unpaid",
        "Refunded",
        "Partial Payment", // second installment sending
        "Partially Completed", // second installment done, job ongoing
        "Waiting for final payment", // job end, waiting for final payment
      ],
      default: "Unpaid",
    },

    // 📅 Project Timing
    startProject: { type: Boolean, default: false },
    projectStartDate: Date,
    startProjectRequestedAt: Date,
    startProjectApprovedAt: Date,
    jobEndRequestedAt: Date,
    jobEndedAt: Date,

    // 🔐 OTP for starting project
    startProjectOtp: String, // hashed
    startProjectOtpExpiry: Date,

    // 📝 Other
    siteVisitCharges: Number,
    otp: Number,
  },
  {
    _id: false, // if embedded in UserBooking
  }
);

const invitedVendorSchema = new mongoose.Schema({
  professionalId: String,
  invitedAt: Date,
  respondedAt: Date,
  cancelledAt: Date,
  cancelledBy: {
    type: String,
    enum: ["internal", "external"], // internal = vendor (app), external = customer/admin (website)
    // default: "external", // safer default
  },
  responseStatus: {
    type: String,
    enum: [
      "pending",
      "accepted",
      "declined",
      "started",
      "completed",
      "customer_cancelled",
      // "vendor_cancelled",
      "unreachable",
      "pending_hiring",
      "mark_hiring",
    ],
    default: "pending",
  },
});

const selectedTeam = new mongoose.Schema(
  {
    memberId: String,
    memberName: String,
  },
  { _id: false }
);

const assignedProfessionalSchema = new mongoose.Schema({
  professionalId: String,
  name: String,
  phone: String,
  acceptedDate: Date,
  acceptedTime: String,
  startedDate: Date,
  startedTime: String,
  endedDate: Date,
  endedTime: String,
  completedDate: Date,
  completedTime: String,
  completedDate: Date,
  completedTime: String,
  hiring: {
    markedDate: Date,
    markedTime: String,
    hiredDate: Date,
    hiredTime: String,
    teamMember: [selectedTeam],
    projectDate: Array,
    noOfDay: Number,
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: "Quote" },
    status: { type: String, enum: ["active", "cancelled"], default: "active" },
    cancelledAt: Date,
    cancelReason: String, // NEW ("auto-unpaid" | "admin-cancel" | "vendor-cancel")
    autoCancelAt: Date,
  },
});
const selectedSlot = new mongoose.Schema({
  slotTime: String,
  slotDate: String,
});
const userBookingSchema = new mongoose.Schema({
  customer: customerSchema,
  service: [serviceSchema],
  bookingDetails: bookingDetailsSchema,
  assignedProfessional: assignedProfessionalSchema,
  address: {
    houseFlatNumber: String,
    streetArea: String,
    landMark: String,
    city: String,
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
  },
  payments: [
    {
      at: { type: Date, default: Date.now },
      method: { type: String, enum: ["Cash", "Card", "UPI", "Wallet"] },
      amount: { type: Number, required: true },
      providerRef: String,
      installment: { type: String, enum: ["first", "second", "final"] }, // helpful for reporting
    },
  ],
  serviceType: {
    type: String,
    enum: ["deep_cleaning", "house_painting"],
    required: true,
  },
  selectedSlot: selectedSlot,
  isEnquiry: Boolean,
  isRead: { type: Boolean, default: false },//New Field
  isDismmised: { type: Boolean, default: false },//New Field
  invitedVendors: [invitedVendorSchema],
  formName: { type: String, required: true }, // Add formName
  createdDate: { type: Date, default: Date.now },
});

userBookingSchema.index({ "address.location": "2dsphere" });

module.exports = mongoose.model("UserBookings", userBookingSchema);
