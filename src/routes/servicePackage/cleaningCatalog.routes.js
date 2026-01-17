// routes/cleaningCatalog.routes.js
const express = require("express");
const CleaningCatalogConfig = require("../../models/servicePackage/CleaningCatalogConfig.js");
const { validateCatalogUpdate } = require("../../helpers/validateCatalogUpdate.js");

const router = express.Router();

/**
 * GET latest config
 * /api/admin/cleaning-catalog?serviceType=deep_cleaning
 */
router.get("/cleaning-catalog/fetch", async (req, res) => {
    try {
        const serviceType = req.query.serviceType || "deep_cleaning";
        const doc = await CleaningCatalogConfig.findOne({ serviceType });

        if (!doc) {
            return res.status(404).json({
                success: false,
                message: `No config found for serviceType=${serviceType}`,
            });
        }

        return res.json({ success: true, data: doc });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err?.message || "Server error",
        });
    }
});

router.get("/ping", (req, res) => res.json({ ok: true }));

/**
 * UPDATE config (safe)
 * /api/admin/cleaning-catalog?serviceType=deep_cleaning
 * body: { data: {...} }
 */
router.put("/cleaning-catalog/update", async (req, res) => {
    try {
        const serviceType = String(req.query.serviceType || "deep_cleaning");
        const incomingData = req.body?.data;

        if (!incomingData || typeof incomingData !== "object") {
            return res.status(400).json({
                success: false,
                message: "Invalid payload. Expected { data: { ... } }",
            });
        }

        const existing = await CleaningCatalogConfig.findOne({ serviceType });
        if (!existing) {
            // Optional: allow first time create
            const created = await CleaningCatalogConfig.create({
                serviceType,
                data: incomingData,
                version: 1,
                updatedBy: req.user?.email || "admin",
            });
            return res.json({ success: true, message: "Config created", data: created });
        }

        // ✅ Validate against forbidden changes
        // const errors = validateCatalogUpdate(existing.data, incomingData, {
        //     lockTeamMembers: true,
        //     lockDuration: true,
        // });

        // if (errors.length) {
        //     return res.status(400).json({
        //         success: false,
        //         message: "Validation failed",
        //         errors,
        //     });
        // }

        existing.data = incomingData;
        existing.version = Number(existing.version || 1) + 1;
        existing.updatedBy = req.user?.email || "admin";

        await existing.save();

        return res.json({
            success: true,
            message: "Config updated successfully",
            data: existing,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err?.message || "Server error",
        });
    }
});

module.exports = router;
