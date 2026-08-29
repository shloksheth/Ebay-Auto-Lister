// Amazon → eBay Lister Helper
// Adds a clipboard button next to the product title. Clicking it:
//  1. Copies a clean, eBay-ready description to the clipboard.
//  2. Sends all product photo URLs (full resolution) to the background
//     script so they can be downloaded to a per-listing folder.

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

  function getTitleElement() {
    return document.getElementById("productTitle");
  }

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  // ---------- Description gathering ----------
  function gatherDescription() {
    const parts = [];

    const titleEl = getTitleElement();
    if (titleEl) parts.push(cleanText(titleEl.textContent));

    // Price (best effort, several possible layouts)
    const priceEl =
      document.querySelector(".a-price .a-offscreen") ||
      document.querySelector("#priceblock_ourprice") ||
      document.querySelector("#priceblock_dealprice");
    if (priceEl) parts.push("Price: " + cleanText(priceEl.textContent));

    // Feature bullets
    const bulletItems = document.querySelectorAll(
      "#feature-bullets ul li span.a-list-item"
    );
    if (bulletItems.length) {
      parts.push("\nKey Features:");
      bulletItems.forEach((li) => {
        const text = cleanText(li.textContent);
        if (text && !/warranty|see more/i.test(text)) {
          parts.push("• " + text);
        }
      });
    }

    // Product description (older layout)
    const descEl = document.querySelector("#productDescription");
    if (descEl) {
      const text = cleanText(descEl.textContent);
      if (text) {
        parts.push("\nDescription:");
        parts.push(text);
      }
    }

    // A+ / modern module content (aplus module)
    const aplus = document.querySelector("#aplus, #aplus_feature_div");
    if (aplus) {
      const aplusText = cleanText(aplus.textContent);
      if (aplusText && aplusText.length > 20) {
        parts.push("\nAdditional Details:");
        parts.push(aplusText);
      }
    }

    // Product overview table (spec table some listings have)
    const overviewRows = document.querySelectorAll(
      "#productOverview_feature_div table tr"
    );
    if (overviewRows.length) {
      parts.push("\nSpecs:");
      overviewRows.forEach((row) => {
        const cells = row.querySelectorAll("td, span");
        const text = cleanText(row.textContent).replace(/\s{2,}/g, " — ");
        if (text) parts.push("• " + text);
      });
    }

    return parts.join("\n").trim();
  }

  // ---------- Image gathering ----------
  function hiResFromThumb(url) {
    // Amazon thumb/gallery URLs embed size modifiers like:
    // ..._SX38_SY50_CR,0,0,38,50_.jpg  or  ..._SL1500_.jpg
    // Stripping the "._..._" segment before the extension yields the
    // original full-resolution image.
    return url.replace(/\._[A-Za-z0-9,_]+_(?=\.\w+$)/, "");
  }

  function gatherImageUrls() {
    const urls = new Set();

    // Main image block thumbnails
    document
      .querySelectorAll("#altImages li img, #imageBlock img")
      .forEach((img) => {
        const src = img.getAttribute("src");
        if (src && src.includes("/images/I/")) {
          urls.add(hiResFromThumb(src));
        }
      });

    // Main landing image, and its high-res data attribute if present
    const landing = document.getElementById("landingImage");
    if (landing) {
      const hires = landing.getAttribute("data-old-hires");
      if (hires) urls.add(hires);
      const dynImg = landing.getAttribute("data-a-dynamic-image");
      if (dynImg) {
        try {
          const parsed = JSON.parse(dynImg);
          Object.keys(parsed).forEach((u) => urls.add(u));
        } catch (e) {
          /* ignore parse errors */
        }
      }
      const src = landing.getAttribute("src");
      if (src) urls.add(hiResFromThumb(src));
    }

    // Fallback: scan inline scripts for the colorImages / imageGalleryData JSON
    // Amazon embeds a JS object like: 'colorImages': { 'initial': [ {hiRes:"...", large:"..."} ] }
    document.querySelectorAll("script:not([src])").forEach((script) => {
      const text = script.textContent;
      if (text && text.includes("colorImages")) {
        const matches = text.matchAll(/"(hiRes|large)":"(https:\/\/[^"]+)"/g);
        for (const m of matches) {
          urls.add(m[2].replace(/\\\//g, "/"));
        }
      }
    });

    return Array.from(urls);
  }

  // ---------- UI ----------
  function makeSafeFolderName(title) {
    return (title || "amazon-product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "amazon-product";
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
      const description = gatherDescription();
      const imageUrls = gatherImageUrls();
      const titleEl = getTitleElement();
      const folder = makeSafeFolderName(titleEl ? titleEl.textContent : "");

      await navigator.clipboard.writeText(description);

      button.innerHTML = CHECK_SVG;
      button.classList.add("a2e-success");

      if (imageUrls.length) {
        chrome.runtime.sendMessage(
          {
            type: "DOWNLOAD_IMAGES",
            folder,
            urls: imageUrls,
          },
          (response) => {
            const count =
              response && typeof response.count === "number"
                ? response.count
                : imageUrls.length;
            showToast(
              button,
              `Description copied · downloading ${count} photo${
                count === 1 ? "" : "s"
              }`
            );
          }
        );
      } else {
        showToast(button, "Description copied · no photos found");
      }
    } catch (err) {
      console.error("Amazon → eBay Lister Helper error:", err);
      showToast(button, "Something went wrong — see console", true);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = originalHTML;
        button.classList.remove("a2e-success");
      }, 2200);
    }
  }

  function insertButton() {
    const titleEl = getTitleElement();
    if (!titleEl || titleEl.dataset.a2eInjected) return;

    const wrapper = document.createElement("span");
    wrapper.className = "a2e-wrapper";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "a2e-button";
    button.title = "Copy description & download photos for eBay";
    button.innerHTML = CLIPBOARD_SVG;
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick(button);
    });

    wrapper.appendChild(button);
    titleEl.insertAdjacentElement("afterend", wrapper);
    titleEl.dataset.a2eInjected = "true";
  }

  // Amazon renders the title asynchronously on some page loads, so watch
  // the DOM until it shows up, then keep watching in case of SPA-style nav.
  const observer = new MutationObserver(() => insertButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  insertButton();
})();
