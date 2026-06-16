import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  RefreshCw,
  Plus,
  Save,
  Trash2,
  Star,
  StarOff,
  KeyRound,
  Loader2,
  CircleAlert,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  LlmApiKind,
  LlmModelEntry,
  LlmProviderInput,
  LlmProviderView,
  LlmSettingsView,
  LlmTestResult,
} from "@/types";

/**
 * 计算工具 · LLM 接入管理（直写 ~/.pi/agent 真源）。
 *
 * 数据流：
 *   - GET /api/llm/providers → providers 草稿（apiKey 全程不回显，仅 hasApiKey）。
 *   - GET /api/llm/settings  → 启用模型 + 默认模型 草稿。
 *   - PUT /api/llm/providers ⇢ 整表覆盖（写 models.json）。
 *   - PUT /api/llm/settings  ⇢ 仅写三键（enabledModels/defaultProvider/defaultModel）。
 *   - 任一保存成功后调 refreshModels() 让 ChatPane/CreationPane 的 ModelSelect 即时反映。
 *
 * apiKey 哨兵语义（与 server llm-config.coerceProviderInput 对齐）：
 *   - 输入框 value 恒空、占位「已配置(****)」；
 *   - 用户键入非空 → 后端覆盖；留空 / "****" → 保留旧值；
 *   - OAuth provider 灰掉提示「凭证由 pi auth 管理」。
 */

const API_OPTIONS: { value: LlmApiKind; label: string }[] = [
  { value: "openai-completions", label: "openai-completions" },
];

function blankModel(): LlmModelEntry {
  return { id: "", name: "", input: ["text"] };
}

function blankProvider(id: string): LlmProviderView {
  return { id, hasApiKey: false, models: [blankModel()] };
}

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

interface DraftFlags {
  newProviderIds: Set<string>;
  apiKeyDrafts: Record<string, string>;
}

export function LlmManagementPane({ refreshModels }: { refreshModels?: () => void }) {
  const [providers, setProviders] = useState<LlmProviderView[]>([]);
  const [settings, setSettings] = useState<LlmSettingsView>({ enabledModels: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flags, setFlags] = useState<DraftFlags>({ newProviderIds: new Set(), apiKeyDrafts: {} });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [providersDirty, setProvidersDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingProviders, setSavingProviders] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, st] = await Promise.all([api.listLlmProviders(), api.getLlmSettings()]);
      setProviders(list);
      setSettings(st);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      setFlags({ newProviderIds: new Set(), apiKeyDrafts: {} });
      setProvidersDirty(false);
      setSettingsDirty(false);
      setTestResult(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? null,
    [providers, selectedId],
  );
  const isNewProvider = selected ? flags.newProviderIds.has(selected.id) : false;

  // ---- providers 编辑 ----

  const updateProvider = (id: string, patch: Partial<LlmProviderView>) => {
    setProviders((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setProvidersDirty(true);
  };

  const renameProviderId = (oldId: string, nextId: string) => {
    const trimmed = nextId.trim();
    if (!trimmed) return;
    if (trimmed !== oldId && providers.some((p) => p.id.trim() === trimmed)) {
      setError(`provider id 已存在：${trimmed}`);
      return;
    }
    setProviders((list) => list.map((p) => (p.id === oldId ? { ...p, id: trimmed } : p)));
    setFlags((f) => {
      const newSet = new Set(f.newProviderIds);
      if (newSet.has(oldId)) {
        newSet.delete(oldId);
        newSet.add(trimmed);
      }
      const drafts = { ...f.apiKeyDrafts };
      if (oldId in drafts) {
        drafts[trimmed] = drafts[oldId] ?? "";
        delete drafts[oldId];
      }
      return { newProviderIds: newSet, apiKeyDrafts: drafts };
    });
    if (selectedId === oldId) setSelectedId(trimmed);
    setProvidersDirty(true);
    setError("");
  };

  const addProvider = () => {
    const base = "new-provider";
    let id = base;
    let i = 1;
    while (providers.some((p) => p.id.trim() === id)) {
      i += 1;
      id = `${base}-${i}`;
    }
    setProviders((list) => [...list, blankProvider(id)]);
    setFlags((f) => ({ ...f, newProviderIds: new Set([...f.newProviderIds, id]) }));
    setSelectedId(id);
    setProvidersDirty(true);
    setTestResult(null);
  };

  const removeSelectedProvider = () => {
    if (!selected) return;
    const id = selected.id;
    setProviders((list) => list.filter((p) => p.id !== id));
    setFlags((f) => {
      const newSet = new Set(f.newProviderIds);
      newSet.delete(id);
      const drafts = { ...f.apiKeyDrafts };
      delete drafts[id];
      return { newProviderIds: newSet, apiKeyDrafts: drafts };
    });
    setSettings((s) => {
      const enabled = s.enabledModels.filter((mid) => !mid.startsWith(`${id}/`));
      const next: LlmSettingsView = { ...s, enabledModels: enabled };
      if (s.defaultProvider === id) {
        delete next.defaultProvider;
        delete next.defaultModel;
      }
      return next;
    });
    setSelectedId(null);
    setProvidersDirty(true);
    setSettingsDirty(true);
    setTestResult(null);
  };

  const setApiKeyDraft = (providerId: string, value: string) => {
    setFlags((f) => ({ ...f, apiKeyDrafts: { ...f.apiKeyDrafts, [providerId]: value } }));
    setProvidersDirty(true);
  };

  // ---- models 子表 ----

  const updateModel = (providerId: string, idx: number, patch: Partial<LlmModelEntry>) => {
    setProviders((list) =>
      list.map((p) =>
        p.id === providerId
          ? { ...p, models: p.models.map((m, i) => (i === idx ? { ...m, ...patch } : m)) }
          : p,
      ),
    );
    setProvidersDirty(true);
  };

  const renameModelId = (providerId: string, idx: number, nextModelId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    const oldModelId = provider.models[idx]?.id ?? "";
    updateModel(providerId, idx, { id: nextModelId });
    if (oldModelId && oldModelId !== nextModelId) {
      const oldKey = modelKey(providerId, oldModelId);
      const newKey = modelKey(providerId, nextModelId);
      setSettings((s) => {
        const enabled = s.enabledModels.map((k) => (k === oldKey ? newKey : k));
        const next: LlmSettingsView = { ...s, enabledModels: enabled };
        if (s.defaultProvider === providerId && s.defaultModel === oldModelId) {
          next.defaultModel = nextModelId;
        }
        return next;
      });
      setSettingsDirty(true);
    }
  };

  const addModel = (providerId: string) => {
    setProviders((list) =>
      list.map((p) => (p.id === providerId ? { ...p, models: [...p.models, blankModel()] } : p)),
    );
    setProvidersDirty(true);
  };

  const removeModel = (providerId: string, idx: number) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    const removedId = provider.models[idx]?.id ?? "";
    setProviders((list) =>
      list.map((p) =>
        p.id === providerId ? { ...p, models: p.models.filter((_, i) => i !== idx) } : p,
      ),
    );
    if (removedId) {
      const k = modelKey(providerId, removedId);
      setSettings((s) => {
        const enabled = s.enabledModels.filter((x) => x !== k);
        const next: LlmSettingsView = { ...s, enabledModels: enabled };
        if (s.defaultProvider === providerId && s.defaultModel === removedId) {
          delete next.defaultProvider;
          delete next.defaultModel;
        }
        return next;
      });
      setSettingsDirty(true);
    }
    setProvidersDirty(true);
  };

  // ---- settings (启用 / 默认) ----

  const toggleEnabled = (providerId: string, modelId: string, on: boolean) => {
    if (!modelId) return;
    const k = modelKey(providerId, modelId);
    setSettings((s) => {
      const set = new Set(s.enabledModels);
      if (on) set.add(k);
      else set.delete(k);
      return { ...s, enabledModels: [...set] };
    });
    setSettingsDirty(true);
  };

  const setDefault = (providerId: string, modelId: string) => {
    if (!modelId) return;
    setSettings((s) => ({ ...s, defaultProvider: providerId, defaultModel: modelId }));
    setSettingsDirty(true);
  };

  const clearDefault = () => {
    setSettings((s) => {
      const next = { ...s };
      delete next.defaultProvider;
      delete next.defaultModel;
      return next;
    });
    setSettingsDirty(true);
  };

  // ---- save / test ----

  /** 把 provider view + apiKey draft 转成 server input：apiKey 留空哨兵。 */
  const buildProvidersInput = (): LlmProviderInput[] =>
    providers.map((p) => {
      const draft = flags.apiKeyDrafts[p.id];
      const input: LlmProviderInput = {
        id: p.id.trim(),
        baseUrl: p.baseUrl,
        api: p.api,
        models: p.models.map((m) => ({ ...m })),
      };
      // 哨兵：留空 / 未键入 → 不发 apiKey；server 保留旧值（OAuth provider 同样不发）。
      if (!p.oauth && typeof draft === "string" && draft !== "") input.apiKey = draft;
      return input;
    });

  const validateBeforeSaveProviders = (): string | null => {
    for (const p of providers) {
      if (!p.id.trim()) return "存在 provider id 为空";
      const isNew = flags.newProviderIds.has(p.id);
      if (isNew && !p.oauth) {
        const draft = flags.apiKeyDrafts[p.id] ?? "";
        if (!draft.trim()) return `新 provider「${p.id}」必须填写 apiKey`;
      }
      if (p.models.length === 0) return `provider「${p.id}」至少需要一个 model`;
      const seen = new Set<string>();
      for (const m of p.models) {
        if (!m.id.trim()) return `provider「${p.id}」存在 model id 为空`;
        if (seen.has(m.id)) return `provider「${p.id}」model id 重复：${m.id}`;
        seen.add(m.id);
      }
      const hasProviderBaseUrl = (p.baseUrl ?? "").trim() !== "";
      const allModelsHaveBaseUrl = p.models.every((m) => (m.baseUrl ?? "").trim() !== "");
      if (!hasProviderBaseUrl && !allModelsHaveBaseUrl) {
        return `provider「${p.id}」需在 provider 级或每个 model 都填 baseUrl`;
      }
    }
    return null;
  };

  const saveProviders = async () => {
    const err = validateBeforeSaveProviders();
    if (err) {
      setError(err);
      return;
    }
    setSavingProviders(true);
    setError("");
    try {
      const next = await api.saveLlmProviders(buildProvidersInput());
      setProviders(next);
      setFlags({ newProviderIds: new Set(), apiKeyDrafts: {} });
      setProvidersDirty(false);
      if (settingsDirty) {
        try {
          const nextSettings = await api.saveLlmSettings(settings);
          setSettings(nextSettings);
          setSettingsDirty(false);
        } catch (e) {
          setError(`providers 已保存，但 settings 保存失败：${String(e)}`);
        }
      }
      refreshModels?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingProviders(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setError("");
    try {
      const next = await api.saveLlmSettings(settings);
      setSettings(next);
      setSettingsDirty(false);
      refreshModels?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingSettings(false);
    }
  };

  const runTest = async () => {
    if (!selected) return;
    if (isNewProvider || providersDirty) {
      setError("先保存 provider 后再测试连通");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testLlmProvider(selected.id);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <BrainCircuit className="h-4 w-4 text-neutral-500" />
        <h2 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">计算工具 · LLM 接入管理</h2>
        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          直写 ~/.pi/agent
        </span>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="ml-auto rounded border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          title="刷新"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-900">
        <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] gap-3 p-4">
          {/* 左列：providers */}
          <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">Providers</h3>
              <span className="text-[11px] text-neutral-400">{providers.length} 个</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={addProvider}
                  className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {providers.length === 0 && (
                <div className="px-3 py-8 text-center text-[12px] text-neutral-400">尚无 provider，点「新建」开始</div>
              )}
              {providers.map((p) => {
                const active = p.id === selectedId;
                const enabledCount = settings.enabledModels.filter((k) => k.startsWith(`${p.id}/`)).length;
                const isDefault = settings.defaultProvider === p.id;
                let dot = "bg-neutral-300 dark:bg-neutral-600";
                let dotTitle = "未配置 apiKey";
                if (p.oauth) {
                  dot = "bg-sky-500";
                  dotTitle = "已通过 pi auth 授权 (OAuth)";
                } else if (p.hasApiKey) {
                  dot = "bg-emerald-500";
                  dotTitle = "已配置 apiKey";
                }
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedId(p.id);
                      setTestResult(null);
                    }}
                    className={`flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-[12px] transition dark:border-neutral-800 ${
                      active ? "bg-neutral-50 dark:bg-neutral-900" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} title={dotTitle} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-neutral-700 dark:text-neutral-200">
                        {p.id}
                        {flags.newProviderIds.has(p.id) && (
                          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9.5px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            新
                          </span>
                        )}
                        {isDefault && <Star className="ml-1 inline h-3 w-3 text-amber-500" />}
                      </div>
                      <div className="truncate text-[11px] text-neutral-400">
                        {p.models.length} 模型 · 启用 {enabledCount}
                        {p.oauth ? " · OAuth" : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-1 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <button
                onClick={() => void saveProviders()}
                disabled={!providersDirty || savingProviders}
                className="flex items-center justify-center gap-1 rounded bg-neutral-900 px-3 py-1 text-[11.5px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {savingProviders ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {savingProviders ? "保存中…" : providersDirty ? "保存到 models.json" : "Providers 已保存"}
              </button>
              <button
                onClick={() => void saveSettings()}
                disabled={!settingsDirty || savingSettings}
                className="flex items-center justify-center gap-1 rounded border border-neutral-300 bg-white px-3 py-1 text-[11.5px] text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {savingSettings ? "保存中…" : settingsDirty ? "保存启用/默认 → settings.json" : "Settings 已保存"}
              </button>
            </div>
          </div>

          {/* 右列：provider 表单 + models 子表 */}
          <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            {error && (
              <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{error}</span>
              </div>
            )}
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
                选择左侧 provider，或点「新建」
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-auto p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">编辑 provider</h3>
                  {selected.oauth && (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10.5px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                      OAuth · 已授权
                    </span>
                  )}
                  <button
                    onClick={removeSelectedProvider}
                    className="ml-auto flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11.5px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="id（新建可改 / 已存只读）">
                    <input
                      value={selected.id}
                      readOnly={!isNewProvider}
                      onChange={(e) => renameProviderId(selected.id, e.target.value)}
                      className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] read-only:bg-neutral-50 read-only:text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:read-only:bg-neutral-900/60"
                    />
                  </Field>
                  <Field label="api">
                    <select
                      value={selected.api ?? ""}
                      onChange={(e) =>
                        updateProvider(selected.id, {
                          api: (e.target.value || undefined) as LlmApiKind | undefined,
                        })
                      }
                      className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                    >
                      <option value="">（不指定，下放 model 级）</option>
                      {API_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="baseUrl（provider 级，留空则要求每个 model 都填）" className="col-span-2">
                    <input
                      value={selected.baseUrl ?? ""}
                      onChange={(e) =>
                        updateProvider(selected.id, { baseUrl: e.target.value })
                      }
                      placeholder="如 https://ark.cn-beijing.volces.com/api/v3"
                      className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                    />
                  </Field>
                  <Field label="apiKey" className="col-span-2">
                    {selected.oauth ? (
                      <div className="flex items-center gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11.5px] text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
                        <KeyRound className="h-3.5 w-3.5" />
                        OAuth 凭证由 <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono dark:bg-neutral-900">pi auth</code> 管理，本面板不可改
                      </div>
                    ) : (
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={flags.apiKeyDrafts[selected.id] ?? ""}
                        onChange={(e) => setApiKeyDraft(selected.id, e.target.value)}
                        placeholder={
                          selected.hasApiKey
                            ? "已配置(****) — 留空保存=保留旧值；键入新值=覆盖"
                            : isNewProvider
                              ? "必填"
                              : "未配置 apiKey — 键入并保存以写入"
                        }
                        className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                      />
                    )}
                  </Field>
                </div>

                {/* models 子表 */}
                <div className="mt-4 rounded border border-neutral-200 dark:border-neutral-800">
                  <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
                    <h4 className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">Models</h4>
                    <span className="text-[11px] text-neutral-400">{selected.models.length} 项</span>
                    <button
                      onClick={() => addModel(selected.id)}
                      className="ml-auto flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      增 model
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11.5px]">
                      <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                        <tr>
                          <th className="px-2 py-1.5 font-normal">启用</th>
                          <th className="px-2 py-1.5 font-normal">默认</th>
                          <th className="px-2 py-1.5 font-normal">id</th>
                          <th className="px-2 py-1.5 font-normal">name</th>
                          <th className="px-2 py-1.5 font-normal">contextWindow</th>
                          <th className="px-2 py-1.5 font-normal">reasoning</th>
                          <th className="px-2 py-1.5 font-normal">baseUrl(可选)</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.models.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-2 py-6 text-center text-neutral-400">
                              至少需要 1 个 model，点「增 model」
                            </td>
                          </tr>
                        )}
                        {selected.models.map((m, idx) => {
                          const k = modelKey(selected.id, m.id);
                          const enabled = m.id ? settings.enabledModels.includes(k) : false;
                          const isDefault =
                            !!m.id && settings.defaultProvider === selected.id && settings.defaultModel === m.id;
                          return (
                            <tr key={idx} className="border-t border-neutral-100 dark:border-neutral-800">
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  disabled={!m.id}
                                  onChange={(e) => toggleEnabled(selected.id, m.id, e.target.checked)}
                                  title={m.id ? "改 settings.enabledModels" : "先填 model id"}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <button
                                  onClick={() =>
                                    isDefault ? clearDefault() : setDefault(selected.id, m.id)
                                  }
                                  disabled={!m.id}
                                  className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                                  title={isDefault ? "取消默认" : "设为默认"}
                                >
                                  {isDefault ? (
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                                  ) : (
                                    <StarOff className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  value={m.id}
                                  onChange={(e) => renameModelId(selected.id, idx, e.target.value)}
                                  className="w-32 rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  value={m.name}
                                  onChange={(e) => updateModel(selected.id, idx, { name: e.target.value })}
                                  className="w-40 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  value={m.contextWindow ?? ""}
                                  onChange={(e) =>
                                    updateModel(selected.id, idx, {
                                      contextWindow: e.target.value ? Number(e.target.value) : undefined,
                                    })
                                  }
                                  className="w-24 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-right font-mono text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={!!m.reasoning}
                                  onChange={(e) => updateModel(selected.id, idx, { reasoning: e.target.checked })}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  value={m.baseUrl ?? ""}
                                  onChange={(e) => updateModel(selected.id, idx, { baseUrl: e.target.value })}
                                  placeholder="provider 级有 baseUrl 时可留空"
                                  className="w-56 rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <button
                                  onClick={() => removeModel(selected.id, idx)}
                                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800"
                                  title="删除 model"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 测试连通 + 状态 */}
                <div className="mt-3 flex items-start gap-2 rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                  <button
                    onClick={() => void runTest()}
                    disabled={testing || isNewProvider || providersDirty}
                    className="flex items-center gap-1 rounded border border-neutral-300 bg-white px-3 py-1 text-[11.5px] text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                    title={
                      isNewProvider || providersDirty
                        ? "先保存 provider 后再测试"
                        : "请求 baseUrl 探活，apiKey 不出网回显"
                    }
                  >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    测试连通
                  </button>
                  {testResult && (
                    <div
                      className={`flex-1 rounded px-2 py-1 text-[11.5px] ${
                        testResult.ok
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                      }`}
                    >
                      {testResult.ok ? "ok" : "fail"}
                      {typeof testResult.status === "number" ? ` · status=${testResult.status}` : ""}
                      {typeof testResult.latencyMs === "number" ? ` · ${testResult.latencyMs}ms` : ""}
                      {testResult.message ? (
                        <span className="ml-1 font-mono text-[11px] opacity-80">{testResult.message}</span>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <CircleAlert className="mr-1 inline h-3.5 w-3.5" />
                  apiKey 写入 ~/.pi/agent/models.json（pi 全局真源），本面板永不回显已存值；OAuth provider 凭证由 pi auth 管理。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11.5px] text-neutral-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
