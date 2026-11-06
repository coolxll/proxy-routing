#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  {
    name: "MetaCubeX meta-rules-dat geosite-category-ads-all (compiled sing-box JSON)",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/category-ads-all.json",
    format: "json",
  },
  {
    name: "ACL4SSR BanAD",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list",
    format: "clash",
  },
  {
    name: "ACL4SSR BanProgramAD",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list",
    format: "clash",
  },
];

const typeOrder = ["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD"];
const supportedTypes = new Set(typeOrder);

function parseJson(contents) {
  const data = JSON.parse(contents);
  const rules = [];
  const skipped = { regexp: 0, other: 0 };

  for (const rule of data.rules ?? []) {
    for (const value of rule.domain ?? []) rules.push(`DOMAIN,${value.toLowerCase()}`);
    for (const value of rule.domain_suffix ?? []) rules.push(`DOMAIN-SUFFIX,${value.toLowerCase()}`);
    for (const value of rule.domain_keyword ?? []) rules.push(`DOMAIN-KEYWORD,${value.toLowerCase()}`);
    skipped.regexp += rule.domain_regex?.length ?? 0;

    for (const [field, value] of Object.entries(rule)) {
      if (["domain", "domain_suffix", "domain_keyword", "domain_regex"].includes(field)) continue;
      skipped.other += Array.isArray(value) ? value.length : 1;
    }
  }

  return { rules, skipped };
}

function parseClash(contents) {
  const rules = [];
  const skipped = { regexp: 0, other: 0 };

  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const [rawType, rawValue] = line.split(",");
    const type = rawType?.trim().toUpperCase();
    const value = rawValue?.trim().toLowerCase().replace(/\s+(no-resolve|src)$/i, "");
    if (!type || !value) continue;

    if (supportedTypes.has(type)) rules.push(`${type},${value}`);
    else skipped.other += 1;
  }

  return { rules, skipped };
}

const collected = new Map();

for (const source of sources) {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);

  const contents = await response.text();
  const { rules, skipped } = source.format === "json" ? parseJson(contents) : parseClash(contents);

  for (const rule of rules) {
    const key = rule.toLowerCase();
    if (!collected.has(key)) collected.set(key, rule);
  }

  console.log(
    `${source.name}: ${rules.length} rules ` +
      `(regexp ${skipped.regexp}, other ${skipped.other})`,
  );
}

const ordered = [...collected.values()].sort((a, b) => {
  const [aType, aValue] = a.split(",");
  const [bType, bValue] = b.split(",");
  const byType = typeOrder.indexOf(aType) - typeOrder.indexOf(bType);
  if (byType !== 0) return byType;
  return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
});

const banner = [
  "# 广告/追踪合并规则（自动生成，请勿手改）",
  "# 来源：",
  ...sources.map((source) => `#   - ${source.name}: ${source.url}`),
  "# 重新生成：node scripts/build-ad-union.mjs",
  "",
];

await writeFile(
  path.join(root, "rules", "ad-union.list"),
  [...banner, ...ordered, ""].join("\n"),
);

await writeFile(
  path.join(root, "providers", "ad-union.yaml"),
  [
    "payload:",
    "  # 自动生成，请勿手改；来源见 rules/ad-union.list",
    ...ordered.map((rule) => `  - '${rule}'`),
    "",
  ].join("\n"),
);

console.log(`wrote rules/ad-union.list and providers/ad-union.yaml (${ordered.length} unique rules)`);
