// Memoizes per-vendor KPI bundles in Redis so the slot filter doesn't
// re-run the geo $near + ratings aggregate for every candidate vendor on
// every slot request.
//
// Key:  kpi:{serviceType}:{vendorId}:{timeframe}
// TTL:  10 minutes
//
// Invalidate on:
//   - new VendorRating row              → invalidateVendor(vendorId)
//   - vendor responds to a lead          → invalidateVendor(vendorId)
//   - vendor cancels                     → invalidateVendor(vendorId)
//
// Cache misses fall through to vendorKpi.computeKpisForGate, which is
// the same code path serving the dashboard endpoints.

const { safeRedis } = require("../config/redis");
const { computeKpisForGate } = require("../helpers/vendorKpi");

const KPI_CACHE_TTL_SECONDS = 10 * 60;
const KEY_PREFIX = "kpi";

const buildKey = (vendorId, serviceType, timeframe = "last") =>
  `${KEY_PREFIX}:${serviceType}:${vendorId}:${timeframe}`;

async function getOrComputeVendorKpis(vendor, serviceType) {
  const key = buildKey(vendor._id, serviceType);

  const cached = await safeRedis(async (redis) => {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }, null);
  if (cached) return cached;

  const kpis = await computeKpisForGate(vendor, serviceType);
  if (!kpis) return null;

  await safeRedis(async (redis) => {
    await redis.set(key, JSON.stringify(kpis), "EX", KPI_CACHE_TTL_SECONDS);
    return true;
  }, false);

  return kpis;
}

async function invalidateVendor(vendorId) {
  return safeRedis(async (redis) => {
    const pattern = `${KEY_PREFIX}:*:${vendorId}:*`;
    let cursor = "0";
    let removed = 0;
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      if (batch.length) {
        await redis.del(...batch);
        removed += batch.length;
      }
      cursor = next;
    } while (cursor !== "0");
    return removed;
  }, 0);
}

module.exports = {
  getOrComputeVendorKpis,
  invalidateVendor,
  KPI_CACHE_TTL_SECONDS,
};
