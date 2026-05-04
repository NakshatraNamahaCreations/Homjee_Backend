const Vendor = require("../models/vendor/vendorAuth");
const Booking = require("../models/user/userBookings");
const DeepCleaningPackage = require("../models/products/DeepCleaningPackage");

const { calculateAvailableSlots } = require("../services/slotAvailability.service");
const { filterEligibleVendors } = require("../helpers/vendorEligibility");
const { listActiveHoldsForDate } = require("../services/slotHold.service");
const {
  getCachedSlots,
  setCachedSlots,
} = require("../services/slotCache.service");

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */

function getReasonMessage(reasons) {
  if (reasons.archived || reasons.outsideRadius) {
    return "No vendors available within service radius";
  }
  if (reasons.lowCoins) {
    return "No vendors with sufficient credits to accept this booking";
  }
  if (reasons.teamShort) {
    return "No vendors with the required team size for this service";
  }
  if (reasons.kpiFail) {
    return "No vendors meet the performance criteria for this booking";
  }
  if (reasons.allBooked) {
    return "All available vendors are already booked for this date";
  }
  return "No slots available for the selected date and location";
}

function normalizeCity(s = "") {
  return String(s).trim().toLowerCase();
}

function pickCityConfig(pkg, cityName) {
  const cfgs = Array.isArray(pkg.cityConfigs) ? pkg.cityConfigs : [];
  const norm = normalizeCity(cityName);
  const cfg = cfgs.find((c) => normalizeCity(c.city) === norm);
  if (cfg) return cfg;
  if (cfgs.length === 1) return cfgs[0]; // fallback when only one config exists
  return null;
}

/**
 * Resolve service params for DC: sum durations, take max team size, sum
 * vendor coin costs across selected packages for the chosen city.
 * Returns null if any package is missing a config for the city.
 */
function resolveDeepCleaningParams(packages, city) {
  const out = { durationMinutes: 0, minTeamMembers: 1, requiredCoins: 0 };
  const missing = [];

  for (const p of packages) {
    let cfg = null;
    if (Array.isArray(p.cityConfigs) && p.cityConfigs.length) {
      cfg = pickCityConfig(p, city);
      if (!cfg) {
        missing.push({
          packageId: p._id,
          name: p.name,
          availableCities: p.cityConfigs.map((c) => c.city),
        });
        continue;
      }
    } else {
      // Old schema fallback (kept for backward compat with legacy data)
      cfg = {
        durationMinutes: p.durationMinutes,
        teamMembers: p.teamMembers,
        coinsForVendor: p.coinsForVendor,
      };
    }
    out.durationMinutes += Number(cfg.durationMinutes || 0);
    out.minTeamMembers = Math.max(out.minTeamMembers, Number(cfg.teamMembers || 1));
    out.requiredCoins += Number(cfg.coinsForVendor || 0);
  }

  if (missing.length) return { missing };

  // Floor protection
  if (!out.durationMinutes || out.durationMinutes < 30) out.durationMinutes = 30;
  if (!out.minTeamMembers || out.minTeamMembers < 1) out.minTeamMembers = 1;

  return out;
}

/* ---------------------------------------------------------------- */
/* shared core: build the slot list                                  */
/* ---------------------------------------------------------------- */

async function buildSlotResponse({
  serviceType,
  date,
  lat,
  lng,
  city,
  packageIds,
  serviceDuration,
  minTeamMembers,
  requiredCoins,
}) {
  // 1. Cache lookup. Cache key includes location bucket + package set so
  //    nearby users with the same selection share a hit.
  const cacheParams = {
    serviceType,
    city: city || "",
    date,
    packageIds: packageIds || [],
    lat,
    lng,
  };
  const cached = await getCachedSlots(cacheParams);
  if (cached) return { ...cached, cache: "hit" };

  // 2. Vendor pool — narrow at the DB level to reduce log noise and avoid
  // running haversine/KPI compute on vendors with no chance.
  //
  // Filters use loose case-insensitive regex because stored values vary:
  //   vendor.serviceType: "Deep Cleaning" | "House Painting" | "house-painter" | ...
  //   vendor.city:        "Pune" | "PUNE" | "Pune City" | ...
  // Substring match catches all the common variants without dropping
  // legitimate vendors. Radius is still the final geographic check.
  const vendorQuery = {};
  vendorQuery["vendor.serviceType"] =
    serviceType === "deep_cleaning" ? /clean/i : /paint/i;
  if (city) {
    // Escape regex specials in user-controlled input before building the pattern.
    const cityEsc = String(city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    vendorQuery["vendor.city"] = new RegExp(cityEsc, "i");
  }
  const vendors = await Vendor.find(vendorQuery).lean();

  // 3. Eligibility pipeline (archive → radius → coins → team → KPI gate)
  const { eligibleVendors, reasons: eligReasons, debug } = await filterEligibleVendors({
    vendors,
    lat,
    lng,
    requiredCoins,
    serviceType,
    minTeamMembers,
    includeDebug: true,
  });

  console.log("[slots] eligibility:", {
    serviceType,
    date,
    city,
    lat,
    lng,
    requiredCoins,
    minTeamMembers,
    serviceDuration,
    totalVendors: vendors.length,
    eligibleVendors: eligibleVendors.length,
    reasons: eligReasons,
    perVendor: debug,
  });

  // 4. Bookings on the requested date that could clash.
  const bookings = await Booking.find({
    isEnquiry: false,
    "assignedProfessional.professionalId": { $exists: true, $ne: null },
    "selectedSlot.slotDate": date,
    "bookingDetails.status": {
      $nin: ["Customer Cancelled", "Admin Cancelled", "Cancelled"],
    },
  }).lean();

  // 5. Active Redis holds for the date (pending payments).
  const activeHolds = await listActiveHoldsForDate(date);

  // 6. Slot engine.
  const result = calculateAvailableSlots({
    vendors: eligibleVendors,
    bookings,
    activeHolds,
    serviceType,
    serviceDuration,
    minTeamMembers,
    date,
    lat,
    lng,
  });

  const reasons = { ...eligReasons, ...result.reasons };
  const response = {
    success: true,
    slots: result.slots,
    slotsWithVendors: result.slotsWithVendors,
    availableVendorsCount: result.availableVendorsCount,
    reason: result.slots.length
      ? null
      : { ...reasons, message: getReasonMessage(reasons) },
  };

  // 7. Cache for 60s — but only successful, non-empty results.
  // Caching empty responses would lock users into "no slots" for the next
  // minute even if a vendor frees up or admin fixes a config issue.
  if (response.slots.length) {
    await setCachedSlots(cacheParams, response);
  }

  return { ...response, cache: "miss" };
}

/* ---------------------------------------------------------------- */
/* ADMIN / APP slot endpoint                                         */
/* ---------------------------------------------------------------- */

exports.getAvailableSlots = async (req, res) => {
  try {
    const { serviceType, packageId, date, lat, lng, city } = req.body;

    if (!serviceType || !date || lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "serviceType, date, lat, lng are required",
      });
    }
    if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
      return res.status(400).json({ success: false, message: "Invalid serviceType" });
    }

    let serviceDuration = 30;
    let minTeamMembers = 1;
    let requiredCoins = 0;
    let resolvedPackageIds = [];

    if (serviceType === "deep_cleaning") {
      if (!Array.isArray(packageId) || !packageId.length) {
        return res.status(400).json({
          success: false,
          message: "packageId array is required for deep cleaning",
        });
      }
      if (!city) {
        return res.status(400).json({
          success: false,
          message: "city is required for deep cleaning to read cityConfigs",
        });
      }

      const packages = await DeepCleaningPackage.find({
        _id: { $in: packageId },
      }).lean();

      if (!packages.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid deep cleaning packages",
        });
      }

      const resolved = resolveDeepCleaningParams(packages, city);
      if (resolved.missing) {
        return res.status(400).json({
          success: false,
          message: "Some selected packages do not have cityConfigs for this city",
          missing: resolved.missing,
        });
      }

      serviceDuration = resolved.durationMinutes;
      minTeamMembers = resolved.minTeamMembers;
      requiredCoins = resolved.requiredCoins;
      resolvedPackageIds = packageId;
    }

    const response = await buildSlotResponse({
      serviceType,
      date,
      lat,
      lng,
      city,
      packageIds: resolvedPackageIds,
      serviceDuration,
      minTeamMembers,
      requiredCoins,
    });

    return res.json(response);
  } catch (err) {
    console.error("SLOT ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Slot calculation failed",
    });
  }
};

/* ---------------------------------------------------------------- */
/* WEBSITE slot endpoint                                             */
/* Body: { serviceType, services:[{duration, teamMembers, coinsForVendor?}], date, lat, lng, city? }
/* ---------------------------------------------------------------- */

exports.getWebsiteAvailableSlots = async (req, res) => {
  try {
    const { serviceType, services, date, lat, lng, city } = req.body;

    if (!serviceType || !date || lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "serviceType, date, lat, lng are required",
      });
    }
    if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
      return res.status(400).json({ success: false, message: "Invalid serviceType" });
    }

    let serviceDuration = 30;
    let minTeamMembers = 1;
    let requiredCoins = 0;

    if (serviceType === "deep_cleaning") {
      if (!Array.isArray(services) || !services.length) {
        return res.status(400).json({
          success: false,
          message: "services array is required for deep cleaning",
        });
      }
      serviceDuration = services.reduce(
        (sum, s) => sum + Number(s.duration || 0),
        0,
      );
      minTeamMembers = Math.max(...services.map((s) => Number(s.teamMembers || 1)));
      requiredCoins = services.reduce(
        (sum, s) => sum + Number(s.coinsForVendor || 0),
        0,
      );
      if (!serviceDuration || serviceDuration < 30) serviceDuration = 30;
      if (!minTeamMembers || minTeamMembers < 1) minTeamMembers = 1;
    }

    const response = await buildSlotResponse({
      serviceType,
      date,
      lat,
      lng,
      city,
      packageIds: services?.map((s) => s.packageId).filter(Boolean) || [],
      serviceDuration,
      minTeamMembers,
      requiredCoins,
    });

    return res.json(response);
  } catch (err) {
    console.error("WEBSITE SLOT ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Website slot calculation failed",
    });
  }
};
