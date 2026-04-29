// Pure helpers for computing a vendor's effective availability status.
//
// Status is intentionally derived (not stored) so wallet, team, and project
// changes are reflected immediately without a write. Used by:
//   - admin getAllVendors / getVendorByVendorId responses (display badge)
//   - getBookingForNearByVendors* endpoints (gate lead visibility)
//
// 4 statuses, in priority order:
//   archived          — admin locked the profile (already implemented)
//   low_coins         — wallet < threshold; no new leads should be offered
//   team_unavailable  — house_painting only; team is busy across the next
//                       N days from active hirings + leaves
//   live              — accepting leads
//
// All inputs are read-only; no DB calls happen here. Callers fetch active
// hirings (if needed) and pass them in.

const LOW_COINS_THRESHOLD = 100;
const TEAM_UNAVAILABLE_WINDOW_DAYS = 4;

// Booking statuses that count as "currently committed" — i.e. team is
// reserved through the project window. Anything else (Pending, Cancelled,
// Completed, Customer Denied, ...) doesn't reserve the team.
const ACTIVE_PROJECT_STATUSES = new Set([
  "Hired",
  "Project Ongoing",
  "Survey Ongoing",
  "Waiting for final payment",
  "Pending Hiring",
]);

const STATUS_DESCRIPTORS = {
  live: { label: "Live", color: "#28a745" },
  low_coins: { label: "Low Coins", color: "#fd7e14" },
  team_unavailable: { label: "Team Unavailable", color: "#ffc107" },
  archived: { label: "Archived", color: "#dc3545" },
};

const toDateKey = (d) => {
  try {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch (e) {
    return null;
  }
};

// Builds the set of YYYY-MM-DD strings the project occupies. Prefers the
// explicit hiring.projectDate array; falls back to hiring.hiredDate +
// noOfDay if projectDate is empty.
const projectDayKeys = (hiring) => {
  const out = new Set();
  if (!hiring) return out;

  if (Array.isArray(hiring.projectDate) && hiring.projectDate.length) {
    for (const d of hiring.projectDate) {
      const k = toDateKey(d);
      if (k) out.add(k);
    }
    return out;
  }

  const start = hiring.hiredDate || hiring.markedDate;
  const noOfDay = Number(hiring.noOfDay || 0);
  if (start && noOfDay > 0) {
    const startDt = new Date(start);
    for (let i = 0; i < noOfDay; i++) {
      const dt = new Date(startDt);
      dt.setDate(dt.getDate() + i);
      const k = toDateKey(dt);
      if (k) out.add(k);
    }
  }
  return out;
};

// Returns true if at least one team member is free on `dayKey`.
// "Free" = not on leave AND not committed to any active project that day.
const isAnyMemberFreeOnDay = (vendor, activeBookings, dayKey) => {
  const team = Array.isArray(vendor?.team) ? vendor.team : [];
  if (team.length === 0) return false;

  for (const member of team) {
    const memberId = String(member?._id || "");
    if (!memberId) continue;

    const onLeave = Array.isArray(member.markedLeaves)
      ? member.markedLeaves.includes(dayKey)
      : false;
    if (onLeave) continue;

    let busy = false;
    for (const booking of activeBookings) {
      const hiring = booking?.assignedProfessional?.hiring;
      if (!hiring || hiring.status === "cancelled") continue;
      if (!ACTIVE_PROJECT_STATUSES.has(String(booking?.bookingDetails?.status))) {
        continue;
      }

      const memberOnProject = (hiring.teamMember || []).some(
        (m) => String(m?.memberId || "") === memberId,
      );
      if (!memberOnProject) continue;

      const days = projectDayKeys(hiring);
      if (days.has(dayKey)) {
        busy = true;
        break;
      }
    }

    if (!busy) return true; // found one free member for this day
  }

  return false;
};

// `activeBookings` should be the vendor's bookings whose
// `bookingDetails.status` is in ACTIVE_PROJECT_STATUSES. If you pass a
// broader list it'll still work — non-matching ones are skipped — but
// fetching narrowly is cheaper.
const isTeamUnavailable = (vendor, activeBookings, now = new Date()) => {
  // Only meaningful for house painting per product spec.
  const serviceType = String(vendor?.vendor?.serviceType || "").toLowerCase();
  if (!serviceType.includes("paint")) return false;

  // No active commitments → team can't be "busy".
  if (!Array.isArray(activeBookings) || activeBookings.length === 0) return false;

  for (let i = 0; i < TEAM_UNAVAILABLE_WINDOW_DAYS; i++) {
    const dt = new Date(now);
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() + i);
    const key = toDateKey(dt);
    if (!key) continue;
    if (isAnyMemberFreeOnDay(vendor, activeBookings, key)) {
      return false; // at least one day in the window has a free member
    }
  }
  return true; // every day in the window has zero free members
};

// Main entry point. `ctx.activeBookings` is required for the team check;
// pass [] if you can't compute it (the vendor will never resolve to
// team_unavailable).
const computeVendorStatus = (vendor, ctx = {}) => {
  if (!vendor) return "live";

  if (vendor.isArchived) return "archived";

  const coins = Number(vendor?.wallet?.coins || 0);
  if (coins < LOW_COINS_THRESHOLD) return "low_coins";

  const activeBookings = Array.isArray(ctx.activeBookings)
    ? ctx.activeBookings
    : [];
  if (isTeamUnavailable(vendor, activeBookings, ctx.now)) {
    return "team_unavailable";
  }

  return "live";
};

const describeStatus = (status) =>
  STATUS_DESCRIPTORS[status] || STATUS_DESCRIPTORS.live;

module.exports = {
  computeVendorStatus,
  describeStatus,
  ACTIVE_PROJECT_STATUSES,
  LOW_COINS_THRESHOLD,
  TEAM_UNAVAILABLE_WINDOW_DAYS,
};
