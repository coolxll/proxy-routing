import assert from "node:assert/strict";
import test from "node:test";
import { probeGoogleAI, probeOpenCode } from "../lib/probes.mjs";

function fakeClient(responses, defaultResp = { status: 200, body: "ok" }) {
  let index = 0;
  return { proxyRequest: async () => responses[index++] ?? defaultResp };
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

test("GoogleAI probe short-circuits after 4 passes", async () => {
  const response = (status = 200, body = "ok") => ({ status, body, headers: {} });
  let calls = 0;
  const client = {
    proxyRequest: async () => {
      calls += 1;
      return response();
    },
  };
  const result = await probeGoogleAI(client, "Temp", { cycles: 5, requiredPasses: 4 });
  assert.equal(result.classification, "pass");
  // 1 transport call + 4 cycles * 2 targets = 9 calls (instead of 11 calls for 5 cycles)
  assert.equal(calls, 9);
  assert.equal(result.cycles.length, 4);
});

test("GoogleAI classifies captcha or sorry redirect as fail", async () => {
  const responses = [
    { status: 200, body: "ok" }, // transport
    { status: 403, body: "Google captcha/sorry block: https://www.google.com/sorry/index", url: "https://www.google.com/sorry/index" },
    { status: 200, body: "ok" },
  ];
  const client = fakeClient(responses);
  const result = await probeGoogleAI(client, "Temp", { cycles: 5 });
  assert.equal(result.cycles[0].targets[0].classification, "fail");
});
