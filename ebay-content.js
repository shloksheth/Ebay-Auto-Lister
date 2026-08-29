// Amazon → eBay Lister Helper — eBay side.
// Looks for listing data stashed by the Amazon content script (via the
// background service worker), shows a small floating panel, and — when
// the user clicks "Autofill" — tries to fill the title, description,
// price, and photo fields on whatever eBay listing form is currently on
// screen. It never submits/publishes anything; the user always reviews
// and clicks eBay's own "List it" button themselves.

(function () {
  "use strict";

  const PENDING_LISTING_KEY = "pendingListing";
  const MAX_AGE_MS = 20 * 60 * 1000; // ignore stale data older than 20 min

  // ---------- Helpers to find & set form fields on an unknown DOM ----------

  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findFieldByHints(hints, tagNames) {
    const selector = tagNames.join(",");
    const candidates = Array.from(document.querySelectorAll(selector)).filter(
      (el) => el.offsetParent !== null // visible only
    );

    for (const hint of hints) {
      const re = new RegExp(hint, "i");
      for (const el of candidates) {
        const haystack = [
          el.name,
          el.id,
          el.getAttribute("aria-label"),
          el.placeholder,
          el.getAttribute("data-testid"),
        ]
          .filter(Boolean)
          .join(" ");
        if (re.test(haystack)) return el;
      }
    }

    // Fallback: match on nearby <label> text
    const labels = Array.from(document.querySelectorAll("label"));
    for (const hint of hints) {
      const re = new RegExp(hint, "i");
      for (const label of labels) {
        if (!re.test(label.textContent || "")) continue;
        const forId = label.getAttribute("for");
        if (forId) {
          const el = document.getElementById(forId);
          if (el && candidates.includes(el)) return el;
        }
        const nested = label.querySelector(tagNames.join(","));
        if (nested) return nested;
      }
    }
    return null;
  }

  function fillTitle(title) {
    const el = findFieldByHints(
      ["title", "item.?name", "listing.?title"],
      ["input", "textarea"]
    );
    if (!el) return false;
    setNativeValue(el, title.slice(0, 80)); // eBay titles cap at 80 chars
    return true;
  }

  function fillPrice(price) {
    if (!price) return false;
    const numeric = (price.match(/[\d.]+/) || [])[0];
    if (!numeric) return false;
    const el = findFieldByHints(["price", "buy.?it.?now"], ["input"]);
    if (!el) return false;
    setNativeValue(el, numeric);
    return true;
  }

  function fillDescription(description) {
    // 1. Try a same-origin rich-text editor iframe (common on eBay's
    //    listing form for the description field).
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const frame of iframes) {
      const hint = `${frame.id} ${frame.title} ${frame.name}`;
      if (!/desc/i.test(hint)) continue;
      try {
        const doc = frame.contentDocument;
        if (doc && doc.body) {
          doc.body.innerHTML = description
            .split("\n")
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join("");
          doc.body.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      } catch (e) {
        // cross-origin iframe, can't touch it — fall through to next option
      }
    }

    // 2. Try a plain contenteditable description area on the page itself.
    const editable = document.querySelector(
      '[contenteditable="true"][class*="descr" i], [contenteditable="true"][id*="descr" i]'
    );
    if (editable) {
      editable.focus();
      editable.innerHTML = description
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    // 3. Fall back to a plain textarea.
    const textarea = findFieldByHints(["description"], ["textarea"]);
    if (textarea) {
      setNativeValue(textarea, description);
      return true;
    }

    return false;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function base64ToFile(image, index) {
    const [header, base64] = image.dataUrl.split(",");
    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const binary = atob(base64);
    let n = binary.length;
    const bytes = new Uint8Array(n);
    while (n--) bytes[n] = binary.charCodeAt(n);
    return new File([bytes], image.filename || `photo-${index + 1}.jpg`, {
      type: mime,
    });
  }

  function attachPhotos(images) {
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput || !images.length) return 0;

    const dt = new DataTransfer();
    images.forEach((img, i) => dt.items.add(base64ToFile(img, i)));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Some upload widgets listen for a drop event on a dropzone rather
    // than a change event on the (often hidden) input — try that too.
    const dropzone = document.querySelector(
      '[class*="upload" i][class*="drop" i], [class*="dropzone" i], [data-testid*="upload" i]'
    );
    if (dropzone) {
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
      dropzone.dispatchEvent(dropEvent);
    }

    return dt.files.length;
  }

  // ---------- Panel UI ----------

  function buildPanel(listing) {
    if (document.getElementById("a2e-ebay-panel")) return;

    const panel = document.createElement("div");
    panel.id = "a2e-ebay-panel";
    panel.className = "a2e-panel";
    panel.innerHTML = `
      <div class="a2e-panel-header">
        <span>Amazon listing ready</span>
        <button type="button" class="a2e-panel-close" title="Dismiss">×</button>
      </div>
      <div class="a2e-panel-title">${escapeHtml(listing.title.slice(0, 70))}${
      listing.title.length > 70 ? "…" : ""
    }</div>
      <button type="button" class="a2e-panel-fill">Autofill this form</button>
      <div class="a2e-panel-status"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector(".a2e-panel-close").addEventListener("click", () => {
      panel.remove();
    });

    panel.querySelector(".a2e-panel-fill").addEventListener("click", () => {
      const status = panel.querySelector(".a2e-panel-status");
      const results = [];

      results.push(["Title", fillTitle(listing.title)]);
      results.push(["Description", fillDescription(listing.description)]);
      results.push(["Price", fillPrice(listing.price)]);
      const attached = attachPhotos(listing.images);
      results.push([
        `Photos (${attached}/${listing.images.length})`,
        attached > 0,
      ]);

      status.innerHTML = results
        .map(
          ([label, ok]) =>
            `<div class="a2e-status-row ${ok ? "a2e-ok" : "a2e-fail"}">${
              ok ? "✓" : "✗"
            } ${label}</div>`
        )
        .join("");

      const anyFailed = results.some(([, ok]) => !ok);
      if (anyFailed) {
        const note = document.createElement("div");
        note.className = "a2e-status-note";
        note.textContent =
          "Some fields weren't found on this page — fill those in manually, then review everything before publishing.";
        status.appendChild(note);
      } else {
        const note = document.createElement("div");
        note.className = "a2e-status-note";
        note.textContent = "Double-check everything, then publish on eBay when ready.";
        status.appendChild(note);
      }
    });
  }

  chrome.storage.local.get(PENDING_LISTING_KEY, (data) => {
    const listing = data && data[PENDING_LISTING_KEY];
    if (!listing) return;
    if (Date.now() - listing.createdAt > MAX_AGE_MS) return;
    buildPanel(listing);
  });
})();
