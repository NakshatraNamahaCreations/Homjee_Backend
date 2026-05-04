// Verifies the BE getKpiBucket matches the FE getKpiColor logic in
// HomjeeVendor-main/src/screens/Performance.js. If these diverge,
// vendors will see one color on their phone but the slot filter will
// gate them differently.

const { getKpiBucket, isPassingBucket } = require("../kpiColor");

describe("getKpiBucket — positive metric, ascending ranges", () => {
  // rating ranges typical: a=0 b=2 c=3 d=4 e=5
  const ranges = { a: 0, b: 2, c: 3, d: 4, e: 5 };

  test("rating 1.5 → red", () => {
    expect(getKpiBucket(1.5, ranges, { positive: true })).toBe("red");
  });
  test("rating 2.5 → orange", () => {
    expect(getKpiBucket(2.5, ranges, { positive: true })).toBe("orange");
  });
  test("rating 3.5 → yellow", () => {
    expect(getKpiBucket(3.5, ranges, { positive: true })).toBe("yellow");
  });
  test("rating 4.5 → green", () => {
    expect(getKpiBucket(4.5, ranges, { positive: true })).toBe("green");
  });
  test("rating below scale (-1) → grey", () => {
    expect(getKpiBucket(-1, ranges, { positive: true })).toBe("grey");
  });
});

describe("getKpiBucket — positive metric, descending ranges (FE normalizes)", () => {
  // hiringPercentage admin entered descending 100>75>50>25>0 — FE
  // normalizes to ascending [e, d, c, b] = [0, 25, 50, 75].
  const ranges = { a: 100, b: 75, c: 50, d: 25, e: 0 };

  test("v=10 → red (in [0, 25))", () => {
    expect(getKpiBucket(10, ranges, { positive: true })).toBe("red");
  });
  test("v=80 → green (>= 75)", () => {
    expect(getKpiBucket(80, ranges, { positive: true })).toBe("green");
  });
});

describe("getKpiBucket — negative metric, descending (cancellation/strikes)", () => {
  // cancellation: a=100 b=75 c=45 d=25 e=0 (descending forced by controller)
  const ranges = { a: 100, b: 75, c: 45, d: 25, e: 0 };

  test("cancellation 80% → red (>= b)", () => {
    expect(getKpiBucket(80, ranges, { positive: false })).toBe("red");
  });
  test("cancellation 50% → orange", () => {
    expect(getKpiBucket(50, ranges, { positive: false })).toBe("orange");
  });
  test("cancellation 30% → yellow", () => {
    expect(getKpiBucket(30, ranges, { positive: false })).toBe("yellow");
  });
  test("cancellation 10% → green", () => {
    expect(getKpiBucket(10, ranges, { positive: false })).toBe("green");
  });
});

describe("getKpiBucket — unconfigured ranges", () => {
  test("all zeros returns grey", () => {
    expect(getKpiBucket(3, { a: 0, b: 0, c: 0, d: 0, e: 0 })).toBe("grey");
  });
  test("missing ranges returns grey", () => {
    expect(getKpiBucket(3, null)).toBe("grey");
  });
});

describe("isPassingBucket", () => {
  test("orange/yellow/green pass", () => {
    expect(isPassingBucket("orange")).toBe(true);
    expect(isPassingBucket("yellow")).toBe(true);
    expect(isPassingBucket("green")).toBe(true);
  });
  test("red/grey fail", () => {
    expect(isPassingBucket("red")).toBe(false);
    expect(isPassingBucket("grey")).toBe(false);
  });
});
