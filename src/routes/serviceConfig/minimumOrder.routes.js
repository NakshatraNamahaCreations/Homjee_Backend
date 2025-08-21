// routes/minimumOrder.routes.js
const router = require("express").Router();
const ctrl = require("../../controllers/serviceConfig/minimumOrder.controller");

// Create/Update (upsert)
router.post("/minimum-orders", ctrl.upsertMinimumOrder);

// Get (single or list)
router.get("/minimum-orders", ctrl.getMinimumOrder);

module.exports = router;
