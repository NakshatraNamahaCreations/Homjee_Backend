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

  test("9:00 AM HP (30-min) is allowed (buffer touches but doesn't overlap)", () => {
    // A blocks [10:00, 15:30]. New 30-min booking at 9:00 blocks [9:00, 10:00].
    // Strict-< boundary touch → no clash. Spec: 9:30 is the earliest blocked
    // slot so 9:00 must remain bookable for short services.
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
    expect(r.slots).toContain("09:00 AM");
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

describe("slotAvailability — HP back-to-back (one-sided buffer)", () => {
  // Spec: A books 2 PM HP. Block 1:30→3:30 (with two-sided model). With
  // our one-sided model: A blocks [2:00, 3:00]. B at 3:00 PM should be
  // immediately available; FE expects per spec inter-customer buffer rule.
  const v = vendor({ id: "v1", team: 1 });
  const aBooking = booking({
    vendorId: "v1",
    slotTime: "02:00 PM",
    durationMinutes: 30,
    serviceType: "house_painting",
  });

  test("HP grid is hourly (no 8:30 AM, 9:30 AM in slot list)", () => {
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
    expect(r.slots).toContain("08:00 AM");
    expect(r.slots).toContain("09:00 AM");
    expect(r.slots).not.toContain("08:30 AM");
    expect(r.slots).not.toContain("09:30 AM");
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

  test("3:00 PM slot is bookable right after 2 PM HP booking ends", () => {
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
    // A blocks [2:00, 3:00]; next hourly slot 3:00 PM should be free.
    expect(r.slots).toContain("03:00 PM");
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
