// Computes available time slots for a service request.
//
// Inputs:
//   vendors       — already filtered through the eligibility pipeline
//                   (archived/radius/coins/team/KPI). The engine only
//                   does TIME-BLOCK math, not eligibility.
//   bookings      — confirmed bookings on the requested date that
//                   could clash with the requested time window.
//   activeHolds   — Redis-held reservations (pending payments) that
//                   should also block their vendor for that window.
//   serviceType   — "deep_cleaning" | "house_painting"
//   serviceDuration — minutes (DC: sum of selected packages, HP: 30)
//   minTeamMembers  — DC only; ignored for HP
//   date           — "YYYY-MM-DD"
//   lat, lng       — customer location (used elsewhere in the pipeline,
//                    kept here for past compatibility / debug)
//
// Output:
//   {
//     slots: ["08:00 AM", "09:00 AM", ...],  // available (backward-compat)
//     slotsWithVendors: [{ slotTime, vendorIds }],
//     unavailableSlots: ["10:00 AM", ...],   // booked/held — render disabled
//     reasons: { noResources, allBooked },
//     availableVendorsCount
//   }

// Travel-buffer per service type. Applied symmetrically to BOTH the
// existing commitment AND the candidate slot (both sides do
// `start + duration + TRAVEL`), so the effective gap between two adjacent
// jobs of the SAME service equals TRAVEL_MIN — not 2 × TRAVEL_MIN — but
// the buffer "reaches" backwards too (a candidate that starts TRAVEL_MIN
// before an existing commitment also clashes).
//
// HP uses 60 min (per product: a 2 PM HP booking must also block 1 PM and
// 3 PM for the same vendor — i.e. a one-hour-on-each-side buffer around a
// 30-min site visit). DC keeps 30 min: DC services are long enough that
// the service duration itself dominates blocking; the existing 30-min
// post-buffer is sufficient and matches the original spec example
// (10 AM 5h DC blocks 9:30 AM → 3:30 PM-exclusive).
const HP_TRAVEL_MIN = 60;
const DC_TRAVEL_MIN = 30;

const DAY_START = 8 * 60;       // 08:00 — earliest service start
const DAY_END = 20 * 60;        // 20:00 — latest service END (must finish by)

const HP_DURATION = 30;         // House painting site visit fixed at 30 min
const HP_GRID_MIN = 60;         // HP slots on the hour: 8 AM, 9, 10, ... 7 PM
const DC_GRID_MIN = 30;         // DC slots on 30-min grid

// Same-day bookings for DC need a 2-hour lead time so the vendor can
// realistically reach the customer. Enforced here so every client
// (website, admin) gets an identical grid — previously only the website
// filtered this, leaving the admin showing slots in the next 2 hours.
//
// HP has no lead-time gate: the picker simply hides start times that have
// already passed (rounded up to the next hour). See earliestHpStartForDate.
const SAME_DAY_LEAD_MIN = 120;

/* ================= TIME HELPERS ================= */

function toMinutes(time) {
  if (!time || typeof time !== "string") return null;
  const parts = time.split(" ");
  if (parts.length !== 2) return null;
  const [hhmm, mer] = parts;
  let [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (mer === "PM" && h !== 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function toTime(min) {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${mer}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// DC: earliest slot for `date`. Same-day = now + 2 hr lead, rounded to grid.
function earliestStartForDate(date, gridMin) {
  const now = new Date();
  const req = new Date(date);
  const sameDay =
    now.getFullYear() === req.getFullYear() &&
    now.getMonth() === req.getMonth() &&
    now.getDate() === req.getDate();
  if (!sameDay) return DAY_START;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.ceil((nowMin + SAME_DAY_LEAD_MIN) / gridMin) * gridMin;
}

// HP: earliest slot for `date`. No lead time — just hide start times that
// have already passed. Same-day at 11:30 AM → cutoff = 12:00, so 8 AM and
// 11 AM drop out; 2 PM, 5 PM, 7 PM remain. Future dates start at 8 AM.
function earliestHpStartForDate(date) {
  const now = new Date();
  const req = new Date(date);
  const sameDay =
    now.getFullYear() === req.getFullYear() &&
    now.getMonth() === req.getMonth() &&
    now.getDate() === req.getDate();
  if (!sameDay) return DAY_START;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.ceil(nowMin / 60) * 60;
}

/* ================= BLOCK MODEL =================
   Each commitment (booking OR hold) is modelled as a one-sided window
       [serviceStart, serviceEnd + travel(serviceType)]
   and clash is detected with STRICT inequalities. Because BOTH the
   existing commitment and the candidate get the same builder, the buffer
   reaches symmetrically: a candidate starting `travel` minutes BEFORE an
   existing commitment also clashes (its own end-buffer overlaps the
   commitment's start). That's how a 2 PM HP booking ends up blocking
   1 PM, 2 PM, and 3 PM — the 1 PM candidate's buffered end (2:30) sits
   inside the existing commitment's window [2:00, 3:30].
================================================== */

function travelForServiceType(serviceType) {
  return serviceType === "house_painting" ? HP_TRAVEL_MIN : DC_TRAVEL_MIN;
}

function blockFromCommitment(serviceStartMin, durationMin, serviceType) {
  return {
    start: serviceStartMin,
    end: serviceStartMin + durationMin + travelForServiceType(serviceType),
  };
}

function durationFromBooking(b) {
  if (b.serviceType === "house_painting") return HP_DURATION;
  return Number(b.bookingDetails?.serviceDurationMinutes) || 0;
}

/* ================= MAIN ================= */

function calculateAvailableSlots({
  vendors,
  bookings,
  activeHolds = [],
  serviceType,
  serviceDuration,
  minTeamMembers,
  date,
  lat,
  lng,
}) {
  const reasons = {
    noResources: false,
    allBooked: false,
  };

  if (!Array.isArray(vendors) || vendors.length === 0) {
    reasons.noResources = true;
    return {
      slots: [],
      slotsWithVendors: [],
      unavailableSlots: [],
      reasons,
      availableVendorsCount: 0,
    };
  }

  // For DC, enforce per-date team headcount via leaves AND members already
  // committed to other active hirings that overlap this date (#9b). Previously
  // only leaves were subtracted, so a vendor whose team met minTeamMembers on
  // paper — but had members tied up on an overlapping (incl. multi-day) job —
  // still passed the booking gate, then failed at job start with
  // "no team members available". We now mirror checkVendorAvailabilityRange:
  // a member is free only if NOT on leave this date AND NOT busy on another
  // active hiring overlapping this date.
  //
  // Busy members are derived from the bookings already loaded for this engine:
  // any active-hiring booking whose projectDate (or slot date) includes `date`
  // marks its assigned team members busy for that vendor.
  const busyMembersByVendor = new Map();
  if (serviceType === "deep_cleaning") {
    for (const b of bookings) {
      const vid = b.assignedProfessional?.professionalId;
      const hiring = b.assignedProfessional?.hiring;
      if (!vid || !hiring) continue;
      if (hiring.status && hiring.status !== "active") continue;
      const projectDates = Array.isArray(hiring.projectDate)
        ? hiring.projectDate.map(String)
        : hiring.projectDate
          ? [String(hiring.projectDate)]
          : [];
      const overlaps = projectDates.length
        ? projectDates.includes(String(date))
        : String(b.selectedSlot?.slotDate) === String(date);
      if (!overlaps) continue;
      const key = String(vid);
      if (!busyMembersByVendor.has(key)) busyMembersByVendor.set(key, new Set());
      (hiring.teamMember || []).forEach((tm) =>
        busyMembersByVendor.get(key).add(String(tm.memberId)),
      );
    }
  }

  const eligibleVendors =
    serviceType === "deep_cleaning"
      ? vendors.filter((v) => {
          const team = Array.isArray(v.team) ? v.team : [];
          const busy = busyMembersByVendor.get(String(v._id)) || new Set();
          const free = team.filter(
            (m) =>
              !(m.markedLeaves || []).includes(date) &&
              !busy.has(String(m._id)),
          );
          return free.length >= (minTeamMembers || 1);
        })
      : vendors;

  if (!eligibleVendors.length) {
    reasons.noResources = true;
    return {
      slots: [],
      slotsWithVendors: [],
      unavailableSlots: [],
      reasons,
      availableVendorsCount: 0,
    };
  }

  /* ---- Build per-vendor blocked windows from bookings + holds ---- */

  const blocked = new Map(); // vendorId -> [{start, end}]
  const pushBlock = (vendorId, block) => {
    const key = String(vendorId);
    if (!blocked.has(key)) blocked.set(key, []);
    blocked.get(key).push(block);
  };

  // Bookings that have been PAID (isEnquiry=false) but no vendor has
  // accepted yet (assignedProfessional unset) consume one unit of vendor
  // capacity for their whole service WINDOW, but we don't know which vendor.
  //
  // #9a: previously we tracked these as a per-exact-slot-label counter, so a
  // paid-unassigned commitment reserved ONLY its own start label and left the
  // travel-adjacent slots free. (Assigned bookings and holds already block
  // adjacent slots via blockFromCommitment, but unassigned-paid ones didn't.)
  // The symptom: while a hold existed the adjacent slot was blocked, then once
  // the hold expired the adjacent slot "became free" again and another
  // customer could book it — and that follow-on booking then had no real
  // vendor free, so lead fanout found nobody and sent no notifications.
  //
  // Fix: model each unassigned-paid commitment as a full [start, end+travel]
  // WINDOW (same builder as assigned bookings/holds) and, at slot time, count
  // how many such windows OVERLAP each candidate — that many vendors of
  // capacity are consumed across the whole window, adjacent slots included.
  const unassignedWindows = []; // [{start, end}] one per paid-unassigned commitment
  const canonLabel = (label) => {
    const m = toMinutes(label);
    return m == null ? null : toTime(m);
  };

  // ── Holds first ──
  // Each active hold blocks one vendor at one slot. We also index the
  // held vendors by (slotLabel, customerId) so a paid-but-unassigned
  // booking belonging to the SAME customer can be matched to its own
  // leftover hold (instead of falsely consuming any other customer's
  // hold at that slot — which over-decrements the unassigned counter
  // and frees the slot for the next browser when it's actually full).
  //
  // Holds aren't tagged with serviceType (they're only created during
  // this engine's own pre-payment phase), so we use the requested
  // serviceType for their travel buffer. That's accurate in practice:
  // a hold only ever competes with same-service candidates because the
  // slot engine is queried per-service.
  const heldVendorsBySlotCustomer = new Map(); // `${label}|${customerId}` -> Set<vendorId>
  for (const h of activeHolds) {
    const startMin = toMinutes(h.slotTime);
    const dur = Number(h.durationMinutes) || 0;
    if (!h.vendorId || startMin == null || !dur) continue;
    pushBlock(h.vendorId, blockFromCommitment(startMin, dur, serviceType));
    const k = canonLabel(h.slotTime);
    if (k && h.customerId) {
      const key = `${k}|${String(h.customerId)}`;
      if (!heldVendorsBySlotCustomer.has(key)) {
        heldVendorsBySlotCustomer.set(key, new Set());
      }
      heldVendorsBySlotCustomer.get(key).add(String(h.vendorId));
    }
  }

  // ── Then bookings ──
  for (const b of bookings) {
    // FIX: schema field is `professionalId`, not `vendorId`. Old code used
    // `vendorId` so the entire blocked-windows map was empty in production.
    const vid = b.assignedProfessional?.professionalId;

    if (vid) {
      const startMin = toMinutes(b.selectedSlot?.slotTime);
      const dur = durationFromBooking(b);
      if (startMin == null || !dur) continue;
      // Use the existing booking's OWN serviceType for the travel buffer
      // — an HP booking always gets the wider HP buffer, even when the
      // engine is currently computing slots for a DC request, so adjacent
      // hourly slots stay correctly blocked for the same vendor.
      pushBlock(vid, blockFromCommitment(startMin, dur, b.serviceType));
    } else if (b.isEnquiry === false) {
      // Paid (isEnquiry flipped to false in payment.service.js) but no
      // vendor accepted yet — committed to ONE eligible vendor.
      //
      // Attribution rule: if this customer ALSO has an active hold at
      // this exact slot, the hold IS this booking's leftover pre-payment
      // hold — pushBlock already blocked that vendor, so don't bump
      // unassigned (would double-count). Otherwise, bump unassigned so
      // the slot engine reserves one vendor of capacity for this booking.
      //
      // Matching by customerId (not just by slot) is what fixes the
      // 2-vendor-Pune bug: Customer A's paid booking + Customer B's
      // active hold at the same slot are TWO real commitments, so we
      // must bump for A AND block for B.
      const k = canonLabel(b.selectedSlot?.slotTime);
      const bookingCustomerId = b.customer?.customerId;
      let consumedByOwnHold = false;
      if (k && bookingCustomerId) {
        const key = `${k}|${String(bookingCustomerId)}`;
        const ownHolds = heldVendorsBySlotCustomer.get(key);
        if (ownHolds && ownHolds.size > 0) {
          // Pop one vendor — subsequent paid bookings by the same
          // customer at the same slot (rare but possible) still need
          // their own bump or hold match.
          const next = ownHolds.values().next().value;
          ownHolds.delete(next);
          consumedByOwnHold = true;
        }
      }
      // #9a: if this paid-unassigned booking is NOT already covered by its own
      // leftover hold (which pushBlock already blocked, travel buffer and all),
      // reserve one vendor of capacity across its full service window so the
      // travel-adjacent slots stay blocked too — not just the exact start.
      if (!consumedByOwnHold) {
        const startMin = toMinutes(b.selectedSlot?.slotTime);
        const dur = durationFromBooking(b);
        if (startMin != null && dur) {
          unassignedWindows.push(
            blockFromCommitment(startMin, dur, b.serviceType),
          );
        }
      }
    }
  }

  if (unassignedWindows.length) {
    console.log(
      "[slots] unassigned-paid commitment windows (travel-buffered):",
      unassignedWindows,
    );
  }
  if (heldVendorsBySlotCustomer.size) {
    console.log(
      "[slots] heldVendorsBySlotCustomer (own-customer hold attribution):",
      [...heldVendorsBySlotCustomer.entries()].map(([k, set]) => [
        k,
        [...set],
      ]),
    );
  }

  /* ---- Generate the slot grid ---- */

  const maxStart = DAY_END - serviceDuration;

  // HP slots run hourly from 8 AM through 7 PM (the latest start that
  // still finishes inside DAY_END). DC keeps its 30-min sliding grid
  // because DC durations vary and customers benefit from finer choice.
  let candidateStarts;
  if (serviceType === "house_painting") {
    const startFloor = Math.max(
      DAY_START,
      earliestHpStartForDate(date),
    );
    candidateStarts = [];
    for (let s = startFloor; s <= maxStart; s += HP_GRID_MIN) {
      candidateStarts.push(s);
    }
  } else {
    const startFloor = Math.max(
      DAY_START,
      earliestStartForDate(date, DC_GRID_MIN),
    );
    candidateStarts = [];
    for (let s = startFloor; s <= maxStart; s += DC_GRID_MIN) {
      candidateStarts.push(s);
    }
  }

  const slots = [];
  const slotsWithVendors = [];
  // Slots where ALL eligible vendors are booked/held. Returned so the UI
  // can render them as disabled tiles ("not available") instead of hiding
  // them entirely. Per spec: customers should see that the slot exists
  // but can't pick it.
  const unavailableSlots = [];

  // Per-slot diagnostic for unavailable slots. Surfaced in the API
  // response so the FE / engineer can see exactly why a slot was
  // marked unavailable without needing terminal log access.
  const diag = [];

  for (const s of candidateStarts) {
    const candidate = blockFromCommitment(s, serviceDuration, serviceType);
    const freeVendorIds = [];
    const blockedVendorIds = [];

    for (const v of eligibleVendors) {
      const vBlocks = blocked.get(String(v._id)) || [];
      // Strict <  /  > so adjacent windows touching at a boundary don't clash.
      const clash = vBlocks.some(
        (b) => candidate.start < b.end && candidate.end > b.start,
      );
      if (!clash) freeVendorIds.push(String(v._id));
      else blockedVendorIds.push(String(v._id));
    }

    const label = toTime(s);
    // #9a: subtract paid-but-unassigned commitments whose service WINDOW
    // overlaps this candidate (not just those that start on this exact label) —
    // each consumes one of the freeVendorIds even though we don't know which.
    // This keeps the travel-adjacent slots reserved for the whole window, so a
    // freed hold can no longer re-open an adjacent slot that has no real vendor
    // left. If commitments equal/exceed free vendors, the slot has no real
    // capacity left, so render it unavailable.
    const consumed = unassignedWindows.filter(
      (w) => candidate.start < w.end && candidate.end > w.start,
    ).length;
    const trueFreeCount = freeVendorIds.length - consumed;

    if (trueFreeCount > 0) {
      slots.push(label);
      slotsWithVendors.push({ slotTime: label, vendorIds: freeVendorIds });
    } else {
      unavailableSlots.push(label);
      reasons.allBooked = true;
      diag.push({
        slot: label,
        eligibleVendors: eligibleVendors.length,
        freeVendors: freeVendorIds.length,
        blockedVendors: blockedVendorIds.length,
        unassignedOverlapping: consumed,
        trueFreeCount,
      });
    }
  }

  return {
    slots,
    slotsWithVendors,
    unavailableSlots,
    reasons,
    availableVendorsCount: eligibleVendors.length,
    debug: {
      totalEligibleVendors: eligibleVendors.length,
      eligibleVendorIds: eligibleVendors.map((v) => String(v._id)),
      bookingsConsidered: bookings.length,
      activeHoldsConsidered: activeHolds.length,
      unavailableSlotsExplained: diag,
    },
  };
}

module.exports = {
  calculateAvailableSlots,
  haversineKm,
  toMinutes,
  toTime,
  HP_TRAVEL_MIN,
  DC_TRAVEL_MIN,
  DAY_START,
  DAY_END,
  HP_DURATION,
  HP_GRID_MIN,
  DC_GRID_MIN,
};
