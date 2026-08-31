(function () {
  "use strict";

  const Core = globalThis.A2ECore;
  if (!Core) return;

  const MAX_IMAGES = 12;
  const ICONS = {
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    ebay: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  };

  function textOf(selector) {
    const node = document.querySelector(selector);
    return node ? Core.cleanText(node.textContent) : "";
  }

  function textWithoutCode(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, template, svg").forEach((element) => element.remove());
    return Core.sanitizeProductText(clone.textContent);
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const value = textOf(selector);
      if (value) return value;
    }
    return "";
  }

  function firstCleanText(selectors) {
    for (const selector of selectors) {
      const value = textWithoutCode(document.querySelector(selector));
      if (value) return value;
    }
    return "";
  }

  function texts(selector) {
    return Core.uniqueStrings(Array.from(document.querySelectorAll(selector)).map(textWithoutCode));
  }

  function jsonLdProduct() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const raw = JSON.parse(script.textContent);
        const queue = Array.isArray(raw) ? raw : raw && Array.isArray(raw["@graph"]) ? raw["@graph"] : [raw];
        const found = queue.find((item) => item && (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product"))));
        if (found) return found;
      } catch (_) {}
    }
    return null;
  }

  function addSpecific(specifics, key, value) {
    const cleanKey = Core.cleanText(key).replace(/:$/, "");
    const cleanValue = Core.cleanText(value);
    if (cleanKey && cleanValue && !specifics[cleanKey]) specifics[cleanKey] = cleanValue;
  }

  function gatherTableSpecifics(selectors) {
    const specifics = {};
    document.querySelectorAll(selectors).forEach((row) => {
      const cells = row.querySelectorAll("th, td");
      if (cells.length >= 2) addSpecific(specifics, cells[0].textContent, cells[cells.length - 1].textContent);
    });
    return specifics;
  }

  function imageCandidate(img, fallbackScore) {
    const dynamic = img.getAttribute("data-a-dynamic-image");
    const output = [];
    if (dynamic) {
      try {
        Object.entries(JSON.parse(dynamic)).forEach(([url, size]) => output.push({ url, score: Number(size[0] || 0) * Number(size[1] || 0) }));
      } catch (_) {}
    }
    const hires = img.getAttribute("data-old-hires") || img.getAttribute("data-zoom-src");
    if (hires) output.push({ url: hires, score: 10000000 });
    const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src");
    if (src) output.push({ url: src, score: fallbackScore || (img.naturalWidth * img.naturalHeight) });
    return output;
  }

  const Amazon = {
    id: "amazon",
    titleNode: () => document.querySelector("#productTitle"),
    gather() {
      const title = textOf("#productTitle");
      const priceText = firstText(["#corePrice_feature_div .a-price .a-offscreen", "#apex_desktop .a-price .a-offscreen", ".a-price .a-offscreen", "#priceblock_ourprice"]);
      const bullets = texts("#feature-bullets li .a-list-item").filter((line) => !/see more|warranty/i.test(line));
      const description = firstCleanText(["#productDescription", "#aplus_feature_div", "#aplus"]);
      const rawSpecifics = gatherTableSpecifics("#productOverview_feature_div tr, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr");
      document.querySelectorAll("#detailBullets_feature_div li").forEach((row) => {
        const parts = textWithoutCode(row).split(":");
        if (parts.length > 1) addSpecific(rawSpecifics, parts.shift(), parts.join(":"));
      });

      const candidates = [];
      document.querySelectorAll("#landingImage, #imgTagWrapperId img, #altImages img, #imageBlock img").forEach((img, index) => {
        imageCandidate(img, index === 0 ? 5000000 : 1000000 - index).forEach((item) => candidates.push(item));
      });
      document.querySelectorAll("script:not([src])").forEach((script) => {
        const source = script.textContent || "";
        if (!source.includes("colorImages")) return;
        for (const match of source.matchAll(/"(hiRes|large)"\s*:\s*"(https?:\\?\/\\?\/[^"\\]+(?:\\.[^"\\]*)?)"/g)) {
          candidates.push({ url: match[2].replace(/\\\//g, "/"), score: match[1] === "hiRes" ? 9000000 : 4000000 });
        }
      });
      const images = Core.dedupeImageCandidates(candidates, Core.amazonImageKey, MAX_IMAGES).map(Core.canonicalAmazonImage);
      const product = { source: "amazon", sourceUrl: location.href, title, priceText, sourcePrice: Core.parseMoney(priceText), bullets, description, specifics: rawSpecifics, images };
      product.specifics = Core.deriveEbaySpecifics(rawSpecifics, product);
      return product;
    },
  };

  function genericImages(selectors, ld) {
    const candidates = [];
    document.querySelectorAll(selectors).forEach((img, index) => imageCandidate(img, 1000000 - index).forEach((item) => candidates.push(item)));
    const ldImages = ld && ld.image ? (Array.isArray(ld.image) ? ld.image : [ld.image]) : [];
    ldImages.forEach((item, index) => candidates.push({ url: typeof item === "string" ? item : item && item.url, score: 2000000 - index }));
    return Core.dedupeImageCandidates(candidates, undefined, MAX_IMAGES);
  }

  const Generic = {
    id: "generic",
    titleNode: () => document.querySelector('h1[itemprop="name"], main h1, h1'),
    gather() {
      const ld = jsonLdProduct() || {};
      const titleNode = this.titleNode();
      const title = Core.cleanText(titleNode ? titleNode.textContent : ld.name);
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers || {};
      const priceText = firstText(['[itemprop="price"]', '[data-testid="price-wrap"]', '.x-price-primary']) || String(offer.price || offer.lowPrice || "");
      const description = Core.cleanText(ld.description || document.querySelector('meta[property="og:description"]')?.content || "");
      const bullets = texts('[data-testid="product-highlights"] li, [class*="Specification"] li, .ux-layout-section--features .ux-labels-values__values');
      const specifics = gatherTableSpecifics('table tr, [class*="specification" i] tr');
      const images = genericImages('main img, [class*="gallery" i] img, [class*="thumbnail" i] img', ld);
      return { source: location.hostname, sourceUrl: location.href, title, priceText, sourcePrice: Core.parseMoney(priceText), bullets, description, specifics, images };
    },
  };

  const adapter = /amazon\./i.test(location.hostname) ? Amazon : Generic;

  function toast(button, message, error) {
    const old = button.parentElement.querySelector(".a2e-toast");
    if (old) old.remove();
    const node = document.createElement("span");
    node.className = `a2e-toast${error ? " a2e-toast-error" : ""}`;
    node.textContent = message;
    button.parentElement.appendChild(node);
    requestAnimationFrame(() => node.classList.add("a2e-toast-visible"));
    setTimeout(() => node.remove(), 3500);
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  async function runButton(button, task) {
    if (button.disabled) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="a2e-spinner"></span>';
    try {
      await task();
      button.innerHTML = ICONS.check;
      button.classList.add("a2e-success");
    } catch (error) {
      console.error("Marketplace → eBay Lister Helper", error);
      toast(button, error.message || "Something went wrong", true);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = original;
        button.classList.remove("a2e-success");
      }, 2500);
    }
  }

  function insertButtons() {
    const titleNode = adapter.titleNode();
    if (!titleNode || titleNode.dataset.a2eInjected) return;
    titleNode.dataset.a2eInjected = "true";
    const wrapper = document.createElement("span");
    wrapper.className = "a2e-wrapper";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "a2e-button";
    copy.title = "Copy a clean description and download deduplicated photos";
    copy.innerHTML = ICONS.copy;
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runButton(copy, async () => {
        const product = adapter.gather();
        const description = Core.buildDescription(product);
        await navigator.clipboard.writeText(description);
        const response = await sendMessage({ type: "DOWNLOAD_IMAGES", title: product.title, urls: product.images });
        toast(copy, `Copied description · ${response?.count || 0} unique photos queued`);
      });
    });

    const list = document.createElement("button");
    list.type = "button";
    list.className = "a2e-button a2e-ebay-button";
    list.title = "Create an eBay listing from this product";
    list.innerHTML = ICONS.ebay;
    list.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runButton(list, async () => {
        const product = adapter.gather();
        if (!product.title) throw new Error("Could not read the product title");
        if (!product.sourcePrice) throw new Error("Could not read a single product price");
        const response = await sendMessage({ type: "PREPARE_EBAY_LISTING", product });
        if (!response?.ok) throw new Error(response?.error || "Could not prepare the listing");
        toast(list, `eBay opened · ${response.imageCount} unique photos prepared`);
      });
    });

    wrapper.append(copy, list);
    titleNode.insertAdjacentElement("afterend", wrapper);
  }

  const observer = new MutationObserver(insertButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  insertButtons();
})();
