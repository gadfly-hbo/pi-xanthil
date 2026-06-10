import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Database, GitBranch, Calculator, Plus, Trash2, Network, RefreshCw, Download, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { GraphCanvas, type GraphCanvasNode, type GraphCanvasEdge } from "@/components/GraphCanvas";
import type { OntoExtractResult } from "@/lib/api/viz";
import type { OntoPrompt } from "@/types";
import type {
  Ontology,
  ObjectType,
  PropertyType,
  LinkType,
  LinkKind,
  MetricDefinition,
  LogicRule,
  OntoAction,
  OntologyGraph,
  BiAggregationDataset,
} from "@/types";

type Section = "onto_readme" | "onto_objects" | "onto_links" | "onto_metrics" | "onto_logic" | "onto_actions" | "onto_graph" | "onto_import";

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

  // P5 导出：直接走 GET（Content-Disposition: attachment 触发浏览器下载）
  const exportOnto = useCallback((format: string) => {
    if (!activeOid) return;
    const a = document.createElement("a");
    a.href = `/api/ontologies/${encodeURIComponent(activeOid)}/export?format=${format}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [activeOid]);

  if (!workspaceId) {
    return <div className="p-8 text-center text-[12.5px] text-neutral-400">请先选择 workspace</div>;
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-neutral-500" />
        <h1 className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">onto-xanthil · 数据语义层</h1>
      </div>

      {/* 本体选择（readme 说明页不需要，隐藏） */}
      {section !== "onto_readme" && (
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
          <>
            <span className="ml-auto inline-flex items-center gap-1 text-neutral-400"><Download className="h-3.5 w-3.5" /></span>
            <select
              className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900"
              defaultValue=""
              onChange={(e) => { if (e.target.value) { exportOnto(e.target.value); e.target.value = ""; } }}
              title="导出本体"
            >
              <option value="" disabled>导出…</option>
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
              <option value="csv">CSV</option>
              <option value="html">HTML</option>
              <option value="ttl">Turtle (RDF)</option>
            </select>
            <button onClick={() => void removeOntology(activeOid)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
      )}

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {section === "onto_readme" ? (
        <ReadmeSection />
      ) : !activeOid && section !== "onto_metrics" ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">选择或新建一个本体后开始建模</div>
      ) : (
        <>
          {section === "onto_objects" && <ObjectsSection workspaceId={workspaceId} oid={activeOid} onError={setError} />}
          {section === "onto_links" && <LinksSection oid={activeOid} onError={setError} />}
          {section === "onto_metrics" && <MetricsSection workspaceId={workspaceId} oid={activeOid} onError={setError} />}
          {section === "onto_logic" && <LogicSection oid={activeOid} onError={setError} />}
          {section === "onto_actions" && <ActionsSection oid={activeOid} onError={setError} />}
          {section === "onto_graph" && <GraphSection oid={activeOid} onError={setError} />}
          {section === "onto_import" && <ImportSection workspaceId={workspaceId} oid={activeOid} onError={setError} />}
        </>
      )}
    </div>
    </div>
  );
}

// ─── 说明（readme：概念 + 操作 + 示例）──────────────────────────────────────
function ReadmeSection() {
  const h2 = "text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100";
  const h3 = "text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200";
  const p = "text-[12.5px] leading-6 text-neutral-600 dark:text-neutral-300";
  const li = "text-[12.5px] leading-6 text-neutral-600 dark:text-neutral-300";
  const code = "rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11.5px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200";
  const th = "border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-left text-[11.5px] font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200";
  const td = "border border-neutral-200 px-2.5 py-1.5 align-top text-[11.5px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-300";
  return (
    <div className="space-y-4">
      <div className={`${cardCls} space-y-2`}>
        <h2 className={h2}>onto-xanthil 是什么</h2>
        <p className={p}>
          onto-xanthil 是 pi-xanthil 的<strong>数据语义层</strong>——把零散的数据集、字段、业务规则，组织成一张「机器可理解」的领域本体（ontology）。
          它回答「<strong>数据是什么</strong>」（对象/属性/关系/指标），与现有「规则记忆·知识图谱」回答「<strong>我们怎么分析</strong>」两层并立、共用一套图引擎。
        </p>
        <p className={p}>
          取向：借鉴 Palantir 的「object/link 绑数据」心智 —— 对象 = 数据集、属性 = 列、关系 = 表间关联、动作 = 可执行操作；做轻、面向数据分析、本地优先，全程经 pi CLI 不直接调模型。
        </p>
      </div>

      <div className={`${cardCls} space-y-3`}>
        <h2 className={h2}>七个核心概念</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>概念</th><th className={th}>含义</th><th className={th}>示例</th></tr></thead>
            <tbody>
              <tr><td className={td}><strong>本体 Ontology</strong></td><td className={td}>一个领域的知识容器，含名称/领域/版本/状态</td><td className={td}>「供应链本体」</td></tr>
              <tr><td className={td}><strong>对象 Object</strong></td><td className={td}>领域里的核心概念。两种：<code className={code}>dataset</code>（绑定聚合数据集）/ <code className={code}>concept</code>（纯概念）</td><td className={td}>供应商、采购订单</td></tr>
              <tr><td className={td}><strong>属性 Property</strong></td><td className={td}>对象的字段，可绑定数据集列 + 标注语义类型（主键/金额…）</td><td className={td}>供应商.供应商ID（主键）</td></tr>
              <tr><td className={td}><strong>关系 Link</strong></td><td className={td}>对象间关联：<code className={code}>join/fk</code>（表关系，带连接键）、<code className={code}>is-a/part-of/related</code>（语义）</td><td className={td}>订单 —fk→ 供应商</td></tr>
              <tr><td className={td}><strong>指标 Metric</strong></td><td className={td}>可执行口径定义（公式/口径/单位），可绑定对象与列；是全局指标语义层的唯一真源</td><td className={td}>准时交付率 = 准时单/总单</td></tr>
              <tr><td className={td}><strong>逻辑 Logic Rule</strong></td><td className={td}>本体的形式化约束/必然关系，可关联对象</td><td className={td}>∀ 订单 → 必有供应商</td></tr>
              <tr><td className={td}><strong>动作 Action</strong></td><td className={td}>基于本体状态触发的可执行操作，含触发条件 + function_code，可关联逻辑</td><td className={td}>库存&lt;阈值 → 通知采购</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${cardCls} space-y-3`}>
        <h2 className={h2}>各子页操作说明</h2>
        <p className={p}>顶部「本体」下拉先选/新建一个本体；除「指标」「说明」外，其它子页都在<strong>当前选中本体</strong>下操作。右上角「导出…」下拉随时把本体导出成 JSON/YAML/CSV/HTML/Turtle。</p>

        <div className="space-y-3.5">
          <div className="space-y-1">
            <h3 className={h3}>① 对象 —— 本体的「名词」</h3>
            <p className={li}><span className="text-neutral-400">用途：</span>把数据集或业务概念登记为对象。两种来源：</p>
            <ul className="ml-4 list-disc space-y-1">
              <li className={li}><strong>从聚合数据集生成（推荐，零 LLM）</strong>：顶部下拉列出本 workspace 已登记的 <code className={code}>clean_data</code> 聚合集 → 选一个 →「生成对象」。系统自动建 <code className={code}>dataset</code> 对象，并按表头逐列建属性、推断 <code className={code}>dataType</code>（string/number/date…）。<span className="text-neutral-400">仅 clean_data 可绑；明细 draw_data 不可（后端 403）。</span></li>
              <li className={li}><strong>手工概念对象</strong>：点「手工概念对象」新建一个 <code className={code}>concept</code> 对象（无数据绑定，纯领域概念，如「客户分层」）。</li>
            </ul>
            <p className={li}><span className="text-neutral-400">管理：</span>每张对象卡显示 kind / 中英文名 / 描述 / 置信度，并列出属性（名称: 类型）。可在卡内增删属性、给属性标注语义类型（主键/外键/金额…）与绑定列。删除对象用卡右上角垃圾桶。</p>
          </div>

          <div className="space-y-1">
            <h3 className={h3}>② 关系 —— 对象间怎么连</h3>
            <p className={li}><span className="text-neutral-400">操作：</span>顶部三个下拉依次选「源对象 → 关系类型 → 目标对象」，点「添加关系」。</p>
            <ul className="ml-4 list-disc space-y-1">
              <li className={li}><code className={code}>fk</code> / <code className={code}>join</code>：<strong>数据层</strong>表间关联（外键 / 连接），可进一步记连接键（源列=目标列）；分析取数 join 时引用。</li>
              <li className={li}><code className={code}>is-a</code>（是一种）/ <code className={code}>part-of</code>（属于）/ <code className={code}>related</code>（相关）：<strong>语义层</strong>层级与关联。</li>
            </ul>
            <p className={li}>下方列表以「源 —类型→ 目标」展示，可逐条删除。同源/目标/类型重复会被去重。</p>
          </div>

          <div className="space-y-1">
            <h3 className={h3}>③ 指标 —— 口径的唯一真源</h3>
            <p className={li}><span className="text-neutral-400">注意：</span>指标是 <strong>workspace 级</strong>（跨本体共享），不绑死单个本体。新建时填名称 / 分类 / <strong>公式</strong> / 口径 / 单位，可选绑定到某对象。</p>
            <ul className="ml-4 list-disc space-y-1">
              <li className={li}><strong>启用开关</strong>决定该指标是否被注入到分析上下文（system prompt / 工作流取数会读已启用指标的口径）。</li>
              <li className={li}>可从历史「指标记忆」<strong>一键 backfill</strong> 导入旧口径（非破坏式）。</li>
              <li className={li}><code className={code}>metric_definitions</code> 是全局指标<strong>唯一真源</strong>：工作流生成 SQL、看板取数都引用同一口径，杜绝各自造轮子、口径打架。</li>
            </ul>
          </div>

          <div className="space-y-1">
            <h3 className={h3}>④ 逻辑 —— 本体的业务铁律</h3>
            <p className={li}><span className="text-neutral-400">操作：</span>填「规则名」+「形式化表达 formula（可选，如 <code className={code}>∀ order → has_supplier</code>）」+「说明」，再点下方对象 chips <strong>多选关联对象</strong>，点「添加规则」。</p>
            <p className={li}>用于沉淀领域约束/必然关系。关联对象建立双向关系，便于后续动作引用。卡片展示 formula/说明/关联对象，可删除。</p>
          </div>

          <div className="space-y-1">
            <h3 className={h3}>⑤ 动作 —— 在什么条件下做什么</h3>
            <p className={li}><span className="text-neutral-400">操作：</span>填「动作名」+「触发条件 executionRule（如 <code className={code}>stock &lt; threshold</code>）」+「function_code（Python，可选）」，再多选「关联逻辑规则」，点「添加动作」。</p>
            <ul className="ml-4 list-disc space-y-1">
              <li className={li}><code className={code}>function_code</code> <strong>保存时不执行</strong>，仅作为可执行规则记录；质检会对它做轻量启发式检查（非空 / 长度）。</li>
              <li className={li}>把「逻辑（约束）」与「动作（响应）」串起来，表达本体的动力学层（借 Palantir Action 心智）。</li>
            </ul>
          </div>

          <div className="space-y-1">
            <h3 className={h3}>⑥ 图谱 —— 一眼看全貌</h3>
            <p className={li}>把当前本体的对象（节点）与关系（边）投影成力导向图，可拖拽探索、点节点看详情。与「规则记忆·知识图谱」共用同一 <code className={code}>GraphCanvas</code> 渲染底座。建好对象/关系后来这里核对结构是否合理。</p>
          </div>

          <div className="space-y-1">
            <h3 className={h3}>⑦ 导入 —— 让 pi 把文档抽成本体</h3>
            <ul className="ml-4 list-disc space-y-1">
              <li className={li}><strong>录入正文</strong>：直接粘贴，或点「上传文件」选 <code className={code}>.md/.txt/.csv</code>（浏览器本地读取，多文件追加进文本框）。</li>
              <li className={li}><strong>开始抽取</strong>：经 pi CLI（不直接调模型）一次性抽出<strong>实体 / 关系 / 逻辑 / 动作四类</strong>；置信度自动校准（四类）；过 7 道质检门禁；<span className="text-neutral-400">抽不到任何实体（fatal）则不落库。</span>结果计数与质检明细就地显示，到「对象/图谱」页查看落库结果。</li>
              <li className={li}><strong>自定义抽取 Prompt</strong>（折叠区）：下拉选已保存模板 / 「从模板新建」生成可编辑草稿 / 改完「保存模板」（命名 + 版本化）/ 删除。模板须含 <code className={code}>{"{{content}}"}</code> 正文占位符；缺占位则回退内置默认模板。</li>
            </ul>
          </div>
        </div>
      </div>

      <div className={`${cardCls} space-y-2`}>
        <h2 className={h2}>完整示例：3 分钟搭一个「供应链本体」</h2>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li className={li}>新建本体「供应链本体」，领域填「供应链」。</li>
          <li className={li}><strong>对象</strong>页选已登记的 clean_data 聚合集（如供应商表）→「生成对象」，得到 <code className={code}>供应商</code> 对象 + 自动属性；再手工建 <code className={code}>采购订单</code> 概念对象。</li>
          <li className={li}><strong>关系</strong>页加：<code className={code}>采购订单 —fk→ 供应商</code>。</li>
          <li className={li}><strong>指标</strong>页定义 <code className={code}>准时交付率</code>（公式：准时单数/总单数，单位 %），绑定到供应商对象。</li>
          <li className={li}><strong>逻辑</strong>页加规则「每笔订单必有供应商」，关联订单+供应商两对象。</li>
          <li className={li}><strong>动作</strong>页加「缺货告警」：触发条件 <code className={code}>stock &lt; threshold</code>，关联上面的逻辑规则。</li>
          <li className={li}>到<strong>图谱</strong>页查看全貌；用顶部<strong>导出</strong>下拉导出 Turtle/JSON 交付他人。</li>
        </ol>
        <p className="text-[11.5px] text-neutral-400">提示：第 2~6 步也可在「导入」页粘贴一段供应链业务说明，让 pi 一次性抽取出对象/关系/逻辑/动作草稿，再人工微调。</p>
      </div>
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

// ─── 逻辑规则（本体形式化约束层，P6）────────────────────────────────────────
function LogicSection({ oid, onError }: { oid: string; onError: (s: string) => void }) {
  const [rules, setRules] = useState<LogicRule[]>([]);
  const [objects, setObjects] = useState<ObjectType[]>([]);
  const [form, setForm] = useState({ nameCn: "", formula: "", description: "", linkedObjectIds: [] as string[] });

  const load = useCallback(async () => {
    try {
      const [rs, objs] = await Promise.all([api.listLogicRules(oid), api.listObjects(oid)]);
      setRules(rs); setObjects(objs);
    } catch (e) { onError(String(e)); }
  }, [oid, onError]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(objects.map((o) => [o.id, o.nameCn]));
    return (id: string) => m.get(id) ?? id;
  }, [objects]);

  const add = useCallback(async () => {
    if (!form.nameCn.trim()) return;
    try {
      await api.createLogicRule(oid, { nameCn: form.nameCn.trim(), formula: form.formula, description: form.description, linkedObjectIds: form.linkedObjectIds });
      setForm({ nameCn: "", formula: "", description: "", linkedObjectIds: [] });
      await load();
    } catch (e) { onError(String(e)); }
  }, [form, oid, load, onError]);

  const remove = useCallback(async (id: string) => {
    try { await api.deleteLogicRule(id); await load(); } catch (e) { onError(String(e)); }
  }, [load, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} space-y-2`}>
        <div className="flex items-center gap-2"><Calculator className="h-3.5 w-3.5 text-neutral-500" /><span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">新增逻辑规则（本体形式化约束）</span></div>
        <input className={inputCls} placeholder="规则名（如：每笔订单必有供应商）" value={form.nameCn} onChange={(e) => setForm((f) => ({ ...f, nameCn: e.target.value }))} />
        <input className={`${inputCls} font-mono`} placeholder="形式化表达（可选，如：∀ order → has_supplier）" value={form.formula} onChange={(e) => setForm((f) => ({ ...f, formula: e.target.value }))} />
        <input className={inputCls} placeholder="说明（可选）" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <div>
          <span className="text-[11px] text-neutral-500">关联对象（可多选）</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {objects.length === 0 ? <span className="text-[11px] text-neutral-400">本体内暂无对象</span> : objects.map((o) => {
              const on = form.linkedObjectIds.includes(o.id);
              return (
                <button key={o.id} type="button" onClick={() => setForm((f) => ({ ...f, linkedObjectIds: on ? f.linkedObjectIds.filter((x) => x !== o.id) : [...f.linkedObjectIds, o.id] }))}
                  className={`rounded-md border px-2 py-1 text-[11px] ${on ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}>{o.nameCn}</button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end"><button onClick={() => void add()} disabled={!form.nameCn.trim()} className={btnPrimary}>添加规则</button></div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无逻辑规则</div>
      ) : rules.map((r) => (
        <div key={r.id} className={`${cardCls} space-y-1.5`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{r.nameCn}</span>
            <button onClick={() => void remove(r.id)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          {r.formula && <p className="font-mono text-[11.5px] text-neutral-500">{r.formula}</p>}
          {r.description && <p className="text-[11.5px] text-neutral-500">{r.description}</p>}
          {r.linkedObjectIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {r.linkedObjectIds.map((id) => <span key={id} className="rounded-md bg-neutral-50 px-2 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">{nameOf(id)}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 动作（可执行动作层，P6）────────────────────────────────────────────────
function ActionsSection({ oid, onError }: { oid: string; onError: (s: string) => void }) {
  const [actions, setActions] = useState<OntoAction[]>([]);
  const [rules, setRules] = useState<LogicRule[]>([]);
  const [form, setForm] = useState({ nameCn: "", executionRule: "", functionCode: "", linkedLogicIds: [] as string[] });

  const load = useCallback(async () => {
    try {
      const [as, rs] = await Promise.all([api.listOntoActions(oid), api.listLogicRules(oid)]);
      setActions(as); setRules(rs);
    } catch (e) { onError(String(e)); }
  }, [oid, onError]);
  useEffect(() => { void load(); }, [load]);

  const ruleNameOf = useMemo(() => {
    const m = new Map(rules.map((r) => [r.id, r.nameCn]));
    return (id: string) => m.get(id) ?? id;
  }, [rules]);

  const add = useCallback(async () => {
    if (!form.nameCn.trim()) return;
    try {
      await api.createOntoAction(oid, { nameCn: form.nameCn.trim(), executionRule: form.executionRule, functionCode: form.functionCode, linkedLogicIds: form.linkedLogicIds });
      setForm({ nameCn: "", executionRule: "", functionCode: "", linkedLogicIds: [] });
      await load();
    } catch (e) { onError(String(e)); }
  }, [form, oid, load, onError]);

  const remove = useCallback(async (id: string) => {
    try { await api.deleteOntoAction(id); await load(); } catch (e) { onError(String(e)); }
  }, [load, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} space-y-2`}>
        <div className="flex items-center gap-2"><Box className="h-3.5 w-3.5 text-neutral-500" /><span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">新增动作（基于本体状态触发的可执行规则）</span></div>
        <input className={inputCls} placeholder="动作名（如：库存低于阈值时通知采购）" value={form.nameCn} onChange={(e) => setForm((f) => ({ ...f, nameCn: e.target.value }))} />
        <input className={inputCls} placeholder="触发条件（可选，如：stock < threshold）" value={form.executionRule} onChange={(e) => setForm((f) => ({ ...f, executionRule: e.target.value }))} />
        <textarea className={`${inputCls} min-h-24 font-mono`} placeholder="function_code（可选，Python；保存时不执行，仅做 AST 语法校验）" value={form.functionCode} onChange={(e) => setForm((f) => ({ ...f, functionCode: e.target.value }))} />
        <div>
          <span className="text-[11px] text-neutral-500">关联逻辑规则（可多选）</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {rules.length === 0 ? <span className="text-[11px] text-neutral-400">本体内暂无逻辑规则</span> : rules.map((r) => {
              const on = form.linkedLogicIds.includes(r.id);
              return (
                <button key={r.id} type="button" onClick={() => setForm((f) => ({ ...f, linkedLogicIds: on ? f.linkedLogicIds.filter((x) => x !== r.id) : [...f.linkedLogicIds, r.id] }))}
                  className={`rounded-md border px-2 py-1 text-[11px] ${on ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}>{r.nameCn}</button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end"><button onClick={() => void add()} disabled={!form.nameCn.trim()} className={btnPrimary}>添加动作</button></div>
      </div>

      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-[12.5px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900/40">暂无动作</div>
      ) : actions.map((a) => (
        <div key={a.id} className={`${cardCls} space-y-1.5`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{a.nameCn}</span>
            <button onClick={() => void remove(a.id)} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          {a.executionRule && <p className="text-[11.5px] text-neutral-500">触发：<span className="font-mono">{a.executionRule}</span></p>}
          {a.functionCode && <pre className="overflow-x-auto rounded-md bg-neutral-50 p-2 font-mono text-[11px] text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">{a.functionCode}</pre>}
          {a.linkedLogicIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {a.linkedLogicIds.map((id) => <span key={id} className="rounded-md bg-neutral-50 px-2 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">{ruleNameOf(id)}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 抽取 prompt 起始模板（P8）：{{content}} 为文档正文占位；留空则后端用默认模板。
const PROMPT_STARTER = `请从以下文档中抽取领域本体的「实体」「关系」「逻辑规则」「动作」。

文档内容：
{{content}}

输出严格 JSON：{"entities":[{"nameCn":"…","description":"…","confidence":0.9}],"relations":[{"source":"…","target":"…","kind":"is-a|part-of|related"}],"logic_rules":[{"nameCn":"…","formula":"…","linkedEntities":["…"]}],"actions":[{"nameCn":"…","executionRule":"…","functionCode":"…","linkedEntities":["…"],"linkedLogic":["…"]}]}`;

function ImportSection({ workspaceId, oid, onError }: { workspaceId: string; oid: string; onError: (s: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OntoExtractResult | null>(null);
  // Prompt 管理（P8）
  const [prompts, setPrompts] = useState<OntoPrompt[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [activePromptId, setActivePromptId] = useState("");
  const [promptName, setPromptName] = useState("");
  const [promptContent, setPromptContent] = useState("");

  const loadPrompts = useCallback(async () => {
    try { setPrompts(await api.listOntoPrompts(workspaceId)); } catch (e) { onError(String(e)); }
  }, [workspaceId, onError]);
  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    try {
      const parts: string[] = [];
      for (const f of Array.from(files)) parts.push(`# ${f.name}\n${await f.text()}`);
      setText((cur) => (cur ? cur + "\n\n" : "") + parts.join("\n\n"));
    } catch (e) { onError(String(e)); }
  }, [onError]);

  const usePrompt = useCallback((id: string) => {
    setActivePromptId(id);
    const p = prompts.find((x) => x.id === id);
    if (p) { setPromptName(p.name); setPromptContent(p.content); }
  }, [prompts]);

  const savePrompt = useCallback(async () => {
    if (!promptName.trim() || !promptContent.trim()) return;
    try {
      if (activePromptId) await api.updateOntoPrompt(activePromptId, { name: promptName.trim(), content: promptContent });
      else { const p = await api.createOntoPrompt(workspaceId, { name: promptName.trim(), content: promptContent }); setActivePromptId(p.id); }
      await loadPrompts();
    } catch (e) { onError(String(e)); }
  }, [activePromptId, promptName, promptContent, workspaceId, loadPrompts, onError]);

  const removePrompt = useCallback(async () => {
    if (!activePromptId) return;
    try { await api.deleteOntoPrompt(activePromptId); setActivePromptId(""); setPromptName(""); setPromptContent(""); await loadPrompts(); }
    catch (e) { onError(String(e)); }
  }, [activePromptId, loadPrompts, onError]);

  const run = useCallback(async () => {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    // 仅当自定义 prompt 含 {{content}} 占位时才覆盖默认模板
    const promptTemplate = activePromptId && promptContent.includes("{{content}}") ? promptContent : undefined;
    try { setResult(await api.extractOntology(oid, { text, promptTemplate })); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  }, [text, oid, activePromptId, promptContent, onError]);

  return (
    <div className="space-y-3">
      <div className={`${cardCls} space-y-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Database className="h-3.5 w-3.5 text-neutral-500" /><span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">文档 → pi 抽取（对象/关系/逻辑/动作）</span></div>
          <label className={`${btnGhost} cursor-pointer`}>
            <Upload className="inline h-3.5 w-3.5" /> 上传文件
            <input type="file" accept=".md,.txt,.csv,text/plain,text/markdown,text/csv" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        <textarea
          className={`${inputCls} min-h-48 font-mono`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴或上传需求文档 / 业务说明 / 规范文本…（支持 .md/.txt/.csv；经 pi CLI 抽取，不直接调模型；落为 concept 对象 + 语义关系 + 逻辑规则 + 动作）"
        />
        <div className="flex items-center justify-between">
          <button onClick={() => setShowPrompt((s) => !s)} className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">{showPrompt ? "▾" : "▸"} 自定义抽取 Prompt{activePromptId ? `（已选：${promptName}）` : ""}</button>
          <button onClick={() => void run()} disabled={!text.trim() || busy} className={btnPrimary}>{busy ? "抽取中…（最长 90s）" : "开始抽取"}</button>
        </div>

        {showPrompt && (
          <div className="space-y-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} mt-0 w-auto`} value={activePromptId} onChange={(e) => { if (e.target.value) usePrompt(e.target.value); else { setActivePromptId(""); setPromptName(""); setPromptContent(""); } }}>
                <option value="">默认模板（不覆盖）</option>
                {prompts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.version}</option>)}
              </select>
              <button onClick={() => { setActivePromptId(""); setPromptName("新建模板"); setPromptContent(PROMPT_STARTER); }} className={btnGhost}><Plus className="inline h-3.5 w-3.5" /> 从模板新建</button>
              {activePromptId && <button onClick={() => void removePrompt()} className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:text-red-600 dark:border-neutral-700"><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
            {(promptContent || promptName) && (
              <>
                <input className={inputCls} placeholder="模板名称" value={promptName} onChange={(e) => setPromptName(e.target.value)} />
                <textarea className={`${inputCls} min-h-32 font-mono`} placeholder="prompt 内容（须含 {{content}} 占位符）" value={promptContent} onChange={(e) => setPromptContent(e.target.value)} />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-neutral-400">{promptContent.includes("{{content}}") ? "✓ 含 {{content}} 占位" : "⚠ 缺 {{content}} 占位，将回退默认模板"}</span>
                  <button onClick={() => void savePrompt()} disabled={!promptName.trim() || !promptContent.trim()} className={btnGhost}>{activePromptId ? "更新模板" : "保存模板"}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className={`${cardCls} space-y-2`}>
          {result.report.hasFatal ? (
            <p className="text-[12.5px] font-medium text-red-600 dark:text-red-400">质检未通过，未落库</p>
          ) : (
            <p className="text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400">
              ✓ 新增 {result.createdObjects} 对象 · {result.createdLinks} 关系 · {result.createdLogicRules} 逻辑规则 · {result.createdActions} 动作（跳过 {result.skippedObjects} 重复对象 / {result.skippedLinks} 无效关系）
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
