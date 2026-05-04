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
//     slots: ["08:00 AM", "09:00 AM", ...],  // backward-compat list
//     slotsWithVendors: [{ slotTime, vendorIds }],
//     reasons: { noResources, allBooked },
//     availableVendorsCount
//   }

const TRAVEL_MIN = 30;

const DAY_START = 8 * 60;       // 08:00 — earliest service start
const DAY_END = 20 * 60;        // 20:00 — latest service END (must finish by)
// DAY_TRAVEL_END = 20*60 + 30 = 20:30. Implied by maxStart math; we don't
// need a separate constant because maxStart = DAY_END - serviceDuration
// already guarantees travel-after fits.

const HP_DURATION = 30;         // House painting site visit fixed at 30 min
const HP_GRID_MIN = 60;         // Spec: HP slots on the hour
const DC_GRID_MIN = 30;         // Spec: DC slots on 30-min grid

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

// Earliest slot we'll show for `date`. For today, round up to the next
// grid step from "now"; for future dates, the day starts at 8:00 AM.
function earliestStartForDate(date, gridMin) {
  const now = new Date();
  const req = new Date(date);
  const sameDay =
    now.getFullYear() === req.getFullYear() &&
    now.getMonth() === req.getMonth() &&
    now.getDate() === req.getDate();
  if (!sameDay) return DAY_START;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.ceil(nowMin / gridMin) * gridMin;
}

/* ================= BLOCK MODEL =================
   We model each commitment (booking OR hold) as a one-sided window
       [serviceStart, serviceEnd + TRAVEL_MIN]
   and use STRICT inequalities on the clash check. This matches the spec's
   "inter-customer buffer" rule where the outbound + inbound 30-min legs
   between two adjacent jobs OVERLAP into a single 30-min gap. Two-sided
   buffers (the old code) would double-count this gap.
================================================== */

function blockFromCommitment(serviceStartMin, durationMin) {
  return {
    start: serviceStartMin,
    end: serviceStartMin + durationMin + TRAVEL_MIN,
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
      reasons,
      availableVendorsCount: 0,
    };
  }

  // For DC, also enforce per-date team headcount via leaves. (Distance,
  // archive, coins, KPI gates run in the controller before us — we only
  // see eligible vendors here. The leave check is date-specific so it
  // lives here next to the time math.)
  const eligibleVendors =
    serviceType === "deep_cleaning"
      ? vendors.filter((v) => {
          const team = Array.isArray(v.team) ? v.team : [];
          const free = team.filter(
            (m) => !(m.markedLeaves || []).includes(date),
          );
          return free.length >= (minTeamMembers || 1);
        })
      : vendors;

  if (!eligibleVendors.length) {
    reasons.noResources = true;
    return {
      slots: [],
      slotsWithVendors: [],
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

  for (const b of bookings) {
    // FIX: schema field is `professionalId`, not `vendorId`. Old code used
    // `vendorId` so the entire blocked-windows map was empty in production.
    const vid = b.assignedProfessional?.professionalId;
    if (!vid) continue;

    const startMin = toMinutes(b.selectedSlot?.slotTime);
    const dur = durationFromBooking(b);
    if (startMin == null || !dur) continue;

    pushBlock(vid, blockFromCommitment(startMin, dur));
  }

  for (const h of activeHolds) {
    const startMin = toMinutes(h.slotTime);
    const dur = Number(h.durationMinutes) || 0;
    if (!h.vendorId || startMin == null || !dur) continue;
    pushBlock(h.vendorId, blockFromCommitment(startMin, dur));
  }

  /* ---- Generate the slot grid ---- */

  const gridMin = serviceType === "house_painting" ? HP_GRID_MIN : DC_GRID_MIN;
  const startFloor = Math.max(DAY_START, earliestStartForDate(date, gridMin));
  const maxStart = DAY_END - serviceDuration;

  const slots = [];
  const slotsWithVendors = [];

  for (let s = startFloor; s <= maxStart; s += gridMin) {
    // For HP, align the iteration to the hourly grid even if startFloor
    // landed on a half-hour due to "now".
    if (serviceType === "house_painting" && s % HP_GRID_MIN !== 0) continue;

    const candidate = blockFromCommitment(s, serviceDuration);
    const freeVendorIds = [];

    for (const v of eligibleVendors) {
      const vBlocks = blocked.get(String(v._id)) || [];
      // Strict <  /  > so adjacent windows touching at a boundary don't clash.
      const clash = vBlocks.some(
        (b) => candidate.start < b.end && candidate.end > b.start,
      );
      if (!clash) freeVendorIds.push(String(v._id));
    }

    if (freeVendorIds.length) {
      const label = toTime(s);
      slots.push(label);
      slotsWithVendors.push({ slotTime: label, vendorIds: freeVendorIds });
    } else {
      reasons.allBooked = true;
    }
  }

  return {
    slots,
    slotsWithVendors,
    reasons,
    availableVendorsCount: eligibleVendors.length,
  };
}

module.exports = {
  calculateAvailableSlots,
  haversineKm,
  toMinutes,
  toTime,
  TRAVEL_MIN,
  DAY_START,
  DAY_END,
  HP_DURATION,
  HP_GRID_MIN,
  DC_GRID_MIN,
};
