import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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

export function listSkills(workspaceRoot: string): PiSkill[] {
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

export function validateSkillPaths(workspaceRoot: string, requested?: string[]): string[] | undefined {
  if (requested === undefined) return undefined;
  const available = new Map(
    listSkills(workspaceRoot)
      .filter((skill) => skill.available)
      .map((skill) => [resolve(skill.path), skill.path]),
  );
  const validated: string[] = [];
  for (const rawPath of requested) {
    const path = available.get(resolve(rawPath));
    if (!path) throw new Error(`skill is not available: ${rawPath}`);
    if (!validated.includes(path)) validated.push(path);
  }
  return validated;
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
