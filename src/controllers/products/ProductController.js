// const Product = require("../../models/products/Product");

// /* ---------------------------
//   Helpers
// --------------------------- */
// const safeStr = (v) => String(v ?? "").trim();

// const matchCity = (docCity, city) => {
//   if (!city) return true; // if no city filter, return all
//   return safeStr(docCity).toLowerCase() === safeStr(city).toLowerCase();
// };

// const packageMatchesCity = (pkg, city) => {
//   if (!city) return true;
//   // your schema stores city inside details[]
//   const details = Array.isArray(pkg?.details) ? pkg.details : [];
//   return details.some((d) => matchCity(d?.city, city));
// };

// /* ---------------------------
//   Paints
// --------------------------- */
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
//       productType,
//       city,
//     } = req.body;

//     if (!name || price === undefined || !type || !productType || !city) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const newPaint = {
//       isSpecial: isSpecial ?? type === "Special",
//       name,
//       price: Number(price),
//       description: description || "",
//       type,
//       includePuttyOnFresh:
//         includePuttyOnFresh ??
//         (type === "Normal" && productType === "Paints"),
//       includePuttyOnRepaint: includePuttyOnRepaint ?? false,
//       productType,
//       city,
//     };

//     let productDoc = await Product.findOne();
//     if (!productDoc) productDoc = new Product();

//     productDoc.paint.push(newPaint);
//     await productDoc.save();

//     return res.status(201).json({
//       message: "Paint added successfully",
//       data: productDoc.paint[productDoc.paint.length - 1],
//     });
//   } catch (error) {
//     console.error("Error adding paint:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.getAllPaints = async (req, res) => {
//   try {
//     const { city } = req.query;

//     const productDoc = await Product.findOne();
//     if (!productDoc || !Array.isArray(productDoc.paint) || productDoc.paint.length === 0) {
//       return res.status(404).json({ message: "No paints found" });
//     }

//     const paints = productDoc.paint
//       .filter((p) => p.productType === "Paints" || !p.productType)
//       .filter((p) => matchCity(p.city, city));

//     return res.json({ paints });
//   } catch (error) {
//     console.error("Error fetching paints:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.updatePaint = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const {
//       name,
//       price,
//       description,
//       type,
//       productType,
//       includePuttyOnFresh,
//       includePuttyOnRepaint,
//       isSpecial,
//       city,
//     } = req.body;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "Product document not found" });

//     const paint = productDoc.paint.id(id);
//     if (!paint) return res.status(404).json({ message: "Paint not found" });

//     if (name !== undefined) paint.name = name;
//     if (price !== undefined) paint.price = Number(price);
//     if (description !== undefined) paint.description = description;
//     if (type !== undefined) paint.type = type;
//     if (productType !== undefined) paint.productType = productType;
//     if (includePuttyOnFresh !== undefined) paint.includePuttyOnFresh = !!includePuttyOnFresh;
//     if (includePuttyOnRepaint !== undefined) paint.includePuttyOnRepaint = !!includePuttyOnRepaint;
//     if (isSpecial !== undefined) paint.isSpecial = !!isSpecial;
//     if (city !== undefined) paint.city = city;

//     if (isSpecial === undefined && type !== undefined) {
//       paint.isSpecial = type === "Special";
//     }

//     await productDoc.save();
//     return res.json({ message: "Paint updated successfully", data: paint });
//   } catch (error) {
//     console.error("Error updating paint:", error);
//     return res.status(500).json({ message: "Internal Server Error", error: error.message });
//   }
// };

// exports.deletePaint = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "Product document not found" });

//     const paint = productDoc.paint.id(id);
//     if (!paint) return res.status(404).json({ message: "Paint not found" });

//     productDoc.paint.pull({ _id: id });
//     await productDoc.save();

//     return res.json({ message: "Paint deleted successfully" });
//   } catch (error) {
//     console.error("Error deleting paint:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// /* ---------------------------
//   Packages (city stored inside details[])
// --------------------------- */
// exports.addPackage = async (req, res) => {
//   try {
//     const { packageName, details } = req.body;

//     if (!packageName || !Array.isArray(details) || details.length === 0) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     // ✅ ensure each detail has city
//     const missingCity = details.some((d) => !d?.city);
//     if (missingCity) {
//       return res.status(400).json({ message: "City missing in package details" });
//     }

//     const packagePrice = details.reduce(
//       (sum, detail) => sum + (Number(detail.paintPrice) || 0),
//       0
//     );

//     const newPackage = {
//       packageName,
//       packagePrice,
//       details,
//       productType: "Packages",
//     };

//     let productDoc = await Product.findOne();
//     if (!productDoc) productDoc = new Product();

//     productDoc.package.push(newPackage);
//     await productDoc.save();

//     return res.status(201).json({
//       message: "Package added successfully",
//       data: productDoc.package[productDoc.package.length - 1],
//     });
//   } catch (error) {
//     console.error("Error adding package:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.getAllPackages = async (req, res) => {
//   try {
//     const { city } = req.query;

//     const productDoc = await Product.findOne();
//     if (!productDoc || !Array.isArray(productDoc.package) || productDoc.package.length === 0) {
//       return res.status(404).json({ message: "No packages found" });
//     }

//     const data = productDoc.package.filter((pkg) => packageMatchesCity(pkg, city));
//     return res.json({ data });
//   } catch (error) {
//     console.error("Error fetching packages:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.updatePackage = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { packageName, details } = req.body;

//     if (!packageName || !Array.isArray(details) || details.length === 0) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const missingCity = details.some((d) => !d?.city);
//     if (missingCity) {
//       return res.status(400).json({ message: "City missing in package details" });
//     }

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "Product document not found" });

//     const pkg = productDoc.package.id(id);
//     if (!pkg) return res.status(404).json({ message: "Package not found" });

//     const packagePrice = details.reduce(
//       (sum, detail) => sum + (Number(detail.paintPrice) || 0),
//       0
//     );

//     pkg.packageName = packageName;
//     pkg.packagePrice = packagePrice;
//     pkg.details = details;
//     pkg.productType = "Packages";

//     await productDoc.save();
//     return res.json({ message: "Package updated successfully", data: pkg });
//   } catch (error) {
//     console.error("Error updating package:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.deletePackage = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "Product document not found" });

//     const pkg = productDoc.package.id(id);
//     if (!pkg) return res.status(404).json({ message: "Package not found" });

//     productDoc.package.pull({ _id: id });
//     await productDoc.save();

//     return res.json({ message: "Package deleted successfully" });
//   } catch (error) {
//     console.error("Error deleting package:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// /* ---------------------------
//   Get products by type (+ city filter)
// --------------------------- */
// exports.getProductsByType = async (req, res) => {
//   try {
//     const { productType, city } = req.query;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "No products found" });

//     let data;

//     if (productType === "Packages") {
//       data = productDoc.package.filter((pkg) => packageMatchesCity(pkg, city));
//     } else if (productType === "Paints") {
//       data = productDoc.paint
//         .filter((p) => p.productType === "Paints" || !p.productType)
//         .filter((p) => matchCity(p.city, city));
//     } else {
//       // for safety (only paints should come here)
//       data = productDoc.paint
//         .filter((p) => p.productType === productType)
//         .filter((p) => matchCity(p.city, city));
//     }

//     return res.json({ data });
//   } catch (error) {
//     console.error("Error fetching products by type:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// /* ---------------------------
//   Finishing Paints (additionalPaints)
// --------------------------- */
// exports.addFinishingPaints = async (req, res) => {
//   try {
//     const { paintName, paintPrice, description, productType, paintType, city } =
//       req.body;

//     if (!paintName || paintPrice === undefined || !description || !productType || !city) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const allowedTypes = [
//       "Texture",
//       "Chemical Waterproofing",
//       "Terrace Waterproofing",
//       "Tile Grouting",
//       "POP",
//       "Wood Polish",
//     ];
//     if (!allowedTypes.includes(productType)) {
//       return res.status(400).json({ message: "Invalid productType" });
//     }

//     const newPaint = {
//       paintName,
//       paintPrice: Number(paintPrice),
//       description: description || "",
//       productType,
//       paintType: paintType || "Normal",
//       city,
//     };

//     let productDoc = await Product.findOne();
//     if (!productDoc) productDoc = new Product({ additionalPaints: [] });

//     productDoc.additionalPaints.push(newPaint);
//     await productDoc.save();

//     return res.status(201).json({
//       message: `${productType} added successfully`,
//       data: productDoc.additionalPaints[productDoc.additionalPaints.length - 1],
//     });
//   } catch (error) {
//     console.error(`Error adding ${req.body.productType}:`, error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.listFinishingPaintsByProductType = async (req, res) => {
//   try {
//     const { productType, city } = req.query;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "No products found" });

//     const data = productDoc.additionalPaints
//       .filter((p) => p.productType === productType)
//       .filter((p) => matchCity(p.city, city));

//     return res.json({ data });
//   } catch (error) {
//     console.error("Error fetching products by type:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.getAllFinishingPaints = async (req, res) => {
//   try {
//     const { city } = req.query;

//     const productDoc = await Product.findOne();
//     if (!productDoc || !Array.isArray(productDoc.additionalPaints) || productDoc.additionalPaints.length === 0) {
//       return res.status(404).json({ message: "No paints found" });
//     }

//     const data = productDoc.additionalPaints.filter((p) => matchCity(p.city, city));
//     return res.json({ data });
//   } catch (error) {
//     console.error("Error fetching paints:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// exports.updateFinishingPaint = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { paintName, paintPrice, description, paintType, city } = req.body;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "No products found" });

//     const paint = productDoc.additionalPaints.id(id);
//     if (!paint) return res.status(404).json({ message: "Paint not found" });

//     paint.paintName = paintName ?? paint.paintName;
//     paint.paintPrice = paintPrice ?? paint.paintPrice;
//     paint.description = description ?? paint.description;
//     paint.paintType = paintType ?? paint.paintType;
//     paint.city = city ?? paint.city;

//     await productDoc.save();
//     return res.json({ message: "Updated successfully", data: paint });
//   } catch (e) {
//     console.error("Update error:", e);
//     return res.status(500).json({ message: "Internal server error" });
//   }
// };

// exports.deleteFinishingPaint = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const productDoc = await Product.findOne();
//     if (!productDoc) return res.status(404).json({ message: "No products found" });

//     productDoc.additionalPaints = productDoc.additionalPaints.filter(
//       (p) => p._id.toString() !== id
//     );

//     await productDoc.save();
//     return res.json({ message: "Deleted successfully" });
//   } catch (e) {
//     console.error("Delete error:", e);
//     return res.status(500).json({ message: "Internal server error" });
//   }
// };



const Product = require("../../models/products/Product");

/* ---------------------------
  Helpers
--------------------------- */
const safeStr = (v) => String(v ?? "").trim();

const matchCity = (docCity, city) => {
  if (!city) return true; // if no city filter, return all
  return safeStr(docCity).toLowerCase() === safeStr(city).toLowerCase();
};

const packageMatchesCity = (pkg, city) => {
  if (!city) return true;
  // your schema stores city inside details[]
  const details = Array.isArray(pkg?.details) ? pkg.details : [];
  return details.some((d) => matchCity(d?.city, city));
};

/* ---------------------------
  Paints
--------------------------- */
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
      city,
    } = req.body;

    if (!name || price === undefined || !type || !productType || !city) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const productDoc = await Product.findOne();
    if (!productDoc) productDoc = new Product();

    // Calculate next order number
    const existingPaints = productDoc.paint.filter(p => 
      p.productType === productType && p.city === city
    );
    const nextOrder = existingPaints.length + 1;

    const newPaint = {
      isSpecial: isSpecial ?? type === "Special",
      name,
      price: Number(price),
      description: description || "",
      type,
      includePuttyOnFresh:
        includePuttyOnFresh ??
        (type === "Normal" && productType === "Paints"),
      includePuttyOnRepaint: includePuttyOnRepaint ?? false,
      productType,
      city,
      order: nextOrder, // Set initial order
    };

    productDoc.paint.push(newPaint);
    await productDoc.save();

    return res.status(201).json({
      message: "Paint added successfully",
      data: productDoc.paint[productDoc.paint.length - 1],
    });
  } catch (error) {
    console.error("Error adding paint:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getAllPaints = async (req, res) => {
  try {
    const { city } = req.query;

    const productDoc = await Product.findOne();
    if (!productDoc || !Array.isArray(productDoc.paint) || productDoc.paint.length === 0) {
      return res.status(404).json({ message: "No paints found" });
    }

    const paints = productDoc.paint
      .filter((p) => p.productType === "Paints" || !p.productType)
      .filter((p) => matchCity(p.city, city))
      .sort((a, b) => a.order - b.order); // Add this line to sort by order

    return res.json({ paints });
  } catch (error) {
    console.error("Error fetching paints:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updatePaint = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      price,
      description,
      type,
      productType,
      includePuttyOnFresh,
      includePuttyOnRepaint,
      isSpecial,
      city,
    } = req.body;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "Product document not found" });

    const paint = productDoc.paint.id(id);
    if (!paint) return res.status(404).json({ message: "Paint not found" });

    if (name !== undefined) paint.name = name;
    if (price !== undefined) paint.price = Number(price);
    if (description !== undefined) paint.description = description;
    if (type !== undefined) paint.type = type;
    if (productType !== undefined) paint.productType = productType;
    if (includePuttyOnFresh !== undefined) paint.includePuttyOnFresh = !!includePuttyOnFresh;
    if (includePuttyOnRepaint !== undefined) paint.includePuttyOnRepaint = !!includePuttyOnRepaint;
    if (isSpecial !== undefined) paint.isSpecial = !!isSpecial;
    if (city !== undefined) paint.city = city;

    if (isSpecial === undefined && type !== undefined) {
      paint.isSpecial = type === "Special";
    }

    await productDoc.save();
    return res.json({ message: "Paint updated successfully", data: paint });
  } catch (error) {
    console.error("Error updating paint:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

exports.deletePaint = async (req, res) => {
  try {
    const { id } = req.params;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "Product document not found" });

    const paint = productDoc.paint.id(id);
    if (!paint) return res.status(404).json({ message: "Paint not found" });

    productDoc.paint.pull({ _id: id });
    await productDoc.save();

    return res.json({ message: "Paint deleted successfully" });
  } catch (error) {
    console.error("Error deleting paint:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/* ---------------------------
  Packages (city stored inside details[])
--------------------------- */
exports.addPackage = async (req, res) => {
  try {
    const { packageName, details } = req.body;

    if (!packageName || !Array.isArray(details) || details.length === 0) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // ✅ ensure each detail has city
    const missingCity = details.some((d) => !d?.city);
    if (missingCity) {
      return res.status(400).json({ message: "City missing in package details" });
    }

    const packagePrice = details.reduce(
      (sum, detail) => sum + (Number(detail.paintPrice) || 0),
      0
    );

    const newPackage = {
      packageName,
      packagePrice,
      details,
      productType: "Packages",
    };

    let productDoc = await Product.findOne();
    if (!productDoc) productDoc = new Product();

    productDoc.package.push(newPackage);
    await productDoc.save();

    return res.status(201).json({
      message: "Package added successfully",
      data: productDoc.package[productDoc.package.length - 1],
    });
  } catch (error) {
    console.error("Error adding package:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getAllPackages = async (req, res) => {
  try {
    const { city } = req.query;

    const productDoc = await Product.findOne();
    if (!productDoc || !Array.isArray(productDoc.package) || productDoc.package.length === 0) {
      return res.status(404).json({ message: "No packages found" });
    }

    const data = productDoc.package
      .filter((pkg) => packageMatchesCity(pkg, city))
      .sort((a, b) => a.order - b.order); // Add this line to sort by order

    return res.json({ data });
  } catch (error) {
    console.error("Error fetching packages:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
exports.updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const { packageName, details } = req.body;

    if (!packageName || !Array.isArray(details) || details.length === 0) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const missingCity = details.some((d) => !d?.city);
    if (missingCity) {
      return res.status(400).json({ message: "City missing in package details" });
    }

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "Product document not found" });

    const pkg = productDoc.package.id(id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    const packagePrice = details.reduce(
      (sum, detail) => sum + (Number(detail.paintPrice) || 0),
      0
    );

    pkg.packageName = packageName;
    pkg.packagePrice = packagePrice;
    pkg.details = details;
    pkg.productType = "Packages";

    await productDoc.save();
    return res.json({ message: "Package updated successfully", data: pkg });
  } catch (error) {
    console.error("Error updating package:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.deletePackage = async (req, res) => {
  try {
    const { id } = req.params;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "Product document not found" });

    const pkg = productDoc.package.id(id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    productDoc.package.pull({ _id: id });
    await productDoc.save();

    return res.json({ message: "Package deleted successfully" });
  } catch (error) {
    console.error("Error deleting package:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/* ---------------------------
  Get products by type (+ city filter)
--------------------------- */
exports.getProductsByType = async (req, res) => {
  try {
    const { productType, city } = req.query;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "No products found" });

    let data;

    if (productType === "Packages") {
      data = productDoc.package
        .filter((pkg) => packageMatchesCity(pkg, city))
        .sort((a, b) => a.order - b.order); // Add this line
    } else if (productType === "Paints") {
      data = productDoc.paint
        .filter((p) => p.productType === "Paints" || !p.productType)
        .filter((p) => matchCity(p.city, city))
        .sort((a, b) => a.order - b.order); // Add this line
    } else {
      data = productDoc.paint
        .filter((p) => p.productType === productType)
        .filter((p) => matchCity(p.city, city))
        .sort((a, b) => a.order - b.order); // Add this line
    }

    return res.json({ data });
  } catch (error) {
    console.error("Error fetching products by type:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/* ---------------------------
  Finishing Paints (additionalPaints)
--------------------------- */
exports.addFinishingPaints = async (req, res) => {
  try {
    const { paintName, paintPrice, description, productType, paintType, city } =
      req.body;

    if (!paintName || paintPrice === undefined || !description || !productType || !city) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const allowedTypes = [
      "Texture",
      "Chemical Waterproofing",
      "Terrace Waterproofing",
      "Tile Grouting",
      "POP",
      "Wood Polish",
    ];
    if (!allowedTypes.includes(productType)) {
      return res.status(400).json({ message: "Invalid productType" });
    }

    const newPaint = {
      paintName,
      paintPrice: Number(paintPrice),
      description: description || "",
      productType,
      paintType: paintType || "Normal",
      city,
    };

    let productDoc = await Product.findOne();
    if (!productDoc) productDoc = new Product({ additionalPaints: [] });

    productDoc.additionalPaints.push(newPaint);
    await productDoc.save();

    return res.status(201).json({
      message: `${productType} added successfully`,
      data: productDoc.additionalPaints[productDoc.additionalPaints.length - 1],
    });
  } catch (error) {
    console.error(`Error adding ${req.body.productType}:`, error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.listFinishingPaintsByProductType = async (req, res) => {
  try {
    const { productType, city } = req.query;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "No products found" });

    const data = productDoc.additionalPaints
      .filter((p) => p.productType === productType)
      .filter((p) => matchCity(p.city, city))
      .sort((a, b) => a.order - b.order); // Add this line to sort by order

    return res.json({ data });
  } catch (error) {
    console.error("Error fetching products by type:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getAllFinishingPaints = async (req, res) => {
  try {
    const { city } = req.query;

    const productDoc = await Product.findOne();
    if (!productDoc || !Array.isArray(productDoc.additionalPaints) || productDoc.additionalPaints.length === 0) {
      return res.status(404).json({ message: "No paints found" });
    }

    const data = productDoc.additionalPaints
      .filter((p) => matchCity(p.city, city))
      .sort((a, b) => a.order - b.order); // Add this line to sort by order

    return res.json({ data });
  } catch (error) {
    console.error("Error fetching paints:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updateFinishingPaint = async (req, res) => {
  try {
    const { id } = req.params;
    const { paintName, paintPrice, description, paintType, city } = req.body;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "No products found" });

    const paint = productDoc.additionalPaints.id(id);
    if (!paint) return res.status(404).json({ message: "Paint not found" });

    paint.paintName = paintName ?? paint.paintName;
    paint.paintPrice = paintPrice ?? paint.paintPrice;
    paint.description = description ?? paint.description;
    paint.paintType = paintType ?? paint.paintType;
    paint.city = city ?? paint.city;

    await productDoc.save();
    return res.json({ message: "Updated successfully", data: paint });
  } catch (e) {
    console.error("Update error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteFinishingPaint = async (req, res) => {
  try {
    const { id } = req.params;

    const productDoc = await Product.findOne();
    if (!productDoc) return res.status(404).json({ message: "No products found" });

    productDoc.additionalPaints = productDoc.additionalPaints.filter(
      (p) => p._id.toString() !== id
    );

    await productDoc.save();
    return res.json({ message: "Deleted successfully" });
  } catch (e) {
    console.error("Delete error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Add this function to your ProductController.js
exports.reorderProducts = async (req, res) => {
  try {
    const { city, productType, orderedIds } = req.body;

    console.log('Reorder request received:', { city, productType, orderedIds });

    if (!city || !productType || !orderedIds || !Array.isArray(orderedIds)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: city, productType, orderedIds array'
      });
    }

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({
        success: false,
        message: 'Product document not found'
      });
    }

    let updatedCount = 0;
    let arrayName;

    // Determine which array to update and update order for each item
    if (productType === "Paints") {
      arrayName = 'paint';
      orderedIds.forEach((id, index) => {
        const paint = productDoc.paint.id(id);
        if (paint && paint.city === city && paint.productType === "Paints") {
          paint.order = index + 1;
          updatedCount++;
        }
      });
    } else if (productType === "Packages") {
      arrayName = 'package';
      orderedIds.forEach((id, index) => {
        const pkg = productDoc.package.id(id);
        if (pkg && pkg.details && pkg.details.length > 0 && pkg.details[0].city === city) {
          pkg.order = index + 1;
          updatedCount++;
        }
      });
    } else {
      // Finishing types
      arrayName = 'additionalPaints';
      orderedIds.forEach((id, index) => {
        const finishing = productDoc.additionalPaints.id(id);
        if (finishing && finishing.city === city && finishing.productType === productType) {
          finishing.order = index + 1;
          updatedCount++;
        }
      });
    }

    if (updatedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching products found for the given city and type'
      });
    }

    await productDoc.save();

    console.log(`Successfully reordered ${updatedCount} ${productType} products for city: ${city}`);

    res.status(200).json({
      success: true,
      message: `Products reordered successfully for ${productType}`,
      data: {
        updatedCount,
        orderedIds
      }
    });

  } catch (error) {
    console.error('Error reordering products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder products',
      error: error.message
    });
  }
};

// Add this function to your ProductController.js
exports.reorderProducts = async (req, res) => {
  try {
    const { city, productType, orderedIds } = req.body;

    console.log('Reorder request received:', { city, productType, orderedIds });

    if (!city || !productType || !orderedIds || !Array.isArray(orderedIds)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: city, productType, orderedIds array'
      });
    }

    const productDoc = await Product.findOne();
    if (!productDoc) {
      return res.status(404).json({
        success: false,
        message: 'Product document not found'
      });
    }

    let updatedCount = 0;
    let arrayName;

    // Determine which array to update and update order for each item
    if (productType === "Paints") {
      arrayName = 'paint';
      orderedIds.forEach((id, index) => {
        const paint = productDoc.paint.id(id);
        if (paint && paint.city === city && paint.productType === "Paints") {
          paint.order = index + 1;
          updatedCount++;
        }
      });
    } else if (productType === "Packages") {
      arrayName = 'package';
      orderedIds.forEach((id, index) => {
        const pkg = productDoc.package.id(id);
        if (pkg && pkg.details && pkg.details.length > 0 && pkg.details[0].city === city) {
          pkg.order = index + 1;
          updatedCount++;
        }
      });
    } else {
      // Finishing types
      arrayName = 'additionalPaints';
      orderedIds.forEach((id, index) => {
        const finishing = productDoc.additionalPaints.id(id);
        if (finishing && finishing.city === city && finishing.productType === productType) {
          finishing.order = index + 1;
          updatedCount++;
        }
      });
    }

    if (updatedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching products found for the given city and type'
      });
    }

    await productDoc.save();

    console.log(`Successfully reordered ${updatedCount} ${productType} products for city: ${city}`);

    res.status(200).json({
      success: true,
      message: `Products reordered successfully for ${productType}`,
      data: {
        updatedCount,
        orderedIds
      }
    });

  } catch (error) {
    console.error('Error reordering products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder products',
      error: error.message
    });
  }
};
