#!/usr/bin/env node
// Regenerates src/resources/catalog-tree.json from Vinted's catalogue page.
// Run after `npm run build`: node scripts/update-categories.cjs [country-domain]
const fs = require("fs");
const path = require("path");
const { readFlightData, findJsonAfter } = require("../dist-ts/vinted-core/parsers/rsc.js");

const domain = process.argv[2] || "www.vinted.co.uk";
const out = path.join(__dirname, "..", "src", "resources", "catalog-tree.json");

(async () => {
  const response = await fetch(`https://${domain}/catalog`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html"
    }
  });
  if (!response.ok) {
    throw new Error(`${domain}/catalog answered ${response.status}`);
  }

  const tree = findJsonAfter(readFlightData(await response.text()), '"catalogTree":', Array.isArray);
  if (!tree) {
    throw new Error("No catalogTree in the page; Vinted changed its markup");
  }

  const categories = [];
  const walk = (node, parents) => {
    const trail = [...parents, node.title];
    categories.push([node.id, trail.join(" > ")]);
    for (const child of node.catalogs || []) {
      walk(child, trail);
    }
  };
  tree.forEach((root) => walk(root, []));

  const snapshot = { source: `https://${domain}/catalog`, fetchedAt: new Date().toISOString().slice(0, 10), categories };
  fs.writeFileSync(out, JSON.stringify(snapshot) + "\n");
  console.log(`Wrote ${categories.length} categories to ${path.relative(process.cwd(), out)}`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
