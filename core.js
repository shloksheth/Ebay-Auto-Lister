(function (root, factory) {
  const api = factory();
  root.A2ECore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cleanText(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return (values || []).filter((value) => {
      const cleaned = cleanText(value);
      const key = cleaned.toLowerCase();
      if (!cleaned || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(cleanText);
  }

  function parseMoney(value) {
    const text = String(value || "").replace(/,/g, "");
    const matches = text.match(/\d+(?:\.\d{1,2})?/g);
    if (!matches || !matches.length) return null;
    const number = Number(matches[0]);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  // Markup is applied first, then the result is rounded upward to a price
  // ending in .99. This never undercuts the requested multiplier.
  function calculateEbayPrice(sourcePrice, multiplier) {
    const source = typeof sourcePrice === "number" ? sourcePrice : parseMoney(sourcePrice);
    const factor = Number(multiplier) > 0 ? Number(multiplier) : 1.6;
    if (!source) return null;
    const markedUp = source * factor;
    const whole = Math.floor(markedUp);
    const rounded = markedUp <= whole + 0.99 ? whole + 0.99 : whole + 1.99;
    return rounded.toFixed(2);
  }

  function shortenTitle(title, limit) {
    const max = Number(limit) > 0 ? Number(limit) : 80;
    let text = cleanText(title)
      .replace(/\b(?:Amazon(?:'s)? Choice|Best Seller|Limited Time Deal)\b/gi, "")
      .replace(/[|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length <= max) return text;

    const removable = [
      /\s*[-–—,:]\s*(?:perfect|great|ideal)\s+for\b.*$/i,
      /\s*[-–—,:]\s*(?:a|the)\s+great\b.*$/i,
      /\s*\([^)]*\)\s*$/,
    ];
    for (const pattern of removable) {
      const candidate = text.replace(pattern, "").trim();
      if (candidate.length >= 35) text = candidate;
      if (text.length <= max) return text;
    }

    const words = text.split(" ");
    while (words.length > 1 && words.join(" ").length > max) words.pop();
    return words.join(" ").replace(/[\s,;:./-]+$/, "").slice(0, max).trim();
  }

  function normalizeSpecifics(specifics) {
    const output = {};
    Object.entries(specifics || {}).forEach(([rawKey, rawValue]) => {
      const key = cleanText(rawKey).replace(/:$/, "");
      const value = cleanText(Array.isArray(rawValue) ? rawValue.join(", ") : rawValue);
      if (!key || !value || key.length > 60 || value.length > 250) return;
      if (!output[key]) output[key] = value;
    });
    return output;
  }

  function buildDescription(product) {
    const bullets = uniqueStrings(product.bullets).slice(0, 12);
    const specifics = normalizeSpecifics(product.specifics);
    const lines = [];

    if (product.aiDescription) lines.push(cleanText(product.aiDescription));
    else {
      if (product.title) lines.push(shortenTitle(product.title, 140));
      if (product.description) lines.push("", cleanText(product.description).slice(0, 3000));
      if (bullets.length) {
        lines.push("", "Features");
        bullets.forEach((bullet) => lines.push(`• ${bullet}`));
      }
    }

    const entries = Object.entries(specifics).slice(0, 20);
    if (entries.length) {
      lines.push("", "Item specifics");
      entries.forEach(([key, value]) => lines.push(`${key}: ${value}`));
    }

    // Keep the description clean and editable. Source price, scripts, and
    // copied HTML are intentionally excluded.
    return uniqueConsecutiveLines(lines).join("\n").trim().slice(0, 10000);
  }

  function uniqueConsecutiveLines(lines) {
    const output = [];
    for (const raw of lines) {
      const line = cleanText(raw);
      if (!line) {
        if (output.length && output[output.length - 1] !== "") output.push("");
      } else if (line !== output[output.length - 1]) {
        output.push(line);
      }
    }
    while (output[output.length - 1] === "") output.pop();
    return output;
  }

  function amazonImageKey(url) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/images\/I\/([^._/]+)/i);
      return match ? `amazon:${match[1].toLowerCase()}` : `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch (_) {
      return String(url || "").split(/[?#]/)[0].toLowerCase();
    }
  }

  function canonicalAmazonImage(url) {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      parsed.pathname = parsed.pathname.replace(/\._[^/]*_(?=\.[a-z0-9]+$)/i, "");
      return parsed.toString();
    } catch (_) {
      return String(url || "").split(/[?#]/)[0].replace(/\._[^/]*_(?=\.[a-z0-9]+$)/i, "");
    }
  }

  function dedupeImageCandidates(candidates, keyFn, limit) {
    const best = new Map();
    for (const candidate of candidates || []) {
      const url = typeof candidate === "string" ? candidate : candidate.url;
      if (!url || !/^https?:/i.test(url)) continue;
      const score = typeof candidate === "string" ? 0 : Number(candidate.score) || 0;
      const key = (keyFn || ((item) => item.split(/[?#]/)[0].toLowerCase()))(url);
      const previous = best.get(key);
      if (!previous || score > previous.score) best.set(key, { url, score });
    }
    return Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, limit || 12).map((item) => item.url);
  }

  return {
    amazonImageKey,
    buildDescription,
    calculateEbayPrice,
    canonicalAmazonImage,
    cleanText,
    dedupeImageCandidates,
    normalizeSpecifics,
    parseMoney,
    shortenTitle,
    uniqueStrings,
  };
});
