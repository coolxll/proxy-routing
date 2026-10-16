#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ENV_KEYS, ModeManager, proxyEnvironment, renderExtension, shellEnvironment } from './switch-macos-proxy-mode.mjs';

const roots = [];
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-mode-test-')); roots.push(home);
  const directory = path.join(home, 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev');
  fs.mkdirSync(path.join(directory, 'profiles'), { recursive: true });
  const generated = { mode: 'rule', 'mixed-port': 7897,
    proxies: [{ name: 'corp172-proxy', type: 'socks5', server: '100.93.132.98', port: 1080,
      'interface-name': 'utun5' }],
    'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['node-a', 'node-b'] }],
    rules: ['MATCH,🚀 节点选择'], dns: { enable: true },
    tun: { enable: true, device: 'utun1024', stack: 'gvisor', 'auto-route': true,
      'auto-detect-interface': true, 'route-exclude-address': ['10.0.0.0/8', '192.168.0.0/16'] } };
  const write = (name, object) => fs.writeFileSync(path.join(directory, name), YAML.stringify(object));
  write('clash-verge.yaml', generated); write('config.yaml', generated);
  write('profiles.yaml', { current: 'subscription-random',
    items: [{ uid: 'subscription-random', option: { script: 'script-random' } },
      { uid: 'script-random', type: 'script', file: 'random.js' }] });
  write('verge.yaml', { enable_tun_mode: true, enable_system_proxy: false, theme_mode: 'dark',
    unrelated: { keep: 'yes' }, profile_dns_settings: { 'another-subscription': { enabled: true } } });
  fs.writeFileSync(path.join(directory, 'profiles/random.js'), 'function main(config) { return config; }\n');
  const resolverRoot = path.join(home, 'resolver'); fs.mkdirSync(resolverRoot);
  fs.writeFileSync(path.join(resolverRoot, 'fixture.ts.net'), 'nameserver 100.100.100.100\n');
  const host = {
    running: true, current: generated, quitCount: 0, startCount: 0, accepted: false,
    vars: Object.fromEntries(ENV_KEYS.map(key => [key, null])),
    selected: { '🚀 节点选择': 'node-b' },
    environment() { return { ...this.vars }; },
    // Mirrors launchctl: only the nine managed keys are touched, others survive.
    setEnvironment(env) { ENV_KEYS.forEach(key => { this.vars[key] = env[key] ?? null; }); },
    tailnet() { return { BackendState: 'Running', MagicDNSSuffix: 'fixture.ts.net',
      Self: { DNSName: 'mac.fixture.ts.net.', TailscaleIPs: ['100.77.110.64'] },
      Peer: { a: { TailscaleIPs: ['100.93.132.98', 'fd7a:115c:a1e0::123'] } } }; },
    dnsAccepted() { return this.accepted; },
    setDnsAccepted(value) { this.accepted = value; },
    tailInterface() { return 'utun9'; },
    appPid() { return this.running ? '99999' : ''; },
    chatgptPid() { return '54321'; },
    async quit() { if (this.denyQuit) throw new Error('Quit denied'); this.running = false; this.quitCount++; },
    async start() {
      this.running = true; this.startCount++;
      const config = YAML.parse(fs.readFileSync(path.join(directory, 'config.yaml'), 'utf8'));
      const context = vm.createContext({ input: config });
      vm.runInContext(fs.readFileSync(path.join(directory, 'profiles/random.js'), 'utf8'), context);
      this.current = vm.runInContext('main(input)', context);
      fs.writeFileSync(path.join(directory, 'clash-verge.yaml'), YAML.stringify(this.current));
    },
    async api() { return this.current; },
    async selections() { return { ...this.selected }; },
    async restoreSelections(value) { this.selected = { ...value }; },
    network() { return { service: 'Wi-Fi', dns: this.current.tun.enable ? '114.114.114.114' :
      "There aren't any DNS Servers set on Wi-Fi.", search: 'dongfu1.com', proxy:
      'HTTPEnable : ' + (this.current.tun.enable ? '0' : '1') +
      '\nHTTPSEnable : ' + (this.current.tun.enable ? '0' : '1') + '\nHTTPProxy : 127.0.0.1\nHTTPSProxy : 127.0.0.1\nHTTPPort : 7897\nHTTPSPort : 7897' }; },
    validate(file) { if (this.invalid) throw new Error('Mihomo candidate validation failed');
      assert.equal(YAML.parse(fs.readFileSync(file, 'utf8')).mode, 'rule'); },
    async health() { if (this.failHealthOnce) { this.failHealthOnce = false; throw new Error('Company health failed'); }
      return { fixture: true }; },
    failEnvironmentOnce: false
  };
  const manager = new ModeManager({ home, root: project, host, resolverRoot });
  return { home, directory, manager, host };
}

test('fresh subscriptions inject corp172 before binding; repeated application does not duplicate routes', () => {
  const source = fs.readFileSync(path.join(project, 'scripts/clash-verge-rev-macos-tun-dns.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(renderExtension(source, 'tun', 'utun9'), context);
  const config = context.main({ rules: ['MATCH,🚀 节点选择'] });
  assert.equal(config.proxies[0]['interface-name'], 'utun9');
  assert.equal(context.main(config).proxies.length, 1);
  assert.equal(config.rules.filter(rule => rule.includes('dongfu1.com')).length, 1);
});
test('proxy environment bypasses known Tailnet addresses without bypassing company domains', () => {
  const f = fixture(); const env = proxyEnvironment(7897, f.host.tailnet());
  assert.equal(env.HTTPS_PROXY, env.https_proxy);
  assert.equal(env.ALL_PROXY, 'http://127.0.0.1:7897');
  assert.ok(env.NO_PROXY.includes('fd7a:115c:a1e0::123'));
  assert.ok(!env.NO_PROXY.includes('dongfangfuli.com'));
});
test('dry-run reports the environment keys it would change without writing any', async () => {
  const f = fixture(); const before = fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8');
  const untouched = { ...f.host.vars };
  const plan = await f.manager.switch('proxy', { dryRun: true });
  assert.deepEqual(new Set(plan.environmentKeys), new Set(ENV_KEYS));
  assert.equal(plan.targetEnvironment.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.deepEqual(f.host.vars, untouched);
  assert.equal(fs.existsSync(f.manager.stateRoot), false);
  assert.equal(fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8'), before);
  assert.equal(f.host.quitCount, 0);
});
test('tun → proxy → tun preserves settings and selection, manages the environment, and is idempotent', async () => {
  const f = fixture(); f.host.vars.NO_PROXY = 'original.local';
  const proxy = await f.manager.switch('proxy');
  assert.equal(proxy.actualMode, 'proxy'); assert.equal(proxy.chatgptRestartRequired, false);
  assert.equal(proxy.environmentManaged, true);
  assert.equal(f.host.vars.NODE_USE_ENV_PROXY, '1');
  assert.equal(f.host.vars.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.ok(f.host.vars.NO_PROXY.includes('100.93.132.98'));
  assert.equal(f.host.current.proxies[0]['interface-name'], undefined);
  const quits = f.host.quitCount;
  assert.equal((await f.manager.switch('proxy')).unchanged, true);
  assert.equal(f.host.quitCount, quits);
  const tun = await f.manager.switch('tun');
  assert.equal(tun.actualMode, 'tun');
  assert.equal(f.host.current.proxies[0]['interface-name'], 'utun9');
  // TUN restores the captured baseline, so the user's own value survives the round trip.
  assert.equal(f.host.vars.NO_PROXY, 'original.local');
  assert.equal(f.host.vars.HTTP_PROXY, null);
  assert.equal(f.host.vars.NODE_USE_ENV_PROXY, null);
  assert.equal(f.host.selected['🚀 节点选择'], 'node-b');
  const verge = YAML.parse(fs.readFileSync(path.join(f.directory, 'verge.yaml'), 'utf8'));
  assert.equal(verge.theme_mode, 'dark'); assert.equal(verge.unrelated.keep, 'yes');
  assert.equal(verge.profile_dns_settings['another-subscription'].enabled, true);
});
test('candidate validation and denied quit leave files and environment untouched', async () => {
  for (const failure of ['invalid', 'denyQuit']) {
    const f = fixture(); const before = fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8');
    f.host[failure] = true;
    await assert.rejects(f.manager.switch('proxy'));
    assert.equal(fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8'), before);
    assert.equal(f.host.vars.NODE_USE_ENV_PROXY, null);
    assert.equal(f.host.running, true);
    assert.equal(fs.existsSync(f.manager.lock), false);
  }
});
test('health failure restores previous files, runtime, environment and selection', async () => {
  const f = fixture(); const before = fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8');
  f.host.failHealthOnce = true;
  await assert.rejects(f.manager.switch('proxy'), /previous configuration restored/);
  assert.equal(fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8'), before);
  assert.equal(f.host.current.tun.enable, true); assert.equal(f.host.vars.NODE_USE_ENV_PROXY, null);
  assert.equal(f.host.selected['🚀 节点选择'], 'node-b');
});
test('manual rollback restores the previous successful mode and its environment', async () => {
  const f = fixture(); await f.manager.switch('proxy'); await f.manager.switch('tun');
  assert.equal((await f.manager.rollback()).actualMode, 'proxy');
  // The snapshot being rolled back is the one taken before the proxy→tun switch,
  // so rolling it back reinstalls the proxy environment.
  assert.equal(f.host.vars.NODE_USE_ENV_PROXY, '1');
  assert.equal(f.host.vars.HTTP_PROXY, 'http://127.0.0.1:7897');
});
test('concurrent switches are rejected while the owner is alive', async () => {
  const f = fixture(); f.manager.acquire();
  await assert.rejects(f.manager.switch('proxy'), /Another switch/);
  f.manager.release(); assert.equal(f.host.quitCount, 0);
});

test('same-mode switch repairs a stopped app or drifted runtime instead of failing an idempotent check', async () => {
  for (const stopped of [true, false]) {
    const f = fixture(); await f.manager.switch('proxy');
    const starts = f.host.startCount;
    if (stopped) f.host.running = false;
    else f.host.current.tun.enable = true;
    await f.manager.switch('proxy');
    assert.ok(f.host.startCount > starts);
    assert.equal(f.host.current.tun.enable, false);
  }
});

// A guard that managed writes touch exactly the nine proxy keys and nothing else.
test('switch and rollback manage exactly the nine proxy keys, including legacy snapshots', async () => {
  const f = fixture();
  const calls = [];
  const delegate = f.host.setEnvironment.bind(f.host);
  f.host.setEnvironment = env => { calls.push({ ...env }); delegate(env); };
  f.host.vars.UNRELATED_KEEP = 'keep';
  // A pre-existing user value the script must adopt as its baseline, not clobber.
  f.host.vars.HTTP_PROXY = 'http://user-proxy.invalid:1234';
  await f.manager.switch('proxy');
  assert.ok(calls.length > 0 && calls.every(call => Object.keys(call).every(key => ENV_KEYS.includes(key))));
  assert.equal(f.host.vars.NODE_USE_ENV_PROXY, '1');
  assert.equal(f.host.vars.UNRELATED_KEEP, 'keep');
  const baseline = f.manager.state().baselineEnv;
  assert.equal(baseline.HTTP_PROXY, 'http://user-proxy.invalid:1234');
  await f.manager.switch('tun');
  assert.equal(f.host.vars.NODE_USE_ENV_PROXY, null);
  // The user's original value is restored by the tun switch, not lost.
  assert.equal(f.host.vars.HTTP_PROXY, 'http://user-proxy.invalid:1234');
  assert.equal(f.host.vars.UNRELATED_KEEP, 'keep');
  // A snapshot predating env management must not break rollback.
  const state = f.manager.state();
  const snapshotFile = path.join(state.lastBackup, 'snapshot.json');
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  delete snapshot.env;
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
  await f.manager.rollback();
  assert.equal(f.host.vars.UNRELATED_KEEP, 'keep');
});

test('tun clears the proxy environment back to the captured baseline', async () => {
  const f = fixture();
  await f.manager.switch('proxy');
  assert.equal(f.host.vars.HTTPS_PROXY, 'http://127.0.0.1:7897');
  const tun = await f.manager.switch('tun');
  assert.equal(tun.environmentManaged, true);
  ENV_KEYS.forEach(key => assert.equal(f.host.vars[key], null, key + ' should be cleared'));
});

test('the baseline is captured once and stays stable across repeated proxy/tun cycles', async () => {
  const f = fixture(); f.host.vars.no_proxy = 'user.example,other.example';
  const first = f.manager.state().baselineEnv;
  assert.equal(first, undefined);
  for (let round = 0; round < 2; round++) {
    await f.manager.switch('proxy');
    await f.manager.switch('tun');
    assert.equal(f.manager.state().baselineEnv.no_proxy, 'user.example,other.example');
    assert.equal(f.host.vars.no_proxy, 'user.example,other.example');
  }
});

test('a drifted environment is repaired without restarting Clash', async () => {
  const f = fixture();
  await f.manager.switch('proxy');
  const quits = f.host.quitCount;
  f.host.vars.HTTP_PROXY = 'http://bogus.invalid:1';
  const result = await f.manager.switch('proxy');
  assert.equal(result.unchanged, true);
  assert.equal(result.environmentRepaired, true);
  assert.equal(f.host.quitCount, quits);
  assert.equal(f.host.vars.HTTP_PROXY, 'http://127.0.0.1:7897');
});

test('a failed environment write rolls the switch back to the previous environment', async () => {
  const f = fixture();
  f.host.vars.NO_PROXY = 'user.local';
  const before = { ...f.host.vars };
  const delegate = f.host.setEnvironment.bind(f.host);
  f.host.setEnvironment = env => {
    delegate(env);
    if (f.host.failEnvironmentOnce) {
      f.host.failEnvironmentOnce = false;
      throw new Error('launchctl environment update failed for: HTTP_PROXY');
    }
  };
  f.host.failEnvironmentOnce = true;
  await assert.rejects(f.manager.switch('proxy'), /previous configuration restored/);
  assert.deepEqual(f.host.vars, before);
  assert.equal(f.host.current.tun.enable, true);
  assert.equal(fs.existsSync(f.manager.lock), false);
});

test('shellEnvironment emits eval-safe lines for both set and unset', () => {
  const env = Object.fromEntries(ENV_KEYS.map(key => [key, null]));
  env.NODE_USE_ENV_PROXY = '1';
  env.NO_PROXY = "a'b,c";
  const lines = shellEnvironment(env).trimEnd().split('\n');
  assert.equal(lines.length, ENV_KEYS.length);
  assert.ok(lines.includes("export NODE_USE_ENV_PROXY='1'"));
  assert.ok(lines.includes("export NO_PROXY='a'\\''b,c'"));
  assert.ok(lines.includes('unset HTTP_PROXY'));
});
