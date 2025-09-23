// /helpers/quotes.js
const Quote = require("../models/measurement/Quote");
const mongoose = require("mongoose");

async function unlockRelatedQuotesByHiring(booking, reason = "auto") {
  try {
    const vendorId = booking?.assignedProfessional?.professionalId;
    const hiring = booking?.assignedProfessional?.hiring || {};
    let { quotationId, leadId } = hiring;

    // 1) If we have a quotationId, prefer it
    if (quotationId) {
      const q = await Quote.findById(
        new mongoose.Types.ObjectId(quotationId)
      ).lean();
      if (q) {
        const res = await Quote.updateMany(
          { leadId: q.leadId, vendorId: q.vendorId, locked: true },
          { $set: { locked: false } }
        );
        console.log(
          `[quotes] unlocked ${res.modifiedCount} by quotationId (${reason})`
        );
        return;
      }
      console.log("[quotes] quotationId not found in DB:", quotationId);
    }

    // 2) Fallback: use leadId from hiring/booking + vendorId
    leadId = leadId || booking?.leadId || null;
    if (leadId && vendorId) {
      const res = await Quote.updateMany(
        { leadId, vendorId, locked: true },
        { $set: { locked: false } }
      );
      console.log(
        `[quotes] unlocked ${res.modifiedCount} by leadId+vendor (${reason})`
      );
      if (res.modifiedCount > 0) return;
    }

    // 3) Last resort: newest locked, finalized quote for this vendor
    if (vendorId) {
      const newest = await Quote.findOne({
        vendorId,
        locked: true,
        status: "finalized",
      })
        .sort({ updatedAt: -1 })
        .lean();

      if (newest) {
        // unlock that one…
        const one = await Quote.updateOne(
          { _id: newest._id, locked: true },
          { $set: { locked: false } }
        );
        console.log(
          `[quotes] fallback unlocked 1 quote (${reason}):`,
          newest._id
        );

        // …and also any other quotes sharing its leadId
        if (newest.leadId) {
          const more = await Quote.updateMany(
            { vendorId, leadId: newest.leadId, locked: true },
            { $set: { locked: false } }
          );
          if (more.modifiedCount) {
            console.log(
              `[quotes] plus unlocked ${more.modifiedCount} more for lead=${newest.leadId}`
            );
          }
        }
        return;
      }
    }

    console.log("[quotes] nothing to unlock (no quotationId/leadId match)");
  } catch (e) {
    console.error("unlockRelatedQuotesByHiring error:", e);
  }
}

module.exports = { unlockRelatedQuotesByHiring };
