const mongoose = require('mongoose');

const vendorTransactionSchema = new mongoose.Schema(
    {
        vendorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Vendor',
            required: true,
        },
        title: {
            type: String,
            required: true, // Example: 'Recharged Wallet', 'Lead Responded'
        },
        amount: {
            type: Number,
            required: true,
        },
        coin: {
            type: Number,
            required: true,
        },
        gst18Perc: {
            type: Number,
            required: true,
        },
        totalPaid: {
            type: Number,
            required: true,
        },
        date: {
            type: Date,
            default: Date.now, // Automatically set the current date if no date is provided
        },
        transactionType: {
            type: String,
            enum: ['wallet recharge', 'lead response', 'cancellation refund', 'reschedule refund', 'change vendor refund'],
            required: true,
        },
        type: {
            type: String,
            enum: ['added', 'deduct'],
            required: true,
        },
        metaData: {
            type: Object,
            default: {},
        },
    },
    { timestamps: true }
);
// vendorTransactionSchema
vendorTransactionSchema.index({ transactionType: 1, type: 1, createdAt: 1 });


const VendorTransaction = mongoose.model('walletTransaction', vendorTransactionSchema);

module.exports = VendorTransaction;
