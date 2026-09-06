import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PURPOSES, buildTagIndex, exactTagForNode, exactTagRegex, mergeHealthyNodes,
  mergePurposeMembership, redact, regexesForHashes, summarizeClassifications,
} from "./core.mjs";
import { ResinClient, SecretResolver, SshTunnel } from "./resin-client.mjs";
import { probeGoogleAI, probeOpenCode } from "./probes.mjs";

const TEMP_PREFIX = "PurposeProbe-";

async function loadPrevious(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function setupInstance(config, resolver) {
  let tunnel = null;
  try {
    let host;
    let port;
    if (config.sshTunnel) {
      tunnel = new SshTunnel(config.sshTunnel);
      ({ host, port } = await tunnel.start());
    } else {
      const parsed = new URL(config.baseUrl);
      host = config.proxyHost ?? parsed.hostname;
      port = config.proxyPort ?? Number(parsed.port || 80);
    }
    const adminToken = await resolver.resolve(config.adminToken, `${config.name}.adminToken`);
    const proxyToken = await resolver.resolve(config.proxyToken, `${config.name}.proxyToken`);
    const baseUrl = tunnel ? `http://${host}:${port}` : config.baseUrl;
    return {
      config,
      tunnel,
      client: new ResinClient({ name: config.name, baseUrl, adminToken, proxyToken, proxyHost: host, proxyPort: port, timeoutMs: config.timeoutMs }),
    };
  } catch (error) {
    await tunnel?.close();
    throw error;
  }
}

async function cleanupTemporaryPlatforms(client) {
  const platforms = await client.listPlatforms();
  for (const platform of platforms.filter((item) => item.name.startsWith(TEMP_PREFIX))) {
    await client.deletePlatform(platform.id);
  }
}

async function targetState(client, names) {
  const platforms = await client.listPlatforms();
  const byName = new Map(platforms.map((platform) => [platform.name, platform]));
  const result = {};
  for (const name of names) {
    const platform = byName.get(name) ?? null;
    const members = platform ? await client.previewPlatform(platform.id) : [];
    result[name] = { platform, members: new Set(members.map((node) => node.node_hash.toLowerCase())) };
  }
  return result;
}

function distributeWorkers(tasksByInstance, concurrency) {
  const active = Object.entries(tasksByInstance).filter(([, tasks]) => tasks.length > 0);
  if (active.length === 0) return {};
  const result = Object.fromEntries(active.map(([name]) => [name, 1]));
  let remaining = Math.max(0, concurrency - active.length);
  while (remaining > 0) {
    active.sort((a, b) => (b[1].length / result[b[0]]) - (a[1].length / result[a[0]]));
    result[active[0][0]] += 1;
    remaining -= 1;
  }
  return result;
}

async function runInstanceWorkers(instance, tasks, workerCount, tagIndex, probeConfig, opencodeKey, logger) {
  let cursor = 0;
  const output = new Map();
  const worker = async (workerIndex) => {
    const name = `${TEMP_PREFIX}${process.pid}-${instance.config.name}-${workerIndex}`;
    let platform;
    try {
      platform = await instance.client.createPlatform({
        name,
        regex_filters: ["^$"],
        region_filters: [],
        sticky_ttl: "1m",
        passive_circuit_breaker_disabled: true,
      });
    } catch (error) {
      if (error.message.includes("passive_circuit_breaker_disabled")) {
        throw new Error(`${instance.config.name} Resin does not support passive_circuit_breaker_disabled; upgrade Resin before running purpose probes`);
      }
      throw error;
    }
    try {
      while (true) {
        const taskIndex = cursor++;
        if (taskIndex >= tasks.length) break;
        const task = tasks[taskIndex];
        const node = task.instances[instance.config.name];
        try {
          const tag = exactTagForNode(node, tagIndex);
          const regex = exactTagRegex(tag);
          await instance.client.patchPlatform(platform.id, { regex_filters: [regex], region_filters: [], passive_circuit_breaker_disabled: true });
          const preview = await instance.client.previewPlatform(platform.id);
          if (preview.length !== 1 || preview[0].node_hash.toLowerCase() !== task.node_hash) {
            throw new Error(`temporary platform matched ${preview.length} nodes instead of ${task.node_hash}`);
          }
          let observedEgress = node.egress_ip ?? "";
          const egressPromise = observedEgress ? null : instance.client
            .proxyRequest(name, probeConfig.egressUrl ?? "https://api.ipify.org?format=json", {
              timeoutMs: Math.min(probeConfig.timeoutMs ?? 10_000, 5_000),
            })
            .then((egress) => { observedEgress = JSON.parse(egress.body).ip ?? observedEgress; })
            .catch(() => {});
          const [google, openCode] = await Promise.all([
            probeGoogleAI(instance.client, name, probeConfig.googleAI),
            probeOpenCode(instance.client, name, opencodeKey, probeConfig.openCode),
            egressPromise,
          ]);
          output.set(task.node_hash, { probe_instance: instance.config.name, tag, egress_ip: observedEgress, region: node.region ?? "", GoogleAI: google, OpenCode: openCode });
          logger(`${instance.config.name} ${task.node_hash.slice(0, 8)} GoogleAI=${google.classification} OpenCode=${openCode.classification}`);
        } catch (error) {
          output.set(task.node_hash, {
            probe_instance: instance.config.name,
            egress_ip: node.egress_ip ?? "",
            region: node.region ?? "",
            GoogleAI: { classification: "inconclusive", error: error.message },
            OpenCode: { classification: "inconclusive", error: error.message },
          });
          logger(`${instance.config.name} ${task.node_hash.slice(0, 8)} inconclusive (${error.message})`);
        }
      }
    } finally {
      await instance.client.deletePlatform(platform.id).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));
  return output;
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

export async function applyTwoInstanceUpdate(changes) {
  for (const change of changes) {
    const preview = await change.client.previewSpec(change.regexFilters);
    const actual = new Set(preview.map((node) => node.node_hash.toLowerCase()));
    if (!setEquals(actual, change.expectedHashes)) throw new Error(`${change.instance} ${change.purpose} preview mismatch`);
  }
  const applied = [];
  try {
    for (const change of changes) {
      if (change.platform) {
        await change.client.patchPlatform(change.platform.id, { regex_filters: change.regexFilters, region_filters: [] });
        applied.push({ ...change, created: false });
      } else {
        const platform = await change.client.createPlatform({ name: change.purpose, regex_filters: change.regexFilters, region_filters: [] });
        applied.push({ ...change, platform, created: true });
      }
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if (change.created) await change.client.deletePlatform(change.platform.id).catch(() => {});
      else await change.client.patchPlatform(change.platform.id, { regex_filters: change.oldRegexFilters, region_filters: change.oldRegionFilters }).catch(() => {});
    }
    throw error;
  }
}

export async function runScan(config, options = {}, dependencies = {}) {
  const logger = dependencies.logger ?? console.log;
  const resolver = dependencies.resolver ?? new SecretResolver();
  const now = new Date().toISOString();
  const resultDir = path.resolve(options.configDir ?? process.cwd(), config.resultsDir ?? "data");
  const latestFile = path.join(resultDir, "latest.json");
  const historyFile = path.join(resultDir, "history.jsonl");
  const previous = await loadPrevious(latestFile);
  const instances = [];
  try {
    for (const instanceConfig of config.instances) instances.push(await setupInstance(instanceConfig, resolver));
    await Promise.all(instances.map((instance) => cleanupTemporaryPlatforms(instance.client)));
    const nodesByInstance = Object.fromEntries(await Promise.all(instances.map(async (instance) => [instance.config.name, await instance.client.listNodes()])));
    const allNodesByInstance = Object.fromEntries(await Promise.all(instances.map(async (instance) => [instance.config.name, await instance.client.listAllNodes()])));
    const mergedAll = mergeHealthyNodes(nodesByInstance, config.preferredInstance ?? "rn-direct");
    const limited = Number.isInteger(options.limit) && options.limit >= 0;
    const merged = limited ? mergedAll.slice(0, options.limit) : mergedAll;
    const trackedPlatforms = [...PURPOSES, "searxng"];
    const targetStates = Object.fromEntries(await Promise.all(instances.map(async (instance) => [instance.config.name, await targetState(instance.client, trackedPlatforms)])));
    const opencodeKey = await resolver.resolve(config.openCode.apiKey, "openCode.apiKey");
    const safeLog = (message) => logger(redact(String(message), resolver.values));
    const tasksByInstance = Object.fromEntries(instances.map((instance) => [instance.config.name, merged.filter((item) => item.probe_instance === instance.config.name)]));
    const workerCounts = distributeWorkers(tasksByInstance, config.concurrency ?? 4);
    const probeOutput = new Map();
    await Promise.all(instances.map(async (instance) => {
      const tasks = tasksByInstance[instance.config.name];
      if (tasks.length === 0) return;
      const partial = await runInstanceWorkers(
        instance, tasks, workerCounts[instance.config.name], buildTagIndex(allNodesByInstance[instance.config.name]),
        { ...(config.probes ?? {}), openCode: { ...(config.probes?.openCode ?? {}), baseUrl: config.openCode.baseUrl } }, opencodeKey, safeLog,
      );
      for (const [hash, value] of partial) probeOutput.set(hash, value);
    }));

    const classifications = Object.fromEntries(PURPOSES.map((purpose) => [purpose, Object.fromEntries([...probeOutput].map(([hash, value]) => [hash, value[purpose].classification]))]));
    const complete = !limited || merged.length === mergedAll.length;
    const platformChanges = [];
    const changesSummary = [];
    if (complete) {
      for (const purpose of PURPOSES) {
        const counts = summarizeClassifications(classifications[purpose]);
        if (counts.pass === 0 && !options.allowEmpty) {
          changesSummary.push({ purpose, action: "preserved", reason: "zero_pass" });
          continue;
        }
        const purposeChanges = [];
        for (const instance of instances) {
          const healthyNodes = nodesByInstance[instance.config.name];
          const healthyHashes = new Set(healthyNodes.map((node) => node.node_hash.toLowerCase()));
          const state = targetStates[instance.config.name][purpose];
          const desired = mergePurposeMembership(classifications[purpose], state.members, healthyHashes);
          const regexFilters = regexesForHashes(healthyNodes, desired, buildTagIndex(allNodesByInstance[instance.config.name]));
          purposeChanges.push({
            client: instance.client, instance: instance.config.name, purpose,
            platform: state.platform, expectedHashes: desired, regexFilters,
            oldRegexFilters: state.platform?.regex_filters ?? [], oldRegionFilters: state.platform?.region_filters ?? [],
          });
          changesSummary.push({ purpose, instance: instance.config.name, before: state.members.size, after: desired.size });
        }
        platformChanges.push(purposeChanges);
      }

      // Also maintain searxng platform using Google-capable nodes
      const googleCounts = summarizeClassifications(classifications["GoogleAI"]);
      if (googleCounts.pass === 0 && !options.allowEmpty) {
        changesSummary.push({ purpose: "searxng", action: "preserved", reason: "zero_pass" });
      } else {
        const searxngChanges = [];
        for (const instance of instances) {
          const healthyNodes = nodesByInstance[instance.config.name];
          const healthyHashes = new Set(healthyNodes.map((node) => node.node_hash.toLowerCase()));
          const state = targetStates[instance.config.name]["searxng"];
          const desired = mergePurposeMembership(classifications["GoogleAI"], state.members, healthyHashes);
          const regexFilters = regexesForHashes(healthyNodes, desired, buildTagIndex(allNodesByInstance[instance.config.name]));
          searxngChanges.push({
            client: instance.client, instance: instance.config.name, purpose: "searxng",
            platform: state.platform, expectedHashes: desired, regexFilters,
            oldRegexFilters: state.platform?.regex_filters ?? [], oldRegionFilters: state.platform?.region_filters ?? [],
          });
          changesSummary.push({ purpose: "searxng", instance: instance.config.name, before: state.members.size, after: desired.size });
        }
        platformChanges.push(searxngChanges);
      }
    } else {
      changesSummary.push({ action: "preserved", reason: "partial_scan" });
    }

    if (!options.dryRun) {
      for (const changes of platformChanges) await applyTwoInstanceUpdate(changes);
    }
    const latest = {
      schema_version: 1, scanned_at: now, dry_run: Boolean(options.dryRun), complete,
      counts: { per_instance: Object.fromEntries(Object.entries(nodesByInstance).map(([name, nodes]) => [name, nodes.length])), union: mergedAll.length, scanned: merged.length },
      classifications: Object.fromEntries(PURPOSES.map((purpose) => [purpose, summarizeClassifications(classifications[purpose])])),
      instance_differences: instances.length === 2 ? {
        only_in_first: nodesByInstance[instances[0].config.name].filter((node) => !nodesByInstance[instances[1].config.name].some((other) => other.node_hash === node.node_hash)).length,
        only_in_second: nodesByInstance[instances[1].config.name].filter((node) => !nodesByInstance[instances[0].config.name].some((other) => other.node_hash === node.node_hash)).length,
      } : {},
      platform_changes: changesSummary,
      nodes: Object.fromEntries([...probeOutput]),
      previous_scan_at: previous?.scanned_at ?? null,
    };
    const safeLatest = redact(latest, resolver.values);
    await atomicJson(latestFile, safeLatest);
    await mkdir(path.dirname(historyFile), { recursive: true });
    await appendFile(historyFile, `${JSON.stringify(redact({ scanned_at: now, dry_run: Boolean(options.dryRun), complete, counts: latest.counts, classifications: latest.classifications, platform_changes: changesSummary }, resolver.values))}\n`, { mode: 0o600 });
    safeLog(`nodes instance=${Object.values(latest.counts.per_instance).join("/")} union=${mergedAll.length} scanned=${merged.length}`);
    for (const purpose of PURPOSES) {
      const item = latest.classifications[purpose];
      safeLog(`${purpose} pass=${item.pass} fail=${item.fail} inconclusive=${item.inconclusive}`);
    }
    const searxngSummary = changesSummary.filter((c) => c.purpose === "searxng");
    if (searxngSummary.length > 0) {
      safeLog(`searxng ${searxngSummary.map((s) => `${s.instance}=${s.after ?? s.action}`).join(" ")}`);
    }
    return safeLatest;
  } finally {
    await Promise.all(instances.map((instance) => instance.tunnel?.close()));
  }
}
