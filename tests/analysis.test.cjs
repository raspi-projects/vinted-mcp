const assert = require("node:assert/strict");
const { test } = require("node:test");

const { parseItemPage } = require("../dist-ts/vinted-core/parsers/item-page.js");
const { parseItem, normaliseCondition, sizeMatches, normaliseSize } = require("../dist-ts/vinted-core/parsers/response-parser.js");
const { priceStats, rankDeals } = require("../dist-ts/vinted-core/analysis/deals.js");
const { buildSellerReport } = require("../dist-ts/vinted-core/analysis/seller.js");
const { vintedCookieMap } = require("../dist-ts/vinted-core/auth/utils.js");
const { findCategories, categoryPath } = require("../dist-ts/resources/categories.js");
const { parseVintedUrl } = require("../dist-ts/tools/shared.js");

// Item pages carry their data as JSON string literals in Next.js flight chunks;
// the stub splits the payload over two chunks and puts a decoy gallery first.
function stubItemPage() {
  const photo = (id) => ({ id, url: `https://images1.vinted.net/t/${id}/f800/a.webp?s=1`, width: 1200, height: 1600 });
  const flight = [
    JSON.stringify({ item_id: "99", photos: [{ id: "decoy", url: "https://images1.vinted.net/t/decoy/f800/d.webp?s=9", width: 1, height: 1 }] }),
    JSON.stringify({ item_id: "42", photos: [photo("p1"), photo("p2")] }),
    JSON.stringify({
      data: {
        attributes: [
          { code: "brand", data: { id: "88", value: "Ralph Lauren" } },
          { code: "size", data: { id: 207, value: "M" } },
          { code: "status", data: { id: 50, value: "Très bon état" } },
          { code: "material", data: { value: "Cotton" } },
          { code: "upload_date", data: { value: "2 days ago" } }
        ]
      }
    }),
    JSON.stringify({ data: { favourite_count: 7, is_favourite: false, item_id: "42" } }),
    JSON.stringify({ data: { badges: [{ type: "SPEEDY_SHIPPING" }], username: "bob" } }),
    JSON.stringify({ item: { brand_dto: { id: "88" }, catalog_id: "5492", id: "42", is_reserved: true, can_buy: true, seller_id: "77", title: "Polo" } })
  ].join(",");
  const half = Math.floor(flight.length / 2);
  const ld = { name: "Polo", description: "Worn twice", offers: { price: 25, priceCurrency: "GBP", availability: "InStock" } };

  return (
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(0, half))}])</script>` +
    `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(half))}])</script>`
  );
}

test("parses an item page's flight payload", () => {
  const page = parseItemPage(stubItemPage(), 42, "https://www.vinted.co.uk/items/42");

  assert.equal(page.title, "Polo");
  assert.equal(page.price, 25);
  assert.equal(page.brand, "Ralph Lauren");
  assert.equal(page.brandId, 88);
  assert.equal(page.categoryId, 5492);
  assert.equal(page.size, "M");
  assert.equal(page.condition, "Very good");
  assert.equal(page.material, "Cotton");
  assert.equal(page.uploaded, "2 days ago");
  assert.deepEqual(page.photos.map((photo) => photo.id), ["p1", "p2"], "skips the decoy gallery");
  assert.equal(page.favouriteCount, 7);
  assert.equal(page.isReserved, true);
  assert.equal(page.sellerId, 77);
  assert.deepEqual(page.sellerBadges, ["SPEEDY_SHIPPING"]);
});

test("normalises the catalogue API's French labels", () => {
  assert.equal(normaliseCondition("Neuf avec étiquette"), "New with tags");
  assert.equal(normaliseCondition("Very good"), "Very good");
  assert.equal(normaliseSize("4 ans / 104 cm"), "4 years / 104 cm");

  const item = parseItem(
    {
      id: 1,
      title: "Polo",
      price: { amount: "20.00", currency_code: "GBP" },
      total_item_price: { amount: "21.90", currency_code: "GBP" },
      item_box: { first_line: "Ralph Lauren", second_line: "M / 38 / 10 · Bon état" },
      photo: { thumbnails: [{ type: "thumb310x430", url: "https://images1.vinted.net/t/a/310x430/a.webp" }] },
      user: { id: 5, login: "ann", business: true }
    },
    "uk"
  );
  assert.equal(item.condition, "Good");
  assert.equal(item.size, "M / 38 / 10");
  assert.equal(item.totalPrice, 21.9);
  assert.equal(item.thumbnailUrl, "https://images1.vinted.net/t/a/310x430/a.webp");
  assert.equal(item.seller.business, true);
});

test("matches sizes against each part of a size label", () => {
  assert.equal(sizeMatches("M / 38 / 10", ["m"]), true);
  assert.equal(sizeMatches("XL", ["L"]), false);
  assert.equal(sizeMatches(null, ["M"]), false);
  assert.equal(sizeMatches(null, []), true);
});

test("ranks deals against the sample median", () => {
  const stats = priceStats([10, 20, 30, 40, 50]);
  assert.equal(stats.median, 30);
  assert.equal(stats.p25, 20);

  const listing = (id, price, extra = {}) => ({ id, price, favouriteCount: 0, isSold: false, isReserved: false, promoted: false, condition: "Good", ...extra });
  const deals = rankDeals([listing(1, 30), listing(2, 6), listing(3, 15), listing(4, 12, { isReserved: true })], stats, 0.6);

  assert.deepEqual(deals.map((deal) => deal.item.id), [2, 3], "cheapest first, reserved and median-priced dropped");
  assert.match(deals[0].flags[0], /check authenticity/);
});

test("flags thin, negative and bulk-stock sellers", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  const listings = Array.from({ length: 12 }, (_, i) =>
    parseItem({ id: i, title: `Ralph Lauren polo size ${["S", "M", "L"][i % 3]}`, price: "15", status: "New with tags", brand: "Ralph Lauren", user: {} }, "uk")
  );
  const report = buildSellerReport({
    user: {
      id: 9,
      login: "bulk",
      feedback_count: 3,
      negative_feedback_count: 1,
      feedback_reputation: 0.8,
      verification: { email: { valid: true } },
      last_loged_on_ts: "2026-11-06T00:00:00Z"
    },
    latestFeedback: [
      { rating: 1, feedback: "Fake, not as described", created_at_ts: "2026-10-20T00:00:00Z" },
      { rating: 5, feedback: "Auto-feedback: Sale completed successfully", created_at_ts: "2026-10-10T00:00:00Z", system_feedback: true }
    ],
    oldestFeedback: [],
    listings,
    country: "uk",
    brand: "ralph lauren",
    now
  });

  const flags = report.flags.join(" | ");
  assert.match(flags, /Only 3 reviews/);
  assert.match(flags, /33% of reviews are negative/);
  assert.match(flags, /Oldest review is from 2026-10-10/);
  assert.match(flags, /12 of 12 sampled listings are new with tags/);
  assert.match(flags, /Same listing title 12 times/);
  assert.equal(report.listings.brandMatches, 12);
  assert.equal(report.criticalReviews.length, 1);
  assert.equal(report.recentReviews.length, 1, "automatic reviews are left out of recentReviews");
});

test("sends only the country's Vinted cookies", () => {
  const cookies = [
    { name: "access_token_web", value: "a", domain: ".vinted.co.uk" },
    { name: "anon_id", value: "b", domain: "www.vinted.co.uk" },
    { name: "SID", value: "google-session", domain: ".google.com" },
    { name: "other", value: "c", domain: ".vinted.fr" }
  ];
  assert.deepEqual(vintedCookieMap(cookies, "www.vinted.co.uk"), { access_token_web: "a", anon_id: "b" });
});

test("finds categories and reads Vinted URLs", () => {
  assert.equal(findCategories("men polo")[0].path, "Men > Clothing > Tops & t-shirts > Polo shirts");
  assert.equal(categoryPath(5), "Men");
  assert.deepEqual(parseVintedUrl("https://www.vinted.co.uk/items/10698492565-nike-air-max", "items"), { id: 10698492565, country: "uk" });
  assert.deepEqual(parseVintedUrl("https://www.vinted.fr/member/181193640-ann", "member"), { id: 181193640, country: "fr" });
  assert.equal(parseVintedUrl("https://example.com/items/1", "items"), null);
});

test("category search matches whole words", () => {
  assert.equal(findCategories("men shoes")[0].path, "Men > Shoes", '"men" must not match "Women"');
});

test("reports Item Verification only when Vinted lists it", () => {
  const { itemVerification } = require("../dist-ts/tools/get-item.js");
  const base = { price: 120, currency: "GBP", seller: { location: "Leeds, United Kingdom" } };
  const path = "Men > Clothing > Outerwear";

  const offered = itemVerification({ ...base, services: { itemVerificationListed: true, itemVerificationFee: 10 }, signedIn: true }, path);
  assert.equal(offered.offered, true);
  assert.equal(offered.fee, "10.00 GBP");

  const notOffered = itemVerification({ ...base, services: { itemVerificationListed: false }, signedIn: true }, path);
  assert.equal(notOffered.offered, false);

  const anonymous = itemVerification({ ...base, services: { itemVerificationListed: false }, signedIn: false }, path);
  assert.equal(anonymous.offered, null, "anonymous sessions never see it, so null means unknown");
  assert.deepEqual(
    [anonymous.publishedRules.priceAtLeast85GBP, anonymous.publishedRules.eligibleCategory, anonymous.publishedRules.sellerInUK],
    [true, true, true]
  );
});
