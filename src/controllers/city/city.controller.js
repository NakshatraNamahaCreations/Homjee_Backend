// controllers/city/city.controller.js  (UPDATED)
// ✅ City stored in Title Case (ex: "Bengaluru")
// ✅ Uniqueness is case-insensitive using cityKey (lowercase)
// ✅ Create/Update handle duplicate nicely
// ✅ Delete blocks if any vendor is tagged with that city (checks by cityKey for safety)

const City = require("../../models/city/City");
const Vendor = require("../../models/vendor/vendorAuth");

// ---------- helpers ----------
const toCityDisplay = (v = "") => {
  const s = String(v).trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
};

const toCityKey = (v = "") => String(v).trim().replace(/\s+/g, " ").toLowerCase();

const isValidUrl = (u) => {
  try {
    // eslint-disable-next-line no-new
    new URL(String(u));
    return true;
  } catch {
    return false;
  }
};

// ============================
// CREATE CITY
// ============================
exports.createCity = async (req, res) => {
  try {
    const cityRaw = String(req.body.city || "").trim();
    const feedbackLink = String(req.body.feedbackLink || "").trim();

    if (!cityRaw || cityRaw.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "City is required" });
    }

    if (!feedbackLink) {
      return res
        .status(400)
        .json({ success: false, message: "Feedback link is required" });
    }

    if (!isValidUrl(feedbackLink)) {
      return res
        .status(400)
        .json({ success: false, message: "Feedback link must be a valid URL" });
    }

    const city = toCityDisplay(cityRaw);
    const cityKey = toCityKey(city);

    const created = await City.create({ city, cityKey, feedbackLink });

    return res.status(201).json({
      success: true,
      message: "City created",
      data: created,
    });
  } catch (err) {
    console.error("createCity error:", err);

    // ✅ duplicate cityKey unique index
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "City already exists" });
    }

    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============================
// LIST CITIES
// ============================
exports.listCities = async (req, res) => {
  try {
    // ✅ keep stable order
    const data = await City.find({});
    return res.json({ success: true, data });
  } catch (err) {
    console.error("listCities error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============================
// DELETE CITY (block if vendors tagged)
// ============================
exports.deleteCity = async (req, res) => {
  try {
    const { id } = req.params;

    const found = await City.findById(id).lean();
    if (!found) {
      return res
        .status(404)
        .json({ success: false, message: "City not found" });
    }

    // ✅ use cityKey for case-insensitive safety
    const cityKey = String(found.cityKey || toCityKey(found.city || "")).trim();
    const cityName = String(found.city || "").trim();

    if (!cityKey) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid city record" });
    }

    // ✅ if vendor.city is not normalized in DB, this will still catch most cases
    // Preferred: vendors should store vendor.city as City.city (display) OR store vendorCityKey too.
    const vendorExists = await Vendor.exists({
      $or: [
        { "vendor.city": cityName }, // exact match (fast with index if used)
        { "vendor.city": new RegExp(`^${cityName}$`, "i") }, // fallback case-insensitive (slower)
      ],
    });

    if (vendorExists) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete. Vendors are tagged with "${cityName}".`,
      });
    }

    await City.deleteOne({ _id: id });
    return res.json({ success: true, message: "City deleted" });
  } catch (err) {
    console.error("deleteCity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============================
// UPDATE CITY
// PUT /api/city/:id
// ============================
exports.updateCity = async (req, res) => {
  try {
    const { id } = req.params;

    const cityRaw =
      req.body.city != null ? String(req.body.city).trim() : undefined;
    const feedbackLink =
      req.body.feedbackLink != null
        ? String(req.body.feedbackLink).trim()
        : undefined;

    const update = {};

    if (cityRaw !== undefined) {
      if (!cityRaw || cityRaw.length < 2) {
        return res
          .status(400)
          .json({ success: false, message: "City is required" });
      }

      const city = toCityDisplay(cityRaw);
      const cityKey = toCityKey(city);

      update.city = city;
      update.cityKey = cityKey;
    }

    if (feedbackLink !== undefined) {
      if (!feedbackLink) {
        return res
          .status(400)
          .json({ success: false, message: "Feedback link is required" });
      }
      if (!isValidUrl(feedbackLink)) {
        return res
          .status(400)
          .json({ success: false, message: "Feedback link must be a valid URL" });
      }
      update.feedbackLink = feedbackLink;
    }

    if (Object.keys(update).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields provided to update" });
    }

    // ✅ If city is being changed, block update if vendors are already using OLD city
    // (because changing city name will break vendor tagging)
    if (update.city) {
      const existing = await City.findById(id).lean();
      if (!existing) {
        return res
          .status(404)
          .json({ success: false, message: "City not found" });
      }

      const oldCityName = String(existing.city || "").trim();
      if (oldCityName && oldCityName !== update.city) {
        const vendorExists = await Vendor.exists({
          $or: [
            { "vendor.city": oldCityName },
            { "vendor.city": new RegExp(`^${oldCityName}$`, "i") },
          ],
        });

        if (vendorExists) {
          return res.status(409).json({
            success: false,
            message: `Cannot rename. Vendors are tagged with "${oldCityName}".`,
          });
        }
      }
    }

    const updated = await City.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "City not found" });
    }

    return res.status(200).json({
      success: true,
      message: "City updated",
      data: updated,
    });
  } catch (err) {
    console.error("updateCity error:", err);

    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "City already exists" });
    }

    return res.status(500).json({ success: false, message: "Server error" });
  }
};
