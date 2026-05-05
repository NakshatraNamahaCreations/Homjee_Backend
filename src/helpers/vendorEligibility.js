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

// Product spec: customer must be within 10 km of vendor for the website
// to surface them. Fixed for all vendors — admin manual-assign path
// (which bypasses this) is the escape hatch when no vendor is in range.
const SERVICE_RADIUS_KM = 10;

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
  includeDebug = false,
}) {
  const reasons = {
    archived: false,
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

    const dist = haversineKm(lat, lng, v.address.latitude, v.address.longitude);
    if (dist > SERVICE_RADIUS_KM) {
      reasons.outsideRadius = true;
      recordDebug(v, `outside_radius (${dist.toFixed(2)}km > ${SERVICE_RADIUS_KM}km)`);
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

module.exports = { filterEligibleVendors };
