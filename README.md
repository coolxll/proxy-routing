# Proxy Routing Rules (自用分流规则)

本仓库用于维护个人自用的代理分流规则、Clash 规则集（Rule Provider）、v2rayN 远程路由规则以及 Subconverter 配置文件。

## 📂 目录结构

```text
├── providers/          # Clash / Mihomo (Clash.Meta) 规则集 (.yaml 格式)
│   ├── ai.yaml
│   ├── bank.yaml
│   ├── direct.yaml
│   ├── github.yaml
│   ├── google.yaml
│   ├── private.yaml
│   ├── proxy.yaml
│   ├── telegram.yaml
│   └── traffic-heavy.yaml
├── rules/              # 纯文本分流列表 (.list 格式，适用于 Surge / Shadowrocket / Loon / Subconverter)
│   ├── ai.list
│   ├── bank.list
│   ├── direct.list
│   ├── github.list
│   ├── google.list
│   ├── private.list
│   ├── proxy.list
│   ├── telegram.list
│   ├── traffic-heavy.list
│   └── v2rayn-routing.json       # v2rayN 远程路由规则
├── templates/          # 订阅转换模板配置 (.ini 格式)
│   └── subconverter.ini
└── mitmproxy-capture.yaml # 可直接导入 Clash/Mihomo 的 mitmproxy 抓包配置
```

## 📝 规则分类与说明

| 规则类型 | 说明 | 对应文件 | 示例条目 |
| :--- | :--- | :--- | :--- |
| **Google** | Google 服务与 Gemini AI。单独成组以实现更高优先级的分流与连接策略。 | `google.list` / `google.yaml` | Google 基础服务、Gemini AI (bard, aistudio, notebooklm) |
| **🤖 AI 平台** | 包含主流 AI 平台（不含 Google Gemini）。由于 AI 服务通常需要特定区域且高质量的 IP，因此单独成组。 | `ai.list` / `ai.yaml` | OpenAI, Claude, DeepSeek, Mistral, Copilot, Cursor 等 |
| **🏦 银行** | HSBC 银行网站，默认直连以避免代理出口 IP 触发登录风控。 | `bank.list` / `bank.yaml` | `hsbc.com.sg`, `hsbc.com.hk`, `hsbcnet.com` 等 |
| **📦 GitHub** | GitHub 的网页、API 和 Copilot 规则，用于提高开发体验和稳定性。 | `github.list` / `github.yaml` | `github.com`, `github.io`, `api.githubcopilot.com` 等 |
| **⬇️ 大流量** | 包含 YouTube、包管理器（npm, pypi, docker, brew 等）、系统更新（Apple）以及 AI CDN/静态资源（如 oaistatic.com, claudeusercontent.com）。此类流量特点是大带宽、低交互，对 IP 不敏感，适合分配给速度快、不限流的节点。 | `traffic-heavy.list` / `traffic-heavy.yaml` | YouTube, Docker, npmjs, PyPI, Homebrew, Apple 更新、AI CDN 等 |
| **✈️ Telegram** | Telegram 专属域名和 CDN 地址。 | `telegram.list` / `telegram.yaml` | `t.me`, `telegram.org` 等 |
| **🎯 直连** | 额外补充的直连域名。 | `direct.list` / `direct.yaml` | `msftconnecttest.com`, `229929605.xyz`, `tail945737.ts.net` 等 |
| **🔒 私有地址** | 局域网和私有 IP 地址，确保本地流量不走代理。 | `private.list` / `private.yaml` | `10.0.0.0/8`, `192.168.0.0/16`, `fe80::/10` 等 |
| **🌐 代理** | 通用代理规则，用于补充 `geolocation-!cn` 之外需要代理的域名。 | `proxy.list` / `proxy.yaml` | WhatsApp, Signal, Reddit 等 |

## ⚙️ 使用方法

### 1. Subconverter 订阅转换
本仓库包含自用的 Subconverter 转换模板。你可以使用配置好的 [subconverter.ini](file:///Users/lynn/workspace/proxy-routing/templates/subconverter.ini) 来生成符合你需求的客户端配置。

规则引用的 Raw 链接格式如下：
- List 规则：`https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/{{filename}}.list`
- YAML 规则集：`https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/{{filename}}.yaml`

v2rayN 远程路由规则地址：
`https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/v2rayn-routing.json`

### 2. 客户端直接引用
关于如何在不同代理客户端（Clash, Mihomo, Surge, Shadowrocket, Loon, v2rayN 等）中配置和引用这些规则，请参阅 [AGENTS.md](file:///Users/lynn/workspace/proxy-routing/AGENTS.md)。

### 3. 使用 Clash + mitmproxy 抓包

仓库提供了一个不依赖 Python、可直接导入 Clash/Mihomo 的配置文件：[mitmproxy-capture.yaml](./mitmproxy-capture.yaml)。它只配置本机 mitmproxy，不包含任何上游节点。

先启动 mitmproxy：

```bash
mitmweb --listen-host 0.0.0.0 --listen-port 8080
```

然后将 `mitmproxy-capture.yaml` 导入 Clash，并把系统或设备代理指向 Clash 的 HTTP 端口 `7890`（SOCKS5 端口为 `7891`）。首次抓 HTTPS 前，需要安装 mitmproxy 提供的 CA 证书。

如果 Clash 和 mitmproxy 不在同一台设备上，将 YAML 中的 `127.0.0.1` 改成 mitmproxy 所在设备的局域网 IP。配置默认把除本机回环地址外的流量全部交给 mitmproxy，因此企业内网网页也会进入抓包；`抓包` 策略组中的 `DIRECT` 仅用于临时绕过抓包。
