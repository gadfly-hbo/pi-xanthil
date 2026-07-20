import {
  ClipboardList,
  Play,
  GitBranch,
  FolderOpen,
  ShieldAlert,
  ShieldCheck,
  FileOutput,
  ChevronDown,
  ChevronRight,
  Circle,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  BUSINESS_STAGES,
  STAGE_GROUPS,
  PROJECT_STAGE_LABELS,
} from "./shared";
import type { ProjectStage } from "@/types/analysis-projects";

const GROUP_ICONS: readonly typeof ClipboardList[] = [ClipboardList, Play, GitBranch];

function TechnicalStateFold() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between border-b border-neutral-100 px-4 py-2.5 text-left dark:border-neutral-800"
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
          15 个技术状态如何折叠为 6 个业务环节
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-neutral-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-neutral-400" />
        )}
      </button>
      {expanded && (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {BUSINESS_STAGES.map((bs) => (
            <div key={bs.id} className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">
                  {bs.label}
                </span>
                <span className="text-[10px] text-neutral-400">
                  {bs.stages.length} 个技术状态
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {bs.stages.map((s) => (
                  <span
                    key={s}
                    className="inline-flex rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  >
                    {s} {PROJECT_STAGE_LABELS[s as ProjectStage]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessStagesCard() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
          <ClipboardList className="h-4 w-4 text-neutral-500" />
          6 个业务环节
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          每张分析工单从提交需求到行动闭环，经历 6 个业务环节。底层对应 15 个技术状态机步骤。
        </p>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {BUSINESS_STAGES.map((bs, i) => {
          const Icon = GROUP_ICONS[i < 2 ? 0 : i < 4 ? 1 : 2] ?? Circle;
          return (
            <div key={bs.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-3 w-3 text-neutral-500" />
                  <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">
                    {bs.label}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {bs.stages.map((s) => s).join(", ")}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageGroupsCard() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
          3 个阶段组
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          15 个技术状态按阶段组组织：需求与计划、分析执行与报告、行动闭环
        </p>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {STAGE_GROUPS.map((group, gi) => {
          const Icon = GROUP_ICONS[gi] ?? Circle;
          return (
            <div key={group.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <Icon className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">
                      {group.id} {group.label}
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      {group.stages.length} 步
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {group.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.stages.map((s) => (
                      <span
                        key={s}
                        className="inline-flex rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      >
                        {s} {PROJECT_STAGE_LABELS[s as ProjectStage]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DataFoldersCard() {
  const folders = [
    {
      icon: ShieldAlert,
      name: "010_raw — 原始数据",
      desc: "原始行级数据，安全级别最高。",
      security: "原始行级内容不进入 LLM。仅经注册工具处理后的聚合/衍生产物（不含原始行）允许进入分析流程。",
      color: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30",
      borderColor: "border-red-200 dark:border-red-800",
    },
    {
      icon: ShieldCheck,
      name: "020_clean — 清洗聚合数据",
      desc: "清洗、聚合后的受控数据，可作为分析输入。",
      security: "用户知情后可送入分析流程。受控数据，不直接暴露原始行。",
      color: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30",
      borderColor: "border-amber-200 dark:border-amber-800",
    },
    {
      icon: FileOutput,
      name: "060_reports — 报告与衍生产物",
      desc: "分析报告、业务需求、汇报版本等衍生产物。",
      security: "衍生产物，可用于后续业务流程。不含原始行级数据。",
      color: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30",
      borderColor: "border-green-200 dark:border-green-800",
    },
  ];

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
          <FolderOpen className="h-4 w-4 text-neutral-500" />
          数据文档放在哪里
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          每个分析任务使用标准文件夹存放不同安全级别的数据材料
        </p>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {folders.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.name} className="px-4 py-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
                  <Icon className="h-3.5 w-3.5 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                    {f.name}
                  </div>
                  <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                    {f.desc}
                  </p>
                  <div className={cn("mt-1 rounded px-1.5 py-1 text-[10px]", f.color)}>
                    {f.security}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
          <p className="font-medium text-neutral-600 dark:text-neutral-300">当前存放事实：</p>
          <p className="mt-1">
            这些文件夹绑定到具体的分析任务（session/flow），不在工作区根目录。
            当前 Analysis Project 尚未拥有独立的任务文件夹，数据材料存放在关联的 session 或 flow 的标准目录中。
          </p>
        </div>
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          待解决：需要 analysis project task folder ownership contract，让每个分析工单拥有独立的数据材料目录。
        </div>
      </div>
    </div>
  );
}

export function InstructionsPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div>
          <h2 className="text-[15px] font-medium text-neutral-800 dark:text-neutral-200">
            使用说明
          </h2>
          <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
            分析工单工作台的流程规则、数据目录边界和安全约束
          </p>
        </div>

        <BusinessStagesCard />
        <TechnicalStateFold />
        <StageGroupsCard />
        <DataFoldersCard />
      </div>
    </div>
  );
}
