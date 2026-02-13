import cron from "node-cron";
import UserBooking from "../models/user/userBookings.js"; // ✅ change path/name
import Vendor from "../models/vendor/vendorAuth.js"; // ✅ change path/name
// import { sendPushToVendor } from "../utils/push.js"; // ✅ you create this
import vendorNotification from "../models/notification/vendorNotification.js";

export const startLeadReminderCron = () => {
    try {
        // runs every minute
        cron.schedule("* * * * *", async () => {
            try {
                const now = new Date();

                // ✅ Find due reminders (embedded in booking)
                const dueBookings = await UserBooking.find({
                    "leadReminder.status": "pending",
                    "leadReminder.reminderAt": { $lte: now },
                }).limit(50);

                for (const booking of dueBookings) {
                    try {
                        const vendorId = booking.vendorId;
                        if (!vendorId) {
                            await UserBooking.updateOne(
                                { _id: booking._id },
                                {
                                    $set: {
                                        "leadReminder.status": "cancelled",
                                        "leadReminder.sentAt": new Date(),
                                    },
                                }
                            );
                            continue;
                        }

                        const vendor = await Vendor.findById(vendorId);
                        if (!vendor) {
                            await UserBooking.updateOne(
                                { _id: booking._id },
                                {
                                    $set: {
                                        "leadReminder.status": "cancelled",
                                        "leadReminder.sentAt": new Date(),
                                    },
                                }
                            );
                            continue;
                        }

                        const newNotification = {
                            vendorId: String(vendorId), // schema expects String
                            notificationType: "REMINDER",
                            thumbnailTitle: "Lead Reminder",
                            message: "You have a reminder for a lead",
                            status: "unread", // optional, default is unread
                            metaData: { bookingId: String(booking._id), leadId: String(booking.leadId || "") }, // ✅ correct key
                        };

                        try {
                            const created = await vendorNotification.create(newNotification);
                            console.log("✅ vendorNotification saved:", created._id);
                        } catch (e) {
                            console.log("❌ vendorNotification create failed:", e?.message);
                            if (e?.errors) console.log("validation errors:", Object.keys(e.errors));
                        }

                        // ✅ Mark as sent
                        await UserBooking.updateOne(
                            { _id: booking._id },
                            {
                                $set: {
                                    "leadReminder.status": "sent",
                                    "leadReminder.sentAt": new Date(),
                                },
                            }
                        );
                    } catch (err) {
                        console.log("Reminder send error:", err);
                    }
                }
            } catch (e) {
                console.log("Lead reminder cron error:", e);
            }
        });

        console.log("✅ Lead reminder cron started");
    } catch (e) {
        console.log("Cron start error:", e);
    }
};
