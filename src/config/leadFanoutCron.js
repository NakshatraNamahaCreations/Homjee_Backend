const cron = require("node-cron");
const UserBooking = require("../models/user/userBookings");
const {
  fanOutLeadToEligibleVendors,
} = require("../services/leadFanout.service");

// Safety net for auto-notifying vendors on lead creation.
//
// The creation endpoints already await the fan-out, but if any path or a
// dropped async task ever leaves a REAL (non-enquiry) Pending lead with zero
// invited vendors, this catches it — so vendors are always notified by pincode
// WITHOUT anyone opening the admin lead-details page.
//
// - Only recently-created leads (last 30 min) so we never re-fan-out old
//   stale leads and spam vendors.
// - Only leads with NO invitedVendors yet, so once a lead is fanned out the
//   cron never touches it again (no duplicate invites/pushes).
// - fanOutLeadToEligibleVendors itself skips already-invited vendors.
function startLeadFanoutCron() {
  try {
    // every minute
    cron.schedule("* * * * *", async () => {
      try {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000); // last 30 min
        const leads = await UserBooking.find({
          isEnquiry: false,
          "bookingDetails.status": "Pending",
          $and: [
            {
              $or: [
                { invitedVendors: { $exists: false } },
                { invitedVendors: { $size: 0 } },
              ],
            },
            {
              $or: [
                { createdDate: { $gte: cutoff } },
                { createdAt: { $gte: cutoff } },
              ],
            },
          ],
        })
          .limit(50)
          .lean();

        for (const lead of leads) {
          try {
            const r = await fanOutLeadToEligibleVendors(lead);
            if (r?.notified) {
              console.log(
                "[fanoutCron] auto-notified",
                r.notified,
                "vendor(s) for",
                lead?.bookingDetails?.booking_id,
              );
            }
          } catch (e) {
            console.error(
              "[fanoutCron] fanout failed for",
              String(lead?._id),
              e?.message,
            );
          }
        }
      } catch (e) {
        console.error("[fanoutCron] tick error:", e?.message);
      }
    });
  } catch (e) {
    console.error("[fanoutCron] start error:", e?.message);
  }
}

module.exports = { startLeadFanoutCron };
