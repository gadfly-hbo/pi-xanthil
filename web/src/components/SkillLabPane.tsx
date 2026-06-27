import { useEffect, useMemo, useState } from "react";
import { Archive, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Download, FileDown, Loader2, Pencil, Play, Plus, Save, Search, Sparkles, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatEfc, formatEta } from "@/lib/efc";
import { downloadArchiveTextFile, downloadArchivesZip, downloadEvaluationArchiveManifest, downloadEvaluationJson, downloadSkillEvaluationMarkdown } from "@/lib/evaluation-export";
import { ArchiveList, EvalHistoryList, ExportActions, ResultCard as SharedResultCard, SummaryTable as SharedSummaryTable } from "@/components/eval-shared";
import { AheManifestPanel } from "@/components/AheManifestPanel";
import type { AutonomousRunResult, EvaluationArchiveIndexItem, EvaluationError, PiModel, PiSkill, RetrievedSkill, SkillCurationApplyResult, SkillCurationProposal, SkillCurationProposalRecord, SkillCurationProposalStatus, SkillCurationResult, SkillEvalSet, SkillEvalTask, SkillEvaluation, SkillEvaluationDetail, SkillEvaluationRunResult, SkillPairwiseSummary, SkillRegistryEntry, SkillVariant, SkillVariantSummary } from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
  onModelChange: (model: string) => void;
}

interface DraftTask {
  id: string;
  prompt: string;
}

interface RegistryCandidateOption {
  entry: SkillRegistryEntry;
  path: string | null;
}

let taskSeq = 2;
const nextTask = (): DraftTask => ({ id: `task_${taskSeq++}`, prompt: "" });

export function SkillLabPane(p: Props) {
  const [skills, setSkills] = useState<PiSkill[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [registryCandidates, setRegistryCandidates] = useState<SkillRegistryEntry[]>([]);
  const [selectedRegistryIds, setSelectedRegistryIds] = useState<string[]>([]);
  const [evaluatedRegistryIds, setEvaluatedRegistryIds] = useState<string[]>([]);
  const [registryActionBusyId, setRegistryActionBusyId] = useState<string | null>(null);
  const [registryActionNote, setRegistryActionNote] = useState("");
  const [tasks, setTasks] = useState<DraftTask[]>([{ id: "task_1", prompt: "" }]);
  const [evalSets, setEvalSets] = useState<SkillEvalSet[]>([]);
  const [newEvalSetName, setNewEvalSetName] = useState("");
  const [selectedEvalSetId, setSelectedEvalSetId] = useState("");
  const [repeat, setRepeat] = useState(1);
  const [judgeRepeat, setJudgeRepeat] = useState(1);
  const [includeRetrievalVariant, setIncludeRetrievalVariant] = useState(false);
  const [retrievalTopK, setRetrievalTopK] = useState(3);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [archives, setArchives] = useState<EvaluationArchiveIndexItem[]>([]);
  const [history, setHistory] = useState<SkillEvaluation[]>([]);
  const [result, setResult] = useState<SkillEvaluationDetail | null>(null);
  const [curating, setCurating] = useState(false);
  const [curation, setCuration] = useState<SkillCurationResult | null>(null);
  const [approvals, setApprovals] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<SkillCurationApplyResult | null>(null);
  const [expandedProposals, setExpandedProposals] = useState<Set<number>>(new Set());
  const [queueProposals, setQueueProposals] = useState<SkillCurationProposalRecord[]>([]);
  const [applyingQueue, setApplyingQueue] = useState(false);
  const [queueApplyResult, setQueueApplyResult] = useState<SkillCurationApplyResult | null>(null);
  const [expandedQueueItems, setExpandedQueueItems] = useState<Set<string>>(new Set());
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [retrieving, setRetrieving] = useState(false);
  const [retrievalResults, setRetrievalResults] = useState<RetrievedSkill[]>([]);
  const [autoTab, setAutoTab] = useState<"eval" | "auto">("eval");
  const [autoQuery, setAutoQuery] = useState("");
  const [autoTopK, setAutoTopK] = useState(3);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoResult, setAutoResult] = useState<AutonomousRunResult | null>(null);
  const [dataContextPaths, setDataContextPaths] = useState<string[]>([]);

  useEffect(() => {
    setSelectedPaths([]);
    setRegistryCandidates([]);
    setSelectedRegistryIds([]);
    setEvaluatedRegistryIds([]);
    setRegistryActionBusyId(null);
    setRegistryActionNote("");
    setSkills([]);
    setEvalSets([]);
    setNewEvalSetName("");
    setSelectedEvalSetId("");
    setHistory([]);
    setResult(null);
    setError(null);
    setArchiveMessage(null);
    setArchives([]);
    setCuration(null);
    setApprovals(new Set());
    setApplyResult(null);
    setQueueProposals([]);
    setQueueApplyResult(null);
    setExpandedQueueItems(new Set());
    setRetrievalQuery("");
    setRetrievalResults([]);
    setAutoQuery("");
    setAutoResult(null);
    setDataContextPaths([]);
    if (!p.workspaceId) return;
    let cancelled = false;
    setLoadingSkills(true);
    Promise.all([
      api.listWorkspaceSkills(p.workspaceId),
      api.listSkillRegistry(p.workspaceId, "candidate"),
      api.listSkillEvaluations(p.workspaceId),
      api.listSkillEvalSets(p.workspaceId),
      api.listEvaluationArchives(p.workspaceId),
      api.listSkillCurationProposals(p.workspaceId),
    ])
      .then(async ([skillItems, candidateItems, evaluationItems, evalSetItems, archiveItems, proposalItems]) => {
        if (cancelled) return;
        setSkills(skillItems);
        setRegistryCandidates(candidateItems);
        setHistory(evaluationItems);
        setEvalSets(evalSetItems);
        setArchives(archiveItems);
        setQueueProposals(proposalItems.filter((p) => p.status === "pending" || p.status === "approved"));
        setSelectedEvalSetId(evalSetItems[0]?.id ?? "");
        if (evaluationItems[0]) {
          const detail = await api.getSkillEvaluation(evaluationItems[0].evaluationId);
          if (!cancelled) setResult(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p.workspaceId]);

  const selectedSkills = useMemo(
    () => skills.filter((skill) => selectedPaths.includes(skill.path)),
    [selectedPaths, skills],
  );
  const registryCandidateOptions = useMemo(
    () => registryCandidates.map((entry): RegistryCandidateOption => ({
      entry,
      path: findRegistrySkillPath(skills, entry.slug),
    })),
    [registryCandidates, skills],
  );
  const selectedRegistryCandidates = useMemo(
    () => registryCandidateOptions.filter((item) => selectedRegistryIds.includes(item.entry.id) && item.path),
    [registryCandidateOptions, selectedRegistryIds],
  );
  const evaluatedRegistryCandidates = useMemo(
    () => registryCandidates.filter((entry) => evaluatedRegistryIds.includes(entry.id)),
    [registryCandidates, evaluatedRegistryIds],
  );
  const runnableTasks = useMemo(
    () => tasks
      .map((task, index): SkillEvalTask => ({ id: task.id || `task_${index + 1}`, prompt: task.prompt.trim() }))
      .filter((task) => task.prompt.length > 0),
    [tasks],
  );
  const canRun = !!p.workspaceId && !!p.model && (selectedSkills.length > 0 || selectedRegistryCandidates.length > 0) && runnableTasks.length > 0 && !running;

  function toggleSkill(skill: PiSkill): void {
    if (!skill.available) return;
    setSelectedPaths((cur) => cur.includes(skill.path) ? cur.filter((path) => path !== skill.path) : [...cur, skill.path]);
  }

  function toggleRegistryCandidate(candidate: RegistryCandidateOption): void {
    if (!candidate.path) return;
    setSelectedRegistryIds((cur) => cur.includes(candidate.entry.id) ? cur.filter((id) => id !== candidate.entry.id) : [...cur, candidate.entry.id]);
  }

  function updateTask(id: string, prompt: string): void {
    setTasks((cur) => cur.map((task) => task.id === id ? { ...task, prompt } : task));
  }

  function removeTask(id: string): void {
    setTasks((cur) => cur.length === 1 ? cur : cur.filter((task) => task.id !== id));
  }

  async function saveEvalSet(): Promise<void> {
    if (!p.workspaceId) return;
    const name = newEvalSetName.trim();
    if (!name) {
      setError("任务集名称不能为空");
      return;
    }
    if (runnableTasks.length === 0) {
      setError("当前没有可保存的任务");
      return;
    }
    setError(null);
    try {
      const saved = await api.createSkillEvalSet(p.workspaceId, { name, tasks: runnableTasks });
      setEvalSets((cur) => [saved, ...cur]);
      setSelectedEvalSetId(saved.id);
      setNewEvalSetName("");
    } catch (err) {
      setError(String(err));
    }
  }

  function loadEvalSet(): void {
    const selected = evalSets.find((item) => item.id === selectedEvalSetId);
    if (!selected) return;
    if (hasDraftTasks(tasks) && !window.confirm("载入任务集会覆盖当前任务，是否继续？")) return;
    setTasks(selected.tasks.map((task) => ({ id: task.id, prompt: task.prompt })));
    taskSeq = Math.max(taskSeq, selected.tasks.length + 2);
  }

  async function renameEvalSet(): Promise<void> {
    const selected = evalSets.find((item) => item.id === selectedEvalSetId);
    if (!selected) return;
    const name = window.prompt("重命名任务集", selected.name)?.trim();
    if (!name || name === selected.name) return;
    setError(null);
    try {
      const updated = await api.updateSkillEvalSet(selected.id, { name });
      setEvalSets((cur) => cur.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(String(err));
    }
  }

  async function updateEvalSetFromCurrentTasks(): Promise<void> {
    const selected = evalSets.find((item) => item.id === selectedEvalSetId);
    if (!selected) return;
    if (runnableTasks.length === 0) {
      setError("当前没有可更新的任务");
      return;
    }
    if (!window.confirm(`用当前 ${runnableTasks.length} 个任务覆盖「${selected.name}」？`)) return;
    setError(null);
    try {
      const updated = await api.updateSkillEvalSet(selected.id, { tasks: runnableTasks });
      setEvalSets((cur) => [updated, ...cur.filter((item) => item.id !== updated.id)]);
      setSelectedEvalSetId(updated.id);
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteEvalSet(): Promise<void> {
    const selected = evalSets.find((item) => item.id === selectedEvalSetId);
    if (!selected) return;
    if (!window.confirm(`删除任务集「${selected.name}」？`)) return;
    setError(null);
    try {
      await api.deleteSkillEvalSet(selected.id);
      setEvalSets((cur) => {
        const next = cur.filter((item) => item.id !== selected.id);
        setSelectedEvalSetId(next[0]?.id ?? "");
        return next;
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function runEvaluation(): Promise<void> {
    if (!p.workspaceId || !canRun) return;
    const variants: SkillVariant[] = [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      ...selectedSkills.map((skill, index) => ({
        id: `skill_${index + 1}`,
        label: skill.name,
        skillPaths: [skill.path],
      })),
      ...selectedRegistryCandidates.flatMap((candidate): SkillVariant[] => {
        if (!candidate.path) return [];
        return [{
          id: registryVariantId(candidate.entry.id),
          label: `${candidate.entry.name} (candidate)`,
          skillPaths: [candidate.path],
        }];
      }),
    ];
    if (includeRetrievalVariant) {
      variants.push({
        id: "retrieval_variant",
        label: `Auto Retrieval (Top ${retrievalTopK})`,
        skillPaths: [],
        retrievalMode: true,
        retrievalTopK,
      });
    }
    setRunning(true);
    setError(null);
    setArchiveMessage(null);
    setResult(null);
    try {
      const summary = await api.runSkillEvaluation(p.workspaceId, {
        model: p.model,
        repeat,
        judgeRepeat,
        variants,
        tasks: runnableTasks,
        dataContextPaths: dataContextPaths.filter(Boolean),
      });
      setResult(summary);
      setEvaluatedRegistryIds(selectedRegistryCandidates.map((candidate) => candidate.entry.id));
      setHistory((cur) => [summary, ...cur.filter((item) => item.evaluationId !== summary.evaluationId)]);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function selectEvaluation(evaluationId: string): Promise<void> {
    setError(null);
    setArchiveMessage(null);
    try {
      const detail = await api.getSkillEvaluation(evaluationId);
      setResult(detail);
      setEvaluatedRegistryIds(extractRegistryIdsFromVariants(detail.variants));
    } catch (err) {
      setError(String(err));
    }
  }

  async function refreshRegistryCandidates(): Promise<void> {
    if (!p.workspaceId) return;
    const [skillItems, candidateItems] = await Promise.all([
      api.listWorkspaceSkills(p.workspaceId),
      api.listSkillRegistry(p.workspaceId, "candidate"),
    ]);
    setSkills(skillItems);
    setRegistryCandidates(candidateItems);
    setSelectedRegistryIds((cur) => cur.filter((id) => candidateItems.some((entry) => entry.id === id)));
    setEvaluatedRegistryIds((cur) => cur.filter((id) => candidateItems.some((entry) => entry.id === id)));
  }

  async function adoptRegistryCandidate(entry: SkillRegistryEntry): Promise<void> {
    if (!window.confirm(`采纳「${entry.name}」为 active skill？`)) return;
    setRegistryActionBusyId(entry.id);
    setRegistryActionNote("");
    setError(null);
    try {
      await api.patchSkillRegistry(entry.id, { status: "active", confirmed: true });
      setRegistryActionNote(`已采纳：${entry.name}`);
      await refreshRegistryCandidates();
    } catch (err) {
      setError(String(err));
    } finally {
      setRegistryActionBusyId(null);
    }
  }

  async function archiveRegistryCandidate(entry: SkillRegistryEntry): Promise<void> {
    if (!window.confirm(`弃用「${entry.name}」？SKILL.md 会保留，registry 状态归档。`)) return;
    setRegistryActionBusyId(entry.id);
    setRegistryActionNote("");
    setError(null);
    try {
      await api.archiveSkillRegistry(entry.id);
      setRegistryActionNote(`已弃用：${entry.name}`);
      await refreshRegistryCandidates();
    } catch (err) {
      setError(String(err));
    } finally {
      setRegistryActionBusyId(null);
    }
  }

  async function archiveCurrentEvaluation(): Promise<void> {
    if (!result) return;
    setError(null);
    setArchiveMessage(null);
    try {
      const archived = await api.archiveEvaluation("skill", result.evaluationId);
      setArchiveMessage(`已归档: ${archived.markdownPath} / ${archived.jsonPath}`);
      if (p.workspaceId) setArchives(await api.listEvaluationArchives(p.workspaceId));
    } catch (err) {
      setError(String(err));
    }
  }

  async function curateCurrentEvaluation(): Promise<void> {
    if (!result) return;
    setCurating(true);
    setCuration(null);
    setApprovals(new Set());
    setApplyResult(null);
    setExpandedProposals(new Set());
    try {
      const res = await api.curateSkillEvaluation(result.evaluationId, p.model);
      setCuration(res);
      setApprovals(new Set(res.proposals.map((_, i) => i)));
    } catch (err) {
      setError(String(err));
    } finally {
      setCurating(false);
    }
  }

  async function applyApprovedProposals(): Promise<void> {
    if (!p.workspaceId || !curation || approvals.size === 0) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const approved = curation.proposals.filter((_, i) => approvals.has(i));
      const res = await api.applySkillCurationProposals(p.workspaceId, approved);
      setApplyResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setApplying(false);
    }
  }

  async function updateQueueProposalStatus(id: string, status: SkillCurationProposalStatus): Promise<void> {
    if (!p.workspaceId) return;
    try {
      await api.updateSkillCurationProposalStatus(id, status);
      setQueueProposals((cur) => cur.map((prop) => prop.id === id ? { ...prop, status } : prop).filter((prop) => prop.status === "pending" || prop.status === "approved"));
    } catch (err) {
      setError(String(err));
    }
  }

  async function applyQueueApprovedProposals(): Promise<void> {
    if (!p.workspaceId) return;
    setApplyingQueue(true);
    setQueueApplyResult(null);
    try {
      const res = await api.applyApprovedCurationProposals(p.workspaceId);
      setQueueApplyResult(res);
      const updated = await api.listSkillCurationProposals(p.workspaceId);
      setQueueProposals(updated.filter((prop) => prop.status === "pending" || prop.status === "approved"));
    } catch (err) {
      setError(String(err));
    } finally {
      setApplyingQueue(false);
    }
  }

  async function searchSkills(): Promise<void> {
    if (!p.workspaceId || !retrievalQuery.trim()) return;
    setRetrieving(true);
    setRetrievalResults([]);
    try {
      const results = await api.retrieveSkills(p.workspaceId, retrievalQuery.trim());
      setRetrievalResults(results);
    } catch (err) {
      setError(String(err));
    } finally {
      setRetrieving(false);
    }
  }

  async function runAuto(): Promise<void> {
    if (!p.workspaceId || !autoQuery.trim()) return;
    setAutoRunning(true);
    setAutoResult(null);
    try {
      const result = await api.runAutonomousTask(p.workspaceId, autoQuery.trim(), p.model || undefined, autoTopK);
      setAutoResult(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setAutoRunning(false);
    }
  }

  async function downloadArchiveFile(item: EvaluationArchiveIndexItem, format: "md" | "json"): Promise<void> {
    if (!p.workspaceId) return;
    try {
      const content = await api.getEvaluationArchiveFile(p.workspaceId, item.baseName, format);
      downloadArchiveTextFile(`${item.baseName}.${format}`, content, format);
    } catch (err) {
      setError(String(err));
    }
  }

  async function downloadAllArchivesZip(): Promise<void> {
    if (!p.workspaceId || archives.length === 0) return;
    setZipping(true);
    try {
      await downloadArchivesZip(archives, (baseName, format) =>
        api.getEvaluationArchiveFile(p.workspaceId!, baseName, format),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setZipping(false);
    }
  }

  if (!p.workspaceId) return <EmptyState text="请先在左侧选择工作区" />;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4" strokeWidth={1.75} />Skill 评估</div>
        <p className="mt-1 text-xs leading-5 text-neutral-500">对比 baseline 与指定 skill 的任务表现、激活证据、成本和耗时。</p>

        <div className="mt-5 text-xs font-medium">候选 skill <span className="text-neutral-400">至少选择 1 个</span></div>
        <div className="mt-2 space-y-1">
          {loadingSkills && <p className="px-2 py-2 text-xs text-neutral-400">正在读取 skill...</p>}
          {!loadingSkills && skills.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">当前工作区没有发现可用 skill。</p>}
          {skills.map((skill) => {
            const checked = selectedPaths.includes(skill.path);
            return (
              <label key={skill.path} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <input className="mt-0.5" type="checkbox" checked={checked} disabled={!skill.available} onChange={() => toggleSkill(skill)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{skill.name}</span>
                  <span className={cn("mt-0.5 block line-clamp-2 text-[11px] leading-4 text-neutral-400", !skill.available && "text-rose-500")}>
                    {skill.description || skill.error || skill.path}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-neutral-400">{skill.source}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-900/70 dark:bg-amber-950/20">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-amber-800 dark:text-amber-200">Registry 候选</div>
            <button
              type="button"
              onClick={() => void refreshRegistryCandidates()}
              disabled={loadingSkills}
              className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-50 disabled:opacity-40 dark:border-amber-800 dark:bg-neutral-900 dark:text-amber-300 dark:hover:bg-amber-950/30"
              title="刷新 candidate skill 列表"
            >
              刷新
            </button>
          </div>
          <p className="mt-1 text-[10.5px] leading-4 text-amber-700/80 dark:text-amber-300/80">promote / distill 产物先在这里送 SkillLab 对照评测，再采纳或弃用。</p>
          <div className="mt-2 space-y-1">
            {registryCandidateOptions.length === 0 && <p className="px-1 py-1 text-[11px] text-amber-700/70 dark:text-amber-300/70">暂无 registry candidate。</p>}
            {registryCandidateOptions.map((candidate) => {
              const checked = selectedRegistryIds.includes(candidate.entry.id);
              const disabled = !candidate.path;
              return (
                <label key={candidate.entry.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 text-xs hover:bg-amber-100/60 dark:hover:bg-amber-950/40">
                  <input className="mt-0.5" type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleRegistryCandidate(candidate)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">{candidate.entry.name}</span>
                    <span className={cn("mt-0.5 block truncate font-mono text-[10px] text-neutral-400", disabled && "text-rose-500")}>
                      {disabled ? "SKILL.md 未被 listSkills 识别，请检查 frontmatter description" : `.pi/skills/${candidate.entry.slug}/SKILL.md`}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-neutral-400">
                      score {candidate.entry.score === null ? "—" : candidate.entry.score.toFixed(2)}
                      {" · "}
                      activation {candidate.entry.activationRate === null ? "—" : `${Math.round(candidate.entry.activationRate * 100)}%`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* BM25 检索技能 */}
        <div className="mt-4">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
            <Search className="h-3.5 w-3.5" />
            <span>检索技能</span>
          </div>
          <div className="mt-1.5 flex gap-1">
            <input
              type="text"
              value={retrievalQuery}
              onChange={(e) => setRetrievalQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void searchSkills()}
              placeholder="输入任务描述..."
              className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
            />
            <button
              type="button"
              disabled={!retrievalQuery.trim() || retrieving || !p.workspaceId}
              onClick={() => void searchSkills()}
              className="shrink-0 rounded border border-neutral-200 px-2 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {retrieving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            </button>
          </div>
          {retrievalResults.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {retrievalResults.map((r) => {
                const maxScore = retrievalResults[0]?.score ?? 1;
                const pct = maxScore > 0 ? (r.score / maxScore) * 100 : 0;
                const alreadySelected = selectedPaths.includes(r.path);
                return (
                  <div key={r.path} className="rounded border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div className="h-full rounded-full bg-sky-400" style={{ width: `${pct.toFixed(0)}%` }} />
                      </div>
                      <span className="shrink-0 text-[10px] text-neutral-400">{r.score.toFixed(1)}</span>
                      <button
                        type="button"
                        disabled={alreadySelected}
                        onClick={() => setSelectedPaths((cur) => alreadySelected ? cur : [...cur, r.path])}
                        className="shrink-0 rounded border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40 dark:border-sky-800 dark:text-sky-400 dark:hover:bg-sky-950/30"
                      >{alreadySelected ? "已选" : "+选"}</button>
                    </div>
                    <p className="mt-0.5 truncate font-medium" title={r.path}>{r.name}</p>
                    {r.snippet && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-neutral-400">{r.snippet}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {!retrieving && retrievalQuery && retrievalResults.length === 0 && (
            <p className="mt-1 text-[11px] text-neutral-400">未找到匹配的 skill。</p>
          )}
        </div>

        {/* 聚合数据路径 */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>聚合数据 <span className="font-normal text-neutral-400">（测评用数据，可被 AI 读取）</span></span>
            <button
              type="button"
              onClick={() => setDataContextPaths((cur) => [...cur, ""])}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="添加路径"
            ><Plus className="h-3.5 w-3.5" /></button>
          </div>
          {dataContextPaths.length === 0 && (
            <p className="mt-1 text-[11px] text-neutral-400">无聚合数据——AI 仅按数据安全规则执行。</p>
          )}
          <div className="mt-1.5 space-y-1">
            {dataContextPaths.map((path, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setDataContextPaths((cur) => cur.map((p, idx) => idx === i ? e.target.value : p))}
                  placeholder="/Users/huangbo/Dev/Data/.../file.csv"
                  className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[11px] outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
                />
                <button
                  type="button"
                  onClick={() => setDataContextPaths((cur) => cur.filter((_, idx) => idx !== i))}
                  className="shrink-0 text-neutral-300 hover:text-red-500 dark:text-neutral-600 dark:hover:text-red-400"
                ><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="block text-xs font-medium">运行模型
            <select value={p.model} onChange={(e) => p.onModelChange(e.target.value)} className={inputClass("mt-1")}>
              {p.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium">重复次数
            <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className={inputClass("mt-1")}>
              {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium">Judge 重采样
            <select value={judgeRepeat} onChange={(e) => setJudgeRepeat(Number(e.target.value))} className={inputClass("mt-1")}>
              {[1, 2, 3, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            {judgeRepeat > 1 && (
              <span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-400">
                每条结果将 judge {judgeRepeat} 次，总 judge 调用 ×{judgeRepeat}
              </span>
            )}
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={includeRetrievalVariant} onChange={(e) => setIncludeRetrievalVariant(e.target.checked)} className="rounded border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900" />
            包含自动检索变体
          </label>
          {includeRetrievalVariant && (
            <label className="ml-6 mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
              检索 Top K:
              <input type="number" value={retrievalTopK} onChange={(e) => setRetrievalTopK(Math.max(1, Number(e.target.value)))} className="w-12 rounded border border-neutral-300 px-1 py-0.5 text-[10px] dark:border-neutral-700 dark:bg-neutral-900" min={1} />
            </label>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs font-medium">评测任务</div>
          <button type="button" onClick={() => setTasks((cur) => [...cur, nextTask()])} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
            <Plus className="h-3.5 w-3.5" />新增
          </button>
        </div>
        <div className="mt-2 space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="flex gap-1.5">
            <input value={newEvalSetName} onChange={(e) => setNewEvalSetName(e.target.value)} placeholder="任务集名称" className={inputClass("min-w-0 flex-1")} />
            <button type="button" onClick={() => void saveEvalSet()} className={smallButtonClass} title="保存当前任务集">
              <Save className="h-3.5 w-3.5" />保存
            </button>
          </div>
          <div className="flex gap-1.5">
            <select value={selectedEvalSetId} onChange={(e) => setSelectedEvalSetId(e.target.value)} className={inputClass("min-w-0 flex-1")}>
              <option value="">选择已保存任务集</option>
              {evalSets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.tasks.length}t</option>)}
            </select>
            <button type="button" disabled={!selectedEvalSetId} onClick={loadEvalSet} className={smallButtonClass} title="载入任务集">
              <FileDown className="h-3.5 w-3.5" />载入
            </button>
          </div>
          <div className="flex gap-1.5">
            <button type="button" disabled={!selectedEvalSetId} onClick={() => void updateEvalSetFromCurrentTasks()} className={smallButtonClass} title="用当前任务覆盖已保存任务集">
              <Save className="h-3.5 w-3.5" />更新
            </button>
            <button type="button" disabled={!selectedEvalSetId} onClick={() => void renameEvalSet()} className={smallButtonClass} title="重命名任务集">
              <Pencil className="h-3.5 w-3.5" />重命名
            </button>
            <button type="button" disabled={!selectedEvalSetId} onClick={() => void deleteEvalSet()} className={smallButtonClass} title="删除任务集">
              <Trash2 className="h-3.5 w-3.5" />删除
            </button>
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {tasks.map((task, index) => (
            <label key={task.id} className="block text-xs font-medium">
              <span className="flex items-center justify-between">
                <span>任务 {index + 1}</span>
                <button type="button" disabled={tasks.length === 1} onClick={() => removeTask(task.id)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" title="删除任务">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
              <textarea value={task.prompt} onChange={(e) => updateTask(task.id, e.target.value)} rows={4} placeholder="输入需要 baseline 和 skill variant 共同执行的任务 prompt" className={inputClass("mt-1 resize-y")} />
            </label>
          ))}
        </div>

        <button onClick={() => void runEvaluation()} disabled={!canRun} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}开始评估
        </button>
        {error && <p className="mt-2 break-words text-xs text-rose-500">{error}</p>}

        <EvalHistoryList items={history} selectedId={result?.evaluationId} onSelect={(item) => void selectEvaluation(item.evaluationId)} emptyText="还没有 Skill 评估历史。" renderMeta={(item) => <span className="text-[10px] text-neutral-400">{item.variants.length}v/{item.tasks.length}t/{item.repeat}x</span>} />

        {/* 治理队列 */}
        <div className="mt-6 flex items-center gap-2 text-xs font-medium text-neutral-500">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1">治理队列</span>
          {queueProposals.length > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {queueProposals.length}
            </span>
          )}
        </div>
        <div className="mt-2 space-y-1.5">
          {queueProposals.map((prop) => {
            const expanded = expandedQueueItems.has(prop.id);
            const skillName = prop.targetPath.split("/").slice(-2).join("/");
            return (
              <div key={prop.id} className="rounded-md border border-neutral-200 text-xs dark:border-neutral-800">
                <div className="flex items-start gap-1.5 px-2 py-1.5">
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 text-neutral-400 hover:text-neutral-600"
                    onClick={() => setExpandedQueueItems((cur) => { const next = new Set(cur); expanded ? next.delete(prop.id) : next.add(prop.id); return next; })}
                  >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", prop.type === "create" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300")}>{prop.type}</span>
                      <span className="truncate font-mono text-[10.5px] text-neutral-600 dark:text-neutral-300" title={prop.targetPath}>{skillName}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[10px] text-neutral-400">置信度 {(prop.confidence * 100).toFixed(0)}%</span>
                      <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", prop.status === "approved" ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400")}>{prop.status}</span>
                    </div>
                    {prop.rationale && <p className="mt-1 text-[11px] leading-4 text-neutral-500">{prop.rationale}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => void updateQueueProposalStatus(prop.id, "approved")}
                      disabled={prop.status === "approved"}
                      className="rounded border border-green-200 px-1.5 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-40 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30"
                    >接受</button>
                    <button
                      type="button"
                      onClick={() => void updateQueueProposalStatus(prop.id, "rejected")}
                      className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                    >拒绝</button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                    {prop.evidence.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[10px] font-medium text-neutral-400">证据</p>
                        <ul className="mt-1 space-y-0.5">
                          {prop.evidence.map((e, i) => (
                            <li key={i} className="font-mono text-[10px] text-neutral-500">{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[10px] font-medium text-neutral-400">路径</p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-neutral-500">{prop.targetPath}</p>
                  </div>
                )}
              </div>
            );
          })}
          {queueProposals.length === 0 && <p className="px-2 py-2 text-xs text-neutral-400">暂无待处理治理提案。</p>}
          {queueProposals.some((p) => p.status === "approved") && (
            <button
              type="button"
              disabled={applyingQueue}
              onClick={() => void applyQueueApprovedProposals()}
              className="mt-1 w-full rounded border border-green-300 bg-green-50 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:border-green-800 dark:bg-green-950/20 dark:text-green-400 dark:hover:bg-green-950/40"
            >
              {applyingQueue ? "写入中..." : `应用已接受 (${queueProposals.filter((p) => p.status === "approved").length})`}
            </button>
          )}
          {queueApplyResult && (
            <div className="rounded border border-neutral-200 px-2 py-1.5 text-[10.5px] dark:border-neutral-700">
              {queueApplyResult.applied.length > 0 && <p className="text-green-700 dark:text-green-400">✓ 已写入 {queueApplyResult.applied.length} 个 SKILL.md</p>}
              {queueApplyResult.errors.map((e, i) => <p key={i} className="text-red-600 dark:text-red-400">{e}</p>)}
            </div>
          )}
        </div>

        <ArchiveList archives={archives} zipping={zipping} onDownload={(item, format) => void downloadArchiveFile(item, format)} onDownloadManifest={() => downloadEvaluationArchiveManifest(archives)} onDownloadZip={() => void downloadAllArchivesZip()} />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {/* 模式切换 tab */}
        <div className="mb-4 flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700" style={{ width: "fit-content" }}>
          <button
            type="button"
            onClick={() => setAutoTab("eval")}
            className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", autoTab === "eval" ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200")}
          >评测模式</button>
          <button
            type="button"
            onClick={() => setAutoTab("auto")}
            className={cn("flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors", autoTab === "auto" ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200")}
          ><Sparkles className="h-3 w-3" />自主完成</button>
        </div>

        {autoTab === "auto" ? (
          <AutonomousPanel
            workspaceId={p.workspaceId}
            model={p.model}
            query={autoQuery}
            onQueryChange={setAutoQuery}
            topK={autoTopK}
            onTopKChange={setAutoTopK}
            running={autoRunning}
            result={autoResult}
            onRun={() => void runAuto()}
          />
        ) : !result ? <EmptyState text={running ? "正在运行 Skill 评估..." : "运行一次评估后，这里会显示对比报告"} /> : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="h-4 w-4" />Skill 测评报告</div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">{result.results.length} 次运行 · {result.durationSec.toFixed(2)}s · {statusLabel(result.status)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ExportActions actions={[
                  { key: "json", title: "导出完整 JSON", onClick: () => downloadEvaluationJson("skill", result.evaluationId, result), label: <><Download className="h-3.5 w-3.5" />JSON</> },
                  { key: "md", title: "导出 Markdown 报告", onClick: () => downloadSkillEvaluationMarkdown(result), label: <><Download className="h-3.5 w-3.5" />Markdown</> },
                  { key: "archive", title: "归档 Markdown 与 JSON 到 workspace", onClick: () => void archiveCurrentEvaluation(), label: <><Archive className="h-3.5 w-3.5" />归档</> },
                ]} />
                <button
                  type="button"
                  disabled={curating}
                  onClick={() => void curateCurrentEvaluation()}
                  className={cn(exportButtonClass, "border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/20")}
                  title="基于本次评测结果，分析 skill 改进方向"
                >
                  {curating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  治理分析
                </button>
                <StatusIcon status={result.status} />
              </div>
            </div>
            {archiveMessage && <p className="mt-2 break-all rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">{archiveMessage}</p>}
            {registryActionNote && <p className="mt-2 break-all rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">{registryActionNote}</p>}
            {evaluatedRegistryCandidates.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/70 dark:bg-amber-950/20">
                <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">Registry candidate 决策</div>
                <div className="mt-2 space-y-1.5">
                  {evaluatedRegistryCandidates.map((entry) => {
                    const pairwise = result.pairwiseSummaries.find((item) => item.variantId === registryVariantId(entry.id));
                    const variant = result.variantSummaries.find((item) => item.variantId === registryVariantId(entry.id));
                    return (
                      <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-white px-2 py-1.5 text-xs dark:border-amber-900 dark:bg-neutral-950">
                        <span className="min-w-0 flex-1 truncate font-medium text-neutral-800 dark:text-neutral-100" title={entry.name}>{entry.name}</span>
                        <span className="text-[10.5px] text-neutral-500">
                          {pairwise ? `win/tie/loss ${pairwise.win}/${pairwise.tie}/${pairwise.loss} · Δ ${pairwise.avgScoreDelta.toFixed(1)}` : "未产生 pairwise"}
                          {variant ? ` · activation ${Math.round(variant.activationRate * 100)}%` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => void adoptRegistryCandidate(entry)}
                          disabled={registryActionBusyId === entry.id}
                          className="inline-flex h-6 items-center gap-1 rounded border border-emerald-300 px-1.5 text-[10.5px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                          title="采纳为 active skill"
                        >
                          <CheckCircle2 className="h-3 w-3" />采纳
                        </button>
                        <button
                          type="button"
                          onClick={() => void archiveRegistryCandidate(entry)}
                          disabled={registryActionBusyId === entry.id}
                          className="inline-flex h-6 items-center gap-1 rounded border border-rose-300 px-1.5 text-[10.5px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30"
                          title="弃用并归档 registry entry"
                        >
                          <Archive className="h-3 w-3" />弃用
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {curating && <p className="mt-2 flex items-center gap-2 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-950/20 dark:text-violet-300"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在分析 skill 改进方向，请稍候…</p>}
            {curation && <CurationPanel curation={curation} approvals={approvals} expanded={expandedProposals} applying={applying} applyResult={applyResult} onToggleApproval={(i) => setApprovals((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} onToggleExpand={(i) => setExpandedProposals((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} onApply={() => void applyApprovedProposals()} />}
            <div className="mt-4">
              <AheManifestPanel component="skill" lab="skill" currentEvaluationId={result.evaluationId} />
            </div>
            <SummaryTable summaries={result.variantSummaries} />
            <PairwiseSummaryTable summaries={result.pairwiseSummaries} />
            <TaskSummaryTable result={result} />
            <div className="mt-6 text-sm font-semibold">运行明细</div>
            <div className="mt-2 space-y-2">
              {result.results.map((item) => <ResultCard key={item.id} result={item} />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SummaryTable({ summaries }: { summaries: SkillVariantSummary[] }) {
  return <SharedSummaryTable rows={summaries} rowKey={(item) => item.variantId} columns={[
    { key: "variant", label: "Variant", className: "font-medium", render: (item) => item.variantLabel }, { key: "success", label: "成功", render: (item) => `${item.success}/${item.total}` }, { key: "activation", label: "激活率", render: (item) => `${Math.round(item.activationRate * 100)}%` }, { key: "efc", label: "EFC", render: (item) => formatEfc(item) }, { key: "eta", label: "η", render: (item) => formatEta(item) }, { key: "duration", label: "平均耗时", render: (item) => `${item.avgDurationSec.toFixed(2)}s` }, { key: "tokens", label: "平均 token", render: (item) => Math.round(item.avgTotalTokens) }, { key: "cost", label: "平均成本", render: (item) => `$${item.avgTotalCost.toFixed(5)}` }, { key: "chars", label: "输出字符", render: (item) => Math.round(item.avgOutputChars) },
  ]} />;
}

function PairwiseSummaryTable({ summaries }: { summaries: SkillPairwiseSummary[] }) {
  if (summaries.length === 0) return null;
  return <div className="mt-6 overflow-x-auto">
    <div className="text-sm font-semibold">Pairwise Judge</div>
    <table className="mt-2 w-full text-left text-xs">
      <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
        <tr>
          <th className="py-2 pr-3 font-medium">Variant</th>
          <th className="py-2 pr-3 font-medium">判分</th>
          <th className="py-2 pr-3 font-medium">Win</th>
          <th className="py-2 pr-3 font-medium">Tie</th>
          <th className="py-2 pr-3 font-medium">Loss</th>
          <th className="py-2 pr-3 font-medium">平均分差</th>
          <th className="py-2 pr-3 font-medium">置信度</th>
          <th className="py-2 pr-3 font-medium">跳过</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((item) => (
          <tr key={item.variantId} className="border-b border-neutral-100 dark:border-neutral-900">
            <td className="py-2 pr-3 font-medium">{item.variantLabel}</td>
            <td className="py-2 pr-3">{item.judged}</td>
            <td className="py-2 pr-3 text-emerald-600 dark:text-emerald-400">{item.win}</td>
            <td className="py-2 pr-3">{item.tie}</td>
            <td className="py-2 pr-3 text-rose-600 dark:text-rose-400">{item.loss}</td>
            <td className="py-2 pr-3">{item.avgScoreDelta.toFixed(1)}</td>
            <td className="py-2 pr-3">{item.avgConfidence === null ? "-" : `${Math.round(item.avgConfidence * 100)}%`}</td>
            <td className="py-2 pr-3">{item.skipped}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function TaskSummaryTable({ result }: { result: SkillEvaluationDetail }) {
  return <div className="mt-6 overflow-x-auto">
    <div className="text-sm font-semibold">任务汇总</div>
    <table className="mt-2 w-full text-left text-xs">
      <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
        <tr>
          <th className="py-2 pr-3 font-medium">Task</th>
          <th className="py-2 pr-3 font-medium">成功</th>
          <th className="py-2 pr-3 font-medium">失败</th>
          <th className="py-2 pr-3 font-medium">激活率</th>
        </tr>
      </thead>
      <tbody>
        {result.taskSummaries.map((item) => (
          <tr key={item.taskId} className="border-b border-neutral-100 dark:border-neutral-900">
            <td className="py-2 pr-3 font-medium">{item.taskId}</td>
            <td className="py-2 pr-3">{item.success}/{item.total}</td>
            <td className="py-2 pr-3">{item.failed}</td>
            <td className="py-2 pr-3">{Math.round(item.activationRate * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function ResultCard({ result }: { result: SkillEvaluationRunResult }) {
  return <SharedResultCard collapsible title={result.variantLabel} status={result.status} meta={<>{result.taskId} · attempt {result.attempt} · {result.activation.activated ? "activated" : "not activated"}</>}>
    <div className="mt-2 grid gap-2 text-neutral-500 md:grid-cols-4">
      <div>耗时 {result.durationSec.toFixed(2)}s</div>
      <div>Token {result.totalTokens}</div>
      <div>成本 ${result.totalCost.toFixed(5)}</div>
      <div>Tool {result.toolCalls}</div>
    </div>
    {result.activation.matchedSkillPaths.length > 0 && (
      <p className="mt-2 break-words text-[11px] leading-4 text-neutral-500">匹配 skill: {result.activation.matchedSkillPaths.join(", ")}</p>
    )}
    {result.pairwise && (
      <div className="mt-2 break-words rounded-md bg-neutral-50 px-3 py-2 text-[11px] leading-4 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
        <p>Pairwise: {result.pairwise.verdict} · Δ {result.pairwise.scoreDelta ?? "-"} · confidence {result.pairwise.confidence === null ? "-" : `${Math.round(result.pairwise.confidence * 100)}%`} · judge {result.pairwise.judgeRuns?.length ?? 1}x · {result.pairwise.reason}</p>
        {result.pairwise.error && (
          <p className="mt-1 whitespace-pre-wrap text-rose-600 dark:text-rose-300">{formatEvaluationError(result.pairwise.error)}</p>
        )}
      </div>
    )}
    {result.error && <p className="mt-2 whitespace-pre-wrap rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30">{formatEvaluationError(result.error)}</p>}
    {result.output && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{result.output}</pre>}
  </SharedResultCard>;
}

function StatusIcon({ status }: { status: "success" | "failed" }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  return <XCircle className="h-4 w-4 text-rose-500" />;
}

function statusLabel(status: "success" | "failed"): string {
  return status === "success" ? "成功" : "失败";
}

function registryVariantId(registryId: string): string {
  return `registry_${registryId}`;
}

function extractRegistryIdsFromVariants(variants: SkillVariant[]): string[] {
  return variants
    .map((variant) => variant.id.startsWith("registry_") ? variant.id.slice("registry_".length) : "")
    .filter(Boolean);
}

function findRegistrySkillPath(skills: PiSkill[], slug: string): string | null {
  const suffix = `/.pi/skills/${slug}/SKILL.md`;
  return skills.find((skill) => skill.available && skill.path.endsWith(suffix))?.path ?? null;
}

function formatEvaluationError(error: EvaluationError | null): string {
  if (!error) return "";
  return [error.message, error.hint, error.cause].filter(Boolean).join("\n");
}

function hasDraftTasks(tasks: DraftTask[]): boolean {
  return tasks.some((task) => task.prompt.trim());
}

function inputClass(extra = ""): string {
  return cn("w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900", extra);
}

const smallButtonClass = "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";
const exportButtonClass = "inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

interface CurationPanelProps {
  curation: SkillCurationResult;
  approvals: Set<number>;
  expanded: Set<number>;
  applying: boolean;
  applyResult: SkillCurationApplyResult | null;
  onToggleApproval: (i: number) => void;
  onToggleExpand: (i: number) => void;
  onApply: () => void;
}

function CurationPanel({ curation, approvals, expanded, applying, applyResult, onToggleApproval, onToggleExpand, onApply }: CurationPanelProps) {
  const approvedCount = approvals.size;
  return (
    <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-800 dark:bg-violet-950/10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-semibold text-violet-800 dark:text-violet-200">Skill 治理分析</span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            {curation.proposals.length} 条提案
          </span>
        </div>
        {curation.proposals.length > 0 && (
          <button
            type="button"
            disabled={applying || approvedCount === 0}
            onClick={onApply}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-violet-600 px-3 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            应用已接受 ({approvedCount})
          </button>
        )}
      </div>

      {curation.error && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{curation.error}</p>
      )}

      {applyResult && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs dark:border-emerald-800 dark:bg-emerald-950/20">
          {applyResult.applied.length > 0 && (
            <p className="text-emerald-700 dark:text-emerald-300">已写入 {applyResult.applied.length} 个文件: {applyResult.applied.join(", ")}</p>
          )}
          {applyResult.errors.map((e, i) => (
            <p key={i} className="text-rose-600 dark:text-rose-400">{e}</p>
          ))}
        </div>
      )}

      {curation.proposals.length === 0 && !curation.error && (
        <p className="mt-2 text-xs text-neutral-500">分析完成，当前 skill 无需改动。</p>
      )}

      <div className="mt-3 space-y-2">
        {curation.proposals.map((proposal, i) => (
          <ProposalCard
            key={i}
            proposal={proposal}
            index={i}
            approved={approvals.has(i)}
            isExpanded={expanded.has(i)}
            onToggleApproval={() => onToggleApproval(i)}
            onToggleExpand={() => onToggleExpand(i)}
          />
        ))}
      </div>
    </div>
  );
}

interface ProposalCardProps {
  proposal: SkillCurationProposal;
  index: number;
  approved: boolean;
  isExpanded: boolean;
  onToggleApproval: () => void;
  onToggleExpand: () => void;
}

function ProposalCard({ proposal, approved, isExpanded, onToggleApproval, onToggleExpand }: ProposalCardProps) {
  const skillName = proposal.targetPath.split("/").slice(-2, -1)[0] ?? proposal.targetPath;
  const confidencePct = Math.round(proposal.confidence * 100);
  const confidenceColor = confidencePct >= 80 ? "text-emerald-600" : confidencePct >= 60 ? "text-amber-600" : "text-rose-500";
  return (
    <div className={cn("rounded-md border bg-white p-3 dark:bg-neutral-900", approved ? "border-violet-200 dark:border-violet-800" : "border-neutral-200 dark:border-neutral-800")}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 shrink-0" checked={approved} onChange={onToggleApproval} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", proposal.type === "create" ? "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300")}>
              {proposal.type}
            </span>
            <span className="truncate font-mono text-xs font-medium">{skillName}</span>
            <span className={cn("text-[10px] font-medium", confidenceColor)}>置信度 {confidencePct}%</span>
          </div>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{proposal.rationale}</p>
          {proposal.evidence.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {proposal.evidence.map((e, j) => (
                <span key={j} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">{e}</span>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-violet-600 hover:underline dark:text-violet-400"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {isExpanded ? "收起" : "查看建议内容"}
          </button>
          {isExpanded && (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-100 p-2 text-[11px] leading-relaxed whitespace-pre-wrap dark:bg-neutral-800">{proposal.suggestedContent}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-neutral-400">{text}</div>;
}

interface AutonomousPanelProps {
  workspaceId: string | null;
  model: string;
  query: string;
  onQueryChange: (q: string) => void;
  topK: number;
  onTopKChange: (n: number) => void;
  running: boolean;
  result: AutonomousRunResult | null;
  onRun: () => void;
}

function AutonomousPanel({ workspaceId, model, query, onQueryChange, topK, onTopKChange, running, result, onRun }: AutonomousPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4" />
          自主完成
        </div>
        <p className="mt-1 text-xs leading-5 text-neutral-500">
          描述任务，系统自动检索相关 skill 并完成任务，无需配置工作流。
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
        <label className="block text-xs font-medium">
          任务描述
          <textarea
            rows={4}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="例如：分析上季度毛利率下降的主要原因，并给出改善建议"
            className="mt-1 block w-full rounded border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
          />
        </label>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-medium">
            检索 Skill 数量
            <input
              type="range"
              min={1}
              max={8}
              value={topK}
              onChange={(e) => onTopKChange(Number(e.target.value))}
              className="w-24"
            />
            <span className="w-4 text-neutral-500">{topK}</span>
          </label>
          <span className="text-xs text-neutral-400">模型: {model || "—"}</span>
        </div>

        <button
          type="button"
          disabled={!workspaceId || !query.trim() || running}
          onClick={onRun}
          className="flex items-center gap-2 rounded bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />运行中...</> : <><Play className="h-3.5 w-3.5" />自主执行</>}
        </button>
      </div>

      {running && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在检索 skill 并执行任务...
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* 使用的 skills */}
          <div>
            <div className="mb-2 text-xs font-medium text-neutral-500">
              自动注入的 Skill ({result.skillsUsed.length}) · {result.durationSec.toFixed(2)}s
              {result.error && <span className="ml-2 text-rose-500">{result.error}</span>}
            </div>
            {result.skillsUsed.length === 0 ? (
              <p className="text-xs text-neutral-400">未找到匹配 skill，以默认能力执行。</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {result.skillsUsed.map((s) => (
                  <span key={s.path} className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300" title={s.path}>
                    {s.name} <span className="opacity-60">{s.score.toFixed(1)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 输出 */}
          <div>
            <div className="mb-2 text-xs font-medium text-neutral-500">输出</div>
            <div className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-6 dark:border-neutral-700 dark:bg-neutral-900">
              {result.output || <span className="text-neutral-400">（无输出）</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
