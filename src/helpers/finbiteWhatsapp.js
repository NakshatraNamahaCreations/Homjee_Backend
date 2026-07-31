// Finbite WhatsApp Business API — OTP sender.
//
// Docs: POST {FINBITE_BASE_URL}/messages  with an Authentication template.
// Exact body shape confirmed from Finbite's "OTP Authentication Template"
// endpoint:
//   {
//     "to": "919595951304",
//     "phoneNoId": "<sender phone number id>",
//     "type": "template",
//     "name": "homjee_login_otp",
//     "language": "en",
//     "bodyParams": ["<otp>"],
//     "buttons": [{ "type": "button", "sub_type": "url", "text": "<otp>" }]
//   }
// The OTP goes in BOTH bodyParams (the message text) and the copy-code button
// (WhatsApp models the auth copy-code button as a url sub_type).
//
// Config via env (mirrors the Render dashboard):
//   FINBITE_API_KEY, FINBITE_BASE_URL, FINBITE_PHONE_ID,
//   FINBITE_OTP_TEMPLATE, FINBITE_OTP_LANG
//
// SAFE BY DEFAULT: if not configured or the send fails, it logs and returns
// { sent:false } instead of throwing — OTP generation is never blocked by a
// WhatsApp hiccup (the code is still saved and can be verified).

const axios = require("axios");

// Normalise to country-code digits. 10-digit numbers get India's 91 prefix.
const toWhatsAppNumber = (mobile) => {
  let d = String(mobile || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  return d;
};

async function sendWhatsAppOtp(mobile, otp) {
  const {
    FINBITE_API_KEY,
    FINBITE_BASE_URL,
    FINBITE_PHONE_ID,
    FINBITE_OTP_TEMPLATE = "homjee_login_otp",
    FINBITE_OTP_LANG = "en",
  } = process.env;

  if (!FINBITE_API_KEY || !FINBITE_BASE_URL || !FINBITE_PHONE_ID) {
    console.warn("[finbite] WhatsApp OTP not configured — send skipped.");
    return { sent: false, reason: "not_configured" };
  }

  const code = String(otp);
  const payload = {
    to: toWhatsAppNumber(mobile),
    phoneNoId: FINBITE_PHONE_ID,
    type: "template",
    name: FINBITE_OTP_TEMPLATE,
    language: FINBITE_OTP_LANG,
    bodyParams: [code],
    buttons: [{ type: "button", sub_type: "url", text: code }],
  };

  try {
    const url = `${FINBITE_BASE_URL.replace(/\/$/, "")}/messages`;
    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${FINBITE_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    return { sent: true, data: resp.data };
  } catch (err) {
    console.error(
      "[finbite] WhatsApp OTP send failed:",
      err?.response?.data || err.message,
    );
    return {
      sent: false,
      reason: "send_failed",
      error: err?.response?.data || err.message,
    };
  }
}

module.exports = { sendWhatsAppOtp };
