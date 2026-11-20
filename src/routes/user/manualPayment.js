const express = require("express");
const {
  createManualPayment,
  createManualPaymentOrder,
  markManualPaymentPaid,
  getManualPayments,
  getManualPaymentById
} = require("../../controllers/user/manualPayment.js");

const router = express.Router();

router.post("/", createManualPayment);
router.get("/", getManualPayments);
// #5c/#7d — Razorpay 2-step for manual / buy-coins links:
router.post("/:id/order", createManualPaymentOrder); // step 1: create order
router.put("/mark-paid/:id", markManualPaymentPaid); // step 2: verify + record
router.get("/:id", getManualPaymentById);

module.exports = router;
