require("dotenv").config();
const express = require("express");
const routes = require("./routes");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");
const {
  startAutoCancelWorker,
} = require("./controllers/user/autoCancelWorker");

const app = express();

// console.log("Razorpay key present:", !!process.env.RAZORPAY_KEY_ID);
// NOTE: Origin values must NOT have a trailing slash. The browser's
// `Origin` header is always `scheme://host[:port]` (no path/slash), so
// any entry ending in "/" will fail the equality check and CORS will
// silently reject the preflight.
const corsOptions = {
  origin: [
    "https://homjeeadmin2026.netlify.app",
    "https://websitehomjee2026.netlify.app",
    "https://adminpanelhomjee.netlify.app",
    "https://websitehomjee.netlify.app",
    // Dropped trailing slash — see the note above; the browser's Origin
    // header never has one, so the old entry was a dead match.
    "https://homjeeadminpanel2026.netlify.app",
    "https://homjeeadminpanel122.netlify.app",
    "https://homjee-website.netlify.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "https://cloudflare-workers-autoconfig-homjee-website.ops-nnc.workers.dev",
    "https://homjeeadminpanel.ops-nnc.workers.dev",
  ],
  optionsSuccessStatus: 200,
};

app.use(express.json());
app.use(morgan("dev"));
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use("/public", express.static("public"));

// Lightweight health check (no DB). Point an external uptime monitor
// (UptimeRobot / cron-job.org) at /health every ~10 min to keep the Render
// free instance from spinning down — that cold-start is what makes the
// vendor app's first leads fetch take 30-50s. (app issue #2)
app.get(["/health", "/api/health"], (req, res) => {
  res.status(200).json({ status: "ok", ts: Date.now() });
});

// TEMP diagnostic — reports whether Firebase push is initialized on this
// server, and (with ?vendorId=...) sends a test push to that vendor. Remove
// once push is confirmed working.
app.get("/api/push-status", async (req, res) => {
  try {
    const {
      isPushEnabled,
      sendPushToVendors,
    } = require("./services/pushNotification.service");
    const pushEnabled = isPushEnabled();
    let sent = null;
    if (req.query.vendorId) {
      sent = await sendPushToVendors([String(req.query.vendorId)], {
        title: "Test push ✅",
        body: "Backend → FCM test. If you see this, push works.",
        channelId: "lead-alerts-v2",
        data: { type: "TEST" },
      });
    }
    res.json({ pushEnabled, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// razor pay
app.use("/api/payments", require("./../src/payments/payment.routes"));

// auto cancellation
startAutoCancelWorker();

app.use("/api", routes);

module.exports = app;
