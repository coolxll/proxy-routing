// Clash Verge Rev 订阅扩展脚本 - 家庭网络智能 DNS 精准分流版
function main(config) {
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];

  // 229929605.xyz 默认走代理，只有依赖直连的主机保持 DIRECT 并使用加密 DNS，
  // 避免系统/明文 DNS 污染。
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

  if (!config.dns) {
    config.dns = {};
  }

  config.dns.enable = true;
  config.dns["respect-rules"] = false;
  config.dns["direct-nameserver"] = ["system"];
  config.dns["direct-nameserver-follow-policy"] = true;

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

  // 订阅可能仍带整域 229929605.xyz 的国内 DoH 策略；代理主机必须交给远端解析。
  for (const key of ["229929605.xyz", "+.229929605.xyz", "*.229929605.xyz"]) {
    delete oldPolicy[key];
  }

  const directPublicPolicy = Object.fromEntries([
    ...directPublicDomains.map(domain => [domain, publicDns]),
    ...directPublicSuffixes.map(domain => [`+.${domain}`, publicDns])
  ]);

  config.dns["nameserver-policy"] = {
    // 先保留订阅原有的其他策略
    ...oldPolicy,

    // DIRECT 重解析也遵守此 policy，避免退回 system DNS
    ...directPublicPolicy,

    "+.ts.net": ["100.100.100.100"],
    "geosite:private": ["system"],
    "geosite:cn": publicDns
  };

  /*
   * 2. Fake-IP 过滤
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

  // 整域排除会覆盖上面的精确主机，代理主机必须去掉整域 Fake-IP 过滤。
  const retireWholeZone = item => ["229929605.xyz", "+.229929605.xyz", "*.229929605.xyz"].includes(item);

  config.dns["fake-ip-filter"] = [
    ...new Set([
      ...(config.dns["fake-ip-filter"] || []).filter(item => !retireWholeZone(item)),
      ...filterList
    ])
  ];

  return config;
}
