const Product = require("../../models/products/Product");

exports.addPaint = async (req, res) => {
  try {
    const {
      isSpecial,
      name,
      price,
      description,
      type,
      includePuttyOnFresh,
      includePuttyOnRepaint,
    } = req.body;

    const newPaint = {
      isSpecial,
      name,
      price,
      description,
      type,
      includePuttyOnFresh,
      includePuttyOnRepaint,
    };

    let productDoc = await Product.findOne();
    if (!productDoc) {
      productDoc = new Product();
    }

    productDoc.paint.push(newPaint);
    await productDoc.save();

    res.status(201).json({
      message: "Paint added successfully",
      data: productDoc.paint[productDoc.paint.length - 1],
    });
  } catch (error) {
    console.error("Error adding paint:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getAllPaints = async (req, res) => {
  try {
    const productDoc = await Product.findOne();
    if (!productDoc || productDoc.paint.length === 0) {
      return res.status(404).json({ message: "No paints found" });
    }

    res.json({ paints: productDoc.paint });
  } catch (error) {
    console.error("Error fetching paints:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updatePaint = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({ message: "Product document not found" });
    }

    const paint = productDoc.paint.id(id);
    if (!paint) {
      return res.status(404).json({ message: "Paint not found" });
    }

    Object.assign(paint, updates); // merge updates
    await productDoc.save();

    res.json({ message: "Paint updated successfully", data: paint });
  } catch (error) {
    console.error("Error updating paint:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
exports.deletePaint = async (req, res) => {
  try {
    const { id } = req.params;

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({ message: "Product document not found" });
    }

    const paint = productDoc.paint.id(id);
    if (!paint) {
      return res.status(404).json({ message: "Paint not found" });
    }

    paint.remove();
    await productDoc.save();

    res.json({ message: "Paint deleted successfully" });
  } catch (error) {
    console.error("Error deleting paint:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.addPackage = async (req, res) => {
  try {
    const { packageName, packagePrice, details } = req.body;

    const newPackage = {
      packageName,
      packagePrice,
      details, // should be array of { packageName, price, sqft }
    };

    let productDoc = await Product.findOne();
    if (!productDoc) {
      productDoc = new Product();
    }

    productDoc.package.push(newPackage);
    await productDoc.save();

    res.status(201).json({
      message: "Package added successfully",
      data: productDoc.package[productDoc.package.length - 1],
    });
  } catch (error) {
    console.error("Error adding package:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getAllPackages = async (req, res) => {
  try {
    const packagesDoc = await Product.findOne();
    if (!packagesDoc || packagesDoc.package.length === 0) {
      return res.status(404).json({ message: "No package found" });
    }

    res.json({ package: packagesDoc.package });
  } catch (error) {
    console.error("Error fetching package:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
