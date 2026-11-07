import { defaultCountry, type VintedAPIClient } from "../vinted-core";
import { countryProperty, jsonBlock, parseVintedUrl, type ToolResult } from "./shared";

export const getSellerTool = {
  name: "get_seller",
  description:
    "Seller trust report: rating (0-5), positive/neutral/negative review counts, the text of critical reviews, the oldest review " +
    "date (how long they have traded), sales and purchases, verifications, location, last seen, and a sample of their active " +
    "listings (top brands, how many are new with tags, repeated titles). flags lists what stands out; weigh it in context.",
  inputSchema: {
    type: "object",
    properties: {
      sellerId: { type: "integer", description: "Vinted seller/user ID" },
      url: { type: "string", description: "Vinted seller profile URL (alternative to sellerId)" },
      country: countryProperty,
      brand: { type: "string", description: "Also count how many sampled listings are this brand" },
      includeItems: { type: "boolean", description: "Include the seller's newest listings", default: true },
      itemLimit: { type: "integer", description: "Max listings to include", default: 10 },
      listingPages: {
        type: "integer",
        description: "Pages of 96 listings to sample for the listing statistics (1-5, default 2)",
        default: 2
      }
    }
  }
};

export async function handleGetSeller(client: VintedAPIClient, args: any): Promise<ToolResult> {
  let sellerId: number;
  let country: string;

  if (args.url) {
    const parsed = parseVintedUrl(args.url, "member");
    if (!parsed) {
      throw new Error(`Invalid Vinted seller URL: ${args.url}`);
    }
    sellerId = parsed.id;
    country = parsed.country;
  } else if (args.sellerId) {
    sellerId = args.sellerId;
    country = args.country || defaultCountry();
  } else {
    throw new Error("Either sellerId or url must be provided");
  }

  const report = await client.getSeller(sellerId, country, {
    brand: args.brand,
    itemLimit: args.itemLimit || 10,
    wardrobePages: Math.min(Math.max(args.listingPages || 2, 1), 5)
  });

  if (args.includeItems === false) {
    const { recentItems, ...rest } = report;
    return [jsonBlock(rest)];
  }
  return [jsonBlock(report)];
}
