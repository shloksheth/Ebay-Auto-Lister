const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ebay = fs.readFileSync(path.join(root, "ebay-content.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const manifest = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bulk = fs.readFileSync(path.join(root, "bulk.js"), "utf8");

test("main photo batch is dispatched once while variation photos use their own one-shot path", () => {
  assert.equal((ebay.match(/input\.dispatchEvent\(new Event\("change"/g) || []).length, 2);
  assert.equal((ebay.match(/function uploadOneVariationPhoto/g) || []).length, 1);
  assert.equal((ebay.match(/input\.dispatchEvent\(new Event\("input"/g) || []).length, 0);
  assert.match(ebay, /state\.uploadAttempted/);
  assert.match(ebay, /Edit or view photo/);
  assert.match(ebay, /currentCount > 0/);
  assert.match(background, /visualFingerprint/);
  assert.match(background, /fingerprintDistance/);
});

test("new listing opens at eBay pre-list instead of the selling landing page", () => {
  assert.match(background, /\/sl\/prelist\/suggest\?a2e=/);
  assert.doesNotMatch(background, /\/sl\/sell\?a2e=/);
});

test("catalog search can continue when eBay has no matching product", () => {
  assert.match(ebay, /function continueWithoutMatch/);
  assert.match(ebay, /continue without \(\?:a \)\?match/);
  assert.match(ebay, /create listing without/);
  assert.match(ebay, /Always build from verified source facts/);
  assert.doesNotMatch(ebay, /best\.button\.click/);
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
  assert.match(background, /Chrome Gemini Nano \(two-pass on-device AI\)/);
  assert.match(background, /useLocalAi: true/);
  assert.doesNotMatch(ebay, /use ai description/i);
  assert.doesNotMatch(manifest, /api\.openai\.com/);
  assert.match(background, /Audit the previous JSON/);
  assert.match(ebay, /data-a2e-description-images/);
});

test("specifics are delayed and bounded, description is seeded once, and quantity is 11", () => {
  assert.match(ebay, /4000 - \(Date\.now\(\) - state\.formDetectedAt\)/);
  assert.match(ebay, /specificAttempts\.get\(entry\.key\).*< 3/);
  assert.match(ebay, /state\.descriptionSeeded/);
  assert.match(ebay, /function htmlCodeToggle/);
  assert.match(ebay, /await fillDescription/);
  assert.match(background, /quantity: 11/);
});

test("listing automation is scoped to one tab and cannot alter revise pages", () => {
  assert.match(background, /targetTabId/);
  assert.match(background, /listing\.targetTabId === senderTabId/);
  assert.match(background, /isRevisionUrl/);
  assert.match(ebay, /function isRevisionPage/);
  assert.match(ebay, /CANCEL_LISTING_AUTOMATION/);
  assert.match(ebay, /clearInterval\(state\.intervalId\)/);
});

test("bulk dashboard imports product links, discovers variants, and selects products", () => {
  assert.match(manifest, /"tabs"/);
  assert.match(background, /EXTRACT_PRODUCT_URL/);
  assert.match(background, /active: false/);
  assert.match(content, /function amazonVariants/);
  assert.match(content, /EXTRACT_PRODUCT/);
  assert.match(bulk, /Import complete/);
  assert.match(bulk, /PREPARE_EBAY_LISTING/);
  assert.match(bulk, /processed < 150/);
});

test("Amazon variants become one eBay variation listing with prices and photos", () => {
  assert.match(content, /variantAttributes/);
  assert.match(content, /inline-twister-row-/);
  assert.match(content, /sourcePrice: sourcePrice/);
  assert.match(content, /primaryImage/);
  assert.match(content, /const balanced = \[\]/);
  assert.match(content, /groups\.values\(\)/);
  assert.match(background, /expandAmazonVariants/);
  assert.match(background, /enqueue\(extracted\.variants\)/);
  assert.match(background, /queued\.size >= 40/);
  assert.match(background, /prepareVariationListing/);
  assert.match(background, /PREPARE_EBAY_VARIATION_LISTING/);
  assert.match(bulk, /Opened as \$\{response\.variationCount\}-variation listing/);
  assert.match(ebay, /function fillVariations/);
  assert.match(ebay, /edit\|create\|add\|manage/);
  assert.match(ebay, /variation\.price/);
  assert.match(ebay, /variation\.quantity \|\| 11/);
  assert.match(ebay, /uploadOneVariationPhoto/);
  assert.match(ebay, /save and close/);
  assert.match(ebay, /getAttribute\("aria-label"\)/);
});
