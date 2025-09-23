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
});
const bookingDetailsSchema = new mongoose.Schema({
  bookingDate: Date,
  bookingTime: String,
  status: {
    type: String,
    enum: [
      "Pending",
      "Confirmed", //accepted or responded
      "Ongoing", //started
      "Completed", //ended
      "Customer Cancelled",
      "Customer Unreachable",
      "Admin Cancelled",
      "Pending Hiring", // mark hiring
      "Hired", // payment done
      "Job Ongoing", // project started
      "Job Ended", // project completed
      "Negotiation",
      "Set Remainder",
    ],
    default: "Pending",
  },
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
      "Partially Completed", // seond installment done, job ongoing
      "Waiting for final payment", // job end, waiting for final payment
    ],
    default: "Unpaid",
  },
  siteVisitCharges: Number,
  paidAmount: Number, // three installment with 40% of quote amount
  amountYetToPay: Number, // update finalized quote amount - total amount
  bookingAmount: Number, // from website initial payment(included)
  originalTotalAmount: Number,
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
  editedPrice: Number,
  reasonForChanging: String,
  // reasonForCancelled: String,
  scope: String,
  hasPriceUpdated: { type: Boolean, default: false },
  startProject: { type: Boolean, default: false },
  startProjectOtp: {
    type: String, // store hashed OTP for security!
  },
  startProjectOtpExpiry: {
    type: Date,
  },
  startProjectRequestedAt: Date, // when vendor requested to start
  startProjectApprovedAt: Date, // when customer approved via OTP
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
