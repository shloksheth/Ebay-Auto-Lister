const DEFAULTS = { aiEnabled: false, apiKey: "", model: "gpt-5-mini", multiplier: 1.6, freeShipping: true, autoStart: true, autoPublish: false };

async function restore() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  for (const [key, value] of Object.entries(settings)) {
    const input = document.getElementById(key);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
  }
}

async function save() {
  const settings = {
    aiEnabled: document.getElementById("aiEnabled").checked,
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim() || DEFAULTS.model,
    multiplier: Number(document.getElementById("multiplier").value) || DEFAULTS.multiplier,
    freeShipping: document.getElementById("freeShipping").checked,
    autoStart: document.getElementById("autoStart").checked,
    autoPublish: document.getElementById("autoPublish").checked,
  };
  await chrome.storage.local.set(settings);
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1800);
}

document.getElementById("save").addEventListener("click", save);
restore();
