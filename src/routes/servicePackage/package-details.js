const express = require("express");
const router = express.Router();
const packageController = require("../../controllers/servicePackage/package-details");
const parser = require("../../middleware/cloudinaryStorage");

router.post(
  "/add-package-images",
  (req, res, next) => {
    req.folder = "packageImages";
    next();
  },
  parser.fields([{ name: "packageImage", maxCount: 9 }]),
  packageController.createPackage
);
router.get(
  "/get-all-packages-by-service-type",
  packageController.getPackagesByServiceType
);
router.get("/get-all-packages", packageController.getAllPackages);

module.exports = router;
