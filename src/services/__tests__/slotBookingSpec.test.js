// Verifies the 8 test cases in the "Slot Booking Logic Specification for
// Home Services" doc + the new vendor-coins business rule:
//   * Eligibility uses PricingConfig.vendorCoins (HP) / service.coinDeduction (DC).
//   * siteVisitCharge=0 (HP) does NOT affect eligibility but DOES skip
//     wallet deduction at confirm time.
//
// Tests are pure: external models are mocked. Run with `npm test`.

// ---- Mocks (must be declared before requiring the units under test) ----

jest.mock("../../models/perfomance/kpiparameters", () => ({
  findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
}));
jest.mock("../vendorKpiCache.service", () => ({
  getOrComputeVendorKpis: jest.fn().mockResolvedValue(null),
}));

const mockPricingConfigState = { byCity: new Map() };
jest.mock("../../models/serviceConfig/PricingConfig", () => ({
  findOne: jest.fn(({ city }) => {
    // Match the case-insensitive regex query the helper builds.
    let cityName = "";
    if (typeof city === "string") cityName = city.toLowerCase();
    else if (city?.$regex instanceof RegExp) {
      const m = city.$regex.toString().match(/\^([^$]*)\$/);
      cityName = (m?.[1] || "").toLowerCase();
    }
    const doc = mockPricingConfigState.byCity.get(cityName) || null;
    return { lean: () => Promise.resolve(doc) };
  }),
}));

const {
  filterEligibleVendors,
} = require("../../helpers/vendorEligibility");
const {
  calculateAvailableSlots,
} = require("../slotAvailability.service");
const {
  computeBookingCoinPolicy,
} = require("../../helpers/bookingCoinPolicy");

// ---- Fixtures ----

const TOMORROW = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();

// Customer coords — vendors placed within radius unless otherwise noted.
const CUST = { lat: 19.0, lng: 73.0 };

function vendor({ id, coins = 0, lat = 19.001, lng = 73.001, team = 4, archived = false, name = id }) {
  return {
    _id: id,
    isArchived: archived,
    vendor: { vendorName: name, city: "Pune" },
    address: { latitude: lat, longitude: lng },
    serviceRadiusKm: 10,
    wallet: { coins },
    team: Array.from({ length: team }, (_, i) => ({ _id: `${id}-m${i}`, markedLeaves: [] })),
  };
}

function bookingFor({ vendorId, slotTime = "09:00 AM", durationMinutes = 30, serviceType = "house_painting" }) {
  return {
    serviceType,
    selectedSlot: { slotTime, slotDate: TOMORROW },
    bookingDetails: { serviceDurationMinutes: durationMinutes, status: "Confirmed" },
    assignedProfessional: { professionalId: vendorId },
  };
}

function setPricingConfig(city, doc) {
  mockPricingConfigState.byCity.set(city.toLowerCase(), doc);
}

beforeEach(() => {
  mockPricingConfigState.byCity.clear();
});

// =============================================================================
// Test Case 1 — Same location with one eligible vendor
//   Vendor A: 120 coins, Vendor B: 90 coins, Required: 100
//   → Only A eligible. Once A books a slot, that slot is blocked for others.
// =============================================================================
describe("TC1 — same location, one eligible vendor", () => {
  test("only the vendor with sufficient coins is eligible", async () => {
    const vA = vendor({ id: "vA", coins: 120 });
    const vB = vendor({ id: "vB", coins: 90 });

    const r = await filterEligibleVendors({
      vendors: [vA, vB],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 100,
      serviceType: "house_painting",
      minTeamMembers: 1,
    });

    expect(r.eligibleVendors.map((v) => v._id)).toEqual(["vA"]);
    expect(r.reasons.lowCoins).toBe(true);
  });

  test("once the only eligible vendor books 9 AM, the same slot is blocked", () => {
    const vA = vendor({ id: "vA", coins: 120 });

    const r = calculateAvailableSlots({
      vendors: [vA], // only A passed eligibility
      bookings: [bookingFor({ vendorId: "vA", slotTime: "09:00 AM" })],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: CUST.lat,
      lng: CUST.lng,
    });

    expect(r.slots).not.toContain("09:00 AM");
    // New spec: blocked slots are RETURNED so the UI can render them as
    // disabled tiles. The slot should be visible but unselectable.
    expect(r.unavailableSlots).toContain("09:00 AM");
    expect(r.reasons.allBooked).toBe(true);
  });
});

// =============================================================================
// Test Case 2 — Vendor has exact required coins
//   Vendor: 100 coins, Required: 100 → Eligible.
// =============================================================================
describe("TC2 — vendor has exact required coins", () => {
  test("vendor.walletCoins === requiredCoins is eligible (>= comparison)", async () => {
    const v = vendor({ id: "v1", coins: 100 });

    const r = await filterEligibleVendors({
      vendors: [v],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 100,
      serviceType: "house_painting",
      minTeamMembers: 1,
    });

    expect(r.eligibleVendors.map((v) => v._id)).toEqual(["v1"]);
    expect(r.reasons.lowCoins).toBe(false);
  });
});

// =============================================================================
// Test Case 3 — Vendor has low coins
//   Vendor: 90 coins, Required: 100 → Ineligible.
// =============================================================================
describe("TC3 — vendor has low coins", () => {
  test("vendor below requiredCoins is filtered out", async () => {
    const v = vendor({ id: "v1", coins: 90 });

    const r = await filterEligibleVendors({
      vendors: [v],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 100,
      serviceType: "house_painting",
      minTeamMembers: 1,
    });

    expect(r.eligibleVendors).toEqual([]);
    expect(r.reasons.lowCoins).toBe(true);
  });
});

// =============================================================================
// Test Case 4 — All vendors have low coins
//   Vendor A: 80, Vendor B: 90, Required: 100 → No vendor eligible, no slots.
// =============================================================================
describe("TC4 — all vendors have low coins", () => {
  test("eligibility returns no vendors when all below threshold", async () => {
    const vA = vendor({ id: "vA", coins: 80 });
    const vB = vendor({ id: "vB", coins: 90 });

    const r = await filterEligibleVendors({
      vendors: [vA, vB],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 100,
      serviceType: "house_painting",
      minTeamMembers: 1,
    });

    expect(r.eligibleVendors).toEqual([]);
    expect(r.reasons.lowCoins).toBe(true);
  });

  test("slot engine returns no slots + noResources when no eligible vendors", () => {
    // Empty eligible-vendor pool simulates "all vendors low coins".
    const r = calculateAvailableSlots({
      vendors: [],
      bookings: [],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: CUST.lat,
      lng: CUST.lng,
    });

    expect(r.slots).toEqual([]);
    expect(r.reasons.noResources).toBe(true);
    expect(r.availableVendorsCount).toBe(0);
  });
});

// =============================================================================
// Test Case 5 — Multiple eligible vendors
//   Vendor A: 150, Vendor B: 130, Required: 100
//   → Both eligible. After A books a slot, the slot remains available because
//     B is still free.
// =============================================================================
describe("TC5 — multiple eligible vendors", () => {
  test("both vendors are eligible when both have sufficient coins", async () => {
    const vA = vendor({ id: "vA", coins: 150 });
    const vB = vendor({ id: "vB", coins: 130 });

    const r = await filterEligibleVendors({
      vendors: [vA, vB],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 100,
      serviceType: "house_painting",
      minTeamMembers: 1,
    });

    expect(r.eligibleVendors.map((v) => v._id).sort()).toEqual(["vA", "vB"]);
  });

  test("slot stays available after one vendor is booked when another is still free", () => {
    const vA = vendor({ id: "vA", coins: 150 });
    const vB = vendor({ id: "vB", coins: 130 });

    const r = calculateAvailableSlots({
      vendors: [vA, vB],
      bookings: [bookingFor({ vendorId: "vA", slotTime: "09:00 AM" })],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: CUST.lat,
      lng: CUST.lng,
    });

    expect(r.slots).toContain("09:00 AM");
    const slot9 = r.slotsWithVendors.find((s) => s.slotTime === "09:00 AM");
    expect(slot9.vendorIds).toEqual(["vB"]);
  });
});

// =============================================================================
// Test Case 6 — Site visit charge is zero
//   Vendor: 120 coins, Required: 100, siteVisitCharge: 0
//   → Vendor eligible. Booking allowed. NO coins deducted.
// =============================================================================
describe("TC6 — site visit charge is zero (no deduction)", () => {
  test("eligibility still uses vendorCoins (siteVisit=0 does NOT affect eligibility)", async () => {
    setPricingConfig("Pune", { city: "Pune", vendorCoins: 100, siteVisitCharge: 0 });

    const v = vendor({ id: "v1", coins: 120 });
    const r = await filterEligibleVendors({
      vendors: [v],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 100, // resolved upstream from PricingConfig.vendorCoins
      serviceType: "house_painting",
      minTeamMembers: 1,
    });

    expect(r.eligibleVendors.map((v) => v._id)).toEqual(["v1"]);
  });

  test("policy returns shouldChargeCoins=false for HP+siteVisit=0", async () => {
    setPricingConfig("Pune", { city: "Pune", vendorCoins: 100, siteVisitCharge: 0 });

    const policy = await computeBookingCoinPolicy({
      serviceType: "house_painting",
      bookingDetails: { siteVisitCharges: 0 },
      address: { city: "Pune" },
      service: [{ coinDeduction: 100 }], // legacy value — should be ignored
    });

    expect(policy.shouldChargeCoins).toBe(false);
    expect(policy.requiredCoins).toBe(0);
    expect(policy.source).toBe("hp_site_visit_zero");
  });
});

// =============================================================================
// Test Case 7 — Site visit charge greater than zero
//   Vendor: 120 coins, Required: 100 (from PricingConfig), siteVisitCharge > 0
//   → Vendor eligible. Booking allowed. Coins deducted via existing logic
//     (requiredCoins = PricingConfig.vendorCoins, unified with eligibility).
// =============================================================================
describe("TC7 — site visit charge > 0 (deduct as configured)", () => {
  test("policy returns PricingConfig.vendorCoins as requiredCoins", async () => {
    setPricingConfig("Pune", { city: "Pune", vendorCoins: 100, siteVisitCharge: 1500 });

    const policy = await computeBookingCoinPolicy({
      serviceType: "house_painting",
      bookingDetails: { siteVisitCharges: 1500 },
      address: { city: "Pune" },
      service: [{ coinDeduction: 999 }], // legacy stamp — must be ignored
    });

    expect(policy.shouldChargeCoins).toBe(true);
    expect(policy.requiredCoins).toBe(100); // from PricingConfig, NOT service[]
    expect(policy.source).toBe("hp_pricing_config");
  });

  test("DC bookings still sum service[].coinDeduction (no unification for DC)", async () => {
    const policy = await computeBookingCoinPolicy({
      serviceType: "deep_cleaning",
      bookingDetails: {},
      address: { city: "Pune" },
      service: [{ coinDeduction: 40 }, { coinDeduction: 60 }],
    });

    expect(policy.shouldChargeCoins).toBe(true);
    expect(policy.requiredCoins).toBe(100);
    expect(policy.source).toBe("dc_service_sum");
  });
});

// =============================================================================
// Test Case 8 — Same slot booking by two users
//   Same location, only one eligible vendor available.
//   User A books 9 AM. User B's slot list must NOT include 9 AM.
// =============================================================================
describe("TC8 — same slot blocked when only one eligible vendor exists", () => {
  test("9:00 AM is excluded from User B's slot list after User A books that slot", () => {
    const vA = vendor({ id: "vA", coins: 200 });

    // Simulate User B's slot fetch AFTER User A's booking exists.
    const r = calculateAvailableSlots({
      vendors: [vA], // only one eligible vendor
      bookings: [bookingFor({ vendorId: "vA", slotTime: "09:00 AM" })],
      activeHolds: [],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: CUST.lat,
      lng: CUST.lng,
    });

    expect(r.slots).not.toContain("09:00 AM");
    // Returned in unavailableSlots so the UI shows it as a disabled tile
    // ("not available"), not hidden — customer can see the slot exists.
    expect(r.unavailableSlots).toContain("09:00 AM");
    // Adjacent slot (10:00 AM) should still be available — vendor's block
    // is [9:00, 10:00] (one-sided post-service buffer, touching boundaries OK).
    expect(r.slots).toContain("10:00 AM");
  });

  test("active hold (pending payment) also blocks the slot for another user", () => {
    const vA = vendor({ id: "vA", coins: 200 });

    // User A is in payment flow → Redis hold but no booking yet.
    const r = calculateAvailableSlots({
      vendors: [vA],
      bookings: [],
      activeHolds: [{ vendorId: "vA", slotTime: "09:00 AM", durationMinutes: 30 }],
      serviceType: "house_painting",
      serviceDuration: 30,
      minTeamMembers: 1,
      date: TOMORROW,
      lat: CUST.lat,
      lng: CUST.lng,
    });

    expect(r.slots).not.toContain("09:00 AM");
  });
});
