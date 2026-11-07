import { defaultCountry, SUPPORTED_COUNTRY_CODES, type VintedAPIClient } from "../vinted-core";
import type { ParsedItem } from "../vinted-core/parsers/response-parser";

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type ToolResult = string | ToolContent[];

export const countryProperty = {
  type: "string",
  description: `Country code (${SUPPORTED_COUNTRY_CODES.join(", ")}). Defaults to VINTED_DEFAULT_COUNTRY, else uk.`
};

export type QrScan = NonNullable<Awaited<ReturnType<VintedAPIClient["scanQrLabels"]>>>;

/**
 * One verdict per listing from its QR scan. A code another seller's listing
 * also shows suggests a genuine label copied onto fakes; the same seller
 * showing it again is usually a relisted item.
 */
export function qrLabelStatus(scan: QrScan): { status: "rl-label" | "cloned" | "other-site" | "none" | "unchecked"; text: string } {
  if (!scan.originals) {
    return { status: "unchecked", text: "not checked: original photos unavailable" };
  }

  const cloned = scan.codes.find((code) => code.alsoInListings.some((other) => !other.sameSeller));
  if (cloned) {
    const others = cloned.alsoInListings.filter((other) => !other.sameSeller).map((other) => other.itemId);
    return { status: "cloned", text: `same QR code as another seller's listing (${others.slice(0, 3).join(", ")}): likely a copied label` };
  }

  const rl = scan.codes.find((code) => code.issuer === "ralph-lauren");
  if (rl) {
    const relisted = rl.alsoInListings.length ? `; also in this seller's listing ${rl.alsoInListings[0].itemId}` : "";
    return {
      status: "rl-label",
      text: `QR label linking to Ralph Lauren (${rl.host}) in photo ${rl.photos.join(", ")}${relisted}; only RL's page when scanned proves it`
    };
  }
  if (scan.codes.length) {
    return { status: "other-site", text: `QR code links to ${scan.codes[0].host || "plain text"}, not Ralph Lauren's ID system` };
  }
  return { status: "none", text: `no QR code found in ${scan.photosChecked} original photos` };
}

export const maxNewScansProperty = {
  type: "integer",
  description:
    "QR checks: listings to scan fresh this call (0-60, default 40; each fetches a listing page, 3-4 s). Beyond that, and " +
    "always with 0, only scans cached in the last week are used, which is instant; the rest count as qrPending.",
  default: 40
};

/**
 * Scans listings one at a time (item pages are rate-limited), up to
 * `maxNewScans` fresh ones, then answers from the week-long cache only.
 */
export function qrScanner(client: VintedAPIClient, country: string, maxNewScans: number) {
  let newScans = 0;
  let pending = 0;
  const scan = async (id: number): Promise<{ status: string; text: string }> => {
    try {
      const result = await client.scanQrLabels(id, country, { cacheOnly: newScans >= maxNewScans });
      if (!result) {
        pending += 1;
        return { status: "unchecked", text: "not scanned yet" };
      }
      newScans += result.cached ? 0 : 1;
      return qrLabelStatus(result);
    } catch (error: any) {
      return { status: "unchecked", text: `not checked: ${error.message}` };
    }
  };
  return { scan, stats: () => ({ newScans, pending }) };
}

export function maxNewScans(args: any): number {
  return Math.min(Math.max(args.maxNewScans ?? 40, 0), 60);
}

/** Runs `fn` over `items` with at most `limit` running at once, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function jsonBlock(value: unknown): ToolContent {
  return { type: "text", text: JSON.stringify(value, null, 2) };
}

/**
 * Downloads photos and puts a text label before each one, so the model and
 * later tool calls can refer to "photo 3". A photo that fails to load becomes
 * a text note instead of failing the whole call.
 */
export async function photoBlocks(client: VintedAPIClient, photos: Array<{ label: string; url: string }>): Promise<ToolContent[]> {
  const loaded = await Promise.all(photos.map((photo) => client.fetchImage(photo.url).catch((error: any) => error as Error)));
  const blocks: ToolContent[] = [];
  photos.forEach((photo, i) => {
    const image = loaded[i];
    if (image instanceof Error) {
      blocks.push({ type: "text", text: `${photo.label}: could not load (${image.message})` });
      return;
    }
    blocks.push({ type: "text", text: photo.label });
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  });
  return blocks;
}

export function money(value: number | null | undefined, currency: string): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} ${currency}` : null;
}

export function listingSummary(item: ParsedItem) {
  return {
    id: item.id,
    title: item.title,
    price: money(item.price, item.currency),
    totalPrice: money(item.totalPrice, item.currency),
    brand: item.brand,
    size: item.size,
    condition: item.condition,
    favourites: item.favouriteCount,
    seller: { id: item.seller.id, username: item.seller.username, business: item.seller.business },
    url: item.url
  };
}

export async function thumbnailBlocks(client: VintedAPIClient, items: ParsedItem[], max = 24): Promise<ToolContent[]> {
  return photoBlocks(
    client,
    items
      .slice(0, max)
      .map((item, i) => ({ item, rank: i + 1 }))
      .filter(({ item }) => item.thumbnailUrl)
      .map(({ item, rank }) => ({
        label: `#${rank} · item ${item.id} · ${money(item.price, item.currency)} · ${item.title}`,
        url: item.thumbnailUrl as string
      }))
  );
}

const DOMAIN_TO_COUNTRY: Record<string, string> = {
  fr: "fr", de: "de", "co.uk": "uk", it: "it", es: "es", nl: "nl", pl: "pl", pt: "pt", be: "be", at: "at",
  lt: "lt", cz: "cz", sk: "sk", hu: "hu", ro: "ro", hr: "hr", fi: "fi", dk: "dk", se: "se"
};

/** Reads `https://www.vinted.<tld>/<kind>/<id>-slug` links. */
export function parseVintedUrl(url: string, kind: "items" | "member"): { id: number; country: string } | null {
  const match = url.match(new RegExp(`vinted\\.([a-z]{2}(?:\\.[a-z]{2})?)\\/(?:[a-z-]+\\/)?${kind}\\/(\\d+)`, "i"));
  if (!match) {
    return null;
  }
  return { id: parseInt(match[2], 10), country: DOMAIN_TO_COUNTRY[match[1].toLowerCase()] || defaultCountry() };
}

/** Accepts either `url` or `itemId` (+ optional `country`), as every item tool does. */
export function itemTarget(args: any): { itemId: number; country: string } {
  if (args.url) {
    const parsed = parseVintedUrl(args.url, "items");
    if (!parsed) {
      throw new Error(`Invalid Vinted item URL: ${args.url}`);
    }
    return { itemId: parsed.id, country: parsed.country };
  }
  if (args.itemId) {
    return { itemId: Number(args.itemId), country: args.country || defaultCountry() };
  }
  throw new Error("Either itemId or url must be provided");
}

export async function colourFilter(client: VintedAPIClient, args: any, country: string) {
  const resolved = args.colours?.length ? await client.resolveColours(args.colours, country) : [];
  return { ids: resolved.length ? resolved.map((colour) => colour.id) : undefined, resolved };
}

/** Brand names in `brands` resolve to IDs and join any `brandIds` given directly. */
export async function brandFilter(client: VintedAPIClient, args: any, country: string) {
  const resolved = args.brands?.length ? await client.resolveBrands(args.brands, country) : [];
  const ids = [...(args.brandIds || []), ...resolved.map((brand) => brand.id)];
  return { ids: ids.length ? ids : undefined, resolved };
}
