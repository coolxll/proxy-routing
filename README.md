# Proxy Routing Rules (自用分流规则)

本仓库用于维护个人自用的代理分流规则、Clash 规则集（Rule Provider）以及 Subconverter 配置文件。

## 📂 目录结构

```text
├── providers/          # Clash / Mihomo (Clash.Meta) 规则集 (.yaml 格式)
│   ├── ai.yaml
│   ├── direct.yaml
│   ├── github.yaml
│   ├── google.yaml
│   ├── private.yaml
│   ├── proxy.yaml
│   ├── telegram.yaml
│   └── traffic-heavy.yaml
├── rules/              # 纯文本分流列表 (.list 格式，适用于 Surge / Shadowrocket / Loon / Subconverter)
│   ├── ai.list
│   ├── direct.list
│   ├── github.list
│   ├── google.list
│   ├── private.list
│   ├── proxy.list
│   ├── telegram.list
│   └── traffic-heavy.list
└── templates/          # 订阅转换模板配置 (.ini 格式)
    └── subconverter.ini
```

## 📝 规则分类与说明

| 规则类型 | 说明 | 对应文件 | 示例条目 |
| :--- | :--- | :--- | :--- |
| **🇬 Google** | Google 服务与 Gemini AI。单独成组以实现更高优先级的分流与连接策略。 | `google.list` / `google.yaml` | Google 基础服务、Gemini AI (bard, aistudio, notebooklm) |
| **🤖 AI 平台** | 包含主流 AI 平台（不含 Google Gemini）。由于 AI 服务通常需要特定区域且高质量的 IP，因此单独成组。 | `ai.list` / `ai.yaml` | OpenAI, Claude, DeepSeek, Mistral, Copilot, Cursor 等 |
| **📦 GitHub** | GitHub 的网页、API 和 Copilot 规则，用于提高开发体验和稳定性。 | `github.list` / `github.yaml` | `github.com`, `github.io`, `api.githubcopilot.com` 等 |
| **⬇️ 大流量** | 包含 YouTube、包管理器（npm, pypi, docker, brew 等）、系统更新（Apple）以及 AI CDN/静态资源（如 oaistatic.com, claudeusercontent.com）。此类流量特点是大带宽、低交互，对 IP 不敏感，适合分配给速度快、不限流的节点。 | `traffic-heavy.list` / `traffic-heavy.yaml` | YouTube, Docker, npmjs, PyPI, Homebrew, Apple 更新、AI CDN 等 |
| **✈️ Telegram** | Telegram 专属域名和 CDN 地址。 | `telegram.list` / `telegram.yaml` | `t.me`, `telegram.org` 等 |
| **🎯 直连** | 额外补充的国内直连域名（不含在 `geosite:cn` 内的）。 | `direct.list` / `direct.yaml` | `msftconnecttest.com`, `msftncsi.com` 等 |
| **🔒 私有地址** | 局域网和私有 IP 地址，确保本地流量不走代理。 | `private.list` / `private.yaml` | `10.0.0.0/8`, `192.168.0.0/16`, `fe80::/10` 等 |
| **🌐 代理** | 通用代理规则，用于补充 `geolocation-!cn` 之外需要代理的域名。 | `proxy.list` / `proxy.yaml` | WhatsApp, Signal, Reddit 等 |

## ⚙️ 使用方法

### 1. Subconverter 订阅转换
本仓库包含自用的 Subconverter 转换模板。你可以使用配置好的 [subconverter.ini](file:///Users/lynn/workspace/proxy-routing/templates/subconverter.ini) 来生成符合你需求的客户端配置。

规则引用的 Raw 链接格式如下：
- List 规则：`https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/{{filename}}.list`
- YAML 规则集：`https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/{{filename}}.yaml`

### 2. 客户端直接引用
关于如何在不同代理客户端（Clash, Mihomo, Surge, Shadowrocket 等）中配置和引用这些规则，请参阅 [AGENTS.md](file:///Users/lynn/workspace/proxy-routing/AGENTS.md)。
