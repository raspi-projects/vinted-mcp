#!/usr/bin/env node

import { startServer } from "../index";
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
} else {
  startServer().catch((error) => {
    console.error("Failed to start Vinted MCP server:", error);
    process.exit?.(1);
  });
}
