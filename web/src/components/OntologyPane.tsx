import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Database, GitBranch, Calculator, Plus, Trash2, Network, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { GraphCanvas, type GraphCanvasNode, type GraphCanvasEdge } from "@/components/GraphCanvas";
import type { OntoExtractResult } from "@/lib/api/viz";
import type {
  Ontology,
  ObjectType,
  PropertyType,
  LinkType,
  LinkKind,
  MetricDefinition,
  OntologyGraph,
  BiAggregationDataset,
} from "@/types";

type Section = "onto_objects" | "onto_links" | "onto_metrics" | "onto_graph" | "onto_import";

const inputCls =
  "mt-1 w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900";
const cardCls =
  "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";
const btnPrimary =
  "rounded-md bg-neutral-900 px-3 py-2 text-[12px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";
const btnGhost =
  "rounded-md border border-neutral-200 px-3 py-2 text-[12px] text-neutral-600 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300";

export function OntologyPane({ workspaceId, section }: { workspaceId: string | null; section: Section }) {
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [activeOid, setActiveOid] = useState<string>("");
  const [error, setError] = useState("");

  const loadOntologies = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const list = await api.listOntologies(workspaceId);
      setOntologies(list);
      setActiveOid((cur) => cur || list[0]?.id || "");
    } catch (e) {
      setError(String(e));
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadOntologies();
  }, [loadOntologies]);

  const createOntology = useCallback(async () => {
    if (!workspaceId) return;
    const name = window.prompt("本体名称", "新建本体");
    if (!name) return;
    try {
      const onto = await api.createOntology(workspaceId, { name });
      setActiveOid(onto.id);
      await loadOntologies();
    } catch (e) {
      setError(String(e));
    }
  }, [workspaceId, loadOntologies]);

  const removeOntology = useCallback(async (oid: string) => {
    if (!window.confirm("删除该本体及其全部对象/关系？")) return;
    try {
      await api.deleteOntology(oid);
      setActiveOid("");
      await loadOntologies();
    } catch (e) {
      setError(String(e));
    }
  }, [loadOntologies]);

  if (!workspaceId) {
    return <div className="p-8 text-center text-[12.5px] text-neutral-400">请先选择 workspace</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-neutral-500" />
        <h1 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">onto-xanthil · 数据语义层</h1>
      </div>

      {/* 本体选择 */}
      <div className={`${cardCls} flex flex-wrap items-center gap-2`}>
        <span className="text-[11px] text-neutral-500">本体</span>
        <select
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
          value={activeOid}
          onChange={(e) => setActiveOid(e.target.value)}
        >
          <option value="">（未选择）</option>
          {ontologies.map((o) => (
            <option key={o.id} value={o.id}>{o.name} · {o.version}</option>
          ))}
        </select>
        <button onClick={() => void createOntology()} className={btnGhost}><Plus className="inline h-3.5 w-3.5" /> 新建本体</button>
        {activeOid && (
          <button onClick={() => void removeOntology(activeOid)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {!activeOid && section !== "onto_metrics" ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">选择或新建一个本体后开始建模</div>
      ) : (
        <>
          {section === "onto_objects" && <ObjectsSection workspaceId={workspaceId} oid={activeOid} onError={setError} />}
          {section === "onto_links" && <LinksSection oid={activeOid} onError={setError} />}
          {section === "onto_metrics" && <MetricsSection workspaceId={workspaceId} oid={activeOid} onError={setError} />}
          {section === "onto_graph" && <GraphSection oid={activeOid} onError={setError} />}
          {section === "onto_import" && <ImportSection oid={activeOid} onError={setError} />}
        </>
      )}
    </div>
  );
}

// ─── 对象 ──────────────────────────────────────────────────────────────────
function ObjectsSection({ workspaceId, oid, onError }: { workspaceId: string; oid: string; onError: (s: string) => void }) {
  const [objects, setObjects] = useState<ObjectType[]>([]);
  const [aggregations, setAggregations] = useState<BiAggregationDataset[]>([]);
  const [selectedAgg, setSelectedAgg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [objs, aggs] = await Promise.all([api.listObjects(oid), api.getBiAggregations(workspaceId)]);
      setObjects(objs);
      setAggregations(aggs);
    } catch (e) { onError(String(e)); }
  }, [oid, workspaceId, onError]);

  useEffect(() => { void load(); }, [load]);

  const genFromAgg = useCallback(async () => {
    if (!selectedAgg) return;
    setBusy(true);
    try {
      await api.createObjectFromAggregation(oid, { boundPathId: selectedAgg });
      setSelectedAgg("");
      await load();
    } catch (e) { onError(String(e)); } finally { setBusy(false); }
  }, [selectedAgg, oid, load, onError]);

  const addConcept = useCallback(async () => {
    const name = window.prompt("概念对象名称");
    if (!name) return;
    try { await api.createObject(oid, { kind: "concept", nameCn: name }); await load(); }
    catch (e) { onError(String(e)); }
  }, [oid, load, onError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm("删除该对象？")) return;
    try { await api.deleteObject(id); await load(); } catch (e) { onError(String(e)); }
  }, [load, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <Database className="h-3.5 w-3.5 text-neutral-500" />
          <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">从聚合集生成对象（零 LLM）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="min-w-56 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] dark:border-neutral-700 dark:bg-neutral-900" value={selectedAgg} onChange={(e) => setSelectedAgg(e.target.value)}>
            <option value="">选择 clean_data 聚合集…</option>
            {aggregations.map((a) => <option key={a.pathId} value={a.pathId}>{a.name}（{a.columns.length} 列 / {a.rowCount} 行）</option>)}
          </select>
          <button onClick={() => void genFromAgg()} disabled={!selectedAgg || busy} className={btnPrimary}>{busy ? "生成中…" : "生成对象"}</button>
          <button onClick={() => void addConcept()} className={btnGhost}><Plus className="inline h-3.5 w-3.5" /> 手工概念对象</button>
        </div>
      </div>

      {objects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无对象</div>
      ) : objects.map((o) => <ObjectCard key={o.id} obj={o} onRemove={() => void remove(o.id)} onError={onError} />)}
    </div>
  );
}

function ObjectCard({ obj, onRemove, onError }: { obj: ObjectType; onRemove: () => void; onError: (s: string) => void }) {
  const [props, setProps] = useState<PropertyType[] | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = useCallback(async () => {
    setOpen((v) => !v);
    if (props === null) {
      try { setProps(await api.listProperties(obj.id)); } catch (e) { onError(String(e)); }
    }
  }, [open, props, obj.id, onError]);

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Box className="h-3.5 w-3.5 text-neutral-400" />
            <h4 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{obj.nameCn}</h4>
            <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${obj.kind === "dataset" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>{obj.kind === "dataset" ? "数据集" : "概念"}</span>
            {obj.boundPathId && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-400 dark:border-neutral-700">绑定 #{obj.boundPathId}</span>}
          </div>
          {obj.description && <p className="mt-1.5 text-[12px] text-neutral-600 dark:text-neutral-300">{obj.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => void toggle()} className={btnGhost}>{open ? "收起" : "字段"}</button>
          <button onClick={onRemove} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          {props === null ? <span className="text-[11px] text-neutral-400">加载中…</span>
            : props.length === 0 ? <span className="text-[11px] text-neutral-400">无字段</span>
            : (
              <div className="flex flex-wrap gap-1.5">
                {props.map((p) => (
                  <span key={p.id} className="rounded-md bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
                    {p.name} <span className="text-neutral-400">: {p.dataType}</span>
                  </span>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ─── 关系 ──────────────────────────────────────────────────────────────────
const LINK_KINDS: LinkKind[] = ["join", "fk", "is-a", "part-of", "related"];
function LinksSection({ oid, onError }: { oid: string; onError: (s: string) => void }) {
  const [links, setLinks] = useState<LinkType[]>([]);
  const [objects, setObjects] = useState<ObjectType[]>([]);
  const [form, setForm] = useState({ source: "", target: "", kind: "related" as LinkKind });

  const load = useCallback(async () => {
    try {
      const [ls, objs] = await Promise.all([api.listLinks(oid), api.listObjects(oid)]);
      setLinks(ls); setObjects(objs);
    } catch (e) { onError(String(e)); }
  }, [oid, onError]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(objects.map((o) => [o.id, o.nameCn]));
    return (id: string) => m.get(id) ?? id;
  }, [objects]);

  const add = useCallback(async () => {
    if (!form.source || !form.target) return;
    try {
      await api.createLink(oid, { sourceObjectId: form.source, targetObjectId: form.target, kind: form.kind });
      setForm({ source: "", target: "", kind: "related" });
      await load();
    } catch (e) { onError(String(e)); }
  }, [form, oid, load, onError]);

  const remove = useCallback(async (id: string) => {
    try { await api.deleteLink(id); await load(); } catch (e) { onError(String(e)); }
  }, [load, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} flex flex-wrap items-center gap-2`}>
        <GitBranch className="h-3.5 w-3.5 text-neutral-500" />
        <select className={`${inputCls} mt-0 w-auto`} value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
          <option value="">源对象…</option>
          {objects.map((o) => <option key={o.id} value={o.id}>{o.nameCn}</option>)}
        </select>
        <select className={`${inputCls} mt-0 w-auto`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as LinkKind }))}>
          {LINK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select className={`${inputCls} mt-0 w-auto`} value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}>
          <option value="">目标对象…</option>
          {objects.map((o) => <option key={o.id} value={o.id}>{o.nameCn}</option>)}
        </select>
        <button onClick={() => void add()} disabled={!form.source || !form.target} className={btnPrimary}>添加关系</button>
      </div>

      {links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无关系</div>
      ) : links.map((l) => (
        <div key={l.id} className={`${cardCls} flex items-center justify-between gap-3`}>
          <span className="text-[12.5px] text-neutral-700 dark:text-neutral-200">{nameOf(l.sourceObjectId)} <span className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800">{l.kind}</span> {nameOf(l.targetObjectId)}</span>
          <button onClick={() => void remove(l.id)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── 指标（metric 真源，P1 仅 CRUD；P2 完成收敛）────────────────────────────
function MetricsSection({ workspaceId, oid, onError }: { workspaceId: string; oid: string; onError: (s: string) => void }) {
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [objects, setObjects] = useState<ObjectType[]>([]);
  const [form, setForm] = useState({ name: "", category: "", formula: "", caliber: "", unit: "", objectTypeId: "" });

  const load = useCallback(async () => {
    try {
      const [ms, objs] = await Promise.all([api.listMetrics(workspaceId), oid ? api.listObjects(oid) : Promise.resolve([])]);
      setMetrics(ms); setObjects(objs);
    } catch (e) { onError(String(e)); }
  }, [workspaceId, oid, onError]);
  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async () => {
    if (!form.name) return;
    try {
      await api.createMetric(workspaceId, {
        name: form.name, category: form.category, description: "", formula: form.formula,
        caliber: form.caliber, unit: form.unit, objectTypeId: form.objectTypeId || undefined,
      });
      setForm({ name: "", category: "", formula: "", caliber: "", unit: "", objectTypeId: "" });
      await load();
    } catch (e) { onError(String(e)); }
  }, [form, workspaceId, load, onError]);

  const remove = useCallback(async (id: string) => {
    try { await api.deleteMetric(id); await load(); } catch (e) { onError(String(e)); }
  }, [load, onError]);

  const backfill = useCallback(async () => {
    try {
      const r = await api.backfillMetricsFromStandards(workspaceId);
      window.alert(`从指标记忆导入：新增 ${r.migrated} 条，跳过 ${r.skipped} 条（同名已存在）`);
      await load();
    } catch (e) { onError(String(e)); }
  }, [workspaceId, load, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} flex items-center justify-between`}>
        <span className="text-[11.5px] text-neutral-500">metric 真源：本页即唯一真源。可从「指标记忆」非破坏式导入历史指标（幂等，不改动原数据）。</span>
        <button onClick={() => void backfill()} className={btnGhost}>从指标记忆导入</button>
      </div>
      <div className={`${cardCls} space-y-2`}>
        <div className="flex items-center gap-2"><Calculator className="h-3.5 w-3.5 text-neutral-500" /><span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">新增指标</span></div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-neutral-500">名称<input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label>
          <label className="text-[11px] text-neutral-500">分类<input className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></label>
          <label className="text-[11px] text-neutral-500">单位<input className={inputCls} value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} /></label>
          <label className="text-[11px] text-neutral-500">归属对象
            <select className={inputCls} value={form.objectTypeId} onChange={(e) => setForm((f) => ({ ...f, objectTypeId: e.target.value }))}>
              <option value="">（无）</option>
              {objects.map((o) => <option key={o.id} value={o.id}>{o.nameCn}</option>)}
            </select>
          </label>
          <label className="col-span-2 text-[11px] text-neutral-500">公式<input className={inputCls} value={form.formula} onChange={(e) => setForm((f) => ({ ...f, formula: e.target.value }))} /></label>
          <label className="col-span-2 text-[11px] text-neutral-500">口径<textarea className={`${inputCls} min-h-14`} value={form.caliber} onChange={(e) => setForm((f) => ({ ...f, caliber: e.target.value }))} /></label>
        </div>
        <div className="flex justify-end"><button onClick={() => void add()} disabled={!form.name} className={btnPrimary}>保存指标</button></div>
      </div>

      {metrics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无指标</div>
      ) : metrics.map((m) => (
        <div key={m.id} className={cardCls}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{m.name}</h4>
                {m.category && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">{m.category}</span>}
                {m.unit && <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:border-neutral-700">单位 {m.unit}</span>}
              </div>
              {m.formula && <p className="mt-1 font-mono text-[11px] text-neutral-500">公式：{m.formula}</p>}
              {m.caliber && <p className="mt-1 text-[11.5px] leading-5 text-neutral-500">口径：{m.caliber}</p>}
            </div>
            <button onClick={() => void remove(m.id)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 文档导入（pi LLM 抽取，P3）────────────────────────────────────────────
const SEV_STYLE: Record<string, string> = {
  fatal: "text-red-700 dark:text-red-300",
  error: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-neutral-500",
};
function ImportSection({ oid, onError }: { oid: string; onError: (s: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OntoExtractResult | null>(null);

  const run = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try { setResult(await api.extractOntology(oid, { text })); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  }, [text, oid, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} space-y-2`}>
        <div className="flex items-center gap-2"><Database className="h-3.5 w-3.5 text-neutral-500" /><span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">粘贴文档 → pi 抽取实体与关系</span></div>
        <textarea
          className={`${inputCls} min-h-48 font-mono`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴需求文档 / 业务说明 / 规范文本…（经 pi CLI 抽取，不直接调模型；抽取结果落为 concept 对象 + 语义关系）"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">置信度自动校准 + 质检门禁（空实体则不落库）</span>
          <button onClick={() => void run()} disabled={!text.trim() || busy} className={btnPrimary}>{busy ? "抽取中…（最长 90s）" : "开始抽取"}</button>
        </div>
      </div>

      {result && (
        <div className={`${cardCls} space-y-2`}>
          {result.report.hasFatal ? (
            <p className="text-[12.5px] font-medium text-red-600 dark:text-red-400">质检未通过，未落库</p>
          ) : (
            <p className="text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400">
              ✓ 新增 {result.createdObjects} 对象 · {result.createdLinks} 关系（跳过 {result.skippedObjects} 重复对象 / {result.skippedLinks} 无效关系）
            </p>
          )}
          {result.report.issues.length > 0 && (
            <div className="space-y-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
              {result.report.issues.map((it, i) => (
                <p key={i} className={`text-[11.5px] ${SEV_STYLE[it.severity] ?? "text-neutral-500"}`}>[{it.severity}] {it.message}</p>
              ))}
            </div>
          )}
          {!result.report.hasFatal && <p className="text-[11px] text-neutral-400">到「对象 / 图谱」页查看抽取结果。</p>}
        </div>
      )}
    </div>
  );
}

// ─── 图谱（共享 GraphCanvas）──────────────────────────────────────────────
const ONTO_COLORS = { dataset: "#0ea5e9", concept: "#a78bfa" } as const;
function ontoColor(group: string): string {
  return group === "dataset" ? ONTO_COLORS.dataset : group === "concept" ? ONTO_COLORS.concept : "#94a3b8";
}
const ONTO_LEGEND = [
  { group: "dataset", label: "数据集", color: ONTO_COLORS.dataset },
  { group: "concept", label: "概念", color: ONTO_COLORS.concept },
];
function GraphSection({ oid, onError }: { oid: string; onError: (s: string) => void }) {
  const [graph, setGraph] = useState<OntologyGraph | null>(null);

  const load = useCallback(async () => {
    try { setGraph(await api.getOntologyGraph(oid)); } catch (e) { onError(String(e)); }
  }, [oid, onError]);
  useEffect(() => { void load(); }, [load]);

  const gcNodes: GraphCanvasNode[] = useMemo(
    () => (graph?.nodes ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      group: n.group ?? n.type,
      color: ontoColor(n.group ?? n.type),
      groupLabel: (n.group ?? n.type) === "dataset" ? "数据集" : "概念",
    })),
    [graph],
  );
  const gcEdges: GraphCanvasEdge[] = useMemo(
    () => (graph?.edges ?? []).map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label ?? e.kind })),
    [graph],
  );

  const onConnect = useCallback(async (fromId: string, toId: string) => {
    try { await api.createLink(oid, { sourceObjectId: fromId, targetObjectId: toId, kind: "related" }); await load(); }
    catch (e) { onError(String(e)); }
  }, [oid, load, onError]);

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-80 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-neutral-500">{graph ? `${graph.nodes.length} 节点 · ${graph.edges.length} 边 · 拖拽节点连线即建「related」关系` : "加载中…"}</span>
        <button onClick={() => void load()} className={btnGhost}><RefreshCw className="inline h-3.5 w-3.5" /> 刷新</button>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <GraphCanvas
          nodes={gcNodes}
          edges={gcEdges}
          legend={ONTO_LEGEND}
          onConnect={(f, t) => void onConnect(f, t)}
          emptyHint={<p className="text-[12.5px]">暂无对象，先在「对象」页建模</p>}
        />
      </div>
    </div>
  );
}
