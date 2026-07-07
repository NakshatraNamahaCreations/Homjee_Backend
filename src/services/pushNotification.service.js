// Firebase Cloud Messaging (FCM) push sender for vendor new-lead alerts (#3).
//
// SAFE BY DEFAULT: if Firebase credentials are not configured, every export
// here no-ops (logs once) instead of throwing — so the app keeps running and
// lead fanout is never blocked by a missing key. Push simply starts working
// the moment you provide the service-account credentials.
//
// ── How to configure ────────────────────────────────────────────────────────
// Provide the Firebase Admin service-account key via EITHER:
//   1. env FIREBASE_SERVICE_ACCOUNT_JSON  = the full JSON (stringified), or
//   2. env FIREBASE_SERVICE_ACCOUNT_PATH  = path to the .json file, or
//   3. a file at  <backend root>/serviceAccountKey.json
// Generate it in: Firebase Console → Project Settings → Service accounts →
// "Generate new private key".

const fs = require("fs");
const path = require("path");

let admin = null;
let messaging = null;
let initState = "uninitialized"; // "ready" | "disabled" | "uninitialized"
let warnedDisabled = false;

function loadServiceAccount() {
  // 1) Inline JSON env (best for hosts like Render where files aren't persisted)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error(
        "[push] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:",
        e.message,
      );
      return null;
    }
  }

  // 2) Path env, or 3) default file at backend root
  const candidate =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "serviceAccountKey.json");
  try {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  } catch (e) {
    console.error("[push] failed reading service account file:", e.message);
  }
  return null;
}

function ensureInit() {
  if (initState !== "uninitialized") return initState === "ready";

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    initState = "disabled";
    if (!warnedDisabled) {
      console.warn(
        "[push] Firebase credentials not found — push notifications are DISABLED. " +
          "Set FIREBASE_SERVICE_ACCOUNT_JSON / _PATH or add serviceAccountKey.json to enable.",
      );
      warnedDisabled = true;
    }
    return false;
  }

  try {
    // Lazy require so the dependency is only needed once credentials exist.
    admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    messaging = admin.messaging();
    initState = "ready";
    console.log("[push] Firebase Admin initialized — push notifications ON.");
    return true;
  } catch (e) {
    initState = "disabled";
    console.error("[push] Firebase Admin init failed:", e.message);
    return false;
  }
}

/**
 * Send a push notification to a set of device tokens.
 * @param {string[]} tokens
 * @param {{title:string, body:string, data?:Object, channelId?:string}} payload
 * @returns {Promise<{sent:number, invalidTokens:string[]}>}
 */
async function sendToTokens(tokens, payload) {
  const unique = Array.from(new Set((tokens || []).filter(Boolean)));
  if (!unique.length) return { sent: 0, invalidTokens: [] };
  if (!ensureInit()) return { sent: 0, invalidTokens: [] };

  const channelId = payload.channelId || "lead-alerts-v2";

  const message = {
    tokens: unique,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    // Stringify data values — FCM requires string-only data payloads.
    data: Object.fromEntries(
      Object.entries(payload.data || {}).map(([k, v]) => [k, String(v ?? "")]),
    ),
    android: {
      priority: "high",
      notification: {
        channelId, // must match the channel created in the app (with sound)
        // 'default' = the device's default notification tone. Switch this to
        // "lead_alert" once a res/raw/lead_alert.mp3 is bundled in the app for
        // a custom Ola-style tune (must match the app channel's sound).
        sound: "default",
        defaultSound: true,
        notificationPriority: "PRIORITY_HIGH",
      },
    },
    apns: {
      payload: { aps: { sound: "default" } },
    },
  };

  try {
    const res = await messaging.sendEachForMulticast(message);
    const invalidTokens = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) {
          invalidTokens.push(unique[i]);
        }
      }
    });
    return { sent: res.successCount, invalidTokens };
  } catch (e) {
    console.error("[push] sendEachForMulticast failed:", e.message);
    return { sent: 0, invalidTokens: [] };
  }
}

/**
 * Resolve vendor tokens, send, and prune any dead tokens from the vendor docs.
 * @param {string[]} vendorIds
 * @param {{title:string, body:string, data?:Object, channelId?:string}} payload
 */
async function sendPushToVendors(vendorIds, payload) {
  const ids = Array.from(new Set((vendorIds || []).map(String).filter(Boolean)));
  if (!ids.length) return { sent: 0 };
  // Early out (and avoid a DB read) when push is disabled.
  if (!ensureInit()) return { sent: 0 };

  // Required lazily to avoid any circular-require surprises at boot.
  const VendorAuth = require("../models/vendor/vendorAuth");

  const vendors = await VendorAuth.find(
    { _id: { $in: ids } },
    { fcmTokens: 1 },
  ).lean();

  const allTokens = [];
  for (const v of vendors) {
    for (const t of v.fcmTokens || []) allTokens.push(t);
  }
  if (!allTokens.length) return { sent: 0 };

  const { sent, invalidTokens } = await sendToTokens(allTokens, payload);

  // Prune dead tokens so we don't keep retrying them.
  if (invalidTokens.length) {
    try {
      await VendorAuth.updateMany(
        { _id: { $in: ids } },
        { $pull: { fcmTokens: { $in: invalidTokens } } },
      );
    } catch (e) {
      console.error("[push] failed pruning invalid tokens:", e.message);
    }
  }

  return { sent };
}

function isPushEnabled() {
  return ensureInit();
}

module.exports = { sendPushToVendors, sendToTokens, isPushEnabled };
