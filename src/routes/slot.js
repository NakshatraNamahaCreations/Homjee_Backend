const express = require("express");
const router = express.Router();
const {
  getAvailableSlots,
  getWebsiteAvailableSlots,
} = require("../controllers/slot.controller");
const {
  createHold,
  releaseHoldEndpoint,
} = require("../controllers/slotHold.controller");

router.post("/available-slots", getAvailableSlots);
router.post("/website/get-available-slots", getWebsiteAvailableSlots);

// Reservation endpoints (Redis-backed; 10-min TTL).
// Mounted under /api/slots so full paths are /api/slots/hold + /api/slots/release.
router.post("/hold", createHold);
router.post("/release", releaseHoldEndpoint);

module.exports = router;
