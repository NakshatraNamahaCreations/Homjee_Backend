const express = require("express");
const router = express.Router();
const { getAvailableSlots , getWebsiteAvailableSlots} = require("../controllers/slot.controller");

router.post("/available-slots", getAvailableSlots);
router.post(
  "/website/get-available-slots",
  getWebsiteAvailableSlots
);


module.exports = router;
