import axios from "axios";

export const sendWhatsAppText = async ({ to, body }) => {
    try {
        const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

        const payload = {
            messaging_product: "whatsapp",
            to, // "9198xxxxxxx"
            type: "text",
            text: { body },
        };

        const resp = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        return resp.data;
    } catch (err) {
        console.error("sendWhatsAppText error:", err?.response?.data || err.message);
        throw new Error(err?.response?.data?.error?.message || "WhatsApp send failed");
    }
};