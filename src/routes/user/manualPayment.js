const express = require("express");
const {
  createManualPayment,
  markManualPaymentPaid,
  getManualPayments
} = require("../../controllers/user/manualPayment.js");

const router = express.Router();

router.post("/create", createManualPayment);
router.put("/mark-paid/:id", markManualPaymentPaid);
router.get("/list", getManualPayments);

module.exports = router;
