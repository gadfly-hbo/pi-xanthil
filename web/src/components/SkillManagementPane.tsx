import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Plus,
  Pencil,
  Archive,
  CheckCircle2,
  AlertTriangle,
  FlaskConical,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Ban,
  Wand2,
  Eye,
  X,
  Download,
  Upload,
  Search,
  Activity,
  History,
} from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { cn } from "@/lib/cn";
import type {
  SkillEvalSet,
  SkillEvaluation,
  SkillEvaluationDetail,
  PiModel,
  SkillAutoDistillResult,
  SkillCoverageGapCluster,
  SkillCoverageGapResult,
  SkillRegistryConflict,
  SkillRegistryEntry,
  SkillRegistryEvalHistoryEntry,
  SkillRegistryRetestActiveResult,
  SkillSource,
  SkillStatus,
} from "@/types";
import { CreateSkillModal, type CreateDraft } from "@/components/CreateSkillModal";
import { EvalSkillModal } from "@/components/EvalSkillModal";
import { AdoptConfirmModal } from "@/components/AdoptConfirmModal";
import { ObservabilityDashboard } from "@/components/skill-management/ObservabilityDashboard";

/**
 * 计算工具·skill 管理（项目级 skill 生命周期注册表 UI）。
 *
 * 数据流（卡2 端点，跨域调 E）：
 *   GET    /api/workspaces/:id/skill-registry          列出
 *   POST   /api/workspaces/:id/skill-registry          创建/版本更新（写 SKILL.md + 注册）
 *   PATCH  /api/skill-registry/:id                     改 status/version/name
 *   DELETE /api/skill-registry/:id                     归档（不删 SKILL.md，留档可回滚）
 *   POST   /api/skill-registry/:id/evaluate            送评测（baseline vs candidate，回写 score/activationRate）
 *
 * 启用关系：sharedApi.memory-enablements (kind="skill")，全局池 + 按工作区启用（同 RulesPane 范式）。
 *
 * 边界：仅 D slot 渲染，跨域调用 E 端点；不读 draw_data 行级；前端只展示评测回写的数值。
 */

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
}

// B 卡：自动沉淀一次最多处理几个 session（每个 = 一次 LLM 蒸馏，顺序执行）。
const AUTO_DISTILL_LIMITS = [1, 3, 5] as const;

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<SkillStatus, string> = {
  draft: "草稿",
  candidate: "候选",
  active: "采纳",
  archived: "归档",
};

const STATUS_TONE: Record<SkillStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  candidate: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  archived: "bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500",
};

const SOURCE_LABEL: Record<SkillSource, string> = {
  manual: "手写",
  distilled: "蒸馏",
  curated: "策展",
  imported: "导入",
};

const FUNNEL_STAGES: { status: SkillStatus; label: string; hint: string }[] = [
  { status: "candidate", label: "候选", hint: "等待评测验证" },
  { status: "draft", label: "评测中/待采纳", hint: "评测产物或人工确认" },
  { status: "active", label: "采纳", hint: "工作区可启用注入" },
  { status: "archived", label: "归档", hint: "留档可回滚" },
];

const DEFAULT_DRAFT_CONTENT = [
  "---",
  "name: example-skill",
  "description: One-line summary so pi can decide when to load.",
  "---",
  "",
  "# Example Skill",
  "",
  "## When to use",
  "- ...",
  "",
  "## Steps",
  "1. ...",
  "",
].join("\n");

const DEFAULT_DRAFT: CreateDraft = {
  slug: "",
  name: "",
  source: "manual",
  status: "candidate",
  reason: "",
  content: DEFAULT_DRAFT_CONTENT,
  supersedesId: null,
  baseVersion: 1,
};

const DEFAULT_EVAL_TASK = {
  id: "task_1",
  prompt: "请使用该 skill 完成以下任务：给定一个需要结构化分析的场景，按 skill 步骤输出关键推理过程和结论。如果 skill 提供了具体工具或流程，请严格遵循。",
};

const LOW_SCORE_THRESHOLD = 0.6;
const LOW_ACTIVATION_THRESHOLD = 0.5;

function isLowPerforming(entry: SkillRegistryEntry): boolean {
  if (entry.status === "archived") return false;
  if (entry.score !== null && entry.score < LOW_SCORE_THRESHOLD) return true;
  if (entry.activationRate !== null && entry.activationRate < LOW_ACTIVATION_THRESHOLD) return true;
  return false;
}

function fmtPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(1) + "%";
}

function fmtScore(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

function fmtTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", { hour12: false });
}

// G 卡：紧凑时间格式、回归 delta 展示与触发标签已搬到子组件 ObservabilityDashboard。

export function SkillManagementPane({ workspaceId, model, models }: Props) {
  const [entries, setEntries] = useState<SkillRegistryEntry[]>([]);
  const [enablements, setEnablements] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SkillRegistryEntry | null>(null);
  const [draft, setDraft] = useState<CreateDraft>(DEFAULT_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [evalTarget, setEvalTarget] = useState<SkillRegistryEntry | null>(null);
  const [evalSets, setEvalSets] = useState<SkillEvalSet[]>([]);
  const [evalSetId, setEvalSetId] = useState<string>("");
  const [evalRepeat, setEvalRepeat] = useState(1);
  const [evalRunning, setEvalRunning] = useState(false);
  const [lastEvaluation, setLastEvaluation] = useState<{ entryId: string; detail: SkillEvaluationDetail; metrics: { score: number | null; activationRate: number | null } } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SkillStatus>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // P1-B：采纳确认（信任门 + 冲突展示）。一个弹窗串联：先查冲突 → 展示提示 → 必要时勾确认 → PATCH active。
  const [adoptTarget, setAdoptTarget] = useState<SkillRegistryEntry | null>(null);
  const [adoptConflicts, setAdoptConflicts] = useState<SkillRegistryConflict[]>([]);
  const [adoptConflictsLoading, setAdoptConflictsLoading] = useState(false);
  const [adoptConflictsError, setAdoptConflictsError] = useState("");
  const [adoptConfirmed, setAdoptConfirmed] = useState(false);
  const [adoptSubmitting, setAdoptSubmitting] = useState(false);
  // P1-B：弹窗内独立 error（与主面板 error 解耦，错误不会隐藏在用户视线外）。
  const [adoptError, setAdoptError] = useState("");
  // P1-B：用 ref 跟踪当前 adopt 请求 token，防止用户连续切换 entry 时旧请求结果污染新弹窗。
  const adoptRequestTokenRef = useRef(0);
  // P1-B：新建/版本更新 modal 的冲突展示（不阻断；用户手动触发或在 submit 前自动调）
  const [createConflicts, setCreateConflicts] = useState<SkillRegistryConflict[]>([]);
  const [createConflictsLoading, setCreateConflictsLoading] = useState(false);
  // B 卡：手动一键自动沉淀（替代定时）。autoDistilling=进行中；autoDistillMsg=本次结果摘要横幅。
  // autoLimit=一次处理 session 数（1/3/5，顺序跑）；autoModel=蒸馏模型（""=继承 pi 默认）。
  const [autoDistilling, setAutoDistilling] = useState(false);
  const [autoDistillMsg, setAutoDistillMsg] = useState("");
  const [autoLimit, setAutoLimit] = useState<number>(3);
  const [autoModel, setAutoModel] = useState<string>("");
  const [gapResult, setGapResult] = useState<SkillCoverageGapResult | null>(null);
  const [gapScanning, setGapScanning] = useState(false);
  const [gapDistillingId, setGapDistillingId] = useState<string | null>(null);
  const [gapMsg, setGapMsg] = useState("");
  // 只读查看 SKILL.md 内容（点名称/「查看」按钮触发，读版本快照）。
  const [viewing, setViewing] = useState<SkillRegistryEntry | null>(null);
  const [viewContent, setViewContent] = useState("");
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");
  // 方式2：编辑弹窗内 AI 改写。
  const [aiRevising, setAiRevising] = useState(false);
  const [aiError, setAiError] = useState("");

  // 缺口2-D：skill 跨工作区导出/导入。导出直接走浏览器下载，导入 = 弹窗（file input + JSON 粘贴二选一）→
  // 调后端 import → 写盘 + 建 imported candidate → 刷新列表，新 candidate 进漏斗走人审门。
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);

  // G 卡：可观测面板（消费 A 生产激活/C 回归历史 + 评测 token 算 ROI）。
  // dashboardOpen=可视区折叠态；evaluations=最近评测列表（计算 ROI/baseline 对比）；
  // history=回归/漂移时间线条目；historySlug=时间线筛选（null=全 workspace）。
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [evaluations, setEvaluations] = useState<SkillEvaluation[]>([]);
  const [history, setHistory] = useState<SkillRegistryEvalHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySlug, setHistorySlug] = useState<string | null>(null);
  const [retesting, setRetesting] = useState(false);
  const [retestMsg, setRetestMsg] = useState("");

  // SkillOpt: 被拒编辑列表
  const [rejectedEdits, setRejectedEdits] = useState<Array<{ id: string; slug: string; reason: string; createdAt: number }>>([]);
  const [showRejected, setShowRejected] = useState(false);
  const [rejectedLoading, setRejectedLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setEntries([]);
      setEnablements(new Map());
      setEvaluations([]);
      setHistory([]);
      return;
    }
    setLoading(true);
    setHistoryLoading(true);
    setError("");
    try {
      const [list, enab, sets, evalList, hist] = await Promise.all([
        api.listSkillRegistry(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId, "skill"),
        api.listSkillEvalSets(workspaceId),
        api.listSkillEvaluations(workspaceId),
        api.listSkillEvalHistory(workspaceId, { limit: 200 }),
      ]);
      setEntries(list);
      setEnablements(new Map(enab.map((e) => [e.itemId, e.enabled])));
      setEvalSets(sets);
      setEvaluations(evalList);
      setHistory(hist.items);
      setPage(0);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, [workspaceId]);

  const loadRejectedEdits = useCallback(async () => {
    if (!workspaceId) return;
    setRejectedLoading(true);
    try {
      const edits = await api.listRejectedEdits(workspaceId);
      setRejectedEdits(edits.map((e) => ({ id: e.id, slug: e.slug, reason: e.reason, createdAt: e.createdAt })));
    } catch {
      // non-critical
    } finally {
      setRejectedLoading(false);
    }
  }, [workspaceId]);

  // B 卡：手动一键触发后台蒸馏 sweep。端点默认扫近 7 天完成 session、产 distilled candidate（守人审门），
  // 跑完刷新列表，新候选自动出现在「候选」漏斗。会真实调用 LLM 蒸馏，故由用户显式点击触发。
  const runAutoDistill = useCallback(async () => {
    if (!workspaceId || autoDistilling) return;
    setAutoDistilling(true);
    setError("");
    setAutoDistillMsg("");
    try {
      const res: SkillAutoDistillResult = await api.runSkillAutoDistill(workspaceId, {
        limit: autoLimit,
        model: autoModel || undefined,
      });
      const createdNames = res.results.filter((r) => r.status === "created").map((r) => r.slug ?? r.name).filter(Boolean);
      const tail = createdNames.length ? `：${createdNames.join("、")}` : "";
      setAutoDistillMsg(`自动沉淀完成：扫描 ${res.scanned} · 新增候选 ${res.created} · 跳过 ${res.skipped} · 失败 ${res.failed}${tail}`);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setAutoDistilling(false);
    }
  }, [workspaceId, autoDistilling, autoLimit, autoModel, refresh]);

  const scanCoverageGaps = useCallback(async () => {
    if (!workspaceId || gapScanning) return;
    setGapScanning(true);
    setError("");
    setGapMsg("");
    try {
      const res = await api.analyzeSkillCoverageGaps(workspaceId, {
        limit: 20,
        lowScoreThreshold: 1.0,
        minClusterSize: 2,
      });
      setGapResult(res);
      setGapMsg(`覆盖缺口扫描完成：扫描 ${res.scanned} 个任务 · 发现 ${res.clusters.length} 个聚类`);
    } catch (err) {
      setError(String(err));
    } finally {
      setGapScanning(false);
    }
  }, [workspaceId, gapScanning]);

  // G 卡：手动重测全部 active skill（C 后端连续评测的前端入口）。
  // 二次确认：弹 confirm 显示 active 数量与成本提示（每个 skill = 一次 LLM 评测）。
  // 端点强依赖 model+tasks，前端复用首个 evalSet 的 tasks 与当前选中 model；
  // 缺评测集时降级到 DEFAULT_EVAL_TASK，与「送评测」单条评测同款。
  const retestAllActive = useCallback(
    async (triggerKind: "retest_all_active" | "model_upgrade" = "retest_all_active") => {
      if (!workspaceId || retesting) return;
      const activeEntries = entries.filter((e) => e.status === "active");
      if (activeEntries.length === 0) {
        setRetestMsg("当前工作区无 active skill，无需重测。");
        return;
      }
      const set = evalSets[0];
      const tasks = set && set.tasks.length > 0 ? set.tasks : [DEFAULT_EVAL_TASK];
      const taskCount = tasks.length;
      const cost = activeEntries.length * taskCount;
      const triggerLabel = triggerKind === "model_upgrade" ? "模型升级重测" : "全量重测";
      const ok = window.confirm(
        `确认${triggerLabel}？\n\n` +
        `· 将对 ${activeEntries.length} 个 active skill 各跑一次评测\n` +
        `· 每次评测 = ${taskCount} 个任务 × baseline+variant 两侧调用\n` +
        `· 预计 ${cost} 次 LLM 调用（模型：${model}）\n` +
        `· 评测集：${set ? set.name : "默认内置任务"}\n\n` +
        `跑完后回归状态会自动回写到表格徽章。`,
      );
      if (!ok) return;
      setRetesting(true);
      setError("");
      setRetestMsg("");
      try {
        const res: SkillRegistryRetestActiveResult = await api.retestActiveSkills(workspaceId, {
          model,
          tasks,
          repeat: 1,
          judgeRepeat: 1,
          contextPrefix: set ? `Eval set: ${set.name}` : "Inline default task",
          triggerKind,
        });
        const failedNames = res.results
          .filter((r) => r.status === "failed")
          .map((r) => r.slug)
          .slice(0, 3)
          .join("、");
        const tail = failedNames ? `（失败示例：${failedNames}${res.failed > 3 ? " 等" : ""}）` : "";
        setRetestMsg(
          `${triggerLabel}完成：扫描 ${res.scanned} · 成功 ${res.succeeded} · 失败 ${res.failed}${tail}`,
        );
        await refresh();
      } catch (err) {
        setError(String(err));
      } finally {
        setRetesting(false);
      }
    },
    [workspaceId, retesting, entries, evalSets, model, refresh],
  );

  const distillCoverageGap = useCallback(async (cluster: SkillCoverageGapCluster) => {
    if (!workspaceId || gapDistillingId) return;
    setGapDistillingId(cluster.id);
    setError("");
    setGapMsg("");
    try {
      const res = await api.distillSkillCoverageGap(workspaceId, {
        cluster,
        model: autoModel || undefined,
      });
      if (res.result.status === "created") {
        setGapMsg(`缺口蒸馏完成：新增候选 ${res.result.slug}`);
        await refresh();
      } else if (res.result.status === "skipped") {
        setGapMsg(`缺口蒸馏跳过：${res.result.reason}`);
      } else if (res.result.status === "dry_run") {
        setGapMsg(`缺口蒸馏预演：${res.result.slug}`);
      } else {
        setError(`缺口蒸馏失败：${res.result.error}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setGapDistillingId(null);
    }
  }, [workspaceId, gapDistillingId, autoModel, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (evalSets.length === 0) return;
    setEvalSetId((prev) => (evalSets.some((s) => s.id === prev) ? prev : (evalSets[0]?.id ?? "")));
  }, [evalSets]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return entries;
    return entries.filter((e) => e.status === statusFilter);
  }, [entries, statusFilter]);

  // P1-a：每 slug 的最高版本号，用于判定"旧版本行"→ 显示回滚。
  const latestVersionBySlug = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.slug, Math.max(m.get(e.slug) ?? 0, e.version));
    return m;
  }, [entries]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const funnelCounts = useMemo(() => {
    const counts: Record<SkillStatus, number> = { draft: 0, candidate: 0, active: 0, archived: 0 };
    for (const e of entries) counts[e.status]++;
    return counts;
  }, [entries]);

  // G 卡 · KPI 仪表盘（来源：A 生产激活字段 + 评测 token 算 ROI + C 回归字段）。
  // - 生产激活率：所有 active skill 的 prodActivated/prodInjected 加权平均（注入为 0 的 skill 被忽略）。
  // - ROI：基于 active skill 最近一次 evaluation，比较 baseline avgTotalTokens vs variant avgTotalTokens。
  //   savedTokens<0 = 注入 skill 反而花了更多 token；汇总值是 active skill 总和。
  // - 回归 active 数：当前 regressionStatus=regression 的 active skill 个数。
  const evalById = useMemo(() => {
    const m = new Map<string, SkillEvaluation>();
    for (const ev of evaluations) m.set(ev.evaluationId, ev);
    return m;
  }, [evaluations]);

  const dashboard = useMemo(() => {
    const activeEntries = entries.filter((e) => e.status === "active");
    let prodInjected = 0;
    let prodActivated = 0;
    let coveredCount = 0;
    let evalCovered = 0;
    let savedTokensTotal = 0;
    let baselineTokensTotal = 0;
    let variantTokensTotal = 0;
    let regressionCount = 0;
    for (const entry of activeEntries) {
      prodInjected += entry.prodInjectedCount;
      prodActivated += entry.prodActivatedCount;
      if (entry.prodInjectedCount > 0) coveredCount++;
      if (entry.regressionStatus === "regression") regressionCount++;
      const evalDoc = entry.lastEvaluationId ? evalById.get(entry.lastEvaluationId) : null;
      if (!evalDoc) continue;
      const baseline = evalDoc.variantSummaries.find((v) => v.variantId === "baseline");
      const variant = evalDoc.variantSummaries.find((v) => v.variantId === entry.id);
      if (!baseline || !variant) continue;
      evalCovered++;
      baselineTokensTotal += baseline.avgTotalTokens;
      variantTokensTotal += variant.avgTotalTokens;
      savedTokensTotal += baseline.avgTotalTokens - variant.avgTotalTokens;
    }
    const prodActivationRate = prodInjected > 0 ? prodActivated / prodInjected : null;
    const tokenSavingPct = baselineTokensTotal > 0
      ? (baselineTokensTotal - variantTokensTotal) / baselineTokensTotal
      : null;
    return {
      activeCount: activeEntries.length,
      prodInjected,
      prodActivated,
      prodActivationRate,
      coveredCount,
      evalCovered,
      savedTokensTotal,
      baselineTokensTotal,
      variantTokensTotal,
      tokenSavingPct,
      regressionCount,
    };
  }, [entries, evalById]);

  // G 卡 · 时间线数据（按 historySlug 过滤）。无筛选时取最近 30 条全 workspace 历史。
  const filteredHistory = useMemo(() => {
    const list = historySlug ? history.filter((h) => h.slug === historySlug) : history;
    return list.slice(0, 30);
  }, [history, historySlug]);

  // 当前回归中的 active slug 集合（顶部"查看"快捷跳转用）。
  const regressionSlugs = useMemo(() => {
    return entries.filter((e) => e.status === "active" && e.regressionStatus === "regression").map((e) => e.slug);
  }, [entries]);


  // 自动沉淀模型下拉：按 provider 分组（与 ChatPane ModelSelect 一致）。
  const modelGroups = useMemo(() => {
    return models.reduce<Record<string, PiModel[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {});
  }, [models]);

  const beginCreate = () => {
    setEditing(null);
    setDraft(DEFAULT_DRAFT);
    setCreateConflicts([]);
    setCreating(true);
  };

  // 版本更新：载入当前 SKILL.md 原文供编辑（而非空白模板）；无快照的老条目回退到模板。
  const beginUpdate = async (entry: SkillRegistryEntry) => {
    const fallback = [
      "---",
      "name: " + entry.name,
      "description: <change description here>",
      "---",
      "",
      "# " + entry.name + " v" + String(entry.version + 1),
      "",
    ].join("\n");
    setEditing(entry);
    setAiError("");
    setDraft({
      slug: entry.slug,
      name: entry.name,
      source: entry.source,
      status: "candidate",
      reason: "",
      content: "（正在载入当前 SKILL.md 原文…）",
      supersedesId: entry.id,
      baseVersion: entry.version,
    });
    setCreateConflicts([]);
    setCreating(true);
    try {
      const res = await api.getSkillVersionContent(entry.id);
      // 仅当用户仍停留在同一条目的更新弹窗时回填，避免连续切换时旧请求污染。
      setDraft((d) => (d.supersedesId === entry.id ? { ...d, content: res.content } : d));
    } catch {
      setDraft((d) => (d.supersedesId === entry.id ? { ...d, content: fallback } : d));
    }
  };

  const cancelEdit = () => {
    setCreating(false);
    setEditing(null);
    setDraft(DEFAULT_DRAFT);
    setCreateConflicts([]);
  };

  const submit = async () => {
    if (!workspaceId) return;
    const slug = draft.slug.trim();
    const name = draft.name.trim();
    const content = draft.content.trim();
    if (!slug || !name || !content) {
      setError("slug / name / content 必填");
      return;
    }
    // P1-B：新建路径下若工作区已有同 slug，二次确认（后端会作为新版本覆盖 SKILL.md）。
    // 同 slug 包含 archived：archived 条目对应的 SKILL.md 仍在磁盘，新建会写覆盖，需明确告知。
    if (!editing) {
      const dup = entries.find((e) => e.slug === slug);
      if (dup) {
        const isArchived = dup.status === "archived";
        const msg = isArchived
          ? `已归档的「${dup.name}」v${dup.version} 占用同 slug，继续将覆盖其 SKILL.md 文件并创建 v${dup.version + 1}（旧快照保留可回滚）。确认？`
          : `「${dup.name}」v${dup.version} 已存在，继续将创建 v${dup.version + 1} 并覆盖 SKILL.md（旧版可回滚）。确认？`;
        if (!window.confirm(msg)) return;
      }
    }
    setSubmitting(true);
    setError("");
    try {
      const reasonNote = draft.reason.trim();
      const nextVersion = editing ? draft.baseVersion + 1 : 1;
      const finalContent = reasonNote
        ? content + "\n\n<!-- 变更原因 (v" + String(nextVersion) + "): " + reasonNote.replace(/-->/g, "-- >") + " -->\n"
        : content;
      const body: Parameters<typeof api.createSkillRegistry>[1] = {
        slug,
        name,
        source: draft.source,
        status: draft.status,
        content: finalContent,
        supersedesId: draft.supersedesId,
      };
      if (editing) body.version = nextVersion;
      await api.createSkillRegistry(workspaceId, body);
      cancelEdit();
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // P1-B：从 modal 触发的冲突检测（基于当前 draft 内容）。
  const checkCreateConflicts = useCallback(async () => {
    if (!workspaceId) return;
    const content = draft.content.trim();
    if (!content) return;
    setCreateConflictsLoading(true);
    try {
      const res = await api.listSkillConflicts(workspaceId, { content });
      // 编辑场景下排除自身
      const filtered = editing ? res.conflicts.filter((c) => c.itemId !== editing.id) : res.conflicts;
      setCreateConflicts(filtered);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateConflictsLoading(false);
    }
  }, [workspaceId, draft.content, editing]);

  // P1-B：采纳流程入口——打开弹窗，预查冲突；distilled/curated 需勾选信任确认才提交。
  // race 防护：每次打开递增 token，回调先校验 token 与当前 ref 是否一致，避免旧请求覆盖新弹窗。
  const beginAdopt = (entry: SkillRegistryEntry) => {
    if (!workspaceId) return;
    const token = adoptRequestTokenRef.current + 1;
    adoptRequestTokenRef.current = token;
    setAdoptTarget(entry);
    setAdoptConflicts([]);
    setAdoptConflictsError("");
    setAdoptConfirmed(false);
    setAdoptError("");
    setAdoptConflictsLoading(true);
    void api
      .listSkillConflicts(workspaceId, { slug: entry.slug })
      .then((res) => {
        if (adoptRequestTokenRef.current !== token) return;
        setAdoptConflicts(res.conflicts.filter((c) => c.itemId !== entry.id));
      })
      .catch((err) => {
        if (adoptRequestTokenRef.current !== token) return;
        setAdoptConflictsError(String(err));
      })
      .finally(() => {
        if (adoptRequestTokenRef.current !== token) return;
        setAdoptConflictsLoading(false);
      });
  };

  const cancelAdopt = () => {
    // 关闭即作废所有 in-flight 请求（递增 token 让回调全部短路）。
    adoptRequestTokenRef.current += 1;
    setAdoptTarget(null);
    setAdoptConflicts([]);
    setAdoptConflictsError("");
    setAdoptConfirmed(false);
    setAdoptSubmitting(false);
    setAdoptError("");
    setAdoptConflictsLoading(false);
  };

  const confirmAdopt = async () => {
    if (!adoptTarget) return;
    const requiresConfirm = adoptTarget.source === "distilled" || adoptTarget.source === "curated";
    if (requiresConfirm && !adoptConfirmed) {
      // 弹窗内显式 error，避免用户看不见提示（主面板 error 在弹窗下方被遮住）。
      setAdoptError("请先勾选「我已审阅 SKILL.md」再采纳蒸馏/策展产物。");
      return;
    }
    setAdoptSubmitting(true);
    setAdoptError("");
    try {
      // 信任门：仅 distilled/curated 来源传 confirmed=true（与 A 端 hasConfirmedReview 校验对齐）；
      // 其他来源不带该字段，避免在未弹确认框时虚构"已审阅"语义。
      const patch: Parameters<typeof api.patchSkillRegistry>[1] = { status: "active" };
      if (requiresConfirm) patch.confirmed = true;
      await api.patchSkillRegistry(adoptTarget.id, patch);
      cancelAdopt();
      await refresh();
    } catch (err) {
      setAdoptError(String(err));
    } finally {
      setAdoptSubmitting(false);
    }
  };

  const archive = async (entry: SkillRegistryEntry) => {
    if (!window.confirm("归档 skill「" + entry.name + "」？SKILL.md 文件保留可回滚，工作区将停用。")) return;
    setBusyId(entry.id);
    try {
      await api.archiveSkillRegistry(entry.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  };

  // 缺口2-D 导出：拉单 JSON 包（含 SKILL.md + 子资源全文）→ 触发浏览器下载为 <slug>.json。
  // 不走 LLM，纯文件搬运，故无需进度态；归档条目后端 400 → 前端按 error 提示即可。
  const exportSkill = async (entry: SkillRegistryEntry) => {
    setBusyId(entry.id);
    setError("");
    try {
      const pkg = await api.exportSkill(entry.id);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entry.slug}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`导出失败：${String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const openImport = () => {
    setImporting(true);
    setImportText("");
    setImportError("");
    setImportNotice("");
  };

  const closeImport = () => {
    if (importSubmitting) return;
    setImporting(false);
    setImportText("");
    setImportError("");
  };

  // 文件 input → 读文本 → 回填 textarea，让用户在提交前可见可改。
  const pickImportFile = (file: File | null | undefined) => {
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setImportText(text);
    };
    reader.onerror = () => setImportError("读取文件失败：" + String(reader.error ?? ""));
    reader.readAsText(file);
  };

  // 提交导入：本地仅做 JSON.parse 防呆，包结构合法性以及路径穿越拦截全部由后端兜底。
  // requestedSlug !== entry.slug 时给"已改名为 X"提示（slug 冲突自动改名）。
  const submitImport = async () => {
    if (!workspaceId || importSubmitting) return;
    if (!importText.trim()) {
      setImportError("请粘贴 JSON 或选择 .json 文件");
      return;
    }
    let pkg: unknown;
    try {
      pkg = JSON.parse(importText);
    } catch (err) {
      setImportError("JSON 解析失败：" + String(err));
      return;
    }
    setImportSubmitting(true);
    setImportError("");
    try {
      const res = await api.importSkill(workspaceId, pkg as Parameters<typeof api.importSkill>[1]);
      const renamed = res.requestedSlug && res.requestedSlug !== res.entry.slug
        ? `（slug「${res.requestedSlug}」已被占用，已改名为「${res.entry.slug}」）`
        : "";
      setImportNotice(`导入成功：${res.entry.name} v${res.entry.version}（候选）${renamed}`);
      setImporting(false);
      setImportText("");
      await refresh();
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImportSubmitting(false);
    }
  };

  const rollback = async (entry: SkillRegistryEntry) => {
    if (!window.confirm("回滚到「" + entry.name + "」v" + String(entry.version) + "？将以该版本内容创建新版本并写回 SKILL.md（旧版本保留）。")) return;
    setBusyId(entry.id);
    setError("");
    try {
      await api.rollbackSkillRegistry(entry.id);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  };

  // 只读查看：拉该版本快照内容展示（内容真源是 SKILL.md，快照随 create/rollback 写入）。
  const openView = async (entry: SkillRegistryEntry) => {
    setViewing(entry);
    setViewContent("");
    setViewError("");
    setViewLoading(true);
    try {
      const res = await api.getSkillVersionContent(entry.id);
      setViewContent(res.content);
    } catch (err) {
      setViewError(`无法读取内容：${String(err)}（该版本可能无快照）`);
    } finally {
      setViewLoading(false);
    }
  };

  // 方式2：AI 改写——把编辑框当前内容 + 修改说明交给 LLM，回填结果到 draft.content（用户可再手改）。
  const aiRevise = async (instruction: string, model: string) => {
    if (!workspaceId || !instruction || !draft.content.trim() || aiRevising) return;
    setAiRevising(true);
    setAiError("");
    try {
      const res = await api.reviseSkill(workspaceId, { content: draft.content, instruction, model: model || undefined });
      setDraft((d) => ({ ...d, content: res.content }));
    } catch (err) {
      setAiError(String(err));
    } finally {
      setAiRevising(false);
    }
  };

  const toggleEnabled = async (entry: SkillRegistryEntry) => {
    if (!workspaceId) return;
    const current = enablements.get(entry.id) ?? false;
    const next = !current;
    try {
      await sharedApi.setMemoryEnablement(workspaceId, "skill", entry.id, next);
      setEnablements((prev) => {
        const m = new Map(prev);
        m.set(entry.id, next);
        return m;
      });
    } catch (err) {
      setError(String(err));
    }
  };

  const beginEval = (entry: SkillRegistryEntry) => {
    setEvalTarget(entry);
    if (!evalSetId && evalSets[0]) setEvalSetId(evalSets[0].id);
    setLastEvaluation(null);
  };

  const closeEval = () => {
    setEvalTarget(null);
    setLastEvaluation(null);
  };

  const runEval = async () => {
    if (!evalTarget) return;
    const set = evalSets.find((s) => s.id === evalSetId);
    const tasks = set && set.tasks.length > 0 ? set.tasks : [DEFAULT_EVAL_TASK];
    setEvalRunning(true);
    setError("");
    try {
      const res = await api.evaluateSkillRegistry(evalTarget.id, {
        model,
        repeat: evalRepeat,
        tasks,
        contextPrefix: set ? "Eval set: " + set.name : "Inline default task",
      });
      setLastEvaluation({ entryId: evalTarget.id, detail: res.evaluation, metrics: res.metrics });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setEvalRunning(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-neutral-400">
        请先在右侧选择一个工作区，再管理项目级 skill。
      </div>
    );
  }

  const emptyHint = loading ? "加载中..." : "当前工作区暂无 skill。点击上方「新建 skill」创建一条。";

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">skill 管理</h2>
          <span className="text-[11px] text-neutral-400">项目池 · 全局编辑 · 按工作区启用</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="刷新"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
            刷新
          </button>
          <div className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 pl-1.5 dark:border-amber-800 dark:bg-amber-950/40">
            <select
              value={autoLimit}
              onChange={(e) => setAutoLimit(Number(e.target.value))}
              disabled={autoDistilling}
              title="一次最多处理几个 session（顺序蒸馏，每个 = 一次 LLM 调用）"
              className="h-7 rounded bg-transparent px-1 text-[11.5px] text-amber-700 outline-none disabled:opacity-50 dark:text-amber-300"
            >
              {AUTO_DISTILL_LIMITS.map((n) => (
                <option key={n} value={n}>{n} 个</option>
              ))}
            </select>
            <select
              value={autoModel}
              onChange={(e) => setAutoModel(e.target.value)}
              disabled={autoDistilling}
              title="蒸馏用模型（默认继承 pi 配置）"
              className="h-7 max-w-[150px] rounded bg-transparent px-1 text-[11.5px] text-amber-700 outline-none disabled:opacity-50 dark:text-amber-300"
            >
              <option value="">默认模型</option>
              {Object.entries(modelGroups).map(([provider, items]) => (
                <optgroup key={provider} label={provider}>
                  {items.map((m) => (
                    <option key={m.id} value={m.id}>{m.model}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runAutoDistill()}
              disabled={!workspaceId || autoDistilling}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/70"
              title="扫描近 7 天完成的任务，自动蒸馏为候选 skill（守人审门，需评测+采纳才生效）。会真实调用 LLM。"
            >
              <Wand2 className={cn("h-3.5 w-3.5", autoDistilling && "animate-pulse")} strokeWidth={1.75} />
              {autoDistilling ? "沉淀中…" : "自动沉淀"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void retestAllActive("retest_all_active")}
            disabled={!workspaceId || retesting || dashboard.activeCount === 0}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 text-[11.5px] text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
            title={`对所有 active skill 跑一次评测，比对历史基线检测回归。会真实调用 LLM（每个 active skill 一次评测，预计 ${dashboard.activeCount} × N 次模型调用）。点击后弹确认框。`}
          >
            <Activity className={cn("h-3.5 w-3.5", retesting && "animate-pulse")} strokeWidth={1.75} />
            {retesting ? "重测中…" : `重测 active (${dashboard.activeCount})`}
          </button>
          <button
            type="button"
            onClick={() => void scanCoverageGaps()}
            disabled={!workspaceId || gapScanning}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="扫描近期任务，找出现有 skill 无高分命中的覆盖缺口"
          >
            <Search className={cn("h-3.5 w-3.5", gapScanning && "animate-pulse")} strokeWidth={1.75} />
            {gapScanning ? "扫描中…" : "覆盖缺口"}
          </button>
          <button
            type="button"
            onClick={openImport}
            disabled={!workspaceId}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="导入 skill 包（JSON）→ 写入工作区并建为候选，需走查看/评测/采纳人审门"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
            导入
          </button>
          <button
            type="button"
            onClick={() => { void loadRejectedEdits(); setShowRejected(true); }}
            disabled={!workspaceId}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="查看被严格门拒绝的 skill 编辑记录"
          >
            <History className="h-3.5 w-3.5" strokeWidth={1.75} />
            被拒编辑
          </button>
          <button
            type="button"
            onClick={beginCreate}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-800 px-2.5 text-[11.5px] text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            新建 skill
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {FUNNEL_STAGES.map((stage) => {
          const count = funnelCounts[stage.status];
          const isActive = statusFilter === stage.status;
          return (
            <button
              key={stage.status}
              type="button"
              onClick={() => setStatusFilter(isActive ? "all" : stage.status)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                isActive
                  ? "border-neutral-700 bg-neutral-50 dark:border-neutral-300 dark:bg-neutral-900"
                  : "border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800",
              )}
              title={stage.hint + "（点击切换筛选）"}
            >
              <span className="flex items-baseline gap-1.5">
                <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10.5px]", STATUS_TONE[stage.status])}>
                  {stage.label}
                </span>
                <span className="text-base font-semibold text-neutral-800 dark:text-neutral-100">{count}</span>
              </span>
              <span className="text-[10.5px] text-neutral-400">{stage.hint}</span>
            </button>
          );
        })}
      </div>

      {/* G 卡：可观测面板（A 生产激活/ROI/C 回归 + 时间线）。点标题折叠。 */}
      <div ref={dashboardRef}>
        <ObservabilityDashboard
          open={dashboardOpen}
          onToggle={() => setDashboardOpen((v) => !v)}
          dashboard={dashboard}
          regressionSlugs={regressionSlugs}
          history={filteredHistory}
          historyTotal={history.length}
          historyLoading={historyLoading}
          historySlug={historySlug}
          onClearHistorySlug={() => setHistorySlug(null)}
          onPickSlug={(slug) => setHistorySlug(slug)}
        />
      </div>

      {retestMsg && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{retestMsg}</span>
          <button type="button" onClick={() => setRetestMsg("")} className="shrink-0 text-rose-500 hover:text-rose-700 dark:hover:text-rose-200">✕</button>
        </div>
      )}

      {statusFilter !== "all" && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <span>当前筛选：{STATUS_LABEL[statusFilter]}</span>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className="rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            清除
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11.5px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {autoDistillMsg && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span>{autoDistillMsg}</span>
          <button type="button" onClick={() => setAutoDistillMsg("")} className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-200">✕</button>
        </div>
      )}

      {importNotice && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11.5px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span>{importNotice}</span>
          <button type="button" onClick={() => setImportNotice("")} className="shrink-0 text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-200">✕</button>
        </div>
      )}

      {gapMsg && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-[11.5px] text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          <span>{gapMsg}</span>
          <button type="button" onClick={() => setGapMsg("")} className="shrink-0 text-sky-500 hover:text-sky-700 dark:hover:text-sky-200">✕</button>
        </div>
      )}

      {gapResult && (
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" strokeWidth={1.75} />
              <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-100">覆盖缺口建议</span>
              <span className="text-[10.5px] text-neutral-400">扫描 {gapResult.scanned} · 阈值 {gapResult.lowScoreThreshold.toFixed(1)} · 最小聚类 {gapResult.minClusterSize}</span>
            </div>
            <button
              type="button"
              onClick={() => setGapResult(null)}
              className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              title="收起覆盖缺口建议"
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
              收起
            </button>
          </div>
          {gapResult.clusters.length === 0 ? (
            <div className="py-2 text-[11px] text-neutral-400">暂无满足阈值的覆盖缺口聚类。</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {gapResult.clusters.map((cluster) => (
                <div key={cluster.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100" title={cluster.title}>
                        {cluster.title}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-neutral-400">
                        {cluster.taskCount} 个任务 · 平均最高分 {cluster.avgTopScore.toFixed(2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void distillCoverageGap(cluster)}
                      disabled={!!gapDistillingId}
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-sky-300 px-1.5 text-[10.5px] text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40"
                      title="把该覆盖缺口交给现有 B 蒸馏链路，生成 distilled candidate"
                    >
                      <Wand2 className={cn("h-3 w-3", gapDistillingId === cluster.id && "animate-pulse")} strokeWidth={1.75} />
                      {gapDistillingId === cluster.id ? "蒸馏中…" : "蒸馏"}
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cluster.keywords.slice(0, 5).map((keyword) => (
                      <span key={keyword} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1">
                    {cluster.tasks.slice(0, 3).map((task) => (
                      <div key={task.id} className="truncate text-[10.5px] text-neutral-500 dark:text-neutral-400" title={task.text}>
                        {task.title}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-[11.5px]">
          <thead className="sticky top-0 bg-neutral-50 text-[10.5px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              <th className="w-10 px-2 py-2">启用</th>
              <th className="px-2 py-2">名称 / slug</th>
              <th className="px-2 py-2">版本</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2">来源</th>
              <th className="px-2 py-2">评测分</th>
              <th className="px-2 py-2">激活率</th>
              <th className="px-2 py-2">回归</th>
              <th className="px-2 py-2">使用</th>
              <th className="px-2 py-2">出处 / 更新</th>
              <th className="w-44 px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-[11px] text-neutral-400">
                  {emptyHint}
                </td>
              </tr>
            )}
            {paged.map((entry) => {
              const enabled = enablements.get(entry.id) ?? false;
              const low = isLowPerforming(entry);
              const isArchived = entry.status === "archived";
              const isRegression = entry.regressionStatus === "regression";
              const sessionShort = entry.originSessionId ? "session " + entry.originSessionId.slice(0, 8) : "—";
              const versionTitle = "版本更新（v" + String(entry.version) + " → v" + String(entry.version + 1) + "）";
              return (
                <tr
                  key={entry.id}
                  className={cn(
                    "border-t border-neutral-100 dark:border-neutral-800",
                    low && "bg-amber-50/60 dark:bg-amber-950/20",
                    isRegression && "bg-rose-50/60 dark:bg-rose-950/20",
                    isArchived && "opacity-60",
                  )}
                >
                  <td className="px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={isArchived}
                      onChange={() => void toggleEnabled(entry)}
                      title={isArchived ? "归档 skill 不可启用" : enabled ? "本工作区已启用" : "启用到本工作区"}
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => void openView(entry)}
                        className="text-left font-medium text-neutral-800 hover:text-amber-600 hover:underline dark:text-neutral-100 dark:hover:text-amber-400"
                        title="查看 SKILL.md 内容"
                      >
                        {entry.name}
                      </button>
                      <span className="font-mono text-[10.5px] text-neutral-400">{entry.slug}</span>
                      {low && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                          建议归档（评测分或激活率偏低）
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top text-neutral-600 dark:text-neutral-300">v{entry.version}</td>
                  <td className="px-2 py-2 align-top">
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10.5px]", STATUS_TONE[entry.status])}>
                      {STATUS_LABEL[entry.status]}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-top text-neutral-600 dark:text-neutral-300">{SOURCE_LABEL[entry.source]}</td>
                  <td className="px-2 py-2 align-top tabular-nums text-neutral-700 dark:text-neutral-200">{fmtScore(entry.score)}</td>
                  <td className="px-2 py-2 align-top tabular-nums text-neutral-700 dark:text-neutral-200">{fmtPct(entry.activationRate)}</td>
                  <td className="px-2 py-2 align-top">
                    {isRegression ? (
                      <button
                        type="button"
                        onClick={() => {
                          setHistorySlug(entry.slug);
                          setDashboardOpen(true);
                          dashboardRef.current?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10.5px] text-rose-700 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60"
                        title={[
                          entry.regressionReason ?? "",
                          entry.regressionScoreDelta !== null ? `Δ score ${entry.regressionScoreDelta.toFixed(3)}` : "",
                          entry.regressionActivationDelta !== null ? `Δ 激活 ${(entry.regressionActivationDelta * 100).toFixed(1)}pp` : "",
                          "点击查看时间线",
                        ].filter(Boolean).join(" · ")}
                      >
                        <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                        回归
                      </button>
                    ) : (
                      <span className="text-[10.5px] text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top tabular-nums text-neutral-700 dark:text-neutral-200">{entry.usageCount}</td>
                  <td className="px-2 py-2 align-top text-[10.5px] text-neutral-500">
                    <div className="flex flex-col gap-0.5">
                      <span title={entry.originSessionId ?? ""}>{sessionShort}</span>
                      <span>{fmtTime(entry.updatedAt)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void openView(entry)}
                        className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        title="查看 SKILL.md 内容（只读）"
                      >
                        <Eye className="h-3 w-3" strokeWidth={1.75} />
                        查看
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportSkill(entry)}
                        disabled={isArchived || busyId === entry.id}
                        className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        title="导出 skill 包（含 SKILL.md 与 references/scripts 等子资源）为 JSON 文件"
                      >
                        <Download className="h-3 w-3" strokeWidth={1.75} />
                        导出
                      </button>
                      <button
                        type="button"
                        onClick={() => beginEval(entry)}
                        disabled={isArchived || busyId === entry.id}
                        className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        title="送评测（baseline vs 本 skill）"
                      >
                        <FlaskConical className="h-3 w-3" strokeWidth={1.75} />
                        送评测
                      </button>
                      <button
                        type="button"
                        onClick={() => void beginUpdate(entry)}
                        disabled={busyId === entry.id}
                        className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        title={versionTitle}
                      >
                        <Pencil className="h-3 w-3" strokeWidth={1.75} />
                        新版本
                      </button>
                      {(entry.status === "candidate" || entry.status === "draft") && (
                        <button
                          type="button"
                          onClick={() => beginAdopt(entry)}
                          disabled={busyId === entry.id}
                          className="inline-flex h-6 items-center gap-1 rounded border border-emerald-300 px-1.5 text-[10.5px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                          title={
                            entry.source === "distilled" || entry.source === "curated"
                              ? "采纳到 active（蒸馏/策展产物需先确认 SKILL.md）"
                              : "采纳到 active"
                          }
                        >
                          <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
                          采纳
                        </button>
                      )}
                      {(entry.status === "candidate" || entry.status === "draft") && (
                        <button
                          type="button"
                          onClick={() => void archive(entry)}
                          disabled={busyId === entry.id}
                          className="inline-flex h-6 items-center gap-1 rounded border border-rose-300 px-1.5 text-[10.5px] text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          title="弃用：归档此 skill（保留 SKILL.md 可回滚）"
                        >
                          <Ban className="h-3 w-3" strokeWidth={1.75} />
                          弃用
                        </button>
                      )}
                      {entry.version < (latestVersionBySlug.get(entry.slug) ?? entry.version) && (
                        <button
                          type="button"
                          onClick={() => void rollback(entry)}
                          disabled={busyId === entry.id}
                          className="inline-flex h-6 items-center gap-1 rounded border border-amber-300 px-1.5 text-[10.5px] text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                          title="回滚：以本版本内容创建新版本写回 SKILL.md"
                        >
                          <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
                          回滚
                        </button>
                      )}
                      {!isArchived && (
                        <button
                          type="button"
                          onClick={() => void archive(entry)}
                          disabled={busyId === entry.id}
                          className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                          title="归档（保留 SKILL.md，可回滚）"
                        >
                          <Archive className="h-3 w-3" strokeWidth={1.75} />
                          归档
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[11px] text-neutral-500">
          <span>
            共 {filtered.length} 条，第 {page + 1}/{totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex h-6 items-center gap-0.5 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ChevronLeft className="h-3 w-3" strokeWidth={1.75} />
              上一页
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex h-6 items-center gap-0.5 rounded border border-neutral-200 px-1.5 text-[10.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              下一页
              <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}

      {creating && (
        <CreateSkillModal
          editing={editing ? { id: editing.id, name: editing.name, slug: editing.slug, source: editing.source, version: editing.version } : null}
          draft={draft}
          submitting={submitting}
          onDraftChange={setDraft}
          onSubmit={() => void submit()}
          onCancel={cancelEdit}
          conflicts={createConflicts}
          conflictsLoading={createConflictsLoading}
          onCheckConflicts={() => void checkCreateConflicts()}
          models={models}
          aiRevising={aiRevising}
          aiError={aiError}
          onAiRevise={(instruction, m) => void aiRevise(instruction, m)}
        />
      )}

      {evalTarget && (
        <EvalSkillModal
          evalTarget={evalTarget}
          evalSets={evalSets}
          evalSetId={evalSetId}
          evalRepeat={evalRepeat}
          evalRunning={evalRunning}
          lastEvaluation={lastEvaluation}
          onEvalSetIdChange={setEvalSetId}
          onEvalRepeatChange={setEvalRepeat}
          onRunEval={() => void runEval()}
          onClose={closeEval}
        />
      )}

      {adoptTarget && (
        <AdoptConfirmModal
          target={adoptTarget}
          conflicts={adoptConflicts}
          conflictsLoading={adoptConflictsLoading}
          conflictsError={adoptConflictsError}
          confirmed={adoptConfirmed}
          onConfirmedChange={setAdoptConfirmed}
          submitting={adoptSubmitting}
          adoptError={adoptError}
          onSubmit={() => void confirmAdopt()}
          onCancel={cancelAdopt}
        />
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setViewing(null)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{viewing.name}</span>
                <span className="font-mono text-[10.5px] text-neutral-400">{viewing.slug} · v{viewing.version} · {STATUS_LABEL[viewing.status]}</span>
              </div>
              <button type="button" onClick={() => setViewing(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title="关闭">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {viewLoading && <p className="text-[11.5px] text-neutral-400">加载中…</p>}
              {viewError && <p className="text-[11.5px] text-red-600 dark:text-red-400">{viewError}</p>}
              {!viewLoading && !viewError && (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-neutral-800 dark:text-neutral-200">{viewContent}</pre>
              )}
            </div>
            <div className="border-t border-neutral-200 px-4 py-2 text-right text-[10.5px] text-neutral-400 dark:border-neutral-800">
              只读预览 · 内容真源 = .pi/skills/{viewing.slug}/SKILL.md
            </div>
          </div>
        </div>
      )}

      {importing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={closeImport}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">导入 skill 包</span>
                <span className="text-[10.5px] text-neutral-400">
                  导入后将建为「候选」，需走查看/评测/采纳走完人审门
                </span>
              </div>
              <button
                type="button"
                onClick={closeImport}
                disabled={importSubmitting}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                title="关闭"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="flex items-center gap-2 text-[11.5px]">
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  disabled={importSubmitting}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                  选择 .json 文件
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    pickImportFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <span className="text-[10.5px] text-neutral-400">或在下方直接粘贴 JSON 文本</span>
              </div>

              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                disabled={importSubmitting}
                placeholder='{"format":"pi-xanthil.skill-package","formatVersion":1,"registry":{...},"files":[...]}'
                className="mt-3 h-72 w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
              />

              {importError && (
                <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11.5px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                  {importError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <button
                type="button"
                onClick={closeImport}
                disabled={importSubmitting}
                className="inline-flex h-7 items-center rounded-md border border-neutral-200 bg-white px-2.5 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitImport()}
                disabled={importSubmitting || !importText.trim()}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-800 px-2.5 text-[11.5px] text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                {importSubmitting ? "导入中…" : "导入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SkillOpt: 被拒编辑列表 */}
      {showRejected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowRejected(false)}>
          <div
            className="flex max-h-[70vh] w-[480px] flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">被拒编辑记录</span>
              <button
                type="button"
                onClick={() => setShowRejected(false)}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {rejectedLoading ? (
                <div className="text-center text-[11.5px] text-neutral-400">加载中...</div>
              ) : rejectedEdits.length === 0 ? (
                <div className="text-center text-[11.5px] text-neutral-400">暂无被拒编辑</div>
              ) : (
                <div className="space-y-2">
                  {rejectedEdits.map((edit) => (
                    <div key={edit.id} className="rounded-md border border-rose-200 bg-rose-50 p-2 dark:border-rose-800 dark:bg-rose-950/40">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-rose-700 dark:text-rose-300">{edit.slug}</span>
                        <span className="text-[10px] text-rose-400">{new Date(edit.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{edit.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setShowRejected(false)}
                className="inline-flex h-7 items-center rounded-md border border-neutral-200 bg-white px-2.5 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
