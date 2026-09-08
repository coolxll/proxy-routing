import { classifyGoogleAI, classifyOpenCode } from "./core.mjs";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const GEO_DENIAL = /not available in your country|not supported in your country|unsupported country|region is not supported|country is not supported|location is not supported|geo.?restricted|sorry\/index|\/sorry\?|google\.com\/sorry|unusual traffic|recaptcha|google_abuse/i;
const PERMISSION_DENIAL = /permission|forbidden|not available in your (country|region)|unsupported (country|region)|access denied|not authorized/i;
const SSL_INTERCEPTION = /DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|ERR_SSL|SSL.*handshake.*failure|TLS.*handshake.*failure/i;

function classifyHttp(response, denialPattern = GEO_DENIAL) {
  if (RETRYABLE.has(response.status)) return { classification: "inconclusive", status: response.status };
  if (denialPattern.test(response.body ?? "") || denialPattern.test(response.url ?? "")) return { classification: "fail", status: response.status };
  if (response.status >= 200 && response.status < 400) return { classification: "pass", status: response.status };
  if (response.status >= 400 && response.status < 500) return { classification: "fail", status: response.status };
  return { classification: "inconclusive", status: response.status };
}

function classifyError(error) {
  if (SSL_INTERCEPTION.test(error)) return "fail";
  return "inconclusive";
}

async function safeRequest(fn) {
  try { return await fn(); }
  catch (error) {
    const kind = error?.code ?? error?.name ?? "network_error";
    const message = error?.message ?? String(error);
    return { error: message === kind ? kind : `${kind}: ${message}` };
  }
}

export async function probeGoogleAI(client, platform, config = {}) {
  const transportUrl = config.transportUrl ?? "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta";
  const targets = config.targets ?? ["https://gemini.google.com/", "https://aistudio.google.com/"];
  const cycles = config.cycles ?? 5;
  const timeoutMs = config.timeoutMs ?? 20_000;
  const requiredPasses = config.requiredPasses ?? 4;

  const transportResponse = await safeRequest(() => client.proxyRequest(platform, transportUrl, { timeoutMs }));
  const transport = transportResponse.status
    ? (RETRYABLE.has(transportResponse.status)
      ? { classification: "inconclusive", status: transportResponse.status }
      : { classification: "pass", status: transportResponse.status })
    : { classification: classifyError(transportResponse.error), error: transportResponse.error };

  if (transport.classification !== "pass") {
    return { classification: transport.classification === "fail" ? "fail" : "inconclusive", transport, cycles: [] };
  }

  const samples = [];
  const cycleResults = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const responses = await Promise.all(targets.map(async (url) => {
      const response = await safeRequest(() => client.proxyRequest(platform, url, { timeoutMs }));
      return response.status ? classifyHttp(response) : { classification: classifyError(response.error), error: response.error };
    }));
    samples.push({ cycle: cycle + 1, targets: responses });
    if (responses.every((item) => item.classification === "pass")) cycleResults.push("pass");
    else if (responses.some((item) => item.classification === "fail")) cycleResults.push("fail");
    else cycleResults.push("inconclusive");

    const passes = cycleResults.filter((item) => item === "pass").length;
    const inconclusiveCount = cycleResults.filter((item) => item === "inconclusive").length;
    if (passes >= requiredPasses) break;
    if (inconclusiveCount >= (cycles - requiredPasses + 1)) break;
  }
  return { classification: classifyGoogleAI(transport, cycleResults, requiredPasses), transport, cycles: samples };
}

function allowedModels(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item) => item?.id).filter((id) => typeof id === "string" && (id === "big-pickle" || id.endsWith("-free")));
}

function parseJson(body) {
  try { return JSON.parse(body); } catch { return null; }
}

function openCodeHttpClassification(response) {
  if (RETRYABLE.has(response.status)) return "inconclusive";
  if (response.status >= 200 && response.status < 300) return "pass";
  if (response.status === 401 || response.status === 403 || PERMISSION_DENIAL.test(response.body ?? "")) return "fail";
  return response.status >= 400 && response.status < 500 ? "fail" : "inconclusive";
}

export async function probeOpenCode(client, platform, apiKey, config = {}) {
  const baseUrl = (config.baseUrl ?? "https://opencode.ai/zen/v1").replace(/\/$/, "");
  const timeoutMs = config.timeoutMs ?? 45_000;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": "OpenCode/1.0" };
  const modelResponse = await safeRequest(() => client.proxyRequest(platform, `${baseUrl}/models`, { headers, timeoutMs }));
  if (!modelResponse.status) {
    const modelsResult = { classification: classifyError(modelResponse.error), error: modelResponse.error };
    return { classification: classifyOpenCode(modelsResult), models: modelsResult };
  }
  const modelClass = openCodeHttpClassification(modelResponse);
  const models = allowedModels(parseJson(modelResponse.body));
  const modelsResult = { classification: modelClass, status: modelResponse.status, allowed_count: models.length };
  if (modelClass !== "pass" || models.length === 0) {
    if (modelClass === "pass") modelsResult.classification = "fail";
    return { classification: classifyOpenCode(modelsResult), models: modelsResult };
  }

  // Skip chat completion for faster probing - models list is sufficient
  return { classification: "pass", models: modelsResult };
}
