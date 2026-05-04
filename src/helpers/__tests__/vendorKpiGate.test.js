const { passesPerformanceGate } = require("../vendorKpiGate");

const dcRanges = {
  rating:                 { a: 0,   b: 2,   c: 3,   d: 4,   e: 5 },
  responsePercentage:     { a: 0,   b: 25,  c: 50,  d: 75,  e: 100 },
  cancellationPercentage: { a: 100, b: 75,  c: 45,  d: 25,  e: 0 },
  strikes:                { a: 50,  b: 20,  c: 10,  d: 5,   e: 0 },
};

const hpRanges = {
  rating:                { a: 0,   b: 2,    c: 3,    d: 4,    e: 5 },
  surveyPercentage:      { a: 0,   b: 25,   c: 50,   d: 75,   e: 100 },
  hiringPercentage:      { a: 0,   b: 20,   c: 40,   d: 60,   e: 100 },
  avgGSV:                { a: 0,   b: 5000, c: 10000, d: 25000, e: 100000 },
  strikes:               { a: 50,  b: 20,   c: 10,   d: 5,    e: 0 },
};

describe("DC gate", () => {
  test("strong vendor passes", () => {
    const kpis = {
      averageRating: 4.5,
      responseRate: 80,
      cancellationRate: 5,
      strikes: 1,
      totalRatings: 30,
      totalLeads: 50,
    };
    const r = passesPerformanceGate(kpis, dcRanges, "deep_cleaning");
    expect(r.pass).toBe(true);
    expect(r.failedMetrics).toEqual([]);
  });

  test("low rating fails", () => {
    const kpis = {
      averageRating: 1.5,
      responseRate: 80,
      cancellationRate: 5,
      strikes: 1,
      totalRatings: 30,
      totalLeads: 50,
    };
    const r = passesPerformanceGate(kpis, dcRanges, "deep_cleaning");
    expect(r.pass).toBe(false);
    expect(r.failedMetrics).toContain("rating");
  });

  test("high cancellation fails", () => {
    const kpis = {
      averageRating: 4.5,
      responseRate: 80,
      cancellationRate: 80,
      strikes: 1,
      totalRatings: 30,
      totalLeads: 50,
    };
    const r = passesPerformanceGate(kpis, dcRanges, "deep_cleaning");
    expect(r.pass).toBe(false);
    expect(r.failedMetrics).toContain("cancellationPercentage");
  });

  test("new vendor (zero ratings, zero leads) is not gated out", () => {
    const kpis = {
      averageRating: 0,
      responseRate: 0,
      cancellationRate: 0,
      strikes: 0,
      totalRatings: 0,
      totalLeads: 0,
    };
    const r = passesPerformanceGate(kpis, dcRanges, "deep_cleaning");
    expect(r.pass).toBe(true);
  });

  test("no admin ranges → no gating (admin hasn't configured yet)", () => {
    const r = passesPerformanceGate(
      { averageRating: 1, totalRatings: 10, totalLeads: 5, responseRate: 0, cancellationRate: 100, strikes: 50 },
      null,
      "deep_cleaning",
    );
    expect(r.pass).toBe(true);
  });
});

describe("HP gate (avgGSV included)", () => {
  test("strong HP vendor passes", () => {
    const kpis = {
      averageRating: 4.5,
      surveyRate: 80,
      hiringRate: 70,
      averageGsv: 30000,
      strikes: 1,
      totalRatings: 30,
      totalLeads: 50,
    };
    const r = passesPerformanceGate(kpis, hpRanges, "house_painting");
    expect(r.pass).toBe(true);
  });

  test("low avgGSV fails (HP only)", () => {
    const kpis = {
      averageRating: 4.5,
      surveyRate: 80,
      hiringRate: 70,
      averageGsv: 1000, // below b=5000 → red
      strikes: 1,
      totalRatings: 30,
      totalLeads: 50,
    };
    const r = passesPerformanceGate(kpis, hpRanges, "house_painting");
    expect(r.pass).toBe(false);
    expect(r.failedMetrics).toContain("avgGSV");
  });
});
