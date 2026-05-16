// Backend port of Homjee-website-main/src/utils/serviceCity.js.
// Canonical service cities + the locality / district / municipal-corporation
// strings that should be treated as that city. Keep this in sync with the
// website copy when a new city is onboarded.
//
// Used by the slot pipeline so a customer in "Pimpri-Chinchwad" and a vendor
// registered under "Pune" are matched as the same service market — the city
// param and vendor.city strings are otherwise free text and never reconciled.

const SERVICE_CITIES = {
  Bengaluru: [
    "bangalore",
    "bengaluru",
    "bangalore urban",
    "bengaluru urban",
    "bangalore rural",
    "bengaluru rural",
  ],
  Pune: [
    "pune",
    "pune urban",
    "pune rural",
    "pimpri",
    "chinchwad",
    "pimpri-chinchwad",
    "pimpri chinchwad",
    // Pune IT suburb. Google sometimes returns "Hinjawadi"/"Hinjewadi"
    // as the locality without a "Pune" sibling component, so the
    // pickServiceCityFromComponents scanner can't snap to Pune on its
    // own. Listed as an alias here so vendors registered under "Pune"
    // still match customers here.
    "hinjawadi",
    "hinjewadi",
  ],
  Mumbai: ["mumbai", "bombay", "mumbai suburban", "mumbai city"],
  Delhi: [
    "delhi",
    "new delhi",
    "central delhi",
    "north delhi",
    "south delhi",
    "east delhi",
    "west delhi",
    "north-east delhi",
    "north east delhi",
    "north-west delhi",
    "north west delhi",
    "south-east delhi",
    "south east delhi",
    "south-west delhi",
    "south west delhi",
    "shahdara",
  ],
  Hyderabad: ["hyderabad", "secunderabad"],
  Chennai: ["chennai", "madras"],
  Kolkata: ["kolkata", "calcutta"],
  Ahmedabad: ["ahmedabad"],
  Jaipur: ["jaipur"],
  Lucknow: ["lucknow"],
};

// Reverse-lookup map: lowercase alias -> canonical city.
const ALIAS_TO_CANONICAL = (() => {
  const out = {};
  for (const [canonical, aliases] of Object.entries(SERVICE_CITIES)) {
    out[canonical.toLowerCase()] = canonical;
    for (const a of aliases) out[String(a).trim().toLowerCase()] = canonical;
  }
  return out;
})();

function escapeRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Raw city string -> canonical service city. Falls back to the trimmed input
// when no alias matches, so cities we haven't onboarded are not dropped.
function canonicalizeCity(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  return ALIAS_TO_CANONICAL[trimmed.toLowerCase()] || trimmed;
}

// Every alias (incl. the canonical name) for whatever city `raw` resolves to.
// For an unknown city, returns just the trimmed input.
function getCityAliases(raw) {
  const canonical = canonicalizeCity(raw);
  if (!canonical) return [];
  const aliases = SERVICE_CITIES[canonical];
  return aliases ? [canonical, ...aliases] : [canonical];
}

// Case-insensitive regex matching any alias of the city `raw` resolves to.
// Used for the vendor-pool query so vendors stored under any alias ("Pune",
// "Pimpri-Chinchwad", ...) match a customer anywhere in the same metro.
function buildCityMatchRegex(raw) {
  const aliases = getCityAliases(raw);
  if (!aliases.length) return null;
  return new RegExp(aliases.map(escapeRegex).join("|"), "i");
}

module.exports = {
  SERVICE_CITIES,
  canonicalizeCity,
  getCityAliases,
  buildCityMatchRegex,
};
