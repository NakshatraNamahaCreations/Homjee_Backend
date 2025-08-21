const express = require("express");
const router = express.Router();
const {
  addPaint,
  getAllPaints,
  updatePaint,
  deletePaint,
  addPackage,
  getAllPackages,
} = require("../../controllers/products/ProductController");

router.post("/add-paint", addPaint);
router.get("/get-all-paints", getAllPaints);
router.put("/update-paint/:id", updatePaint);
router.delete("/delete-paint/:id", deletePaint);
router.post("/add-package", addPackage);
router.get("/get-all-Packages", getAllPackages);

module.exports = router;
