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
router.get(
  "/get-nearest-booking-by-location/:lat/:long",
  bookingController.getBookingForNearByVendors
);
router.post(
  "/update-confirm-job-status",
  bookingController.updateConfirmedStatus
);

router.get(
  "/get-confirm-bookings-by-vendorId/:professionalId",
  bookingController.getBookingExceptPending
);
router.post("/start-job", bookingController.startJob);
router.post("/end-job", bookingController.endJob);
router.post("/update-price", bookingController.updatePricing);
router.post("/update-status", bookingController.updateStatus);
module.exports = router;
