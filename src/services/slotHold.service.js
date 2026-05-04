// Reservation/hold layer for slot booking, backed by Redis.
//
// Pattern:
//   key = `hold:{vendorId}:{date}:{slotTime}`
//   value = JSON { holdId, customerId, durationMinutes, serviceType, createdAt }
//   TTL = HOLD_TTL_SECONDS (10 min)
//
// Acquire is atomic via SET NX EX — only one hold can win per (vendor,
// date, slot). Other concurrent requests get 409.
//
// Reads use SCAN MATCH `hold:*:{date}:*` once per slot-availability
// request, then MGET to fetch values. Bounded keyspace so SCAN is cheap.
//
// Holds are NOT a fallback for booking confirmation — confirmBooking()
// must re-validate inside a Mongo transaction in case Redis evicted the
// hold or another writer beat us. Hold = soft reservation, booking row
// = source of truth.

const crypto = require("crypto");
const { getRedis, isRedisReady, safeRedis } = require("../config/redis");

const HOLD_TTL_SECONDS = 10 * 60; // 10 minutes
const HOLD_KEY_PREFIX = "hold";

const holdKey = (vendorId, date, slotTime) =>
  `${HOLD_KEY_PREFIX}:${vendorId}:${date}:${slotTime}`;

/**
 * Try to lock a slot for a vendor.
 * @returns {Promise<{ok: true, holdId}|{ok: false, reason}>}
 */
async function acquireHold({
  vendorId,
  date,
  slotTime,
  durationMinutes,
  customerId,
  serviceType,
}) {
  if (!isRedisReady()) {
    return { ok: false, reason: "redis_unavailable" };
  }
  if (!vendorId || !date || !slotTime || !durationMinutes) {
    return { ok: false, reason: "invalid_params" };
  }

  const redis = getRedis();
  const key = holdKey(vendorId, date, slotTime);
  const holdId = crypto.randomUUID();
  const payload = JSON.stringify({
    holdId,
    customerId: customerId || null,
    vendorId: String(vendorId),
    date,
    slotTime,
    durationMinutes: Number(durationMinutes),
    serviceType: serviceType || null,
    createdAt: new Date().toISOString(),
  });

  // SET NX EX = atomic "set only if not exists, with TTL". This is the lock.
  const result = await redis.set(key, payload, "EX", HOLD_TTL_SECONDS, "NX");
  if (result !== "OK") {
    return { ok: false, reason: "slot_already_held" };
  }

  return { ok: true, holdId, expiresInSeconds: HOLD_TTL_SECONDS };
}

/**
 * Release a hold. Pass holdId to ensure we only delete the caller's own
 * hold (defends against accidental release of someone else's lock if the
 * key was rewritten after expiry).
 */
async function releaseHold({ vendorId, date, slotTime, holdId }) {
  if (!isRedisReady()) return { ok: false, reason: "redis_unavailable" };
  if (!vendorId || !date || !slotTime) {
    return { ok: false, reason: "invalid_params" };
  }

  const redis = getRedis();
  const key = holdKey(vendorId, date, slotTime);

  if (!holdId) {
    const deleted = await redis.del(key);
    return { ok: deleted === 1 };
  }

  // Compare-and-delete via Lua so we don't race against TTL expiry +
  // a fresh hold acquired by someone else.
  const lua = `
    local v = redis.call("GET", KEYS[1])
    if v then
      local ok, parsed = pcall(cjson.decode, v)
      if ok and parsed.holdId == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
    end
    return 0
  `;
  const deleted = await redis.eval(lua, 1, key, holdId);
  return { ok: deleted === 1 };
}

/**
 * List all active holds for a date. Used by the slot-availability
 * controller to merge holds into per-vendor blocked windows.
 *
 * @returns {Promise<Array<{vendorId, slotTime, durationMinutes, holdId}>>}
 */
async function listActiveHoldsForDate(date) {
  return safeRedis(async (redis) => {
    const pattern = `${HOLD_KEY_PREFIX}:*:${date}:*`;
    const keys = await scanAll(redis, pattern);
    if (!keys.length) return [];

    const values = await redis.mget(...keys);
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const raw = values[i];
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        out.push({
          vendorId: parsed.vendorId,
          slotTime: parsed.slotTime,
          durationMinutes: parsed.durationMinutes,
          holdId: parsed.holdId,
        });
      } catch (_) {
        // ignore malformed entries
      }
    }
    return out;
  }, []);
}

// SCAN paginates with a cursor. Walk the whole keyspace match.
async function scanAll(redis, pattern) {
  const out = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    if (batch.length) out.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return out;
}

module.exports = {
  acquireHold,
  releaseHold,
  listActiveHoldsForDate,
  HOLD_TTL_SECONDS,
};
