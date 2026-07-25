# 代理客户端配置指南 (Proxy Agents Configuration)

本指南介绍如何在不同的代理客户端（以下统称 **Agents**）中引用本仓库的规则。

---

## 仓库维护与落地流程

### 先判断变更类型

| 类型 | 典型变更 | 是否更新模板 | 是否重新生成订阅 |
| :--- | :--- | :---: | :---: |
| 仅更新 list | 在现有分类中增删域名、IP、CIDR | 否 | 通常否 |
| 更新模板 | 新增 provider、调整策略组/规则顺序/DNS/端口 | 是 | 是 |

无论哪种类型，都先推送 Git，再刷新 SublinkPro 或客户端。模板引用的是 GitHub Raw 地址；
若先下发模板，新增的远端规则文件可能还不存在或仍命中旧缓存。

### 流程 A：仅更新 list

1. 修改 `rules/<name>.list`，并同步修改对应的 `providers/<name>.yaml`。两者规则内容应一致，
   区别只是 YAML 文件外层有 `payload:`。
2. 若 v2rayN 也使用这一分类，同步更新 `rules/v2rayn-routing.json`。
3. 执行基础检查：

   ```bash
   git diff --check
   ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f) }' providers/*.yaml
   jq empty rules/v2rayn-routing.json
   git diff -- rules providers
   ```

4. 提交并推送 `main`。只要 provider 名称和 URL 没变，不需要更新 SublinkPro 模板。
5. 客户端会按 `interval: 86400` 自动刷新。需要立即落地时，手动更新 rule-provider；
   小米路由器也可以执行 ShellCrash 的订阅更新任务。

### 流程 B：更新模板

1. 修改 `templates/` 下的模板；新增 provider 时，同时添加 `rules/*.list` 和
   `providers/*.yaml`，并确保 `RULE-SET` 名称与 `rule-providers` 的键完全一致。
2. 保持规则顺序：私有地址、广告、Windows Update、大流量、Google、AI、Microsoft、
   GitHub、Telegram、银行、DMM、额外直连/代理、中国域名与 GeoIP 兜底、`MATCH`。
   地区策略组使用 `include-all + filter` 时，不要再显式加入“节点选择”“自动选择”等上级组，
   否则这些上级组也会出现在地区组的可选项中。
3. 执行流程 A 的检查，并额外验证 ShellCrash 模板：

   ```bash
   ruby -e 'require "yaml"; YAML.load_file("templates/shellcrash-low-geosite.yaml")'
   git diff --check
   ```

4. 提交并推送 Git。确认新增 Raw URL 返回 `200` 后，再更新 SublinkPro：

   - SublinkPro `routing.yaml` 的正文来自 `templates/routing.yaml`，规则源使用
     `templates/subconverter.ini`；
   - `xiaomi-shellcrash.yaml` 使用 `templates/shellcrash-low-geosite.yaml`，规则源为
     `templates/subconverter-low-geosite.ini`；
   - 更新后生成一次订阅，至少检查 YAML 可解析、代理节点数、策略组、`rules` 和
     `rule-providers`，并确认关键节点（如 `DediRock-LA`）存在。

5. 默认选择“规则生成”：配置保留远端 `RULE-SET`，后续只改 list 就能独立刷新。
   “规则远端展开”只用于不支持 rule-provider 或要求配置完全自包含的客户端；list 每次变化后
   都必须重新生成、重新下发，配置也更大。

### Clash Verge Rev 扩展脚本维护

Clash Verge Rev 使用两份独立的订阅后处理脚本：

- `scripts/clash-verge-rev-smart-dns.js` 是办公版兼容入口。公司域名只在 `companyDomains`
  维护，VPN DNS 只在 `vpnDns` 维护；
- `scripts/clash-verge-rev-home-smart-dns.js` 是家庭网络版，不得加入公司 DNS、公司域名规则或
  针对 `10.0.0.0/8` 的 TUN 修改；
- 两版都让普通 `DIRECT` 使用系统 DNS 重解析，并将 `*.ts.net` 交给本机
  `100.100.100.100` 解析和排除 Fake-IP；
- 家庭版不得注入或重排路由；办公版的公司/VPN 自定义路由必须放在原订阅规则前，并过滤完全相同的
  重复规则；
- 办公版保留 `10.0.0.0/8` 进入 TUN，再由 `DIRECT` 交给系统 VPN 路由，不要把它重新加入
  `route-exclude-address`；家庭版保持原订阅的 TUN 排除列表不变；
- 扩展脚本不得重复注入 `private` 或 `dmm`；DMM 继续由 `routing.yaml` 中原有的
  `RULE-SET,dmm,🇯🇵 日本` 处理；
- 修改后对两份脚本执行 `node --check`，并在 Clash Verge Rev 中确认扩展后的 DNS policy、
  Fake-IP filter 和规则顺序。扩展脚本变更不需要更新 SublinkPro 模板，但客户端必须重新应用
  对应脚本。

### 小米路由器 ShellCrash 落地

当前路由器地址为 `192.168.3.1`。仓库和文档不得保存 SSH 密码、SublinkPro API Key 或
订阅分享 token；本地 `.env` 必须保持 Git 忽略且权限为 `600`。

Git 与 SublinkPro 都验证完成后执行：

```bash
ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.3.1
/data/clash/task/task.sh 104
```

更新任务必须成功通过内核配置检查。随后从维护电脑验证：

```bash
curl -fsS http://192.168.3.1:9999/version
curl -fsS http://192.168.3.1:9999/rules | jq '.rules | length'
curl -fsS http://192.168.3.1:9999/providers/rules | jq '.providers | keys'
curl -fsS http://192.168.3.1:9999/proxies | jq '.proxies | keys'
```

重点确认：

- `dmm`、`cn-domain`、`direct` 等 provider 已加载；
- DMM 使用 `RULE-SET,dmm`，不要恢复为依赖客户端数据集的 `GEOSITE,dmm`；
- `direct` 中包含自有域名和 VPS IP，防止代理节点入口再次经过代理形成多重链路；
- `DediRock-LA` 及预期策略组存在，核心进程持续运行。
- `🇯🇵 日本` 必须是 `fallback`，成员顺序固定为 `日本01-Hy`、`日本01`；前者不健康时
  自动切到后者。
- `GLOBAL` 是 Mihomo 内建组，不来自模板；在本项目的 `Rule` 模式下无需操作。

若新配置校验失败，先保存失败现场，再恢复 ShellCrash 留下的上一版配置：

```bash
cp /data/clash/yamls/config.yaml /data/clash/yamls/config.yaml.failed-$(date +%Y%m%d-%H%M%S)
cp /data/clash/yamls/config.yaml.bak /data/clash/yamls/config.yaml
/data/clash/start.sh start
```

GeoSite 标签在不同 ShellCrash 发行版的数据集中可能不存在。小米模板不使用 GeoSite：
DMM 使用仓库 `dmm.list`，中国域名使用 ACL4SSR `ChinaDomain.list`，其他域名由最终规则承接。
新增分类时也优先使用远端 `.list`。

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

  dmm:
    type: http
    behavior: classical
    url: "https://raw.githubusercontent.com/coolxll/proxy-routing/main/providers/dmm.yaml"
    path: ./ruleset/dmm.yaml
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

  # 🇯🇵 DMM / FANZA（远端 list，避免依赖 geosite:dmm）
  - RULE-SET,dmm,🇯🇵 日本
  
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
