const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  customerId: String,
  name: String,
  phone: String,
});

const serviceSchema = new mongoose.Schema({
  // serviceId: String,
  category: String,
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
      "Customer Not Reachable",
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
  addedAmount: Number,
  reasonForChanging: String,
  reasonForCancelled: String,
  scope: String,
  hasPriceUpdated: { type: Boolean, default: false },
});

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
});
const selectedSlot = new mongoose.Schema({
  slotTime: String,
  slotDate: Date,
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
});

module.exports = mongoose.model("UserBookings", userBookingSchema);
