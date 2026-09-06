# Resin purpose probe

This dependency-free Node.js CLI scans the healthy-node union of two Resin
instances and maintains the `GoogleAI` and `OpenCode` Platforms.

```bash
node tools/resin-purpose-probe/probe.mjs scan --config config.json
node tools/resin-purpose-probe/probe.mjs scan --config config.json --dry-run
node tools/resin-purpose-probe/probe.mjs scan --config config.json --limit 10
```

Copy `config.example.json` to an ignored local `config.json` and adjust only
connection metadata. Secrets must use an environment variable or a command
that writes the secret (or an env file containing it) to stdout. Literal token
fields are not supported.

`--dry-run` performs real probes and temporary Platform lifecycle operations,
but does not change `GoogleAI` or `OpenCode`. A limited scan is considered
partial and also preserves the target Platforms. `--allow-empty` only affects a
complete scan and permits a purpose Platform to be emptied when no node passes.

Runtime output is written to the ignored `data/latest.json` and
`data/history.jsonl`. Temporary Platforms use the `PurposeProbe-` prefix and
are cleaned both at startup and after each worker exits.

The Resin API must support the Platform field
`passive_circuit_breaker_disabled`. The CLI refuses to probe on older versions
because failed capability requests could otherwise change a node's global
circuit-breaker state.
