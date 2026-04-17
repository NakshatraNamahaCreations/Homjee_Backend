
// const { CloudinaryStorage } = require("multer-storage-cloudinary");
// const multer = require("multer");
// const cloudinary = require("../config/cloudinary");

// const storage = new CloudinaryStorage({
//   cloudinary,
//   params: async (req, file) => {
//     const folder = req.folder || "defaultFolder";
//     return {
//       folder: folder,
//       allowed_formats: ["jpg", "png", "jpeg", "webp"],
//       public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
//     };
//   },
// });

// const parser = multer({ storage });

// module.exports = parser;



const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const folder = req.folder || "defaultFolder";
    return {
      folder,
      allowed_formats: ["jpg", "png", "jpeg", "webp"],
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
    };
  },
});

// ✅ add limits + optional fileFilter
const parser = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
    files: 10,                  // optional total files limit
  },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    if (!ok) return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
    cb(null, true);
  },
});

module.exports = parser;