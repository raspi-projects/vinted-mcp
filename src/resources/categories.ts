import snapshot from "./catalog-tree.json";

export const categoriesResource = {
  uri: "vinted://categories",
  name: "Vinted Categories",
  description: "Top three levels of Vinted's category tree with IDs; use find_category to search all of it",
  mimeType: "application/json"
};

// Regenerate with scripts/update-categories.cjs; IDs are shared by all Vinted countries.
const CATEGORIES = (snapshot.categories as Array<[number, string]>).map(([id, path]) => ({ id, path }));

export function getCategoriesData(): string {
  const shallow = CATEGORIES.filter((category) => category.path.split(" > ").length <= 3);
  return JSON.stringify({ fetchedAt: snapshot.fetchedAt, categories: shallow }, null, 2);
}

export function categoryPath(id: number | null | undefined): string | null {
  return CATEGORIES.find((category) => category.id === id)?.path || null;
}

/**
 * Every query word must start a word in the path ("men" must not match
 * "Women"). Matches in the category's own name rank first, then shallower
 * categories, since a parent filter includes its children.
 */
export function findCategories(query: string, limit = 15) {
  const words = query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu"));
  return CATEGORIES.filter((category) => words.every((word) => word.test(category.path)))
    .map((category) => {
      const parts = category.path.split(" > ");
      const own = parts[parts.length - 1];
      return { ...category, ownHits: words.filter((word) => word.test(own)).length, depth: parts.length };
    })
    .sort((a, b) => b.ownHits - a.ownHits || a.depth - b.depth)
    .slice(0, limit)
    .map(({ id, path }) => ({ id, path }));
}
