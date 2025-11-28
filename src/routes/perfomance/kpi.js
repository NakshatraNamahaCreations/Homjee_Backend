// routes/perfomance/kpi.js
const express = require("express");
const router = express.Router();
const kpiController = require("../../controllers/perfomance/kpiController");

// GET /api/perf/kpi/:serviceType
router.get("/:serviceType", kpiController.getKPI);

// PUT /api/perf/kpi/:serviceType/ranges
router.put("/:serviceType/ranges", kpiController.updateRanges);

// PUT /api/perf/kpi/:serviceType/metrics
router.put("/:serviceType/metrics", kpiController.updateMetrics);

module.exports = router;
