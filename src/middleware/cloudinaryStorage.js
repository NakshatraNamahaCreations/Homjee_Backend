const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "vendorDocs",
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const parser = multer({ storage });

module.exports = parser;
