import { useState, useCallback, useRef } from "react";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  Play,
  Tag,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  FolderOpen,
  Link2,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type {
  ProjectDetailReadModel,
  EvidenceRef,
  RunRef,
  VersionRef,
  GateType,
  ProjectStage,
  CommandAffordance,
  CapabilitiesResponse,
  ClosureCommandResult,
} from "@/types/analysis-projects";
import {
  PROJECT_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STAGE_LABELS,
  RUN_STATUS_LABELS,
  GATE_TYPE_LABELS,
  SAFETY_CLASS_LABELS,
  SAFETY_CLASS_COLORS,
  businessStage,
  businessStageProgress,
  formatRelativeTime,
  formatBytes,
  commandLabel,
  BUSINESS_STAGES,
  STAGE_NEXT_HINTS,
} from "./shared";

const NODE_COMMANDS: Record<string, readonly string[]> = {
  submit: ["request.submit"],
  confirm: ["requirement.generate", "requirement.decide_confirmation", "plan.generate", "plan.decide_confirmation"],
  prepare: [],
  execute: ["run.abort", "run.retry"],
  review: ["report.decide_review"],
  close: ["closure.initiate_cycle", "closure.record_s31_translation", "closure.record_s32_deployment", "closure.record_s33_execution", "closure.append_s34_feedback", "closure.record_s35_evaluation", "closure.record_s36_trigger"],
};

interface Props {
  data: ProjectDetailReadModel;
  workspaceId: string;
  capabilities: CapabilitiesResponse | null;
  onRefresh: () => void;
  onBack: () => void;
  onNavigateToClosure?: () => void;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="shrink-0 w-16 text-[11px] text-neutral-400">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-neutral-700 dark:text-neutral-300">
        {children}
      </span>
    </div>
  );
}

type StageStatus = "done" | "active" | "pending";

function getStageStatus(
  stage: ProjectStage,
  currentStage: ProjectStage,
): StageStatus {
  const allStages: ProjectStage[] = [
    "S1.1", "S1.2", "S1.4", "S2.1", "S2.2", "S2.3", "S2.4", "S2.5", "S2.6",
    "S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6",
  ];
  const currentIdx = allStages.indexOf(currentStage);
  const stageIdx = allStages.indexOf(stage);
  if (stageIdx < currentIdx) return "done";
  if (stageIdx === currentIdx) return "active";
  return "pending";
}

function StageDot({ status }: { status: StageStatus }) {
  if (status === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  }
  if (status === "active") {
    return <Clock className="h-3.5 w-3.5 text-blue-500" />;
  }
  return <Circle className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-600" />;
}

function InteractiveFlowTrack({
  currentStage,
  cmds,
  analysisRequest,
  currentRequirement,
  currentPlan,
  latestRun,
  pendingGate,
  inputEvidence,
  workspaceId,
  projectId,
  expectedUpdatedAt,
  capabilities,
  onRefresh,
  onNavigateToClosure,
}: {
  currentStage: ProjectStage;
  cmds: readonly CommandAffordance[];
  analysisRequest: ProjectDetailReadModel["data"]["analysisRequest"];
  currentRequirement: VersionRef | null;
  currentPlan: VersionRef | null;
  latestRun: RunRef | null;
  pendingGate: GateType | null;
  inputEvidence: readonly EvidenceRef[];
  workspaceId: string;
  projectId: string;
  expectedUpdatedAt: string;
  capabilities: CapabilitiesResponse | null;
  onRefresh: () => void;
  onNavigateToClosure?: () => void;
}) {
  const currentBusinessStage = businessStage(currentStage);
  const currentIdx = currentBusinessStage
    ? BUSINESS_STAGES.findIndex((b) => b.id === currentBusinessStage.id)
    : -1;

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (currentBusinessStage) initial.add(currentBusinessStage.id);
    return initial;
  });

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  return (
    <div className="relative py-1">
      {BUSINESS_STAGES.map((stage, idx) => {
        const isDone = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isLast = idx === BUSINESS_STAGES.length - 1;
        const isExpanded = expandedNodes.has(stage.id);
        const nodeCmds = cmds.filter((c) => NODE_COMMANDS[stage.id]?.includes(c.commandType));
        const availableCmdCount = nodeCmds.filter((c) => c.available).length;
        const totalCmdCount = nodeCmds.length;

        return (
          <div key={stage.id} className="relative flex gap-3">
            {!isLast && (
              <div
                className={cn(
                  "absolute left-[11px] top-[28px] bottom-0 w-[2px]",
                  isDone
                    ? "bg-green-300 dark:bg-green-800"
                    : "bg-neutral-200 dark:bg-neutral-700",
                )}
              />
            )}
            <div className="relative z-10 shrink-0 pt-0.5">
              {isDone ? (
                <CheckCircle2 className="h-[22px] w-[22px] text-green-500" />
              ) : isCurrent ? (
                <Clock className="h-[22px] w-[22px] text-blue-500" />
              ) : (
                <Circle className="h-[22px] w-[22px] text-neutral-300 dark:text-neutral-600" />
              )}
            </div>
            <div className={cn("min-w-0 flex-1", isLast ? "pb-0" : "pb-4")}>
              <button
                onClick={() => toggleNode(stage.id)}
                className="flex w-full items-center gap-1 text-left"
              >
                <div
                  className={cn(
                    "text-[13px]",
                    isDone
                      ? "text-green-700 dark:text-green-400"
                      : isCurrent
                        ? "font-medium text-blue-700 dark:text-blue-400"
                        : "text-neutral-400 dark:text-neutral-500",
                  )}
                >
                  {stage.label}
                </div>
                {!isExpanded && totalCmdCount > 0 && (
                  <span className="ml-1 rounded bg-neutral-100 px-1 py-0.5 text-[9px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {availableCmdCount}/{totalCmdCount}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-neutral-400">
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
              {isCurrent && (
                <div className="mt-0.5 text-[11px] text-blue-600 dark:text-blue-400">
                  当前环节
                </div>
              )}
              <div className="mt-0.5 text-[10px] text-neutral-400">
                {stage.stages.join(" → ")}
              </div>

              {isExpanded && (
                <div className="mt-2 space-y-2 rounded-md border border-neutral-100 bg-neutral-50/50 p-2 dark:border-neutral-800 dark:bg-neutral-900/30">
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    {stage.stages.map((s) => {
                      const status = getStageStatus(s, currentStage);
                      const sHint = STAGE_NEXT_HINTS[s];
                      return (
                        <div
                          key={s}
                          className={cn(
                            "flex items-center gap-1 rounded border px-1.5 py-0.5",
                            status === "done"
                              ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
                              : status === "active"
                                ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20"
                                : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900",
                          )}
                        >
                          <StageDot status={status} />
                          <span
                            className={cn(
                              "text-[10px]",
                              status === "done"
                                ? "text-green-700 dark:text-green-400"
                                : status === "active"
                                  ? "font-medium text-blue-700 dark:text-blue-400"
                                  : "text-neutral-500 dark:text-neutral-400",
                            )}
                          >
                            {s} {PROJECT_STAGE_LABELS[s]}
                          </span>
                          {status === "active" && sHint && (
                            <span className="text-[9px] text-blue-500">· {sHint}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <NodeActions
                    nodeId={stage.id}
                    nodeCmds={nodeCmds}
                    analysisRequest={analysisRequest}
                    currentRequirement={currentRequirement}
                    currentPlan={currentPlan}
                    latestRun={latestRun}
                    pendingGate={pendingGate}
                    inputEvidence={inputEvidence}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    expectedUpdatedAt={expectedUpdatedAt}
                    capabilities={capabilities}
                    onRefresh={onRefresh}
                    onNavigateToClosure={onNavigateToClosure}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeActions({
  nodeId,
  nodeCmds,
  analysisRequest,
  currentRequirement,
  currentPlan,
  latestRun,
  pendingGate,
  inputEvidence,
  workspaceId,
  projectId,
  expectedUpdatedAt,
  capabilities,
  onRefresh,
  onNavigateToClosure,
}: {
  nodeId: string;
  nodeCmds: readonly CommandAffordance[];
  analysisRequest: ProjectDetailReadModel["data"]["analysisRequest"];
  currentRequirement: VersionRef | null;
  currentPlan: VersionRef | null;
  latestRun: RunRef | null;
  pendingGate: GateType | null;
  inputEvidence: readonly EvidenceRef[];
  workspaceId: string;
  projectId: string;
  expectedUpdatedAt: string;
  capabilities: CapabilitiesResponse | null;
  onRefresh: () => void;
  onNavigateToClosure?: () => void;
}) {
  if (nodeId === "submit") {
    return (
      <div className="space-y-1.5">
        {analysisRequest ? (
          <div className="text-[10px] text-neutral-500">
            需求已提交 · {formatRelativeTime(analysisRequest.submittedAt)}
            {analysisRequest.locale && <span> · {analysisRequest.locale}</span>}
          </div>
        ) : (
          <div className="text-[10px] text-neutral-400">尚未提交业务需求</div>
        )}
        {nodeCmds.map((cmd) => (
          <DisabledCommandChip key={cmd.commandType} cmd={cmd} />
        ))}
      </div>
    );
  }

  if (nodeId === "confirm") {
    return (
      <div className="space-y-2">
        <GenerateRequirementButton
          workspaceId={workspaceId}
          projectId={projectId}
          analysisRequest={analysisRequest}
          currentRequirement={currentRequirement}
          expectedUpdatedAt={expectedUpdatedAt}
          capabilities={capabilities}
          onRefresh={onRefresh}
        />
        {currentRequirement && (
          <VersionInfo version={currentRequirement} label="当前需求版本" />
        )}
        {currentPlan && (
          <VersionInfo version={currentPlan} label="当前计划版本" />
        )}
        {pendingGate && (pendingGate === "requirement_confirmation" || pendingGate === "plan_confirmation") && (
          <GateInfo gateType={pendingGate} />
        )}
        {nodeCmds.filter((c) => c.commandType !== "requirement.generate").map((cmd) => (
          <DisabledCommandChip key={cmd.commandType} cmd={cmd} />
        ))}
      </div>
    );
  }

  if (nodeId === "prepare") {
    const rawCount = inputEvidence.filter((ev) => ev.safetyClass === "restricted_raw").length;
    const cleanCount = inputEvidence.filter((ev) => ev.safetyClass === "controlled").length;
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] text-neutral-500">
          原始数据: {rawCount} 项 · 受控数据: {cleanCount} 项
        </div>
        {inputEvidence.length === 0 && (
          <div className="text-[10px] text-neutral-400">暂无已登记材料</div>
        )}
      </div>
    );
  }

  if (nodeId === "execute") {
    return (
      <div className="space-y-1.5">
        {latestRun ? (
          <RunInfo run={latestRun} />
        ) : (
          <div className="text-[10px] text-neutral-400">暂无执行记录</div>
        )}
        {nodeCmds.map((cmd) => (
          <DisabledCommandChip key={cmd.commandType} cmd={cmd} />
        ))}
      </div>
    );
  }

  if (nodeId === "review") {
    return (
      <div className="space-y-1.5">
        {pendingGate === "report_review" && <GateInfo gateType={pendingGate} />}
        {nodeCmds.map((cmd) => (
          <DisabledCommandChip key={cmd.commandType} cmd={cmd} />
        ))}
        {nodeCmds.length === 0 && (
          <div className="text-[10px] text-neutral-400">报告审核操作待后续扩展</div>
        )}
      </div>
    );
  }

  if (nodeId === "close") {
    return (
      <div className="space-y-1.5">
        {onNavigateToClosure && (
          <button
            onClick={onNavigateToClosure}
            className="w-full rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-left text-[11px] text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-400 dark:hover:border-violet-700"
          >
            进入业务闭合面板
          </button>
        )}
        {nodeCmds.map((cmd) => (
          <DisabledCommandChip key={cmd.commandType} cmd={cmd} />
        ))}
      </div>
    );
  }

  return null;
}

function DisabledCommandChip({ cmd }: { cmd: CommandAffordance }) {
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11px]",
        cmd.available
          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-400"
          : "border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{commandLabel(cmd.commandType)}</span>
      </div>
      {!cmd.available && cmd.unavailableReasons.length > 0 && (
        <div className="mt-0.5 text-[9px] text-neutral-400">
          {cmd.unavailableReasons[0]}
        </div>
      )}
      {cmd.available && (
        <div className="mt-0.5 text-[9px] text-neutral-400">API 尚未接入</div>
      )}
    </div>
  );
}

function GateInfo({ gateType }: { gateType: GateType }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="font-medium text-amber-700 dark:text-amber-400">
          {GATE_TYPE_LABELS[gateType] ?? gateType}
        </span>
      </div>
      <div className="mt-0.5 text-amber-600 dark:text-amber-500">
        等待审核决定
      </div>
    </div>
  );
}

function RunInfo({ run }: { run: RunRef }) {
  const statusColor =
    run.currentRunStatus === "succeeded"
      ? "text-green-600 dark:text-green-400"
      : run.currentRunStatus === "failed"
        ? "text-red-600 dark:text-red-400"
        : run.currentRunStatus === "running"
          ? "text-blue-600 dark:text-blue-400"
          : "text-neutral-500";
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className={cn("font-medium", statusColor)}>
        {RUN_STATUS_LABELS[run.currentRunStatus] ?? run.currentRunStatus}
      </span>
      <span className="text-neutral-400">Run #{run.runOrdinal}</span>
      <span className="text-neutral-400">
        {PROJECT_STAGE_LABELS[run.currentAnalysisStage as keyof typeof PROJECT_STAGE_LABELS] ?? run.currentAnalysisStage}
      </span>
      {run.endedAt && (
        <span className="text-neutral-400">
          {formatRelativeTime(run.endedAt)}
        </span>
      )}
    </div>
  );
}

function VersionInfo({
  version,
  label,
}: {
  version: VersionRef;
  label: string;
}) {
  return (
    <div className="text-[11px]">
      <span className="font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </span>
      <span className="ml-2 text-neutral-400">
        v{version.versionOrdinal} · {formatRelativeTime(version.createdAt)} ·{" "}
        {version.createdBy.displayName}
      </span>
    </div>
  );
}

function EvidenceRow({ ev }: { ev: EvidenceRef }) {
  return (
    <div className="space-y-0.5 border-b border-neutral-100 py-1.5 last:border-b-0 dark:border-neutral-800">
      <div className="flex items-center gap-2 text-[11px]">
        <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
        <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">
          {ev.displayName}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
            SAFETY_CLASS_COLORS[ev.safetyClass],
          )}
        >
          {SAFETY_CLASS_LABELS[ev.safetyClass]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-[9px] text-neutral-400">
        <span>{formatBytes(ev.byteSize)}</span>
        <span className="truncate font-mono" title={ev.contentSha256}>
          sha256:{ev.contentSha256.slice(0, 8)}
        </span>
        <span>{formatRelativeTime(ev.createdAt)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate requirement button — real API integration
// ---------------------------------------------------------------------------

function GenerateRequirementButton({
  workspaceId,
  projectId,
  analysisRequest,
  currentRequirement,
  expectedUpdatedAt,
  capabilities,
  onRefresh,
}: {
  workspaceId: string;
  projectId: string;
  analysisRequest: { analysisRequestId: string } | null;
  currentRequirement: VersionRef | null;
  expectedUpdatedAt: string;
  capabilities: CapabilitiesResponse | null;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const engineAvailable = capabilities?.data.engine.status === "available";
  const hasAnalysisRequest = analysisRequest != null;
  const canGenerate = hasAnalysisRequest && engineAvailable && !loading;

  let disabledReason = "";
  if (!hasAnalysisRequest) {
    disabledReason = "需要先提交业务需求";
  } else if (!engineAvailable) {
    disabledReason = "分析引擎不可用";
  }

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, string> = {
        expectedProjectUpdatedAt: expectedUpdatedAt,
      };
      if (currentRequirement) {
        body.previousRequirementVersionId = currentRequirement.versionId;
      }
      const res: ClosureCommandResult = await api.generateRequirement(workspaceId, projectId, body);
      if (res.kind === "executed" || res.kind === "replayed_success") {
        setResult({ kind: "success", message: "结构化需求已生成" });
        onRefresh();
      } else {
        setResult({ kind: "error", message: res.errorSummary ?? "生成失败" });
      }
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [canGenerate, workspaceId, projectId, expectedUpdatedAt, currentRequirement, onRefresh]);

  return (
    <div className="space-y-2">
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className={cn(
          "w-full rounded-md border px-3 py-2 text-left text-[12px] transition-colors",
          canGenerate
            ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/20 dark:text-blue-400 dark:hover:bg-blue-950/30"
            : "border-neutral-300 bg-neutral-100 text-neutral-500 cursor-not-allowed dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
        )}
      >
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          <span className="font-medium">
            {loading ? "生成中…" : currentRequirement ? "重新生成结构化需求" : "生成结构化需求"}
          </span>
        </div>
        {!canGenerate && disabledReason && (
          <div className="mt-1 text-[10px] text-neutral-400">
            {disabledReason}
          </div>
        )}
      </button>
      {result && (
        <div
          className={cn(
            "rounded-md px-2 py-1.5 text-[11px]",
            result.kind === "success"
              ? "border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/20 dark:text-green-400"
              : "border border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400",
          )}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// More actions dropdown — real API integration
// ---------------------------------------------------------------------------

function MoreActionsMenu({
  workspaceId,
  projectId,
  cmds,
  project,
  onRefresh,
}: {
  workspaceId: string;
  projectId: string;
  cmds: readonly CommandAffordance[];
  project: ProjectDetailReadModel["data"]["project"];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ kind: "success" | "error"; message: string; cmd: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const managementCmds = cmds.filter((c) =>
    ["project.update_metadata", "project.delete_draft", "project.cancel", "project.archive", "project.unarchive", "project.reopen"].includes(c.commandType),
  );

  const isDangerous = (cmdType: string) =>
    ["project.delete_draft", "project.cancel", "project.archive"].includes(cmdType);

  const executeCommand = useCallback(async (cmdType: string) => {
    setLoading(cmdType);
    setActionResult(null);
    try {
      let res: ClosureCommandResult;
      const expectedUpdatedAt = project.updatedAt;
      switch (cmdType) {
        case "project.delete_draft":
          res = await api.deleteDraftProject(workspaceId, projectId, { confirmPermanentDeletion: true });
          break;
        case "project.cancel":
          res = await api.cancelProject(workspaceId, projectId, { expectedUpdatedAt });
          break;
        case "project.archive":
          res = await api.archiveProject(workspaceId, projectId, { expectedUpdatedAt });
          break;
        case "project.unarchive":
          res = await api.unarchiveProject(workspaceId, projectId, { expectedUpdatedAt });
          break;
        default:
          return;
      }
      if (res.kind === "executed" || res.kind === "replayed_success") {
        setActionResult({ kind: "success", message: `${commandLabel(cmdType)} 成功`, cmd: cmdType });
        setConfirmAction(null);
        onRefresh();
      } else {
        setActionResult({ kind: "error", message: res.errorSummary ?? "操作失败", cmd: cmdType });
      }
    } catch (err) {
      setActionResult({ kind: "error", message: err instanceof Error ? err.message : String(err), cmd: cmdType });
    } finally {
      setLoading(null);
    }
  }, [workspaceId, projectId, project.updatedAt, onRefresh]);

  const executeUpdate = useCallback(async () => {
    if (!editTitle.trim() || !editSlug.trim()) return;
    setLoading("project.update_metadata");
    setActionResult(null);
    try {
      const res = await api.updateProject(workspaceId, projectId, {
        title: editTitle.trim(),
        slug: editSlug.trim(),
        expectedUpdatedAt: project.updatedAt,
      });
      if (res.kind === "executed" || res.kind === "replayed_success") {
        setActionResult({ kind: "success", message: "更新信息成功", cmd: "project.update_metadata" });
        setEditOpen(false);
        onRefresh();
      } else {
        setActionResult({ kind: "error", message: res.errorSummary ?? "更新失败", cmd: "project.update_metadata" });
      }
    } catch (err) {
      setActionResult({ kind: "error", message: err instanceof Error ? err.message : String(err), cmd: "project.update_metadata" });
    } finally {
      setLoading(null);
    }
  }, [workspaceId, projectId, editTitle, editSlug, project.updatedAt, onRefresh]);

  if (managementCmds.length === 0) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => { setOpen(!open); setActionResult(null); }}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <MoreVertical className="h-3.5 w-3.5" />
        更多操作
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {managementCmds.map((cmd) => {
            const isLoading = loading === cmd.commandType;
            const isConfirming = confirmAction === cmd.commandType;
            const dangerous = isDangerous(cmd.commandType);
            return (
              <div key={cmd.commandType} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-800">
                {cmd.commandType === "project.update_metadata" ? (
                  <div>
                    <button
                      onClick={() => {
                        if (!cmd.available) return;
                        setEditOpen(!editOpen);
                        setEditTitle(project.title);
                        setEditSlug(project.slug);
                      }}
                      disabled={!cmd.available}
                      className={cn(
                        "w-full px-3 py-2 text-left text-[12px]",
                        cmd.available
                          ? "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                          : "cursor-not-allowed text-neutral-400 dark:text-neutral-500",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                        <span>{commandLabel(cmd.commandType)}</span>
                      </div>
                      {!cmd.available && (
                        <div className="text-[10px] text-neutral-400">
                          {cmd.unavailableReasons[0] ?? "不可用"}
                        </div>
                      )}
                    </button>
                    {editOpen && cmd.available && (
                      <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="标题"
                            className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
                          />
                          <input
                            type="text"
                            value={editSlug}
                            onChange={(e) => setEditSlug(e.target.value)}
                            placeholder="slug"
                            className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-mono dark:border-neutral-700 dark:bg-neutral-800"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={executeUpdate}
                              disabled={isLoading}
                              className="rounded bg-blue-600 px-2 py-0.5 text-[10px] text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {isLoading ? "保存中…" : "保存"}
                            </button>
                            <button
                              onClick={() => setEditOpen(false)}
                              className="rounded px-2 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (!cmd.available) return;
                      if (dangerous && !isConfirming) {
                        setConfirmAction(cmd.commandType);
                        return;
                      }
                      if (isConfirming) {
                        void executeCommand(cmd.commandType);
                      }
                    }}
                    disabled={!cmd.available || isLoading}
                    className={cn(
                      "w-full px-3 py-2 text-left text-[12px]",
                      cmd.available
                        ? dangerous
                          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                          : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        : "cursor-not-allowed text-neutral-400 dark:text-neutral-500",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                      <span>{commandLabel(cmd.commandType)}</span>
                      {dangerous && cmd.available && !isConfirming && (
                        <span className="text-[10px] text-neutral-400">点击确认</span>
                      )}
                      {isConfirming && (
                        <span className="text-[10px] text-red-500">再次点击确认</span>
                      )}
                    </div>
                    {!cmd.available && (
                      <div className="text-[10px] text-neutral-400">
                        {cmd.unavailableReasons[0] ?? "不可用"}
                      </div>
                    )}
                  </button>
                )}
              </div>
            );
          })}
          {actionResult && (
            <div
              className={cn(
                "mx-2 mb-2 rounded-md px-2 py-1.5 text-[11px]",
                actionResult.kind === "success"
                  ? "border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/20 dark:text-green-400"
                  : "border border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400",
              )}
            >
              {actionResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence upload panel
// ---------------------------------------------------------------------------

function EvidenceUploadPanel({
  workspaceId,
  projectId,
  safetyClass,
  safetyHandlingPolicy,
  label,
  onClose,
  onUploaded,
}: {
  workspaceId: string;
  projectId: string;
  safetyClass: "restricted_raw" | "controlled";
  safetyHandlingPolicy: "local_transform_required" | "controlled_or_derived_allowed";
  label: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [declaredDataScope, setDeclaredDataScope] = useState("");
  const [usageConstraints, setUsageConstraints] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !displayName) {
      setDisplayName(f.name);
    }
  }, [displayName]);

  const canUpload = file != null && displayName.trim().length > 0 && declaredDataScope.trim().length > 0 && !loading;

  const handleUpload = useCallback(async () => {
    if (!canUpload || !file) return;
    setLoading(true);
    setResult(null);
    try {
      const metadata = {
        displayName: displayName.trim(),
        declaredDataScope: declaredDataScope.trim(),
        usageConstraints: usageConstraints.trim() ? usageConstraints.trim().split(/\s*,\s*/).filter(Boolean) : ["analysis_input"],
        safetyHandlingPolicy,
        safetyClass,
        declaredMediaType: file.type || "application/octet-stream",
        declaredByteSize: file.size,
      };
      const res = await api.uploadEvidence(workspaceId, projectId, metadata, file);
      if (res.kind === "executed" || res.kind === "replayed_success") {
        setResult({ kind: "success", message: "上传成功" });
        setFile(null);
        setDisplayName("");
        setDeclaredDataScope("");
        setUsageConstraints("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        onUploaded();
      } else {
        setResult({ kind: "error", message: res.errorSummary ?? "上传失败" });
      }
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [canUpload, file, workspaceId, projectId, displayName, declaredDataScope, usageConstraints, safetyClass, safetyHandlingPolicy, onUploaded]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
          上传材料 — {label}
        </span>
        <button onClick={onClose} className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-neutral-500">文件</label>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="w-full text-[11px] text-neutral-600 file:mr-2 file:rounded file:border-0 file:bg-neutral-100 file:px-2 file:py-0.5 file:text-[11px] file:text-neutral-600 dark:text-neutral-400 dark:file:bg-neutral-800 dark:file:text-neutral-400"
          />
        </div>
        <div>
          <label className="text-[10px] text-neutral-500">显示名称 *</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="材料名称"
            className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        <div>
          <label className="text-[10px] text-neutral-500">数据范围 *</label>
          <input
            type="text"
            value={declaredDataScope}
            onChange={(e) => setDeclaredDataScope(e.target.value)}
            placeholder="例如：渠道投放明细"
            className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        <div>
          <label className="text-[10px] text-neutral-500">使用约束</label>
          <input
            type="text"
            value={usageConstraints}
            onChange={(e) => setUsageConstraints(e.target.value)}
            placeholder="例如：analysis_input"
            className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
        {safetyClass === "restricted_raw" && (
          <div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>原始行级数据不会进入 LLM 处理，仅作为登记元数据保存。</span>
          </div>
        )}
        {result && (
          <div
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px]",
              result.kind === "success"
                ? "border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/20 dark:text-green-400"
                : "border border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400",
            )}
          >
            {result.message}
          </div>
        )}
        <button
          onClick={handleUpload}
          disabled={!canUpload}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
            canUpload
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600",
          )}
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {loading ? "上传中…" : "上传"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ProjectDetailPanel
// ---------------------------------------------------------------------------

export function ProjectDetailPanel({
  data,
  workspaceId,
  capabilities,
  onRefresh,
  onBack,
  onNavigateToClosure,
}: Props) {
  const {
    project,
    analysisRequest,
    inputEvidence,
    sources,
    currentRequirement,
    currentPlan,
    latestRun,
    latestReport,
    lockedReportId,
    pendingGate,
    availableCommands: cmds,
  } = data.data;
  const isS3Stage = project.stage.startsWith("S3.");
  const showClosure = !!lockedReportId || isS3Stage;
  const currentStage = project.stage as ProjectStage;
  const currentBusinessStage = businessStage(currentStage);
  const hint = STAGE_NEXT_HINTS[currentStage];
  const pct = businessStageProgress(currentStage);

  const [uploadPanel, setUploadPanel] = useState<"raw" | "clean" | null>(null);

  const rawEvidence = inputEvidence.filter((ev) => ev.safetyClass === "restricted_raw");
  const cleanEvidence = inputEvidence.filter((ev) => ev.safetyClass === "controlled");
  const hasReport = latestReport != null || lockedReportId != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-3 w-3" />
          返回
        </button>
        <h2 className="min-w-0 truncate text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
          {project.title}
        </h2>
        <span className="shrink-0 text-[10px] text-neutral-400">
          #{project.slug}
        </span>
        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] ?? project.status}
        </span>
        <div className="ml-auto shrink-0">
          <MoreActionsMenu
            workspaceId={workspaceId}
            projectId={project.projectId}
            cmds={cmds}
            project={project}
            onRefresh={onRefresh}
          />
        </div>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* ── Left pane: Inputs ── */}
        <div className="space-y-3 order-3 lg:order-1">
          <Section title="Uploads" icon={FolderOpen}>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setUploadPanel(uploadPanel === "raw" ? null : "raw")}
                  className={cn(
                    "rounded-md border p-2 text-center transition-colors",
                    uploadPanel === "raw"
                      ? "border-red-400 bg-red-100 dark:border-red-600 dark:bg-red-950/30"
                      : "border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/20 dark:hover:bg-red-950/30",
                  )}
                >
                  <div className="text-[10px] font-medium text-red-700 dark:text-red-400">010_raw</div>
                  <div className="mt-1 text-[9px] text-red-600 dark:text-red-500">
                    {rawEvidence.length > 0 ? `${rawEvidence.length} 项` : "上传"}
                  </div>
                </button>
                <button
                  onClick={() => setUploadPanel(uploadPanel === "clean" ? null : "clean")}
                  className={cn(
                    "rounded-md border p-2 text-center transition-colors",
                    uploadPanel === "clean"
                      ? "border-amber-400 bg-amber-100 dark:border-amber-600 dark:bg-amber-950/30"
                      : "border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
                  )}
                >
                  <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400">020_clean</div>
                  <div className="mt-1 text-[9px] text-amber-600 dark:text-amber-500">
                    {cleanEvidence.length > 0 ? `${cleanEvidence.length} 项` : "上传"}
                  </div>
                </button>
                <div className="rounded-md border border-green-200 bg-green-50 p-2 text-center dark:border-green-800 dark:bg-green-950/20">
                  <div className="text-[10px] font-medium text-green-700 dark:text-green-400">060_reports</div>
                  <div className="mt-1 text-[9px] text-green-600 dark:text-green-500">
                    {hasReport ? "已产出" : "暂无"}
                  </div>
                </div>
              </div>
              {uploadPanel === "raw" && (
                <EvidenceUploadPanel
                  workspaceId={workspaceId}
                  projectId={project.projectId}
                  safetyClass="restricted_raw"
                  safetyHandlingPolicy="local_transform_required"
                  label="010_raw 原始数据"
                  onClose={() => setUploadPanel(null)}
                  onUploaded={onRefresh}
                />
              )}
              {uploadPanel === "clean" && (
                <EvidenceUploadPanel
                  workspaceId={workspaceId}
                  projectId={project.projectId}
                  safetyClass="controlled"
                  safetyHandlingPolicy="controlled_or_derived_allowed"
                  label="020_clean 受控数据"
                  onClose={() => setUploadPanel(null)}
                  onUploaded={onRefresh}
                />
              )}
            </div>
          </Section>

          <Section title="Raw files" icon={FileText}>
            {rawEvidence.length > 0 ? (
              <div className="max-h-40 overflow-auto">
                {rawEvidence.map((ev) => (
                  <EvidenceRow key={ev.evidenceArtifactId} ev={ev} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-neutral-200 p-2 text-center dark:border-neutral-700">
                <p className="text-[10px] text-neutral-400">暂无原始数据</p>
              </div>
            )}
            <div className="mt-1.5 text-[9px] text-red-500 dark:text-red-400">
              原始数据仅登记元数据，行级内容不进入 LLM 处理
            </div>
          </Section>

          <Section title="Clean files" icon={FileText}>
            {cleanEvidence.length > 0 ? (
              <div className="max-h-40 overflow-auto">
                {cleanEvidence.map((ev) => (
                  <EvidenceRow key={ev.evidenceArtifactId} ev={ev} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-neutral-200 p-2 text-center dark:border-neutral-700">
                <p className="text-[10px] text-neutral-400">暂无受控数据</p>
              </div>
            )}
            <div className="mt-1.5 text-[9px] text-amber-600 dark:text-amber-400">
              受控数据经处理后用于分析流程，需用户知情
            </div>
          </Section>

          <Section title="Business request" icon={FileText}>
            {analysisRequest ? (
              <div className="space-y-2">
                <div className="max-h-32 overflow-auto rounded bg-neutral-50 p-2 text-[11px] leading-relaxed break-words text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {analysisRequest.rawRequestText.length > 500
                    ? analysisRequest.rawRequestText.slice(0, 500) + "…"
                    : analysisRequest.rawRequestText}
                </div>
                <div className="text-[10px] text-neutral-400">
                  {formatRelativeTime(analysisRequest.submittedAt)}
                  {analysisRequest.locale && (
                    <span className="ml-1">· {analysisRequest.locale}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-neutral-200 p-2 text-center dark:border-neutral-700">
                <p className="text-[10px] text-neutral-400">尚未提交业务需求</p>
              </div>
            )}
          </Section>

          {sources.length > 0 && (
            <Section title="数据来源" icon={Link2}>
              <div className="space-y-1">
                {sources.map((s) => (
                  <div key={s.sourceReferenceId} className="flex items-start gap-2 rounded border border-neutral-100 px-2 py-1.5 text-[11px] dark:border-neutral-800">
                    <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-neutral-400" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {s.displayName}
                      </span>
                      <span className="ml-2 text-[10px] text-neutral-400">
                        {s.sourceKind === "agentharness" ? "AgentHarness" : "用户上传"}
                      </span>
                      {s.description && (
                        <div className="text-[10px] text-neutral-400">{s.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* ── Center pane: Flow ── */}
        <div className="space-y-3 order-1 lg:order-2">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-[12px] font-medium text-blue-800 dark:text-blue-300">
                  {currentBusinessStage?.label ?? "未知"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-blue-600 dark:text-blue-400">
                  {pct}%
                </span>
              </div>
            </div>
            {hint && (
              <div className="mt-1 text-[10px] text-blue-700 dark:text-blue-400">
                下一步: {hint}
              </div>
            )}
          </div>

          <Section title="流程路径" icon={GitBranch}>
            <InteractiveFlowTrack
              currentStage={currentStage}
              cmds={cmds}
              analysisRequest={analysisRequest}
              currentRequirement={currentRequirement}
              currentPlan={currentPlan}
              latestRun={latestRun}
              pendingGate={pendingGate}
              inputEvidence={inputEvidence}
              workspaceId={workspaceId}
              projectId={project.projectId}
              expectedUpdatedAt={project.updatedAt}
              capabilities={capabilities}
              onRefresh={onRefresh}
              onNavigateToClosure={onNavigateToClosure}
            />
          </Section>
        </div>

        {/* ── Right pane: Outputs ── */}
        <div className="space-y-3 order-2 lg:order-3">
          {latestReport ? (
            <Section title="Latest report" icon={FileText}>
              <div className="space-y-1.5 text-[11px]">
                <div>
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    v{latestReport.versionOrdinal}
                  </span>
                  <span className="ml-2 text-neutral-400">
                    {formatRelativeTime(latestReport.createdAt)}
                  </span>
                </div>
                <div className="text-[10px] text-neutral-400">
                  {latestReport.createdBy.displayName}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-neutral-400">
                  <span>schema: {latestReport.schemaVersion}</span>
                  <span className="truncate font-mono" title={latestReport.contentSha256}>
                    sha256:{latestReport.contentSha256.slice(0, 8)}
                  </span>
                </div>
                <div className="mt-1 rounded border border-dashed border-neutral-200 px-2 py-1 text-[10px] text-neutral-400 dark:border-neutral-700">
                  报告内容查看待后续扩展（当前无 content route）
                </div>
              </div>
            </Section>
          ) : (
            <Section title="Latest report" icon={FileText}>
              <div className="rounded-md border border-dashed border-neutral-200 p-2 text-center dark:border-neutral-700">
                <p className="text-[10px] text-neutral-400">暂无报告产物</p>
                <p className="mt-0.5 text-[9px] text-neutral-400">
                  报告由分析执行自动生成
                </p>
              </div>
            </Section>
          )}

          {lockedReportId ? (
            <Section title="Locked report" icon={FileText}>
              <div className="space-y-1.5">
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-400">
                  <div className="truncate font-mono text-[10px]" title={lockedReportId}>
                    {lockedReportId}
                  </div>
                </div>
                <div className="text-[9px] text-neutral-400">
                  锁定后不可修改，作为最终交付版本
                </div>
              </div>
            </Section>
          ) : (
            <Section title="Locked report" icon={FileText}>
              <div className="rounded-md border border-dashed border-neutral-200 p-2 text-center dark:border-neutral-700">
                <p className="text-[10px] text-neutral-400">暂无锁定报告</p>
              </div>
            </Section>
          )}

          <Section title="Report versions" icon={FileText}>
            <div className="rounded-md border border-dashed border-neutral-200 p-2 text-center dark:border-neutral-700">
              <p className="text-[10px] text-neutral-400">版本浏览待扩展</p>
              <p className="mt-0.5 text-[9px] text-neutral-400">
                当前仅展示最新版本，多版本浏览待后续实现
              </p>
            </div>
          </Section>

          <Section title="项目信息" icon={Tag}>
            <FieldRow label="类型">
              {PROJECT_KIND_LABELS[project.kind as keyof typeof PROJECT_KIND_LABELS] ?? project.kind}
            </FieldRow>
            <FieldRow label="技术状态">
              <span className="text-[11px]">
                {PROJECT_STAGE_LABELS[currentStage] ?? currentStage}
              </span>
            </FieldRow>
            <FieldRow label="创建">
              {formatRelativeTime(project.createdAt)}
            </FieldRow>
            <FieldRow label="更新">
              {formatRelativeTime(project.updatedAt)}
            </FieldRow>
            {showClosure && onNavigateToClosure && (
              <button
                onClick={onNavigateToClosure}
                className="mt-2 w-full rounded-md border border-violet-200 bg-violet-50 p-2 text-left text-[11px] text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-400 dark:hover:border-violet-700"
              >
                <span className="font-medium">业务闭合</span>
                <span className="ml-2 text-violet-500">
                  {isS3Stage
                    ? `当前: ${PROJECT_STAGE_LABELS[currentStage] ?? currentStage}`
                    : "查看闭合周期"}
                </span>
              </button>
            )}
          </Section>

          {currentPlan && (
            <Section title="当前计划版本" icon={FileText}>
              <VersionInfo version={currentPlan} label="分析计划" />
            </Section>
          )}

          {latestRun && (
            <Section title="最近执行" icon={Play}>
              <RunInfo run={latestRun} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
