# M Dropshipping Bulk Import 4.1.0

This Chrome extension reads a product page, prepares a structured eBay listing,
opens eBay's seller flow, and automatically advances through the forms it can
identify.

## Bulk Import Studio

Clicking the extension icon now opens a full-page bulk dashboard. Paste one or
more supported marketplace product links, then choose **Import links and
variants**. The importer uses temporary inactive tabs to load each page with its
normal browser environment, extracts title, current price, description,
features, item specifics, high-resolution images, and discoverable Amazon
variant ASINs, then closes each temporary tab.

Every successfully imported base product and variant appears in a review grid.
Use **Select all** or choose individual products, then select **Add selected to
eBay**. Each selected product receives its own isolated eBay automation tab, so
one item cannot overwrite another. Imported products remain saved locally in
the dashboard until cleared. A 150-product import safety limit prevents a bad
variant graph from creating an unbounded queue.

## What changed in 4.1

- Final titles remain grounded in the original marketplace title and target
  75–80 characters when enough verified product facts are available.
- Missing source brands are entered as eBay's accepted **Unbranded** value.
- Item-specific dropdowns now wait for eBay's menu, verify the selected value,
  and retry a bounded three times instead of silently counting a click.
- Descriptions are committed through eBay's **Show HTML Code** form field so
  eBay's validation state receives the content; the normal editor remains
  editable after the HTML is committed.

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
- Chrome's on-device model writes an accurate title of at most 80 characters
  and a clean description. A deterministic local fallback is always available.
- Automatic final publication is a separate, off-by-default safety setting.
- The Chrome toolbar/extension icons use the M Dropshipping parachute package
  mark, with transparent 16, 48, and 128 pixel versions.

## What changed in 3.1

- Photo upload is now strictly one-shot. Only the file input's `change` event
  is dispatched, and a timed-out verification never resends the batch.
- Verification counts eBay's real **Edit or view photo N** controls, preventing
  the retry loop that produced 24 accepted duplicates and many failed uploads.
- Only eBay-supported JPEG, PNG, or HEIC files are prepared for listing.
- Amazon A+ scripts, CSS, templates, and hidden code are removed before any
  description is generated.
- A built-in no-key premium generator produces an optimized title, overview,
  feature list, and product-details section.
- Dimensions such as `4.2 x 2.9 x 3.1 inches` are converted to eBay Item
  Length, Width, and Height values; common Amazon labels are mapped to eBay's
  Brand, Model, MPN, Connectivity, Features, and other controls.
- Current eBay `attributes.*` custom dropdowns and text fields are filled by
  their exact accessible names, and eBay's suggested specifics are applied.
- New listings open directly at `/sl/prelist/suggest`; the landing-page
  **List an item**/**Sell now** buttons remain automated as a fallback.
- Pre-list condition choices prioritize **New with box**, **New with tags**,
  **New with papers**, **Brand new**, then **New**.

## What changed in 3.2

- Item-specific dropdowns now recognize eBay's current `menuitemradio`
  controls, including searchable values such as Brand and Color.
- The completion check counts only source-backed fields whose actual eBay value
  matches the extracted value. Unrelated prefilled fields no longer create a
  false success checkmark.
- Suggested specifics are applied only when both their name and value exactly
  match the product source. Guesses such as heart-rate sensors on a sizing kit
  are left unchecked.
- The description is inserted as editable rich text with a concise Overview,
  up to five Key Features, and verified Specifications. Marketplace checkout
  claims and generic boilerplate are removed.
- Chrome's on-device Gemini Nano model writes the title, overview, and key
  features from verified product facts. It uses Chrome's Prompt API, requires
  no API key, and does not use eBay AI.
- Condition-choice screens rank **New with box and papers** first, then other
  brand-new choices, then the top option shown by eBay.
- Condition confirmation modals using radio buttons are supported, including
  eBay's **New**, **Open box**, **Used**, and **For parts** screen. The extension
  selects the best new option and clicks **Continue to listing**.
- Watch, jewelry, and collectible condition screens explicitly prioritize
  **New with box and papers** over a plain **New** choice. When eBay cannot find
  a suitable catalog product, the extension selects **Continue without match**
  (including eBay's alternate wording) and proceeds with a new listing.
- The listing form now waits four seconds for eBay's template to populate item
  specifics, changes only one unmatched field per pass, and stops after two
  failed attempts per field instead of cycling through dropdowns forever.
- Descriptions are seeded only once and remain editable after eBay's free,
  built-in AI finishes. Promotional boilerplate and buyer-directed marketplace
  text receive stricter filtering.
- Listing quantity is always set to **11**.
- eBay catalog matches are now always skipped. This prevents an accessory or
  visually similar product from replacing the source title, category, photos,
  or item specifics.
- Product-identity checks prevent bundled words such as "keyboard and mouse"
  from turning a desktop PC listing into a mouse listing.
- Image files are compared by both cryptographic hash and a pixel-based visual
  fingerprint, catching the same photo served at different sizes or quality.
  A resumed draft with existing photos never receives the batch again.
- The on-device AI performs a second quality-review pass before the listing is
  accepted. Up to four useful, visually unique product images are also placed
  in the editable description.
- Each prepared product is bound to only the exact eBay tab opened for it.
  Other seller tabs cannot retrieve or apply that product. Revise/edit listing
  pages are explicitly blocked, and closing the floating panel now cancels the
  automation permanently instead of hiding it while it continues running.

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
- Leave **Chrome on-device AI** enabled. Open Extension options and click
  **Check or download AI model** once. Chrome downloads Gemini Nano to supported
  Windows, macOS, or Linux computers; generation then runs locally without a
  per-listing charge or API key.
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
| `background.js` | Image fetching/hash dedupe, on-device AI, storage, eBay tab |
| `ebay-content.js` | State-driven eBay flow and verified form filling |
| `bulk.html/js/css` | Bulk link import, recursive variant queue, review and selection dashboard |
| `options.html/js/css` | Settings and publish safety control |
| `styles.css` | Product buttons and eBay progress panel |
