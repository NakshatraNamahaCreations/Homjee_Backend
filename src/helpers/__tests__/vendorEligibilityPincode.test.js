// Pincode gate tests for vendorEligibility.

jest.mock("../../models/perfomance/kpiparameters", () => ({
  findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
}));
jest.mock("../../services/vendorKpiCache.service", () => ({
  getOrComputeVendorKpis: jest.fn().mockResolvedValue(null),
}));

const {
  filterEligibleVendors,
  extractPincode,
} = require("../vendorEligibility");

// Customer in Undri, pincode 411060.
const CUST = { lat: 18.5853, lng: 73.7543 };

function vendor({ id, name, locationString, lat, lng, coins = 1000, radiusKm = 10 }) {
  return {
    _id: id,
    isArchived: false,
    vendor: { vendorName: name, city: "Pune" },
    address: { location: locationString, latitude: lat, longitude: lng },
    serviceRadiusKm: radiusKm,
    wallet: { coins },
    team: [{ _id: `${id}-m1`, markedLeaves: [] }],
  };
}

describe("extractPincode", () => {
  test("pulls 6-digit pincode out of a free-form address string", () => {
    expect(
      extractPincode(
        "A-402, Wing-A, Dynamic Grandeur oasis, Undri, Pune, Maharashtra 411060, India",
      ),
    ).toBe("411060");
  });

  test("returns null when no 6-digit token is present", () => {
    expect(extractPincode("Some address, no pin here")).toBe(null);
    expect(extractPincode("")).toBe(null);
    expect(extractPincode(null)).toBe(null);
    expect(extractPincode(undefined)).toBe(null);
  });

  test("ignores phone numbers and longer digit runs", () => {
    expect(extractPincode("Call 9999999999, near 411060 lane")).toBe("411060");
  });
});

describe("pincode gate in filterEligibleVendors", () => {
  test("when bookingPincode set, rejects vendors with a different pincode", async () => {
    const vUndri = vendor({
      id: "vUndri",
      name: "Varun",
      locationString: "Undri, Pune 411060",
      lat: CUST.lat,
      lng: CUST.lng,
    });
    const vKothrud = vendor({
      id: "vKothrud",
      name: "Ram",
      // Different pincode — still within 10 km radius of Undri so the
      // old radius-only gate would let them through.
      locationString: "Kothrud, Pune 411038",
      lat: 18.5074,
      lng: 73.8077,
    });
    const r = await filterEligibleVendors({
      vendors: [vUndri, vKothrud],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 0,
      serviceType: "house_painting",
      minTeamMembers: 1,
      bookingPincode: "411060",
      includeDebug: true,
    });

    const names = r.eligibleVendors.map((v) => v?.vendor?.vendorName);
    expect(names).toEqual(["Varun"]);
    expect(r.reasons.pincodeMismatch).toBe(true);

    const ramDebug = r.debug.find((d) => d.vendorName === "Ram");
    expect(ramDebug.status).toMatch(/pincode_mismatch/);
  });

  test("when bookingPincode is null, falls back to radius-only gate", async () => {
    const vUndri = vendor({
      id: "vUndri",
      name: "Varun",
      locationString: "Undri, Pune 411060",
      lat: CUST.lat,
      lng: CUST.lng,
    });
    const vKothrud = vendor({
      id: "vKothrud",
      name: "Ram",
      locationString: "Kothrud, Pune 411038",
      lat: 18.5074,
      lng: 73.8077,
      // Ram's base is ~10.5 km from Undri — sits just outside the
      // default 10 km vendor radius. Bump his radius to 15 km so this
      // test isolates the no-pincode fallback path; without it the
      // radius gate would reject Ram for an unrelated reason.
      radiusKm: 15,
    });
    const r = await filterEligibleVendors({
      vendors: [vUndri, vKothrud],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 0,
      serviceType: "house_painting",
      minTeamMembers: 1,
      // bookingPincode intentionally omitted
      includeDebug: true,
    });

    expect(r.eligibleVendors.map((v) => v?.vendor?.vendorName).sort()).toEqual([
      "Ram",
      "Varun",
    ]);
    expect(r.reasons.pincodeMismatch).toBe(false);
  });

  test("vendor without a pincode in their address string falls through (not auto-rejected)", async () => {
    const vNoPin = vendor({
      id: "vNoPin",
      name: "Akash",
      // No 6-digit token in the location string — legacy data.
      locationString: "Aundh area",
      lat: CUST.lat,
      lng: CUST.lng,
    });
    const r = await filterEligibleVendors({
      vendors: [vNoPin],
      lat: CUST.lat,
      lng: CUST.lng,
      requiredCoins: 0,
      serviceType: "house_painting",
      minTeamMembers: 1,
      bookingPincode: "411060",
      includeDebug: true,
    });
    expect(r.eligibleVendors.map((v) => v?.vendor?.vendorName)).toEqual([
      "Akash",
    ]);
    expect(r.reasons.pincodeMismatch).toBe(false);
  });
});
