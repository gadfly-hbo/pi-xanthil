import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { collectEvent, emptyMetrics, extractText } from "./evaluation-common.ts";
import { runPiTurn } from "./pi-adapter.ts";
import { saveSkillCurationProposals } from "./db.ts";
import { listSkills } from "./skills.ts";
import type { SkillCurationApplyResult, SkillCurationProposal, SkillCurationResult, SkillEvaluationDetail } from "./types.ts";

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

export async function curateSkillEvaluation(request: SkillCurationRequest): Promise<SkillCurationResult> {
  const { workspaceRoot, workspaceId, model, evaluation } = request;
  const curatorDir = join(workspaceRoot, "evaluations", "curator", evaluation.evaluationId);
  mkdirSync(curatorDir, { recursive: true });

  const skills = listSkills(workspaceRoot).filter((s) => s.available);
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

  const prompt = buildCurationPrompt(evaluation, skillContents, workspaceRoot);
  let text = "";

  const run = runPiTurn({
    workspaceRoot: curatorDir,
    piSessionId: `skill-curator-${evaluation.evaluationId}`,
    text: prompt,
    model: model || undefined,
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

function buildCurationPrompt(
  evaluation: SkillEvaluationDetail,
  skillContents: Array<{ name: string; path: string; content: string }>,
  workspaceRoot: string,
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

---

请分析评测数据，找出每个 skill 的问题（如触发词不准、内容含糊、缺乏关键步骤等），并给出具体改进提案。

- 只修改/新建有充分证据支持的 skill，不改没有问题的 skill
- 新建 skill 的建议路径前缀: \`${newSkillBase}/<skill-name>/SKILL.md\`
- SKILL.md 必须包含 frontmatter（name 与 description 字段）

只输出如下 JSON 对象，不加 Markdown 代码块：
{"proposals":[{"type":"update","targetPath":"/absolute/path/SKILL.md","suggestedContent":"---\\nname: ...\\ndescription: ...\\n---\\n\\n...(skill 正文)","rationale":"一句话说明改动原因","confidence":0.8,"evidence":["task_id: loss scoreDelta=-10","激活率 20%"]}]}

type 只允许 "update" 或 "create"。proposals 可以为空数组。`;
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
