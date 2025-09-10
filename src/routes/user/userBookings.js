const express = require("express");
const router = express.Router();
const bookingController = require("../../controllers/user/userBookings");

router.post("/create-user-booking", bookingController.createBooking);
router.get("/get-all-leads", bookingController.getAllLeadsBookings);
router.get("/get-all-enquiries", bookingController.getAllEnquiries);
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
  "/get-nearest-booking-by-location-deep-cleaning/:lat/:long",
  bookingController.getBookingForNearByVendorsDeepCleaning
);
// router.get(
//   "/deep-cleaning-vendor-performance",
//   bookingController.getDeepCleaningPerformance
// );

router.get(
  "/deep-cleaning-vendor-performance-metrics/:vendorId/:lat/:long/:timeframe",
  bookingController.getVendorPerformanceMetricsDeepCleaning
);

router.get(
  "/get-nearest-booking-by-location-house-painting/:lat/:long",
  bookingController.getBookingForNearByVendorsHousePainting
);

router.post(
  "/response-confirm-job",
  bookingController.respondConfirmJobVendorLine
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
