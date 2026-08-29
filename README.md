# Amazon → eBay Lister Helper

A Chrome extension that adds a small clipboard button next to the product
title on Amazon product pages. Click it and it will:

1. **Copy a ready-to-paste description** (title, price, bullet features,
   product description, and spec table when present) to your clipboard so
   you can paste it straight into an eBay listing.
2. **Download all of the product's photos** (full resolution, not the tiny
   thumbnails) into a folder named after the product, inside your normal
   Downloads folder.

## Install (Developer Mode — no Chrome Web Store needed)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `amazon-to-ebay-helper` folder.
5. The extension is now active. No further setup needed.

## Use it

1. Go to any Amazon product page (`amazon.com/.../dp/...`).
2. You'll see a small clipboard icon next to the product title.
3. Click it:
   - The description is copied to your clipboard — go paste it into eBay.
   - All product photos start downloading automatically into
     `Downloads/<product-name>/photo-01.jpg`, `photo-02.jpg`, etc.
   - A small confirmation toast appears next to the button.

## Notes & limitations

- Only runs on `amazon.com` pages by default. If you shop on another Amazon
  domain (e.g. `amazon.co.uk`, `amazon.de`), add a matching line to
  `host_permissions` and `content_scripts.matches` in `manifest.json`,
  e.g. `"*://*.amazon.co.uk/*"`.
- Amazon changes its page markup fairly often. If a listing uses an unusual
  layout, the description or image list might be incomplete — open the
  browser console (`F12`) for warnings, and feel free to tweak the selectors
  in `content.js`.
- Downloads use Chrome's built-in downloads API, so they'll follow whatever
  "ask where to save each file" setting you already have. If that setting is
  on, you may get a save prompt per image — turn it off in
  `chrome://settings/downloads` for silent bulk downloads.
- This is for your own personal reselling workflow — always make sure you
  have the right to reuse a seller's photos/description before listing on
  eBay.

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration (Manifest V3) |
| `content.js` | Injects the button, scrapes description & image URLs |
| `background.js` | Service worker that performs the actual file downloads |
| `styles.css` | Styling for the button and toast notification |
| `icons/` | Toolbar/extension icons |
