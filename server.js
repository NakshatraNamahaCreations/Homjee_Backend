const app = require("./src/app");
const dotenv = require("dotenv");
const { connectDB } = require("./src/config/db");
const { startLeadReminderCron } = require("./src/config/leadReminderCron");
const { startLeadFanoutCron } = require("./src/config/leadFanoutCron");
const {
  startWhatsappFollowupCron,
} = require("./src/config/whatsappFollowupCron");

dotenv.config({ quiet: true });

connectDB();

startLeadReminderCron();
// Safety net: auto fan-out any recent real lead that has no invited vendors,
// so vendors are notified by pincode without opening the admin lead page.
startLeadFanoutCron();
// Automated WhatsApp enquiry follow-ups (5 min / 1 h / 24 h). Only sends
// templates that are approved and enabled in whatsappFollowupCron.js.
startWhatsappFollowupCron();

const PORT = process.env.PORT || 9000;

// app.set("etag", false);
app.listen(PORT, () => {
  console.log(`Server running on port at http://localhost:${PORT}`);
});
