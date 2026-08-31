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

  function sanitizeProductText(value) {
    let text = String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(?:^|\s)[.#][a-z][\w-]*(?:\s+[.#]?[a-z][\w-]*)*\s*\{[^{}]*\}/gi, " ")
      .replace(/\bfunction\s+[a-z_$][\w$]*\s*\([^)]*\)\s*\{[^{}]*\}/gi, " ")
      .replace(/\b(?:position|overflow|display|width|height|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|background(?:-[a-z]+)?|word-(?:break|wrap)|border(?:-[a-z]+)?|text-align|float)\s*:\s*[^;{}]+;?/gi, " ")
      .replace(/[{};]/g, " ");
    text = cleanText(text);
    const cssSignals = (text.match(/\b(?:aplus-v\d|module-wrapper|background-image|margin-left|addtocart|window\.ue)\b/gi) || []).length;
    if (cssSignals >= 3) {
      const anchors = ["Product description", "Features", "About this item"];
      const positions = anchors.map((anchor) => text.toLowerCase().lastIndexOf(anchor.toLowerCase())).filter((position) => position >= 0);
      if (positions.length) text = text.slice(Math.max(...positions));
      else return "";
    }
    return cleanText(text).slice(0, 5000);
  }

  function findSpecific(specifics, aliases) {
    const entries = Object.entries(specifics || {});
    for (const alias of aliases) {
      const wanted = alias.toLowerCase();
      const exact = entries.find(([key]) => cleanText(key).toLowerCase() === wanted);
      if (exact && cleanText(exact[1])) return cleanText(exact[1]);
    }
    return "";
  }

  function deriveEbaySpecifics(rawSpecifics, product) {
    const raw = normalizeSpecifics(rawSpecifics);
    const output = { ...raw };
    const set = (key, value) => {
      const cleaned = cleanText(value);
      if (cleaned && !output[key]) output[key] = cleaned;
    };

    set("Brand", findSpecific(raw, ["Brand", "Brand Name"]));
    set("Model", findSpecific(raw, ["Model", "Model Name", "Item model number"]));
    set("MPN", findSpecific(raw, ["MPN", "Manufacturer Part Number", "Part Number"]));
    set("Color", findSpecific(raw, ["Color", "Colour"]));
    set("Material", findSpecific(raw, ["Material", "Material Type"]));
    set("Size", findSpecific(raw, ["Size", "Product Size"]));
    set("Country of Origin", findSpecific(raw, ["Country of Origin", "Country/Region of Manufacture"]));
    set("Connectivity", findSpecific(raw, ["Connectivity", "Connectivity Technology"]));
    set("Features", findSpecific(raw, ["Features", "Special Feature", "Special Features"]));
    set("Type", findSpecific(raw, ["Type", "Item Type Name", "Product Type"]));

    const searchable = cleanText([product?.title, product?.description, ...(product?.bullets || [])].join(" "));
    const dimensionsEntry = Object.entries(raw).find(([key, value]) => !/package/i.test(key) && /(?:product|item)?\s*dimensions?/i.test(key) && /\d\s*[x×]\s*\d/i.test(value));
    if (dimensionsEntry) {
      const match = dimensionsEntry[1].match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(inches?|in\.?|cm|mm)?/i);
      if (match) {
        const unit = /cm|mm/i.test(match[4] || "") ? match[4].toLowerCase() : "in";
        set("Item Length", `${match[1]} ${unit}`);
        set("Item Width", `${match[2]} ${unit}`);
        set("Item Height", `${match[3]} ${unit}`);
      }
    }

    const dpiValues = Array.from(searchable.matchAll(/\b(\d{3,5})\s*dpi\b/gi)).map((match) => Number(match[1])).filter(Number.isFinite);
    if (dpiValues.length) set("Maximum DPI", String(Math.max(...dpiValues)));
    const buttonMatch = searchable.match(/\b(\d{1,2})\s*(?:programmable\s*)?buttons?\b/i);
    if (buttonMatch) set("Number of Buttons", buttonMatch[1]);
    if (!output.Connectivity) {
      const connections = [];
      if (/\bbluetooth\b/i.test(searchable)) connections.push("Bluetooth");
      if (/\b(?:2\.4\s*g(?:hz)?|wireless)\b/i.test(searchable)) connections.push("Wireless");
      if (/\busb\b/i.test(searchable)) connections.push("USB");
      set("Connectivity", connections.join(", "));
    }
    if (/\bcharger included\b|\bincludes? (?:a )?(?:usb )?(?:charging cable|charger)\b/i.test(searchable)) set("Charger Included", "Yes");
    else if (/\bcharger not included\b|\bdoes not include (?:a )?charger\b/i.test(searchable)) set("Charger Included", "No");

    set("Unit Quantity", "1");
    set("Unit Type", "Unit");
    return normalizeSpecifics(output);
  }

  function cleanFeature(value) {
    let text = marketplaceSafeText(value)
      .replace(/^[•\-*\s]+/, "")
      .replace(/^([A-Z][A-Z\s/&-]{2,45})[;:]\s*(?=\S)/, (_, label) => `${label.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}: `)
      .replace(/\s+[–—-]\s+|\s*\|\s*/g, ". ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\bMouses\b/gi, "Mice")
      .replace(/\bMacox\b/gi, "macOS")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 190) text = shortenTitle(text, 190).replace(/[,:;.-]+$/, "");
    return text;
  }

  function marketplaceSafeText(value) {
    const text = sanitizeProductText(value)
      .replace(/\b(?:Amazon|Prime)\b[^.!?]*(?:[.!?]|$)/gi, " ")
      .replace(/[^.!?]*\b(?:credit (?:will )?automatically|at checkout|source price|seller)\b[^.!?]*(?:[.!?]|$)/gi, " ")
      .replace(/\bPlease review all photos[^.!?]*(?:[.!?]|$)/gi, " ")
      .replace(/\bColors? may vary[^.!?]*(?:[.!?]|$)/gi, " ")
      .replace(/\b(?:limited time deal|best seller|customers also bought)\b[^.!?]*(?:[.!?]|$)/gi, " ");
    return cleanText(text);
  }

  function conciseOverview(value, title) {
    const clean = marketplaceSafeText(value)
      .replace(/\bPRODUCT (?:OVERVIEW|DESCRIPTION)\b/gi, " ")
      .replace(/\bKEY FEATURES\b[\s\S]*$/i, " ");
    const sentences = clean.match(/[^.!?]+[.!?]?/g) || [];
    const selected = [];
    for (const sentence of sentences) {
      const candidate = cleanText(sentence);
      if (candidate.length < 20 || /\b(?:buy|purchase|checkout|shipping|we|our|you|your)\b/i.test(candidate)) continue;
      selected.push(candidate.replace(/[,:;\s]+$/, "") + (/[.!?]$/.test(candidate) ? "" : "."));
      if (selected.length === 2 || selected.join(" ").length >= 360) break;
    }
    return cleanText(selected.join(" ")).slice(0, 420) || `A clear, practical overview of the ${title}, with verified features and specifications listed below.`;
  }

  function createPremiumTitle(product, limit) {
    const max = Number(limit) > 0 ? Number(limit) : 80;
    const specifics = deriveEbaySpecifics(product?.specifics, product);
    const original = sanitizeProductText(product?.title)
      .replace(/[【】]/g, " ")
      .replace(/\s*\|\s*/g, ", ")
      .replace(/\bMouses\b/gi, "Mouse");
    const brand = specifics.Brand || "";

    if (/\bmouse\b/i.test(original)) {
      const parts = [brand];
      if (/\bwireless\b/i.test(original)) parts.push("Wireless");
      if (/\bvertical\b/i.test(original)) parts.push("Vertical");
      if (/\bergonomic\b/i.test(original)) parts.push("Ergonomic");
      parts.push("Mouse");
      if (specifics.Color) parts.push(specifics.Color);
      if (specifics["Maximum DPI"]) parts.push(`${specifics["Maximum DPI"]} DPI`);
      if (specifics["Number of Buttons"]) parts.push(`${specifics["Number of Buttons"]}-Button`);
      if (/\bsilent(?: click)?\b/i.test(original)) parts.push("Silent Click");
      const unique = [];
      const seen = new Set();
      for (const part of parts) {
        const key = cleanText(part).toLowerCase();
        if (key && !seen.has(key)) { seen.add(key); unique.push(cleanText(part)); }
      }
      return shortenTitle(unique.join(" "), max);
    }

    let base = original
      .replace(/\b(?:perfect|ideal|great) for\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const additions = [specifics.Model, specifics.Color, specifics.Size].filter((value) => value && !base.toLowerCase().includes(value.toLowerCase()));
    if (brand && !base.toLowerCase().startsWith(brand.toLowerCase())) base = `${brand} ${base}`;
    return shortenTitle([base, ...additions].join(" "), max);
  }

  function buildPremiumDescription(product) {
    const title = createPremiumTitle(product, 80);
    const specifics = deriveEbaySpecifics(product?.specifics, product);
    const description = marketplaceSafeText(product?.aiOverview || product?.aiDescription || product?.description);
    const sourceBullets = Array.isArray(product?.aiFeatures) && product.aiFeatures.length ? product.aiFeatures : product?.bullets || [];
    const bullets = uniqueStrings(sourceBullets.map(cleanFeature))
      .filter((value) => value.length >= 4 && !/\b(?:Amazon|Prime|checkout|credit|please review|colors? may vary)\b/i.test(value))
      .slice(0, 5);
    const lines = [title, "", "Overview", conciseOverview(description, title)];

    if (bullets.length) {
      lines.push("", "Key Features");
      bullets.forEach((bullet) => lines.push(`• ${bullet}`));
    }

    const preferred = ["Brand", "Model", "Type", "Color", "Material", "Size", "Connectivity", "Features", "Maximum DPI", "Number of Buttons", "Item Length", "Item Width", "Item Height", "Country of Origin", "MPN", "Unit Quantity", "Unit Type"];
    const details = preferred.filter((key) => specifics[key]).map((key) => [key, specifics[key]]);
    if (details.length) {
      lines.push("", "Specifications");
      details.forEach(([key, value]) => lines.push(`• ${key}: ${value}`));
    }
    return uniqueConsecutiveLines(lines).join("\n").trim().slice(0, 8000);
  }

  function rankConditionOptions(labels) {
    const values = (labels || []).map((label, index) => ({ label: cleanText(label), index })).filter((item) => item.label);
    const score = (label) => {
      const text = label.toLowerCase();
      if (/\bnew with\b(?=[^\n]*\bbox\b)(?=[^\n]*\bpapers?\b)/.test(text)) return 1200;
      if (/\bnew with\b.*\b(?:box|papers?|tags)\b/.test(text)) return 1000;
      if (/\bbrand new\b/.test(text)) return 900;
      if (/^new(?:\b|$)/.test(text) && !/\b(?:other|without)\b/.test(text)) return 800;
      if (/^open box\b/.test(text)) return 700;
      return 0;
    };
    values.sort((left, right) => score(right.label) - score(left.label) || left.index - right.index);
    return values[0]?.label || "";
  }

  function buildDescription(product) {
    return buildPremiumDescription(product);
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
    buildPremiumDescription,
    calculateEbayPrice,
    canonicalAmazonImage,
    cleanText,
    createPremiumTitle,
    dedupeImageCandidates,
    deriveEbaySpecifics,
    normalizeSpecifics,
    parseMoney,
    rankConditionOptions,
    shortenTitle,
    sanitizeProductText,
    uniqueStrings,
  };
});
