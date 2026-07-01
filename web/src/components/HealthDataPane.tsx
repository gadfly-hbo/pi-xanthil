import { useEffect, useMemo, useState } from "react";
import { dataApi } from "@/lib/api/data";
import { vizApi, type MonitorWatchlist } from "@/lib/api/viz";
import { api } from "@/lib/api";
import { getHealthSelectedWatchlistId, setHealthSelectedWatchlistId } from "@/lib/health-ui-state";
import { MonitorWatchlistSelector } from "@/components/monitor/MonitorWatchlistSelector";
import type {
  BiAggregationDataset,
  SqlConnection,
  SchemaTable,
  MonitorSourceRole,
  MonitorDatasetBinding,
  MonitorConfig,
  Ontology,
  MonitorMetricSystemDraft,
  MonitorMetricSystemEntry,
} from "@/types";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";
import readmeContent from "@/docs/health-data-readme.md?raw";

// D-MONITOR7（X-MONITOR5 口径）：监测初始化页只保留「数据库连接导入」单入口，
// 只展示 clean_data/monitor/ 下的「监测聚合数据」，不暴露工作区其他 clean_data。
// 配套后端：dataApi.importMonitorSql / dataApi.listMonitorImports（D-MONITOR6）。

const ROLES: { value: MonitorSourceRole; label: string; color: string }[] = [
  { value: "goal", label: "运营目标", color: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700" },
  { value: "source", label: "经营数据", color: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700" },
  { value: "industry", label: "行业大盘", color: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700" },
  { value: "competitor", label: "竞品数据", color: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700" },
];

const ROLE_ORDER: Array<MonitorSourceRole | "unbound"> = ["source", "goal", "industry", "competitor", "unbound"];

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const INPUT_CLS = "h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[12px] dark:border-neutral-700 dark:bg-neutral-950";
const BTN_PRIMARY = "h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900";
const BTN_GHOST = "h-8 rounded-md border border-neutral-300 bg-white px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300";

export function HealthDataPane({ workspaceId }: { workspaceId: string | null }) {
  const [view, setView] = useState<"main" | "readme">("main");
  const [watchlistId, setWatchlistId] = useState(getHealthSelectedWatchlistId());
  const [watchlists, setWatchlists] = useState<MonitorWatchlist[]>([]);
  // 监测专用导入数据 + 角色绑定
  const [datasets, setDatasets] = useState<BiAggregationDataset[]>([]);
  const [bindings, setBindings] = useState<Map<string, MonitorDatasetBinding>>(new Map());
  const [configMeta, setConfigMeta] = useState<Pick<MonitorConfig, "ontologyId" | "metricSystemId" | "thresholds">>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 数据库连接导入工作流
  const [sqlConns, setSqlConns] = useState<SqlConnection[]>([]);
  const [connId, setConnId] = useState("");
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaTables, setSchemaTables] = useState<SchemaTable[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [sqlText, setSqlText] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [importRole, setImportRole] = useState<MonitorSourceRole | "">("");
  const [importBusy, setImportBusy] = useState(false);
  const [lastImport, setLastImport] = useState<{ columns: string[]; rowCount: number; name: string; pathId: string } | null>(null);

  // 指标体系初始化（保留 D-MONITOR3 既有行为）
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
      setOntologies([]);
      setSelectedOntologyId("");
      setSystems([]);
      setDraft(null);
      setWatchlists([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      dataApi.listMonitorImports(workspaceId)
        .then((list) => { if (!cancelled) setDatasets(list); })
        .catch((e) => { if (!cancelled) setError(`加载监测聚合数据失败: ${String(e)}`); }),
      (async () => {
        try {
          const config = await vizApi.getMonitorConfig(workspaceId);
          if (cancelled) return;
          const map = new Map<string, MonitorDatasetBinding>();
          if (config) {
            for (const b of config.datasetBindings) map.set(b.datasetPathId, b);
            setConfigMeta({ ontologyId: config.ontologyId, metricSystemId: config.metricSystemId, thresholds: config.thresholds });
            if (config.ontologyId) setSelectedOntologyId(config.ontologyId);
          } else {
            setConfigMeta({});
          }
          setBindings(map);
        } catch (e) {
          if (!cancelled) setError(`加载监测配置失败: ${String(e)}`);
        }
      })(),
      vizApi.listOntologies(workspaceId)
        .then((list) => { if (!cancelled) setOntologies(list); })
        .catch(() => {}),
      vizApi.listMonitorMetricSystems(workspaceId)
        .then((list) => { if (!cancelled) setSystems(list); })
        .catch(() => {}),
    ]).finally(() => { if (!cancelled) setLoading(false); });
    api.listSqlConnections()
      .then((list) => { if (!cancelled) setSqlConns(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    if (watchlistId === "default") {
      let cancelled = false;
      vizApi.getMonitorConfig(workspaceId)
        .then((config) => {
          if (cancelled) return;
          const map = new Map<string, MonitorDatasetBinding>();
          if (config) {
            for (const b of config.datasetBindings) map.set(b.datasetPathId, b);
            setConfigMeta({ ontologyId: config.ontologyId, metricSystemId: config.metricSystemId, thresholds: config.thresholds });
            if (config.ontologyId) setSelectedOntologyId(config.ontologyId);
          } else {
            setConfigMeta({});
          }
          setBindings(map);
        })
        .catch((e) => { if (!cancelled) setError(`加载默认监测配置失败: ${String(e)}`); });
      return () => { cancelled = true; };
    }
    const current = watchlists.find((item) => item.id === watchlistId);
    if (!current) return;
    const map = new Map<string, MonitorDatasetBinding>();
    for (const binding of current.datasetBindings) map.set(binding.datasetPathId, binding);
    setBindings(map);
    setConfigMeta((prev) => ({ ...prev, metricSystemId: current.metricSystemId, thresholds: current.thresholds }));
  }, [workspaceId, watchlistId, watchlists]);

  useEffect(() => {
    setSchemaTables([]);
    setSelectedTable("");
    setSqlText("");
    setLastImport(null);
    if (!connId) return;
    let cancelled = false;
    setSchemaLoading(true);
    api.getSqlSchema(connId)
      .then((r) => { if (!cancelled) setSchemaTables(r.tables); })
      .catch((e) => { if (!cancelled) setError(`拉取 schema 失败: ${String(e)}`); })
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [connId]);

  useEffect(() => {
    if (!selectedTable) return;
    const ident = selectedTable.replace(/"/g, '""');
    setSqlText(`SELECT * FROM "${ident}"`);
    if (!datasetName) setDatasetName(selectedTable);
    setLastImport(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable]);

  const refreshDatasets = async () => {
    if (!workspaceId) return;
    try {
      const list = await dataApi.listMonitorImports(workspaceId);
      setDatasets(list);
    } catch (e) {
      setError(String(e));
    }
  };

  // 持久化 monitor config：保留 ontology/metricSystem/thresholds，避免覆盖 D-MONITOR3 既有字段。
  const persistBindings = async (nextBindings: MonitorDatasetBinding[]) => {
    if (!workspaceId) return;
    if (watchlistId !== "default") {
      const current = watchlists.find((item) => item.id === watchlistId);
      if (!current) throw new Error("当前监测计划不存在");
      const updated = await vizApi.updateMonitorWatchlist(workspaceId, watchlistId, { datasetBindings: nextBindings });
      setWatchlists((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      const map = new Map<string, MonitorDatasetBinding>();
      for (const b of updated.datasetBindings) map.set(b.datasetPathId, b);
      setBindings(map);
      return;
    }
    const config = await vizApi.saveMonitorConfig(workspaceId, {
      suite: "monthly",
      datasetBindings: nextBindings,
      ...configMeta,
    });
    const map = new Map<string, MonitorDatasetBinding>();
    for (const b of config.datasetBindings) map.set(b.datasetPathId, b);
    setBindings(map);
  };

  const setRole = async (pathId: string, role: MonitorSourceRole | null, label?: string) => {
    if (!workspaceId) return;
    const next = new Map(bindings);
    if (role === null) {
      next.delete(pathId);
    } else {
      next.set(pathId, { datasetPathId: pathId, role, label, updatedAt: Date.now() });
    }
    try {
      await persistBindings(Array.from(next.values()));
      setError(null);
    } catch (e) {
      setError(`保存角色失败: ${String(e)}`);
    }
  };

  // 调用 D-MONITOR6 端点导入；成功后自动绑定角色（如已选）+ 刷新列表。
  const doImport = async () => {
    if (!workspaceId || !connId || !sqlText.trim() || !datasetName.trim()) return;
    setImportBusy(true);
    setError(null);
    try {
      const result = await dataApi.importMonitorSql(workspaceId, {
        connectionId: connId,
        sql: sqlText.trim(),
        datasetName: datasetName.trim(),
        format: "csv",
      });
      setLastImport({ columns: result.columns, rowCount: result.rowCount, name: result.name, pathId: result.pathId });
      await refreshDatasets();
      if (importRole) {
        const next = new Map(bindings);
        next.set(result.pathId, {
          datasetPathId: result.pathId,
          role: importRole,
          label: result.name,
          updatedAt: Date.now(),
        });
        await persistBindings(Array.from(next.values()));
      }
    } catch (e) {
      setError(`导入失败: ${String(e)}`);
    } finally {
      setImportBusy(false);
    }
  };

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
      setError(`生成指标体系草案失败: ${String(e)}`);
    } finally {
      setDraftBusy(false);
    }
  };

  const adoptDraft = async () => {
    if (!workspaceId || !draft) return;
    setAdoptBusy(true);
    setError(null);
    try {
      const r = await vizApi.adoptMonitorMetricSystem(workspaceId, { draft });
      if (watchlistId === "default") {
        const saved = await vizApi.saveMonitorConfig(workspaceId, {
          suite: "monthly",
          datasetBindings: Array.from(bindings.values()),
          ontologyId: selectedOntologyId || undefined,
          metricSystemId: r.metricSystemId,
          thresholds: configMeta.thresholds,
        });
        setConfigMeta({ ontologyId: saved.ontologyId, metricSystemId: saved.metricSystemId, thresholds: saved.thresholds });
      } else {
        const updated = await vizApi.updateMonitorWatchlist(workspaceId, watchlistId, { metricSystemId: r.metricSystemId });
        setWatchlists((prev) => prev.map((item) => item.id === updated.id ? updated : item));
        setConfigMeta((prev) => ({ ...prev, metricSystemId: r.metricSystemId }));
      }
      setDraft(null);
      vizApi.listMonitorMetricSystems(workspaceId).then(setSystems).catch(() => {});
    } catch (e) {
      setError(`采纳指标体系失败: ${String(e)}`);
    } finally {
      setAdoptBusy(false);
    }
  };

  const roleStats = useMemo(
    () => ROLES.map((r) => ({
      ...r,
      count: Array.from(bindings.values()).filter(
        (b) => b.role === r.value && datasets.some((d) => d.pathId === b.datasetPathId),
      ).length,
    })),
    [bindings, datasets],
  );

  const onboardingSteps = useMemo(() => {
    const hasSource = Array.from(bindings.values()).some((b) => b.role === "source" && datasets.some((d) => d.pathId === b.datasetPathId));
    const hasGoal = Array.from(bindings.values()).some((b) => b.role === "goal" && datasets.some((d) => d.pathId === b.datasetPathId));
    return [
      { label: "数据接入", ok: datasets.length > 0 },
      { label: "角色绑定", ok: hasSource },
      { label: "指标体系", ok: !!configMeta.metricSystemId },
      { label: "可运行", ok: hasSource && hasGoal && !!configMeta.metricSystemId },
    ];
  }, [bindings, configMeta.metricSystemId, datasets]);

  // hint：生成指标体系前提示缺少 source/goal（不硬阻塞）
  const missingRoles = useMemo(() => {
    const present = new Set(Array.from(bindings.values())
      .filter((b) => datasets.some((d) => d.pathId === b.datasetPathId))
      .map((b) => b.role));
    return (["source", "goal"] as MonitorSourceRole[]).filter((r) => !present.has(r));
  }, [bindings, datasets]);

  const qualityHints = useMemo(() => {
    const hints: string[] = [];
    const sourceDatasets = datasets.filter((ds) => bindings.get(ds.pathId)?.role === "source");
    const goalDatasets = datasets.filter((ds) => bindings.get(ds.pathId)?.role === "goal");
    if (sourceDatasets.length === 0) hints.push("缺 source 经营数据，观星台无法判断主指标异常。");
    if (goalDatasets.length === 0) hints.push("缺 goal 目标数据，可先去目标测算采纳计划或绑定 goal 数据集。");
    if (!selectedOntologyId && !configMeta.ontologyId) hints.push("未选择 ontology，引擎会降级按数据元数据生成指标体系。");
    if (!sourceDatasets.some((ds) => ds.columns.some((col) => /date|time|day|month|日期|时间|月份/.test(col.toLowerCase())))) hints.push("source 数据未识别到明显时间列，趋势/环比类规则可能降级。");
    if (sourceDatasets.some((ds) => ds.rowCount < 30)) hints.push("source 历史行数偏少，趋势判断置信度可能较低。");
    return hints;
  }, [bindings, configMeta.ontologyId, datasets, selectedOntologyId]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-neutral-50/40 text-[12.5px] dark:bg-neutral-950/40">
      <div className="flex items-center justify-end border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setView("main")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "main" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            功能
          </button>
          <button
            type="button"
            onClick={() => setView("readme")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "readme" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            readme
          </button>
        </div>
      </div>
      {view === "readme" ? (
        <div className="flex-1 overflow-auto p-5">
          <div className="mx-auto w-full max-w-4xl rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <Markdown>{readmeContent}</Markdown>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
        <header>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">监测初始化 · 数据接入</h2>
          <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
            通过数据库连接将表或 SELECT 查询导入到当前工作区的「监测聚合数据」目录（<code>clean_data/monitor/</code>）。
            本页只展示监测专用数据集，工作区其他 clean_data 不在此处出现。
          </p>
        </header>

        <MonitorWatchlistSelector
          workspaceId={workspaceId}
          value={watchlistId}
          onChange={(id) => {
            setHealthSelectedWatchlistId(id);
            setWatchlistId(id);
            if (id === "default" && workspaceId) {
              void vizApi.getMonitorConfig(workspaceId).then((config) => {
                const map = new Map<string, MonitorDatasetBinding>();
                for (const binding of config?.datasetBindings ?? []) map.set(binding.datasetPathId, binding);
                setBindings(map);
                setConfigMeta({ ontologyId: config?.ontologyId, metricSystemId: config?.metricSystemId, thresholds: config?.thresholds });
              }).catch(() => {});
            }
          }}
          onWatchlistsChange={setWatchlists}
        />

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 sm:grid-cols-4">
          {onboardingSteps.map((step, idx) => (
            <div key={step.label} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium ${step.ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"}`}>{idx + 1}</span>
              <div>
                <div className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{step.label}</div>
                <div className="text-[10px] text-neutral-400">{step.ok ? "已完成" : "待完成"}</div>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 角色统计 */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-[12px] dark:border-neutral-800 dark:bg-neutral-900">
          {roleStats.map((r) => (
            <span key={r.value} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${r.color}`}>
              <span className="font-medium">{r.label}</span>
              <span className="rounded bg-white/70 px-1 text-[10px] tabular-nums dark:bg-black/30">{r.count}</span>
            </span>
          ))}
          <span className="ml-auto text-[11px] text-neutral-400">仅监测聚合数据 · {datasets.length} 个</span>
        </div>

        {/* 数据库连接导入 */}
        {renderImportSection()}

        {/* 监测已导入数据集列表 */}
        {renderDatasetSection()}

        {/* 指标体系初始化 */}
        {renderMetricSystemSection()}
          </div>
        </div>
      )}
    </div>
  );

  function renderImportSection() {
    return (
      <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">数据库连接导入</h3>
          {schemaLoading && <span className="text-[11px] text-neutral-400">读取 schema 中…</span>}
        </div>
        <select value={connId} onChange={(e) => setConnId(e.target.value)} className={INPUT_CLS}>
          <option value="">选择数据库连接…（支持 SQLite / PostgreSQL / MySQL）</option>
          {sqlConns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
        </select>
        {sqlConns.length === 0 && (
          <p className="text-[11px] text-neutral-400">
            暂无数据库连接。请到「计算工具 · SQL 连接」新建连接（SQLite 仅需文件路径）。
          </p>
        )}
        {connId && schemaTables.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)} className={INPUT_CLS}>
              <option value="">选择表 …（自动生成 SELECT）</option>
              {schemaTables.map((t) => {
                const key = t.schema ? `${t.schema}.${t.name}` : t.name;
                return <option key={key} value={t.name}>{key}（{t.columns.length} 列）</option>;
              })}
            </select>
            <input
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              className={INPUT_CLS}
              placeholder="监测数据集名称（用作文件名）"
            />
          </div>
        )}
        {connId && (
          <textarea
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
            rows={3}
            placeholder="SELECT ... （仅允许只读 SELECT；可在自动生成后手动修改）"
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-950"
          />
        )}
        {connId && (
          <div className="flex items-center gap-2">
            <select
              value={importRole}
              onChange={(e) => setImportRole(e.target.value as MonitorSourceRole | "")}
              className={`${INPUT_CLS} flex-1`}
            >
              <option value="">导入后不自动绑定角色</option>
              {ROLES.map((r) => <option key={r.value} value={r.value}>导入后绑定为：{r.label}</option>)}
            </select>
            <button
              onClick={doImport}
              disabled={importBusy || !connId || !sqlText.trim() || !datasetName.trim()}
              className={BTN_PRIMARY}
            >
              {importBusy ? "导入中…" : "导入到监测聚合数据"}
            </button>
          </div>
        )}
        {lastImport && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
            已导入 <span className="font-medium">{lastImport.name}</span>
            · {lastImport.rowCount} 行 · {lastImport.columns.length} 列
            {importRole && <span className="ml-2">已绑定角色：{ROLES.find((r) => r.value === importRole)?.label}</span>}
          </div>
        )}
      </div>
    );
  }

  function renderDatasetSection() {
    const grouped = new Map<MonitorSourceRole | "unbound", BiAggregationDataset[]>();
    for (const key of ROLE_ORDER) grouped.set(key, []);
    for (const ds of datasets) grouped.get(bindings.get(ds.pathId)?.role ?? "unbound")!.push(ds);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">监测已导入数据集（{datasets.length}）</label>
          <button onClick={() => void refreshDatasets()} className="text-xs text-blue-500 hover:underline">刷新</button>
        </div>
        {loading && <p className="text-[12px] text-neutral-400">加载中…</p>}
        {ROLE_ORDER.map((role) => {
          const list = grouped.get(role) ?? [];
          if (list.length === 0) return null;
          const roleMeta = ROLES.find((item) => item.value === role);
          return (
            <section key={role} className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{roleMeta?.label ?? "未绑定数据"}</h3>
                <span className="text-[11px] text-neutral-400">{list.length} 个</span>
              </div>
              {list.map((ds) => renderDatasetCard(ds))}
            </section>
          );
        })}
        {datasets.length === 0 && !loading && (
          <p className="text-sm text-neutral-400">暂无监测聚合数据。请在上方「数据库连接导入」选择连接并导入。</p>
        )}
      </div>
    );
  }

  function renderDatasetCard(ds: BiAggregationDataset) {
    const b = bindings.get(ds.pathId);
    return (
      <div key={ds.pathId} className="rounded-md border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/40">
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
                onClick={() => void setRole(ds.pathId, active ? null : r.value, ds.name)}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition ${active ? r.color : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"}`}
              >
                {r.label}
              </button>
            );
          })}
          {b && <button onClick={() => void setRole(ds.pathId, null)} className="text-[11px] text-neutral-400 hover:text-red-500">清除</button>}
        </div>
      </div>
    );
  }

  function renderMetricSystemSection() {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">指标体系初始化</label>
            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              基于已启用 ontology + 监测聚合数据元数据生成监测指标体系（指标 / 依赖 / 监测规则）。LLM 仅读结构与摘要，不读原始行。
            </p>
          </div>
          {configMeta.metricSystemId && (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
              已采纳: {configMeta.metricSystemId.slice(0, 8)}…
            </span>
          )}
        </div>
        {missingRoles.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            提示：当前监测数据集尚未绑定 {missingRoles.map((r) => ROLES.find((x) => x.value === r)?.label).join(" / ")}；生成草案仍可继续，但建议先补齐角色以提高质量。
          </div>
        )}
        {qualityHints.length > 0 && (
          <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <div className="font-medium">生成前质量提示</div>
            <ul className="mt-1 list-disc pl-4">
              {qualityHints.map((hint) => <li key={hint}>{hint}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <select
            value={selectedOntologyId}
            onChange={(e) => {
              setSelectedOntologyId(e.target.value);
              setConfigMeta((prev) => ({ ...prev, ontologyId: e.target.value || undefined }));
            }}
            className={`${INPUT_CLS} flex-1`}
          >
            <option value="">选择 ontology（可选，留空让引擎自选）</option>
            {ontologies.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.version})</option>
            ))}
          </select>
          <button onClick={generateDraft} disabled={draftBusy || !workspaceId} className={BTN_PRIMARY}>
            {draftBusy ? "生成中…" : "生成指标体系草案"}
          </button>
        </div>
        {draft && renderDraftPreview(draft, adoptDraft, adoptBusy, () => setDraft(null))}
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
    );
  }
}

// draft 预览块抽到顶层纯函数（无闭包依赖、JSX 大段，外置后主组件函数体不再膨胀）。
function renderDraftPreview(
  draft: MonitorMetricSystemDraft,
  onAdopt: () => void,
  adopting: boolean,
  onDiscard: () => void,
) {
  return (
    <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium text-amber-900 dark:text-amber-100">草案预览</span>
          <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-200/80">
            需要确认：{draft.metrics.length} 个指标 · {draft.missingData.length} 项缺失数据 · {draft.assumptions.length} 条假设 · {draft.metrics.filter((m) => m.confidence < 0.7).length} 个低置信指标
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onDiscard} className={BTN_GHOST}>丢弃</button>
          <button
            onClick={onAdopt}
            disabled={adopting}
            className="rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {adopting ? "采纳中…" : "采纳，观星台可运行"}
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
  );
}
