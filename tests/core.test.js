const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

test("price markup rounds upward to a .99 ending", () => {
  assert.equal(Core.calculateEbayPrice("$10.00", 1.6), "16.99");
  assert.equal(Core.calculateEbayPrice("$10.75", 1.6), "17.99");
  assert.equal(Core.calculateEbayPrice("US $1,249.50", 1.6), "1999.99");
});

test("fallback title respects eBay's limit without splitting a word", () => {
  const title = "Example Brand Professional Wireless Rechargeable Product With Accessories for Home Office Travel";
  const shortened = Core.shortenTitle(title, 80);
  assert.ok(shortened.length <= 80);
  assert.ok(!shortened.endsWith(" "));
  assert.ok(title.startsWith(shortened));
});

test("Amazon URL variants collapse to the same product photo", () => {
  const thumbnail = "https://m.media-amazon.com/images/I/ABC123._AC_SX90_.jpg";
  const large = "https://images-na.ssl-images-amazon.com/images/I/ABC123._AC_SL1500_.jpg";
  assert.equal(Core.amazonImageKey(thumbnail), Core.amazonImageKey(large));
  const selected = Core.dedupeImageCandidates([{ url: thumbnail, score: 100 }, { url: large, score: 1000 }], Core.amazonImageKey, 12);
  assert.deepEqual(selected, [large]);
});

test("description is plain, fact-based, and excludes source price", () => {
  const description = Core.buildDescription({
    title: "Example Product",
    priceText: "$12.00",
    description: "A useful product.",
    bullets: ["Durable", "Durable", "Compact"],
    specifics: { Brand: "Example", Height: "4 in" },
  });
  assert.match(description, /Key Features/);
  assert.match(description, /Brand: Example/);
  assert.doesNotMatch(description, /\$12\.00/);
  assert.equal((description.match(/Durable/g) || []).length, 1);
});

test("premium description is concise, formatted, and removes Amazon checkout claims", () => {
  const description = Core.buildPremiumDescription({
    title: "OURA Ring 5 Sizing Kit",
    description: "Find the ideal fit before purchasing. An Amazon credit will automatically be applied at checkout. Sizes differ from standard rings.",
    bullets: ["SIZE BEFORE YOU BUY; Test your fit before choosing a ring", "AVAILABLE SIZES; Sizes 6-13 with no half sizes"],
    specifics: { Brand: "OURA", Color: "Sizing Kit" },
  });
  assert.match(description, /^OURA Ring 5 Sizing Kit\n\nOverview/m);
  assert.match(description, /Key Features/);
  assert.match(description, /Specifications/);
  assert.doesNotMatch(description, /Amazon|checkout|PRODUCT OVERVIEW|Please review all photos/i);
});

test("description removes promotional boilerplate and buyer-directed filler", () => {
  const description = Core.buildPremiumDescription({
    title: "Example Watch",
    description: "Please review all photos before purchase. Colors may vary by screen. Stainless steel construction provides everyday durability.",
    bullets: ["Best Seller. Customers also bought this item", "Water resistant stainless steel case"],
    specifics: { Brand: "Example" },
  });
  assert.doesNotMatch(description, /Please review|Colors may vary|Best Seller|Customers also bought/i);
  assert.match(description, /stainless steel/i);
});

test("on-device AI overview and features replace noisy marketplace copy", () => {
  const description = Core.buildPremiumDescription({
    title: "Example Stainless Steel Watch",
    description: "BUY NOW AMAZON DEAL random marketplace filler",
    bullets: ["Customers also bought unrelated products"],
    aiOverview: "A refined stainless steel watch designed for dependable everyday timekeeping.",
    aiFeatures: ["Durable stainless steel construction", "Clear, easy-to-read dial"],
    specifics: { Brand: "Example", Material: "Stainless Steel" },
  });
  assert.match(description, /refined stainless steel watch/i);
  assert.match(description, /Clear, easy-to-read dial/);
  assert.doesNotMatch(description, /BUY NOW|Customers also bought|Amazon/i);
});

test("condition ranking prefers new with box and papers, then the top newest option", () => {
  assert.equal(Core.rankConditionOptions(["Used", "New", "New with box and papers"]), "New with box and papers");
  assert.equal(Core.rankConditionOptions(["New", "New with tags", "New with box and papers", "Pre-owned"]), "New with box and papers");
  assert.equal(Core.rankConditionOptions(["Used", "Brand New", "New"]), "Brand New");
  assert.equal(Core.rankConditionOptions(["Used", "Open box"]), "Open box");
  assert.equal(Core.rankConditionOptions(["Used - Excellent", "Used - Good"]), "Used - Excellent");
});

test("Amazon A+ CSS and JavaScript never enter the listing description", () => {
  const contaminated = `.aplus-v2 .aplus-content-wrapper { position: relative; overflow: hidden; }
    function logShoppableMetrics(moduleName) { window.ue.count(moduleName); }
    Product description A comfortable wireless mouse for everyday work.`;
  const cleaned = Core.sanitizeProductText(contaminated);
  assert.doesNotMatch(cleaned, /aplus|position:|function|window\.ue/i);
  assert.match(cleaned, /comfortable wireless mouse/i);
});

test("local premium generator creates an informative mouse title without an API key", () => {
  const product = {
    title: "Woddlffy Ergonomic Mouse, Vertical Ergonomic Wireless Computer Mouse Purple with Silent Click",
    bullets: ["6 Buttons with adjustable 1000/1200/1600 DPI"],
    specifics: { Brand: "Woddlffy", Color: "Purple" },
  };
  const title = Core.createPremiumTitle(product, 80);
  assert.equal(title, "Woddlffy Wireless Vertical Ergonomic Mouse Purple 1600 DPI 6-Button Silent Click");
  assert.ok(title.length <= 80);
});

test("a desktop PC bundle containing a keyboard and mouse remains a PC listing", () => {
  const source = "HP RGB Gaming Desktop PC Computer Tower with Keyboard and Mouse";
  const title = Core.createPremiumTitle({ title: source, specifics: { Brand: "HP" } }, 80);
  assert.match(title, /\b(?:Desktop|PC|Computer)\b/i);
  assert.doesNotMatch(title, /^HP Mouse$/i);
  assert.equal(Core.productKind(source), "desktop computer");
  assert.equal(Core.titlePreservesProductIdentity(source, "HP Wireless Mouse"), false);
  assert.equal(Core.titlePreservesProductIdentity(source, "HP Gaming Desktop PC Bundle"), true);
  assert.equal(Core.titlePreservesProductIdentity(source, "Generic Gaming Desktop PC", { Brand: "HP" }), false);
  assert.doesNotMatch(Core.createPremiumTitle({ title: `${source} Intel Core i7 16GB RAM 1TB SSD with Keyboard and Mouse`, specifics: { Brand: "HP" } }, 80), /\bwith$/i);
});

test("product dimensions are converted into eBay item-specific fields", () => {
  const specifics = Core.deriveEbaySpecifics({
    Brand: "Example",
    "Product Dimensions": "4.2 x 2.9 x 3.1 inches",
  }, { title: "Example Product" });
  assert.equal(specifics["Item Length"], "4.2 in");
  assert.equal(specifics["Item Width"], "2.9 in");
  assert.equal(specifics["Item Height"], "3.1 in");
  assert.equal(specifics["Unit Quantity"], "1");
});

test("missing brands use eBay's accepted Unbranded value", () => {
  const specifics = Core.deriveEbaySpecifics({}, { title: "Rechargeable Desk Lamp" });
  assert.equal(specifics.Brand, "Unbranded");
});

test("final title stays source-backed and targets 75-80 characters when facts allow", () => {
  const source = "AULA Gaming Desktop PC Computer Tower Intel Core i7 16GB RAM 1TB SSD RGB Keyboard and Mouse Bundle";
  const title = Core.finalizeEbayTitle(source, "AULA Powerful Gaming Computer", { Brand: "AULA", Type: "Desktop Computer" }, 75, 80);
  assert.ok(title.length >= 75 && title.length <= 80, `${title.length}: ${title}`);
  assert.equal(Core.titlePreservesProductIdentity(source, title, { Brand: "AULA" }), true);
  assert.match(title, /Desktop|PC|Computer/i);
});
