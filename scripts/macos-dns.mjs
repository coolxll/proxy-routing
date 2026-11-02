#!/usr/bin/env node
// 临时切换系统 DNS；不修改 Clash、代理环境变量或 Tailnet resolver。
import { spawnSync } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function command(binary, args = [], input) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 10000, input });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(binary)}: ${(result.stderr || result.error?.message || 'failed').trim()}`);
  }
  return result.stdout.trim();
}

function activeService() {
  const global = command('/usr/sbin/scutil', [], 'show State:/Network/Global/IPv4\nquit\n');
  const id = global.match(/PrimaryService\s*:\s*(\S+)/)?.[1];
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('无法确定当前网络服务');
  const setup = command('/usr/sbin/scutil', [], `show Setup:/Network/Service/${id}\nquit\n`);
  const service = setup.match(/UserDefinedName\s*:\s*(.+)/)?.[1]?.trim();
  if (!service) throw new Error('当前网络服务名称不可用');
  return service;
}

async function checkLocalDns() {
  const resolver = new dns.Resolver({ timeout: 2500, tries: 1 });
  resolver.setServers(['127.0.0.1']);
  const addresses = await resolver.resolve4('chatgpt.com');
  if (!addresses.length || addresses.some(ip => !net.isIPv4(ip) || ip.startsWith('198.18.') || ip.startsWith('198.19.'))) {
    throw new Error('本机 DNS 未返回真实 IPv4；请确认 Clash 在 Proxy / redir-host 模式运行');
  }
}

export async function switchDns(mode, service, host) {
  if (!['local', 'dhcp'].includes(mode)) throw new Error('Unknown DNS mode');
  const before = host.read(service);
  if (mode === 'local') await host.checkLocal();
  try {
    host.set(service, mode === 'local' ? ['127.0.0.1'] : ['Empty']);
    const actual = host.read(service);
    if (mode === 'local' ? actual.join(',') !== '127.0.0.1' : actual.length !== 0) {
      throw new Error('系统 DNS 设置未生效');
    }
    host.flush();
  } catch (error) {
    try { host.set(service, before.length ? before : ['Empty']); host.flush(); }
    catch (rollback) { throw new Error(`${error.message}；恢复失败：${rollback.message}`); }
    throw error;
  }
}

async function main() {
  const [mode, requestedService, ...extra] = process.argv.slice(2);
  if (!mode || mode === '--help') {
    console.log('用法：sudo node scripts/macos-dns.mjs local|dhcp [网络服务名]\n      node scripts/macos-dns.mjs status [网络服务名]\n省略服务名时使用当前活动网络；不修改系统代理或 Tailnet resolver。');
    return;
  }
  if (!['local', 'dhcp', 'status'].includes(mode) || extra.length) throw new Error('参数错误；使用 --help 查看用法');
  if (process.platform !== 'darwin') throw new Error('仅支持 macOS');
  if (mode !== 'status' && process.getuid() !== 0) throw new Error('修改系统 DNS 需要 sudo');
  const service = requestedService || activeService();
  const host = {
    read: name => {
      const text = command('/usr/sbin/networksetup', ['-getdnsservers', name]);
      if (text.startsWith("There aren't any DNS Servers")) return [];
      const ips = text.split('\n');
      if (!ips.every(ip => net.isIP(ip))) throw new Error('无法读取网络服务的 DNS：' + name);
      return ips;
    },
    set: (name, servers) => command('/usr/sbin/networksetup', ['-setdnsservers', name, ...servers]),
    checkLocal: checkLocalDns,
    flush: () => {
      command('/usr/bin/dscacheutil', ['-flushcache']);
      command('/usr/bin/killall', ['-HUP', 'mDNSResponder']);
    }
  };
  if (mode !== 'status') await switchDns(mode, service, host);
  console.log(`${service} DNS：${host.read(service).join(', ') || '自动 / DHCP'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
