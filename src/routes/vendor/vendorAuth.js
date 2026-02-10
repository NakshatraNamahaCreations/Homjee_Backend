// const express = require("express");
// const router = express.Router();
// const vendorAuthController = require("../../controllers/vendor/vendorAuth");
// const parser = require("../../middleware/cloudinaryStorage");

// router.post(
//   "/create-vendor",
//   (req, res, next) => {
//     req.folder = "vendorDocs";
//     next();
//   },
//   parser.fields([
//     { name: "profileImage", maxCount: 1 },
//     { name: "aadhaarImage", maxCount: 1 },
//     { name: "panImage", maxCount: 1 },
//     { name: "otherPolicy", maxCount: 1 },
//   ]),
//   vendorAuthController.createVendor
// );
// router.post("/login-with-mobile", vendorAuthController.loginWithMobile);
// router.post("/verify-otp", vendorAuthController.verifyOTP);
// router.post("/resent-otp", vendorAuthController.resendOTP);
// router.get(
//   "/get-vendor-by-vendorId/:id",
//   vendorAuthController.getVendorByVendorId
// );

// router.post("/add-coin", vendorAuthController.addCoin);
// router.post("/reduce-coin", vendorAuthController.reduceCoin);
// router.post("/team/add", vendorAuthController.addTeamMember);
// router.post("/team/remove", vendorAuthController.removeTeamMember);
// router.get("/get-all-vendor", vendorAuthController.getAllVendors);

// module.exports = router;

const express = require("express");
const router = express.Router();
const vendorAuthController = require("../../controllers/vendor/vendorAuth");
const parser = require("../../middleware/cloudinaryStorage");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ message: "Multer error", error: err.message });
  }
  if (err) {
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
  next();
};

router.post(
  "/create-vendor",
  (req, res, next) => {
    req.folder = "vendorDocs";
    next();
  },
  parser.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadhaarfrontImage", maxCount: 1 },
    { name: "aadhaarbackImage", maxCount: 1 },
    { name: "panImage", maxCount: 1 },
    { name: "otherPolicy", maxCount: 1 },
  ]),
  vendorAuthController.createVendor
);

router.put(
  "/update-vendor/:vendorId",
  (req, res, next) => {
    try {
      req.folder = "vendorDocs";
      next();
    } catch (err) {
      next(err);
    }
  },
  parser.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadhaarfrontImage", maxCount: 1 },
    { name: "aadhaarbackImage", maxCount: 1 },
    { name: "panImage", maxCount: 1 },
    { name: "otherPolicy", maxCount: 1 },
  ]),
  vendorAuthController.updateVendor
);

router.put("/vendor-leave", vendorAuthController.updateVendorLeaves);

router.post(
  "/team/add",
  (req, res, next) => {
    req.folder = "teamDocs";
    next();
  },
  parser.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadhaarfrontImage", maxCount: 1 },
    { name: "aadhaarbackImage", maxCount: 1 },
    { name: "aadhaarImage", maxCount: 1 }, // ✅ add this
    { name: "panImage", maxCount: 1 },
    { name: "otherPolicy", maxCount: 1 },
  ]),
  vendorAuthController.addTeamMember
);

router.put(
  "/team/update",
  (req, res, next) => {
    req.folder = "teamDocs";
    next();
  },
  parser.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadhaarfrontImage", maxCount: 1 },
    { name: "aadhaarbackImage", maxCount: 1 },
    { name: "aadhaarImage", maxCount: 1 }, // ✅ add this
    { name: "panImage", maxCount: 1 },
    { name: "otherPolicy", maxCount: 1 },
  ]),
  vendorAuthController.updateTeamMember
);

router.post("/login-with-mobile", vendorAuthController.loginWithMobile);
router.post("/verify-otp", vendorAuthController.verifyOTP);
router.post("/resend-otp", vendorAuthController.resendOTP);
router.get(
  "/get-vendor-by-vendorId/:id",
  vendorAuthController.getVendorByVendorId
);
router.post("/add-coin", vendorAuthController.addCoin);
router.post("/reduce-coin", vendorAuthController.reduceCoin);
router.post("/team/remove", vendorAuthController.removeTeamMember);
router.get("/get-all-vendor", vendorAuthController.getAllVendors);
router.put(
  "/team/leaves/:vendorId/:teamMemberId",
  vendorAuthController.updateTeamMemberLeaves
);
router.get(
  "/get-team-id/:vendorId/:teamMemberId",
  vendorAuthController.teamMemberById
);
router.get(
  "/get-team-member-busy-dates/:vendorId/:teamMemberId",
  vendorAuthController.getTeamMemberBusyDates
);
router.get(
  "/team-members-status/:vendorId/status",
  vendorAuthController.getVendorTeamStatuses
);
router.get(
  "/check-vendor-availability/:vendorId/availability",
  vendorAuthController.checkVendorAvailability
);

router.get(
  "/check-teammember-availability/:vendorId/availability-range",
  vendorAuthController.checkVendorAvailabilityRange
);

// kiruth...................
router.post(
  "/add-team-member/vendor/:vendorId",
  vendorAuthController.addSmallTeamMember
);
router.get(
  "/get-teams-by-vendor/:vendorId",
  vendorAuthController.getTeamByVendorID
);

router.post(
  "/bulk-upload",
  upload.single("file"),
  vendorAuthController.bulkUploadVendors
);

router.get(
  "/overall-coin-sold",
  vendorAuthController.getOverallCoinPurchasedTotal
);

router.post("/get-available-vendor", vendorAuthController.getAvailableVendors)
module.exports = router;
