// Builds the HTML used to render the customer-facing quote PDF.
// Mirrors HomjeeVendor-main/src/screens/Home Painting/QuotesView.js layout.

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeText = (v, fb = "—") => {
  const s = String(v ?? "").trim();
  return s.length ? s : fb;
};

const rupee = (val) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return "—";
  return `₹ ${num.toLocaleString("en-IN")}`;
};

const getDayLabel = (days) => {
  const d = Number(days ?? 0);
  if (!Number.isFinite(d) || d <= 0) return "—";
  return `${d} ${d === 1 ? "Day" : "Days"}`;
};

const modeLabel = (mode) => {
  const m = String(mode || "").toUpperCase();
  if (m === "REPAINT") return "Repaint With Primer";
  if (m === "FRESH") return "Fresh Paint";
  if (m === "WHITEWASH") return "Whitewash";
  return m || "";
};

const labelType = (t, roomName) => {
  const x = String(t || "").toLowerCase();
  if (x.includes("measurement")) return roomName;
  if (x.includes("ceiling")) return "Ceiling";
  if (x.includes("wall")) return "Wall";
  return t || "";
};

const weightType = (t) => {
  const x = String(t || "").toLowerCase();
  if (x.includes("ceiling")) return 1;
  if (x.includes("wall")) return 2;
  if (x.includes("measurement")) return 3;
  return 9;
};

const getCountFromMeasurement = (measurement, roomName, type, mode) => {
  try {
    const room = measurement?.rooms?.[roomName] || measurement?.rooms?.get?.(roomName);
    if (!room) return 0;
    const m = String(mode || "").toUpperCase();
    const t = String(type || "").toLowerCase();

    if (t.includes("ceiling")) {
      const arr = Array.isArray(room?.ceilings) ? room.ceilings : [];
      return arr.filter((x) => String(x?.mode || "").toUpperCase() === m).length;
    }
    if (t.includes("wall")) {
      const arr = Array.isArray(room?.walls) ? room.walls : [];
      return arr.filter((x) => String(x?.mode || "").toUpperCase() === m).length;
    }
    if (t.includes("measurement")) {
      const arr = Array.isArray(room?.measurements) ? room.measurements : [];
      return arr.filter((x) => String(x?.mode || "").toUpperCase() === m).length;
    }
    return 0;
  } catch {
    return 0;
  }
};

const buildRoomWise = (quote, measurement) => {
  const lines = Array.isArray(quote?.lines) ? quote.lines : [];
  const bySection = { Interior: [], Exterior: [], Others: [] };

  for (const ln of lines) {
    const sectionType = ln?.sectionType || "Others";
    const roomName = ln?.roomName || "Room";

    const breakdown = Array.isArray(ln?.breakdown) ? ln.breakdown : [];
    const map = new Map();

    for (const b of breakdown) {
      const sqft = Number(b?.sqft ?? 0);
      const price = Number(b?.price ?? 0);
      const paintName = b?.paintName || "Paint";
      const type = b?.type || "";
      const mode = b?.mode || "";
      const key = `${paintName}__${type}__${mode}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          paintName,
          type,
          mode,
          sqft,
          price,
          unitPrice: Number(b?.unitPrice ?? 0),
          count: getCountFromMeasurement(measurement, roomName, type, mode),
        });
      } else {
        prev.sqft += sqft;
        prev.price += price;
        map.set(key, prev);
      }
    }

    const paintRows = Array.from(map.values()).sort((a, b) => {
      const wa = weightType(a.type);
      const wb = weightType(b.type);
      if (wa !== wb) return wa - wb;
      const ma = String(a.mode || "").toUpperCase();
      const mb = String(b.mode || "").toUpperCase();
      if (ma !== mb) return ma.localeCompare(mb);
      return String(a.paintName || "").localeCompare(String(b.paintName || ""));
    });

    const additionalServices = Array.isArray(ln?.additionalServices)
      ? ln.additionalServices
      : [];
    const additionalItems = additionalServices.map((x) => ({
      serviceType: x?.serviceType || "Additional Service",
      materialName: x?.customName?.trim() ? x.customName : x?.materialName,
      surfaceType: x?.surfaceType || "",
      areaSqft: Number(x?.areaSqft ?? 0),
      unitPrice: Number(x?.unitPrice ?? 0),
      total: Number(x?.total ?? 0),
    }));

    const paintSubtotal = Number(ln?.subtotal ?? 0);
    const additionalTotal = Number(ln?.additionalTotal ?? 0);

    if (!bySection[sectionType]) bySection[sectionType] = [];
    bySection[sectionType].push({
      roomName,
      subtotal: paintSubtotal + additionalTotal,
      paintRows: paintRows.filter((p) => Number(p?.price ?? 0) > 0),
      additionalItems,
    });
  }

  return bySection;
};

const buildServiceWise = (quote) => {
  const lines = Array.isArray(quote?.lines) ? quote.lines : [];
  const paintMap = new Map();
  const addMap = new Map();

  for (const ln of lines) {
    const breakdown = Array.isArray(ln?.breakdown) ? ln.breakdown : [];
    for (const b of breakdown) {
      const key = `${b?.paintName || "Paint"}__${b?.type || ""}`;
      const prev = paintMap.get(key);
      const sqft = Number(b?.sqft ?? 0);
      const price = Number(b?.price ?? 0);
      if (!prev) {
        paintMap.set(key, {
          kind: "paint",
          title: b?.paintName || "Paint",
          sub: `${b?.type || ""}`,
          sqft,
          amount: price,
          type: b?.type || "",
        });
      } else {
        prev.sqft += sqft;
        prev.amount += price;
        prev.sub = `${prev.type} (${Math.round(prev.sqft)} sqft)`;
        paintMap.set(key, prev);
      }
    }

    const additional = Array.isArray(ln?.additionalServices)
      ? ln.additionalServices
      : [];
    for (const a of additional) {
      const title = a?.serviceType || "Additional Service";
      const name = a?.customName?.trim() ? a.customName : a?.materialName;
      const key = `${title}__${name}__${a?.surfaceType || ""}`;
      const prev = addMap.get(key);
      const area = Number(a?.areaSqft ?? 0);
      const total = Number(a?.total ?? 0);
      if (!prev) {
        addMap.set(key, {
          kind: "additional",
          title,
          sub: `${name || ""}${a?.surfaceType ? ` • ${a.surfaceType}` : ""} (${Math.round(area)} sqft)`,
          amount: total,
        });
      } else {
        prev.amount += total;
        addMap.set(key, prev);
      }
    }
  }

  const out = [...paintMap.values(), ...addMap.values()];
  out.sort((a, b) => {
    const wa = a.kind === "additional" ? 9 : weightType(a.type);
    const wb = b.kind === "additional" ? 9 : weightType(b.type);
    if (wa !== wb) return wa - wb;
    return String(a.title).localeCompare(String(b.title));
  });
  return out;
};

const renderRoomCostTable = (title, rooms) => {
  if (!rooms?.length) return "";
  return `
    <div class="tableBox">
      <div class="tableHeader"><div class="tableHeaderText">${escapeHtml(title)}</div></div>
      ${rooms
        .map(
          (r, idx) => `
        <div class="roomHeader">
          <div class="roomTitle">${escapeHtml(safeText(r.roomName))}</div>
          <div class="roomAmt">${escapeHtml(rupee(r.subtotal))}</div>
        </div>
        ${r.paintRows
          .map(
            (p) => `
          <div class="roomRow">
            <div class="roomRowLeft">
              <div class="roomPaint">${escapeHtml(safeText(p.paintName))} ${escapeHtml(modeLabel(p.mode))}</div>
              <div class="roomMeta">${Number(p.count || 0)} ${escapeHtml(labelType(p.type, r.roomName))} (${Math.round(Number(p.sqft ?? 0))}sqft)</div>
            </div>
            <div class="roomRowAmt">${escapeHtml(rupee(p.price))}</div>
          </div>
        `,
          )
          .join("")}
        ${r.additionalItems
          .map(
            (a) => `
          <div class="roomRow">
            <div class="roomRowLeft">
              <div class="roomPaint">${escapeHtml(safeText(a.serviceType))} ${a.materialName ? "• " + escapeHtml(a.materialName) : ""}</div>
              <div class="roomMeta">${a.surfaceType ? escapeHtml(a.surfaceType) + " • " : ""}(${Math.round(Number(a.areaSqft ?? 0))} sqft) • ₹ ${Number(a.unitPrice ?? 0)}/sqft</div>
            </div>
            <div class="roomRowAmt">${escapeHtml(rupee(a.total))}</div>
          </div>
        `,
          )
          .join("")}
        ${idx !== rooms.length - 1 ? '<div class="tableLine"></div>' : ""}
      `,
        )
        .join("")}
    </div>
  `;
};

const renderQuoteHtml = ({ quote, customer, vendor, measurement }) => {
  const t = quote?.totals || {};
  const roomWise = buildRoomWise(quote, measurement);
  const serviceWise = buildServiceWise(quote);
  const customerName = safeText(customer?.name, "Customer");
  const vendorPhone = safeText(vendor?.phone, "—");
  const hasDiscount = Number(t?.discountAmount || 0) > 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Homjee Quote</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Poppins', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #1F2937;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 16px 18px 24px; }
  .header { text-align: center; margin: 4px 0 8px; }
  .logo { height: 32px; object-fit: contain; }
  .hi { font-size: 13px; font-weight: 600; color: #1B1B1B; margin-top: 6px; }
  .subText { margin-top: 6px; color: #4B5563; font-size: 11px; line-height: 1.55; font-weight: 500; }

  .topRow { display: flex; gap: 10px; margin-top: 14px; }
  .quoteCard, .guaranteeCard { background: #ddecff; border-radius: 14px; padding: 12px; }
  .quoteCard { flex: 1.05; }
  .guaranteeCard { flex: 0.95; }
  .pill { display: inline-block; background: #2B6CB0; color: #fff; padding: 4px 10px; border-radius: 10px; font-weight: 600; font-size: 11px; margin-bottom: 8px; }
  .smallMuted { color: #2B6CB0; font-size: 11px; text-decoration: line-through; font-weight: 600; }
  .bigTotal { margin-top: 2px; font-size: 18px; font-weight: 600; color: #111827; }
  .plusTaxes { font-size: 10px; font-weight: 600; color: #3279a7; }
  .rowLine { display: flex; justify-content: space-between; margin: 3px 0; }
  .rowLabel, .rowValue { color: #1F2937; font-size: 10px; font-weight: 600; }
  .sep { height: 1px; background: #46748f; margin: 10px 0; }
  .durationText { color: #1F2937; font-size: 10px; font-weight: 600; }

  .gItem { display: flex; gap: 8px; margin: 4px 0; align-items: flex-start; }
  .gTick { color: #2B6CB0; font-weight: 600; margin-top: 1px; }
  .gText { color: #1F2937; font-size: 10px; line-height: 1.55; font-weight: 400; }

  .scrollHint { margin-top: 12px; text-align: center; font-size: 9px; color: #6B7280; }

  .sectionTitle { text-align: center; font-size: 13px; font-weight: 600; color: #111827; margin: 18px 0 10px; }

  .tableBox { border-radius: 14px; border: 1px solid #98c7e4; overflow: hidden; margin-bottom: 12px; }
  .tableHeader { padding: 10px 12px; border-bottom: 1px solid #155f8a; }
  .tableHeaderText { text-align: center; font-weight: 600; font-size: 12px; color: #1F2937; }

  .roomHeader {
    display: flex; justify-content: space-between;
    padding: 10px 12px; background: #ddecff;
    border-top: 1px solid #155f8a;
  }
  .roomTitle, .roomAmt { font-weight: 600; font-size: 11px; color: #111827; }

  .roomRow { display: flex; justify-content: space-between; padding: 10px 12px; background: #fff; }
  .roomRowLeft { flex: 1; padding-right: 10px; }
  .roomPaint { font-weight: 600; color: #111827; font-size: 11px; }
  .roomMeta { color: #6B7280; font-weight: 400; font-size: 10px; margin-top: 2px; }
  .roomRowAmt { font-weight: 500; color: #111827; font-size: 11px; align-self: flex-start; }
  .tableLine { border-top: 1px solid #155f8a; }

  .tableRow { display: flex; justify-content: space-between; padding: 7px 12px; }
  .tableRowTitle { font-weight: 600; color: #111827; font-size: 11px; }
  .tableRowSub { color: #6B7280; font-size: 10px; margin-top: 2px; font-weight: 400; }
  .tableRowAmt { font-weight: 600; color: #111827; font-size: 11px; align-self: flex-start; }

  .miniTotalRow {
    display: flex; justify-content: space-between;
    padding: 8px 12px; background: #fff;
    border-top: 1px solid #EEF4FF;
  }
  .miniLabel, .miniValue { color: #374151; font-size: 11px; font-weight: 600; }
  .note { padding: 10px 12px; color: #fff; font-size: 9px; font-weight: 500; text-align: center; background: #277cb3; border-top: 1px solid #EEF4FF; }

  .whyRow { display: flex; flex-wrap: wrap; justify-content: space-between; margin-bottom: 30px; }
  .whyChip { width: 48%; text-align: center; padding: 12px 10px; border-radius: 14px; margin-bottom: 10px; }
  .whyIconWrap { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; }
  .whyIconWrap img { width: 40px; height: 40px; object-fit: contain; }
  .whyChipText { text-align: center; font-size: 10px; font-weight: 500; color: #0b3769; line-height: 1.4; margin-top: 10px; }

  .processBox { display: flex; gap: 10px; justify-content: space-between; }
  .processCol { flex: 1; padding: 10px; }
  .processTitlePill { background: #277cb3; padding: 6px 8px; border-radius: 10px; margin-bottom: 8px; }
  .processTitle { color: #fff; font-weight: 600; font-size: 11px; }
  .processItem { color: #000; font-size: 10.8px; line-height: 1.3; font-weight: 400; }

  .blockBox { padding: 12px; }
  .bulletRow { display: flex; gap: 8px; margin-top: 6px; }
  .bulletDot { font-weight: 500; color: #000; }
  .bulletText { font-weight: 500; color: #707274; font-size: 11px; line-height: 1.55; }
  .para { color: #707274; font-size: 12px; line-height: 1.45; font-weight: 500; margin-bottom: 5px; }

  .footer { margin-top: 18px; text-align: center; }
  .footerText { color: #707274; font-weight: 500; font-size: 12px; }
  .linkText { color: #2563EB; font-size: 12px; font-weight: 600; }
  .thank { margin-top: 14px; font-weight: 600; color: #111827; }

  /* Avoid breaking inside cards/tables */
  .tableBox, .quoteCard, .guaranteeCard, .whyChip, .processCol { page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <img class="logo" src="https://res.cloudinary.com/dddc5vq0h/image/upload/v1778673628/homjee/logo_onj8ho.png" alt="Homjee" />
    </div>

    <div class="hi">Hi ${escapeHtml(customerName)},</div>
    <div class="subText">Here is a quote for your painting work based on accurate measurements. If you need any clarifications, reply to us.</div>

    <div class="topRow">
      <div class="quoteCard">
        <span class="pill">Quote</span>
        ${hasDiscount ? `<div class="smallMuted">${escapeHtml(rupee(t.subtotal))}</div>` : ""}
        <div class="bigTotal">${escapeHtml(rupee(t.grandTotal))} <span class="plusTaxes">+ Taxes</span></div>
        <div class="rowLine"><span class="rowLabel">Interior</span><span class="rowValue">${escapeHtml(rupee(t.interior))}</span></div>
        <div class="rowLine"><span class="rowLabel">Exterior</span><span class="rowValue">${escapeHtml(rupee(t.exterior))}</span></div>
        <div class="rowLine"><span class="rowLabel">Other</span><span class="rowValue">${escapeHtml(rupee(t.others))}</span></div>
        <div class="sep"></div>
        <div class="durationText">⏱ Project Duration: ${escapeHtml(getDayLabel(quote?.days))}</div>
      </div>

      <div class="guaranteeCard">
        <span class="pill">Homjee Guarantee</span>
        <div class="gItem"><span class="gTick">✓</span><span class="gText">Accurate area measurement.</span></div>
        <div class="gItem"><span class="gTick">✓</span><span class="gText">Genuine best quality paints.</span></div>
        <div class="gItem"><span class="gTick">✓</span><span class="gText">Dedicated project manager &amp; trained painters.</span></div>
        <div class="gItem"><span class="gTick">✓</span><span class="gText">Furniture masking &amp; post service cleanup.</span></div>
        <div class="gItem"><span class="gTick">✓</span><span class="gText">On-time project completion.</span></div>
      </div>
    </div>

    <div class="scrollHint">*Scroll down to see detailed price breakup</div>

    <div class="sectionTitle">Room-wise Painting Cost</div>
    ${renderRoomCostTable("For Interior", roomWise.Interior)}
    ${renderRoomCostTable("For Exterior", roomWise.Exterior)}
    ${renderRoomCostTable("For Others", roomWise.Others)}

    <div class="sectionTitle">Why Choose Homjee</div>
    <div class="whyRow">
      <div class="whyChip">
        <div class="whyIconWrap"><img src="https://img.icons8.com/dotty/80/20618d/user.png" alt="" /></div>
        <div class="whyChipText">Dedicated Project Manager</div>
      </div>
      <div class="whyChip">
        <div class="whyIconWrap"><img src="https://img.icons8.com/ios/50/20618d/roller-brush--v1.png" alt="" /></div>
        <div class="whyChipText">Genuine Product Used</div>
      </div>
      <div class="whyChip">
        <div class="whyIconWrap"><img src="https://img.icons8.com/ios/50/20618d/diamond--v1.png" alt="" /></div>
        <div class="whyChipText">100% Transparency</div>
      </div>
      <div class="whyChip">
        <div class="whyIconWrap"><img src="https://img.icons8.com/ios/50/20618d/approval--v1.png" alt="" /></div>
        <div class="whyChipText">6 months service warranty</div>
      </div>
    </div>

    <div class="tableBox">
      <div class="tableHeader"><div class="tableHeaderText">Service-wise Cost</div></div>
      ${serviceWise
        .map(
          (it) => `
        <div class="tableRow">
          <div class="roomRowLeft">
            <div class="tableRowTitle">${escapeHtml(safeText(it.title))}</div>
            <div class="tableRowSub">${escapeHtml(safeText(it.sub))}</div>
          </div>
          <div class="tableRowAmt">${escapeHtml(rupee(it.amount))}</div>
        </div>
      `,
        )
        .join("")}
      <div class="tableLine"></div>
      <div class="miniTotalRow"><span class="miniLabel">Original Cost</span><span class="miniValue">${escapeHtml(rupee(t.subtotal))}</span></div>
      <div class="miniTotalRow"><span class="miniLabel">Discount</span><span class="miniValue">${escapeHtml(rupee(t.discountAmount))}</span></div>
      <div class="miniTotalRow"><span class="miniLabel" style="font-weight:700">Final Cost</span><span class="miniValue" style="font-weight:700">${escapeHtml(rupee(t.grandTotal))}</span></div>
      <div class="note">*All measurements are taken by laser device.</div>
    </div>

    <div class="tableBox" style="margin-top:10px">
      <div class="tableHeader"><div class="tableHeaderText">Paint Process</div></div>
      <div class="processBox">
        <div class="processCol">
          <div class="processTitlePill"><div class="processTitle">Whitewash Process</div></div>
          ${["Packaging & masking", "Sanding", "2 coats of putty", "Basic cleanup"]
            .map((x) => `<div class="bulletRow"><span class="bulletDot">+</span><span class="processItem">${escapeHtml(x)}</span></div>`)
            .join("")}
        </div>
        <div class="processCol">
          <div class="processTitlePill"><div class="processTitle">Repaint Process</div></div>
          ${["Packaging & masking", "Sanding", "Minor damage repair", "1 coat primer", "2 coats of paint", "Basic cleanup"]
            .map((x) => `<div class="bulletRow"><span class="bulletDot">+</span><span class="processItem">${escapeHtml(x)}</span></div>`)
            .join("")}
        </div>
        <div class="processCol">
          <div class="processTitlePill"><div class="processTitle">Fresh Paint Process</div></div>
          ${["Packaging & masking", "Damage repair", "2 coats of putty", "Hand sanding", "1 coat primer", "2 coats of paint", "Basic cleanup"]
            .map((x) => `<div class="bulletRow"><span class="bulletDot">+</span><span class="processItem">${escapeHtml(x)}</span></div>`)
            .join("")}
        </div>
      </div>
    </div>

    <div class="tableBox" style="margin-top:10px">
      <div class="tableHeader"><div class="tableHeaderText">Paint Details</div></div>
      <div class="blockBox">
        <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Tractor Emulsion is a basic emulsion with smooth finish.</span></div>
        <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Royale Luxury is a premium washable finish for interior walls.</span></div>
        <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Oil enamel is durable and glossy for wood and metal surfaces.</span></div>
      </div>
    </div>

    <div class="sectionTitle">Scope of Work T&amp;C</div>
    <div class="blockBox">
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Homjee will only be responsible for the work mentioned in the quotation.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Any work not covered in the quote will be considered extra.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">In case of any dispute, scope of work mentioned in the quote will be followed.</span></div>
    </div>

    <div class="sectionTitle">Payment T&amp;C</div>
    <div class="blockBox">
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">40% advance to be paid before work starts.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">40% to be paid after 50% completion.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">20% to be paid at the end after final day of work.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">We do not accept cash. Payments should be made online only.</span></div>
    </div>

    <div class="sectionTitle">Warranty T&amp;C</div>
    <div class="blockBox">
      <div class="para">Warranty is applicable as per conditions defined below. The warranty starts from the date of completion of the painting project.</div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Warranty claim can be raised for paint peeling or major issues.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Damage due to seepage, damp walls or external factors is not covered.</span></div>
      <div class="bulletRow"><span class="bulletDot">-</span><span class="bulletText">Any misuse or changes by third party voids warranty.</span></div>
    </div>

    <div class="footer">
      <div class="footerText">In case you need any assistance,</div>
      <div class="footerText">Please feel free to contact us on <span class="linkText">+91 ${escapeHtml(vendorPhone)}</span></div>
      <div class="footerText">or write to us on <span class="linkText">info@homjee.com</span></div>
      <div class="thank">❤️ Thank you ❤️</div>
    </div>
  </div>
</body>
</html>`;
};

module.exports = { renderQuoteHtml };
