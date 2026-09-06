#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "./lib/runner.mjs";

function usage() {
  console.error("Usage: node tools/resin-purpose-probe/probe.mjs scan --config <file> [--dry-run] [--limit N] [--allow-empty]");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--config") options.config = rest[++index];
    else if (value === "--dry-run") options.dryRun = true;
    else if (value === "--allow-empty") options.allowEmpty = true;
    else if (value === "--limit") options.limit = Number(rest[++index]);
    else throw new Error(`unknown argument: ${value}`);
  }
  if (command !== "scan" || !options.config || (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1))) {
    usage();
    process.exitCode = 2;
    return null;
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options) {
    const configFile = path.resolve(options.config);
    const config = JSON.parse(await readFile(configFile, "utf8"));
    await runScan(config, { ...options, configDir: path.dirname(configFile) });
  }
} catch (error) {
  console.error(`resin-purpose-probe: ${error.message}`);
  process.exitCode = 1;
}
