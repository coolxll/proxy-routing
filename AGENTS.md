# 代理客户端配置指南 (Proxy Agents Configuration)

本指南介绍如何在不同的代理客户端（以下统称 **Agents**）中引用本仓库的规则。

---

## 1. Mihomo / Clash.Meta / Clash

在 Clash 生态中，推荐使用 `rule-providers`（规则集）以支持动态更新和更好的内存优化。

### 示例配置

```yaml
# 规则集定义
rule-providers:
  private:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/private.yaml"
    path: ./ruleset/private.yaml
    interval: 86400
  
  google:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/google.yaml"
    path: ./ruleset/google.yaml
    interval: 86400

  ai:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/ai.yaml"
    path: ./ruleset/ai.yaml
    interval: 86400

  github:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/github.yaml"
    path: ./ruleset/github.yaml
    interval: 86400

  traffic-heavy:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/traffic-heavy.yaml"
    path: ./ruleset/traffic-heavy.yaml
    interval: 86400

  telegram:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/telegram.yaml"
    path: ./ruleset/telegram.yaml
    interval: 86400

  direct:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/direct.yaml"
    path: ./ruleset/direct.yaml
    interval: 86400

  proxy:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/proxy.yaml"
    path: ./ruleset/proxy.yaml
    interval: 86400

# 规则策略组路由配置
rules:
  # 🎯 局域网直连
  - RULE-SET,private,DIRECT
  
  # 🇬 Google & Gemini（高级分流）
  - RULE-SET,google,🇬 Google
  
  # 🤖 AI 服务（需高质量 IP 或指定区域）
  - RULE-SET,ai,🤖 AI
  
  # 📦 GitHub 规则
  - RULE-SET,github,📦 GitHub
  
  # ⬇️ 大流量规则（如 YouTube、系统更新等，对 IP 纯净度低，追求大带宽速度）
  - RULE-SET,traffic-heavy,⬇️ 大流量
  
  # ✈️ Telegram 规则
  - RULE-SET,telegram,✈️ Telegram
  
  # 🎯 额外直连
  - RULE-SET,direct,DIRECT
  
  # 🌐 代理补充
  - RULE-SET,proxy,🌐 代理
  
  # 其余国内流量直连（通常使用 geosite / geoip 底座）
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT
  
  # 兜底代理
  - MATCH,🌐 代理
```

---

## 2. Surge (iOS / macOS)

Surge 能够极好地支持基于外部文件的 `RULE-SET` 规则段。建议使用 `.list` 纯文本格式规则。

### 示例配置

```ini
[Rule]
# 🎯 局域网直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/private.list,DIRECT,no-resolve

# 🇬 Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,🇬 Google

# 🤖 AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI

# 📦 GitHub 规则
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,📦 GitHub

# ⬇️ 大流量
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量

# ✈️ Telegram
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,✈️ Telegram

# 🎯 额外直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/direct.list,DIRECT

# 🌐 代理补充
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/proxy.list,🌐 代理

# 兜底规则（结合 Surge 本地 GeoIP/GeoSite）
RULE-SET,SYSTEM,DIRECT
RULE-SET,LAN,DIRECT
GEOIP,CN,DIRECT
FINAL,🌐 代理
```

---

## 3. Shadowrocket (小火箭)

在 Shadowrocket 中，你可以在你的配置文本中，通过 `RULE-SET` 规则，直接订阅仓库中的 `.list` 规则文件。

### 示例配置

```text
[Rule]
# 私有地址
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/private.list,DIRECT
# Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,🇬 Google
# AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI
# GitHub
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,📦 GitHub
# 大流量
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量
# Telegram
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,✈️ Telegram
# 额外直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/direct.list,DIRECT
# 通用代理
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/proxy.list,🌐 代理

# 兜底
GEOIP,CN,DIRECT
FINAL,🌐 代理
```

---

## 4. Loon (iOS)

Loon 的配置与 Surge/Shadowrocket 类似，采用 `RULE-SET` 的格式解析文本规则列表。

### 示例配置

```ini
[Rule]
# 局域网
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/private.list,DIRECT
# Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,🇬 Google
# AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI
# GitHub
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,📦 GitHub
# 大流量
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量
# Telegram
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,✈️ Telegram
# 直连补充
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/direct.list,DIRECT
# 代理补充
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/proxy.list,🌐 代理

# 兜底
GEOIP,CN,DIRECT
FINAL,🌐 代理
```

---

## 5. Sing-box

Sing-box 规则集（`rule_set`）通常需要 JSON 格式的二进制或源文件。如果你使用本地转换或外部自定义脚本，可以使用本项目的 `.list` 纯文本作为输入源，将其解析为 Sing-box 的 `dns.rules` 或 `route.rules` 配置。
