// routes/cleaningCatalog.routes.js
const express = require("express");
const CleaningCatalogConfig = require("../../models/servicePackage/CleaningCatalogConfig.js");
const { validateCatalogUpdate } = require("../../helpers/validateCatalogUpdate.js");

const router = express.Router();

/**
 * GET latest config
 * /api/admin/cleaning-catalog?serviceType=deep_cleaning
 */
// router.get("/cleaning-catalog/fetch", async (req, res) => {
//     try {
//         const serviceType = req.query.serviceType || "deep_cleaning";
//         const doc = await CleaningCatalogConfig.findOne({ serviceType });

//         if (!doc) {
//             return res.status(404).json({
//                 success: false,
//                 message: `No config found for serviceType=${serviceType}`,
//             });
//         }

//         return res.json({ success: true, data: doc });
//     } catch (err) {
//         return res.status(500).json({
//             success: false,
//             message: err?.message || "Server error",
//         });
//     }
// });

router.get("/cleaning-catalog/fetch", async (req, res) => {
  try {
    const serviceType = req.query.serviceType || "deep_cleaning";
    const city = (req.query.city || "").trim().toLowerCase();

    const doc = await CleaningCatalogConfig.findOne({ serviceType }).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: `No config found for serviceType=${serviceType}`,
      });
    }

    let filteredData = doc.data || {};

    if (city) {
      const nextData = {};

      Object.keys(filteredData).forEach((categoryKey) => {
        const packages = Array.isArray(filteredData[categoryKey])
          ? filteredData[categoryKey]
          : [];

        const matchedPackages = packages.filter((pkg) => {
          try {
            return Array.isArray(pkg.cityConfigs)
              ? pkg.cityConfigs.some(
                (cfg) => String(cfg.city || "").trim().toLowerCase() === city
              )
              : false;
          } catch (e) {
            return false;
          }
        });

        if (matchedPackages.length > 0) {
          nextData[categoryKey] = matchedPackages;
        }
      });

      filteredData = nextData;
    }

    return res.json({
      success: true,
      data: {
        ...doc,
        data: filteredData,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error",
    });
  }
});

router.get("/fetching-packages/catalog/by-city", async (req, res) => {
  try {
    const { city } = req.query;

    if (!city || !city.trim()) {
      return res.status(400).json({
        success: false,
        message: "city is required",
      });
    }

    const cityName = city.trim().toLowerCase();

    const configDoc = await CleaningCatalogConfig.findOne({
      serviceType: "deep_cleaning",
    }).lean();

    if (!configDoc) {
      return res.status(404).json({
        success: false,
        message: "Cleaning catalog config not found",
      });
    }

    const data = configDoc.data || {};
    const mergedPackages = [];

    Object.keys(data).forEach((category) => {
      const packages = Array.isArray(data[category]) ? data[category] : [];

      packages.forEach((pkg) => {
        const matchedCityConfig = (pkg.cityConfigs || []).find(
          (cfg) => cfg?.city?.trim().toLowerCase() === cityName
        );

        if (matchedCityConfig) {
          mergedPackages.push({
            category,
            packageId: pkg.packageId || "",
            name: pkg.name || "",
            reviews: pkg.reviews || "",
            details: pkg.details || "",
            extras: pkg.extras || "",
            image: pkg.image || "",
            city: matchedCityConfig.city || "",
            price: matchedCityConfig.price ?? 0,
            coinsForVendor: matchedCityConfig.coinsForVendor ?? 0,
            teamMembers: matchedCityConfig.teamMembers ?? 0,
            duration: matchedCityConfig.duration ?? 0,
          });
        }
      });
    });

    return res.status(200).json({
      success: true,
      message: "Packages fetched successfully",
      count: mergedPackages.length,
      data: mergedPackages,
    });
  } catch (error) {
    console.error("getDeepCleaningCatalogByCity error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch packages",
      error: error.message,
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


// {
// "_id": "6969eedfef2480cbe2c65457",
// "serviceType": "deep_cleaning",
// "version": 1,
// "updatedBy": "seed",
// "data": {
// "Furnished apartment": [
// {
// "packageId": "696b2aeda4e50597341a4eff",
// "name": "1 BHK Cleaning - Classic",
// "reviews": "4.80 (15K reviews)",
// "details": "Includes 1 bedroom, 1 bathroom, 1 hall, 1 kitchen & 1 balcony",
// "extras": "Basic cleaning, excludes terrace & paint marks removal",
// "image": "one",
// "cityConfigs": [
//   {
// "cityId": "6993019d2716a651e1d87dc5",
// "city": "Pune",
// "price": 3199,
// "coinsForVendor": 20,
// "teamMembers": 4,
// "duration": 60
// },
// {
// "cityId": "699301432716a651e1d87db4",
// "city": "Bengaluru",
// "price": 3699,
// "coinsForVendor": 40,
// "teamMembers": 1,
// "duration": 40
// }
// ]
// }],
// "Unfurnished apartment": [
// {
// "name": "1 BHK Cleaning - Classic",
// "reviews": "4.75 (10K reviews)",
// "details": "Includes 1 bedroom, 1 bathroom, 1 hall, 1 kitchen & 1 balcony",
// "extras": "Basic cleaning, excludes paint marks removal",
// "image": "six",
// "packageId": "696b2aeda4e50597341a4f0e",
// "cityConfigs": [
// {
// "cityId": "6993019d2716a651e1d87dc5",
// "city": "Pune",
// "price": 2799,
// "coinsForVendor": 15,
// "teamMembers": 4,
// "duration": 60
// }
// ]
// }],
// "Book by room":[],
// "Unfurnished bungalow/duplex":[],
// "Furnished bungalow/duplex":[],
// "Mini services":[],
// }
// }