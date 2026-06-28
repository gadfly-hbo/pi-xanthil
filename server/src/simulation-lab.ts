import { basename, dirname, extname, join, resolve } from "node:path";
import { runPiPrompt } from "./pi-adapter.ts";
import { getWorkspacePath, getWorkspace } from "./db.ts";
import { readFlowFile, writeFlowFile } from "./flow-fs.ts";
import type { DigitalLifeForm, SimulationRunInput, SimulationRunResult, SimulationArtifactPaths, SimulationScenario } from "./types.ts";

export type SimulationRunPi = (opts: {
  workspaceRoot: string;
  model: string;
  systemPrompt: string;
  text: string;
  timeoutMs: number;
}) => Promise<string>;

const VALID_SCENARIOS: ReadonlyArray<SimulationScenario> = ["consumer_campaign", "product_concept", "expert_panel"];

export function extractJsonObjectText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return "{}";
  return raw.slice(start, end + 1);
}

export function repairLooseJson(text: string): string {
  return text.replace(/,\s*([\]}])/g, "$1");
}

export function extractJsonObject(text: string): unknown {
  const raw = extractJsonObjectText(text);
  if (raw === "{}") throw new Error(`LLM response does not contain JSON object: ${text.slice(0, 300)}`);
  for (const candidate of [raw, repairLooseJson(raw)]) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  throw new Error(`LLM response JSON could not be parsed: ${raw.slice(0, 300)}`);
}

async function repairSimulationJson(rawOutput: string, model: string, workspaceRoot: string, runPi: SimulationRunPi): Promise<unknown> {
  const schemaHint = `
{
  "scenario": "consumer_campaign | product_concept | expert_panel",
  "verdict": "go | revise | hold | reject",
  "overallScore": 0-100,
  "roleAssessments": [{
    "lifeFormId": "string",
    "name": "string",
    "stance": "support | conditional | oppose | uncertain",
    "score": 0-100,
    "rationale": "string",
    "acceptanceConditions": ["string"],
    "objections": ["string"],
    "evidenceQuotes": ["string"],
    "suggestions": ["string"]
  }],
  "risks": ["string"],
  "recommendedChanges": ["string"],
  "validationExperiments": ["string"]
}
`;
  const repaired = await runPi({
    workspaceRoot,
    model,
    systemPrompt: "你是 JSON 修复器。只输出严格 JSON，不要解释。",
    text: `请把下面模型输出改写为符合 schema 的严格 JSON。\n\nschema：\n${schemaHint}\n\n原输出：\n${rawOutput.slice(0, 8000)}`,
    timeoutMs: 60_000,
  });
  return extractJsonObject(repaired);
}

function sanitizeReportText(text: string): string {
  // The backend never accesses draw_data; this hook is reserved for future masking of derived report text.
  return text;
}

export function validateReportRelPath(path: string): void {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) throw new Error("report path required");
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) {
    throw new Error("invalid report path");
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeRoleAssessment(value: unknown, fallback: DigitalLifeForm): SimulationRunResult["roleAssessments"][number] {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const stance = source.stance === "support" || source.stance === "conditional" || source.stance === "oppose" || source.stance === "uncertain"
    ? source.stance
    : "uncertain";
  const rawScore = typeof source.score === "number" && Number.isFinite(source.score) ? source.score : 0;
  return {
    lifeFormId: typeof source.lifeFormId === "string" && source.lifeFormId.trim() ? source.lifeFormId.trim() : fallback.id,
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallback.name,
    stance,
    score: Math.max(0, Math.min(100, rawScore)),
    rationale: typeof source.rationale === "string" ? source.rationale : "",
    acceptanceConditions: asStringArray(source.acceptanceConditions),
    objections: asStringArray(source.objections),
    evidenceQuotes: asStringArray(source.evidenceQuotes).map((quote) => quote.slice(0, 240)),
    suggestions: asStringArray(source.suggestions),
  };
}

export function normalizeSimulationResult(value: unknown, input: SimulationRunInput, artifactPaths: SimulationArtifactPaths, id = `simulation_${Date.now()}`): SimulationRunResult {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const verdict = source.verdict === "go" || source.verdict === "revise" || source.verdict === "hold" || source.verdict === "reject"
    ? source.verdict
    : "hold";  const rawScore = typeof source.overallScore === "number" && Number.isFinite(source.overallScore) ? source.overallScore : 0;
  const rawAssessments = Array.isArray(source.roleAssessments) ? source.roleAssessments : [];
  const roleAssessments = input.lifeForms.map((lifeForm, index) => normalizeRoleAssessment(rawAssessments[index], lifeForm));
  return {
    id,
    scenario: input.scenario,
    verdict,
    overallScore: Math.max(0, Math.min(100, rawScore)),
    summary: typeof source.summary === "string" && source.summary.trim() ? source.summary.trim() : "模拟实验已完成，但模型未返回摘要。",
    roleAssessments,
    risks: asStringArray(source.risks),
    recommendedChanges: asStringArray(source.recommendedChanges),
    validationExperiments: asStringArray(source.validationExperiments),
    artifactPaths,
    model: input.model,
  };
}

export interface RunSimulationLabOptions {
  /** Injected pi runner for tests; defaults to runPiPrompt. */
  runPi?: SimulationRunPi;
}

const defaultRunPi: SimulationRunPi = (opts) => runPiPrompt({ ...opts, onEvent: () => {} });

/**
 * Pure: parse + validate raw POST /api/simulation-lab/run body.
 * Folder / extension / DB guards remain inside runSimulationLab; this only covers shape rules.
 */
export function parseSimulationRunRequest(body: unknown): SimulationRunInput {
  const src = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof src.pathId !== "number" || !Number.isFinite(src.pathId)) {
    throw new Error("pathId (number) required");
  }
  if (typeof src.model !== "string" || !src.model.trim()) {
    throw new Error("model required");
  }
  if (typeof src.scenario !== "string" || !(VALID_SCENARIOS as ReadonlyArray<string>).includes(src.scenario)) {
    throw new Error("invalid scenario");
  }
  if (!Array.isArray(src.lifeForms) || src.lifeForms.length === 0) {
    throw new Error("at least one lifeForm required");
  }
  const lifeForms: DigitalLifeForm[] = src.lifeForms.map((raw, idx) => {
    const lf = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof lf.id !== "string" || !lf.id.trim()) throw new Error(`lifeForms[${idx}].id required`);
    if (typeof lf.name !== "string" || !lf.name.trim()) throw new Error(`lifeForms[${idx}].name required`);
    if (typeof lf.persona !== "string" || !lf.persona.trim()) throw new Error(`lifeForms[${idx}].persona required`);
    const source: "subagent_template" | "manual_persona" | "crowd_profile" =
      lf.source === "subagent_template" || lf.source === "manual_persona" || lf.source === "crowd_profile" ? lf.source : "manual_persona";
    const out: DigitalLifeForm = {
      id: lf.id.trim(),
      name: lf.name.trim(),
      persona: lf.persona,
      source,
    };
    if (typeof lf.templateId === "string" && lf.templateId.trim()) out.templateId = lf.templateId.trim();
    if (typeof lf.crowdProfileId === "string" && lf.crowdProfileId.trim()) out.crowdProfileId = lf.crowdProfileId.trim();
    if (typeof lf.crowdProfileVersionId === "string" && lf.crowdProfileVersionId.trim()) out.crowdProfileVersionId = lf.crowdProfileVersionId.trim();
    return out;
  });
  const result: SimulationRunInput = {
    pathId: src.pathId,
    scenario: src.scenario as SimulationScenario,
    model: src.model.trim(),
    lifeForms,
  };
  if (typeof src.relPath === "string" && src.relPath.trim()) result.relPath = src.relPath;
  if (typeof src.prompt === "string") result.prompt = src.prompt;
  if (typeof src.businessContext === "string") result.businessContext = src.businessContext;
  return result;
}

/**
 * Pure: build the system + user prompts. Includes report name / scenario / personas / report body.
 * Truncates persona (1500) and report (30000) chars. Never includes any toolIds — DLF is persona-only.
 */
export function buildSimulationPrompts(args: {
  reportName: string;
  reportText: string;
  input: SimulationRunInput;
}): { systemPrompt: string; userPrompt: string } {
  const { reportName, reportText, input } = args;
  const personas = input.lifeForms.map((lf) => {
    return `ID: ${lf.id}\nName: ${lf.name}\nPersona: ${lf.persona.slice(0, 1500)}`;
  }).join("\n\n---\n\n");

  const systemPrompt = `你是模拟实验裁判。请基于提供的方案报告和用户输入的 DigitalLifeForms（虚拟人类群体），进行严谨的角色扮演和模拟推演。
要求：
1. 每个角色必须独立思考，基于其自身的 Persona 判断是否接受方案。
2. 你需要从整体上评估本次模拟实验的结果，给出 overallScore 和 verdict。
3. 输出严格 JSON 对象，不要解释，不要使用 Markdown fence（如 \`\`\`json）。
4. evidenceQuotes 必须是从报告/方案中摘录的短语或短句。`;

  const userPrompt = `场景：${input.scenario}

报告名称：${reportName}

模拟目标提示：
${input.prompt || "无"}

业务上下文（可选衍生文本，不得包含原始明细）：
${input.businessContext || "无"}

角色群体 (Digital Life Forms)：
${personas}

方案报告原文：
${sanitizeReportText(reportText).slice(0, 30_000)}`;

  return { systemPrompt, userPrompt };
}

export async function runSimulationLab(input: SimulationRunInput, opts: RunSimulationLabOptions = {}): Promise<SimulationRunResult> {
  const runPi = opts.runPi ?? defaultRunPi;

  const wsPath = getWorkspacePath(input.pathId);
  if (!wsPath) throw new Error("pathId not found");
  if (wsPath.folder !== "report") throw new Error("Simulation lab only supports reports");

  const workspace = getWorkspace(wsPath.workspaceId);
  if (!workspace) throw new Error("workspace not found");

  const outputDir = wsPath.kind === "dir" ? resolve(wsPath.path) : dirname(resolve(wsPath.path));
  const sourceRelPath = wsPath.kind === "dir" ? input.relPath ?? "" : basename(wsPath.path);
  if (wsPath.kind === "dir" && !sourceRelPath) throw new Error("relPath required for directory report paths");
  if (wsPath.kind === "file" && input.relPath) throw new Error("file report paths do not accept relPath");
  validateReportRelPath(sourceRelPath);

  const ext = extname(sourceRelPath).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown" && ext !== ".txt") {
    throw new Error("Simulation lab only supports text reports (.md, .markdown, .txt)");
  }

  const lifeForms = input.lifeForms;
  if (!Array.isArray(lifeForms) || lifeForms.length === 0) {
    throw new Error("At least one DigitalLifeForm is required");
  }

  const reportText = readFlowFile(outputDir, sourceRelPath).content;

  const { systemPrompt, userPrompt } = buildSimulationPrompts({
    reportName: basename(sourceRelPath),
    reportText,
    input,
  });

  const rawOutput = await runPi({
    workspaceRoot: workspace.rootPath,
    model: input.model,
    systemPrompt,
    text: userPrompt,
    timeoutMs: 120_000,
  });

  let parsed: unknown;
  try {
    parsed = extractJsonObject(rawOutput);
  } catch {
    parsed = await repairSimulationJson(rawOutput, input.model, workspace.rootPath, runPi);
  }

  if (
    typeof parsed !== "object" || parsed === null ||
    typeof (parsed as { verdict?: unknown }).verdict !== "string" ||
    typeof (parsed as { overallScore?: unknown }).overallScore !== "number" ||
    !Array.isArray((parsed as { roleAssessments?: unknown }).roleAssessments)
  ) {
    throw new Error("Repaired JSON still missing required fields");
  }

  const timestamp = Date.now();
  const runId = `simulation_${timestamp}`;
  const jsonName = `${runId}.json`;
  const mdName = `${runId}.md`;
  const sourceDir = dirname(sourceRelPath) === "." ? "" : dirname(sourceRelPath);
  const outputPrefix = sourceDir ? join(sourceDir, "simulation_lab") : "simulation_lab";
  const jsonRelPath = join(outputPrefix, jsonName);
  const markdownRelPath = join(outputPrefix, mdName);
  const artifactPaths: SimulationArtifactPaths = {
    json: jsonRelPath,
    markdown: markdownRelPath,
  };
  const result = normalizeSimulationResult(parsed, input, artifactPaths, runId);

  writeFlowFile(outputDir, jsonRelPath, `${JSON.stringify(result, null, 2)}\n`);

  const mdContent = `# 模拟实验报告 (DLF)

**场景**: ${result.scenario}
**综合得分**: ${result.overallScore} / 100
**最终结论**: ${result.verdict.toUpperCase()}

## 总体分析
${result.summary}

**主要风险 (Risks)**:
${result.risks?.map(r => `- ${r}`).join("\n") || "无"}

**推荐修改 (Recommended Changes)**:
${result.recommendedChanges?.map(c => `- ${c}`).join("\n") || "无"}

**后续验证实验建议 (Validation Experiments)**:
${result.validationExperiments?.map(e => `- ${e}`).join("\n") || "无"}

## 角色反馈详情 (Role Assessments)
${result.roleAssessments.map(ra => `
### ${ra.name} (ID: ${ra.lifeFormId})
- **立场**: ${ra.stance}
- **打分**: ${ra.score} / 100
- **理由 (Rationale)**: ${ra.rationale}
- **支持条件**:
${ra.acceptanceConditions?.map(c => `  - ${c}`).join("\n") || "  - 无"}
- **主要异议**:
${ra.objections?.map(o => `  - ${o}`).join("\n") || "  - 无"}
- **原文引用 (Evidence Quotes)**:
${ra.evidenceQuotes?.map(q => `  - > ${q}`).join("\n") || "  - 无"}
- **建议 (Suggestions)**:
${ra.suggestions?.map(s => `  - ${s}`).join("\n") || "  - 无"}
`).join("\n")}
`;

  writeFlowFile(outputDir, markdownRelPath, mdContent.endsWith("\n") ? mdContent : `${mdContent}\n`);

  return result;
}
