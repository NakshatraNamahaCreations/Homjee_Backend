const mongoose = require("mongoose");
const Vendor = require("../models/vendor/vendorAuth");
const MobileRegistry = require("../models/vendor/mobileRegistry.model");
const City = require("../models/city/City");
exports.connectDB = async () => {
  try {
    await mongoose.connect(
      process.env.MONGO_URI ||
        "mongodb+srv://homjee:homjee@cluster0.0bvspx4.mongodb.net/",
      // {
      //  useNewUrlParser: true,
      //   useUnifiedTopology: true,
      // }
    );

    await City.syncIndexes();

    await Vendor.syncIndexes();
    await MobileRegistry.syncIndexes();
    console.log("Database Connected.........");
  } catch (err) {
    console.error("❌MongoDB connection failed:", err.message);
    process.exit(1);
  }
};
