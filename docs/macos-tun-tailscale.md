# macOS Proxy／TUN 模式切换

使用 proxy-mode 管理整套设置：Clash 模式、系统代理、DNS 和 corp172
出口。不要仅在 Clash Verge 界面中切换 TUN，否则配套设置不会同步。

## 使用

新终端可直接执行；已有终端先 source ~/.zshrc 加载包装函数：

    proxy-mode proxy             # 系统代理，并装载代理环境变量
    proxy-mode tun               # TUN，并把环境变量清回基线
    proxy-mode status            # 期望配置和实际运行状态
    proxy-mode rollback          # 最近一次成功切换前的状态
    proxy-mode proxy --dry-run   # 只读预览（含将变更的环境键）
    proxy-mode status --json     # 机器可读输出

包装函数在切换成功且非 --dry-run 后 eval 一次 shell-env，把结果同步进当前
shell。proxy_on / proxy_off 只作用于当前 shell，保留为手动排障工具，从不
触碰 launchctl；zsh 启动不自动导出代理变量。

底层入口是 scripts/switch-macos-proxy-mode.mjs，需要 Node.js 24 或更高版本及
项目已有的 yaml 依赖。

## 模式行为

| 设置 | Proxy | TUN |
| --- | --- | --- |
| Clash 模式 | Rule | Rule |
| TUN | 关闭 | 开启，保留 gVisor／自动路由 |
| 系统代理 | 当前 mixed-port | 关闭 |
| 代理环境变量 | 装载 mixed-port | 清除回基线 |
| 网络 DNS | Verge 恢复原网络 DNS | Verge 占位 DNS，TUN 劫持 |
| corp172 接口 | 移除绑定，走系统路由 | 从实际 Tailnet 路由动态读取 |
| MagicDNS | 保留分域 resolver | 保留分域 resolver |

两层管理：launchctl 全局层管「之后新启动的进程」，包装函数的 shell-env 管
「当前这个已开的 shell」。launchctl setenv 不回溯，所以两层都必要，而不是
二选一。shell-env 回读 launchctl 而非重算，因此当前 shell 的变量恒等于此刻
新开一个终端会继承到的值。

status 的 environmentManaged 为真表示当前 launchctl 与期望目标一致，
environmentDrift 为真表示漂移（重跑本命令可在不重启 Clash 的前提下修复）。

Proxy 模式的 Node 健康检查仍用独立诊断子进程；与旧版的区别是成功切换后同一
组变量也会写入 launchctl。健康检查本身只验证代理可达性，不代表 Codex 控制
进程已使用代理。系统代理不能覆盖所有软件；Chrome 控制必须单独实际验收。

## 共享订阅扩展

scripts/clash-verge-rev-macos-tun-dns.js 是 Proxy/TUN 共享源。切换脚本向当前订阅
扩展注入模式参数，再让 Verge 重新生成配置，不直接编辑 clash-verge.yaml。
通用自适应版、家庭版、SublinkPro 模板均不改变。

公网使用加密 DNS；ChatGPT 经节点选择查询 Cloudflare／Google DoH。
节点解析及 DIRECT 重解析不递归使用 system，自有域名保留原直连分流。

公司域名（包含 dongfu1.com）交给 corp172-proxy SOCKS5 远端解析和出站，不添加
本机公司 DNS policy。TUN 使用 Fake-IP；Proxy 的 HTTP CONNECT 保留域名交给
公司规则。10.0.0.0/8 公司规则保留。

TUN 排除 100.64.0.0/10、fd7a:115c:a1e0::/48。普通 Tailnet 访问绕过 Clash，
但 Mihomo 自己的出站仍可能绑定物理出口。因此 corp172 接口从 route -n get
<corp172-server> 动态取得，不写死 utun5。Tailscale 重建接口后再次执行
proxy-mode tun 可刷新绑定。Proxy 模式已验证无需此绑定。

## MagicDNS 和 DNS 恢复

两种模式均保持本机 accept-dns=false。Tailnet 全局 MagicDNS 和已有 ts.net
split DNS 不变。脚本要求已有 /etc/resolver/tail945737.ts.net：

    domain tail945737.ts.net
    nameserver 100.100.100.100
    timeout 3

Clash 保留 ts.net policy 和 Fake-IP 排除；完整设备域名返回真实 Tailnet 地址。
分域 resolver 不自动添加短名称搜索域，公司搜索域保留原网络配置。

不手工把系统 DNS 指向 Clash，不增加 DNS listener。Verge 2.5.8 在 TUN + DNS +
Fake-IP 生效时自动设置 114.114.114.114 占位 DNS；关闭 TUN 后恢复原值。
脚本检查实际覆写／恢复结果。Proxy 模式的系统公网 DNS 仍可能异常，但代理保留
域名建立连接；公网直连失败不等同于 Proxy 模式失败。

## 事务与回滚

切换先加锁、备份、生成候选并通过 Mihomo 校验，再请求 Clash 正常退出。
退出受阻则停止，不强杀。退出后原子更新配置，启动 Clash、恢复策略组选择并验收。
保留其他订阅设置、主题等无关字段。

重复执行相同模式且状态一致时不重启 Clash，只检查状态和网络；环境变量漂移
也在这条路径上就地修复。
候选校验失败不改变运行配置；切换或健康检查失败自动恢复操作之前的状态。
失败记录脱敏。

环境变量在 verify 通过之后才写入，因此只有代理确实可用时才会对外安装全局
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

## 不开 TUN 的按进程代理候选（尚未在本机验收）

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

### 2026-10-16：代理环境变量管理重新启用

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
- 风险：全局代理会作用于所有之后启动的 GUI/CLI；NO_PROXY 超长（40+ peer）在
  个别工具上可能解析异常；接管后用户手动改这九个键，下次 tun 会覆盖，status
  会以 environmentDrift 提示。
