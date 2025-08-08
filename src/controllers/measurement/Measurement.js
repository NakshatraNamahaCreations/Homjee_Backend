// controllers/measurementController.js
const Measurement = require("../../models/measurement/Measurement");

// Save or Update measurement
exports.saveMeasurement = async (req, res) => {
  const { vendorId, leadId, category, rooms } = req.body;

  if (!vendorId || !leadId || !rooms) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    let measurement = await Measurement.findOne({ vendorId, leadId });

    if (measurement) {
      // Update existing
      measurement.rooms = rooms;
      await measurement.save();
    } else {
      // Create new
      measurement = await Measurement.create({
        vendorId,
        leadId,
        category,
        rooms,
      });
    }

    return res
      .status(200)
      .json({ message: "Measurement saved successfully", measurement });
  } catch (error) {
    console.error("Error saving measurement:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Get measurement summary
exports.getMeasurementSummary = async (req, res) => {
  const { leadId } = req.params;

  try {
    const measurement = await Measurement.findOne({ leadId });

    if (!measurement) {
      return res.status(404).json({ message: "Measurement not found" });
    }

    const rooms = measurement.rooms;
    let interior = 0,
      exterior = 0,
      others = 0;
    const interiorKeys = [
      "Entrance Passage",
      "Living Room",
      "Bedroom 1",
      "Bedroom 2",
      "Kitchen",
      "Passage",
    ];
    const exteriorKeys = ["Balcony", "Dry Balcony", "Bedroom Balcony"];

    for (const [room, data] of rooms.entries()) {
      const sum = (list) =>
        list?.reduce((acc, cur) => acc + (cur.area || 0), 0);

      const total = sum(data.ceilings) + sum(data.walls) + sum(data.items);

      if (
        interiorKeys.includes(room) ||
        room.toLowerCase().includes("bedroom") ||
        room.toLowerCase().includes("washroom")
      ) {
        interior += total;
      } else if (exteriorKeys.includes(room)) {
        exterior += total;
      } else {
        others += total;
      }
    }

    return res.status(200).json({
      interior,
      exterior,
      others,
      total: interior + exterior + others,
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Get measurement data by leadId
exports.getMeasurementByLead = async (req, res) => {
  const { leadId } = req.params;

  try {
    const measurement = await Measurement.findOne({ leadId });

    if (!measurement) {
      return res.status(404).json({ message: "Measurement not found" });
    }

    return res.status(200).json(measurement);
  } catch (error) {
    console.error("Error fetching measurement:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
