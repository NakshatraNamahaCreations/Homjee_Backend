const express = require("express");
const { getKPI, updateKPI } = require("../../controllers/perfomance/kpiparameters");

const router = express.Router();

// GET KPI for service
router.get("/:serviceType", getKPI);

// UPDATE KPI for service
router.put("/:serviceType", updateKPI);

module.exports = router;
