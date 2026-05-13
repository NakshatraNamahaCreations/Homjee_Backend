const axios = require("axios");

const WA_URL = () =>
  `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

const authHeaders = () => ({
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  "Content-Type": "application/json",
});

const normalizeTo = (to) => String(to || "").replace(/\D/g, "");

const sendWhatsAppText = async ({ to, body }) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: normalizeTo(to),
      type: "text",
      text: { body },
    };

    const resp = await axios.post(WA_URL(), payload, { headers: authHeaders() });
    return resp.data;
  } catch (err) {
    console.error("sendWhatsAppText error:", err?.response?.data || err.message);
    throw new Error(err?.response?.data?.error?.message || "WhatsApp send failed");
  }
};

const sendWhatsAppDocument = async ({ to, link, filename, caption }) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: normalizeTo(to),
      type: "document",
      document: {
        link,
        filename: filename || "document.pdf",
        ...(caption ? { caption } : {}),
      },
    };

    const resp = await axios.post(WA_URL(), payload, { headers: authHeaders() });
    return resp.data;
  } catch (err) {
    console.error("sendWhatsAppDocument error:", err?.response?.data || err.message);
    throw new Error(err?.response?.data?.error?.message || "WhatsApp document send failed");
  }
};

module.exports = { sendWhatsAppText, sendWhatsAppDocument };
