import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { ResinClient, SecretResolver } from "../lib/resin-client.mjs";

test("ResinClient uses the simulated Resin control API", async (t) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
      response.setHeader("Content-Type", "application/json");
      if (request.url.startsWith("/api/v1/nodes")) response.end(JSON.stringify({ items: [{ node_hash: "aa", enabled: true, has_outbound: true, circuit_open_since: null }], total: 1 }));
      else if (request.url.startsWith("/api/v1/platforms/preview-filter")) response.end(JSON.stringify({ items: [], total: 0 }));
      else response.end(JSON.stringify({ items: [], total: 0 }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const client = new ResinClient({ name: "mock", baseUrl: `http://127.0.0.1:${port}`, adminToken: "admin", proxyToken: "proxy" });
  const nodes = await client.listNodes();
  await client.previewSpec(["^Tag$"]);
  assert.equal(nodes.length, 1);
  assert.equal(requests[0].authorization, "Bearer admin");
  assert.match(requests[0].url, /enabled=true/);
  assert.deepEqual(JSON.parse(requests[1].body), { platform_spec: { regex_filters: ["^Tag$"], region_filters: [] } });
});

test("SecretResolver does not accept literal tokens", async () => {
  const resolver = new SecretResolver({ TOKEN: "value" });
  assert.equal(await resolver.resolve({ env: "TOKEN" }, "token"), "value");
  await assert.rejects(resolver.resolve({ token: "value" }, "token"), /must define env or command/);
});
