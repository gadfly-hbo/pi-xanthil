import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { WORKSPACES_ROOT } from "./config.ts";

/**
 * Move an app-managed directory to the macOS Trash (recoverable, not a permanent
 * delete). Safety: refuses any path that is not strictly inside WORKSPACES_ROOT,
 * so externally-registered user paths (e.g. ~/Downloads) can never be deleted.
 * No-op when the directory does not exist.
 */
export function moveManagedDirToTrash(absDir: string): void {
  const root = resolve(WORKSPACES_ROOT);
  const target = resolve(absDir);
  if (target === root || !target.startsWith(root + sep)) {
    throw new Error(`refusing to trash path outside workspaces root: ${target}`);
  }
  if (!existsSync(target)) return;
  // AppleScript "delete" moves the item to Trash instead of erasing it.
  const script = `tell application "Finder" to delete (POSIX file ${JSON.stringify(target)})`;
  execFileSync("osascript", ["-e", script]);
}
