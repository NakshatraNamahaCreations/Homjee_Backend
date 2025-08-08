// routes/measurementRoutes.js
const express = require("express");
const router = express.Router();
const measurementController = require("../../controllers/measurement/Measurement");

// Save or update measurement
router.post("/save-measurement", measurementController.saveMeasurement);

// Get summary
router.get("/:leadId/summary", measurementController.getMeasurementSummary);

// Get measurement by leadId
router.get("/:leadId", measurementController.getMeasurementByLead);

module.exports = router;
