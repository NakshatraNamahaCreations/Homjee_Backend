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
    enum: ["Paid", "Unpaid", "Refunded", "Waiting for final payment"],
  },
  paidAmount: Number,
  amountYetToPay: Number,
  otp: Number,
  editedPrice: Number,
  reasonForChanging: String,
  // reasonForCancelled: String,
  scope: String,
  hasPriceUpdated: { type: Boolean, default: false },
  startProject: { type: Boolean, default: false },
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
  hiring: {
    markedDate: Date,
    markedTime: String,
    hiredDate: Date,
    hiredTime: String,
    teamMember: [selectedTeam],
    projectDate: Array,
    noOfDay: Number,
    quotationId: String,
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
