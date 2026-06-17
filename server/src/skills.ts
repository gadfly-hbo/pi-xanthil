import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { listExtractionTools } from "../tools/registry.ts";

export type SkillSource = "global" | "project";

export interface PiSkill {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  available: boolean;
  error?: string;
}

interface SkillRoot {
  path: string;
  source: SkillSource;
}

const EXTRACTION_TOOL_SKILL_DIR = "xanthil-extraction-tools";
const GENERATED_MARKER = "<!-- xanthil-generated-extraction-tool-skill -->";

export type SkillValidationMode = "strict" | "lenient";

export interface ValidateSkillPathOptions {
  mode?: SkillValidationMode;
}

export function listSkills(workspaceRoot: string): PiSkill[] {
  ensureExtractionToolSkill(workspaceRoot);
  const roots: SkillRoot[] = [
    { path: join(homedir(), ".pi", "agent", "skills"), source: "global" },
    { path: join(homedir(), ".agents", "skills"), source: "global" },
    ...projectSkillRoots(workspaceRoot),
  ];
  const seen = new Set<string>();
  const visitedDirs = new Set<string>();
  const skills: PiSkill[] = [];
  for (const root of roots) scanSkillRoot(root, skills, seen, visitedDirs);
  return skills.sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export function extractionToolSkillPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".pi", "skills", EXTRACTION_TOOL_SKILL_DIR, "SKILL.md");
}

function ensureExtractionToolSkill(workspaceRoot: string): void {
  try {
    const skillFile = extractionToolSkillPath(workspaceRoot);
    const skillDir = dirname(skillFile);
    const next = buildExtractionToolSkill();
    if (existsSync(skillFile)) {
      const current = readFileSync(skillFile, "utf8");
      if (!current.includes(GENERATED_MARKER) || current === next) return;
    }
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillFile, next, "utf8");
  } catch {
    // Skill discovery must keep working even if the generated bridge cannot be written.
  }
}

function buildExtractionToolSkill(): string {
  const tools = listExtractionTools();
  const toolLines = tools.length > 0
    ? tools.map((tool) => {
      const params = (tool.parameters ?? [])
        .map((param) => `${param.name}${param.required ? " required" : ""}: ${param.description || param.label || param.type}`)
        .join("; ");
      return `- ${tool.id}: ${tool.name}. ${tool.description}${params ? ` Parameters: ${params}.` : ""}`;
    }).join("\n")
    : "- No ExtractionTool is currently registered.";

  return `---
name: xanthil-extraction-tools
description: Use local Xanthil ExtractionTool tools for data-analysis chat. Only registered clean_data paths may be used.
---
${GENERATED_MARKER}

# Xanthil ExtractionTool Bridge

Use this skill when the user asks pi to run a local data-analysis ExtractionTool during ChatPane data analysis.

## Contract

- Tools are exposed through the workspace MCP server as tool names matching the ExtractionTool id.
- The required input key is \`cleanDataPath\`.
- \`cleanDataPath\` must be an absolute path from the workspace registered \`clean_data\` list.
- Never use \`draw_data\`, raw detail files, copied raw content, column samples, or unregistered paths.
- Pass only paths and scalar parameters to tools. Do not paste data contents into the prompt.
- Tool results may include \`runId\`, \`success\`, \`failed\`, \`results[].outputs\`, \`stdout\`, and \`stderr\`.
- Summarize the tool result for the user and cite output file paths when the tool created artifacts.
- If a tool rejects the input as non-\`clean_data\`, stop and ask the user to register an allowed aggregate file.

## Registered Tools

${toolLines}
`;
}

export function validateSkillPaths(
  workspaceRoot: string,
  requested?: string[],
  options: ValidateSkillPathOptions = {},
): string[] | undefined {
  if (requested === undefined) return undefined;
  const mode = options.mode ?? "strict";
  const available = new Map(
    listSkills(workspaceRoot)
      .filter((skill) => skill.available)
      .map((skill) => [resolve(skill.path), skill.path]),
  );
  const validated: string[] = [];
  for (const rawPath of requested) {
    const path = available.get(resolve(rawPath));
    if (!path) {
      if (mode === "strict") throw new Error(`skill is not available: ${rawPath}`);
      continue;
    }
    if (!validated.includes(path)) validated.push(path);
  }
  return validated;
}

// 把请求体里的 skillPaths 解析成三态契约（与 workflow node.skillPaths 一致）：
//   undefined → 继承（返回 undefined）；[] → 禁用（返回 []）；非空 → 校验后的子集。
// 非数组 / 非字符串数组直接抛错。复用 validateSkillPaths 做可用性校验，不另造注入口径。
export function parseRequestedSkillPaths(
  workspaceRoot: string,
  value: unknown,
  options: ValidateSkillPathOptions = {},
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("skillPaths must be a string array when provided");
  }
  return validateSkillPaths(workspaceRoot, value as string[], options) ?? [];
}

function projectSkillRoots(workspaceRoot: string): SkillRoot[] {
  const roots: SkillRoot[] = [];
  let current = resolve(workspaceRoot);
  while (true) {
    roots.push({ path: join(current, ".pi", "skills"), source: "project" });
    roots.push({ path: join(current, ".agents", "skills"), source: "project" });
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function scanSkillRoot(root: SkillRoot, skills: PiSkill[], seen: Set<string>, visitedDirs: Set<string>): void {
  if (!existsSync(root.path)) return;
  try {
    walk(root.path, root.source, skills, seen, visitedDirs);
  } catch {
    // Ignore unreadable skill roots.
  }
}

function walk(dir: string, source: SkillSource, skills: PiSkill[], seen: Set<string>, visitedDirs: Set<string>): void {
  const realDir = realpathSync(dir);
  if (visitedDirs.has(realDir)) return;
  visitedDirs.add(realDir);
  const skillFile = join(dir, "SKILL.md");
  if (existsSync(skillFile)) {
    addSkill(skillFile, source, skills, seen);
    return;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    try {
      if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(path).isDirectory())) {
        walk(path, source, skills, seen, visitedDirs);
      }
    } catch {
      // Ignore unreadable or broken symlinks.
    }
  }
}

function addSkill(skillFile: string, source: SkillSource, skills: PiSkill[], seen: Set<string>): void {
  const path = resolve(skillFile);
  if (seen.has(path)) return;
  seen.add(path);
  try {
    const content = readFileSync(path, "utf8");
    const frontmatter = parseFrontmatter(content);
    const name = frontmatter.name || basename(dirname(path));
    const description = frontmatter.description;
    if (!description) {
      skills.push({ name, description: "", path, source, available: false, error: "missing description" });
      return;
    }
    skills.push({ name, description, path, source, available: true });
  } catch (err) {
    skills.push({
      name: basename(dirname(path)),
      description: "",
      path,
      source,
      available: false,
      error: String(err),
    });
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const values: Record<string, string> = {};
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match?.[1]) continue;
    values[match[1]] = unquote(match[2] ?? "");
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
