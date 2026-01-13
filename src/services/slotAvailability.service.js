// const RADIUS_KM = 5;
// const TRAVEL_MIN = 30;

// const DAY_START = 8 * 60;              // 08:00 AM (slot start from here)
// const DAY_SERVICE_END = 20.5 * 60;     // 08:30 PM (service must finish by this)
// const DAY_TRAVEL_END = DAY_SERVICE_END + TRAVEL_MIN; // 09:00 PM (travel-after buffer)


// /* ================= HELPERS ================= */

// function toMinutes(time) {
//   const [t, mer] = time.split(" ");
//   let [h, m] = t.split(":").map(Number);
//   if (mer === "PM" && h !== 12) h += 12;
//   if (mer === "AM" && h === 12) h = 0;
//   return h * 60 + m;
// }

// function toTime(min) {
//   let h = Math.floor(min / 60);
//   let m = min % 60;
//   const mer = h >= 12 ? "PM" : "AM";
//   if (h > 12) h -= 12;
//   if (h === 0) h = 12;
//   return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${mer}`;
// }

// function haversine(lat1, lon1, lat2, lon2) {
//   const R = 6371;
//   const dLat = ((lat2 - lat1) * Math.PI) / 180;
//   const dLon = ((lon2 - lon1) * Math.PI) / 180;
//   const a =
//     Math.sin(dLat / 2) ** 2 +
//     Math.cos((lat1 * Math.PI) / 180) *
//       Math.cos((lat2 * Math.PI) / 180) *
//       Math.sin(dLon / 2) ** 2;
//   return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
// }

// function getStartMinute(date) {
//   const today = new Date();
//   const req = new Date(date);

//   if (
//     today.getFullYear() !== req.getFullYear() ||
//     today.getMonth() !== req.getMonth() ||
//     today.getDate() !== req.getDate()
//   ) {
//     return DAY_START;
//   }

//   const nowMin = today.getHours() * 60 + today.getMinutes();
//   return Math.ceil(nowMin / 30) * 30;
// }

// /* ================= MAIN ================= */

// function calculateAvailableSlots({
//   vendors,
//   bookings,
//   serviceType,
//   serviceDuration,
//   minTeamMembers,
//   date,
//   lat,
//   lng,
// }) {
//   console.log("\n================ SLOT CALCULATION START ================");
//   console.table({ date, lat, lng, serviceDuration, minTeamMembers });

//   const vendorResources = {};
//   const reasons = {
//     outsideRadius: false,
//     noResources: false,
//     allBooked: false,
//   };

//   /* ================= STEP 1: FILTER VENDORS ================= */

//   vendors.forEach((v) => {
//     if (!v.address) return;

//     const dist = haversine(lat, lng, v.address.latitude, v.address.longitude);

//     console.log(
//       `📍 Vendor ${v.vendor?.vendorName || v._id} distance: ${dist.toFixed(
//         2
//       )} km`
//     );

//     if (dist > RADIUS_KM) {
//       reasons.outsideRadius = true;
//       return;
//     }

//     if (serviceType === "deep_cleaning") {
//       const availableTeam = (v.team || []).filter(
//         (m) => !m.markedLeaves?.includes(date)
//       );

//       console.log(`   👥 Team available: ${availableTeam.length}`);

//       if (availableTeam.length >= minTeamMembers) {
//         vendorResources[v._id.toString()] = true;
//         console.log("   ✅ VENDOR ELIGIBLE (DEEP CLEANING)");
//       }
//     } else {
//       vendorResources[v._id.toString()] = true;
//       console.log("   ✅ VENDOR ELIGIBLE (HOUSE PAINTING)");
//     }
//   });

//   const eligibleVendors = Object.keys(vendorResources);

//   if (!eligibleVendors.length) {
//     reasons.noResources = true;
//     return { slots: [], reasons, availableVendorsCount: 0 };
//   }

//   /* ================= STEP 2: BLOCKED WINDOWS ================= */

//   const blocked = {};

//   bookings.forEach((b) => {
//     const start = toMinutes(b.selectedSlot.slotTime);
//     const duration =
//       b.serviceType === "house_painting"
//         ? 30
//         : b.bookingDetails?.serviceDurationMinutes;

//     if (!duration) return;

//     const blockStart = start - TRAVEL_MIN;
//     const blockEnd = start + duration + TRAVEL_MIN;

//     const vendorId = b.assignedProfessional?.vendorId;
//     if (!vendorId) return;

//     blocked[vendorId] = blocked[vendorId] || [];
//     blocked[vendorId].push({ start: blockStart, end: blockEnd });

//     console.log(
//       `🔒 Vendor ${vendorId} blocked ${toTime(blockStart)} → ${toTime(
//         blockEnd
//       )}`
//     );
//   });

//   /* ================= STEP 3: SLOT CHECK ================= */

//   const slots = [];
// const startMin = Math.max(DAY_START, getStartMinute(date));

// // ✅ Last possible START time such that service ends by 8:30 PM
// const maxStart = DAY_SERVICE_END - serviceDuration;

// console.log("⏱ Slot generation window:", {
//   startFrom: toTime(startMin),
//   endAt: toTime(maxStart),
// });



//   for (let slotStart = startMin; slotStart <= maxStart; slotStart += 30) {
//     // 🚫 ABSOLUTE PAST SLOT BLOCK
//     if (slotStart < getStartMinute(date)) {
//       console.log(`⏭ Skipping past slot ${toTime(slotStart)}`);
//       continue;
//     }

//     // ✅ FIX: travel + service + travel window
//     const candidateStart = slotStart - TRAVEL_MIN; // travel before
//     const candidateEnd = slotStart + serviceDuration + TRAVEL_MIN; // service + travel after

//     // ✅ ensure vendor can finish travel-after within day travel end
//     if (candidateEnd > DAY_TRAVEL_END) continue;

//     const slotLabel = toTime(slotStart);
//     console.log(`\n🕒 Checking slot: ${slotLabel}`);

//     let available = false;

//     for (const vId of eligibleVendors) {
//       const blocks = blocked[vId] || [];

//       // ✅ FIX: clash check must use candidateStart/candidateEnd
//       const clash = blocks.some(
//         (b) => candidateStart < b.end && candidateEnd > b.start
//       );

//       if (!clash) {
//         console.log(`   🟢 Vendor ${vId} can handle this slot`);
//         available = true;
//         break;
//       }
//     }

//     if (available) slots.push(slotLabel);
//     else reasons.allBooked = true;
//   }

//   console.log("\n================ FINAL RESULT ================");
//   console.log("AVAILABLE SLOTS:", slots);
//   console.log("ELIGIBLE VENDORS:", eligibleVendors.length);
//   console.log("================ SLOT CALC END ================\n");

//   return {
//     slots,
//     reasons,
//     availableVendorsCount: eligibleVendors.length,
//   };
// }

// module.exports = { calculateAvailableSlots };

// old working code
const RADIUS_KM = 5;
const TRAVEL_MIN = 30;

const DAY_START = 8 * 60; // 08:00 AM
const DAY_END = 20 * 60; // 08:00 PM
const DAY_TRAVEL_END = 20.5 * 60; // 08:30 PM

/* ================= HELPERS ================= */

function toMinutes(time) {
  const [t, mer] = time.split(" ");
  let [h, m] = t.split(":").map(Number);
  if (mer === "PM" && h !== 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function toTime(min) {
  let h = Math.floor(min / 60);
  let m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${mer}`;
}

function haversine(lat1, lon1, lat2, lon2) {
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

function getStartMinute(date) {
  const today = new Date();
  const req = new Date(date);

  if (
    today.getFullYear() !== req.getFullYear() ||
    today.getMonth() !== req.getMonth() ||
    today.getDate() !== req.getDate()
  ) {
    return DAY_START;
  }

  const nowMin = today.getHours() * 60 + today.getMinutes();
  return Math.ceil(nowMin / 30) * 30;
}

/* ================= MAIN ================= */

function calculateAvailableSlots({
  vendors,
  bookings,
  serviceType,
  serviceDuration,
  minTeamMembers,
  date,
  lat,
  lng,
}) {
  // console.log("\n================ SLOT CALCULATION START ================");
  // console.table({ date, lat, lng, serviceDuration, minTeamMembers });

  const vendorResources = {};
  const reasons = {
    outsideRadius: false,
    noResources: false,
    allBooked: false,
  };

  /* ================= STEP 1: FILTER VENDORS ================= */

  vendors.forEach((v) => {
    if (!v.address) return;

    const dist = haversine(lat, lng, v.address.latitude, v.address.longitude);

    // console.log(
    //   `📍 Vendor ${v.vendor?.vendorName || v._id} distance: ${dist.toFixed(
    //     2
    //   )} km`
    // );

    if (dist > RADIUS_KM) {
      reasons.outsideRadius = true;
      return;
    }

    if (serviceType === "deep_cleaning") {
      const availableTeam = (v.team || []).filter(
        (m) => !m.markedLeaves?.includes(date)
      );

      // console.log(`   👥 Team available: ${availableTeam.length}`);

      if (availableTeam.length >= minTeamMembers) {
        vendorResources[v._id.toString()] = true;
        // console.log("   ✅ VENDOR ELIGIBLE (DEEP CLEANING)");
      }
    } else {
      vendorResources[v._id.toString()] = true;
      // console.log("   ✅ VENDOR ELIGIBLE (HOUSE PAINTING)");
    }
  });

  const eligibleVendors = Object.keys(vendorResources);

  if (!eligibleVendors.length) {
    reasons.noResources = true;
    return { slots: [], reasons, availableVendorsCount: 0 };
  }

  /* ================= STEP 2: BLOCKED WINDOWS ================= */

  const blocked = {};

  bookings.forEach((b) => {
    const start = toMinutes(b.selectedSlot.slotTime);
    const duration =
      b.serviceType === "house_painting"
        ? 30
        : b.bookingDetails?.serviceDurationMinutes;

    if (!duration) return;

    const blockStart = start - TRAVEL_MIN;
    const blockEnd = start + duration + TRAVEL_MIN;

    const vendorId = b.assignedProfessional?.vendorId;
    if (!vendorId) return;

    blocked[vendorId] = blocked[vendorId] || [];
    blocked[vendorId].push({ start: blockStart, end: blockEnd });

    // console.log(
    //   `🔒 Vendor ${vendorId} blocked ${toTime(blockStart)} → ${toTime(
    //     blockEnd
    //   )}`
    // );
  });

  /* ================= STEP 3: SLOT CHECK ================= */

  const slots = [];
  const startMin = Math.max(DAY_START, getStartMinute(date));
  const maxStart = DAY_END - serviceDuration;

  // console.log("⏱ Slot generation window:", {
  //   startFrom: toTime(startMin),
  //   endAt: toTime(maxStart),
  // });

  for (let slotStart = startMin; slotStart <= maxStart; slotStart += 30) {
    // 🚫 ABSOLUTE PAST SLOT BLOCK
    if (slotStart < getStartMinute(date)) {
      // console.log(`⏭ Skipping past slot ${toTime(slotStart)}`);
      continue;
    }

    // ✅ FIX: travel + service + travel window
    const candidateStart = slotStart - TRAVEL_MIN; // travel before
    const candidateEnd = slotStart + serviceDuration + TRAVEL_MIN; // service + travel after

    // ✅ ensure vendor can finish travel-after within day travel end
    if (candidateEnd > DAY_TRAVEL_END) continue;

    const slotLabel = toTime(slotStart);
    // console.log(`\n🕒 Checking slot: ${slotLabel}`);

    let available = false;

    for (const vId of eligibleVendors) {
      const blocks = blocked[vId] || [];

      // ✅ FIX: clash check must use candidateStart/candidateEnd
      const clash = blocks.some(
        (b) => candidateStart < b.end && candidateEnd > b.start
      );

      if (!clash) {
        // console.log(`   🟢 Vendor ${vId} can handle this slot`);
        available = true;
        break;
      }
    }

    if (available) slots.push(slotLabel);
    else reasons.allBooked = true;
  }

  // console.log("\n================ FINAL RESULT ================");
  // console.log("AVAILABLE SLOTS:", slots);
  // console.log("ELIGIBLE VENDORS:", eligibleVendors.length);
  // console.log("================ SLOT CALC END ================\n");

  return {
    slots,
    reasons,
    availableVendorsCount: eligibleVendors.length,
  };
}

module.exports = { calculateAvailableSlots };
