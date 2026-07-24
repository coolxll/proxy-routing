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
│   ├── microsoft.yaml
│   ├── private.yaml
│   ├── proxy.yaml
│   ├── telegram.yaml
│   ├── traffic-heavy.yaml
│   └── windows-update.yaml
├── rules/              # 纯文本分流列表 (.list 格式，适用于 Surge / Shadowrocket / Loon / Subconverter)
│   ├── ai.list
│   ├── bank.list
│   ├── direct.list
│   ├── github.list
│   ├── google.list
│   ├── microsoft.list
│   ├── private.list
│   ├── proxy.list
│   ├── telegram.list
│   ├── traffic-heavy.list
│   ├── windows-update.list
│   └── v2rayn-routing.json       # v2rayN 远程路由规则
├── templates/          # 订阅转换模板配置 (.ini 格式)
│   └── subconverter.ini
└── mitmproxy-capture.yaml # 可直接导入 Clash/Mihomo 的 mitmproxy 抓包配置
```

## 📝 规则分类与说明

| 规则类型 | 说明 | 对应文件 | 示例条目 |
| :--- | :--- | :--- | :--- |
| **Google** | Google 服务与 Gemini AI。单独成组以实现更高优先级的分流与连接策略。 | `google.list` / `google.yaml` | Google 基础服务、Gemini AI (bard, aistudio, notebooklm) |
| **🤖 AI 平台** | 包含主流 AI 平台（不含 Google Gemini）。微软 Copilot 及 Edge Copilot 入口也在此组，以使用地区合适、质量较高且出口一致的节点。 | `ai.list` / `ai.yaml` | OpenAI, Claude, DeepSeek, Mistral, Microsoft Copilot, Cursor 等 |
| **Ⓜ️ Microsoft** | Bing、Microsoft 365、Office、Outlook、OneDrive、SharePoint、账号登录与协作服务。与 Windows Update、Copilot 分组，避免策略互相牵连。 | `microsoft.list` / `microsoft.yaml` | Bing, Microsoft 365, Office, OneDrive, Entra ID 等 |
| **🪟 Windows 更新** | Windows Update、Delivery Optimization、Microsoft Store、Edge 与 Microsoft 365 Apps 更新。默认直连，降低 WinHTTP、TLS 检查和 HTTP Range 不兼容导致的失败；同时涵盖 Mac Office 更新 CDN。 | `windows-update.list` / `windows-update.yaml` | `*.do.dsp.mp.microsoft.com`, `*.delivery.mp.microsoft.com`, `*.windowsupdate.com`, Office CDN 等 |
| **🏦 银行** | HSBC 银行网站，默认直连以避免代理出口 IP 触发登录风控。 | `bank.list` / `bank.yaml` | `hsbc.com.sg`, `hsbc.com.hk`, `hsbcnet.com` 等 |
| **📦 GitHub** | GitHub 的网页、API 和 Copilot 规则，用于提高开发体验和稳定性。 | `github.list` / `github.yaml` | `github.com`, `github.io`, `api.githubcopilot.com` 等 |
| **⬇️ 大流量** | 包含 YouTube、包管理器（npm, pypi, docker, brew 等）、Apple 系统更新以及 AI CDN/静态资源。Windows Update 因 WinHTTP / Delivery Optimization 的特殊要求单独分组。 | `traffic-heavy.list` / `traffic-heavy.yaml` | YouTube, Docker, npmjs, PyPI, Homebrew, Apple 更新、AI CDN 等 |
| **✈️ Telegram** | Telegram 专属域名和 CDN 地址。 | `telegram.list` / `telegram.yaml` | `t.me`, `telegram.org` 等 |
| **🎯 直连** | 额外补充的直连域名。 | `direct.list` / `direct.yaml` | `msftconnecttest.com`, `229929605.xyz`, `tail945737.ts.net` 等 |
| **🔒 私有地址** | 局域网和私有 IP 地址，确保本地流量不走代理。 | `private.list` / `private.yaml` | `10.0.0.0/8`, `192.168.0.0/16`, `fe80::/10` 等 |
| **🌐 代理** | 通用代理规则，用于补充 `geolocation-!cn` 之外需要代理的域名。 | `proxy.list` / `proxy.yaml` | WhatsApp, Signal, Reddit 等 |

### Microsoft 分流原则

Microsoft 流量按用途拆分，并按以下顺序匹配：

1. `windows-update`：默认 `DIRECT`。微软明确建议 `*.do.dsp.mp.microsoft.com` 直连并绕过 TLS 检查；更新内容代理还必须支持 HTTP Range / 206，否则 WinHTTP 可能下载失败、退回全量下载或出现 503。
2. `ai`：Copilot 网站、Microsoft 365 Copilot 共用入口、Edge Copilot 容器。AI 服务对地区和出口 IP 更敏感。
3. `microsoft`：Bing、Microsoft 365、账号与其他交互服务。可按所在网络选择代理或直连。
4. `direct`：`msftconnecttest.com` / `msftncsi.com` 保持直连，避免 Windows 网络状态检测误判。

`*.cloud.microsoft` 是 Microsoft 365 的统一域名，既承载 Copilot，也承载 Office、Outlook 等服务，单凭域名无法按 URL 路径完全拆开。本仓库将已知的 `copilot.cloud.microsoft` 与 `m365.cloud.microsoft` 优先放入 AI，其余 `cloud.microsoft` 流量进入 Microsoft 组。

规则依据以微软官方动态资料为准：

- [Using a proxy with Delivery Optimization](https://learn.microsoft.com/en-us/windows/deployment/do/delivery-optimization-proxy)
- [Connection endpoints for Windows 11 Enterprise](https://learn.microsoft.com/en-us/windows/privacy/manage-windows-11-endpoints)
- [Microsoft 365 IP Address and URL web service](https://learn.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-ip-web-service)
- [Microsoft 365 Copilot network requirements](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-requirements)
- [Allowlist for Microsoft Edge endpoints](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-endpoints)
- [Network requests in Office for Mac](https://learn.microsoft.com/en-us/microsoft-365/enterprise/network-requests-in-office-2016-for-mac)

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
