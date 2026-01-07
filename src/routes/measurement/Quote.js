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
router.get("/get-finalized-quote/leadId/:id", quoteController.getFinalizedQuoteByLeadId);

router.post(
  "/quotes-room-price/:quoteId/rooms/:roomName/pricing",
  quoteController.upsertQuoteRoomPricing
);
router.delete(
  "/clear-room-services/:quoteId/clear",
  quoteController.clearQuoteServices
);

router.post(
  "/add-finishing-paints/:quoteId/rooms/:roomName/additional-services",
  quoteController.upsertQuoteAdditionalServices
);
router.delete(
  "/delete-quote/:quoteId/empty-draft",
  quoteController.deleteIfEmptyDraft
);
router.delete(
  "/delete-finishing-paints/:quoteId/rooms/:roomName/additional-services",
  quoteController.removeAdditionalService
);

router.patch("/update-quote/:quoteId", quoteController.updateQuoteMeta);

module.exports = router;
