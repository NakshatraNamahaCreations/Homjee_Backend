// controllers/deepCleaning.controller.js
const DeepCleaningPackage = require("../../models/products/DeepCleaningPackage");
const {
  CATALOG,
  getSubcategories,
  getServices,
  isValidCombo,
} = require("../../data/deepCleaningCatalog");

// GET /api/deep-cleaning-catalog
exports.getCatalog = async (req, res) => {
  res.json({ success: true, data: CATALOG });
};

// POST /api/deep-cleaning-packages
exports.createPackage = async (req, res) => {
  try {
    // const { category, subcategory, service = "", totalAmount, bookingAmount, coinsForVendor, teamMembers } = req.body;
    const {
      category,
      subcategory,
      service = "",
      totalAmount,
      coinsForVendor,
      teamMembers,
    } = req.body;

    if (!isValidCombo(category, subcategory, service)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category/subcategory/service combination.",
      });
    }

    const pkg = await DeepCleaningPackage.create({
      category,
      subcategory,
      service,
      totalAmount,
      // bookingAmount,
      coinsForVendor,
      teamMembers,
    });

    return res.status(201).json({ success: true, data: pkg });
  } catch (err) {
    // Duplicate key or other validation
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A package for this category/subcategory/service already exists.",
      });
    }
    return res
      .status(400)
      .json({
        success: false,
        message: err.message || "Failed to create package.",
      });
  }
};

// GET /api/deep-cleaning-packages
// Filters: ?category=&subcategory=&service=&page=&limit=
exports.listPackages = async (req, res) => {
  try {
    const { category, subcategory, service, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (subcategory) filter.subcategory = subcategory;

    // Allow empty service filter with special "_none" (optional). If client sends empty string, we match empty service.
    if (service !== undefined) {
      if (service === "" || service === "_none") {
        filter.service = "";
      } else {
        filter.service = service;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      DeepCleaningPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      DeepCleaningPackage.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: items,
      page: Number(page),
      limit: Number(limit),
      total,
    });
  } catch (err) {
    res
      .status(400)
      .json({
        success: false,
        message: err.message || "Failed to list packages.",
      });
  }
};

// GET /api/deep-cleaning-packages/:id
exports.getPackageById = async (req, res) => {
  try {
    const doc = await DeepCleaningPackage.findById(req.params.id);
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, data: doc });
  } catch (err) {
    res
      .status(400)
      .json({
        success: false,
        message: err.message || "Failed to fetch package.",
      });
  }
};

// PUT /api/deep-cleaning-packages/:id
exports.updatePackage = async (req, res) => {
  try {
    // const { category, subcategory, service = "", totalAmount, bookingAmount, coinsForVendor, teamMembers } = req.body;
    const {
      category,
      subcategory,
      service = "",
      totalAmount,
      coinsForVendor,
      teamMembers,
    } = req.body;

    if (category || subcategory || service !== undefined) {
      // If any of these changed, validate the combo (merge with existing doc to check correctly)
      const existing = await DeepCleaningPackage.findById(req.params.id);
      if (!existing)
        return res.status(404).json({ success: false, message: "Not found." });

      const newCategory = category ?? existing.category;
      const newSubcategory = subcategory ?? existing.subcategory;
      const newService = service ?? existing.service;

      if (!isValidCombo(newCategory, newSubcategory, newService)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid category/subcategory/service combination.",
          });
      }
    }

    const updated = await DeepCleaningPackage.findByIdAndUpdate(
      req.params.id,
      {
        category,
        subcategory,
        service,
        totalAmount,
        // bookingAmount,
        coinsForVendor,
        teamMembers,
      },
      { new: true, runValidators: true }
    );

    if (!updated)
      return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A package for this category/subcategory/service already exists.",
      });
    }
    res
      .status(400)
      .json({
        success: false,
        message: err.message || "Failed to update package.",
      });
  }
};

// DELETE /api/deep-cleaning-packages/:id
exports.deletePackage = async (req, res) => {
  try {
    const doc = await DeepCleaningPackage.findByIdAndDelete(req.params.id);
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, message: "Deleted successfully." });
  } catch (err) {
    res
      .status(400)
      .json({
        success: false,
        message: err.message || "Failed to delete package.",
      });
  }
};
