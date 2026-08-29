// Handles downloading product photos requested by the content script.
// Runs in the background so downloads keep going even if the content
// script's fetches would otherwise be blocked, and so filenames can be
// organized into a per-product folder under the browser's Downloads dir.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "DOWNLOAD_IMAGES") return;

  const { folder, urls } = message;
  let started = 0;

  urls.forEach((url, index) => {
    let ext = "jpg";
    const extMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i);
    if (extMatch) ext = extMatch[1].toLowerCase();

    const filename = `${folder}/photo-${String(index + 1).padStart(2, "0")}.${ext}`;

    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      },
      () => {
        // chrome.runtime.lastError is checked to avoid unhandled promise
        // rejections when a single image URL fails (e.g. expired link).
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
});
