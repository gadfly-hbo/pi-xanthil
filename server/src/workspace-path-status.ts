import { statSync } from "node:fs";
import type { WorkspacePath } from "./types.ts";

/**
 * 工作区路径文件系统状态（接缝层 · T-C2a）。
 *
 * 给已登记的 WorkspacePath 附加运行时存在性/类型/大小/mtime 状态。纯函数、
 * 仅依赖 node:fs，供 index.ts(workspace/session paths) 与 routes/engine.ts(flow paths) 共享。
 */
export function withWorkspacePathStatus(path: WorkspacePath): WorkspacePath {
  try {
    const stat = statSync(path.path);
    const currentKind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null;
    return {
      ...path,
      exists: true,
      currentKind,
      size: stat.isFile() ? stat.size : null,
      mtime: stat.mtimeMs,
      status: currentKind === path.kind ? "ok" : "kind_mismatch",
    };
  } catch {
    return {
      ...path,
      exists: false,
      currentKind: null,
      size: null,
      mtime: null,
      status: "missing",
    };
  }
}

export function withWorkspacePathStatuses(paths: WorkspacePath[]): WorkspacePath[] {
  return paths.map(withWorkspacePathStatus);
}
