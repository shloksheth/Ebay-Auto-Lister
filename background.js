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

async function visualFingerprint(bytes, type) {
  if (!globalThis.OffscreenCanvas || !globalThis.createImageBitmap || /heic/i.test(type)) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type }));
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 16, 16);
    const pixels = context.getImageData(0, 0, 16, 16).data;
    const gray = [];
    for (let index = 0; index < pixels.length; index += 4) gray.push(Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114));
    const average = gray.reduce((sum, value) => sum + value, 0) / gray.length;
    const fingerprint = new Uint8Array(32);
    gray.forEach((value, index) => { if (value >= average) fingerprint[Math.floor(index / 8)] |= 1 << (index % 8); });
    return Array.from(fingerprint);
  } catch (_) {
    return null;
  } finally {
    bitmap?.close();
  }
}

function fingerprintDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Infinity;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let value = left[index] ^ right[index];
    while (value) { distance += value & 1; value >>>= 1; }
  }
  return distance;
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
      visualHash: await visualFingerprint(bytes, type),
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
  const sourceKeys = new Set();
  const visualHashes = [];
  const output = [];
  for (const image of fetched) {
    if (!image) continue;
    const sourceKey = Core.amazonImageKey(image.sourceUrl);
    const visuallyDuplicated = image.visualHash && visualHashes.some((fingerprint) => fingerprintDistance(image.visualHash, fingerprint) <= 10);
    if (hashes.has(image.hash) || sourceKeys.has(sourceKey) || visuallyDuplicated) continue;
    hashes.add(image.hash);
    sourceKeys.add(sourceKey);
    if (image.visualHash) visualHashes.push(image.visualHash);
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
      content: `You are a meticulous professional eBay listing copywriter. The source title defines the primary product and its category. A bundled keyboard, mouse, cable, case, or other accessory must never replace the primary product in the title or overview. Use only supplied facts. Never invent specifications, compatibility, condition, warranty, accessories, or included items. Never mention Amazon, another marketplace, source price, checkout credits, shipping speed, seller claims, or customer reviews. Write polished, concise US English without hype, emojis, filler, buyer instructions, or repeated facts. Return only valid JSON with this exact shape: {"title":"80 characters maximum","overview":"one or two premium factual sentences","features":["four to six concise factual bullets"]}.`,
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
    const raw = await session.prompt(`Create premium eBay listing JSON from these verified facts. The title must remain based on the original title, preserve the exact product identity, use only verified facts, and target 75-80 characters without exceeding 80. Treat ${JSON.stringify(Core.productKind(facts.title) || "the item named in the source title")} as the primary product:\n${JSON.stringify(facts)}`);
    let parsed = parseJsonObject(raw);
    try {
      const revised = await session.prompt(`Audit the previous JSON for wrong product identity, unsupported claims, repetition, weak wording, and marketplace filler. Rewrite it into stronger premium copy while preserving only verified facts. Return only the corrected JSON.`);
      parsed = parseJsonObject(revised);
    } catch (error) {
      console.warn("Marketplace → eBay: AI quality-review pass failed; using first AI draft", error);
    }
    const generatedTitle = Core.shortenTitle(parsed.title, 80);
    const title = Core.finalizeEbayTitle(facts.title, generatedTitle, facts.specifications, 75, 80);
    const overview = Core.sanitizeProductText(parsed.overview).slice(0, 600);
    const features = Core.uniqueStrings(Array.isArray(parsed.features) ? parsed.features : []).map(Core.sanitizeProductText).filter((item) => item.length >= 8).slice(0, 6);
    if (!title || overview.length < 30 || features.length < 2 || !Core.titlePreservesProductIdentity(facts.title, overview)) throw new Error("Chrome on-device AI did not preserve the primary product identity");
    return { title, overview, features };
  } finally {
    session.destroy();
  }
}

async function prepareListing(product) {
  const settings = await getSettings();
  let ai = null;
  try {
    ai = await improveWithLocalAi(product, settings);
  } catch (error) {
    console.error("Marketplace → eBay: on-device AI generation rejected", error);
    throw new Error(`Premium on-device AI listing could not be generated: ${error.message}. Open Extension options and run “Check or download AI model,” then retry.`);
  }
  if (settings.useLocalAi && !ai) throw new Error("Premium on-device AI is enabled but did not produce a listing");

  const mergedSpecifics = Core.deriveEbaySpecifics(Core.normalizeSpecifics(product.specifics), product);
  const localTitle = Core.createPremiumTitle({ ...product, specifics: mergedSpecifics }, 80);
  const listing = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceUrl: product.sourceUrl,
    sourcePrice: product.sourcePrice,
    title: Core.finalizeEbayTitle(product.title, ai?.title || localTitle, mergedSpecifics, 75, 80),
    description: Core.buildPremiumDescription({ ...product, title: Core.finalizeEbayTitle(product.title, ai?.title || localTitle, mergedSpecifics, 75, 80), specifics: mergedSpecifics, aiOverview: ai?.overview || ai?.description, aiFeatures: ai?.features }),
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
    generator: ai ? "Chrome Gemini Nano (two-pass on-device AI)" : "Local premium fallback",
    aiWarning: "",
  };
  await chrome.storage.local.set({ [`${PENDING_PREFIX}${listing.id}`]: listing, activeListingId: listing.id });
  return listing;
}

async function bindListingToTab(listing, tabId) {
  const bound = { ...listing, targetTabId: tabId };
  await chrome.storage.local.set({ [`${PENDING_PREFIX}${bound.id}`]: bound, activeListingId: bound.id });
  return bound;
}

function isRevisionUrl(url) {
  try {
    const parsed = new URL(url || "");
    return /(?:revise|revision|editlisting|mode=(?:revise|edit))/i.test(`${parsed.pathname} ${parsed.search}`);
  } catch (_) {
    return false;
  }
}

function validateImportUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS product links are supported");
  if (!/(?:^|\.)(?:amazon\.com|walmart\.com|aliexpress\.com|ebay\.com)$/i.test(parsed.hostname)) throw new Error(`Unsupported marketplace: ${parsed.hostname}`);
  parsed.hash = "";
  return parsed.toString();
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Product page timed out")), timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const finish = (error) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") finish(); }).catch(finish);
  });
}

async function extractProductUrl(value) {
  const url = validateImportUrl(value);
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 900));
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PRODUCT" });
        if (response?.ok && response.product?.title && response.product?.sourcePrice) return response.product;
        if (attempt === 9) throw new Error(response?.error || "Could not read this product page");
      } catch (error) {
        if (attempt === 9) throw error;
      }
    }
    throw new Error("Could not extract product information");
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(DEFAULTS).then((current) => chrome.storage.local.set(current));
  if (details.reason === "install") chrome.runtime.openOptionsPage();
  if (details.reason === "update" && details.previousVersion !== "4.1.0") chrome.tabs.create({ url: chrome.runtime.getURL("bulk.html") });
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("bulk.html") }));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PRODUCT_URL") {
    extractProductUrl(message.url)
      .then((product) => sendResponse({ ok: true, product }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

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
      .then(async (listing) => {
        const tab = await chrome.tabs.create({ url: `https://www.ebay.com/sl/prelist/suggest?a2e=${encodeURIComponent(listing.id)}` });
        return bindListingToTab(listing, tab.id);
      })
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
      const listing = id ? data[`${PENDING_PREFIX}${id}`] || null : null;
      const senderTabId = sender.tab?.id;
      if (!listing || listing.cancelled || !senderTabId || isRevisionUrl(sender.tab?.url)) {
        sendResponse({ listing: null });
        return;
      }
      if (listing.targetTabId == null && message.id) {
        const bound = await bindListingToTab(listing, senderTabId);
        sendResponse({ listing: bound });
        return;
      }
      sendResponse({ listing: listing.targetTabId === senderTabId ? listing : null });
    });
    return true;
  }

  if (message.type === "CANCEL_LISTING_AUTOMATION") {
    const id = message.id;
    if (!id) { sendResponse({ ok: false }); return false; }
    chrome.storage.local.get(`${PENDING_PREFIX}${id}`).then(async (data) => {
      const listing = data[`${PENDING_PREFIX}${id}`];
      if (!listing || listing.targetTabId !== sender.tab?.id) return { ok: false };
      await chrome.storage.local.set({ [`${PENDING_PREFIX}${id}`]: { ...listing, cancelled: true } });
      return { ok: true };
    }).then(sendResponse);
    return true;
  }

  return false;
});
