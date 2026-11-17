# 按需公司 SSH 隧道

macOS 保留 Clash TUN，公司域名与 `10.0.0.0/8` 进入「🏢 公司内网」策略组。
默认 `DIRECT`，需要远程公司出口时才启用 SSH。本机不安装 LaunchAgent 或自动重连服务。

```bash
corp-tunnel on       # 启动并验证隧道，然后选择 corp172-ssh
corp-tunnel off      # 恢复 DIRECT，再关闭本命令管理的 SSH
corp-tunnel status  # 查看隧道和策略组状态
```

命令安装在 `~/.local/bin/corp-tunnel`，链接到仓库的
`scripts/corp-tunnel.mjs`。无需 sudo，不修改系统代理、TUN 或系统 DNS。

## 路径与配置

```text
Chrome → Clash TUN → 公司策略组
                      ├─ DIRECT：当前网络直接访问公司资源
                      ├─ corp172-proxy：原 Tailnet SOCKS 100.93.132.98:1080
                      └─ corp172-ssh：127.0.0.1:11080
                                          ↓ SSH 本地转发
                                     corp172-dev 的 127.0.0.1:1080
                                          ↓ 远端 SOCKS
                                       公司资源
```

共享订阅扩展为 `corp172-ssh` 提供本地 SOCKS5 `127.0.0.1:11080`，始终不绑定网卡；
原 `corp172-proxy` 保留为 Tailnet SOCKS，TUN 下仅这个旧出口动态绑定 Tailnet 接口。
SSH 通过既有 `corp172-dev` 主机别名连接；该别名当前使用 Tailscale 地址、端口 `22022`。
SSH 自身跟随系统 Tailscale 路由，按需 SSH 路径不依赖 Mihomo 的 Tailnet 出口。

公司的直接 DNS 查询使用 `10.8.100.121` / `10.8.121.121`，这两个地址始终走 DIRECT。
TUN 的公司域名仍返回 Fake-IP：选择本地 SOCKS 时由远端解析，DIRECT 时根据公司 DNS
策略重新解析。普通公网与 `ts.net` 的 DNS 设置保留。家庭/外网下关闭隧道，不能保证
公司内部资源可达；需要时执行 `corp-tunnel on`。

## SublinkPro 标准订阅

`templates/routing.yaml` 的公司组默认 DIRECT。标准 `sublink` 订阅里的
`corp172-proxy` 保留 SOCKS5 `100.93.132.98:1080`，新增独立节点 `corp172-ssh`
使用 SOCKS5 `127.0.0.1:11080`；两者由 SublinkPro 节点记录提供，策略组共有三项。
模板本身不内嵌节点凭据。小米路由器订阅不包含这两个公司节点。
刷新订阅只更新分流配置，不会自动启动 SSH；需要时仍执行 `corp-tunnel on`。
本机系统 DNS 和 TUN 开关继续由 `proxy-mode` 管理，订阅不修改操作系统设置。

## 生命周期和错误处理

- `on` 使用专用 SSH ControlMaster，通过 `-L` 映射现有远端 SOCKS 服务；只监听回环。
- 先验证本地 SOCKS 能访问 Spug，再选择公司代理，再验证 Clash 的完整公司访问路径。
- 重复 `on` 复用现有隧道；SSH 密钥需已可用，命令使用 BatchMode，不等待交互密码。
- `off` 先切 DIRECT 并清理该策略组的旧连接，再退出专用 SSH master。
- 切换策略组后仅关闭公司组的旧连接，其他连接不受影响。
- 验证失败时恢复此前策略；只关闭本次启动的 SSH，不关闭已有会话。
- Control socket 位于 `~/Library/Application Support/proxy-routing/corp-tunnel/control.sock`，
  父目录权限为 700。命令与 `proxy-mode` 共用事务锁，避免同时改路由。
- 远端断线后 SSH 的 ServerAlive 会结束连接；不后台自动重连。恢复网络后重新 `on`，
  或执行 `off` 回到 DIRECT。`status` 分别报告 master 是否运行与策略组选择。

模式切换保留公司组选择；首次从旧的远端 SOCKS 配置迁移时设为 DIRECT。
`proxy-mode` 仅在选中公司代理时检查公司服务，隧道未开启不阻止普通 TUN 使用。

## 2026-11-17 验证

在公司网络完成实际的 off → on → off：

- 隧道关闭时，公司主站 302、Spug 200、Google 200。
- 隧道开启时，经 TUN、本地 SOCKS 与 Clash 显式代理的公司访问均通过。
- 关闭后本地 11080 端口不再监听，策略组为 DIRECT，公司网站仍可访问。
- Bilinote 的 Tailnet HTTPS 入口正常返回认证重定向。

仓库检查覆盖启动前验证、重复启动、失败恢复、停止顺序和已有隧道保护。
