# TUN 与 Tailscale 共存：前提、裁定与验收门槛

日期：2026-11-12（重构版）。取代同日初稿及其后的多轮补充；初稿里被推翻的结论集中
记录在第 9 节，避免被再次引用。除标注「未实测」者外，本节的网络数字均来自本机
2026-11-12 12:4x–12:5x 的真实命令输出（见第 2 节）。

## 0. 一页结论

- **保留官方 Tailscale.app 不动，TUN 默认关闭**；Gemini Desktop 继续用已验收的
  Proxifier 单进程规则（`docs/macos-tun-tailscale.md` 2026-11-12 小节）。
- 架构上只剩一条路线：**官方 App + Clash 只在外围做路由隔离**。网关化、按网络位置
  切模式、换掉 tailnet 实现，三条路已全部否决（第 3 节）。
- **唯一尚未回答的技术问题**：官方 App 的 outer socket 是否已绑定物理接口。这决定
  `/32` 排除表是需要维护，还是可以缩到只剩 overlay 项（第 4 节，是 P0 的第一项）。
- 无论该问题结论如何，**事务与离线恢复（journal / watchdog）都必须补**：失败窗口
  打的是本机唯一的异地远程通道。

## 1. 显式前提（任一不成立，本文结论作废）

1. **corp172 所在网段没有公网 IP** → 异地唯一入口是 tailnet 的 100.x 地址。
   办公网能直连 `10.8.1.172` 属观测点特权，不构成「tailnet 冗余」。
2. **本机同时有出流量与入流量**。实测存在从 tailnet 进本机的连接：

   ```text
   sshd-sess 100.77.110.64:22 -> 100.80.49.47:48330 (ESTABLISHED)
   ```

   → 本机必须**始终是 tailnet peer**，不能用「把 tailnet 移出本机」来简化。
3. **上游当前没有 IPv6**（第 2 节实测：无全局地址、无 RA）。所以 underlay 端点只
   可能是 IPv4；**条件一旦变化，必须重采端点**，否则新增的 v6 underlay 路径不在任何
   排除范围内（无声回归）。
4. **tailnet 常开**，理由是无公网 IP 的硬约束 + 免切换成本；安全是顺带收益，不是
   主要论据。因此不允许「按网络位置切模式」。
5. 本机是**「家用路由器内嵌公司隧道」的叠加形态**：mihomo 的出口与 Tailscale 的
   underlay 共用同一条上游（第 2 节 traceroute 证据）。

## 2. 本机拓扑实测

| 项目 | 实测值 | 命令 |
| --- | --- | --- |
| en0 地址 / 网关 | `192.168.3.31/24` / `192.168.3.1`（Huawei IGD，UPnP 可用） | `ipconfig getifaddr en0` |
| 到 corp172 underlay | `192.168.3.1` 2.9ms → `10.55.27.254` 3.6ms → `10.8.1.172` 3.6ms | `traceroute -n -m 5 10.8.1.172` |
| 到 `223.167.75.56`（对端公网端点） | 经同一 `10.55.27.254` → `10.55.0.253` | `traceroute -n -m 5 223.167.75.56` |
| Tailscale P2P | `corp172-dev` `via 10.8.1.172:49322` **7ms**；`df-k14` `via 10.55.26.45:41641` **7ms** | `tailscale ping -c 3` |
| 最近 DERP 与延迟 | `home-sh` **11.9ms**；`nue` 160.1；`lax` 188.1；`sea` 208.0 | `tailscale netcheck` |
| NAT 类型 | `MappingVariesByDestIP: true`（对称 NAT），`PortMapping: UPnP` | `tailscale netcheck` |
| IPv6 上行 | **无**：en0 仅 `fe80::…`，`IPv6 IP address: none`、`IPv6 Router: none` | `ifconfig` / `networksetup` |
| 版本 | Tailscale.app 1.104.1；Mihomo v1.19.33（Clash Verge 2.5.10），mixed-port 7897 | `tailscale version` / `/version` |

两个与设计直接相关的推论：

- **家路由器 `192.168.3.1` 是公司网的隧道入口**。所以「排除 underlay」的目的不是
  「别抢家宽路由」，而是**别把本该走公司隧道的 WireGuard UDP 送到境外代理节点**。
  3.6ms 的路径被改写成绕行出国，才是真正的代价（MTU、延迟、丢包）。
- 本机存在多个只有 link-local、却带 IPv6 默认路由的空壳 utun（`utun0`–`utun3`
  `default fe80::%utunN`）。**任何「出口网卡发现」逻辑都不得把这类 utun 当作物理
  出口或 Tailscale 接口**，必须用 Tailnet IP + 路由 + `tailscale status` 交叉确认。

## 3. 已否决的路径

| 路径 | 否决理由 | 关键证据 |
| --- | --- | --- |
| 排除整个 `10.0.0.0/8` | 10/8 在本仓库是**主动走公司代理**的通道，全段排除会让规则失效并制造「域名可用、真实 IP 不可用」的分裂 | `scripts/clash-verge-rev-macos-tun-dns.js:175`、`:190`、`:203`、`:208`；`templates/routing.yaml:158` |
| 按网络位置切模式 | 前提 1 与 4 直接冲突：异地只能走 tailnet，常开又不允许切换 | 第 1 节 |
| 网关化 / 把 tailnet 移出本机 | 本机有 inbound 依赖，移出即失去 100.x 身份、ACL 与 `known_hosts` | 第 1 节实测的 `sshd-sess` |
| 完整替换 tailnet 实现（独立 daemon / userspace 全量替换） | 同上（身份迁移）+ 破坏系统 MagicDNS 与 `proxy-mode` 的 prepare/health 假设 | `docs/macos-tun-tailscale.md` 模式行为表 |
| 以 Mihomo 内嵌或 sing-box endpoint 替代 | 均为各自 fork 的 TS 核心，升级链与官方 App 脱钩：Mihomo 依赖 `metacubex/tailscale`（`VERSION.txt` 1.102.3），sing-box 依赖 `sagernet/tailscale`（1.102.1），本机官方为 1.104.1、上游 1.104.6 | 两处 `go.mod` + `VERSION.txt` |
| 硬编码 `223.x` 的 `IP-CIDR,DIRECT` | 端点会随 NAT 与网络位置变化，静态条目必过期 | 第 2 节换网观测 |
| `tailscale set --netfilter-mode` 调优先级 | 该开关只对 Linux 生效，macOS 无此竞争路径 | 官方 netfilter 文档 |

补充一条对第 5 行的公平记录：**Mihomo v1.19.33 确实有原生 Tailscale 出站**（
`adapter/outbound/tailscale.go`，需 `with_gvisor` 且未加 `no_tailscale`），且它是唯一
能对自身 outer 传输统一做物理接口绑定的实现。否决理由不是「没有这个能力」，而是
「该能力来自 fork，与前提 4 的常开语义捆绑在一个跟不上上游的版本上」。

## 4. 剩余路径与唯一未定问题

**路径**：官方 Tailscale.app 保持不变（身份、100.x、MagicDNS、inbound 全部不动），
Clash 只增加「不捕获 tailscaled 的 outer 传输」这一件事。

**未定问题**：官方 1.104.1 在 macOS 上的 outer socket 是否已经 `IP_BOUND_IF` 到物理
接口。

- 源码位置：`tailscale/net/netns/netns_darwin.go`（`IP_BOUND_IF` / `IPV6_BOUND_IF`），
  默认按 OS/缓存默认接口绑定，并会排除 Tailscale 自己的接口。
- **若已绑定** → `/32` 表可缩到仅 overlay 项（`100.64.0.0/10`、`fd7a:115c:a1e0::/48`），
  P0-2 的动态发现分支可删除，`docs/macos-tun-tailscale.md` 的「待办 T1」按缩减后重写。
- **若未绑定** → 必须维护最小排除集，并按第 6 节的判定树做动态发现与验收。
- 该问题**没有静态判定方法**（`IP_BOUND_IF` 不出现在 `lsof`/`netstat` 输出里）。
  先做源码与官方 issue 的只读调研；仍不确定时才考虑一次受控实验，实验前提见第 7 节。

## 5. 失败分级（替代「direct 否则失败」）

`tailscale ping` 与 `tailscale status` 的判据，按代价分四级：

| 等级 | 判据 | 代价量级 | 处置 |
| --- | --- | --- | --- |
| **A 正常** | `CurAddr` 非空，`ping … via <IP>:<port>` | 7ms（本机实测） | 通过 |
| **B 降级** | `ping … via DERP(home-sh)` | 约 12ms 单程 + 单 TCP 流带宽上限（未实测端到端） | 告警；持续则排查是否被改写端点 |
| **C 不可接受** | `via DERP(<跨区>)` 或 `CurAddr` 为空且 RTT > 100ms | 200ms+（`sea` 208ms 实测） | 判定失败，回滚 |
| **D 事故** | `ping` 超时 / inbound SSH 断开 | — | 立即回滚，走本地恢复入口 |

两点必须保留在判定里：

- **`MappingVariesByDestIP: true`（对称 NAT）**意味着打洞本身就更脆，被改写后恢复
  direct 的难度高于普通 NAT；B 级不该被当成永久可接受状态。
- 「SSH 还能连」不是判据。B 级（DERP）同样能连 SSH，但已经是降级。

## 6. mesh VPN + 全域代理共存：一般判定树

适用于 Tailscale / ZeroTier / Cloudflare Tunnel / WARP 这类「无 WAN 端口、靠出站
发起的长连接维持入站」的方案：

1. 本机是否同时是某 mesh VPN 的 peer（有入站依赖）？是 → 该 VPN 的 underlay 必须有
   旁路，优先级：**socket 绑定 > 精确 `/32` > 网关化**。
2. 旁路是否覆盖「打洞 keepalive」与「DERP 回退」两条路径？只覆盖 peer IP 不够。
3. 验收口径是否以 **`CurAddr` 非空 + `ping via <IP>:<port>`** 为准，而非「能连」？
4. 能否网关化简化？**有入站依赖 → 不能。**
5. 上游 IPv6 状态是否已记录？启用 IPv6 会引入不在排除表内的新 underlay 路径。

## 7. 分阶段行动

### P0-1（只读，先做）

判定官方 App outer socket 的绑定行为：查 `netns_darwin.go` 的调用路径、官方 issue、
以及本机可见证据（`lsof`、`netstat -anv`、`scutil`）。**不启 TUN、不改配置、不装包。**
结论决定 P0-2 的规模。

### P0-2（条件性，取决于 P0-1）

若需要排除表：只排除**已确认端点**的 `/32`（本轮观测为 `10.8.1.172`、
`10.55.26.45`、`10.55.26.163`、`223.166.74.97`、`223.167.75.56`），每条记录必须带
**时间戳、接口、IP、来源**；集合并入 `desiredFiles`，因为
`route-exclude-address` 是 Verge GUI 强制字段（`constants.rs:73`），手改运行文件无效。
顶层 `interface-name` 只约束 mihomo 自身 socket，且不能写死 `en0`；物理出口与
corp172 的 Tailnet 出口必须分层绑定，且用三方交叉确认排除空壳 utun。

### P0-3（无条件，必须做）

事务与本地恢复：持久 journal（`prepared → applied → verifying → committed`）、独立
watchdog、总超时、SIGINT/SIGTERM 尽力回滚、`restore()` 改为**先关 TUN 再动
Tailscale**、陈旧事务恢复。现有实现只在 `catch` 得到的失败上可靠，`SIGKILL` 或
`lastBackup` 过期会停在「TUN 已开」的中间态。恢复入口必须能在本地控制台执行。

### P0-4（无条件）

把第 5 节的 A/B/C/D 分级与第 6 节判定树固化进 `scripts/check-macos-proxy-mode.mjs`：

- TUN 分支当前缺少 Tailnet CONNECT 健康检查（Proxy 分支已有），必须补齐
- 增加 `tailscale ping` 路径解析（区分 `via IP:port` 与 `via DERP(...)`）
- 增加第 1 节的**前提校验**：inbound 可用性、公司 10/8 规则仍生效、上游 IPv6 状态

### P0-5：回归样例（需要人工输入）

需要至少一个「只能经 corp172 到达的真实 10.x 目标」作为过排除检测的回归目标。
**此项无法由代码生成，也不扫描内网。** 缺失时只能批准有限的人工值守试验。

## 8. 已推翻的旧结论（防误引）

| 旧结论 | 现状 |
| --- | --- |
| 「在办公网里 tailnet 是冗余路径」 | ❌ 撤回。仅在办公网这个观测点成立；本质是 corp172 网段无公网 IP |
| 「补 `route-exclude-address: 10.0.0.0/8`」 | ❌ 撤回。与 10/8 公司代理规则冲突，见第 3 节 |
| 「DERP 回退约 263ms 即中继罚」 | ❌ 撤回。263ms ≈ 到 `sea` 的距离（208ms）+ 对端到 `sea`；最近 DERP `home-sh` 仅 11.9ms |
| 「12ms peer-relay 可作为就近中转成本」 | ❌ 撤回。该路径经公司隧道，不能类推到异地 |
| 「经 `192.168.3.1` 说明同局域网」 | ❌ 撤回。默认网关对所有非本地目标都会出现，不能证明共网关系 |
| 「集成方案仅因版本滞后被否」 | ❌ 收窄表述。真实否决理由是身份/inbound 迁移，版本滞后是附加理由 |

## 9. 未验证声明

- **未实测**：开启 TUN 后的任何业务表现、`/32` 排除效果、官方 App 的 socket 绑定
  行为、DERP 回退后的端到端 RTT 与吞吐、换网/睡眠/IPv6 启用后的行为、离线恢复与
  `SIGKILL` 演练。
- **未执行**：`proxy-mode tun/proxy/rollback`、系统网络或 Clash 配置写入、
  Tailscale setter、任何安装或编译。第 7 节的行动项全部未开始。
- 第 2 节的数字是本机某一时刻的快照（12:4x–12:5x）；本机在此期间换过网络
  （09:30 观测到 `10.55.90.63/24`，12:48 为 `192.168.3.31/24`），任何跨时段的比较
  必须先确认接口与网关一致。
