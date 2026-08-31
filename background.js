importScripts("core.js");

const Core = globalThis.A2ECore;
const PENDING_PREFIX = "pendingListing:";
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DEFAULTS = {
  useLocalAi: true,
  multiplier: 1.6,
  freeShipping: true,
  autoStart: true,
  autoPublish: false,
};

const LOCAL_AI_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
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

function parseJsonObject(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("The on-device AI returned an invalid response");
}

async function localAiAvailability() {
  if (!globalThis.LanguageModel) return "unavailable";
  try { return await LanguageModel.availability(LOCAL_AI_OPTIONS); }
  catch (_) { return LanguageModel.availability(); }
}

async function createLocalAiSession() {
  if (!globalThis.LanguageModel) throw new Error("Chrome on-device AI is not available in this browser");
  return LanguageModel.create({
    ...LOCAL_AI_OPTIONS,
    initialPrompts: [{
      role: "system",
      content: `You are a professional eBay listing copywriter. Use only supplied product facts. Never invent specifications, compatibility, condition, warranty, accessories, or included items. Never mention Amazon, another marketplace, source price, checkout credits, shipping speed, seller claims, or customer reviews. Write polished, concise US English without hype, emojis, filler, instructions to the buyer, or repeated facts. Return only valid JSON with this exact shape: {"title":"80 characters maximum","overview":"one or two premium factual sentences","features":["four to six concise factual bullets"]}.`,
    }],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        chrome.storage.local.set({ localAiDownloadProgress: Math.round((event.loaded || 0) * 100) });
      });
    },
  });
}

async function improveWithLocalAi(product, settings) {
  if (!settings.useLocalAi) return null;
  const availability = await localAiAvailability();
  if (availability === "unavailable") throw new Error("Chrome on-device AI is unavailable on this computer");
  const session = await createLocalAiSession();
  try {
    const facts = {
      title: Core.sanitizeProductText(product.title).slice(0, 500),
      description: Core.sanitizeProductText(product.description).slice(0, 2400),
      featureBullets: Core.uniqueStrings(product.bullets).slice(0, 10),
      specifications: Object.fromEntries(Object.entries(Core.normalizeSpecifics(product.specifics)).slice(0, 30)),
    };
    const raw = await session.prompt(`Create the premium listing JSON from these verified facts:\n${JSON.stringify(facts)}`);
    const parsed = parseJsonObject(raw);
    const title = Core.shortenTitle(parsed.title, 80);
    const overview = Core.sanitizeProductText(parsed.overview).slice(0, 600);
    const features = Core.uniqueStrings(Array.isArray(parsed.features) ? parsed.features : []).map(Core.sanitizeProductText).filter((item) => item.length >= 8).slice(0, 6);
    if (!title || overview.length < 30 || features.length < 2) throw new Error("Chrome on-device AI did not return a complete listing");
    return { title, overview, features };
  } finally {
    session.destroy();
  }
}

async function prepareListing(product) {
  const settings = await getSettings();
  let ai = null;
  let aiWarning = "";
  try {
    ai = await improveWithLocalAi(product, settings);
  } catch (error) {
    aiWarning = error.message;
    console.warn("Marketplace → eBay: on-device AI fallback used", error);
  }

  const mergedSpecifics = Core.deriveEbaySpecifics(Core.normalizeSpecifics(product.specifics), product);
  const localTitle = Core.createPremiumTitle({ ...product, specifics: mergedSpecifics }, 80);
  const listing = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceUrl: product.sourceUrl,
    sourcePrice: product.sourcePrice,
    title: Core.shortenTitle(ai?.title || localTitle, 80),
    description: Core.buildPremiumDescription({ ...product, title: ai?.title || localTitle, specifics: mergedSpecifics, aiOverview: ai?.overview || ai?.description, aiFeatures: ai?.features }),
    specifics: mergedSpecifics,
    price: Core.calculateEbayPrice(product.sourcePrice, settings.multiplier),
    quantity: 11,
    images: await fetchUniqueImages(product.images),
    settings: {
      autoStart: Boolean(settings.autoStart),
      autoPublish: Boolean(settings.autoPublish),
      freeShipping: Boolean(settings.freeShipping),
      multiplier: Number(settings.multiplier) || DEFAULTS.multiplier,
    },
    aiUsed: Boolean(ai),
    generator: ai ? "Chrome Gemini Nano (on-device)" : "Local premium fallback",
    aiWarning,
  };
  await chrome.storage.local.set({ [`${PENDING_PREFIX}${listing.id}`]: listing, activeListingId: listing.id });
  return listing;
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(DEFAULTS).then((current) => chrome.storage.local.set(current));
  if (details.reason === "install" || (details.reason === "update" && details.previousVersion !== "3.4.0")) chrome.runtime.openOptionsPage();
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
