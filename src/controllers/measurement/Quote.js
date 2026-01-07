// controllers/quote.controller.js
const Measurement = require("../../models/measurement/Measurement");
const Quote = require("../../models/measurement/Quote");
const mongoose = require("mongoose");
const userBookings = require("../../models/user/userBookings");
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

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const sum = (arr, pick = (x) => x) =>
  arr.reduce((t, x) => t + Number(pick(x) || 0), 0);

// old- need to be handle carefully*** REEVERT BACK If needed
exports.upsertQuoteRoomPricing = async (req, res) => {
  try {
    const { quoteId, roomName } = req.params;
    if (!Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }

    // Read once (lean) to get prev line for preservation logic
    const qLean = await Quote.findById(quoteId, {
      lines: 1,
      discount: 1,
      days: 1,
    }).lean();
    if (!qLean) return res.status(404).json({ message: "Quote not found" });

    const idx = (qLean.lines || []).findIndex(
      (l) => norm(l.roomName) === norm(roomName)
    );
    const prevLine = idx >= 0 ? qLean.lines[idx] : null;

    // ---- parse/normalize body ----
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

    ceilingsTotal = Number(ceilingsTotal || 0);
    wallsTotal = Number(wallsTotal || 0);
    othersTotal = Number(othersTotal || 0);
    subtotal = Number(subtotal || 0);

    // ---- preserve additional services from prev line ----
    const preservedAdditional = Array.isArray(prevLine?.additionalServices)
      ? prevLine.additionalServices.map((s) => ({
        serviceType: String(s.serviceType || ""),
        materialId: s.materialId != null ? String(s.materialId) : undefined,
        materialName: String(s.materialName || s.customName || ""),
        surfaceType: String(s.surfaceType || ""),
        withPaint: !!s.withPaint,
        areaSqft: Number(s.areaSqft || 0),
        unitPrice: Number(s.unitPrice || 0),
        total: Number(
          Number(
            s.total || Number(s.areaSqft || 0) * Number(s.unitPrice || 0)
          ).toFixed(2)
        ),
        customName: String(s.customName || ""),
        customNote: String(s.customNote || ""),
      }))
      : [];

    const preservedAdditionalTotal = preservedAdditional.reduce(
      (S, x) => S + Number(x.total || 0),
      0
    );

    // ---- zero paint rows where preserved additional says "without paint" ----
    const parseSurface = (label) => {
      const raw = String(label || "")
        .trim()
        .toLowerCase();
      let type = "Measurement";
      if (raw.startsWith("ceil")) type = "Ceiling";
      else if (raw.startsWith("wall")) type = "Wall";
      const n = raw.match(/(\d+)/);
      const ordinal = n ? Math.max(1, parseInt(n[1], 10)) : 1;
      return { type, ordinal };
    };

    const zeroKeys = new Set(
      preservedAdditional
        .filter((s) => !s.withPaint)
        .map((s) => {
          const { type, ordinal } = parseSurface(s.surfaceType);
          return `${type}:${ordinal}`;
        })
    );

    if (zeroKeys.size > 0 && breakdown.length > 0) {
      const counters = { Ceiling: 0, Wall: 0, Measurement: 0 };
      for (let i = 0; i < breakdown.length; i++) {
        const b = breakdown[i];
        if (!b?.type) continue;
        let ord = b.displayIndex;
        if (typeof ord !== "number") {
          counters[b.type] = (counters[b.type] || 0) + 1;
          ord = counters[b.type];
        }
        const key = `${b.type}:${ord}`;
        if (zeroKeys.has(key)) {
          breakdown[i].sqft = 0;
          breakdown[i].price = 0;
        }
      }
      const sumType = (arr, t) =>
        arr
          .filter((x) => x.type === t)
          .reduce((s, x) => s + Number(x.price || 0), 0);
      ceilingsTotal = Number(sumType(breakdown, "Ceiling").toFixed(2));
      wallsTotal = Number(sumType(breakdown, "Wall").toFixed(2));
      othersTotal = Number(sumType(breakdown, "Measurement").toFixed(2));
      subtotal = Number((ceilingsTotal + wallsTotal + othersTotal).toFixed(2));
    }

    // ---- build final line ----
    const line = {
      roomName,
      sectionType: sectionType || prevLine?.sectionType || "Interior",
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
      additionalServices: preservedAdditional,
      additionalTotal: preservedAdditionalTotal,
    };

    // ---- ATOMIC UPSERT of the room line (no doc.save) ----
    const upd = await Quote.updateOne(
      { _id: quoteId, "lines.roomName": roomName },
      { $set: { "lines.$": line, updatedAt: new Date() } }
    );

    if (upd.matchedCount === 0) {
      await Quote.updateOne(
        { _id: quoteId },
        { $push: { lines: line }, $set: { updatedAt: new Date() } }
      );
    }

    // ---- recompute totals from a fresh read ----
    const fresh = await Quote.findById(quoteId, {
      lines: 1,
      discount: 1,
      days: 1,
    }).lean();
    const lines = fresh?.lines || [];

    const interior = sum(
      lines.filter((l) => l.sectionType === "Interior"),
      (l) => l.subtotal
    );
    const exterior = sum(
      lines.filter((l) => l.sectionType === "Exterior"),
      (l) => l.subtotal
    );
    const others = sum(
      lines.filter((l) => l.sectionType === "Others"),
      (l) => l.subtotal
    );

    const addAll = lines.reduce((S, l) => {
      const fromTotal = Number(l.additionalTotal || 0);
      if (fromTotal > 0) return S + fromTotal;
      const fromList = Array.isArray(l.additionalServices)
        ? l.additionalServices.reduce((a, x) => a + Number(x.total || 0), 0)
        : 0;
      return S + fromList;
    }, 0);

    const subtotalAll = Number(
      (interior + exterior + others + addAll).toFixed(2)
    );
    let discountAmount = 0;
    if (fresh?.discount?.type === "PERCENT") {
      discountAmount = Number(
        (subtotalAll * (Number(fresh.discount.value || 0) / 100)).toFixed(2)
      );
    } else if (fresh?.discount?.type === "FLAT") {
      discountAmount = Math.min(
        Number(fresh.discount.amount || 0),
        subtotalAll
      );
      discountAmount = Number(discountAmount.toFixed(2));
    }

    const finalPerDay = Number(
      Math.max(0, subtotalAll - discountAmount).toFixed(2)
    );
    const grandTotal = finalPerDay;

    await Quote.updateOne(
      { _id: quoteId },
      {
        $set: {
          totals: {
            interior,
            exterior,
            others,
            additionalServices: addAll,
            subtotal: subtotalAll,
            discountAmount,
            finalPerDay,
            grandTotal,
          },
          updatedAt: new Date(),
        },
      }
    );

    return res.json({ message: "OK", data: { line } });
  } catch (err) {
    console.error("upsertQuoteRoomPricing error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.clearQuoteServices = async (req, res) => {
  try {
    const { quoteId } = req.params;
    if (!Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }

    // Find the quote
    const quote = await Quote.findById(quoteId);
    if (!quote) {
      return res.status(404).json({ message: "Quote not found" });
    }

    // Clear all additional services and reset values for all rooms
    const updatedLines = quote.lines.map((line) => {
      return {
        ...line,
        additionalServices: [], // Clear additional services
        additionalTotal: 0, // Set additional total to 0
        subtotal: 0, // Set subtotal to 0
        breakdown: [], // Clear breakdown if needed
        selectedPaints: { ceiling: null, wall: null, measurements: null }, // Reset paints
        ceilingsTotal: 0,
        wallsTotal: 0,
        othersTotal: 0,
      };
    });

    // Update the quote with cleared lines
    quote.lines = updatedLines;
    quote.totals.additionalServices = 0;
    quote.totals.subtotal = 0;
    quote.totals.grandTotal = 0;
    quote.status = "draft"; // Reset the status to draft
    quote.discount = { type: "PERCENT", value: 0, amount: 0 }; // Reset discount if needed

    // Save the updated quote
    await quote.save();

    // Return a success response
    return res.json({
      message: "Quote services cleared successfully",
      data: quote,
    });
  } catch (err) {
    console.error("clearQuoteServices error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.upsertQuoteAdditionalServices = async (req, res) => {
  try {
    const { quoteId, roomName } = req.params;
    if (!Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }

    const q = await Quote.findById(quoteId);
    if (!q) return res.status(404).json({ message: "Quote not found" });

    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const lineIdx = (q.lines || []).findIndex(
      (l) => norm(l.roomName) === norm(roomName)
    );
    if (lineIdx < 0)
      return res.status(404).json({ message: "Room not found on quote" });

    const line = q.lines[lineIdx] || {};

    // --- parse payload items ---
    let items = Array.isArray(req.body?.items) ? req.body.items : [];
    items = items.map((it) => {
      const area = Number(it.areaSqft || 0);
      const unit = Number(it.unitPrice || 0);
      const total = Number(
        (it.total != null ? it.total : area * unit).toFixed(2)
      );
      return {
        serviceType: String(it.serviceType || ""),
        materialId: it.materialId != null ? String(it.materialId) : undefined,
        materialName: String(it.materialName || it.customName || ""),
        surfaceType: String(it.surfaceType || ""),
        withPaint: !!it.withPaint,
        areaSqft: area,
        unitPrice: unit,
        total,
        customName: String(it.customName || ""),
        customNote: String(it.customNote || ""),
      };
    });

    // must know which surface we are updating
    const surfaceRef = req.body?.surfaceRef || null; // { type, index, mode? } optional but preferred
    const surfaceLabelNorm = items.length ? norm(items[0].surfaceType) : ""; // e.g., "wall 1"

    // --- MERGE-BY-SURFACE: keep others, replace only this surface's items ---
    const prev = Array.isArray(line.additionalServices)
      ? line.additionalServices
      : [];
    const keep = prev.filter(
      (s) =>
        surfaceLabelNorm ? norm(s.surfaceType) !== surfaceLabelNorm : true // if no label given, we won't remove by label
    );
    const merged = [...keep, ...items];

    line.additionalServices = merged;
    // line additional total = sum of all additional services on this room (merged)
    line.additionalTotal = merged.reduce((s, x) => s + Number(x.total || 0), 0);

    // --- zero the base breakdown row ONLY for the current surface if any "without paint" ---
    const bd = Array.isArray(line.breakdown)
      ? line.breakdown.map((b) => ({ ...b }))
      : [];
    if (bd.length) {
      // determine whether, for this surface specifically, any WITHOUT paint exists in merged list
      const mergedForThisSurface = merged.filter((s) =>
        surfaceLabelNorm ? norm(s.surfaceType) === surfaceLabelNorm : false
      );
      const shouldZero = mergedForThisSurface.some((s) => !s.withPaint);

      if (shouldZero) {
        // Prefer exact surfaceRef (type + index + optional mode) to pick right base row
        if (surfaceRef && surfaceRef.type && surfaceRef.index != null) {
          const counters = { Ceiling: 0, Wall: 0, Measurement: 0 };
          const t = surfaceRef.type;
          let targeted = false;

          for (let i = 0; i < bd.length; i++) {
            const b = bd[i];
            if (b?.type !== t) continue;
            counters[t] = (counters[t] || 0) + 1;
            const ordinal = counters[t];
            const modeMatches = surfaceRef.mode
              ? String(b?.mode || "") === String(surfaceRef.mode)
              : true;
            if (ordinal === surfaceRef.index && modeMatches) {
              bd[i].sqft = 0;
              bd[i].price = 0;
              targeted = true;
              break;
            }
          }
          // fallback (ignore mode) if we didn't hit
          if (!targeted) {
            counters[t] = 0;
            for (let i = 0; i < bd.length; i++) {
              const b = bd[i];
              if (b?.type !== t) continue;
              counters[t] += 1;
              if (counters[t] === surfaceRef.index) {
                bd[i].sqft = 0;
                bd[i].price = 0;
                break;
              }
            }
          }
        } else if (surfaceLabelNorm) {
          // fallback: parse "Wall 1", "Ceiling 2"
          const raw = surfaceLabelNorm;
          let t = "Measurement";
          if (raw.startsWith("ceil")) t = "Ceiling";
          else if (raw.startsWith("wall")) t = "Wall";
          const numMatch = raw.match(/(\d+)/);
          const ordinalWanted = numMatch
            ? Math.max(1, parseInt(numMatch[1], 10))
            : 1;

          const counters = { Ceiling: 0, Wall: 0, Measurement: 0 };
          for (let i = 0; i < bd.length; i++) {
            const b = bd[i];
            if (b?.type !== t) continue;
            counters[t] = (counters[t] || 0) + 1;
            if (counters[t] === ordinalWanted) {
              bd[i].sqft = 0;
              bd[i].price = 0;
              break;
            }
          }
        }
      }
    }

    // --- recompute line totals from updated breakdown (paint subtotals) ---
    const sumBreakdown = (arr, typ) =>
      arr
        .filter((x) => x.type === typ)
        .reduce((s, x) => s + Number(x.price || 0), 0);

    line.breakdown = bd;
    line.ceilingsTotal = Number(sumBreakdown(bd, "Ceiling").toFixed(2));
    line.wallsTotal = Number(sumBreakdown(bd, "Wall").toFixed(2));
    line.othersTotal = Number(sumBreakdown(bd, "Measurement").toFixed(2));
    line.subtotal = Number(
      (line.ceilingsTotal + line.wallsTotal + line.othersTotal).toFixed(2)
    );

    q.set(`lines.${lineIdx}`, line);
    q.markModified("lines");

    // --- recompute quote totals (base + additional) ---
    const interior = q.lines
      .filter((l) => l.sectionType === "Interior")
      .reduce((s, l) => s + Number(l.subtotal || 0), 0);
    const exterior = q.lines
      .filter((l) => l.sectionType === "Exterior")
      .reduce((s, l) => s + Number(l.subtotal || 0), 0);
    const others = q.lines
      .filter((l) => l.sectionType === "Others")
      .reduce((s, l) => s + Number(l.subtotal || 0), 0);
    const addAll = q.lines.reduce(
      (s, l) => s + Number(l.additionalTotal || 0),
      0
    );

    const subtotalAll = Number(
      (interior + exterior + others + addAll).toFixed(2)
    );

    let discountAmount = 0;
    if (q.discount?.type === "PERCENT") {
      discountAmount = Number(
        (subtotalAll * (Number(q.discount.value || 0) / 100)).toFixed(2)
      );
    } else if (q.discount?.type === "FLAT") {
      discountAmount = Number(q.discount.amount || 0);
      if (discountAmount > subtotalAll) discountAmount = subtotalAll;
      discountAmount = Number(discountAmount.toFixed(2));
    }

    const finalPerDay = Number(
      Math.max(0, subtotalAll - discountAmount).toFixed(2)
    );
    const grandTotal = finalPerDay;

    q.totals = {
      interior,
      exterior,
      others,
      additionalServices: addAll,
      subtotal: subtotalAll,
      discountAmount,
      finalPerDay,
      grandTotal,
    };

    await q.save();

    return res.json({
      message: "OK",
      data: {
        roomName,
        additionalServices: line.additionalServices,
        additionalTotal: line.additionalTotal,
        ceilingsTotal: line.ceilingsTotal,
        wallsTotal: line.wallsTotal,
        othersTotal: line.othersTotal,
        subtotal: line.subtotal,
        totals: q.totals,
      },
    });
  } catch (err) {
    console.error("upsertQuoteAdditionalServices error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.removeAdditionalService = async (req, res) => {
  try {
    const { quoteId, roomName } = req.params;
    const where = req.body?.where || {};
    const norm = (s) => (s || "").trim().toLowerCase();

    if (!Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }
    const q = await Quote.findById(quoteId);
    if (!q) return res.status(404).json({ message: "Quote not found" });

    const li = (q.lines || []).findIndex(
      (l) => norm(l.roomName) === norm(roomName)
    );
    if (li < 0) return res.status(404).json({ message: "Room line not found" });

    const line = q.lines[li];
    const list = Array.isArray(line.additionalServices)
      ? line.additionalServices
      : [];

    const eqNum = (a, b) => Number(a || 0) === Number(b || 0);
    const same = (s) =>
      norm(s.surfaceType) === norm(where.surfaceType) &&
      norm(s.serviceType) === norm(where.serviceType) &&
      String(s.materialId || "") === String(where.materialId || "") &&
      eqNum(s.unitPrice, where.unitPrice) &&
      eqNum(s.areaSqft, where.areaSqft) &&
      !!s.withPaint === !!where.withPaint &&
      norm(s.materialName || s.customName || "") ===
      norm(where.materialName || where.customName || "");

    const i = list.findIndex(same);
    if (i < 0) {
      return res.status(404).json({ message: "Additional service not found" });
    }

    const removed = list.splice(i, 1)[0];
    // recompute room additional total
    const additionalTotal = list.reduce(
      (s, it) => s + Number(it.total || 0),
      0
    );
    line.additionalServices = list;
    line.additionalTotal = Number(additionalTotal.toFixed(2));

    // recompute quote totals (don’t try to “restore” paint sqft here — SelectPaint save will do)
    const sumRoom = (sect) =>
      (q.lines || [])
        .filter((l) => l.sectionType === sect)
        .reduce((s, l) => s + Number(l.subtotal || 0), 0);

    const interior = sumRoom("Interior");
    const exterior = sumRoom("Exterior");
    const others = sumRoom("Others");
    const addAll = (q.lines || []).reduce(
      (s, l) =>
        s +
        (Array.isArray(l.additionalServices)
          ? l.additionalServices.reduce((a, x) => a + Number(x.total || 0), 0)
          : Number(l.additionalTotal || 0)),
      0
    );

    const subtotalAll = Number(
      (interior + exterior + others + addAll).toFixed(2)
    );
    let discountAmount = 0;
    if (q.discount?.type === "PERCENT") {
      discountAmount = Number(
        (subtotalAll * (Number(q.discount.value || 0) / 100)).toFixed(2)
      );
    } else if (q.discount?.type === "FLAT") {
      discountAmount = Math.min(subtotalAll, Number(q.discount.amount || 0));
      discountAmount = Number(discountAmount.toFixed(2));
    }
    const finalPerDay = Number(
      Math.max(0, subtotalAll - discountAmount).toFixed(2)
    );
    q.totals = {
      interior,
      exterior,
      others,
      additionalServices: addAll,
      subtotal: subtotalAll,
      discountAmount,
      finalPerDay,
      grandTotal: finalPerDay,
    };

    await q.save();
    return res.json({ message: "Deleted", data: { line, removed } });
  } catch (err) {
    console.error("removeAdditionalService error", err);
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

    q.status = "created";

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

    if (!Types.ObjectId.isValid(sourceId) || !Types.ObjectId.isValid(destId)) {
      return res.status(400).json({ message: "Invalid quote id(s)" });
    }

    const src = await Quote.findById(sourceId).lean();
    if (!src)
      return res.status(404).json({ message: "Source quote not found" });

    // Function to calculate additional services total
    const calculateAdditionalServicesTotal = (additionalServices = []) => {
      return additionalServices.reduce((total, service) => {
        return total + (service.total || 0); // Ensure we add the total of each service
      }, 0);
    };

    // Deep copy + sanitize including additional services
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
      additionalServices: line.additionalServices || [], // Ensure additional services are copied
      additionalTotal: Number(line.additionalTotal || 0),
    }));

    // Calculate additional services total and add it to totals
    const additionalServicesTotal = lines.reduce((sum, line) => {
      return sum + calculateAdditionalServicesTotal(line.additionalServices);
    }, 0);

    const days = src.days ?? 1;
    const discount = src.discount ?? { type: "PERCENT", value: 0, amount: 0 };
    const totals = computeTotals(lines, discount, days);

    // Include the additional services total in the grand total calculation
    totals.additionalServices = additionalServicesTotal;
    totals.grandTotal += additionalServicesTotal;

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
          status: "draft", // Reset the status to draft
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

exports.deleteIfEmptyDraft = async (req, res) => {
  try {
    const { quoteId } = req.params;
    if (!Types.ObjectId.isValid(quoteId)) {
      return res.status(400).json({ message: "Invalid quote id" });
    }
    const q = await Quote.findById(quoteId);
    if (!q) return res.status(404).json({ message: "Quote not found" });
    if ((q.status || "draft") !== "draft") {
      return res
        .status(400)
        .json({ message: "Only draft quotes can be removed" });
    }
    const hasContent = (q.lines || []).some(
      (l) =>
        Number(l.subtotal || 0) > 0 ||
        (Array.isArray(l.additionalServices) && l.additionalServices.length > 0)
    );
    if (hasContent) {
      return res.status(400).json({ message: "Quote is not empty" });
    }
    await q.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteIfEmptyDraft error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.finalizeQuote = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorId, leadId, exclusive = false } = req.body || {};

    const query = { _id: new mongoose.Types.ObjectId(id) };

    if (vendorId) query.vendorId = vendorId;
    if (leadId) query.leadId = leadId;

    const findLead = await userBookings.findById(leadId);
    if (!findLead) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const q = await Quote.findOne(query);
    if (!q) return res.status(404).json({ message: "Quote not found" });

    if (q.status === "finalized") {
      return res.status(200).json({
        message: "Quote already finalized",
        data: { quote: q, listItem: toListItem(q) },
      });
    }
    const updatePrice = {};
    if (q.totals?.grandTotal) {
      updatePrice["bookingDetails.amountYetToPay"] = q.totals.grandTotal;
      updatePrice["bookingDetails.originalTotalAmount"] = q.totals.grandTotal;
      updatePrice["bookingDetails.bookingAmount"] = q.totals.grandTotal; // ✅ ADD THIS
    }
    await userBookings.findByIdAndUpdate(
      leadId,
      { $set: updatePrice },
      { new: true }
    );

    if (exclusive) {
      await Quote.updateMany(
        {
          _id: { $ne: q._id },
          leadId: q.leadId,
          vendorId: q.vendorId,
          measurementId: q.measurementId,
          status: "finalized",
        },
        { $set: { status: "created" }, $unset: { finalizedAt: 1 } }
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

exports.getFinalizedQuoteByLeadId = async (req, res) => {
  try {
    const { id: leadId } = req.params;

    if (!leadId) {
      return res.status(400).json({ message: "LeadId is required" });
    }

    const quote = await Quote.findOne({
      leadId,
      status: "finalized",
    }).lean();

    if (!quote) {
      return res.status(404).json({
        message: "Finalized quote not found for this lead",
      });
    }

    return res.status(200).json({
      message: "OK",
      data: quote,
    });
  } catch (err) {
    console.error("getFinalizedQuoteByLeadId error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

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

exports.listQuotesByLeadAndMeasurement = async (req, res) => {
  try {
    const { leadId, vendorId } = req.query;

    if (!leadId) {
      return res.status(400).json({
        message: "leadId is required",
      });
    }

    // const filter = { leadId }; returin all based on status
    const filter = { leadId, status: { $ne: "draft" } }; // Exclude drafts
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
      finalized: q.status === "finalized",
      locked: q.locked,
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
