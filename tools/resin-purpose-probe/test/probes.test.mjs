import assert from "node:assert/strict";
import test from "node:test";
import { probeGoogleAI, probeOpenCode } from "../lib/probes.mjs";

function fakeClient(responses) {
  let index = 0;
  return { proxyRequest: async () => responses[index++] };
}

test("GoogleAI probe classifies a 4/5 result as pass", async () => {
  const response = (status = 200, body = "ok") => ({ status, body, headers: {} });
  const responses = [response()];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    responses.push(response(), cycle === 4 ? response(403, "not available in your country") : response());
  }
  const result = await probeGoogleAI(fakeClient(responses), "Temp", { cycles: 5 });
  assert.equal(result.classification, "pass");
});

test("GoogleAI stops after an inconclusive transport check", async () => {
  let calls = 0;
  const client = { proxyRequest: async () => { calls += 1; throw new Error("timeout"); } };
  const result = await probeGoogleAI(client, "Temp", { cycles: 5 });
  assert.equal(result.classification, "inconclusive");
  assert.equal(calls, 1);
  assert.deepEqual(result.cycles, []);
});

test("OpenCode success requires models and exact ok generation", async () => {
  const client = fakeClient([
    { status: 200, body: JSON.stringify({ data: [{ id: "model-free" }] }) },
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) },
  ]);
  const result = await probeOpenCode(client, "Temp", "secret");
  assert.equal(result.classification, "pass");
});

test("OpenCode explicit denial is fail and retryable status is inconclusive", async () => {
  const denied = await probeOpenCode(fakeClient([{ status: 403, body: "region is not supported" }]), "Temp", "secret");
  assert.equal(denied.classification, "fail");
  const retryable = await probeOpenCode(fakeClient([{ status: 429, body: "slow down" }]), "Temp", "secret");
  assert.equal(retryable.classification, "inconclusive");
});
