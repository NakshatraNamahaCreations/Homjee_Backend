const express = require("express");
const router = express.Router();
const bookingController = require("../../controllers/user/userBookings");


router.post("/create-user-booking", bookingController.createBooking);
router.post("/create-admin-booking", bookingController.adminCreateBooking);
// router.patch('/:id/mark-as-lead', bookingController.markAsLead); // new routes to udpate enquiry to lead
router.get("/get-all-leads", bookingController.getAllLeadsBookings);
router.get("/get-all-enquiries", bookingController.getAllEnquiries);
router.get("/get-all-bookings", bookingController.getAllBookings);

// 🔹 NEW — Get only Pending Leads
router.get("/get-pending-leads", bookingController.getPendingLeads);

// 🔹 NEW — Get all leads except Pending
router.get("/get-non-pending-leads", bookingController.getNonPendingLeads);

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
// .............metrics routes..................
router.get(
  "/deep-cleaning-vendor-performance-metrics/:vendorId/:lat/:long/:timeframe",
  bookingController.getVendorPerformanceMetricsDeepCleaning
);

router.get(
  "/house-painting-vendor-performance-metrics/:vendorId/:lat/:long/:timeframe",
  bookingController.getVendorPerformanceMetricsHousePainting
);

// router.get(
//   "/house-painting-vendor-performance-metrics/:vendorId/:lat/:long/:timeframe",
//   bookingController.getVendorPerformanceMetricsHousePainting
// );

router.get("/overall", bookingController.getOverallPerformance);
// .............................................
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
  bookingController.getBookingExceptPendingAndCancelled
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
router.post("/cancel-booking/customer/website", bookingController.cancelLeadFromWebsite);
router.post("/mark-pending-hiring", bookingController.markPendingHiring);
router.post("/make-payment", bookingController.makePayment);
// router.post("/created-by-admin/make-payment/admin", bookingController.adminToCustomerPayment);

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

// router.put("/update-user-booking/:bookingId", bookingController.updateBooking);
// Update address and reset slots
router.put('/update-address-slot/:bookingId', bookingController.updateAddressAndResetSlots);

// Update selected slot
router.put('/update-slot/:bookingId', bookingController.updateSelectedSlot);

// Update user booking (existing route - keep this)
router.put('/update-user-booking/:bookingId', bookingController.updateUserBooking);
router.put('/update-user-enquiry/:bookingId', bookingController.updateEnquiry);


router.patch("/:bookingId/status", bookingController.updateBookingField);


// router.put(
//   "/update-assigned-professional/:bookingId",
//   bookingController.updateAssignedProfessional
// );

module.exports = router;
