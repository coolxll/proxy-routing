#!/usr/bin/env node
// 按需 SSH 本地转发；只管理自己的 ControlMaster，不安装常驻服务。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MacHost, ModeManager } from './switch-macos-proxy-mode.mjs';

export const GROUP = '🏢 公司内网';
export const NODE = 'corp172-proxy';
const PORT = 11080;
const SSH_HOST = 'corp172-dev';
const GROUP_API = '/proxies/' + encodeURIComponent(GROUP);

export class TunnelHost extends MacHost {
  constructor(home = os.homedir()) {
    super(home);
    this.directory = path.join(home, 'Library/Application Support/proxy-routing/corp-tunnel');
    this.control = path.join(this.directory, 'control.sock');
  }
  masterAlive() {
    const r = spawnSync('/usr/bin/ssh', ['-S', this.control, '-O', 'check', SSH_HOST],
      { encoding: 'utf8', timeout: 4000 });
    return !r.error && r.status === 0;
  }
  async startTunnel() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', () => reject(new Error('127.0.0.1:11080 is already in use; no process was stopped')));
      server.listen(PORT, '127.0.0.1', () => server.close(resolve));
    });
    if (fs.existsSync(this.control)) {
      if (this.masterAlive()) return;
      const stat = fs.lstatSync(this.control);
      if (!stat.isSocket() || stat.uid !== process.getuid()) throw new Error('Unexpected SSH control path');
      fs.unlinkSync(this.control);
    }
    this.command('/usr/bin/ssh', ['-M', '-S', this.control, '-fNT',
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ControlPersist=no',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3', '-L', '127.0.0.1:11080:127.0.0.1:1080', SSH_HOST],
    { timeout: 12000 });
  }
  stopTunnel() {
    if (this.masterAlive()) this.command('/usr/bin/ssh', ['-S', this.control, '-O', 'exit', SSH_HOST]);
  }
  async selected() { return (await this.api(GROUP_API)).now; }
  async checkConfig() {
    const proxy = await this.api('/proxies/' + NODE);
    const config = new ModeManager({ home: this.home, host: this }).discover().generated;
    const node = config.proxies?.find(p => p.name === NODE);
    if (proxy.type !== 'Socks5' || proxy.interface || node?.server !== '127.0.0.1' || node?.port !== PORT) {
      throw new Error('Run proxy-mode to apply the local company proxy first');
    }
  }
  async select(name) { await this.api(GROUP_API, 'PUT', { name }); }
  checkSocks() {
    const code = this.command('/usr/bin/curl', ['--noproxy', '', '--proxy', 'socks5h://127.0.0.1:11080',
      '-sS', '--connect-timeout', '4', '--max-time', '8', '-o', '/dev/null', '-w', '%{http_code}',
      'https://spug.dongfangfuli.com/']);
    if (code !== '200') throw new Error('SSH SOCKS health check failed (' + code + ')');
  }
  async checkRoute() {
    const config = await this.api('/configs');
    const code = this.command('/usr/bin/curl', ['--noproxy', '', '--proxy', 'http://127.0.0.1:' + config['mixed-port'],
      '-sS', '--connect-timeout', '4', '--max-time', '8', '-o', '/dev/null', '-w', '%{http_code}',
      'https://spug.dongfangfuli.com/']);
    if (code !== '200') throw new Error('Clash company route health check failed (' + code + ')');
  }
  async closeCompanyConnections() {
    const data = await this.api('/connections');
    for (const connection of data.connections || []) {
      if (connection.chains?.includes(GROUP)) await this.api('/connections/' + encodeURIComponent(connection.id), 'DELETE');
    }
  }
}

export class CorpTunnel {
  constructor({ host = new TunnelHost(), lock = new ModeManager() } = {}) {
    this.host = host;
    this.lock = lock;
  }
  async status() {
    const running = this.host.masterAlive();
    let selected = null;
    try { selected = await this.host.selected(); } catch {}
    return { running, selected, enabled: running && selected === NODE,
      local: '127.0.0.1:11080', remote: 'corp172-dev:127.0.0.1:1080' };
  }
  async on() {
    this.lock.acquire();
    let started = false, selectedBefore, selectionAttempted = false;
    try {
      await this.host.checkConfig();
      selectedBefore = await this.host.selected();
      if (!this.host.masterAlive()) {
        started = true;
        await this.host.startTunnel();
      }
      this.host.checkSocks();
      selectionAttempted = true;
      await this.host.select(NODE);
      await this.host.closeCompanyConnections();
      await this.host.checkRoute();
      return await this.status();
    } catch (error) {
      // Restore routing before stopping a newly created tunnel. Keep it alive if
      // routing restoration fails, rather than leaving Clash pointing at a dead port.
      if (selectionAttempted) {
        try { await this.host.select(selectedBefore); await this.host.closeCompanyConnections(); }
        catch { throw new Error(error.message + '; route restoration failed; SSH tunnel left running'); }
      }
      if (started) this.host.stopTunnel();
      throw error;
    } finally { this.lock.release(); }
  }
  async off() {
    this.lock.acquire();
    try {
      // Do not stop a live SSH tunnel until Clash has switched away from it.
      await this.host.select('DIRECT');
      await this.host.closeCompanyConnections();
      this.host.stopTunnel();
      return await this.status();
    } finally { this.lock.release(); }
  }
}

async function cli() {
  const [command, ...options] = process.argv.slice(2);
  if (!['on', 'off', 'status'].includes(command) || options.some(v => v !== '--json')) {
    console.log('Usage: corp-tunnel on|off|status [--json]');
    process.exitCode = command ? 1 : 0;
    return;
  }
  const tunnel = new CorpTunnel();
  const result = await tunnel[command]();
  if (options.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log('SSH 隧道：' + (result.running ? '运行中' : '已停止') +
    '；公司策略：' + (result.selected || 'Clash 不可用') + '；本地入口：' + result.local);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
