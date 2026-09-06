import assert from "node:assert/strict";
import test from "node:test";
import { applyTwoInstanceUpdate } from "../lib/runner.mjs";

function client(name, { failPatch = false } = {}) {
  const calls = [];
  return {
    calls,
    previewSpec: async () => [{ node_hash: "aa" }],
    patchPlatform: async (id, body) => {
      calls.push(["patch", id, body]);
      if (failPatch && calls.length === 1) throw new Error(`${name} failed`);
    },
    createPlatform: async () => { throw new Error("not expected"); },
    deletePlatform: async () => {},
  };
}

test("second instance failure restores the first instance", async () => {
  const first = client("first");
  const second = client("second", { failPatch: true });
  const change = (instance, api) => ({
    client: api, instance, purpose: "GoogleAI", platform: { id: `${instance}-id` },
    expectedHashes: new Set(["aa"]), regexFilters: ["^Tag/A$"],
    oldRegexFilters: ["^Old$"], oldRegionFilters: ["us"],
  });
  await assert.rejects(applyTwoInstanceUpdate([change("first", first), change("second", second)]), /second failed/);
  assert.deepEqual(first.calls, [
    ["patch", "first-id", { regex_filters: ["^Tag/A$"], region_filters: [] }],
    ["patch", "first-id", { regex_filters: ["^Old$"], region_filters: ["us"] }],
  ]);
});
