# Proxy Routing Deployment Runbook

## Contents

1. Repository map
2. Validation
3. SublinkPro rollout
4. Xiaomi ShellCrash rollout
5. Runtime verification
6. Recovery
7. Lessons and diagnostics

## Repository map

| Target | Template text | Rule source | Sublink subscription |
| :--- | :--- | :--- | :--- |
| Standard Clash/Mihomo | `templates/routing.yaml` | `templates/subconverter.ini` | `sublink` |
| Xiaomi ShellCrash | `templates/shellcrash-low-geosite.yaml` | `templates/subconverter-low-geosite.ini` | `xiaomi 路由器` |

Rule formats:

- `rules/*.list`: text/classical rule-provider input used by templates and mobile clients.
- `providers/*.yaml`: YAML payload form used by direct Mihomo/Clash references.
- `rules/v2rayn-routing.json`: ordered v2rayN remote routing rules.

Important deployed resources:

- Sublink template files: `routing.yaml`, `xiaomi-shellcrash.yaml`
- Xiaomi router: `192.168.3.1`
- ShellCrash persistent root: `/data/clash`
- ShellCrash runtime root: `/tmp/ShellCrash`
- Mihomo controller exposed by ShellCrash: `http://192.168.3.1:9999`

## Validation

Run baseline checks:

```bash
git diff --check
ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f) }' providers/*.yaml templates/*.yaml
jq empty rules/v2rayn-routing.json
node --check scripts/clash-verge-rev-smart-dns.js
```

For a list/provider pair:

```bash
ruby -ryaml -e '
name=ARGV.fetch(0)
r=File.readlines("rules/#{name}.list", chomp:true).reject{|x| x.empty? || x.start_with?("#")}
p=YAML.load_file("providers/#{name}.yaml")["payload"]
abort "#{name} mismatch" unless r==p
puts "#{name}: #{r.length} identical rules"
' dmm
```

For a template, parse it and compare its `RULE-SET` keys with `rule-providers`. Also verify every rule target refers to a defined group, `DIRECT`, or `REJECT`.

After pushing, check every newly added Raw URL:

```bash
curl --retry 3 --retry-all-errors -L -fsS -o /dev/null \
  https://raw.githubusercontent.com/coolxll/proxy-routing/main/rules/example.list
```

Do not use `curl -k`. A transient Sublink TLS error has resolved on bounded retry; disabling certificate validation would hide a real certificate problem.

## SublinkPro rollout

Load credentials without printing them:

```bash
set -a
. ./.env
set +a
```

Before a write:

1. `GET /api/v1/template/get`
2. Select the exact filename and inspect current `category`, `ruleSource`, `useProxy`, and `enableIncludeAll`.
3. Follow the `sublinkpro` skill’s confirmation requirement.

Update template fields with form encoding:

```text
filename=<remote filename>
oldname=<same current filename>
text=<matching local template file>
category=clash
ruleSource=<matching GitHub Raw INI URL>
useProxy=false
proxyLink=
enableIncludeAll=false
```

Check the response body’s `.code == 200`; HTTP `200` alone is not success. Fetch templates again and compare remote text to local text. Use `jq -j` for exact string output so an extra newline does not cause a false diff.

Find the matching subscription via `GET /api/v1/subcription/get`, then its enabled share via `GET /api/v1/shares/get?subId=<id>`. Consume `/c/` internally and parse the YAML. Never print or return the token.

Rendered-output checks:

- Expected proxy count and key node names
- Policy-group type, members, and order
- Rule order and targets
- Required provider keys and URLs
- No proxy credentials in logs or responses

The standard and Xiaomi subscriptions may contain different node counts. Validate required names instead of assuming counts must match.

## Xiaomi ShellCrash rollout

The router’s legacy SSH server requires RSA compatibility:

```bash
ssh -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  root@192.168.3.1
```

Do not store its password in the repository or skill.

Run the configured subscription update:

```bash
/data/clash/task/task.sh 104
```

Task output prints the full subscription URL. Treat it as a secret: do not repeat it in commentary, final responses, files, or commits. Do not refresh/rotate the share token without explicit user confirmation because that breaks existing clients.

The task may return to the shell without an explicit success line after downloading. Verify the controller instead of inferring success from console output.

## Runtime verification

Basic checks from the maintenance computer:

```bash
base=http://192.168.3.1:9999
curl -fsS "$base/version" | jq .
curl -fsS "$base/configs" | jq '{mode}'
curl -fsS "$base/rules" | jq '.rules'
curl -fsS "$base/providers/rules" | jq '.providers'
curl -fsS "$base/proxies" | jq '.proxies'
```

Provider counts are in `.providers.<name>.ruleCount`, not an embedded `.rules` array.

Required Xiaomi state:

- Core version responds and mode is `rule`.
- No rule has type `GeoSite`.
- `dmm`, `cn-domain`, and `direct` providers have nonzero `ruleCount`.
- `direct.ruleCount` covers personal domains plus all VPS `/32` rules.
- `DediRock-LA` exists and is alive when connectivity is available.
- `🇯🇵 日本` is:

  ```yaml
  type: fallback
  proxies:
    - 日本01-Hy
    - 日本01
  ```

- Runtime API reports group type `Fallback`, member order unchanged, and current selection `日本01-Hy` while healthy.

`GLOBAL` always appears in the Mihomo proxies API even though it is absent from `proxy-groups`. It is a core-provided selector for Global mode. Do not attempt to delete it; confirm `/configs` reports `mode: rule`.

## Recovery

On template validation failure, first verify whether the controller is alive:

```bash
curl --connect-timeout 5 -fsS http://192.168.3.1:9999/version
```

If the core is down, preserve the failed file and restore the previous configuration:

```bash
failed_stamp=$(date +%Y%m%d-%H%M%S)
cp /data/clash/yamls/config.yaml \
  /data/clash/yamls/config.yaml.failed-$failed_stamp
cp /data/clash/yamls/config.yaml.bak \
  /data/clash/yamls/config.yaml
/data/clash/start.sh start
```

Verify `/version` before attempting another deployment. Keep failed artifacts for diagnosis; do not overwrite or delete them casually.

## Lessons and diagnostics

### GeoSite compatibility

Do not assume specialized tags exist in ShellCrash’s bundled database. This router rejected:

- `GEOSITE,dmm`
- `GEOSITE,geolocation-!cn`

The reliable Xiaomi design is:

1. Dedicated remote lists for private, ads, service groups, DMM, direct, and proxy.
2. ACL4SSR `ChinaDomain.list` as `cn-domain`.
3. `GEOIP,CN,DIRECT`.
4. `MATCH` as the final foreign/default policy.

The standard `routing.yaml` may retain GeoSite because it targets current desktop Mihomo clients; do not copy those rules into the Xiaomi low-GeoSite template.

### Regional groups

`include-all + filter` filters actual proxies but explicit `proxies` entries are also retained. Adding parent groups such as `🚀 节点选择` or `♻️ 自动选择` therefore pollutes a regional selector.

When strict failover priority matters, avoid dynamic filtering and list the exact proxies in order. A Mihomo `fallback` selects the first healthy member, not the lowest-latency member.

### Git and remote ordering

Always deploy in this order:

1. Edit and validate local sources.
2. Commit and push Git.
3. Confirm Raw URLs return `200`.
4. Update Sublink template.
5. Render and validate subscription.
6. Update ShellCrash.
7. Verify runtime API.

Reversing Git and Sublink steps can produce stale rules or Raw `404` failures. A list-only change does not require template regeneration when the provider URL and name remain stable.
