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
    "http://localhost:5173",
    "http://localhost:5174",
  ],
  optionsSuccessStatus: 200,
};

app.use(express.json());
app.use(morgan("dev"));
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use("/public", express.static("public"));

// razor pay
app.use("/api/payments", require("./../src/payments/payment.routes"));

// auto cancellation
startAutoCancelWorker();

app.use("/api", routes);

module.exports = app;
