import type { VintedAPIClient } from "../vinted-core";
import { itemTargetProperties } from "./get-item";
import { itemTarget } from "./shared";

export const likeItemTool = {
  name: "like_item",
  description:
    "Add a Vinted item to your favourites (or remove it with unlike). Requires a logged-in session: run 'vinted-mcp login' once.",
  inputSchema: {
    type: "object",
    properties: {
      ...itemTargetProperties,
      unlike: { type: "boolean", description: "Remove the item from favourites instead of adding it", default: false }
    }
  }
};

export async function handleLikeItem(client: VintedAPIClient, args: any): Promise<string> {
  const { itemId, country } = itemTarget(args);
  const result = await client.setFavourite(itemId, country, !args.unlike);
  return JSON.stringify(result, null, 2);
}
