import { ArrowLeft, FileText, GitBranch, Play, Shield, Tag } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProjectDetailReadModel, EvidenceRef, RunRef, VersionRef, GateType } from "@/types/analysis-projects";
import {
  PROJECT_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STAGE_LABELS,
  RUN_STATUS_LABELS,
  GATE_TYPE_LABELS,
  SAFETY_CLASS_LABELS,
  SAFETY_CLASS_COLORS,
  stageProgress,
  formatRelativeTime,
  formatBytes,
  availableCommands,
  commandLabel,
} from "./shared";

interface Props {
  data: ProjectDetailReadModel;
  onBack: () => void;
  onNavigateToClosure?: () => void;
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof FileText; children: React.ReactNode }) {
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-neutral-400 w-16">{label}</span>
      <span className="min-w-0 flex-1 text-[12px] text-neutral-700 dark:text-neutral-300">{children}</span>
    </div>
  );
}

function StageProgress({ stage }: { stage: string }) {
  const pct = stageProgress(stage as import("@/types/analysis-projects").ProjectStage);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-neutral-500">
        {PROJECT_STAGE_LABELS[stage as keyof typeof PROJECT_STAGE_LABELS] ?? stage}
      </span>
    </div>
  );
}

function GateInfo({ gateType }: { gateType: GateType }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] dark:border-amber-800 dark:bg-amber-950/20">
      <div className="font-medium text-amber-700 dark:text-amber-400">
        {GATE_TYPE_LABELS[gateType] ?? gateType}
      </div>
      <div className="mt-0.5 text-amber-600 dark:text-amber-500">
        等待审核
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
      <span className="text-neutral-400">
        Run #{run.runOrdinal}
      </span>
      <span className="text-neutral-400">
        {PROJECT_STAGE_LABELS[run.currentAnalysisStage as keyof typeof PROJECT_STAGE_LABELS] ?? run.currentAnalysisStage}
      </span>
      {run.endedAt && (
        <span className="text-neutral-400">{formatRelativeTime(run.endedAt)}</span>
      )}
    </div>
  );
}

function VersionInfo({ version, label }: { version: VersionRef; label: string }) {
  return (
    <div className="text-[11px]">
      <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
      <span className="ml-2 text-neutral-400">
        v{version.versionOrdinal} · {formatRelativeTime(version.createdAt)} · {version.createdBy.displayName}
      </span>
    </div>
  );
}

function EvidenceRow({ ev }: { ev: EvidenceRef }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
      <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">
        {ev.displayName}
      </span>
      <span className={cn("shrink-0 rounded px-1 py-0.5 text-[9px] font-medium", SAFETY_CLASS_COLORS[ev.safetyClass])}>
        {SAFETY_CLASS_LABELS[ev.safetyClass]}
      </span>
      <span className="shrink-0 text-[10px] text-neutral-400">{formatBytes(ev.byteSize)}</span>
      {ev.safetyClass === "restricted_raw" && (
        <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[9px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          受限
        </span>
      )}
    </div>
  );
}

export function ProjectDetailPanel({ data, onBack, onNavigateToClosure }: Props) {
  const { project, analysisRequest, inputEvidence, sources, currentRequirement, currentPlan, latestRun, latestReport, lockedReportId, pendingGate, availableCommands: cmds } = data.data;
  const activeCmds = availableCommands(cmds);
  const isS3Stage = project.stage.startsWith("S3.");
  const showClosure = !!lockedReportId || isS3Stage;

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
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Project info */}
        <Section title="项目信息" icon={Tag}>
          <FieldRow label="类型">{PROJECT_KIND_LABELS[project.kind as keyof typeof PROJECT_KIND_LABELS] ?? project.kind}</FieldRow>
          <FieldRow label="状态">{PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] ?? project.status}</FieldRow>
          <FieldRow label="标识">#{project.slug}</FieldRow>
          <FieldRow label="阶段">
            <StageProgress stage={project.stage} />
          </FieldRow>
          <FieldRow label="创建">{formatRelativeTime(project.createdAt)}</FieldRow>
          <FieldRow label="更新">{formatRelativeTime(project.updatedAt)}</FieldRow>
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
                {isS3Stage ? `当前: ${PROJECT_STAGE_LABELS[project.stage as keyof typeof PROJECT_STAGE_LABELS] ?? project.stage}` : "查看闭合周期"}
              </span>
            </button>
          )}
        </Section>

        {/* Pending gate */}
        {pendingGate && (
          <Section title="待处理审核" icon={Shield}>
            <GateInfo gateType={pendingGate} />
          </Section>
        )}

        {/* Latest run */}
        {latestRun && (
          <Section title="最近执行" icon={Play}>
            <RunInfo run={latestRun} />
          </Section>
        )}

        {/* Available commands */}
        {activeCmds.length > 0 && (
          <Section title="可用操作" icon={GitBranch}>
            <div className="flex flex-wrap gap-1.5">
              {activeCmds.map((c) => (
                <span
                  key={c.commandType}
                  className="inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {commandLabel(c.commandType)}
                </span>
              ))}
            </div>
          </Section>
        )}

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
              {analysisRequest.locale && <span className="ml-1">· {analysisRequest.locale}</span>}
            </div>
          </Section>
        )}

        {/* Current requirement */}
        {currentRequirement && (
          <Section title="当前需求版本" icon={FileText}>
            <VersionInfo version={currentRequirement} label="结构化需求" />
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
                {formatRelativeTime(latestReport.createdAt)} · {latestReport.createdBy.displayName}
              </span>
            </div>
          </Section>
        )}

        {/* Input evidence */}
        {inputEvidence.length > 0 && (
          <Section title={`输入证据 (${inputEvidence.length})`} icon={FileText}>
            <div className="max-h-48 overflow-auto">
              {inputEvidence.map((ev) => (
                <EvidenceRow key={ev.evidenceArtifactId} ev={ev} />
              ))}
            </div>
          </Section>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <Section title={`数据来源 (${sources.length})`} icon={GitBranch}>
            {sources.map((s) => (
              <div key={s.sourceReferenceId} className="py-1 text-[11px]">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">{s.displayName}</span>
                <span className="ml-2 text-[10px] text-neutral-400">
                  {s.sourceKind === "agentharness" ? "AgentHarness" : "用户上传"}
                </span>
                {s.latestCheck && (
                  <span className="ml-2 text-[10px] text-neutral-400">
                    检查: {s.latestCheck.availabilityStatus} · {formatRelativeTime(s.latestCheck.checkedAt)}
                  </span>
                )}
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
