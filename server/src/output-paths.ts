import { dirname, resolve } from "node:path";
import type { WorkspaceFolderName, WorkspacePath } from "./types.ts";

// Fixed display order for registered path folders — must stay stable so that
// the assembled contextPrefix produces the same bytes across requests when the
// registered paths haven't changed (important for provider prefix-cache hits).
const FOLDER_DISPLAY_ORDER: WorkspaceFolderName[] = ["clean_data", "report"];

export interface RegisteredPathContext {
  workspaceId: string;
  fallbackOutputDir: string;
  sessionId?: string;
  flowId?: string;
}

function isWorkspacePath(path: WorkspacePath): boolean {
  return path.sessionId === null && path.flowId === null;
}

function isScopedPath(path: WorkspacePath, context: RegisteredPathContext): boolean {
  if (context.sessionId) return path.sessionId === context.sessionId;
  if (context.flowId) return path.flowId === context.flowId;
  return isWorkspacePath(path);
}

function latest(paths: WorkspacePath[]): WorkspacePath | undefined {
  return [...paths].sort((a, b) => b.addedAt - a.addedAt)[0];
}

function outputDirectory(path: WorkspacePath): string {
  const absolutePath = resolve(path.path);
  return path.kind === "dir" ? absolutePath : dirname(absolutePath);
}

function selectOutputPath(
  scopedPaths: WorkspacePath[],
  workspacePaths: WorkspacePath[],
): WorkspacePath | undefined {
  return latest(scopedPaths.filter((path) => path.folder === "report"))
    ?? latest(scopedPaths.filter((path) => path.folder === "clean_data"))
    ?? latest(workspacePaths.filter((path) => path.folder === "report"))
    ?? latest(workspacePaths.filter((path) => path.folder === "clean_data"));
}

export interface OutputTarget {
  outputDir: string;
  source: string;
  hasConfiguredReportPath: boolean;
}

export function resolveOutputTarget(
  paths: WorkspacePath[],
  context: RegisteredPathContext,
): OutputTarget {
  const workspacePaths = paths.filter(isWorkspacePath);
  const scopedPaths = paths.filter((path) => isScopedPath(path, context));
  const selected = selectOutputPath(scopedPaths, workspacePaths);
  return {
    outputDir: selected ? outputDirectory(selected) : resolve(context.fallbackOutputDir),
    source: selected
      ? selected.folder === "report"
        ? "报告 tab 登记路径"
        : "最近加载的数据源路径"
      : "当前工作目录 fallback",
    hasConfiguredReportPath: Boolean(selected?.folder === "report"),
  };
}

export function buildOutputPathInstructions(outputDir: string, source: string): string {
  return [
    "[内容输出路径约束]",
    `- 本次所有新生成内容必须写入：${resolve(outputDir)}`,
    `- 输出目录来源：${source}。`,
    "- 禁止在其他位置创建输出目录或写入生成内容。",
    "- 输入数据只读；除非用户明确要求，不得覆盖已有文件。",
    "- 生成多个文件时，全部放在上述目录中。",
    "",
  ].join("\n");
}

/**
 * Build the context prefix injected at the top of every user turn.
 *
 * @param fileAnalyses - Optional map of workspace_path.id → cached analysis text.
 *   When present and a `clean_data` path has a cached analysis, the analysis is
 *   indented under the path so the agent can use it without re-reading the file.
 */
export function buildRegisteredPathContext(
  paths: WorkspacePath[],
  context: RegisteredPathContext,
  fileAnalyses?: Map<number, string>,
): string {
  const workspacePaths = paths.filter(isWorkspacePath);
  const scopedPaths = paths.filter((path) => isScopedPath(path, context));
  const visiblePaths = context.sessionId || context.flowId
    ? [...workspacePaths, ...scopedPaths]
    : workspacePaths;
  // Raw data paths are intentionally excluded: they must never be disclosed to an LLM.
  const uniquePaths = [...new Map(
    visiblePaths
      .filter((path) => path.folder !== "draw_data")
      .map((path) => [path.id, path]),
  ).values()];
  const target = resolveOutputTarget(paths, context);
  const labels: Record<string, string> = {
    draw_data: "原始数据",
    clean_data: "聚合数据",
    report: "报告",
  };
  const grouped: Partial<Record<WorkspaceFolderName, WorkspacePath[]>> = {};
  for (const path of uniquePaths) (grouped[path.folder] ??= []).push(path);
  const pathList = FOLDER_DISPLAY_ORDER
    .filter((folder) => grouped[folder])
    .map((folder) => {
      const folderPaths = grouped[folder]!;
      const entries = folderPaths.map((p) => {
        const analysis = folder === "clean_data" ? fileAnalyses?.get(p.id) : undefined;
        if (analysis) {
          const indented = analysis.split("\n").map((l) => `    ${l}`).join("\n");
          return `  - ${p.path}\n    [已缓存字段说明]\n${indented}`;
        }
        return `  - ${p.path}`;
      });
      return `${labels[folder] ?? folder}:\n${entries.join("\n")}`;
    })
    .join("\n");
  const registeredPaths = pathList ? `[已登记文件路径]\n${pathList}\n\n` : "";

  return `${registeredPaths}${buildOutputPathInstructions(target.outputDir, target.source)}\n`;
}
