const app = require("./src/app");
const dotenv = require("dotenv");
const { connectDB } = require("./src/config/db");
const { startLeadReminderCron } = require("./src/config/leadReminderCron")

dotenv.config({ quiet: true });

connectDB();

startLeadReminderCron();

const PORT = process.env.PORT || 9000;

app.set("etag", false);
app.listen(PORT, () => {
  console.log(`Server running on port at http://localhost:${PORT}`);
});
