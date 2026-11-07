import type { VintedAPIClient } from "../vinted-core";
import { itemTargetProperties } from "./get-item";
import { itemTarget, photoBlocks, type ToolResult } from "./shared";

const MAX_PHOTOS = 6;

export const getItemPhotosTool = {
  name: "get_item_photos",
  description:
    "Get chosen photos of a listing at original size (usually 1200x1600) to check care labels, neck tags, logos, stitching and " +
    "flaws up close. Photo numbers are the ones get_item shows. Originals come from the seller's wardrobe; when the listing is " +
    "not found there, the 800px version is returned and labelled as such.",
  inputSchema: {
    type: "object",
    properties: {
      ...itemTargetProperties,
      photos: {
        type: "array",
        items: { type: "integer" },
        description: `Photo numbers, 1-based (max ${MAX_PHOTOS} per call)`
      }
    },
    required: ["photos"]
  }
};

export async function handleGetItemPhotos(client: VintedAPIClient, args: any): Promise<ToolResult> {
  const { itemId, country } = itemTarget(args);
  const item = await client.getItem(itemId, country);
  const wanted: number[] = (args.photos || []).slice(0, MAX_PHOTOS);
  const photos = wanted.map((index) => item.photos[index - 1]).filter(Boolean);
  if (!photos.length) {
    throw new Error(`Item ${itemId} has ${item.photos.length} photos; ask for numbers 1-${item.photos.length}`);
  }

  return photoBlocks(
    client,
    photos.map((photo) => ({
      label: photo.fullSizeUrl
        ? `Photo ${photo.index}/${item.photos.length} (original ${photo.width}x${photo.height})`
        : `Photo ${photo.index}/${item.photos.length} (800px high; original not available)`,
      url: photo.fullSizeUrl || photo.url
    }))
  );
}
