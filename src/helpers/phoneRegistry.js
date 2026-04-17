// utils/phoneRegistry.js
const PhoneRegistry = require("../models/vendor/PhoneRegistry");

const toPhoneNumber = (v) => {
  // handles "98765 43210", "+91..." etc.
  const s = String(v ?? "").replace(/[^\d]/g, "");
  const no91 = s.startsWith("91") && s.length > 10 ? s.slice(2) : s;
  const last10 = no91.length > 10 ? no91.slice(-10) : no91;
  const n = Number(last10);
  return Number.isFinite(n) ? n : NaN;
};

const assertValidPhone = (n) => {
  // 10 digit check: 1000000000..9999999999
  if (!Number.isFinite(n) || n < 1000000000 || n > 9999999999) {
    const e = new Error("Valid 10-digit mobile number is required");
    e.statusCode = 400;
    throw e;
  }
};

const reservePhone = async ({ phone, ownerType, vendorId, memberId }, session) => {
  try {
    await PhoneRegistry.create(
      [{ phone, ownerType, vendorId, memberId }],
      session ? { session } : undefined
    );
  } catch (err) {
    if (err?.code === 11000) {
      const e = new Error("Mobile number already exists");
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
};

const releasePhone = async ({ phone }, session) => {
  await PhoneRegistry.deleteOne({ phone }, session ? { session } : undefined);
};

const movePhone = async ({ oldPhone, newPhone, ownerType, vendorId, memberId }, session) => {
  await reservePhone({ phone: newPhone, ownerType, vendorId, memberId }, session);
  if (Number.isFinite(oldPhone) && oldPhone !== newPhone) {
    await releasePhone({ phone: oldPhone }, session);
  }
};

module.exports = { toPhoneNumber, assertValidPhone, reservePhone, releasePhone, movePhone };