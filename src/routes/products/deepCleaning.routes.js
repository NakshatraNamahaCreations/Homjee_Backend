// routes/deepCleaning.routes.js
const router = require("express").Router();
const ctrl = require("../../controllers/products/deepCleaning.controller");

// Static catalog (for front-end dropdowns)
router.get("/deep-cleaning-catalog", ctrl.getCatalog);

// CRUD for packages
router.post("/deep-cleaning-packages", ctrl.createPackage);
router.get("/deep-cleaning-packages", ctrl.listPackages);
router.get("/deep-cleaning-packages/:id", ctrl.getPackageById);
router.put("/deep-cleaning-packages/:id", ctrl.updatePackage);
router.delete("/deep-cleaning-packages/:id", ctrl.deletePackage);

module.exports = router;
