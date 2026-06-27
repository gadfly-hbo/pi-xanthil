import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { collectEvent, emptyMetrics, extractText } from "./evaluation-common.ts";
import { runPiTurn } from "./pi-adapter.ts";
import { saveSkillCurationProposals } from "./db.ts";
import { listSkillRegistryEntries } from "./db/engine.ts";
import { listSkills } from "./skills.ts";
import { guardSlowUpdateWrite } from "./skill-rewrite-gate.ts";
import { buildRejectedFeedbackPrompt, insertRejectedEdit } from "./skill-rejected-buffer.ts";
import type { SkillCurationApplyResult, SkillCurationProposal, SkillCurationResult, SkillEvaluationDetail, SkillRegistryEntry } from "./types.ts";

export interface SkillCurationRequest {
  workspaceRoot: string;
  workspaceId: string;
  model: string;
  evaluation: SkillEvaluationDetail;
}

export interface SkillCurationApplyRequest {
  workspaceRoot: string;
  proposals: SkillCurationProposal[];
}

export interface CuratedSkillContent {
  name: string;
  path: string;
  content: string;
}

export interface DescriptionOptimizationEvidence {
  skillName: string;
  path: string;
  currentDescription: string;
  prodInjectedCount: number;
  prodActivatedCount: number;
  prodActivationRate: number | null;
  evalMisses: Array<{ taskId: string; variantId: string; outputSnippet: string }>;
  evidence: string[];
}

const LOW_PROD_ACTIVATION_RATE = 0.4;
const MIN_PROD_INJECTIONS_FOR_DESCRIPTION_OPT = 3;

export async function curateSkillEvaluation(request: SkillCurationRequest): Promise<SkillCurationResult> {
  const { workspaceRoot, workspaceId, model, evaluation } = request;
  const curatorDir = join(workspaceRoot, "evaluations", "curator", evaluation.evaluationId);
  mkdirSync(curatorDir, { recursive: true });

  const skills = listSkills(workspaceRoot).filter((s) => s.available);
  const registryEntries = listSkillRegistryEntries(workspaceId, "active");
  const testedPaths = new Set(evaluation.variants.flatMap((v) => v.skillPaths));
  const skillContents = skills
    .filter((s) => testedPaths.has(s.path))
    .map((s) => {
      try {
        return { name: s.name, path: s.path, content: readFileSync(s.path, "utf8") };
      } catch {
        return { name: s.name, path: s.path, content: "" };
      }
    });
  const skillContentPaths = new Set(skillContents.map((skill) => resolve(skill.path)));
  for (const entry of registryEntries) {
    if (entry.prodInjectedCount < MIN_PROD_INJECTIONS_FOR_DESCRIPTION_OPT) continue;
    if (entry.prodActivationRate === null || entry.prodActivationRate >= LOW_PROD_ACTIVATION_RATE) continue;
    const path = registrySkillPath(workspaceRoot, entry.slug);
    if (skillContentPaths.has(resolve(path))) continue;
    skillContents.push({ name: entry.name, path, content: readSkillContent(path) });
    skillContentPaths.add(resolve(path));
  }
  const descriptionEvidence = buildDescriptionOptimizationEvidence({
    workspaceRoot,
    evaluation,
    skillContents,
    registryEntries,
  });

  const prompt = buildCurationPrompt(evaluation, skillContents, workspaceRoot, descriptionEvidence);
  const rejectedFeedback = registryEntries
    .map((entry) => buildRejectedFeedbackPrompt(entry.slug, workspaceId))
    .filter(Boolean)
    .join("\n");
  const fullPrompt = rejectedFeedback ? `${prompt}\n${rejectedFeedback}` : prompt;
  let text = "";

  const run = runPiTurn({
    workspaceRoot: curatorDir,
    piSessionId: `skill-curator-${evaluation.evaluationId}`,
    text: fullPrompt,
    model: model || undefined,
    allowWeb: false,
    onEvent: (event) => {
      collectEvent(emptyMetrics(), event, {
        workspaceId,
        targetId: `curator-${evaluation.evaluationId}`,
        title: "Skill Curator",
      });
      const msg = event.type === "message_end"
        ? (event as { message?: { role?: string; content?: unknown } }).message
        : undefined;
      if (msg?.role === "assistant") {
        const next = extractText(msg.content);
        if (next) text = next;
      }
    },
  });

  const code = await run.done;
  if (code !== 0) {
    return { proposals: [], analysisText: text, error: `Curator 进程退出码 ${String(code)}` };
  }
  return parseCurationResponse(text);
}

export function applySkillCurationProposals(request: SkillCurationApplyRequest): SkillCurationApplyResult {
  const allowed = allowedSkillDirs(request.workspaceRoot);
  const applied: string[] = [];
  const errors: string[] = [];

  for (const proposal of request.proposals) {
    const targetPath = resolve(proposal.targetPath);
    const permitted = allowed.some((dir) => targetPath.startsWith(dir + "/") || targetPath === dir);
    if (!permitted) {
      errors.push(`拒绝写入 ${proposal.targetPath}（不在允许的 skill 目录内）`);
      continue;
    }
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
    const guard = guardSlowUpdateWrite(existing, proposal.suggestedContent);
    if (!guard.allowed) {
      errors.push(`拒绝写入 ${proposal.targetPath}（${guard.reason ?? "slow-update 受保护字段被修改"}）`);
      continue;
    }
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, proposal.suggestedContent, "utf8");
      applied.push(targetPath);
    } catch (err) {
      errors.push(`写入失败 ${targetPath}: ${String(err)}`);
    }
  }

  return { applied, errors };
}

export function applySkillCurationProposalsGated(
  request: SkillCurationApplyRequest & { workspaceId: string; slug?: string },
): SkillCurationApplyResult {
  const allowed = allowedSkillDirs(request.workspaceRoot);
  const applied: string[] = [];
  const errors: string[] = [];

  for (const proposal of request.proposals) {
    const targetPath = resolve(proposal.targetPath);
    const permitted = allowed.some((dir) => targetPath.startsWith(dir + "/") || targetPath === dir);
    if (!permitted) {
      errors.push(`拒绝写入 ${proposal.targetPath}（不在允许的 skill 目录内）`);
      continue;
    }
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
    const guard = guardSlowUpdateWrite(existing, proposal.suggestedContent);
    if (!guard.allowed) {
      const reason = guard.reason ?? "slow-update 受保护字段被修改";
      errors.push(`拒绝写入 ${proposal.targetPath}（${reason}）`);
      insertRejectedEdit({
        workspaceId: request.workspaceId,
        registryId: "",
        slug: request.slug ?? "",
        edit: { kind: "replace", after: proposal.suggestedContent.slice(0, 500) },
        candidateContent: proposal.suggestedContent,
        reason,
        evaluationId: null,
      });
      continue;
    }
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, proposal.suggestedContent, "utf8");
      applied.push(targetPath);
    } catch (err) {
      errors.push(`写入失败 ${targetPath}: ${String(err)}`);
    }
  }

  return { applied, errors };
}

function allowedSkillDirs(workspaceRoot: string): string[] {
  const home = homedir();
  return [
    resolve(join(home, ".pi", "agent", "skills")),
    resolve(join(home, ".agents", "skills")),
    resolve(join(workspaceRoot, ".pi", "skills")),
    resolve(join(workspaceRoot, ".agents", "skills")),
  ];
}

export function buildDescriptionOptimizationEvidence(input: {
  workspaceRoot: string;
  evaluation: SkillEvaluationDetail;
  skillContents: CuratedSkillContent[];
  registryEntries: SkillRegistryEntry[];
}): DescriptionOptimizationEvidence[] {
  const contentsByPath = new Map(input.skillContents.map((skill) => [resolve(skill.path), skill]));
  const missesByPath = collectEvaluationActivationMisses(input.evaluation);
  const entriesByPath = new Map(
    input.registryEntries
      .filter((entry) => entry.status === "active")
      .map((entry) => [resolve(registrySkillPath(input.workspaceRoot, entry.slug)), entry]),
  );
  const paths = new Set([...contentsByPath.keys(), ...missesByPath.keys()]);
  for (const [path, entry] of entriesByPath) {
    if (entry.prodInjectedCount >= MIN_PROD_INJECTIONS_FOR_DESCRIPTION_OPT
      && entry.prodActivationRate !== null
      && entry.prodActivationRate < LOW_PROD_ACTIVATION_RATE) {
      paths.add(path);
    }
  }

  const evidence: DescriptionOptimizationEvidence[] = [];
  for (const path of paths) {
    const content = contentsByPath.get(path);
    const entry = entriesByPath.get(path);
    if (!content && !entry) continue;
    const rawContent = content?.content ?? readSkillContent(path);
    const evalMisses = missesByPath.get(path) ?? [];
    const signals: string[] = [];
    if (entry?.prodActivationRate !== null && entry?.prodActivationRate !== undefined) {
      signals.push(`生产激活率 ${(entry.prodActivationRate * 100).toFixed(0)}% (${entry.prodActivatedCount}/${entry.prodInjectedCount})`);
    }
    if (evalMisses.length > 0) signals.push(`评测未激活 ${evalMisses.length} 个 case`);
    if (signals.length === 0) continue;
    evidence.push({
      skillName: content?.name ?? entry?.name ?? "",
      path,
      currentDescription: extractFrontmatterDescription(rawContent),
      prodInjectedCount: entry?.prodInjectedCount ?? 0,
      prodActivatedCount: entry?.prodActivatedCount ?? 0,
      prodActivationRate: entry?.prodActivationRate ?? null,
      evalMisses,
      evidence: signals,
    });
  }
  return evidence;
}

export function buildCurationPrompt(
  evaluation: SkillEvaluationDetail,
  skillContents: CuratedSkillContent[],
  workspaceRoot: string,
  descriptionEvidence: DescriptionOptimizationEvidence[] = [],
): string {
  const taskLines = evaluation.tasks
    .map((t) => {
      const points = t.expectedPoints?.length ? `\n  预期要点: ${t.expectedPoints.slice(0, 5).join("; ")}` : "";
      const rubric = t.rubric ? `\n  评分标准: ${t.rubric.slice(0, 200)}` : "";
      return `- [${t.id}] ${t.prompt.slice(0, 300)}${points}${rubric}`;
    })
    .join("\n");

  const variantLines = evaluation.variantSummaries
    .map((v) => {
      const pw = evaluation.pairwiseSummaries.find((p) => p.variantId === v.variantId);
      const pwText = pw
        ? `pairwise win/tie/loss=${pw.win}/${pw.tie}/${pw.loss} avgDelta=${pw.avgScoreDelta.toFixed(1)}`
        : "无 pairwise";
      return `- ${v.variantLabel}: 激活率=${(v.activationRate * 100).toFixed(0)}% ${pwText}`;
    })
    .join("\n");

  const lossExamples = evaluation.results
    .filter((r) => r.pairwise?.verdict === "loss" || (r.variantId !== "baseline" && !r.activation.activated))
    .slice(0, 5)
    .map((r) => [
      `[task=${r.taskId} variant=${r.variantId} verdict=${r.pairwise?.verdict ?? "n/a"} activated=${r.activation.activated}]`,
      `输出片段: ${r.output.slice(0, 500)}`,
    ].join("\n"))
    .join("\n\n---\n\n");

  const skillSections = skillContents.length
    ? skillContents
        .map((s) => `### ${s.name}\n路径: ${s.path}\n\`\`\`\n${s.content.slice(0, 2000)}\n\`\`\``)
        .join("\n\n")
    : "（本次评测未涉及任何 SKILL.md 文件）";

  const descriptionEvidenceLines = descriptionEvidence.length
    ? descriptionEvidence.map((item) => {
        const prod = item.prodActivationRate === null
          ? "生产激活率暂无"
          : `生产激活率 ${(item.prodActivationRate * 100).toFixed(0)}% (${item.prodActivatedCount}/${item.prodInjectedCount})`;
        const missLines = item.evalMisses.slice(0, 3)
          .map((miss) => `  - eval未激活 task=${miss.taskId} variant=${miss.variantId} output="${miss.outputSnippet}"`)
          .join("\n");
        return [
          `- ${item.skillName || item.path}`,
          `  路径: ${item.path}`,
          `  当前 description: ${item.currentDescription || "（空）"}`,
          `  ${prod}`,
          missLines,
        ].filter(Boolean).join("\n");
      }).join("\n")
    : "（无低激活或未激活 description 证据）";

  const newSkillBase = resolve(join(workspaceRoot, ".pi", "skills"));

  return `你是 Skill 治理专家，负责分析 AI skill 的评测数据并提出 SKILL.md 改进方案。

## 评测任务

${taskLines}

## 各 variant 表现

${variantLines}

## 失败/未激活 case 样本

${lossExamples || "（无失败案例）"}

## 当前 SKILL.md 内容

${skillSections}

## description 触发词优化证据

${descriptionEvidenceLines}

---

请分析评测数据，找出每个 skill 的问题（如触发词不准、内容含糊、缺乏关键步骤等），并给出具体改进提案。

- 只修改/新建有充分证据支持的 skill，不改没有问题的 skill
- 若某 skill 出现在「description 触发词优化证据」中，优先判断是否只需改 frontmatter 的 description：让 description 明确包含会触发该 skill 的任务类型、关键词、数据/场景信号与负例边界
- description 优化提案仍输出完整 SKILL.md，但除 description 外尽量保持 name 与正文不变；不要自动改文件，提案必须等待人审 apply
- 证据必须引用生产低激活率或 eval 未激活 case，不要凭空泛化触发词
- 新建 skill 的建议路径前缀: \`${newSkillBase}/<skill-name>/SKILL.md\`
- SKILL.md 必须包含 frontmatter（name 与 description 字段）

只输出如下 JSON 对象，不加 Markdown 代码块：
{"proposals":[{"type":"update","targetPath":"/absolute/path/SKILL.md","suggestedContent":"---\\nname: ...\\ndescription: ...\\n---\\n\\n...(skill 正文)","rationale":"一句话说明改动原因","confidence":0.8,"evidence":["task_id: loss scoreDelta=-10","激活率 20%"]}]}

type 只允许 "update" 或 "create"。proposals 可以为空数组。`;
}

function collectEvaluationActivationMisses(evaluation: SkillEvaluationDetail): Map<string, Array<{ taskId: string; variantId: string; outputSnippet: string }>> {
  const misses = new Map<string, Array<{ taskId: string; variantId: string; outputSnippet: string }>>();
  for (const result of evaluation.results) {
    if (result.variantId === "baseline" || result.activation.activated) continue;
    for (const skillPath of result.skillPaths) {
      const key = resolve(skillPath);
      const rows = misses.get(key) ?? [];
      rows.push({
        taskId: result.taskId,
        variantId: result.variantId,
        outputSnippet: result.output.slice(0, 180),
      });
      misses.set(key, rows);
    }
  }
  return misses;
}

function registrySkillPath(workspaceRoot: string, slug: string): string {
  return resolve(join(workspaceRoot, ".pi", "skills", slug, "SKILL.md"));
}

function readSkillContent(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

function extractFrontmatterDescription(content: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] ?? "";
  const line = frontmatter.split("\n").find((item) => /^description\s*:/.test(item));
  return line?.replace(/^description\s*:/, "").trim().replace(/^["']|["']$/g, "") ?? "";
}

function parseCurationResponse(text: string): SkillCurationResult {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return { proposals: [], analysisText: text };
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { proposals?: unknown[] };
    return { proposals: parseProposals(Array.isArray(parsed.proposals) ? parsed.proposals : []), analysisText: text };
  } catch {
    return { proposals: [], analysisText: text, error: "无法解析治理分析 JSON 结果" };
  }
}

// Fire-and-forget: called after skill evaluation completes. Saves proposals to DB.
export function autoTriggerCuration(request: SkillCurationRequest): void {
  const hasVariantsWithSkills = request.evaluation.variants.some((v) => v.skillPaths.length > 0);
  if (!hasVariantsWithSkills) return;
  curateSkillEvaluation(request)
    .then((result) => {
      if (result.proposals.length > 0) {
        saveSkillCurationProposals(request.workspaceId, request.evaluation.evaluationId, result.proposals);
      }
    })
    .catch(() => {
      // Background curation failure is non-fatal.
    });
}

function parseProposals(items: unknown[]): SkillCurationProposal[] {
  const proposals: SkillCurationProposal[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const type = raw.type === "create" || raw.type === "update" ? raw.type : null;
    const targetPath = typeof raw.targetPath === "string" && raw.targetPath.trim() ? raw.targetPath.trim() : null;
    if (!type || !targetPath) continue;
    const suggestedContent = typeof raw.suggestedContent === "string" ? raw.suggestedContent : "";
    const rationale = typeof raw.rationale === "string" ? raw.rationale : "";
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0;
    const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((e): e is string => typeof e === "string") : [];
    proposals.push({ type, targetPath, suggestedContent, rationale, confidence, evidence });
  }
  return proposals;
}
