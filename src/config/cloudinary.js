// config/cloudinary.js
const cloudinary = require("cloudinary").v2;

// Working Cloudinary account (the previous "dddc5vq0h" was disabled).
// cloud_name and api_key are not secret; the API SECRET must come from an
// env var (CLOUDINARY_API_SECRET) — set it in .env locally and on Render.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dflefzc57",
  api_key: process.env.CLOUDINARY_API_KEY || "853579764261439",
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
