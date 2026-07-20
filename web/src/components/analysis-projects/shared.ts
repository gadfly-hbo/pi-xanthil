import type {
  ProjectKind,
  ProjectStatus,
  ProjectStage,
  RunStatus,
  GateType,
  GateDecision,
  SafetyClass,
  CommandAffordance,
  ClosureCycleStatus,
  ClosureStage,
  TranslationStatus,
  DownstreamSystem,
  DeploymentStatus,
  FeedbackSource,
  SignificanceStatus,
  ReviewStatus,
  HypothesisResult,
  EffectivenessRating,
  IterationBranch,
} from "@/types/analysis-projects";

// ---------------------------------------------------------------------------
// Label maps — translate backend enums to friendly Chinese labels
// ---------------------------------------------------------------------------

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  goal_decomposition: "目标分解",
  daily_analysis: "日常分析",
  topic_research: "专题研究",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "进行中",
  completed: "已完成",
  rejected: "已拒绝",
  cancelled: "已取消",
};

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  "S1.1": "已提交需求",
  "S1.2": "需求已生成",
  "S1.4": "计划已生成",
  "S2.1": "计划已确认",
  "S2.2": "执行中·输入",
  "S2.3": "执行中·分析",
  "S2.4": "执行中·输出",
  "S2.5": "报告已生成",
  "S2.6": "报告已锁定",
  "S3.1": "结论转化",
  "S3.2": "系统部署",
  "S3.3": "业务执行",
  "S3.4": "效果反馈",
  "S3.5": "效果评估",
  "S3.6": "迭代决策",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  aborted: "已中止",
  blocked: "已阻塞",
};

export const GATE_TYPE_LABELS: Record<GateType, string> = {
  requirement_confirmation: "需求确认",
  plan_confirmation: "计划确认",
  report_review: "报告审核",
};

export const GATE_DECISION_LABELS: Record<GateDecision, string> = {
  approved: "已批准",
  changes_requested: "需修改",
  rejected: "已拒绝",
};

export const SAFETY_CLASS_LABELS: Record<SafetyClass, string> = {
  restricted_raw: "受限原始数据",
  controlled: "受控数据",
  derived: "衍生产物",
};

export const SAFETY_CLASS_COLORS: Record<SafetyClass, string> = {
  restricted_raw: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30",
  controlled: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30",
  derived: "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30",
};

// ---------------------------------------------------------------------------
// Stage → progress percentage (for visual indicator)
// ---------------------------------------------------------------------------

const STAGE_ORDER: readonly ProjectStage[] = [
  "S1.1", "S1.2", "S1.4", "S2.1", "S2.2", "S2.3", "S2.4", "S2.5", "S2.6",
  "S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6",
];

export function stageProgress(stage: ProjectStage): number {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / STAGE_ORDER.length) * 100);
}

// ---------------------------------------------------------------------------
// Command label helpers
// ---------------------------------------------------------------------------

const COMMAND_LABELS: Record<string, string> = {
  "project.create": "创建项目",
  "project.update_metadata": "更新信息",
  "project.delete_draft": "删除草稿",
  "project.cancel": "取消项目",
  "project.archive": "归档项目",
  "project.unarchive": "恢复项目",
  "project.reopen": "重新打开",
  "evidence.upload_user": "上传证据",
  "request.submit": "提交需求",
  "requirement.generate": "生成需求",
  "requirement.decide_confirmation": "确认需求",
  "plan.generate": "生成计划",
  "plan.decide_confirmation": "确认计划",
  "run.abort": "中止执行",
  "run.retry": "重试执行",
  "report.decide_review": "审核报告",
  "closure.initiate_cycle": "启动闭合周期",
  "closure.record_s31_translation": "记录结论转化",
  "closure.record_s32_deployment": "记录系统部署",
  "closure.record_s33_execution": "记录业务执行",
  "closure.append_s34_feedback": "追加效果反馈",
  "closure.record_s35_evaluation": "记录效果评估",
  "closure.record_s36_trigger": "记录迭代决策",
};

export function commandLabel(commandType: string): string {
  return COMMAND_LABELS[commandType] ?? commandType;
}

export function availableCommands(commands: readonly CommandAffordance[]): readonly CommandAffordance[] {
  return commands.filter((c) => c.available);
}

export function unavailableCommands(commands: readonly CommandAffordance[]): readonly CommandAffordance[] {
  return commands.filter((c) => !c.available);
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "刚刚";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天前`;
  return new Date(isoString).toLocaleDateString("zh-CN");
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

// ---------------------------------------------------------------------------
// S3.x Closure label maps
// ---------------------------------------------------------------------------

export const CLOSURE_CYCLE_STATUS_LABELS: Record<ClosureCycleStatus, string> = {
  initiated: "已启动",
  in_progress: "进行中",
  archived: "已归档",
  iterating: "迭代中",
};

export const CLOSURE_STAGE_LABELS: Record<ClosureStage, string> = {
  "S3.1": "结论转化",
  "S3.2": "系统部署",
  "S3.3": "业务执行",
  "S3.4": "效果反馈",
  "S3.5": "效果评估",
  "S3.6": "迭代决策",
};

export const TRANSLATION_STATUS_LABELS: Record<TranslationStatus, string> = {
  draft: "草稿",
  confirmed: "已确认",
};

export const DOWNSTREAM_SYSTEM_LABELS: Record<DownstreamSystem, string> = {
  cdp_tag_engine: "CDP 标签引擎",
  marketing_automation: "营销自动化",
  bi_reports: "BI 报表",
  other: "其他",
};

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  pending: "待部署",
  test_verified: "测试验证",
  gray_verified: "灰度验证",
  fully_deployed: "全量部署",
  failed: "部署失败",
  rolled_back: "已回滚",
};

export const FEEDBACK_SOURCE_LABELS: Record<FeedbackSource, string> = {
  execution_log: "执行日志",
  conversion_data: "转化数据",
  tag_hit_log: "标签命中日志",
  combined: "综合",
};

export const SIGNIFICANCE_STATUS_LABELS: Record<SignificanceStatus, string> = {
  not_reached: "未达到",
  reached: "已达到",
  pending: "待确认",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "待审核",
  passed: "已通过",
  rejected: "已拒绝",
};

export const HYPOTHESIS_RESULT_LABELS: Record<HypothesisResult, string> = {
  confirmed: "已验证",
  rejected: "已否定",
  inconclusive: "不确定",
};

export const EFFECTIVENESS_RATING_LABELS: Record<EffectivenessRating, string> = {
  met_expectations: "达到预期",
  significant_deviation: "显著偏差",
  warning: "预警",
};

export const ITERATION_BRANCH_LABELS: Record<IterationBranch, string> = {
  archive: "归档",
  iterate: "迭代",
};

// ---------------------------------------------------------------------------
// Stage groups — business journey grouping for the 15-state machine
// ---------------------------------------------------------------------------

export interface StageGroup {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly stages: readonly ProjectStage[];
}

export const STAGE_GROUPS: readonly StageGroup[] = [
  {
    id: "S1",
    label: "需求与计划",
    description: "明确分析目标、生成结构化需求和执行计划",
    stages: ["S1.1", "S1.2", "S1.4"],
  },
  {
    id: "S2",
    label: "分析执行与报告",
    description: "准备数据、执行分析、生成并锁定报告",
    stages: ["S2.1", "S2.2", "S2.3", "S2.4", "S2.5", "S2.6"],
  },
  {
    id: "S3",
    label: "行动闭环",
    description: "将分析结论转化为业务行动，评估效果并决定下一步",
    stages: ["S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6"],
  },
];

// ---------------------------------------------------------------------------
// Next-step hints — business-language guidance for each stage
// ---------------------------------------------------------------------------

export const STAGE_NEXT_HINTS: Record<ProjectStage, string> = {
  "S1.1": "等待系统生成结构化需求",
  "S1.2": "请确认需求是否准确，或要求修改",
  "S1.4": "请确认分析计划，或要求修改",
  "S2.1": "计划已确认，准备执行分析",
  "S2.2": "正在准备输入数据和证据",
  "S2.3": "分析运行中，请等待完成",
  "S2.4": "正在生成分析报告",
  "S2.5": "报告已生成，请审核并决定是否锁定",
  "S2.6": "报告已锁定，可进入业务闭合阶段",
  "S3.1": "将分析结论转化为可执行的业务行动",
  "S3.2": "将行动方案部署到下游系统",
  "S3.3": "业务团队执行行动方案",
  "S3.4": "收集执行效果反馈数据",
  "S3.5": "评估行动效果是否达到预期",
  "S3.6": "决定归档或迭代优化",
};

// ---------------------------------------------------------------------------
// Stage group lookup
// ---------------------------------------------------------------------------

export function stageGroup(stage: ProjectStage): StageGroup | undefined {
  return STAGE_GROUPS.find((g) => g.stages.includes(stage));
}

export function stageGroupIndex(stage: ProjectStage): number {
  return STAGE_GROUPS.findIndex((g) => g.stages.includes(stage));
}

// ---------------------------------------------------------------------------
// Project kind descriptions (for empty state)
// ---------------------------------------------------------------------------

export const PROJECT_KIND_DESCRIPTIONS: Record<ProjectKind, string> = {
  goal_decomposition: "将业务目标拆解为可量化的分析子任务",
  daily_analysis: "日常运营指标的例行分析与监控",
  topic_research: "针对特定业务问题的深度专题研究",
};

// ---------------------------------------------------------------------------
// Slug generation — strips all non-ASCII-alphanumeric characters
// ---------------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function generateSlug(title: string): string {
  if (!title.trim()) return "";
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii && /^[a-z0-9]/.test(ascii)) {
    return ascii;
  }
  return `analysis-${Date.now()}`;
}
