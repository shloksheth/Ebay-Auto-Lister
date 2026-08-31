const DEFAULTS = { useLocalAi: true, multiplier: 1.6, freeShipping: true, autoStart: true, autoPublish: false };

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
    multiplier: Number(document.getElementById("multiplier").value) || DEFAULTS.multiplier,
    freeShipping: document.getElementById("freeShipping").checked,
    useLocalAi: document.getElementById("useLocalAi").checked,
    autoStart: document.getElementById("autoStart").checked,
    autoPublish: document.getElementById("autoPublish").checked,
  };
  await chrome.storage.local.set(settings);
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1800);
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("initializeAi").addEventListener("click", async () => {
  const button = document.getElementById("initializeAi");
  const status = document.getElementById("aiStatus");
  button.disabled = true;
  status.textContent = "Checking Chrome’s AI model…";
  try {
    if (!globalThis.LanguageModel) throw new Error("Chrome on-device AI is unavailable in this browser");
    const options = {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    };
    let availability;
    try { availability = await LanguageModel.availability(options); }
    catch (_) { availability = await LanguageModel.availability(); }
    if (availability === "unavailable") throw new Error("This computer does not meet Chrome’s on-device AI requirements");
    const session = await LanguageModel.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          status.textContent = `Downloading AI model: ${Math.round((event.loaded || 0) * 100)}%`;
        });
      },
    });
    session.destroy();
    await chrome.storage.local.set({ useLocalAi: true, localAiDownloadProgress: 100 });
    document.getElementById("useLocalAi").checked = true;
    status.textContent = "AI model is ready";
  } catch (error) {
    status.textContent = error.message || "Could not initialize the AI model";
  } finally {
    button.disabled = false;
  }
});
restore();
