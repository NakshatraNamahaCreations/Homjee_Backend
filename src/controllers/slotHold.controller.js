const {
  acquireHold,
  releaseHold,
} = require("../services/slotHold.service");
const { invalidateForDate } = require("../services/slotCache.service");
const { isRedisReady } = require("../config/redis");

/**
 * POST /api/slots/hold
 * Body: { vendorId, date, slotTime, durationMinutes, customerId, serviceType }
 *
 * 200 → { success: true, holdId, expiresInSeconds }
 * 409 → slot already held by another customer
 * 503 → Redis unavailable (holds disabled until Redis is up)
 */
exports.createHold = async (req, res) => {
  try {
    if (!isRedisReady()) {
      return res.status(503).json({
        success: false,
        message: "Hold service unavailable. Please retry shortly.",
      });
    }

    const { vendorId, date, slotTime, durationMinutes, customerId, serviceType } = req.body;
    if (!vendorId || !date || !slotTime || !durationMinutes) {
      return res.status(400).json({
        success: false,
        message: "vendorId, date, slotTime, durationMinutes are required",
      });
    }

    const result = await acquireHold({
      vendorId,
      date,
      slotTime,
      durationMinutes,
      customerId,
      serviceType,
    });

    if (!result.ok) {
      if (result.reason === "slot_already_held") {
        return res.status(409).json({
          success: false,
          message: "This slot was just taken by another customer. Please pick another slot.",
        });
      }
      if (result.reason === "redis_unavailable") {
        return res.status(503).json({
          success: false,
          message: "Hold service unavailable. Please retry shortly.",
        });
      }
      return res.status(400).json({ success: false, message: result.reason });
    }

    // New hold reduces availability for that date — clear cache so the
    // next /slots call recomputes against the fresh hold list.
    await invalidateForDate(date);

    return res.json({
      success: true,
      holdId: result.holdId,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (err) {
    console.error("HOLD ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to create hold" });
  }
};

/**
 * POST /api/slots/release
 * Body: { vendorId, date, slotTime, holdId }
 */
exports.releaseHoldEndpoint = async (req, res) => {
  try {
    const { vendorId, date, slotTime, holdId } = req.body;
    if (!vendorId || !date || !slotTime) {
      return res.status(400).json({
        success: false,
        message: "vendorId, date, slotTime are required",
      });
    }

    const result = await releaseHold({ vendorId, date, slotTime, holdId });
    await invalidateForDate(date);

    return res.json({ success: true, released: result.ok });
  } catch (err) {
    console.error("RELEASE HOLD ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to release hold" });
  }
};
