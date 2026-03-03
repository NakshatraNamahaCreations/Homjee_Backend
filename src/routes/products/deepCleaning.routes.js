// routes/deepCleaning.routes.js
const router = require("express").Router();
const ctrl = require("../../controllers/products/deepCleaning.controller");

// Static catalog (for front-end dropdowns)
router.get("/deep-cleaning-catalog", ctrl.getCatalog);

// CRUD for packages
router.post("/deep-cleaning-packages", ctrl.createPackage);
router.get("/deep-cleaning-packages", ctrl.listPackages);
router.get("/deep-cleaning-packages/:id", ctrl.getPackageById);
router.get("/deep-cleaning-packages/by-city/:cityId", ctrl.getPackagesByCityIdFlat);
router.get("/deep-cleaning-packages/by-city-name/:city", ctrl.getPackagesByCityNameFlat);
// router.put("/deep-cleaning-packages/:id", ctrl.updatePackage);
router.put("/deep-cleaning-packages/:id/city-config", ctrl.upsertPackageCityConfig);
router.delete("/deep-cleaning-packages/:id", ctrl.deletePackage);

module.exports = router;
