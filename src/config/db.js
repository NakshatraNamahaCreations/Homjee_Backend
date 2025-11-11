const mongoose = require("mongoose");

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
    console.log("Database Connected.........");
  } catch (err) {
    console.error("❌MongoDB connection failed:", err.message);
    process.exit(1);
  }
};
