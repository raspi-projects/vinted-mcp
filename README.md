# Vinted MCP Server (raspi-projects fork)

An MCP server for buying well on Vinted. It finds underpriced listings, shows Claude a listing's photos
so it can check labels and logos, reports the full cost (price, Vinted fee, postage), and turns a
seller's profile, reviews and wardrobe into a trust report. A companion skill,
[`skills/vinted-deals`](skills/vinted-deals/SKILL.md), turns that into a deal-hunting and
authentication workflow, tuned for Ralph Lauren on Vinted UK.

Forked from [andrijdavid/vinted-mcp](https://github.com/andrijdavid/vinted-mcp) (AGPL-3.0-or-later).
This fork isn't published to npm; run it from a local build.

**Disclaimer**: not affiliated with, authorised or endorsed by Vinted. It reads Vinted's public web
pages and APIs, which Vinted's terms don't permit for automated use; keep request volumes low.

## What's different from upstream

- **Photos as images.** `get_item` attaches every photo (800px high), and `get_item_photos` fetches
  originals (usually 1200×1600) for reading care labels and checking stitching.
- **Deal finding.** `find_deals` samples up to 480 comparable listings, computes the spread of asking
  prices and returns the cheapest relative to the median, with thumbnails.
- **Seller trust report.** `get_seller` adds positive/neutral/negative counts, critical review texts, the
  oldest review date, location, bundle discounts, and a scan of the seller's listings for bulk
  new-with-tags stock and repeated titles. `flags` lists what stands out.
- **Full cost and Item Verification.** `get_item` reports the Vinted fee and postage from Vinted's
  pricing service, and whether Vinted's £10 Item Verification is offered (see the limits below).
- **QR labels.** Recent genuine Ralph Lauren pieces carry a gold label with a QR code. The server
  finds and decodes QR codes in a listing's original photos (zxing-wasm, no native code), says whether
  each links into RL's product-ID system (`q-rl.us`, `tn.gg`), and remembers codes it has seen
  (`~/.vinted-mcp/qr-seen.json`) so a code in another seller's listing is flagged as a copied label.
  Codes are decoded, never followed: opening one records a scan with RL, so that's the buyer's step.
- **Real filters.** `find_brand` resolves brand names to IDs (Ralph Lauren = 88, Polo Ralph Lauren =
  4273); `find_category` searches a snapshot of Vinted's real 3,081-category tree (the upstream list was
  made up); `colours` takes Vinted's colour names; `categoryIds` takes several categories at once.
- **Correct money and labels.** Prices from sellers abroad are shown converted, with the seller's own
  price and location; conditions come back in English (the catalogue API answers in French).
- **Fixes.** Logged-in mode used to send *every* cookie in the browser profile (Google's, Facebook's…)
  to Vinted; now only the country's Vinted cookies go. Failures are reported as errors instead of
  empty placeholder data. UK is the default country (`VINTED_DEFAULT_COUNTRY`).

## Use it with Claude Code

```bash
git clone https://github.com/raspi-projects/vinted-mcp.git ~/projects/vinted-mcp
cd ~/projects/vinted-mcp
npm install && npm run build && npm run bundle

claude mcp add --scope user vinted -e VINTED_DEFAULT_COUNTRY=uk -- node ~/projects/vinted-mcp/dist/bundle.js
ln -s ~/projects/vinted-mcp/skills/vinted-deals ~/.claude/skills/vinted-deals
```

Then ask, for example, "find me a good deal on a Ralph Lauren polo, size M" or paste a listing link and
ask whether it's legit.

## Tools

| Tool | What it does |
|---|---|
| `find_deals` | Samples 1–5 pages of 96 listings for a search (brands, categories, colours, sizes, condition), returns asking-price statistics and the listings at or below a fraction of the median, cheapest first, with thumbnails. `checkQr` adds a QR label verdict per deal; `requireQrLabel` returns only listings with a Ralph Lauren label. |
| `search_items` | Search with brand names or IDs, category, sizes, condition, price range and sort; optional thumbnails. |
| `get_item` | Details, photos (none / 800px / originals), costs, Item Verification, QR labels, seller summary and badges. |
| `get_item_photos` | Chosen photos at original size, up to 6 per call. |
| `get_seller` | Trust report: reviews, activity, verifications, location, bundle discounts, listing scan, flags. |
| `find_brand` | Brand IDs by name, with Vinted's "requires authenticity check" flag. |
| `find_category` | Category IDs by words, e.g. "men polo" → 5492. A parent category includes its children. |
| `compare_prices` | Upstream's cross-country comparison (see limits). |
| `get_trending` | Recent listings ranked by favourites. |
| `like_item` | Favourite or unfavourite a listing; needs a signed-in session. |

Resources: `vinted://countries`, `vinted://categories` (top three levels), and templates for items,
sellers and searches.

### From scripts: `call`

`node dist/bundle.js call <tool> '<json arguments>'` runs one tool and prints its MCP result as JSON
(images as base64); it exits 1 when the tool reports an error. The hub's `vinted` connector uses it.

### In the hub: the `vinted` block

The connector lives in the hub (`~/projects/hub/content/.connectors/vinted.py`, versioned with the hub's
content). A fenced block named `vinted` takes the same filters as `find_deals` plus `qr: off | show |
only`, and shows price statistics, a numbered contact sheet of thumbnails and a table of listings,
refreshed every 30 minutes. See the hub page `lars-space/vinted` for its keys.

## Limits worth knowing

- **Region follows your IP.** Vinted serves the catalogue for the caller's region whatever domain is
  used, so `compare_prices` across countries returns the same listings from one location.
- **Item Verification needs a signed-in session to see.** Vinted's pricing service returned
  `item_verification: null` for every listing when browsing anonymously, including £850 Moncler and
  Gucci pieces. `get_item` then reports `offered: null` and checks the published rules (≥ £85,
  eligible category, UK seller); the diamond badge on the listing settles it.
- **Asking prices, not sold prices.** Medians describe what sellers ask today.
- **Originals come from the seller's wardrobe.** Their URLs only appear there, so for sellers with
  hundreds of listings an older item may only be available at 800px, and then its QR label can't be
  decoded (the decoder reads JPEG, and the 800px photos are WebP).
- **Item pages are rate-limited.** QR scans fetch one each (3–4 s with backoff), so they run one at a
  time and are cached for a week.

## Signing in (optional)

Searching and checking listings work anonymously. Signing in is only needed for `like_item`, and
probably for seeing Item Verification (untested). Either:

- `node dist/bundle.js login --country uk` opens a browser to sign in (needs Playwright with Chromium
  and a display), saving a profile under `~/.vinted-mcp`; or
- set `VINTED_AUTH_MODE=env` with `VINTED_AUTH_COOKIES` and `VINTED_AUTH_CSRF_TOKEN` copied from your
  browser's developer tools.

Either way, requests then go out as your account. Treat these values as secrets.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `VINTED_DEFAULT_COUNTRY` | `uk` | Country when a call names none |
| `VINTED_AUTH_MODE` | `http` | `http` (anonymous), `playwright` or `env` |
| `VINTED_AUTH_COOKIES`, `VINTED_AUTH_CSRF_TOKEN`, `VINTED_AUTH_ACCESS_TOKEN`, `VINTED_AUTH_REFRESH_TOKEN` | – | Credentials for `env` mode |
| `VINTED_PROFILE_DIR` | `~/.vinted-mcp` | Where `login` keeps browser profiles |
| `VINTED_PROXY_URL` | – | Proxy for Vinted requests |
| `VINTED_MAX_CONCURRENCY`, `VINTED_REQUEST_DELAY_MS`, `VINTED_MAX_RETRIES` | 3, 500, 3 | Rate limiting |
| `VINTED_MCP_TRANSPORT` | `stdio` | `http` serves Streamable HTTP and SSE on `VINTED_MCP_HOST:VINTED_MCP_PORT` (no authentication: keep it on localhost) |

The server also loads a `.env` file from its working directory.

## Development

```bash
npm install
npm run build        # TypeScript → dist-ts (used by the unit tests)
npm run bundle       # esbuild → dist/bundle.js (what MCP clients run)
npm test             # unit + protocol tests, offline
RUN_LIVE_MCP_TESTS=1 npm test   # plus a live run against Vinted
npm run update-categories       # refresh src/resources/catalog-tree.json
```

## License

AGPL-3.0-or-later, as upstream. See `LICENSE.md`.
