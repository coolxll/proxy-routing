# macOS Proxy／TUN 模式切换

使用 proxy-mode 管理整套设置：Clash 模式、系统代理、DNS 和公司策略。
公司出口通过 [按需 SSH 隧道](./corp-ssh-tunnel.md) 启停；默认 DIRECT。
不要仅在 Clash Verge 界面中切换 TUN，否则配套设置不会同步。

## 使用

新终端可直接执行；已有终端先 source ~/.zshrc 加载包装函数：

    proxy-mode proxy             # 系统代理，并装载代理环境变量
    sudo -v                      # TUN 写系统 DNS 前授权，可用 Touch ID
    proxy-mode tun               # TUN，并把环境变量清回基线
    proxy-mode status            # 期望配置和实际运行状态
    proxy-mode rollback          # 最近一次成功切换前的状态
    proxy-mode proxy --dry-run   # 只读预览（含将变更的环境键）
    proxy-mode status --json     # 机器可读输出

包装函数在切换成功且非 --dry-run 后 eval 一次 shell-env，把结果同步进当前
shell。proxy_on / proxy_off 只作用于当前 shell，保留为手动排障工具，从不
触碰 launchctl。

新 shell 由 ~/.zshenv 末端的受管块加载（2026-11-18 从 .zshrc 迁来，以便登
录 shell、脚本和 IDE 拉起的 `agy` 也能拿到代理）：块内直接调用切换脚本并把结果
缓存在 `~/.cache/proxy-routing/shell-env.sh`，仅在 state.json 变化后重生成。
shell-env 只读持久化的 state.json，Proxy 模式输出 proxyEnv，TUN 模式输出
baselineEnv 的 export/unset，清理继承来的代理残留。未接管时输出为空，保留调用
者原有环境。此路径不依赖 launchctl、登录任务或网络。

`.zshenv` 在 `~/.zshrc` 定义 `proxy-mode` 之前执行，所以受管块内不调用该函数，
而是直接执行切换脚本，并缓存结果：

    if [[ -r "$HOME/workspace/projects/proxy-routing/scripts/switch-macos-proxy-mode.mjs" ]]; then
      ... # 仅在 ~/.cache/proxy-routing/shell-env.sh 缺失或 state.json 更新时重生成
      [[ -s "$_pr_cache" ]] && source "$_pr_cache"
    fi

缓存让稳态启动不 spawn Node（实测 0.00s），切换模式后才重生成一次（实测 0.08s）。
`node` 在 `.zshenv` 阶段可能还不在 PATH（nvm 在 `.zshrc` 才加载），块内按
`$commands[node]` → `~/.nvm/versions/node/*/bin/node` → Homebrew → `/usr/local`
的顺序探测。

手工使用时仍须直接写 `proxy-mode <子命令>`：写成 `command proxy-mode` 会绕过 shell
函数去找二进制，eval 拿到空输出，变量静默缺失。

底层入口是 scripts/switch-macos-proxy-mode.mjs，需要 Node.js 24 或更高版本及
项目已有的 yaml 依赖。

## 模式行为

| 设置 | Proxy | TUN |
| --- | --- | --- |
| Clash 模式 | Rule | Rule |
| TUN | 关闭 | 开启，保留 gVisor／自动路由 |
| 系统代理 | 当前 mixed-port | 关闭 |
| 代理环境变量 | 装载 mixed-port | 清除回基线 |
| 网络 DNS | 保留已有本地 DNS 或由 Verge 恢复原值 | 启动后设为 127.0.0.1，直接查询 Mihomo |
| 公司代理入口 | DIRECT、原 Tailnet SOCKS、本地按需 SSH 三项 | SSH 不绑定网卡；仅旧 Tailnet 选项动态绑定接口 |
| MagicDNS | 保留分域 resolver | 保留分域 resolver |

环境变量只在 shell 内管理：state.json 保存模式和目标值，.zshenv 在启动时加载；
已有 shell 由 proxy-mode 包装函数在命令成功后同步。一个终端切换模式不会回溯
修改其他已打开的终端，它们可执行 `eval "$(proxy-mode shell-env)"` 同步。

status 的 environmentSource 为 state.json，environmentManaged 表示有已接管的
模式记录；shellEnvironmentMatches 比较命令继承到的环境与保存值，直接运行底层
脚本时它可能在包装函数同步之前为 false。状态输出不会再把 launchctl 清空报为漂移。

Node 健康检查用独立诊断子进程验证代理可达性，不代表 Codex 控制进程已使用代理。
系统代理不能覆盖所有软件；Chrome 控制必须单独实际验收。

## 共享订阅扩展

scripts/clash-verge-rev-macos-tun-dns.js 是 Proxy/TUN 共享源。切换脚本向当前订阅
扩展注入模式参数，再让 Verge 重新生成配置，不直接编辑 clash-verge.yaml。
通用自适应版、家庭版、SublinkPro 模板均不改变。

公网使用加密 DNS；ChatGPT 经节点选择查询 Cloudflare／Google DoH。
节点解析及 DIRECT 重解析不递归使用 system，自有域名保留原直连分流。

公司域名（包含 dongfu1.com）保留 TUN Fake-IP，选择 SSH 公司节点时由远端解析和出站；
选择 DIRECT 时使用普通 DNS 配置，不设置公司域名专用解析器。10.0.0.0/8 的公司策略组规则保留。
Proxy 的 HTTP CONNECT 保留域名交给公司规则。

TUN 排除 100.64.0.0/10、fd7a:115c:a1e0::/48，普通 Tailnet 访问绕过 Clash。
公司按需 SSH 节点为 `corp172-ssh`（`127.0.0.1:11080`），`corp-tunnel on` 选择它，
`off` 恢复 DIRECT 后停止 SSH。这条路径不绑定 Tailnet 接口。原 `corp172-proxy`
仍保留 `100.93.132.98:1080`，可手动选择；TUN 下只有它动态绑定 Tailnet 接口。
首次迁移旧远端节点时默认切 DIRECT，之后模式切换保留用户的公司组选择。
公司域名不再配置公司 DNS 策略或 DNS 服务器 IP 例外；SOCKS 出口在远端解析域名。

## MagicDNS 和 DNS 恢复

两种模式均保持本机 accept-dns=false。Tailnet 全局 MagicDNS 和已有 ts.net
split DNS 不变。脚本要求已有 /etc/resolver/tail945737.ts.net：

    domain tail945737.ts.net
    nameserver 100.100.100.100
    timeout 3

Clash 保留 ts.net policy 和 Fake-IP 排除；完整设备域名返回真实 Tailnet 地址。
分域 resolver 不自动添加短名称搜索域，公司搜索域保留原网络配置。

两种模式都监听 `127.0.0.1:53`（UDP/TCP），复用现有加密 DNS；Proxy 返回真实 IP，
TUN 返回 Fake-IP（Tailnet 等过滤项返回真实地址）。内部 DNS 不使用 system，避免回环。
TUN 切换在启动后将当前活动网络的 DNS 设为 `127.0.0.1` 并清理系统缓存；需要先在
同一终端执行 `sudo -v`。授权缺失会在退出 Clash 前停止。这样 macOS 绑定物理接口的
scoped DNS 查询也不会直接访问公司/局域网 DNS。不要启用 Verge DNS 覆写，以免覆盖
共享扩展的 MagicDNS、Fake-IP 过滤与上游设置。
Proxy 模式不主动修改网络 DNS；需要时可用下文 `macos-dns.mjs local` 接入本地监听。
本机 `tail945737.ts.net` 分域 resolver 保留，公司访问继续由代理跳板远端解析，
不额外安装公司 resolver；绕过代理的公司内网域名解析不在此方案保证范围。

Clash 必须持续运行，否则普通 DNS 查询不可用。退出 Clash 或撤销本机 DNS 接入前，
执行 `networksetup -setdnsservers Wi-Fi Empty` 恢复 DHCP（服务名按实际网络）。
酒店等需要网页认证的网络，可在仓库根目录使用：

```bash
sudo node scripts/macos-dns.mjs dhcp    # 登录前恢复当前网络的 DHCP DNS
sudo node scripts/macos-dns.mjs local   # 登录后恢复 Clash DNS，先检查本机解析服务
node scripts/macos-dns.mjs status       # 查看当前网络服务的 DNS
```

省略网络服务名时自动选择当前活动服务，也可在命令末尾指定 `Wi-Fi` 或带引号的
`"USB 10/100/1000 LAN"`。切换后清理 DNS 缓存；写入或检查失败时恢复操作前的 DNS。
命令只管理 DNS，不修改代理、launchctl、Shell、Tailnet resolver 或 Clash 配置。
若系统代理影响认证页，需临时关闭系统代理，登录完成后恢复；终端中的代理环境变量
也不会被此命令清除。不要用 sudo 运行完整的 `proxy-mode` 切换脚本。

验收使用 `dig @127.0.0.1 <公网域名>` 和系统解析接口；Tailnet 分域解析使用
`dscacheutil -q host -a name corp172-dev.tail945737.ts.net`，应为 `100.93.132.98`。

Verge 2.5.10 在 TUN + DNS + Fake-IP 生效时仍会自动设置 `114.114.114.114` 占位 DNS；
切换脚本在启动后改回本地监听并校验。回滚会恢复快照中的原网络 DNS。GUI 重载或单独
切 TUN 可能再次改写系统 DNS，使用 `proxy-mode tun` 重新同步整套配置。

## 事务与回滚

切换先加锁、备份、生成候选并通过 Mihomo 校验，再请求 Clash 正常退出。
退出受阻则停止，不强杀。退出后原子更新配置，启动 Clash、恢复策略组选择并验收。
保留其他订阅设置、主题等无关字段。

重复执行相同模式且状态一致时不重启 Clash，只检查状态和网络，并刷新保存的
环境变量与 shell 启动块。
候选校验失败不改变运行配置；切换或健康检查失败自动恢复操作之前的状态。
失败记录脱敏。

环境变量目标在 verify 通过之后才保存，因此只有代理确实可用时才会供 shell 加载
代理变量；写入失败同样落入回滚范围。

状态目录为 ~/Library/Application Support/proxy-routing/macos-mode/，
包含 state.json、事务锁和 backups/*/snapshot.json。备份含节点／订阅信息：
目录权限 700，文件权限 600，不提交或分享。rollback 恢复文件、代理环境变量、
Tailscale DNS 偏好及策略组选择。没有 env 字段的早期快照会跳过环境恢复，
不会因为旧快照而失败。

## 2026-10-14 验收记录

- 初版 9 项本地测试通过：新节点注入、环境绕过、dry-run、模式往返／幂等、校验和退出
  失败、健康检查失败自动回滚、手动回滚、并发拒绝、应用停止／运行时偏差修复。
- 实际完成 TUN → Proxy → TUN，重复 TUN 不重启，手动回滚恢复 Proxy。
- 两种模式的 GitHub、Spug HTTPS 200；ChatGPT 完成 TLS／HTTP，原生 Node fetch
  正常，MagicDNS 和普通 Tailnet SSH 正常。Proxy 模式经 Mihomo 的 Tailnet
  CONNECT 正常且不绑定接口。HTTP 403 仅作为 TLS／HTTP 到达证据。
- 用户重启后实测 Chrome nameSession 仍超时；扩展和 Native Host 检查正常。
  主应用有代理变量，但 cua_repl 启动清单 env_vars=[]，控制子进程未收到代理环境。
  Chrome 整条链路未通过，不能将显式代理 Node 请求成功作为浏览器验收。
- launchctl 的九个代理变量已按首次快照恢复为空。当时的版本两种模式及 rollback 均不
  管理环境变量；新增禁止调用环境 setter 的回归测试，10 项测试通过。
  （该决定已于 2026-10-16 反转，见下文对应小节。）
- 不更新 SublinkPro、路由器、远端订阅或 Tailnet 全局配置。

2026-10-13 的初始诊断确认：TUN 自动出口曾把 corp172 连接绑定到 en0，固定 utun5
可以恢复公司访问；本次将该手工处理纳入切换命令，并在 TUN 模式下动态发现接口。

## 不开 TUN 的按进程代理候选

> **状态（2026-11-12 更新）**：本节候选已在 Gemini Desktop 上完成首次真实验收 ——
> 规则为 `Applications=Gemini; GeminiAppLauncher; crashpad_handler`，
> `Targets=*`、`Ports=443;80`，经 `HTTP 127.0.0.1:7897` 出站，直连归零。详见
> 本文 2026-11-12 小节「现象二」。下文关于按名匹配、无法做路径隔离的约束仍然成立，
> 因此验收范围限于「同一台机器上只有一份该应用」的场景。

Proxifier macOS 官方规则按可执行文件名匹配，不按完整路径限定。
v3 的 Working with Proxifier 文档目前指向 v2 文档；不能声称路径隔离已受支持。

- 官方规则说明：https://www.proxifier.com/docs/mac-v2/rules.htm
- v3 文档指引：https://www.proxifier.com/docs/mac-v3/working.html
- 类似 cua_repl 环境问题的用户报告：https://github.com/openai/codex/issues/42454

候选规则为 Applications=node;node_repl，Targets=chatgpt.com;*.chatgpt.com，
经 SOCKS5 127.0.0.1:<mixed-port> 出站并使用代理 DNS。保留 Localhost 直连规则和
默认 Direct；Clash 本身不纳入代理。目标域名需根据真实连接日志补充，规则仍会
影响其他同名 Node 进程访问这些目标，不能做到仅匹配 app 内的完整路径。

这不是已验证的 Chrome 修复；未安装 Proxifier、未修改其规则或 Codex 插件。
官方仓库 issue 属于用户复现报告，临时 launcher 方案依赖内部实现，不是官方保证。

## 2026-10-14 CUA 专用代理实验（等待完整验收）

已在本项目被 Git 忽略的 .codex/config.toml 配置 cua_repl 专用启动器。
~/.local/libexec/codex-cua-proxy.mjs 是 scripts/codex-cua-proxy-launcher.mjs 的链接。
启动器从当前插件元数据动态读取传输命令、参数、环境，保留 trusted services 和
工具策略；仅向 CUA 后端注入当前 mixed-port 的代理变量及其环境白名单。
不修改 App、插件缓存、全局 launchctl、DNS、浏览器数据或安全设置。

验证：bundled CLI 的 mcp get 返回专用启动器；独立 MCP initialize/tools-list
成功；实际原生 node_repl 子进程收到 NODE_USE_ENV_PROXY、HTTP_PROXY、HTTPS_PROXY。
Proxifier 已退出并选择不继续后台处理。上述检查不等于实际 Chrome 页面控制成功。
需要用户完全退出重开 Codex、回到本项目，核对 live CUA 启动路径后再验收页面操作。
桌面生成配置是否覆盖项目设置仍待验证。

回滚命令：node /Users/lynn/workspace/projects/proxy-routing/dist/rollback-cua-proxy.mjs
脚本只删除原样的本项目实验配置和指向本项目的启动器链接；若配置已被其他操作改变，
会停止并要求人工合并，不覆盖其他设置。随后手动重启 Codex。

### 重启后的实际 Chrome 验收：通过

2026-10-14，用户完全退出并重新打开 Codex 后，本项目配置生效。
当前 CUA launcher 和其原生 node_repl 子进程均收到 NODE_USE_ENV_PROXY=1、
HTTP_PROXY、HTTPS_PROXY；Proxifier 主进程未运行，之前已选择停止后台处理。
Clash 实际模式为 Proxy，TUN 关闭，系统代理开启；launchctl 的 NODE_USE_ENV_PROXY
仍为空，仅 CUA 控制进程使用专用代理环境。

实际通过 CUA Chrome API 新建标签，导航已登录的 GitHub 首页并读取 DOM，再导航
https://github.com/openai/codex 并读取仓库页面。此为真实浏览器控制验收，非 HTTP 403
推断。未增加本地 DNS 监听或 chatgpt.com resolver，未修改 Tailnet 全局 DNS。
修复当前仅覆盖本项目的 .codex/config.toml；其他项目尚未安装或验证。
模式脚本中的 chromeEndToEndVerified 固定 false，表示该脚本不自行执行 Chrome
验收；本节记录的是人工触发的独立实际验收结果，不代表未来更新后的持续保证。

## 用户级迁移（2026-10-14，待重启持久性验收）

按用户要求，将已验证的项目方案迁到 ~/.codex/config.toml 的 cua_repl 表，标记为
BEGIN/END codex-cua-proxy。项目 .codex/config.toml 实验文件已移除，因此其他项目
和项目外 CLI 都能读取用户级默认设置；更高优先级的项目或 CLI 配置仍可覆盖。
启动器 ~/.local/libexec/codex-cua-proxy.mjs 改为独立普通文件，仅使用 Node 内建模块，
不再通过 symlink 引用仓库、yaml 依赖或模式切换脚本。仓库保留源代码供维护。
Tailscale 地址发现变为可选，未安装或未运行 Tailscale 不阻止 CUA 启动。

官方建议用用户级配置提供个人默认值：
https://learn.chatgpt.com/docs/config-file/config-basic
社区指出 Desktop 可能重写受管 CUA 的用户配置：
https://github.com/openai/codex/issues/42454
因此本方案仍是临时 workaround；不宣称产品官方支持或跨更新永久生效，不添加
配置 watcher、后台守护任务，不修改生成插件、App、权限或证书校验。

验证：从项目外的临时目录运行 bundled CLI mcp get cua_repl，读取到全局启动器；
通过该配置启动独立 MCP，initialize/tools-list 正常，原生后端收到代理变量。
独立启动器 --check 与仓库 validate 均通过。尚需用户完全退出重开桌面 App 后
确认全局块未被覆盖、live CUA 后端继承代理，并实际完成 Chrome 页面读取。

备份位置：~/.codex/backups/cua-proxy-global-20261014-104410，目录 700、文件 600。
回滚命令仍为 node /Users/lynn/workspace/projects/proxy-routing/dist/rollback-cua-proxy.mjs。
现版回滚只移除原样的全局实验块，保留其他用户配置修改，并恢复此前已验证的
项目配置和链接；若配置或启动器发生额外变化，会停止并要求合并。

### 用户级重启验收失败，准备系统配置 fallback

用户重启后，~/.codex/config.toml 的 CUA 实验块被 Desktop 删除；新控制进程未收到
代理变量，本聊天也未暴露 cua_repl 工具。此前项目级方案成功，但用户级迁移不持久。
不反复写入受管用户块，不恢复 launchctl，不重新启用 Proxifier/TUN。

已准备 scripts/install-codex-cua-system-proxy.mjs。它安装独立启动器到
/usr/local/libexec/codex-cua-proxy.mjs，并仅在 /etc/codex/config.toml 合并 CUA 配置。
系统默认配置可由其他本机账号读取，但代理注入仅在 SUDO_UID 对应账号启用；
其他账号保留其原插件声明的环境。安装前保存 root-only 回滚记录；项目外 CLI
配置选择验证失败会恢复原文件。现阶段仅通过语法与仓库检查，尚未实际安装。

本机 sudo 需要密码，因此需要用户执行：
    sudo /Users/lynn/workspace/projects/proxy-routing/scripts/install-codex-cua-system-proxy.mjs
然后完全退出重开 Codex，再检查实际控制进程和 Chrome 页面。
回滚：
    sudo /Users/lynn/workspace/projects/proxy-routing/scripts/install-codex-cua-system-proxy.mjs --rollback
安装器保留无关系统配置；若 CUA 块或启动器后来被修改，回滚会停止要求合并。

### 系统级重启与 Chrome 实际验收：通过

2026-10-14，用户安装系统配置并完全退出重开 Codex 后：
- /etc/codex/config.toml 的 CUA 块保留，实际 transport 指向
  /usr/local/libexec/codex-cua-proxy.mjs；项目覆盖仍不存在。
- 新 launcher 和原生 node_repl 后端收到 NODE_USE_ENV_PROXY=1、HTTP_PROXY、HTTPS_PROXY。
- 实际创建 Chrome 标签、导航已登录 GitHub 首页并读取 DOM，再导航
  https://github.com/openai/codex 并读取仓库页面，均成功。
- Proxifier 未运行，Clash TUN 关闭、系统代理开启；launchctl NODE_USE_ENV_PROXY 为空。
- 从 /private/tmp 读取 cua_repl 配置也选择系统启动器，配置不依赖本项目。

当前生效位置为 /etc/codex/config.toml 和 /usr/local/libexec/codex-cua-proxy.mjs。
用户级 ~/.codex/config.toml 不需要重复的 CUA 实验块；本项目也不再需要覆盖。
系统默认对本机账号可见，代理注入限定 UID 501；更高优先级配置仍可覆盖默认。
本次已证明重启后生效，不保证未来产品升级不改变内部插件布局；升级后应重新
核对 --check、实际进程环境与页面读取。未修改 App、插件、TLS 或浏览器安全配置。

### 2026-10-16：代理环境变量管理重新启用（历史方案）

以下 launchctl 管理与 Proxy 专用启动块的记录已被 2026-11-13 的 shell 方案替代。

按用户要求恢复环境变量接管，并扩展为两层：launchctl 全局 + 包装函数同步
当前 shell。反转了 2026-10-14 那条「不管理环境变量」的决定。

- **范围**：Proxy 模式写入九个键（NODE_USE_ENV_PROXY、HTTP_PROXY、
  HTTPS_PROXY、ALL_PROXY、NO_PROXY 及五个小写变体）；TUN 模式清回基线。
- **基线语义**：baselineEnv 是脚本首次接管时用户的九个键原值，只捕获一次、
  持久化在 state.json、只要仍受管就不再重捕。反复 proxy↔tun 都恢复到同一份
  基线，用户的原有值不会被永久破坏。自捕获护栏：若首次接管时某键已等于我方
  将要写入的值（说明是上一轮残留），该键在基线里置 null，不当作「用户原值」。
- **NO_PROXY 逐 IP 枚举**：实测 Node 的 NO_PROXY 解析只认精确 IP 字面量和 *，
  **不认 CIDR**（100.64.0.0/10、/32、192.168.0.0/16 全部被无视）；主机名后缀
  匹配有效。因此 Tailnet peer 必须逐个列举，当前 46 项、846 字符。peer 变动后
  重跑 proxy-mode proxy 刷新。
- **写入时机**：环境变量在 verify 通过之后才写入，失败落入回滚；写入本身逐键
  应用并聚合报错，让 rollback 能做一次完整重放。
- **shell-env 子命令**：回读 launchctl 输出九行 export/unset 供包装函数 eval。
  因为 launchctl setenv 不回溯，这层存在的唯一理由是同步当前已开的 shell；
  回读而非重算保证当前 shell 恒等于此刻新开终端会继承到的值。
- **漂移修复**：重复切换同模式且文件/运行时一致时，若 launchctl 与期望不符，
  就地修复而不重启 Clash，返回 environmentRepaired=true。
- **rollback 语义反转**：现在会装回快照里的环境变量；没有 env 字段的早期快照
  跳过，不报错。旧文档「rollback 不装 env」不再成立。
- 实测通过：15 项本地测试；真实 proxy→tun→proxy 往返；TUN 清空九个键并重启
  Clash 完成全量健康检查；漂移检测与免重启修复（Clash PID 不变）；shell-env
  在 fresh zsh 中经包装函数 eval 生效；curl 200、node:http 经环境代理 301。
- CUA 链路不受影响：codex-cua-proxy-launcher.mjs 的 injectProxy 先无条件删除
  继承自父进程的代理键再写入自己的值，全局设置代理对它无害。
- 风险：NO_PROXY 超长（40+ peer）在个别工具上可能解析异常；接管后用户手动改
  这九个键，下次 tun 会覆盖，status 会以 environmentDrift 提示。
- launchctl 覆盖范围修正（2026-10-18）：此前文档称 launchctl 全局层作用于
  「之后启动的 GUI/CLI」，实测不成立——setenv 只进 user 域，GUI 域不可见，
  Ghostty 进程及其 herdr/zsh 子链均无代理变量。因此新增 .zshrc 受管块做
  Proxy 模式下的 shell 启动注入，TUN 模式移除，避免 TUN 下残留环境代理。

## 2026-11-18：受管块从 .zshrc 迁到 .zshenv

起因：Go 写的 CLI（`agy`、helm、terraform 等）不读 macOS 系统代理，只认
`HTTP(S)_PROXY` 环境变量。受管块原先只在 `~/.zshrc`，因此只有交互 shell 拿到代理；
登录 shell、脚本，以及 Antigravity IDE 后台拉起的 `agy` 都没有代理，直连 Google
时超时（agy 的 auth 预算 10 秒）后判定“未登录”，反复弹出登录页。

改动：

- 受管块迁到 `~/.zshenv`，标记改为 `# BEGIN proxy-routing shell-env (zshenv)`。
  `.zshenv` 被每个 zsh 进程读取，覆盖交互/登录/脚本/IDE 四种场景。
- 块内不再 `eval "$(proxy-mode shell-env)"`（函数此时未定义），改为直接调用
  切换脚本，并缓存到 `~/.cache/proxy-routing/shell-env.sh`；缓存仅在
  `state.json` 更新后重生成，避免每个 zsh 进程都 spawn Node。
- `ModeManager.zshenv` 取代旧的 `this.zshrc`；`renderZshenv` / `ZSHENV_BEGIN` /
  `ZSHENV_END` 取代 `renderZshrc` / `ZSHRC_BEGIN` / `ZSHRC_END`；快照、回滚、
  `assertShellHook` 与 `shellHookInstalled` 全部指向 `~/.zshenv`。

验证：`zsh -c`（非交互）、`zsh -l -c`（登录）、`zsh -i`（交互）三者拿到的代理键
完全一致；`zsh -c 'agy models'` 可直接列出模型；`node scripts/check-macos-proxy-mode.mjs`
27 项全通过。

## 2026-11-13：简化为 shell 直接加载持久化模式

重启后 launchctl 环境被清空，而旧版 shell-env 回读 launchctl，导致每个新终端
执行 unset。曾加过登录 LaunchAgent 重放作为补救；终端需求本身不需要这层。
最终方案为 `state.json → .zshrc / shell-env → CLI`（2026-11-18 起启动层迁到
`.zshenv`，见上一节），已卸载登录任务并移除
安装器与 env-sync 子命令。模式切换也不再写 launchctl。

- Proxy 模式从 state.proxyEnv 生成九个键；TUN 从 baselineEnv 生成 export/unset。
- 两种模式都保留启动块，避免 TUN 下新 shell 继承旧终端的代理变量。
- shell-env 只读磁盘，不要求 Clash、Tailscale 或网络在线。NO_PROXY 保留上次
  成功切换时的 peer 列表，peer 变化后重跑 proxy-mode proxy 刷新。
- 包装函数同步当前 shell，新终端自动读取；其他已打开的终端需手动同步。
- 回滚恢复持久化状态与启动块；旧快照里的 env 字段不再重放到 launchctl。

验证覆盖空环境启动 zsh 后加载 Proxy 变量、TUN 清理继承变量、回滚、基线保留与
未接管时不改环境。实机卸载 LaunchAgent、清理旧 launchctl 变量后，验证新交互
zsh 自动取得代理变量，并检查代理连通性。没有通过重启机器来验收。

## 2026-10-27：NO_PROXY 的 CIDR 与后缀支持实测

起因：agent-fleet 开发服务器改为只绑 Tailscale 接口后，命令行访问
`http://<tailnet-ip>:5173` 仍被 Clash 接管。排查发现 `~/.zshrc` 末尾仍调用
`proxy_on`，用一份手写的 `192.168.0.0/16,10.0.0.0/8,172.16.0.0/12` 列表覆盖了
受管块 eval 出来的 tailnet 感知列表。

同一份 NO_PROXY 在各客户端上的实测结果（2026-10-27，curl 8.7.1 / Node 24.14.1
undici / CPython 3.13 urllib，均以指向关闭端口的代理验证是否真的绕过）：

| NO_PROXY 条目 | curl | Node (undici) | Python (urllib) |
| :-- | :--: | :--: | :--: |
| 精确 IP `100.77.110.64` | ✅ | ✅ | ✅ |
| CIDR `100.64.0.0/10` | ✅ | ❌ | ❌ |
| 后缀 `tail945737.ts.net` | ✅ | ✅ | ❌ |
| 后缀 `.ts.net` | ✅ | ✅ | ❌ |
| 通配 `*.ts.net` | ❌ | ✅ | ❌ |

结论不变：**只有逐 peer 枚举 IP 才是全客户端通用的方案**；CIDR 只能兜住 curl，
Python 连 MagicDNS 后缀都不认。手写 CIDR 列表看着优雅，在这条链路上等于没写。

修复：

- 删除 `~/.zshrc` 末尾自动调用的 `proxy_on`。Proxy 模式的 shell 注入已经由
  受管 `BEGIN proxy-routing shell-env` 块负责，TUN 模式下该块被移除；末尾再调
  `proxy_on` 会在 TUN 模式重新注入代理变量，并把受管列表覆盖成过期 CIDR 列表。
- `proxy_on` 改为优先 eval `proxy-mode shell-env`（唯一事实来源），仅当
  proxy-routing 不可用时退回内置的 loopback + RFC1918 + `100.64.0.0/10` 列表，
  并在注释里写明该退回值只对 curl 有效。
- 手工验证：fresh `zsh -ic` 下把 `http_proxy` 指向关闭端口，curl、node fetch、
  python urllib 访问 tailnet 地址全部 200（即真的绕过代理）。

## 2026-11-12：TUN 排除表与 Tailscale underlay（已重构）

本节原来记录「TUN 排除表缺 10/8」与「Gemini Desktop 半代理」两条独立现象。其中
TUN 部分已整体重构为独立裁定文档：[`docs/tun-tailscale-decision.md`](./tun-tailscale-decision.md)。
那份文档已在结论复核后区分用户需求、历史观测、源码机制和候选方案，撤回了
“仅剩一条架构”“缺少端点排除必然回环”和按 DERP 地区直接判失败等结论。

**本节只保留原始现象记录**，以便对照当时观测：

```text
$ tailscale status
100.93.132.98  corp172-dev  active; offers exit node; direct 10.8.1.172:49322
100.80.11.110  df-k14       active; direct 10.55.26.45:41641
```

当时 `tun.route-exclude-address` 只有 `127.0.0.0/8`、`100.64.0.0/10`、
`172.16.0.0/12`、`192.168.0.0/16`、`fd7a:115c:a1e0::/48`，没有单列这些 underlay
端点。是否进入 `utun1024` 还取决于路由和 socket 绑定，本次未在 TUN 开启后验证。

初稿据此提出的「补 `route-exclude-address: 10.0.0.0/8`」**已被推翻**：10/8 在本仓库
是主动走公司代理的通道（`scripts/clash-verge-rev-macos-tun-dns.js:175`、`:190`，
`:203`、`:208` 还主动删除 10/8 排除项）。源码依据与候选方案见
[`docs/tun-tailscale-decision.md`](./tun-tailscale-decision.md) 第 4、5 节。


### 现象二：Gemini Desktop 只有部分请求遵循系统代理

`/Applications/Gemini.app`（`com.google.GeminiMacOS`，1.141.3.1394，arm64 thin，
Developer ID `EQHXZ8M8AV`，`flags=0x10000(runtime)`）在「系统代理指向 mixed-port、
TUN 关闭」的条件下：

    $ lsof -nP -i -a -c Gemini | grep -v 127.0.0.1
    Gemini  10.55.90.63:61759 -> 172.217.112.4:443  SYN_SENT
    Gemini  10.55.90.63:61760 -> 172.217.119.4:443  SYN_SENT
    （共 6 条）

同时有一条 `127.0.0.1:xxxxx -> 127.0.0.1:7897 ESTABLISHED`。即：一部分流量走了
系统代理，另一部分（`172.217.x.x:443`）直连被阻断并持续重试 —— 典型的半代理。

已落地（本机实测通过，2026-11-12）：Proxifier 3.15.0 for Mac，profile
`Gemini-2026-11-12`：

- Proxies：`127.0.0.1:7897`（mihomo mixed-port，UI 标为 HTTPS）。
- Proxification Rules：`Name=Gemini`，`Applications=Gemini; GeminiAppLauncher;
  crashpad_handler`，`Target hosts=*`，`Target ports=443; 80`，Action 指向上述代理，
  排在 Default 之前。
- Default 保持 Direct，其他 App 规则未改动。
- Name Resolution 直连列表加入 `127.0.0.1; localhost`（系统代理已指向 7897，
  避免回环）。

验收：重新启动 Gemini 后，直连 `SYN_SENT` 归零，4 条连接全部经
`127.0.0.1:7897`；Proxifier 日志显示 `Gemini -> www.googleapis.com:443` 经
`127.0.0.1:7897` 且已有收发流量。系统代理与 TUN 状态均未被改动。

与文档「不开 TUN 的按进程代理候选」一节的结论一致：Proxifier 按可执行文件名匹配，
不按完整路径。本机只有一份 Gemini 安装，暂不存在同名进程误伤；但
`crashpad_handler` 是通用名，若其他 Google App 也有同名进程，规则会一并命中。

待办 T2（零常驻方案，未开始）：目标是不依赖 Proxifier 常驻。候选是 DYLD 注入：
`Gemini.app` 带 hardened runtime（`flags=0x10000(runtime)`）、无 `__RESTRICT` 段。
这些信息不足以判定 DYLD 注入是否可用，还需核对 entitlements、library validation
和启动方式；不能断言必须去签名或重签后一定生效。若采用重签方案，代价包括：
每次 App 更新都要重做；可能丢失现有登录态/Keychain 项；重签后的 bundle 是否仍能通过
Google 侧校验未知。流程要求：先在 `~/Applications/Gemini-copy.app` 副本上验收
（注入后直连归零且能正常登录对话），通过后再决定是否动 `/Applications` 原件。
替代候选 hosts + 本地 `:443` SNI relay 需要一个小 root 常驻进程，不符合「零常驻」，
仅在 DYLD 不可行时考虑。

### 回滚

- Proxifier：删除 `Gemini` 规则并切回原 profile，或直接退出 Proxifier 后
  Gemini 恢复为半代理状态（不会更差，现象与 2026-11-12 之前一致）。
- TUN 相关：本次未做任何变更，无需回滚。

### 未验证声明

本节保留的 TUN 部分仅为静态观测（`tailscale status` 与路由表比对），没有在 TUN
开启状态下实测 `ssh corp172`、`tailscale ping` 路径或 Gemini 直连是否归零。
Gemini 部分的 Proxifier 规则已实测通过（`lsof` 直连归零、4 条连接经 `7897`）。
