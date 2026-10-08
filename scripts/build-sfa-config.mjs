#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node's Happy Eyeballs gives each address only 250ms by default. The TCP handshake to
// the Cloudflare-fronted SublinkPro often takes longer from China (and IPv6 is
// unreachable), so every attempt fails with ETIMEDOUT even though the server is up.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "dist", "sfa-tailscale.json");
const customRuleSetNames = [
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

function parseSocks(url, tag) {
  const outbound = {
    type: "socks",
    tag,
    server: url.hostname,
    server_port: Number(url.port) || 1080,
  };
  if (url.username) outbound.username = decode(url.username);
  if (url.password) outbound.password = decode(url.password);
  return outbound;
}

function isTailnetAddress(host) {
  if (typeof host !== "string") return false;
  if (host.endsWith(".ts.net")) return true;
  // 100.64.0.0/10 (Tailnet CGNAT IPv4 range: 100.64.0.0 - 100.127.255.255)
  if (/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

function parseNode(node, usedTags) {
  const url = new URL(node.Link);
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const tag = uniqueTag(node.Name || node.EffectiveName || decode(url.hash.slice(1)), usedTags);
  let outbound;

  if (scheme === "vless") outbound = parseVless(url, tag);
  else if (scheme === "hysteria2" || scheme === "hy2") outbound = parseHysteria2(url, tag);
  else if (scheme === "socks" || scheme === "socks5") outbound = parseSocks(url, tag);
  else throw new Error(`${tag}: unsupported node protocol: ${scheme}`);

  // Nodes hosted inside Tailnet (e.g. corp172-proxy at 100.93.132.98) must dial through
  // the Tailscale endpoint, otherwise Android attempts direct WAN dial and fails.
  if (isTailnetAddress(outbound.server)) {
    outbound.detour = "tailscale";
  }

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

// Outbounds that connect directly by default. Domains routed to them must be resolved
// by domestic DNS; otherwise the app receives an answer from dns-remote (Cloudflare via
// the proxy exit) and the direct connection dials an overseas/CDN-far IP, which is slow
// or unreachable from China. NekoBox does this implicitly for every direct rule.
const directOutbounds = new Set(["direct"]);

// Rule-sets that contain domain items. sing-box 1.14 rejects DNS rules referencing
// IP-only rule-sets (e.g. private / geoip-cn) when new DNS features such as query_type
// are in use, so only domain-bearing rule-sets may be used for DNS routing.
async function loadDomainRuleSets() {
  const domainFields = ["domain", "domain_suffix", "domain_keyword", "domain_regex"];
  const tags = new Set(["geosite-category-ads-all", "geosite-cn", "geosite-geolocation-!cn"]);
  for (const tag of customRuleSetNames) {
    const file = path.join(root, "rules", "sing-box", `${tag}.json`);
    const { rules } = JSON.parse(await readFile(file, "utf8"));
    if (rules.some((rule) => domainFields.some((field) => rule[field]?.length))) tags.add(tag);
  }
  return tags;
}

function domesticDnsRuleSets(routeRules, domainRuleSets) {
  return routeRules
    .filter((rule) => typeof rule.rule_set === "string" && directOutbounds.has(rule.outbound))
    .map((rule) => rule.rule_set)
    .filter((tag) => domainRuleSets.has(tag));
}

// Domestic-only apps that gain nothing from entering the TUN.
// Bypassing them avoids userspace TCP dial timeouts to unreachable internal IPs.
// Note: Google Play (needs proxy) and DingTalk (accesses company intranet) are intentionally kept in TUN.
const defaultExcludePackages = [
  "com.tencent.mm",             // WeChat
  "com.tencent.mobileqq",      // QQ
  "com.eg.android.AlipayGphone", // Alipay
  "com.taobao.taobao",         // Taobao
  "com.autonavi.minimap",      // Amap/高德地图
  "ctrip.android.view",        // Trip.com/携程
  "com.dianping.v1",           // 大众点评
  "com.sankuai.meituan",       // 美团
  "com.MobileTicket",          // 铁路12306
  "com.jd.lib.un.jdmobilelite", // JD (lite)
  "com.jingdong.app.mall",     // JD
  "com.ss.android.ugc.aweme",  // 抖音
  "com.kuaishou.nebula",       // 快手
  "com.smile.gifmaker",        // 快手 (old pkg)
  "tv.danmaku.bili",           // 哔哩哔哩
  "com.xiaomi.market",         // Xiaomi AppStore
  "com.miui.gallery",          // MIUI Gallery
];

function buildConfig(nodes, environment, domainRuleSets) {
  const proxyTag = "🚀 节点选择";
  const autoTag = "♻️ 自动选择";
  const googleTag = "Google";
  const aiTag = "🤖 AI";
  const heavyTrafficTag = "⬇️ 大流量";
  const japanTag = "🇯🇵 日本";
  const corpTag = "🏢 公司内网";

  const usedTags = new Set([
    "direct",
    "block",
    "tailscale",
    proxyTag,
    autoTag,
    googleTag,
    aiTag,
    heavyTrafficTag,
    japanTag,
    corpTag,
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

  const autoTags = nodeTags.filter((tag) => !/(Home-Shanghai|corp172|上海|内网)/i.test(tag));
  if (autoTags.length === 0) {
    throw new Error("no public proxy node available for ♻️ 自动选择");
  }
  const autoOutbounds = autoTags;
  const corpOutbounds = nodeTags.includes("corp172-proxy")
    ? ["corp172-proxy", "direct"]
    : ["direct"];

  const tailnetRoutes = ["100.64.0.0/10", "fd7a:115c:a1e0::/48", ...csv(environment.SFA_TAILSCALE_ROUTES)];
  const tailnetDnsDomains = ["ts.net", ...csv(environment.SFA_TAILSCALE_DNS_DOMAINS)];
  const companyDomains = ["dongfangfuli.com", "psf-dev.com", "ocjfuli.com"];
  const commonChoices = [proxyTag, autoTag, "direct", ...nodeTags];

  // Proxy node server IPs: exclude from TUN at the system routing table level so
  // outbound connections to the proxy servers never re-enter the TUN.
  // Tailnet node IPs (e.g. 100.93.132.98) must NOT be excluded; they must enter the TUN
  // and be routed through the Tailscale endpoint.
  const nodeServerIPs = [
    ...new Set(
      parsedNodes
        .map(({ outbound }) => outbound.server)
        .filter((s) => !isTailnetAddress(s))
        .filter((s) => /^[\d.]+$/.test(s) || /^[0-9a-f:]+$/i.test(s))
    ),
  ].map((ip) => (ip.includes(":") ? `${ip}/128` : `${ip}/32`));

  // Package exclusion: allow user override or append via SFA_EXCLUDE_PACKAGES (+pkg adds to default, otherwise replaces).
  const envPackages = environment.SFA_EXCLUDE_PACKAGES;
  const excludePackages = envPackages !== undefined
    ? (envPackages.startsWith("+")
        ? [...new Set([...defaultExcludePackages, ...csv(envPackages.slice(1))])]
        : csv(envPackages))
    : defaultExcludePackages;

  const routeRules = [
    { ip_cidr: ["223.5.5.5/32"], action: "route", outbound: "direct" },
    { action: "sniff" },
    { protocol: "dns", action: "hijack-dns" },
    { domain_suffix: tailnetDnsDomains, action: "route", outbound: "tailscale" },
    { ip_cidr: tailnetRoutes, action: "route", outbound: "tailscale" },
    // 公司内网与业务域名（优先于 private 直连，默认走 corp172 远端代理直连）
    { domain_suffix: companyDomains, action: "route", outbound: corpTag },
    { ip_cidr: ["10.0.0.0/8"], action: "route", outbound: corpTag },
    // Some Android networks advertise IPv6 without providing a usable route.
    // Reject Chinese IPv6 literals after Tailnet routing so apps can retry IPv4.
    {
      type: "logical",
      mode: "and",
      rules: [{ ip_version: 6 }, { rule_set: "geoip-cn" }],
      action: "reject",
    },
    route("private", "direct"),
    route("unban", "direct"),
    route("geosite-category-ads-all", "block"),
    route("download", "direct"),
    route("windows-update", "direct"),
    route("traffic-heavy", heavyTrafficTag),
    route("google", googleTag),
    route("ai", aiTag),
    route("microsoft", proxyTag),
    route("github", proxyTag),
    route("telegram", proxyTag),
    route("bank", "direct"),
    route("travel-direct", "direct"),
    route("apple", "direct"),
    route("dmm", japanTag),
    route("direct", "direct"),
    route("proxy", proxyTag),
    route("geosite-cn", "direct"),
    route("geosite-geolocation-!cn", proxyTag),
    route("geoip-cn", "direct"),
  ];
  const domesticDnsSets = domesticDnsRuleSets(routeRules, domainRuleSets);
  if (!domesticDnsSets.includes("direct")) {
    throw new Error("direct rule-set must resolve through domestic DNS");
  }

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
          detour: proxyTag,
          tls: { enabled: true, server_name: "cloudflare-dns.com" },
        },
        {
          type: "tailscale",
          tag: "dns-tailscale",
          endpoint: "tailscale",
          accept_default_resolvers: false,
          accept_search_domain: true,
        },
        {
          type: "fakeip",
          tag: "dns-fakeip",
          inet4_range: "198.18.0.0/15",
        },
      ],
      rules: [
        // derp-sh is behind the home NAT. Let the router's split DNS return its LAN address
        // instead of resolving the public address through dns-cn and causing NAT hairpinning.
        { domain: ["derp-sh", "derp-sh.229929605.xyz"], action: "route", server: "dns-local" },
        // Honor MagicDNS and every split-DNS suffix advertised by the Tailscale endpoint.
        // This must precede the public/local resolvers so private names never leak to them.
        { preferred_by: "dns-tailscale", action: "route", server: "dns-tailscale" },
        { domain_suffix: tailnetDnsDomains, action: "route", server: "dns-tailscale" },
        { domain_regex: ["^[^.]+$"], action: "route", server: "dns-tailscale" },
        // Internal company domains resolve via Fake-IP so Android avoids public NXDOMAIN/timeout;
        // sing-box maps the Fake-IP back to the original domain name and the SOCKS5 proxy resolves it remotely.
        { domain_suffix: companyDomains, action: "route", server: "dns-fakeip" },
        // Keep public traffic on IPv4 even when Android has a nominal but unreliable
        // IPv6 address. Tailscale DNS rules above still return AAAA for Tailnet names.
        { query_type: "AAAA", action: "predefined", rcode: "NOERROR" },
        { domain_suffix: ["msftconnecttest.com", "msftncsi.com"], action: "route", server: "dns-local" },
        { domain_suffix: ["229929605.xyz", "bytecloudapp.com"], action: "route", server: "dns-cn" },
        // Every domain rule-set routed to a direct-by-default outbound resolves domestically.
        { rule_set: domesticDnsSets, action: "route", server: "dns-cn" },
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
        // Proxy node server IPs bypass TUN at the system routing table level,
        // preventing routing loops more robustly than override_android_vpn alone.
        route_exclude_address: nodeServerIPs,
        // Domestic-only apps bypass the TUN entirely via Android VpnService.
        // Their traffic never enters sing-box's userspace stack, eliminating
        // dial timeout errors for unreachable internal IPs (e.g. Alibaba ACCS).
        exclude_package: excludePackages,
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
      selector(corpTag, corpOutbounds, corpOutbounds[0]),
      selector(proxyTag, [autoTag, "direct", ...nodeTags], autoTag),
      {
        type: "urltest",
        tag: autoTag,
        outbounds: autoOutbounds,
        url: "https://www.gstatic.com/generate_204",
        interval: "5m",
        tolerance: 50,
        interrupt_exist_connections: false,
      },
      selector(googleTag, commonChoices, proxyTag),
      selector(aiTag, commonChoices, proxyTag),
      selector(heavyTrafficTag, [autoTag, proxyTag, "direct", ...nodeTags], autoTag),
      {
        type: "urltest",
        tag: japanTag,
        outbounds: japanTags,
        url: "https://www.gstatic.com/generate_204",
        interval: "5m",
        tolerance: 50,
        interrupt_exist_connections: false,
      },
    ],
    http_clients: [
      {
        tag: "direct-http",
        // An omitted detour uses direct dialing; an empty direct outbound is rejected.
      },
    ],
    route: {
      rules: routeRules,
      rule_set: [...customRuleSets(), ...communityRuleSets()],
      final: proxyTag,
      default_domain_resolver: "dns-local",
      auto_detect_interface: true,
      override_android_vpn: true,
    },
    experimental: {
      cache_file: {
        enabled: true,
        path: "cache.db",
        store_fakeip: true,
        store_dns: true,
      },
    },
  };
}

async function publishToGist(filePath, existingGistId) {
  try {
    execFileSync("gh", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("gh CLI is not installed. Install it with: brew install gh");
  }

  if (existingGistId) {
    const content = await readFile(filePath, "utf8");
    const payload = JSON.stringify({
      files: { "sfa-tailscale.json": { content } },
    });

    try {
      execFileSync("gh", ["api", `/gists/${existingGistId}`, "-X", "PATCH", "--input", "-"], {
        input: payload,
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (error) {
      throw new Error(`Failed to update gist ${existingGistId}: ${error.message}`);
    }

    const owner = execFileSync(
      "gh",
      ["api", `/gists/${existingGistId}`, "--jq", ".owner.login"],
      { encoding: "utf8" }
    ).trim();

    const rawUrl = `https://gist.githubusercontent.com/${owner}/${existingGistId}/raw/sfa-tailscale.json`;
    console.log(`updated secret gist: ${existingGistId}`);
    return { gistId: existingGistId, rawUrl };
  } else {
    let output;
    try {
      output = execFileSync(
        "gh",
        ["gist", "create", filePath, "-d", "SFA Tailscale config"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] }
      ).trim();
    } catch (error) {
      throw new Error(`Failed to create gist: ${error.message}`);
    }

    const gistId = output.split("/").pop();
    const user = output.split("/").slice(-2, -1)[0];
    const rawUrl = `https://gist.githubusercontent.com/${user}/${gistId}/raw/sfa-tailscale.json`;

    console.log(`created secret gist: ${output}`);
    return { gistId, rawUrl };
  }
}

async function saveGistIdToEnv(envPath, gistId) {
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const line = `SFA_GIST_ID=${gistId}`;
  const lines = content.split(/\r?\n/);
  const existingIndex = lines.findIndex((l) => l.trim().startsWith("SFA_GIST_ID="));

  if (existingIndex >= 0) {
    lines[existingIndex] = line;
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    lines.push(line);
  }

  await writeFile(envPath, lines.join("\n") + "\n", { mode: 0o600 });
  await chmod(envPath, 0o600);
  console.log(`saved SFA_GIST_ID to .env`);
}

function tryShowQrCode(url) {
  try {
    const qr = execFileSync("qrencode", ["-t", "UTF8", url], { encoding: "utf8" });
    console.log("\n扫描二维码添加到 SFA Remote Profile：\n");
    console.log(qr);
  } catch {
    console.log("\n(安装 qrencode 可以显示二维码: brew install qrencode)");
  }
}

const environment = await loadEnvironment();
const baseUrl = environment.SUBLINK_BASE_URL;
const apiKey = environment.SUBLINK_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error("SUBLINK_BASE_URL and SUBLINK_API_KEY are required in .env or the environment");
}

const cliArgs = process.argv.slice(2);
const shouldPublish = cliArgs.includes("--publish");

const nodes = await fetchNodes(baseUrl, apiKey);
const config = buildConfig(nodes, environment, await loadDomainRuleSets());
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);

console.log(`generated ${path.relative(root, outputPath)} with ${nodes.length} proxy nodes`);
console.log("Tailscale authentication is intentionally left to SFA Tools > Endpoints.");

if (shouldPublish) {
  const gistId = environment.SFA_GIST_ID;
  const result = await publishToGist(outputPath, gistId);

  if (!gistId) {
    await saveGistIdToEnv(path.join(root, ".env"), result.gistId);
  }

  console.log(`\nraw URL: ${result.rawUrl}`);
  tryShowQrCode(result.rawUrl);
}
