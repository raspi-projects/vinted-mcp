#!/usr/bin/env node

import { callTool, createClient, startServer } from "../index";
import { defaultCountry } from "../vinted-core";
import { loginInteractive } from "../vinted-core/auth/profile-auth";

const argv = process.argv?.slice(2) || [];

if (argv[0] === "login") {
  const countryIndex = argv.indexOf("--country");
  const country = countryIndex >= 0 ? argv[countryIndex + 1] : defaultCountry();

  loginInteractive(country || defaultCountry()).catch((error) => {
    console.error(`Login failed: ${error?.message || error}`);
    process.exit?.(1);
  });
} else if (argv[0] === "call") {
  // `call <tool> '<json args>'` prints the tool's MCP result as JSON, for scripts
  // such as the hub's vinted connector. Exits 1 when the tool reports an error.
  let args: any;
  try {
    args = JSON.parse(argv[2] || "{}");
  } catch {
    console.error("Usage: vinted-mcp call <tool> '<json arguments>'");
    process.exit?.(2);
  }

  callTool(createClient(), argv[1] || "", args).then((result: any) => {
    process.stdout?.write(JSON.stringify(result) + "\n", () => process.exit?.(result.isError ? 1 : 0));
  });
} else {
  startServer().catch((error) => {
    console.error("Failed to start Vinted MCP server:", error);
    process.exit?.(1);
  });
}
