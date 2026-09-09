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

## 可选设置

生成器支持以下环境变量：

```bash
# Tailnet 中显示的设备名
SFA_TAILSCALE_HOSTNAME=my-android

# 需要经 Tailscale subnet router 访问的网段，多个值用逗号分隔
SFA_TAILSCALE_ROUTES=192.168.3.0/24,10.20.0.0/16

# Tailnet split DNS 域名；标准 *.ts.net 和 MagicDNS 短名称已经自动处理
SFA_TAILSCALE_DNS_DOMAINS=corp.example.com,home.arpa
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

规则顺序与 Clash 模板一致：Tailscale、私有地址、广告、Windows Update、大流量、Google、
AI、Microsoft、GitHub、Telegram、银行、DMM、额外直连/代理、中国域名和 GeoIP、最终兜底。

自有分类来自本仓库 `rules/sing-box/*.json`；广告、中国域名、非中国域名和中国 IP 使用
SagerNet 官方发布的二进制 rule-set。SFA 每天刷新一次远端规则。
