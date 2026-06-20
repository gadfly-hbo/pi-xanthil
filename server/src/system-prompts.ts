import { buildAnaxQuickWorkflow, buildAnaxWorkflow } from "./anax-template.ts";
import type { WorkflowDef } from "./multi-agent-runner.ts";
import { BLOCK_BASE_BEHAVIOR, BLOCK_FILE_ANALYSIS, BLOCK_SAFETY } from "./prompt-blocks.ts";
import { buildSqlLoopWorkflow } from "./sql-loop-template.ts";

export interface SystemPromptOverview {
  source: string;
  label: string;
  scope: string;
  preview: string;
}

const PREVIEW_MAX_CHARS = 240;

const REPORT_SYSTEM_PROMPT =
  "你是一个数据分析报告专家。将分析结论整理为结构清晰的报告，包含执行摘要、核心发现、方法说明与行动建议，输出 Markdown 格式。写入较长报告文件时，禁止在单次 write 工具调用中传递完整长文；优先使用 bash heredoc 分块写入，或先创建文件再按章节追加，每块控制在合理长度。请等待用户提供分析结果或数据。";

const PRESENTATION_SYSTEM_PROMPT =
  "你是资深数据分析汇报编辑。你的任务是把详细分析报告提炼为简洁、准确、适合沟通的 Markdown 汇报稿。";

function preview(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_CHARS) return normalized;
  return `${normalized.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

function workflowPromptOverviews(template: string, workflow: WorkflowDef): SystemPromptOverview[] {
  return workflow.nodes.map((node) => ({
    source: `${template}.nodes.${node.id}.prompt`,
    label: `${template} · ${node.label}`,
    scope: "workflow-node",
    preview: preview(node.prompt),
  }));
}

export function listSystemPromptOverviews(): SystemPromptOverview[] {
  const staticPrompts: SystemPromptOverview[] = [
    {
      source: "prompt-blocks.ts:BLOCK_SAFETY",
      label: "稳定前缀 · 数据安全约束",
      scope: "all-pi-sessions",
      preview: preview(BLOCK_SAFETY),
    },
    {
      source: "prompt-blocks.ts:BLOCK_BASE_BEHAVIOR",
      label: "稳定前缀 · Agent 行为规范",
      scope: "all-pi-sessions",
      preview: preview(BLOCK_BASE_BEHAVIOR),
    },
    {
      source: "prompt-blocks.ts:BLOCK_FILE_ANALYSIS",
      label: "稳定前缀 · 文件字段字典约束",
      scope: "all-pi-sessions",
      preview: preview(BLOCK_FILE_ANALYSIS),
    },
    {
      source: "memory-injection.ts:buildMemoryPrompt",
      label: "记忆注入 · 动态记忆 prompt",
      scope: "chat | workflow",
      preview: "按 workspace、目标 scope、检索上下文与 token budget 动态选择规则、指标、业务背景和案例；本目录不读取 workspace 内容。",
    },
    {
      source: "memory-injection.ts:withRulesPrompt",
      label: "记忆注入 · system prompt 包装器",
      scope: "chat | workflow",
      preview: "存在动态记忆时，将 buildMemoryPrompt 的结果置于调用方 systemPrompt 之前；无记忆时原样返回。",
    },
    {
      source: "index.ts:WORKFLOW_SYSTEM_PROMPTS.report",
      label: "报告生成 · 数据分析报告",
      scope: "report",
      preview: preview(REPORT_SYSTEM_PROMPT),
    },
    {
      source: "index.ts:generatePresentationVersionWithLlm.systemPrompt",
      label: "汇报生成 · 汇报版本编辑",
      scope: "presentation",
      preview: preview(PRESENTATION_SYSTEM_PROMPT),
    },
    {
      source: "types.ts:ClientMessage.send_flow.systemPrompt",
      label: "工作流对话 · send_flow 自定义 systemPrompt",
      scope: "workflow-runtime",
      preview: "由 send_flow 消息在运行时提供，可选；可能先经记忆与知识注入包装，再传给 pi。该值不持久化，因此仅展示接入点。",
    },
  ];

  return [
    ...staticPrompts,
    ...workflowPromptOverviews("anax-full", buildAnaxWorkflow()),
    ...workflowPromptOverviews("anax-quick", buildAnaxQuickWorkflow()),
    ...workflowPromptOverviews("sql-loop", buildSqlLoopWorkflow()),
  ];
}
