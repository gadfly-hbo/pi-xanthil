import { api } from "@/lib/api";
import { vizApi } from "@/lib/api/viz";
import type { FolderScope } from "@/tabs/types";
import type { FlowTreeNode, WorkspacePath } from "@/types";

export interface ExploreOutputStatus {
  report: number;
  review: number;
  presentation: number;
  golden: number;
  actions: number;
  roots: number;
  availableRoots: number;
  unavailableRoots: number;
}

export const EMPTY_EXPLORE_OUTPUT_STATUS: ExploreOutputStatus = {
  report: 0,
  review: 0,
  presentation: 0,
  golden: 0,
  actions: 0,
  roots: 0,
  availableRoots: 0,
  unavailableRoots: 0,
};

export function isExplorePathAvailable(path: WorkspacePath): boolean {
  return path.status !== "missing" && path.status !== "kind_mismatch" && path.exists !== false;
}

export function listExploreScopePaths(
  scope: FolderScope,
  folder: "draw_data" | "clean_data" | "report",
): Promise<WorkspacePath[]> {
  if (!scope) return Promise.resolve([]);
  if (scope.type === "session") return api.listSessionPaths(scope.sessionId, folder);
  if (scope.type === "workspace") return api.listWorkspacePaths(scope.workspaceId, folder);
  return api.listFlowPaths(scope.flowId, folder);
}

function scopeId(scope: FolderScope): string {
  if (!scope) return "";
  if (scope.type === "session") return scope.sessionId;
  if (scope.type === "workspace") return scope.workspaceId;
  return scope.flowId;
}

function flattenFiles(node: FlowTreeNode): FlowTreeNode[] {
  const files: FlowTreeNode[] = [];
  const visit = (current: FlowTreeNode) => {
    if (current.kind === "file") files.push(current);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return files;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function outputFamily(path: string): keyof Pick<ExploreOutputStatus, "report" | "review" | "presentation" | "golden"> {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized.startsWith("review_history/") || normalized.includes("/review_history/")) return "review";
  if (normalized.startsWith("presentation_versions/") || normalized.includes("/presentation_versions/")) return "presentation";
  if (normalized.startsWith("golden_strategy/") || normalized.includes("/golden_strategy/")) return "golden";
  return "report";
}

export async function loadExploreOutputStatus(scope: FolderScope): Promise<ExploreOutputStatus> {
  if (!scope) return EMPTY_EXPLORE_OUTPUT_STATUS;
  const reportRoots = await listExploreScopePaths(scope, "report");
  const availableRoots = reportRoots.filter(isExplorePathAvailable);
  const nestedFiles = await Promise.all(availableRoots.map(async (root) => {
    if (root.kind === "file") return [{ ...root, name: basename(root.path) }];
    return flattenFiles(await api.workspacePathTree(root.id));
  }));
  const counts: ExploreOutputStatus = {
    ...EMPTY_EXPLORE_OUTPUT_STATUS,
    roots: reportRoots.length,
    availableRoots: availableRoots.length,
    unavailableRoots: reportRoots.length - availableRoots.length,
  };
  for (const file of nestedFiles.flat()) counts[outputFamily(file.path)] += 1;
  counts.actions = (await vizApi.listActionItems(scopeId(scope))).length;
  return counts;
}
