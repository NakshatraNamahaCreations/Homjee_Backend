// controllers/measurementController.js
const Measurement = require("../../models/measurement/Measurement");

// Save or Update measurement
// exports.saveMeasurement = async (req, res) => {
//   const { vendorId, leadId, category, rooms } = req.body;

//   console.log("vendorId, leadId,rooms", vendorId, leadId, rooms);

//   if (!vendorId || !leadId || !rooms) {
//     return res.status(400).json({ message: "Missing required fields" });
//   }

//   try {
//     let measurement = await Measurement.findOne({ vendorId, leadId });

//     if (measurement) {
//       // Update existing
//       measurement.rooms = rooms;
//       await measurement.save();
//     } else {
//       // Create new
//       measurement = await Measurement.create({
//         vendorId,
//         leadId,
//         category,
//         rooms,
//       });
//     }

//     return res
//       .status(200)
//       .json({ message: "Measurement saved successfully", measurement });
//   } catch (error) {
//     console.error("Error saving measurement:", error);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

const toNum = (v) => (Number.isFinite(+v) ? +v : 0);
const area = (w, h) => +Math.max(toNum(w) * toNum(h), 0).toFixed(2);

/** normalize legacy { measurements:[{type,sections:[{sectionName,width,height}]}] } into rooms map */
function normalizeLegacy(payload) {
  if (!Array.isArray(payload?.measurements)) return null;
  const map = {};
  payload.measurements.forEach((m) => {
    const walls = (m.sections || []).map((s) => ({
      width: toNum(s.width),
      height: toNum(s.height),
      area: area(s.width, s.height),
      windows: [],
      doors: [],
      cupboards: [],
    }));
    map[m.type] = { mode: "REPAINT", unit: "FT", ceilings: [], walls };
  });
  return map;
}

function recomputeTotals(doc) {
  let wallsArea = 0,
    ceilingsArea = 0;
  // exterior = 0;
  other = 0;
  for (const [, room] of doc.rooms) {
    ceilingsArea += (room.ceilings || []).reduce(
      (s, c) => s + toNum(c.area ?? area(c.width, c.height)),
      0
    );
    wallsArea += (room.walls || []).reduce((s, w) => {
      const gross = area(w.width, w.height);
      const openings = [
        ...(w.windows || []),
        ...(w.doors || []),
        ...(w.cupboards || []),
      ].reduce((ss, o) => ss + toNum(o.area ?? area(o.width, o.height)), 0);
      return s + Math.max(gross - openings, 0);
    }, 0);
    other += (room.measurements || []).reduce(
      (s, c) => s + toNum(c.area ?? area(c.width, c.height)),
      0
    );
  }
  doc.totals = {
    wallsArea: +wallsArea.toFixed(2),
    ceilingsArea: +ceilingsArea.toFixed(2),
    measurementsArea: +other.toFixed(2),
  };
}

exports.saveMeasurement = async (req, res) => {
  const { vendorId, leadId } = req.body;
  let { rooms } = req.body;

  if (!vendorId || !leadId) {
    return res.status(400).json({ message: "Missing vendorId or leadId" });
  }

  if (!rooms) rooms = normalizeLegacy(req.body);

  if (!rooms || typeof rooms !== "object") {
    return res.status(400).json({ message: "No rooms provided" });
  }

  try {
    let doc = await Measurement.findOne({ vendorId, leadId });
    if (!doc) doc = new Measurement({ vendorId, leadId, rooms: {} });

    Object.entries(rooms).forEach(([name, room]) => {
      doc.rooms.set(name, room);
    });

    recomputeTotals(doc);
    await doc.save();

    return res.status(200).json({
      message: "Measurement saved successfully",
      data: doc,
      // data: { id: doc._id, rooms: doc.rooms, totals: doc.totals },
    });
  } catch (error) {
    console.error("Error saving measurement:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// exports.updateRoomPricing = async (req, res) => {
//   try {
//     const { leadId, roomName, selectedPackage } = req.body;

//     if (!leadId || !roomName || !selectedPackage) {
//       return res
//         .status(400)
//         .json({ message: "Missing leadId, roomName, or selectedPackage" });
//     }

//     // Find measurement doc
//     const doc = await Measurement.findOne({ leadId });
//     if (!doc) {
//       return res.status(404).json({ message: "Measurement not found" });
//     }

//     const room = doc.rooms.get(roomName);
//     if (!room) {
//       return res.status(404).json({ message: `Room "${roomName}" not found` });
//     }

//     // Calculate total pricing for the given room based on selected package
//     let totalRoomPrice = 0;
//     let pricingBreakdown = [];

//     // Ceiling pricing
//     if (room.ceilings && room.ceilings.length > 0) {
//       const ceilingArea = room.ceilings.reduce(
//         (sum, c) => sum + (c.area || 0),
//         0
//       );
//       const ceilingPackage = selectedPackage.details.find(
//         (d) =>
//           d.name.toLowerCase().includes(room.mode.toLowerCase()) &&
//           d.name.toLowerCase().includes("ceiling")
//       );
//       if (ceilingPackage) {
//         const price =
//           (ceilingArea / ceilingPackage.sqft) * ceilingPackage.price;
//         totalRoomPrice += price;
//         pricingBreakdown.push({
//           type: "Ceiling",
//           sqft: ceilingArea,
//           unitPrice: ceilingPackage.price / ceilingPackage.sqft,
//           price,
//         });
//       }
//     }

//     // Wall pricing
//     if (room.walls && room.walls.length > 0) {
//       const wallArea = room.walls.reduce((sum, w) => sum + (w.area || 0), 0);
//       const wallPackage = selectedPackage.details.find(
//         (d) =>
//           d.name.toLowerCase().includes(room.mode.toLowerCase()) &&
//           d.name.toLowerCase().includes("wall")
//       );
//       if (wallPackage) {
//         const price = (wallArea / wallPackage.sqft) * wallPackage.price;
//         totalRoomPrice += price;
//         pricingBreakdown.push({
//           type: "Wall",
//           sqft: wallArea,
//           unitPrice: wallPackage.price / wallPackage.sqft,
//           price,
//         });
//       }
//     }

//     // Save pricing info inside room (optional)
//     room.pricing = {
//       packageId: selectedPackage.id,
//       packageName: selectedPackage.name,
//       total: totalRoomPrice,
//       breakdown: pricingBreakdown,
//     };

//     doc.rooms.set(roomName, room);
//     await doc.save();

//     return res.status(200).json({
//       message: "Room pricing updated successfully",
//       data: {
//         roomName,
//         totalRoomPrice,
//         pricingBreakdown,
//       },
//     });
//   } catch (err) {
//     console.error("Error updating room pricing:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// Get measurement summary

exports.updateRoomPricing = async (req, res) => {
  try {
    const {
      leadId,
      roomName,
      newRoomName,
      selectedPackage,
      selectedPackageItems,
    } = req.body;

    // Validate input
    if (!leadId || !roomName || !selectedPackage) {
      return res
        .status(400)
        .json({ message: "Missing leadId, roomName, or selectedPackage" });
    }

    // Find measurement doc
    const doc = await Measurement.findOne({ leadId });
    if (!doc) {
      return res.status(404).json({ message: "Measurement not found" });
    }

    // Get the room
    const room = doc.rooms.get(roomName);
    if (!room) {
      return res.status(404).json({ message: `Room "${roomName}" not found` });
    }

    // Update room name if newRoomName is provided
    if (newRoomName && newRoomName !== roomName) {
      if (doc.rooms.has(newRoomName)) {
        return res
          .status(400)
          .json({ message: `Room "${newRoomName}" already exists` });
      }
      room.name = newRoomName;
      doc.rooms.delete(roomName);
      doc.rooms.set(newRoomName, room);
    }

    if (selectedPackageItems && Array.isArray(selectedPackageItems)) {
      room.packages = selectedPackageItems.map((item) => ({
        width: item.width,
        height: item.height,
        area: item.area,
      }));
    }

    // Calculate total pricing
    let totalRoomPrice = 0;
    let pricingBreakdown = [];

    // Ceiling pricing
    if (room.ceilings && room.ceilings.length > 0) {
      const ceilingArea = room.ceilings.reduce(
        (sum, c) => sum + (c.area || 0),
        0
      );
      const ceilingPackage = selectedPackage.details.find(
        (d) =>
          d.name.toLowerCase().includes(room.mode.toLowerCase()) &&
          d.name.toLowerCase().includes("ceiling")
      );
      if (ceilingPackage) {
        const price =
          (ceilingArea / ceilingPackage.sqft) * ceilingPackage.price;
        totalRoomPrice += price;
        pricingBreakdown.push({
          type: "Ceiling",
          sqft: ceilingArea,
          unitPrice: ceilingPackage.price / ceilingPackage.sqft,
          price,
        });
      }
    }

    // Wall pricing
    if (room.walls && room.walls.length > 0) {
      const wallArea = room.walls.reduce((sum, w) => sum + (w.area || 0), 0);
      const wallPackage = selectedPackage.details.find(
        (d) =>
          d.name.toLowerCase().includes(room.mode.toLowerCase()) &&
          d.name.toLowerCase().includes("wall")
      );
      if (wallPackage) {
        const price = (wallArea / wallPackage.sqft) * wallPackage.price;
        totalRoomPrice += price;
        pricingBreakdown.push({
          type: "Wall",
          sqft: wallArea,
          unitPrice: wallPackage.price / wallPackage.sqft,
          price,
        });
      }
    }

    if (room.packages && room.packages.length > 0) {
      const packageArea = room.packages.reduce(
        (sum, p) => sum + (p.area || 0),
        0
      );
      const packagePricing = selectedPackage.details.find(
        (d) =>
          d.name.toLowerCase().includes(room.mode.toLowerCase()) &&
          d.name.toLowerCase().includes("package")
      );
      if (packagePricing) {
        const price =
          (packageArea / packagePricing.sqft) * packagePricing.price;
        totalRoomPrice += price;
        pricingBreakdown.push({
          type: "Package",
          sqft: packageArea,
          unitPrice: packagePricing.price / packagePricing.sqft,
          price,
        });
      }
    }

    // Save pricing info
    room.pricing = {
      packageId: selectedPackage.id,
      packageName: selectedPackage.name,
      total: totalRoomPrice,
      breakdown: pricingBreakdown,
      packages: room.packages || [],
    };

    // Update room in the document
    doc.rooms.set(newRoomName || roomName, room);
    doc.markModified(`rooms.${newRoomName || roomName}`);
    await doc.save();

    return res.status(200).json({
      message: "Room pricing and name updated successfully",
      data: {
        roomName: newRoomName || roomName,
        totalRoomPrice,
        pricingBreakdown,
        packages: room.packages,
      },
    });
  } catch (err) {
    console.error("Error updating room pricing:", err);
    res.status(500).json({ message: "Server error" });
  }
};

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

exports.getMeasurement = async (req, res) => {
  const { vendorId, leadId } = req.query;
  if (!vendorId || !leadId)
    return res
      .status(400)
      .json({ message: "vendorId and leadId are required" });
  try {
    const doc = await Measurement.findOne({ vendorId, leadId });
    if (!doc) return res.status(404).json({ message: "Not found" });
    return res.json({
      data: { id: doc._id, rooms: doc.rooms, totals: doc.totals },
    });
  } catch (e) {
    return res.status(500).json({ message: "Server error" });
  }
};
