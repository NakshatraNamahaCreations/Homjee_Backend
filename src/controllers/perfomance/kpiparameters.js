const KPI = require("../../models/perfomance/kpiparameters");

// Default metric bands
const defaultBand = { red: 0, orange: 0, yellow: 0, green: 0 };

// Default metrics per service
const defaultMetrics = {
  house_painting: {
    surveyPercentage: defaultBand,
    hiringPercentage: defaultBand,
    avgGSV: defaultBand,
    rating: defaultBand,
    strikes: defaultBand,
  },

  deep_cleaning: {
    responsePercentage: defaultBand,
    cancellationPercentage: defaultBand,
    rating: defaultBand,
    strikes: defaultBand,
  },
};

/* -------------------------------------------------------
   GET KPI PARAMETERS BY SERVICE
--------------------------------------------------------*/
exports.getKPI = async (req, res) => {
  try {
    const { serviceType } = req.params;

    let kpi = await KPI.findOne({ serviceType });

    // Auto-create if not found
    if (!kpi) {
      kpi = await KPI.create({
        serviceType,
        metrics: defaultMetrics[serviceType],
      });
    }

    return res.status(200).json({
      success: true,
      data: kpi,
    });
  } catch (error) {
    console.error("GET KPI ERROR:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* -------------------------------------------------------
   UPDATE KPI PARAMETERS BY SERVICE
--------------------------------------------------------*/
exports.updateKPI = async (req, res) => {
  try {
    const { serviceType } = req.params;
    const newMetrics = req.body.metrics;

    let kpi = await KPI.findOne({ serviceType });

    if (!kpi) {
      // Create if not exists
      kpi = await KPI.create({
        serviceType,
        metrics: { ...defaultMetrics[serviceType], ...newMetrics },
      });
    } else {
      // Merge existing + new values
      kpi.metrics = {
        ...kpi.metrics,
        ...newMetrics,
      };

      await kpi.save();
    }

    return res.status(200).json({
      success: true,
      message: "KPI updated successfully",
      data: kpi,
    });
  } catch (error) {
    console.error("UPDATE KPI ERROR:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
