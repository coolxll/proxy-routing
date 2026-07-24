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

  windows-update:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/windows-update.yaml"
    path: ./ruleset/windows-update.yaml
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

  microsoft:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/microsoft.yaml"
    path: ./ruleset/microsoft.yaml
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

  bank:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/bank.yaml"
    path: ./ruleset/bank.yaml
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

  # 🪟 Windows / Microsoft Update
  # DO 控制面应直连；其余更新默认直连，避免 WinHTTP / HTTP Range 代理兼容问题
  - RULE-SET,windows-update,DIRECT

  # ⬇️ 大流量规则（必须在 Google 前，避免 googlevideo.com 被 Google 规则提前匹配）
  - RULE-SET,traffic-heavy,⬇️ 大流量
  
  # Google & Gemini（高级分流）
  - RULE-SET,google,Google
  
  # 🤖 AI 服务（需高质量 IP 或指定区域）
  - RULE-SET,ai,🤖 AI

  # Ⓜ️ Bing / Microsoft 365 / 账号（必须在 AI 后，让 Copilot 优先命中 AI）
  - RULE-SET,microsoft,Ⓜ️ Microsoft
  
  # 📦 GitHub 规则
  - RULE-SET,github,📦 GitHub
  
  # ✈️ Telegram 规则
  - RULE-SET,telegram,✈️ Telegram

  # 🏦 银行网站直连
  - RULE-SET,bank,DIRECT
  
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

# 🪟 Windows / Microsoft Update（DO / WinHTTP 默认直连）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/windows-update.list,DIRECT

# ⬇️ 大流量（必须在 Google 前，避免 googlevideo.com 被 Google 规则提前匹配）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量

# Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,Google

# 🤖 AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI

# Ⓜ️ Bing / Microsoft 365 / 账号（必须在 AI 后，让 Copilot 优先命中 AI）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/microsoft.list,Ⓜ️ Microsoft

# 📦 GitHub 规则
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,📦 GitHub

# ✈️ Telegram
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,✈️ Telegram

# 🏦 银行网站直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/bank.list,DIRECT

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
# Windows / Microsoft Update（DO / WinHTTP 默认直连）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/windows-update.list,DIRECT
# 大流量（必须在 Google 前，避免 googlevideo.com 被 Google 规则提前匹配）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量
# Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,Google
# AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI
# Bing / Microsoft 365 / 账号（必须在 AI 后，让 Copilot 优先命中 AI）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/microsoft.list,Ⓜ️ Microsoft
# GitHub
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,📦 GitHub
# Telegram
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,✈️ Telegram
# 银行网站直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/bank.list,DIRECT
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
# Windows / Microsoft Update（DO / WinHTTP 默认直连）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/windows-update.list,DIRECT
# 大流量（必须在 Google 前，避免 googlevideo.com 被 Google 规则提前匹配）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量
# Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,Google
# AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI
# Bing / Microsoft 365 / 账号（必须在 AI 后，让 Copilot 优先命中 AI）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/microsoft.list,Ⓜ️ Microsoft
# GitHub
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,📦 GitHub
# Telegram
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,✈️ Telegram
# 银行网站直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/bank.list,DIRECT
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

---

## 6. v2rayN

v2rayN 可以从远程 URL 导入自定义路由规则。规则文件必须是 JSON 数组格式，每一项对应一条路由规则。

远程地址：

```text
https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/v2rayn-routing.json
```

在 v2rayN 的路由设置中，将此地址作为远程自定义规则导入。规则按文件中的顺序从上到下匹配。

其中 `🇯🇵 日本01` 是指定的日本 IP 代理组，必须与本地 v2rayN 配置中的 outbound 名称完全一致，不要改成通用的 `proxy`。

---

## Microsoft 分流注意事项

- `windows-update` 必须在 `microsoft` 前。`*.do.dsp.mp.microsoft.com` 是 Delivery Optimization 控制面，微软建议绕过代理与 TLS 检查并直连公网。
- Windows Update 使用 WinHTTP；更新内容下载依赖 HTTP Range / 206。若上游代理不支持 Range、需要认证、修改响应或出口不稳定，可能出现 407、503、全量重下或更新失败。
- `ai` 必须在 `microsoft` 前，确保 `copilot.microsoft.com`、`copilot.cloud.microsoft`、`m365.cloud.microsoft` 与 `edgeservices.bing.com` 优先走 AI 策略。
- `microsoft` 承接 Bing、Microsoft 365、Office、OneDrive、Outlook、Teams 与账号登录。不要把整个 Microsoft 域名集合塞进 AI 或更新组。
- `msftconnecttest.com` 与 `msftncsi.com` 继续直连，用于 Windows 网络连接状态检测。
