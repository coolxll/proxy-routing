// Clash Verge Rev 订阅扩展脚本 - 智能 DNS 精准分流版
// 依赖本项目模板提供 dmm rule-provider 和“🇯🇵 日本”策略组。
function main(config) {
  const vpnDns = ["10.8.100.121", "10.8.121.121"];

  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];

  // 公司域名只在这里维护
  const companyDomains = [
    "dongfangfuli.com",
    "psf-dev.com",
    "ocjfuli.com"
  ];

  if (!config.dns) {
    config.dns = {};
  }

  config.dns.enable = true;
  config.dns["respect-rules"] = false;

  /*
   * 1. DNS 策略
   */
  const oldPolicy = config.dns["nameserver-policy"] || {};

  // 清理可能与新策略冲突的旧规则
  const conflictKeys = [
    "geosite:cn,private",
    "geosite:private,cn",
    "geosite:private",
    "geosite:cn"
  ];

  conflictKeys.forEach(key => {
    delete oldPolicy[key];
  });

  // +.example.com 同时匹配根域名和所有层级子域名
  const companyPolicy = Object.fromEntries(
    companyDomains.map(domain => [`+.${domain}`, vpnDns])
  );

  config.dns["nameserver-policy"] = {
    // 先保留订阅原有的其他策略
    ...oldPolicy,

    // 后写入，确保公司策略不会被订阅覆盖
    ...companyPolicy,

    "geosite:private": ["system"],
    "geosite:cn": publicDns
  };

  /*
   * 2. Fake-IP 过滤
   */
  const companyFakeIpFilters = companyDomains.map(
    domain => `+.${domain}`
  );

  const filterList = [
    ...companyFakeIpFilters,
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
   * 3. 路由规则
   */
  const companyRules = companyDomains.map(
    domain => `DOMAIN-SUFFIX,${domain},DIRECT`
  );

  const myRules = [
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    ...companyRules,
    "GEOSITE,private,DIRECT",
    "RULE-SET,dmm,🇯🇵 日本"
  ];

  // 避免订阅中已经存在相同规则时重复添加
  const existingRules = config.rules || [];

  config.rules = [
    ...myRules,
    ...existingRules.filter(rule => !myRules.includes(rule))
  ];

  /*
   * 4. TUN 排除列表
   *
   * 不排除 10.0.0.0/8，让请求先进入 Mihomo，
   * 再通过上面的 DIRECT 规则交给系统路由/VPN。
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
