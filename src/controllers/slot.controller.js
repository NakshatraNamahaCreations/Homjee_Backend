const Vendor = require("../models/vendor/vendorAuth");
const Booking = require("../models/user/userBookings");
const DeepCleaningPackage = require("../models/products/DeepCleaningPackage");
const { calculateAvailableSlots } = require("../services/slotAvailability.service");

function getReasonMessage(reasons) {
  if (reasons.noResources && reasons.outsideRadius) {
    return "No vendors available within service radius";
  }
  if (reasons.allBooked) {
    return "All available vendors are already booked";
  }
  return "No slots available for the selected date and location";
}

exports.getAvailableSlots = async (req, res) => {
  try {
    const { serviceType, packageId, date, lat, lng } = req.body;

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

    console.log("SERVICE TYPE:", serviceType);

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

      const packages = await DeepCleaningPackage.find({
        _id: { $in: packageId },
      }).lean();

      if (!packages.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid deep cleaning packages",
        });
      }

      console.log("\nDEBUG PACKAGES:");
      packages.forEach(p =>
        console.log(
          `• ${p.name} → team ${p.teamMembers}, duration ${p.durationMinutes}`
        )
      );

      // ✅ FINAL CALCULATION
      serviceDuration = packages.reduce(
        (sum, p) => sum + (p.durationMinutes || 0),
        0
      );

      minTeamMembers = Math.max(
        ...packages.map(p => p.teamMembers || 1)
      );

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
    res.status(500).json({
      success: false,
      message: "Slot calculation failed",
    });
  }
};



// old code 
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

//       // ✅ CORRECT CALCULATION
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
//             ...result.reasons,
//             message: getReasonMessage(result.reasons),
//           },
//     });
//   } catch (err) {
//     console.error("❌ SLOT ERROR:", err);
//     res.status(500).json({
//       success: false,
//       message: "Slot calculation failed",
//     });
//   }
// };
