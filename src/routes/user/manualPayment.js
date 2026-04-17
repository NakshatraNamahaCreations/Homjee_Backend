const express = require("express");
const {
  createManualPayment,
  markManualPaymentPaid,
  getManualPayments,
  getManualPaymentById
} = require("../../controllers/user/manualPayment.js");

const router = express.Router();

router.post("/", createManualPayment);
router.get("/", getManualPayments);
router.put("/mark-paid/:id", markManualPaymentPaid);
router.get("/:id", getManualPaymentById);

module.exports = router;
