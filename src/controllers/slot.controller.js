// const Vendor = require("../models/vendor/vendorAuth");
// const Booking = require("../models/user/userBookings");
// const DeepCleaningPackage = require("../models/products/DeepCleaningPackage");
// const { calculateAvailableSlots } = require("../services/slotAvailability.service");

// function getReasonMessage(reasons) {
//   if (reasons.noResources && reasons.outsideRadius) {
//     return "No vendors available within service radius";
//   }
//   if (reasons.allBooked) {
//     return "All available vendors are already booked";
//   }
//   return "No slots available for the selected date and location";
// }

// exports.getAvailableSlots = async (req, res) => {
//   try {
//     const { serviceType, packageId, date, lat, lng } = req.body;

//     console.log("\n================ SLOT API HIT ================");
//     console.log("REQUEST:", req.body);

//     if (!serviceType || !date || lat == null || lng == null) {
//       return res.status(400).json({
//         success: false,
//         message: "serviceType, date, lat, lng are required",
//       });
//     }

//     if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid serviceType",
//       });
//     }

//     console.log("SERVICE TYPE:", serviceType);

//     let serviceDuration = 30;
//     let minTeamMembers = 1;

//     /* ================= DEEP CLEANING ================= */
//     if (serviceType === "deep_cleaning") {
//       if (!Array.isArray(packageId) || !packageId.length) {
//         return res.status(400).json({
//           success: false,
//           message: "packageId array is required for deep cleaning",
//         });
//       }

//       const packages = await DeepCleaningPackage.find({
//         _id: { $in: packageId },
//       }).lean();

//       if (!packages.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid deep cleaning packages",
//         });
//       }

//       console.log("\nDEBUG PACKAGES:");
//       packages.forEach(p =>
//         console.log(
//           `• ${p.name} → team ${p.teamMembers}, duration ${p.durationMinutes}`
//         )
//       );

//       // ✅ FINAL CALCULATION
//       serviceDuration = packages.reduce(
//         (sum, p) => sum + (p.durationMinutes || 0),
//         0
//       );

//       minTeamMembers = Math.max(
//         ...packages.map(p => p.teamMembers || 1)
//       );

//       console.log("FINAL SERVICE DURATION:", serviceDuration);
//       console.log("FINAL REQUIRED TEAM:", minTeamMembers);
//     }

//     /* ================= FETCH DATA ================= */

//     const vendors = await Vendor.find({}).lean();
//     console.log("FETCHED VENDORS:", vendors.length);

//     const bookings = await Booking.find({
//       isEnquiry: false,
//       assignedProfessional: { $exists: true },
//       "selectedSlot.slotDate": date,
//       "bookingDetails.status": {
//         $nin: ["Customer Cancelled", "Admin Cancelled", "Cancelled"],
//       },
//     }).lean();

//     console.log("FETCHED BOOKINGS:", bookings.length);

//     const result = calculateAvailableSlots({
//       vendors,
//       bookings,
//       serviceType,
//       serviceDuration,
//       minTeamMembers,
//       date,
//       lat,
//       lng,
//     });

//     return res.json({
//       success: true,
//       slots: result.slots,
//       availableVendorsCount: result.availableVendorsCount,
//       reason: result.slots.length
//         ? null
//         : {
//           ...result.reasons,
//           message: getReasonMessage(result.reasons),
//         },
//     });
//   } catch (err) {
//     console.error("❌ SLOT ERROR:", err);
//     res.status(500).json({
//       success: false,
//       message: "Slot calculation failed",
//     });
//   }
// };


// exports.getWebsiteAvailableSlots = async (req, res) => {
//   try {
//     const { serviceType, services, date, lat, lng } = req.body;

//     // console.log("\n================ WEBSITE SLOT API HIT ================");
//     // console.log("REQUEST:", req.body);

//     if (!serviceType || !date || lat == null || lng == null) {
//       return res.status(400).json({
//         success: false,
//         message: "serviceType, date, lat, lng are required",
//       });
//     }

//     if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid serviceType",
//       });
//     }

//     let serviceDuration = 30;   // default → SAME AS ADMIN
//     let minTeamMembers = 1;

//     /* ================= WEBSITE DEEP CLEANING ================= */
//     if (serviceType === "deep_cleaning") {
//       if (!Array.isArray(services) || !services.length) {
//         return res.status(400).json({
//           success: false,
//           message: "services array is required for deep cleaning",
//         });
//       }

//       // durations are already in MINUTES
//       serviceDuration = services.reduce(
//         (sum, s) => sum + Number(s.duration || 0),
//         0
//       );

//       minTeamMembers = Math.max(
//         ...services.map(s => Number(s.teamMembers || 1))
//       );

//       // console.log("DEEP CLEANING DURATION:", serviceDuration);
//       // console.log("DEEP CLEANING TEAM:", minTeamMembers);
//     }

//     /* ================= WEBSITE HOUSE PAINTING ================= */
//     else if (serviceType === "house_painting") {
//       // 🔥 EXACT SAME LOGIC AS ADMIN
//       serviceDuration = 30;
//       minTeamMembers = 1;

//       // console.log("HOUSE PAINTING SLOT CHECK (ADMIN LOGIC)");
//     }

//     /* ================= FETCH DATA ================= */

//     const vendors = await Vendor.find({}).lean();
//     // console.log("FETCHED VENDORS:", vendors.length);

//     const bookings = await Booking.find({
//       isEnquiry: false,
//       assignedProfessional: { $exists: true },
//       "selectedSlot.slotDate": date,
//       "bookingDetails.status": {
//         $nin: ["Customer Cancelled", "Admin Cancelled", "Cancelled"],
//       },
//     }).lean();

//     // console.log("FETCHED BOOKINGS:", bookings.length);

//     /* ================= SLOT ENGINE ================= */

//     const result = calculateAvailableSlots({
//       vendors,
//       bookings,
//       serviceType,
//       serviceDuration,
//       minTeamMembers,
//       date,
//       lat,
//       lng,
//     });

//     return res.json({
//       success: true,
//       slots: result.slots,
//       availableVendorsCount: result.availableVendorsCount,
//       reason: result.slots.length ? null : result.reasons,
//     });
//   } catch (err) {
//     // console.error("❌ WEBSITE SLOT ERROR:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Website slot calculation failed",
//     });
//   }
// };



const Vendor = require("../models/vendor/vendorAuth");
const Booking = require("../models/user/userBookings");
const DeepCleaningPackage = require("../models/products/DeepCleaningPackage");
const { calculateAvailableSlots } = require("../services/slotAvailability.service");

/* ------------------ Reason Message ------------------ */
function getReasonMessage(reasons) {
  if (reasons.noResources && reasons.outsideRadius) {
    return "No vendors available within service radius";
  }
  if (reasons.allBooked) {
    return "All available vendors are already booked";
  }
  return "No slots available for the selected date and location";
}

/* ------------------ City Helpers ------------------ */
function normalizeCity(str = "") {
  return String(str).trim().toLowerCase();
}

/**
 * ✅ Pick correct cityConfig by city name (Pune, Bengaluru...)
 * - case-insensitive exact match
 * - fallback: if only one cityConfig exists, use it
 */
function pickCityConfigByCityName(pkg, city) {
  const cfgs = Array.isArray(pkg.cityConfigs) ? pkg.cityConfigs : [];
  const cityNorm = normalizeCity(city);

  const cfg = cfgs.find((c) => normalizeCity(c.city) === cityNorm);
  if (cfg) return cfg;

  // fallback only if package has single cityConfig
  if (cfgs.length === 1) return cfgs[0];

  return null;
}

/* ======================================================
   ✅ ADMIN / APP SLOT API
   Body:
   {
     serviceType: "deep_cleaning" | "house_painting",
     packageId: [..] (required for deep_cleaning),
     city: "Pune" (required for deep_cleaning),
     date: "YYYY-MM-DD",
     lat, lng
   }
====================================================== */
exports.getAvailableSlots = async (req, res) => {
  try {
    const { serviceType, packageId, date, lat, lng, city } = req.body;

    console.log("\n================ SLOT API HIT ================");
    console.log("REQUEST:", req.body);

    if (!serviceType || !date || lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "serviceType, date, lat, lng are required",
      });
    }

    if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid serviceType",
      });
    }

    let serviceDuration = 30;
    let minTeamMembers = 1;

    /* ================= DEEP CLEANING ================= */
    if (serviceType === "deep_cleaning") {
      if (!Array.isArray(packageId) || !packageId.length) {
        return res.status(400).json({
          success: false,
          message: "packageId array is required for deep cleaning",
        });
      }

      // ✅ city name is required (since you can't pass cityId)
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

      const effective = [];
      const missing = [];

      for (const p of packages) {
        // ✅ NEW SCHEMA
        if (Array.isArray(p.cityConfigs) && p.cityConfigs.length) {
          const cfg = pickCityConfigByCityName(p, city);

          if (!cfg) {
            missing.push({
              packageId: p._id,
              name: p.name,
              category: p.category,
              subcategory: p.subcategory,
              service: p.service,
              availableCities: (p.cityConfigs || []).map((c) => c.city),
            });
            continue;
          }

          effective.push({
            name: p.name,
            teamMembers: Number(cfg.teamMembers || 1),
            durationMinutes: Number(cfg.durationMinutes || 0),
            pickedCity: cfg.city,
          });
        }
        // ✅ OLD SCHEMA fallback
        else {
          effective.push({
            name: p.name,
            teamMembers: Number(p.teamMembers || 1),
            durationMinutes: Number(p.durationMinutes || 0),
            pickedCity: null,
          });
        }
      }

      // if any package missing city config -> fail early and show which ones
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message:
            "Some selected packages do not have cityConfigs for this city name",
          missing,
        });
      }

      console.log("\nDEBUG PACKAGES (EFFECTIVE):");
      effective.forEach((p) =>
        console.log(
          `• ${p.name} → team ${p.teamMembers}, duration ${p.durationMinutes} (city: ${p.pickedCity || "-"})`
        )
      );

      serviceDuration = effective.reduce(
        (sum, p) => sum + (p.durationMinutes || 0),
        0
      );

      minTeamMembers = Math.max(...effective.map((p) => p.teamMembers || 1));

      // safety
      if (!serviceDuration || serviceDuration < 30) serviceDuration = 30;
      if (!minTeamMembers || minTeamMembers < 1) minTeamMembers = 1;

      console.log("FINAL SERVICE DURATION:", serviceDuration);
      console.log("FINAL REQUIRED TEAM:", minTeamMembers);
    }

    /* ================= FETCH DATA ================= */
    const vendors = await Vendor.find({}).lean();
    console.log("FETCHED VENDORS:", vendors.length);

    const bookings = await Booking.find({
      isEnquiry: false,
      assignedProfessional: { $exists: true },
      "selectedSlot.slotDate": date,
      "bookingDetails.status": {
        $nin: ["Customer Cancelled", "Admin Cancelled", "Cancelled"],
      },
    }).lean();

    console.log("FETCHED BOOKINGS:", bookings.length);

    /* ================= SLOT ENGINE ================= */
    const result = calculateAvailableSlots({
      vendors,
      bookings,
      serviceType,
      serviceDuration,
      minTeamMembers,
      date,
      lat,
      lng,
    });

    return res.json({
      success: true,
      slots: result.slots,
      availableVendorsCount: result.availableVendorsCount,
      reason: result.slots.length
        ? null
        : {
            ...result.reasons,
            message: getReasonMessage(result.reasons),
          },
    });
  } catch (err) {
    console.error("❌ SLOT ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Slot calculation failed",
    });
  }
};

/* ======================================================
   ✅ WEBSITE SLOT API (your existing logic)
====================================================== */
exports.getWebsiteAvailableSlots = async (req, res) => {
  try {
    const { serviceType, services, date, lat, lng } = req.body;

    if (!serviceType || !date || lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "serviceType, date, lat, lng are required",
      });
    }

    if (!["deep_cleaning", "house_painting"].includes(serviceType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid serviceType",
      });
    }

    let serviceDuration = 30;
    let minTeamMembers = 1;

    if (serviceType === "deep_cleaning") {
      if (!Array.isArray(services) || !services.length) {
        return res.status(400).json({
          success: false,
          message: "services array is required for deep cleaning",
        });
      }

      serviceDuration = services.reduce(
        (sum, s) => sum + Number(s.duration || 0),
        0
      );

      minTeamMembers = Math.max(
        ...services.map((s) => Number(s.teamMembers || 1))
      );

      if (!serviceDuration || serviceDuration < 30) serviceDuration = 30;
      if (!minTeamMembers || minTeamMembers < 1) minTeamMembers = 1;
    } else {
      serviceDuration = 30;
      minTeamMembers = 1;
    }

    const vendors = await Vendor.find({}).lean();

    const bookings = await Booking.find({
      isEnquiry: false,
      assignedProfessional: { $exists: true },
      "selectedSlot.slotDate": date,
      "bookingDetails.status": {
        $nin: ["Customer Cancelled", "Admin Cancelled", "Cancelled"],
      },
    }).lean();

    const result = calculateAvailableSlots({
      vendors,
      bookings,
      serviceType,
      serviceDuration,
      minTeamMembers,
      date,
      lat,
      lng,
    });

    return res.json({
      success: true,
      slots: result.slots,
      availableVendorsCount: result.availableVendorsCount,
      reason: result.slots.length ? null : result.reasons,
    });
  } catch (err) {
    console.error("❌ WEBSITE SLOT ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Website slot calculation failed",
    });
  }
};