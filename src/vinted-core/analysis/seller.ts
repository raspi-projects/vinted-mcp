import { getBaseUrl, getCountry } from "../models/country";
import { toStars, type ParsedItem } from "../parsers/response-parser";
import { priceStats } from "./deals";

export interface SellerReportInput {
  user: any;
  /** Newest reviews first, as the feedback API returns them. */
  latestFeedback: any[];
  /** The last feedback page, so the oldest review is in it. */
  oldestFeedback: any[];
  feedbackTotal?: number;
  /** A sample of the seller's active listings, newest first. */
  listings: ParsedItem[];
  country: string;
  brand?: string;
  itemLimit?: number;
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns the raw profile, reviews and wardrobe into the facts a buyer checks
 * before paying. Flags state what was observed; judging them is the caller's job.
 */
export function buildSellerReport(input: SellerReportInput) {
  const { user, listings, country } = input;
  const now = input.now ?? Date.now();
  const flags: string[] = [];

  const total = Number(user.feedback_count) || 0;
  const positive = Number(user.positive_feedback_count) || 0;
  const neutral = Number(user.neutral_feedback_count) || 0;
  const negative = Number(user.negative_feedback_count) || 0;
  const rating = toStars(user.feedback_reputation);

  const reviews = input.latestFeedback.map(toReview);
  const oldest = [...input.oldestFeedback, ...input.latestFeedback]
    .map((feedback) => Date.parse(feedback.created_at_ts))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const oldestReviewAt = oldest ? new Date(oldest).toISOString() : null;

  if (total === 0) {
    flags.push("No reviews yet");
  } else if (total < 5) {
    flags.push(`Only ${total} review${total === 1 ? "" : "s"}`);
  }
  if (total > 0 && negative / total >= 0.05) {
    flags.push(`${Math.round((negative / total) * 100)}% of reviews are negative (${negative} of ${total})`);
  }
  if (rating !== null && total >= 5 && rating < 4.5) {
    flags.push(`Rating ${rating}/5 is below 4.5`);
  }
  if (oldest && now - oldest < 90 * DAY_MS) {
    flags.push(`Oldest review is from ${oldestReviewAt!.slice(0, 10)}: new or only recently active account`);
  }

  const verification = user.verification || {};
  const verifications = {
    email: Boolean(verification.email?.valid),
    google: Boolean(verification.google?.valid),
    facebook: Boolean(verification.facebook?.valid)
  };
  if (!verifications.email && !verifications.google && !verifications.facebook) {
    flags.push("No verified email, Google or Facebook");
  }

  const lastSeen = Date.parse(user.last_loged_on_ts);
  if (Number.isFinite(lastSeen) && now - lastSeen > 30 * DAY_MS) {
    flags.push(`Last seen ${new Date(lastSeen).toISOString().slice(0, 10)}`);
  }
  if (user.is_on_holiday) {
    flags.push("On holiday mode");
  }
  if (user.is_account_banned) {
    flags.push("Account is banned");
  }
  if (user.business) {
    flags.push("Business (Pro) seller account");
  }
  const buyerCountry = getCountry(country).name;
  if (user.country_title && user.country_title !== buyerCountry) {
    flags.push(`Seller is in ${user.country_title}, not ${buyerCountry}: international postage and possible import charges`);
  }

  const listingSummary = summariseListings(listings, input.brand);
  flags.push(...listingSummary.flags);

  return {
    id: user.id,
    username: user.login || "",
    profileUrl: user.profile_url || `${getBaseUrl(country)}/member/${user.id}`,
    rating,
    ratingCount: total,
    reviews: {
      total: input.feedbackTotal ?? total,
      positive,
      neutral,
      negative,
      oldestReviewAt,
      note: "Counts include reviews the user received as a buyer."
    },
    activity: {
      soldCount: Number(user.given_item_count) || 0,
      boughtCount: Number(user.taken_item_count) || 0,
      activeListings: Number(user.item_count) || 0,
      followers: Number(user.followers_count) || 0,
      lastSeenAt: user.last_loged_on_ts || null,
      onHoliday: Boolean(user.is_on_holiday),
      bundleDiscounts: user.bundle_discount?.enabled
        ? (user.bundle_discount.discounts || []).map(
            (tier: any) => `${Math.round(Number(tier.fraction) * 100)}% off ${tier.minimal_item_count}+ items`
          )
        : []
    },
    account: {
      business: Boolean(user.business),
      city: user.city || null,
      country: user.country_title || null,
      verifications
    },
    flags,
    listings: listingSummary.summary,
    recentReviews: reviews.filter((review) => !review.automatic).slice(0, 5),
    criticalReviews: reviews.filter((review) => review.rating !== null && review.rating <= 3).slice(0, 10),
    recentItems: listings.slice(0, input.itemLimit ?? 10).map((item) => ({
      id: item.id,
      title: item.title,
      price: `${item.price.toFixed(2)} ${item.currency}`,
      brand: item.brand,
      size: item.size,
      condition: item.condition,
      listedAt: item.listedAt,
      url: item.url
    }))
  };
}

function toReview(feedback: any) {
  const rating = Number(feedback.rating);
  return {
    rating: Number.isFinite(rating) ? rating : null,
    comment: feedback.feedback || "",
    createdAt: feedback.created_at_ts || null,
    automatic: Boolean(feedback.system_feedback) || /^auto-feedback/i.test(feedback.feedback || "")
  };
}

function summariseListings(listings: ParsedItem[], brand?: string) {
  const flags: string[] = [];
  const sampled = listings.length;

  const brandCounts = countBy(listings.map((item) => item.brand || "(no brand)"));
  const topBrands = [...brandCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ brand: name, count }));
  const newWithTags = listings.filter((item) => item.condition === "New with tags").length;
  const duplicateTitles = [...countBy(listings.map((item) => titleKey(item.title))).entries()]
    .filter(([key, count]) => key && count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ title: listings.find((item) => titleKey(item.title) === key)!.title, count }));

  if (sampled >= 10 && newWithTags >= 10 && newWithTags / sampled >= 0.5) {
    flags.push(`${newWithTags} of ${sampled} sampled listings are new with tags`);
  }
  for (const duplicate of duplicateTitles) {
    flags.push(`Same listing title ${duplicate.count} times: "${duplicate.title}"`);
  }
  if (sampled >= 10 && topBrands[0] && topBrands[0].count / sampled >= 0.7) {
    flags.push(`${topBrands[0].count} of ${sampled} sampled listings are ${topBrands[0].brand}`);
  }

  const stats = priceStats(listings.map((item) => item.price));
  const brandMatches = brand
    ? listings.filter((item) => (item.brand || "").toLowerCase().includes(brand.toLowerCase())).length
    : undefined;

  return {
    flags,
    summary: {
      sampled,
      newWithTags,
      topBrands,
      duplicateTitles,
      ...(brandMatches !== undefined ? { brandMatches } : {}),
      priceRange: stats ? { min: stats.min, median: stats.median, max: stats.max, currency: listings[0]?.currency } : null
    }
  };
}

/** Collapses sizes and spacing so "Polo shirt size M" and "Polo shirt size L" count as one title. */
function titleKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/\b(size|taille|xxs|xs|s|m|l|xl|xxl|xxxl|\d+(\.\d+)?)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}
