const packageSchema = require("../../models/servicePackage/package-details");

exports.createPackage = async (req, res) => {
  try {
    if (!req.files || !req.files.packageImage) {
      return res.status(400).json({ message: "Package images are required" });
    }

    const packageImageUrls = req.files.packageImage.map((file) => file.path);
    console.log("packageImageUrls:", packageImageUrls);

    const newPackage = new packageSchema({
      serviceType: req.body.serviceType,
      packageImage: packageImageUrls,
    });

    await newPackage.save();

    res
      .status(201)
      .json({ message: "Package created successfully", newPackage });
  } catch (error) {
    console.error("Error creating newPackage:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: "Validation error",
        error: error.errors,
      });
    }
    return res.status(500).json({
      message: "Server error",
      error: error.message || String(error),
      stack: error.stack,
    });
  }
};

exports.getPackagesByServiceType = async (req, res) => {
  try {
    let subCategories = req.query.subCategory;

    // Ensure subCategories is always an array
    if (!subCategories) {
      return res.status(400).json({ message: "subCategory query is required" });
    }

    if (!Array.isArray(subCategories)) {
      subCategories = [subCategories]; // wrap single value in array
    }

    const packages = await packageSchema.find({
      serviceType: { $in: subCategories },
    });

    if (packages.length === 0) {
      return res.status(404).json({ message: "No packages found" });
    }

    res.status(200).json({
      status: true,
      message: "Packages found",
      packages,
    });
  } catch (error) {
    console.error("Error in getPackagesByServiceType:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAllPackages = async (req, res) => {
  try {
    const packages = await packageSchema.find();

    if (!packages) {
      return res.status(404).json({ message: "packages not found" });
    }

    res.status(200).json({ packages });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ message: "Server error" });
  }
};
