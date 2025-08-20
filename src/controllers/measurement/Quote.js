// controllers/quote.controller.js
const Measurement = require("../../models/measurement/Measurement");
const Quote = require("../../models/measurement/Quote");
const mongoose = require("mongoose");
const { Types } = mongoose;

const toNum = (v) => (Number.isFinite(+v) ? +v : 0);

const round2 = (n) => +Number(n || 0).toFixed(2);

function generateQuoteNo() {
  return `Q${Date.now()}`;
}

function toListItem(q) {
  return {
    id: String(q._id),
    title: q.title || "Quote",
    amount: q?.totals?.grandTotal ?? 0,
    taxes: !!q.taxes,
    days: q.days ?? 1,
    finalized: q.status === "finalized",
    breakdown: [
      { label: "Interior", amount: q?.totals?.interior ?? 0 },
      { label: "Exterior", amount: q?.totals?.exterior ?? 0 },
      { label: "Others", amount: q?.totals?.others ?? 0 },
      {
        label: "Additional Services",
        amount: q?.totals?.additionalServices ?? 0,
      },
    ],
  };
}

const sumBreakdown = (arr = [], t) =>
  arr.filter((b) => b.type === t).reduce((s, b) => s + toNum(b.price), 0);

const buildRoomLine = (name, room) => {
  const bd = Array.isArray(room?.pricing?.breakdown)
    ? room.pricing.breakdown
    : [];
  const subtotal = round2(toNum(room?.pricing?.total));
  return {
    roomName: name,
    sectionType: room.sectionType,
    subtotal,
    ceilingsTotal: round2(sumBreakdown(bd, "Ceiling")),
    wallsTotal: round2(sumBreakdown(bd, "Wall")),
    othersTotal: round2(sumBreakdown(bd, "Measurement")),
    selectedPaints: room?.pricing?.selectedPaints || null,
    breakdown: bd,
  };
};

const sanitizePaint = (p) => {
  if (!p) return null;
  const id = p.id === "undefined" ? null : p.id; // clean bad string ids
  return {
    id,
    name: p.name ?? "",
    isSpecial: !!p.isSpecial,
    price: Number(p.price || 0),
    includePuttyOnFresh: !!p.includePuttyOnFresh,
    includePuttyOnRepaint: !!p.includePuttyOnRepaint,
  };
};

const computeTotals = (
  lines = [],
  discount = { type: "PERCENT", value: 0, amount: 0 },
  days = 1
) => {
  let interior = 0,
    exterior = 0,
    others = 0;
  for (const l of lines) {
    const sub = Number(l?.subtotal || 0);
    const t = (l?.sectionType || "").trim();
    if (t === "Interior") interior += sub;
    else if (t === "Exterior") exterior += sub;
    else others += sub;
  }
  const additionalServices = 0;
  const subtotal = interior + exterior + others + additionalServices;

  let discountAmount = 0;
  if (discount?.type === "PERCENT")
    discountAmount = (Number(discount.value || 0) / 100) * subtotal;
  else if (discount?.type === "FLAT")
    discountAmount = Number(discount.amount || 0);
  else discountAmount = Number(discount?.amount || 0);

  discountAmount = Number(discountAmount.toFixed(2));
  const finalPerDay = Number((subtotal - discountAmount).toFixed(2));
  const grandTotal =
    // days > 1 ? Number((finalPerDay * days).toFixed(2)) :
    finalPerDay;

  return {
    interior,
    exterior,
    others,
    additionalServices,
    subtotal,
    discountAmount,
    finalPerDay,
    grandTotal,
  };
};

exports.createQuote = async (req, res) => {
  try {
    const {
      leadId,
      vendorId,
      measurementId,
      days: rawDays,
      discount: rawDiscount, // { type: 'PERCENT'|'FLAT', value }
      comments,
    } = req.body;

    if (!leadId || !measurementId) {
      return res
        .status(400)
        .json({ message: "leadId and measurementId are required" });
    }

    const meas = await Measurement.findById(measurementId);
    if (!meas)
      return res.status(404).json({ message: "Measurement not found" });
    if (vendorId && String(meas.vendorId) !== String(vendorId)) {
      return res.status(403).json({ message: "Vendor mismatch" });
    }
    if (String(meas.leadId) !== String(leadId)) {
      return res.status(403).json({ message: "Lead mismatch" });
    }

    // Build room lines only for rooms that have pricing
    const lines = [];
    let interior = 0,
      exterior = 0,
      others = 0;

    for (const [name, room] of meas.rooms?.entries?.() ??
      Object.entries(meas.rooms || {})) {
      if (!room?.pricing?.total) continue;
      const line = buildRoomLine(name, room);
      lines.push(line);
      if (room.sectionType === "Interior") interior += line.subtotal;
      else if (room.sectionType === "Exterior") exterior += line.subtotal;
      else if (room.sectionType === "Others") others += line.subtotal;
    }

    interior = round2(interior);
    exterior = round2(exterior);
    others = round2(others);

    const additionalServices = 0; // for now
    const subtotal = round2(interior + exterior + others + additionalServices);

    // Discount
    const dType = rawDiscount?.type === "FLAT" ? "FLAT" : "PERCENT";
    const dValue = toNum(rawDiscount?.value);
    let discountAmount = 0;

    if (dType === "PERCENT") {
      const pct = Math.max(0, Math.min(100, dValue));
      discountAmount = round2(subtotal * (pct / 100));
    } else {
      discountAmount = round2(Math.max(0, dValue));
    }
    // clamp
    discountAmount = Math.min(discountAmount, subtotal);

    const days = Math.max(1, toNum(rawDays));
    const finalPerDay = round2(Math.max(0, subtotal - discountAmount));
    const grandTotal = finalPerDay;

    // Persist
    const quote = await Quote.create({
      quoteNo: `Q${Date.now()}`,
      leadId,
      vendorId: vendorId ?? meas.vendorId,
      measurementId: meas._id,
      currency: "INR",
      days,
      discount: { type: dType, value: dValue, amount: discountAmount },
      lines,
      totals: {
        interior,
        exterior,
        others,
        additionalServices,
        subtotal,
        discountAmount,
        finalPerDay,
        grandTotal,
      },
      comments: comments || "",
      status: "draft",
    });

    return res.status(201).json({ message: "Quotation created", data: quote });
  } catch (err) {
    console.error("createQuote error", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.upsertQuoteRoomPricing = async (req, res) => {
  try {
    const { quoteId, roomName } = req.params;
    if (!Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }

    const q = await Quote.findById(quoteId);
    if (!q) return res.status(404).json({ message: "Quote not found" });

    let {
      sectionType,
      selectedPaints,
      breakdown,
      ceilingsTotal,
      wallsTotal,
      othersTotal,
      subtotal,
    } = req.body;

    if (typeof breakdown === "string") {
      try {
        breakdown = JSON.parse(breakdown);
      } catch {
        return res
          .status(400)
          .json({ message: "breakdown must be array/JSON array" });
      }
    }
    if (!Array.isArray(breakdown)) breakdown = [];

    // Coerce breakdown numbers & normalise names/ids
    breakdown = breakdown.map((b) => ({
      type: b.type,
      mode: b.mode,
      sqft: Number(b.sqft || 0),
      unitPrice: Number(b.unitPrice || 0),
      price: Number(b.price || 0),
      paintId: b.paintId != null ? String(b.paintId) : null,
      paintName: b.paintName ?? "",
      displayIndex:
        typeof b.displayIndex === "number" ? b.displayIndex : undefined,
    }));

    // Coerce totals
    ceilingsTotal = Number(ceilingsTotal || 0);
    wallsTotal = Number(wallsTotal || 0);
    othersTotal = Number(othersTotal || 0);
    subtotal = Number(subtotal || 0);

    const line = {
      roomName,
      sectionType,
      selectedPaints: {
        ceiling: selectedPaints?.ceiling || null,
        wall: selectedPaints?.wall || null,
        measurements: selectedPaints?.measurements || null,
      },
      breakdown,
      ceilingsTotal,
      wallsTotal,
      othersTotal,
      subtotal,
    };

    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const idx = (q.lines || []).findIndex(
      (l) => norm(l.roomName) === norm(roomName)
    );

    if (idx >= 0) {
      q.set(`lines.${idx}`, line); // ensure change tracking
    } else {
      q.lines.push(line);
    }
    q.markModified("lines"); // belt-and-suspenders

    // --- recompute quote totals ---
    const interior = q.lines
      .filter((l) => l.sectionType === "Interior")
      .reduce((s, l) => s + Number(l.subtotal || 0), 0);
    const exterior = q.lines
      .filter((l) => l.sectionType === "Exterior")
      .reduce((s, l) => s + Number(l.subtotal || 0), 0);
    const others = q.lines
      .filter((l) => l.sectionType === "Others")
      .reduce((s, l) => s + Number(l.subtotal || 0), 0);
    const add = Number(q.totals?.additionalServices || 0);

    const subtotalAll = Number((interior + exterior + others + add).toFixed(2));

    let discountAmount = 0;
    if (q.discount?.type === "PERCENT") {
      discountAmount = Number(
        (subtotalAll * (Number(q.discount.value || 0) / 100)).toFixed(2)
      );
    } else if (q.discount?.type === "FLAT") {
      discountAmount = Number(q.discount.amount || 0); // ← use amount for FLAT
      if (discountAmount > subtotalAll) discountAmount = subtotalAll;
      discountAmount = Number(discountAmount.toFixed(2));
    }

    const finalPerDay = Number(
      Math.max(0, subtotalAll - discountAmount).toFixed(2)
    );
    const days = Math.max(1, Number(q.days || 1));
    // const grandTotal = Number((finalPerDay * days).toFixed(2));
    const grandTotal = finalPerDay;

    q.totals = {
      interior,
      exterior,
      others,
      additionalServices: add,
      subtotal: subtotalAll,
      discountAmount,
      finalPerDay,
      grandTotal,
    };

    await q.save();
    return res.json({ message: "OK", data: { line } });
  } catch (err) {
    console.error("upsertQuoteRoomPricing error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.updateQuoteMeta = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { days, discount, comments } = req.body;

    const q = await Quote.findById(quoteId);
    if (!q) return res.status(404).json({ message: "Quote not found" });

    // update simple fields
    if (Number.isFinite(+days)) q.days = Math.max(1, +days);
    if (comments != null) q.comments = comments;

    // normalize discount
    if (discount && (discount.type === "PERCENT" || discount.type === "FLAT")) {
      q.discount.type = discount.type;
      q.discount.value = Number(discount.value || 0);
    }

    // recompute totals from lines
    const toNum = (v) => (Number.isFinite(+v) ? +v : 0);
    const round2 = (n) => +Number(n || 0).toFixed(2);

    const interior = (q.lines || [])
      .filter((l) => l.sectionType === "Interior")
      .reduce((s, l) => s + toNum(l.subtotal), 0);

    const exterior = (q.lines || [])
      .filter((l) => l.sectionType === "Exterior")
      .reduce((s, l) => s + toNum(l.subtotal), 0);

    const others = (q.lines || [])
      .filter((l) => l.sectionType === "Others")
      .reduce((s, l) => s + toNum(l.subtotal), 0);

    const additionalServices = q.totals?.additionalServices || 0;
    const subtotal = round2(interior + exterior + others + additionalServices);

    const calcDiscount = () => {
      if (q.discount?.type === "PERCENT") {
        const pct = Math.max(0, Math.min(100, toNum(q.discount.value)));
        return round2(subtotal * (pct / 100));
      }
      if (q.discount?.type === "FLAT") {
        return round2(Math.max(0, toNum(q.discount.value)));
      }
      return 0;
    };

    const discountAmount = Math.min(calcDiscount(), subtotal);
    q.discount.amount = discountAmount;

    const finalPerDay = round2(subtotal - discountAmount);
    const grandTotal = finalPerDay;
    // const grandTotal = round2(finalPerDay * Math.max(1, q.days || 1));

    q.totals = {
      interior,
      exterior,
      others,
      additionalServices,
      subtotal,
      discountAmount,
      finalPerDay,
      grandTotal,
    };

    await q.save();
    res.json({ message: "OK", data: q });
  } catch (err) {
    console.error("updateQuoteMeta error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.cloneQuoteFrom = async (req, res) => {
  try {
    const sourceId = req.params.id; // ← URL param
    const { destId } = req.body || {}; // ← BODY param
    // console.log("[clone] sourceId=", sourceId, "destId=", destId);
    if (!Types.ObjectId.isValid(sourceId) || !Types.ObjectId.isValid(destId)) {
      return res.status(400).json({ message: "Invalid quote id(s)" });
    }

    const src = await Quote.findById(sourceId).lean();
    if (!src)
      return res.status(404).json({ message: "Source quote not found" });

    // Deep copy + sanitize
    const lines = (src.lines || []).map((line) => ({
      roomName: line.roomName,
      sectionType: line.sectionType,
      subtotal: Number(line.subtotal || 0),
      ceilingsTotal: Number(line.ceilingsTotal || 0),
      wallsTotal: Number(line.wallsTotal || 0),
      othersTotal: Number(line.othersTotal || 0),
      selectedPaints: {
        ceiling: sanitizePaint(line.selectedPaints?.ceiling),
        wall: sanitizePaint(line.selectedPaints?.wall),
        measurements: sanitizePaint(line.selectedPaints?.measurements),
      },
      breakdown: (line.breakdown || []).map((b) => ({
        type: b.type,
        mode: b.mode,
        sqft: Number(b.sqft || 0),
        unitPrice: Number(b.unitPrice || 0),
        price: Number(b.price || 0),
        paintId: b.paintId ?? null,
        paintName: b.paintName ?? "",
        displayIndex:
          typeof b.displayIndex === "number" ? b.displayIndex : undefined,
      })),
    }));

    const days = src.days ?? 1;
    const discount = src.discount ?? { type: "PERCENT", value: 0, amount: 0 };
    const totals = computeTotals(lines, discount, days);

    const updated = await Quote.findByIdAndUpdate(
      destId,
      {
        $set: {
          currency: src.currency || "INR",
          days,
          discount,
          lines,
          totals,
          comments: "",
          status: "draft",
        },
      },
      { new: true }
    ).lean();

    if (!updated)
      return res.status(404).json({ message: "Destination quote not found" });

    return res.status(200).json({ message: "OK", data: updated });
  } catch (err) {
    console.error("cloneQuoteFrom error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// exports.duplicateQuote = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { vendorId, leadId } = req.body || {};

//     // Optional scoping: vendor & lead ownership checks
//     const query = { _id: new mongoose.Types.ObjectId(id) };
//     if (vendorId) query.vendorId = vendorId;
//     if (leadId) query.leadId = leadId;

//     const base = await Quote.findOne(query);
//     if (!base) {
//       return res.status(404).json({ message: "Quote not found" });
//     }

//     // Deep clone the doc
//     const obj = base.toObject({ depopulate: true });
//     delete obj._id;
//     delete obj.createdAt;
//     delete obj.updatedAt;

//     // Mutate fields for the duplicate
//     obj.quoteNo = generateQuoteNo();
//     obj.status = "draft"; // duplicated as draft
//     obj.title = obj.title || "Quote"; // keep or default
//     // keep days, totals, lines, discount, comments, etc. exactly as original

//     const dup = await Quote.create(obj);

//     // Return the full doc & a list-item projection (for convenience)
//     return res.status(201).json({
//       message: "Quote duplicated",
//       data: {
//         quote: dup,
//         listItem: toListItem(dup),
//       },
//     });
//   } catch (err) {
//     console.error("Duplicate quote error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.finalizeQuote = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorId, leadId, exclusive = false } = req.body || {};

    // Ownership scoping (optional but recommended)
    const query = { _id: new mongoose.Types.ObjectId(id) };
    if (vendorId) query.vendorId = vendorId;
    if (leadId) query.leadId = leadId;

    const q = await Quote.findOne(query);
    if (!q) return res.status(404).json({ message: "Quote not found" });

    // Idempotency: already finalized
    if (q.status === "finalized") {
      return res.status(200).json({
        message: "Quote already finalized",
        data: { quote: q, listItem: toListItem(q) },
      });
    }

    // If we want *only one* final quote per measurement, demote others
    if (exclusive) {
      await Quote.updateMany(
        {
          _id: { $ne: q._id },
          leadId: q.leadId,
          vendorId: q.vendorId,
          measurementId: q.measurementId,
        },
        { $set: { status: "draft" }, $unset: { finalizedAt: 1 } }
      );
    }

    q.status = "finalized";
    q.finalizedAt = new Date();
    await q.save();

    return res.status(200).json({
      message: "Quote finalized",
      data: { quote: q, listItem: toListItem(q) },
    });
  } catch (err) {
    console.error("Finalize quote error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// exports.getQuoteById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { leadId, vendorId, expand } = req.query;

//     if (!Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ message: "Invalid quote id" });
//     }

//     // Build a scoped query (helps prevent cross-tenant access)
//     const query = { _id: id };
//     if (leadId) query.leadId = leadId;
//     if (vendorId) query.vendorId = vendorId;

//     // Base finder
//     let q = Quote.findOne(query);

//     // Optional light populate of the measurement
//     if ((expand || "").toLowerCase() === "measurement") {
//       // keep the projection small to avoid heavy payloads
//       q = q.populate(
//         "measurementId",
//         "leadId vendorId totals createdAt updatedAt"
//       );
//     }

//     const quote = await q.lean();
//     if (!quote) {
//       return res.status(404).json({ message: "Quote not found" });
//     }

//     return res.status(200).json({ message: "OK", data: quote });
//   } catch (err) {
//     console.error("getQuoteById error:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };
exports.getQuoteById = async (req, res) => {
  try {
    const { id } = req.params;
    const { leadId, vendorId, expand } = req.query;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }

    // Build scoped query and cast to ObjectId
    const query = { _id: new Types.ObjectId(id) };

    if (leadId && Types.ObjectId.isValid(leadId)) {
      query.leadId = new Types.ObjectId(leadId);
    }
    if (vendorId && Types.ObjectId.isValid(vendorId)) {
      query.vendorId = new Types.ObjectId(vendorId);
    }

    let q = Quote.findOne(query);

    if ((expand || "").toLowerCase() === "measurement") {
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
      // .sort({ createdAt: -1 })
      .lean();

    // Optional: provide a compact view that your app expects (you still get the raw list too)
    const listView = quotes.map((q, idx) => ({
      id: String(q._id),
      title: `Quote ${idx + 1}`,
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
