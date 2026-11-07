import { defaultCountry, type VintedAPIClient } from "../vinted-core";
import { priceStats, rankDeals } from "../vinted-core/analysis/deals";
import { sizeMatches } from "../vinted-core/parsers/response-parser";
import { categoryPath } from "../resources/categories";
import { keepTitle, searchFilterProperties } from "./search-items";
import {
  brandFilter,
  colourFilter,
  jsonBlock,
  listingSummary,
  mapLimit,
  maxNewScans,
  maxNewScansProperty,
  qrScanner,
  thumbnailBlocks,
  type ToolResult
} from "./shared";

export const findDealsTool = {
  name: "find_deals",
  description:
    "Find underpriced listings. Samples up to 5 pages (480 listings) of a search, computes the spread of asking prices, and returns " +
    "the listings at or below maxRatio of the median, cheapest relative to the median first, with thumbnails. Narrow the search " +
    "(brand + category + sizes) or the median mixes unlike items. These are asking prices of live listings, not sold prices.",
  inputSchema: {
    type: "object",
    properties: {
      ...searchFilterProperties,
      maxPrice: {
        type: "number",
        description: "Only return deals at or under this price. Does not change the market statistics."
      },
      maxRatio: {
        type: "number",
        description: "Return listings priced at or below this fraction of the median (default 0.6)",
        default: 0.6
      },
      pages: { type: "integer", description: "Pages of 96 listings to sample (1-5, default 3)", default: 3 },
      sortBy: {
        type: "string",
        enum: ["newest_first", "relevance"],
        description: "Which listings to sample (default newest_first: fresh deals go fast)"
      },
      limit: { type: "integer", description: "Max deals to return (max 40)", default: 15 },
      checkQr: {
        type: "boolean",
        description: "Decode QR codes in each returned deal's original photos and add qrLabel (slower: fetches every listing)",
        default: false
      },
      requireQrLabel: {
        type: "boolean",
        description:
          "Only return listings showing a Ralph Lauren QR label: scans candidates cheapest first until `limit` are found. " +
          "Fresh scans are capped by maxNewScans and cached for a week, so calling again goes further. " +
          "Fakes rarely have a label, so use a higher maxRatio, e.g. 2.5.",
        default: false
      },
      maxNewScans: maxNewScansProperty,
      includeThumbnails: { type: "boolean", description: "Attach a 310x430 photo of each deal", default: true }
    }
  }
};

export async function handleFindDeals(client: VintedAPIClient, args: any): Promise<ToolResult> {
  const country = args.country || defaultCountry();
  const sizes: string[] = args.sizes || [];
  const brands = await brandFilter(client, args, country);
  const colours = await colourFilter(client, args, country);
  const categoryIds: number[] = [...(args.categoryIds || []), ...(args.categoryId ? [args.categoryId] : [])];
  if (!args.query && !brands.ids && !categoryIds.length) {
    throw new Error("Give at least a query, a brand or a category, or the sample is the whole catalogue");
  }

  const sample = await client.searchSample(
    {
      query: args.query,
      country,
      categoryIds,
      colorIds: colours.ids,
      brandIds: brands.ids,
      condition: args.condition,
      sortBy: args.sortBy || "newest_first"
    },
    Math.min(Math.max(args.pages || 3, 1), 5)
  );

  const comparable = sample.items.filter((item) => sizeMatches(item.size, sizes) && keepTitle(item.title, args.excludeWords));
  const stats = priceStats(comparable.map((item) => item.price));
  if (!stats) {
    return [jsonBlock({ sampled: sample.items.length, comparable: 0, note: "No priced listings matched; widen the search." })];
  }

  const limit = Math.min(Math.max(args.limit || 15, 1), 40);
  const ranked = rankDeals(comparable, stats, args.maxRatio || 0.6).filter(
    (deal) => args.maxPrice === undefined || deal.item.price <= args.maxPrice
  );
  const currency = comparable[0]?.currency;

  const qr = new Map<number, { status: string; text: string }>();
  const scanner = qrScanner(client, country, maxNewScans(args));

  let deals = ranked.slice(0, limit);
  if (args.requireQrLabel) {
    // Fresh scans stop at maxNewScans; the rest of the list is read from the cache.
    deals = [];
    for (const deal of ranked) {
      if (deals.length >= limit) {
        break;
      }
      const verdict = await scanner.scan(deal.item.id);
      qr.set(deal.item.id, verdict);
      if (verdict.status === "rl-label") {
        deals.push(deal);
      }
    }
  } else if (args.checkQr) {
    const results = await mapLimit(deals, 1, (deal) => scanner.scan(deal.item.id));
    deals.forEach((deal, i) => qr.set(deal.item.id, results[i]));
  }

  const summary = jsonBlock({
    search: {
      query: args.query || null,
      country,
      brands: brands.resolved.length ? brands.resolved : args.brandIds || null,
      categories: categoryIds.length ? categoryIds.map((id) => ({ id, path: categoryPath(id) })) : null,
      colours: colours.resolved.length ? colours.resolved.map((colour) => colour.title) : null,
      sizes: sizes.length ? sizes : null,
      excludeWords: args.excludeWords?.length ? args.excludeWords : null,
      condition: args.condition || null
    },
    sample: {
      listings: sample.items.length,
      comparable: comparable.length,
      sortBy: args.sortBy || "newest_first",
      qrScanned: qr.size ? qr.size - scanner.stats().pending : undefined,
      qrNewScans: qr.size ? scanner.stats().newScans : undefined,
      qrPending: qr.size ? scanner.stats().pending : undefined,
      qrLabelled: qr.size ? [...qr.values()].filter((verdict) => verdict.status === "rl-label").length : undefined
    },
    askingPrices: { ...stats, currency },
    deals: deals.map((deal, i) => ({
      rank: i + 1,
      priceVsMedian: `${Math.round(deal.priceRatio * 100)}%`,
      flags: deal.flags.length ? deal.flags : undefined,
      qrLabel: qr.get(deal.item.id),
      ...listingSummary(deal.item)
    })),
    note:
      "A low price is a reason to look closer, not proof of a deal: check photos, labels and the seller before buying. " +
      "Some sellers are abroad (prices converted); get_item shows the seller's location."
  });

  return args.includeThumbnails === false ? [summary] : [summary, ...(await thumbnailBlocks(client, deals.map((deal) => deal.item)))];
}
