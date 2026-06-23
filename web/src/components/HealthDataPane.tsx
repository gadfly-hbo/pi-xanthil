import { useEffect, useState } from "react";
import { dataApi } from "@/lib/api/data";
import { vizApi } from "@/lib/api/viz";
import { api } from "@/lib/api";
import type {
  BiAggregationDataset,
  ExtractionTool,
  SqlConnection,
  MonitorSourceRole,
  MonitorDatasetBinding,
  MonitorConfig,
  Ontology,
  MonitorMetricSystemDraft,
  MonitorMetricSystemEntry,
} from "@/types";

const ROLES: { value: MonitorSourceRole; label: string; color: string }[] = [
  { value: "goal", label: "运营目标", color: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700" },
  { value: "source", label: "经营数据", color: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700" },
  { value: "industry", label: "行业大盘", color: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700" },
  { value: "competitor", label: "竞品数据", color: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700" },
];

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function HealthDataPane({ workspaceId }: { workspaceId: string | null }) {
  const [datasets, setDatasets] = useState<BiAggregationDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 监测配置：pathId → role binding（含更新时间）
  const [bindings, setBindings] = useState<Map<string, MonitorDatasetBinding>>(new Map());
  const [configMeta, setConfigMeta] = useState<Pick<MonitorConfig, "ontologyId" | "metricSystemId" | "thresholds">>({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);

  // SQL/SQLite 导出
  const [sqlConns, setSqlConns] = useState<SqlConnection[]>([]);
  const [sqlConnId, setSqlConnId] = useState("");
  const [sqlText, setSqlText] = useState("SELECT * FROM ...");
  const [sqlExportPath, setSqlExportPath] = useState("");
  const [sqlBindRole, setSqlBindRole] = useState<MonitorSourceRole | "">("");
  const [sqlBusy, setSqlBusy] = useState(false);

  // 数据提取
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [toolId, setToolId] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [toolOutput, setToolOutput] = useState("");
  const [toolBindRole, setToolBindRole] = useState<MonitorSourceRole | "">("");
  const [toolBusy, setToolBusy] = useState(false);

  // 指标体系初始化（D-MONITOR3）
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [selectedOntologyId, setSelectedOntologyId] = useState("");
  const [systems, setSystems] = useState<MonitorMetricSystemEntry[]>([]);
  const [draft, setDraft] = useState<MonitorMetricSystemDraft | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [adoptBusy, setAdoptBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) {
      setDatasets([]);
      setBindings(new Map());
      setConfigMeta({});
      setConfigDirty(false);
      setOntologies([]);
      setSelectedOntologyId("");
      setSystems([]);
      setDraft(null);
      return;
    }
    setLoading(true);
    Promise.all([
      dataApi.getBiAggregations(workspaceId).then(setDatasets).catch((e) => setError(String(e))),
      (async () => {
        try {
          const config = await vizApi.getMonitorConfig(workspaceId);
          const map = new Map<string, MonitorDatasetBinding>();
          if (config) {
            for (const b of config.datasetBindings) map.set(b.datasetPathId, b);
            setConfigMeta({ ontologyId: config.ontologyId, metricSystemId: config.metricSystemId, thresholds: config.thresholds });
            if (config.ontologyId) setSelectedOntologyId(config.ontologyId);
          } else {
            setConfigMeta({});
          }
          setBindings(map);
          setConfigDirty(false);
        } catch (e) {
          setError(`加载监测配置失败: ${String(e)}`);
        }
      })(),
      vizApi.listOntologies(workspaceId).then(setOntologies).catch(() => {}),
      vizApi.listMonitorMetricSystems(workspaceId).then(setSystems).catch(() => {}),
    ]).finally(() => setLoading(false));
    api.listSqlConnections().then(setSqlConns).catch(() => {});
    dataApi.listExtractionTools().then(setTools).catch(() => {});
  }, [workspaceId]);

  const refresh = async (): Promise<BiAggregationDataset[] | undefined> => {
    if (!workspaceId) return;
    try {
      const list = await dataApi.getBiAggregations(workspaceId);
      setDatasets(list);
      return list;
    } catch (e) {
      setError(String(e));
      return undefined;
    }
  };

  const setRole = (pathId: string, role: MonitorSourceRole | null, label?: string) => {
    setBindings((prev) => {
      const next = new Map(prev);
      if (role === null) {
        next.delete(pathId);
      } else {
        next.set(pathId, { datasetPathId: pathId, role, label, updatedAt: Date.now() });
      }
      return next;
    });
    setConfigDirty(true);
  };

  const persistBindings = async (nextBindings: MonitorDatasetBinding[]) => {
    if (!workspaceId) return;
    const config = await vizApi.saveMonitorConfig(workspaceId, {
      suite: "monthly",
      datasetBindings: nextBindings,
      ...configMeta,
    });
    const map = new Map<string, MonitorDatasetBinding>();
    for (const b of config.datasetBindings) map.set(b.datasetPathId, b);
    setBindings(map);
    setConfigDirty(false);
  };

  const saveConfig = async () => {
    if (!workspaceId) return;
    setSavingConfig(true);
    try {
      await persistBindings(Array.from(bindings.values()));
      setError(null);
    } catch (e) {
      setError(`保存监测配置失败: ${String(e)}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const doSqlExport = async () => {
    if (!workspaceId || !sqlConnId || !sqlText || !sqlExportPath) return;
    setSqlBusy(true);
    try {
      const result = await api.exportSql(sqlConnId, sqlText, sqlExportPath, undefined, undefined, workspaceId);
      // 登记规范化路径（result.path）到 clean_data
      await api.addWorkspacePath(workspaceId, "clean_data", result.path, "file");
      const list = await refresh();
      // 如选了角色，自动绑定到新登记的 path
      if (sqlBindRole && list) {
        const fname = result.path.split("/").pop();
        const newDs = list.find((d) => d.name === fname);
        if (newDs) {
          const next = new Map(bindings);
          next.set(newDs.pathId, { datasetPathId: newDs.pathId, role: sqlBindRole, label: newDs.name, updatedAt: Date.now() });
          await persistBindings(Array.from(next.values()));
        } else {
          setError(`导出成功但未找到新登记数据集，无法自动绑定角色：${fname ?? result.path}`);
          return;
        }
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSqlBusy(false);
    }
  };

  const doToolRun = async () => {
    if (!workspaceId || !toolId || !toolInput || !toolOutput) return;
    setToolBusy(true);
    try {
      const run = await dataApi.runExtractionTool(toolId, toolInput, toolOutput, undefined, workspaceId);
      // 读 results[].outputs，过滤表格文件逐个登记到 clean_data
      const TABULAR = new Set([".csv", ".tsv", ".xlsx", ".xls"]);
      const outputs = new Set<string>();
      for (const r of run.results ?? []) {
        for (const out of r.outputs ?? []) {
          const lower = out.toLowerCase();
          if (TABULAR.has(lower.slice(lower.lastIndexOf(".")))) {
            outputs.add(out);
          }
        }
      }
      const regErrors: string[] = [];
      for (const p of outputs) {
        try {
          await api.addWorkspacePath(workspaceId, "clean_data", p, "file");
        } catch (e) {
          regErrors.push(`${p}: ${String(e)}`);
        }
      }
      const list = await refresh();
      if (toolBindRole && list && outputs.size > 0) {
        const next = new Map(bindings);
        for (const p of outputs) {
          const fname = p.split("/").pop();
          const newDs = list.find((d) => d.name === fname);
          if (newDs) next.set(newDs.pathId, { datasetPathId: newDs.pathId, role: toolBindRole, label: newDs.name, updatedAt: Date.now() });
        }
        await persistBindings(Array.from(next.values()));
      }
      if (regErrors.length > 0) {
        setError(`部分产物登记失败: ${regErrors.join("; ")}`);
      } else {
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setToolBusy(false);
    }
  };
  // 生成指标体系草案
  const generateDraft = async () => {
    if (!workspaceId) return;
    setDraftBusy(true);
    setError(null);
    try {
      const r = await vizApi.draftMonitorMetricSystem(workspaceId, {
        ontologyId: selectedOntologyId || undefined,
      });
      setDraft(r.draft);
    } catch (e) {
      setError(`生成指标体系草案失败（可能 E-MONITOR2 后端未实装）: ${String(e)}`);
    } finally {
      setDraftBusy(false);
    }
  };

  // 采纳指标体系草案：落库 + 回写 monitor config
  const adoptDraft = async () => {
    if (!workspaceId || !draft) return;
    setAdoptBusy(true);
    setError(null);
    try {
      const r = await vizApi.adoptMonitorMetricSystem(workspaceId, { draft });
      // 把 metricSystemId 回写到 monitor config
      const saved = await vizApi.saveMonitorConfig(workspaceId, {
        suite: "monthly",
        datasetBindings: Array.from(bindings.values()),
        ontologyId: selectedOntologyId || undefined,
        metricSystemId: r.metricSystemId,
        thresholds: configMeta.thresholds,
      });
      setConfigMeta({ ontologyId: saved.ontologyId, metricSystemId: saved.metricSystemId, thresholds: saved.thresholds });
      setDraft(null);
      vizApi.listMonitorMetricSystems(workspaceId).then(setSystems).catch(() => {});
    } catch (e) {
      setError(`采纳指标体系失败: ${String(e)}`);
    } finally {
      setAdoptBusy(false);
    }
  };

  const roleStats = ROLES.map((r) => ({
    ...r,
    count: Array.from(bindings.values()).filter((b) => b.role === r.value).length,
  }));

  const inputCls = "h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950";
  const btnCls = "h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900";

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-neutral-50/40 text-[12.5px] dark:bg-neutral-950/40">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">监测初始化 · 数据角色</h2>
          <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
            为已登记的 clean_data 聚合集打角色标签（运营目标 / 经营数据 / 行业大盘 / 竞品数据），保存后供观星台读取。下方可接入更多数据源（SQL/SQLite 导出、数据提取）。
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 角色统计 + 保存按钮 */}
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {roleStats.map((r) => (
              <span key={r.value} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${r.color}`}>
                <span className="font-medium">{r.label}</span>
                <span className="rounded bg-white/70 px-1 text-[10px] tabular-nums dark:bg-black/30">{r.count}</span>
              </span>
            ))}
            {configDirty && <span className="text-[11px] text-amber-600 dark:text-amber-400">未保存改动</span>}
          </div>
          <button
            onClick={saveConfig}
            disabled={savingConfig || !configDirty || !workspaceId}
            className={btnCls}
          >
            {savingConfig ? "保存中…" : "保存监测配置"}
          </button>
        </div>

        {/* 已登记聚合数据列表（带角色绑定） */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">已登记聚合数据（{datasets.length}）</label>
            <button onClick={() => void refresh()} className="text-xs text-blue-500 hover:underline">刷新</button>
          </div>
          {loading && <p className="text-[12px] text-neutral-400">加载中…</p>}
          {datasets.map((ds) => {
            const b = bindings.get(ds.pathId);
            return (
              <div key={ds.pathId} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">{ds.name}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {ds.rowCount} 行 · {ds.columns.length} 列 · pathId={ds.pathId}
                      {b?.updatedAt && <span className="ml-2">绑定于 {fmtTime(b.updatedAt)}</span>}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {ROLES.map((r) => {
                    const active = b?.role === r.value;
                    return (
                      <button
                        key={r.value}
                        onClick={() => setRole(ds.pathId, active ? null : r.value, ds.name)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] transition ${active ? r.color : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"}`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                  {b && (
                    <button
                      onClick={() => setRole(ds.pathId, null)}
                      className="text-[11px] text-neutral-400 hover:text-red-500"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {datasets.length === 0 && !loading && (
            <p className="text-sm text-neutral-400">暂无聚合数据。使用下方入口接入。</p>
          )}
        </div>

        {/* SQL/SQLite 导出 → clean_data */}
        <details className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="cursor-pointer text-sm font-medium">SQL / SQLite 导出 → 聚合数据</summary>
          <div className="mt-2 space-y-2">
            <select value={sqlConnId} onChange={(e) => setSqlConnId(e.target.value)} className={inputCls}>
              <option value="">选择数据库连接…（支持 SQLite / PostgreSQL / MySQL）</option>
              {sqlConns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
            </select>
            {sqlConns.length === 0 && (
              <p className="text-[11px] text-neutral-400">
                暂无数据库连接。请到「计算工具 · SQL 连接」新建连接（SQLite 仅需文件路径）。
              </p>
            )}
            <textarea
              value={sqlText}
              onChange={(e) => setSqlText(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="SELECT ..."
            />
            <input
              value={sqlExportPath}
              onChange={(e) => setSqlExportPath(e.target.value)}
              className={inputCls}
              placeholder="输出路径（如 /Users/.../clean_data/export.csv）"
            />
            <div className="flex items-center gap-2">
              <select
                value={sqlBindRole}
                onChange={(e) => setSqlBindRole(e.target.value as MonitorSourceRole | "")}
                className={`${inputCls} flex-1`}
              >
                <option value="">导出后不自动绑定角色</option>
                {ROLES.map((r) => <option key={r.value} value={r.value}>导出后绑定为：{r.label}</option>)}
              </select>
              <button
                onClick={doSqlExport}
                disabled={sqlBusy || !sqlConnId || !sqlText || !sqlExportPath}
                className={btnCls}
              >
                {sqlBusy ? "导出中…" : "导出并登记"}
              </button>
            </div>
          </div>
        </details>

        {/* 数据提取 → clean_data */}
        <details className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <summary className="cursor-pointer text-sm font-medium">数据提取 → 聚合数据</summary>
          <div className="mt-2 space-y-2">
            <select value={toolId} onChange={(e) => setToolId(e.target.value)} className={inputCls}>
              <option value="">选择提取工具…</option>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input value={toolInput} onChange={(e) => setToolInput(e.target.value)} className={inputCls} placeholder="输入路径" />
            <input value={toolOutput} onChange={(e) => setToolOutput(e.target.value)} className={inputCls} placeholder="输出目录" />
            <div className="flex items-center gap-2">
              <select
                value={toolBindRole}
                onChange={(e) => setToolBindRole(e.target.value as MonitorSourceRole | "")}
                className={`${inputCls} flex-1`}
              >
                <option value="">运行后不自动绑定角色</option>
                {ROLES.map((r) => <option key={r.value} value={r.value}>运行后绑定为：{r.label}</option>)}
              </select>
              <button
                onClick={doToolRun}
                disabled={toolBusy || !toolId || !toolInput || !toolOutput}
                className={btnCls}
              >
                {toolBusy ? "运行中…" : "运行并登记"}
              </button>
            </div>
          </div>
        </details>

        {/* 指标体系初始化（D-MONITOR3） */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">指标体系初始化</label>
              <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                基于已启用 ontology + clean_data 元数据生成监测指标体系（指标 / 依赖 / 监测规则）。LLM 仅读结构与摘要，不读原始行。
              </p>
            </div>
            {configMeta.metricSystemId && (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                已采纳: {configMeta.metricSystemId.slice(0, 8)}…
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={selectedOntologyId}
              onChange={(e) => {
                setSelectedOntologyId(e.target.value);
                setConfigMeta((prev) => ({ ...prev, ontologyId: e.target.value || undefined }));
                setConfigDirty(true);
              }}
              className={`${inputCls} flex-1`}
            >
              <option value="">选择 ontology（可选，留空让引擎自选）</option>
              {ontologies.map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.version})</option>
              ))}
            </select>
            <button
              onClick={generateDraft}
              disabled={draftBusy || !workspaceId}
              className={btnCls}
            >
              {draftBusy ? "生成中…" : "生成指标体系草案"}
            </button>
          </div>

          {draft && (
            <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-amber-900 dark:text-amber-100">草案预览</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDraft(null)}
                    className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[11px] hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    丢弃
                  </button>
                  <button
                    onClick={adoptDraft}
                    disabled={adoptBusy}
                    className="rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {adoptBusy ? "采纳中…" : "采纳"}
                  </button>
                </div>
              </div>
              <div className="space-y-1 text-[11px]">
                <div>
                  <span className="font-semibold text-amber-900 dark:text-amber-100">指标 ({draft.metrics.length})</span>
                  <ul className="mt-0.5 list-disc pl-4 text-amber-900/80 dark:text-amber-200/80">
                    {draft.metrics.slice(0, 8).map((m, i) => (
                      <li key={i}>
                        <span className="font-medium">{m.name}</span>
                        {m.unit && <span className="ml-1 text-neutral-500">({m.unit})</span>}
                        {m.formula && <span className="ml-1 font-mono text-neutral-500">= {m.formula}</span>}
                        <span className="ml-1 text-neutral-500">· 置信 {(m.confidence * 100).toFixed(0)}%</span>
                      </li>
                    ))}
                    {draft.metrics.length > 8 && <li className="text-neutral-500">…还有 {draft.metrics.length - 8} 条</li>}
                  </ul>
                </div>
                {draft.monitorRules.length > 0 && (
                  <div>
                    <span className="font-semibold text-amber-900 dark:text-amber-100">监测规则 ({draft.monitorRules.length})</span>
                    <ul className="mt-0.5 list-disc pl-4 text-amber-900/80 dark:text-amber-200/80">
                      {draft.monitorRules.slice(0, 5).map((r, i) => (
                        <li key={i}>
                          <span className="font-medium">{r.title}</span>
                          <span className="ml-1 text-neutral-500">[{r.comparisonKinds.join(",")}]</span>
                        </li>
                      ))}
                      {draft.monitorRules.length > 5 && <li className="text-neutral-500">…还有 {draft.monitorRules.length - 5} 条</li>}
                    </ul>
                  </div>
                )}
                {draft.dependencies.length > 0 && (
                  <div>
                    <span className="font-semibold text-amber-900 dark:text-amber-100">依赖 ({draft.dependencies.length})</span>
                    <ul className="mt-0.5 list-disc pl-4 text-amber-900/80 dark:text-amber-200/80">
                      {draft.dependencies.slice(0, 5).map((d, i) => (
                        <li key={i}>
                          <span className="font-mono text-[10px]">{d.metricId} → {d.relatedMetricId}</span>
                          <span className="ml-1 text-neutral-500">[{d.relation}]</span> {d.rationale}
                        </li>
                      ))}
                      {draft.dependencies.length > 5 && <li className="text-neutral-500">…还有 {draft.dependencies.length - 5} 条</li>}
                    </ul>
                  </div>
                )}
                {draft.assumptions.length > 0 && (
                  <div>
                    <span className="font-semibold text-amber-900 dark:text-amber-100">假设</span>
                    <ul className="mt-0.5 list-disc pl-4 text-amber-900/80 dark:text-amber-200/80">
                      {draft.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {draft.missingData.length > 0 && (
                  <div>
                    <span className="font-semibold text-rose-700 dark:text-rose-300">缺失数据</span>
                    <ul className="mt-0.5 list-disc pl-4 text-rose-700/80 dark:text-rose-300/80">
                      {draft.missingData.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {systems.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
                历史指标体系（{systems.length}）
              </summary>
              <div className="mt-1 space-y-1">
                {systems.map((sys) => (
                  <div key={sys.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-2 py-1 text-[11px] dark:border-neutral-800">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{sys.name}</span>
                      <span className="ml-2 text-neutral-500">{sys.status}</span>
                      <span className="ml-2 text-neutral-400">{fmtTime(sys.updatedAt)}</span>
                    </div>
                    <span className="text-neutral-400">{sys.draft.metrics.length} 指标</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
