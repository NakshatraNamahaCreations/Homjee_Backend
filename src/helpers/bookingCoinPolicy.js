// Resolve how many vendor coins to deduct on accept/confirm + whether to
// deduct at all. Single source of truth so the "siteVisitCharge=0 → skip
// deduction" rule and the "HP requiredCoins comes from PricingConfig.vendorCoins"
// unification both live in one place.
//
// Spec rules encoded here:
//   - HP + siteVisitCharges === 0  → shouldChargeCoins: false (no deduction).
//                                    Vendor is still eligible & can accept.
//   - HP + siteVisitCharges  >  0  → requiredCoins = PricingConfig.vendorCoins
//                                    for the booking's city (matches the
//                                    eligibility-side gate).
//   - DC                           → requiredCoins = sum of service[].coinDeduction
//                                    (per-package config; existing logic).
//
// Eligibility (slot-listing) is unaffected — this only governs the
// confirm-time deduction step.

const PricingConfig = require("../models/serviceConfig/PricingConfig");

function escapeRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function sumServiceCoins(services) {
  return (services || []).reduce((sum, s) => sum + n(s?.coinDeduction), 0);
}

/**
 * @param {object} booking — full booking doc (Mongoose or lean)
 * @returns {Promise<{requiredCoins:number, shouldChargeCoins:boolean, source:string}>}
 *   source ∈ "hp_pricing_config" | "hp_service_fallback" | "dc_service_sum" | "hp_site_visit_zero"
 */
async function computeBookingCoinPolicy(booking) {
  const serviceType = booking?.serviceType;

  if (serviceType === "house_painting") {
    const siteVisit = n(booking?.bookingDetails?.siteVisitCharges);
    if (siteVisit === 0) {
      return {
        requiredCoins: 0,
        shouldChargeCoins: false,
        source: "hp_site_visit_zero",
      };
    }

    const city = booking?.address?.city;
    if (city) {
      const pricing = await PricingConfig.findOne({
        city: { $regex: new RegExp(`^${escapeRegex(city)}$`, "i") },
      }).lean();
      if (pricing) {
        return {
          requiredCoins: n(pricing.vendorCoins),
          shouldChargeCoins: true,
          source: "hp_pricing_config",
        };
      }
    }

    // Fallback: city missing or no PricingConfig for it. Use whatever was
    // stamped on the booking at creation time so vendors aren't permanently
    // blocked by a config gap.
    return {
      requiredCoins: sumServiceCoins(booking?.service),
      shouldChargeCoins: true,
      source: "hp_service_fallback",
    };
  }

  // DC and any other types: existing per-service summation.
  return {
    requiredCoins: sumServiceCoins(booking?.service),
    shouldChargeCoins: true,
    source: "dc_service_sum",
  };
}

module.exports = { computeBookingCoinPolicy };
