const { join } = require("path");

/**
 * Render (and most CI hosts) wipe the default ~/.cache/puppeteer between
 * build and runtime. Store the Chromium download inside the project so it
 * is included in the deployed slug.
 */
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
