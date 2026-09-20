// Clash Verge Rev 订阅扩展脚本 - 智能自适应全网络版 (含 corp172 内网穿透代理)
function main(config) {
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];

  // 这些公网域名保持 DIRECT，但必须使用加密 DNS，避免系统/明文 DNS 污染。
  const directPublicDomains = [
    "229929605.xyz",
    "bytecloudapp.com"
  ];

  // 公司域名通过 corp172 远端代理直连，兼顾办公网与家庭网无感接入
  const companyDomains = [
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
  config.dns["direct-nameserver"] = ["system"];
  config.dns["direct-nameserver-follow-policy"] = true;

  /*
   * 3. DNS 策略
   * 公司域名交由代理远端解析，不再本地强行查询 vpnDns，避免在家庭网/未连 VPN 时超时
   */
  const oldPolicy = config.dns["nameserver-policy"] || {};

  const conflictKeys = [
    "geosite:cn,private",
    "geosite:private,cn",
    "geosite:private",
    "geosite:cn"
  ];

  conflictKeys.forEach(key => {
    delete oldPolicy[key];
  });

  const directPublicPolicy = Object.fromEntries(
    directPublicDomains.map(domain => [`+.${domain}`, publicDns])
  );

  config.dns["nameserver-policy"] = {
    ...oldPolicy,
    ...directPublicPolicy,
    "+.ts.net": ["100.100.100.100"],
    "geosite:private": ["system"],
    "geosite:cn": publicDns
  };

  /*
   * 4. Fake-IP 过滤
   * 公司域名不加入 Fake-IP filter，使 Fake-IP 正常生效，请求封装至 SOCKS5 由远端解析
   */
  const directFakeIpFilters = directPublicDomains.map(
    domain => `+.${domain}`
  );

  const filterList = [
    ...directFakeIpFilters,
    "geosite:private",
    "localhost",
    "+.local",
    "+.tailscale.com",
    "+.ts.net"
  ];

  config.dns["fake-ip-filter"] = [
    ...new Set([
      ...(config.dns["fake-ip-filter"] || []),
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
  if (
    config.tun &&
    Array.isArray(config.tun["route-exclude-address"])
  ) {
    config.tun["route-exclude-address"] =
      config.tun["route-exclude-address"].filter(
        item => item !== "10.0.0.0/8"
      );
  }

  return config;
}
