# Marketplace → eBay Lister Helper

A Chrome extension that adds two small buttons next to the product title on
**Amazon**, **Walmart**, **AliExpress**, and **eBay** product/item pages:

**📋 Clipboard button**
1. **Copies a ready-to-paste description** (title, price, bullet features,
   description, and spec table when present) to your clipboard.
2. **Downloads all of the product's photos at their best available
   quality — with duplicates removed.** Each site embeds the same photo
   multiple times at different sizes (thumbnail, large, hi-res, zoom); the
   extension figures out which URLs point to the *same* photo and keeps
   only the highest-quality copy of each one, instead of downloading every
   size variant.

**📤 eBay button**
Grabs the title, description, price, and photos and sends them to a new
eBay listing tab, with an autofill panel to drop them into the listing
form. See "Send to eBay" below for details.

## Install (Developer Mode — no Chrome Web Store needed)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `amazon-to-ebay-helper` folder
   (the one that directly contains `manifest.json`).
5. The extension is now active. No further setup needed.

## Use it

### Copy + download (clipboard button)
1. Go to a product page on Amazon, Walmart, AliExpress, or an item page on
   eBay.
2. Click the clipboard icon next to the title.
3. The description is copied to your clipboard, and the product's photos
   (deduped, best quality) start downloading into
   `Downloads/<product-name>/photo-01.jpg`, etc.

### Send to eBay (second button)
1. Click the second (upload-arrow) icon next to the title.
2. A new eBay tab opens (`ebay.com/sl/sell`) and your data is handed off in
   the background.
3. A panel appears bottom-right on the eBay tab. **Step 1** happens
   automatically: it finds eBay's "what are you selling?" search box and
   types the product title in for you (shortened if it's over eBay's
   character limit — it'll tell you). eBay requires you to pick a catalog
   match / category yourself here — that part needs your judgment.
4. Once you reach the actual listing form (title, description, price, photo
   fields), click **"Autofill listing details"** in the panel (**Step 2**).
   It reports which fields it filled (✓) and which it couldn't confirm (✗),
   including checking the page a moment later to see whether photos
   actually appeared, not just whether it tried to attach them.
5. **Review everything** before you click eBay's own submit/"List it"
   button. The extension never publishes anything for you.

## Notes & limitations

- Only runs on `amazon.com`, `walmart.com`, `aliexpress.com`, and `ebay.com`
  by default. For other regional domains (e.g. `amazon.co.uk`,
  `walmart.ca`), add matching entries to `host_permissions` and
  `content_scripts` in `manifest.json`.
- These sites change their page markup fairly often. If a listing uses an
  unusual layout, extraction might be incomplete for that page — open the
  browser console (`F12`) for warnings, and feel free to tweak the
  selectors for that site's adapter in `content.js`.
- AliExpress and eBay item pages sometimes render their long description as
  images/an iframe rather than plain text — in that case the extracted
  description may be shorter than what's visible on the page (the photos
  themselves are unaffected).
- The eBay autofill uses generic heuristics (field names, labels, aria
  attributes) rather than an official API — eBay doesn't provide one for
  this kind of use — so it's best-effort, not guaranteed on every layout.
- Downloads use Chrome's built-in downloads API, so they'll follow whatever
  "ask where to save each file" setting you already have. Turn that off in
  `chrome://settings/downloads` for silent bulk downloads.
- The eBay panel ignores handoff data older than 20 minutes.
- This is for your own personal reselling workflow — always make sure you
  have the right to reuse a seller's photos/description before listing on
  eBay.

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration (Manifest V3) |
| `content.js` | Source-site buttons + per-site adapters (Amazon/Walmart/AliExpress/eBay item pages) |
| `ebay-content.js` | eBay sell-flow page: autofill panel |
| `background.js` | Service worker: downloads photos, fetches+relays data for the eBay handoff |
| `styles.css` | Styling for the buttons, toast, and eBay-side panel |
| `icons/` | Toolbar/extension icons |
