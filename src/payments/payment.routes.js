const router = require("express").Router();
const ctrl = require("./payment.controller");

router.post("/razorpay/order", ctrl.createOrder);
router.post("/razorpay/verify", ctrl.verify);

module.exports = router;