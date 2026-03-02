const City = require("../../models/city/City");

exports.createCity = async (req, res) => {
  try {
    const city = String(req.body.city || "").trim();
    const feedbackLink = String(req.body.feedbackLink || "").trim();

    if (!city || city.length < 2) {
      return res.status(400).json({ success: false, message: "City is required" });
    }

    if (!feedbackLink) {
      return res
        .status(400)
        .json({ success: false, message: "Feedback link is required" });
    }

    const created = await City.create({ city, feedbackLink });

    return res.status(201).json({
      success: true,
      message: "City created",
      data: created,
    });
  } catch (err) {
    console.error("createCity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.listCities = async (req, res) => {
  try {
    const data = await City.find({}).sort({ createdAt: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("listCities error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteCity = async (req, res) => {
  try {
    const { id } = req.params;

    const found = await City.findById(id);
    if (!found) {
      return res.status(404).json({ success: false, message: "City not found" });
    }

    await City.deleteOne({ _id: id });
    return res.json({ success: true, message: "City deleted" });
  } catch (err) {
    console.error("deleteCity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
