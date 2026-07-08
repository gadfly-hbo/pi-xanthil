import type { ExtractionToolManifest } from "../tools/registry.ts";
import type { RiskLevel, ToolAiExposure, ToolOutputContract, ToolPolicyCheck } from "./types.ts";

export const AUTOMATION_CANDIDATE_EXPOSURES: readonly ToolAiExposure[] = [
  "mcp",
  "command",
  "subagent",
  "workflow",
];

export const DEFAULT_ANALYSIS_AI_EXPOSURE: readonly ToolAiExposure[] = [
  "manual_confirmed",
  "mcp",
  "command",
  "subagent",
  "workflow",
  "eval",
];

export type ToolPolicyInput = Pick<
  ExtractionToolManifest,
  "id" | "category" | "aiExposure" | "riskLevel" | "deprecated" | "outputContract" | "replacementToolId"
>;

export type ToolExposureInput = Pick<
  ExtractionToolManifest,
  "category" | "aiExposure" | "riskLevel" | "deprecated"
>;

/**
 * 从 manifest 推导原始 aiExposure：显式 > category 推导。
 * - analysis 且缺省 → 全能力集合（v1 等价）
 * - ingestion 且缺省 → 空集合
 * 返回副本，避免外部 mutation。
 */
export function deriveAiExposure(
  tool: Pick<ExtractionToolManifest, "category" | "aiExposure">
): ToolAiExposure[] {
  if (tool.aiExposure !== undefined) return [...tool.aiExposure];
  if (tool.category === "analysis") return [...DEFAULT_ANALYSIS_AI_EXPOSURE];
  return [];
}

/**
 * riskLevel 作为 aiExposure 的硬上限：
 * - L0/L1：无限制
 * - L2：禁止 automation candidate MCP（mcp）
 * - L3：只能人工确认（manual_confirmed）或 eval
 */
export function applyRiskLevelCap(
  exposure: ToolAiExposure[],
  riskLevel: RiskLevel | undefined
): ToolAiExposure[] {
  if (!riskLevel || riskLevel === "L0" || riskLevel === "L1") return exposure;
  if (riskLevel === "L2") return exposure.filter((e) => e !== "mcp");
  return exposure.filter((e) => e === "manual_confirmed" || e === "eval");
}

/**
 * deprecated 工具不得进入自动化候选：过滤 mcp / command / subagent / workflow，
 * 保留 manual_confirmed / eval（人工/评测兼容）。
 */
export function applyDeprecatedFilter(
  exposure: ToolAiExposure[],
  deprecated: boolean | undefined
): ToolAiExposure[] {
  if (!deprecated) return exposure;
  return exposure.filter((e) => e === "manual_confirmed" || e === "eval");
}

/**
 * 生效的 aiExposure = 推导 → riskLevel 上限 → deprecated 过滤。
 */
export function getEffectiveAiExposure(
  tool: ToolExposureInput
): ToolAiExposure[] {
  const derived = deriveAiExposure(tool);
  const capped = applyRiskLevelCap(derived, tool.riskLevel);
  return applyDeprecatedFilter(capped, tool.deprecated);
}

export function hasAutomationCandidateExposure(exposure: ToolAiExposure[]): boolean {
  return exposure.some((e) => AUTOMATION_CANDIDATE_EXPOSURES.includes(e));
}

/**
 * 是否可被自动化 AI 入口使用（MCP / subagent / workflow / command）。
 * eval 与 manual_confirmed 不算自动化候选；若需判断，用 canExposeTo。
 * v1 兼容：category=analysis 且未被 riskLevel/deprecated 阻断 → true。
 */
export function isAiExposedTool(tool: ToolExposureInput): boolean {
  return hasAutomationCandidateExposure(getEffectiveAiExposure(tool));
}

export function isToolBindable(tool: ToolExposureInput): boolean {
  return hasAutomationCandidateExposure(getEffectiveAiExposure(tool));
}

/**
 * 判断工具是否允许暴露到特定入口。
 */
export function canExposeTo(
  tool: ToolExposureInput,
  exposure: ToolAiExposure
): boolean {
  return getEffectiveAiExposure(tool).includes(exposure);
}

export function listAiExposedToolIds(
  tools: Array<ToolExposureInput & { id: string }>
): Set<string> {
  return new Set(tools.filter(isAiExposedTool).map((tool) => tool.id));
}

export function filterAiExposedTools<T extends ToolExposureInput>(tools: T[]): T[] {
  return tools.filter(isAiExposedTool);
}

/**
 * 返回归一化的 outputContract；缺省时保守推导为 unknown。
 */
export function deriveOutputContract(
  tool: Pick<ExtractionToolManifest, "outputContract">
): ToolOutputContract {
  return tool.outputContract ?? { tableShape: "unknown" };
}

/**
 * 检查 replacementToolId 是否指向有效且未退役的工具。
 */
export function validateToolReplacement(
  tool: Pick<ExtractionToolManifest, "id" | "replacementToolId" | "deprecated">,
  allTools: Array<Pick<ExtractionToolManifest, "id" | "deprecated">>
): string[] {
  const warnings: string[] = [];
  if (!tool.replacementToolId) return warnings;
  const replacement = allTools.find((t) => t.id === tool.replacementToolId);
  if (!replacement) {
    warnings.push(
      `tool ${tool.id} references missing replacement ${tool.replacementToolId}`
    );
  } else if (replacement.deprecated) {
    warnings.push(
      `tool ${tool.id} references deprecated replacement ${tool.replacementToolId}`
    );
  }
  return warnings;
}

/**
 * 入口级 policy 检查：明确返回 blocker / warning。
 * 本函数不执行，只产生确定性判断，供 /run adapter 与各入口调用。
 */
export function checkToolPolicy(
  tool: ToolPolicyInput,
  exposure: ToolAiExposure
): ToolPolicyCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const effective = getEffectiveAiExposure(tool);

  if (!effective.includes(exposure)) {
    blockers.push(`tool ${tool.id} is not exposed to ${exposure}`);
  }

  const contract = deriveOutputContract(tool);

  // 保守策略：unknown 输出形态禁止直接进入 autonomous MCP/subagent
  if (contract.tableShape === "unknown") {
    if (exposure === "mcp") {
      if (!contract.llmSafeSummary) {
        blockers.push(
          `tool ${tool.id} has unknown output shape and cannot be used via autonomous MCP`
        );
      }
    } else if (exposure === "subagent") {
      if (!contract.llmSafeSummary) {
        blockers.push(
          `tool ${tool.id} has unknown output shape and cannot be used via autonomous subagent`
        );
      }
    }
  }

  // row_level 输出禁止进入 autonomous MCP/subagent
  if (contract.tableShape === "row_level") {
    if (exposure === "mcp" || exposure === "subagent") {
      blockers.push(
        `tool ${tool.id} produces row-level output and cannot be used via autonomous ${exposure}`
      );
    }
  }

  // command/workflow 允许绑定，但提示不得把 artifact 正文注入 LLM
  if (contract.tableShape === "unknown" || contract.tableShape === "row_level") {
    if (exposure === "command" || exposure === "workflow") {
      warnings.push(
        `tool ${tool.id} output shape is ${contract.tableShape}; artifact content must not be injected into LLM`
      );
    }
  }

  return { allowed: blockers.length === 0, blockers, warnings };
}

/**
 * 治理级别 warning：返回该 manifest 在 aiExposure/riskLevel/deprecated 上的冲突提示。
 */
export function getToolGovernanceWarnings(
  tool: ToolPolicyInput,
  allTools?: Array<Pick<ExtractionToolManifest, "id" | "deprecated">>
): string[] {
  const warnings: string[] = [];
  const raw = deriveAiExposure(tool);
  const capped = applyRiskLevelCap(raw, tool.riskLevel);
  const removedByRiskLevel = raw.filter((e) => !capped.includes(e));
  if (removedByRiskLevel.length > 0) {
    warnings.push(
      `tool ${tool.id} riskLevel=${tool.riskLevel} removes exposures: ${removedByRiskLevel.join(", ")}`
    );
  }
  const effective = applyDeprecatedFilter(capped, tool.deprecated);
  const removedByDeprecated = capped.filter((e) => !effective.includes(e));
  if (removedByDeprecated.length > 0) {
    warnings.push(
      `tool ${tool.id} is deprecated and removes automation exposures: ${removedByDeprecated.join(", ")}`
    );
  }
  if (tool.replacementToolId && allTools) {
    warnings.push(...validateToolReplacement(tool, allTools));
  }
  return warnings;
}

export function renderToolManifestSummary(
  tool: Pick<
    ExtractionToolManifest,
    "tags" | "allowedUse" | "forbiddenUse" | "riskLevel" | "deprecated" | "replacementToolId"
  >
): string {
  const parts: string[] = [];
  if (tool.tags?.length) parts.push(`tags=${tool.tags.slice(0, 6).join(",")}`);
  if (tool.riskLevel) parts.push(`risk=${tool.riskLevel}`);
  if (tool.deprecated) parts.push(`deprecated=true`);
  if (tool.replacementToolId) parts.push(`replacement=${tool.replacementToolId}`);
  if (tool.allowedUse) parts.push(`适用: ${tool.allowedUse}`);
  if (tool.forbiddenUse) parts.push(`禁止: ${tool.forbiddenUse}`);
  return parts.join("；");
}
