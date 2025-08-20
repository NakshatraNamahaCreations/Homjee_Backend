// routes/quote.routes.js
const router = require("express").Router();
const quoteController = require("../../controllers/measurement/Quote");

router.post("/create-quote", quoteController.createQuote);
router.get("/get-quotes/:id", quoteController.getQuoteById);
router.get(
  "/quotes-list-by-id",
  quoteController.listQuotesByLeadAndMeasurement
);
router.post("/create-duplicate/:id/duplicate", quoteController.cloneQuoteFrom);
router.patch("/quote/:id/finalize", quoteController.finalizeQuote);
router.post(
  "/quotes/:quoteId/rooms/:roomName/pricing",
  quoteController.upsertQuoteRoomPricing
);
router.patch("/update-quote/:quoteId", quoteController.updateQuoteMeta);

module.exports = router;
