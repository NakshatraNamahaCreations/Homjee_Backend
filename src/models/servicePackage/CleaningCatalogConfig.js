const mongoose = require('mongoose');

const CleaningCatalogConfigSchema = new mongoose.Schema(
    {
        serviceType: {
            type: String,
            required: true,
            enum: ["deep_cleaning"], // add more later if needed
            unique: true, // one active config per serviceType
        },

        // the actual JSON you shared
        data: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },

        version: { type: Number, default: 1 },
        updatedBy: { type: String, default: "admin" }, // store adminId/email if you have
    },
    { timestamps: true }
);

// export default mongoose.model(
//     "CleaningCatalogConfig",
//     CleaningCatalogConfigSchema
// );

module.exports = mongoose.model(
    "CleaningCatalogConfig",
    CleaningCatalogConfigSchema
);
