// Clash Verge Rev 订阅扩展脚本 - 家庭网络智能 DNS 精准分流版
function main(config) {
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ];

  // 自有域名默认走代理，直连例外使用精确主机名和加密 DNS，
  // 避免系统/明文 DNS 污染。
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
    "kddi-ws.bytecloudapp.com",
    "migu1.bytecloudapp.com",
    "migu2.bytecloudapp.com"
  ];
  const legacyZonePatterns = ["229929605.xyz", "bytecloudapp.com"]
    .flatMap(zone => [zone, `+.${zone}`, `*.${zone}`]);

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

  // 清掉旧订阅中的整域 DNS 例外，保留精确主机策略。
  for (const key of legacyZonePatterns) {
    delete oldPolicy[key];
  }

  const directPublicPolicy = Object.fromEntries(directPublicDomains.map(domain => [domain, publicDns]));

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
  const filterList = [
    ...directPublicDomains,
    "geosite:private",
    "localhost",
    "+.local",
    "+.tailscale.com",
    "+.ts.net"
  ];

  // 整域排除会覆盖上面的精确主机，代理主机必须去掉整域 Fake-IP 过滤。
  const retireWholeZone = item => legacyZonePatterns.includes(item);

  config.dns["fake-ip-filter"] = [
    ...new Set([
      ...(config.dns["fake-ip-filter"] || []).filter(item => !retireWholeZone(item)),
      ...filterList
    ])
  ];

  return config;
}
