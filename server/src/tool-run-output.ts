/**
 * ToolRunOutput adapter & validator (X-TOOLUSE7B).
 *
 * 职责：
 *   1. 把旧 `summary.json`（LegacyToolSummary）统一转换为标准 `ToolRunOutput`。
 *   2. 识别并透传试点工具已原生输出的 `ToolRunOutput`（缺 gateway 控制字段时补全）。
 *   3. 校验 `ToolRunOutput` 结构、artifact 路径（必须落在本次 run 的 output/report 目录内，禁止穿越）、
 *      metrics 类型、row guard 与 outputContract 冲突。
 *   4. 为自动化入口提供 policy 阻断 / governance warning。
 *
 * 红线：
 *   - 不读取或发送 `draw_data` 原始行。
 *   - artifact 正文不得进入 LLM/MCP tool result；本模块只处理 artifact 元数据（basename/relPath/kind）。
 *   - 不暴露绝对路径给前端/LLM/ledger。
 */
import { randomUUID } from "node:crypto";
import { basename, relative, resolve, sep } from "node:path";
import type {
  MetricSnapshot,
  RiskLevel,
  ToolAiExposure,
  ToolOutputContract,
  ToolRunArtifact,
  ToolRunOutput,
  ToolTableShape,
} from "./types.ts";
import { checkToolPolicy, deriveOutputContract, type ToolPolicyInput } from "./tool-policy.ts";

/** 旧 `summary.json` 的宽松形状；只用于 adapter 内部。 */
export interface LegacyToolSummary {
  success?: number;
  failed?: number;
  error?: string;
  results?: Array<{
    file?: string;
    outputs?: string[];
    error?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface AdapterContext {
  runId: string;
  toolId: string;
  toolName: string;
  outputDir: string;
  summary: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  error: Error | null;
  rowGuard: { blocked: boolean; rowLimit?: number; maxRowsSeen?: number } | null;
  outputContract?: ToolOutputContract;
  metricSnapshots?: MetricSnapshot[];
  caller: string;
  source: "manual" | "ai";
  /** 完整 manifest 中的 policy 字段，用于入口级检查。 */
  category?: "ingestion" | "analysis";
  aiExposure?: ToolAiExposure[];
  riskLevel?: RiskLevel;
  deprecated?: boolean;
  replacementToolId?: string;
}

export interface ToolRunOutputAdapterResult {
  /** 校验后的标准输出。 */
  output: ToolRunOutput;
  /** governance warning（不阻断）。 */
  warnings: string[];
  /** 是否为试点工具已原生输出的标准结构。 */
  isNative: boolean;
  /** 用于向后兼容的旧 summary 快照；null 表示工具已原生迁移。 */
  legacySummary: LegacyToolSummary | null;
  /** 必须阻断当前入口的硬性错误。 */
  blockers: string[];
}

const ALLOWED_ARTIFACT_KINDS: ToolRunArtifact["kind"][] = ["report", "data", "summary", "other"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isToolTableShape(value: unknown): value is ToolTableShape {
  return value === "aggregate" || value === "row_level" || value === "unknown";
}

function isMetricSnapshot(value: unknown): value is MetricSnapshot {
  if (!isPlainObject(value)) return false;
  const name = value.name;
  const val = value.value;
  const period = value.period;
  const status = value.status;
  const source = value.source;
  if (typeof name !== "string" || name.trim() === "") return false;
  if (typeof val !== "number" || !Number.isFinite(val)) return false;
  if (typeof period !== "string") return false;
  if (!["normal", "warning", "alert"].includes(status as string)) return false;
  if (source !== "extraction_tool" && source !== "bi_aggregation") return false;
  return true;
}

function isToolRunArtifact(value: unknown): value is ToolRunArtifact {
  if (!isPlainObject(value)) return false;
  const id = value.id;
  const title = value.title;
  const basename_ = value.basename;
  const relPath = value.relPath;
  const kind = value.kind;
  if (typeof id !== "string" || id.trim() === "") return false;
  if (typeof title !== "string" || title.trim() === "") return false;
  if (typeof basename_ !== "string" || basename_.trim() === "") return false;
  if (typeof relPath !== "string" || relPath.trim() === "") return false;
  if (!ALLOWED_ARTIFACT_KINDS.includes(kind as ToolRunArtifact["kind"])) return false;
  // relPath 必须是相对路径，不得以 / 或 .. 开头，不得包含路径穿越段。
  if (relPath.startsWith("/") || relPath.startsWith("\\")) return false;
  if (relPath.split(/[\\/]/).some((seg) => seg === "..")) return false;
  return true;
}

function isRowGuard(value: unknown): value is { blocked: boolean; rowLimit?: number; maxRowsSeen?: number } {
  if (!isPlainObject(value)) return false;
  if (typeof value.blocked !== "boolean") return false;
  if (value.rowLimit !== undefined && value.rowLimit !== null && (typeof value.rowLimit !== "number" || !Number.isInteger(value.rowLimit) || value.rowLimit < 0)) return false;
  if (value.maxRowsSeen !== undefined && value.maxRowsSeen !== null && (typeof value.maxRowsSeen !== "number" || !Number.isInteger(value.maxRowsSeen) || value.maxRowsSeen < 0)) return false;
  return true;
}

/**
 * 判断工具产物是否已是原生 `ToolRunOutput`（或接近完整的部分结构）。
 * 必须含有 status/summary/metrics/artifacts/rowGuard 等核心字段；缺少 gateway 字段（runId/toolId/toolName/durationMs）
 * 仍视为原生，由 adapter 补全。
 */
export function isNativeToolRunOutput(value: unknown): value is Partial<ToolRunOutput> & Pick<ToolRunOutput, "status" | "summary" | "metrics" | "artifacts" | "rowGuard"> {
  if (!isPlainObject(value)) return false;
  if (!["success", "failed"].includes(value.status as string)) return false;
  if (typeof value.summary !== "string") return false;
  if (!Array.isArray(value.metrics)) return false;
  if (!Array.isArray(value.artifacts)) return false;
  if (value.rowGuard !== null && !isRowGuard(value.rowGuard)) return false;
  return true;
}

/**
 * 将 artifact 绝对路径列表转换为受控的 `ToolRunArtifact[]`。
 * 任何落在 outputDir 之外的绝对路径都会进入 errors，不生成 artifact。
 */
export function buildArtifactsFromOutputs(
  outputs: string[],
  outputDir: string,
): { artifacts: ToolRunArtifact[]; errors: string[] } {
  const artifacts: ToolRunArtifact[] = [];
  const errors: string[] = [];
  const normalizedDir = resolve(outputDir);
  const normalizedRoot = normalizedDir.endsWith(sep) ? normalizedDir : normalizedDir + sep;

  for (const raw of outputs) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const absolute = resolve(normalizedDir, raw);
    if (absolute !== normalizedDir && !absolute.startsWith(normalizedRoot)) {
      errors.push(`artifact path outside output directory: ${raw}`);
      continue;
    }
    const rel = relative(normalizedDir, absolute);
    if (rel.startsWith("..") || rel.split(/[\\/]/).some((seg) => seg === "..")) {
      errors.push(`artifact relative path escapes output directory: ${raw}`);
      continue;
    }
    const name = basename(absolute);
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    const kind: ToolRunArtifact["kind"] = ext === ".md" || ext === ".html" ? "report" : ext === ".json" || ext === ".csv" ? "data" : "other";
    artifacts.push({
      id: randomUUID(),
      title: name,
      basename: name,
      relPath: rel,
      kind,
    });
  }
  return { artifacts, errors };
}

/**
 * 校验 `ToolRunOutput` 结构与 artifact 路径安全。
 * 返回 { valid, errors }；errors 非空表示存在 blocking violation。
 */
export function validateToolRunOutput(
  value: unknown,
  outputDir: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ["ToolRunOutput must be an object"] };
  }
  if (typeof value.runId !== "string" || value.runId.trim() === "") errors.push("runId is required");
  if (typeof value.toolId !== "string" || value.toolId.trim() === "") errors.push("toolId is required");
  if (typeof value.toolName !== "string" || value.toolName.trim() === "") errors.push("toolName is required");
  if (!["success", "failed"].includes(value.status as string)) errors.push("status must be success or failed");
  if (typeof value.summary !== "string") errors.push("summary must be a string");

  if (!Array.isArray(value.metrics)) {
    errors.push("metrics must be an array");
  } else {
    for (let i = 0; i < value.metrics.length; i++) {
      if (!isMetricSnapshot(value.metrics[i])) {
        errors.push(`metrics[${i}] is not a valid MetricSnapshot`);
      }
    }
  }

  if (!Array.isArray(value.artifacts)) {
    errors.push("artifacts must be an array");
  } else {
    for (let i = 0; i < value.artifacts.length; i++) {
      const art = value.artifacts[i];
      if (!isToolRunArtifact(art)) {
        errors.push(`artifacts[${i}] is not a valid ToolRunArtifact`);
        continue;
      }
      const validation = buildArtifactsFromOutputs([art.relPath], outputDir);
      if (validation.errors.length > 0) {
        errors.push(...validation.errors.map((e) => `artifacts[${i}]: ${e}`));
      }
    }
  }

  if (value.rowGuard !== null && !isRowGuard(value.rowGuard)) {
    errors.push("rowGuard must be null or a valid row guard object");
  }

  if (value.errorCode !== undefined && value.errorCode !== null && typeof value.errorCode !== "string") {
    errors.push("errorCode must be a string or null");
  }
  if (value.durationMs !== undefined && (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs))) {
    errors.push("durationMs must be a finite number");
  }

  return { valid: errors.length === 0, errors };
}

function sanitizeSummaryText(text: string): string {
  // 去除可能导致 JSON/协议歧义的换行与前后空白，保持单行短摘要。
  return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function formatLegacySummary(summary: LegacyToolSummary): string {
  if (summary.error) return sanitizeSummaryText(summary.error);
  const success = summary.success ?? 0;
  const failed = summary.failed ?? 0;
  const parts: string[] = [];
  if (success > 0) parts.push(`成功 ${success} 个文件`);
  if (failed > 0) parts.push(`失败 ${failed} 个文件`);
  const outputs = (summary.results ?? [])
    .flatMap((r) => r.outputs ?? [])
    .map((p) => basename(p))
    .filter(Boolean);
  if (outputs.length > 0) parts.push(`产出 ${outputs.join(", ")}`);
  return sanitizeSummaryText(parts.join("；") || "工具执行完成");
}

function collectLegacyOutputs(summary: LegacyToolSummary): string[] {
  return [...new Set((summary.results ?? []).flatMap((r) => r.outputs ?? []).filter((p): p is string => typeof p === "string"))];
}

function mergeMetricSnapshots(native: MetricSnapshot[] | undefined, fromHints: MetricSnapshot[] | undefined): MetricSnapshot[] {
  const nativeArr = Array.isArray(native) ? native : [];
  const hintsArr = Array.isArray(fromHints) ? fromHints : [];
  if (nativeArr.length > 0 && hintsArr.length === 0) return nativeArr;
  if (hintsArr.length > 0 && nativeArr.length === 0) return hintsArr;
  if (nativeArr.length === 0 && hintsArr.length === 0) return [];
  // 同时存在时以原生输出为准；hint 产出的作为 fallback 补入不重复的指标名。
  const seen = new Set(nativeArr.map((m) => m.name));
  return [...nativeArr, ...hintsArr.filter((m) => !seen.has(m.name))];
}

/**
 * 将 legacy summary 转换为目标 `ToolRunOutput`。
 */
function buildToolRunOutputFromLegacy(ctx: AdapterContext, summary: LegacyToolSummary): ToolRunOutput {
  const { artifacts, errors } = buildArtifactsFromOutputs(collectLegacyOutputs(summary), ctx.outputDir);
  const status: ToolRunOutput["status"] = ctx.error ? "failed" : summary.error ? "failed" : "success";
  const rowGuard = ctx.rowGuard;
  const errorCode = ctx.error
    ? "tool_error"
    : summary.error
      ? "tool_error"
      : rowGuard?.blocked
        ? "row_guard"
        : errors.length > 0
          ? "artifact_validation"
          : null;
  return {
    runId: ctx.runId,
    toolId: ctx.toolId,
    toolName: ctx.toolName,
    status,
    summary: formatLegacySummary(summary),
    metrics: ctx.metricSnapshots ?? [],
    artifacts,
    rowGuard,
    errorCode,
    durationMs: ctx.durationMs,
  };
}

/**
 * 补全/透传试点工具已原生输出的结构。
 */
function normalizeNativeToolRunOutput(ctx: AdapterContext, partial: Partial<ToolRunOutput>): ToolRunOutput {
  const rowGuard = partial.rowGuard ?? ctx.rowGuard;
  const status: ToolRunOutput["status"] = partial.status ?? (ctx.error ? "failed" : "success");
  const summary = sanitizeSummaryText(partial.summary ?? (ctx.error ? String(ctx.error.message) : "工具执行完成"));
  const metrics = mergeMetricSnapshots(partial.metrics, ctx.metricSnapshots);
  const errorCode = partial.errorCode ?? (
    ctx.error ? "tool_error" : rowGuard?.blocked ? "row_guard" : null
  );
  return {
    runId: partial.runId ?? ctx.runId,
    toolId: partial.toolId ?? ctx.toolId,
    toolName: partial.toolName ?? ctx.toolName,
    status,
    summary,
    metrics,
    artifacts: Array.isArray(partial.artifacts) ? partial.artifacts : [],
    rowGuard,
    errorCode,
    durationMs: partial.durationMs ?? ctx.durationMs,
  };
}

/**
 * 检查 row guard 结果与工具声明的 outputContract 是否冲突。
 * - aggregate/unknown 工具若 rowGuard.blocked=true，说明 summary 里出现了疑似明细行，与聚合契约冲突。
 * - row_level 工具允许落盘明细，rowGuard.blocked=true 不视为冲突。
 */
function checkRowGuardContractConflict(
  contract: ToolOutputContract,
  rowGuard: ToolRunOutput["rowGuard"],
): string | null {
  if (!rowGuard?.blocked) return null;
  if (contract.tableShape === "row_level") return null;
  return `row guard blocked but outputContract.tableShape=${contract.tableShape}; row-level data in summary conflicts with declared contract`;
}

/**
 * 把 caller/source 映射到 `ToolAiExposure`。
 * source=manual 恒为 manual_confirmed；source=ai 时按 caller 映射。
 * 无法识别的 caller 返回 null，表示无需自动化入口 policy 检查。
 */
export function mapCallerToExposure(
  caller: string,
  source: "manual" | "ai",
): ToolAiExposure | null {
  // source=manual 表示控制台/表单直接调用，不走 AI 入口 policy。
  if (source === "manual") return null;
  switch (caller) {
    case "mcp": return "mcp";
    case "command": return "command";
    case "subagent": return "subagent";
    case "workflow": return "workflow";
    case "eval": return "eval";
    case "chat": return "manual_confirmed";
    case "manual": return "manual_confirmed";
    default: return null;
  }
}

export interface RunPolicyInput {
  id: string;
  category?: "ingestion" | "analysis";
  aiExposure?: ToolAiExposure[];
  riskLevel?: RiskLevel;
  deprecated?: boolean;
  outputContract?: ToolOutputContract;
  replacementToolId?: string;
}

/**
 * 对一次具体运行做入口级 policy 检查。
 * 额外叠加 deprecated 自动化调用阻断。
 */
export function checkRunPolicy(
  tool: RunPolicyInput,
  exposure: ToolAiExposure | null,
): { allowed: boolean; blockers: string[]; warnings: string[] } {
  if (exposure === null) return { allowed: true, blockers: [], warnings: [] };

  const policyInput: ToolPolicyInput = {
    id: tool.id,
    category: tool.category,
    aiExposure: tool.aiExposure,
    riskLevel: tool.riskLevel,
    deprecated: tool.deprecated,
    outputContract: tool.outputContract,
    replacementToolId: tool.replacementToolId,
  };
  const check = checkToolPolicy(policyInput, exposure);

  if (tool.deprecated && exposure !== "manual_confirmed" && exposure !== "eval") {
    check.blockers.push(`tool ${tool.id} is deprecated and cannot be invoked via automated ${exposure}`);
  }

  return { allowed: check.blockers.length === 0, blockers: check.blockers, warnings: check.warnings };
}

/**
 * 主入口：把工具产物（legacy 或 native）适配为 `ToolRunOutput` 并做校验与治理判断。
 */
export function adaptToolRunOutput(ctx: AdapterContext): ToolRunOutputAdapterResult {
  const contract = deriveOutputContract({ outputContract: ctx.outputContract });
  const warnings: string[] = [];
  const blockers: string[] = [];
  let output: ToolRunOutput;
  let isNative = false;
  let legacySummary: LegacyToolSummary | null = null;

  if (isNativeToolRunOutput(ctx.summary)) {
    isNative = true;
    output = normalizeNativeToolRunOutput(ctx, ctx.summary as Partial<ToolRunOutput>);
  } else {
    legacySummary = (ctx.summary ?? {}) as LegacyToolSummary;
    output = buildToolRunOutputFromLegacy(ctx, legacySummary);
    warnings.push(`tool ${ctx.toolId} is using legacy summary.json adapter`);
  }

  // gateway 级校验
  const validation = validateToolRunOutput(output, ctx.outputDir);
  if (!validation.valid) {
    blockers.push(...validation.errors);
  }

  // artifact 路径安全：校验失败中的越界属于 blocking violation
  if (!isNative) {
    const { errors } = buildArtifactsFromOutputs(collectLegacyOutputs(legacySummary!), ctx.outputDir);
    for (const e of errors) {
      blockers.push(e);
    }
  }

  // row guard 与 outputContract 冲突
  const conflict = checkRowGuardContractConflict(contract, output.rowGuard);
  if (conflict) blockers.push(conflict);

  // 自动化入口 policy 检查
  const exposure = mapCallerToExposure(ctx.caller, ctx.source);
  const policyCheck = checkRunPolicy(
    {
      id: ctx.toolId,
      category: ctx.category,
      aiExposure: ctx.aiExposure,
      riskLevel: ctx.riskLevel,
      deprecated: ctx.deprecated,
      outputContract: ctx.outputContract,
      replacementToolId: ctx.replacementToolId,
    },
    exposure,
  );
  if (!policyCheck.allowed) blockers.push(...policyCheck.blockers);
  warnings.push(...policyCheck.warnings);

  // unknown/row_level 下 artifact 正文不得进入 LLM 的 governance warning
  if (contract.tableShape === "unknown" || contract.tableShape === "row_level") {
    warnings.push(`tool ${ctx.toolId} output shape is ${contract.tableShape}; artifact content must not be injected into LLM`);
  }

  return { output, warnings, isNative, legacySummary, blockers };
}

/**
 * 生成一个稳定的 "legacy-compatible" 响应对象，供 `/api/extraction-tools/:id/run` 在返回标准
 * `ToolRunOutput` 字段的同时，保留旧字段（success/failed/results/error/stdout/stderr）以兼容
 * 现有调用方。旧字段仅作兼容，不应被新代码依赖。
 */
export function buildLegacyCompatibleResponse(
  output: ToolRunOutput,
  legacySummary: LegacyToolSummary | null,
  stdout: string,
  stderr: string,
): Record<string, unknown> {
  const legacy = legacySummary ?? {};
  return {
    ...output,
    stdout,
    stderr,
    success: legacy.success ?? (output.status === "success" ? 1 : 0),
    failed: legacy.failed ?? (output.status === "failed" ? 1 : 0),
    results: legacy.results,
    ...(output.errorCode ? { errorCode: output.errorCode } : {}),
    ...(output.rowGuard?.blocked && output.rowGuard.rowLimit !== undefined
      ? { error: `结果超 ${output.rowGuard.rowLimit} 行，疑似明细输出，请加 GROUP BY/COUNT 聚合`, rowLimit: output.rowGuard.rowLimit, maxRowsSeen: output.rowGuard.maxRowsSeen }
      : {}),
  };
}
