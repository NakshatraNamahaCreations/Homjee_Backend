const express = require("express");
const router = express.Router();
const bookingController = require("../../controllers/user/userBookings");

router.post("/create-user-booking", bookingController.createBooking);
router.get("/get-all-bookings", bookingController.getAllBookings);
router.get(
  "/get-bookings-by-bookingid/:id",
  bookingController.getBookingsByBookingId
);
router.get(
  "/get-bookings-by-customerid/:customerId",
  bookingController.getBookingsByCustomerId
);

module.exports = router;
