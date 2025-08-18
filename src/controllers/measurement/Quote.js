// controllers/quote.controller.js
const Measurement = require("../../models/measurement/Measurement");
const Quote = require("../../models/measurement/Quote");

const toNum = (v) => (Number.isFinite(+v) ? +v : 0);

exports.createQuote = async (req, res) => {
  try {
    const {
      leadId,
      vendorId, // optional if you use it on Measurement
      days = 1,
      flatAmount = 0,
      discount = 0,
      comments = "",
    } = req.body;

    if (!leadId) {
      return res.status(400).json({ message: "leadId is required" });
    }

    // Pull measurement (source of truth)
    const findQuery = vendorId ? { leadId, vendorId } : { leadId };
    const meas = await Measurement.findOne(findQuery);
    if (!meas)
      return res.status(404).json({ message: "Measurement not found" });

    // Build lines from rooms that actually have pricing already computed
    const lines = [];
    let interior = 0,
      exterior = 0,
      others = 0;

    for (const [roomName, room] of meas.rooms) {
      const subtotal = toNum(room?.pricing?.total);
      if (!subtotal) continue; // skip rooms without paint selection/pricing

      // Sum section totals
      const section = (room.sectionType || "").trim();
      if (section === "Interior") interior += subtotal;
      else if (section === "Exterior") exterior += subtotal;
      else if (section === "Others") others += subtotal;

      const breakdown = room?.pricing?.breakdown || [];
      const ceilingsTotal = breakdown
        .filter((b) => b.type === "Ceiling")
        .reduce((s, b) => s + toNum(b.price), 0);
      const wallsTotal = breakdown
        .filter((b) => b.type === "Wall")
        .reduce((s, b) => s + toNum(b.price), 0);
      const othersTotal = breakdown
        .filter((b) => b.type !== "Wall" && b.type !== "Ceiling")
        .reduce((s, b) => s + toNum(b.price), 0);

      lines.push({
        roomName,
        sectionType: section,
        subtotal,
        ceilingsTotal,
        wallsTotal,
        othersTotal,
        selectedPaints: room?.pricing?.selectedPaints || null,
        breakdown,
      });
    }

    if (!lines.length) {
      return res
        .status(400)
        .json({ message: "No rooms with paint pricing to quote." });
    }

    const additionalServices = 0; // keep 0 for now
    const totalBeforeDiscount =
      interior + exterior + others + additionalServices;
    const dayCharge = Math.max(1, toNum(days)) * toNum(flatAmount);
    const grandTotal = totalBeforeDiscount - toNum(discount) + dayCharge;

    const quote = await Quote.create({
      quoteNo: `Q${Date.now()}`, // simple & unique enough; replace with your generator if needed
      leadId,
      vendorId: vendorId || null,
      measurementId: meas._id,
      currency: "INR",
      lines,
      totals: {
        interior: +interior.toFixed(2),
        exterior: +exterior.toFixed(2),
        others: +others.toFixed(2),
        additionalServices: +additionalServices.toFixed(2),
        discount: +toNum(discount).toFixed(2),
        dayCharge: +dayCharge.toFixed(2),
        totalBeforeDiscount: +totalBeforeDiscount.toFixed(2),
        grandTotal: +grandTotal.toFixed(2),
      },
      days: toNum(days),
      flatAmount: toNum(flatAmount),
      comments,
      status: "draft",
    });

    return res.status(201).json({
      message: "Quote created",
      data: quote,
    });
  } catch (err) {
    console.error("createQuote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getQuoteById = async (req, res) => {
  try {
    const { id } = req.params;
    const { leadId, vendorId, expand } = req.query;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }

    // Build a scoped query (helps prevent cross-tenant access)
    const query = { _id: id };
    if (leadId) query.leadId = leadId;
    if (vendorId) query.vendorId = vendorId;

    // Base finder
    let q = Quote.findOne(query);

    // Optional light populate of the measurement
    if ((expand || "").toLowerCase() === "measurement") {
      // keep the projection small to avoid heavy payloads
      q = q.populate(
        "measurementId",
        "leadId vendorId totals createdAt updatedAt"
      );
    }

    const quote = await q.lean();
    if (!quote) {
      return res.status(404).json({ message: "Quote not found" });
    }

    return res.status(200).json({ message: "OK", data: quote });
  } catch (err) {
    console.error("getQuoteById error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// exports.listQuotesByLeadAndMeasurement = async (req, res) => {
//   try {
//     const { leadId, measurementId, vendorId } = req.query;

//     if (!leadId || !measurementId) {
//       return res.status(400).json({
//         message: "leadId and measurementId are required",
//       });
//     }

//     const filter = { leadId, measurementId };
//     if (vendorId) filter.vendorId = vendorId;

//     // Keep payload small but useful. Adjust fields as per your schema.
//     const quotes = await Quote.find(filter)
//       .sort({ createdAt: -1 })
//       .select(
//         "_id title status days applyTaxes totals createdAt updatedAt " +
//           "totals.interior totals.exterior totals.others totals.additionalServices totals.grandTotal"
//       )
//       .lean();

//     // Optional: provide a compact view that your app expects (you still get the raw list too)
//     const listView = quotes.map((q) => ({
//       id: String(q._id),
//       title: q.title || "Quote",
//       amount: q?.totals?.grandTotal ?? 0,
//       taxes: !!q.applyTaxes,
//       days: q.days ?? 1,
//       finalized: q.status === "final",
//       breakdown: [
//         { label: "Interior", amount: q?.totals?.interior ?? 0 },
//         { label: "Exterior", amount: q?.totals?.exterior ?? 0 },
//         { label: "Others", amount: q?.totals?.others ?? 0 },
//         {
//           label: "Additional Services",
//           amount: q?.totals?.additionalServices ?? 0,
//         },
//       ],
//     }));

//     return res.status(200).json({
//       message: "OK",
//       data: {
//         list: listView, // ready for your screen
//         raw: quotes, // full data if you need it elsewhere
//       },
//     });
//   } catch (err) {
//     console.error("listQuotesByLeadAndMeasurement error:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

exports.listQuotesByLeadAndMeasurement = async (req, res) => {
  try {
    const { leadId, vendorId } = req.query;

    if (!leadId) {
      return res.status(400).json({
        message: "leadId is required",
      });
    }

    const filter = { leadId };
    if (vendorId) filter.vendorId = vendorId;

    // Keep payload small but useful. Adjust fields as per your schema.
    const quotes = await Quote.find(filter)
      .sort({ createdAt: -1 })

      .lean();

    // Optional: provide a compact view that your app expects (you still get the raw list too)
    const listView = quotes.map((q) => ({
      id: String(q._id),
      title: q.title || "Quote",
      amount: q?.totals?.grandTotal ?? 0,
      taxes: !!q.applyTaxes,
      days: q.days ?? 1,
      finalized: q.status === "final",
      breakdown: [
        { label: "Interior", amount: q?.totals?.interior ?? 0 },
        { label: "Exterior", amount: q?.totals?.exterior ?? 0 },
        { label: "Others", amount: q?.totals?.others ?? 0 },
        {
          label: "Additional Services",
          amount: q?.totals?.additionalServices ?? 0,
        },
      ],
    }));

    return res.status(200).json({
      message: "OK",
      data: {
        list: listView,
        raw: quotes,
      },
    });
  } catch (err) {
    console.error("listQuotesByLeadAndMeasurement error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
