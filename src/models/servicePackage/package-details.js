const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema({
  serviceType: String,
  packageImage: [String],
});

module.exports = mongoose.model("package", packageSchema);
