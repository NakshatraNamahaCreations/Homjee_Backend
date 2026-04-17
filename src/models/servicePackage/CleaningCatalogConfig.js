const mongoose = require('mongoose');

const CleaningCatalogConfigSchema = new mongoose.Schema(
    {
        serviceType: {
            type: String,
            required: true,
            enum: ["deep_cleaning"],
            unique: true,
        },
        data: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },

        version: { type: Number, default: 1 },
        updatedBy: { type: String, default: "admin" },
    },
    { timestamps: true }
);


module.exports = mongoose.model(
    "CleaningCatalogConfig",
    CleaningCatalogConfigSchema
);