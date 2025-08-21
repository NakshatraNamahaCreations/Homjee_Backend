// const Product = require("../../models/products/Product");

// exports.addPaint = async (req, res) => {
//   try {
//     const {
//       isSpecial,
//       name,
//       price,
//       description,
//       type,
//       includePuttyOnFresh,
//       includePuttyOnRepaint,
//     } = req.body;

//     const newPaint = {
//       isSpecial,
//       name,
//       price,
//       description,
//       type,
//       includePuttyOnFresh,
//       includePuttyOnRepaint,
//     };

//     let productDoc = await Product.findOne();
//     if (!productDoc) {
//       productDoc = new Product();
//     }

//     productDoc.paint.push(newPaint);
//     await productDoc.save();

//     res.status(201).json({
//       message: "Paint added successfully",
//       data: productDoc.paint[productDoc.paint.length - 1],
//     });
//   } catch (error) {
//     console.error("Error adding paint:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.getAllProducts = async (req, res) => {
//   try {
//     const productDoc = await Product.find();
//     if (!productDoc.length === 0) {
//       return res.status(404).json({ message: "No product found" });
//     }
//     res.json({ product: productDoc });
//   } catch (error) {
//     console.error("Error fetching product:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.getAllPaints = async (req, res) => {
//   try {
//     const productDoc = await Product.findOne();
//     if (!productDoc || productDoc.paint.length === 0) {
//       return res.status(404).json({ message: "No paints found" });
//     }

//     res.json({ paints: productDoc.paint });
//   } catch (error) {
//     console.error("Error fetching paints:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.updatePaint = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const updates = req.body;

//     const productDoc = await Product.findOne();
//     if (!productDoc) {
//       return res.status(404).json({ message: "Product document not found" });
//     }

//     const paint = productDoc.paint.id(id);
//     if (!paint) {
//       return res.status(404).json({ message: "Paint not found" });
//     }

//     Object.assign(paint, updates); // merge updates
//     await productDoc.save();

//     res.json({ message: "Paint updated successfully", data: paint });
//   } catch (error) {
//     console.error("Error updating paint:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.deletePaint = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const productDoc = await Product.findOne();
//     if (!productDoc) {
//       return res.status(404).json({ message: "Product document not found" });
//     }

//     const paint = productDoc.paint.id(id);
//     if (!paint) {
//       return res.status(404).json({ message: "Paint not found" });
//     }

//     paint.remove();
//     await productDoc.save();

//     res.json({ message: "Paint deleted successfully" });
//   } catch (error) {
//     console.error("Error deleting paint:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.addPackage = async (req, res) => {
//   try {
//     const { packageName, packagePrice, details } = req.body;

//     const newPackage = {
//       packageName,
//       packagePrice,
//       details, // should be array of { packageName, price, sqft }
//     };

//     let productDoc = await Product.findOne();
//     if (!productDoc) {
//       productDoc = new Product();
//     }

//     productDoc.package.push(newPackage);
//     await productDoc.save();

//     res.status(201).json({
//       message: "Package added successfully",
//       data: productDoc.package[productDoc.package.length - 1],
//     });
//   } catch (error) {
//     console.error("Error adding package:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.getAllPackages = async (req, res) => {
//   try {
//     const packagesDoc = await Product.findOne();
//     if (!packagesDoc || packagesDoc.package.length === 0) {
//       return res.status(404).json({ message: "No package found" });
//     }

//     res.json({ package: packagesDoc.package });
//   } catch (error) {
//     console.error("Error fetching package:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };




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
      productType,
    } = req.body;

    if (!name || !price || !type || !productType) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newPaint = {
      isSpecial: isSpecial || type === "Special",
      name,
      price: Number(price),
      description: description || "",
      type,
      includePuttyOnFresh: includePuttyOnFresh ?? (type === "Normal" && productType === "Paints"),
      includePuttyOnRepaint: includePuttyOnRepaint ?? false,
      productType,
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
    if (!productDoc || !productDoc.paint || productDoc.paint.length === 0) {
      return res.status(404).json({ message: "No paints found" });
    }

    const paints = productDoc.paint.filter(p => p.productType === "Paints" || !p.productType);
    res.json({ paints });
  } catch (error) {
    console.error("Error fetching paints:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updatePaint = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      isSpecial,
      name,
      price,
      description,
      type,
      includePuttyOnFresh,
      includePuttyOnRepaint,
      productType,
    } = req.body;

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({ message: "Product document not found" });
    }

    const paint = productDoc.paint.id(id);
    if (!paint) {
      return res.status(404).json({ message: "Paint not found" });
    }

    paint.isSpecial = isSpecial || type === "Special";
    paint.name = name || paint.name;
    paint.price = price ? Number(price) : paint.price;
    paint.description = description || paint.description;
    paint.type = type || paint.type;
    paint.includePuttyOnFresh = includePuttyOnFresh ?? (type === "Normal" && productType === "Paints");
    paint.includePuttyOnRepaint = includePuttyOnRepaint ?? false;
    paint.productType = productType || paint.productType;

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

    productDoc.paint.pull({ _id: id });
    await productDoc.save();

    res.json({ message: "Paint deleted successfully" });
  } catch (error) {
    console.error("Error deleting paint:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.addPackage = async (req, res) => {
  try {
    const { packageName, details } = req.body;

    if (!packageName || !details || !Array.isArray(details)) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Calculate packagePrice as the sum of paintPrice from details
    const packagePrice = details.reduce((sum, detail) => sum + (Number(detail.paintPrice) || 0), 0);

    const newPackage = {
      packageName,
      packagePrice,
      details,
      productType: "Packages",
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
    const productDoc = await Product.findOne();
    if (!productDoc || !productDoc.package || productDoc.package.length === 0) {
      return res.status(404).json({ message: "No packages found" });
    }

    res.json({ data: productDoc.package });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const { packageName, details } = req.body;

    if (!packageName || !details || !Array.isArray(details)) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({ message: "Product document not found" });
    }

    const pkg = productDoc.package.id(id);
    if (!pkg) {
      return res.status(404).json({ message: "Package not found" });
    }

    // Calculate packagePrice as the sum of paintPrice from details
    const packagePrice = details.reduce((sum, detail) => sum + (Number(detail.paintPrice) || 0), 0);

    pkg.packageName = packageName;
    pkg.packagePrice = packagePrice;
    pkg.details = details;
    pkg.productType = "Packages";

    await productDoc.save();

    res.json({ message: "Package updated successfully", data: pkg });
  } catch (error) {
    console.error("Error updating package:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.deletePackage = async (req, res) => {
  try {
    const { id } = req.params;

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({ message: "Product document not found" });
    }

    const pkg = productDoc.package.id(id);
    if (!pkg) {
      return res.status(404).json({ message: "Package not found" });
    }

    productDoc.package.pull({ _id: id });
    await productDoc.save();

    res.json({ message: "Package deleted successfully" });
  } catch (error) {
    console.error("Error deleting package:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getProductsByType = async (req, res) => {
  try {
    const { productType } = req.query;
    const productDoc = await Product.findOne();

    if (!productDoc) {
      return res.status(404).json({ message: "No products found" });
    }

    let data;
    if (productType === "Packages") {
      data = productDoc.package;
    } else {
      data = productDoc.paint.filter(
        (p) => p.productType === productType || (productType === "Paints" && !p.productType)
      );
    }

    res.json({ data });
  } catch (error) {
    console.error("Error fetching products by type:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
