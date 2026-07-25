---
name: proxy-routing-ops
description: Maintain and deploy this proxy-routing repository across rules, providers, SublinkPro templates/subscriptions, Xiaomi ShellCrash, Clash/Mihomo, v2rayN, and Clash Verge Rev extension scripts. Use for list-only rule changes, template or policy-group changes, Git-to-Sublink rollout, router deployment, runtime verification, rollback, GeoSite compatibility issues, regional fallback groups, direct-route VPS protection, or diagnosing unexpected Mihomo groups.
---

# Proxy Routing Operations

Operate this repository as the source of truth for proxy rules and deployed configurations.

## Load project context

1. Read the repository `AGENTS.md` and the files directly involved in the requested change.
2. Read [references/runbook.md](references/runbook.md) before any SublinkPro or ShellCrash deployment.
3. If a SublinkPro API call is needed, also load and follow the sibling `sublinkpro` skill. Its write-confirmation and API content-type rules remain mandatory.
4. Inspect `git status -sb` before editing. Preserve unrelated user changes.

## Classify the change

Choose one workflow before editing:

- **List-only:** Add or remove entries while provider names, URLs, policy groups, and rule ordering stay unchanged.
- **Template:** Add/remove providers, change group behavior, rule order, DNS, TUN, ports, template text, or rule-source URL.
- **Runtime-only diagnosis:** Inspect generated output and device APIs without changing Git, SublinkPro, or the router unless the user requests a fix.

## List-only workflow

1. Update both `rules/<name>.list` and `providers/<name>.yaml`.
2. Keep their non-comment payloads identical.
3. Update `rules/v2rayn-routing.json` when that client consumes the same classification.
4. Validate YAML, JSON, pair equality, and `git diff --check`.
5. Commit and push Git.
6. Do not regenerate templates when provider names and URLs are unchanged. Refresh the provider only when immediate rollout is required.

## Template workflow

1. Update local source files first:
   - Standard Sublink: `templates/routing.yaml` + `templates/subconverter.ini`
   - Xiaomi ShellCrash: `templates/shellcrash-low-geosite.yaml` + `templates/subconverter-low-geosite.ini`
2. Ensure every `RULE-SET` key has a matching `rule-providers` entry and every target policy group exists.
3. Preserve routing order: private, ads, Windows Update, heavy traffic, Google, AI, Microsoft, GitHub, Telegram, bank, DMM, direct/proxy additions, domestic fallback, final match.
4. Validate locally, commit, push, and confirm new GitHub Raw URLs return `200`.
5. Update the matching SublinkPro template only after Git is reachable.
6. Render the subscription and inspect YAML, node names, groups, rules, and provider URLs.
7. Deploy ShellCrash only after rendered output passes.

Prefer ordinary rule generation with remote `RULE-SET`. Use remote expansion only for clients that lack rule-provider support or require a self-contained configuration.

## Project-specific invariants

- Keep Xiaomi ShellCrash free of active GeoSite rules. Its bundled `GeoSite.dat` has lacked both `dmm` and `geolocation-!cn`.
- Route DMM with `RULE-SET,dmm`; route Chinese domains with `cn-domain`; finish with `GEOIP,CN` and `MATCH`.
- Keep personal domains and all proxy-server IPs in `direct` to avoid proxying a proxy endpoint.
- Keep Xiaomi `🇯🇵 日本` as an ordered fallback: `日本01-Hy`, then `日本01`.
- Treat `GLOBAL` as a Mihomo built-in group. It is not a template leak and is ignored while mode is `Rule`.
- Keep `DediRock-LA` in the Xiaomi subscription and verify it after generation and deployment.
- Keep the Clash Verge Rev script’s company domains in its `companyDomains` array and DMM routing on `RULE-SET,dmm`.

## Safety and completion

- Never print, commit, or document SSH passwords, API keys, share tokens, node credentials, or full generated proxy YAML.
- Load Sublink credentials from the ignored `.env`; require mode `600`.
- Sublink and ShellCrash can transiently fail TLS/download operations. Retry boundedly; never bypass TLS verification with `-k`.
- ShellCrash may report fallback after validation failure while leaving the core stopped. Always verify the controller API after task `104`.
- If deployment fails, preserve the failed config, restore `config.yaml.bak`, restart, and verify the old core before continuing.
- Finish only after Git, Sublink rendered output, and device runtime state all agree with the requested outcome.
