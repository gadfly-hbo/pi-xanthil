import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { CommandEvaluationDetail, CommandEvaluationRunResult, EvaluationError, HookEvaluationDetail, HookEvaluationRunResult, PromptEvaluationDetail, PromptEvaluationRunResult, SkillEvaluationDetail, SkillEvaluationRunResult, SubAgentEvaluationDetail, SubAgentEvaluationRunResult, ToolEvaluationDetail, ToolEvaluationRunResult } from "./types.ts";

export interface EvaluationArchiveResult {
  markdownPath: string;
  jsonPath: string;
}

export interface EvaluationArchiveIndexItem {
  kind: "skill" | "tool" | "prompt" | "command" | "subagent" | "hook";
  evaluationId: string;
  baseName: string;
  markdownPath: string;
  jsonPath: string;
  markdownRelPath: string;
  jsonRelPath: string;
  markdownSize: number;
  jsonSize: number;
  updatedAt: number;
}

const MAX_TEXT_CHARS = 4_000;
const MAX_DETAIL_ROWS = 20;

export function archiveSkillEvaluation(workspaceRoot: string, result: SkillEvaluationDetail): EvaluationArchiveResult {
  return archiveEvaluation(workspaceRoot, "skill", result.evaluationId, result, renderSkillEvaluationMarkdown(result));
}

export function archiveToolEvaluation(workspaceRoot: string, result: ToolEvaluationDetail): EvaluationArchiveResult {
  return archiveEvaluation(workspaceRoot, "tool", result.evaluationId, result, renderToolEvaluationMarkdown(result));
}

export function archivePromptEvaluation(workspaceRoot: string, result: PromptEvaluationDetail): EvaluationArchiveResult {
  return archiveEvaluation(workspaceRoot, "prompt", result.evaluationId, result, renderPromptEvaluationMarkdown(result));
}

export function archiveCommandEvaluation(workspaceRoot: string, result: CommandEvaluationDetail): EvaluationArchiveResult {
  return archiveEvaluation(workspaceRoot, "command", result.evaluationId, result, renderCommandEvaluationMarkdown(result));
}

export function archiveSubAgentEvaluation(workspaceRoot: string, result: SubAgentEvaluationDetail): EvaluationArchiveResult {
  return archiveEvaluation(workspaceRoot, "subagent", result.evaluationId, result, renderSubAgentEvaluationMarkdown(result));
}

export function archiveHookEvaluation(workspaceRoot: string, result: HookEvaluationDetail): EvaluationArchiveResult {
  return archiveEvaluation(workspaceRoot, "hook", result.evaluationId, result, renderHookEvaluationMarkdown(result));
}

export function listEvaluationArchives(workspaceRoot: string): EvaluationArchiveIndexItem[] {
  const archiveDir = join(workspaceRoot, "evaluations", "archive");
  if (!existsSync(archiveDir)) return [];
  const files = readdirSync(archiveDir, { withFileTypes: true }).filter((entry) => entry.isFile());
  const bases = new Set(
    files
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".md") || name.endsWith(".json"))
      .map((name) => name.replace(/\.(md|json)$/u, "")),
  );
  const items: EvaluationArchiveIndexItem[] = [];
  for (const baseName of bases) {
    const kind = baseName.startsWith("skill-evaluation-") ? "skill" : baseName.startsWith("tool-evaluation-") ? "tool" : baseName.startsWith("prompt-evaluation-") ? "prompt" : baseName.startsWith("command-evaluation-") ? "command" : baseName.startsWith("subagent-evaluation-") ? "subagent" : baseName.startsWith("hook-evaluation-") ? "hook" : null;
    if (!kind) continue;
    const markdownPath = join(archiveDir, `${baseName}.md`);
    const jsonPath = join(archiveDir, `${baseName}.json`);
    if (!existsSync(markdownPath) || !existsSync(jsonPath)) continue;
    const markdownStat = statSync(markdownPath);
    const jsonStat = statSync(jsonPath);
    items.push({
      kind,
      evaluationId: readArchiveEvaluationId(jsonPath) ?? baseName.replace(`${kind}-evaluation-`, ""),
      baseName,
      markdownPath,
      jsonPath,
      markdownRelPath: relative(workspaceRoot, markdownPath),
      jsonRelPath: relative(workspaceRoot, jsonPath),
      markdownSize: markdownStat.size,
      jsonSize: jsonStat.size,
      updatedAt: Math.max(markdownStat.mtimeMs, jsonStat.mtimeMs),
    });
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

function archiveEvaluation(
  workspaceRoot: string,
  kind: "skill" | "tool" | "prompt" | "command" | "subagent" | "hook",
  evaluationId: string,
  value: unknown,
  markdown: string,
): EvaluationArchiveResult {
  const archiveDir = join(workspaceRoot, "evaluations", "archive");
  mkdirSync(archiveDir, { recursive: true });
  const base = `${kind}-evaluation-${safeFilePart(evaluationId)}`;
  const markdownPath = join(archiveDir, `${base}.md`);
  const jsonPath = join(archiveDir, `${base}.json`);
  writeFileSync(markdownPath, markdown, "utf8");
  writeFileSync(jsonPath, JSON.stringify(value, null, 2), "utf8");
  return { markdownPath, jsonPath };
}

function readArchiveEvaluationId(jsonPath: string): string | null {
  try {
    const value = JSON.parse(readFileSync(jsonPath, "utf8")) as { evaluationId?: unknown };
    return typeof value.evaluationId === "string" && value.evaluationId.trim() ? value.evaluationId : null;
  } catch {
    return null;
  }
}

function renderSkillEvaluationMarkdown(result: SkillEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error || item.pairwise?.error);
  return [
    "# Skill Evaluation Report",
    "",
    "## Summary",
    "",
    keyValueTable([
      ["Evaluation ID", result.evaluationId],
      ["Workspace ID", result.workspaceId],
      ["Model", result.model],
      ["Status", result.status],
      ["Started At", formatTime(result.startedAt)],
      ["Ended At", formatTime(result.endedAt)],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Repeat", String(result.repeat)],
      ["Variants", String(result.variants.length)],
      ["Tasks", String(result.tasks.length)],
      ["Runs", String(result.results.length)],
      ["Failed / Judge Error Runs", String(failed.length)],
    ]),
    "",
    "## Variant Metrics",
    "",
    markdownTable(
      ["Variant", "Success", "Failed", "Activation", "Avg Duration", "Avg Tokens", "Avg Cost", "Avg Tools", "Avg Output Chars"],
      result.variantSummaries.map((item) => [
        item.variantLabel,
        `${item.success}/${item.total}`,
        String(item.failed),
        `${Math.round(item.activationRate * 100)}%`,
        `${item.avgDurationSec.toFixed(2)}s`,
        String(Math.round(item.avgTotalTokens)),
        `$${item.avgTotalCost.toFixed(5)}`,
        String(item.avgToolCalls.toFixed(1)),
        String(Math.round(item.avgOutputChars)),
      ]),
    ),
    "",
    "## Pairwise Judge",
    "",
    result.pairwiseSummaries.length ? markdownTable(
      ["Variant", "Judged", "Skipped", "Win", "Tie", "Loss", "Avg Delta", "Avg Confidence"],
      result.pairwiseSummaries.map((item) => [
        item.variantLabel,
        String(item.judged),
        String(item.skipped),
        String(item.win),
        String(item.tie),
        String(item.loss),
        item.avgScoreDelta.toFixed(1),
        item.avgConfidence === null ? "-" : `${Math.round(item.avgConfidence * 100)}%`,
      ]),
    ) : "No pairwise judge results.",
    "",
    "## Task Metrics",
    "",
    markdownTable(
      ["Task", "Success", "Failed", "Activation"],
      result.taskSummaries.map((item) => [
        item.taskId,
        `${item.success}/${item.total}`,
        String(item.failed),
        `${Math.round(item.activationRate * 100)}%`,
      ]),
    ),
    "",
    "## Failed Runs",
    "",
    failed.length ? failed.slice(0, MAX_DETAIL_ROWS).map(renderSkillRunFailure).join("\n\n") : "No failed runs.",
    failed.length > MAX_DETAIL_ROWS ? `\n\n_Only the first ${MAX_DETAIL_ROWS} failed runs are shown._` : "",
  ].join("\n");
}

export function renderPromptEvaluationMarkdown(result: PromptEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error || item.pairwise?.error);
  return [
    "# Prompt Evaluation Report",
    "",
    "## Summary",
    "",
    keyValueTable([
      ["Evaluation ID", result.evaluationId],
      ["Workspace ID", result.workspaceId],
      ["Model", result.model],
      ["Status", result.status],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Repeat", String(result.repeat)],
      ["Variants", String(result.variants.length)],
      ["Tasks", String(result.tasks.length)],
      ["Runs", String(result.results.length)],
    ]),
    "",
    "## Variant Metrics",
    "",
    markdownTable(
      ["Variant", "Success", "Failed", "Avg Duration", "Avg Tokens", "Avg Cost", "Avg Tools", "Avg Output Chars"],
      result.variantSummaries.map((item) => [item.variantLabel, `${item.success}/${item.total}`, String(item.failed), `${item.avgDurationSec.toFixed(2)}s`, String(Math.round(item.avgTotalTokens)), `$${item.avgTotalCost.toFixed(5)}`, item.avgToolCalls.toFixed(1), String(Math.round(item.avgOutputChars))]),
    ),
    "",
    "## Pairwise Judge",
    "",
    result.pairwiseSummaries.length ? markdownTable(
      ["Variant", "Judged", "Skipped", "Win", "Tie", "Loss", "Avg Delta", "Avg Confidence"],
      result.pairwiseSummaries.map((item) => [item.variantLabel, String(item.judged), String(item.skipped), String(item.win), String(item.tie), String(item.loss), item.avgScoreDelta.toFixed(1), item.avgConfidence === null ? "-" : `${Math.round(item.avgConfidence * 100)}%`]),
    ) : "No pairwise judge results.",
    "",
    "## Failed Runs",
    "",
    failed.length ? failed.slice(0, MAX_DETAIL_ROWS).map(renderPromptRunFailure).join("\n\n") : "No failed runs.",
  ].join("\n");
}

function renderPromptRunFailure(result: PromptEvaluationRunResult): string {
  return [
    `### ${escapeMarkdown(result.variantLabel)} / ${escapeMarkdown(result.taskId)} / attempt ${result.attempt}`,
    "",
    keyValueTable([
      ["Status", result.status],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Tokens", String(result.totalTokens)],
      ["Cost", `$${result.totalCost.toFixed(5)}`],
      ["Error", formatEvaluationError(result.error ?? result.pairwise?.error ?? null) || "-"],
    ]),
    result.output ? fenced("text", truncateText(result.output)) : "",
  ].filter(Boolean).join("\n");
}

function renderCommandEvaluationMarkdown(result: CommandEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error);
  return [
    "# Command Evaluation Report",
    "",
    "## Summary",
    "",
    keyValueTable([
      ["Evaluation ID", result.evaluationId],
      ["Workspace ID", result.workspaceId],
      ["Command ID", result.commandId],
      ["Status", result.status],
      ["Started At", formatTime(result.startedAt)],
      ["Ended At", formatTime(result.endedAt)],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Repeat", String(result.repeat)],
      ["Cases", String(result.cases.length)],
      ["Runs", String(result.results.length)],
      ["Failed Runs", String(failed.length)],
    ]),
    "",
    "## Case Metrics",
    "",
    markdownTable(
      ["Case", "Success", "Failed", "Avg Duration"],
      result.caseSummaries.map((item) => [
        item.caseName,
        `${item.success}/${item.total}`,
        String(item.failed),
        `${item.avgDurationSec.toFixed(2)}s`,
      ]),
    ),
    "",
    "## Failed Runs",
    "",
    failed.length ? failed.slice(0, MAX_DETAIL_ROWS).map(renderCommandRunFailure).join("\n\n") : "No failed runs.",
    failed.length > MAX_DETAIL_ROWS ? `\n\n_Only the first ${MAX_DETAIL_ROWS} failed runs are shown._` : "",
  ].join("\n");
}

function renderCommandRunFailure(result: CommandEvaluationRunResult): string {
  return [
    `### ${escapeMarkdown(result.caseName)} / attempt ${result.attempt}`,
    "",
    keyValueTable([
      ["Status", result.status],
      ["Expectation", result.expectation.kind],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Skill Slugs", result.skillSlugs.join(", ") || "-"],
      ["Error", formatEvaluationError(result.error) || "-"],
    ]),
    result.expandedText ? "#### expanded\n\n" + fenced("text", truncateText(result.expandedText)) : "",
    result.output ? "#### run output\n\n" + fenced("text", truncateText(result.output)) : "",
  ].filter(Boolean).join("\n");
}

export function renderSubAgentEvaluationMarkdown(result: SubAgentEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error);
  return [
    "# SubAgent Evaluation Report",
    "",
    "## Summary",
    "",
    keyValueTable([
      ["Evaluation ID", result.evaluationId],
      ["Workspace ID", result.workspaceId],
      ["Status", result.status],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Repeat", String(result.repeat)],
      ["Cases", String(result.cases.length)],
      ["Runs", String(result.results.length)],
      ["Failed Runs", String(failed.length)],
    ]),
    "",
    "## Case Metrics",
    "",
    markdownTable(
      ["Case", "Success", "Failed", "Avg Duration", "Avg Steps", "Avg Tokens", "Avg Cost"],
      result.caseSummaries.map((item) => [item.caseName, `${item.success}/${item.total}`, String(item.failed), `${item.avgDurationSec.toFixed(2)}s`, item.avgStepCount.toFixed(1), String(Math.round(item.avgTotalTokens)), `$${item.avgTotalCost.toFixed(5)}`]),
    ),
    "",
    "## Failed Runs",
    "",
    failed.length ? failed.slice(0, MAX_DETAIL_ROWS).map(renderSubAgentRunFailure).join("\n\n") : "No failed runs.",
  ].join("\n");
}

function renderSubAgentRunFailure(result: SubAgentEvaluationRunResult): string {
  return [
    `### ${escapeMarkdown(result.caseName)} / attempt ${result.attempt}`,
    "",
    keyValueTable([
      ["Status", result.status],
      ["Expectation", result.expectation.kind],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Steps", String(result.stepCount)],
      ["Tokens", String(result.totalTokens)],
      ["Cost", `$${result.totalCost.toFixed(5)}`],
      ["Tool trajectory", result.toolTrajectory.join(" -> ") || "-"],
      ["Report", result.reportPath ?? "-"],
      ["Error", formatEvaluationError(result.error) || "-"],
    ]),
    result.output ? fenced("text", truncateText(result.output)) : "",
  ].filter(Boolean).join("\n");
}

export function renderHookEvaluationMarkdown(result: HookEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error);
  return [
    "# Hook Evaluation Report",
    "",
    "## Summary",
    "",
    keyValueTable([
      ["Evaluation ID", result.evaluationId],
      ["Workspace ID", result.workspaceId],
      ["Status", result.status],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Repeat", String(result.repeat)],
      ["Cases", String(result.cases.length)],
      ["Runs", String(result.results.length)],
      ["Failed Runs", String(failed.length)],
    ]),
    "",
    "## Case Metrics",
    "",
    markdownTable(
      ["Case", "Success", "Failed", "Avg Duration"],
      result.caseSummaries.map((item) => [item.caseName, `${item.success}/${item.total}`, String(item.failed), `${item.avgDurationSec.toFixed(2)}s`]),
    ),
    "",
    "## Failed Runs",
    "",
    failed.length ? failed.slice(0, MAX_DETAIL_ROWS).map(renderHookRunFailure).join("\n\n") : "No failed runs.",
  ].join("\n");
}

function renderHookRunFailure(result: HookEvaluationRunResult): string {
  return [
    `### ${escapeMarkdown(result.caseName)} / attempt ${result.attempt}`,
    "",
    keyValueTable([
      ["Status", result.status],
      ["Expectation", result.expectation.kind],
      ["Blocked", result.blocked ? "yes" : "no"],
      ["Block reason", result.blockReason ?? "-"],
      ["Matched hooks", result.matchedHookIds.join(", ") || "-"],
      ["Side-effect kinds", result.sideEffectKinds.join(", ") || "-"],
      ["Trigger count", String(result.triggerCount)],
      ["Mutated input", result.mutatedInput === null ? "-" : JSON.stringify(result.mutatedInput)],
      ["Error", formatEvaluationError(result.error) || "-"],
    ]),
  ].filter(Boolean).join("\n");
}

function renderToolEvaluationMarkdown(result: ToolEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error);
  return [
    "# Tool Evaluation Report",
    "",
    "## Summary",
    "",
    keyValueTable([
      ["Evaluation ID", result.evaluationId],
      ["Workspace ID", result.workspaceId],
      ["Tool ID", result.toolId],
      ["Status", result.status],
      ["Started At", formatTime(result.startedAt)],
      ["Ended At", formatTime(result.endedAt)],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Repeat", String(result.repeat)],
      ["Cases", String(result.cases.length)],
      ["Runs", String(result.results.length)],
      ["Failed Runs", String(failed.length)],
    ]),
    "",
    "## Case Metrics",
    "",
    markdownTable(
      ["Case", "Success", "Failed", "Avg Duration"],
      result.caseSummaries.map((item) => [
        item.caseName,
        `${item.success}/${item.total}`,
        String(item.failed),
        `${item.avgDurationSec.toFixed(2)}s`,
      ]),
    ),
    "",
    "## Failed Runs",
    "",
    failed.length ? failed.slice(0, MAX_DETAIL_ROWS).map(renderToolRunFailure).join("\n\n") : "No failed runs.",
    failed.length > MAX_DETAIL_ROWS ? `\n\n_Only the first ${MAX_DETAIL_ROWS} failed runs are shown._` : "",
  ].join("\n");
}

function renderSkillRunFailure(result: SkillEvaluationRunResult): string {
  return [
    `### ${escapeMarkdown(result.variantLabel)} / ${escapeMarkdown(result.taskId)} / attempt ${result.attempt}`,
    "",
    keyValueTable([
      ["Status", result.status],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Tokens", String(result.totalTokens)],
      ["Cost", `$${result.totalCost.toFixed(5)}`],
      ["Tool Calls", String(result.toolCalls)],
      ["Activated", result.activation.activated ? "yes" : "no"],
      ["Error", formatEvaluationError(result.error) || "-"],
      ["Pairwise", result.pairwise ? `${result.pairwise.verdict} / ${result.pairwise.reason}` : "-"],
      ["Pairwise Error", formatEvaluationError(result.pairwise?.error ?? null) || "-"],
    ]),
    result.output ? fenced("text", truncateText(result.output)) : "",
  ].filter(Boolean).join("\n");
}

function renderToolRunFailure(result: ToolEvaluationRunResult): string {
  return [
    `### ${escapeMarkdown(result.caseName)} / attempt ${result.attempt}`,
    "",
    keyValueTable([
      ["Status", result.status],
      ["Expectation", result.expectation.kind],
      ["Input", result.inputPath],
      ["Output", result.outputPath],
      ["Duration", `${result.durationSec.toFixed(2)}s`],
      ["Summary Success", String(result.summary?.success ?? "-")],
      ["Summary Failed", String(result.summary?.failed ?? "-")],
      ["Error", formatEvaluationError(result.error) || "-"],
    ]),
    result.stdout ? "#### stdout\n\n" + fenced("text", truncateText(result.stdout)) : "",
    result.stderr ? "#### stderr\n\n" + fenced("text", truncateText(result.stderr)) : "",
  ].filter(Boolean).join("\n");
}

function keyValueTable(rows: Array<[string, string]>): string {
  return markdownTable(["Key", "Value"], rows);
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!-])/g, "\\$1");
}

function fenced(lang: string, value: string): string {
  return `\`\`\`${lang}\n${value.replace(/```/g, "`\u200b``")}\n\`\`\``;
}

function truncateText(value: string): string {
  return value.length <= MAX_TEXT_CHARS
    ? value
    : `${value.slice(0, MAX_TEXT_CHARS)}\n\n... truncated ${value.length - MAX_TEXT_CHARS} chars`;
}

function formatEvaluationError(error: EvaluationError | null): string {
  if (!error) return "";
  return [error.message, error.hint, error.cause].filter(Boolean).join(" / ");
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
