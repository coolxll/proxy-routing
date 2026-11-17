#!/usr/bin/env node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CorpTunnel, GROUP, NODE } from './corp-tunnel.mjs';

function fixture() {
  const events = [];
  const host = {
    running: false, choice: 'DIRECT',
    masterAlive() { return this.running; },
    async selected() { return this.choice; },
    async checkConfig() { events.push('config'); },
    async startTunnel() { events.push('start'); this.running = true; },
    stopTunnel() { events.push('stop'); this.running = false; },
    async select(name) {
      events.push('select:' + name);
      if (this.failSelection === name) throw new Error('API unavailable');
      this.choice = name;
    },
    checkSocks() { events.push('socks'); if (this.failSocks) throw new Error('SOCKS unavailable'); },
    async checkRoute() { events.push('route'); if (this.failRoute) throw new Error('Route unavailable'); },
    async closeCompanyConnections() { events.push('close-company'); },
  };
  let locked = false;
  const lock = {
    acquire() { assert.equal(locked, false); locked = true; },
    release() { assert.equal(locked, true); locked = false; },
  };
  return { host, events, tunnel: new CorpTunnel({ host, lock }), isLocked: () => locked };
}

test('starting validates the SSH SOCKS service before selecting it, and repeated on reuses SSH', async () => {
  const f = fixture();
  assert.equal((await f.tunnel.on()).enabled, true);
  assert.ok(f.events.indexOf('socks') < f.events.indexOf('select:' + NODE));
  await f.tunnel.on();
  assert.equal(f.events.filter(v => v === 'start').length, 1);
  assert.equal(f.isLocked(), false);
});
test('failed SOCKS validation stops only the newly started master without changing routing', async () => {
  const f = fixture(); f.host.failSocks = true;
  await assert.rejects(f.tunnel.on(), /SOCKS unavailable/);
  assert.equal(f.host.running, false);
  assert.equal(f.host.choice, 'DIRECT');
  assert.ok(!f.events.includes('select:' + NODE));
  assert.equal(f.isLocked(), false);
});
test('failed end-to-end validation restores DIRECT before stopping the new tunnel', async () => {
  const f = fixture(); f.host.failRoute = true;
  await assert.rejects(f.tunnel.on(), /Route unavailable/);
  assert.equal(f.host.choice, 'DIRECT');
  assert.equal(f.host.running, false);
  assert.ok(f.events.lastIndexOf('select:DIRECT') < f.events.indexOf('stop'));
});
test('failed validation of an existing tunnel leaves its master running', async () => {
  const f = fixture(); f.host.running = true; f.host.failRoute = true;
  await assert.rejects(f.tunnel.on(), /Route unavailable/);
  assert.equal(f.host.running, true);
  assert.ok(!f.events.includes('stop'));
});
test('off switches routing and clears company connections before stopping SSH', async () => {
  const f = fixture(); await f.tunnel.on(); f.events.length = 0;
  const result = await f.tunnel.off();
  assert.deepEqual(f.events, ['select:DIRECT', 'close-company', 'stop']);
  assert.equal(result.running, false);
  assert.equal(result.selected, 'DIRECT');
});
test('off does not kill the SSH master if switching to DIRECT fails', async () => {
  const f = fixture(); await f.tunnel.on(); f.host.failSelection = 'DIRECT';
  await assert.rejects(f.tunnel.off(), /API unavailable/);
  assert.equal(f.host.running, true);
  assert.equal(f.host.choice, NODE);
  assert.equal(f.isLocked(), false);
});
test('a failed route restoration keeps the new tunnel alive', async () => {
  const f = fixture(); f.host.failRoute = true; f.host.failSelection = 'DIRECT';
  await assert.rejects(f.tunnel.on(), /route restoration failed; SSH tunnel left running/);
  assert.equal(f.host.running, true);
  assert.equal(f.isLocked(), false);
});
test('status does not start a tunnel', async () => {
  const f = fixture();
  assert.equal((await f.tunnel.status()).enabled, false);
  assert.deepEqual(f.events, []);
  assert.equal(GROUP, '🏢 公司内网');
});
