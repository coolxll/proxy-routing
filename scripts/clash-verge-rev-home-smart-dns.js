// Clash Verge Rev 订阅扩展脚本 - 家庭网络智能 DNS 精准分流版
// 依赖本项目模板提供 dmm rule-provider 和“🇯🇵 日本”策略组。
function main(config) {
  const publicDns = [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
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

  config.dns["nameserver-policy"] = {
    // 先保留订阅原有的其他策略
    ...oldPolicy,

    "+.ts.net": ["100.100.100.100"],
    "geosite:private": ["system"],
    "geosite:cn": publicDns
  };

  /*
   * 2. Fake-IP 过滤
   */
  const filterList = [
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
  const myRules = [
    "GEOSITE,private,DIRECT",
    "RULE-SET,dmm,🇯🇵 日本"
  ];

  // 避免订阅中已经存在相同规则时重复添加
  const existingRules = config.rules || [];

  config.rules = [
    ...myRules,
    ...existingRules.filter(rule => !myRules.includes(rule))
  ];

  return config;
}
