const PricingConfig = require("../../models/serviceConfig/PricingConfig");

// exports.createPricingConfig = async (req, res) => {
//   try {
//     const { siteVisitCharge, vendorCoins, puttyPrice } = req.body;

//     if (!siteVisitCharge || !vendorCoins || !puttyPrice) {
//       return res.status(400).json({ message: "All fields are required" });
//     }

//     const pricing = new PricingConfig({
//       siteVisitCharge,
//       vendorCoins,
//       puttyPrice,
//     });

//     await pricing.save();

//     res
//       .status(201)
//       .json({ message: "Pricing configuration saved", data: pricing });
//   } catch (error) {
//     console.error("Error saving pricing:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };
// commanded by kir on 18-mar-2026
// exports.createPricingConfig = async (req, res) => {
//   try {
//     const { siteVisitCharge, vendorCoins, puttyPrice } = req.body;

//     // helper to check "missing but allow 0"
//     const isMissing = (v) => v === undefined || v === null || v === "";

//     if ([siteVisitCharge, vendorCoins, puttyPrice].some(isMissing)) {
//       return res.status(400).json({ message: "All fields are required" });
//     }

//     // normalize + validate numbers
//     const site = Number(siteVisitCharge);
//     const coins = Number(vendorCoins);
//     const putty = Number(puttyPrice);

//     if ([site, coins, putty].some(Number.isNaN)) {
//       return res.status(400).json({ message: "Values must be valid numbers" });
//     }

//     const pricing = new PricingConfig({
//       siteVisitCharge: site,
//       vendorCoins: coins,
//       puttyPrice: putty,
//     });

//     await pricing.save();

//     return res
//       .status(201)
//       .json({ message: "Pricing configuration saved", data: pricing });

//   } catch (error) {
//     console.error("Error saving pricing:", error);
//     return res.status(500).json({ message: "Internal Server Error" });
//   }
// };


exports.createOrUpdatePricingConfig = async (req, res) => {
  try {
    const { siteVisitCharge, vendorCoins, puttyPrice, city } = req.body;

    if (!city || city.trim() === "") {
      return res.status(400).json({ message: "City is required" });
    }

    const updateData = {};

    if (siteVisitCharge !== undefined && siteVisitCharge !== null && siteVisitCharge !== "") {
      const site = Number(siteVisitCharge);
      if (Number.isNaN(site)) {
        return res.status(400).json({ message: "siteVisitCharge must be a valid number" });
      }
      updateData.siteVisitCharge = site;
    }

    if (vendorCoins !== undefined && vendorCoins !== null && vendorCoins !== "") {
      const coins = Number(vendorCoins);
      if (Number.isNaN(coins)) {
        return res.status(400).json({ message: "vendorCoins must be a valid number" });
      }
      updateData.vendorCoins = coins;
    }

    if (puttyPrice !== undefined && puttyPrice !== null && puttyPrice !== "") {
      const putty = Number(puttyPrice);
      if (Number.isNaN(putty)) {
        return res.status(400).json({ message: "puttyPrice must be a valid number" });
      }
      updateData.puttyPrice = putty;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "At least one field is required to update" });
    }

    const pricing = await PricingConfig.findOneAndUpdate(
      { city: city.trim() },
      { $set: updateData },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({
      message: "Pricing configuration saved successfully",
      data: pricing,
    });
  } catch (error) {
    console.error("Error saving pricing:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getPricingConfigByCity = async (req, res) => {
  try {
    const { city } = req.params;

    if (!city || city.trim() === "") {
      return res.status(400).json({ message: "City is required" });
    }

    const pricing = await PricingConfig.findOne({ city: city.trim() });

    if (!pricing) {
      return res.status(404).json({ message: "Pricing configuration not found" });
    }

    return res.status(200).json({
      message: "Pricing configuration fetched successfully",
      data: pricing,
    });
  } catch (error) {
    console.error("Error fetching pricing config:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getLatestPricing = async (req, res) => {
  try {
    const latest = await PricingConfig.findOne().sort({ createdAt: -1 });
    if (!latest) {
      return res
        .status(404)
        .json({ message: "No pricing configuration found" });
    }
    res.status(200).json({ success: true, data: latest });
  } catch (error) {
    console.error("Error fetching pricing:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
