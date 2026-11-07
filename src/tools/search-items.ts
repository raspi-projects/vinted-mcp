import { defaultCountry, type VintedAPIClient } from "../vinted-core";
import { sizeMatches, type ParsedItem } from "../vinted-core/parsers/response-parser";
import {
  brandFilter,
  colourFilter,
  countryProperty,
  jsonBlock,
  listingSummary,
  mapLimit,
  qrLabelStatus,
  thumbnailBlocks,
  type ToolResult
} from "./shared";

export const searchFilterProperties = {
  query: { type: "string", description: "Search keywords; optional when filtering by brand or category" },
  country: countryProperty,
  brands: {
    type: "array",
    items: { type: "string" },
    description: 'Brand names, resolved to Vinted brand IDs, e.g. ["Ralph Lauren"]. Use find_brand to see sub-brands.'
  },
  brandIds: { type: "array", items: { type: "integer" }, description: "Vinted brand IDs, e.g. 88 for Ralph Lauren" },
  categoryId: {
    type: "integer",
    description: "Vinted category ID from find_category, e.g. 5492 for Men > Polo shirts. A parent category includes its children."
  },
  categoryIds: {
    type: "array",
    items: { type: "integer" },
    description: "Several category IDs at once, e.g. [79, 13] for men's and women's jumpers"
  },
  colours: {
    type: "array",
    items: { type: "string" },
    description: 'Colours as Vinted names them, e.g. ["Navy"] or ["Light blue", "Blue"]. Sellers pick them, so some are wrong or missing.'
  },
  sizes: {
    type: "array",
    items: { type: "string" },
    description: 'Keep only these sizes, e.g. ["M", "L"]. Matched against each part of labels like "M / 38 / 10".'
  },
  condition: {
    type: "array",
    items: { type: "string", enum: ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] },
    description: "Condition filter"
  }
};

export const searchItemsTool = {
  name: "search_items",
  description:
    "Search Vinted listings by keywords, brand, category, size, condition and price. price is the asking price; totalPrice adds " +
    "Vinted's buyer protection fee (postage is extra). Vinted serves the catalogue of the caller's region, so results follow the " +
    "server's IP more than the country code.",
  inputSchema: {
    type: "object",
    properties: {
      ...searchFilterProperties,
      priceMin: { type: "number", description: "Minimum price" },
      priceMax: { type: "number", description: "Maximum price" },
      sortBy: {
        type: "string",
        enum: ["relevance", "price_low_to_high", "price_high_to_low", "newest_first"],
        description: "Sort order (default relevance)"
      },
      limit: { type: "integer", description: "Max items to return (max 96)", default: 20 },
      page: { type: "integer", description: "Result page", default: 1 },
      includeThumbnails: {
        type: "boolean",
        description: "Attach a 310x430 photo of each returned item (up to 24), labelled with its rank",
        default: false
      },
      checkQr: {
        type: "boolean",
        description: "Decode QR codes in each returned item's original photos and add qrLabel (slower)",
        default: false
      }
    }
  }
};

export async function handleSearchItems(client: VintedAPIClient, args: any): Promise<ToolResult> {
  const country = args.country || defaultCountry();
  const limit = Math.min(Math.max(args.limit || 20, 1), 96);
  const sizes: string[] = args.sizes || [];
  const brands = await brandFilter(client, args, country);
  const colours = await colourFilter(client, args, country);

  const result = await client.searchItems({
    query: args.query,
    country,
    categoryId: args.categoryId,
    categoryIds: args.categoryIds,
    colorIds: colours.ids,
    brandIds: brands.ids,
    priceMin: args.priceMin,
    priceMax: args.priceMax,
    condition: args.condition,
    sortBy: args.sortBy || "relevance",
    // Sizes are filtered here, so fetch a full page to have enough left over.
    perPage: sizes.length ? 96 : limit,
    page: args.page || 1
  });

  const items = result.items.filter((item) => sizeMatches(item.size, sizes)).slice(0, limit);
  const qr = args.checkQr
    ? await mapLimit(items, 1, (item: ParsedItem) =>
        client
          .scanQrLabels(item.id, country)
          .then(qrLabelStatus)
          .catch((error: any) => ({ status: "unchecked", text: `not checked: ${error.message}` }))
      )
    : null;
  const summary = jsonBlock({
    totalFound: result.totalCount,
    note: result.totalCount >= 960 ? "Vinted caps totalFound at 960" : undefined,
    returned: items.length,
    country,
    brands: brands.resolved.length ? brands.resolved : undefined,
    items: items.map((item, i) => ({ rank: i + 1, qrLabel: qr?.[i], ...listingSummary(item) }))
  });

  return args.includeThumbnails ? [summary, ...(await thumbnailBlocks(client, items))] : [summary];
}
