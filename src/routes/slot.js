const express = require("express");
const router = express.Router();
const { getAvailableSlots } = require("../controllers/slot.controller");

router.post("/available-slots", getAvailableSlots);

module.exports = router;
