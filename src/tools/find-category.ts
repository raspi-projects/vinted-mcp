import { findCategories } from "../resources/categories";
import { jsonBlock, type ToolResult } from "./shared";

export const findCategoryTool = {
  name: "find_category",
  description:
    "Search Vinted's category tree for IDs to filter by, e.g. \"men polo\" gives Men > Clothing > Tops & t-shirts > Polo shirts. " +
    "Every word must appear in the category path. A parent category includes its children.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: 'Words to match, e.g. "men jumpers" or "women shirts"' },
      limit: { type: "integer", description: "Max categories to return", default: 15 }
    },
    required: ["query"]
  }
};

export async function handleFindCategory(_client: unknown, args: any): Promise<ToolResult> {
  const categories = findCategories(args.query || "", Math.min(args.limit || 15, 50));
  return [jsonBlock({ query: args.query, categories, note: categories.length ? undefined : "No match; try fewer words" })];
}
