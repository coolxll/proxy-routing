#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_KEYS = ['NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
const WRAPPER = 'function main(config) {\n  return macosProxyConfig(config);\n}';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function readJson(file, fallback = null) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
export function atomicWrite(file, body, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, body, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  ENV_KEYS.forEach(key => delete env[key]);
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && value !== undefined) env[key] = value;
  }
  return env;
}
export function renderExtension(source, mode, tailscaleInterface) {
  if (!source.includes(WRAPPER)) throw new Error('Shared extension entry point is missing');
  return source.replace(WRAPPER, 'function main(config) {\n  return macosProxyConfig(config, ' +
    JSON.stringify({ mode, tailscaleInterface }) + ');\n}');
}
export function proxyEnvironment(port, tailnet) {
  const bypass = new Set(['localhost', '127.0.0.1', '::1', '.local', '*.local',
    '100.100.100.100', 'fd7a:115c:a1e0::53']);
  const suffix = tailnet.MagicDNSSuffix;
  if (!suffix || !/^[a-z0-9.-]+$/i.test(suffix)) throw new Error('MagicDNS suffix is unavailable');
  bypass.add(suffix);
  bypass.add('.' + suffix);
  bypass.add('*.' + suffix);
  for (const peer of [tailnet.Self, ...Object.values(tailnet.Peer || {})]) {
    for (const ip of peer?.TailscaleIPs || []) if (net.isIP(ip)) bypass.add(ip);
  }
  const env = { NODE_USE_ENV_PROXY: '1' };
  for (const key of ENV_KEYS.filter(key => /^(http|https|all)_proxy$/i.test(key))) {
    env[key] = 'http://127.0.0.1:' + port;
  }
  env.NO_PROXY = env.no_proxy = [...bypass].join(',');
  return env;
}
export function envValues(source) {
  const values = source || {};
  return Object.fromEntries(ENV_KEYS.map(key => [key, values[key] ?? null]));
}
export function envTarget(plan, state) {
  return plan.mode === 'proxy' ? envValues(plan.env) : envValues(state.baselineEnv);
}
export function envEquals(left, right) {
  const a = envValues(left), b = envValues(right);
  return ENV_KEYS.every(key => a[key] === b[key]);
}
export function derivedBaseline(envBefore, proxyEnv) {
  // Adopt the user's original values once. A leftover value equal to what we are
  // about to write is ours, not theirs, so it must not become the baseline.
  return Object.fromEntries(ENV_KEYS.map(key => [key,
    envBefore[key] !== null && envBefore[key] === proxyEnv[key] ? null : envBefore[key]]));
}
export function shellEnvironment(env) {
  // Consumed by eval; stdout carries exactly one line per key and nothing else.
  return ENV_KEYS.map(key => {
    const value = envValues(env)[key];
    return value === null ? 'unset ' + key :
      'export ' + key + "='" + value.replace(/'/g, "'\\''") + "'";
  }).join('\n') + '\n';
}
export const ZSHRC_BEGIN = '# BEGIN proxy-routing shell-env';
export const ZSHRC_END = '# END proxy-routing shell-env';
const ZSHRC_MANAGED = [
  ZSHRC_BEGIN,
  '# Managed by proxy-mode: only present in Proxy mode. It gives shells their own proxy',
  '# environment because launchctl setenv reaches the user domain only, while GUI terminal',
  '# apps (Ghostty, iTerm, VS Code) start from the gui domain and never inherit it.',
  '# Removed automatically when switching to TUN. Edit the switch script, not this block.',
  '# $commands only tracks executables, so accept the shell function from ~/.zshrc too.',
  '# Call the function directly: "command" would skip it and look for a binary.',
  'if (( $+functions[proxy-mode] || $+commands[proxy-mode] )); then',
  '  eval "$(proxy-mode shell-env 2>/dev/null)"',
  'fi',
  ZSHRC_END
].join('\n') + '\n';
export function renderZshrc(body, enabled) {
  // Idempotently insert or remove the managed block; the rest of the file is untouched.
  const start = body.indexOf(ZSHRC_BEGIN), end = body.indexOf(ZSHRC_END);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start) throw new Error('Unbalanced shell-env block in ~/.zshrc');
    // Drop the blank separator the insert added; the original trailing newline survives.
    body = body.slice(0, start).replace(/\n\n$/, '\n') +
      body.slice(end + ZSHRC_END.length).replace(/^\n/, '');
  }
  if (!enabled) return body;
  const trimmed = body.replace(/\s*$/, '');
  return (trimmed ? trimmed + '\n\n' : '') + ZSHRC_MANAGED;
}
function patchYaml(body, values) {
  const doc = YAML.parseDocument(body);
  if (doc.errors.length) throw new Error('Invalid source YAML');
  for (const [key, value] of Object.entries(values)) doc.set(key, value);
  return String(doc);
}
function snapshotFiles(files) {
  return Object.fromEntries(files.map(file => [file, fs.existsSync(file) ?
    { body: fs.readFileSync(file, 'utf8'), mode: fs.statSync(file).mode & 0o777 } : null]));
}
function restoreFiles(files) {
  for (const [file, saved] of Object.entries(files)) {
    if (saved) atomicWrite(file, saved.body, saved.mode);
    else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
function safeError(error) {
  return String(error.message || error).replace(/https?:\/\/[^\s]+/g, '<URL>')
    .replace(/(token|password|secret|uuid)[=:]\S+/gi, '$1=<redacted>').slice(0, 600);
}

export class MacHost {
  constructor(home = os.homedir()) {
    this.home = home;
    this.app = '/Applications/Clash Verge.app';
    this.socket = '/var/run/clash-verge-service/users/' + process.getuid() + '/verge-mihomo.sock';
  }
  command(cmd, args = [], options = {}) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 12000,
      maxBuffer: 8 * 1024 * 1024, env: cleanEnv(), ...options });
    if (result.error || result.status !== 0) {
      if (options.optional) return '';
      throw new Error(path.basename(cmd) + ' failed (' + (result.error?.code || result.status) + ')');
    }
    return result.stdout.trim();
  }
  environment() {
    return Object.fromEntries(ENV_KEYS.map(key => [key,
      this.command('/bin/launchctl', ['getenv', key], { optional: true }) || null]));
  }
  setEnvironment(env) {
    // Apply every key before reporting: a partial write still moves the global
    // environment toward the target, and rollback replays the full snapshot.
    const values = envValues(env), failed = [];
    for (const key of ENV_KEYS) {
      try {
        if (values[key] === null) this.command('/bin/launchctl', ['unsetenv', key]);
        else this.command('/bin/launchctl', ['setenv', key, values[key]]);
      } catch { failed.push(key); }
    }
    if (failed.length) throw new Error('launchctl environment update failed for: ' + failed.join(', '));
  }
  tailnet() { return JSON.parse(this.command('tailscale', ['status', '--json'])); }
  dnsAccepted() {
    return JSON.parse(this.command('tailscale', ['debug', 'prefs'])).CorpDNS;
  }
  setDnsAccepted(value) { this.command('tailscale', ['set', '--accept-dns=' + value]); }
  tailInterface(server) {
    const output = this.command('/sbin/route', ['-n', 'get', server]);
    const iface = output.match(/interface:\s+(\S+)/)?.[1];
    if (!/^utun\d+$/.test(iface || '')) throw new Error('Tailnet route does not use a utun interface');
    return iface;
  }
  appPid() { return this.command('/usr/bin/pgrep', ['-x', 'clash-verge'], { optional: true }); }
  chatgptPid() {
    // Match the executable path rather than helpers or the CLI app-server.
    return this.command('/bin/ps', ['-axo', 'pid=,comm='], { optional: true }).split('\n')
      .filter(line => /\/Applications\/ChatGPT\.app\/Contents\/MacOS\//.test(line))
      .map(line => line.trim().split(/\s+/)[0]).join(',');
  }
  async quit() {
    if (!this.appPid()) return;
    this.command('/usr/bin/osascript',
      ['-e', 'tell application id "io.github.clash-verge-rev.clash-verge-rev" to quit'],
      { timeout: 20000 });
    const end = Date.now() + 20000;
    while (this.appPid() && Date.now() < end) await wait(250);
    if (this.appPid()) throw new Error('Clash did not exit normally; no forced termination was attempted');
  }
  async start() {
    this.command('/usr/bin/open', ['-a', this.app]);
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      try { if (this.appPid() && await this.api('/configs')) return; } catch {}
      await wait(300);
    }
    throw new Error('Clash core did not become ready');
  }
  api(endpoint, method = 'GET', value) {
    return new Promise((resolve, reject) => {
      const body = value === undefined ? undefined : JSON.stringify(value);
      const req = http.request({ socketPath: this.socket, path: endpoint, method,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 300) return reject(new Error('Core API failed (' + res.statusCode + ')'));
          try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid core API response')); }
        });
      });
      req.setTimeout(4000, () => req.destroy(new Error('Core API timeout')));
      req.on('error', reject);
      req.end(body);
    });
  }
  async selections() {
    const data = await this.api('/proxies');
    return Object.fromEntries(Object.entries(data.proxies).filter(([, p]) => p.type === 'Selector' && p.now)
      .map(([name, p]) => [name, p.now]));
  }
  async restoreSelections(selected) {
    const current = (await this.api('/proxies')).proxies;
    for (const [group, name] of Object.entries(selected)) {
      if (current[group]?.type === 'Selector' && current[group].all?.includes(name)) {
        await this.api('/proxies/' + encodeURIComponent(group), 'PUT', { name });
      }
    }
  }
  network() {
    const global = this.command('/usr/sbin/scutil', [], { input: 'show State:/Network/Global/IPv4\nquit\n' });
    const serviceId = global.match(/PrimaryService\s*:\s*(\S+)/)?.[1];
    if (!serviceId) throw new Error('No active network service');
    const service = this.command('/usr/sbin/scutil', [], {
      input: 'show Setup:/Network/Service/' + serviceId + '\nquit\n'
    }).match(/UserDefinedName\s*:\s*(.+)/)?.[1]?.trim();
    if (!service) throw new Error('Active network service has no name');
    return { service, serviceId,
      dns: this.command('/usr/sbin/networksetup', ['-getdnsservers', service]),
      search: [...new Set([...this.command('/usr/sbin/scutil', ['--dns']).matchAll(/search domain\[\d+\]\s*:\s*(\S+)/g)].map(match => match[1]))],
      manualSearch: this.command('/usr/sbin/networksetup', ['-getsearchdomains', service]),
      proxy: this.command('/usr/sbin/scutil', ['--proxy']) };
  }
  validate(candidate, directory) {
    const result = spawnSync(this.app + '/Contents/MacOS/verge-mihomo',
      ['-t', '-d', directory, '-f', candidate],
      { encoding: 'utf8', timeout: 20000, env: cleanEnv() });
    if (result.error || result.status !== 0) throw new Error('Mihomo candidate validation failed');
  }
  async health(mode, port, env, tailnet) {
    const url = 'http://127.0.0.1:' + port;
    const checks = {};
    for (const [name, hostname, acceptable] of [
      ['github', 'github.com', [200]], ['chatgptTls', 'chatgpt.com', [200, 403]],
      ['company', 'spug.dongfangfuli.com', [200]]
    ]) {
      const args = ['-sS', '--connect-timeout', '4', '--max-time', '8',
        '-o', '/dev/null', '-w', '%{http_code}'];
      args.push(...(mode === 'proxy' ? ['--proxy', url, '--noproxy', ''] : ['--noproxy', '*']));
      const code = Number(this.command('/usr/bin/curl', [...args, 'https://' + hostname]));
      if (!acceptable.includes(code)) throw new Error(name + ' health check failed (' + code + ')');
      checks[name] = code;
    }
    const nodeCode = "Promise.all(['github.com','spug.dongfangfuli.com','ab.chatgpt.com'].map(async h=>" +
      "{const r=await fetch('https://'+h,{signal:AbortSignal.timeout(8000)});" +
      "console.log(JSON.stringify({host:h,status:r.status}));})).catch(()=>process.exitCode=1)";
    const output = this.command(process.execPath, ['-e', nodeCode],
      { env: cleanEnv(mode === 'proxy' ? env : {}), timeout: 12000 });
    const responses = output.split('\n').map(line => JSON.parse(line));
    if (responses.length !== 3 || responses.some(r => r.status !==
      (r.host === 'ab.chatgpt.com' ? 403 : 200))) throw new Error('Node fetch health check failed');
    checks.nodeFetch = responses;
    const address = await dns.lookup(tailnet.Self.DNSName.replace(/\.$/, ''));
    if (!tailnet.Self.TailscaleIPs.includes(address.address)) throw new Error('MagicDNS returned an unexpected address');
    checks.magicDns = true;
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '100.93.132.98', port: 22 });
      socket.setTimeout(5000);
      socket.once('data', data => {
        socket.destroy();
        data.toString().startsWith('SSH-') ? resolve() : reject(new Error('Tailnet SSH banner is missing'));
      });
      socket.once('error', reject);
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Tailnet SSH timeout')); });
    });
    checks.tailnetSsh = true;
    if (mode === 'proxy') {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port });
        let buffer = '';
        socket.setTimeout(7000);
        socket.on('connect', () => socket.write('CONNECT 100.93.132.98:22 HTTP/1.1\r\n' +
          'Host: 100.93.132.98:22\r\n\r\n'));
        socket.on('data', data => {
          buffer += data.toString();
          if (buffer.includes('\r\n\r\n') && buffer.split('\r\n\r\n').slice(1).join('\r\n\r\n').startsWith('SSH-')) {
            socket.destroy(); resolve();
          }
        });
        socket.on('error', reject);
        socket.on('end', () => { if (!buffer.includes('SSH-')) reject(new Error('Mihomo Tailnet CONNECT closed')); });
        socket.on('timeout', () => { socket.destroy(); reject(new Error('Mihomo Tailnet CONNECT timeout')); });
      });
      checks.tailnetViaMihomo = true;
    }
    return checks;
  }
}

export class ModeManager {
  constructor({ home = os.homedir(), root = ROOT, host = new MacHost(home), resolverRoot = '/etc/resolver' } = {}) {
    this.home = home; this.root = root; this.host = host; this.resolverRoot = resolverRoot;
    this.directory = path.join(home, 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev');
    this.stateRoot = path.join(home, 'Library/Application Support/proxy-routing/macos-mode');
    this.stateFile = path.join(this.stateRoot, 'state.json');
    this.lock = path.join(this.stateRoot, 'lock');
    this.source = path.join(root, 'scripts/clash-verge-rev-macos-tun-dns.js');
    this.zshrc = path.join(home, '.zshrc');
  }
  state() { return readJson(this.stateFile, {}); }
  discover() {
    const file = name => path.join(this.directory, name);
    const parse = name => YAML.parse(fs.readFileSync(file(name), 'utf8'));
    const profiles = parse('profiles.yaml');
    const selected = profiles.items.find(p => p.uid === profiles.current);
    const script = profiles.items.find(p => p.uid === selected?.option?.script);
    if (!selected || !script?.file || path.basename(script.file) !== script.file) {
      throw new Error('Current subscription has no usable extension script');
    }
    return { selected: profiles.current, script: path.join(this.directory, 'profiles', script.file),
      verge: parse('verge.yaml'), config: parse('config.yaml'), generated: parse('clash-verge.yaml'),
      vergeFile: file('verge.yaml'), configFile: file('config.yaml'), profilesFile: file('profiles.yaml') };
  }
  acquire() {
    fs.mkdirSync(this.stateRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.stateRoot, 0o700);
    try { fs.mkdirSync(this.lock, { mode: 0o700 }); }
    catch {
      const owner = readJson(path.join(this.lock, 'owner.json'));
      if (!owner?.pid) throw new Error('Another switch owns the transaction lock');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('Another switch is running');
      fs.rmSync(this.lock, { recursive: true });
      fs.mkdirSync(this.lock, { mode: 0o700 });
    }
    atomicWrite(path.join(this.lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
  }
  release() { fs.rmSync(this.lock, { recursive: true, force: true }); }
  async status() {
    const state = this.state(), files = this.discover(), env = this.host.environment();
    let runtime = null;
    try { runtime = await this.host.api('/configs'); } catch {}
    const actual = runtime ? (runtime.tun?.enable ? 'tun' : 'proxy') : 'unavailable';
    const network = this.host.network();
    const proxyEnabled = /HTTPEnable\s*:\s*1/.test(network.proxy) && /HTTPSEnable\s*:\s*1/.test(network.proxy);
    const target = state.mode === 'proxy' ? envValues(state.proxyEnv) : envValues(state.baselineEnv);
    return { expectedMode: state.mode || 'unmanaged', actualMode: actual,
      persistentTun: files.verge.enable_tun_mode, persistentSystemProxy: files.verge.enable_system_proxy,
      systemProxyEnabled: proxyEnabled, mixedPort: runtime?.['mixed-port'] ?? files.generated['mixed-port'],
      dns: network.dns, searchDomains: network.search,
      environmentManaged: ['proxy', 'tun'].includes(state.mode) && envEquals(env, target),
      environmentDrift: ['proxy', 'tun'].includes(state.mode) && !envEquals(env, target),
      nodeUseEnvProxy: env.NODE_USE_ENV_PROXY, tailscaleAcceptDns: this.host.dnsAccepted(),
      tailnetInterface: this.host.tailInterface('100.93.132.98'),
      corpInterface: files.generated.proxies?.find(p => p.name === 'corp172-proxy')?.['interface-name'] || null,
      magicDnsResolverPresent: fs.existsSync(path.join(this.resolverRoot, this.host.tailnet().MagicDNSSuffix)),
      shellHookInstalled: fs.existsSync(this.zshrc) && fs.readFileSync(this.zshrc, 'utf8').includes(ZSHRC_BEGIN),
      chatgptRestartRequired: false, chromeEndToEndVerified: false,
      lastChecks: state.checks || null, lastBackup: state.lastBackup || null };
  }
  async prepare(mode) {
    if (!['proxy', 'tun'].includes(mode)) throw new Error('Expected proxy or tun');
    const files = this.discover(), state = this.state(), tailnet = this.host.tailnet();
    if (tailnet.BackendState !== 'Running') throw new Error('Tailscale is not running');
    const resolver = path.join(this.resolverRoot, tailnet.MagicDNSSuffix || '');
    const resolverText = fs.existsSync(resolver) && fs.readFileSync(resolver, 'utf8');
    if (!resolverText || !/nameserver\s+100\.100\.100\.100/.test(resolverText)) {
      throw new Error('MagicDNS resolver is missing; install it before switching');
    }
    const port = files.verge.verge_mixed_port ?? files.generated['mixed-port'];
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid mixed proxy port');
    const source = fs.readFileSync(this.source, 'utf8');
    const corpServer = files.generated.proxies?.find(p => p.name === 'corp172-proxy')?.server || '100.93.132.98';
    const iface = mode === 'tun' ? this.host.tailInterface(corpServer) : undefined;
    if (iface === files.generated.tun?.device) throw new Error('Corp route incorrectly points into Clash TUN');
    const scriptBody = renderExtension(source, mode, iface);
    const context = vm.createContext({});
    vm.runInContext(scriptBody, context, { timeout: 2000 });
    context.input = structuredClone(files.generated);
    const candidate = vm.runInContext('main(input)', context, { timeout: 2000 });
    // Used for the isolated diagnostic child and, on success, for the global environment.
    const env = mode === 'proxy' ? proxyEnvironment(port, tailnet) : {};
    // Shell startup injection only exists in Proxy mode; TUN keeps shells clean.
    const zshrcBody = renderZshrc(fs.existsSync(this.zshrc) ?
      fs.readFileSync(this.zshrc, 'utf8') : '', mode === 'proxy');
    return { mode, files, candidate, scriptBody, port, iface, env, tailnet, zshrcBody };
  }
  desiredFiles(plan) {
    // Read again after normal exit, preserving unrelated settings saved during shutdown.
    const verge = YAML.parse(fs.readFileSync(plan.files.vergeFile, 'utf8'));
    const profileDns = { ...(verge.profile_dns_settings || {}) };
    profileDns[plan.files.selected] = { ...profileDns[plan.files.selected], enabled: false };
    return {
      [plan.files.vergeFile]: patchYaml(fs.readFileSync(plan.files.vergeFile, 'utf8'), {
        enable_tun_mode: plan.mode === 'tun', enable_system_proxy: plan.mode === 'proxy',
        proxy_auto_config: false, proxy_host: '127.0.0.1',
        profile_dns_settings: profileDns
      }),
      [plan.files.configFile]: patchYaml(fs.readFileSync(plan.files.configFile, 'utf8'), {
        mode: 'rule', tun: plan.candidate.tun
      }),
      [plan.files.script]: plan.scriptBody
    };
  }
  async verifyState(plan) {
    const runtime = await this.host.api('/configs'), files = this.discover();
    const network = this.host.network();
    if (runtime.mode !== 'rule' || runtime['mixed-port'] !== plan.port || !!runtime.tun?.enable !== (plan.mode === 'tun')) {
      throw new Error('Runtime mode differs from the requested mode');
    }
    const enabled = /HTTPEnable\s*:\s*1/.test(network.proxy) && /HTTPSEnable\s*:\s*1/.test(network.proxy);
    if (enabled !== (plan.mode === 'proxy')) throw new Error('System proxy did not reach the requested state');
    if (plan.mode === 'proxy') {
      for (const kind of ['HTTP', 'HTTPS']) {
        if (!new RegExp(kind + 'Proxy\\s*:\\s*127\\.0\\.0\\.1').test(network.proxy) ||
            !new RegExp(kind + 'Port\\s*:\\s*' + plan.port + '(?:\\s|$)').test(network.proxy)) {
          throw new Error('System proxy host or port does not match the mixed port');
        }
      }
    }
    if (plan.mode === 'proxy' && /(^|\n)114\.114\.114\.114(\n|$)/.test(network.dns)) {
      throw new Error('TUN placeholder DNS was not restored');
    }
    if (plan.mode === 'tun' && network.dns !== '114.114.114.114') throw new Error('Verge DNS override failed');
    if (this.host.dnsAccepted()) throw new Error('Tailscale DNS takeover is still enabled');
    const iface = files.generated.proxies?.find(p => p.name === 'corp172-proxy')?.['interface-name'];
    if (iface !== plan.iface) throw new Error('Generated corp172 interface differs from the mode configuration');
  }
  assertShellHook(plan) {
    const body = fs.readFileSync(this.zshrc, 'utf8');
    if (body !== plan.zshrcBody) throw new Error('Managed shell-env block in ~/.zshrc was not applied');
  }
  async verify(plan) {
    const end = Date.now() + 20000;
    while (true) {
      try { await this.verifyState(plan); break; }
      catch (error) { if (Date.now() >= end) throw error; await wait(250); }
    }
    return this.host.health(plan.mode, plan.port, plan.env, plan.tailnet);
  }
  async switch(mode, { dryRun = false } = {}) {
    if (dryRun) {
      const plan = await this.prepare(mode), state = this.state(), env = this.host.environment();
      const target = envTarget(plan, state);
      return { dryRun: true, mode, selectedSubscription: plan.files.selected, mixedPort: plan.port,
        corpInterface: plan.iface || null,
        environmentKeys: ENV_KEYS.filter(key => env[key] !== target[key]),
        targetEnvironment: target,
        restartClash: true, restartChatGPT: false };
    }
    this.acquire();
    let backup, stopped = false, mutated = false, environmentChangedAt;
    try {
      const plan = await this.prepare(mode), state = this.state(), envBefore = this.host.environment();
      environmentChangedAt = state.environmentChangedAt;
      const baselineEnv = state.baselineEnv || derivedBaseline(envBefore, envValues(plan.env));
      const target = envTarget({ ...plan, mode }, { baselineEnv });
      const changes = this.desiredFiles(plan);
      const sameFiles = Object.entries(changes).every(([file, body]) => fs.readFileSync(file, 'utf8') === body);
      let coherent = state.mode === mode && sameFiles && !!this.host.appPid() &&
        !this.host.dnsAccepted();
      if (coherent) {
        try { await this.verifyState(plan); } catch { coherent = false; }
      }
      const zshrcSame = fs.existsSync(this.zshrc) &&
        fs.readFileSync(this.zshrc, 'utf8') === plan.zshrcBody;
      if (coherent) {
        // A drifted global environment is repaired without restarting Clash.
        const sameEnv = envEquals(envBefore, target);
        if (!sameEnv) this.host.setEnvironment(target);
        if (!zshrcSame) atomicWrite(this.zshrc, plan.zshrcBody, 0o644);
        const checks = await this.verify(plan);
        if (mode === 'proxy') this.assertShellHook(plan);
        atomicWrite(this.stateFile, JSON.stringify({ ...state, mode, baselineEnv,
          proxyEnv: mode === 'proxy' ? envValues(plan.env) : null,
          environmentChangedAt: sameEnv ? state.environmentChangedAt : new Date().toISOString(),
          checks }, null, 2));
        return { unchanged: true, environmentRepaired: !sameEnv || !zshrcSame, ...(await this.status()) };
      }
      const dir = path.join(this.stateRoot, 'backups', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const candidateFile = path.join(dir, 'candidate.yaml');
      atomicWrite(candidateFile, YAML.stringify(plan.candidate));
      this.host.validate(candidateFile, this.directory);
      let selections = {};
      try { selections = await this.host.selections(); }
      catch (error) { if (this.host.appPid()) throw error; }
      backup = { directory: dir, files: snapshotFiles([plan.files.vergeFile, plan.files.configFile, plan.files.script, this.zshrc]),
        env: envBefore, state, dnsAccepted: this.host.dnsAccepted(),
        network: this.host.network(), selections };
      atomicWrite(path.join(dir, 'snapshot.json'), JSON.stringify(backup, null, 2));
      await this.host.quit();
      stopped = true;
      // Re-discover to catch subscription changes made while the quit request was pending.
      if (this.discover().selected !== plan.files.selected) throw new Error('Subscription changed during switch');
      backup.files = snapshotFiles(Object.keys(backup.files));
      atomicWrite(path.join(dir, 'snapshot.json'), JSON.stringify(backup, null, 2));
      mutated = true;
      for (const [file, body] of Object.entries(this.desiredFiles(plan))) {
        atomicWrite(file, body, backup.files[file].mode);
      }
      atomicWrite(this.zshrc, plan.zshrcBody, 0o644);
      if (backup.dnsAccepted) this.host.setDnsAccepted(false);
      await this.host.start();
      stopped = false;
      await this.host.restoreSelections(backup.selections);
      const checks = await this.verify(plan);
      if (mode === 'proxy') this.assertShellHook(plan);
      // Install the proxy environment only after the proxy itself verified.
      if (!envEquals(this.host.environment(), target)) {
        this.host.setEnvironment(target);
        environmentChangedAt = new Date().toISOString();
      }
      const next = { ...state, mode, lastBackup: dir, baselineEnv,
        proxyEnv: mode === 'proxy' ? envValues(plan.env) : null, environmentChangedAt, checks };
      delete next.chatgptPidAtSwitch;
      atomicWrite(this.stateFile, JSON.stringify(next, null, 2));
      return await this.status();
    } catch (error) {
      if (backup) atomicWrite(path.join(backup.directory, 'failure.json'),
        JSON.stringify({ error: safeError(error), failedAt: new Date().toISOString(), mutated }, null, 2));
      if (mutated) {
        try { await this.host.quit(); await this.restore(backup); }
        catch (rollbackError) {
          throw new Error(safeError(error) + '; automatic rollback failed: ' + safeError(rollbackError) +
            '. Snapshot: ' + backup.directory);
        }
      } else if (stopped || (backup && !this.host.appPid())) await this.host.start();
      throw new Error(safeError(error) + (mutated ? '; previous configuration restored' : ''));
    } finally { this.release(); }
  }
  async restore(backup) {
    restoreFiles(backup.files);
    // Reinstall the snapshot's environment; snapshots predating env management omit it.
    if (backup.env) this.host.setEnvironment(backup.env);
    if (this.host.dnsAccepted() !== backup.dnsAccepted) this.host.setDnsAccepted(backup.dnsAccepted);
    atomicWrite(this.stateFile, JSON.stringify(backup.state, null, 2));
    await this.host.start();
    await this.host.restoreSelections(backup.selections);
    const expected = YAML.parse(backup.files[this.discover().vergeFile].body).enable_tun_mode;
    const runtime = await this.host.api('/configs');
    if (!!runtime.tun?.enable !== !!expected) throw new Error('Rollback runtime verification failed');
  }
  async rollback({ dryRun = false } = {}) {
    const state = this.state();
    if (!state.lastBackup) throw new Error('No successful switch snapshot is available');
    const backup = readJson(path.join(state.lastBackup, 'snapshot.json'));
    if (!backup) throw new Error('Rollback snapshot is missing');
    if (dryRun) return { dryRun: true, rollbackSnapshot: state.lastBackup };
    this.acquire();
    try { await this.host.quit(); await this.restore(backup); return await this.status(); }
    finally { this.release(); }
  }

}

async function cli() {
  const args = process.argv.slice(2), command = args.find(arg => !arg.startsWith('--'));
  if (!['proxy', 'tun', 'status', 'rollback', 'shell-env'].includes(command)) {
    console.log('Usage: proxy-mode proxy|tun|status|rollback|shell-env [--dry-run] [--json]');
    process.exitCode = command ? 1 : 0;
    return;
  }
  if (process.platform !== 'darwin') throw new Error('This command supports macOS only');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');
  const manager = new ModeManager();
  if (command === 'shell-env') {
    // The wrapper evals this verbatim; stdout must carry the assignments and nothing else.
    process.stdout.write(shellEnvironment(manager.host.environment()));
    return;
  }
  const options = { dryRun: args.includes('--dry-run') };
  const result = command === 'status' ? await manager.status() : command === 'rollback' ?
    await manager.rollback(options) : await manager.switch(command, options);
  if (args.includes('--json')) { console.log(JSON.stringify(result, null, 2)); return; }
  if (options.dryRun) {
    console.log(JSON.stringify(result, null, 2));
    console.log('只读预览；未修改配置、环境或应用。');
    return;
  }
  console.log((result.unchanged ? '无需重复切换；' : '') +
    '期望模式：' + result.expectedMode + '；实际模式：' + result.actualMode);
  console.log('系统代理：' + (result.systemProxyEnabled ? '开启' : '关闭') +
    '；TUN：' + (result.actualMode === 'tun' ? '开启' : '关闭'));
  console.log('代理环境变量：' + (result.environmentDrift ? '已漂移（重跑本命令可修复）' :
    result.environmentManaged ? '已按模式管理' : '未接管') +
    '；NODE_USE_ENV_PROXY=' + (result.nodeUseEnvProxy || '未设置'));
  console.log('DNS：' + (result.dns.startsWith("There aren't") ? '自动／DHCP' : result.dns));
  console.log('corp172 接口：' + (result.corpInterface || '系统路由') +
    '；MagicDNS resolver：' + (result.magicDnsResolverPresent ? '已安装' : '缺失'));
  if (result.lastChecks) console.log('上次网络检查：GitHub／Spug／隔离 Node 请求／MagicDNS／Tailnet SSH 通过（不代表控制进程已使用代理）。');
  if (result.chatgptRestartRequired) console.log('等待手动重启 ChatGPT；Chrome 整条链路尚未验收。');
  else console.log('Chrome 整条链路仍需实际控制验证；脚本不会自动宣称已验收。');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
}
