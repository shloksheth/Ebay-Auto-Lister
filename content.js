// Marketplace → eBay Lister Helper (source side)
// Runs on Amazon, AliExpress, Walmart, and eBay item pages. Adds a
// clipboard button (copy description + download best-quality photos) and
// an "eBay" button (hand off title/description/price/photos to a new eBay
// listing) next to the product title.
//
// Each site has different markup, so a small per-site "adapter" supplies
// the site-specific extraction logic; everything else (button UI, image
// dedupe, messaging) is shared.

(function () {
  "use strict";

  const CLIPBOARD_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
    </svg>`;

  const CHECK_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>`;

  const EBAY_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"></path>
      <polyline points="16 6 12 2 8 6"></polyline>
      <line x1="12" y1="2" x2="12" y2="15"></line>
    </svg>`;

  const MAX_IMAGES = 20;

  // ---------- Shared helpers ----------

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function absolutize(url) {
    if (!url) return url;
    if (url.startsWith("//")) return "https:" + url;
    try {
      return new URL(url, location.href).toString();
    } catch (e) {
      return url;
    }
  }

  // Reads Schema.org Product JSON-LD, present on most modern e-commerce
  // sites (Walmart, eBay, and sometimes AliExpress). Used as a fallback /
  // supplement to per-site DOM scraping.
  function getJsonLdProduct() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (e) {
        continue;
      }
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data["@graph"])
        ? data["@graph"]
        : [data];
      for (const item of items) {
        const type = item && item["@type"];
        const isProduct =
          type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (isProduct) return item;
      }
    }
    return null;
  }

  function jsonLdImages(product) {
    if (!product || !product.image) return [];
    const raw = product.image;
    if (Array.isArray(raw)) return raw.filter((u) => typeof u === "string");
    if (typeof raw === "string") return [raw];
    if (raw.url) return [raw.url];
    return [];
  }

  function jsonLdPrice(product) {
    if (!product) return "";
    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (!offers) return "";
    const val = offers.price || offers.lowPrice;
    return val ? `$${val}` : "";
  }

  function getOgMeta(prop) {
    const el = document.querySelector(
      `meta[property="${prop}"], meta[name="${prop}"]`
    );
    return el ? el.getAttribute("content") : "";
  }

  // Dedupe a list of image URLs. `canonicalize(url)` should return the
  // best-quality URL for that photo (stripping size/quality suffixes) —
  // duplicates naturally collapse because they map to the same string.
  function dedupeImages(rawUrls, canonicalize) {
    const seen = new Set();
    const out = [];
    rawUrls.forEach((raw) => {
      if (!raw) return;
      const url = absolutize(raw);
      const canon = canonicalize ? canonicalize(url) || url : url;
      if (!seen.has(canon)) {
        seen.add(canon);
        out.push(canon);
      }
    });
    return out.slice(0, MAX_IMAGES);
  }

  function bulletList(selector) {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => cleanText(el.textContent))
      .filter(Boolean);
  }

  function buildDescriptionText({ title, price, bullets, extra }) {
    const parts = [];
    if (title) parts.push(title);
    if (price) parts.push("Price: " + price);
    if (bullets && bullets.length) {
      parts.push("\nKey Features:");
      bullets.forEach((b) => parts.push("• " + b));
    }
    if (extra) {
      parts.push("\nDescription:");
      parts.push(extra);
    }
    return parts.join("\n").trim();
  }

  // ---------- Site adapters ----------

  function amazonCanonicalUrl(url) {
    // Amazon appends a size/quality token right before the extension, e.g.
    // ..._SL1500_.jpg or ._AC_SX679_.jpg — stripping it yields the
    // original full-resolution image, and collapses every size variant of
    // the same photo down to one identical string.
    let clean = url.split("?")[0];
    clean = clean.replace(/\.[A-Za-z0-9,_]*_(?=\.\w+$)/, "");
    return clean;
  }

  const AmazonAdapter = {
    id: "amazon",
    getTitleElement: () => document.getElementById("productTitle"),
    gatherPrice: () => {
      const el =
        document.querySelector(".a-price .a-offscreen") ||
        document.querySelector("#priceblock_ourprice") ||
        document.querySelector("#priceblock_dealprice");
      return el ? cleanText(el.textContent) : "";
    },
    gatherDescription: function () {
      const title = this.getTitleElement()
        ? cleanText(this.getTitleElement().textContent)
        : "";
      const price = this.gatherPrice();
      const bullets = bulletList("#feature-bullets ul li span.a-list-item").filter(
        (t) => !/warranty|see more/i.test(t)
      );
      const descEl = document.querySelector("#productDescription, #aplus, #aplus_feature_div");
      const extra = descEl ? cleanText(descEl.textContent) : "";
      const overviewRows = Array.from(
        document.querySelectorAll("#productOverview_feature_div table tr")
      )
        .map((row) => cleanText(row.textContent).replace(/\s{2,}/g, " — "))
        .filter(Boolean);
      let text = buildDescriptionText({ title, price, bullets, extra: extra.slice(0, 1200) });
      if (overviewRows.length) {
        text += "\n\nSpecs:\n" + overviewRows.map((r) => "• " + r).join("\n");
      }
      return text;
    },
    gatherImageUrls: () => {
      const raw = [];
      document
        .querySelectorAll("#altImages li img, #imageBlock img")
        .forEach((img) => {
          const src = img.getAttribute("src");
          if (src && src.includes("/images/I/")) raw.push(src);
        });
      const landing = document.getElementById("landingImage");
      if (landing) {
        const hires = landing.getAttribute("data-old-hires");
        if (hires) raw.push(hires);
        const dynImg = landing.getAttribute("data-a-dynamic-image");
        if (dynImg) {
          try {
            const parsed = JSON.parse(dynImg);
            Object.keys(parsed).forEach((u) => raw.push(u));
          } catch (e) {
            /* ignore */
          }
        }
        const src = landing.getAttribute("src");
        if (src) raw.push(src);
      }
      document.querySelectorAll("script:not([src])").forEach((script) => {
        const text = script.textContent;
        if (text && text.includes("colorImages")) {
          const matches = text.matchAll(/"(hiRes|large)":"(https:\/\/[^"]+)"/g);
          for (const m of matches) raw.push(m[2].replace(/\\\//g, "/"));
        }
      });
      return dedupeImages(raw, amazonCanonicalUrl);
    },
  };

  function walmartCanonicalKey(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch (e) {
      return url.split("?")[0];
    }
  }

  function walmartUpgrade(url) {
    try {
      const u = new URL(url);
      if (u.searchParams.has("odnWidth")) u.searchParams.set("odnWidth", "2000");
      if (u.searchParams.has("odnHeight")) u.searchParams.set("odnHeight", "2000");
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  const WalmartAdapter = {
    id: "walmart",
    getTitleElement: () =>
      document.querySelector(
        'h1[itemprop="name"], h1[data-testid="product-title"], main h1'
      ),
    gatherPrice: function () {
      const el = document.querySelector(
        '[itemprop="price"], [data-testid="price-wrap"] span, [data-automation-id="product-price"]'
      );
      if (el) {
        const val = el.getAttribute("content") || el.textContent;
        return cleanText(val);
      }
      const ld = getJsonLdProduct();
      return jsonLdPrice(ld);
    },
    gatherDescription: function () {
      const titleEl = this.getTitleElement();
      const title = titleEl ? cleanText(titleEl.textContent) : "";
      const price = this.gatherPrice();
      const bullets = bulletList(
        '[data-testid="product-highlights"] li, #product-highlights li'
      );
      const ld = getJsonLdProduct();
      const descEl = document.querySelector(
        '[data-testid="product-description"], [itemprop="description"]'
      );
      const extra = descEl
        ? cleanText(descEl.textContent)
        : ld && ld.description
        ? cleanText(ld.description)
        : cleanText(getOgMeta("og:description"));
      return buildDescriptionText({ title, price, bullets, extra: extra.slice(0, 1200) });
    },
    gatherImageUrls: () => {
      const raw = [];
      document
        .querySelectorAll(
          'img[data-testid="hero-image"], [data-testid="media-thumbnail"] img, button[data-testid="thumbnail"] img'
        )
        .forEach((img) => {
          const src = img.getAttribute("src") || img.getAttribute("data-src");
          if (src) raw.push(src);
        });
      const ld = getJsonLdProduct();
      jsonLdImages(ld).forEach((u) => raw.push(u));
      const seen = new Map();
      raw.forEach((u) => {
        const abs = absolutize(u);
        const key = walmartCanonicalKey(abs);
        if (!seen.has(key)) seen.set(key, walmartUpgrade(abs));
      });
      return Array.from(seen.values()).slice(0, MAX_IMAGES);
    },
  };

  function aliexpressCanonicalUrl(url) {
    // AliExpress appends a size token like _640x640.jpg or _220x220q90.jpg
    // right before the extension — stripping it yields the original.
    let clean = url.split("?")[0];
    clean = clean.replace(/_\d+x\d+[a-z0-9]*(?=\.\w+$)/i, "");
    return clean;
  }

  const AliExpressAdapter = {
    id: "aliexpress",
    getTitleElement: () =>
      document.querySelector(
        'h1[data-pl="product-title"], .product-title-text, h1'
      ),
    gatherPrice: function () {
      const el = document.querySelector(
        '.product-price-value, [class*="Price_priceText"], .uniform-banner-box-price'
      );
      if (el) return cleanText(el.textContent);
      const ld = getJsonLdProduct();
      return jsonLdPrice(ld);
    },
    gatherDescription: function () {
      const titleEl = this.getTitleElement();
      const title = titleEl ? cleanText(titleEl.textContent) : "";
      const price = this.gatherPrice();
      const bullets = bulletList(
        ".product-prop-list li, .specification-list li, [class*='Specification'] li"
      );
      const ld = getJsonLdProduct();
      const extra = (ld && ld.description ? cleanText(ld.description) : cleanText(getOgMeta("og:description"))).slice(
        0,
        1200
      );
      return buildDescriptionText({ title, price, bullets, extra });
    },
    gatherImageUrls: () => {
      const raw = [];
      document
        .querySelectorAll(
          ".images-view-item img, .image-view img, [class*='slider'] img, [class*='thumb'] img"
        )
        .forEach((img) => {
          const src = img.getAttribute("src") || img.getAttribute("data-src");
          if (src) raw.push(src);
        });
      const ld = getJsonLdProduct();
      jsonLdImages(ld).forEach((u) => raw.push(u));
      return dedupeImages(raw, aliexpressCanonicalUrl);
    },
  };

  function ebayCanonicalUrl(url) {
    // eBay image URLs embed a size token like s-l64 / s-l500 — replacing
    // it with eBay's largest standard size (s-l1600) both upgrades quality
    // and collapses every size variant of the same photo to one string.
    let clean = url.split("?")[0];
    clean = clean.replace(/s-l\d+(?=\.\w+$)/i, "s-l1600");
    return clean;
  }

  const EbayItemAdapter = {
    id: "ebay-item",
    getTitleElement: () =>
      document.querySelector(
        '#itemTitle, h1[itemprop="name"], .x-item-title__mainTitle span, .x-item-title__mainTitle'
      ),
    gatherPrice: function () {
      const el = document.querySelector(
        '.x-price-primary span, #prcIsum, [itemprop="price"]'
      );
      if (el) {
        const val = el.getAttribute("content") || el.textContent;
        return cleanText(val);
      }
      const ld = getJsonLdProduct();
      return jsonLdPrice(ld);
    },
    gatherDescription: function () {
      const titleEl = this.getTitleElement();
      let title = titleEl ? cleanText(titleEl.textContent) : "";
      title = title.replace(/^details about\s*/i, "");
      const price = this.gatherPrice();
      const bullets = bulletList(
        ".ux-layout-section--features .ux-labels-values__values, .itemAttr td"
      );
      let extra = "";
      const descFrame = document.querySelector("#desc_ifr");
      if (descFrame) {
        try {
          extra = cleanText(descFrame.contentDocument.body.textContent);
        } catch (e) {
          /* cross-origin, can't read it */
        }
      }
      if (!extra) {
        const descDiv = document.querySelector(".x-item-description, #desc_div");
        if (descDiv) extra = cleanText(descDiv.textContent);
      }
      return buildDescriptionText({ title, price, bullets, extra: extra.slice(0, 1200) });
    },
    gatherImageUrls: () => {
      const raw = [];
      document
        .querySelectorAll(
          "#icImg, .ux-image-filmstrip-carousel-item img, #PicturePanel img, .ux-image-carousel-item img"
        )
        .forEach((img) => {
          const src =
            img.getAttribute("src") ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-zoom-src");
          if (src) raw.push(src);
        });
      const ld = getJsonLdProduct();
      jsonLdImages(ld).forEach((u) => raw.push(u));
      return dedupeImages(raw, ebayCanonicalUrl);
    },
  };

  function detectAdapter() {
    const host = location.hostname;
    if (/amazon\./i.test(host)) return AmazonAdapter;
    if (/walmart\./i.test(host)) return WalmartAdapter;
    if (/aliexpress\./i.test(host)) return AliExpressAdapter;
    if (/ebay\./i.test(host)) return EbayItemAdapter;
    return null;
  }

  const ADAPTER = detectAdapter();
  if (!ADAPTER) return;

  // ---------- UI (shared across sites) ----------

  function makeSafeFolderName(title) {
    return (
      (title || "product")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 60) || "product"
    );
  }

  function showToast(button, message, isError) {
    const toast = document.createElement("span");
    toast.className = "a2e-toast" + (isError ? " a2e-toast-error" : "");
    toast.textContent = message;
    button.parentElement.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("a2e-toast-visible"));
    setTimeout(() => {
      toast.classList.remove("a2e-toast-visible");
      setTimeout(() => toast.remove(), 200);
    }, 2200);
  }

  async function handleClick(button) {
    const originalHTML = button.innerHTML;
    button.disabled = true;

    try {
      const description = ADAPTER.gatherDescription();
      const imageUrls = ADAPTER.gatherImageUrls();
      const titleEl = ADAPTER.getTitleElement();
      const folder = makeSafeFolderName(titleEl ? titleEl.textContent : "");

      await navigator.clipboard.writeText(description);

      button.innerHTML = CHECK_SVG;
      button.classList.add("a2e-success");

      if (imageUrls.length) {
        chrome.runtime.sendMessage(
          { type: "DOWNLOAD_IMAGES", folder, urls: imageUrls },
          (response) => {
            const count =
              response && typeof response.count === "number"
                ? response.count
                : imageUrls.length;
            showToast(
              button,
              `Description copied · downloading ${count} photo${count === 1 ? "" : "s"}`
            );
          }
        );
      } else {
        showToast(button, "Description copied · no photos found");
      }
    } catch (err) {
      console.error("Marketplace → eBay Lister Helper error:", err);
      showToast(button, "Something went wrong — see console", true);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = originalHTML;
        button.classList.remove("a2e-success");
      }, 2200);
    }
  }

  async function handleEbayClick(button) {
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="a2e-spinner"></span>`;

    try {
      const titleEl = ADAPTER.getTitleElement();
      const title = titleEl ? cleanText(titleEl.textContent) : "";
      const description = ADAPTER.gatherDescription();
      const price = ADAPTER.gatherPrice();
      const imageUrls = ADAPTER.gatherImageUrls();

      chrome.runtime.sendMessage(
        { type: "PREPARE_EBAY_LISTING", title, description, price, imageUrls },
        (response) => {
          if (response && response.ok) {
            showToast(button, `Opening eBay — click "Autofill listing details" there`);
          } else {
            showToast(button, "Couldn't prepare listing — see console", true);
          }
          button.disabled = false;
          button.innerHTML = originalHTML;
        }
      );
    } catch (err) {
      console.error("Marketplace → eBay Lister Helper error:", err);
      showToast(button, "Something went wrong — see console", true);
      button.disabled = false;
      button.innerHTML = originalHTML;
    }
  }

  function insertButton() {
    const titleEl = ADAPTER.getTitleElement();
    if (!titleEl || titleEl.dataset.a2eInjected) return;

    const wrapper = document.createElement("span");
    wrapper.className = "a2e-wrapper";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "a2e-button";
    copyButton.title = "Copy description & download photos";
    copyButton.innerHTML = CLIPBOARD_SVG;
    copyButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick(copyButton);
    });

    const ebayButton = document.createElement("button");
    ebayButton.type = "button";
    ebayButton.className = "a2e-button a2e-ebay-button";
    ebayButton.title = "Send title, description & photos to an eBay listing";
    ebayButton.innerHTML = EBAY_SVG;
    ebayButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEbayClick(ebayButton);
    });

    wrapper.appendChild(copyButton);
    wrapper.appendChild(ebayButton);
    titleEl.insertAdjacentElement("afterend", wrapper);
    titleEl.dataset.a2eInjected = "true";
  }

  const observer = new MutationObserver(() => insertButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  insertButton();
})();
