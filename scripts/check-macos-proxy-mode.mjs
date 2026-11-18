#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { ENV_KEYS, ModeManager, proxyEnvironment, renderExtension, renderZshrc, shellEnvironment,
  ZSHRC_BEGIN, ZSHRC_END } from './switch-macos-proxy-mode.mjs';

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
  fs.writeFileSync(path.join(home, '.zshrc'), 'export PATH=/usr/local/bin:$PATH\n');
  const resolverRoot = path.join(home, 'resolver'); fs.mkdirSync(resolverRoot);
  fs.writeFileSync(path.join(resolverRoot, 'fixture.ts.net'), 'nameserver 100.100.100.100\n');
  const host = {
    running: true, current: generated, quitCount: 0, startCount: 0, accepted: false,
    vars: Object.fromEntries(ENV_KEYS.map(key => [key, null])),
    dnsValue: '114.114.114.114', dnsWrites: [], dnsFlushes: 0,
    selected: { '🚀 节点选择': 'node-b', '🏢 公司内网': 'corp172-proxy' },
    environment() { return { ...this.vars }; },
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
      this.dnsValue = this.current.tun.enable ? '114.114.114.114' :
        "There aren't any DNS Servers set on Wi-Fi.";
      fs.writeFileSync(path.join(directory, 'clash-verge.yaml'), YAML.stringify(this.current));
    },
    async api() { return this.current; },
    async selections() { return { ...this.selected }; },
    async restoreSelections(value) { this.selected = { ...value }; },
    requireDnsPrivilege() { if (this.denyDnsPrivilege) throw new Error('sudo -v required'); },
    setNetworkDns(service, servers) {
      if (this.failDnsOnce) { this.failDnsOnce = false; throw new Error('DNS permission denied'); }
      this.dnsWrites.push({ service, servers });
      this.dnsValue = servers.join('\n') || "There aren't any DNS Servers set on Wi-Fi.";
    },
    flushDns() { this.dnsFlushes++; },
    network() { return { service: 'Wi-Fi', dns: this.dnsValue, search: 'dongfu1.com', proxy:
      'HTTPEnable : ' + (this.current.tun.enable ? '0' : '1') +
      '\nHTTPSEnable : ' + (this.current.tun.enable ? '0' : '1') + '\nHTTPProxy : 127.0.0.1\nHTTPSProxy : 127.0.0.1\nHTTPPort : 7897\nHTTPSPort : 7897' }; },
    validate(file) { if (this.invalid) throw new Error('Mihomo candidate validation failed');
      assert.equal(YAML.parse(fs.readFileSync(file, 'utf8')).mode, 'rule'); },
    async health() { if (this.failHealthOnce) { this.failHealthOnce = false; throw new Error('Company health failed'); }
      return { fixture: true }; },
  };
  const manager = new ModeManager({ home, root: project, host, resolverRoot });
  return { home, directory, manager, host };
}

test('fresh subscriptions use local SSH without a Tailnet interface; routes stay idempotent', () => {
  const source = fs.readFileSync(path.join(project, 'scripts/clash-verge-rev-macos-tun-dns.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(renderExtension(source, 'tun', 'utun9'), context);
  const config = context.main({ rules: ['MATCH,🚀 节点选择'] });
  const ssh = config.proxies.find(p => p.name === 'corp172-ssh');
  const legacy = config.proxies.find(p => p.name === 'corp172-proxy');
  assert.equal(ssh['interface-name'], undefined);
  assert.equal(ssh.server, '127.0.0.1');
  assert.equal(ssh.port, 11080);
  assert.equal(legacy.server, '100.93.132.98');
  assert.equal(legacy['interface-name'], 'utun9');
  assert.deepEqual(Array.from(config['proxy-groups'][0].proxies), ['DIRECT', 'corp172-proxy', 'corp172-ssh']);
  assert.equal(context.main(config).proxies.length, 2);
  assert.equal(config.rules.filter(rule => rule.includes('dongfu1.com')).length, 1);
});
test('KDDI chain selector stays above the main selector and reuses subscription proxies', () => {
  const source = fs.readFileSync(path.join(project, 'scripts/clash-verge-rev-macos-tun-dns.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(renderExtension(source, 'tun', 'utun9'), context);
  const config = context.main({
    proxies: [
      { name: 'KDDI-JP家宽', type: 'vless', server: 'kddi.example', port: 50414 },
      { name: 'VMiss-美国Tri-WS', type: 'vless' },
      { name: 'VMiss-美国Tri', type: 'vless' },
      { name: '日本01', type: 'vless' },
    ],
    'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: [] }],
    rules: [],
  });
  assert.deepEqual(Array.from(config['proxy-groups'], group => group.name),
    ['🏢 公司内网', 'KDDI 前置', '🚀 节点选择'], 'chain selector must sit above the main selector');
  assert.deepEqual(Array.from(config['proxy-groups'][1].proxies),
    ['VMiss-美国Tri-WS', 'VMiss-美国Tri', '日本01', 'DIRECT'], 'chain head default and candidate order');
  assert.equal(config.proxies.find(p => p.name === 'KDDI-JP家宽')['dialer-proxy'], 'KDDI 前置');
  assert.ok(!config['proxy-groups'][1].proxies.some(name => name === 'KDDI-JP家宽' || name.startsWith('corp172-')),
    'chain candidates must exclude the chained node and company exits');
  assert.equal(Array.from(context.main(config)['proxy-groups']).filter(group => group.name === 'KDDI 前置').length, 1,
    'reapplying the extension must not duplicate the selector');
});
test('stale company DNS policies are removed while domain routing and unrelated DNS remain', () => {
  const source = fs.readFileSync(path.join(project, 'scripts/clash-verge-rev-macos-tun-dns.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(renderExtension(source, 'tun', 'utun9'), context);
  const config = context.main({ dns: { 'nameserver-policy': {
    '+.dongfangfuli.com': ['10.8.100.121'], '*.psf-dev.com': ['10.8.121.121'],
    'dongfu1.com': ['10.8.100.121'], 'example.test': ['https://1.1.1.1/dns-query']
  } }, rules: ['IP-CIDR,10.8.100.121/32,DIRECT,no-resolve',
    'IP-CIDR,10.8.121.121/32,DIRECT,no-resolve', 'MATCH,🚀 节点选择'] });
  for (const key of ['+.dongfangfuli.com', '*.psf-dev.com', 'dongfu1.com']) {
    assert.equal(config.dns['nameserver-policy'][key], undefined);
  }
  assert.equal(config.dns['nameserver-policy']['example.test'][0], 'https://1.1.1.1/dns-query');
  assert.equal(config.rules.some(rule => /10\.8\.(100|121)\.121/.test(rule)), false);
  assert.ok(config.rules.includes('DOMAIN-SUFFIX,dongfangfuli.com,🏢 公司内网'));
  assert.ok(!config.dns['fake-ip-filter'].includes('+.dongfangfuli.com'));
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
test('tun → proxy → tun preserves settings and selection and persists shell exports', async () => {
  const f = fixture(); f.host.vars.NO_PROXY = 'original.local';
  const before = { ...f.host.vars };
  const proxy = await f.manager.switch('proxy');
  assert.equal(proxy.actualMode, 'proxy'); assert.equal(proxy.environmentManaged, true);
  const env = f.manager.shellEnv();
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.ok(env.NO_PROXY.includes('100.93.132.98'));
  assert.equal(f.host.current.proxies[0]['interface-name'], undefined);
  const quits = f.host.quitCount;
  assert.equal((await f.manager.switch('proxy')).unchanged, true);
  assert.equal(f.host.quitCount, quits);
  const tun = await f.manager.switch('tun');
  assert.equal(tun.actualMode, 'tun');
  assert.equal(f.host.current.proxies.find(p => p.name === 'corp172-ssh')['interface-name'], undefined);
  assert.equal(f.host.current.proxies.find(p => p.name === 'corp172-ssh').server, '127.0.0.1');
  assert.equal(f.host.current.proxies.find(p => p.name === 'corp172-proxy')['interface-name'], 'utun9');
  assert.equal(f.host.selected['🏢 公司内网'], 'DIRECT');
  assert.equal(f.manager.shellEnv().NO_PROXY, 'original.local');
  assert.equal(f.manager.shellEnv().HTTP_PROXY, null);
  assert.equal(f.manager.shellEnv().NODE_USE_ENV_PROXY, null);
  assert.deepEqual(f.host.vars, before, 'switching never writes the parent or launchctl environment');
  assert.equal(f.host.selected['🚀 节点选择'], 'node-b');
  const verge = YAML.parse(fs.readFileSync(path.join(f.directory, 'verge.yaml'), 'utf8'));
  assert.equal(verge.theme_mode, 'dark'); assert.equal(verge.unrelated.keep, 'yes');
  assert.equal(verge.profile_dns_settings['another-subscription'].enabled, true);
});
test('migration defaults to DIRECT once, then preserves an explicitly enabled local company tunnel', async () => {
  const f = fixture();
  await f.manager.switch('proxy');
  assert.equal(f.host.selected['🏢 公司内网'], 'DIRECT');
  f.host.selected['🏢 公司内网'] = 'corp172-ssh';
  await f.manager.switch('tun');
  assert.equal(f.host.selected['🏢 公司内网'], 'corp172-ssh');
  const ssh = f.host.current.proxies.find(p => p.name === 'corp172-ssh');
  assert.equal(ssh.server, '127.0.0.1');
  assert.equal(ssh['interface-name'], undefined);
});
test('TUN replaces the startup DNS placeholder with the local listener and restores DNS on rollback', async () => {
  const f = fixture();
  await f.manager.switch('proxy');
  const originalDns = f.host.network().dns;
  await f.manager.switch('tun');
  assert.equal(f.host.network().dns, '127.0.0.1');
  assert.equal(f.host.current.dns.listen, '127.0.0.1:53');
  assert.equal(f.host.current.dns['enhanced-mode'], 'fake-ip');
  assert.equal(f.host.current.proxies.find(p => p.name === 'corp172-ssh')['interface-name'], undefined);
  assert.equal(f.host.current.proxies.find(p => p.name === 'corp172-ssh').port, 11080);
  assert.deepEqual(Array.from(f.host.current.dns['nameserver-policy']['+.ts.net']), ['100.100.100.100']);
  assert.ok(f.host.dnsFlushes > 0);
  const starts = f.host.startCount;
  assert.equal((await f.manager.switch('tun')).unchanged, true);
  assert.equal(f.host.startCount, starts);
  await f.manager.rollback();
  assert.equal(f.host.network().dns, originalDns);
});
test('missing DNS authorization stops a TUN switch before restarting or changing files', async () => {
  const f = fixture();
  const before = fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8');
  f.host.denyDnsPrivilege = true;
  await assert.rejects(f.manager.switch('tun'), /sudo -v required/);
  assert.equal(f.host.quitCount, 0);
  assert.equal(fs.readFileSync(path.join(f.directory, 'config.yaml'), 'utf8'), before);
  assert.equal(fs.existsSync(f.manager.lock), false);
});
test('DNS write denial and later health failure restore the previous manual DNS', async () => {
  for (const failure of ['failDnsOnce', 'failHealthOnce']) {
    const f = fixture();
    await f.manager.switch('proxy');
    f.host.setNetworkDns('Wi-Fi', ['9.9.9.9', '1.1.1.1']);
    f.host[failure] = true;
    await assert.rejects(f.manager.switch('tun'), /previous configuration restored/);
    assert.equal(f.host.current.tun.enable, false);
    assert.equal(f.host.network().dns, '9.9.9.9\n1.1.1.1');
    assert.equal(f.manager.state().mode, 'proxy');
    assert.equal(fs.existsSync(f.manager.lock), false);
  }
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
test('manual rollback restores the previous mode and its saved shell exports', async () => {
  const f = fixture(); await f.manager.switch('proxy'); await f.manager.switch('tun');
  assert.equal((await f.manager.rollback()).actualMode, 'proxy');
  assert.equal(f.manager.shellEnv().NODE_USE_ENV_PROXY, '1');
  assert.equal(f.manager.shellEnv().HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.ok(ENV_KEYS.every(key => f.host.vars[key] === null));
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

test('legacy rollback snapshots do not write their old launchctl environment', async () => {
  const f = fixture();
  await f.manager.switch('proxy'); await f.manager.switch('tun');
  const file = path.join(f.manager.state().lastBackup, 'snapshot.json');
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  snapshot.env = { HTTP_PROXY: 'http://legacy.invalid:1' };
  fs.writeFileSync(file, JSON.stringify(snapshot));
  await f.manager.rollback();
  assert.equal(f.manager.shellEnv().HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(f.host.vars.HTTP_PROXY, null);
});

test('tun persists the baseline for shell startup', async () => {
  const f = fixture();
  await f.manager.switch('proxy');
  assert.equal(f.manager.shellEnv().HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal((await f.manager.switch('tun')).environmentManaged, true);
  ENV_KEYS.forEach(key => assert.equal(f.manager.shellEnv()[key], null));
});

test('the baseline is captured once and stays stable across repeated proxy/tun cycles', async () => {
  const f = fixture(); f.host.vars.no_proxy = 'user.example,other.example';
  const first = f.manager.state().baselineEnv;
  assert.equal(first, undefined);
  for (let round = 0; round < 2; round++) {
    await f.manager.switch('proxy');
    await f.manager.switch('tun');
    assert.equal(f.manager.state().baselineEnv.no_proxy, 'user.example,other.example');
    assert.equal(f.manager.shellEnv().no_proxy, 'user.example,other.example');
  }
});

test('same-mode switch refreshes persisted exports without restarting Clash', async () => {
  const f = fixture();
  await f.manager.switch('proxy');
  const quits = f.host.quitCount, state = f.manager.state();
  state.proxyEnv.HTTP_PROXY = 'http://bogus.invalid:1';
  fs.writeFileSync(f.manager.stateFile, JSON.stringify(state));
  const result = await f.manager.switch('proxy');
  assert.equal(result.unchanged, true);
  assert.equal(result.environmentRepaired, true);
  assert.equal(f.host.quitCount, quits);
  assert.equal(f.manager.shellEnv().HTTP_PROXY, 'http://127.0.0.1:7897');
});

test('renderZshrc inserts, replaces and removes exactly one managed block', () => {
  const base = 'export PATH=/usr/local/bin:$PATH\n';
  const on = renderZshrc(base, true);
  assert.ok(on.startsWith(base));
  assert.equal(on.split(ZSHRC_BEGIN).length - 1, 1);
  assert.equal(on.split(ZSHRC_END).length - 1, 1);
  assert.equal(renderZshrc(on, true), on, 'rendering twice must be byte-identical');
  assert.equal(renderZshrc(on, false), base, 'removal restores the original file');
  assert.equal(renderZshrc(renderZshrc(base, true).replace(/x/, 'x'), false), base);
  assert.equal(renderZshrc('', true).startsWith(ZSHRC_BEGIN), true);
  assert.throws(() => renderZshrc(ZSHRC_BEGIN + '\nbroken\n', false), /Unbalanced/);
});
test('shell startup hook stays in both modes and is restored by rollback', async () => {
  const f = fixture(); const zshrc = path.join(f.home, '.zshrc');
  const base = fs.readFileSync(zshrc, 'utf8');
  await f.manager.switch('proxy');
  const proxied = fs.readFileSync(zshrc, 'utf8');
  assert.ok(proxied.includes(ZSHRC_BEGIN) && proxied.includes('proxy-mode shell-env'));
  assert.ok(proxied.startsWith(base), 'the rest of ~/.zshrc must be preserved');
  assert.equal((await f.manager.status()).shellHookInstalled, true);
  const tun = await f.manager.switch('tun');
  assert.ok(fs.readFileSync(zshrc, 'utf8').includes(ZSHRC_BEGIN), 'TUN also loads the saved baseline');
  assert.equal(tun.shellHookInstalled, true);
  await f.manager.rollback();
  assert.ok(fs.readFileSync(zshrc, 'utf8').includes(ZSHRC_BEGIN), 'rollback restores the proxy snapshot');
});
test('a missing hook is repaired without restarting Clash', async () => {
  const f = fixture(); const zshrc = path.join(f.home, '.zshrc');
  await f.manager.switch('proxy');
  const quits = f.host.quitCount;
  fs.writeFileSync(zshrc, 'export PATH=/usr/local/bin:$PATH\n');
  const result = await f.manager.switch('proxy');
  assert.equal(result.environmentRepaired, true);
  assert.equal(f.host.quitCount, quits, 'no Clash restart for a shell-hook-only repair');
  assert.ok(fs.readFileSync(zshrc, 'utf8').includes(ZSHRC_BEGIN));
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
test('fresh shells load persisted exports with an empty environment and clear inherited proxies in TUN', async () => {
  const f = fixture();
  const run = env => {
    const result = spawnSync('/bin/zsh', ['-f', '-c',
      'eval "$1"; "$2" -e "$3"',
      'test-shell', shellEnvironment(f.manager.shellEnv()), process.execPath,
      'console.log(JSON.stringify(process.env))'], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  await f.manager.switch('proxy');
  // Neither login jobs nor a launchctl environment are available here.
  const proxy = run({ PATH: '/usr/bin:/bin', UNRELATED: 'keep' });
  assert.equal(proxy.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(proxy.NODE_USE_ENV_PROXY, '1');
  assert.equal(proxy.NO_PROXY, f.manager.state().proxyEnv.NO_PROXY);
  assert.equal(proxy.UNRELATED, 'keep');
  await f.manager.switch('tun');
  const tun = run(proxy);
  ENV_KEYS.forEach(key => assert.equal(tun[key], undefined, key));
  assert.equal(tun.UNRELATED, 'keep');
});
test('an unmanaged shell leaves its inherited environment alone', () => {
  const f = fixture();
  assert.equal(f.manager.shellEnv(), null);
  assert.equal(fs.existsSync(f.manager.stateRoot), false);
});
test('a missing proxy environment is reported instead of silently clearing a shell', () => {
  const f = fixture();
  fs.mkdirSync(f.manager.stateRoot, { recursive: true });
  fs.writeFileSync(f.manager.stateFile, JSON.stringify({ mode: 'proxy' }));
  assert.throws(() => f.manager.shellEnv(), /Proxy environment is missing/);
});
