import type { ParsedItem } from "../parsers/response-parser";

export interface PriceStats {
  count: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/** Linear-interpolated quantiles over asking prices. */
export function priceStats(prices: number[]): PriceStats | null {
  const sorted = prices.filter((price) => Number.isFinite(price) && price > 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }

  const quantile = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    return round2(sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower));
  };

  return {
    count: sorted.length,
    min: sorted[0],
    p10: quantile(0.1),
    p25: quantile(0.25),
    median: quantile(0.5),
    p75: quantile(0.75),
    max: sorted[sorted.length - 1]
  };
}

export interface RankedDeal {
  item: ParsedItem;
  /** Asking price as a fraction of the sample median. */
  priceRatio: number;
  flags: string[];
}

/**
 * Below this fraction of the median a listing is more often fake, damaged,
 * mislabelled (kids' size, wrong item) or bait than a bargain.
 */
export const SUSPICIOUS_RATIO = 0.3;

export function rankDeals(items: ParsedItem[], stats: PriceStats, maxRatio: number): RankedDeal[] {
  const ranked: RankedDeal[] = [];
  for (const item of items) {
    if (!(item.price > 0) || item.isSold || item.isReserved) {
      continue;
    }

    const priceRatio = round2(item.price / stats.median);
    if (priceRatio > maxRatio) {
      continue;
    }

    const flags: string[] = [];
    if (priceRatio < SUSPICIOUS_RATIO) {
      flags.push(`under ${Math.round(SUSPICIOUS_RATIO * 100)}% of the median: check authenticity and condition first`);
    }
    if (item.condition === "New with tags" && priceRatio < 0.5) {
      flags.push("new with tags at under half the median");
    }
    if (item.promoted) {
      flags.push("promoted listing");
    }
    ranked.push({ item, priceRatio, flags });
  }

  return ranked.sort((a, b) => a.priceRatio - b.priceRatio || b.item.favouriteCount - a.item.favouriteCount);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
