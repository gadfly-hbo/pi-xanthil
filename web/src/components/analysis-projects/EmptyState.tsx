import { useState } from "react";
import {
  ClipboardList,
  FileSearch,
  GitBranch,
  Play,
  Circle,
  Plus,
  Loader2,
  FolderOpen,
  ShieldAlert,
  ShieldCheck,
  FileOutput,
  Info,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  STAGE_GROUPS,
  PROJECT_STAGE_LABELS,
  PROJECT_KIND_LABELS,
  PROJECT_KIND_DESCRIPTIONS,
  SLUG_PATTERN,
  generateSlug,
} from "./shared";
import type { ProjectKind, ProjectStage } from "@/types/analysis-projects";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onCreateProject: (title: string, slug: string) => Promise<void>;
  creating: boolean;
  createError: string | null;
}

// ---------------------------------------------------------------------------
// Stage group icons
// ---------------------------------------------------------------------------

const GROUP_ICONS: readonly typeof ClipboardList[] = [ClipboardList, Play, GitBranch];

// ---------------------------------------------------------------------------
// Stage timeline for a single group
// ---------------------------------------------------------------------------

function StageTimeline({ stages }: { stages: readonly ProjectStage[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className="flex items-center gap-1">
            <Circle className="h-2.5 w-2.5 text-neutral-300 dark:text-neutral-600" />
            <span className="text-[10px] text-neutral-400">
              {PROJECT_STAGE_LABELS[s]}
            </span>
          </div>
          {i < stages.length - 1 && (
            <div className="w-2 h-px bg-neutral-200 dark:bg-neutral-700" />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Business map card
// ---------------------------------------------------------------------------

function BusinessMapCard() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
          <FileSearch className="h-4 w-4 text-neutral-500" />
          数据分析生命周期
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          一个分析项目从需求到行动闭环，经历 3 个阶段组、15 个步骤
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
                  <div className="mt-2">
                    <StageTimeline stages={group.stages} />
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

// ---------------------------------------------------------------------------
// Create project form
// ---------------------------------------------------------------------------

function CreateProjectForm({
  onSubmit,
  creating,
  createError,
}: {
  onSubmit: (title: string, slug: string) => Promise<void>;
  creating: boolean;
  createError: string | null;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const effectiveSlug = slug.trim() || generateSlug(title) || `analysis-${Date.now()}`;
  const slugValid = SLUG_PATTERN.test(effectiveSlug);
  const titleValid = title.trim().length > 0;
  const canSubmit = titleValid && slugValid && !creating;

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slugTouched) {
      setSlug(generateSlug(v));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit(title.trim(), effectiveSlug);
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
        <Plus className="h-4 w-4 text-neutral-500" />
        新建分析项目
      </div>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[11px] text-neutral-500">
            业务标题 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="例如：Q3 用户留存分析"
            className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-neutral-500">
            技术标识 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="q3-user-retention"
            className={cn(
              "w-full rounded-md border bg-neutral-50 px-3 py-1.5 text-[12px] font-mono text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:bg-neutral-800 dark:text-neutral-200",
              slug && !slugValid
                ? "border-red-300 focus:border-red-400 dark:border-red-700"
                : "border-neutral-200 focus:border-blue-400 dark:border-neutral-700",
            )}
          />
          {slug && !slugValid && (
            <p className="text-[10px] text-red-500">
              仅允许小写字母、数字和连字符，且不能以连字符开头或结尾
            </p>
          )}
          {!slugTouched && title && (
            <p className="text-[10px] text-neutral-400">
              已自动生成标识: {effectiveSlug}
            </p>
          )}
        </div>
        {createError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {createError}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[12px] font-medium transition-colors",
            canSubmit
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-neutral-100 text-neutral-400 cursor-not-allowed dark:bg-neutral-800 dark:text-neutral-600",
          )}
        >
          {creating && <Loader2 className="h-3 w-3 animate-spin" />}
          创建项目
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// How it works explanation card
// ---------------------------------------------------------------------------

function HowItWorksCard() {
  const steps = [
    { icon: Plus, label: "创建项目", desc: "填写业务标题，建立状态机项目" },
    { icon: ClipboardList, label: "提交需求", desc: "描述分析目标和背景" },
    { icon: FolderOpen, label: "登记材料", desc: "绑定数据来源、上传证据文件" },
    { icon: Play, label: "执行分析", desc: "系统生成需求、计划并运行分析" },
    { icon: FileOutput, label: "生成报告", desc: "审核报告并锁定最终版本" },
    { icon: GitBranch, label: "业务闭合", desc: "将结论转化为行动，评估效果" },
  ];

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
          <Info className="h-4 w-4 text-neutral-500" />
          工作台如何运作
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          创建项目只是第一步。后续需要提交需求、登记材料、执行分析、审核报告、进入业务闭合
        </p>
      </div>
      <div className="grid gap-0 divide-y divide-neutral-100 dark:divide-neutral-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {i + 1}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-neutral-500" />
                  <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                    {step.label}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  {step.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data folder placement card
// ---------------------------------------------------------------------------

function DataFolderCard() {
  const folders = [
    {
      icon: ShieldAlert,
      name: "010_raw — 原始数据",
      desc: "仅登记或上传，不送 LLM 处理",
      color: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30",
      borderColor: "border-red-200 dark:border-red-800",
      hint: "安全级别最高，内容不会发送给 AI",
    },
    {
      icon: ShieldCheck,
      name: "020_clean — 清洗聚合数据",
      desc: "经处理的聚合数据，可作为分析输入",
      color: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30",
      borderColor: "border-amber-200 dark:border-amber-800",
      hint: "受控数据，用户知情后可送入分析流程",
    },
    {
      icon: FileOutput,
      name: "060_reports — 报告与衍生产物",
      desc: "分析报告、业务需求、汇报版本等输出",
      color: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30",
      borderColor: "border-green-200 dark:border-green-800",
      hint: "衍生产物，可用于后续流程",
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
            <div key={f.name} className="px-4 py-2.5">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
                  <Icon className="h-3.5 w-3.5 text-neutral-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                    {f.name}
                  </div>
                  <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    {f.desc}
                  </p>
                  <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium ${f.color}`}>
                    {f.hint}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-neutral-100 px-4 py-2 dark:border-neutral-800">
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
          这些文件夹绑定到具体的分析任务（session/flow），不在工作区根目录。
          当前 Analysis Project 尚未拥有独立的任务文件夹，使用现有 session/flow 任务目录。
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main EmptyState component
// ---------------------------------------------------------------------------

export function EmptyState({ onCreateProject, creating, createError }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-[15px] font-medium text-neutral-800 dark:text-neutral-200">
            分析台
          </h2>
          <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
            管理数据分析项目的完整生命周期，从需求到行动闭环
          </p>
        </div>

        {/* How it works */}
        <HowItWorksCard />

        {/* Business map */}
        <BusinessMapCard />

        {/* Data folder placement */}
        <DataFolderCard />

        {/* Create form */}
        <CreateProjectForm
          onSubmit={onCreateProject}
          creating={creating}
          createError={createError}
        />

        {/* Project types hint */}
        <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
            支持的项目类型
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              Object.entries(PROJECT_KIND_LABELS) as [ProjectKind, string][]
            ).map(([kind, label]) => (
              <div
                key={kind}
                className="rounded-md border border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-800/50"
              >
                <div className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                  {label}
                </div>
                <div className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {PROJECT_KIND_DESCRIPTIONS[kind]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
