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
} from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { cn } from "@/lib/cn";
import type {
  SkillEvalSet,
  SkillEvaluationDetail,
  SkillRegistryConflict,
  SkillRegistryEntry,
  SkillSource,
  SkillStatus,
} from "@/types";
import { CreateSkillModal, type CreateDraft } from "@/components/CreateSkillModal";
import { EvalSkillModal } from "@/components/EvalSkillModal";
import { AdoptConfirmModal } from "@/components/AdoptConfirmModal";

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
}

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

export function SkillManagementPane({ workspaceId, model }: Props) {
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

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setEntries([]);
      setEnablements(new Map());
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [list, enab, sets] = await Promise.all([
        api.listSkillRegistry(workspaceId),
        sharedApi.listMemoryEnablements(workspaceId, "skill"),
        api.listSkillEvalSets(workspaceId),
      ]);
      setEntries(list);
      setEnablements(new Map(enab.map((e) => [e.itemId, e.enabled])));
      setEvalSets(sets);
      setPage(0);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

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

  const beginCreate = () => {
    setEditing(null);
    setDraft(DEFAULT_DRAFT);
    setCreateConflicts([]);
    setCreating(true);
  };

  const beginUpdate = (entry: SkillRegistryEntry) => {
    const nextVer = entry.version + 1;
    setEditing(entry);
    setDraft({
      slug: entry.slug,
      name: entry.name,
      source: entry.source,
      status: "candidate",
      reason: "",
      content: [
        "---",
        "name: " + entry.name,
        "description: <change description here>",
        "---",
        "",
        "# " + entry.name + " v" + String(nextVer),
        "",
        "变更原因：",
        "",
      ].join("\n"),
      supersedesId: entry.id,
      baseVersion: entry.version,
    });
    setCreateConflicts([]);
    setCreating(true);
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
              <th className="px-2 py-2">使用</th>
              <th className="px-2 py-2">出处 / 更新</th>
              <th className="w-44 px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-[11px] text-neutral-400">
                  {emptyHint}
                </td>
              </tr>
            )}
            {paged.map((entry) => {
              const enabled = enablements.get(entry.id) ?? false;
              const low = isLowPerforming(entry);
              const isArchived = entry.status === "archived";
              const sessionShort = entry.originSessionId ? "session " + entry.originSessionId.slice(0, 8) : "—";
              const versionTitle = "版本更新（v" + String(entry.version) + " → v" + String(entry.version + 1) + "）";
              return (
                <tr
                  key={entry.id}
                  className={cn(
                    "border-t border-neutral-100 dark:border-neutral-800",
                    low && "bg-amber-50/60 dark:bg-amber-950/20",
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
                      <span className="font-medium text-neutral-800 dark:text-neutral-100">{entry.name}</span>
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
                        onClick={() => beginUpdate(entry)}
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
    </div>
  );
}
