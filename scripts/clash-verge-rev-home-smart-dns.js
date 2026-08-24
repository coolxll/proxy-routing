// Clash Verge Rev 订阅扩展脚本 - 家庭网络智能 DNS 精准分流版
function main(config) {
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];

  // 这些公网域名保持 DIRECT，但必须使用加密 DNS，避免系统/明文 DNS 污染。
  const directPublicDomains = [
    "229929605.xyz"
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

  const directPublicPolicy = Object.fromEntries(
    directPublicDomains.map(domain => [`+.${domain}`, publicDns])
  );

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

  return config;
}
