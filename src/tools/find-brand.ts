import { defaultCountry, type VintedAPIClient } from "../vinted-core";
import { countryProperty, jsonBlock, type ToolResult } from "./shared";

export const findBrandTool = {
  name: "find_brand",
  description:
    "Look up Vinted brand IDs by name, e.g. \"ralph lauren\" also finds sub-brands like Polo Ralph Lauren or Lauren Ralph Lauren. " +
    "requiresAuthenticityCheck marks brands Vinted treats as often counterfeited.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Brand name or part of it" },
      country: countryProperty
    },
    required: ["query"]
  }
};

export async function handleFindBrand(client: VintedAPIClient, args: any): Promise<ToolResult> {
  const brands = await client.findBrands(args.query, args.country || defaultCountry());
  return [jsonBlock({ query: args.query, brands: brands.slice(0, 15) })];
}
