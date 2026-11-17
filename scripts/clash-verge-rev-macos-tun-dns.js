// macOS Proxy/TUN 共享订阅扩展；公司代理通过按需 SSH 隧道连接本地回环。
function macosProxyConfig(config, { mode = "proxy" } = {}) {
  if (!["proxy", "tun"].includes(mode)) throw new Error("Unknown macOS proxy mode");
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
    "cfcdn.229929605.xyz",
    "cjp.229929605.xyz",
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

  // 公司域名默认本地直连，需要时通过 corp172 的 SSH SOCKS 出口。
  const companyDomains = [
    "dongfu1.com",
    "dongfangfuli.com",
    "psf-dev.com",
    "ocjfuli.com"
  ];

  /*
   * 1. 注入本地 SSH SOCKS5 入口与按需策略组
   */
  const corpProxyNode = {
    name: "corp172-proxy",
    type: "socks5",
    server: "127.0.0.1",
    port: 11080
  };

  const corpGroupName = "🏢 公司内网";
  const corpGroup = {
    name: corpGroupName,
    type: "select",
    proxies: ["DIRECT", "corp172-proxy"]
  };

  config.proxies = config.proxies || [];
  if (!config.proxies.some(p => p.name === corpProxyNode.name)) {
    config.proxies.push(corpProxyNode);
  }
  const corpProxy = config.proxies.find(p => p.name === corpProxyNode.name);
  Object.assign(corpProxy, corpProxyNode);
  delete corpProxy["interface-name"];

  config["proxy-groups"] = config["proxy-groups"] || [];
  const existingCorpGroup = config["proxy-groups"].find(g => g.name === corpGroupName);
  if (existingCorpGroup) {
    existingCorpGroup.proxies = [...new Set([...corpGroup.proxies, ...(existingCorpGroup.proxies || [])])];
  } else {
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
  // 两种模式都提供本地 DNS，避免 macOS 的 scoped 查询绕过 TUN。
  // 禁止内部查询 system，避免系统指向本机后形成 DNS 环路。
  config.dns.listen = "127.0.0.1:53";
  config.dns["direct-nameserver-follow-policy"] = true;

  /*
   * 3. DNS 策略
   * TUN 公司域名使用 Fake-IP；SOCKS 由远端解析，DIRECT 使用显式公司 DNS。
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
    // 仅直连公司网络时查询公司 DNS；TUN 的 Fake-IP + SOCKS 由远端解析。
    ...Object.fromEntries(companyDomains.map(domain => [`+.${domain}`, ["10.8.100.121", "10.8.121.121"]])),
    "+.ts.net": ["100.100.100.100"],
    "+.chatgpt.com": proxiedDns,
    "geosite:cn": publicDns
  };

  /*
   * 4. Fake-IP 过滤
   * 公司域名保留 Fake-IP，按策略组选择本地直连或 SSH 远端解析。
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
   * 优先拦截隐私泄露与无用埋点（必须置于公司内网后缀前，防止未脱敏凭据外泄）
   * 公司域名和 10.0.0.0/8 优先进入「🏢 公司内网」策略组（默认 DIRECT）。
   */
  const privacyRejectRules = [
    "DOMAIN,trace.dongfangfuli.com,REJECT",
    "DOMAIN,dffe-log.cn-shanghai.log.aliyuncs.com,REJECT",
    "DOMAIN,gio.dongfangfuli.com,REJECT",
    "DOMAIN,h5speed.m.jd.com,REJECT"
  ];

  const companyRules = companyDomains.map(
    domain => `DOMAIN-SUFFIX,${domain},${corpGroupName}`
  );

  const myRules = [
    ...privacyRejectRules,
    // 公司 DNS 本身始终直连，防止解析请求再次进入按需 SOCKS 隧道。
    "IP-CIDR,10.8.100.121/32,DIRECT,no-resolve",
    "IP-CIDR,10.8.121.121/32,DIRECT,no-resolve",
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
