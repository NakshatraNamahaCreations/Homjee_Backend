// Caches /available-slots responses in Redis for a short TTL so that
// many users near the same location requesting the same service+date
// don't each trigger the full vendor-filter pipeline.
//
// Cache key strategy:
//   slots:{serviceType}:{city}:{date}:{packagesHash}:{latBucket}:{lngBucket}
//
//   - latBucket / lngBucket round to ~1.1 km grid (3 decimals) so users
//     within roughly 100 m of each other share a cache hit, while users
//     in different neighbourhoods don't poison each other's results.
//   - packagesHash sorts + joins package IDs so order doesn't matter.
//
// Invalidate on any event that changes vendor eligibility for a date:
//   - new booking confirmed   → invalidateForDate(date)
//   - hold acquired/released  → invalidateForDate(date)
//   - vendor archived/coins   → invalidateAll()
//
// Caching is best-effort. Redis down → skip cache, hit Mongo.

const crypto = require("crypto");
const { safeRedis } = require("../config/redis");

const SLOT_CACHE_TTL_SECONDS = 60;
const KEY_PREFIX = "slots";

function bucketCoord(n) {
  return Number(n).toFixed(3); // ~110 m at the equator
}

function packagesHash(packageIds) {
  if (!Array.isArray(packageIds) || !packageIds.length) return "none";
  const joined = packageIds.map(String).sort().join(",");
  return crypto.createHash("sha1").update(joined).digest("hex").slice(0, 10);
}

function buildKey({ serviceType, city, date, packageIds, lat, lng }) {
  return [
    KEY_PREFIX,
    serviceType,
    (city || "any").toLowerCase(),
    date,
    packagesHash(packageIds),
    bucketCoord(lat),
    bucketCoord(lng),
  ].join(":");
}

async function getCachedSlots(params) {
  return safeRedis(async (redis) => {
    const raw = await redis.get(buildKey(params));
    return raw ? JSON.parse(raw) : null;
  }, null);
}

async function setCachedSlots(params, value) {
  return safeRedis(async (redis) => {
    await redis.set(
      buildKey(params),
      JSON.stringify(value),
      "EX",
      SLOT_CACHE_TTL_SECONDS,
    );
    return true;
  }, false);
}

// Targeted invalidation for one date (most common case — new booking).
async function invalidateForDate(date) {
  return safeRedis(async (redis) => {
    const pattern = `${KEY_PREFIX}:*:*:${date}:*`;
    let cursor = "0";
    let removed = 0;
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      if (batch.length) {
        await redis.del(...batch);
        removed += batch.length;
      }
      cursor = next;
    } while (cursor !== "0");
    return removed;
  }, 0);
}

// Wipe everything (vendor archive / coin drop affects all dates).
async function invalidateAll() {
  return safeRedis(async (redis) => {
    const pattern = `${KEY_PREFIX}:*`;
    let cursor = "0";
    let removed = 0;
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
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
  getCachedSlots,
  setCachedSlots,
  invalidateForDate,
  invalidateAll,
  SLOT_CACHE_TTL_SECONDS,
};
