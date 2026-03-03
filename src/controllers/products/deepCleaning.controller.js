// // controllers/deepCleaning.controller.js
// const DeepCleaningPackage = require("../../models/products/DeepCleaningPackage");
// const {
//   CATALOG,
//   isValidCombo,
// } = require("../../data/deepCleaningCatalog");
// const City = require("../../models/city/City.js"); // adjust path

// const CleaningCatalogConfig = require("../../models/servicePackage/CleaningCatalogConfig"); // adjust path

// /* ===================== CATALOG ===================== */

// // GET /api/deep-cleaning-catalog
// exports.getCatalog = async (req, res) => {
//   try {
//     return res.json({ success: true, data: CATALOG });
//   } catch (err) {
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch catalog",
//     });
//   }
// };

// /* ===================== CREATE PACKAGE ===================== */

// // POST /api/deep-cleaning-packages
// exports.createPackage = async (req, res) => {
//   try {
//     const {
//       cityId,
//       category,
//       subcategory,
//       service = "",
//       totalAmount,
//       coinsForVendor,
//       teamMembers,
//       durationMinutes,
//     } = req.body;

//     if (!cityId) {
//       return res.status(400).json({ success: false, message: "cityId is required" });
//     }

//     const city = await City.findById(cityId).lean();
//     if (!city) {
//       return res.status(404).json({ success: false, message: "City not found" });
//     }

//     if (!isValidCombo(category, subcategory, service)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid category/subcategory/service combination.",
//       });
//     }

//     if (!durationMinutes || Number(durationMinutes) < 30) {
//       return res.status(400).json({
//         success: false,
//         message: "durationMinutes is required and must be >= 30",
//       });
//     }

//     if (!teamMembers || Number(teamMembers) < 1) {
//       return res.status(400).json({
//         success: false,
//         message: "teamMembers must be at least 1",
//       });
//     }

//     const pkg = await DeepCleaningPackage.create({
//       cityId,
//       cityKey: city.cityKey,            // ✅ derive from City
//       category: String(category).trim(),
//       subcategory: String(subcategory).trim(),
//       service: String(service || "").trim(),
//       totalAmount: Number(totalAmount),
//       coinsForVendor: Number(coinsForVendor),
//       teamMembers: Number(teamMembers),
//       durationMinutes: Number(durationMinutes),
//     });

//     return res.status(201).json({ success: true, data: pkg });
//   } catch (err) {
//     if (err?.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message: "This package already exists for this city.",
//       });
//     }

//     return res.status(400).json({
//       success: false,
//       message: err.message || "Failed to create package.",
//     });
//   }
// };
// /* ===================== LIST PACKAGES ===================== */

// // GET /api/deep-cleaning-packages
// exports.listPackages = async (req, res) => {
//   try {
//     const { cityId, cityKey, category, subcategory, service, page, limit } = req.query;

//     const filter = {};

//     // ✅ City filter (at least one should be sent from frontend)
//     if (cityId) filter.cityId = cityId;
//     else if (cityKey) filter.cityKey = String(cityKey).trim().toLowerCase();

//     if (category) filter.category = String(category).trim();
//     if (subcategory) filter.subcategory = String(subcategory).trim();

//     if (service !== undefined) {
//       const s = String(service).trim();
//       filter.service = s === "" || s === "_none" ? "" : s;
//     }

//     const hasPagination =
//       page !== undefined &&
//       limit !== undefined &&
//       Number(page) > 0 &&
//       Number(limit) > 0;

//     const query = DeepCleaningPackage.find(filter).sort({
//       category: 1,
//       subcategory: 1,
//       service: 1,
//     });

//     if (hasPagination) {
//       const skip = (Number(page) - 1) * Number(limit);

//       const [items, total] = await Promise.all([
//         query.skip(skip).limit(Number(limit)),
//         DeepCleaningPackage.countDocuments(filter),
//       ]);

//       return res.json({ success: true, data: items, page: Number(page), limit: Number(limit), total });
//     }

//     const [items, total] = await Promise.all([
//       query,
//       DeepCleaningPackage.countDocuments(filter),
//     ]);

//     return res.json({ success: true, data: items, total });
//   } catch (err) {
//     return res.status(400).json({
//       success: false,
//       message: err.message || "Failed to list packages.",
//     });
//   }
// };

// /* ===================== GET PACKAGE ===================== */

// // GET /api/deep-cleaning-packages/:id
// exports.getPackageById = async (req, res) => {
//   try {
//     const doc = await DeepCleaningPackage.findById(req.params.id);
//     if (!doc) {
//       return res.status(404).json({
//         success: false,
//         message: "Package not found.",
//       });
//     }

//     return res.json({ success: true, data: doc });
//   } catch (err) {
//     return res.status(400).json({
//       success: false,
//       message: err.message || "Failed to fetch package.",
//     });
//   }
// };

// /* ===================== UPDATE PACKAGE ===================== */

// // PUT /api/deep-cleaning-packages/:id
// // exports.updatePackage = async (req, res) => {
// //   try {
// //     const {
// //       category,
// //       subcategory,
// //       service = "",
// //       totalAmount,
// //       coinsForVendor,
// //       teamMembers,
// //       durationMinutes, // ✅ NEW
// //     } = req.body;

// //     const existing = await DeepCleaningPackage.findById(req.params.id);
// //     if (!existing) {
// //       return res.status(404).json({
// //         success: false,
// //         message: "Package not found.",
// //       });
// //     }

// //     /* ---------- VALIDATE COMBO IF CHANGED ---------- */

// //     if (category || subcategory || service !== undefined) {
// //       const newCategory = category ?? existing.category;
// //       const newSubcategory = subcategory ?? existing.subcategory;
// //       const newService = service ?? existing.service;

// //       if (!isValidCombo(newCategory, newSubcategory, newService)) {
// //         return res.status(400).json({
// //           success: false,
// //           message: "Invalid category/subcategory/service combination.",
// //         });
// //       }
// //     }

// //     if (durationMinutes !== undefined && durationMinutes < 30) {
// //       return res.status(400).json({
// //         success: false,
// //         message: "durationMinutes must be >= 30",
// //       });
// //     }

// //     const updated = await DeepCleaningPackage.findByIdAndUpdate(
// //       req.params.id,
// //       {
// //         category,
// //         subcategory,
// //         service,
// //         totalAmount,
// //         coinsForVendor,
// //         teamMembers,
// //         durationMinutes, // ✅ UPDATED
// //       },
// //       { new: true, runValidators: true }
// //     );

// //     return res.json({
// //       success: true,
// //       data: updated,
// //     });
// //   } catch (err) {
// //     if (err?.code === 11000) {
// //       return res.status(409).json({
// //         success: false,
// //         message:
// //           "A package for this category/subcategory/service already exists.",
// //       });
// //     }

// //     return res.status(400).json({
// //       success: false,
// //       message: err.message || "Failed to update package.",
// //     });
// //   }
// // };

// exports.updatePackage = async (req, res) => {
//   try {
//     let {
//       category,
//       subcategory,
//       service,
//       totalAmount,
//       coinsForVendor,
//       teamMembers,
//       durationMinutes,
//     } = req.body;

//     const existing = await DeepCleaningPackage.findById(req.params.id);
//     if (!existing) {
//       return res.status(404).json({
//         success: false,
//         message: "Package not found.",
//       });
//     }

//     // ✅ normalize incoming strings
//     const norm = (v) => (v === undefined || v === null ? undefined : String(v).trim());
//     category = norm(category);
//     subcategory = norm(subcategory);
//     service = norm(service);

//     // your UI sometimes sends _none or "" for no service
//     if (service === "_none") service = "";

//     // ✅ check if combo ACTUALLY changed (not just present in req.body)
//     const comboActuallyChanged =
//       (category !== undefined && category !== String(existing.category || "").trim()) ||
//       (subcategory !== undefined && subcategory !== String(existing.subcategory || "").trim()) ||
//       (service !== undefined && service !== String(existing.service || "").trim());

//     // ✅ validate combo only if changed
//     if (comboActuallyChanged) {
//       const newCategory = category ?? existing.category;
//       const newSubcategory = subcategory ?? existing.subcategory;
//       const newService = service ?? existing.service;

//       const ok = await isValidComboFromCatalogConfig(newCategory, newSubcategory, newService);
//       if (!ok) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid category/subcategory/service combination.",
//         });
//       }
//     }

//     // ✅ validate duration only if provided
//     if (durationMinutes !== undefined && Number(durationMinutes) < 30) {
//       return res.status(400).json({
//         success: false,
//         message: "durationMinutes must be >= 30",
//       });
//     }

//     // ✅ update only provided fields
//     const updateFields = {};

//     if (category !== undefined) updateFields.category = category;
//     if (subcategory !== undefined) updateFields.subcategory = subcategory;
//     if (service !== undefined) updateFields.service = service;

//     if (totalAmount !== undefined) updateFields.totalAmount = Number(totalAmount);
//     if (coinsForVendor !== undefined) updateFields.coinsForVendor = Number(coinsForVendor);
//     if (teamMembers !== undefined) updateFields.teamMembers = Number(teamMembers);
//     if (durationMinutes !== undefined) updateFields.durationMinutes = Number(durationMinutes);

//     const updated = await DeepCleaningPackage.findByIdAndUpdate(
//       req.params.id,
//       { $set: updateFields },
//       { new: true, runValidators: true }
//     );

//     // ✅ Sync catalog config by name (same as you wanted)
//     await syncDeepCleaningCatalogByName(updated);

//     return res.json({
//       success: true,
//       data: updated,
//     });
//   } catch (err) {
//     if (err?.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message: "A package for this category/subcategory/service already exists.",
//       });
//     }

//     return res.status(400).json({
//       success: false,
//       message: err.message || "Failed to update package.",
//     });
//   }
// };

// /* ✅ Validate combo from CleaningCatalogConfig (reliable) */
// async function isValidComboFromCatalogConfig(category, subcategory, service) {
//   try {
//     const c = String(category || "").trim();
//     const sc = String(subcategory || "").trim();
//     const sv = String(service || "").trim();

//     const computedName = sv ? `${sc} - ${sv}` : sc;

//     const config = await CleaningCatalogConfig.findOne({ serviceType: "deep_cleaning" });
//     if (!config?.data) return false;

//     const list = config.data[c];
//     if (!Array.isArray(list)) return false;

//     return list.some((it) => String(it?.name || "").trim() === computedName);
//   } catch (e) {
//     console.error("isValidComboFromCatalogConfig error:", e.message);
//     return false;
//   }
// }

// /* ✅ Sync data by name */
// async function syncDeepCleaningCatalogByName(updatedPkg) {
//   try {
//     const computedName =
//       updatedPkg.name ||
//       (updatedPkg.service
//         ? `${updatedPkg.subcategory} - ${updatedPkg.service}`
//         : updatedPkg.subcategory);

//     const config = await CleaningCatalogConfig.findOne({ serviceType: "deep_cleaning" });
//     if (!config?.data) return;

//     let found = false;

//     for (const categoryKey of Object.keys(config.data)) {
//       const items = config.data[categoryKey];
//       if (!Array.isArray(items)) continue;

//       for (let i = 0; i < items.length; i++) {
//         if (String(items[i]?.name || "").trim() === String(computedName).trim()) {
//           items[i].price = Number(updatedPkg.totalAmount) || 0;
//           items[i].teamMembers = Number(updatedPkg.teamMembers) || 0;
//           items[i].duration = Number(updatedPkg.durationMinutes) || 0;
//           items[i].coinsForVendor = Number(updatedPkg.coinsForVendor) || 0;
//           found = true;
//           break;
//         }
//       }

//       if (found) break;
//     }

//     if (found) {
//       config.markModified("data");
//       await config.save();
//     }
//   } catch (err) {
//     console.error("Catalog sync failed:", err.message);
//   }
// }

// /* ===================== DELETE PACKAGE ===================== */

// // DELETE /api/deep-cleaning-packages/:id
// exports.deletePackage = async (req, res) => {
//   try {
//     const doc = await DeepCleaningPackage.findByIdAndDelete(req.params.id);

//     if (!doc) {
//       return res.status(404).json({
//         success: false,
//         message: "Package not found.",
//       });
//     }

//     return res.json({
//       success: true,
//       message: "Deleted successfully.",
//     });
//   } catch (err) {
//     return res.status(400).json({
//       success: false,
//       message: err.message || "Failed to delete package.",
//     });
//   }
// };

const mongoose = require("mongoose");
const DeepCleaningPackage = require("../../models/products/DeepCleaningPackage");
const { CATALOG, isValidCombo } = require("../../data/deepCleaningCatalog");
const City = require("../../models/city/City.js");
const CleaningCatalogConfig = require("../../models/servicePackage/CleaningCatalogConfig");

/* ===================== HELPERS ===================== */

const norm = (v) => (v === undefined || v === null ? "" : String(v).trim());

function computeName(subcategory, service) {
  const sc = norm(subcategory);
  const sv = norm(service);
  return sv ? `${sc} - ${sv}` : sc;
}

function pickCityName(cityDoc) {
  // adjust if your City schema uses other fields
  return (
    norm(cityDoc?.city) ||
    norm(cityDoc?.name) ||
    norm(cityDoc?.title) ||
    norm(cityDoc?.cityName) ||
    ""
  );
}

/**
 * For UI compatibility (your old UI expects top-level fields):
 * If cityId is provided, return derived fields at root.
 */
function flattenForCity(doc, cityId) {
  try {
    if (!doc) return doc;
    const d = doc.toObject ? doc.toObject() : doc;
    if (!cityId) return d;

    const cfg = (d.cityConfigs || []).find(
      (c) => String(c.cityId) === String(cityId),
    );

    if (!cfg) return d;

    return {
      ...d,
      // old root-like keys for UI
      cityId: cfg.cityId,
      city: cfg.city,
      totalAmount: cfg.totalAmount,
      coinsForVendor: cfg.coinsForVendor,
      teamMembers: cfg.teamMembers,
      durationMinutes: cfg.durationMinutes,
      selectedCityConfig: cfg,
    };
  } catch (e) {
    return doc;
  }
}

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (e) {
    return id;
  }
}

/* ===================== CATALOG ===================== */

// GET /api/deep-cleaning-catalog
exports.getCatalog = async (req, res) => {
  try {
    return res.json({ success: true, data: CATALOG });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch catalog",
    });
  }
};

/* ===================== CREATE PACKAGE ===================== */
/**
 * POST /api/deeppackage/deep-cleaning-packages
 * Body:
 * {
 *   cityId,
 *   category,
 *   subcategory,
 *   service?,
 *   totalAmount,
 *   coinsForVendor,
 *   teamMembers,
 *   durationMinutes
 * }
 *
 * ✅ Behavior:
 * - If identity exists and cityConfig exists -> update it
 * - If identity exists but cityConfig not present -> push new cityConfig
 * - If identity does not exist -> create new package doc
 */
exports.createPackage = async (req, res) => {
  try {
    let {
      cityId,
      category,
      subcategory,
      service = "",
      totalAmount,
      coinsForVendor,
      teamMembers,
      durationMinutes,
    } = req.body;

    if (!cityId) {
      return res
        .status(400)
        .json({ success: false, message: "cityId is required" });
    }

    category = norm(category);
    subcategory = norm(subcategory);
    service = norm(service);
    if (service === "_none") service = "";

    if (!category || !subcategory) {
      return res.status(400).json({
        success: false,
        message: "category and subcategory are required",
      });
    }

    // ✅ Validate combo from catalog
    if (!isValidCombo(category, subcategory, service)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category/subcategory/service combination.",
      });
    }

    // ✅ Validate required city config inputs
    if (durationMinutes === undefined || Number(durationMinutes) < 30) {
      return res.status(400).json({
        success: false,
        message: "durationMinutes is required and must be >= 30",
      });
    }

    if (teamMembers === undefined || Number(teamMembers) < 1) {
      return res.status(400).json({
        success: false,
        message: "teamMembers must be at least 1",
      });
    }

    const cityDoc = await City.findById(cityId).lean();
    if (!cityDoc) {
      return res
        .status(404)
        .json({ success: false, message: "City not found" });
    }

    const cityName = pickCityName(cityDoc) || "unknown";

    const cfg = {
      cityId: toObjectId(cityId),
      city: cityName,
      totalAmount: Number(totalAmount ?? 0),
      coinsForVendor: Number(coinsForVendor ?? 0),
      teamMembers: Number(teamMembers),
      durationMinutes: Number(durationMinutes),
    };

    const name = computeName(subcategory, service);

    // ✅ 1) If identity + cityConfig exists -> update that array element
    const updatedExistingCity = await DeepCleaningPackage.findOneAndUpdate(
      {
        category,
        subcategory,
        service,
        "cityConfigs.cityId": toObjectId(cityId),
      },
      {
        $set: {
          name,
          "cityConfigs.$.city": cfg.city,
          "cityConfigs.$.totalAmount": cfg.totalAmount,
          "cityConfigs.$.coinsForVendor": cfg.coinsForVendor,
          "cityConfigs.$.teamMembers": cfg.teamMembers,
          "cityConfigs.$.durationMinutes": cfg.durationMinutes,
        },
      },
      { new: true, runValidators: true },
    );

    if (updatedExistingCity) {
      await syncDeepCleaningCatalogByName(updatedExistingCity, cityId);
      return res.status(200).json({
        success: true,
        data: flattenForCity(updatedExistingCity, cityId),
      });
    }

    // ✅ 2) If identity exists but cityConfig not present -> push new city config
    const upserted = await DeepCleaningPackage.findOneAndUpdate(
      { category, subcategory, service },
      {
        $setOnInsert: { category, subcategory, service, name },
        $push: { cityConfigs: cfg },
      },
      { new: true, upsert: true, runValidators: true },
    );

    await syncDeepCleaningCatalogByName(upserted, cityId);

    return res.status(201).json({
      success: true,
      data: flattenForCity(upserted, cityId),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A package for this category/subcategory/service already exists.",
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Failed to create package.",
    });
  }
};

/* ===================== LIST PACKAGES ===================== */
/**
 * GET /api/deeppackage/deep-cleaning-packages
 * Query:
 *  cityId, category, subcategory, service, page, limit
 *
 * ✅ City filter uses: cityConfigs.cityId
 * ✅ Response flattens fields if cityId is passed (for old UI)
 */
exports.listPackages = async (req, res) => {
  try {
    const { cityId, category, subcategory, service, page, limit } = req.query;

    const filter = {};

    if (cityId) filter["cityConfigs.cityId"] = toObjectId(cityId);
    if (category) filter.category = norm(category);
    if (subcategory) filter.subcategory = norm(subcategory);

    if (service !== undefined) {
      let s = norm(service);
      if (s === "_none") s = "";
      filter.service = s;
    }

    const hasPagination =
      page !== undefined &&
      limit !== undefined &&
      Number(page) > 0 &&
      Number(limit) > 0;

    const query = DeepCleaningPackage.find(filter).sort({
      category: 1,
      subcategory: 1,
      service: 1,
    });

    if (hasPagination) {
      const skip = (Number(page) - 1) * Number(limit);

      const [itemsRaw, total] = await Promise.all([
        query.skip(skip).limit(Number(limit)),
        DeepCleaningPackage.countDocuments(filter),
      ]);

      const items = cityId
        ? itemsRaw.map((d) => flattenForCity(d, cityId))
        : itemsRaw;

      return res.json({
        success: true,
        data: items,
        page: Number(page),
        limit: Number(limit),
        total,
      });
    }

    const [itemsRaw, total] = await Promise.all([
      query,
      DeepCleaningPackage.countDocuments(filter),
    ]);

    const items = cityId
      ? itemsRaw.map((d) => flattenForCity(d, cityId))
      : itemsRaw;

    return res.json({ success: true, data: items, total });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to list packages.",
    });
  }
};

/* ===================== GET PACKAGE ===================== */
// GET /api/deeppackage/deep-cleaning-packages/:id?cityId=...
exports.getPackageById = async (req, res) => {
  try {
    const { cityId } = req.query;

    const doc = await DeepCleaningPackage.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Package not found.",
      });
    }

    return res.json({ success: true, data: flattenForCity(doc, cityId) });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to fetch package.",
    });
  }
};

/* ===================== UPDATE PACKAGE ===================== */
/**
 * PUT /api/deeppackage/deep-cleaning-packages/:id
 *
 * Body recommended:
 * {
 *   cityId, // required to update city config (for now)
 *   totalAmount?, coinsForVendor?, teamMembers?, durationMinutes?,
 *   category?, subcategory?, service?
 * }
 *
 * ✅ Updates cityConfig by cityId using arrayFilters
 */
// exports.updatePackage = async (req, res) => {
//   try {
//     let {
//       cityId,
//       category,
//       subcategory,
//       service,
//       totalAmount,
//       coinsForVendor,
//       teamMembers,
//       durationMinutes,
//     } = req.body;

//     const existing = await DeepCleaningPackage.findById(req.params.id);
//     if (!existing) {
//       return res.status(404).json({
//         success: false,
//         message: "Package not found.",
//       });
//     }

//     if (!cityId) {
//       return res.status(400).json({
//         success: false,
//         message: "cityId is required to update city pricing/config.",
//       });
//     }

//     const n1 = (v) =>
//       v === undefined || v === null ? undefined : String(v).trim();
//     category = n1(category);
//     subcategory = n1(subcategory);
//     service = n1(service);
//     if (service === "_none") service = "";

//     const newCategory = category ?? existing.category;
//     const newSubcategory = subcategory ?? existing.subcategory;
//     const newService = service ?? existing.service;

//     const identityChanged =
//       (category !== undefined && norm(category) !== norm(existing.category)) ||
//       (subcategory !== undefined &&
//         norm(subcategory) !== norm(existing.subcategory)) ||
//       (service !== undefined && norm(service) !== norm(existing.service));

//     if (identityChanged) {
//       const ok = isValidCombo(newCategory, newSubcategory, newService);
//       if (!ok) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid category/subcategory/service combination.",
//         });
//       }
//     }

//     if (durationMinutes !== undefined && Number(durationMinutes) < 30) {
//       return res.status(400).json({
//         success: false,
//         message: "durationMinutes must be >= 30",
//       });
//     }

//     if (teamMembers !== undefined && Number(teamMembers) < 1) {
//       return res.status(400).json({
//         success: false,
//         message: "teamMembers must be at least 1",
//       });
//     }

//     const $set = {};

//     // identity updates
//     if (category !== undefined) $set.category = category;
//     if (subcategory !== undefined) $set.subcategory = subcategory;
//     if (service !== undefined) $set.service = service;
//     if (identityChanged) $set.name = computeName(newSubcategory, newService);

//     // city config updates
//     if (totalAmount !== undefined)
//       $set["cityConfigs.$[c].totalAmount"] = Number(totalAmount);
//     if (coinsForVendor !== undefined)
//       $set["cityConfigs.$[c].coinsForVendor"] = Number(coinsForVendor);
//     if (teamMembers !== undefined)
//       $set["cityConfigs.$[c].teamMembers"] = Number(teamMembers);
//     if (durationMinutes !== undefined)
//       $set["cityConfigs.$[c].durationMinutes"] = Number(durationMinutes);

//     // optional: sync city display name from City collection
//     const cityDoc = await City.findById(cityId).lean();
//     if (cityDoc) {
//       const cityName = pickCityName(cityDoc);
//       if (cityName) $set["cityConfigs.$[c].city"] = cityName;
//     }

//     const updated = await DeepCleaningPackage.findByIdAndUpdate(
//       req.params.id,
//       { $set },
//       {
//         new: true,
//         runValidators: true,
//         arrayFilters: [{ "c.cityId": toObjectId(cityId) }],
//       },
//     );

//     if (!updated) {
//       return res.status(400).json({
//         success: false,
//         message: "Update failed.",
//       });
//     }

//     await syncDeepCleaningCatalogByName(updated, cityId);

//     return res.json({
//       success: true,
//       data: flattenForCity(updated, cityId),
//     });
//   } catch (err) {
//     if (err?.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message:
//           "A package for this category/subcategory/service already exists.",
//       });
//     }

//     return res.status(400).json({
//       success: false,
//       message: err.message || "Failed to update package.",
//     });
//   }
// };

// PUT /api/deeppackage/deep-cleaning-packages/:id/city-config
// Body: { cityId, totalAmount, coinsForVendor, teamMembers, durationMinutes }
exports.upsertPackageCityConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const { cityId, totalAmount, coinsForVendor, teamMembers, durationMinutes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid package id" });
    }
    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return res.status(400).json({ success: false, message: "Invalid cityId" });
    }

    const cityDoc = await City.findById(cityId).lean();
    if (!cityDoc) {
      return res.status(404).json({ success: false, message: "City not found" });
    }

    const payload = {
      cityId: new mongoose.Types.ObjectId(cityId),
      city: cityDoc.city,
      totalAmount: Number(totalAmount),
      coinsForVendor: Number(coinsForVendor),
      teamMembers: Number(teamMembers),
      durationMinutes: Number(durationMinutes),
    };

    // basic validations
    if (!Number.isFinite(payload.totalAmount) || payload.totalAmount < 0)
      return res.status(400).json({ success: false, message: "Invalid totalAmount" });

    if (!Number.isFinite(payload.coinsForVendor) || payload.coinsForVendor < 0)
      return res.status(400).json({ success: false, message: "Invalid coinsForVendor" });

    if (!Number.isFinite(payload.teamMembers) || payload.teamMembers < 1)
      return res.status(400).json({ success: false, message: "Invalid teamMembers" });

    if (!Number.isFinite(payload.durationMinutes) || payload.durationMinutes < 30)
      return res.status(400).json({ success: false, message: "Invalid durationMinutes" });

    // 1) Try update existing cityConfig
    const updated = await DeepCleaningPackage.findOneAndUpdate(
      { _id: id, "cityConfigs.cityId": payload.cityId },
      {
        $set: {
          "cityConfigs.$.city": payload.city,
          "cityConfigs.$.totalAmount": payload.totalAmount,
          "cityConfigs.$.coinsForVendor": payload.coinsForVendor,
          "cityConfigs.$.teamMembers": payload.teamMembers,
          "cityConfigs.$.durationMinutes": payload.durationMinutes,
        },
      },
      { new: true }
    ).lean();

    if (updated) {
      return res.json({ success: true, message: "City config updated", data: updated });
    }

    // 2) Else push new cityConfig
    const pushed = await DeepCleaningPackage.findByIdAndUpdate(
      id,
      { $push: { cityConfigs: payload } },
      { new: true }
    ).lean();

    if (!pushed) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    return res.json({ success: true, message: "City config added", data: pushed });
  } catch (err) {
    console.error("upsertPackageCityConfig error:", err);
    return res.status(500).json({ success: false, message: "Failed to save city config" });
  }
};
/* ===================== DELETE PACKAGE ===================== */
// DELETE /api/deeppackage/deep-cleaning-packages/:id
exports.deletePackage = async (req, res) => {
  try {
    const doc = await DeepCleaningPackage.findByIdAndDelete(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Package not found.",
      });
    }

    return res.json({
      success: true,
      message: "Deleted successfully.",
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to delete package.",
    });
  }
};

// GET /api/deeppackage/deep-cleaning-packages/by-city/:cityId
exports.getPackagesByCityIdFlat = async (req, res) => {
  try {
    const { cityId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return res.status(400).json({ success: false, message: "Invalid cityId" });
    }

    const cityDoc = await City.findById(cityId).lean();
    const cityName = cityDoc?.city || ""; // if you store city as "Pune"

    const list = await DeepCleaningPackage.aggregate([
      {
        $project: {
          category: 1,
          subcategory: 1,
          service: 1,
          name: 1,

          // ✅ pick only selected city's config
          cityCfg: {
            $first: {
              $filter: {
                input: "$cityConfigs",
                as: "c",
                cond: { $eq: ["$$c.cityId", new mongoose.Types.ObjectId(cityId)] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          cityId: new mongoose.Types.ObjectId(cityId),
          city: cityName,

          // ✅ if config exists -> value, else -> null (blank in UI)
          totalAmount: { $ifNull: ["$cityCfg.totalAmount", null] },
          coinsForVendor: { $ifNull: ["$cityCfg.coinsForVendor", null] },
          teamMembers: { $ifNull: ["$cityCfg.teamMembers", null] },
          durationMinutes: { $ifNull: ["$cityCfg.durationMinutes", null] },

          hasCityConfig: { $cond: [{ $ifNull: ["$cityCfg.cityId", false] }, true, false] },
        },
      },
      { $project: { cityCfg: 0 } },
      { $sort: { category: 1, subcategory: 1, service: 1 } },
    ]);

    return res.json({ success: true, data: list });
  } catch (err) {
    console.error("getPackagesByCityIdFlat error:", err);
    return res.status(500).json({ success: false, message: "Failed to load packages" });
  }
};

// GET /api/deeppackage/deep-cleaning-packages/by-city-name/:city
exports.getPackagesByCityNameFlat = async (req, res) => {
  try {
    const { city } = req.params;

    if (!city) {
      return res.status(400).json({ success: false, message: "city is required" });
    }

    const cityNorm = String(city).trim().toLowerCase();

    // Match packages where any cityConfigs.city equals the provided city (case-insensitive)
    const filter = { "cityConfigs.city": { $regex: `^${cityNorm}$`, $options: "i" } };

    const totalPackages = await DeepCleaningPackage.countDocuments(filter);
    const packages = await DeepCleaningPackage.find(filter).lean();

    const flat = packages.flatMap((pkg) => {
      const cfgs = (pkg.cityConfigs || []).filter(
        (c) => String(c.city).trim().toLowerCase() === cityNorm,
      );

      return cfgs.map((cfg) => ({
        _id: pkg._id,
        category: pkg.category,
        subcategory: pkg.subcategory,
        service: pkg.service,
        name: pkg.name,
        createdAt: pkg.createdAt,
        updatedAt: pkg.updatedAt,

        cityId: cfg.cityId,
        city: cfg.city,
        totalAmount: cfg.totalAmount,
        coinsForVendor: cfg.coinsForVendor,
        teamMembers: cfg.teamMembers,
        durationMinutes: cfg.durationMinutes,
      }));
    });

    return res.json({
      success: true,
      data: flat,
      total: totalPackages,
      returned: flat.length,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to fetch packages by city.",
    });
  }
};
/* ===================== SYNC CATALOG CONFIG ===================== */
/**
 * ✅ Updated:
 * uses cityConfigs entry instead of root totalAmount/teamMembers/etc.
 */
async function syncDeepCleaningCatalogByName(updatedPkg, cityId) {
  try {
    const computedName =
      updatedPkg.name ||
      (updatedPkg.service
        ? `${updatedPkg.subcategory} - ${updatedPkg.service}`
        : updatedPkg.subcategory);

    const cfg =
      (updatedPkg.cityConfigs || []).find(
        (c) => String(c.cityId) === String(cityId),
      ) || (updatedPkg.cityConfigs || [])[0];

    if (!cfg) return;

    const config = await CleaningCatalogConfig.findOne({
      serviceType: "deep_cleaning",
    });
    if (!config?.data) return;

    let found = false;

    for (const categoryKey of Object.keys(config.data)) {
      const items = config.data[categoryKey];
      if (!Array.isArray(items)) continue;

      for (let i = 0; i < items.length; i++) {
        if (
          String(items[i]?.name || "").trim() === String(computedName).trim()
        ) {
          items[i].price = Number(cfg.totalAmount) || 0;
          items[i].teamMembers = Number(cfg.teamMembers) || 0;
          items[i].duration = Number(cfg.durationMinutes) || 0;
          items[i].coinsForVendor = Number(cfg.coinsForVendor) || 0;
          found = true;
          break;
        }
      }

      if (found) break;
    }

    if (found) {
      config.markModified("data");
      await config.save();
    }
  } catch (err) {
    console.error("Catalog sync failed:", err.message);
  }
}
