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
router.post("/complete-survey", bookingController.completeSurvey);
router.post("/update-price/:bookingId", bookingController.requestPriceChange);
router.post(
  "/approve-pricing/:bookingId",
  bookingController.approvePriceChange
);
router.post(
  "/disapprove-pricing/:bookingId",
  bookingController.rejectPriceChange
);
router.post("/update-status", bookingController.updateStatus);
router.post("/mark-pending-hiring", bookingController.markPendingHiring);
router.post("/make-payment", bookingController.makePayment);
router.post(
  "/start-project/generating-otp/:bookingId",
  bookingController.requestStartProjectOtp
);
router.post(
  "/confirm-otp/start/project/:bookingId",
  bookingController.verifyStartProjectOtp
);
// router.post(
//   "/request-final-payment/final/project/:bookingId",
//   bookingController.requestFinalPayment  // not anymore
// );
router.post(
  "/request-next-payment/second/project/:bookingId",
  bookingController.requestSecondPayment
);

router.post(
  "/completing-job/final-payemt/request/end-job/:bookingId",
  bookingController.requestingFinalPaymentEndProject
);

router.put("/update-user-booking/:id", bookingController.updateBooking);
router.patch("/:bookingId/read-status", bookingController.updateMarkReadStatus);

// router.put(
//   "/update-assigned-professional/:bookingId",
//   bookingController.updateAssignedProfessional
// );

module.exports = router;
