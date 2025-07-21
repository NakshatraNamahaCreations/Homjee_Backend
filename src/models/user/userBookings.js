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
    enum: ["Pending", "Confirmed", "Completed", "Cancelled"],
    default: "Pending",
  },
  paymentMethod: {
    type: String,
    enum: ["Cash", "Card", "UPI", "Wallet"],
  },
  paymentStatus: {
    type: String,
    enum: ["Paid", "Unpaid", "Refunded"],
  },
  paidAmount: Number,
});

const assignedProfessionalSchema = new mongoose.Schema({
  professionalId: String,
  name: String,
  phone: String,
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
    lat: Number,
    long: Number,
  },
  selectedSlot: selectedSlot,
  isEnquiry: Boolean,
});

module.exports = mongoose.model("UserBookings", userBookingSchema);
