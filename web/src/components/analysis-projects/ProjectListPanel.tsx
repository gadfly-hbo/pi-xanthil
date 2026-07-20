import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProjectListReadModel, ProjectListItem, ProjectStage } from "@/types/analysis-projects";
import {
  PROJECT_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STAGE_LABELS,
  RUN_STATUS_LABELS,
  GATE_TYPE_LABELS,
  businessStage,
  businessStageProgress,
  formatRelativeTime,
  truncateText,
  STAGE_NEXT_HINTS,
} from "./shared";

interface Props {
  data: ProjectListReadModel;
  onSelect: (item: ProjectListItem) => void;
  onRefresh: () => void;
}

function StageBar({ stage }: { stage: string }) {
  const pct = businessStageProgress(stage as ProjectStage);
  const bs = businessStage(stage as ProjectStage);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {bs && (
        <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          {bs.label}
        </span>
      )}
      <span className="text-[10px] text-neutral-400">
        {PROJECT_STAGE_LABELS[stage as keyof typeof PROJECT_STAGE_LABELS] ?? stage}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] ?? status;
  const color =
    status === "active"
      ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
      : status === "completed"
        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", color)}>
      {label}
    </span>
  );
}

function BlockerReason({ item }: { item: ProjectListItem }) {
  if (item.pendingGate) {
    return (
      <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
        等待 {GATE_TYPE_LABELS[item.pendingGate] ?? item.pendingGate} 审核
      </div>
    );
  }
  if (item.latestRun) {
    const runStatus = item.latestRun.currentRunStatus;
    if (runStatus === "failed") {
      return (
        <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          最近执行失败
        </div>
      );
    }
    if (runStatus === "blocked") {
      return (
        <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          执行已阻塞
        </div>
      );
    }
  }
  return null;
}

function ProjectRow({ item, onSelect }: { item: ProjectListItem; onSelect: () => void }) {
  const hint = STAGE_NEXT_HINTS[item.stage as keyof typeof STAGE_NEXT_HINTS];
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-start gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {truncateText(item.title, 60)}
          </span>
          <StatusBadge status={item.status} />
          {item.lockedReportId && (
            <span className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
              已锁定
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span>{PROJECT_KIND_LABELS[item.kind] ?? item.kind}</span>
          <span>·</span>
          <StageBar stage={item.stage} />
        </div>
        {hint && (
          <div className="mt-1 text-[10px] text-neutral-400">
            下一步: {hint}
          </div>
        )}
        <BlockerReason item={item} />
        {item.latestRun && item.latestRun.currentRunStatus === "running" && (
          <div className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">
            执行中: {RUN_STATUS_LABELS[item.latestRun.currentRunStatus as keyof typeof RUN_STATUS_LABELS] ?? item.latestRun.currentRunStatus}
            {item.latestRun.currentAnalysisStage && (
              <span className="ml-1">
                · {PROJECT_STAGE_LABELS[item.latestRun.currentAnalysisStage as keyof typeof PROJECT_STAGE_LABELS] ?? item.latestRun.currentAnalysisStage}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right text-[10px] text-neutral-400">
        <div>{formatRelativeTime(item.updatedAt)}</div>
        <div className="mt-0.5">#{item.slug}</div>
      </div>
    </button>
  );
}

export function ProjectListPanel({ data, onSelect, onRefresh }: Props) {
  const { items, hasMore } = data.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
        <span className="text-[11px] text-neutral-500">
          {items.length} 张工单{hasMore ? " (有更多)" : ""}
        </span>
        <button
          onClick={onRefresh}
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {items.map((item) => (
          <ProjectRow
            key={item.projectId}
            item={item}
            onSelect={() => onSelect(item)}
          />
        ))}
      </div>
    </div>
  );
}
