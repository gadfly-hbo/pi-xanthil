import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Database,
  Download,
  FilePlus2,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { gateway } from "@/lib/ws";
import { cn } from "@/lib/cn";
import type { AnaxGateConfig, Flow, FlowRun, FlowTreeNode, GateVerdict, PiEvent, PiModel, ServerMessage, WorkflowNode, WorkspacePath } from "@/types";

interface Props {
  workspaceId: string | null;
  model: string;
  models: PiModel[];
  rulesPromptEnabled: boolean;
}

type StepStatus = "pending" | "running" | "done" | "failed";
interface StepState {
  status: StepStatus;
  output: string;
}
interface HistorySnap {
  dbRunId: string;
  stepStates: Record<string, StepState>;
  gates: Record<string, GateVerdict>;
}

/** Source names for the two AnaX flow variants. */
const ANAX_SOURCE = "AnaX v3.0";
const ANAX_QUICK_SOURCE = "AnaX v3.0 Quick";

function makeRunId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Top-level directory names directly under the run folder. */
function topLevelDirs(tree: FlowTreeNode): Set<string> {
  const out = new Set<string>();
  for (const child of tree.children ?? []) {
    if (child.kind === "dir") out.add(child.name);
  }
  return out;
}

function extractEventText(event: PiEvent): string {
  if (event.type !== "message_end") return "";
  const msg = (event as { message?: { role?: string; content?: unknown } }).message;
  if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (b): b is { type: "text"; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const DATA_GATE_HINTS: Array<[RegExp, string]> = [
  [/RL03/, "数据质量综合评分 < 5，无法继续分析。请登记/更新聚合数据文件（点上方「登记新文件」），确保综合评分 ≥ 7 后重新启动。"],
  [/RL05/, "数据报告未披露局限性，通常因数据维度不完整。请补充更多字段或更长时间跨度的聚合数据。"],
  [/dataQuality|数据质量/, "聚合数据质量不足阈值（≥ 7）。请补充或替换质量更高的数据文件后重新运行。"],
  [/置信度/, "Data Curator 置信度偏低，通常因可评分指标太少。请确保聚合数据包含完整的量化指标。"],
  [/证据数/, "可引用数据证据点不足（需 ≥ 2）。请补充包含更多维度或时间段的聚合数据。"],
];

const REVIEW_GATE_HINTS: Array<[RegExp, string]> = [
  [/RL01/, "结论缺乏数据支撑。通常因数据质量偏低或维度不足，请补充聚合数据后重新运行。"],
  [/RL02/, "假设被直接采纳、未经检验。请在 brief 中更明确地描述待验证假设，并确保提供充足聚合数据供 I 阶段检验。"],
  [/RL04/, "建议未回应核心商务问题。请优化 brief，清晰描述决策目标（如：需在 XX 日前决定是否 YY）。"],
  [/RL05/, "未披露关键局限性。请在 brief 中注明已知数据限制，或补充覆盖更多维度的聚合数据。"],
  [/RL06/, "高影响假设缺少交叉验证。请确保聚合数据覆盖多个视角（时间 × 渠道 × 用户分层），供 I 阶段多角度验证。"],
  [/RL07/, "建议缺少四要素（负责人/时间/成功标准/验证方案）。请在 brief 中补充更多业务背景和决策约束，帮助模型生成可落地的建议。"],
  [/置信度/, "分析置信度偏低，证据链不充分。请补充更完整的聚合数据，或扩大数据时间跨度。"],
  [/证据数/, "证据引用过少，分析深度不足。请确保聚合数据包含更丰富的指标维度。"],
];

const STAGE_OVERALL_HINT: Record<string, string> = {
  data_gate: "修复路径：补充/更新「本次分析数据」中的聚合文件，使综合评分 ≥ 7，然后重新启动分析。",
  review_gate: "修复路径：根据上述红线调整 brief 或补充数据，然后重新启动分析；无需修改代码。",
};

function hintsForGate(gate: { stage: string; reasons: string[] }): string[] {
  const table = gate.stage === "data_gate" ? DATA_GATE_HINTS : REVIEW_GATE_HINTS;
  const hints: string[] = [];
  for (const reason of gate.reasons) {
    const match = table.find(([re]) => re.test(reason));
    if (match) hints.push(match[1]);
  }
  const overall = STAGE_OVERALL_HINT[gate.stage];
  if (overall) hints.push(overall);
  return [...new Set(hints)]; // deduplicate
}

export function AnaXPane({ workspaceId, model, models, rulesPromptEnabled }: Props) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [brief, setBrief] = useState("");
  const [quickMode, setQuickMode] = useState(false);
  // AnaX has its own model picker — the global Chat model often differs or is unset.
  // Default to the parent model, falling back to the first available model.
  const [localModel, setLocalModel] = useState(() => model || "");
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const [gates, setGates] = useState<Record<string, GateVerdict>>({});
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- run history ----
  const [allRuns, setAllRuns] = useState<FlowRun[]>([]);
  const [historySnap, setHistorySnap] = useState<HistorySnap | null>(null);

  // ---- data quality precheck ----
  const [precheckState, setPrecheckState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [precheckScore, setPrecheckScore] = useState<number | null>(null);
  const [precheckPass, setPrecheckPass] = useState(false);
  const [precheckSummary, setPrecheckSummary] = useState("");
  const precheckIdRef = useRef<string | null>(null);

  // ---- aggregate data selected to feed this analysis ----
  const [availableData, setAvailableData] = useState<WorkspacePath[]>([]);
  const [selectedData, setSelectedData] = useState<Set<string>>(new Set());
  const [registering, setRegistering] = useState(false);

  // ---- gate config ----
  const [gateConfig, setGateConfig] = useState<AnaxGateConfig | null>(null);
  const [gateConfigOpen, setGateConfigOpen] = useState(false);
  const [gateConfigSaving, setGateConfigSaving] = useState(false);

  // ---- cross-run compare ----
  const [compareMode, setCompareMode] = useState(false);
  const [compareSnap, setCompareSnap] = useState<HistorySnap | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);

  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;
  const flowIdRef = useRef<string | null>(null);
  flowIdRef.current = flow?.id ?? null;

  // ---- find an existing AnaX flow for this workspace ----
  const loadWorkflow = useCallback((flowId: string) => {
    api.flowWorkflowGet(flowId).then((r) => setNodes(r.workflow?.nodes ?? [])).catch(() => setNodes([]));
  }, []);

  // ---- registered aggregate (clean_data) files available to feed the analysis ----
  const refreshData = useCallback(() => {
    if (!workspaceId) return;
    api.listWorkspacePaths(workspaceId, "clean_data")
      .then((rows) => setAvailableData(rows.filter((r) => r.kind === "file")))
      .catch(() => setAvailableData([]));
  }, [workspaceId]);

  const loadGateConfig = useCallback(() => {
    if (!workspaceId) return;
    api.getAnaxGateConfig(workspaceId).then(setGateConfig).catch(() => null);
  }, [workspaceId]);

  const saveGateConfig = useCallback(async (patch: Partial<Pick<AnaxGateConfig, "minConfidence" | "minEvidenceCount" | "minDataQualityScore">>) => {
    if (!workspaceId) return;
    setGateConfigSaving(true);
    try {
      const updated = await api.updateAnaxGateConfig(workspaceId, patch);
      setGateConfig(updated);
    } finally {
      setGateConfigSaving(false);
    }
  }, [workspaceId]);

  const registerNewData = useCallback(async () => {
    if (!workspaceId || registering) return;
    setRegistering(true);
    try {
      const { path } = await api.pickLocalPath("file");
      if (!path) return;
      const added = await api.addWorkspacePath(workspaceId, "clean_data", path, "file");
      refreshData();
      setSelectedData((cur) => new Set(cur).add(added.path));
    } catch {
      /* user cancelled or path rejected */
    } finally {
      setRegistering(false);
    }
  }, [workspaceId, registering, refreshData]);

  useEffect(() => {
    setFlow(null);
    setNodes([]);
    setStepStates({});
    setGates({});
    setSelectedData(new Set());
    setAvailableData([]);
    setAllRuns([]);
    setHistorySnap(null);
    if (!workspaceId) return;
    let cancelled = false;
    refreshData();
    const targetSource = quickMode ? ANAX_QUICK_SOURCE : ANAX_SOURCE;
    api.listFlows(workspaceId).then((flows) => {
      if (cancelled) return;
      const existing = flows.find((f) => f.sourceName === targetSource);
      if (existing) {
        setFlow(existing);
        loadWorkflow(existing.id);
        api.listFlowRuns(existing.id).then((runs) => {
          if (!cancelled) setAllRuns(runs);
        }).catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, quickMode, loadWorkflow, refreshData]);

  useEffect(() => { loadGateConfig(); }, [loadGateConfig]);

  // ---- reattach to an in-flight / latest run after the pane remounts ----
  // The pane unmounts on tab switch, but the server run keeps going. Rebuild
  // the visible state from the run folder so progress isn't "lost".
  useEffect(() => {
    if (!flow || nodes.length === 0 || runId) return;
    let cancelled = false;
    const flowId = flow.id;
    (async () => {
      const runs = await api.listFlowRuns(flowId).catch(() => []);
      if (cancelled || runs.length === 0) return;
      const latest = runs[0]!; // listFlowRuns is ordered started_at DESC
      const isRunning = latest.status === "running";
      const rid = basename(latest.outputDir);

      const tree = await api.flowRunTree(flowId, latest.id).catch(() => null);
      if (cancelled || !tree) return;
      const dirs = topLevelDirs(tree);
      const present = nodes.filter((n) => dirs.has(n.id));
      const lastIdx = present.length - 1;

      const states: Record<string, StepState> = {};
      present.forEach((n, i) => {
        states[n.id] = { status: isRunning && i === lastIdx ? "running" : "done", output: "" };
      });

      // Restore gate verdicts + spec deliverables from disk (best effort).
      const restoredGates: Record<string, GateVerdict> = {};
      await Promise.all(
        present.map(async (n) => {
          if (n.kind === "gate") {
            const f = await api.flowRunFileGet(flowId, latest.id, `gates/${n.id}.json`).catch(() => null);
            if (f?.content) {
              try { restoredGates[n.id] = JSON.parse(f.content) as GateVerdict; } catch { /* ignore */ }
            }
          } else if (n.spec) {
            const f = await api.flowRunFileGet(flowId, latest.id, `specs/${n.spec}`).catch(() => null);
            if (f?.content) states[n.id] = { ...states[n.id]!, output: f.content };
          }
        }),
      );

      if (cancelled) return;
      setRunId(rid);
      setRunning(isRunning);
      setStepStates(states);
      setGates(restoredGates);
      setActiveNodeId(isRunning && present[lastIdx] ? present[lastIdx]!.id : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [flow, nodes, runId]);

  // ---- subscribe to execution events ----
  useEffect(() => {
    return gateway.subscribe((msg: ServerMessage) => {
      // Precheck messages are correlated by precheckId, not flowId/runId.
      if (msg.type === "anax_precheck_event" || msg.type === "anax_precheck_done" || msg.type === "anax_precheck_error") {
        if (msg.precheckId !== precheckIdRef.current) return;
        if (msg.type === "anax_precheck_done") {
          setPrecheckState("done");
          setPrecheckScore(msg.score);
          setPrecheckPass(msg.pass);
          setPrecheckSummary(msg.summary);
        } else if (msg.type === "anax_precheck_error") {
          setPrecheckState("error");
          setPrecheckSummary(msg.message);
        }
        return;
      }

      if (!("flowId" in msg) || msg.flowId !== flowIdRef.current) return;
      if (!("runId" in msg) || msg.runId !== runIdRef.current) return;
      switch (msg.type) {
        case "agent_step_start":
          setActiveNodeId(msg.nodeId);
          setStepStates((cur) => ({ ...cur, [msg.nodeId]: { status: "running", output: "" } }));
          break;
        case "agent_event": {
          const text = extractEventText(msg.event);
          if (text) {
            setStepStates((cur) => {
              const prev = cur[msg.nodeId] ?? { status: "running" as StepStatus, output: "" };
              return { ...cur, [msg.nodeId]: { ...prev, output: text } };
            });
          }
          break;
        }
        case "blackboard_update":
          setStepStates((cur) => {
            const prev = cur[msg.key] ?? { status: "done" as StepStatus, output: "" };
            return { ...cur, [msg.key]: { ...prev, output: msg.value || prev.output } };
          });
          break;
        case "agent_step_end":
          setStepStates((cur) => {
            const prev = cur[msg.nodeId] ?? { status: "done" as StepStatus, output: "" };
            return { ...cur, [msg.nodeId]: { ...prev, status: msg.code === 0 ? "done" : "failed" } };
          });
          break;
        case "agent_gate":
          setGates((cur) => ({ ...cur, [msg.nodeId]: msg.verdict }));
          if (msg.verdict.verdict === "blocked") setExpanded(msg.nodeId);
          break;
        case "run_end":
          setRunning(false);
          setActiveNodeId(null);
          // Refresh the run list so the newly-finished run appears in history.
          if (flowIdRef.current) {
            api.listFlowRuns(flowIdRef.current).then(setAllRuns).catch(() => undefined);
          }
          break;
        case "error":
          setRunning(false);
          break;
      }
    });
  }, []);

  const handleStart = useCallback(async () => {
    if (running || busy || !workspaceId || !brief.trim()) return;
    setBusy(true);
    try {
      let target = flow;
      if (!target) {
        target = quickMode
          ? await api.instantiateAnaxQuick(workspaceId)
          : await api.instantiateAnax(workspaceId);
        setFlow(target);
        loadWorkflow(target.id);
      }
      const newRunId = makeRunId();
      setRunId(newRunId);
      setStepStates({});
      setGates({});
      setActiveNodeId(null);
      setExpanded(null);
      setHistorySnap(null);
      setRunning(true);
      const text = brief.trim();
      const dataFiles = [...selectedData];
      gateway.send({
        type: "execute_multi_agent",
        flowId: target.id,
        runId: newRunId,
        inputs: {
          task: text,
          prompt: text,
          query: text,
          data_files: dataFiles.length ? dataFiles.map((p) => `- ${p}`).join("\n") : "（未指定）",
        },
        model: localModel || model || undefined,
        injectRulesPrompt: rulesPromptEnabled,
      });
    } finally {
      setBusy(false);
    }
  }, [running, busy, workspaceId, brief, flow, model, localModel, rulesPromptEnabled, loadWorkflow, selectedData, quickMode]);

  const handleResumeFrom = useCallback((nodeId: string) => {
    if (!flow || !workspaceId || running || !brief.trim()) return;
    // The run whose blackboard we inherit: the one currently being viewed.
    const previousRunId = historySnap?.dbRunId ?? allRuns[0]?.id;
    if (!previousRunId) return;

    const newRunId = makeRunId();
    // Pre-populate stepStates: nodes BEFORE nodeId are marked done (inherited);
    // nodeId and after are cleared so live events paint them fresh.
    const resumeIdx = nodes.findIndex((n) => n.id === nodeId);
    const viewStates = historySnap?.stepStates ?? stepStates;
    const inheritedStates: Record<string, StepState> = {};
    nodes.slice(0, Math.max(0, resumeIdx)).forEach((n) => {
      const cur = viewStates[n.id];
      if (cur) inheritedStates[n.id] = { ...cur, status: "done" };
    });

    setRunId(newRunId);
    setStepStates(inheritedStates);
    setGates({});
    setActiveNodeId(null);
    setExpanded(null);
    setHistorySnap(null);
    setRunning(true);

    const dataFiles = [...selectedData];
    gateway.send({
      type: "execute_multi_agent",
      flowId: flow.id,
      runId: newRunId,
      inputs: {
        task: brief.trim(),
        prompt: brief.trim(),
        query: brief.trim(),
        data_files: dataFiles.length ? dataFiles.map((p) => `- ${p}`).join("\n") : "（未指定）",
      },
      model: model || undefined,
      injectRulesPrompt: rulesPromptEnabled,
      resumeFromNodeId: nodeId,
      previousRunId,
    });
  }, [flow, workspaceId, running, brief, historySnap, allRuns, nodes, stepStates, selectedData, model, rulesPromptEnabled]);

  const handleExportReport = useCallback(async () => {
    if (!flow || nodes.length === 0) return;
    // Export from the currently-viewed run (snapshot or latest completed).
    const exportRun = historySnap
      ? allRuns.find((r) => r.id === historySnap.dbRunId) ?? allRuns[0]
      : allRuns[0];
    if (!exportRun) return;

    const specNodes = nodes.filter((n) => n.spec && n.kind !== "gate");
    const sections: string[] = [];
    for (const n of specNodes) {
      try {
        const file = await api.flowRunFileGet(flow.id, exportRun.id, `specs/${n.spec}`);
        if (file?.content?.trim()) {
          sections.push(`## ${n.label}\n\n${file.content.trim()}`);
        } else {
          sections.push(`## ${n.label}\n\n*(本阶段无产出)*`);
        }
      } catch {
        sections.push(`## ${n.label}\n\n*(文件读取失败)*`);
      }
    }

    const date = new Date(exportRun.startedAt).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    const header = [
      "# AnaX 商业分析报告",
      "",
      `> 分析任务：${brief.trim() || "（未记录）"}`,
      `> 运行时间：${date}`,
      `> 状态：${exportRun.status === "success" ? "✅ 成功" : exportRun.status === "failed" ? "❌ 被阻断" : exportRun.status}`,
      "",
    ].join("\n");

    const content = `${header}---\n\n${sections.join("\n\n---\n\n")}`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anax-report-${new Date(exportRun.startedAt).toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [flow, nodes, historySnap, allRuns, brief]);

  const loadHistorySnap = useCallback(async (run: FlowRun) => {
    if (!flow || nodes.length === 0) return;
    const tree = await api.flowRunTree(flow.id, run.id).catch(() => null);
    if (!tree) return;
    const dirs = topLevelDirs(tree);
    const present = nodes.filter((n) => dirs.has(n.id));
    const states: Record<string, StepState> = {};
    present.forEach((n) => {
      states[n.id] = { status: "done", output: "" };
    });
    const restoredGates: Record<string, GateVerdict> = {};
    await Promise.all(
      present.map(async (n) => {
        if (n.kind === "gate") {
          const f = await api.flowRunFileGet(flow.id, run.id, `gates/${n.id}.json`).catch(() => null);
          if (f?.content) {
            try { restoredGates[n.id] = JSON.parse(f.content) as GateVerdict; } catch { /* ignore */ }
          }
        } else if (n.spec) {
          const f = await api.flowRunFileGet(flow.id, run.id, `specs/${n.spec}`).catch(() => null);
          if (f?.content) states[n.id] = { status: "done", output: f.content };
        }
      }),
    );
    setHistorySnap({ dbRunId: run.id, stepStates: states, gates: restoredGates });
    setExpanded(null);
  }, [flow, nodes]);

  const loadCompareSnap = useCallback(async (run: FlowRun) => {
    if (!flow || nodes.length === 0) return;
    setCompareRunId(run.id);
    const tree = await api.flowRunTree(flow.id, run.id).catch(() => null);
    if (!tree) return;
    const dirs = topLevelDirs(tree);
    const present = nodes.filter((n) => dirs.has(n.id));
    const states: Record<string, StepState> = {};
    present.forEach((n) => { states[n.id] = { status: "done", output: "" }; });
    const restoredGates: Record<string, GateVerdict> = {};
    await Promise.all(
      present.map(async (n) => {
        if (n.kind === "gate") {
          const f = await api.flowRunFileGet(flow.id, run.id, `gates/${n.id}.json`).catch(() => null);
          if (f?.content) {
            try { restoredGates[n.id] = JSON.parse(f.content) as GateVerdict; } catch { /* ignore */ }
          }
        } else if (n.spec) {
          const f = await api.flowRunFileGet(flow.id, run.id, `specs/${n.spec}`).catch(() => null);
          if (f?.content) states[n.id] = { status: "done", output: f.content };
        }
      }),
    );
    setCompareSnap({ dbRunId: run.id, stepStates: states, gates: restoredGates });
  }, [flow, nodes]);

  const enterCompareMode = useCallback(async () => {
    if (allRuns.length < 2) return;
    setCompareMode(true);
    const runA = allRuns[0]!;
    const runB = allRuns[1]!;
    if (!historySnap || historySnap.dbRunId !== runA.id) await loadHistorySnap(runA);
    await loadCompareSnap(runB);
  }, [allRuns, historySnap, loadHistorySnap, loadCompareSnap]);

  const handleAbort = useCallback(() => {
    if (!flow || !runId || !running) return;
    gateway.send({ type: "abort_multi_agent", flowId: flow.id, runId });
  }, [flow, runId, running]);

  const handlePrecheck = useCallback(() => {
    if (!workspaceId || selectedData.size === 0 || precheckState === "running" || running) return;
    const id = `pc${Date.now().toString(36)}`;
    precheckIdRef.current = id;
    setPrecheckState("running");
    setPrecheckScore(null);
    setPrecheckPass(false);
    setPrecheckSummary("");
    gateway.send({
      type: "execute_anax_precheck",
      precheckId: id,
      workspaceId,
      data_files: [...selectedData].map((p) => `- ${p}`).join("\n"),
      model: model || undefined,
    });
  }, [workspaceId, selectedData, precheckState, running, model]);

  const handleAbortPrecheck = useCallback(() => {
    if (precheckIdRef.current && precheckState === "running") {
      gateway.send({ type: "abort_anax_precheck", precheckId: precheckIdRef.current });
      setPrecheckState("idle");
    }
  }, [precheckState]);

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-400 dark:text-neutral-500">
        <div className="flex flex-col items-center gap-2">
          <Search className="h-8 w-8" strokeWidth={1.5} />
          <span className="text-[13px]">请先选择一个工作区</span>
        </div>
      </div>
    );
  }

  // When viewing a historical run, overlay its snapshot; otherwise show live state.
  const displayStepStates = historySnap?.stepStates ?? stepStates;
  const displayGates = historySnap?.gates ?? gates;

  const doneCount = nodes.filter((n) => displayStepStates[n.id]?.status === "done").length;

  function formatRunTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return isToday ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  function runStatusIcon(status: FlowRun["status"]): string {
    if (status === "success") return "✅";
    if (status === "failed") return "❌";
    if (status === "aborted") return "⚠️";
    return "🔄";
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* brief + controls */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
          <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">AnaX 商业分析</span>
          <span className="text-[11px] text-neutral-400">B → A → D → 门禁 → I → R → 复核 → X → 归档</span>
          {nodes.length > 0 && (
            <span className="ml-auto text-[11px] tabular-nums text-neutral-400">
              {doneCount}/{nodes.length}
            </span>
          )}
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={running}
          rows={2}
          placeholder="描述本次商务诉求：发生了什么？要做什么决策？成功长什么样？（如：次月留存从 42% 掉到 38%，需在月底前决定是否调整华南区拉新预算）"
          className="w-full resize-none rounded-md border border-neutral-200 bg-transparent px-2.5 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
        />

        {/* aggregate data selection — what the data-curator will actually read */}
        <div className="rounded-md border border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-2.5 py-1.5 dark:border-neutral-800">
            <Database className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
            <span className="text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">本次分析数据</span>
            <span className="text-[10.5px] text-neutral-400">已选 {selectedData.size}/{availableData.length}</span>
            <button
              onClick={registerNewData}
              disabled={running || registering}
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-sky-600 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-400 dark:hover:bg-sky-950/30"
            >
              {registering ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> : <FilePlus2 className="h-3 w-3" strokeWidth={2} />}
              登记新文件
            </button>
          </div>
          {availableData.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-neutral-400">
              工作区暂无已登记聚合数据。点「登记新文件」添加，或留空运行（分析将基于假设，大概率卡在数据门禁）。
            </p>
          ) : (
            <div className="max-h-28 overflow-y-auto px-1 py-1">
              {availableData.map((p) => {
                const checked = selectedData.has(p.path);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedData((cur) => {
                        const next = new Set(cur);
                        if (next.has(p.path)) next.delete(p.path);
                        else next.add(p.path);
                        return next;
                      });
                      setPrecheckState("idle");
                    }}
                    disabled={running}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800/50"
                    title={p.path}
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                        checked
                          ? "border-sky-500 bg-sky-500 text-white"
                          : "border-neutral-300 dark:border-neutral-600",
                      )}
                    >
                      {checked && <CheckCircle2 className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-neutral-600 dark:text-neutral-400">{p.path}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mode toggle: full (8-stage BADIR) vs quick (3-stage, medium confidence) */}
        <div className="flex items-center gap-1 rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
          <button
            onClick={() => !running && setQuickMode(false)}
            disabled={running}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
              !quickMode
                ? "bg-sky-500 text-white"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
            )}
          >
            <Play className="h-2.5 w-2.5" strokeWidth={2} />
            完整分析
          </button>
          <button
            onClick={() => !running && setQuickMode(true)}
            disabled={running}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
              quickMode
                ? "bg-amber-500 text-white"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
            )}
          >
            <Zap className="h-2.5 w-2.5" strokeWidth={2} />
            快速分析
          </button>
        </div>

        {/* Model selector — AnaX-local, avoids having to switch in Chat tab */}
        {models.length > 0 && (
          <select
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            disabled={running}
            className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[11.5px] text-neutral-700 focus:outline-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {localModel === "" && <option value="">（默认模型）</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.model || m.id}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={handleAbort}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-rose-500 px-3 text-[12.5px] font-medium text-white hover:bg-rose-600"
            >
              <Square className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />
              强制停止
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!brief.trim() || busy}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors",
                !brief.trim() || busy
                  ? "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                  : quickMode
                    ? "bg-amber-500 text-white hover:bg-amber-600"
                    : "bg-sky-500 text-white hover:bg-sky-600",
              )}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : quickMode ? (
                <Zap className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {quickMode ? "快速分析" : "启动分析"}
            </button>
          )}
          {/* Data quality precheck — only in full mode when data is selected */}
          {!running && !quickMode && selectedData.size > 0 && (
            precheckState === "running" ? (
              <button
                onClick={handleAbortPrecheck}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                预检中…
              </button>
            ) : (
              <button
                onClick={handlePrecheck}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-[12px] text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Wrench className="h-3.5 w-3.5" strokeWidth={2} />
                预检数据
              </button>
            )
          )}
          {!running && !quickMode && selectedData.size === 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
              <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />
              未选数据，分析将基于假设，大概率卡在数据门禁
            </span>
          )}
          {!running && quickMode && (
            <span className="text-[11px] text-amber-600 dark:text-amber-500">
              3 阶段 · medium 置信度 · 结论仅供参考
            </span>
          )}
          {!flow && (
            <span className="text-[11px] text-neutral-400">
              首次启动将自动创建 {quickMode ? "AnaX 快速分析" : "AnaX"} 流程
            </span>
          )}
        </div>

        {/* Precheck result card */}
        {(precheckState === "done" || precheckState === "error") && (
          <div className={cn(
            "rounded-md border px-3 py-2 text-[11.5px]",
            precheckState === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300"
              : precheckPass
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                : "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20",
          )}>
            {precheckState === "error" ? (
              <span>预检失败：{precheckSummary}</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className={cn(
                  "shrink-0 text-[15px] font-bold tabular-nums",
                  precheckPass ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                )}>
                  {precheckScore !== null ? `${precheckScore.toFixed(1)}/10` : "—"}
                </span>
                <span className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  precheckPass
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                )}>
                  {precheckPass ? "预计通过门禁" : "预计被门禁拦截"}
                </span>
                {precheckSummary && (
                  <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-400" title={precheckSummary}>
                    {precheckSummary}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* run history pill bar + export — shown when ≥ 1 run exists */}
      {allRuns.length >= 1 && (
        compareMode ? (
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-800">
            <span className="shrink-0 text-[10.5px] font-semibold text-sky-600 dark:text-sky-400">↔ 对比</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-neutral-400">A</span>
              <select
                value={historySnap?.dbRunId ?? allRuns[0]?.id ?? ""}
                onChange={(e) => { const r = allRuns.find((x) => x.id === e.target.value); if (r) void loadHistorySnap(r); }}
                className="rounded border border-sky-200 bg-white px-1.5 py-0.5 text-[10.5px] dark:border-sky-800 dark:bg-neutral-900"
              >
                {allRuns.map((run, idx) => (
                  <option key={run.id} value={run.id}>第{allRuns.length - idx}次 {formatRunTime(run.startedAt)}</option>
                ))}
              </select>
            </div>
            <span className="text-[10px] text-neutral-300 dark:text-neutral-600">vs</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-neutral-400">B</span>
              <select
                value={compareRunId ?? ""}
                onChange={(e) => { const r = allRuns.find((x) => x.id === e.target.value); if (r) void loadCompareSnap(r); }}
                className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[10.5px] dark:border-violet-800 dark:bg-neutral-900"
              >
                {allRuns.map((run, idx) => (
                  <option key={run.id} value={run.id}>第{allRuns.length - idx}次 {formatRunTime(run.startedAt)}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => { setCompareMode(false); setCompareSnap(null); setCompareRunId(null); }}
              className="ml-auto shrink-0 rounded border border-neutral-200 px-2 py-0.5 text-[10.5px] text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              退出对比
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-800">
            <span className="shrink-0 text-[10.5px] text-neutral-400">历史</span>
            {/* live view pill — only shown when there are ≥ 2 runs to switch between */}
            {allRuns.length >= 2 && (
              <button
                onClick={() => setHistorySnap(null)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors",
                  !historySnap
                    ? "border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
              >
                🔴 实时
              </button>
            )}
            {allRuns.map((run, idx) => {
              const isSelected = historySnap?.dbRunId === run.id;
              return (
                <button
                  key={run.id}
                  onClick={() => void loadHistorySnap(run)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors",
                    isSelected
                      ? "border-neutral-500 bg-neutral-100 text-neutral-700 dark:border-neutral-500 dark:bg-neutral-800 dark:text-neutral-200"
                      : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800",
                  )}
                  title={new Date(run.startedAt).toLocaleString("zh-CN")}
                >
                  {runStatusIcon(run.status)} 第{allRuns.length - idx}次 {formatRunTime(run.startedAt)}
                </button>
              );
            })}
            {allRuns.length >= 2 && !running && (
              <button
                onClick={() => void enterCompareMode()}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-neutral-200 px-2 py-0.5 text-[10.5px] text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                ↔ 对比
              </button>
            )}
            <button
              onClick={() => void handleExportReport()}
              disabled={running}
              title="将本次分析各阶段产出合并为 Markdown 文件下载"
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-neutral-200 px-2 py-0.5 text-[10.5px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <Download className="h-3 w-3" strokeWidth={2} />
              导出报告
            </button>
          </div>
        )
      )}

      {/* stage list */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {nodes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
            填写商务诉求并启动分析，即可生成 8 阶段 BADIR 流程
          </div>
        ) : (
          nodes.map((n) => {
            const state = displayStepStates[n.id];
            const gate = displayGates[n.id];
            const isGate = n.kind === "gate";
            const isActive = !historySnap && activeNodeId === n.id;
            const isExpanded = expanded === n.id;
            const stateB = compareMode ? compareSnap?.stepStates[n.id] : undefined;
            const hasDiff = compareMode && compareSnap && (state?.output ?? "") !== (stateB?.output ?? "");
            return (
              <div
                key={n.id}
                className={cn(
                  "rounded-md border",
                  isActive ? "border-sky-300 dark:border-sky-800" : "border-neutral-200 dark:border-neutral-700",
                )}
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : n.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[12px]">
                    {state?.status === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.25} />
                    ) : state?.status === "failed" ? (
                      <XCircle className="h-4 w-4 text-rose-500" strokeWidth={2.25} />
                    ) : state?.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-sky-500" strokeWidth={2.25} />
                    ) : (
                      <span>{n.icon ?? "•"}</span>
                    )}
                  </span>
                  <span className="text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">{n.label}</span>
                  {n.role && (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      {n.role}
                    </span>
                  )}
                  {gate && (
                    <span
                      className={cn(
                        "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        gate.verdict === "pass"
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
                      )}
                    >
                      {gate.verdict === "pass" ? <ShieldCheck className="h-3 w-3" strokeWidth={2.25} /> : <ShieldAlert className="h-3 w-3" strokeWidth={2.25} />}
                      {gate.verdict === "pass" ? "PASS" : `BLOCKED · ${gate.blockers}`}
                    </span>
                  )}
                  {compareMode && compareSnap && !isGate && (
                    <span className={cn("ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold", hasDiff ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400")}>
                      {hasDiff ? "≠ 有差异" : "✓ 相同"}
                    </span>
                  )}
                  {!gate && (
                    <span className={cn("shrink-0 text-[10px] text-neutral-400", compareMode ? "" : "ml-auto")}>
                      {state?.status === "running" ? "执行中" : state?.status === "done" ? "完成" : state?.status === "failed" ? "失败" : isGate ? "门禁" : "待执行"}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                    {gate && (
                      <div className="mb-2 flex flex-col gap-1.5">
                        {gate.summary && <p className="text-[12px] text-neutral-600 dark:text-neutral-300">{gate.summary}</p>}
                        {gate.reasons.length > 0 ? (
                          <>
                            <ul className="flex flex-col gap-0.5">
                              {gate.reasons.map((r, i) => (
                                <li key={i} className="text-[11.5px] text-rose-600 dark:text-rose-400">✖ {r}</li>
                              ))}
                            </ul>
                            {gate.verdict === "blocked" && (() => {
                              const hints = hintsForGate(gate);
                              if (hints.length === 0) return null;
                              return (
                                <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                                  <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                                    <Wrench className="h-3 w-3 shrink-0" strokeWidth={2} />
                                    如何修复
                                  </div>
                                  <ul className="flex flex-col gap-1">
                                    {hints.map((h, i) => (
                                      <li key={i} className="text-[11px] leading-4.5 text-amber-800 dark:text-amber-300">
                                        → {h}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })()}
                          </>
                        ) : (
                          <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400">✓ 无红线违规，门禁通过</p>
                        )}
                      </div>
                    )}
                    {/* Resume button: only on non-gate nodes when run has ended and there's a base run */}
                    {!isGate && !running && (historySnap || allRuns.length > 0) && (state?.status === "done" || state?.status === "failed") && (
                      <div className="mb-2 flex justify-end">
                        <button
                          onClick={() => handleResumeFrom(n.id)}
                          disabled={!brief.trim()}
                          title={brief.trim() ? "从此节点重新执行（继承前段输出）" : "请先填写商务诉求"}
                          className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-0.5 text-[10.5px] text-neutral-500 hover:border-sky-400 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-sky-600 dark:hover:text-sky-400"
                        >
                          ↩ 从此重跑
                        </button>
                      </div>
                    )}
                    {compareMode && compareSnap && !isGate ? (
                      <div className="grid grid-cols-2 divide-x divide-neutral-100 dark:divide-neutral-800">
                        <div className="pr-3">
                          <p className="mb-1.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">Run A</p>
                          {state?.output
                            ? <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]"><Markdown>{state.output}</Markdown></div>
                            : <p className="text-[11.5px] text-neutral-400">无产出</p>}
                        </div>
                        <div className="pl-3">
                          <p className="mb-1.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">Run B</p>
                          {stateB?.output
                            ? <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]"><Markdown>{stateB.output}</Markdown></div>
                            : <p className="text-[11.5px] text-neutral-400">无产出</p>}
                        </div>
                      </div>
                    ) : state?.output ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]">
                        <Markdown>{state.output}</Markdown>
                      </div>
                    ) : (
                      <p className="text-[11.5px] text-neutral-400">
                        {state?.status === "running" ? "等待节点输出…" : "暂无产出"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Gate thresholds config — collapsible, shown only when not running */}
      {!running && gateConfig && (
        <div className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-700">
          <button
            onClick={() => setGateConfigOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[12px] font-medium text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
          >
            <span>⚙ 门禁阈值设置</span>
            <span className="text-[10px] text-neutral-400">{gateConfigOpen ? "▲" : "▼"}</span>
          </button>
          {gateConfigOpen && (
            <div className="border-t border-neutral-200 px-4 pb-4 pt-3 dark:border-neutral-700">
              <p className="mb-3 text-[11px] text-neutral-400">调整后在下次分析启动时生效。降低阈值会放松门禁，提高阈值会更严格。</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-500 dark:text-neutral-400">最低置信度</label>
                  <select
                    value={gateConfig.minConfidence}
                    onChange={(e) => saveGateConfig({ minConfidence: e.target.value as AnaxGateConfig["minConfidence"] })}
                    disabled={gateConfigSaving}
                    className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <option value="low">low（宽松）</option>
                    <option value="medium">medium（默认）</option>
                    <option value="high">high（严格）</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-500 dark:text-neutral-400">最少证据数</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={gateConfig.minEvidenceCount}
                    onChange={(e) => saveGateConfig({ minEvidenceCount: Number(e.target.value) })}
                    disabled={gateConfigSaving}
                    className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-neutral-500 dark:text-neutral-400">数据质量最低分 (0-10)</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={gateConfig.minDataQualityScore}
                    onChange={(e) => saveGateConfig({ minDataQualityScore: Number(e.target.value) })}
                    disabled={gateConfigSaving}
                    className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>
              </div>
              {gateConfigSaving && <p className="mt-2 text-[11px] text-neutral-400">保存中…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
