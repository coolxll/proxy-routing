export const PURPOSES = ["GoogleAI", "OpenCode"];

export function isHealthyNode(node) {
  return node?.enabled === true && node?.has_outbound === true && node?.circuit_open_since == null;
}

export function mergeHealthyNodes(instanceNodes, preferredInstance = "rn-direct") {
  const merged = new Map();
  for (const [instanceName, nodes] of Object.entries(instanceNodes)) {
    for (const node of nodes.filter(isHealthyNode)) {
      const hash = String(node.node_hash).toLowerCase();
      const entry = merged.get(hash) ?? { node_hash: hash, instances: {}, probe_instance: instanceName };
      entry.instances[instanceName] = { ...node, node_hash: hash };
      if (instanceName === preferredInstance) entry.probe_instance = instanceName;
      merged.set(hash, entry);
    }
  }
  return [...merged.values()].sort((a, b) => a.node_hash.localeCompare(b.node_hash));
}

export function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function buildTagIndex(nodes) {
  const index = new Map();
  for (const node of nodes) {
    for (const item of node.tags ?? []) {
      const tag = item.tag;
      if (!tag) continue;
      if (!index.has(tag)) index.set(tag, new Set());
      index.get(tag).add(String(node.node_hash).toLowerCase());
    }
  }
  return index;
}

export function exactTagForNode(node, tagIndex) {
  const hash = String(node.node_hash).toLowerCase();
  const candidates = [...new Set((node.tags ?? []).map((item) => item.tag).filter(Boolean))].sort();
  for (const tag of candidates) {
    const owners = tagIndex.get(tag);
    if (owners?.size === 1 && owners.has(hash)) return tag;
  }
  throw new Error(`node ${hash} has no unique tag; conflicting tags: ${candidates.join(", ") || "none"}`);
}

export function exactTagRegex(tag) {
  return `^${escapeRegex(tag)}$`;
}

export function regexesForHashes(nodes, hashes, tagIndex = buildTagIndex(nodes)) {
  const wanted = new Set([...hashes].map((hash) => String(hash).toLowerCase()));
  const tags = nodes
    .filter((node) => wanted.has(String(node.node_hash).toLowerCase()))
    .map((node) => exactTagForNode(node, tagIndex))
    .sort();
  // Resin treats an empty filter list as "all enabled nodes", and multiple filters as AND.
  if (tags.length === 0) return ["^$"];
  if (tags.length === 1) return [exactTagRegex(tags[0])];
  return [`^(?:${tags.map(escapeRegex).join("|")})$`];
}

export function classifyGoogleAI(transport, cycles, requiredPasses = 4) {
  if (transport?.classification !== "pass") {
    return transport?.classification === "fail" ? "fail" : "inconclusive";
  }
  const clear = cycles.filter((item) => item === "pass" || item === "fail");
  const passes = clear.filter((item) => item === "pass").length;
  if (passes >= requiredPasses) return "pass";
  if (clear.length === cycles.length) return "fail";
  return "inconclusive";
}

export function classifyOpenCode(modelsResult, generationResult) {
  if (modelsResult?.classification === "fail" || generationResult?.classification === "fail") return "fail";
  if (modelsResult?.classification !== "pass" || generationResult?.classification !== "pass") return "inconclusive";
  return generationResult.output?.trim().toLowerCase() === "ok" ? "pass" : "fail";
}

export function mergePurposeMembership(results, oldMembers, healthyHashes) {
  const old = new Set([...oldMembers].map((hash) => String(hash).toLowerCase()));
  const healthy = new Set([...healthyHashes].map((hash) => String(hash).toLowerCase()));
  const next = new Set();
  for (const [hashValue, classification] of Object.entries(results)) {
    const hash = hashValue.toLowerCase();
    if (!healthy.has(hash)) continue;
    if (classification === "pass" || (classification === "inconclusive" && old.has(hash))) next.add(hash);
  }
  return next;
}

export function summarizeClassifications(results) {
  const summary = { pass: 0, fail: 0, inconclusive: 0 };
  for (const value of Object.values(results)) {
    if (value in summary) summary[value] += 1;
  }
  return summary;
}

export function redact(value, secrets = []) {
  const secretValues = secrets.filter((item) => typeof item === "string" && item.length > 0);
  const visit = (input, key = "") => {
    if (/token|secret|password|api.?key/i.test(key)) return "<redacted>";
    if (typeof input === "string") {
      let output = input;
      for (const secret of secretValues) output = output.split(secret).join("<redacted>");
      return output;
    }
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([childKey, item]) => [childKey, visit(item, childKey)]));
    }
    return input;
  };
  return visit(value);
}
