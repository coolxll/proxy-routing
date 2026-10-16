#!/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
// User-level workaround; no repository dependencies or vendor file modifications.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROXY_KEYS = ['NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
export function mixedPort(body) {
  const match = body.match(/^mixed-port:\s*(\d+)\s*(?:#.*)?$/m);
  const port = Number(match?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Clash mixed-port is not a supported integer');
  return port;
}
export function proxyEnvironment(port, tailnet = null) {
  const bypass = new Set(['localhost', '127.0.0.1', '::1', '.local', '*.local',
    '100.100.100.100', 'fd7a:115c:a1e0::53']);
  const suffix = tailnet?.MagicDNSSuffix;
  if (suffix && /^[a-z0-9.-]+$/i.test(suffix)) {
    bypass.add(suffix); bypass.add('.' + suffix); bypass.add('*.' + suffix);
  }
  for (const peer of [tailnet?.Self, ...Object.values(tailnet?.Peer || {})]) {
    for (const ip of peer?.TailscaleIPs || []) bypass.add(ip);
  }
  const env = { NODE_USE_ENV_PROXY: '1', NO_PROXY: [...bypass].join(',') };
  env.no_proxy = env.NO_PROXY;
  for (const key of PROXY_KEYS.filter(k => /^(http|https|all)_proxy$/i.test(k))) env[key] = 'http://127.0.0.1:' + port;
  return env;
}
export function injectProxy(parent, server, proxy) {
  const env = { ...parent, ...server.env };
  PROXY_KEYS.forEach(k => delete env[k]);
  Object.assign(env, proxy);
  env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST = [...new Set([
    ...(env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST || '').split(',').filter(Boolean), ...PROXY_KEYS
  ])].join(',');
  return env;
}
function launch() {
  const home = os.homedir();
  const codexRoot = process.env.CODEX_HOME || path.join(home, '.codex');
  const metadataFile = path.join(codexRoot, '.tmp/bundled-marketplaces/openai-bundled/plugins/unified-computer-use/.codex-plugin/plugin.json');
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  if (!/^[a-zA-Z0-9._-]+$/.test(metadata.version || '')) throw new Error('Invalid installed CUA version');
  const manifestFile = path.join(codexRoot, 'plugins/cache/openai-bundled/unified-computer-use', metadata.version, '.mcp.json');
  const server = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).mcpServers?.cua_repl;
  if (!server || !path.isAbsolute(server.command || '') || !fs.existsSync(server.command) ||
      !Array.isArray(server.args) || !server.args.every(a => typeof a === 'string') ||
      !server.env?.CUA_REPL_NODE_REPL_PATH || !server.env?.NODE_REPL_TRUSTED_SERVICES) {
    throw new Error('Installed CUA transport changed; stop rather than guessing a replacement');
  }
  // A machine-level config may be read by another account: proxy injection is owner-only.
  if (process.env.CODEX_CUA_PROXY_OWNER_UID && String(process.getuid()) !== process.env.CODEX_CUA_PROXY_OWNER_UID) {
    process.execve(server.command, [server.command, ...server.args], { ...process.env, ...server.env });
    return;
  }
  const clashFile = path.join(home, 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml');
  const port = mixedPort(fs.readFileSync(clashFile, 'utf8'));
  // Optional Tailnet bypass discovery must not prevent CUA starting when Tailscale is unavailable.
  let tailnet = null;
  const result = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 });
  if (result.status === 0) { try { tailnet = JSON.parse(result.stdout); } catch {} }
  const env = injectProxy(process.env, server, proxyEnvironment(port, tailnet));
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ version: metadata.version, command: server.command, args: server.args,
      mixedPort: port, proxyKeys: PROXY_KEYS, trustedServicesPreserved: env.NODE_REPL_TRUSTED_SERVICES === server.env.NODE_REPL_TRUSTED_SERVICES,
      nodeRepl: env.CUA_REPL_NODE_REPL_PATH, repositoryDependency: false }, null, 2));
  } else {
    if (typeof process.execve !== 'function') throw new Error('This launcher requires Node.js with execve support');
    process.execve(server.command, [server.command, ...server.args], env);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { launch(); } catch (error) { console.error('CUA proxy launcher: ' + error.message); process.exitCode = 1; }
}
