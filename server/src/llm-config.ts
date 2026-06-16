import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { PI_AUTH_PATH, PI_MODELS_PATH, PI_SETTINGS_PATH } from "./config.ts";
import type {
  LlmApiKind,
  LlmAuthStatus,
  LlmModelEntry,
  LlmProviderInput,
  LlmProviderView,
  LlmSettingsView,
  LlmTestResult,
} from "./types.ts";

const SUPPORTED_API_KINDS: ReadonlySet<LlmApiKind> = new Set(["openai-completions"]);
const API_KEY_SENTINEL = "****";

type JsonObject = Record<string, unknown>;
type ModelsDoc = { providers: Record<string, JsonObject> } & JsonObject;
type SettingsDoc = JsonObject;
type AuthDoc = Record<string, JsonObject>;

export class LlmConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigValidationError";
  }
}

const asRecord = (value: unknown): JsonObject => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {});
const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => asString(item).trim()).filter(Boolean) : [];
const asNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const isApiKind = (value: unknown): value is LlmApiKind => typeof value === "string" && SUPPORTED_API_KINDS.has(value as LlmApiKind);

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readModelsDoc(): ModelsDoc {
  const raw = asRecord(readJsonFile(PI_MODELS_PATH));
  const providers: Record<string, JsonObject> = {};
  for (const [id, provider] of Object.entries(asRecord(raw.providers))) {
    providers[id] = asRecord(provider);
  }
  return { ...raw, providers };
}

function readSettingsDoc(): SettingsDoc {
  return asRecord(readJsonFile(PI_SETTINGS_PATH));
}

function readAuthDoc(): AuthDoc {
  return asRecord(readJsonFile(PI_AUTH_PATH)) as AuthDoc;
}

export function atomicWriteJson(path: string, obj: unknown): void {
  const previousMode = existsSync(path) ? statSync(path).mode & 0o777 : undefined;
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(obj, null, 2)}\n`, { encoding: "utf8", mode: previousMode });
  renameSync(tmpPath, path);
  if (previousMode !== undefined) chmodSync(path, previousMode);
}

function providerHasApiKey(provider: JsonObject): boolean {
  if (asString(provider.apiKey).trim()) return true;
  const models = Array.isArray(provider.models) ? provider.models : [];
  return models.some((model) => asString(asRecord(model).apiKey).trim() !== "");
}

function projectModelView(rawModel: unknown): LlmModelEntry | null {
  const model = asRecord(rawModel);
  const id = asString(model.id).trim();
  if (!id) return null;
  const view: LlmModelEntry = {
    id,
    name: asString(model.name).trim() || id,
  };
  const input = asStringArray(model.input);
  if (input.length > 0) view.input = input;
  const contextWindow = asNumber(model.contextWindow);
  if (contextWindow !== undefined) view.contextWindow = contextWindow;
  const maxTokens = asNumber(model.maxTokens);
  if (maxTokens !== undefined) view.maxTokens = maxTokens;
  if (typeof model.reasoning === "boolean") view.reasoning = model.reasoning;
  const baseUrl = asString(model.baseUrl).trim();
  if (baseUrl) view.baseUrl = baseUrl;
  if (isApiKind(model.api)) view.api = model.api;
  return view;
}

export function listProvidersView(): LlmProviderView[] {
  const raw = readModelsDoc();
  const auth = readAuthDoc();
  return Object.entries(raw.providers).map(([id, provider]): LlmProviderView => {
    const view: LlmProviderView = {
      id,
      hasApiKey: providerHasApiKey(provider),
      models: (Array.isArray(provider.models) ? provider.models : []).map(projectModelView).filter((model): model is LlmModelEntry => model !== null),
    };
    const baseUrl = asString(provider.baseUrl).trim();
    if (baseUrl) view.baseUrl = baseUrl;
    if (isApiKind(provider.api)) view.api = provider.api;
    if (asString(auth[id]?.type) === "oauth") view.oauth = true;
    return view;
  });
}

function coerceApiKind(value: unknown, fieldName: string): LlmApiKind | undefined {
  if (value == null || asString(value).trim() === "") return undefined;
  if (!isApiKind(value)) throw new LlmConfigValidationError(`${fieldName} must be openai-completions`);
  return value;
}

function coerceModelInput(input: unknown, prevModel: JsonObject): JsonObject {
  const raw = asRecord(input);
  const id = asString(raw.id).trim();
  if (!id) throw new LlmConfigValidationError("models[].id required");
  const next: JsonObject = { ...prevModel, id, name: asString(raw.name).trim() || id };

  const inputKinds = asStringArray(raw.input);
  next.input = inputKinds.length > 0 ? inputKinds : ["text"];

  const contextWindow = asNumber(raw.contextWindow);
  if (contextWindow !== undefined) next.contextWindow = clamp(Math.round(contextWindow), 1, 10_000_000);
  else delete next.contextWindow;

  const maxTokens = asNumber(raw.maxTokens);
  if (maxTokens !== undefined) next.maxTokens = clamp(Math.round(maxTokens), 1, 10_000_000);
  else delete next.maxTokens;

  if (typeof raw.reasoning === "boolean") next.reasoning = raw.reasoning;
  else delete next.reasoning;

  const baseUrl = asString(raw.baseUrl).trim();
  if (baseUrl) next.baseUrl = baseUrl;
  else delete next.baseUrl;

  const api = coerceApiKind(raw.api, "models[].api");
  if (api) next.api = api;
  else delete next.api;

  return next;
}

function shouldKeepPreviousApiKey(value: unknown): boolean {
  const next = asString(value).trim();
  return next === "" || next === API_KEY_SENTINEL;
}

export function coerceProviderInput(id: string, input: unknown, prevRaw: ModelsDoc): JsonObject {
  const providerId = id.trim();
  if (!providerId) throw new LlmConfigValidationError("provider id required");

  const raw = asRecord(input);
  const prevProvider = asRecord(prevRaw.providers[providerId]);
  const isOauthProvider = asString(readAuthDoc()[providerId]?.type) === "oauth";
  const next: JsonObject = { ...prevProvider };

  const baseUrl = asString(raw.baseUrl).trim();
  if (baseUrl) next.baseUrl = baseUrl;
  else delete next.baseUrl;

  const api = coerceApiKind(raw.api, "api");
  if (api) next.api = api;
  else delete next.api;

  if (isOauthProvider) {
    if (typeof prevProvider.apiKey === "string" && prevProvider.apiKey.trim()) next.apiKey = prevProvider.apiKey;
    else delete next.apiKey;
  } else if (!shouldKeepPreviousApiKey(raw.apiKey)) {
    next.apiKey = asString(raw.apiKey).trim();
  } else if (typeof prevProvider.apiKey === "string" && prevProvider.apiKey.trim()) {
    next.apiKey = prevProvider.apiKey;
  } else {
    delete next.apiKey;
  }

  const prevModelsById = new Map<string, JsonObject>();
  for (const model of Array.isArray(prevProvider.models) ? prevProvider.models : []) {
    const record = asRecord(model);
    const modelId = asString(record.id).trim();
    if (modelId) prevModelsById.set(modelId, record);
  }

  const rawModels = Array.isArray(raw.models) ? raw.models : [];
  if (rawModels.length === 0) throw new LlmConfigValidationError("models required");
  const seenModelIds = new Set<string>();
  const models = rawModels.map((modelInput) => {
    const modelId = asString(asRecord(modelInput).id).trim();
    if (seenModelIds.has(modelId)) throw new LlmConfigValidationError(`duplicate model id: ${modelId}`);
    seenModelIds.add(modelId);
    return coerceModelInput(modelInput, prevModelsById.get(modelId) ?? {});
  });
  next.models = models;

  const hasProviderBaseUrl = asString(next.baseUrl).trim() !== "";
  const allModelsHaveBaseUrl = models.every((model) => asString(model.baseUrl).trim() !== "");
  if (!hasProviderBaseUrl && !allModelsHaveBaseUrl) {
    throw new LlmConfigValidationError("baseUrl required at provider level or every model");
  }

  return next;
}

function parseProvidersInput(body: unknown): LlmProviderInput[] {
  if (Array.isArray(body)) return body as LlmProviderInput[];
  const providers = (body as { providers?: unknown } | null)?.providers;
  return Array.isArray(providers) ? providers as LlmProviderInput[] : [];
}

export function writeProviders(body: unknown): LlmProviderView[] {
  const prev = readModelsDoc();
  const inputs = parseProvidersInput(body);
  const nextProviders: Record<string, JsonObject> = {};
  const seen = new Set<string>();
  for (const input of inputs) {
    const id = asString(asRecord(input).id).trim();
    if (!id) throw new LlmConfigValidationError("providers[].id required");
    if (seen.has(id)) throw new LlmConfigValidationError(`duplicate provider id: ${id}`);
    seen.add(id);
    nextProviders[id] = coerceProviderInput(id, input, prev);
  }

  const next: ModelsDoc = { ...prev, providers: nextProviders };
  atomicWriteJson(PI_MODELS_PATH, next);
  return listProvidersView();
}

export function readSettingsView(): LlmSettingsView {
  const raw = readSettingsDoc();
  const enabledModels = Array.isArray(raw.enabledModels)
    ? raw.enabledModels.map((item) => asString(item).trim()).filter(Boolean)
    : [];
  const view: LlmSettingsView = { enabledModels };
  const defaultProvider = asString(raw.defaultProvider).trim();
  const defaultModel = asString(raw.defaultModel).trim();
  if (defaultProvider) view.defaultProvider = defaultProvider;
  if (defaultModel) view.defaultModel = defaultModel;
  return view;
}

function ensureModelExists(providerId: string, modelId: string, modelsDoc: ModelsDoc): void {
  const provider = asRecord(modelsDoc.providers[providerId]);
  const models = Array.isArray(provider.models) ? provider.models : [];
  const exists = models.some((model) => asString(asRecord(model).id).trim() === modelId);
  if (!exists) throw new LlmConfigValidationError(`model not found: ${providerId}/${modelId}`);
}

export function writeSettings(patch: unknown): LlmSettingsView {
  const rawPatch = asRecord(patch);
  const enabledModels = Array.isArray(rawPatch.enabledModels)
    ? rawPatch.enabledModels.map((item) => asString(item).trim()).filter(Boolean)
    : [];
  for (const id of enabledModels) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(id)) throw new LlmConfigValidationError(`invalid enabled model: ${id}`);
  }

  const defaultProvider = asString(rawPatch.defaultProvider).trim();
  const defaultModel = asString(rawPatch.defaultModel).trim();
  if ((defaultProvider && !defaultModel) || (!defaultProvider && defaultModel)) {
    throw new LlmConfigValidationError("defaultProvider/defaultModel must be set together");
  }
  if (defaultProvider && defaultModel) ensureModelExists(defaultProvider, defaultModel, readModelsDoc());

  const next = structuredClone(readSettingsDoc()) as SettingsDoc;
  next.enabledModels = enabledModels;
  if (defaultProvider && defaultModel) {
    next.defaultProvider = defaultProvider;
    next.defaultModel = defaultModel;
  } else {
    delete next.defaultProvider;
    delete next.defaultModel;
  }
  atomicWriteJson(PI_SETTINGS_PATH, next);
  return readSettingsView();
}

export function listAuthStatus(): LlmAuthStatus[] {
  const auth = readAuthDoc();
  return Object.entries(auth).map(([providerId, value]) => ({
    providerId,
    type: asString(asRecord(value).type),
    authorized: true,
  }));
}

function redactMessage(message: string, key: string): string {
  return key ? message.replaceAll(key, API_KEY_SENTINEL) : message;
}

function resolveTestConfig(id: string): { baseUrl: string; api: LlmApiKind; key: string } {
  const provider = asRecord(readModelsDoc().providers[id]);
  if (Object.keys(provider).length === 0) throw new LlmConfigValidationError(`provider not found: ${id}`);
  const models = Array.isArray(provider.models) ? provider.models.map(asRecord) : [];
  const fallbackModel = models.find((model) => asString(model.baseUrl).trim() || isApiKind(model.api) || asString(model.apiKey).trim());

  const baseUrl = asString(provider.baseUrl).trim() || asString(fallbackModel?.baseUrl).trim();
  const api = isApiKind(provider.api) ? provider.api : isApiKind(fallbackModel?.api) ? fallbackModel.api : undefined;
  const key = asString(provider.apiKey).trim() || asString(fallbackModel?.apiKey).trim();
  if (!baseUrl) throw new LlmConfigValidationError("baseUrl required");
  if (!api) throw new LlmConfigValidationError("api required");
  if (!key) throw new LlmConfigValidationError("apiKey required");
  return { baseUrl, api, key };
}

export async function testProvider(id: string, timeout = 8000): Promise<LlmTestResult> {
  const started = performance.now();
  let key = "";
  try {
    const config = resolveTestConfig(id);
    key = config.key;
    if (config.api !== "openai-completions") throw new LlmConfigValidationError("unsupported api");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), clamp(timeout, 1000, 30_000));
    try {
      const url = new URL("models", config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.key}` },
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (response.ok) return { ok: true, status: response.status, latencyMs, message: "ok" };
      const body = await response.text().catch(() => "");
      const message = redactMessage(body || response.statusText || `HTTP ${response.status}`, config.key);
      return { ok: false, status: response.status, latencyMs, message };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs, message: redactMessage(message, key) };
  }
}
