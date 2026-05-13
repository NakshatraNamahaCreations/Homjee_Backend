const puppeteer = require("puppeteer");
const cloudinary = require("../config/cloudinary");
const Quote = require("../models/measurement/Quote");
const Measurement = require("../models/measurement/Measurement");
const userBookings = require("../models/user/userBookings");
const { sendWhatsAppDocument } = require("./whatsapp");
const { renderQuoteHtml } = require("./quoteHtml");

const INR = (n) =>
  `Rs. ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const buildQuotePdfBuffer = async (quote, customer, vendor, measurement) => {
  const html = renderQuoteHtml({ quote, customer, vendor, measurement });

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.emulateMediaType("screen");

    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });

    return buffer;
  } finally {
    await browser.close();
  }
};

const uploadPdfBufferToCloudinary = (buffer, publicId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "homjee/quotes",
        public_id: publicId,
        format: "pdf",
        overwrite: true,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
    stream.end(buffer);
  });

const lookupBooking = async (leadId) => {
  if (!leadId) return null;
  try {
    return await userBookings
      .findById(leadId)
      .select("customer assignedProfessional address")
      .lean();
  } catch {
    return null;
  }
};

const lookupMeasurement = async (measurementId) => {
  if (!measurementId) return null;
  try {
    return await Measurement.findById(measurementId).lean();
  } catch {
    return null;
  }
};

const generateAndSendQuotePdf = async (quoteId) => {
  const quote = await Quote.findById(quoteId);
  if (!quote) throw new Error("Quote not found");

  const dryRun = String(process.env.WHATSAPP_DRY_RUN || "").toLowerCase() === "true";

  const booking = await lookupBooking(quote.leadId);
  const customer = booking?.customer || null;
  const vendor = booking?.assignedProfessional || null;
  const measurement = await lookupMeasurement(quote.measurementId);

  if (!dryRun && !customer?.phone) {
    const err = new Error("Customer phone not found for this lead");
    err.code = "NO_PHONE";
    throw err;
  }

  const pdfBuffer = await buildQuotePdfBuffer(quote, customer, vendor, measurement);

  const publicId = `quote_${quote._id}_${Date.now()}`;
  const uploaded = await uploadPdfBufferToCloudinary(pdfBuffer, publicId);
  const pdfUrl = uploaded?.secure_url;
  if (!pdfUrl) throw new Error("Cloudinary upload returned no URL");

  quote.pdfUrl = pdfUrl;
  quote.pdfGeneratedAt = new Date();
  await quote.save();

  if (dryRun) {
    console.log(`[quote-pdf] DRY RUN — WhatsApp send skipped. PDF: ${pdfUrl}`);
    quote.pdfSendError = null;
    await quote.save();
    return { pdfUrl, dryRun: true, sentToCustomerAt: null };
  }

  await sendWhatsAppDocument({
    to: customer.phone,
    link: pdfUrl,
    filename: `Homjee_Quote_${quote.quoteNo || quote._id}.pdf`,
    caption: `Hi ${customer.name || "there"}! Your Homjee painting quote is ready. Total: ${INR(
      quote?.totals?.grandTotal,
    )}.`,
  });

  quote.sentToCustomerAt = new Date();
  quote.pdfSendError = null;
  await quote.save();

  return { pdfUrl, sentToCustomerAt: quote.sentToCustomerAt };
};

module.exports = { generateAndSendQuotePdf, buildQuotePdfBuffer };
