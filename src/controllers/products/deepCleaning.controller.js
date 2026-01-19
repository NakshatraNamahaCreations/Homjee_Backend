// controllers/deepCleaning.controller.js
const DeepCleaningPackage = require("../../models/products/DeepCleaningPackage");
const {
  CATALOG,
  isValidCombo,
} = require("../../data/deepCleaningCatalog");

const CleaningCatalogConfig = require("../../models/servicePackage/CleaningCatalogConfig"); // adjust path


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

// POST /api/deep-cleaning-packages
exports.createPackage = async (req, res) => {
  try {
    const {
      category,
      subcategory,
      service = "",
      totalAmount,
      coinsForVendor,
      teamMembers,
      durationMinutes, // ✅ NEW
    } = req.body;

    /* ---------- VALIDATIONS ---------- */

    if (!isValidCombo(category, subcategory, service)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category/subcategory/service combination.",
      });
    }

    if (!durationMinutes || durationMinutes < 30) {
      return res.status(400).json({
        success: false,
        message: "durationMinutes is required and must be >= 30",
      });
    }

    if (!teamMembers || teamMembers < 1) {
      return res.status(400).json({
        success: false,
        message: "teamMembers must be at least 1",
      });
    }

    /* ---------- CREATE ---------- */

    const pkg = await DeepCleaningPackage.create({
      category,
      subcategory,
      service,
      totalAmount,
      coinsForVendor,
      teamMembers,
      durationMinutes, // ✅ STORED
    });

    return res.status(201).json({
      success: true,
      data: pkg,
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

// GET /api/deep-cleaning-packages
exports.listPackages = async (req, res) => {
  try {
    const { category, subcategory, service, page, limit } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (subcategory) filter.subcategory = subcategory;

    if (service !== undefined) {
      filter.service = service === "" || service === "_none" ? "" : service;
    }

    const hasPagination =
      page !== undefined &&
      limit !== undefined &&
      Number.isFinite(Number(page)) &&
      Number.isFinite(Number(limit)) &&
      Number(page) > 0 &&
      Number(limit) > 0;

    const query = DeepCleaningPackage.find(filter).sort({ createdAt: -1 });

    let items = [];
    let total = 0;

    if (hasPagination) {
      const skip = (Number(page) - 1) * Number(limit);

      const [pagedItems, count] = await Promise.all([
        query.skip(skip).limit(Number(limit)),
        DeepCleaningPackage.countDocuments(filter),
      ]);

      items = pagedItems;
      total = count;

      return res.json({
        success: true,
        data: items,
        page: Number(page),
        limit: Number(limit),
        total,
      });
    }

    // ✅ No pagination requested -> return all
    const [allItems, count] = await Promise.all([
      query,
      DeepCleaningPackage.countDocuments(filter),
    ]);

    items = allItems;
    total = count;

    return res.json({
      success: true,
      data: items,
      total,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to list packages.",
    });
  }
};


/* ===================== GET PACKAGE ===================== */

// GET /api/deep-cleaning-packages/:id
exports.getPackageById = async (req, res) => {
  try {
    const doc = await DeepCleaningPackage.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Package not found.",
      });
    }

    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to fetch package.",
    });
  }
};

/* ===================== UPDATE PACKAGE ===================== */

// PUT /api/deep-cleaning-packages/:id
// exports.updatePackage = async (req, res) => {
//   try {
//     const {
//       category,
//       subcategory,
//       service = "",
//       totalAmount,
//       coinsForVendor,
//       teamMembers,
//       durationMinutes, // ✅ NEW
//     } = req.body;

//     const existing = await DeepCleaningPackage.findById(req.params.id);
//     if (!existing) {
//       return res.status(404).json({
//         success: false,
//         message: "Package not found.",
//       });
//     }

//     /* ---------- VALIDATE COMBO IF CHANGED ---------- */

//     if (category || subcategory || service !== undefined) {
//       const newCategory = category ?? existing.category;
//       const newSubcategory = subcategory ?? existing.subcategory;
//       const newService = service ?? existing.service;

//       if (!isValidCombo(newCategory, newSubcategory, newService)) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid category/subcategory/service combination.",
//         });
//       }
//     }

//     if (durationMinutes !== undefined && durationMinutes < 30) {
//       return res.status(400).json({
//         success: false,
//         message: "durationMinutes must be >= 30",
//       });
//     }

//     const updated = await DeepCleaningPackage.findByIdAndUpdate(
//       req.params.id,
//       {
//         category,
//         subcategory,
//         service,
//         totalAmount,
//         coinsForVendor,
//         teamMembers,
//         durationMinutes, // ✅ UPDATED
//       },
//       { new: true, runValidators: true }
//     );

//     return res.json({
//       success: true,
//       data: updated,
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


exports.updatePackage = async (req, res) => {
  try {
    let {
      category,
      subcategory,
      service,
      totalAmount,
      coinsForVendor,
      teamMembers,
      durationMinutes,
    } = req.body;

    const existing = await DeepCleaningPackage.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Package not found.",
      });
    }

    // ✅ normalize incoming strings
    const norm = (v) => (v === undefined || v === null ? undefined : String(v).trim());
    category = norm(category);
    subcategory = norm(subcategory);
    service = norm(service);

    // your UI sometimes sends _none or "" for no service
    if (service === "_none") service = "";

    // ✅ check if combo ACTUALLY changed (not just present in req.body)
    const comboActuallyChanged =
      (category !== undefined && category !== String(existing.category || "").trim()) ||
      (subcategory !== undefined && subcategory !== String(existing.subcategory || "").trim()) ||
      (service !== undefined && service !== String(existing.service || "").trim());

    // ✅ validate combo only if changed
    if (comboActuallyChanged) {
      const newCategory = category ?? existing.category;
      const newSubcategory = subcategory ?? existing.subcategory;
      const newService = service ?? existing.service;

      const ok = await isValidComboFromCatalogConfig(newCategory, newSubcategory, newService);
      if (!ok) {
        return res.status(400).json({
          success: false,
          message: "Invalid category/subcategory/service combination.",
        });
      }
    }

    // ✅ validate duration only if provided
    if (durationMinutes !== undefined && Number(durationMinutes) < 30) {
      return res.status(400).json({
        success: false,
        message: "durationMinutes must be >= 30",
      });
    }

    // ✅ update only provided fields
    const updateFields = {};

    if (category !== undefined) updateFields.category = category;
    if (subcategory !== undefined) updateFields.subcategory = subcategory;
    if (service !== undefined) updateFields.service = service;

    if (totalAmount !== undefined) updateFields.totalAmount = Number(totalAmount);
    if (coinsForVendor !== undefined) updateFields.coinsForVendor = Number(coinsForVendor);
    if (teamMembers !== undefined) updateFields.teamMembers = Number(teamMembers);
    if (durationMinutes !== undefined) updateFields.durationMinutes = Number(durationMinutes);

    const updated = await DeepCleaningPackage.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    // ✅ Sync catalog config by name (same as you wanted)
    await syncDeepCleaningCatalogByName(updated);

    return res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A package for this category/subcategory/service already exists.",
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Failed to update package.",
    });
  }
};

/* ✅ Validate combo from CleaningCatalogConfig (reliable) */
async function isValidComboFromCatalogConfig(category, subcategory, service) {
  try {
    const c = String(category || "").trim();
    const sc = String(subcategory || "").trim();
    const sv = String(service || "").trim();

    const computedName = sv ? `${sc} - ${sv}` : sc;

    const config = await CleaningCatalogConfig.findOne({ serviceType: "deep_cleaning" });
    if (!config?.data) return false;

    const list = config.data[c];
    if (!Array.isArray(list)) return false;

    return list.some((it) => String(it?.name || "").trim() === computedName);
  } catch (e) {
    console.error("isValidComboFromCatalogConfig error:", e.message);
    return false;
  }
}

/* ✅ Sync data by name */
async function syncDeepCleaningCatalogByName(updatedPkg) {
  try {
    const computedName =
      updatedPkg.name ||
      (updatedPkg.service
        ? `${updatedPkg.subcategory} - ${updatedPkg.service}`
        : updatedPkg.subcategory);

    const config = await CleaningCatalogConfig.findOne({ serviceType: "deep_cleaning" });
    if (!config?.data) return;

    let found = false;

    for (const categoryKey of Object.keys(config.data)) {
      const items = config.data[categoryKey];
      if (!Array.isArray(items)) continue;

      for (let i = 0; i < items.length; i++) {
        if (String(items[i]?.name || "").trim() === String(computedName).trim()) {
          items[i].price = Number(updatedPkg.totalAmount) || 0;
          items[i].teamMembers = Number(updatedPkg.teamMembers) || 0;
          items[i].duration = Number(updatedPkg.durationMinutes) || 0;
          items[i].coinsForVendor = Number(updatedPkg.coinsForVendor) || 0;
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



/* ===================== DELETE PACKAGE ===================== */

// DELETE /api/deep-cleaning-packages/:id
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

// // controllers/deepCleaning.controller.js
// const DeepCleaningPackage = require("../../models/products/DeepCleaningPackage");
// const {
//   CATALOG,
//   getSubcategories,
//   getServices,
//   isValidCombo,
// } = require("../../data/deepCleaningCatalog");

// // GET /api/deep-cleaning-catalog
// exports.getCatalog = async (req, res) => {
//   res.json({ success: true, data: CATALOG });
// };

// // POST /api/deep-cleaning-packages
// exports.createPackage = async (req, res) => {
//   try {
//     // const { category, subcategory, service = "", totalAmount, bookingAmount, coinsForVendor, teamMembers } = req.body;
//     const {
//       category,
//       subcategory,
//       service = "",
//       totalAmount,
//       coinsForVendor,
//       teamMembers,
//     } = req.body;

//     if (!isValidCombo(category, subcategory, service)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid category/subcategory/service combination.",
//       });
//     }

//     const pkg = await DeepCleaningPackage.create({
//       category,
//       subcategory,
//       service,
//       totalAmount,
//       // bookingAmount,
//       coinsForVendor,
//       teamMembers,
//     });

//     return res.status(201).json({ success: true, data: pkg });
//   } catch (err) {
//     // Duplicate key or other validation
//     if (err?.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message:
//           "A package for this category/subcategory/service already exists.",
//       });
//     }
//     return res
//       .status(400)
//       .json({
//         success: false,
//         message: err.message || "Failed to create package.",
//       });
//   }
// };

// // GET /api/deep-cleaning-packages
// // Filters: ?category=&subcategory=&service=&page=&limit=
// exports.listPackages = async (req, res) => {
//   try {
//     const { category, subcategory, service, page = 1, limit = 20 } = req.query;

//     const filter = {};
//     if (category) filter.category = category;
//     if (subcategory) filter.subcategory = subcategory;

//     // Allow empty service filter with special "_none" (optional). If client sends empty string, we match empty service.
//     if (service !== undefined) {
//       if (service === "" || service === "_none") {
//         filter.service = "";
//       } else {
//         filter.service = service;
//       }
//     }

//     const skip = (Number(page) - 1) * Number(limit);

//     const [items, total] = await Promise.all([
//       DeepCleaningPackage.find(filter)
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(Number(limit)),
//       DeepCleaningPackage.countDocuments(filter),
//     ]);

//     res.json({
//       success: true,
//       data: items,
//       page: Number(page),
//       limit: Number(limit),
//       total,
//     });
//   } catch (err) {
//     res
//       .status(400)
//       .json({
//         success: false,
//         message: err.message || "Failed to list packages.",
//       });
//   }
// };

// // GET /api/deep-cleaning-packages/:id
// exports.getPackageById = async (req, res) => {
//   try {
//     const doc = await DeepCleaningPackage.findById(req.params.id);
//     if (!doc)
//       return res.status(404).json({ success: false, message: "Not found." });
//     res.json({ success: true, data: doc });
//   } catch (err) {
//     res
//       .status(400)
//       .json({
//         success: false,
//         message: err.message || "Failed to fetch package.",
//       });
//   }
// };

// // PUT /api/deep-cleaning-packages/:id
// exports.updatePackage = async (req, res) => {
//   try {
//     // const { category, subcategory, service = "", totalAmount, bookingAmount, coinsForVendor, teamMembers } = req.body;
//     const {
//       category,
//       subcategory,
//       service = "",
//       totalAmount,
//       coinsForVendor,
//       teamMembers,
//     } = req.body;

//     if (category || subcategory || service !== undefined) {
//       // If any of these changed, validate the combo (merge with existing doc to check correctly)
//       const existing = await DeepCleaningPackage.findById(req.params.id);
//       if (!existing)
//         return res.status(404).json({ success: false, message: "Not found." });

//       const newCategory = category ?? existing.category;
//       const newSubcategory = subcategory ?? existing.subcategory;
//       const newService = service ?? existing.service;

//       if (!isValidCombo(newCategory, newSubcategory, newService)) {
//         return res
//           .status(400)
//           .json({
//             success: false,
//             message: "Invalid category/subcategory/service combination.",
//           });
//       }
//     }

//     const updated = await DeepCleaningPackage.findByIdAndUpdate(
//       req.params.id,
//       {
//         category,
//         subcategory,
//         service,
//         totalAmount,
//         // bookingAmount,
//         coinsForVendor,
//         teamMembers,
//       },
//       { new: true, runValidators: true }
//     );

//     if (!updated)
//       return res.status(404).json({ success: false, message: "Not found." });
//     res.json({ success: true, data: updated });
//   } catch (err) {
//     if (err?.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message:
//           "A package for this category/subcategory/service already exists.",
//       });
//     }
//     res
//       .status(400)
//       .json({
//         success: false,
//         message: err.message || "Failed to update package.",
//       });
//   }
// };

// // DELETE /api/deep-cleaning-packages/:id
// exports.deletePackage = async (req, res) => {
//   try {
//     const doc = await DeepCleaningPackage.findByIdAndDelete(req.params.id);
//     if (!doc)
//       return res.status(404).json({ success: false, message: "Not found." });
//     res.json({ success: true, message: "Deleted successfully." });
//   } catch (err) {
//     res
//       .status(400)
//       .json({
//         success: false,
//         message: err.message || "Failed to delete package.",
//       });
//   }
// };
