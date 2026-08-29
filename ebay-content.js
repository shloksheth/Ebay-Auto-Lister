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
    if (!el) return { ok: false };
    const limit = el.maxLength && el.maxLength > 0 ? el.maxLength : 80;
    const value = title.slice(0, limit);
    setNativeValue(el, value);
    return { ok: true, truncated: value.length < title.length, limit };
  }

  // ---------- Step 1: eBay's "what are you selling?" search/match step ----------
  // Before the real listing form exists, eBay makes you search for the item
  // so it can offer catalog matches / a category. We can't (and shouldn't)
  // pick a match for you, but we can save the copy-paste by dropping the
  // title into that search box automatically.

  function isInGlobalHeader(el) {
    if (el.closest("header, nav")) return true;
    if (/^gh-/i.test(el.id || "")) return true; // eBay's global header search
    return false;
  }

  function findListingSearchBox() {
    const inputs = Array.from(
      document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')
    ).filter((el) => el.offsetParent !== null && !isInGlobalHeader(el));

    const hints = [
      "what.*selling",
      "search.*item",
      "item.*name",
      "brand.*model",
      "upc",
      "isbn",
      "product",
    ];
    for (const hint of hints) {
      const re = new RegExp(hint, "i");
      for (const el of inputs) {
        const haystack = [
          el.name,
          el.id,
          el.getAttribute("aria-label"),
          el.placeholder,
        ]
          .filter(Boolean)
          .join(" ");
        if (re.test(haystack)) return el;
      }
    }
    return null;
  }

  function fillSearchBox(title) {
    const el = findListingSearchBox();
    if (!el) return { ok: false };
    const limit = el.maxLength && el.maxLength > 0 ? el.maxLength : title.length;
    const value = title.slice(0, limit);
    setNativeValue(el, value);
    el.focus();
    return { ok: true, truncated: value.length < title.length };
  }

  function watchForSearchBox(title, onFilled, timeoutMs) {
    const immediate = fillSearchBox(title);
    if (immediate.ok) {
      onFilled(immediate);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const observer = new MutationObserver(() => {
      const result = fillSearchBox(title);
      if (result.ok) {
        observer.disconnect();
        onFilled(result);
      } else if (Date.now() > deadline) {
        observer.disconnect();
        onFilled(result);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      onFilled(fillSearchBox(title));
    }, timeoutMs);
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

  function countPhotoPreviews() {
    // Uploaded/attached photos are almost always rendered from a local
    // object URL (blob:) while eBay processes them, so count those as a
    // reasonable proxy for "did this actually take."
    return document.querySelectorAll('img[src^="blob:"]').length;
  }

  function findPhotoInputs() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    // Prefer inputs that look image-related; fall back to any file input.
    const imageLike = inputs.filter((el) => {
      const accept = el.getAttribute("accept") || "";
      const haystack = `${accept} ${el.name} ${el.id}`;
      return /image|photo|jpg|jpeg|png/i.test(haystack);
    });
    return imageLike.length ? imageLike : inputs;
  }

  function findDropzone() {
    return document.querySelector(
      '[class*="upload" i][class*="drop" i], [class*="dropzone" i], [data-testid*="upload" i], [data-testid*="photo" i]'
    );
  }

  function attemptAttachPhotos(images) {
    if (!images.length) return { attempted: false };

    const dt = new DataTransfer();
    images.forEach((img, i) => dt.items.add(base64ToFile(img, i)));

    let triedSomething = false;

    findPhotoInputs().forEach((input) => {
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      triedSomething = true;
    });

    const dropzone = findDropzone();
    if (dropzone) {
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
      dropzone.dispatchEvent(dropEvent);
      triedSomething = true;
    }

    return { attempted: triedSomething };
  }

  // Fills photos, then actually checks the page a moment later to see if a
  // preview shows up, instead of just assuming the DOM write worked.
  function attachPhotosWithVerification(images, onResult) {
    const before = countPhotoPreviews();
    const { attempted } = attemptAttachPhotos(images);

    if (!attempted) {
      onResult({ ok: false, reason: "no-target" });
      return;
    }

    let checks = 0;
    const maxChecks = 8; // ~4s at 500ms
    const interval = setInterval(() => {
      checks += 1;
      const after = countPhotoPreviews();
      if (after > before) {
        clearInterval(interval);
        onResult({ ok: true, count: after - before });
      } else if (checks >= maxChecks) {
        clearInterval(interval);
        onResult({ ok: false, reason: "no-preview" });
      }
    }, 500);
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
      <div class="a2e-panel-step">
        <div class="a2e-step-label">Step 1 · Search box</div>
        <div class="a2e-step-status a2e-step-pending">Looking for eBay's search field…</div>
      </div>
      <div class="a2e-panel-step">
        <div class="a2e-step-label">Step 2 · Once you're on the listing form</div>
        <button type="button" class="a2e-panel-fill">Autofill listing details</button>
        <div class="a2e-panel-status"></div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector(".a2e-panel-close").addEventListener("click", () => {
      panel.remove();
    });

    const searchStatus = panel.querySelector(".a2e-step-status");
    watchForSearchBox(
      listing.title,
      (result) => {
        searchStatus.classList.remove("a2e-step-pending");
        if (result.ok) {
          searchStatus.classList.add("a2e-ok");
          searchStatus.textContent = result.truncated
            ? "✓ Typed in a shortened title (eBay's field has a character limit). Check the match eBay suggests, then continue."
            : "✓ Typed the title in — check the match eBay suggests, then continue.";
        } else {
          searchStatus.classList.add("a2e-fail");
          searchStatus.textContent =
            "✗ Couldn't find it yet. Paste manually: " + listing.title.slice(0, 60);
        }
      },
      8000
    );

    panel.querySelector(".a2e-panel-fill").addEventListener("click", () => {
      const status = panel.querySelector(".a2e-panel-status");
      const results = [];

      const titleResult = fillTitle(listing.title);
      results.push([
        titleResult.ok && titleResult.truncated
          ? `Title (shortened to eBay's ${titleResult.limit}-char limit)`
          : "Title",
        titleResult.ok,
      ]);
      results.push(["Description", fillDescription(listing.description)]);
      results.push(["Price", fillPrice(listing.price)]);

      status.innerHTML =
        results
          .map(
            ([label, ok]) =>
              `<div class="a2e-status-row ${ok ? "a2e-ok" : "a2e-fail"}">${
                ok ? "✓" : "✗"
              } ${label}</div>`
          )
          .join("") +
        `<div class="a2e-status-row a2e-step-pending" data-role="photos">… Photos (checking)</div>`;

      const photoRow = status.querySelector('[data-role="photos"]');
      attachPhotosWithVerification(listing.images, (result) => {
        photoRow.classList.remove("a2e-step-pending");
        if (result.ok) {
          photoRow.classList.add("a2e-ok");
          photoRow.textContent = `✓ Photos (${result.count} of ${listing.images.length} confirmed on the page)`;
        } else if (result.reason === "no-target") {
          photoRow.classList.add("a2e-fail");
          photoRow.textContent =
            "✗ Photos — no upload field found on this page yet";
        } else {
          photoRow.classList.add("a2e-fail");
          photoRow.textContent =
            "✗ Photos — attached, but no preview appeared. Check the page, or drag them in manually.";
        }

        const anyFailed =
          results.some(([, ok]) => !ok) || !result.ok;
        const note = document.createElement("div");
        note.className = "a2e-status-note";
        note.textContent = anyFailed
          ? "Some fields weren't found on this page yet — if you're not on the listing-details step yet, finish picking a match/category first, then click this again. Otherwise fill those in manually."
          : "Double-check everything, then publish on eBay when ready.";
        status.appendChild(note);
      });
    });
  }

  chrome.storage.local.get(PENDING_LISTING_KEY, (data) => {
    const listing = data && data[PENDING_LISTING_KEY];
    if (!listing) return;
    if (Date.now() - listing.createdAt > MAX_AGE_MS) return;
    buildPanel(listing);
  });
})();
