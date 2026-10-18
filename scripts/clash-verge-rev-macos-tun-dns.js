// macOS Proxy/TUN 共享订阅扩展；由 proxy-mode 注入模式和实际 Tailnet 接口。
function macosProxyConfig(config, { mode = "proxy", tailscaleInterface } = {}) {
  if (!["proxy", "tun"].includes(mode)) throw new Error("Unknown macOS proxy mode");
  if (mode === "tun" && !/^utun\d+$/.test(tailscaleInterface || "")) {
    throw new Error("TUN requires a detected Tailnet interface; run proxy-mode tun");
  }
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];
  const proxiedDns = [
    "https://1.1.1.1/dns-query#🚀 节点选择",
    "https://8.8.8.8/dns-query#🚀 节点选择"
  ];

  // 229929605.xyz 默认走代理，只有依赖直连的主机保持 DIRECT 并使用加密 DNS，
  // 避免系统/明文 DNS 污染。整域不再排除 Fake-IP，代理主机由远端解析。
  const directPublicDomains = [
    "derp-sh.229929605.xyz",
    "crn.229929605.xyz",
    "rn.229929605.xyz",
    "ss.jph2.229929605.xyz",
    "claude.229929605.xyz",
    "sublink.229929605.xyz",
    "auth.229929605.xyz",
    "travel.229929605.xyz",
    "opencode.229929605.xyz",
    "nav.229929605.xyz"
  ];
  const directPublicSuffixes = [
    "bytecloudapp.com"
  ];

  // 公司域名通过 corp172 远端代理直连，兼顾办公网与家庭网无感接入
  const companyDomains = [
    "dongfu1.com",
    "dongfangfuli.com",
    "psf-dev.com",
    "ocjfuli.com"
  ];

  /*
   * 1. 注入 corp172 SOCKS5 代理节点与策略组
   */
  const corpProxyNode = {
    name: "corp172-proxy",
    type: "socks5",
    server: "100.93.132.98",
    port: 1080
  };

  const corpGroupName = "🏢 公司内网";
  const corpGroup = {
    name: corpGroupName,
    type: "select",
    proxies: ["corp172-proxy", "DIRECT"]
  };

  config.proxies = config.proxies || [];
  if (!config.proxies.some(p => p.name === corpProxyNode.name)) {
    config.proxies.push(corpProxyNode);
  }
  const corpProxy = config.proxies.find(p => p.name === corpProxyNode.name);
  if (mode === "tun") corpProxy["interface-name"] = tailscaleInterface;
  else delete corpProxy["interface-name"];

  config["proxy-groups"] = config["proxy-groups"] || [];
  if (!config["proxy-groups"].some(g => g.name === corpGroupName)) {
    config["proxy-groups"].unshift(corpGroup);
  }

  /*
   * 2. DNS 基础配置
   */
  if (!config.dns) {
    config.dns = {};
  }

  config.dns.enable = true;
  config.dns["respect-rules"] = false;
  config.dns["enhanced-mode"] = mode === "tun" ? "fake-ip" : "redir-host";
  config.dns["fake-ip-range"] = "198.18.0.1/16";
  config.dns["fake-ip-filter-mode"] = "blacklist";
  config.dns["prefer-h3"] = false;
  config.dns["default-nameserver"] = ["https://223.5.5.5/dns-query"];
  config.dns["proxy-server-nameserver"] = publicDns;
  config.dns.nameserver = proxiedDns;
  config.dns.fallback = [];
  config.dns["direct-nameserver"] = publicDns;
  // 系统 DNS 由 Verge 自动覆写并劫持；不能从内部再次查询 system。
  delete config.dns.listen;
  config.dns["direct-nameserver-follow-policy"] = true;

  /*
   * 3. DNS 策略
   * 公司域名使用 Fake-IP，由 SOCKS5 在 corp172 远端解析；本机不查询公司 DNS。
   */
  const oldPolicy = { ...(config.dns["nameserver-policy"] || {}) };
  for (const [key, value] of Object.entries(oldPolicy)) {
    const resolvers = Array.isArray(value) ? value : [value];
    if (resolvers.some(resolver => resolver === "system")) delete oldPolicy[key];
  }

  for (const domain of companyDomains) {
    delete oldPolicy[`+.${domain}`];
    delete oldPolicy[domain];
  }

  // 订阅可能仍带整域 229929605.xyz 的国内 DoH 策略；代理主机必须交给远端解析。
  for (const key of ["229929605.xyz", "+.229929605.xyz", "*.229929605.xyz"]) {
    delete oldPolicy[key];
  }

  const conflictKeys = [
    "geosite:cn,private",
    "geosite:private,cn",
    "geosite:private",
    "geosite:cn"
  ];

  conflictKeys.forEach(key => {
    delete oldPolicy[key];
  });

  const directPublicPolicy = Object.fromEntries([
    ...directPublicDomains.map(domain => [domain, publicDns]),
    ...directPublicSuffixes.map(domain => [`+.${domain}`, publicDns])
  ]);

  config.dns["nameserver-policy"] = {
    ...oldPolicy,
    ...directPublicPolicy,
    "+.ts.net": ["100.100.100.100"],
    "+.chatgpt.com": proxiedDns,
    "geosite:cn": publicDns
  };

  /*
   * 4. Fake-IP 过滤
   * 公司域名保留 Fake-IP，连接交给 corp172，SOCKS5 远端解析域名。
   */
  const directFakeIpFilters = [
    ...directPublicDomains,
    ...directPublicSuffixes.map(domain => `+.${domain}`)
  ];

  const filterList = [
    ...directFakeIpFilters,
    "geosite:private",
    "localhost",
    "+.local",
    "+.tailscale.com",
    "+.ts.net"
  ];

  const retireWholeZone = item => ["229929605.xyz", "+.229929605.xyz", "*.229929605.xyz"].includes(item)
    || companyDomains.some(domain =>
      item === domain || item === `+.${domain}` || item === `*.${domain}`
    );

  config.dns["fake-ip-filter"] = [
    ...new Set([
      ...(config.dns["fake-ip-filter"] || []).filter(item => !retireWholeZone(item)),
      ...filterList
    ])
  ];

  /*
   * 5. 路由规则
   * 公司域名和 10.0.0.0/8 优先进入「🏢 公司内网」策略组 (默认走 corp172 宿主机直连)
   */
  const companyRules = companyDomains.map(
    domain => `DOMAIN-SUFFIX,${domain},${corpGroupName}`
  );

  const myRules = [
    `IP-CIDR,10.0.0.0/8,${corpGroupName},no-resolve`,
    ...companyRules
  ];

  const existingRules = config.rules || [];

  config.rules = [
    ...myRules,
    ...existingRules.filter(rule => !myRules.includes(rule))
  ];

  /*
   * 6. TUN 排除列表
   * 让 10.0.0.0/8 进入 TUN 虚拟网卡，由 Mihomo 规则转送给「🏢 公司内网」
   */
  config.tun = config.tun || {};
  const exclusions = config.tun["route-exclude-address"] || [];
  config.tun["route-exclude-address"] = [...new Set([
    ...exclusions.filter(item => item !== "10.0.0.0/8"),
    "100.64.0.0/10",
    "fd7a:115c:a1e0::/48"
  ])];
  config.tun["dns-hijack"] = ["any:53", "tcp://any:53"];
  config.tun.enable = mode === "tun";
  config.mode = "rule";

  return config;
}

function main(config) {
  return macosProxyConfig(config);
}
