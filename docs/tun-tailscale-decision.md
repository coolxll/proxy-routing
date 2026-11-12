# TUN 与 Tailscale 共存：后续决策与执行门槛

日期：2026-11-12。范围：本机 macOS / Verge 2.5.10 / 实际运行 Mihomo v1.19.33。

本文是 TUN 与 Tailscale 共存问题的裁定与执行门槛，取代
`docs/macos-tun-tailscale.md` 中 2026-11-12 小节「待办 T1」原文里
「补 `route-exclude-address: 10.0.0.0/8`」的建议：本机 10/8 是公司代理规则
（`scripts/clash-verge-rev-macos-tun-dns.js:175`、`:190`），全段排除与既有约束冲突。
文中的验收命令是**未来执行清单**，本次一条都没有跑过。

## 结论摘要

**不推荐现在把 TUN 设为默认。默认保持 Proxy，Gemini 继续使用已验收的 Proxifier 规则。** TUN 只作为后续受控试验：先完成公司地址清单、精确 underlay 排除、出口分层、配置持久性检查和独立离线恢复，再在本机控制台进行试验。不能把当前 `proxy-mode tun` 当作已经安全的入口。

推荐修订 T1 为：**保留公司 10/8 代理语义，排除已确认的 underlay 主机 `/32`（IPv6 为 `/128`），动态发现物理出口与 Tailnet 出口，分别绑定**。本次观察到的 underlay 共五个 IPv4：`10.8.1.172`、`10.55.26.45`、`10.55.26.163`、`223.166.74.97`、`223.167.75.56`。它们是试验初始清单，不是永久静态配置。单靠切换时刷新仍不能保证端点迁移后安全。

不采用 T1 原文的整个 `10.0.0.0/8` 排除：它与现有 AGENTS.md、共享扩展和生效公司路由直接冲突。当前观察到 10.x 连接为零，只能说明采样时没有活跃连接，不能证明公司代理需求不存在。精确排除也会让这些主机的**所有端口**绕过透明代理，须明确接受这项例外。

T2（DYLD）保留为低优先级副本实验，不作为 TUN 的先决条件，也不建议为“零常驻”立即重签原 App。T3 将旧的“未验收”拆成“Gemini 已验收、CUA 候选适用范围另计”，不要把 Gemini 成功推广到所有进程。

本次没有开启 TUN、切模式、修改 Clash/Tailscale/系统网络，也没有修改代码或规则文件；除本文档外仓库无其他变更。

## 证据、边界与读法

以下仓库行号以本次工作区内容为准；`docs/macos-tun-tailscale.md` 本来就有未提交修改，已保留。`D` 表示：

```text
/Users/lynn/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev
```

阅读顺序已执行：AGENTS.md → docs/macos-tun-tailscale.md → scripts/switch-macos-proxy-mode.mjs → 本机 config.yaml 与 clash-verge.yaml。配置只提取网络字段，没有输出节点凭据。附录 A 为本次真实输出；后文验收命令均是**未来执行清单，不代表本次跑过**。

### 外部一手依据

- [Mihomo TUN 文档](https://wiki.metacubex.one/config/inbound/tun/)：排除表、自动出口、stack 的语义；部分能力仅 Linux 可用。
- [Mihomo 全局配置](https://wiki.metacubex.one/config/general/)：`interface-name` 为出站接口，`bind-address` 为入站监听地址，`routing-mark` 面向 Linux。
- [Mihomo 规则语法](https://wiki.metacubex.one/config/rules/)：进程、端口、逻辑规则。规则匹配发生在流量进入内核之后，不等于 OS 路由排除。
- [Tailscale netfilter modes](https://tailscale.com/docs/reference/netfilter-modes)：明确只适用于 Linux。
- [Tailscale 防火墙端口说明](https://tailscale.com/docs/reference/faq/firewall-ports)：直连使用 UDP，41641 只是可变默认端口，3478 用于 STUN。
- [Tailscale 连接类型](https://tailscale.com/docs/reference/connection-types)：直连、DERP 和其他中继路径需区分。
- 固定版本源码：[Verge enhance/mod.rs](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.10/src-tauri/src/enhance/mod.rs)、[constants.rs](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.10/src-tauri/src/constants.rs)、[manager/config.rs](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.10/src-tauri/src/core/manager/config.rs)。行号按该 tag 的原文计算，本仓库不保存第三方源码副本。
- 固定内核源码：[dialer.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.33/component/dialer/dialer.go)、[bind_darwin.go](https://github.com/MetaCubeX/mihomo/blob/v1.19.33/component/dialer/bind_darwin.go)。公开 tag 源码可用于解释机制，但没有证明本机二进制与 tag 字节级一致。

## 1. 排除整个 10/8，还是 peer /32？

### 裁定

**当前选择精确 underlay `/32`，不排除整个 10/8。** 这里的 peer `/32` 指 peer 的实际传输端点 IP，不是它的 100.x Tailnet IP；后者已有 100.64/10 排除。

量化结果分三种，不能混为“没有业务”：

| 项目 | 本次结果 | 能推出什么 |
| --- | --- | --- |
| 当前 Mihomo 连接 | 55 条中目的 IP 为 10.x 的 0 条 | 瞬时样本，不覆盖离线业务、远端 SOCKS 解析、UDP 或未来家庭网络 |
| 当前用户可见 ESTABLISHED TCP | 搜索结果没有 `->10.x`，有 Tailnet SSH | 当前采样中未观察到直接 10.x 业务，root 服务可见性有限 |
| 配置承诺 | 1 条 10/8 公司代理规则，4 个公司域后缀；公司组选中 corp172-proxy | 存在明确的公司代理意图，不能以无连接删除 |
| 已见私网 underlay | 3 个 `/32`，合计 3 个地址 | 比整个 10/8 的 16,777,216 个地址小；保留其余 16,777,213 个地址的捕获资格 |
| 当前公网 underlay | 2 个 `/32` | 同样需要保护，补 10/8 无法解决 |

具体依据：共享源 `scripts/clash-verge-rev-macos-tun-dns.js:175`、`:190` 将 10/8 送往「🏢 公司内网」；`:203`、`:208` 明确删除整个 10/8 排除。生效 `D/clash-verge.yaml:512` 同样保留该规则。`templates/routing.yaml:158` 也有公司 10/8 路由。原 T1 的全段排除建议已按本文裁定改正，见 `docs/macos-tun-tailscale.md` 的「2026-11-12」小节待办 T1。

全段排除的副作用：通过真实 IP 访问的公司服务不再进入 Mihomo，公司代理规则失效，流量交给本地系统路由；在家庭网可能超时、落入同址家庭设备或泄漏到错误网络。在办公网“恰好可直连”不能证明跨网正确。公司域名走 Fake-IP 时可能仍进入 TUN（共享源 `:100`、`:144`），因此还会出现“域名能用、真实 IP 不能用”的分裂行为。显式 HTTP/SOCKS 代理请求不受 OS TUN 排除的同样限制，所以测试必须包含无显式代理的真实 IP 业务。

即使最终盘点发现确实没有需要公司 SOCKS 的 10.x 服务，全段排除也不是零代价：它是主动放弃 10/8 透明策略、拦截和可观测性；重叠子网、subnet route 仍需单独处理。只有用户明确撤销整个公司 10/8 代理要求、接受这些影响，并同步修改约束/规则，才可评估全段排除。本次没有足够证据作此裁定。

### 后续实施规格

1. `prepare()` 在 TUN 关闭、路由尚未受污染时采集端点和 `route -n get` 出口，保留采样时间及来源。除了 CurAddr，需识别可获得的候选端点；不能把 `tailscale status --json` 当作稳定、完整的 endpoint API。只采集 CurAddr 的实现要明确标为快照方案。
2. 将已确认 underlay 主机与 `ssh corp172` 的直连 HostName 放入排除集；当前包括 `10.55.26.163`，不要只补任务中前两个地址。去重、校验 IP、拒绝意外 `0/0` 和整个 10/8。IPv6 候选同理 `/128`。
3. 本地活动 LAN `/24` 是否额外排除取决于服务盘点；不能自动扩大到整个 10.55/16。现有直连 LAN 路由可能更具体，具体是否进 TUN须在试验后查表，不能机械认为“缺 10/8 的所有 10.x 都一定进 TUN”。本任务已确认的几个端点风险直接采信。
4. 每个被排除主机全部端口都会绕过透明代理，包括 `10.8.1.172` 上其他服务。若同一主机的部分端口必须经公司代理，优先使用显式代理/域名方案，或试验经正确出口绑定的 UDP DIRECT 规则；CIDR 排除无法按端口区分。
5. 要求提供至少一个“只能经 corp172 到达的真实 10.x 服务”作为回归目标。当前未发现具体业务 IP/端口，**此项是未完成的验收前提，不编造地址、不扫描内网**。

### 验收

使用清单 B1、B2、B3：五个 underlay 路由不走 Clash；100.x 仍走实际 Tailscale utun；非例外公司业务保持 corp172 出站；两种 SSH 都通过。若公司业务样例仍空缺，只能批准有限试验，不能宣称公司路由无回归。

## 2. Mihomo 自身出站怎样防二次捕获？

### 裁定

**物理出站绑定是必要防线之一，但顶层 `interface-name: en0` 不能独自证明共存正确。** 它约束 Mihomo 发起的 socket，不约束 Tailscale 自己的 UDP socket；后者仍需排除/正确路由。corp172-proxy 还必须保持独立 Tailnet 接口绑定，不能被全局 en0 错误覆盖。

v1.19.33 `component/dialer/dialer.go:163` 先采用具体出站接口，没有才取默认接口，再没有才用自动查找。Darwin 的 `bind_darwin.go:14`、`:25`、`:27`、`:39` 使用 `IP_BOUND_IF` / `IPV6_BOUND_IF`，这是接口绑定的具体机制。UDP listen 路径也有绑定处理（`:49`）。因此建议采用：公网节点、普通 DIRECT 的物理出口来自切换前的实际非 Clash 默认出口（此刻 en0）；corp172-proxy 保持实际 Tailnet utun（此刻 utun4），见共享源 `:65` 与切换脚本 `:175`、`:392`。

不能长期写死 en0；换 USB 网卡、Wi-Fi 重连或 VPN 改路由后可能错误。出口必须有网关/地址/可达性检查，禁止发现到 utun1024 后把它当作物理出口；也不能把任意其他 utun 一概当作 Tailscale。现有 `tailInterface()` 只检查 utun 名称，再在 prepare 中排除与 Clash device 相同（`:178`、`:393`），应强化为用多个 Tailnet IP、路由和 Tailscale 状态交叉确认。

全局物理绑定还可能伤害 Mihomo 内部的普通 Tailnet DIRECT（例如显式 CONNECT 100.x），即使 OS 有 100/10 排除，该请求已进入内核。因此后续应设计显式 Tailnet DIRECT 出站（绑定发现到的 utun）并路由到它；corp172 SOCKS 单独绑定不能替代这一项。现有 Proxy 健康检查专门有 Tailnet CONNECT（脚本 `:294`），TUN 分支没有，应补上。

- `routing-mark`：不采用。该键是 Linux 的出站流量标记，不是 Darwin 的防回环方案。
- `bind-address`：不采用作防回环修复。它控制代理入站监听地址；误改可能扩大局域网暴露或断开本机代理，不解决外发路由。
- `gvisor`：继续保留作为第一轮试验的固定变量。它处理已进入 TUN 的包，不会自动给 Tailscale 提供旁路，也不会替代 OS 路由和外发 socket 绑定；改 system/mixed 不是本次根因的修复。
- 本机现在两个配置的上述顶层接口键均缺省，运行 `/configs` 返回 `interface-name:""`。不能声称当前已设置 en0，也不能仅凭自动检测开启就宣称不会回环。

### Verge 重启会不会覆写？

**会重建 `clash-verge.yaml`；持久修改必须进入来源与生成事务。** 在固定 v2.5.10 源码中：

- `enhance/mod.rs:589` 的 `merge_default_config` 把 app config 盖到订阅，tun 按子键合并（`:598`）；`:917` 起依次执行合并、TUN 设置、全局扩展、订阅扩展，最后 `:964` 附近执行 authoritative enforcement。
- `constants.rs:69` 的 GUI_KEYS 包含 `route-exclude-address`（`:73`）、auto-detect-interface 等。已保存的 GUI TUN 字段会被重新强制应用，单在 JS 写排除表不足以保证生效。
- 顶层 `interface-name` 不在该 GUI TUN 键表，也不在 `field.rs:4` 的固定 HANDLE_FIELDS 中；`field.rs:57` 保留其他普通键。可以由扩展产生，但仍须检查其他 merge/script 的最终效果。
- `core/manager/config.rs:149` 重新 generate，`:347` 验证候选，`:357` 写运行文件再应用。手改运行文件不是持久来源。
- 仓库脚本 `:417` 当前只向 app config 写 `mode` 和候选 `tun`；若增加顶层出口字段，必须明确由共享扩展产生还是纳入 desiredFiles，且切回 Proxy 必须恢复之前值，而非遗留 en0。

上述是源码结论，**未实际重启验证**。验收须比较候选、config.yaml、生成文件、运行 API、实际 TCP/UDP 出口；至少正常重启一次，并重新应用当前订阅一次。

## 3. 公共 peer 被捕获后退回 DERP：代价与动态方案

### 裁定

不能接受“SSH 还能连，所以安全”。DERP 通常增加 RTT、带宽瓶颈和中继依赖；在错误路由下也可能直接失联，不能承诺必然成功退回 DERP。本次没有测量直连/DERP 延迟差，不给虚构毫秒数。当前两条 223.x 是 direct（附录 A）。

**`IP-CIDR,<公共IP>/32,DIRECT,no-resolve` 可以作为有条件试验，但它不是内核旁路。** 它让捕获流量再由 Mihomo UDP DIRECT 发出，只有 UDP 映射、物理出口绑定、返回路径正常时才可能恢复直连。规则应先于可能拦截它的规则；10.x 如采用这种方案，必须先于公司 10/8。不能仅加规则就宣布 Tailscale 已绕开 TUN。CIDR 排除更直接，但同样按整个 IP 例外。

方案优先级：

| 方案 | 动态地址适应性 | 局限 | 决策 |
| --- | --- | --- | --- |
| 已确认 underlay /32(/128) 排除 | 切换时刷新，迁移后失效 | 漏掉新端点；同 IP 全端口旁路 | 受控试验首选，配退化检测 |
| 按真实 Network Extension 进程的 UDP DIRECT | 不依赖 peer IP/远端 NAT 端口 | Darwin UDP 归属可能识别失败；仍经过 Mihomo NAT；需 root 内核实测 | P1 优先实验候选，不把 UI 名 Tailscale 当进程名 |
| 源 UDP 端口匹配 + DIRECT | 若本地监听稳定则覆盖变化的远端端口 | 本地端口可变、多个实例、误伤同端口其他程序 | 查证监听后可作有边界兜底 |
| 目标 UDP 41641/3478 DIRECT | IP 动态时仍可命中相同端口 | corp172 当前远端是 49322；3478 只帮 STUN，不等于打通数据 | 不作为完整修复 |
| 全 UDP DIRECT | 无需 IP 维护 | 大量应用绕过代理，违背全流量目标 | 不做 |
| 外部 watcher 维护 OS 主机路由 | 可追踪部分变化 | 仍有竞态、恢复/清理难，Mac NE 自己也改路由 | 不做首轮方案 |

本机实际传输进程是 `io.tailscale.ipn.macsys.network-extension`（附录 A），不是仅有 `/Applications/Tailscale.app/.../Tailscale`。候选语法可用：

```yaml
# 仅设计示例；必须通过当前内核 -t、真实元数据与 UDP 行为验证，未应用。
- AND,((NETWORK,UDP),(PROCESS-NAME,io.tailscale.ipn.macsys.network-extension)),DIRECT
# 若确实证实本地源端口是 41641，以下才可作为补充，不能只看远端端口猜：
- AND,((NETWORK,UDP),(SRC-PORT,41641)),DIRECT
```

不要将上述通用内核规则误称为 macOS 支持进程级 OS route-exclude；不使用 Linux 的 exclude-uid/auto-redirect 方案移植。进程匹配未知时，旧 /32 只保护旧 IP，新端点可能被代理、退回 DERP或失联；这是明确的失效模式。

动态退化策略：初轮测试在切换前生成端点快照；启用后短周期观察五个关键 peer 的 direct/endpoint 与出口。发现未知 endpoint、关键 peer 持续 relay 或出口变化就**恢复已知 Proxy 快照**，不要从受污染的 TUN 路由直接重新推导物理出口。若今后要日常 TUN，必须实现独立本地监督/恢复机制或证明稳定的进程旁路；仅手动重跑刷新不足以作为默认模式保障。

验收：B2 的 direct 检查加 RTT 分布。定义相同网络下前后各至少 20 个 ping；初始预算为关键 peer 零丢包、最终可恢复 direct，持续 relay 不通过；RTT 中位数增量不超过 `max(10ms, baseline×25%)`，p95 不超过 `max(baseline p95×1.5, baseline p95+20ms)`。这些是建议验收预算，不是已测性能。吞吐若重要，用现有授权文件传输对比，不能把 ping 代替吞吐测试。

## 4. route-exclude、netfilter 与 Tailscale 路由谁优先？

### 裁定

**macOS 上没有“调 netfilter 优先级即可解决”的路径。** Tailscale netfilter 模式只适用于 Linux。当前 prefs 返回 NetfilterMode=0 不代表本机存在可参与竞争的 Linux netfilter 规则，更不应因此运行 `tailscale set --netfilter-mode=off`。

分层判断：

1. Tailscale overlay 100.x / IPv6 ULA 目的流量，由 OS 路由送到其 utun；Mihomo 排除让自身不要捕获这些目标。
2. Tailscale 把包封装为访问 peer underlay 的 UDP，第二次查找路由；只排除 100/10 不保护 10.x 或 223.x underlay。
3. 系统根据最长前缀、接口作用域、路由 flags 等选路；socket 接口绑定也参与。route-exclude 不是一个压过所有 VPN 的“DIRECT 优先级”，只是约束 Mihomo 自动路由范围，不能替 Tailscale 建 subnet route。
4. 进入 Mihomo 后才按规则选择公司 SOCKS / DIRECT / 公网代理；规则表的先后与系统路由竞争是不同问题。

本机 prefs：`RouteAll:true`（接受 subnet routes），没有选择 exit node，`AdvertiseRoutes:null`，`CorpDNS:false`。corp172 “offers exit node”不等于本机正在使用它。

- **使用远端 subnet router**：先盘点批准/已安装的子网前缀及其真实路由，明确每段归 Tailscale 还是公司 SOCKS。需要走 Tailscale 的前缀应让 Mihomo不捕获，并检查路由确实指向其 utun；不能仅排除然后让物理默认路由接走。与本地 LAN 重叠时没有一个全局优先级承诺能消除歧义。共享源当前 10/8 公司规则须与这些精确前缀明确分工。
- **本机作为 subnet router/exit node**：新增转发流量、回程与 NAT 场景，不属于本次本机客户端验证范围。禁止把 root 服务能跑 TUN 推广为转发共存已验证；应在隔离设备单独测试，且不承诺所有 macOS 安装形态支持相同服务端角色。
- **本机使用远端 exit node**：Tailscale 和 Mihomo 均争取广域流量，可能形成代理经 exit node 的嵌套路径。当前设计应拒绝“已选 exit node + TUN”组合；后续若必须支持，先明确唯一默认出口与 underlay 逃生路由，再单独设计验收。不要自动清掉用户 exit-node 设置来强行通过。

验收：B1、B4；分别覆盖 IPv4/IPv6、subnet 真实业务、路由作用域。不能仅查 `netstat` 的第一条 default。

## 5. 现有事务能覆盖断网与中断吗？

### 裁定

**覆盖部分可捕获失败，不覆盖所有“排除表错误”或进程中断；不能称为断网保险。**

已有保护（脚本行号）：

- `:469` 加锁，`:498` 创建私密目录，`:502` 内核语法检查，`:506` 保存文件/环境/DNS 偏好/系统网络快照/选择，`:509` 写快照后才退出 App。
- `:517` 原子写来源配置，`:525` verify。网络不可达且抛错时，`:537` catch 经 `:541` 尝试正常退出并 restore。
- health `:260` 检查公网/公司 HTTP，`:280` 检查自身 MagicDNS，`:283` 仅取 Tailnet 22 端口 banner；这些检查能发现一部分断网。
- restore `:550` 不调用 prepare、不需要互联网先验，文件、launchctl、Tailscale 本地偏好、App/socket 均在本机，故**单纯失去互联网时有希望恢复**。

缺口：

1. 健康检查不验证 underlay direct、两种 SSH 命令、非例外真实 10.x 服务、进程元数据、UDP/MTU/长期迁移。relay 还可拿 SSH banner，错误排除表仍可能被提交为成功。
2. 没有 SIGINT/SIGTERM 收尾、持久事务阶段或独立 watchdog。SIGKILL/终端关闭/掉电可能停在已启 TUN 的中间态；`finally` 不是所有中断的保证。
3. `lastBackup` 只在成功后 `:532`、`:535` 更新。半途崩溃后的 `rollback` 可能指向更早的成功切换；甚至其快照可能是 TUN，而非当前事务开始前 Proxy。不能盲目调用就认定会关闭 TUN。
4. `quit()` `:188` 只等正常退出，不强杀；退出卡住就不能继续恢复。root core 与本地服务异常也会阻断。
5. `restore()` 先写文件、环境，再调用 Tailscale prefs（`:554`），本地 Tailscale 服务异常会导致在重启 Clash 前中止。
6. backup.network 有 DNS/代理值，但 restore 没有显式重放整个 network 快照；依赖 Verge 正常启动/退出恢复 DNS和系统代理。`:558` 只验证 tun.enable，未做完整网络健康验收。
7. `dns.lookup()` `:280` 没有独立 JS 级超时；多个串行健康检查虽大多有 timeout，仍没有覆盖全事务的总截止时间。
8. 幂等分支 `:485` 在没有新 backup 的情况下修复环境和 shell hook，若后续 verify 失败，catch 没有对应快照重放；不能把主切换路径的回滚保证泛化到该分支。

### 必须先补的事务设计

- 加持久 journal：`prepared → applied → verifying → committed`，记录本次 snapshot 路径与预先证明的 Proxy 恢复目标，权限沿用 700/600；切换成功前不能仅依赖 lastBackup。
- 在 apply 前启动独立本地恢复守护，带事务 ID 和总截止时间（建议初始 180 秒，实际测试校准）；只有完成全套检查才撤销。守护必须能在主进程被 SIGKILL 后工作；不用互联网、不依赖 Tailscale 在线、不从远端拉依赖。
- 恢复流程先确保 TUN 关闭和本机代理/DNS回到已知 Proxy，再做可选 Tailnet 检查；Tailscale prefs 无变化时不调用 setter，读取失败不能阻断紧急解除 TUN。恢复失败要保留 journal 与阶段证据。
- 添加信号尽力回滚和陈旧事务恢复，但不宣称它能捕获 SIGKILL。限定锁恢复策略，不能只看 PID 不存在就丢弃未完成事务。
- 恢复后校验系统代理、DNS、默认路由、env、corpInterface；网络探测失败应区分“外网本来不可达”和“本地模式恢复失败”。

### 断网时能否 rollback？

条件式“能”：本地 Node/yaml 依赖、快照、App、unix socket 和 Tailscale 本地服务可用，且选中了正确 Proxy 快照时，网络断开不天然阻止 restore。条件式“不能保证”：本地服务卡死、快照错误、进程中断、DNS恢复失败等均可阻断。恢复入口应从本地终端执行，不能只依赖 corp172 远程 SSH 会话。

当前可用恢复步骤见清单 C；它是现有代码恢复能力的操作方案，**本次未演练**。P0 要求在正式试验前先演练本地恢复；没有恢复演练就不启 TUN。

## 6. 是否把 TUN 作为默认？

**不推荐。** Gemini 已有小范围可用修复，TUN 的 underlay 动态性、公司规则冲突和离线恢复缺口尚未关闭，现在收益不足以覆盖全机断网风险。

以后只有满足以下全部条件才重新评估：P0 完成；关键 peer 在办公/家庭网络、睡眠唤醒、物理网卡变化、端点迁移、Verge 正常重启/重应用订阅后仍 direct；公司真实 IP 和域名业务都通过；本地断网恢复与主进程被杀演练通过；IPv6 路径策略明确；至少连续五个工作日无未知 relay/回环/需要手工修路由。五天是建议观察门槛，不是历史实测。

即使全部通过，若需求仍只是 Gemini 的 80/443 请求，继续按进程更合适。只有覆盖多个无法配代理的应用、UDP 或控制链路的明确需求出现，才有把 TUN 常开作为候选的理由；“不接受额外常驻程序”本身不意味着 TUN 的风险更小。

## 7. TUN 与 per-process 取舍

| 场景/维度 | Proxy + 显式代理/环境 | Proxy + Proxifier | DYLD 副本实验 | TUN |
| --- | --- | --- | --- | --- |
| 当前 Gemini 80/443 半代理 | 不完整，已确认 | **首选，已有历史实测** | 可研究，未验收 | 能作为候选，但当前不应为此全机启用 |
| 单个可控 CLI/Node | 首选，维护成本低 | 通常多余 | 无必要 | 通常多余 |
| 父进程清空代理环境 | 需修改受支持启动入口；现有特定 launcher 曾通过 | 若 TCP/API 受覆盖可用 | 依赖签名和调用路径 | 完成共存后可兜住被路由捕获的流量 |
| 需要通用 UDP/QUIC/未知协议透明覆盖 | 常有缺口 | 不能假定当前 HTTP/TCP 规则覆盖 UDP | 取决于注入拦截点，不能保证 | 在这些候选中通常需要 TUN，仍有排除例外 |
| 按应用隔离，不影响其他软件 | 显式入口可精确 | 按名字而非路径，同名风险 | 可限于副本，但稳定性未知 | 全机影响，需另外配规则 |
| Tailscale/多 VPN 共存风险 | 当前已用，范围最小 | 规则误伤要控制 | 不改全机路由但改 App | 最高，需要本方案所有门槛 |
| 升级成本 | 检查代理支持/启动器接口 | 检查名字/子进程/日志 | 签名、entitlement、登录和更新均可能出问题 | 检查 Verge 生成逻辑、内核路由、TS端点 |
| “零额外常驻” | 通常满足 | 不满足，依赖 Proxifier | 可能没有另一个后台进程，但注入库持续存在 | 没有新增 Proxifier，不等于无常驻：已有 root core，稳健动态方案还可能要守护 |

“必须 TUN”仅指在这里列出的候选、且应用既不支持显式代理也不能被现有 per-process 工具完整覆盖时；不是声称 macOS 不存在其他 Network Extension 产品方案。

DYLD 的明确立场：`docs/macos-tun-tailscale.md` 的「2026-11-12」小节待办 T2 中「移除签名后即可注入」应保留为候选假设，不能当充分条件。无 __RESTRICT 不足以证明允许 DYLD；hardened runtime、entitlements、library validation、启动方式都参与。只在 `~/Applications/Gemini-copy.app` 验证，不修改原件，不关 SIP/Gatekeeper，不全局注入。登录、Keychain、更新及 Google 侧校验风险见同一待办 T2 所列。没有稳定可复现收益就停止，不以系统安全机制换“零常驻”。

Proxifier 的 `crashpad_handler` 是通用名，见原文 `:415`；P1 可缩小此项规则，先查日志再决定，不能凭进程名推断属于 Gemini。

## 分阶段行动计划

### P0：任何 TUN 试验前必须完成

1. **需求与路由盘点**：列出至少一个真实公司 10.x 目标的 IP/端口/协议、当前经 corp172 成功证据、办公和家庭网络预期；列出 subnet route / exit node 使用需求。保留现有公司 10/8 约束，纠正 T1 的全段排除建议。没有业务样例不能签署“10/8 无回归”。
2. **配置候选生成**：共享源接受由切换器生成的 underlay 排除集和物理/Tailnet 出口参数；只排除精确端点；顶层出口与 Tailnet DIRECT 分层；保存 Proxy 原值。当前 wrapper 逐字节约束（切换脚本 `:17`、`:42`）必须保持。同步 desiredFiles 中的 config.tun，防 GUI 覆盖；不手改生成文件。
3. **事务与本地恢复**：持久 journal、当前事务 Proxy 快照、独立守护、总超时、幂等路径快照和完整恢复验证。先通过 mock/故障测试，再在 Proxy 模式验证恢复入口不依赖互联网/远端 SSH。
4. **扩充验收**：direct/endpoint、两种 SSH、Tailnet CONNECT、公司真实 IP、DNS、IPv6策略、重启持久性；未知端点或本地服务不可用则拒绝启用/恢复 Proxy。动态方案未成熟只允许本地有人值守的短试验。
5. **变更交付**：后续实施时跑 `node --check`、相关事务故障测试、`npm run validate`，检查 diff，按 AGENTS.md 提交推送后才应用客户端。仅扩展/模式脚本变更不必改 SublinkPro 模板；若改模板则走其 Git → Raw 验证 → SublinkPro 生成验收流程。本次仅设计，不执行任何上述变更或提交。

### P1：可在 P0 后做

- 证明 macOS NE 的 UDP 进程归属，评估按进程 DIRECT 能否替代不断增长的公网 /32；验证源端口方案，不使用目标 41641 作为唯一条件。
- 两种网络、睡眠、地址迁移、应用/订阅重载长测，按定义预算比较 RTT 与业务吞吐。
- Gemini 副本 DYLD 可行性实验；即使成功也先观察更新、登录和回滚，不触原件。
- T3 文档修正：标注 Gemini Proxifier 已通过，保留其他场景各自的未验证范围。

### 明确不做

- 当前开启 TUN或将其设为默认；把整个 10/8 排除当作通用修复。
- 修改 Tailscale DNS/全局设置、netfilter、exit node 来“配合成功”；硬编码 utun4/en0 为永久策略。
- 仅加 `IP-CIDR DIRECT` 就宣称等价 OS 排除；硬编码两条 223.x 后声称动态问题已解决。
- 全 UDP 直连、系统 pf/路由 watcher 作为首轮修复；全局关闭安全机制、重签原 Gemini、改 hosts + root SNI relay。
- 把 403、SSH banner、`status` 成功或旧的验收记录当作 Chrome/Gemini/当前 TUN 完整验收。

## 验收清单（未来执行；本次没有执行切换/恢复/主动业务测试）

所有命令在仓库根目录、本机终端执行。A 类只读可现在执行；B/C 仅供后续明确授权的实施窗口。不要把整段当自动化脚本粘贴执行。涉及真实业务的探测需要已有授权，SSH 禁止新增信任记录。

### A. 只读基线

```bash
node scripts/switch-macos-proxy-mode.mjs status --json
```

期望：expectedMode/actualMode 均 proxy、persistentTun=false、systemProxyEnabled=true、mixedPort=7897、environmentDrift=false、tailscaleAcceptDns=false。`chromeEndToEndVerified=false` 正常，不能当作 Chrome 失败，也不能改成 true 伪造验收。

```bash
tailscale status
tailscale debug prefs | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d.get(k) for k in ["RouteAll","CorpDNS","ExitNodeID","ExitNodeIP","AdvertiseRoutes"]})'
netstat -rn -f inet
netstat -rn -f inet6
scutil --dns
```

期望：关键 peer direct；没有本机选定 exit node；公司 subnet 需求与表一致；MagicDNS suffix 指向 100.100.100.100。不要把 offers exit node 当 selected。

### B1. 试验前与启用后的路由对照

```bash
for ip in 10.8.1.172 10.55.26.45 10.55.26.163 223.166.74.97 223.167.75.56 100.93.132.98; do
  route -n get "$ip" | rg 'route to:|gateway:|interface:'
done
```

期望：前五个走已记录的 underlay 出口，当前为 en0 / 10.55.90.254；最后一个走实际 Tailscale utun，当前 utun4；任何一项指向 utun1024 都失败。非 Tailscale utun 也不能自动判通过。新 IPv6 端点用 `route -n get -inet6 <实际IPv6>` 同样检查；没 IPv6样本只可标记未验证。

### B2. 业务与直连验收

```bash
tailscale status | rg 'corp172-dev|df-k14|sh-4631|lynn-kubuntu|linglongr9000p'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 corp172 'echo ok'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 corp172-dev 'echo ok'
tailscale ping --c 20 --until-direct=false corp172-dev
tailscale ping --c 20 --until-direct=false df-k14
tailscale ping --c 20 --until-direct=false lynn-kubuntu
tailscale ping --c 20 --until-direct=false linglongr9000p
```

期望：SSH 均退出 0 并输出 ok；活跃 peer 最终为 direct，RTT符合第 3 节预算。tailscale ping 是后续主动探测，可能促进链路建立；需在本机版本 `tailscale ping --help` 先确认参数，若不支持按帮助调整。这里不要求从第一次 ping 就绝无 DERP，因为建链过程可能短暂中继；持续退化或关键 peer 不可达则失败。加入 sh-4631 的同样 20 次测试。

```bash
curl --noproxy '*' --connect-timeout 4 --max-time 10 -o /dev/null -sS -w '%{http_code}\n' https://github.com
curl --noproxy '*' --connect-timeout 4 --max-time 10 -o /dev/null -sS -w '%{http_code}\n' https://spug.dongfangfuli.com
dscacheutil -q host -a name corp172-dev.tail945737.ts.net
curl --proxy http://127.0.0.1:7897 --noproxy '' --proxytunnel --max-time 8 telnet://100.93.132.98:22
```

期望：两个 HTTPS 200；MagicDNS 返回 100.93.132.98；显式 CONNECT 能收到 SSH- banner（telnet会话之后可能因空闲超时，不能把 curl 的整体超时退出码误判为建立失败）。HTTPS检查需清除继承环境干扰或使用上述显式参数；HTTP 403只可证明相应服务的 TLS/HTTP到达。

### B3. 公司真实 IP 与最终配置

```bash
# 此命令使用验收人员先填入的真实业务 URL，不得留空运行：
: "${CORP_TEST_URL:?先填写经 corp172 才可达的真实 10.x 业务 URL}"
curl --noproxy '*' --connect-timeout 4 --max-time 10 -sS -o /dev/null -w '%{http_code}\n' "$CORP_TEST_URL"
```

期望：按业务预先登记的成功 HTTP 状态（非 HTTP业务改用其只读客户端命令），且 Mihomo连接记录显示公司策略/对应 SOCKS。必须选一个不属于 underlay 排除主机的目标；Proxy 基线可用 `curl --socks5-hostname 100.93.132.98:1080 --noproxy '' ...` 对同一 URL 对照。如果目标未知，本条为未满足，不以 Spug 域名替代。

```bash
curl -fsS --unix-socket "/var/run/clash-verge-service/users/$(id -u)/verge-mihomo.sock" http://localhost/configs | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d.get(k) for k in ["mode","interface-name","tun"]})'
```

期望：试验阶段 tun.enable=true，排除包含精确端点与原 Tailnet范围，不包含整个 10/8；出口字段符合候选。API 未暴露某字段时不能当“没有生效”，需再查生成 YAML 和实际出站。使用 Node+yaml 提取 config.yaml 与 clash-verge.yaml 的 tun、interface-name及 corp172 的 interface-name做三方比较，禁止 cat 全配置。Verge正常重启/重应用当前订阅后重复同一条命令，期望语义不变。后续实现前，本条预期不会由现有脚本自动满足。

最终 YAML 三方核对中的文件部分可直接执行：

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import YAML from 'yaml';
const d=path.join(os.homedir(),'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev');
for(const f of ['config.yaml','clash-verge.yaml']) {
  const c=YAML.parse(fs.readFileSync(path.join(d,f),'utf8'));
  console.log(f,JSON.stringify({tun:c.tun,interface:c['interface-name']??null,
    corpInterface:c.proxies?.find(p=>p.name==='corp172-proxy')?.['interface-name']??null,
    companyRules:c.rules?.filter(r=>r.startsWith('IP-CIDR,10.0.0.0/8,'))??[]}));
}
NODE
```

期望：两个 tun 的排除集语义一致，生成配置保留公司 10/8 规则；corpInterface为当前实际Tailnet接口，公网默认出口为候选物理接口。config.yaml没有代理列表是正常的；顶层接口若采用仅扩展生成，config.yaml不必有相同键，生成文件与运行/实际出站必须一致。启用前后、正常重启及重新应用订阅后均执行并比较，不输出完整代理配置。

### B4. 动态、故障与场景门槛

```bash
tailscale status
node scripts/switch-macos-proxy-mode.mjs status --json
route -n get 100.93.132.98
scutil --proxy
scutil --dns
```

期望：在另行授权的正常睡眠唤醒、办公/家庭切网、Verge 重载场景后重复，仍符合 B1–B3；端点变化被正确刷新或自动恢复 Proxy，不能只保留旧名单。需要真实切网场景，不能本次只读分析代做。若涉及 subnet/exit-node，需要单独场景计划，当前不得验收为已支持。

### C. 断网时本地恢复（未来实施窗口使用，会改变模式）

**先确认快照目标，后恢复。** 试验前在本机私密位置登记本次 Proxy 快照路径，不把路径内容或节点信息复制到共享文档。下面只打印布尔状态，不打印快照正文：

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import YAML from 'yaml';
const r=path.join(os.homedir(),'Library/Application Support/proxy-routing/macos-mode');
const s=JSON.parse(fs.readFileSync(path.join(r,'state.json'),'utf8'));
if(!s.lastBackup) throw Error('没有成功切换快照，不能盲用 rollback');
const b=JSON.parse(fs.readFileSync(path.join(s.lastBackup,'snapshot.json'),'utf8'));
const v=Object.entries(b.files).find(([p])=>p.endsWith('/verge.yaml'))?.[1];
console.log({rollbackTargetTun:v ? YAML.parse(v.body).enable_tun_mode : 'missing'});
NODE
```

期望 `rollbackTargetTun:false` 才运行普通 rollback；若是 true、missing 或报错，停止，使用已登记的正确 Proxy 快照。当前 `rollback` 是“回到最近成功切换之前”，不是“关闭 TUN”。

```bash
# 只有上一步确认目标为 Proxy 时执行；这些命令本次未运行。
node scripts/switch-macos-proxy-mode.mjs rollback
node scripts/switch-macos-proxy-mode.mjs status --json
```

期望 actualMode=proxy、TUN关闭、7897系统代理恢复、DNS不再是114占位，随后查路由/SSH。使用底层 node不依赖 shell 函数存在，但它不替当前 shell eval环境；需要同步时在原 zsh 中运行 `eval "$(node scripts/switch-macos-proxy-mode.mjs shell-env)"`。不要 sudo 运行完整切换脚本。

若 lastBackup 指向旧事务，现有类导出的 restore 可以恢复**已登记、可信、目标明确为 Proxy 的快照**。以下是临时本地维护入口设计，不是受支持的现有 CLI 子命令；本次未执行，P0 应把它做成经过测试的正式恢复命令：

```bash
# 在本机终端先填入私密登记路径；不得由“目录最新”盲选。
export RECOVERY_SNAPSHOT='/填写已确认的Proxy快照目录/snapshot.json'
node --input-type=module <<'NODE'
import fs from 'node:fs'; import YAML from 'yaml';
import {ModeManager} from './scripts/switch-macos-proxy-mode.mjs';
const p=process.env.RECOVERY_SNAPSHOT;
if(!p || !fs.existsSync(p)) throw Error('快照不存在');
const b=JSON.parse(fs.readFileSync(p,'utf8'));
const v=Object.entries(b.files).find(([f])=>f.endsWith('/verge.yaml'))?.[1];
if(!v || YAML.parse(v.body).enable_tun_mode !== false) throw Error('拒绝恢复非Proxy快照');
const m=new ModeManager(); m.acquire();
try { await m.host.quit(); await m.restore(b); console.log('本地恢复完成，仍须核对DNS和路由'); }
finally { m.release(); }
NODE
```

该入口绕过 prepare/在线健康探测，但**仍有正常退出/Tailscale本地prefs依赖**，不声称它能处理本地服务卡死。与 lastBackup 的问题相比，显式路径解决了选错快照，不解决 restore 内部全部缺陷。

若连本地服务都异常，先尝试 unix socket 紧急停 TUN（仅恢复用途，不是正常切换流程）：

```bash
curl --connect-timeout 2 --max-time 5 --unix-socket "/var/run/clash-verge-service/users/$(id -u)/verge-mihomo.sock" \
  -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H 'Content-Type: application/json' \
  -d '{"tun":{"enable":false}}' http://localhost/configs
```

期望 2xx，随后 GET /configs确认false，并用 B1看路由。该 API 只解除运行时 TUN，不恢复所有持久状态，重启可能再次打开；必须尽快用可信快照完成恢复。若 socket失效，该命令无能为力，不要远程盲删 utun/route 或强杀所有 VPN。P0 的独立守护必须覆盖此类失败的本地操作路径并实测；当前尚未有可靠的一键兜底。

```bash
# 已停 TUN且DNS仍停在114占位、常规恢复失败时，恢复当前活动网络的DHCP DNS。
# 这是既有专用DNS恢复脚本，不修改Tailscale resolver；会改变系统DNS，本次未执行。
sudo node scripts/macos-dns.mjs dhcp
scutil --dns
scutil --proxy
route -n get 10.8.1.172
```

期望恢复活动网络 DHCP DNS、MagicDNS分域保留、underlay走原出口。若 root core也停止而系统代理仍开启，应用系统代理需通过可信 Proxy 恢复/本地界面处理；不能仅恢复 DNS 就宣称网络已恢复。DHCP DNS 也不等于能访问所有境外网站，目标是恢复本地可管理性。首轮试验须坐在本机控制台，保留本文离线副本与可信快照；无法恢复时停止试验，不扩大系统修改。

## 未验证声明

- **本次实测**：读取实际配置/源码、git status、tailscale status/prefs、IPv4路由表及六个目标 route get、用户可见 TCP连接、DNS resolver、实际服务进程名、unix socket GET version/configs/connections/proxies。真实结果见附录 A。
- **直接采信用户事实**：当前两种 SSH 可用、TUN关闭时的既有拓扑、2026-11-12 Proxifier Gemini已生效。没有本次重跑 SSH/Gemini/Chrome操作。
- **历史实测，非本次复测**：2026-10-27 NO_PROXY 表格（原文 `:323`），精确IP枚举是所列客户端共同通过的形式，CIDR支持不通用。它属于应用显式代理绕过，与 TUN 的路由排除是两层，不能用 NO_PROXY 修复 TUN underlay。Python后缀结果只针对记录的具体测试形态，不推广成所有版本的语言规格。
- **源码推断**：出口绑定机制、Verge重建/authoritative覆盖行为、现有回滚缺口；本次没有运行修改后候选，也没有重启验证字段持久性。
- **尚未验证**：开启TUN后任何业务表现；/32排除效果；公网IP DIRECT UDP效果；Network Extension进程识别；DERP延迟/吞吐差；端点迁移；IPv6 underlay；subnet router/exit node与TUN组合；离线恢复/SIGKILL演练；DYLD注入与登录稳定性。
- **没有执行**：`proxy-mode tun/proxy/rollback`、候选 -t、npm run validate、系统网络/配置写入、Tailscale setter、源码或文档仓库变更、Git提交推送。设计文档没有代码变更，未运行 validate 不代表失败；实施时必须运行。

## 附录 A：本次真实输出摘录

以下保留命令和真实输出的相关行；`…` 仅表示省略无关行，没有补造输出。网络字段会随时间变化，不能作为永久配置。

```text
$ git status -sb
## main...origin/main
 M docs/macos-tun-tailscale.md

$ tailscale status
100.93.132.98   corp172-dev        coolxll@        linux    active; offers exit node; direct 10.8.1.172:49322, tx 1883267892 rx 850932040
100.80.11.110   df-k14             coolxll@        windows  active; direct 10.55.26.45:41641, tx 52119340 rx 36097412
100.92.214.69   linglongr9000p     coolxll@        windows  active; offers exit node; direct 223.167.75.56:41641, tx 8347584 rx 14488836
100.80.49.47    lynn-kubuntu       coolxll@        linux    active; direct 223.166.74.97:41641, tx 525372300 rx 130184128
100.83.8.30     sh-4631            coolxll@        windows  active; direct 10.55.26.163:41641, tx 36678792 rx 54332584
```

```text
$ tailscale debug prefs | python3 [提取指定字段；实际执行的提取键如下]
{
  "RouteAll": true,
  "CorpDNS": false,
  "ExitNodeID": "",
  "ExitNodeIP": "",
  "AdvertiseRoutes": null,
  "NoSNAT": false,
  "NetfilterMode": 0
}

$ netstat -rn -f inet
Destination        Gateway            Flags               Netif Expire
default            10.55.90.254       UGScg                 en0
default            link#20            UCSIg               utun4
10.55.90/24        link#12            UCS                   en0      !
100.64/10          link#20            UCS                 utun4
100.93.132.98      link#20            UHWIi               utun4
```

```text
$ for ip in 10.8.1.172 10.55.26.45 10.55.26.163 223.166.74.97 223.167.75.56 100.93.132.98; do route -n get "$ip" | rg 'route to:|gateway:|interface:'; done
   route to: 10.8.1.172
    gateway: 10.55.90.254
  interface: en0
   route to: 10.55.26.45
    gateway: 10.55.90.254
  interface: en0
   route to: 10.55.26.163
    gateway: 10.55.90.254
  interface: en0
   route to: 223.166.74.97
    gateway: 10.55.90.254
  interface: en0
   route to: 223.167.75.56
    gateway: 10.55.90.254
  interface: en0
   route to: 100.93.132.98
  interface: utun4
```

```text
$ lsof -nP -iTCP -sTCP:ESTABLISHED | rg -- '->10\.|->100\.'
ssh        3204 lynn    5u  IPv4  0xb5e8b65571f3a18      0t0  TCP 100.77.110.64:60303->100.93.132.98:22022 (ESTABLISHED)
ssh        3246 lynn    5u  IPv4 0xf38a7a7491e9d58e      0t0  TCP 100.77.110.64:61903->100.80.11.110:22 (ESTABLISHED)
ssh        7589 lynn    4u  IPv4 0xbd2f1a0fec7bd775      0t0  TCP 100.77.110.64:54802->100.83.8.30:22 (ESTABLISHED)
ssh        9907 lynn    5u  IPv4 0x194499be401956ac      0t0  TCP 100.77.110.64:56875->100.80.49.47:22 (ESTABLISHED)
sshd-sess 24160 lynn    7u  IPv4 0xd7102d79d2fab31a      0t0  TCP 100.77.110.64:22->100.80.49.47:48330 (ESTABLISHED)
sshd-sess 24160 lynn    8u  IPv4 0xd7102d79d2fab31a      0t0  TCP 100.77.110.64:22->100.80.49.47:48330 (ESTABLISHED)
ssh       59204 lynn    5u  IPv4 0xee6ff9d00dfea791      0t0  TCP 100.77.110.64:61378->100.92.214.69:22 (ESTABLISHED)
```

下面由 Node `http.get({socketPath,path})` 实际调用本机 unix socket GET，输出经过指定字段提取：

```text
/version {"meta":true,"version":"v1.19.33"}
/configs {"mode":"rule","tun":{"enable":false,"device":"utun1024","stack":"gVisor","dns-mode":"","dns-hijack":["any:53","tcp://any:53"],"auto-route":true,"auto-detect-interface":true,"mtu":1500,"inet4-address":["198.18.0.1/30"],"route-exclude-address":["127.0.0.0/8","100.64.0.0/10","172.16.0.0/12","192.168.0.0/16","fd7a:115c:a1e0::/48"],"file-descriptor":0,"recvmsgx":true,"processors-per-channel":1},"interface-name":""}
/connections {"total":55,"tenCount":0,"ten":[]}
/proxies {"company":"corp172-proxy"}
```

```text
$ scutil --dns | rg -n -A 7 -B 1 'tail945737|100.100.100.100|nameserver\[0\]'
4-  search domain[0] : dongfu1.com
5:  nameserver[0] : 127.0.0.1
…
57-resolver #8
58:  domain   : tail945737.ts.net
59:  nameserver[0] : 100.100.100.100
60-  timeout  : 3
61-  flags    : Request A records
62-  reach    : 0x00000003 (Reachable,Transient Connection)
```

```text
$ ps -axo pid=,comm= | rg -i 'tailscale|IPNExtension|mihomo'
 3853 /Applications/Tailscale.app/Contents/MacOS/Tailscale
 3961 /Library/SystemExtensions/686BA9B1-2B75-4DDC-BDB5-A7F510B40D2E/io.tailscale.ipn.macsys.network-extension.systemextension/Contents/MacOS/io.tailscale.ipn.macsys.network-extension
…
52197 /Library/Application Support/clash-verge-service/cores/verge-mihomo
```

本机 YAML 的 Node+yaml 提取真实输出（节选）：

```text
config.yaml:14:  auto-detect-interface: true
config.yaml:15:  auto-route: true
config.yaml:21:  route-exclude-address:
config.yaml:27:  stack: gvisor
config.yaml:29:  enable: false
clash-verge.yaml:110:  auto-detect-interface: true
clash-verge.yaml:117:  route-exclude-address:
clash-verge.yaml:123:  stack: gvisor
clash-verge.yaml:125:  enable: false
clash-verge.yaml:512:- IP-CIDR,10.0.0.0/8,🏢 公司内网,no-resolve
10.x rules ["IP-CIDR,10.0.0.0/8,🏢 公司内网,no-resolve","DOMAIN-SUFFIX,dongfu1.com,🏢 公司内网","DOMAIN-SUFFIX,dongfangfuli.com,🏢 公司内网","DOMAIN-SUFFIX,psf-dev.com,🏢 公司内网","DOMAIN-SUFFIX,ocjfuli.com,🏢 公司内网"]
```
