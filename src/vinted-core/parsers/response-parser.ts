import { getBaseUrl } from "../models/country";

export interface ParsedSeller {
  id: number;
  username: string;
  rating: number | null;
  ratingCount: number;
  itemCount: number;
  followerCount: number;
  lastSeenAt: string | null;
  country: string;
  profileUrl: string;
  business?: boolean;
  /** Where the seller says they are, e.g. "Leeds, United Kingdom"; only the user API has it. */
  location?: string | null;
}

export interface ParsedItem {
  id: number;
  url: string;
  title: string;
  description: string;
  price: number;
  /** Price plus Vinted's buyer protection fee, before postage. */
  totalPrice: number | null;
  currency: string;
  originalPrice: number | null;
  country: string;
  brand: string | null;
  brandId: number | null;
  category: string | null;
  categoryId: number | null;
  size: string | null;
  condition: string | null;
  color: string | null;
  photos: string[];
  thumbnailUrl: string | null;
  favouriteCount: number;
  viewCount: number;
  isSold: boolean;
  isReserved: boolean;
  promoted: boolean;
  soldAt: string | null;
  /** When the first photo was uploaded; only the wardrobe API carries it. */
  listedAt: string | null;
  createdAt: string;
  updatedAt: string;
  seller: ParsedSeller;
  scrapedAt: string;
}

const CONDITIONS: Array<{ code: string; label: string; aliases: string[] }> = [
  { code: "new_with_tags", label: "New with tags", aliases: ["neuf avec étiquette"] },
  { code: "new_without_tags", label: "New without tags", aliases: ["neuf sans étiquette"] },
  { code: "very_good", label: "Very good", aliases: ["très bon état"] },
  { code: "good", label: "Good", aliases: ["bon état"] },
  { code: "satisfactory", label: "Satisfactory", aliases: ["satisfaisant"] }
];

/**
 * The catalogue API answers in French whatever the domain or locale, so map
 * condition labels back to the English names the rest of the server uses.
 */
export function normaliseCondition(label: unknown): string | null {
  const text = String(label || "").trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  const match = CONDITIONS.find(
    (condition) => condition.code === lower || condition.label.toLowerCase() === lower || condition.aliases.includes(lower)
  );
  return match ? match.label : text;
}

export function conditionCode(label: unknown): string | null {
  const english = normaliseCondition(label);
  return CONDITIONS.find((condition) => condition.label === english)?.code || null;
}

/** Kids' sizes come back as "4 ans / 104 cm" from the French-only catalogue API. */
export function normaliseSize(label: unknown): string | null {
  const text = String(label || "").trim();
  if (!text) {
    return null;
  }
  return text.replace(/\bans\b/g, "years").replace(/\bmois\b/g, "months");
}

/** True when any part of a size label like "M / 38 / 10" equals one of the wanted sizes. */
export function sizeMatches(label: string | null, wanted: string[]): boolean {
  if (!wanted.length) {
    return true;
  }
  if (!label) {
    return false;
  }

  const parts = label.split("/").map((part) => part.trim().toLowerCase());
  return wanted.some((size) => parts.includes(size.trim().toLowerCase()));
}

export function amount(value: any): number | null {
  const parsed = parseFloat(value?.amount ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function unixToIso(seconds: unknown): string | null {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}

export function parseItem(raw: any, country: string): ParsedItem {
  const baseUrl = getBaseUrl(country);
  const seller = raw.user || raw.seller || {};
  // svc-catalogue results carry no structured brand/size/condition. They only
  // exist baked into item_box's display strings: first_line is the brand,
  // second_line is "size · condition".
  const [boxSize, boxCondition] = String(raw.item_box?.second_line || "").split(" \u00b7 ");

  return {
    id: raw.id,
    url: toAbsoluteUrl(raw.url, baseUrl) || `${baseUrl}/items/${raw.id}`,
    title: raw.title || "",
    description: raw.description || "",
    price: parseFloat(raw.price?.amount || raw.price || raw.total_item_price?.amount || "0"),
    totalPrice: amount(raw.total_item_price),
    currency: raw.price?.currency_code || raw.currency || "EUR",
    originalPrice: raw.original_price ? parseFloat(raw.original_price.amount || raw.original_price) : null,
    country,
    // item_box's first line is the brand in search results, but the title when a wardrobe listing has no brand.
    brand: raw.brand_title || raw.brand || ("brand" in raw ? null : raw.item_box?.first_line) || null,
    brandId: raw.brand_id || raw.brand_dto?.id || null,
    category: raw.catalog_title || raw.category || null,
    categoryId: raw.catalog_id || raw.category_id || null,
    size: normaliseSize(raw.size_title || raw.size || boxSize),
    condition: normaliseCondition(raw.status || raw.condition || boxCondition),
    color: raw.color1 || raw.color || null,
    photos: (raw.photos || raw.photo_urls || [])
      .map((photo: any) =>
        typeof photo === "string" ? photo : photo.url || photo.full_size_url || photo.thumbnails?.[0]?.url || ""
      )
      .filter(Boolean),
    thumbnailUrl: thumbnailUrl(raw.photo || raw.photos?.[0]),
    favouriteCount: raw.favourite_count || raw.favorites_count || 0,
    viewCount: raw.view_count || 0,
    isSold: raw.is_closed || raw.is_sold || raw.status === "sold" || false,
    isReserved: Boolean(raw.is_reserved),
    promoted: Boolean(raw.promoted),
    soldAt: raw.closed_at || raw.sold_at || null,
    listedAt: unixToIso(raw.photos?.[0]?.high_resolution?.timestamp),
    createdAt: raw.created_at_ts || raw.created_at || "",
    updatedAt: raw.updated_at_ts || raw.updated_at || raw.created_at_ts || "",
    seller: parseSeller(seller, country),
    scrapedAt: new Date().toISOString()
  };
}

function thumbnailUrl(photo: any): string | null {
  if (!photo) {
    return null;
  }
  const thumb = (photo.thumbnails || []).find((entry: any) => entry.type === "thumb310x430");
  return thumb?.url || photo.url || null;
}

/** Vinted reports feedback_reputation as a 0-1 fraction; callers expect stars. */
export function toStars(reputation: unknown): number | null {
  const value = parseFloat(String(reputation));
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 5 * 10) / 10;
}

function toAbsoluteUrl(url: unknown, baseUrl: string): string {
  if (typeof url !== "string" || !url) {
    return "";
  }
  return url.startsWith("http") ? url : `${baseUrl}${url}`;
}

export function parseSeller(raw: any, country: string): ParsedSeller {
  const baseUrl = getBaseUrl(country);
  return {
    id: raw.id || 0,
    username: raw.login || raw.username || "",
    rating: toStars(raw.feedback_reputation),
    ratingCount: raw.feedback_count || raw.rating_count || 0,
    itemCount: raw.item_count || raw.items_count || 0,
    followerCount: raw.followers_count || raw.follower_count || 0,
    lastSeenAt: raw.last_loged_on_ts || raw.last_seen_at || null,
    country,
    profileUrl: raw.profile_url || `${baseUrl}/member/${raw.id}-${raw.login || ""}`,
    business: Boolean(raw.business),
    location: [raw.city, raw.country_title].filter(Boolean).join(", ") || null
  };
}

export function parseSellerProfile(raw: any, country: string) {
  const baseUrl = getBaseUrl(country);
  return {
    id: raw.id,
    username: raw.login || raw.username || "",
    profileUrl: raw.profile_url || `${baseUrl}/member/${raw.id}-${raw.login || ""}`,
    rating: toStars(raw.feedback_reputation),
    ratingCount: raw.feedback_count || 0,
    itemCount: raw.item_count || raw.items_count || 0,
    soldItemCount: raw.given_item_count || raw.sold_item_count || 0,
    followerCount: raw.followers_count || 0,
    followingCount: raw.following_count || 0,
    country,
    city: raw.city || null,
    lastSeenAt: raw.last_loged_on_ts || null,
    createdAt: raw.created_at || null,
    verifications: {
      email: raw.verification?.email?.valid || false,
      phone: raw.verification?.phone?.valid || false,
      facebook: raw.verification?.facebook?.valid || false,
      google: raw.verification?.google?.valid || false
    }
  };
}

export function parseSearchResponse(raw: any, country: string, page: number, perPage: number) {
  const items = (raw.items || []).map((item: any) => parseItem(item, country));
  return {
    items,
    totalCount: raw.pagination?.total_entries || raw.total_count || items.length,
    page,
    perPage,
    hasMore: items.length >= perPage
  };
}
