import { execFile } from "node:child_process";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).replace(/^export\s+/, "").trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export class SecretResolver {
  constructor(environment = process.env) {
    this.environment = environment;
    this.cache = new Map();
    this.values = [];
  }

  async resolve(spec, label) {
    if (!spec || typeof spec !== "object") throw new Error(`${label} must use env or command secret source`);
    const cacheKey = JSON.stringify(spec);
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    let value;
    if (spec.env) {
      value = this.environment[spec.env];
    } else if (Array.isArray(spec.command) && spec.command.length > 0) {
      const [command, ...args] = spec.command;
      const { stdout } = await execFileAsync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
      value = spec.envKey ? parseEnv(stdout)[spec.envKey] : stdout.trim();
    } else {
      throw new Error(`${label} must define env or command[]`);
    }
    if (!value) throw new Error(`${label} resolved to an empty value`);
    value = String(value).trim();
    this.cache.set(cacheKey, value);
    this.values.push(value);
    return value;
  }
}

function waitForPort(host, port, timeoutMs = 10_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error(`timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function freePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export class SshTunnel {
  constructor(config) {
    this.config = config;
    this.process = null;
  }

  async start() {
    const localHost = this.config.localHost ?? "127.0.0.1";
    const localPort = this.config.localPort ?? await freePort(localHost);
    const remoteHost = this.config.remoteHost ?? "127.0.0.1";
    const args = [
      "-N", "-T", "-o", "ExitOnForwardFailure=yes",
      "-L", `${localHost}:${localPort}:${remoteHost}:${this.config.remotePort}`,
      this.config.sshHost,
    ];
    this.process = spawn(this.config.sshCommand ?? "ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    this.process.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const exited = new Promise((_, reject) => this.process.once("exit", (code) => reject(new Error(`SSH tunnel exited (${code}): ${stderr.trim()}`))));
    await Promise.race([waitForPort(localHost, localPort, this.config.timeoutMs), exited]);
    return { host: localHost, port: localPort };
  }

  async close() {
    if (!this.process || this.process.exitCode != null) return;
    this.process.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => this.process.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (this.process.exitCode == null) this.process.kill("SIGKILL");
  }
}

export class ResinClient {
  constructor({ name, baseUrl, adminToken, proxyToken, proxyHost, proxyPort, timeoutMs = 20_000 }) {
    this.name = name;
    this.baseUrl = new URL(baseUrl);
    this.adminToken = adminToken;
    this.proxy = { host: proxyHost ?? this.baseUrl.hostname, port: proxyPort ?? Number(this.baseUrl.port), token: proxyToken };
    this.timeoutMs = timeoutMs;
    this.connectionPool = new Map();
  }

  async request(path, options = {}) {
    const url = new URL(`/api/v1${path}`, this.baseUrl);
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${this.adminToken}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) {
      const message = payload?.message ?? payload?.error?.message ?? String(payload ?? response.statusText);
      throw new Error(`${this.name} Resin ${response.status}: ${message}`);
    }
    return payload;
  }

  async listNodes(filters = "enabled=true&has_outbound=true&circuit_open=false") {
    const page = await this.request(`/nodes?limit=100000&${filters}`);
    return (page.items ?? []).filter((node) => node.enabled && node.has_outbound && node.circuit_open_since == null);
  }

  async listAllNodes() {
    const page = await this.request("/nodes?limit=100000");
    return page.items ?? [];
  }

  async listPlatforms() { return (await this.request("/platforms?limit=100000")).items ?? []; }
  async createPlatform(body) { return this.request("/platforms", { method: "POST", body }); }
  async patchPlatform(id, body) { return this.request(`/platforms/${id}`, { method: "PATCH", body }); }
  async deletePlatform(id) { return this.request(`/platforms/${id}`, { method: "DELETE" }); }
  async previewSpec(regexFilters) {
    const page = await this.request("/platforms/preview-filter?limit=100000", {
      method: "POST", body: { platform_spec: { regex_filters: regexFilters, region_filters: [] } },
    });
    return page.items ?? page;
  }
  async previewPlatform(id) {
    const page = await this.request("/platforms/preview-filter?limit=100000", { method: "POST", body: { platform_id: id } });
    return page.items ?? page;
  }

  async proxyRequest(platform, url, options = {}) {
    return requestViaHttpProxy({
      proxy: this.proxy,
      platform,
      account: options.account ?? `purpose-probe-${process.pid}`,
      url,
      method: options.method,
      headers: options.headers,
      body: options.body,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maxBodyBytes: options.maxBodyBytes,
      redirects: options.redirects,
      connectionPool: this.connectionPool,
    });
  }

  closePooledConnections() {
    for (const socket of this.connectionPool.values()) {
      socket.destroy();
    }
    this.connectionPool.clear();
  }
}

function connectTunnel(proxy, target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("proxy CONNECT timeout")));
    socket.once("error", reject);
    socket.once("connect", () => {
      const auth = Buffer.from(`${target.identity}:${proxy.token}`).toString("base64");
      socket.write(`CONNECT ${target.host}:${target.port} HTTP/1.1\r\nHost: ${target.host}:${target.port}\r\nProxy-Authorization: Basic ${auth}\r\nConnection: keep-alive\r\n\r\n`);
    });
    let buffered = Buffer.alloc(0);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      socket.off("data", onData);
      const header = buffered.subarray(0, boundary).toString("latin1");
      const match = header.match(/^HTTP\/\d\.\d\s+(\d+)/);
      if (!match || Number(match[1]) !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: ${match?.[1] ?? "invalid response"}`));
        return;
      }
      const rest = buffered.subarray(boundary + 4);
      if (rest.length) socket.unshift(rest);
      socket.setTimeout(0);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}

function getConnectionPoolKey(input, target) {
  return `${input.platform}.${input.account}@${target.hostname}:${target.port || 443}`;
}

function isSocketUsable(socket) {
  return socket && !socket.destroyed && !socket.errored && socket.writable;
}

async function createSecureConnection(input, target) {
  const rawSocket = await connectTunnel(input.proxy, target, input.timeoutMs);
  
  const secureSocket = await new Promise((resolve, reject) => {
    const socket = tls.connect({ socket: rawSocket, servername: target.hostname, ALPNProtocols: ["http/1.1"] });
    socket.setTimeout(input.timeoutMs, () => socket.destroy(new Error("TLS timeout")));
    socket.once("secureConnect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("error", reject);
  });
  
  return secureSocket;
}

async function getOrCreateSecureConnection(input, target) {
  const pool = input.connectionPool;
  if (!pool) return createSecureConnection(input, target);
  
  const key = getConnectionPoolKey(input, target);
  const pooled = pool.get(key);
  
  if (pooled && isSocketUsable(pooled)) {
    return pooled;
  }
  
  if (pooled) {
    pool.delete(key);
    pooled.destroy();
  }
  
  const secureSocket = await createSecureConnection(input, target);
  secureSocket.once("close", () => pool.delete(key));
  secureSocket.once("error", () => pool.delete(key));
  pool.set(key, secureSocket);
  return secureSocket;
}

async function oneProxyRequest(input) {
  const target = new URL(input.url);
  if (target.protocol !== "https:") throw new Error("purpose probes require HTTPS targets");
  
  const secureSocket = await getOrCreateSecureConnection(input, {
    host: target.hostname,
    port: Number(target.port || 443),
    identity: `${input.platform}.${input.account}`,
  });
  
  const body = input.body == null ? null : Buffer.from(typeof input.body === "string" ? input.body : JSON.stringify(input.body));
  return new Promise((resolve, reject) => {
    const agent = new http.Agent({ keepAlive: true });
    agent.createConnection = () => secureSocket;
    const request = http.request({
      method: input.method ?? (body ? "POST" : "GET"),
      host: target.hostname,
      port: Number(target.port || 443),
      path: `${target.pathname}${target.search}`,
      headers: {
        Host: target.host,
        "User-Agent": "resin-purpose-probe/1.0",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Connection: "keep-alive",
        ...(body ? { "Content-Length": body.length, "Content-Type": "application/json" } : {}),
        ...input.headers,
      },
      agent,
      maxHeaderSize: input.maxHeaderSize ?? (64 * 1024),
    }, (response) => {
      const chunks = [];
      let size = 0;
      const max = input.maxBodyBytes ?? 1024 * 1024;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= max) chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: size > max });
      });
    });
    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new Error("request timeout"));
      if (input.connectionPool) {
        const key = getConnectionPoolKey(input, target);
        input.connectionPool.delete(key);
      }
    });
    request.once("error", (error) => {
      if (input.connectionPool) {
        const key = getConnectionPoolKey(input, target);
        input.connectionPool.delete(key);
      }
      reject(error);
    });
    if (body) request.write(body);
    request.end();
  });
}

export async function requestViaHttpProxy(input) {
  let current = input.url;
  const redirects = input.redirects ?? 3;
  for (let attempt = 0; attempt <= redirects; attempt += 1) {
    const response = await oneProxyRequest({ ...input, url: current });
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) return { ...response, url: current };
    const nextUrl = new URL(response.headers.location, current).toString();
    if (/sorry\/index|\/sorry\?|google\.com\/sorry/i.test(nextUrl)) {
      return { ...response, status: 403, body: `Google captcha/sorry block: ${nextUrl}`, url: nextUrl };
    }
    current = nextUrl;
  }
  return { status: 429, body: "too many redirects", url: current, headers: {} };
}
