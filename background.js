// Handles:
//  1. DOWNLOAD_IMAGES  - saving product photos straight to disk (existing feature).
//  2. PREPARE_EBAY_LISTING - fetching product photos as base64 (using the
//     extension's cross-origin fetch privileges, so no CORS problems),
//     stashing everything in chrome.storage.local, and opening a new eBay
//     tab. The eBay-side content script (ebay-content.js) then reads this
//     data and fills in the listing form.

const PENDING_LISTING_KEY = "pendingListing";
const MAX_IMAGES_FOR_EBAY = 12; // eBay listings commonly cap around this

function guessExtension(url, blobType) {
  const fromUrl = url.match(/\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i);
  if (fromUrl) return fromUrl[1].toLowerCase();
  if (blobType && blobType.includes("/")) return blobType.split("/")[1];
  return "jpg";
}

function bufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize)
    );
  }
  return btoa(binary);
}

async function fetchImageAsDataUrl(url, index) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = bufferToBase64(buffer);
    const mime = blob.type || "image/jpeg";
    const ext = guessExtension(url, blob.type);
    return {
      dataUrl: `data:${mime};base64,${base64}`,
      filename: `photo-${String(index + 1).padStart(2, "0")}.${ext}`,
    };
  } catch (err) {
    console.warn("Amazon → eBay Lister Helper: image fetch failed", url, err);
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DOWNLOAD_IMAGES") {
    const { folder, urls } = message;
    let started = 0;

    urls.forEach((url, index) => {
      let ext = "jpg";
      const extMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i);
      if (extMatch) ext = extMatch[1].toLowerCase();

      const filename = `${folder}/photo-${String(index + 1).padStart(
        2,
        "0"
      )}.${ext}`;

      chrome.downloads.download(
        { url, filename, conflictAction: "uniquify", saveAs: false },
        () => {
          if (chrome.runtime.lastError) {
            console.warn(
              "Amazon → eBay Lister Helper: failed to download",
              url,
              chrome.runtime.lastError.message
            );
          }
        }
      );
      started += 1;
    });

    sendResponse({ count: started });
    return true;
  }

  if (message.type === "PREPARE_EBAY_LISTING") {
    const { title, description, price, imageUrls } = message;
    const urlsToFetch = (imageUrls || []).slice(0, MAX_IMAGES_FOR_EBAY);

    Promise.all(urlsToFetch.map((url, i) => fetchImageAsDataUrl(url, i)))
      .then((results) => {
        const images = results.filter(Boolean);
        const pendingListing = {
          title,
          description,
          price,
          images,
          createdAt: Date.now(),
        };
        return chrome.storage.local
          .set({ [PENDING_LISTING_KEY]: pendingListing })
          .then(() => images);
      })
      .then((images) => {
        chrome.tabs.create({ url: "https://www.ebay.com/sl/sell" });
        sendResponse({ ok: true, imageCount: images.length });
      })
      .catch((err) => {
        console.error(
          "Amazon → eBay Lister Helper: failed to prepare listing",
          err
        );
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // keep the message channel open for the async response
  }
});
