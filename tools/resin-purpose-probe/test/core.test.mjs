import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTagIndex, classifyGoogleAI, exactTagForNode, exactTagRegex, mergeHealthyNodes,
  mergePurposeMembership, redact, regexesForHashes,
} from "../lib/core.mjs";

const node = (hash, tag, extra = {}) => ({
  node_hash: hash, enabled: true, has_outbound: true, circuit_open_since: null,
  tags: [{ tag }], ...extra,
});

test("healthy node union deduplicates by node_hash and prefers rn-direct", () => {
  const merged = mergeHealthyNodes({
    wujie: [node("AA", "sub/a"), node("BB", "sub/b", { circuit_open_since: "now" })],
    "rn-direct": [node("aa", "other/a"), node("CC", "sub/c")],
  });
  assert.deepEqual(merged.map((item) => item.node_hash), ["aa", "cc"]);
  assert.equal(merged[0].probe_instance, "rn-direct");
  assert.deepEqual(Object.keys(merged[0].instances).sort(), ["rn-direct", "wujie"]);
});

test("exact tag regex escapes metacharacters and duplicate tags conflict", () => {
  const first = node("aa", "Sub/HK (01)+");
  assert.equal(exactTagRegex(exactTagForNode(first, buildTagIndex([first]))), "^Sub/HK \\(01\\)\\+$");
  const second = node("bb", "Sub/HK (01)+");
  assert.throws(() => exactTagForNode(first, buildTagIndex([first, second])), /no unique tag/);
});

test("empty desired membership uses a match-nothing regex", () => {
  assert.deepEqual(regexesForHashes([node("aa", "Sub/A")], new Set()), ["^$"]);
  assert.deepEqual(regexesForHashes([node("aa", "Sub/A")], new Set(["aa"])), ["^Sub/A$"]);
  assert.deepEqual(regexesForHashes([node("aa", "Sub/A"), node("bb", "Sub/B")], new Set(["aa", "bb"])), ["^(?:Sub/A|Sub/B)$"]);
});

test("GoogleAI requires four clear passes out of five", () => {
  assert.equal(classifyGoogleAI({ classification: "pass" }, ["pass", "pass", "pass", "pass", "fail"]), "pass");
  assert.equal(classifyGoogleAI({ classification: "pass" }, ["pass", "pass", "pass", "fail", "fail"]), "fail");
  assert.equal(classifyGoogleAI({ classification: "pass" }, ["pass", "pass", "pass", "fail", "inconclusive"]), "inconclusive");
  assert.equal(classifyGoogleAI({ classification: "inconclusive" }, ["pass", "pass", "pass", "pass", "pass"]), "inconclusive");
});

test("inconclusive preserves old membership while fail removes it", () => {
  const next = mergePurposeMembership(
    { aa: "pass", bb: "inconclusive", cc: "fail", dd: "inconclusive" },
    new Set(["bb", "cc"]), new Set(["aa", "bb", "cc", "dd"]),
  );
  assert.deepEqual([...next].sort(), ["aa", "bb"]);
});

test("tokens do not appear in log-like messages or result objects", () => {
  const secret = "top-secret-token";
  const logLine = redact(`failed with ${secret}`, [secret]);
  const result = redact({ message: `failed with ${secret}`, apiKey: secret, nested: [secret] }, [secret]);
  assert.equal(logLine.includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.apiKey, "<redacted>");
});
