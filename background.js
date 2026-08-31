importScripts("core.js");

const Core = globalThis.A2ECore;
const PENDING_PREFIX = "pendingListing:";
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DEFAULTS = {
  aiEnabled: false,
  apiKey: "",
  model: "gpt-5-mini",
  multiplier: 1.6,
  freeShipping: true,
  useEbayAi: true,
  autoStart: true,
  autoPublish: false,
};

function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

function safeFolder(title) {
  return (Core.cleanText(title || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "product");
}

function extensionFor(type, url) {
  const allowed = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic" };
  if (allowed[type]) return allowed[type];
  return (String(url).match(/\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i) || [null, "jpg"])[1].toLowerCase();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function fetchImage(url, index) {
  try {
    const response = await fetch(url, { credentials: "omit", cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
    if (!type.startsWith("image/")) throw new Error(`Unexpected content type ${type}`);
    if (!/image\/(?:jpeg|jpg|png|heic)/i.test(type)) throw new Error(`eBay does not accept ${type}`);
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("Image size is invalid");
    const bytes = new Uint8Array(buffer);
    return {
      dataUrl: `data:${type};base64,${bytesToBase64(bytes)}`,
      filename: `photo-${String(index + 1).padStart(2, "0")}.${extensionFor(type, url)}`,
      hash: await sha256(bytes),
      sourceUrl: url,
    };
  } catch (error) {
    console.warn("Marketplace → eBay: skipped image", url, error);
    return null;
  }
}

async function fetchUniqueImages(urls) {
  const fetched = await Promise.all((urls || []).slice(0, 20).map(fetchImage));
  const hashes = new Set();
  const output = [];
  for (const image of fetched) {
    if (!image || hashes.has(image.hash)) continue;
    hashes.add(image.hash);
    image.filename = `photo-${String(output.length + 1).padStart(2, "0")}.${image.filename.split(".").pop()}`;
    output.push(image);
    if (output.length >= MAX_IMAGES) break;
  }
  return output;
}

function responseText(payload) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

async function improveWithAi(product, settings) {
  if (!settings.aiEnabled || !settings.apiKey) return null;
  const facts = {
    title: product.title,
    description: Core.sanitizeProductText(product.description).slice(0, 5000),
    bullets: Core.uniqueStrings(product.bullets).slice(0, 15),
    specifics: Core.normalizeSpecifics(product.specifics),
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "description", "specifics"],
    properties: {
      title: { type: "string", maxLength: 80 },
      description: { type: "string", maxLength: 8000 },
      specifics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "value"],
          properties: { name: { type: "string" }, value: { type: "string" } },
        },
      },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model || DEFAULTS.model,
      input: [
        { role: "system", content: [{ type: "input_text", text: "Create an accurate eBay listing from supplied product facts. Title must be at most 80 characters, front-load brand/model/product type and useful attributes, and contain no unsupported claims. Description must be plain text, editable, concise, professional, and must not mention Amazon, source price, shipping speed, warranties, or facts absent from the input. Preserve useful dimensions, material, color, model and brand in specifics. Never invent values." }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(facts) }] },
      ],
      text: { format: { type: "json_schema", name: "ebay_listing", strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const raw = responseText(await response.json());
  const parsed = JSON.parse(raw);
  return {
    title: Core.shortenTitle(parsed.title, 80),
    description: Core.cleanText(parsed.description).slice(0, 8000),
    specifics: Core.normalizeSpecifics(Object.fromEntries((parsed.specifics || []).map((item) => [item.name, item.value]))),
  };
}

async function prepareListing(product) {
  const settings = await getSettings();
  let ai = null;
  let aiWarning = "";
  try {
    ai = await improveWithAi(product, settings);
  } catch (error) {
    aiWarning = error.message;
    console.warn("Marketplace → eBay: AI fallback used", error);
  }

  const mergedSpecifics = Core.deriveEbaySpecifics({ ...Core.normalizeSpecifics(product.specifics), ...(ai?.specifics || {}) }, product);
  const localTitle = Core.createPremiumTitle({ ...product, specifics: mergedSpecifics }, 80);
  const listing = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceUrl: product.sourceUrl,
    sourcePrice: product.sourcePrice,
    title: Core.shortenTitle(ai?.title || localTitle, 80),
    description: Core.buildPremiumDescription({ ...product, title: ai?.title || localTitle, specifics: mergedSpecifics, aiDescription: ai?.description }),
    specifics: mergedSpecifics,
    price: Core.calculateEbayPrice(product.sourcePrice, settings.multiplier),
    images: await fetchUniqueImages(product.images),
    settings: {
      autoStart: Boolean(settings.autoStart),
      autoPublish: Boolean(settings.autoPublish),
      freeShipping: Boolean(settings.freeShipping),
      useEbayAi: settings.useEbayAi !== false,
      multiplier: Number(settings.multiplier) || DEFAULTS.multiplier,
    },
    aiUsed: Boolean(ai),
    generator: ai ? "OpenAI + eBay AI" : "eBay AI (no API key) + local fallback",
    aiWarning,
  };
  await chrome.storage.local.set({ [`${PENDING_PREFIX}${listing.id}`]: listing, activeListingId: listing.id });
  return listing;
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(DEFAULTS).then((current) => chrome.storage.local.set(current));
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DOWNLOAD_IMAGES") {
    const urls = Array.from(new Set(message.urls || [])).slice(0, 20);
    const folder = safeFolder(message.title);
    urls.forEach((url, index) => {
      const ext = extensionFor("", url);
      chrome.downloads.download({ url, filename: `${folder}/photo-${String(index + 1).padStart(2, "0")}.${ext}`, conflictAction: "uniquify", saveAs: false });
    });
    sendResponse({ ok: true, count: urls.length });
    return false;
  }

  if (message.type === "PREPARE_EBAY_LISTING") {
    prepareListing(message.product)
      .then((listing) => chrome.tabs.create({ url: `https://www.ebay.com/sl/prelist/suggest?a2e=${encodeURIComponent(listing.id)}` }).then(() => listing))
      .then((listing) => sendResponse({ ok: true, imageCount: listing.images.length, aiUsed: listing.aiUsed, warning: listing.aiWarning }))
      .catch((error) => {
        console.error("Marketplace → eBay: prepare failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (message.type === "GET_ACTIVE_LISTING") {
    chrome.storage.local.get(["activeListingId"]).then(async ({ activeListingId }) => {
      const id = message.id || activeListingId;
      const data = id ? await chrome.storage.local.get(`${PENDING_PREFIX}${id}`) : {};
      sendResponse({ listing: id ? data[`${PENDING_PREFIX}${id}`] || null : null });
    });
    return true;
  }

  return false;
});
