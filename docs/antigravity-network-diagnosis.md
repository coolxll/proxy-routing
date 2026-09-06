# Google Antigravity 网络与地区错误排查

本文记录 2026 年 9 月 1 日对 macOS Antigravity、Clash Verge Rev 和 Google AI
出口的调查结果。重点处理以下现象：

- Gemini 网页可以正常打开；
- Antigravity 登录、账号信息和模型列表正常；
- 真正提交提示词时偶发失败，切换出口或重启后又可能恢复；
- 普通 `DIRECT` 流量保持不变，只对 Antigravity / Google AI 的关键链路约束出口地址族。

本文不包含节点凭据、订阅地址、认证 token 或 SSH 密码。

## 关键结论

Gemini 网页可用不能证明 Antigravity 模型调用可用。两者使用的入口和后端不同：

- Gemini Web 主要访问 `gemini.google.com`；
- Antigravity 的 language server 使用 `daily-cloudcode-pa.googleapis.com`，并在生成内容时调用
  `/v1internal:streamGenerateContent?alt=sse`；
- Antigravity 还会访问 `generativelanguage.googleapis.com`、`oauth2.googleapis.com`、
  `www.googleapis.com` 和产品配置、更新服务。

因此，OAuth 登录成功、`loadCodeAssist` 成功或模型列表可见，只能证明初始化链路正常。
地区判定、后端容量、账号配额映射和 SSE 流式请求问题通常要到真正发送提示词时才会暴露。

后续实测还确认：`日本01` 所在服务器具备 IPv6，代理 TCP 出口也会使用 IPv6，但 AGY
真实模型调用可以成功。因此，“服务器启用 IPv6”本身不是充分根因；更可能是特定出口地址、
IPv6 前缀或 Google 地区数据库结果不同。

## 本机验证结果

测试环境：

- macOS；
- Antigravity 2.11.0；
- Clash Verge Rev 使用系统 HTTP、HTTPS 和 SOCKS 代理；
- Clash TUN 未开启；
- `Google` 策略组可在日本和美国节点之间切换。

Antigravity 2.11.0 启动的 language server 明确包含以下参数：

```text
--api_server_url https://generativelanguage.googleapis.com
--cloud_code_endpoint https://daily-cloudcode-pa.googleapis.com
```

临时将 `Google` 策略切换到 `RN-美国02-Hy` 并重新启动 Antigravity 后，新连接包括：

```text
daily-cloudcode-pa.googleapis.com
generativelanguage.googleapis.com
oauth2.googleapis.com
www.googleapis.com
antigravity-unleash.goog
```

这些连接均正确命中 `Google -> RN-美国02-Hy`。启动日志出现：

```text
Auth succeeded, refreshing features and managers
initialized server successfully
```

这次测试只验证了认证、初始化和模型列表链路，没有提交实际模型对话，因此不能据此判断
`streamGenerateContent` 一定可用。测试完成后已恢复原来的日本策略。

## 已确认的历史故障

旧版 Antigravity 日志曾多次出现以下错误：

```text
Post "https://oauth2.googleapis.com/token": EOF
request failed: Post "https://daily-cloudcode-pa.googleapis.com/
v1internal:streamGenerateContent?alt=sse":
Post "https://oauth2.googleapis.com/token": EOF
```

这表明至少一部分历史故障不是账号未登录，而是 language server 刷新 OAuth token 时连接被
中断。缓存 token 尚未过期时应用可能继续工作，必须刷新时才失败，因此会表现为“有时候正常”。

旧日志默认位于：

```text
~/Library/Application Support/Antigravity/logs/
~/Library/Application Support/Antigravity IDE/logs/
```

Antigravity 2.11.0 的当前 language server 日志位于：

```text
~/Library/Logs/Antigravity/language_server.log
```

## 网上同类案例

Google AI Developers Forum 中存在多类与本机现象相符的报告：

1. Gemini 浏览器正常，但 Antigravity IDE 和 CLI 在执行 Agent 时失败：
   [Agent execution terminated due to error: Can't use CLI and IDE, but Gemini in a browser works](https://discuss.ai.google.dev/t/agent-execution-terminated-due-to-error-cant-use-cli-and-ide-but-gemini-in-a-browser-works/179283)
2. 位于支持地区、OAuth 与模型列表正常，但 `streamGenerateContent` 返回错误地区：
   [Antigravity IDE 2.5.5 - FAILED_PRECONDITION (400): User location is not supported in Spain](https://discuss.ai.google.dev/t/antigravity-ide-2-5-5-failed-precondition-400-user-location-is-not-supported-in-spain/180211)
3. Antigravity 的 Cloud Code 后端出现 HTTP 500 或登录、初始化异常：
   [Can't authenticate/logins - Antigravity](https://discuss.ai.google.dev/t/cant-authenticate-logins-antigravity/145397/12)
4. 配额看似充足，但模型调用返回 `MODEL_CAPACITY_EXHAUSTED`：
   [Agent terminated due to error: Model Capacity Exhausted](https://discuss.ai.google.dev/t/agent-terminated-due-to-error-model-capacity-exhausted/127316)
5. OAuth token 交换偶发 EOF 或连接重置：
   [OAuth2 errors this morning](https://discuss.ai.google.dev/t/oauth2-errors-this-morning/171616)
6. IPv4 与 IPv6 的地区数据库结果不一致：
   [User location is not supported for the API use](https://discuss.ai.google.dev/t/code-400-message-user-location-is-not-supported-for-the-api-use-status-failed-precondition/61327)

这些是社区案例，不等于 Google 对本机问题的正式根因确认，但可以证明“网页正常而 Antigravity
失败”和“同一账号、网络偶发恢复”并非孤立现象。

## 错误分类

发生失败后应立即查看 `language_server.log`，不要只测试 Gemini 网页。

| 日志错误 | 更可能的原因 | 首要检查 |
| :--- | :--- | :--- |
| `FAILED_PRECONDITION: User location is not supported` | Antigravity 后端地区误判 | 实际出口 IP、IPv4/IPv6、是否存在旧连接 |
| `MODEL_CAPACITY_EXHAUSTED` | Google 模型后端容量不足 | 更换模型、稍后重试，避免立即认定 IP 被封 |
| `RESOURCE_EXHAUSTED` | 配额或账号层级映射 | Antigravity 配额页面、账号类型、模型选择 |
| `PERMISSION_DENIED` / HTTP 403 | 账号授权、项目或风控 | OAuth 状态、账号、出口稳定性 |
| HTTP 500 / 502 / 503 | Cloud Code 后端故障 | 对比其他用户报告，保留 Trace ID |
| `EOF` / `unexpected EOF` / `connection reset` | OAuth、HTTP/2 或代理链路中断 | 代理连接、节点切换、旧连接、服务器日志 |
| `context deadline exceeded` | 后端响应慢或长连接超时 | 节点延迟、SSE 连接、服务端容量 |

快速检查命令：

```bash
rg -n -i \
  'streamGenerateContent|FAILED_PRECONDITION|MODEL_CAPACITY_EXHAUSTED|RESOURCE_EXHAUSTED|PERMISSION_DENIED|EOF|connection reset|HTTP (400|403|429|500|502|503)' \
  "$HOME/Library/Logs/Antigravity/language_server.log"
```

## 正确的节点 A/B 测试

Antigravity、Chrome 和 Google 服务会保持 HTTP/2、WebSocket 或 SSE 长连接。仅在 Clash 中
切换策略不会迁移已经建立的连接，旧连接可能继续使用原出口，新连接使用新出口，从而出现同一
应用混用两个 IP 的情况。

每次测试应按以下顺序执行：

1. 完全退出 Antigravity，确认 language server 进程已经退出；
2. 在 Clash 中切换 `Google` 策略；
3. 在 Clash 连接页面关闭已有 Google 连接，必要时重启 Mihomo 核心；
4. 重新启动 Antigravity；
5. 不只观察登录和模型列表，实际发送一个最小提示词；
6. 立即保存 `language_server.log` 中的错误代码、URL 和 Trace ID；
7. 使用同样步骤测试下一个出口，避免旧连接污染结果。

可以用下面的命令确认 language server 是否仍在运行以及当前目标端点：

```bash
pgrep -afil '/Applications/Antigravity.app/Contents/Resources/bin/language_server'
```

输出可能包含本地 CSRF 或 bridge token，不要把完整输出提交到仓库或发送到公开渠道。

## AGY 关键域名指定地址族出口设计

客户端 Clash 的 `ipv6` 开关不能约束远端代理服务器的最终出口。目标是在不关闭服务器 IPv6、
不影响其他代理流量的前提下，根据 Google 对各节点地址的实际地区判定，为 AGY 关键链路指定
可用的地址族：

```text
Mac DIRECT --------------> 本地 IPv4，不经过 RN

Antigravity -------------> Clash Google 策略
                           -> 代理服务器入站
                           -> agy-direct-v4 / agy-direct-v6

服务器其他代理流量 ------> 原有 direct / WARP 出站
```

这里的 `DIRECT` 是客户端本地直连，与服务器上的 AGY 专用 direct outbound 不是同一个概念。
客户端 `DIRECT` 流量不会到达这些代理服务器，因此增加 AGY 专用出站不会影响本地直连流量。

不要直接修改全部 Google 流量。只匹配 Antigravity 的关键链路：

```text
daily-cloudcode-pa.googleapis.com
cloudcode-pa.googleapis.com
generativelanguage.googleapis.com
oauth2.googleapis.com
www.googleapis.com
gemini.google.com
aistudio.google.com
```

服务端应满足：

- RN 和 la-tri 使用独立的 `agy-direct-v4` direct outbound，以 `ipv4_only` 解析；
- DediRock 使用独立的 `agy-direct-v6` direct outbound，以 `ipv6_only` 解析；
- 上述精确域名在通用规则之前进入对应的 AGY 专用出站；
- 其他域名继续使用服务器原有 direct、WARP 或 DNS 策略；
- 修改前备份 sing-box 配置，使用服务器自身的 sing-box 二进制检查后再重启服务。

## 服务端落地结果

RN 和 la-tri 使用 `agy-direct-v4`，DediRock 使用 `agy-direct-v6`。实际请求日志确认
`daily-cloudcode-pa.googleapis.com`、`www.googleapis.com`、`gemini.google.com` 和
`aistudio.google.com` 命中对应出站：

- `RN-美国02`、`RN-美国02-Hy` 和 `RN-美国02-CFCDN` 的真实提示词测试成功；
- `VMiss-美国Tri`、`VMiss-美国Tri-Hy` 的真实提示词测试成功；
- `DediRock-LA` 的 AGY CLI 曾在 IPv4 专用出站下完成真实提示词测试；后续远端检测确认 Google
  将其 IPv4 判断为 `CHN` 并关闭 Gemini 功能，而 IPv6 判断为 `USA` 并启用 Gemini，因此已将
  这组精确域名改为 `agy-direct-v6`；
- 客户端临时选择 `DediRock-LA` 后访问 `/app`，页面返回 Gemini 功能标记 `true` 和地区 `USA`，
  DediRock 日志同时确认连接命中 `outbound/direct[agy-direct-v6]`；
- RN sing-box 进程采样到 AGY 测试期间的 443 连接为 IPv4，未采样到 IPv6 443 连接。
- Gemini 和 AI Studio 网页入口的 HTTP 200 只能证明传输链路可达，不能替代登录态页面的
  地区资格检查。

`RN-3X-Vless` 由 3x-ui / Xray 管理，原配置将该入站全部送入 WARP。曾分别测试 Freedom
`UseIPv4` 和独立 WARP `ForceIPv4` 出站，但 `loadCodeAssist` 都稳定返回 EOF，因此两种改动均
已回滚，保留原 WARP 路由。不要把这一路径标记为已修复。

这些测试执行时，未修改 Clash 的全局 IPv6 开关，也未修改 `google.list`、SublinkPro 模板或
其他客户端规则。完成登录态网页对照后，`Google` 策略改为 `RN-美国02-Hy`。

## 当前判断

现有证据不支持“所有洛杉矶 IP 都被 Gemini 封禁”的结论。更符合现象的组合是：

1. `streamGenerateContent` 使用独立于 Gemini Web 的 Cloud Code 后端；
2. Antigravity 后端存在地区误判、容量不足或服务端 5xx；
3. OAuth token 刷新和 SSE 长连接曾在本机出现 EOF；
4. 切换节点但未清除旧连接时，应用可能混用多个出口；
5. 日本 IPv6 出口可用，说明问题不能简化为“IPv6 必然触发 400”；
6. Google 将 DediRock IPv4 判断为 `CHN`、IPv6 判断为 `USA`；该节点的 Google/AGY 精确域名
   应固定 IPv6，不能套用 RN 和 la-tri 的 IPv4 策略；
7. 重启或更换节点后暂时恢复，不足以证明原出口 IP 被永久封禁。

后续服务器地址族调整必须以真实提示词请求为验收标准，不能只以登录、模型列表或
`gemini.google.com` 返回 HTTP 200 作为成功依据。
