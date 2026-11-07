import { CookieFactory } from "../auth/cookie-factory";
import { EnvAuth } from "../auth/env-auth";
import { HttpAuth } from "../auth/http-auth";
import { ProfileAuth, hasProfile, loginHint } from "../auth/profile-auth";
import { TokenCache } from "../auth/token-cache";
import { getBaseUrl } from "../models/country";
import { buildSellerReport } from "../analysis/seller";
import {
  buildBrandSearchUrl,
  buildColoursUrl,
  buildFavouriteToggleUrl,
  buildItemPageUrl,
  buildItemServicesUrl,
  buildSearchUrl,
  buildUserFeedbacksUrl,
  buildUserUrl,
  buildWardrobeUrl
} from "./endpoints";
import { RateLimiter } from "./rate-limiter";
import { parseItemPage, type ItemPagePhoto } from "../parsers/item-page";
import { QrRegistry, qrIssuer, readQrCodes } from "../qr";
import { amount, parseItem, parseSearchResponse, parseSeller, unixToIso, type ParsedItem } from "../parsers/response-parser";
import type { AuthSession, ClientOptions, SearchParams } from "../types";
import { getRandomUserAgent, getBrowserHeaders, runtimeRequire } from "../auth/utils";

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export class VintedAPIClient {
  private readonly tokenCache = new TokenCache();
  private readonly httpAuth: HttpAuth;
  private readonly envAuth: EnvAuth;
  private readonly profileAuth = new ProfileAuth();
  private readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly proxies: string[];
  private readonly authMode: "http" | "playwright" | "env";
  private cookieFactory: CookieFactory | null = null;
  private consecutiveFailures = 0;
  private readonly wardrobeCache = new Map<string, { at: number; items: any[] }>();
  private colours: Promise<Array<{ id: number; title: string }>> | null = null;
  private readonly qrRegistry = new QrRegistry();
  private readonly itemCache = new Map<string, { at: number; item: ReturnType<VintedAPIClient["loadItem"]> }>();
  private readonly sessionRequestCount = new Map<string, number>();
  private readonly sessionLocks = new Map<string, Promise<AuthSession>>();
  private cooldownUntil = 0;

  private static readonly MAX_CONSECUTIVE_FAILURES = 10;
  private static readonly BACKOFF_MS = 30000;
  private static readonly MAX_BACKOFF_MS = 60000;
  private static readonly LONG_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly MAX_REQUESTS_PER_SESSION = 40;
  private static readonly WARDROBE_PAGE_SIZE = 96;
  private static readonly WARDROBE_CACHE_MS = 5 * 60 * 1000;
  private static readonly ITEM_CACHE_MS = 2 * 60 * 1000;
  private static readonly MAX_IMAGE_BYTES = 4 * 1024 * 1024;

  constructor(options: ClientOptions = {}) {
    this.authMode = options.authMode || "http";
    this.proxies = options.proxies || (options.proxyUrl ? [options.proxyUrl] : []);
    this.httpAuth = new HttpAuth(this.tokenCache, this.proxies.length > 0 ? this.proxies[0] : undefined);
    this.envAuth = new EnvAuth(new TokenCache());
    this.rateLimiter = new RateLimiter(options.maxConcurrency || 5, options.requestDelayMs || 500, options.jitterMs || 300);
    this.maxRetries = options.maxRetries || 3;

    if (this.authMode === "playwright") {
      this.cookieFactory = new CookieFactory(this.tokenCache);
    }
  }

  async searchItems(params: SearchParams) {
    const url = buildSearchUrl(params);
    const data = await this.makeRequest(url, params.country);
    return parseSearchResponse(data, params.country, params.page || 1, params.perPage || 24);
  }

  /** Fetches up to `pages` result pages of 96 listings, for price statistics. */
  async searchSample(params: SearchParams, pages: number) {
    const seen = new Set<number>();
    const items: ParsedItem[] = [];
    let totalCount = 0;

    for (let page = 1; page <= pages; page++) {
      const result = await this.searchItems({ ...params, page, perPage: 96 });
      totalCount = result.totalCount;
      for (const item of result.items) {
        // Promoted listings repeat across pages.
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      if (result.items.length < 96) {
        break;
      }
    }

    return { items, totalCount };
  }

  async findBrands(keyword: string, country: string) {
    const data = await this.makeRequest(buildBrandSearchUrl(keyword, country), country);
    return (data.brands || []).map((brand: any) => ({
      id: brand.id,
      title: brand.title,
      itemCount: brand.item_count || 0,
      requiresAuthenticityCheck: Boolean(brand.requires_authenticity_check),
      isLuxury: Boolean(brand.is_luxury)
    }));
  }

  /** Resolves colour names ("navy", "light blue") to Vinted's colour ids. */
  async resolveColours(names: string[], country: string) {
    if (!this.colours) {
      this.colours = this.makeRequest(buildColoursUrl(country), country).then((data) =>
        (data.colors || []).map((colour: any) => ({ id: colour.id, title: colour.title }))
      );
      this.colours.catch(() => (this.colours = null));
    }

    const colours = await this.colours;
    return names.map((name) => {
      const match = colours.find((colour) => colour.title.toLowerCase() === name.trim().toLowerCase());
      if (!match) {
        throw new Error(`Unknown colour "${name}". Vinted's colours: ${colours.map((colour) => colour.title).join(", ")}`);
      }
      return match;
    });
  }

  /** Resolves brand names to ids, preferring an exact title match over the most-listed partial one. */
  async resolveBrands(names: string[], country: string) {
    const resolved: Array<{ name: string; id: number; title: string }> = [];
    for (const name of names) {
      const brands = await this.findBrands(name, country);
      const exact = brands.find((brand: any) => brand.title.toLowerCase() === name.trim().toLowerCase());
      const best = exact || [...brands].sort((a: any, b: any) => b.itemCount - a.itemCount)[0];
      if (!best) {
        throw new Error(`No Vinted brand matches "${name}"`);
      }
      resolved.push({ name, id: best.id, title: best.title });
    }
    return resolved;
  }

  /**
   * Vinted removed the item JSON API. The public item page has the details
   * and 800px photos; the seller's wardrobe adds original-size photos,
   * upload times, views and the total with buyer protection. Cached briefly,
   * since get_item_photos usually follows get_item for the same listing.
   */
  getItem(id: number, country: string) {
    const key = `${country}:${id}`;
    const cached = this.itemCache.get(key);
    if (cached && Date.now() - cached.at < VintedAPIClient.ITEM_CACHE_MS) {
      return cached.item;
    }

    const item = this.loadItem(id, country);
    this.itemCache.set(key, { at: Date.now(), item });
    item.catch(() => this.itemCache.delete(key));
    return item;
  }

  private async loadItem(id: number, country: string) {
    const pageUrl = buildItemPageUrl(id, country);
    const page = parseItemPage(await this.fetchItemPage(id, country), id, pageUrl);
    if (!page.title && !page.photos.length) {
      throw new Error(`Could not read item ${id} from ${pageUrl}`);
    }

    const [listing, seller, services] = await Promise.all([
      page.sellerId ? this.findListing(page.sellerId, id, country).catch(() => null) : null,
      page.sellerId
        ? this.makeRequest(buildUserUrl(page.sellerId, country), country)
            .then((data) => parseSeller(data.user || data, country))
            .catch(() => null)
        : null,
      this.makeRequest(buildItemServicesUrl(id, country), country)
        .then((data) => data.services || null)
        .catch(() => null)
    ]);

    const listingPhotos: any[] = listing?.photos || [];
    const pagePhotos: ItemPagePhoto[] = page.photos.length
      ? page.photos
      : listingPhotos.map((photo) => ({ id: String(photo.high_resolution?.id), url: photo.url, width: photo.width, height: photo.height }));
    const photos = pagePhotos.map((photo, index) => {
      const match = listingPhotos.find((entry) => entry?.high_resolution?.id === photo.id) || listingPhotos[index];
      return {
        index: index + 1,
        width: photo.width,
        height: photo.height,
        url: photo.url,
        fullSizeUrl: (match?.full_size_url as string) || null,
        uploadedAt: unixToIso(match?.high_resolution?.timestamp)
      };
    });
    const uploadTimes = photos.map((photo) => photo.uploadedAt).filter(Boolean).sort();

    // The page shows the seller's own currency; the wardrobe converts to the
    // buyer's, as search does. Sellers abroad list in USD, EUR and so on.
    const price = amount(listing?.price) ?? page.price;
    const currency = listing?.price?.currency_code || page.currency;

    return {
      ...page,
      price,
      currency,
      sellerPrice: page.currency !== currency ? { amount: page.price, currency: page.currency } : null,
      photos,
      totalPrice: amount(listing?.total_item_price),
      viewCount: listing ? Number(listing.view_count) || 0 : null,
      favouriteCount: listing ? Number(listing.favourite_count) || 0 : page.favouriteCount,
      listedAt: (uploadTimes[0] as string) || null,
      seller: { ...(seller || { id: page.sellerId }), badges: page.sellerBadges },
      services: services
        ? {
            vintedFee: amount(services.buyer_protection?.final_price),
            postage: amount(services.shipping?.final_price),
            postageBeforeDiscount: amount(services.shipping?.original_price),
            itemVerificationFee: amount(services.item_verification?.final_price),
            itemVerificationListed: Boolean(services.item_verification)
          }
        : null,
      signedIn: this.hasSignedInSession(country)
    };
  }

  /** Profile, reviews and a sample of active listings, condensed by buildSellerReport. */
  async getSeller(id: number, country: string, options: { brand?: string; itemLimit?: number; wardrobePages?: number } = {}) {
    const [userData, latest, listings] = await Promise.all([
      this.makeRequest(buildUserUrl(id, country), country),
      this.makeRequest(buildUserFeedbacksUrl(id, country, 1, 100), country).catch(() => null),
      this.getWardrobeItems(id, country, options.wardrobePages ?? 2).catch(() => [])
    ]);

    const lastPage = latest?.pagination?.total_pages || 1;
    const oldest = lastPage > 1 ? await this.makeRequest(buildUserFeedbacksUrl(id, country, lastPage, 100), country).catch(() => null) : null;

    return buildSellerReport({
      user: userData.user || userData,
      latestFeedback: latest?.user_feedbacks || [],
      oldestFeedback: oldest?.user_feedbacks || [],
      feedbackTotal: latest?.pagination?.total_entries,
      listings: listings.map((raw: any) => parseItem(raw, country)),
      country,
      brand: options.brand,
      itemLimit: options.itemLimit
    });
  }

  /**
   * Decodes QR codes in a listing's original photos (cached for a week) and
   * says, per code, whether it links into Ralph Lauren's ID system and which
   * other listings showed the same code. Originals are JPEG; the 800px page
   * photos are WebP, which the decoder can't read, so a listing whose
   * originals aren't in the seller's wardrobe can't be checked.
   */
  async scanQrLabels(id: number, country: string, options: { useCache?: boolean; cacheOnly?: boolean } = {}) {
    let scan = options.useCache === false ? null : this.qrRegistry.cachedScan(id);
    const cached = Boolean(scan);

    if (!scan && options.cacheOnly) {
      return null;
    }
    if (!scan) {
      const item = await this.getItem(id, country);
      const originals = item.photos.filter((photo) => photo.fullSizeUrl);
      const codes: Array<{ photo: number; text: string }> = [];
      await Promise.all(
        originals.map(async (photo) => {
          const image = await this.fetchImageBytes(photo.fullSizeUrl as string).catch(() => null);
          const texts = image ? await readQrCodes(image.bytes).catch(() => []) : [];
          texts.forEach((text) => codes.push({ photo: photo.index, text }));
        })
      );
      codes.sort((a, b) => a.photo - b.photo);
      scan = { checkedAt: new Date().toISOString(), photosChecked: originals.length, originals: originals.length > 0, codes };
      this.qrRegistry.record(id, (item.seller as any)?.id ?? null, scan);
    }

    const byText = new Map<string, number[]>();
    for (const { photo, text } of scan.codes) {
      byText.set(text, [...(byText.get(text) || []), photo]);
    }

    return {
      checkedAt: scan.checkedAt,
      cached,
      photosChecked: scan.photosChecked,
      originals: scan.originals,
      codes: [...byText.entries()].map(([text, photos]) => ({
        text,
        photos,
        ...qrIssuer(text),
        alsoInListings: this.qrRegistry.otherListings(text, id)
      }))
    };
  }

  /** Downloads a photo from Vinted's image CDN as base64, for MCP image content. */
  async fetchImage(url: string): Promise<{ data: string; mimeType: string; bytes: number }> {
    const image = await this.fetchImageBytes(url);
    const { Buffer } = runtimeRequire("buffer");
    return { data: Buffer.from(image.bytes).toString("base64"), mimeType: image.mimeType, bytes: image.bytes.length };
  }

  private async fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    if (!/^https:\/\/images\d*\.vinted\.net\//.test(url)) {
      throw new Error(`Not a Vinted image URL: ${url}`);
    }

    const dispatcher = this.getProxyDispatcher();
    const response = await fetch(url, {
      headers: { "User-Agent": getRandomUserAgent(), Accept: "image/webp,image/jpeg,image/*" },
      ...(dispatcher ? { dispatcher } : {})
    } as RequestInit);
    if (!response.ok) {
      throw new Error(`Photo fetch failed: ${response.status} ${response.statusText}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > VintedAPIClient.MAX_IMAGE_BYTES) {
      throw new Error(`Photo is ${Math.round(bytes.length / 1024)} KB, over the ${VintedAPIClient.MAX_IMAGE_BYTES / 1024} KB limit`);
    }

    return { bytes, mimeType: (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim() };
  }

  /** The wardrobe is the only API left that has a listing's original photos and upload times. */
  private async findListing(sellerId: number, itemId: number, country: string, maxPages = 3): Promise<any | null> {
    for (let page = 1; page <= maxPages; page++) {
      const items = await this.getWardrobePage(sellerId, country, page);
      const hit = items.find((item: any) => Number(item.id) === itemId);
      if (hit) {
        return hit;
      }
      if (items.length < VintedAPIClient.WARDROBE_PAGE_SIZE) {
        return null;
      }
    }
    return null;
  }

  private async getWardrobeItems(sellerId: number, country: string, maxPages: number): Promise<any[]> {
    const items: any[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const pageItems = await this.getWardrobePage(sellerId, country, page);
      items.push(...pageItems);
      if (pageItems.length < VintedAPIClient.WARDROBE_PAGE_SIZE) {
        break;
      }
    }
    return items;
  }

  private async getWardrobePage(sellerId: number, country: string, page: number): Promise<any[]> {
    const key = `${country}:${sellerId}:${page}`;
    const cached = this.wardrobeCache.get(key);
    if (cached && Date.now() - cached.at < VintedAPIClient.WARDROBE_CACHE_MS) {
      return cached.items;
    }

    const url = buildWardrobeUrl(sellerId, country, page, VintedAPIClient.WARDROBE_PAGE_SIZE, "newest_first");
    const items = (await this.makeRequest(url, country)).items || [];
    this.wardrobeCache.set(key, { at: Date.now(), items });
    return items;
  }

  async getSellerItems(id: number, country: string, perPage = 24) {
    const data = await this.makeRequest(buildWardrobeUrl(id, country, 1, perPage), country);
    return (data.items || []).map((item: any) => parseItem(item, country));
  }

  async getTrending(query: string, country: string, perPage = 24) {
    const result = await this.searchItems({ query, country, perPage, sortBy: "relevance" });
    return result.items.sort((a: any, b: any) => (b.favouriteCount || 0) - (a.favouriteCount || 0));
  }

  async comparePrices(query: string, countries: string[], limitPerCountry = 20) {
    const comparisons: Array<{
      country: string;
      avgPrice: number;
      medianPrice: number;
      minPrice: number;
      maxPrice: number;
      itemCount: number;
      currency: string;
    }> = [];

    const results = await Promise.allSettled(
      countries.map(async (country) => {
        const searchResult = await this.searchItems({
          query,
          country,
          perPage: limitPerCountry,
          sortBy: "relevance"
        });

        return { country, items: searchResult.items };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }

      const { country, items } = result.value;
      if (!items.length) {
        continue;
      }

      const prices = items.map((item: any) => item.price).sort((a: number, b: number) => a - b);
      const sum = prices.reduce((a: number, b: number) => a + b, 0);
      const avg = sum / prices.length;
      const median =
        prices.length % 2 === 0
          ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
          : prices[Math.floor(prices.length / 2)];

      comparisons.push({
        country,
        avgPrice: Math.round(avg * 100) / 100,
        medianPrice: Math.round(median * 100) / 100,
        minPrice: prices[0],
        maxPrice: prices[prices.length - 1],
        itemCount: items.length,
        currency: items[0].currency
      });
    }

    const validComparisons = comparisons.filter((comparison) => comparison.avgPrice > 0);

    let bestBuyCountry = validComparisons[0]?.country || "";
    let bestSellCountry = validComparisons[0]?.country || "";
    let minAvg = Number.POSITIVE_INFINITY;
    let maxAvg = 0;

    for (const comparison of validComparisons) {
      if (comparison.avgPrice < minAvg) {
        minAvg = comparison.avgPrice;
        bestBuyCountry = comparison.country;
      }
      if (comparison.avgPrice > maxAvg) {
        maxAvg = comparison.avgPrice;
        bestSellCountry = comparison.country;
      }
    }

    const spread =
      maxAvg > 0 && Number.isFinite(minAvg)
        ? Math.round((((maxAvg - minAvg) / minAvg) * 100) * 10) / 10
        : 0;

    return {
      query,
      comparisons,
      bestBuyCountry,
      bestSellCountry,
      arbitrageSpreadPct: spread
    };
  }

  /**
   * Vinted's favourite endpoint is a toggle, so read the current state first;
   * liking an already-liked item would otherwise unlike it.
   */
  async setFavourite(itemId: number, country: string, liked: boolean) {
    const key = country.toLowerCase();
    const url = buildItemPageUrl(itemId, key);

    try {
      // The item JSON API is gone, so read the current state off the item page
      // with the logged-in session. The toggle endpoint would otherwise unlike
      // an item that is already liked.
      const html = await this.fetchItemPage(itemId, key);
      const likedMatch = html.match(/\\"is_favourite\\":(true|false)/);
      if (!likedMatch) {
        throw new Error("Could not read the item's current favourite state from the item page");
      }

      const wasLiked = likedMatch[1] === "true";
      if (wasLiked !== liked) {
        await this.makeRequest(buildFavouriteToggleUrl(key), key, {
          method: "POST",
          body: { type: "item", user_favourites: [itemId] }
        });
      }

      const titleMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      const title = titleMatch ? (safeJsonParse(titleMatch[1])?.name ?? "") : "";

      return {
        id: itemId,
        title,
        liked,
        changed: wasLiked !== liked,
        url
      };
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.includes("401") || message.includes("403")) {
        throw new Error(`${loginHint(key)} (${message})`);
      }
      throw error;
    }
  }

  /** Env credentials or a saved login profile mean requests go out as the user. */
  hasSignedInSession(country: string): boolean {
    return this.authMode === "env" || hasProfile(country);
  }

  invalidateSession(country: string): void {
    this.tokenCache.invalidate(country);
    this.envAuth.invalidate(country);
  }

  clearSessions(): void {
    this.tokenCache.invalidateAll();
    this.envAuth.clear();
  }

  private async getSession(country: string): Promise<AuthSession> {
    const key = country.toLowerCase();
    const existing = this.sessionLocks.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.createSession(key).finally(() => {
      this.sessionLocks.delete(key);
    });
    this.sessionLocks.set(key, promise);
    return promise;
  }

  private async createSession(country: string): Promise<AuthSession> {
    if (this.authMode === "env") {
      return this.envAuth.createSession(country);
    }

    if (hasProfile(country)) {
      try {
        return await this.profileAuth.createSession(country);
      } catch (error: any) {
        console.warn(`[vinted-core] Profile session failed for ${country}: ${error?.message || error}`);
      }
    }

    if (this.cookieFactory) {
      try {
        return await this.cookieFactory.createSession(country);
      } catch {
        // Fallback to HTTP auth.
      }
    }

    return this.httpAuth.createSession(country);
  }

  private async makeRequest(url: string, country: string, options: RequestOptions = {}, retryCount = 0): Promise<any> {
    const key = country.toLowerCase();

    if (this.consecutiveFailures >= VintedAPIClient.MAX_CONSECUTIVE_FAILURES) {
      if (Date.now() < this.cooldownUntil) {
        await sleep(this.cooldownUntil - Date.now());
      } else {
        this.cooldownUntil = Date.now() + VintedAPIClient.LONG_COOLDOWN_MS;
        this.rateLimiter.pause(VintedAPIClient.LONG_COOLDOWN_MS);
        console.warn(
          `[vinted-core] ${VintedAPIClient.MAX_CONSECUTIVE_FAILURES} consecutive failures, cooling down ${VintedAPIClient.LONG_COOLDOWN_MS}ms before retrying`
        );
        await sleep(VintedAPIClient.LONG_COOLDOWN_MS);
      }
      this.consecutiveFailures = 0;
      this.tokenCache.invalidate(key);
      this.sessionRequestCount.set(key, 0);
    }

    const currentCount = this.sessionRequestCount.get(key) || 0;
    if (currentCount >= VintedAPIClient.MAX_REQUESTS_PER_SESSION) {
      this.tokenCache.invalidate(key);
      this.sessionRequestCount.set(key, 0);
    }

    const session = await this.getSession(key);
    this.sessionRequestCount.set(key, (this.sessionRequestCount.get(key) || 0) + 1);

    const cookieHeader = Object.entries(session.cookies)
      .map(([k, value]) => `${k}=${value}`)
      .join("; ");

    const ua = getRandomUserAgent();
    const baseUrl = getBaseUrl(key);
    const headers: Record<string, string> = {
      ...getBrowserHeaders(ua),
      Cookie: cookieHeader,
      "X-CSRF-Token": session.csrfToken,
      Referer: `${baseUrl}/`,
      Origin: baseUrl
    };

    if (session.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    try {
      const fetchOptions: Record<string, unknown> = {
        headers,
        redirect: "follow",
        method: options.method || "GET"
      };

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(options.body);
      }

      const dispatcher = this.getProxyDispatcher();
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const response = await this.rateLimiter.execute(() => fetch(url, fetchOptions as RequestInit));

      if (response.ok) {
        this.consecutiveFailures = 0;
        return parseJsonBody(await response.text());
      }

      const status = response.status;
      const retriable = status === 401 || status === 403 || status === 429 || status === 503;

      if (retriable && retryCount < this.maxRetries) {
        this.tokenCache.invalidate(key);
        this.sessionRequestCount.set(key, 0);

        if (this.authMode === "env" && status === 401) {
          this.envAuth.invalidate(key);
        }

        if (status === 401 || status === 403) {
          this.profileAuth.invalidate(key);
        }

        let pauseMs = 0;
        if (status === 401) {
          // First 401 likely just an expired token; don't penalize backoff yet.
          pauseMs = retryCount === 0 ? 250 : this.computeBackoff(retryCount);
          if (retryCount > 0) {
            this.consecutiveFailures += 1;
          }
        } else {
          this.consecutiveFailures += 1;
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          pauseMs = retryAfter ?? this.computeBackoff(this.consecutiveFailures);
        }

        const body = await response.text().catch(() => "");
        if (this.looksLikeCloudflare(response, body) && this.cookieFactory) {
          await this.cookieFactory.createSession(key).catch(() => undefined);
        }

        if (pauseMs > 0) {
          this.rateLimiter.pause(pauseMs);
          await sleep(pauseMs);
        }

        return this.makeRequest(url, key, options, retryCount + 1);
      }

      throw new Error(`Vinted API error: ${status} ${response.statusText}`);
    } catch (error: any) {
      if (retryCount < this.maxRetries && (error instanceof TypeError || error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT")) {
        this.consecutiveFailures += 1;
        const pauseMs = this.computeBackoff(retryCount + 1);
        this.rateLimiter.pause(pauseMs);
        await sleep(pauseMs);
        return this.makeRequest(url, key, options, retryCount + 1);
      }

      throw error;
    }
  }

  private computeBackoff(attempt: number): number {
    const exp = Math.min(VintedAPIClient.MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.max(0, attempt)));
    const jitter = Math.floor(Math.random() * 500);
    return exp + jitter;
  }

  private looksLikeCloudflare(response: Response, body: string): boolean {
    const server = response.headers.get("server")?.toLowerCase() || "";
    if (server.includes("cloudflare")) {
      return true;
    }
    if (response.headers.get("cf-mitigated") || response.headers.get("cf-ray")) {
      return true;
    }
    return body.includes("cf-challenge") || body.includes("Just a moment") || body.includes("Attention Required");
  }

  private async fetchItemPage(id: number, country: string, retryCount = 0): Promise<string> {
    const dispatcher = this.getProxyDispatcher();

    let cookieHeader = "";
    try {
      const session = await this.getSession(country);
      cookieHeader = Object.entries(session.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    } catch {
      // Item pages load anonymously; a session is a nice-to-have, not required.
    }

    const response = await this.rateLimiter.execute(() =>
      fetch(buildItemPageUrl(id, country), {
        headers: {
          "User-Agent": getRandomUserAgent(),
          Accept: "text/html,application/xhtml+xml",
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        redirect: "follow",
        ...(dispatcher ? { dispatcher } : {})
      } as RequestInit)
    );

    // Item pages are rate-limited harder than the API; back off like makeRequest does.
    if ((response.status === 429 || response.status === 503) && retryCount < this.maxRetries) {
      const pauseMs = parseRetryAfter(response.headers.get("retry-after")) ?? this.computeBackoff(retryCount + 1);
      this.rateLimiter.pause(pauseMs);
      await sleep(pauseMs);
      return this.fetchItemPage(id, country, retryCount + 1);
    }

    if (!response.ok) {
      throw new Error(`Item page fetch failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  private getProxyDispatcher(): unknown {
    if (!this.proxies || this.proxies.length === 0) {
      return undefined;
    }

    const proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];

    try {
      const undici = runtimeRequire("undici") as { ProxyAgent?: new (url: string) => unknown };
      if (undici.ProxyAgent) {
        return new undici.ProxyAgent(proxy);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonBody(text: string): any {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(120_000, Math.round(seconds * 1000));
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.min(120_000, date - Date.now()));
  }
  return null;
}
