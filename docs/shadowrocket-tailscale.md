# Shadowrocket + Tailscale 配置

Shadowrocket 2.2.89 及以上版本提供内置的 Tailscale 全局隧道。iOS 只运行 Shadowrocket
这一条系统 VPN；不要同时启动官方 Tailscale App。

## 准备节点和配置

1. 在 Shadowrocket 中保留或添加现有代理节点订阅。
2. 导入 `templates/shadowrocket-tailscale.conf`，并将它设为当前配置。
3. 配置中的策略组使用 `include-all-proxies=1`，会自动纳入 Shadowrocket 中已有的订阅节点。

远端配置地址：

```text
https://raw.githubusercontent.com/coolxll/proxy-routing/main/templates/shadowrocket-tailscale.conf
```

## 加入 Tailnet

1. 在 Tailscale 管理控制台创建一次性、预授权的 auth key。不要把 key 写进配置文件或仓库。
2. 打开 Shadowrocket 的 `设置` > `Tailscale`。
3. 填入 auth key；使用官方 Tailnet 时保持控制服务器 URL 为默认值。
4. 启用 Tailscale，确认设备出现在 Tailscale Machines 页面。
5. 默认不要选择出口节点。只有明确需要让全部互联网流量经某台 Tailnet 设备时才启用。

Shadowrocket 会持久化设备状态。auth key 完成首次注册后无需保留；若创建的是一次性 key，
它在使用后会自动失效。

## 路由规则

配置把以下规则放在 `private.list` 之前：

```ini
DOMAIN-SUFFIX,ts.net,TAILSCALE
IP-CIDR,100.64.0.0/10,TAILSCALE,no-resolve
IP-CIDR6,fd7a:115c:a1e0::/48,TAILSCALE,no-resolve
```

这保证 Tailnet IP、`*.ts.net` 和 MagicDNS 解析结果进入内置 Tailscale 隧道。之后才匹配现有
private、广告、Windows Update、大流量、Google、AI、Microsoft、GitHub、Telegram、银行、
DMM、direct、proxy、中国域名和 GeoIP 规则。

不要在 Shadowrocket 的 `tun-excluded-routes`、TUN 旁路或其他跳过 VPN 的设置中加入
`100.64.0.0/10`。也不要开启会排除简单主机名的配置项，否则 MagicDNS 短名称可能绕过隧道。

## Tailscale 子网路由

只访问 Tailnet 设备自身的 `100.x` 地址时，不需要额外设置。

若需要通过 subnet router 访问 `192.168.3.0/24`：

1. 在 Shadowrocket `设置` > `Tailscale` 中启用“使用 Tailscale 子网”。
2. 在配置的 Tailscale 规则后、`private.list` 前加入：

   ```ini
   IP-CIDR,192.168.3.0/24,TAILSCALE,no-resolve
   ```

3. 重新应用配置并测试目标地址。

如果手机当前也连接在相同的 `192.168.3.0/24` 局域网，这条规则仍会优先选择 Tailscale。
需要本地 Wi-Fi 优先时，应为家庭 Wi-Fi 使用另一份不含该 subnet 规则的配置或场景。

## 检查

- Shadowrocket 的 Tailscale 页面能看到本机 Tailnet IP 和 peer。
- `100.x` peer 地址可访问。
- `device.tailnet-name.ts.net` 和 MagicDNS 短名称可解析。
- 普通网页仍按现有代理策略分流。
- DMM 命中日本组，Windows Update 默认直连。
