// config/cloudinary.js
const cloudinary = require("cloudinary").v2;

// The cloud_name below ("dddc5vq0h") was reported DISABLED by Cloudinary,
// which breaks vendor photo/document uploads and viewing. Set working
// credentials on Render (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET) to
// override without a code change.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dddc5vq0h",
  api_key: process.env.CLOUDINARY_API_KEY || "953144231318836",
  api_secret: process.env.CLOUDINARY_API_SECRET || "BjHwpbWxhqSV03ibhewtbixkk6Y",
});

module.exports = cloudinary;
