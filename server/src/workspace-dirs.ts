import { isAbsolute, join, relative, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { WorkspaceFolderName } from "./types.ts";

/**
 * Physical directory standard for a *task* (a session or a flow). The three
 * logical folder labels map to fixed numbered directories so raw / clean /
 * report files stop scattering. Numbering leaves gaps (030~050) for future
 * buckets without renumbering.
 *
 * The standard is bound to the task, not the workspace: each session lives at
 * `<root>/sessions/<id>/` and each flow at its `folderPath` (`flows/<id>/`),
 * and the three dirs are created under that base. The workspace root itself
 * does NOT carry these dirs.
 */
export const FOLDER_DIRS: Record<WorkspaceFolderName, string> = {
  draw_data: "010_raw",
  clean_data: "020_clean",
  report: "060_reports",
};

/** Base directory of a session task. */
export function sessionDir(rootPath: string, sessionId: string): string {
  return join(rootPath, "sessions", sessionId);
}

/** Absolute standard directory for a folder under a task base directory. */
export function standardDirIn(baseDir: string, folder: WorkspaceFolderName): string {
  return join(baseDir, FOLDER_DIRS[folder]);
}

/** Create the three standard dirs under baseDir (idempotent). */
export function ensureStandardDirs(baseDir: string): void {
  for (const name of Object.values(FOLDER_DIRS)) mkdirSync(join(baseDir, name), { recursive: true });
}

/**
 * True when absPath lives inside (or equals) the standard directory for the
 * given folder under baseDir. Uses path.relative to reject `../` escapes and
 * absolute jumps.
 */
export function isInsideStandardDir(baseDir: string, folder: WorkspaceFolderName, absPath: string): boolean {
  const base = resolve(standardDirIn(baseDir, folder));
  const target = resolve(absPath);
  if (target === base) return true;
  const rel = relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
