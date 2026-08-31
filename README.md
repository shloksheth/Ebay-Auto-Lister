# Amazon → eBay Lister Helper 3.0.1

This Chrome extension reads a product page, prepares a structured eBay listing,
opens eBay's seller flow, and automatically advances through the forms it can
identify.

## What changed in 3.0

- Photo URLs are ranked by quality and deduplicated by Amazon image ID.
- Photos fetched for eBay are deduplicated again by SHA-256 file hash.
- Only one eBay file input receives one upload batch, preventing duplicate
  attachments caused by firing both input and drop-zone handlers.
- The photo status becomes a check only after a new eBay preview appears.
- Descriptions are inserted as plain editable text. No copied scripts, HTML,
  source price, or locked replacement markup is used.
- Amazon overview, technical-detail, dimension, brand, model, color, and other
  fact tables are collected as structured item specifics.
- Price is `source price × multiplier` (1.6 by default), then rounded upward to
  the next price ending in `.99`.
- The eBay flow automatically searches the title, chooses a sufficiently close
  catalog match (or continues without one), fills the listing form, selects a
  new condition where available, and enables free shipping.
- Optional OpenAI enhancement writes an accurate title of at most 80 characters
  and a clean description. A deterministic local fallback is always available.
- Automatic final publication is a separate, off-by-default safety setting.
- The Chrome toolbar/extension icons use the M Dropshipping parachute package
  mark, with transparent 16, 48, and 128 pixel versions.

## Install or update

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder (the folder containing
   `manifest.json`). If an older copy is already loaded, remove it first or
   point it at this new folder, then click **Reload**.
4. The settings page opens on first install. You can reopen it by clicking the
   extension's toolbar icon or **Details → Extension options**.

## Configure

- Keep the price multiplier at `1.6` to use the requested pricing rule.
- Leave **free shipping** and **automatic form advance** enabled for the
  one-click workflow.
- To use AI, enable it and enter your own OpenAI API key and model name. The key
  is stored in `chrome.storage.local` inside your Chrome profile; it is never
  placed in this extension folder.
- Test several listings with **Automatically click List it** disabled. When
  enabled, the extension can publish and potentially incur eBay fees.

## Use

On a supported Amazon product page:

- The clipboard button copies a clean description and downloads unique photos.
- The upload button prepares the listing and opens eBay. The floating panel
  shows verified status for title, description, price, specifics, shipping,
  photos, and final submission.

The automation follows eBay's changing page structure using labels and semantic
hints rather than brittle generated class names. If eBay introduces a new
required choice, use the panel's **Retry now** button after making that choice.

## Important marketplace-policy note

eBay permits dropshipping from a wholesale supplier, but its published policy
says listing an item and then buying it from another retailer or marketplace to
ship directly to the customer is not allowed. Use this extension only for
inventory you control or a supplier/fulfillment arrangement that complies with
eBay's rules. You remain responsible for image and description rights, accurate
stock and delivery promises, returns, fees, and buyer satisfaction.

Policy: https://www.ebay.com/help/selling/posting-items/setting-postage-options/drop-shipping?id=4176

## Files

| File | Purpose |
|---|---|
| `core.js` | Tested text, pricing, title, description, and image helpers |
| `content.js` | Product extraction and Amazon-page buttons |
| `background.js` | Image fetching/hash dedupe, optional AI, storage, eBay tab |
| `ebay-content.js` | State-driven eBay flow and verified form filling |
| `options.html/js/css` | Settings and publish safety control |
| `styles.css` | Product buttons and eBay progress panel |
