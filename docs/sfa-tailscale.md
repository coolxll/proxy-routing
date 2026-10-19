# SFA + Tailscale 配置

这套配置用于 Android：SFA 建立系统唯一的 VPN，同时由 Sing-box 内置 Tailscale endpoint
接入 Tailnet。桌面端继续使用 Clash Verge，不受影响。

## 要求

- SFA / Sing-box 1.14.0 或更高版本；配置使用 1.14.0 新增的 Tailscale
  `accept_search_domain`，支持用 MagicDNS 短主机名访问设备。
- 仓库根目录的 `.env` 已配置 `SUBLINK_BASE_URL` 和 `SUBLINK_API_KEY`。
- `rules/sing-box/*.json` 已提交并推送到 GitHub，供 SFA 作为远端 source rule-set 拉取。

## 生成

先从现有 Clash classical list 生成 Sing-box rule-set：

```bash
node scripts/build-sing-box-rule-sets.mjs
```

再从 SublinkPro 读取当前节点并生成 SFA 配置：

```bash
node scripts/build-sfa-config.mjs
```

输出文件是 `dist/sfa-tailscale.json`。它包含代理节点凭据，因此目录已加入 `.gitignore`，
文件权限固定为 `600`，不得上传到 Git、网盘或公开订阅。

远端规则集使用 `http_client: "direct-http"`，不再使用已弃用的 `download_detour`。
该 HTTP client 不设置 `detour`，默认直接连接；不要添加 `detour: "direct"`，
新版内核会拒绝 detour 到没有拨号选项的 direct outbound。

### 自动发布到 GitHub Secret Gist

加 `--publish` 参数可以自动将配置上传到 GitHub secret gist，方便 SFA 通过 Remote Profile
远端拉取（只需首次扫码，之后自动更新）：

```bash
node scripts/build-sfa-config.mjs --publish
```

首次运行会创建新的 secret gist 并将 `SFA_GIST_ID` 保存到 `.env`；后续运行自动更新同一
gist。需要预先安装并登录 [GitHub CLI](https://cli.github.com/)（`brew install gh && gh auth login`）。

如果安装了 `qrencode`（`brew install qrencode`），脚本会在终端显示二维码供 SFA 扫描添加
Remote Profile。

## 导入和登录

1. 在 Android 安装 SFA 1.14.0 或更高版本。
2. 将 `dist/sfa-tailscale.json` 作为本地配置导入 SFA，或使用 `--publish` 生成远端 URL
   后通过 Remote Profile 扫码添加（推荐，支持自动更新）。
3. 启动一次配置，然后打开 `Tools` > `Endpoints` > `tailscale` 完成交互登录。
4. 回到配置页重新启动，检查普通网站、Tailnet IP、`*.ts.net` MagicDNS 名称和短主机名。

配置不保存 Tailscale auth key；登录状态由 SFA 的 `tailscale` state directory 持久化。

`derp-sh` 位于家庭 NAT 后，路由器对 `derp-sh.229929605.xyz` 提供内网 split DNS
结果。配置会先把该短名称和完整域名交给 `dns-local`，使用 Android 当前网络的路由器
DNS，避免公共 DoH 返回公网 IP 后发生 NAT 回环。

`229929605.xyz` 默认走代理：除白名单主机外，其余子域（`komodo`、`beszel` 等
Cloudflare 主机）落到 `route.final` 的代理出口并由所选节点远端解析，缓解直连质量不稳。
白名单主机（`crn`、`rn`、`ss.jph2`、`claude`、`sublink`、`auth`、`travel`、`opencode`、`nav`）
使用 `direct` 出站与 `dns-cn`；`derp-sh` 单独使用 `direct-local` 与 `dns-local`，顺序在
白名单之前。新增同域主机时应先确认它是否依赖直连。

DNS 规则也会使用 `preferred_by: dns-tailscale`，自动采用 Tailscale 控制台下发的
MagicDNS 和 split DNS 域；这与上述路由器本地 split DNS 是两条独立路径。

普通公网域名的 AAAA 查询会返回空结果，让 Android 上的网页和应用固定使用 IPv4，避免
本机只获得名义上的公网 IPv6、但实际路径或代理出口 IPv6 不稳定时出现静态资源加载失败。
这条规则位于 Tailscale DNS、`*.ts.net` 和 MagicDNS 短名称规则之后，因此 Tailnet 名称
仍可解析为 IPv6，`fd7a:115c:a1e0::/48` 也继续路由到 Tailscale endpoint。

对于绕过系统 DNS、直接连接缓存或自带 DoH 返回的中国公网 IPv6 地址，路由规则会通过
`geoip-cn + ip_version: 6` 快速拒绝，使应用回退到 IPv4。该规则同样位于 Tailnet 路由
之后，不会拦截 Tailnet IPv6。

SFA 的 DNS 分类按流量路由的顺序生成，先命中的代理分类不会被后面的直连分类
提前解析。例如 `officeapps.live.com` 使用节点选择对应的远程 DNS，`swcdn.apple.com`
使用大流量组对应的远程 DNS，而 `login.live.com` 使用国内 DoH。

普通直连分类使用 `dns-cn`（阿里公共 DoH）。`direct` 出站也明确使用该解析器和 IPv4，
用于接收域名目标时的解析。家庭 DERP 的精确名称使用独立 `direct-local` 出站，
保留本地 split DNS；Tailnet 继续使用 Tailscale DNS 和 endpoint。

混合域名/IP 的 `apple`、`direct` 分类另生成 `apple-domains.json`、`direct-domains.json`，
供 DNS 引用，避免把 IP 条目当作 DNS 响应过滤条件。域名伴随文件同样每天远端刷新；
更新这两个分类时必须一起生成并推送。纯 IP 分类不参与域名 DNS 匹配。

TUN 排除地址保留代理节点 IP，并额外排除 mDNS 组播地址 `224.0.0.251/32` 和
`ff02::fb/128`，让无线 ADB 的局域网自动发现绕过 TUN。此设置不排除整个 Wi-Fi
网段，不改变 Tailscale 和公司内网路由。更新配置后需重启 SFA、重新开关无线调试，
再通过电脑上的 `adb mdns services` 验证；实际效果仍受 Android 系统的组播实现影响。

Google 分类的 A 查询使用 Fake-IP。连接进入 SFA 后恢复原始域名，由 Google 组所选的
VLESS / Hysteria2 / SOCKS 节点远端解析，因此商店 API、图标和下载 CDN 使用所选出口。
Google 的 HTTPS 查询返回空记录，避免地址提示绕过 Fake-IP；其他查询使用经 Google 组
出站的 Cloudflare DoH。Google 组选 `direct` 时，A 查询对应的连接由 `direct` 使用国内
DoH 解析，实际连通性取决于当前网络；其他远程 DNS 查询仍需要该网络能够连接 Cloudflare。
共享 UnBan 保留 ACL4SSR 风格的防误杀条目。SFA 对 `dl.google.com` 和
`googletraveladservices.com` 在 UnBan/广告规则前走 Google，保留广告例外并使用 Google 出口。

其他代理分类的远程 DNS 分别跟随节点选择、AI、大流量和日本组。普通真实 IP 的 DNS
响应启用 `reverse_mapping`，补充嗅探无法识别域名时的分流；绕过 SFA DNS 的查询和旧的
系统缓存仍可能无法恢复域名。更新配置后建议重启 SFA，重启正在验证的应用。

执行 `npm run validate` 会检查 SFA 的 DNS 优先级、直连解析、Google Play 域名、
域名伴随文件一致性和 Tailnet 路由；手机上的安装和更新仍需要实际验证。

## 可选设置

生成器支持以下环境变量：

```bash
# Tailnet 中显示的设备名
SFA_TAILSCALE_HOSTNAME=my-android

# 需要经 Tailscale subnet router 访问的网段，多个值用逗号分隔
SFA_TAILSCALE_ROUTES=192.168.3.0/24,10.20.0.0/16

# 额外强制交给 Tailscale DNS 的域名；控制台下发的 split DNS、标准 *.ts.net 和
# MagicDNS 短名称已经自动处理
SFA_TAILSCALE_DNS_DOMAINS=corp.example.com,home.arpa

# 绕过 TUN 的安卓应用包名列表（微信、支付宝等默认已排除；以 + 开头表示在默认列表基础上追加，否则为全量替换）
SFA_EXCLUDE_PACKAGES=+com.example.app,org.example.another
```

可以临时附加变量生成，不必写入 `.env`：

```bash
SFA_TAILSCALE_HOSTNAME=my-phone \
SFA_TAILSCALE_ROUTES=192.168.3.0/24 \
node scripts/build-sfa-config.mjs
```

`accept_routes` 已启用，但 Sing-box 路由仍需要知道哪些子网应送进 Tailscale endpoint，
所以 Tailnet 的 subnet routes 应同时填写到 `SFA_TAILSCALE_ROUTES`。这些规则位于现有
`private` 规则之前，避免 `192.168.0.0/16` 或 `10.0.0.0/8` 被提前直连。

## 当前分流映射

规则顺序与 Clash 模板一致：Tailscale、公司内网、私有地址、广告、Windows Update、大流量、Google、
AI、Microsoft、GitHub、Telegram、银行、DMM、额外直连/代理、中国域名和 GeoIP、最终兜底。
策略组采用精简架构，与 Clash 保持一致：包含【🚀 节点选择】、【♻️ 自动选择】、【Google】、【🤖 AI】、【⬇️ 大流量】、【🇯🇵 日本】6 个核心组，以及按需启用的【🏢 公司内网】；
Microsoft / GitHub / Telegram / 通用代理收敛至【🚀 节点选择】；Windows Update / Bank / 额外直连走内置 DIRECT。
【♻️ 自动选择】保留历史名称以兼容已有配置引用，实际为手动选择组，候选项排除内网与家宽节点
（`Home-Shanghai`、`corp172` 等）。

### Android 耗电优化

取消两个组的 URLTest，将【♻️ 自动选择】和【🇯🇵 日本】都改为手动 selector，
不再定时探测节点，也不自动切换出口。手动池优先默认选择 `DediRock-LA`，不存在时选择
首个公网节点；日本组默认选择首个日本节点。已有手动组的缓存选择仍然保留。
节点故障时需要手动选择其他节点；主动点击测速仍可产生探测流量。

默认绕过 TUN 的应用增加小红书、知乎和京东读书，减少国内流量在用户态转发的开销。
这些应用会直接使用当前网络，同时绕过 SFA 的 DNS、广告拦截与 Tailnet 分流。
钉钉需要公司内网，Google Play、Google 服务及下载管理器需要代理路径，继续留在 TUN 内。
日志默认只记录 warn 及以上级别；排障时可以临时恢复 info。保留 DNS/Fake-IP 缓存、
mixed 协议栈、现有节点、公司和 Tailscale 路由，不额外缩短保活或 UDP 超时。

这些设置减少可避免的网络探测和转发，实际省电幅度仍需在相同网络、亮度和使用行为下对照测量。


自有分类来自本仓库 `rules/sing-box/*.json`；广告、中国域名、非中国域名和中国 IP 使用
SagerNet 官方发布的二进制 rule-set。SFA 每天刷新一次远端规则。
