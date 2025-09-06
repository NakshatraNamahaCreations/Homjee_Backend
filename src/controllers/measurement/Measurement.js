const Measurement = require("../../models/measurement/Measurement");

const PUTTY_RATE_PER_SQFT = 10;
const toNum = (v) => (Number.isFinite(+v) ? +v : 0);
const getNet = (it) => toNum(it.totalSqt ?? it.area ?? it.width * it.height);
const area = (w, h) => +Math.max(toNum(w) * toNum(h), 0).toFixed(2);

function normalizeLegacy(payload) {
  if (!Array.isArray(payload?.measurements)) return null;
  const map = {};
  payload.measurements.forEach((m) => {
    const walls = (m.sections || []).map((s) => {
      const gross = area(s.width, s.height);
      return {
        width: toNum(s.width),
        height: toNum(s.height),
        area: gross, // gross
        totalSqt: gross, // net == gross (legacy had no openings)
        windows: [],
        doors: [],
        cupboards: [],
        mode: "REPAINT",
      };
    });

    const ceilings = (m.sections || []).map((s) => {
      const gross = area(s.width, s.height);
      return {
        width: toNum(s.width),
        height: toNum(s.height),
        area: gross, // gross
        totalSqt: gross, // net == gross
        windows: [],
        doors: [],
        cupboards: [],
        mode: "REPAINT",
      };
    });

    const measurements = (m.measurements || []).map((s) => {
      const gross = area(s.width, s.height);
      return {
        width: toNum(s.width),
        height: toNum(s.height),
        area: gross,
        totalSqt: gross,
        mode: "REPAINT",
      };
    });

    map[m.type] = {
      mode: "REPAINT",
      unit: "FT",
      ceilings,
      walls,
      measurements,
    };
  });
  return map;
}

function recomputeTotals(doc) {
  // global rollups you already expose
  let wallsArea = 0,
    ceilingsArea = 0,
    measurementsArea = 0;

  // new sectionwise rollup for the Measurement Summary card
  const bySection = { Interior: 0, Exterior: 0, Others: 0 };

  const netRect = (r, sectionType) => {
    // For Interior sections, always recompute net — don’t trust frontend
    if (sectionType === "Interior") {
      const gross = area(r?.width, r?.height);
      const openings = [
        ...(r?.windows || []),
        ...(r?.doors || []),
        ...(r?.cupboards || []),
      ].reduce((s, o) => s + toNum(o.area ?? area(o.width, o.height)), 0);
      return Math.max(gross - openings, 0);
    }

    // For Exterior/Others, trust totalSqt if present
    if (r?.totalSqt != null) return toNum(r.totalSqt);

    // fallback
    const gross = area(r?.width, r?.height);
    const openings = [
      ...(r?.windows || []),
      ...(r?.doors || []),
      ...(r?.cupboards || []),
    ].reduce((s, o) => s + toNum(o.area ?? area(o.width, o.height)), 0);
    return Math.max(gross - openings, 0);
  };
  // const netRect = (r) => {
  //   // prefer totalSqt when present (already net)
  //   if (r?.totalSqt != null) return toNum(r.totalSqt);

  //   // else compute gross - openings
  //   const gross = area(r?.width, r?.height);
  //   const openings = [
  //     ...(r?.windows || []),
  //     ...(r?.doors || []),
  //     ...(r?.cupboards || []),
  //   ].reduce((s, o) => s + toNum(o.area ?? area(o.width, o.height)), 0);

  //   return Math.max(gross - openings, 0);
  // };

  const asMeas = (m) =>
    m?.totalSqt != null
      ? toNum(m.totalSqt)
      : toNum(m.area ?? area(m.width, m.height));

  // NOTE: doc.rooms is a Mongoose Map
  for (const [, room] of doc.rooms) {
    // const roomWalls = (room.walls || []).reduce((s, w) => s + netRect(w), 0);
    // const roomCeilings = (room.ceilings || []).reduce(
    //   (s, c) => s + netRect(c),
    //   0
    // );
    const roomWalls = (room.walls || []).reduce(
      (s, w) => s + netRect(w, room.sectionType),
      0
    );
    const roomCeilings = (room.ceilings || []).reduce(
      (s, c) => s + netRect(c, room.sectionType),
      0
    );
    const roomMeas = (room.measurements || []).reduce(
      (s, m) => s + asMeas(m),
      0
    );

    wallsArea += roomWalls;
    ceilingsArea += roomCeilings;
    measurementsArea += roomMeas;

    // Bucket by sectionType (default to Others if missing/unknown)
    const key = (room.sectionType || "").trim().toLowerCase();
    const bucket =
      key === "interior"
        ? "Interior"
        : key === "exterior"
        ? "Exterior"
        : "Others";
    bySection[bucket] += roomWalls + roomCeilings + roomMeas;
  }

  doc.totals = {
    // existing fields (unchanged contract)
    wallsArea: +wallsArea.toFixed(2),
    ceilingsArea: +ceilingsArea.toFixed(2),
    measurementsArea: +measurementsArea.toFixed(2),

    // new, convenient breakdown for your “Measurement Summary” UI
    bySection: {
      interior: +bySection.Interior.toFixed(2),
      exterior: +bySection.Exterior.toFixed(2),
      others: +bySection.Others.toFixed(2),
    },
    grandTotal: +(
      bySection.Interior +
      bySection.Exterior +
      bySection.Others
    ).toFixed(2),
  };
}

// function recomputeTotals(doc) {
//   let wallsArea = 0,
//     ceilingsArea = 0,
//     other = 0;

//   for (const [, room] of doc.rooms) {
//     ceilingsArea += (room.ceilings || []).reduce((s, w) => {
//       if (w.totalSqt != null) return s + toNum(w.totalSqt);
//       const gross = area(w.width, w.height);
//       const openings = [
//         ...(w.windows || []),
//         ...(w.doors || []),
//         ...(w.cupboards || []),
//       ].reduce((ss, o) => ss + toNum(o.area ?? area(o.width, o.height)), 0);
//       return s + Math.max(gross - openings, 0);
//     }, 0);

//     wallsArea += (room.walls || []).reduce((s, w) => {
//       if (w.totalSqt != null) return s + toNum(w.totalSqt);
//       const gross = area(w.width, w.height);
//       const openings = [
//         ...(w.windows || []),
//         ...(w.doors || []),
//         ...(w.cupboards || []),
//       ].reduce((ss, o) => ss + toNum(o.area ?? area(o.width, o.height)), 0);
//       return s + Math.max(gross - openings, 0);
//     }, 0);

//     other += (room.measurements || []).reduce((s, c) => {
//       // measurements have no openings: use totalSqt if present, else area
//       const val =
//         c.totalSqt != null
//           ? toNum(c.totalSqt)
//           : toNum(c.area ?? area(c.width, c.height));
//       return s + val;
//     }, 0);
//   }

//   doc.totals = {
//     wallsArea: +wallsArea.toFixed(2),
//     ceilingsArea: +ceilingsArea.toFixed(2),
//     measurementsArea: +other.toFixed(2),
//   };
// }

function paintUnitRate(paint, mode, sectionType) {
  // One base price + optional putty
  const base = toNum(paint?.price);
  const needsPutty =
    mode === "FRESH"
      ? !!paint?.includePuttyOnFresh
      : !!paint?.includePuttyOnRepaint;

  // If your client ever says "Others never add putty", uncomment:
  // if (sectionType === "Others") return base;

  return base + (needsPutty ? PUTTY_RATE_PER_SQFT : 0);
}

function displayPaintName(paint, mode, sectionType) {
  if (!paint) return "";
  const isOthers = (sectionType || "").trim() === "Others";

  // Prefix for special paints
  const specialPrefix = paint.isSpecial ? "★ " : "";

  // For Others: never append process per client decision
  if (isOthers) return `${specialPrefix}${paint.name}`;

  // For Normal: append process after the name
  const process = mode === "FRESH" ? "Fresh Paint" : "Repaint With Primer";

  return paint.isSpecial
    ? `${specialPrefix}${paint.name}` // special paints: name only, plus the star
    : `${paint.name} ${process}`; // normal paints: append process
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

exports.updateRoomPaintPricing = async (req, res) => {
  try {
    const {
      leadId,
      roomName,
      newRoomName,
      selections, // { paints: {ceiling, wall, measurements}, items: {ceilings, walls, measurements} }
    } = req.body;

    if (!leadId || !roomName || !selections) {
      return res
        .status(400)
        .json({ message: "Missing leadId, roomName or selections" });
    }

    const doc = await Measurement.findOne({ leadId });
    if (!doc) return res.status(404).json({ message: "Measurement not found" });

    const room = doc.rooms.get(roomName);
    if (!room)
      return res.status(404).json({ message: `Room "${roomName}" not found` });

    // Rename room if needed
    const finalRoomName =
      newRoomName && newRoomName !== roomName ? newRoomName : roomName;
    if (finalRoomName !== roomName) {
      if (doc.rooms.has(finalRoomName)) {
        return res
          .status(400)
          .json({ message: `Room "${finalRoomName}" already exists` });
      }
      room.name = finalRoomName;
      doc.rooms.delete(roomName);
      doc.rooms.set(finalRoomName, room);
    }

    const sectionType = room.sectionType; // "Interior" | "Exterior" | "Others"

    // Selections from client (send back exactly what you picked on the app)
    const paintCeil = selections?.paints?.ceiling ?? null;
    const paintWall = selections?.paints?.wall ?? null;
    const paintMeas = selections?.paints?.measurements ?? null;

    // Items: minimal per-item info is enough (mode + sqft)
    const selCeil = Array.isArray(selections?.items?.ceilings)
      ? selections.items.ceilings
      : [];
    const selWall = Array.isArray(selections?.items?.walls)
      ? selections.items.walls
      : [];
    const selMeas = Array.isArray(selections?.items?.measurements)
      ? selections.items.measurements
      : [];

    // Build breakdown lines
    const breakdown = [];
    let total = 0;

    const addLines = (kind, items, paint) => {
      items.forEach((it) => {
        const sqft = +getNet(it).toFixed(2);
        if (!sqft) return;

        const unitPrice = paintUnitRate(paint, it.mode, sectionType);
        const linePrice = +(unitPrice * sqft).toFixed(2);

        breakdown.push({
          type: kind, // "Ceiling" | "Wall" | "Measurement"
          mode: it.mode, // "FRESH" | "REPAINT"
          sqft,
          unitPrice, // base + maybe putty
          price: linePrice,
          paintId: paint?.id ?? null,
          paintName: paint?.name ?? "",
          isSpecial: !!paint?.isSpecial,
          displayPaint: displayPaintName(paint, it.mode, sectionType),
          components: {
            paintPrice: toNum(paint?.price),
            puttyPrice:
              unitPrice - toNum(paint?.price) > 0 ? PUTTY_RATE_PER_SQFT : 0,
            puttyApplied: unitPrice - toNum(paint?.price) > 0,
          },
        });

        total += linePrice;
      });
    };

    // Map kinds per section type
    // Interior/Exterior: ceilings & walls; Others: measurements
    if (sectionType === "Others") {
      addLines("Measurement", selMeas, paintMeas);
    } else {
      addLines("Ceiling", selCeil, paintCeil);
      addLines("Wall", selWall, paintWall);
    }

    // Persist in pricing (don’t touch packages here)
    room.pricing = {
      ...(room.pricing || {}),
      total: +total.toFixed(2),
      breakdown,
      selectedPaints: {
        ceiling: paintCeil,
        wall: paintWall,
        measurements: paintMeas,
      },
    };

    // Save
    doc.rooms.set(finalRoomName, room);
    doc.markModified(`rooms.${finalRoomName}`);
    await doc.save();
    console.log("whole documents", doc);
    res.status(200).json({
      message: "Room paint pricing saved",
      data: {
        roomName: finalRoomName,
        total: room.pricing.total,
        breakdown: room.pricing.breakdown,
        selectedPaints: room.pricing.selectedPaints,
        whole: doc,
      },
    });
  } catch (err) {
    console.error("updateRoomPaintPricing error:", err);
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
