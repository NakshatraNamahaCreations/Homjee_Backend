// routes/quote.routes.js
const router = require("express").Router();
const quoteController = require("../../controllers/measurement/Quote");

router.post("/create-quote", quoteController.createQuote);
router.get("/get-quotes/:id", quoteController.getQuoteById);
router.get(
  "/quotes-list-by-id",
  quoteController.listQuotesByLeadAndMeasurement
);

module.exports = router;
