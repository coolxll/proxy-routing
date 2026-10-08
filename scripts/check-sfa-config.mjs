#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildConfig, loadDomainRuleSets } from "./build-sfa-config.mjs";

const domainSets = await loadDomainRuleSets();
const config = buildConfig([
  { Name: "日本01", LinkCountry: "JP", Link: "vless://00000000-0000-0000-0000-000000000001@192.0.2.1:443?security=tls&sni=example.com" },
  { Name: "corp172-proxy", Link: "socks5://100.93.132.98:1080" },
], {}, domainSets);
const sources = new Map();
for (const set of config.route.rule_set.filter((set) => set.format === "source")) {
  const filename = fileURLToPath(new URL(`../rules/sing-box/${set.tag}.json`, import.meta.url));
  sources.set(set.tag, JSON.parse(await readFile(filename, "utf8")).rules);
}
function matches(rule, domain, queryType) {
  if (rule.query_type && rule.query_type !== queryType) return false;
  if (rule.rule_set) return (sources.get(rule.rule_set) ?? []).some((entry) => matches(entry, domain, queryType));
  return (rule.domain ?? []).includes(domain)
    || (rule.domain_suffix ?? []).some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))
    || (rule.domain_keyword ?? []).some((keyword) => domain.includes(keyword))
    || (rule.domain_regex ?? []).some((pattern) => new RegExp(pattern).test(domain));
}
function checkDomain(domain, outbound, server) {
  const route = config.route.rules.find((rule) => rule.action === "route" && matches(rule, domain));
  const dns = config.dns.rules.find((rule) => matches(rule, domain, "A"));
  assert.equal(route?.outbound, outbound, `${domain}: outbound`);
  assert.equal(dns?.server, server, `${domain}: DNS`);
}
// These used to be split between direct DNS and a different outbound.
checkDomain("officeapps.live.com", "🚀 节点选择", "dns-remote");
checkDomain("swcdn.apple.com", "⬇️ 大流量", "dns-heavy");
checkDomain("www.googletraveladservices.com", "Google", "dns-fakeip");
checkDomain("login.live.com", "direct", "dns-cn");
checkDomain("www.229929605.xyz", "direct", "dns-cn");
checkDomain("derp-sh.229929605.xyz", "direct-local", "dns-local");
checkDomain("host.tail945737.ts.net", "tailscale", "dns-tailscale");
checkDomain("intranet.psf-dev.com", "🏢 公司内网", "dns-fakeip");
for (const domain of ["play.google.com", "android.apis.google.com", "android.clients.google.com", "dl.google.com", "dl-ssl.google.com", "redirector.gvt1.com", "www.gvt3.com", "connectivitycheck.android.com"]) {
  checkDomain(domain, "Google", "dns-fakeip");
}
// Verify the complete order, including community sets that the domain examples skip.
const expected = config.route.rules.filter((rule) => domainSets.has(rule.rule_set)).map((rule) => domainSets.get(rule.rule_set));
const actual = config.dns.rules.filter((rule) => rule.rule_set).map((rule) => rule.rule_set).filter((tag, index, tags) => tag !== tags[index - 1]);
assert.deepEqual(actual, expected, "DNS classification must preserve route order");
for (const rule of config.dns.rules.filter((rule) => rule.rule_set)) {
  for (const entry of sources.get(rule.rule_set) ?? []) {
    assert.equal(entry.ip_cidr, undefined, `${rule.rule_set}: DNS set contains IP filters`);
  }
}
for (const [tag, original] of [["apple-domains", "apple"], ["direct-domains", "direct"]]) {
  const expected = sources.get(original).map((rule) => Object.fromEntries(Object.entries(rule).filter(([field]) => field.startsWith("domain"))));
  assert.deepEqual(sources.get(tag), expected, `${tag}: stale generated domains`);
}
assert.equal(config.dns.reverse_mapping, true);
assert.deepEqual(config.outbounds.find((outbound) => outbound.tag === "direct").domain_resolver, { server: "dns-cn", strategy: "ipv4_only" });
assert.equal(config.dns.servers.find((server) => server.tag === "dns-google").detour, "Google");
assert.equal(config.route.rules[0].action, "sniff");
assert.equal(config.route.rules[1].action, "hijack-dns", "DNS must not be bypassed by a destination IP rule");
for (const pkg of ["com.android.vending", "com.google.android.gms", "com.google.android.gsf", "com.android.providers.downloads"]) {
  assert(!config.inbounds[0].exclude_package.includes(pkg), `${pkg}: must remain inside VPN`);
}
assert.equal(config.outbounds.find((outbound) => outbound.tag === "corp172-proxy").detour, "tailscale");
console.log("SFA DNS order, direct resolution, Google Play and Tailnet regression checks passed");
