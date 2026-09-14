#!/usr/bin/env bun
/** make_config — generate adws/adw_sssf_config/sssf.config.yaml with great defaults. */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const TEMPLATE = join(dirname(import.meta.dir), "templates", "sssf.config.yaml");
const dest = join(process.cwd(), "adws", "adw_sssf_config", "sssf.config.yaml");
if (existsSync(dest) && !process.argv.includes("--force")) {
  console.log(`${dest} already exists — use --force to overwrite`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(TEMPLATE, dest);
console.log(`wrote ${dest}`);
