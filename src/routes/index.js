const express = require("express");
const router = express.Router();

const userRoutes = require("./user/userAuth");
const bookingRoutes = require("./user/userBookings");
const serviceConfigRoutes = require("./serviceConfig/PricingConfig");
const vendorRoute = require("./vendor/vendorAuth");
const packageRoute = require("./servicePackage/package-details");
const measurementRoutes = require("./measurement/Measurement");
const quoteRoutes = require("./measurement/Quote");
const productRoutes = require("./products/ProductRoutes");
const adminAuthRoutes = require("./admin/adminAuthRoutes");
const deepCleaningRoutes = require("./products/deepCleaning.routes");
const minimumOrderRoutes = require("./serviceConfig/minimumOrder.routes");
const reminderRoutes = require("../routes/user/reminder");
const manualPaymentRoutes = require("../routes/user/manualPayment");
const kpiParametersRoutes = require("../routes/perfomance/kpi");
const vendorRatingsystem = require("../routes/vendor/vendorRating");
const InAppNotification = require("../routes/notification/Notification");
const slotForVendorReschedule = require("./vendor/slot");

// Performance KPI Parameters Routes
router.use("/kpi-parameters", kpiParametersRoutes);

router.use("/user", userRoutes);
router.use("/bookings", bookingRoutes);

router.use("/service", serviceConfigRoutes);
router.use("/vendor", vendorRoute);
router.use("/package", packageRoute);
router.use("/measurements", measurementRoutes);
router.use("/quotations", quoteRoutes);
router.use("/products", productRoutes);
router.use("/admin/auth", adminAuthRoutes);
router.use("/deeppackage", deepCleaningRoutes);
router.use("/minimumorder", minimumOrderRoutes);
router.use("/reminders", reminderRoutes);
router.use("/manual-payment", manualPaymentRoutes);
router.use("/ratings", vendorRatingsystem);
router.use("/in-app-notify", InAppNotification);
router.use("/slot", slotForVendorReschedule);

router.get("/hello-world/testing", (req, res) => {
  res.json({ message: "Hi Jimmy!" });
});

module.exports = router;
