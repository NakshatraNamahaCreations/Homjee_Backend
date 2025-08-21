const PricingConfig = require("../../models/serviceConfig/PricingConfig");

exports.createPricingConfig = async (req, res) => {
  try {
    const { siteVisitCharge, vendorCoins, puttyPrice } = req.body;

    if (!siteVisitCharge || !vendorCoins || !puttyPrice) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const pricing = new PricingConfig({
      siteVisitCharge,
      vendorCoins,
      puttyPrice,
    });

    await pricing.save();

    res
      .status(201)
      .json({ message: "Pricing configuration saved", data: pricing });
  } catch (error) {
    console.error("Error saving pricing:", error);
    res.status(500).json({ message: "Internal Server Error" });
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
