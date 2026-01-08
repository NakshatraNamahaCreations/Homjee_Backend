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

exports.createPricingConfig = async (req, res) => {
  try {
    const { siteVisitCharge, vendorCoins, puttyPrice } = req.body;

    // helper to check "missing but allow 0"
    const isMissing = (v) => v === undefined || v === null || v === "";

    if ([siteVisitCharge, vendorCoins, puttyPrice].some(isMissing)) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // normalize + validate numbers
    const site = Number(siteVisitCharge);
    const coins = Number(vendorCoins);
    const putty = Number(puttyPrice);

    if ([site, coins, putty].some(Number.isNaN)) {
      return res.status(400).json({ message: "Values must be valid numbers" });
    }

    const pricing = new PricingConfig({
      siteVisitCharge: site,
      vendorCoins: coins,
      puttyPrice: putty,
    });

    await pricing.save();

    return res
      .status(201)
      .json({ message: "Pricing configuration saved", data: pricing });

  } catch (error) {
    console.error("Error saving pricing:", error);
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
