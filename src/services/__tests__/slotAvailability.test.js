// Verifies the slot engine against the spec examples in
// "Slot Booking Logic Specification for Home Services" + the user's
// 2 BHK example. Run with `npm test`.

const {
  calculateAvailableSlots,
  toMinutes,
  toTime,
} = require("../slotAvailability.service");

const TOMORROW = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();

function vendor({ id, lat = 19.0, lng = 73.0, team = 4, archived = false }) {
  return {
    _id: id,
    isArchived: archived,
    address: { latitude: lat, longitude: lng },
    serviceRadiusKm: 10,
    team: Array.from({ length: team }, (_, i) => ({ _id: `${id}m${i}`, markedLeaves: [] })),
  };
}

function booking({ vendorId, slotTime, durationMinutes, serviceType = "deep_cleaning" }) {
  return {
    serviceType,
    selectedSlot: { slotTime, slotDate: TOMORROW },
    bookingDetails: { serviceDurationMinutes: durationMinutes, status: "Confirmed" },
    assignedProfessional: { professionalId: vendorId },
  };
}

describe("slotAvailability — DC 2 BHK 5h example", () => {
  // Spec/user: customer A books 10:00 AM 5h (300 min). The same vendor
  // should be unbookable from 9:30 AM through (but not including) 3:30 PM.
  const v = vendor({ id: "v1" });
  const aBooking = booking({
    vendorId: "v1",
    slotTime: "10:00 AM",
    durationMinutes: 300,
  });

  test("9:30 AM is blocked", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [aBooking],
      activeHolds: [],
      serviceType: "deep_cleaning",
      serviceDuration: 60, // washroom
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("09:30 AM");
  });

  test("8:00 AM HP (30-min) is allowed when DC 10 AM 5h booking exists (touching buffer ok)", () => {
    // A's DC block: [10:00, 15:30]. 8 AM HP block: [8:00, 9:00]. No overlap.
    // HP grid is [8, 11, 2, 5, 7 PM] — 8 AM is the earliest pre-DC slot,
    // so it should remain bookable even though the vendor is busy 10–3:30.
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [aBooking],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toContain("08:00 AM");
    // 11 AM and 2 PM fall inside the DC block → not bookable.
    expect(r.slots).not.toContain("11:00 AM");
    expect(r.slots).not.toContain("02:00 PM");
    // 5 PM and 7 PM are after the DC block ends at 3:30 PM → bookable.
    expect(r.slots).toContain("05:00 PM");
    expect(r.slots).toContain("07:00 PM");
  });

  test("9:00 AM DC washroom (60 min) is blocked (own service runs into vendor's 10:00 commitment)", () => {
    // A 60-min service starting at 9:00 AM ends at 10:00 AM — vendor can't
    // physically reach the 10:00 AM customer in time. Correctly blocked.
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [aBooking],
      activeHolds: [],
      serviceType: "deep_cleaning",
      serviceDuration: 60,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("09:00 AM");
  });

  test("3:30 PM is allowed (touching boundary)", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [aBooking],
      activeHolds: [],
      serviceType: "deep_cleaning",
      serviceDuration: 60,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toContain("03:30 PM");
  });

  test("3:00 PM is blocked", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [aBooking],
      activeHolds: [],
      serviceType: "deep_cleaning",
      serviceDuration: 60,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("03:00 PM");
  });
});

describe("slotAvailability — HP fixed 5-slot grid", () => {
  // Product spec: HP customers pick from 5 anchored start times per day
  // (8 AM, 11 AM, 2 PM, 5 PM, 7 PM). No hourly fillers between them.
  const v = vendor({ id: "v1", team: 1 });
  const aBooking = booking({
    vendorId: "v1",
    slotTime: "02:00 PM",
    durationMinutes: 30,
    serviceType: "house_painting",
  });

  test("HP grid is exactly [8 AM, 11 AM, 2 PM, 5 PM, 7 PM]", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toEqual([
      "08:00 AM",
      "11:00 AM",
      "02:00 PM",
      "05:00 PM",
      "07:00 PM",
    ]);
  });

  test("HP grid does NOT include hourly fillers like 9 AM, 10 AM, 1 PM", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("09:00 AM");
    expect(r.slots).not.toContain("10:00 AM");
    expect(r.slots).not.toContain("01:00 PM");
    expect(r.slots).not.toContain("03:00 PM");
  });

  test("HP last bookable slot is 7:00 PM", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toContain("07:00 PM");
    expect(r.slots).not.toContain("08:00 PM");
  });

  test("5:00 PM slot is still available after 2 PM HP booking (next anchored slot)", () => {
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [aBooking],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    // A blocks [14:00, 15:00]. Next anchored start is 5 PM — outside the
    // block — so 5 PM remains free even with only one vendor.
    expect(r.slots).toContain("05:00 PM");
    expect(r.slots).not.toContain("02:00 PM");
  });
});

describe("slotAvailability — bug fix: professionalId not vendorId", () => {
  test("blocks the vendor whose professionalId matches the booking", () => {
    const v = vendor({ id: "vendor-X" });
    const b = booking({
      vendorId: "vendor-X",
      slotTime: "10:00 AM",
      durationMinutes: 60,
    });
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [b],
      activeHolds: [],
      serviceType: "deep_cleaning",
      serviceDuration: 60,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    // 10:00 AM on the only vendor must be blocked, so the slot list
    // shouldn't include it.
    expect(r.slots).not.toContain("10:00 AM");
  });
});

describe("slotAvailability — holds also block", () => {
  test("active hold blocks the slot just like a booking", () => {
    const v = vendor({ id: "v1" });
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [],
      activeHolds: [
        { vendorId: "v1", slotTime: "11:00 AM", durationMinutes: 60 },
      ],
      serviceType: "deep_cleaning",
      serviceDuration: 60,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("11:00 AM");
    // Adjacent slots respecting the buffer should still appear.
    expect(r.slots).toContain("12:30 PM");
  });
});

describe("slotAvailability — DC team headcount via leaves", () => {
  test("vendor with all members on leave is excluded for DC", () => {
    const v = {
      _id: "v1",
      isArchived: false,
      address: { latitude: 19.0, longitude: 73.0 },
      serviceRadiusKm: 10,
      team: [
        { _id: "m1", markedLeaves: [TOMORROW] },
        { _id: "m2", markedLeaves: [TOMORROW] },
      ],
    };
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [],
      activeHolds: [],
      serviceType: "deep_cleaning",
      serviceDuration: 60,
      minTeamMembers: 2,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toEqual([]);
    expect(r.reasons.noResources).toBe(true);
  });
});

describe("slotAvailability — unavailableSlots (booked-out tiles)", () => {
  test("slot where the only vendor is booked appears in unavailableSlots, not slots", () => {
    const v = vendor({ id: "v1", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v],
      bookings: [
        booking({
          vendorId: "v1",
          slotTime: "11:00 AM",
          durationMinutes: 30,
          serviceType: "house_painting",
        }),
      ],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("11:00 AM");
    expect(r.unavailableSlots).toContain("11:00 AM");
    expect(r.reasons.allBooked).toBe(true);
  });

  test("when no vendors exist at all, unavailableSlots is still empty (noResources case)", () => {
    // Empty eligible pool → engine short-circuits before generating the
    // grid, so neither slots nor unavailableSlots are populated.
    const r = calculateAvailableSlots({
      vendors: [],
      bookings: [],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toEqual([]);
    expect(r.unavailableSlots).toEqual([]);
    expect(r.reasons.noResources).toBe(true);
  });
});

describe("slotAvailability — paid-but-unassigned bookings consume capacity", () => {
  // After payment, isEnquiry is flipped to false but assignedProfessional
  // isn't set until a vendor accepts. The engine must treat these as 1
  // unit of vendor capacity consumed at the booked slot time — otherwise
  // other customers see the slot as free even though it's been paid for.

  function paidUnassigned({ slotTime, serviceType = "house_painting" }) {
    return {
      serviceType,
      isEnquiry: false, // paid
      selectedSlot: { slotTime, slotDate: TOMORROW },
      bookingDetails: { serviceDurationMinutes: 30, status: "Confirmed" },
      // assignedProfessional NOT set — no vendor accepted yet
    };
  }

  test("2 vendors + 1 paid booking at 08:00 AM → slot still available (1 vendor remains)", () => {
    const v1 = vendor({ id: "v1", team: 1 });
    const v2 = vendor({ id: "v2", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v1, v2],
      bookings: [paidUnassigned({ slotTime: "08:00 AM" })],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toContain("08:00 AM");
  });

  test("2 vendors + 2 paid bookings at 08:00 AM → slot is unavailable (capacity exhausted)", () => {
    const v1 = vendor({ id: "v1", team: 1 });
    const v2 = vendor({ id: "v2", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v1, v2],
      bookings: [
        paidUnassigned({ slotTime: "08:00 AM" }),
        paidUnassigned({ slotTime: "08:00 AM" }),
      ],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("08:00 AM");
    expect(r.unavailableSlots).toContain("08:00 AM");
    expect(r.reasons.allBooked).toBe(true);
  });

  test("1 vendor + 1 paid booking at 08:00 AM → slot is unavailable", () => {
    const v1 = vendor({ id: "v1", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v1],
      bookings: [paidUnassigned({ slotTime: "08:00 AM" })],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).not.toContain("08:00 AM");
    expect(r.unavailableSlots).toContain("08:00 AM");
  });

  test("unpaid enquiry (isEnquiry:true) without assignedProfessional does NOT consume capacity", () => {
    // Customer hasn't paid yet; they're holding the slot via Redis (handled
    // separately by activeHolds). The booking record alone shouldn't block.
    const v1 = vendor({ id: "v1", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v1],
      bookings: [
        {
          serviceType: "house_painting",
          isEnquiry: true, // unpaid enquiry
          selectedSlot: { slotTime: "08:00 AM", slotDate: TOMORROW },
          bookingDetails: { serviceDurationMinutes: 30, status: "Pending" },
        },
      ],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toContain("08:00 AM");
  });
});

describe("slotAvailability — own-customer hold attribution", () => {
  // Reproduces the 2-vendor-Pune bug: Customer A pays for 1:00 PM (no
  // vendor assigned yet), then Customer B grabs a hold on V1 at the same
  // slot for their own checkout. The slot still has capacity for one more
  // booker (V2) until both customers' commitments resolve — but the
  // engine must NOT consume Customer B's hold to satisfy Customer A's
  // booking. That would double-credit and falsely free the slot when in
  // fact V1 is held by B and V2 is implicitly committed to A.

  test("paid booking by A + active hold by B at same slot → both commitments counted", () => {
    const v1 = vendor({ id: "v1", team: 1 });
    const v2 = vendor({ id: "v2", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v1, v2],
      bookings: [
        {
          serviceType: "house_painting",
          isEnquiry: false,
          customer: { customerId: "customerA" },
          selectedSlot: { slotTime: "02:00 PM", slotDate: TOMORROW },
          bookingDetails: { serviceDurationMinutes: 30, status: "Confirmed" },
        },
      ],
      activeHolds: [
        {
          vendorId: "v1",
          slotTime: "02:00 PM",
          durationMinutes: 30,
          customerId: "customerB",
        },
      ],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    // V1 held by B + A's unassigned booking → both vendors committed.
    expect(r.slots).not.toContain("02:00 PM");
    expect(r.unavailableSlots).toContain("02:00 PM");
  });

  test("paid booking by A + A's own lingering hold on V1 → only one commitment", () => {
    // Race window: payment committed, hold release hasn't run yet.
    // Without same-customer attribution, A would double-count (bump +
    // pushBlock), wrongly blocking the slot even when V2 is free.
    const v1 = vendor({ id: "v1", team: 1 });
    const v2 = vendor({ id: "v2", team: 1 });
    const r = calculateAvailableSlots({
      vendors: [v1, v2],
      bookings: [
        {
          serviceType: "house_painting",
          isEnquiry: false,
          customer: { customerId: "customerA" },
          selectedSlot: { slotTime: "02:00 PM", slotDate: TOMORROW },
          bookingDetails: { serviceDurationMinutes: 30, status: "Confirmed" },
        },
      ],
      activeHolds: [
        {
          vendorId: "v1",
          slotTime: "02:00 PM",
          durationMinutes: 30,
          customerId: "customerA", // same customer — leftover pre-payment hold
        },
      ],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: 19.0,
      lng: 73.0,
    });
    expect(r.slots).toContain("02:00 PM");
  });
});

describe("slotAvailability — time helpers", () => {
  test("toMinutes / toTime round-trip", () => {
    expect(toMinutes("10:00 AM")).toBe(600);
    expect(toMinutes("12:00 PM")).toBe(720);
    expect(toMinutes("12:00 AM")).toBe(0);
    expect(toMinutes("01:30 PM")).toBe(13 * 60 + 30);
    expect(toTime(600)).toBe("10:00 AM");
    expect(toTime(720)).toBe("12:00 PM");
    expect(toTime(0)).toBe("12:00 AM");
  });
});
