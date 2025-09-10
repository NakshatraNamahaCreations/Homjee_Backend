// const express = require("express");
// const router = express.Router();
// const {
//   addPaint,
//   getAllPaints,
//   updatePaint,
//   deletePaint,
//   addPackage,
//   getAllPackages,
//   getAllProducts,
// } = require("../../controllers/products/ProductController");

// router.post("/add-paint", addPaint);
// router.get("/get-all-paints", getAllPaints);
// router.put("/update-paint/:id", updatePaint);
// router.delete("/delete-paint/:id", deletePaint);
// router.post("/add-package", addPackage);
// router.get("/get-all-Packages", getAllPackages);
// router.get("/get-all-products", getAllProducts);

// module.exports = router;

const express = require("express");
const router = express.Router();
const {
  addPaint,
  getAllPaints,
  updatePaint,
  deletePaint,
  addPackage,
  getAllPackages,
  updatePackage,
  deletePackage,
  getProductsByType,
  addFinishingPaints,
  listFinishingPaintsByProductType,
  getAllFinishingPaints,
  updateFinishingPaint,
  deleteFinishingPaint,
} = require("../../controllers/products/ProductController");

router.post("/add-paint", addPaint);
router.get("/get-all-paints", getAllPaints);
router.put("/update-paint/:id", updatePaint);
router.delete("/delete-paint/:id", deletePaint);
router.post("/add-package", addPackage);
router.get("/get-all-packages", getAllPackages);
router.put("/update-package/:id", updatePackage);
router.delete("/delete-package/:id", deletePackage);
router.get("/get-products-by-type", getProductsByType);
router.post("/add-finishing-paints", addFinishingPaints);
router.get("/list-finishing-paints", listFinishingPaintsByProductType);
router.get("/get-all-finishing-paints", getAllFinishingPaints);
router.put("/update-finishing-paint/:id", updateFinishingPaint);
router.delete("/delete-finishing-paint/:id", deleteFinishingPaint);

module.exports = router;
