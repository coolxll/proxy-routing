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
2. 执行 `node scripts/build-sing-box-rule-sets.mjs`，同步更新 SFA 使用的
   `rules/sing-box/<name>.json`。
3. 若 v2rayN 也使用这一分类，同步更新 `rules/v2rayn-routing.json`。
4. 执行基础检查：

   ```bash
   npm run validate
   git diff -- rules providers
   ```

   `validate.mjs` 会统一检查 list/provider 内容一致性、Mihomo/ShellCrash 模板引用与规则顺序、
   `dns.enable` 语义、Sing-box/v2rayN JSON 语法、`scripts/` 下全部脚本的 `node --check`、
   SFA 配置、macOS Proxy/TUN 模式切换测试，以及 `git diff --check`。

5. 提交并推送 `main`。只要 provider 名称和 URL 没变，不需要更新 SublinkPro 模板。
6. 客户端会按 `interval: 86400` 自动刷新。需要立即落地时，手动更新 rule-provider；
   小米路由器也可以执行 ShellCrash 的订阅更新任务。

### 流程 B：更新模板

1. 修改 `templates/` 下的模板；新增 provider 时，同时添加 `rules/*.list` 和
   `providers/*.yaml`，并确保 `RULE-SET` 名称与 `rule-providers` 的键完全一致。
2. 保持规则顺序：私有地址、防误杀(UnBan)、广告、下载防封(Download)、Windows Update、
   大流量、Google、AI、Microsoft、GitHub、Telegram、银行、机酒出行、Apple、DMM、额外直连/代理、
   中国域名与 GeoIP 兜底、`MATCH`。
   策略组采用精简架构：必须包含【🚀 节点选择】、【Google】、【🤖 AI】、【⬇️ 大流量】、【🇯🇵 日本】与【♻️ 自动选择】
   6 个核心组；直连/拦截/更新直接走内置 DIRECT/REJECT；通用代理归入【🚀 节点选择】；允许按需添加专用场景组（如【🏢 公司内网】）。
   地区策略组使用 `include-all + filter` 时，不要再显式加入“节点选择”“自动选择”等上级组，
   否则这些上级组也会出现在地区组的可选项中。
3. 执行流程 A 的检查；`validate.mjs` 也会验证 ShellCrash 无 GeoSite、日本 fallback 顺序和核心策略组完整性：

   ```bash
   npm run validate
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

Clash Verge Rev 使用三份订阅后处理脚本：

- `scripts/clash-verge-rev-macos-tun-dns.js` 是 macOS Proxy/TUN **共享源**。它导出
  `macosProxyConfig(config, { mode, tailscaleInterface })`，由 `proxy-mode` 注入模式后写入
  **当前订阅**的扩展脚本文件，再让 Verge 重新生成配置。不要直接编辑 `clash-verge.yaml`；
- `scripts/clash-verge-rev-smart-dns.js` 是全网络自适应入口。自动注入 `corp172-proxy`（`100.93.132.98:1080` SOCKS5）与「🏢 公司内网」策略组，公司域名（在 `companyDomains` 维护）与 `10.0.0.0/8` 均分流至该组由远端解析与出站，不依赖本地 `vpnDns`，消除家庭网/未连 VPN 时的 DNS 查询超时；
- `scripts/clash-verge-rev-home-smart-dns.js` 是家庭网络版，不得加入公司域名规则、公司代理或针对 `10.0.0.0/8` 的 TUN 修改。

macOS 现有订阅绑定的是共享源的渲染结果（`{"mode":"proxy"}`），不是 smart-dns。

三份脚本都适用的通用约束：

- 普通 `DIRECT` 使用系统 DNS 重解析，并将 `*.ts.net` 交给本机 `100.100.100.100` 解析和排除
  Fake-IP；
- `229929605.xyz` 默认走代理（Cloudflare 前缀直连质量不稳定），只有白名单主机保持直连并使用
  公共 DoH、排除 Fake-IP：`derp-sh`、`crn`、`rn`、`ss.jph2`、`claude`、`sublink`、`auth`、
  `travel`、`opencode`、`nav`；脚本必须删除订阅遗留的整域 `229929605.xyz` / `+.229929605.xyz`
  policy 与 Fake-IP 过滤，否则整域会覆盖精确主机；
- 不得重复注入 `private` 或 `dmm`；DMM 继续由 `routing.yaml` 中原有的
  `RULE-SET,dmm,🇯🇵 日本` 处理；
- 公司自定义路由必须放在原订阅规则前，并过滤完全相同的重复规则；家庭版不得注入或重排路由；
- 共享源保留 `10.0.0.0/8` 进入 TUN，再由规则转送给「🏢 公司内网」代理，不要把它重新加入
  `route-exclude-address`；家庭版保持原订阅的 TUN 排除列表不变；
- 修改后对脚本执行 `node --check`，并在 Clash Verge Rev 中确认扩展后的 DNS policy、Fake-IP
  filter 和规则顺序。扩展脚本变更不需要更新 SublinkPro 模板，但客户端必须重新应用对应脚本。

渲染注入依赖共享源末尾的 wrapper 与 `switch-macos-proxy-mode.mjs` 中的常量逐字节一致
（`function main(config) {\n  return macosProxyConfig(config);\n}`）。改动该 wrapper 的缩进、
换行或行尾会让 `renderExtension()` 抛出 `Shared extension entry point is missing`。

### macOS Proxy / TUN 模式切换

不要在 Clash Verge 界面里单独切 TUN，也不要手工改 `clash-verge.yaml`。Clash 模式、系统代理、
DNS、corp172 出口和代理环境变量由 `scripts/switch-macos-proxy-mode.mjs` 统一管理，通过
`~/.zshrc` 中手工维护的 `proxy-mode` 包装函数调用。需要 macOS 与 Node.js 24 以上。

```bash
proxy-mode proxy             # 系统代理，并装载代理环境变量
proxy-mode tun               # TUN，并把环境变量清回基线
proxy-mode status            # 期望配置和实际运行状态
proxy-mode rollback          # 最近一次成功切换前的状态
proxy-mode proxy --dry-run   # 只读预览
```

代理环境变量分三层：

- **launchctl 层**：Proxy 模式写入九个键（`NODE_USE_ENV_PROXY`、`HTTP_PROXY`、`HTTPS_PROXY`、
  `ALL_PROXY`、`NO_PROXY` 及五个小写变体）。注意脚本用的是不带域限定的 `launchctl setenv`，
  它只写入 **`user/<uid>` 域**，`gui/<uid>` 域不受影响。从 Dock / Spotlight / Finder 启动的
  GUI 应用（Ghostty、iTerm、VS Code 等）属于 GUI 域，**拿不到这些变量**，它们内部启动的
  所有进程也继承不到。`launchctl print user/$(id -u)` 能看到变量而 `gui/$(id -u)` 看不到，
  这是正常现象，不是写入失败；域内写入也不回溯已启动的进程。
- **shell 启动层**：`.zshrc` 末尾在 **Proxy 模式**下 `eval "$(proxy-mode shell-env)"`，让每个
  新 shell 自己带上变量，从而绕开上述 GUI 域隔离。该调用只存在于 `# BEGIN proxy-routing
  shell-env` 受管块内；块里用 `$+functions[proxy-mode]` 判断包装函数是否已定义，**不要改成
  `command proxy-mode`**——`command` 会跳过 shell 函数而去找同名二进制，变量不会被注入；
- **当前 shell 层**：包装函数在切换成功后 `eval` 一次 `shell-env`，同步这个已开的 shell。

`.zshrc` 的启动注入由脚本写在 `# BEGIN proxy-routing proxy-mode` 受管块内，**只在 Proxy 模式
存在**：切到 TUN 时脚本会删掉那段 eval 再恢复原块，TUN 模式下 shell 保持干净。手工删掉或改坏
这段会被下一次 `proxy-mode proxy` 重新写回；要永久关闭启动注入，请在脚本里改，不要只改 `.zshrc`。

Shell 层的来源仍是 `launchctl getenv`（`shell-env` 回读），所以 `.zshrc` 注入也依赖 launchctl
里的值存在。若 shell 里仍没有代理变量，先确认 `proxy-mode status` 显示 Proxy 模式且
`environmentDrift` 为假。手工排障可用只作用于当前 shell 的 `proxy_on` / `proxy_off`，
它们从不触碰 launchctl。

其他约束：

- `baselineEnv` 只在首次接管时捕获一次并持久化；反复 proxy↔tun 都恢复到同一份基线。接管后手工
  改这九个键会在下次 `tun` 被覆盖，`status` 以 `environmentDrift` 提示，重跑 `proxy-mode` 可在
  不重启 Clash 的前提下就地修复；
- `NO_PROXY` 里的 Tailnet peer 必须**逐个枚举 IP**：Node 只认精确 IP 字面量和 `*`，**不认 CIDR**。
  peer 变动后重跑 `proxy-mode proxy` 刷新；
- 需要 `/etc/resolver/<MagicDNSSuffix>` 分域 resolver 存在（`nameserver 100.100.100.100`），缺失时
  `prepare()` 直接拒绝；两种模式均保持 Tailscale `accept-dns=false`；
- 环境变量在健康检查通过之后才写入，写入失败同样落入回滚；切换失败会自动恢复操作前的文件、
  运行时、环境变量与策略组选择；
- 状态目录 `~/Library/Application Support/proxy-routing/macos-mode/`（目录 700、文件 600）含
  `state.json`、事务锁和 `backups/*/snapshot.json`。**快照含节点与订阅信息，不得提交或分享。**

**系统代理与全局环境变量都无法覆盖所有软件**：父进程固定或清空子进程环境（例如 CUA 启动清单
里 `env_vars=[]`）时，子进程拿不到这些变量，只能靠 TUN 兜住；Chrome 整条控制链路必须单独实际
验收，`status` 的 `chromeEndToEndVerified` 恒为 false，表示脚本不自行宣称已验收。完整行为、
验收记录与设计取舍见 `docs/macos-tun-tailscale.md`。

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

  # 🛡️ 防误杀白名单（必须在广告拦截前）
  - RULE-SET,unban,DIRECT

  # 🛑 广告拦截
  - GEOSITE,category-ads-all,REJECT

  # 📥 BT/P2P 下载防封直连
  - RULE-SET,download,DIRECT

  # 🪟 Windows / Microsoft Update（DO 控制面与 WinHTTP 默认直连）
  - RULE-SET,windows-update,DIRECT

  # ⬇️ 大流量规则（必须在 Google 前，避免 googlevideo.com 被 Google 规则提前匹配）
  - RULE-SET,traffic-heavy,⬇️ 大流量

  # Google & Gemini
  - RULE-SET,google,Google

  # 🤖 AI 服务（需高质量 IP 或指定区域，独立切换）
  - RULE-SET,ai,🤖 AI

  # Ⓜ️ Bing / Microsoft 365 / 账号（Copilot 优先命中 AI，其余走节点选择）
  - RULE-SET,microsoft,🚀 节点选择

  # 📦 GitHub 规则
  - RULE-SET,github,🚀 节点选择

  # ✈️ Telegram 规则
  - RULE-SET,telegram,🚀 节点选择

  # 🏦 银行网站直连
  - RULE-SET,bank,DIRECT

  # ✈️ 海外机酒预订直连
  - RULE-SET,travel-direct,DIRECT

  # 🍎 Apple 核心与认证服务直连
  - RULE-SET,apple,DIRECT

  # 🇯🇵 DMM / FANZA（远端 list，避免依赖 geosite:dmm）
  - RULE-SET,dmm,🇯🇵 日本

  # 🎯 额外直连
  - RULE-SET,direct,DIRECT

  # 🌐 代理补充
  - RULE-SET,proxy,🚀 节点选择

  # 其余国内流量直连（通常使用 geosite / geoip 底座）
  - GEOSITE,cn,DIRECT
  - GEOSITE,geolocation-!cn,🚀 节点选择
  - GEOIP,CN,DIRECT

  # 兜底代理
  - MATCH,🚀 节点选择
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

Shadowrocket 2.2.89 及以上版本需要让代理和 Tailscale 共用 iOS 唯一的系统 VPN 时，使用
`templates/shadowrocket-tailscale.conf`，并在应用的 `设置 > Tailscale` 中启用内置全局隧道。
Tailnet 的 `*.ts.net`、`100.64.0.0/10` 和 `fd7a:115c:a1e0::/48` 必须使用 `TAILSCALE`
策略，并排在 `private` 前。不得把 `100.64.0.0/10` 放入 `tun-excluded-routes`；subnet router
网段也必须在 `private` 前显式路由到 `TAILSCALE`。完整说明见
`docs/shadowrocket-tailscale.md`。

### 示例配置

```text
[Rule]
# 私有地址直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/private.list,DIRECT
# 防误杀白名单（必须在广告拦截前）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/unban.list,DIRECT
# 广告拦截
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list,REJECT
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list,REJECT
# BT/P2P 下载防封
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/download.list,DIRECT
# Windows / Microsoft Update（DO / WinHTTP 默认直连）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/windows-update.list,DIRECT
# 大流量（必须在 Google 前，避免 googlevideo.com 被 Google 规则提前匹配）
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/traffic-heavy.list,⬇️ 大流量
# Google / Gemini
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/google.list,Google
# AI 平台
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/ai.list,🤖 AI
# Bing / Microsoft 365 / GitHub / Telegram 全部归入 🚀 节点选择
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/microsoft.list,🚀 节点选择
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/github.list,🚀 节点选择
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/telegram.list,🚀 节点选择
# 银行 / 机酒出行 / Apple 核心服务直连
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/bank.list,DIRECT
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/travel-direct.list,DIRECT
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/apple.list,DIRECT
# DMM / FANZA
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/dmm.list,🇯🇵 日本
# 额外直连 / 代理
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/direct.list,DIRECT
RULE-SET,https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/proxy.list,🚀 节点选择
# 中国域名直连
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list,DIRECT

# 兜底
GEOIP,CN,DIRECT
FINAL,🚀 节点选择
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

本仓库使用 `node scripts/build-sing-box-rule-sets.mjs` 将现有 `.list` 自动转换为
`rules/sing-box/*.json` source rule-set。Android SFA 需要让代理和 Tailscale 共用一个系统 VPN
时，使用 `node scripts/build-sfa-config.mjs` 从 SublinkPro 读取当前 VLESS / Hysteria2 节点，
生成被 Git 忽略的 `dist/sfa-tailscale.json`。

该配置要求 SFA / Sing-box 1.14.0 或更高版本，并使用内置 Tailscale endpoint、MagicDNS、
现有规则分类和 SagerNet GeoSite / GeoIP rule-set。完整生成、导入和 subnet route 配置见
`docs/sfa-tailscale.md`。生成结果包含节点凭据，不得提交或公开分享。

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
