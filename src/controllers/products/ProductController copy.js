const Product = require("../../models/products/Product");

exports.createProduct = async (req, res) => {
  try {
    const {
      productType,
      isSpecial,
      name,
      price,
      description,
      type,
      interiorCeiling,
      interiorWalls,
      exteriorCeiling,
      exteriorWalls,
      others,
    } = req.body;

    // Validate required fields
    // if (!productType || !name || !price || !description) {
    //   return res.status(400).json({ message: "Product type, name, price, and description are required" });
    // }

    // Find or create a document for the product type
    let productDoc = await Product.findOne({ productType });
    if (!productDoc) {
      productDoc = new Product({ productType, products: [] });
    }

    const newProduct = {
      name,
      isSpecial,
      price,
      description,
      type: type || "Normal",
      ...(productType === "Packages" && {
        interiorCeiling: interiorCeiling || "",
        interiorWalls: interiorWalls || "",
        exteriorCeiling: exteriorCeiling || "",
        exteriorWalls: exteriorWalls || "",
        others: others || "",
      }),
    };

    productDoc.products.push(newProduct);

    await productDoc.save();

    res
      .status(201)
      .json({ message: "Product added successfully", data: productDoc });
  } catch (error) {
    console.error("Error adding product:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getProductsByType = async (req, res) => {
  try {
    const { productType } = req.query;
    const productDoc = await Product.findOne({ productType });

    if (!productDoc) {
      return res
        .status(404)
        .json({ message: `No products found for type: ${productType}` });
    }

    res.status(200).json({ success: true, data: productDoc.products });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { productType, productId } = req.params;
    const {
      name,
      price,
      description,
      type,
      interiorCeiling,
      interiorWalls,
      exteriorCeiling,
      exteriorWalls,
      others,
    } = req.body;

    if (!name || !price || !description) {
      return res
        .status(400)
        .json({ message: "Name, price, and description are required" });
    }

    const productDoc = await Product.findOne({ productType });
    if (!productDoc) {
      return res
        .status(404)
        .json({ message: `No products found for type: ${productType}` });
    }

    const product = productDoc.products.id(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    product.name = name;
    product.price = price;
    product.description = description;
    product.type = type || "Normal";
    if (productType === "Packages") {
      product.interiorCeiling = interiorCeiling || "";
      product.interiorWalls = interiorWalls || "";
      product.exteriorCeiling = exteriorCeiling || "";
      product.exteriorWalls = exteriorWalls || "";
      product.others = others || "";
    }

    await productDoc.save();

    res
      .status(200)
      .json({ message: "Product updated successfully", data: productDoc });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { productType, productId } = req.params;

    const productDoc = await Product.findOne({ productType });
    if (!productDoc) {
      return res
        .status(404)
        .json({ message: `No products found for type: ${productType}` });
    }

    const product = productDoc.products.id(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    productDoc.products.pull(productId);
    await productDoc.save();

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getPaintNames = async (req, res) => {
  try {
    const productDoc = await Product.findOne({ productType: "Paints" });
    if (!productDoc) {
      return res.status(404).json({ message: "No paints found" });
    }
    const paintNames = productDoc.products.map((product) => product.name);
    res.status(200).json({ success: true, data: paintNames });
  } catch (error) {
    console.error("Error fetching paint names:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
