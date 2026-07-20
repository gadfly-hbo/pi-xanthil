import {
  ArrowLeft,
  FileText,
  GitBranch,
  Play,
  Shield,
  Tag,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  FolderOpen,
  Info,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  ProjectDetailReadModel,
  EvidenceRef,
  RunRef,
  VersionRef,
  GateType,
  ProjectStage,
  CommandAffordance,
} from "@/types/analysis-projects";
import {
  PROJECT_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STAGE_LABELS,
  RUN_STATUS_LABELS,
  GATE_TYPE_LABELS,
  SAFETY_CLASS_LABELS,
  SAFETY_CLASS_COLORS,
  stageProgress,
  stageGroup,
  formatRelativeTime,
  formatBytes,
  availableCommands,
  commandLabel,
  STAGE_GROUPS,
  STAGE_NEXT_HINTS,
} from "./shared";

interface Props {
  data: ProjectDetailReadModel;
  onBack: () => void;
  onNavigateToClosure?: () => void;
}

// ---------------------------------------------------------------------------
// Section primitive
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stage status for the 15-state machine track
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 15-state machine stage track (grouped)
// ---------------------------------------------------------------------------

function StageTrack({ currentStage }: { currentStage: ProjectStage }) {
  return (
    <div className="space-y-3">
      {STAGE_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
              {group.id} {group.label}
            </span>
            <span className="text-[10px] text-neutral-400">
              {group.description}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {group.stages.map((stage) => {
              const status = getStageStatus(stage, currentStage);
              const hint = STAGE_NEXT_HINTS[stage];
              return (
                <div
                  key={stage}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1",
                    status === "done"
                      ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
                      : status === "active"
                        ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20"
                        : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50",
                  )}
                >
                  <StageDot status={status} />
                  <div>
                    <div
                      className={cn(
                        "text-[11px]",
                        status === "done"
                          ? "text-green-700 dark:text-green-400"
                          : status === "active"
                            ? "font-medium text-blue-700 dark:text-blue-400"
                            : "text-neutral-500 dark:text-neutral-400",
                      )}
                    >
                      {stage} {PROJECT_STAGE_LABELS[stage]}
                    </div>
                    {status === "active" && hint && (
                      <div className="text-[10px] text-blue-600 dark:text-blue-400">
                        {hint}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gate info
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Run info
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Version info
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Evidence row
// ---------------------------------------------------------------------------

function EvidenceRow({ ev }: { ev: EvidenceRef }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
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
      <span className="shrink-0 text-[10px] text-neutral-400">
        {formatBytes(ev.byteSize)}
      </span>
      {ev.safetyClass === "restricted_raw" && (
        <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[9px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          受限
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Available commands display
// ---------------------------------------------------------------------------

function CommandsList({ cmds }: { cmds: readonly CommandAffordance[] }) {
  if (cmds.length === 0) return null;
  return (
    <Section title="可用操作" icon={GitBranch}>
      <div className="flex flex-wrap gap-1.5">
        {cmds.map((c) => (
          <span
            key={c.commandType}
            className="inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {commandLabel(c.commandType)}
          </span>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main ProjectDetailPanel
// ---------------------------------------------------------------------------

export function ProjectDetailPanel({
  data,
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
  const activeCmds = availableCommands(cmds);
  const isS3Stage = project.stage.startsWith("S3.");
  const showClosure = !!lockedReportId || isS3Stage;
  const currentStage = project.stage as ProjectStage;
  const group = stageGroup(currentStage);
  const hint = STAGE_NEXT_HINTS[currentStage];
  const pct = stageProgress(currentStage);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      {/* Back + header */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-3 w-3" />
          返回
        </button>
        <h2 className="truncate text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
          {project.title}
        </h2>
        <span className="shrink-0 text-[10px] text-neutral-400">
          #{project.slug}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Left column: project info + stage track */}
        <div className="space-y-3 lg:col-span-2">
          {/* Current stage highlight */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-[13px] font-medium text-blue-800 dark:text-blue-300">
                  当前阶段: {PROJECT_STAGE_LABELS[currentStage] ?? currentStage}
                </span>
                {group && (
                  <span className="text-[11px] text-blue-600 dark:text-blue-400">
                    ({group.label})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-20 overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] text-blue-600 dark:text-blue-400">
                  {pct}%
                </span>
              </div>
            </div>
            {hint && (
              <div className="mt-1.5 text-[11px] text-blue-700 dark:text-blue-400">
                下一步: {hint}
              </div>
            )}
          </div>

          {/* 15-state machine stage track */}
          <Section title="数据分析生命周期" icon={GitBranch}>
            <StageTrack currentStage={currentStage} />
          </Section>

          {/* Pending gate */}
          {pendingGate && (
            <Section title="待处理审核" icon={Shield}>
              <GateInfo gateType={pendingGate} />
            </Section>
          )}

          {/* Available commands */}
          <CommandsList cmds={activeCmds} />

          {/* Analysis request */}
          {analysisRequest && (
            <Section title="分析需求" icon={FileText}>
              <div className="max-h-32 overflow-auto rounded bg-neutral-50 p-2 text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                {analysisRequest.rawRequestText.length > 500
                  ? analysisRequest.rawRequestText.slice(0, 500) + "…"
                  : analysisRequest.rawRequestText}
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                {formatRelativeTime(analysisRequest.submittedAt)}
                {analysisRequest.locale && (
                  <span className="ml-1">· {analysisRequest.locale}</span>
                )}
              </div>
            </Section>
          )}

          {/* Materials & Documents — combined evidence + sources mapped to stages */}
          {(inputEvidence.length > 0 || sources.length > 0) && (
            <Section title="材料与文档" icon={FolderOpen}>
              <div className="space-y-3">
                {/* Stage mapping explanation */}
                <div className="rounded-md border border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-800/50">
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    材料与状态机阶段的对应关系
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                      <Circle className="h-2 w-2" /> S1 输入材料
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[9px] text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
                      <Circle className="h-2 w-2" /> S2 分析证据
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-[9px] text-green-700 dark:bg-green-950/30 dark:text-green-400">
                      <Circle className="h-2 w-2" /> S2.5/S2.6 报告产物
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                      <Circle className="h-2 w-2" /> S3 行动闭合材料
                    </span>
                  </div>
                </div>

                {/* Input evidence list */}
                {inputEvidence.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      输入证据 ({inputEvidence.length})
                    </div>
                    <div className="max-h-40 overflow-auto rounded border border-neutral-100 dark:border-neutral-800">
                      {inputEvidence.map((ev) => (
                        <EvidenceRow key={ev.evidenceArtifactId} ev={ev} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources list */}
                {sources.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      数据来源 ({sources.length})
                    </div>
                    <div className="space-y-1">
                      {sources.map((s) => (
                        <div key={s.sourceReferenceId} className="flex items-start gap-2 rounded border border-neutral-100 px-2 py-1.5 text-[11px] dark:border-neutral-800">
                          <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-neutral-400" />
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-neutral-700 dark:text-neutral-300">
                              {s.displayName}
                            </span>
                            <span className="ml-2 text-[10px] text-neutral-400">
                              {s.sourceKind === "agentharness"
                                ? "AgentHarness"
                                : "用户上传"}
                            </span>
                            {s.description && (
                              <div className="text-[10px] text-neutral-400">
                                {s.description}
                              </div>
                            )}
                            {s.latestCheck && (
                              <div className="text-[10px] text-neutral-400">
                                检查: {s.latestCheck.availabilityStatus} ·{" "}
                                {formatRelativeTime(s.latestCheck.checkedAt)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* No materials hint */}
          {inputEvidence.length === 0 && sources.length === 0 && (
            <Section title="材料与文档" icon={FolderOpen}>
              <div className="rounded-md border border-dashed border-neutral-200 p-3 text-center dark:border-neutral-700">
                <FolderOpen className="mx-auto mb-1.5 h-5 w-5 text-neutral-300 dark:text-neutral-600" />
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  暂无已登记的材料或数据来源
                </p>
                <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                  提交分析需求后，可在 S2 阶段登记输入材料和数据来源
                </p>
              </div>
            </Section>
          )}
        </div>

        {/* Right column: metadata sidebar */}
        <div className="space-y-3">
          {/* Project info */}
          <Section title="项目信息" icon={Tag}>
            <FieldRow label="类型">
              {PROJECT_KIND_LABELS[project.kind as keyof typeof PROJECT_KIND_LABELS] ?? project.kind}
            </FieldRow>
            <FieldRow label="状态">
              {PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] ?? project.status}
            </FieldRow>
            <FieldRow label="阶段">
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
            {lockedReportId && (
              <div className="mt-1.5 rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-400">
                已锁定报告: {lockedReportId.slice(0, 8)}…
              </div>
            )}
            {showClosure && onNavigateToClosure && (
              <button
                onClick={onNavigateToClosure}
                className="mt-2 w-full rounded-md border border-violet-200 bg-violet-50 p-2 text-left text-[11px] text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-400 dark:hover:border-violet-700"
              >
                <span className="font-medium">业务闭合</span>
                <span className="ml-2 text-violet-500 dark:text-violet-500">
                  {isS3Stage
                    ? `当前: ${PROJECT_STAGE_LABELS[currentStage] ?? currentStage}`
                    : "查看闭合周期"}
                </span>
              </button>
            )}
          </Section>

          {/* Data folder status */}
          <Section title="数据文件夹" icon={FolderOpen}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <div className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-neutral-600 dark:text-neutral-400">
                  当前使用现有 session/flow 任务文件夹
                </span>
              </div>
              <div className="rounded-md border border-dashed border-neutral-200 p-2 dark:border-neutral-700">
                <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
                  Analysis Project 尚未拥有独立的任务文件夹。
                  数据材料存放在关联的 session 或 flow 的标准目录中：
                </div>
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-red-50 px-1 py-0.5 text-red-600 dark:bg-red-950/30 dark:text-red-400">010_raw</span>
                    <span className="text-neutral-500">原始数据</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-amber-50 px-1 py-0.5 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">020_clean</span>
                    <span className="text-neutral-500">清洗聚合数据</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-green-50 px-1 py-0.5 text-green-600 dark:bg-green-950/30 dark:text-green-400">060_reports</span>
                    <span className="text-neutral-500">报告与衍生产物</span>
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400">
                <Info className="mr-1 inline h-3 w-3" />
                需要后续 contract：analysis project task folder ownership
              </div>
            </div>
          </Section>

          {/* Latest run */}
          {latestRun && (
            <Section title="最近执行" icon={Play}>
              <RunInfo run={latestRun} />
            </Section>
          )}

          {/* Current requirement */}
          {currentRequirement && (
            <Section title="当前需求版本" icon={FileText}>
              <VersionInfo
                version={currentRequirement}
                label="结构化需求"
              />
            </Section>
          )}

          {/* Current plan */}
          {currentPlan && (
            <Section title="当前计划版本" icon={FileText}>
              <VersionInfo version={currentPlan} label="分析计划" />
            </Section>
          )}

          {/* Latest report */}
          {latestReport && (
            <Section title="最新报告" icon={FileText}>
              <div className="text-[11px]">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  v{latestReport.versionOrdinal}
                </span>
                <span className="ml-2 text-neutral-400">
                  {formatRelativeTime(latestReport.createdAt)} ·{" "}
                  {latestReport.createdBy.displayName}
                </span>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
