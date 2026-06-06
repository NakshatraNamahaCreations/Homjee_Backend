// Vendor eligibility pipeline for slot booking.
//
// Filters in order, short-circuiting on first failure for cheap checks
// before the expensive KPI lookup. Used by:
//   - slot.controller.getAvailableSlots (compute slot list)
//   - booking-confirm flow (re-validate vendor right before insert)
//
// Returns:
//   {
//     eligibleVendors: [vendor, ...],
//     reasons: { archived, outsideRadius, lowCoins, teamShort, kpiFail },
//     debug: { perVendor: [{ vendorId, status: "ok"|reason }] }   // optional
//   }
//
// Each "reason" flag = "at least one vendor was rejected for this reason",
// useful for the FE's "no slots — why" message.

const KPI = require("../models/perfomance/kpiparameters");
const { haversineKm } = require("../services/slotAvailability.service");
const { getOrComputeVendorKpis } = require("../services/vendorKpiCache.service");
const { passesPerformanceGate } = require("./vendorKpiGate");

// Default service radius (km) when a vendor doesn't have one set. Every
// vendor doc carries its OWN `serviceRadiusKm` field (default 10 in the
// model). We respect that per-vendor value so a vendor in a small pocket
// of the city (e.g. Undri-only) can set a tight radius and not get
// surfaced for distant leads — while a vendor who serves a wide area can
// keep theirs at 10+. Before this, every vendor used a hardcoded 10 km
// cap regardless of their setting, so every Pune painter matched every
// Pune lead and the admin "Vendors Notified" card always showed all 3.
const DEFAULT_SERVICE_RADIUS_KM = 10;

// Indian PIN codes are 6 digits. Booking + vendor address fields are
// stored as freeform strings ("…Undri, Pune, Maharashtra 411060, India"),
// so we extract the first 6-digit token. Returns null if not found.
const PINCODE_REGEX = /\b(\d{6})\b/;
function extractPincode(addressString) {
  if (!addressString || typeof addressString !== "string") return null;
  const m = addressString.match(PINCODE_REGEX);
  return m ? m[1] : null;
}

/**
 * @param {object} args
 * @param {Array}  args.vendors          — raw vendor docs (lean)
 * @param {number} args.lat
 * @param {number} args.lng
 * @param {number} args.requiredCoins    — sum of cityConfig.coinsForVendor for selected packages
 * @param {string} args.serviceType      — "deep_cleaning" | "house_painting"
 * @param {number} args.minTeamMembers   — DC only
 * @param {boolean} [args.includeDebug=false]
 */
async function filterEligibleVendors({
  vendors,
  lat,
  lng,
  requiredCoins = 0,
  serviceType,
  minTeamMembers = 1,
  // Booking pincode. When set AND the vendor's address also contains a
  // 6-digit pincode, the two MUST match — vendors in a different pincode
  // are rejected before we even check radius/coins/KPI. If either is
  // missing, we fall through to the regular radius gate so legacy data
  // (no pincode in the address string) still works.
  bookingPincode = null,
  includeDebug = false,
}) {
  const reasons = {
    archived: false,
    pincodeMismatch: false,
    outsideRadius: false,
    lowCoins: false,
    teamShort: false,
    kpiFail: false,
  };
  const debug = includeDebug ? [] : null;
  const recordDebug = (vendor, status) => {
    if (!debug) return;
    debug.push({
      vendorId: String(vendor._id),
      vendorName: vendor?.vendor?.vendorName || null,
      status,
    });
  };

  // KPI ranges are admin-configured per service type. Fetch once per request.
  const kpiDoc = await KPI.findOne({ serviceType }).lean();
  const ranges = kpiDoc?.ranges || null;

  // ---- Phase 1: cheap synchronous filters ----
  const survivors = [];
  for (const v of vendors) {
    if (v.isArchived) {
      reasons.archived = true;
      recordDebug(v, "archived");
      continue;
    }

    if (!v.address || v.address.latitude == null || v.address.longitude == null) {
      recordDebug(v, "no_address");
      continue;
    }

    // Pincode gate. Runs BEFORE the radius check because it's cheap and
    // strictly tighter: a vendor whose pincode doesn't match the
    // booking's pincode is not surfaced even if their base address
    // happens to fall inside the radius. Falls through silently when
    // either side lacks a parseable pincode, so legacy address strings
    // without an explicit pincode aren't accidentally filtered out.
    if (bookingPincode) {
      const vendorPincode = extractPincode(v.address?.location);
      if (vendorPincode && vendorPincode !== bookingPincode) {
        reasons.pincodeMismatch = true;
        recordDebug(
          v,
          `pincode_mismatch (vendor=${vendorPincode}, booking=${bookingPincode})`,
        );
        continue;
      }
    }

    const dist = haversineKm(lat, lng, v.address.latitude, v.address.longitude);
    const vendorRadius =
      Number(v.serviceRadiusKm) > 0
        ? Number(v.serviceRadiusKm)
        : DEFAULT_SERVICE_RADIUS_KM;
    if (dist > vendorRadius) {
      reasons.outsideRadius = true;
      recordDebug(
        v,
        `outside_radius (${dist.toFixed(2)}km > vendor's ${vendorRadius}km)`,
      );
      continue;
    }

    const coins = Number(v?.wallet?.coins || 0);
    if (coins < requiredCoins) {
      reasons.lowCoins = true;
      recordDebug(v, "low_coins");
      continue;
    }

    if (serviceType === "deep_cleaning") {
      // Headcount-only check here. Per-date leaves are checked in the
      // slot engine since they're date-specific and we may want the same
      // vendor for different dates with different leave states.
      const team = Array.isArray(v.team) ? v.team : [];
      if (team.length < minTeamMembers) {
        reasons.teamShort = true;
        recordDebug(v, "team_short");
        continue;
      }
    }

    survivors.push(v);
  }

  // ---- Phase 2: KPI gate (Redis-cached, parallel) ----
  // Skip entirely if admin hasn't set ranges — gating with no ranges
  // would block everyone.
  if (!ranges) {
    survivors.forEach((v) => recordDebug(v, "ok"));
    return { eligibleVendors: survivors, reasons, debug };
  }

  const eligibleVendors = [];
  const kpiResults = await Promise.all(
    survivors.map((v) => getOrComputeVendorKpis(v, serviceType).catch(() => null)),
  );

  for (let i = 0; i < survivors.length; i++) {
    const v = survivors[i];
    const kpis = kpiResults[i];
    // KPI fetch failed (geo issue, etc.) — let the vendor through rather
    // than punish them for a transient compute failure.
    if (!kpis) {
      recordDebug(v, "ok_kpi_unknown");
      eligibleVendors.push(v);
      continue;
    }

    const gate = passesPerformanceGate(kpis, ranges, serviceType);
    if (!gate.pass) {
      reasons.kpiFail = true;
      recordDebug(v, `kpi_fail:${gate.failedMetrics.join(",")}`);
      continue;
    }
    recordDebug(v, "ok");
    eligibleVendors.push(v);
  }

  return { eligibleVendors, reasons, debug };
}

module.exports = { filterEligibleVendors, extractPincode };
