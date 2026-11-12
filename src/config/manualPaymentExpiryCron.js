const cron = require("node-cron");
const ManualPayment = require("../models/user/manualPayment");

// #6d / #7d: Manual Payment links and Buy-Coins payment links (both are
// ManualPayment documents — the coins ones have context:"coins") must auto
// expire 24 hours after creation if no successful payment is made.
//
// When a link expires we flip payment.status "Pending" -> "Failed" and
// payment.isActive -> false. Effects:
//   - The money-dashboard pending list only shows status:"Pending", so expired
//     links drop off it automatically (and stop counting toward "Amount yet to
//     be collected").
//   - isActive:false marks the link dead so the pay/verify flow can reject it.
//
// A successful payment sets status:"Paid" before 24h, so it is never touched
// here and instead shows up in the paid list — exactly the spec behaviour.
function startManualPaymentExpiryCron() {
  try {
    // Every 5 minutes is frequent enough for a 24h window.
    cron.schedule("*/5 * * * *", async () => {
      try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
        const res = await ManualPayment.updateMany(
          { "payment.status": "Pending", createdAt: { $lte: cutoff } },
          { $set: { "payment.status": "Failed", "payment.isActive": false } },
        );
        if (res?.modifiedCount) {
          console.log(
            `[manualPaymentExpiry] expired ${res.modifiedCount} stale payment link(s)`,
          );
        }
      } catch (e) {
        console.error("[manualPaymentExpiry] run error:", e?.message || e);
      }
    });
    console.log("[manualPaymentExpiry] cron started (every 5 min, 24h expiry)");
  } catch (e) {
    console.error("[manualPaymentExpiry] failed to start:", e?.message || e);
  }
}

module.exports = { startManualPaymentExpiryCron };
