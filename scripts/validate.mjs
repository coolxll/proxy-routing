#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_GROUPS = ["🚀 节点选择", "Google", "🤖 AI", "⬇️ 大流量", "🇯🇵 日本", "♻️ 自动选择"];
const BUILTIN_TARGETS = ["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"];
const EXPECTED_PROVIDER_ORDER = [
  "private",
  "unban",
  "download",
  "windows-update",
  "traffic-heavy",
  "google",
  "ai",
  "microsoft",
  "github",
  "telegram",
  "bank",
  "travel-direct",
  "apple",
  "dmm",
  "direct",
  "proxy"
];

let checks = 0;
const errors = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function check(label, callback) {
  try {
    callback();
    checks += 1;
    console.log(`ok  ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: ${message}`);
    console.error(`ERR ${label}: ${message}`);
  }
}

function loadYaml(relativePath) {
  return parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  assert(result.status === 0, (result.stderr || result.stdout).trim());
}

function ruleTarget(rule) {
  const parts = rule.split(",");
  return parts[0] === "MATCH" ? parts[1] : parts[2];
}

function validateDns(config) {
  const dns = config.dns;
  assert(dns && typeof dns === "object", "缺少 dns 配置段");
  assert(!Object.prototype.hasOwnProperty.call(dns, "enabled"), "dns.enabled 无效；请使用 dns.enable");
  assert(Object.prototype.hasOwnProperty.call(dns, "enable"), "缺少 dns.enable");
  assert(typeof dns.enable === "boolean", "dns.enable 必须是布尔值");
  assert(dns.enable === true, "模板要求 dns.enable 为 true");
}

function validateTemplate(relativePath, { shellcrash = false } = {}) {
  const config = loadYaml(relativePath);
  const rules = config.rules;
  const providers = Object.keys(config["rule-providers"] ?? {});
  const groups = config["proxy-groups"];

  assert(Array.isArray(rules), "缺少 rules 数组");
  assert(Array.isArray(groups), "缺少 proxy-groups 数组");
  validateDns(config);

  const groupNames = groups.map((group) => group.name);
  assert(
    [...groupNames].sort().join("\0") === [...CORE_GROUPS].sort().join("\0"),
    `策略组必须恰好为 6 个核心组；实际为 ${JSON.stringify(groupNames)}`
  );
  assert(rules[rules.length - 1]?.startsWith("MATCH,"), "MATCH 必须是最后一条规则");
  assert(rules.filter((rule) => rule.startsWith("MATCH,")).length === 1, "必须且只能有一条 MATCH");

  const ruleSetNames = rules
    .filter((rule) => rule.startsWith("RULE-SET,"))
    .map((rule) => rule.split(",")[1]);
  const missingProviders = [...new Set(ruleSetNames)].filter((name) => !providers.includes(name));
  assert(missingProviders.length === 0, `RULE-SET 缺少 provider: ${missingProviders.join(", ")}`);

  const validTargets = new Set([...groupNames, ...BUILTIN_TARGETS]);
  const missingTargets = [...new Set(rules.map(ruleTarget).filter((target) => target && !validTargets.has(target)))];
  assert(missingTargets.length === 0, `规则引用不存在的策略组: ${missingTargets.join(", ")}`);

  const orderedNames = ruleSetNames.filter((name) => EXPECTED_PROVIDER_ORDER.includes(name));
  assert(
    orderedNames.join("\0") === EXPECTED_PROVIDER_ORDER.join("\0"),
    `核心 RULE-SET 顺序不符；实际为 ${orderedNames.join(" -> ")}`
  );

  const japan = groups.find((group) => group.name === "🇯🇵 日本");
  assert(japan, "缺少 🇯🇵 日本策略组");

  if (shellcrash) {
    assert(!rules.some((rule) => rule.startsWith("GEOSITE,")), "ShellCrash 模板不得使用 GEOSITE");
    assert(japan.type === "fallback", "ShellCrash 日本组必须为 fallback");
    assert(
      JSON.stringify(japan.proxies) === JSON.stringify(["日本01-Hy", "日本01"]),
      "ShellCrash 日本组顺序必须为 日本01-Hy、日本01"
    );
  } else {
    assert(japan["include-all"] === true && typeof japan.filter === "string", "标准模板日本组必须使用 include-all + filter");
    const parents = new Set(["🚀 节点选择", "♻️ 自动选择"]);
    assert(!(japan.proxies ?? []).some((proxy) => parents.has(proxy)), "地区组不得显式包含上级策略组");
  }
}

check("rules/*.list 与 providers/*.yaml 内容一致", () => {
  const listNames = readdirSync(join(ROOT, "rules"))
    .filter((name) => name.endsWith(".list"))
    .map((name) => name.slice(0, -5))
    .sort();
  const providerNames = readdirSync(join(ROOT, "providers"))
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -5))
    .sort();

  assert(
    listNames.join("\0") === providerNames.join("\0"),
    `规则与 provider 文件集合不同；仅 list=${listNames.filter((name) => !providerNames.includes(name))}，` +
      `仅 provider=${providerNames.filter((name) => !listNames.includes(name))}`
  );

  for (const name of listNames) {
    const listRules = readFileSync(join(ROOT, "rules", `${name}.list`), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const payload = loadYaml(join("providers", `${name}.yaml`)).payload;
    assert(Array.isArray(payload), `${name}: provider payload 必须是数组`);
    assert(JSON.stringify(listRules) === JSON.stringify(payload), `${name}: list 与 YAML payload 不一致`);
  }
});

check("标准 Mihomo 模板结构及 dns.enable 正确", () => {
  validateTemplate("templates/routing.yaml");
});

check("ShellCrash 模板结构、dns.enable 及项目约束正确", () => {
  validateTemplate("templates/shellcrash-low-geosite.yaml", { shellcrash: true });
});

check("所有 Sing-box 与 v2rayN JSON 可解析", () => {
  const jsonPaths = readdirSync(join(ROOT, "rules", "sing-box"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(ROOT, "rules", "sing-box", name));
  jsonPaths.push(join(ROOT, "rules", "v2rayn-routing.json"));
  for (const path of jsonPaths) JSON.parse(readFileSync(path, "utf8"));
});

check("Clash Verge Rev 扩展脚本语法正确", () => {
  const scripts = readdirSync(join(ROOT, "scripts"))
    .filter((name) => name.startsWith("clash-verge-rev-") && name.endsWith(".js"));
  for (const script of scripts) run(process.execPath, ["--check", join("scripts", script)]);
});

check("git diff --check", () => {
  run("git", ["diff", "--check"]);
});

if (errors.length === 0) {
  console.log(`\nvalidation passed (${checks} checks)`);
  process.exit(0);
}

console.error(`\nvalidation failed (${errors.length} errors)`);
for (const error of errors) console.error(`- ${error}`);
process.exit(1);
