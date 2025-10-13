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
const FirstMilestoneSchema = new mongoose.Schema(
  {
    baseTotal: { type: Number, min: 0 }, // baseline for 40% (usually bookingAmount)
    requiredAmount: { type: Number, min: 0 }, // round(baseTotal * 0.40)
    completedAt: { type: Date, default: null }, // set when paidAmount >= requiredAmount
  },
  { _id: false }
);
const PriceChangeSchema = new mongoose.Schema(
  {
    proposedAt: Date,
    proposedBy: String, // "vendor", "admin", etc.
    scopeType: { type: String, enum: ["Added", "Reduced"] },
    delta: Number, // signed (+/-)
    proposedTotal: Number,
    baseAtProposal: Number, // the base we added delta to
    state: { type: String, enum: ["pending", "approved", "rejected"] },
    decidedAt: Date,
    decidedBy: String, // "admin" | "customer"
    reason: String,
  },
  { _id: false }
);

const bookingDetailsSchema = new mongoose.Schema({
  bookingDate: Date,
  bookingTime: String,
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
      "Hired", // payment done
      "Project Ongoing", // project started
      "Waiting for final payment",
      "Project Completed", // project completed
      "Negotiation",
      "Set Remainder",
    ],
    default: "Pending",
  },
  priceChanges: { type: [PriceChangeSchema], default: [] },
  isJobStarted: { type: Boolean, default: false },
  paymentMethod: {
    type: String,
    enum: ["Cash", "Card", "UPI", "Wallet"],
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
  siteVisitCharges: Number,
  paidAmount: Number, // three installment with 40% of quote amount
  amountYetToPay: Number, // update finalized quote amount - total amount
  bookingAmount: Number, // from website initial payment(included)
  originalTotalAmount: Number,
  finalTotal: {
    type: Number,
    // default: function () {
    //   // pick a sensible initial approved total
    //   return (
    //     this.currentTotalAmount ??
    //     this.bookingAmount ??
    //     this.originalTotalAmount ??
    //     0
    //   );
    // },
  },
  currentTotalAmount: {
    type: Number,
    default: function () {
      return this.originalTotalAmount || 0;
    },
  },
  paymentLink: {
    url: String,
    isActive: { type: Boolean, default: true },
    providerRef: String,
  },
  otp: Number,
  //  ........................
  reasonForChanging: String,
  // reasonForCancelled: String,
  // edit scoping
  newTotal: Number,
  editedPrice: Number,
  reasonForEditing: String,
  scopeType: String,
  priceApprovalStatus: { type: Boolean, default: false },
  priceApprovalState: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  hasPriceUpdated: { type: Boolean, default: false },
  firstMilestone: { type: FirstMilestoneSchema, default: {} },
  approvedBy: { type: String, enum: ["admin", "customer"], default: null },
  approvedAt: Date,
  priceEditedDate: Date,
  priceEditedTime: String,
  priceApprovedDate: Date,
  rejectedBy: {
    type: String,
    enum: ["admin", "customer", null],
    default: null,
  },
  priceApprovedTime: String,
  priceRejectedDate: Date,
  priceRejectedTime: String,
  //.....................
  startProject: { type: Boolean, default: false },
  startProjectOtp: {
    type: String, // store hashed OTP for security!
  },
  startProjectOtpExpiry: {
    type: Date,
  },
  projectStartDate: {
    type: Date,
    default: null,
  },
  startProjectRequestedAt: Date,
  startProjectApprovedAt: Date,
  jobEndedAt: Date,
  jobEndRequestedAt: Date,
});
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
  selectedSlot: selectedSlot,
  isEnquiry: Boolean,
  invitedVendors: [invitedVendorSchema],
  formName: { type: String, required: true }, // Add formName
  createdDate: { type: Date, default: Date.now },
});

userBookingSchema.index({ "address.location": "2dsphere" });

module.exports = mongoose.model("UserBookings", userBookingSchema);
