(function () {
  "use strict";

  const Core = globalThis.A2ECore;
  const MAX_AGE = 2 * 60 * 60 * 1000;
  const state = { running: true, busy: false, searchSubmitted: false, choiceClicked: false, uploadStarted: false, uploadConfirmed: false, published: false, specificCount: 0, filled: new Set() };

  function visible(element) {
    return Boolean(element && element.isConnected && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  }

  function normalized(value) {
    return Core.cleanText(value).toLowerCase();
  }

  function describe(element) {
    const label = element.labels ? Array.from(element.labels).map((item) => item.textContent).join(" ") : "";
    return normalized([element.id, element.name, element.placeholder, element.getAttribute("aria-label"), element.getAttribute("data-testid"), label].filter(Boolean).join(" "));
  }

  function isHeader(element) {
    return Boolean(element.closest("header, nav, [role=banner]") || /^gh-/i.test(element.id || ""));
  }

  function setValue(element, value) {
    if (!element || String(value ?? "") === "") return false;
    const next = String(value);
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(element, next);
    else element.value = next;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return normalized(element.value) === normalized(next);
  }

  function findField(patterns, tags = "input,textarea,select", allowHeader = false) {
    const candidates = Array.from(document.querySelectorAll(tags)).filter((element) => visible(element) && !element.disabled && (allowHeader || !isHeader(element)));
    for (const pattern of patterns) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
      const match = candidates.find((element) => regex.test(describe(element)));
      if (match) return match;
    }
    return null;
  }

  function buttons() {
    return Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')).filter((element) => visible(element) && !element.disabled && !isHeader(element));
  }

  function buttonText(element) {
    return normalized(element.textContent || element.value || element.getAttribute("aria-label"));
  }

  function clickButton(patterns, exclude) {
    for (const pattern of patterns) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
      const found = buttons().find((element) => regex.test(buttonText(element)) && !(exclude && exclude.test(buttonText(element))));
      if (found) {
        found.click();
        return found;
      }
    }
    return null;
  }

  function searchField() {
    return findField([/what.*selling/, /tell us.*item/, /search.*item/, /item.*title/, /brand.*model/, /upc|isbn/], 'input[type="text"], input[type="search"], input:not([type])');
  }

  function titleField() {
    return findField([/^.*listing.*title/, /^.*custom.*title/, /(^|\s)title(\s|$)/, /item.*name/], "input,textarea");
  }

  function priceField() {
    return findField([/buy.*now.*price/, /fixed.*price/, /(^|\s)price(\s|$)/], "input");
  }

  function tokenSimilarity(a, b) {
    const left = new Set(normalized(a).split(/[^a-z0-9]+/).filter((item) => item.length > 2));
    const right = new Set(normalized(b).split(/[^a-z0-9]+/).filter((item) => item.length > 2));
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    left.forEach((token) => { if (right.has(token)) overlap += 1; });
    return overlap / Math.min(left.size, right.size);
  }

  function chooseBestMatch(title) {
    const actionRegex = /sell (?:one|this)|select|list this|use this|choose/;
    const candidates = buttons().filter((button) => actionRegex.test(buttonText(button)));
    let best = null;
    for (const button of candidates) {
      const container = button.closest("li, article, [class*=card], [data-testid*=result]") || button.parentElement;
      const score = tokenSimilarity(title, container?.textContent || "");
      if (!best || score > best.score) best = { button, score };
    }
    if (best && best.score >= 0.55) {
      best.button.click();
      return true;
    }
    return Boolean(clickButton([/continue without (?:a )?match/, /create (?:a )?new listing/, /list without match/], /cancel|back/));
  }

  function insertEditableText(editable, value) {
    editable.focus();
    const selection = editable.ownerDocument.getSelection();
    const range = editable.ownerDocument.createRange();
    range.selectNodeContents(editable);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try { inserted = editable.ownerDocument.execCommand("insertText", false, value); } catch (_) {}
    if (!inserted) editable.textContent = value;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    editable.dispatchEvent(new Event("change", { bubbles: true }));
    return normalized(editable.textContent).startsWith(normalized(value).slice(0, 40));
  }

  function fillDescription(description) {
    const textarea = findField([/description/, /describe.*item/], "textarea");
    if (textarea) return setValue(textarea, description);

    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"][contenteditable]')).filter(visible);
    const editable = editables.find((element) => /desc|describe/.test(describe(element) + " " + normalized(element.closest("section,div")?.querySelector("label,h2,h3")?.textContent))) || editables[0];
    if (editable) return insertEditableText(editable, description);

    for (const frame of document.querySelectorAll("iframe")) {
      if (!/desc|editor/i.test(`${frame.id} ${frame.name} ${frame.title}`)) continue;
      try {
        if (frame.contentDocument?.body) return insertEditableText(frame.contentDocument.body, description);
      } catch (_) {}
    }
    return false;
  }

  function selectValue(select, wanted) {
    const target = normalized(wanted);
    const options = Array.from(select.options);
    const exact = options.find((option) => normalized(option.textContent) === target);
    const partial = options.find((option) => normalized(option.textContent).includes(target) || target.includes(normalized(option.textContent)));
    return setValue(select, (exact || partial)?.value || "");
  }

  function fillSpecifics(specifics) {
    let count = 0;
    for (const [key, value] of Object.entries(specifics || {})) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const field = findField([new RegExp(`(^|\\s)${escaped}($|\\s)`, "i")], "input,textarea,select");
      if (!field) continue;
      const ok = field instanceof HTMLSelectElement ? selectValue(field, value) : setValue(field, value);
      if (ok) count += 1;
    }
    return count;
  }

  function fillCondition() {
    const select = findField([/condition/], "select");
    if (select) return selectValue(select, "New");
    const newInput = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).find((input) => visible(input) && /(^|\s)new($|\s)/i.test(describe(input)));
    if (newInput && !newInput.checked) newInput.click();
    if (newInput) return true;
    return Boolean(clickButton([/^new$/], /other|like new|new other/));
  }

  function enableFreeShipping() {
    const controls = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]')).filter(visible);
    const free = controls.find((input) => /free.*shipping|shipping.*free/.test(describe(input)));
    if (free) {
      if (!free.checked) free.click();
      return free.checked;
    }
    const zeroCost = findField([/shipping.*cost/, /buyer.*pays/, /cost.*shipping/], "input");
    if (zeroCost && setValue(zeroCost, "0.00")) return true;
    const button = buttons().find((item) => /^free shipping$/.test(buttonText(item)));
    if (button) {
      if (button.getAttribute("aria-pressed") !== "true") button.click();
      return true;
    }
    return false;
  }

  function dataUrlToFile(image, index) {
    const comma = image.dataUrl.indexOf(",");
    const header = image.dataUrl.slice(0, comma);
    const binary = atob(image.dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const type = (header.match(/^data:([^;]+)/) || [null, "image/jpeg"])[1];
    return new File([bytes], image.filename || `photo-${index + 1}.jpg`, { type });
  }

  function photoCount() {
    const selectors = [
      '[data-testid*="photo" i] img:not([src=""])',
      '[class*="photo" i] img[src^="blob:"]',
      '[class*="photo" i] img[src^="https:"]',
      '[class*="image" i][class*="preview" i] img',
    ];
    return new Set(Array.from(document.querySelectorAll(selectors.join(","))).filter((image) => !image.closest("#a2e-ebay-panel")).map((image) => image.currentSrc || image.src)).size;
  }

  async function uploadPhotos(images) {
    if (!images?.length) return { ok: false, reason: "No usable source photos" };
    if (state.uploadConfirmed) return { ok: true, count: photoCount() };
    if (state.uploadStarted) return { ok: false, pending: true, reason: "Waiting for eBay to process photos" };
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((input) => /image|photo|jpg|jpeg|png/i.test(`${input.accept} ${input.id} ${input.name}`));
    const input = inputs[0] || document.querySelector('input[type="file"]');
    if (!input) return { ok: false, reason: "Photo uploader is not on this step yet" };

    const before = photoCount();
    const transfer = new DataTransfer();
    images.forEach((image, index) => transfer.items.add(dataUrlToFile(image, index)));
    state.uploadStarted = true;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    for (let check = 0; check < 30; check += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const count = photoCount();
      if (count >= Math.min(images.length, before + 1)) {
        state.uploadConfirmed = true;
        return { ok: true, count };
      }
    }
    state.uploadStarted = false;
    return { ok: false, reason: "eBay did not confirm the upload; retry is available" };
  }

  function setStatus(label, ok, detail) {
    const row = document.querySelector(`[data-a2e-status="${label}"]`);
    if (!row) return;
    row.className = `a2e-status-row ${ok ? "a2e-ok" : "a2e-step-pending"}`;
    row.textContent = `${ok ? "✓" : "…"} ${detail || label}`;
  }

  function requiredReady(listing) {
    const needsSpecifics = Object.keys(listing.specifics || {}).length > 0;
    return state.filled.has("title") && state.filled.has("description") && state.filled.has("price") &&
      state.filled.has("condition") && state.filled.has("shipping") && state.uploadConfirmed &&
      (!needsSpecifics || state.filled.has("specifics"));
  }

  async function fillForm(listing) {
    const title = titleField();
    const price = priceField();
    if (!title && !price) return false;

    if (!state.filled.has("title") && title && setValue(title, listing.title.slice(0, title.maxLength > 0 ? title.maxLength : 80))) state.filled.add("title");
    if (!state.filled.has("description") && fillDescription(listing.description)) state.filled.add("description");
    if (!state.filled.has("price") && price && setValue(price, listing.price)) state.filled.add("price");
    if (!state.filled.has("specifics")) {
      state.specificCount = fillSpecifics(listing.specifics);
      if (state.specificCount) state.filled.add("specifics");
    }
    if (!state.filled.has("condition") && fillCondition()) state.filled.add("condition");
    if (!state.filled.has("shipping") && (!listing.settings.freeShipping || enableFreeShipping())) state.filled.add("shipping");

    setStatus("title", state.filled.has("title"), "Title");
    setStatus("description", state.filled.has("description"), "Editable description");
    setStatus("price", state.filled.has("price"), `Price $${listing.price}`);
    setStatus("specifics", state.filled.has("specifics"), `${state.specificCount} matching item specifics`);
    setStatus("shipping", state.filled.has("shipping"), "Free shipping");

    const photoResult = await uploadPhotos(listing.images);
    setStatus("photos", photoResult.ok, photoResult.ok ? `${listing.images.length} unique photos sent` : photoResult.reason);

    if (listing.settings.autoPublish && requiredReady(listing) && !state.published) {
      const publish = clickButton([/^list it$/, /^publish$/, /^submit listing$/], /preview|save|schedule/);
      if (publish) {
        state.published = true;
        setStatus("publish", true, "Listing submitted to eBay");
      }
    } else if (!listing.settings.autoPublish) {
      setStatus("publish", false, "Review mode: final List it click is left to you");
    }
    return true;
  }

  function buildPanel(listing) {
    if (document.getElementById("a2e-ebay-panel")) return;
    const panel = document.createElement("aside");
    panel.id = "a2e-ebay-panel";
    panel.className = "a2e-panel";
    panel.innerHTML = `
      <div class="a2e-panel-header"><span>eBay one-click listing</span><button type="button" class="a2e-panel-close">×</button></div>
      <div class="a2e-panel-title">${escapeHtml(listing.title)}</div>
      <div class="a2e-panel-meta">$${escapeHtml(listing.price)} · ${listing.images.length} unique photos · ${listing.aiUsed ? "AI enhanced" : "clean fallback"}</div>
      <div class="a2e-panel-status">
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="flow">… Finding the correct eBay step</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="title">… Title</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="description">… Editable description</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="price">… Price</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="specifics">… Item specifics</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="shipping">… Free shipping</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="photos">… Photos</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="publish">… Final submission</div>
      </div>
      <div class="a2e-panel-actions"><button type="button" data-a2e-action="retry">Retry now</button><button type="button" data-a2e-action="toggle">Pause</button></div>
      ${listing.aiWarning ? `<div class="a2e-status-note">AI was unavailable, so the accurate local fallback was used.</div>` : ""}
    `;
    document.body.appendChild(panel);
    panel.querySelector(".a2e-panel-close").addEventListener("click", () => panel.remove());
    panel.querySelector('[data-a2e-action="retry"]').addEventListener("click", () => { state.searchSubmitted = false; state.choiceClicked = false; state.uploadStarted = false; advance(listing); });
    panel.querySelector('[data-a2e-action="toggle"]').addEventListener("click", (event) => { state.running = !state.running; event.currentTarget.textContent = state.running ? "Pause" : "Resume"; if (state.running) advance(listing); });
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value || "";
    return div.innerHTML;
  }

  async function advance(listing) {
    if (!state.running || state.busy) return;
    state.busy = true;
    try {
      if (await fillForm(listing)) {
        setStatus("flow", true, "Listing form found and filled");
        return;
      }

      const search = searchField();
      if (search && !state.searchSubmitted) {
        setValue(search, listing.title);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const submitted = clickButton([/get started/, /^search$/, /^continue$/, /^start listing$/], /cancel|back/);
        if (submitted) {
          state.searchSubmitted = true;
          setStatus("flow", true, "Product search submitted automatically");
          return;
        }
      }

      if (!state.choiceClicked && chooseBestMatch(listing.title)) {
        state.choiceClicked = true;
        setStatus("flow", true, "Best catalog match/category path selected");
        return;
      }

      if (!search && clickButton([/^continue$/, /^done$/, /^create listing$/], /cancel|back|without match/)) {
        setStatus("flow", true, "Advanced to the next listing step");
      } else {
        setStatus("flow", false, "Waiting for eBay’s next form step");
      }
    } finally {
      state.busy = false;
    }
  }

  function getListing() {
    const id = new URLSearchParams(location.search).get("a2e");
    return new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_ACTIVE_LISTING", id }, (response) => resolve(response?.listing || null)));
  }

  const isSellerFlow = /\/(?:sl|lstng|sell|listing)(?:\/|$)/i.test(location.pathname) || new URLSearchParams(location.search).has("a2e");
  if (!Core || !/ebay\./i.test(location.hostname) || !isSellerFlow) return;
  getListing().then((listing) => {
    if (!listing || Date.now() - listing.createdAt > MAX_AGE) return;
    buildPanel(listing);
    if (!listing.settings.autoStart) state.running = false;
    setInterval(() => advance(listing), 1400);
    advance(listing);
  });
})();
