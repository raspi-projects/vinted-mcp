import { normaliseCondition, normaliseSize } from "./response-parser";
import { findJsonAfter, readFlightData } from "./rsc";

export interface ItemPagePhoto {
  id: string;
  /** 800px-high rendition, the largest the item page links to. */
  url: string;
  /** Size of the original upload. */
  width: number;
  height: number;
}

export interface ItemPageData {
  id: number;
  url: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  brand: string | null;
  brandId: number | null;
  category: string | null;
  categoryId: number | null;
  size: string | null;
  condition: string | null;
  material: string | null;
  color: string | null;
  /** Vinted's own wording, e.g. "Just now" or "3 weeks ago". */
  uploaded: string | null;
  photos: ItemPagePhoto[];
  favouriteCount: number | null;
  isSold: boolean;
  isReserved: boolean;
  canBuy: boolean | null;
  sellerId: number | null;
  sellerBadges: string[];
}

/**
 * Structured basics come from the page's ld+json block; everything else
 * (photos, attributes, seller id, reservation state) only exists in the
 * Next.js flight payload, see readFlightData.
 */
export function parseItemPage(html: string, id: number, fallbackUrl: string): ItemPageData {
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const ld = ldMatch ? safeJsonParse(ldMatch[1]) : null;
  const flight = readFlightData(html);
  const itemId = String(id);

  // The sidebar's item object is the one record that is certainly this item.
  const sidebarItem = findJsonAfter(flight, '"item":', (value) => value && String(value.id) === itemId && "seller_id" in value);

  // Recommendation widgets carry photos too; the gallery's array sits right after this item's id.
  const photos =
    findJsonAfter(flight, '"photos":', (value, index) => isPhotoList(value) && flight.slice(Math.max(0, index - 400), index).includes(`"${itemId}"`)) ||
    findJsonAfter(flight, '"photos":', isPhotoList) ||
    [];

  const attributes: any[] =
    findJsonAfter(flight, '"attributes":', (value) => Array.isArray(value) && value.some((entry: any) => entry?.code === "status" || entry?.code === "brand")) || [];
  const attribute = (code: string) => attributes.find((entry: any) => entry?.code === code)?.data;

  const badgesMatch = flight.match(/"data":\{"badges":(\[[^\]]*\]),"username"/);
  const badges = badgesMatch ? safeJsonParse(badgesMatch[1]) || [] : [];

  const favouriteMatch = flight.match(new RegExp(`"favourite_count":(\\d+)[^{}]*"item_id":"?${itemId}\\b`)) || flight.match(/"favourite_count":(\d+)/);
  const brandId = Number(attribute("brand")?.id || sidebarItem?.brand_dto?.id);
  const categoryId = Number(sidebarItem?.catalog_id);
  const sellerId = Number(sidebarItem?.seller_id);

  return {
    id,
    url: ld?.offers?.url || fallbackUrl,
    title: ld?.name || sidebarItem?.title || "",
    description: ld?.description || "",
    price: Number(ld?.offers?.price || 0),
    currency: ld?.offers?.priceCurrency || sidebarItem?.currency || "EUR",
    brand: attribute("brand")?.value || ld?.brand?.name || null,
    brandId: brandId > 0 ? brandId : null,
    category: ld?.category || null,
    categoryId: categoryId > 0 ? categoryId : null,
    size: normaliseSize(attribute("size")?.value),
    condition: normaliseCondition(attribute("status")?.value || ld?.offers?.itemCondition?.replace("Condition", "")),
    material: attribute("material")?.value || null,
    color: attribute("color")?.value || ld?.color || null,
    uploaded: attribute("upload_date")?.value || null,
    photos: photos.map((photo: any) => ({
      id: String(photo.id),
      url: photo.url,
      width: Number(photo.width) || 0,
      height: Number(photo.height) || 0
    })),
    favouriteCount: favouriteMatch ? Number(favouriteMatch[1]) : null,
    isSold: ld?.offers?.availability === "OutOfStock",
    isReserved: Boolean(sidebarItem?.is_reserved),
    canBuy: typeof sidebarItem?.can_buy === "boolean" ? sidebarItem.can_buy : null,
    sellerId: sellerId > 0 ? sellerId : null,
    sellerBadges: badges.map((badge: any) => badge?.type).filter(Boolean)
  };
}

function isPhotoList(value: any): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((photo: any) => typeof photo?.url === "string" && photo.url.includes("vinted.net"));
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
