const express = require("express");
const router = express.Router();

const userRoutes = require("./user/userAuth");
const bookingRoutes = require("./user/userBookings");
const serviceConfigRoutes = require("./serviceConfig/PricingConfig");

router.use("/user", userRoutes);
router.use("/bookings", bookingRoutes);
router.use("/service", serviceConfigRoutes);

router.get("/", (req, res) => {
  res.json({ message: "Hi Jimmy!" });
});

module.exports = router;
