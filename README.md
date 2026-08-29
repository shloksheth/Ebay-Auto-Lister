# Amazon → eBay Lister Helper

A Chrome extension that adds two small buttons next to the product title on
Amazon product pages:

**📋 Clipboard button**
1. **Copies a ready-to-paste description** (title, price, bullet features,
   product description, and spec table when present) to your clipboard so
   you can paste it straight into an eBay listing.
2. **Downloads all of the product's photos** (full resolution, not the tiny
   thumbnails) into a folder named after the product, inside your normal
   Downloads folder.

**📤 eBay button**
Grabs the title, description, price, and photos and sends them straight to
an eBay tab. A small floating panel appears on the eBay page with an
**"Autofill this form"** button — click it once you're on the listing page
with the title/description/price/photo fields visible, and it fills them in
for you. It never submits or publishes the listing automatically — you
always review and click eBay's own "List it" button yourself.

## Install (Developer Mode — no Chrome Web Store needed)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `amazon-to-ebay-helper` folder.
5. The extension is now active. No further setup needed.

## Use it

### Copy + download (clipboard button)
1. Go to any Amazon product page (`amazon.com/.../dp/...`).
2. Click the clipboard icon next to the title.
3. The description is copied to your clipboard, and all product photos start
   downloading into `Downloads/<product-name>/photo-01.jpg`, etc.

### Send to eBay (second button)
1. Click the second (upload-arrow) icon next to the title.
2. A new eBay tab opens (`ebay.com/sl/sell`) and your data is handed off in
   the background.
3. On the eBay tab, start (or continue) creating your listing as normal —
   search for the item / pick a category until you reach the actual listing
   form with title, description, price, and photo fields.
4. A small panel appears in the bottom-right corner of the eBay page. Click
   **"Autofill this form"**. It will report which fields it managed to fill
   (✓) and which it couldn't find (✗) so you can finish those manually.
5. **Review everything** — title length/wording, description formatting,
   price, and that all photos attached correctly — before you click eBay's
   own submit/"List it" button. The extension never publishes anything for
   you.

## Notes & limitations

- Only runs on `amazon.com` / `ebay.com` by default. For other regional
  domains (e.g. `amazon.co.uk`, `ebay.co.uk`), add matching entries to
  `host_permissions` and `content_scripts` in `manifest.json`.
- Amazon and eBay both change their page markup fairly often. If a listing
  uses an unusual layout, the description/images might be incomplete, or the
  eBay autofill might miss a field — open the browser console (`F12`) for
  warnings, and feel free to tweak the selectors in `content.js` /
  `ebay-content.js`.
- The eBay autofill uses generic heuristics (field names, labels, aria
  attributes) rather than eBay-specific hooks, since eBay doesn't offer a
  listing-creation API for this kind of use. It's a best-effort autofill,
  not guaranteed to work on every listing flow eBay shows you.
- Downloads use Chrome's built-in downloads API, so they'll follow whatever
  "ask where to save each file" setting you already have. Turn that off in
  `chrome://settings/downloads` for silent bulk downloads.
- The eBay panel ignores handoff data older than 20 minutes, so if you sit
  on the eBay tab too long before clicking Autofill, just go back to the
  Amazon tab and click the eBay button again.
- This is for your own personal reselling workflow — always make sure you
  have the right to reuse a seller's photos/description before listing on
  eBay.

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration (Manifest V3) |
| `content.js` | Amazon page: injects both buttons, scrapes title/description/price/images |
| `ebay-content.js` | eBay page: shows the autofill panel, fills in the form fields |
| `background.js` | Service worker: downloads photos, and fetches+relays data for the eBay handoff |
| `styles.css` | Styling for the buttons, toast, and eBay-side panel |
| `icons/` | Toolbar/extension icons |
