#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "rules");
const outputDir = path.join(sourceDir, "sing-box");
const ruleSetNames = [
  "private",
  "windows-update",
  "traffic-heavy",
  "google",
  "ai",
  "microsoft",
  "github",
  "telegram",
  "bank",
  "travel-direct",
  "dmm",
  "direct",
  "proxy",
];

const fieldByType = new Map([
  ["DOMAIN", "domain"],
  ["DOMAIN-SUFFIX", "domain_suffix"],
  ["DOMAIN-KEYWORD", "domain_keyword"],
  ["IP-CIDR", "ip_cidr"],
  ["IP-CIDR6", "ip_cidr"],
]);

function convertList(contents, filename) {
  const converted = {};

  for (const [index, originalLine] of contents.split(/\r?\n/).entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [rawType, rawValue] = line.split(",", 3);
    const type = rawType?.trim().toUpperCase();
    const value = rawValue?.trim();
    const field = fieldByType.get(type);

    if (!field || !value) {
      throw new Error(
        `${filename}:${index + 1}: unsupported or malformed rule: ${originalLine}`,
      );
    }

    (converted[field] ??= []).push(value);
  }

  if (Object.keys(converted).length === 0) {
    throw new Error(`${filename}: no rules found`);
  }

  return { version: 3, rules: [converted] };
}

await mkdir(outputDir, { recursive: true });

for (const name of ruleSetNames) {
  const source = path.join(sourceDir, `${name}.list`);
  const destination = path.join(outputDir, `${name}.json`);
  const contents = await readFile(source, "utf8");
  const ruleSet = convertList(contents, path.relative(root, source));
  await writeFile(destination, `${JSON.stringify(ruleSet, null, 2)}\n`);
  console.log(`generated ${path.relative(root, destination)}`);
}
