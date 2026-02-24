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

console.log("Razorpay key present:", !!process.env.RAZORPAY_KEY_ID);

app.use(express.json());
app.use(morgan("dev"));
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use("/public", express.static("public"));

// razor pay
app.use("/api/payments", require("./../src/payments/payment.routes"));

// auto cancellation
startAutoCancelWorker();

app.use("/api", routes);

module.exports = app;
