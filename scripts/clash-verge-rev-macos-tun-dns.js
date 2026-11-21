// macOS Proxy/TUN 共享订阅扩展；公司代理通过按需 SSH 隧道连接本地回环。
function macosProxyConfig(config, { mode = "proxy", tailscaleInterface } = {}) {
  if (!["proxy", "tun"].includes(mode)) throw new Error("Unknown macOS proxy mode");
  // 链头选择器放在策略组最前面，方便在 Verge 里直接切。
  const chainGroupName = "KDDI 前置";
  const kddi = (config.proxies || []).find(proxy => proxy.name === "KDDI-JP家宽");
  if (kddi) {
    const defaultProxy = "VMiss-美国Tri-WS";
    const candidates = (config.proxies || [])
      .filter(proxy => !proxy.name.startsWith("KDDI-JP家宽") &&
        !proxy.name.startsWith("corp172-") && !proxy["dialer-proxy"])
      .map(proxy => proxy.name);
    const choices = candidates.includes(defaultProxy)
      ? [defaultProxy, ...candidates.filter(name => name !== defaultProxy)]
      : candidates;
    kddi["dialer-proxy"] = chainGroupName;
    config["proxy-groups"] = [
      { name: chainGroupName, type: "select", proxies: [...choices, "DIRECT"] },
      ...(config["proxy-groups"] || []).filter(group => group.name !== chainGroupName)
    ];
  }
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];
  const proxiedDns = [
    "https://1.1.1.1/dns-query#🚀 节点选择",
    "https://8.8.8.8/dns-query#🚀 节点选择"
  ];

  // 自有域名默认走代理，直连例外使用精确主机名和加密 DNS，
  // 避免系统/明文 DNS 污染。整域不再排除 Fake-IP，代理主机由远端解析。
  const directPublicDomains = [
    "derp-sh.229929605.xyz",
    "cfcdn.229929605.xyz",
    "cjp.229929605.xyz",
    "crn.229929605.xyz",
    "rn.229929605.xyz",
    "jph2.229929605.xyz",
    "ss.jph2.229929605.xyz",
    "claude.229929605.xyz",
    "sublink.229929605.xyz",
    "auth.229929605.xyz",
    "travel.229929605.xyz",
    "opencode.229929605.xyz",
    "nav.229929605.xyz",
    "ali-hk.bytecloudapp.com",
    "kddi.bytecloudapp.com",
    "kddi-cf.bytecloudapp.com",
    "kddi-ws.bytecloudapp.com"
  ];
  const legacyZonePatterns = ["229929605.xyz", "bytecloudapp.com"]
    .flatMap(zone => [zone, `+.${zone}`, `*.${zone}`]);

  // 公司域名默认本地直连，需要时通过 corp172 的 SSH SOCKS 出口。
  const companyDomains = [
    "dongfu1.com",
    "dongfangfuli.com",
    "psf-dev.com",
    "ocjfuli.com"
  ];

  /*
   * 1. 保留 Tailnet SOCKS 与独立的本地 SSH SOCKS 入口
   */
  const corpProxyNode = {
    name: "corp172-proxy",
    type: "socks5",
    server: "100.93.132.98",
    port: 1080
  };
  const sshProxyNode = {
    name: "corp172-ssh",
    type: "socks5",
    server: "127.0.0.1",
    port: 11080
  };

  const corpGroupName = "🏢 公司内网";
  const corpGroup = {
    name: corpGroupName,
    type: "select",
    proxies: ["DIRECT", "corp172-proxy", "corp172-ssh"]
  };

  config.proxies = config.proxies || [];
  for (const node of [corpProxyNode, sshProxyNode]) {
    let proxy = config.proxies.find(p => p.name === node.name);
    if (!proxy) { proxy = {}; config.proxies.push(proxy); }
    Object.assign(proxy, node);
    delete proxy["interface-name"];
  }
  // 只有手动选用旧 Tailnet 出口时才使用该绑定；本地 SSH 始终不绑定网卡。
  if (mode === "tun" && /^utun\d+$/.test(tailscaleInterface || "")) {
    config.proxies.find(p => p.name === corpProxyNode.name)["interface-name"] = tailscaleInterface;
  }

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
   * TUN 公司域名使用 Fake-IP；SOCKS 由远端解析，DIRECT 使用普通 DNS 配置。
   */
  const oldPolicy = { ...(config.dns["nameserver-policy"] || {}) };
  for (const [key, value] of Object.entries(oldPolicy)) {
    const resolvers = Array.isArray(value) ? value : [value];
    if (resolvers.some(resolver => resolver === "system")) delete oldPolicy[key];
  }

  for (const domain of companyDomains) {
    delete oldPolicy[`+.${domain}`];
    delete oldPolicy[`*.${domain}`];
    delete oldPolicy[domain];
  }

  // 清掉旧订阅中的整域 DNS 例外，保留精确主机策略。
  for (const key of legacyZonePatterns) {
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

  const directPublicPolicy = Object.fromEntries(directPublicDomains.map(domain => [domain, publicDns]));

  config.dns["nameserver-policy"] = {
    ...oldPolicy,
    ...directPublicPolicy,
    "+.ts.net": ["100.100.100.100"],
    "+.chatgpt.com": proxiedDns,
    "geosite:cn": publicDns
  };

  /*
   * 4. Fake-IP 过滤
   * 公司域名保留 Fake-IP，按策略组选择本地直连或 SSH 远端解析。
   */
  const filterList = [
    ...directPublicDomains,
    "geosite:private",
    "localhost",
    "+.local",
    "+.tailscale.com",
    "+.ts.net"
  ];

  const retireWholeZone = item => legacyZonePatterns.includes(item)
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
    `IP-CIDR,10.0.0.0/8,${corpGroupName},no-resolve`,
    ...companyRules
  ];

  // 清理旧订阅/脚本遗留的公司 DNS 例外，不再为这些解析器设置专用规则。
  const retiredDnsRules = new Set([
    "IP-CIDR,10.8.100.121/32,DIRECT,no-resolve",
    "IP-CIDR,10.8.121.121/32,DIRECT,no-resolve"
  ]);
  const existingRules = config.rules || [];

  config.rules = [
    ...myRules,
    ...existingRules.filter(rule => !myRules.includes(rule) && !retiredDnsRules.has(rule))
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
