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
  assert.match(description, /Features/);
  assert.match(description, /Brand: Example/);
  assert.doesNotMatch(description, /\$12\.00/);
  assert.equal((description.match(/Durable/g) || []).length, 1);
});
