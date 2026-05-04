// Single Redis client used for slot caching + slot holds.
//
// Caching: graceful fallback — if Redis is unreachable, callers skip cache
//   and fall through to Mongo. App keeps working in dev without Redis.
// Holds:   strict — slot holds REQUIRE Redis (atomic SET NX EX is the
//   primitive). Hold endpoints return 503 when isRedisReady() is false.
//
// Local dev on Windows: install Memurai
//   winget install Memurai.MemuraiDeveloper
// Then either set REDIS_URL=redis://127.0.0.1:6379 in .env or leave unset
// to use that default.

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let client = null;
let ready = false;
let logged = { connect: false, error: false };

function getRedis() {
  if (client) return client;

  client = new Redis(REDIS_URL, {
    // Don't crash the process on startup if Redis isn't running — we want
    // the rest of the API to keep serving. lazyConnect + maxRetries gives
    // ioredis room to reconnect when Redis comes back online.
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    enableOfflineQueue: false, // fail fast instead of buffering forever
  });

  client.on("ready", () => {
    ready = true;
    if (!logged.connect) {
      console.log(`[redis] connected ${REDIS_URL}`);
      logged.connect = true;
      logged.error = false;
    }
  });

  client.on("end", () => {
    ready = false;
  });

  client.on("error", (err) => {
    ready = false;
    if (!logged.error) {
      console.warn(`[redis] unavailable (${err.code || err.message}). Caching + slot holds disabled until Redis is up.`);
      logged.error = true;
      logged.connect = false;
    }
  });

  return client;
}

function isRedisReady() {
  if (!client) getRedis();
  return ready;
}

// Wraps a Redis call so a transport failure never breaks the caller.
// Returns `fallback` (default null) when Redis is down or the op throws.
async function safeRedis(fn, fallback = null) {
  if (!isRedisReady()) return fallback;
  try {
    return await fn(getRedis());
  } catch (err) {
    console.warn("[redis] op failed:", err.message);
    return fallback;
  }
}

module.exports = { getRedis, isRedisReady, safeRedis };
