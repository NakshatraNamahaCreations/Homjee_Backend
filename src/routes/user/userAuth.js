const express = require("express");
const router = express.Router();
const userController = require("../../controllers/user/userAuth");

router.post("/save-user", userController.saveUser);
router.post("/verify-otp", userController.verifyOTP);
router.post("/resent-otp", userController.resendOTP);
router.put("/save-address/:id", userController.addAddress);
router.get("/get-user-address/:id", userController.getUserAddressByUserId);
router.get("/get-address-by-userid/:id", userController.addAddress);

module.exports = router;
