// Resolve how many vendor coins to deduct on accept/confirm + whether to
// deduct at all. Single source of truth so the "siteVisitCharge=0 → skip
// deduction" rule and the "HP requiredCoins comes from PricingConfig.vendorCoins"
// unification both live in one place.
//
// Spec rules encoded here:
//   - HP                           → always charge coins (per product decision,
//                                    regardless of siteVisitCharges). requiredCoins
//                                    = PricingConfig.vendorCoins for the booking's
//                                    city when configured (>0), else falls back to
//                                    the service-stamped coins so a config gap can
//                                    never block a response.
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
 *   source ∈ "hp_pricing_config" | "hp_service_fallback" | "dc_service_sum"
 */
async function computeBookingCoinPolicy(booking) {
  const serviceType = booking?.serviceType;

  if (serviceType === "house_painting") {
    // Always charge HP responses (the siteVisit=0 skip was removed per the
    // product decision — vendors pay coins on every HP lead response).
    const city = booking?.address?.city;
    if (city) {
      const pricing = await PricingConfig.findOne({
        city: { $regex: new RegExp(`^${escapeRegex(city)}$`, "i") },
      }).lean();
      // Only trust a configured, positive vendorCoins value. A zero/unset
      // config must NOT win here — otherwise requiredCoins=0 trips the
      // "Coin deduction not configured" guard and blocks the response.
      if (pricing && n(pricing.vendorCoins) > 0) {
        return {
          requiredCoins: n(pricing.vendorCoins),
          shouldChargeCoins: true,
          source: "hp_pricing_config",
        };
      }
    }

    // Fallback: city missing, no PricingConfig, or vendorCoins not set.
    // Use whatever was stamped on the booking at creation time (the value
    // the app shows on the Respond button) so a config gap never blocks.
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
