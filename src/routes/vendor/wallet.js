const express = require('express');
const walletTransaction = require('../../models/vendor/wallet');
const vendorAuthSchema = require('../../models/vendor/vendorAuth');
const mongoose = require('mongoose');

const router = express.Router();

// API to add a new transaction
router.post('/recharge-wallet/vendor-coin', async (req, res) => {
    try {
        const { vendorId, title, amount, transactionType, type } = req.body;

        // Create a new transaction record
        const newTransaction = new walletTransaction({
            vendorId,
            title,
            amount,
            transactionType,
            type,
        });

        // Save the transaction to the database
        await newTransaction.save();
        const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
        const vendor = await vendorAuthSchema.findById(vendorObjectId);
        if (!vendor) {
            return res.status(404).json({
                status: 'fail',
                message: 'Vendor not found',
            });
        }
        if (transactionType === 'wallet recharge' && type === 'added') {
            vendor.wallet.coins += amount;
        }
        if (vendor.wallet) {
            vendor.wallet.canRespondLead = true;  // Safely assign since vendor.wallet exists
        }
        // Save the updated vendor record
        await vendor.save();

        // Send the response
        res.status(201).json({
            status: 'success',
            message: 'Wallet Recharged successfully',
            data: newTransaction,
            updatedVendorCoins: vendor.wallet.coins,
        });
    } catch (error) {
        console.error('Error recharging wallet:', error);
        res.status(500).json({
            status: 'error',
            message: 'Server error',
        });
    }
});

router.get("/get-wallet-transaction/vendor/:id", async (req, res) => {
    try {
        const { id } = req.params;

        // validate vendorId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: "Invalid vendorId" });
        }

        // pagination (optional)
        // const page = Math.max(Number(req.query.page || 1), 1);
        // const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
        // const skip = (page - 1) * limit;

        // fetch transactions for vendor
        const [transactions, total] = await Promise.all([
            walletTransaction
                .find({ vendorId: id })
                .sort({ createdAt: -1 }), // latest first
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

module.exports = router;
