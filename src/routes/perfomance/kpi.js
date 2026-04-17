// // routes/perfomance/kpi.js
// const express = require("express");
// const router = express.Router();
// const kpiController = require("../../controllers/perfomance/kpiController");

// // GET /api/perf/kpi/:serviceType
// router.get("/:serviceType", kpiController.getKPI);

// // PUT /api/perf/kpi/:serviceType/ranges
// router.put("/:serviceType/ranges", kpiController.updateRanges);

// // PUT /api/perf/kpi/:serviceType/metrics
// router.put("/:serviceType/metrics", kpiController.updateMetrics);

// module.exports = router;



// routes/perfomance/kpi.js
const express = require("express");
const router = express.Router();
const kpiController = require("../../controllers/perfomance/kpiController");

// GET RANGES for a service type
// GET /api/kpi-parameters/:serviceType
router.get("/:serviceType", kpiController.getKPI);

// UPDATE RANGES for a service type
// PUT /api/kpi-parameters/:serviceType/ranges
router.put("/:serviceType/ranges", kpiController.updateRanges);


module.exports = router;
