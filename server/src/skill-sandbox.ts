import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";

export type SandboxRole = "creator" | "evaluator";

export interface SkillSandbox {
  role: SandboxRole;
  cwd: string;
  systemPromptSuffix: string;
}

const CREATOR_RED_LINE_PATHS = ["golden_strategy", "validator", "execution_traces", "trace"];
const EVALUATOR_RED_LINE_PATHS = [".pi/skills", "skills"];

export function createSkillSandbox(
  workspaceRoot: string,
  role: SandboxRole,
  parentDir: string,
): SkillSandbox {
  const sandboxId = randomUUID().slice(0, 8);
  const cwd = join(parentDir, `skill-sandbox-${role}-${sandboxId}`);
  mkdirSync(cwd, { recursive: true });

  if (role === "creator") {
    return {
      role,
      cwd,
      systemPromptSuffix: buildCreatorSystemPrompt(workspaceRoot),
    };
  }
  return {
    role,
    cwd,
    systemPromptSuffix: buildEvaluatorSystemPrompt(workspaceRoot),
  };
}

function buildCreatorSystemPrompt(workspaceRoot: string): string {
  const redLines = CREATOR_RED_LINE_PATHS.map((p) => resolve(workspaceRoot, p));
  return `\n[权限隔离 · Creator 角色]
你是优化队(Creator)，只允许：
1. 读取脱敏报告和决策历史（clean_data/report 目录）
2. 写入 skill 库（.pi/skills/ 目录）
3. 读取 skill 库现有内容

绝对禁止访问以下路径（违反即失败）：
${redLines.map((p) => `- ${p}`).join("\n")}

禁止读取 golden_strategy、validator、执行 trace 等评估队专属数据。
禁止使用绝对路径读取上述禁止目录中的任何文件。`;
}

function buildEvaluatorSystemPrompt(workspaceRoot: string): string {
  const redLines = EVALUATOR_RED_LINE_PATHS.map((p) => resolve(workspaceRoot, p));
  return `\n[权限隔离 · Evaluator 角色]
你是评估队(Evaluator)，只允许：
1. 读取 oracle/validator/golden_strategy 数据
2. 读取待评估的 skill 内容（只读）
3. 输出脱敏问题报告

绝对禁止：
- 写入或修改 skill 库（.pi/skills/ 目录）
- 直接修改任何 SKILL.md 文件

禁止写入以下路径：
${redLines.map((p) => `- ${p}`).join("\n")}`;
}

export function verifyCreatorIsolation(
  workspaceRoot: string,
  accessedPaths: string[],
): { isolated: boolean; violations: string[] } {
  const redLines = CREATOR_RED_LINE_PATHS.map((p) => resolve(workspaceRoot, p));
  const violations: string[] = [];
  for (const accessed of accessedPaths) {
    const resolved = resolve(accessed);
    for (const red of redLines) {
      if (resolved.startsWith(red + "/") || resolved === red) {
        violations.push(`Creator accessed forbidden path: ${relative(workspaceRoot, resolved)}`);
      }
    }
  }
  return { isolated: violations.length === 0, violations };
}

export function verifyEvaluatorIsolation(
  workspaceRoot: string,
  writtenPaths: string[],
): { isolated: boolean; violations: string[] } {
  const redLines = EVALUATOR_RED_LINE_PATHS.map((p) => resolve(workspaceRoot, p));
  const violations: string[] = [];
  for (const written of writtenPaths) {
    const resolved = resolve(written);
    for (const red of redLines) {
      if (resolved.startsWith(red + "/") || resolved === red) {
        violations.push(`Evaluator wrote to forbidden path: ${relative(workspaceRoot, resolved)}`);
      }
    }
  }
  return { isolated: violations.length === 0, violations };
}
