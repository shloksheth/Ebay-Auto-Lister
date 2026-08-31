const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ebay = fs.readFileSync(path.join(root, "ebay-content.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const manifest = fs.readFileSync(path.join(root, "manifest.json"), "utf8");

test("photo batch is dispatched exactly once and never through input plus change", () => {
  assert.equal((ebay.match(/input\.dispatchEvent\(new Event\("change"/g) || []).length, 1);
  assert.equal((ebay.match(/input\.dispatchEvent\(new Event\("input"/g) || []).length, 0);
  assert.match(ebay, /state\.uploadAttempted/);
  assert.match(ebay, /Edit or view photo/);
});

test("new listing opens at eBay pre-list instead of the selling landing page", () => {
  assert.match(background, /\/sl\/prelist\/suggest\?a2e=/);
  assert.doesNotMatch(background, /\/sl\/sell\?a2e=/);
});

test("catalog search can continue when eBay has no matching product", () => {
  assert.match(ebay, /function continueWithoutMatch/);
  assert.match(ebay, /continue without \(\?:a \)\?match/);
  assert.match(ebay, /create listing without/);
});

test("current eBay item-specific names and landing actions are supported", () => {
  assert.match(ebay, /attributes\.\$\{wanted\}/);
  assert.match(ebay, /list an item/);
  assert.match(ebay, /rankConditionOptions/);
  assert.match(ebay, /input\[type="radio"\]/);
  assert.match(ebay, /continue to listing/);
  assert.match(ebay, /menuitemradio/);
  assert.match(ebay, /apply all/);
  assert.match(ebay, /source-backed item specifics/);
});

test("Chrome on-device AI generates listings without eBay AI or an API key", () => {
  assert.match(background, /globalThis\.LanguageModel/);
  assert.match(background, /LanguageModel\.create/);
  assert.match(background, /Chrome Gemini Nano \(on-device\)/);
  assert.match(background, /useLocalAi: true/);
  assert.doesNotMatch(ebay, /use ai description/i);
  assert.doesNotMatch(manifest, /api\.openai\.com/);
});

test("specifics are delayed and bounded, description is seeded once, and quantity is 11", () => {
  assert.match(ebay, /4000 - \(Date\.now\(\) - state\.formDetectedAt\)/);
  assert.match(ebay, /specificAttempts\.get\(entry\.key\).*< 2/);
  assert.match(ebay, /state\.descriptionSeeded/);
  assert.match(background, /quantity: 11/);
});
