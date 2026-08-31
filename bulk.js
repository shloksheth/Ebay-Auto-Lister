const state = { items: [], importing: false, sending: false };
const elements = {
  links: document.getElementById("links"), import: document.getElementById("import"), clear: document.getElementById("clear"),
  status: document.getElementById("importStatus"), products: document.getElementById("products"), empty: document.getElementById("empty"),
  selectAll: document.getElementById("selectAll"), send: document.getElementById("sendToEbay"), summary: document.getElementById("selectionSummary"),
  count: document.getElementById("importedCount"), settings: document.getElementById("settings"),
};

function sendMessage(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => {
    const error = chrome.runtime.lastError;
    error ? reject(new Error(error.message)) : resolve(response);
  }));
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function productKey(value) {
  try {
    const url = new URL(value);
    const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
    return asin ? `amazon:${asin.toUpperCase()}` : `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch (_) { return String(value || "").trim().toLowerCase(); }
}

function parseLinks(value) {
  return Array.from(new Set((String(value || "").match(/https:\/\/[^\s,]+/gi) || []).map((url) => url.replace(/[)\]}>]+$/, ""))));
}

async function persist() {
  await chrome.storage.local.set({ bulkImportedProducts: state.items });
}

function updateSelection() {
  const selected = state.items.filter((item) => item.selected).length;
  elements.summary.textContent = selected ? `${selected} of ${state.items.length} selected` : "Nothing selected";
  elements.send.disabled = !selected || state.sending || state.importing;
  elements.selectAll.checked = Boolean(state.items.length && selected === state.items.length);
  elements.selectAll.indeterminate = selected > 0 && selected < state.items.length;
}

function render() {
  elements.count.textContent = state.items.length;
  elements.empty.hidden = state.items.length > 0;
  elements.products.innerHTML = state.items.map((item) => {
    const image = item.product.images?.[0] || "icons/icon128.png";
    const variant = item.variantLabel ? `<span class="pill variant">${escapeHtml(item.variantLabel)}</span>` : "";
    const statusClass = item.statusType === "error" ? " error" : "";
    return `<article class="product" data-id="${escapeHtml(item.id)}">
      <input class="product-select" type="checkbox" ${item.selected ? "checked" : ""} aria-label="Select product">
      <img src="${escapeHtml(image)}" alt="">
      <div><h3>${escapeHtml(item.product.title)}</h3><div class="product-meta"><span class="pill">$${escapeHtml(item.product.sourcePrice?.toFixed?.(2) || item.product.sourcePrice)}</span><span class="pill">${item.product.images?.length || 0} photos</span>${variant}</div>
      <footer><a href="${escapeHtml(item.product.sourceUrl)}" target="_blank">View source</a><span class="product-status${statusClass}">${escapeHtml(item.status || "Ready")}</span></footer></div>
    </article>`;
  }).join("");
  elements.products.querySelectorAll(".product").forEach((card) => card.querySelector("input").addEventListener("change", async (event) => {
    const item = state.items.find((entry) => entry.id === card.dataset.id);
    if (item) item.selected = event.target.checked;
    updateSelection();
    await persist();
  }));
  updateSelection();
}

async function importProducts() {
  if (state.importing) return;
  const initialLinks = parseLinks(elements.links.value);
  if (!initialLinks.length) { elements.status.textContent = "Paste at least one HTTPS product link."; return; }
  state.importing = true;
  elements.import.disabled = true;
  elements.send.disabled = true;
  const seen = new Set(state.items.map((item) => productKey(item.product.sourceUrl)));
  const queue = initialLinks.map((url) => ({ url, groupId: crypto.randomUUID(), variantLabel: "", variantAttributes: {} }));
  let processed = 0;
  while (queue.length && processed < 150) {
    const task = queue.shift();
    const key = productKey(task.url);
    if (seen.has(key)) continue;
    seen.add(key);
    processed += 1;
    elements.status.textContent = `Importing ${processed}: ${task.url}`;
    try {
      const response = await sendMessage({ type: "EXTRACT_PRODUCT_URL", url: task.url });
      if (!response?.ok) throw new Error(response?.error || "Import failed");
      response.product.variantAttributes = { ...task.variantAttributes, ...(response.product.variantAttributes || {}) };
      const detectedLabel = Object.entries(response.product.variantAttributes).map(([name, value]) => `${name}: ${value}`).join(" · ");
      const item = { id: crypto.randomUUID(), groupId: task.groupId, variantLabel: detectedLabel || task.variantLabel, product: response.product, selected: true, status: "Ready" };
      state.items.push(item);
      for (const variant of response.product.variants || []) {
        if (!seen.has(productKey(variant.url))) queue.push({ url: variant.url, groupId: task.groupId, variantLabel: `${variant.dimension}: ${variant.label}`, variantAttributes: variant.attributes || { [variant.dimension || "Variation"]: variant.label } });
      }
      render();
      await persist();
    } catch (error) {
      state.items.push({ id: crypto.randomUUID(), groupId: task.groupId, variantLabel: task.variantLabel, product: { title: task.url, sourceUrl: task.url, sourcePrice: "—", images: [] }, selected: false, status: error.message || "Import failed", statusType: "error" });
      render();
    }
  }
  state.importing = false;
  elements.import.disabled = false;
  elements.status.textContent = queue.length ? "Stopped at the 150-product safety limit." : `Import complete: ${state.items.filter((item) => item.statusType !== "error").length} products ready.`;
  updateSelection();
  await persist();
}

async function sendSelectedToEbay() {
  if (state.sending) return;
  const selected = state.items.filter((item) => item.selected && item.statusType !== "error");
  if (!selected.length) return;
  state.sending = true;
  elements.send.disabled = true;
  const groups = Array.from(new Map(selected.map((item) => [item.groupId, selected.filter((candidate) => candidate.groupId === item.groupId)])).values());
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    group.forEach((item) => { item.status = `Preparing group ${index + 1}/${groups.length}`; });
    render();
    try {
      const response = group.length > 1
        ? await sendMessage({ type: "PREPARE_EBAY_VARIATION_LISTING", products: group.map((item) => item.product) })
        : await sendMessage({ type: "PREPARE_EBAY_LISTING", product: group[0].product });
      if (!response?.ok) throw new Error(response?.error || "Could not create eBay listing");
      group.forEach((item) => { item.status = response.variationCount ? `Opened as ${response.variationCount}-variation listing` : "Opened in eBay"; item.selected = false; });
    } catch (error) {
      group.forEach((item) => { item.status = error.message || "eBay preparation failed"; item.statusType = "error"; });
    }
    render();
    await persist();
  }
  state.sending = false;
  updateSelection();
}

elements.import.addEventListener("click", importProducts);
elements.clear.addEventListener("click", async () => { if (state.importing || state.sending) return; state.items = []; await persist(); render(); elements.status.textContent = "Imported products cleared."; });
elements.selectAll.addEventListener("change", async (event) => { state.items.forEach((item) => { if (item.statusType !== "error") item.selected = event.target.checked; }); render(); await persist(); });
elements.send.addEventListener("click", sendSelectedToEbay);
elements.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.local.get({ bulkImportedProducts: [] }).then(({ bulkImportedProducts }) => {
  state.items = Array.isArray(bulkImportedProducts) ? bulkImportedProducts : [];
  render();
});
