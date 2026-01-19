const express = require("express");
const walletTransaction = require("../../models/vendor/wallet");
const vendorAuthSchema = require("../../models/vendor/vendorAuth");
const mongoose = require("mongoose");
const ManualPayment = require("../../models/user/manualPayment"); // adjust path
const VendorTransaction = require("../../models/vendor/wallet"); // adjust path

const router = express.Router();

// server might be UTC, so we should compute IST expiry correctly.
const getTodayEndOfDayIST = () => {
  // IST offset = +5:30 from UTC = 330 minutes
  const now = new Date();
  // Convert "now" to IST clock
  const istNow = new Date(now.getTime() + 330 * 60 * 1000);
  // Set IST end-of-day
  istNow.setHours(23, 59, 59, 999);
  // Convert back to UTC Date object for storing in DB
  const expiryUTC = new Date(istNow.getTime() - 330 * 60 * 1000);
  return expiryUTC;
};

const isExpired = (expiry) => {
  if (!expiry) return true;
  return new Date() > new Date(expiry);
};

const paymentLink = "http://localhost:5173/wallet-recharge";

// API to add a new transaction
router.post("/recharge-wallet/add-coin/vendor", async (req, res) => {
  try {
    const { vendorId } = req.body;

    if (!vendorId) {
      return res
        .status(400)
        .json({ status: "fail", message: "vendorId required" });
    }

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor) {
      return res
        .status(404)
        .json({ status: "fail", message: "Vendor not found" });
    }

    // ✅ define values once
    const coin = 500;
    const amount = 5000;
    const gst18Perc = 900;
    const totalPaid = 5900;
    const transactionType = "wallet recharge";
    const type = "added";

    const newTransaction = new walletTransaction({
      vendorId,
      title: `Wallet recharge`,
      amount,
      coin,
      gst18Perc,
      totalPaid,
      transactionType,
      type,
    });

    await newTransaction.save();

    // ✅ update wallet safely
    if (!vendor.wallet) vendor.wallet = { coins: 0 };
    if (!vendor.wallet) vendor.wallet = { overallCoinPurchased: 0 };
    const totalCoinValue =
      (Number(vendor.wallet.overallCoinPurchased) || 0) + coin;
    if (transactionType === "wallet recharge" && type === "added") {
      vendor.wallet.coins = (Number(vendor.wallet.coins) || 0) + coin;
      vendor.wallet.overallCoinPurchased = totalCoinValue;
    }

    vendor.wallet.canRespondLead = true;
    vendor.wallet.isLinkActive = false;
    vendor.wallet.paymentLink = null;
    vendor.wallet.linkExpiry = null;

    await vendor.save();

    return res.status(201).json({
      status: "success",
      message: "Wallet recharged successfully",
      data: newTransaction,
      updatedVendorCoins: vendor.wallet.coins,
    });
  } catch (error) {
    console.error("Error recharging wallet:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error",
      error: error.message,
    });
  }
});

router.put("/send-recharge-link/:vendorId/payment-link", async (req, res) => {
  try {
    const { vendorId } = req.params;
    console.log("vendorId", vendorId);

    const existing = await vendorAuthSchema.findById(vendorId);
    if (!existing) {
      return res.status(404).json({
        status: "fail",
        message: "Vendor not found",
      });
    }

    /* ===============================
           CHECK ACTIVE LINK (WALLET)
        =============================== */
    if (
      existing.wallet?.isLinkActive &&
      existing.wallet?.linkExpiry &&
      !isExpired(existing.wallet.linkExpiry)
    ) {
      return res.status(400).json({
        status: "fail",
        message: "A link is already active until 11:59 PM.",
      });
    }

    /* ===============================
           GENERATE PAYMENT LINK
        =============================== */
    const randomRef = Math.floor(100000 + Math.random() * 900000); // 6 digit
    const generatedLink = `${paymentLink}?vendorId=${vendorId}&ref=${randomRef}`;

    const expiry = getTodayEndOfDayIST();

    /* ===============================
           UPDATE WALLET OBJECT
        =============================== */
    const update = {
      "wallet.paymentLink": generatedLink,
      "wallet.linkExpiry": expiry,
      "wallet.isLinkActive": true,
    };

    const updated = await vendorAuthSchema.findByIdAndUpdate(
      vendorId,
      { $set: update },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      status: "success",
      message: "Recharge payment link generated",
      wallet: {
        paymentLink: updated.wallet.paymentLink,
        // linkExpiry: updated.wallet.linkExpiry,
        // isLinkActive: updated.wallet.isLinkActive,
      },
    });
  } catch (err) {
    console.error("fail to send link error:", err);
    return res.status(500).json({
      status: "fail",
      message: "Server error",
      error: err.message,
    });
  }
});

router.get("/vendor/payment-link/validate", async (req, res) => {
  try {
    const { vendorId, ref } = req.query;

    if (!vendorId || !ref) {
      return res.status(400).json({
        ok: false,
        status: "invalid",
        message: "Missing vendorId or ref",
      });
    }

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        ok: false,
        status: "invalid",
        message: "Vendor not found",
      });
    }

    // ✅ OPTIONAL (but strongly recommended): validate ref matches the latest link
    // If your stored paymentLink contains ref=xxxx then check it:
    const storedLink = vendor.wallet?.paymentLink || "";
    const refMatches = storedLink.includes(`ref=${ref}`);

    if (!refMatches) {
      return res.status(400).json({
        ok: false,
        status: "invalid",
        message: "Invalid or old link reference",
      });
    }

    // 1) Already paid / inactive
    if (!vendor.wallet?.isLinkActive) {
      return res.status(200).json({
        ok: false,
        status: "paid", // or "inactive"
        message: "Link already used or deactivated",
      });
    }

    // 2) Expired
    if (
      !vendor.wallet?.linkExpiry ||
      new Date() > new Date(vendor.wallet.linkExpiry)
    ) {
      vendor.wallet.isLinkActive = false;
      await vendor.save();

      return res.status(200).json({
        ok: false,
        status: "expired",
        message: "Payment link expired",
        linkExpiry: vendor.wallet?.linkExpiry || null,
      });
    }

    // 3) Active
    return res.status(200).json({
      ok: true,
      status: "active",
      paymentLink: vendor.wallet.paymentLink,
      linkExpiry: vendor.wallet.linkExpiry,
      // optional extra fields for UI:
      currentCoins: vendor.wallet.coins,
    });
  } catch (err) {
    console.error("validate link error:", err);
    return res.status(500).json({
      ok: false,
      status: "error",
      message: "Server error",
    });
  }
});

router.get("/get-link-status/payment-link/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;

    const vendor = await vendorAuthSchema.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        status: "fail",
        message: "Vendor not found",
      });
    }

    const wallet = vendor.wallet || {};
    const now = new Date();

    // No active link → can generate
    if (!wallet.isLinkActive) {
      return res.status(200).json({
        status: "success",
        canGenerateLink: true,
        wallet: {
          isLinkActive: false,
          linkExpiry: wallet.linkExpiry || null,
        },
      });
    }

    // Active link but expired → auto-disable & allow
    if (wallet.linkExpiry && now > new Date(wallet.linkExpiry)) {
      vendor.wallet.isLinkActive = false;
      await vendor.save();

      return res.status(200).json({
        status: "success",
        canGenerateLink: true,
        reason: "LINK_EXPIRED",
        wallet: {
          isLinkActive: false,
          linkExpiry: wallet.linkExpiry,
        },
      });
    }

    // Active + not expired → block generation
    return res.status(200).json({
      status: "success",
      canGenerateLink: false,
      reason: "LINK_ACTIVE",
      wallet: {
        isLinkActive: true,
        linkExpiry: wallet.linkExpiry,
      },
    });
  } catch (err) {
    console.error("status api error", err);
    return res.status(500).json({
      status: "fail",
      message: "Server error",
    });
  }
});

router.get("/get-wallet-transaction/vendor/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // validate vendorId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ status: false, message: "Invalid vendorId" });
    }

    // pagination (optional)
    // const page = Math.max(Number(req.query.page || 1), 1);
    // const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    // const skip = (page - 1) * limit;

    // fetch transactions for vendor
    const [transactions, total] = await Promise.all([
      walletTransaction.find({ vendorId: id }).sort({ createdAt: -1 }), // latest first
      // .skip(skip)
      // .limit(limit),
      walletTransaction.countDocuments({ vendorId: id }),
    ]);

    // const transactions = await walletTransaction
    //     .find({ vendorId: req.params.id })
    //     .sort({ createdAt: -1 });

    if (!transactions.length) {
      return res.status(404).json({
        status: false,
        message: "No wallet transaction history",
        data: [],
      });
    }

    return res.status(200).json({
      status: true,
      message: "Transactions fetched",
      total,
      data: transactions,
    });
  } catch (error) {
    console.log("get-wallet-transaction error:", error);
    return res.status(500).json({ status: false, message: "Server error" });
  }
});

router.get("/overall-coin-sold", async (req, res) => {
  try {
    const [manualAgg, walletAgg] = await Promise.all([
      ManualPayment.aggregate([
        {
          $match: {
            type: "vendor",
            context: "coins",
            "payment.status": "Paid",
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      VendorTransaction.aggregate([
        { $match: { transactionType: "wallet recharge", type: "added" } },
        { $group: { _id: null, total: { $sum: "$totalPaid" } } },
      ]),
    ]);

    const manualTotal = manualAgg?.[0]?.total || 0;
    const walletTotal = walletAgg?.[0]?.total || 0;

    return res.json({
      success: true,
      data: {
        manualTotal,
        walletTotal,
        grandTotal: manualTotal + walletTotal,
      },
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to calculate totals",
    });
  }
});

module.exports = router;
