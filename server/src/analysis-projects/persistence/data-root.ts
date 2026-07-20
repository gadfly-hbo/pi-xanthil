/**
 * Analysis-projects data-root layout initialization.
 *
 * Contract (workcanger-absorption-contract.md WCA-01, P0-37, P0-38):
 * - XANTHIL_DATA_DIR env var overrides default ~/.pi-xanthil.
 * - Analysis-projects root is ${XANTHIL_DATA_DIR}/analysis-projects/.
 * - Fixed layout: workcanger.sqlite, artifacts/blobs, artifacts/tmp,
 *   pi-sessions, exports, backups.
 * - Source repo must not hold runtime data.
 * - Tests must use temp data root, never ~/.pi-xanthil or the repo.
 * - No side effects at import time; caller must invoke initDataRoot explicitly.
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface DataRootLayout {
  root: string;
  sqlitePath: string;
  blobsDir: string;
  tmpDir: string;
  piSessionsDir: string;
  exportsDir: string;
  backupsDir: string;
}

/**
 * The required subdirectories under the data root.
 */
export const DATA_ROOT_SUBDIRS = [
  "artifacts/blobs",
  "artifacts/tmp",
  "pi-sessions",
  "exports",
  "backups",
] as const;

/**
 * Resolve the analysis-projects data root from env or default.
 * Returns ${XANTHIL_DATA_DIR}/analysis-projects/ (or ~/.pi-xanthil/analysis-projects/).
 * Does NOT create directories.
 */
export function resolveDataRoot(envOverride?: string): string {
  const env = envOverride ?? process.env.XANTHIL_DATA_DIR;
  const xanthilRoot = env && env.trim().length > 0
    ? resolve(env)
    : join(homedir(), ".pi-xanthil");
  return join(xanthilRoot, "analysis-projects");
}

/**
 * Build the layout descriptor for a given root path.
 */
export function buildLayout(root: string): DataRootLayout {
  return {
    root,
    sqlitePath: join(root, "workcanger.sqlite"),
    blobsDir: join(root, "artifacts", "blobs"),
    tmpDir: join(root, "artifacts", "tmp"),
    piSessionsDir: join(root, "pi-sessions"),
    exportsDir: join(root, "exports"),
    backupsDir: join(root, "backups"),
  };
}

/**
 * Initialize the data root directory structure.
 * Creates the root and all required subdirectories if they don't exist.
 * Returns the layout descriptor.
 */
export function initDataRoot(root: string): DataRootLayout {
  const layout = buildLayout(root);

  if (!existsSync(layout.root)) {
    mkdirSync(layout.root, { recursive: true });
  } else {
    const stat = statSync(layout.root);
    if (!stat.isDirectory()) {
      throw new Error(
        `Data root exists but is not a directory: ${layout.root}`,
      );
    }
  }

  for (const subdir of DATA_ROOT_SUBDIRS) {
    const dirPath = join(layout.root, subdir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  return layout;
}
