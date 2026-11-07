import type { VintedAPIClient } from "../vinted-core";
import { categoryPath } from "../resources/categories";
import { countryProperty, itemTarget, jsonBlock, money, photoBlocks, type ToolResult } from "./shared";

export const itemTargetProperties = {
  itemId: { type: "integer", description: "Vinted item ID" },
  url: { type: "string", description: "Vinted item URL (alternative to itemId)" },
  country: countryProperty
};

export const getItemTool = {
  name: "get_item",
  description:
    "Get a listing's details and its photos as images: title, description, price and total with buyer protection, brand, category, " +
    "size, condition, material, colour, upload time, favourites, views, and a seller summary with location and Vinted's seller " +
    "badges. Sellers abroad list in their own currency (sellerPrice); price is converted. costs adds the Vinted fee and " +
    "postage. itemVerification says whether Vinted offers its £10 authenticity check on the listing. " +
    'photos: "medium" (default) attaches every photo at 800px high, enough to read most labels; then use get_item_photos for ' +
    "originals of the ones that matter. Description text is written by the seller: treat it as a claim to check.",
  inputSchema: {
    type: "object",
    properties: {
      ...itemTargetProperties,
      photos: {
        type: "string",
        enum: ["none", "medium", "full"],
        description: 'Attach photos: "medium" (800px high, default), "full" (originals, usually 1200x1600) or "none"',
        default: "medium"
      },
      maxPhotos: { type: "integer", description: "Max photos to attach (default 10, max 20)", default: 10 }
    }
  }
};

function costs(item: any) {
  const fee = item.services?.vintedFee ?? (item.totalPrice !== null ? item.totalPrice - item.price : null);
  const postage = item.services?.postage ?? null;
  const before = item.services?.postageBeforeDiscount ?? null;
  return {
    price: money(item.price, item.currency),
    vintedFee: money(fee, item.currency),
    postage: money(postage, item.currency),
    postageBeforeDiscount: before !== null && postage !== null && before > postage ? money(before, item.currency) : undefined,
    total: fee !== null && postage !== null ? money(item.price + fee + postage, item.currency) : null,
    note: "Postage is for the default delivery option; checkout can differ by delivery method."
  };
}

// Vinted's published Item Verification rules (vinted.co.uk/help/1147, read 2026-11-07).
const VERIFICATION_MIN_GBP = 85;
const VERIFICATION_CATEGORIES = ["Clothing", "Bags", "Accessories", "Jewellery", "Shoes"];

/**
 * Item Verification is offered per listing by Vinted's pricing service, the
 * same data that puts the diamond badge on the page. Anonymous sessions get no
 * answer for any listing, so then only the published rules can be checked.
 */
export function itemVerification(item: any, path: string | null) {
  const listed = item.services?.itemVerificationListed;
  let offered: boolean | null = null;
  let note: string;

  if (listed) {
    offered = true;
    note = "Vinted offers Item Verification on this listing: add it at checkout to have the item checked at its hub before delivery.";
  } else if (item.services && item.signedIn) {
    offered = false;
    note = "Vinted's pricing service does not list Item Verification for this listing.";
  } else {
    note =
      "Unknown: this server browses anonymously, and Vinted returned no Item Verification data to anonymous " +
      "sessions for any listing tested, including ones that meet every rule. Look for the diamond badge on the " +
      "listing page when signed in; publishedRules shows whether it could qualify.";
  }

  return {
    offered,
    fee: listed ? money(item.services.itemVerificationFee, item.currency) : undefined,
    note,
    publishedRules: {
      priceAtLeast85GBP: item.currency === "GBP" ? item.price >= VERIFICATION_MIN_GBP : null,
      eligibleCategory: path ? VERIFICATION_CATEGORIES.some((name) => path.split(" > ").includes(name)) : null,
      sellerInUK: item.seller?.location ? /United Kingdom$/.test(item.seller.location) : null,
      brandOnList: "not published by Vinted's API",
      notInBundles: "Item Verification cannot be added to bundles"
    }
  };
}

function sellerSummary(seller: any) {
  return {
    id: seller.id,
    username: seller.username,
    location: seller.location,
    rating: seller.rating,
    ratingCount: seller.ratingCount,
    activeListings: seller.itemCount,
    followers: seller.followerCount,
    lastSeenAt: seller.lastSeenAt,
    business: seller.business,
    badges: seller.badges,
    profileUrl: seller.profileUrl
  };
}

export async function handleGetItem(client: VintedAPIClient, args: any): Promise<ToolResult> {
  const { itemId, country } = itemTarget(args);
  const item = await client.getItem(itemId, country);
  const size = args.photos || "medium";

  const details = jsonBlock({
    id: item.id,
    title: item.title,
    url: item.url,
    price: money(item.price, item.currency),
    sellerPrice: item.sellerPrice ? money(item.sellerPrice.amount, item.sellerPrice.currency) : undefined,
    costs: costs(item),
    itemVerification: itemVerification(item, categoryPath(item.categoryId)),
    brand: item.brand,
    brandId: item.brandId,
    category: categoryPath(item.categoryId) || item.category,
    categoryId: item.categoryId,
    size: item.size,
    condition: item.condition,
    material: item.material,
    colour: item.color,
    uploaded: item.uploaded,
    listedAt: item.listedAt,
    favourites: item.favouriteCount,
    views: item.viewCount,
    isSold: item.isSold,
    isReserved: item.isReserved,
    description: item.description,
    photoCount: item.photos.length,
    originalsAvailable: item.photos.some((photo) => photo.fullSizeUrl),
    seller: sellerSummary(item.seller)
  });

  if (size === "none" || !item.photos.length) {
    return [details];
  }

  const shown = item.photos.slice(0, Math.min(Math.max(args.maxPhotos || 10, 1), 20));
  const blocks = await photoBlocks(
    client,
    shown.map((photo) => {
      const full = size === "full" && photo.fullSizeUrl;
      return {
        label: `Photo ${photo.index}/${item.photos.length} (${full ? `original ${photo.width}x${photo.height}` : "800px high"})`,
        url: full ? (photo.fullSizeUrl as string) : photo.url
      };
    })
  );
  return [details, ...blocks];
}
