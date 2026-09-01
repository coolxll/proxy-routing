#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "dist", "sfa-tailscale.json");
const customRuleSetNames = [
  "private",
  "windows-update",
  "traffic-heavy",
  "google",
  "ai",
  "microsoft",
  "github",
  "telegram",
  "bank",
  "dmm",
  "direct",
  "proxy",
];

function parseEnv(contents) {
  const values = {};
  for (const originalLine of contents.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadEnvironment() {
  let fileValues = {};
  try {
    fileValues = parseEnv(await readFile(path.join(root, ".env"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...fileValues, ...process.env };
}

function csv(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueTag(name, usedTags) {
  const base = name.trim() || "Proxy";
  let tag = base;
  let suffix = 2;
  while (usedTags.has(tag)) tag = `${base} ${suffix++}`;
  usedTags.add(tag);
  return tag;
}

function tlsOptions(url, query, reality = false) {
  const serverName = query.get("sni") || query.get("peer") || url.hostname;
  const insecure = asBoolean(query.get("allowInsecure")) || asBoolean(query.get("insecure"));
  const alpn = csv(query.get("alpn"));
  const fingerprint = query.get("fp");
  const tls = {
    enabled: true,
    server_name: serverName,
    insecure,
  };

  if (alpn.length > 0) tls.alpn = alpn;
  if (fingerprint) tls.utls = { enabled: true, fingerprint };
  if (reality) {
    const publicKey = query.get("pbk") || query.get("public-key");
    if (!publicKey) throw new Error("Reality VLESS node is missing pbk/public-key");
    tls.reality = {
      enabled: true,
      public_key: publicKey,
      short_id: query.get("sid") || query.get("short-id") || "",
    };
  }
  return tls;
}

function vlessTransport(query) {
  const type = (query.get("type") || "tcp").toLowerCase();
  if (type === "tcp" || type === "none") return undefined;
  if (type === "ws") {
    const transport = {
      type: "ws",
      path: query.get("path") || "/",
    };
    const host = query.get("host");
    if (host) transport.headers = { Host: host };
    return transport;
  }
  if (type === "grpc") {
    return {
      type: "grpc",
      service_name: query.get("serviceName") || query.get("service_name") || "",
    };
  }
  throw new Error(`unsupported VLESS transport: ${type}`);
}

function parseVless(url, tag) {
  const query = url.searchParams;
  const security = (query.get("security") || "none").toLowerCase();
  const outbound = {
    type: "vless",
    tag,
    server: url.hostname,
    server_port: Number(url.port),
    uuid: decode(url.username),
  };
  const flow = query.get("flow");
  const transport = vlessTransport(query);

  if (flow) outbound.flow = flow;
  if (security === "tls" || security === "reality") {
    outbound.tls = tlsOptions(url, query, security === "reality");
  }
  if (transport) outbound.transport = transport;
  return outbound;
}

function parseHysteria2(url, tag) {
  const query = url.searchParams;
  const password = query.get("auth") || decode(url.password || url.username);
  if (!password) throw new Error("Hysteria2 node is missing a password");

  const outbound = {
    type: "hysteria2",
    tag,
    server: url.hostname,
    server_port: Number(url.port),
    password,
    tls: tlsOptions(url, query),
  };
  const portRange = query.get("mport") || query.get("ports");
  if (portRange) outbound.server_ports = [portRange.replaceAll("-", ":")];

  const obfsType = query.get("obfs");
  if (obfsType) {
    const obfsPassword = query.get("obfs-password") || query.get("obfs_password");
    if (!obfsPassword) throw new Error("Hysteria2 obfs is missing a password");
    outbound.obfs = { type: obfsType, password: obfsPassword };
  }
  return outbound;
}

function parseNode(node, usedTags) {
  const url = new URL(node.Link);
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const tag = uniqueTag(node.Name || node.EffectiveName || decode(url.hash.slice(1)), usedTags);
  let outbound;

  if (scheme === "vless") outbound = parseVless(url, tag);
  else if (scheme === "hysteria2" || scheme === "hy2") outbound = parseHysteria2(url, tag);
  else throw new Error(`${tag}: unsupported node protocol: ${scheme}`);

  return {
    outbound,
    country: String(node.LinkCountry || "").toUpperCase(),
  };
}

async function fetchNodes(baseUrl, apiKey) {
  const nodes = [];
  let page = 1;

  while (true) {
    const url = new URL("/api/v1/nodes/get", baseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "200");
    const response = await fetch(url, { headers: { "X-API-Key": apiKey } });
    if (!response.ok) throw new Error(`SublinkPro returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.code !== 200) throw new Error(`SublinkPro error: ${body.msg || body.code}`);
    nodes.push(...(body.data?.items ?? []));
    if (page >= (body.data?.totalPages ?? 1)) break;
    page += 1;
  }
  return nodes;
}

function customRuleSets() {
  return customRuleSetNames.map((tag) => ({
    type: "remote",
    tag,
    format: "source",
    url: `https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/sing-box/${tag}.json`,
    http_client: "direct-http",
    update_interval: "1d",
  }));
}

function communityRuleSets() {
  const geosite = (tag) => ({
    type: "remote",
    tag: `geosite-${tag}`,
    format: "binary",
    url: `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-${tag}.srs`,
    http_client: "direct-http",
    update_interval: "1d",
  });
  return [
    geosite("category-ads-all"),
    geosite("cn"),
    geosite("geolocation-!cn"),
    {
      type: "remote",
      tag: "geoip-cn",
      format: "binary",
      url: "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs",
      http_client: "direct-http",
      update_interval: "1d",
    },
  ];
}

function selector(tag, outbounds, defaultTag = outbounds[0]) {
  return {
    type: "selector",
    tag,
    outbounds,
    default: defaultTag,
    interrupt_exist_connections: false,
  };
}

function route(ruleSet, outbound) {
  return { rule_set: ruleSet, action: "route", outbound };
}

function buildConfig(nodes, environment) {
  const usedTags = new Set([
    "direct",
    "block",
    "tailscale",
    "Proxy",
    "Auto",
    "Google",
    "AI",
    "Microsoft",
    "GitHub",
    "Heavy Traffic",
    "Windows Update",
    "Telegram",
    "Bank",
    "Japan",
    "Final",
  ]);
  const parsedNodes = nodes.map((node) => parseNode(node, usedTags));
  const nodeTags = parsedNodes.map(({ outbound }) => outbound.tag);
  if (nodeTags.length === 0) throw new Error("SublinkPro returned no nodes");

  const japanTags = parsedNodes
    .filter(({ country, outbound }) => country === "JP" || /(日本|Japan|JP|东京|大阪)/i.test(outbound.tag))
    .map(({ outbound }) => outbound.tag);
  if (japanTags.length === 0) {
    throw new Error("no Japanese node found for the DMM route");
  }

  const tailnetRoutes = ["100.64.0.0/10", "fd7a:115c:a1e0::/48", ...csv(environment.SFA_TAILSCALE_ROUTES)];
  const tailnetDnsDomains = ["ts.net", ...csv(environment.SFA_TAILSCALE_DNS_DOMAINS)];
  const autoTag = "Auto";
  const proxyTag = "Proxy";
  const commonChoices = [proxyTag, autoTag, "direct", ...nodeTags];

  return {
    log: { level: "info", timestamp: true },
    dns: {
      servers: [
        { type: "local", tag: "dns-local" },
        {
          type: "https",
          tag: "dns-cn",
          server: "223.5.5.5",
          server_port: 443,
          tls: { enabled: true, server_name: "dns.alidns.com" },
        },
        {
          type: "https",
          tag: "dns-remote",
          server: "1.1.1.1",
          server_port: 443,
          detour: "Proxy",
          tls: { enabled: true, server_name: "cloudflare-dns.com" },
        },
        {
          type: "tailscale",
          tag: "dns-tailscale",
          endpoint: "tailscale",
          accept_default_resolvers: false,
          accept_search_domain: true,
        },
      ],
      rules: [
        { domain_suffix: tailnetDnsDomains, action: "route", server: "dns-tailscale" },
        { domain_regex: ["^[^.]+$"], action: "route", server: "dns-tailscale" },
        {
          type: "logical",
          mode: "and",
          rules: [
            { query_type: "AAAA" },
            { network_interface_address: { wifi: ["2000::/3"] }, invert: true },
            { network_interface_address: { cellular: ["2000::/3"] }, invert: true },
            { network_interface_address: { ethernet: ["2000::/3"] }, invert: true },
            { network_interface_address: { other: ["2000::/3"] }, invert: true },
          ],
          action: "predefined",
          rcode: "NOERROR",
        },
        { domain_suffix: ["msftconnecttest.com", "msftncsi.com"], action: "route", server: "dns-local" },
        { domain_suffix: ["229929605.xyz"], action: "route", server: "dns-cn" },
        { rule_set: ["windows-update", "bank", "geosite-cn"], action: "route", server: "dns-cn" },
      ],
      final: "dns-remote",
      strategy: "prefer_ipv4",
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
        mtu: 9000,
        auto_route: true,
        strict_route: true,
        stack: "mixed",
      },
    ],
    endpoints: [
      {
        type: "tailscale",
        tag: "tailscale",
        state_directory: "tailscale",
        hostname: environment.SFA_TAILSCALE_HOSTNAME || "sfa-android",
        accept_routes: true,
      },
    ],
    outbounds: [
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
      ...parsedNodes.map(({ outbound }) => outbound),
      {
        type: "urltest",
        tag: autoTag,
        outbounds: nodeTags,
        url: "https://www.gstatic.com/generate_204",
        interval: "5m",
        tolerance: 50,
        interrupt_exist_connections: false,
      },
      selector(proxyTag, [autoTag, "direct", ...nodeTags], autoTag),
      selector("Google", commonChoices, proxyTag),
      selector("AI", commonChoices, proxyTag),
      selector("Microsoft", commonChoices, proxyTag),
      selector("GitHub", commonChoices, proxyTag),
      selector("Heavy Traffic", [autoTag, proxyTag, "direct", ...nodeTags], autoTag),
      selector("Windows Update", ["direct", "Heavy Traffic", proxyTag, ...nodeTags], "direct"),
      selector("Telegram", commonChoices, proxyTag),
      selector("Bank", ["direct", proxyTag, ...nodeTags], "direct"),
      {
        type: "urltest",
        tag: "Japan",
        outbounds: japanTags,
        url: "https://www.gstatic.com/generate_204",
        interval: "5m",
        tolerance: 50,
        interrupt_exist_connections: false,
      },
      selector("Final", [proxyTag, "direct", autoTag, ...nodeTags], proxyTag),
    ],
    http_clients: [
      {
        tag: "direct-http",
        detour: "direct",
      },
    ],
    route: {
      rules: [
        { ip_cidr: ["223.5.5.5/32"], action: "route", outbound: "direct" },
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        { domain_suffix: tailnetDnsDomains, action: "route", outbound: "tailscale" },
        { ip_cidr: tailnetRoutes, action: "route", outbound: "tailscale" },
        route("private", "direct"),
        route("geosite-category-ads-all", "block"),
        route("windows-update", "Windows Update"),
        route("traffic-heavy", "Heavy Traffic"),
        route("google", "Google"),
        route("ai", "AI"),
        route("microsoft", "Microsoft"),
        route("github", "GitHub"),
        route("telegram", "Telegram"),
        route("bank", "Bank"),
        route("dmm", "Japan"),
        route("direct", "direct"),
        route("proxy", proxyTag),
        route("geosite-cn", "direct"),
        route("geosite-geolocation-!cn", proxyTag),
        route("geoip-cn", "direct"),
      ],
      rule_set: [...customRuleSets(), ...communityRuleSets()],
      final: "Final",
      default_domain_resolver: "dns-local",
      auto_detect_interface: true,
      override_android_vpn: true,
    },
    experimental: {
      cache_file: {
        enabled: true,
        path: "cache.db",
        store_fakeip: false,
        store_dns: true,
      },
    },
  };
}

const environment = await loadEnvironment();
const baseUrl = environment.SUBLINK_BASE_URL;
const apiKey = environment.SUBLINK_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error("SUBLINK_BASE_URL and SUBLINK_API_KEY are required in .env or the environment");
}

const nodes = await fetchNodes(baseUrl, apiKey);
const config = buildConfig(nodes, environment);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);

console.log(`generated ${path.relative(root, outputPath)} with ${nodes.length} proxy nodes`);
console.log("Tailscale authentication is intentionally left to SFA Tools > Endpoints.");
