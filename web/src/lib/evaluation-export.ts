import type { EvaluationArchiveIndexItem, EvaluationError, PromptEvaluationDetail, PromptEvaluationRunResult, SkillEvaluationDetail, SkillEvaluationRunResult, ToolEvaluationDetail, ToolEvaluationRunResult } from "@/types";

const MAX_TEXT_CHARS = 4_000;
const MAX_DETAIL_ROWS = 20;

export function downloadEvaluationJson(prefix: "skill" | "tool" | "prompt", evaluationId: string, value: unknown): void {
  downloadTextFile(`${prefix}-evaluation-${safeFilePart(evaluationId)}.json`, JSON.stringify(value, null, 2), "application/json;charset=utf-8");
}

export function downloadPromptEvaluationMarkdown(result: PromptEvaluationDetail): void {
  downloadTextFile(
    `prompt-evaluation-${safeFilePart(result.evaluationId)}.md`,
    renderPromptEvaluationMarkdown(result),
    "text/markdown;charset=utf-8",
  );
}

export function downloadSkillEvaluationMarkdown(result: SkillEvaluationDetail): void {
  downloadTextFile(
    `skill-evaluation-${safeFilePart(result.evaluationId)}.md`,
    renderSkillEvaluationMarkdown(result),
    "text/markdown;charset=utf-8",
  );
}

export function downloadToolEvaluationMarkdown(result: ToolEvaluationDetail): void {
  downloadTextFile(
    `tool-evaluation-${safeFilePart(result.evaluationId)}.md`,
    renderToolEvaluationMarkdown(result),
    "text/markdown;charset=utf-8",
  );
}

export function downloadEvaluationArchiveManifest(archives: unknown[]): void {
  downloadTextFile("evaluation-archives-manifest.json", JSON.stringify(archives, null, 2), "application/json;charset=utf-8");
}

export function downloadArchiveTextFile(filename: string, content: string, type: "md" | "json"): void {
  downloadTextFile(filename, content, type === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8");
}

function renderSkillEvaluationMarkdown(result: SkillEvaluationDetail): string {
  const failed = result.results.filter((item) => item.status === "failed" || item.error);
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
      ["Failed Runs", String(failed.length)],
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

function renderPromptEvaluationMarkdown(result: PromptEvaluationDetail): string {
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

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

// ---- zip batch download ----

export async function downloadArchivesZip(
  archives: EvaluationArchiveIndexItem[],
  fetchFile: (baseName: string, format: "md" | "json") => Promise<string>,
): Promise<void> {
  const enc = new TextEncoder();
  const pairs = archives.flatMap((a) => [
    { name: `${a.baseName}.md`, baseName: a.baseName, format: "md" as const },
    { name: `${a.baseName}.json`, baseName: a.baseName, format: "json" as const },
  ]);
  const contents = await Promise.all(pairs.map((p) => fetchFile(p.baseName, p.format)));
  const files = pairs.map((p, i) => ({ name: p.name, data: enc.encode(contents[i]!) }));
  const zipBytes = buildZip(files);
  const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `evaluation-archives-${new Date().toISOString().slice(0, 10)}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Minimal ZIP builder — stored (no compression), pure TypeScript, no dependencies.
function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const localBlocks: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = computeCrc32(file.data);
    const size = file.data.length;

    const local = new DataView(new ArrayBuffer(30 + nameBytes.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // version needed
    local.setUint16(6, 0, true);        // flags
    local.setUint16(8, 0, true);        // method: stored
    local.setUint16(10, 0, true);       // mod time
    local.setUint16(12, 0, true);       // mod date
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);    // compressed size
    local.setUint32(22, size, true);    // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);       // extra field length
    new Uint8Array(local.buffer).set(nameBytes, 30);

    const central = new DataView(new ArrayBuffer(46 + nameBytes.length));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);     // version made by
    central.setUint16(6, 20, true);     // version needed
    central.setUint16(8, 0, true);      // flags
    central.setUint16(10, 0, true);     // method: stored
    central.setUint16(12, 0, true);     // mod time
    central.setUint16(14, 0, true);     // mod date
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);  // compressed size
    central.setUint32(24, size, true);  // uncompressed size
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);     // extra field length
    central.setUint16(32, 0, true);     // file comment length
    central.setUint16(34, 0, true);     // disk number start
    central.setUint16(36, 0, true);     // internal attrs
    central.setUint32(38, 0, true);     // external attrs
    central.setUint32(42, localOffset, true); // local header offset
    new Uint8Array(central.buffer).set(nameBytes, 46);

    const block = concat([new Uint8Array(local.buffer), file.data]);
    localBlocks.push(block);
    centralEntries.push(new Uint8Array(central.buffer));
    localOffset += block.length;
  }

  const centralDir = concat(centralEntries);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);                          // disk number
  eocd.setUint16(6, 0, true);                          // start disk
  eocd.setUint16(8, files.length, true);               // entries on disk
  eocd.setUint16(10, files.length, true);              // total entries
  eocd.setUint32(12, centralDir.length, true);         // central dir size
  eocd.setUint32(16, localOffset, true);               // central dir offset
  eocd.setUint16(20, 0, true);                         // comment length

  return concat([...localBlocks, centralDir, new Uint8Array(eocd.buffer)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

function computeCrc32(data: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}
