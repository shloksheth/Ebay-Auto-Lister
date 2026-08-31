(function () {
  "use strict";

  const Core = globalThis.A2ECore;
  const MAX_AGE = 2 * 60 * 60 * 1000;
  const state = {
    running: true,
    busy: false,
    searchSubmitted: false,
    choiceClicked: false,
    conditionChoiceClicked: false,
    uploadAttempted: false,
    uploadStarted: false,
    uploadConfirmed: false,
    photoBefore: 0,
    published: false,
    suggestedApplied: false,
    specificCount: 0,
    specificTotal: 0,
    formDetectedAt: 0,
    descriptionSeeded: false,
    specificsDone: false,
    nextSpecificAt: 0,
    specificAttempts: new Map(),
    filled: new Set(),
  };

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
    return Array.from(document.querySelectorAll('button, a[href], input[type="submit"], input[type="button"], [role="button"]')).filter((element) => visible(element) && !element.disabled && !isHeader(element));
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

  function quantityField() {
    return Array.from(document.querySelectorAll("input")).find((input) => {
      if (!visible(input) || input.disabled || isHeader(input) || /^attributes\./i.test(input.name || "")) return false;
      const labels = input.labels ? Array.from(input.labels).map((label) => label.textContent).join(" ") : "";
      return normalized(input.getAttribute("aria-label") || labels || input.name || input.id) === "quantity";
    }) || null;
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
    const actionRegex = /sell (?:one|this)|select|list this|use this|choose|start with this|use this title/;
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
    return continueWithoutMatch();
  }

  function continueWithoutMatch() {
    return Boolean(clickButton([
      /^continue without (?:a )?match(?:ing item)?$/,
      /^continue without selecting (?:a )?match$/,
      /^create (?:a )?new listing$/,
      /^create listing without (?:a )?match$/,
      /^list (?:it )?without (?:a )?match$/,
      /don['’]t see (?:a )?match.*continue/,
    ], /cancel|back|search again/));
  }

  function descriptionHtml(value) {
    const escape = (text) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const lines = String(value || "").split(/\r?\n/).map((line) => Core.cleanText(line));
    let html = "";
    let inList = false;
    lines.forEach((line, index) => {
      if (!line) {
        if (inList) { html += "</ul>"; inList = false; }
        return;
      }
      if (/^[•*-]\s+/.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${escape(line.replace(/^[•*-]\s+/, ""))}</li>`;
        return;
      }
      if (inList) { html += "</ul>"; inList = false; }
      if (index === 0) html += `<h2>${escape(line)}</h2>`;
      else if (/^(Overview|Key Features|Specifications)$/i.test(line)) html += `<h3>${escape(line)}</h3>`;
      else html += `<p>${escape(line)}</p>`;
    });
    if (inList) html += "</ul>";
    return html;
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

  function insertEditableHtml(editable, value) {
    const html = descriptionHtml(value);
    editable.focus();
    let inserted = false;
    try {
      const selection = editable.ownerDocument.getSelection();
      const range = editable.ownerDocument.createRange();
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = editable.ownerDocument.execCommand("insertHTML", false, html);
    } catch (_) {}
    if (!inserted) editable.innerHTML = html;
    editable.setAttribute("contenteditable", "true");
    editable.removeAttribute("aria-disabled");
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
    editable.dispatchEvent(new Event("change", { bubbles: true }));
    return normalized(editable.textContent).length >= 40;
  }

  function descriptionEditable() {
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"][contenteditable]')).filter(visible);
    const editable = editables.find((element) => /desc|describe/.test(describe(element) + " " + normalized(element.closest("section,div")?.querySelector("label,h2,h3")?.textContent))) || editables[0];
    if (editable) return editable;
    for (const frame of document.querySelectorAll("iframe")) {
      if (!/desc|editor|summary|rte/i.test(`${frame.id} ${frame.name} ${frame.title}`)) continue;
      try { if (frame.contentDocument?.body) return frame.contentDocument.body; } catch (_) {}
    }
    return null;
  }

  function fillDescription(description) {
    const textarea = findField([/description/, /describe.*item/], "textarea");
    if (textarea) return setValue(textarea, description);

    const editable = descriptionEditable();
    if (editable) return insertEditableHtml(editable, description);
    return false;
  }

  function selectValue(select, wanted) {
    const target = normalized(wanted);
    const options = Array.from(select.options);
    const exact = options.find((option) => normalized(option.textContent) === target);
    const partial = options.find((option) => normalized(option.textContent).includes(target) || target.includes(normalized(option.textContent)));
    return setValue(select, (exact || partial)?.value || "");
  }

  const SPECIFIC_ALIASES = {
    "Brand Name": "Brand",
    Manufacturer: "Brand",
    "Item model number": "Model",
    "Model Name": "Model",
    "Connectivity Technology": "Connectivity",
    "Special Feature": "Features",
    "Special Features": "Features",
    "Part Number": "MPN",
    "Manufacturer Part Number": "MPN",
    "Country/Region of Manufacture": "Country of Origin",
  };

  function specificControl(key) {
    const wanted = SPECIFIC_ALIASES[key] || key;
    const exactName = `attributes.${wanted}`;
    const byName = Array.from(document.querySelectorAll("input,textarea,select,button")).find((element) => visible(element) && element.getAttribute("name") === exactName);
    if (byName) return { field: byName, key: wanted };
    const byAria = Array.from(document.querySelectorAll("input,textarea,select,button")).find((element) => visible(element) && normalized(element.getAttribute("aria-label")) === normalized(wanted));
    return byAria ? { field: byAria, key: wanted } : null;
  }

  function pressEnter(element) {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
  }

  async function fillCustomSpecific(button, value) {
    if (normalized(buttonText(button)) === normalized(value)) return true;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    const optionCandidates = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [role="listbox"] button, [class*="menu" i] button, [class*="dropdown" i] button')).filter((element) => visible(element) && element !== button && !element.closest("#a2e-ebay-panel"));
    const target = normalized(value);
    const exact = optionCandidates.find((option) => normalized(option.textContent || option.getAttribute("aria-label")) === target);
    const partial = optionCandidates.find((option) => {
      const text = normalized(option.textContent || option.getAttribute("aria-label"));
      return text.length > 1 && (text.includes(target) || target.includes(text));
    });
    if (exact || partial) {
      (exact || partial).click();
      return true;
    }

    const overlayInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter((input) => visible(input) && !isHeader(input) && /search|enter|own|value|filter/i.test(describe(input)));
    const input = overlayInputs[overlayInputs.length - 1];
    if (input && setValue(input, value)) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      const newOptions = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [role="listbox"] button')).filter(visible);
      const match = newOptions.find((option) => normalized(option.textContent || option.getAttribute("aria-label")) === target) ||
        newOptions.find((option) => normalized(option.textContent || option.getAttribute("aria-label")).includes(target));
      if (match) match.click();
      else pressEnter(input);
      return true;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    return false;
  }

  async function fillSpecifics(specifics) {
    const priority = ["Brand", "Type", "Model", "Tracking Method", "Connectivity", "Features", "Color", "Number of Buttons", "Maximum DPI", "MPN", "Item Height", "Item Width", "Item Length", "Unit Quantity", "Unit Type", "Country of Origin", "Charger Included"];
    const source = Core.deriveEbaySpecifics(specifics, { specifics });
    const keys = [...priority, ...Object.keys(source)];
    const entries = [];
    const handled = new Set();
    for (const rawKey of keys) {
      const key = SPECIFIC_ALIASES[rawKey] || rawKey;
      if (handled.has(key) || !source[rawKey]) continue;
      handled.add(key);
      const match = specificControl(key);
      if (match) entries.push({ rawKey, key, value: source[rawKey], field: match.field });
    }

    const fieldValue = (field) => field instanceof HTMLSelectElement
      ? field.selectedOptions[0]?.textContent
      : field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? field.value
        : field.textContent;
    const isMatch = (entry) => {
      const expected = normalized(entry.value);
      const current = normalized(fieldValue(entry.field));
      return current === expected || (current.length > 1 && (current.includes(expected) || expected.includes(current)));
    };
    const currentResult = () => ({
      matched: entries.filter(isMatch).length,
      total: entries.length,
      done: entries.length > 0 && entries.every(isMatch),
    });

    if (!state.suggestedApplied) {
      let selected = 0;
      const suggestions = Array.from(document.querySelectorAll('input[name="extracted-attribute-selector"][type="checkbox"]'));
      suggestions.forEach((checkbox) => {
        const text = Core.cleanText(checkbox.getAttribute("aria-label") || (checkbox.labels ? Array.from(checkbox.labels).map((label) => label.textContent).join(" ") : "") || checkbox.parentElement?.textContent);
        const match = text.match(/^\s*([^:]+):\s*(.+?)\s*$/);
        const wanted = match && Object.entries(source).find(([key, value]) => normalized(key) === normalized(match[1]) && normalized(value) === normalized(match[2]));
        if (checkbox.checked && !wanted) checkbox.click();
        if (wanted && !checkbox.checked) checkbox.click();
        if (wanted) selected += 1;
      });
      const applyAll = buttons().find((button) => /^apply all$/.test(buttonText(button)));
      if (applyAll && selected) {
        applyAll.click();
        state.nextSpecificAt = Date.now() + 1200;
      }
      state.suggestedApplied = true;
      return currentResult();
    }

    const before = currentResult();
    if (before.done || Date.now() < state.nextSpecificAt) return before;

    const next = entries.find((entry) => !isMatch(entry) && (state.specificAttempts.get(entry.key) || 0) < 2);
    if (!next) return { ...before, exhausted: true };

    state.specificAttempts.set(next.key, (state.specificAttempts.get(next.key) || 0) + 1);
    state.nextSpecificAt = Date.now() + 1200;
    if (next.field instanceof HTMLSelectElement) selectValue(next.field, next.value);
    else if (next.field instanceof HTMLInputElement || next.field instanceof HTMLTextAreaElement) setValue(next.field, next.value);
    else if (next.field instanceof HTMLButtonElement) await fillCustomSpecific(next.field, next.value);
    return currentResult();
  }

  function chooseNewestConditionOption() {
    const pageMentionsCondition = /\bcondition\b/i.test(`${document.querySelector("main")?.textContent || ""} ${document.body.textContent || ""}`);
    if (!pageMentionsCondition) return null;
    const textFor = (control) => Core.cleanText(
      control.getAttribute("aria-label") ||
      (control.labels ? Array.from(control.labels).map((label) => label.textContent).join(" ") : "") ||
      control.textContent ||
      control.closest("label")?.textContent ||
      control.parentElement?.textContent
    );
    const clickable = [
      ...buttons(),
      ...Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).filter((input) => visible(input) && !input.disabled),
    ];
    const candidates = clickable.filter((control) => {
      const text = textFor(control);
      return text.length <= 90 && /^(?:brand new|new(?:\b|\s+with)|open box\b|used(?:\b|\s+-)|pre-owned\b|for parts\b)/i.test(text) && !/continue|cancel|back|search/i.test(text) && !control.closest("#a2e-ebay-panel");
    }).sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top || left.getBoundingClientRect().left - right.getBoundingClientRect().left);
    if (!candidates.length) return null;
    const preferred = Core.rankConditionOptions(candidates.map(textFor));
    const choice = candidates.find((control) => textFor(control) === preferred) || candidates[0];
    choice.click();
    choice.dataset.a2eConditionText = textFor(choice);
    return choice;
  }

  function fillCondition() {
    const select = findField([/condition/], "select");
    if (select) {
      const preferred = Core.rankConditionOptions(Array.from(select.options).map((option) => option.textContent));
      return preferred ? selectValue(select, preferred) : false;
    }
    const conditionInputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).filter((input) => visible(input) && /\bcondition\b|\bnew\b|\bused\b/i.test(describe(input)));
    const preferred = Core.rankConditionOptions(conditionInputs.map((input) => Core.cleanText(input.labels ? Array.from(input.labels).map((label) => label.textContent).join(" ") : describe(input))));
    const newInput = conditionInputs.find((input) => normalized(input.labels ? Array.from(input.labels).map((label) => label.textContent).join(" ") : describe(input)) === normalized(preferred));
    if (newInput && !newInput.checked) newInput.click();
    if (newInput) return true;
    const current = buttons().find((button) => /^new$/.test(buttonText(button)) && /condition/i.test(`${button.getAttribute("aria-label")} ${button.closest("section,div")?.textContent || ""}`));
    if (current) return true;
    return Boolean(clickButton([/^new with (?:box(?:\s*(?:\/|or)\s*papers?)?|tags|papers?)$/, /^brand new$/, /^new(?: item condition)?$/], /without|other|like new|new other/));
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
    const editButtons = document.querySelectorAll('button[aria-label^="Edit or view photo "]');
    if (editButtons.length) return editButtons.length;
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
    const currentCount = photoCount();
    if (!state.uploadAttempted && currentCount >= Math.min(images.length, 24)) {
      state.uploadConfirmed = true;
      return { ok: true, count: currentCount };
    }
    if (state.uploadConfirmed || (state.uploadAttempted && currentCount > state.photoBefore)) {
      state.uploadConfirmed = true;
      return { ok: true, count: currentCount };
    }
    if (state.uploadAttempted) return { ok: false, reason: "Photo batch was sent once; not resending to prevent duplicates" };
    if (state.uploadStarted) return { ok: false, pending: true, reason: "Waiting for eBay to process photos" };
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((input) => /image|photo|jpg|jpeg|png/i.test(`${input.accept} ${input.id} ${input.name}`));
    const input = inputs[0] || document.querySelector('input[type="file"]');
    if (!input) return { ok: false, reason: "Photo uploader is not on this step yet" };

    const before = currentCount;
    const transfer = new DataTransfer();
    images.forEach((image, index) => transfer.items.add(dataUrlToFile(image, index)));
    state.uploadStarted = true;
    state.uploadAttempted = true;
    state.photoBefore = before;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    for (let check = 0; check < 30; check += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const count = photoCount();
      if (count > before) {
        state.uploadConfirmed = true;
        state.uploadStarted = false;
        return { ok: true, count };
      }
    }
    state.uploadStarted = false;
    return { ok: false, reason: "Photo batch sent once; waiting for eBay without retrying" };
  }

  function setStatus(label, ok, detail) {
    const row = document.querySelector(`[data-a2e-status="${label}"]`);
    if (!row) return;
    row.className = `a2e-status-row ${ok ? "a2e-ok" : "a2e-step-pending"}`;
    row.textContent = `${ok ? "✓" : "…"} ${detail || label}`;
  }

  function requiredReady(listing) {
    const descriptionReady = state.filled.has("description");
    return state.filled.has("title") && descriptionReady && state.filled.has("price") &&
      state.filled.has("quantity") && state.filled.has("condition") && state.filled.has("shipping") && state.uploadConfirmed &&
      state.specificsDone && (state.specificTotal === 0 || state.filled.has("specifics"));
  }

  async function fillForm(listing) {
    const title = titleField();
    const price = priceField();
    if (!title && !price) return false;
    if (!state.formDetectedAt) state.formDetectedAt = Date.now();

    if (!state.filled.has("title") && title && setValue(title, listing.title.slice(0, title.maxLength > 0 ? title.maxLength : 80))) state.filled.add("title");
    if (!state.descriptionSeeded && fillDescription(listing.description)) {
      state.descriptionSeeded = true;
      state.filled.add("description");
    }
    if (!state.filled.has("price") && price && setValue(price, listing.price)) state.filled.add("price");
    const quantity = quantityField();
    if (!state.filled.has("quantity") && quantity && setValue(quantity, String(listing.quantity || 11))) state.filled.add("quantity");
    const specificsWait = Math.max(0, 4000 - (Date.now() - state.formDetectedAt));
    if (!state.specificsDone && specificsWait === 0) {
      const result = await fillSpecifics(listing.specifics);
      state.specificCount = result.matched;
      state.specificTotal = result.total;
      if (result.done) state.filled.add("specifics");
      if (result.done || result.exhausted) state.specificsDone = true;
    }
    if (!state.filled.has("condition") && fillCondition()) state.filled.add("condition");
    if (!state.filled.has("shipping") && (!listing.settings.freeShipping || enableFreeShipping())) state.filled.add("shipping");

    setStatus("title", state.filled.has("title"), "Title");
    setStatus("description", state.filled.has("description"), `${listing.generator || "Premium"} description (editable)`);
    setStatus("price", state.filled.has("price"), `Price $${listing.price}`);
    setStatus("quantity", state.filled.has("quantity"), `Quantity ${listing.quantity || 11}`);
    setStatus("specifics", state.filled.has("specifics"), specificsWait > 0 ? `Waiting ${Math.ceil(specificsWait / 1000)}s for eBay item specifics` : state.specificsDone && !state.filled.has("specifics") ? `${state.specificCount}/${state.specificTotal} specifics filled; retries stopped` : `${state.specificCount}/${state.specificTotal || "?"} source-backed item specifics`);
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
      <div class="a2e-panel-meta">$${escapeHtml(listing.price)} · ${listing.images.length} unique photos · ${escapeHtml(listing.generator || (listing.aiUsed ? "AI enhanced" : "local premium generator"))}</div>
      <div class="a2e-panel-status">
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="flow">… Finding the correct eBay step</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="title">… Title</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="description">… Editable description</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="price">… Price</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="quantity">… Quantity 11</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="specifics">… Item specifics</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="shipping">… Free shipping</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="photos">… Photos</div>
        <div class="a2e-status-row a2e-step-pending" data-a2e-status="publish">… Final submission</div>
      </div>
      <div class="a2e-panel-actions"><button type="button" data-a2e-action="retry">Retry now</button><button type="button" data-a2e-action="toggle">Pause</button></div>
      ${listing.aiWarning ? `<div class="a2e-status-note">${escapeHtml(listing.aiWarning)}. A clean editable fallback was used.</div>` : ""}
    `;
    document.body.appendChild(panel);
    panel.querySelector(".a2e-panel-close").addEventListener("click", () => panel.remove());
    panel.querySelector('[data-a2e-action="retry"]').addEventListener("click", () => { state.searchSubmitted = false; state.choiceClicked = false; state.conditionChoiceClicked = false; advance(listing); });
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

      const started = clickButton([/^list an item$/, /^sell now$/], /draft|delete/);
      if (started) {
        setStatus("flow", true, "Opened eBay’s item listing form");
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

      if (!state.conditionChoiceClicked) {
        const condition = chooseNewestConditionOption();
        if (condition) {
          state.conditionChoiceClicked = true;
          setStatus("flow", true, `Selected ${condition.dataset.a2eConditionText || Core.cleanText(condition.textContent || condition.getAttribute("aria-label"))}`);
          return;
        }
      }

      if (state.conditionChoiceClicked) {
        const continued = clickButton([/^continue to listing$/, /^continue$/], /cancel|back/);
        if (continued) {
          setStatus("flow", true, "Condition confirmed; opening the listing form");
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
