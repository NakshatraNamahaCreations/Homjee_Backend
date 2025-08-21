const express = require("express");
const router = express.Router();
const {
  createProduct,
  getProductsByType,
  updateProduct,
  deleteProduct,
  getPaintNames,
} = require("../../controllers/products/ProductController");

router.post("/create", createProduct);
router.get("/get-products-by-type", getProductsByType);
router.put("/:productType/:productId", updateProduct);
router.delete("/:productType/:productId", deleteProduct);

router.get("/paints/names", getPaintNames);

module.exports = router;
