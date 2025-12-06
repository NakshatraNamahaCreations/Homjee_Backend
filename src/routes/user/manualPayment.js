const express = require("express");
const {
  createManualPayment,
  markManualPaymentPaid,
  getManualPayments
} = require("../../controllers/user/manualPayment.js");

const router = express.Router();

router.post("/", createManualPayment);
router.put("/mark-paid/:id", markManualPaymentPaid);
router.get("/", getManualPayments);

module.exports = router;
