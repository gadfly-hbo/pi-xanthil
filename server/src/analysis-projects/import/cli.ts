/**
 * Thin CLI entry for the one-time WorkCanger importer.
 *
 * Usage:
 *   node --experimental-strip-types server/src/analysis-projects/import/cli.ts \
 *     --source-root <donor data root> \
 *     --target-root <analysis-projects data root> \
 *     --workspace-id <existing pi-Xanthil Workspace ID> \
 *     [--xanthil-db <path to xanthil.db>] [--init-target] [--dry-run]
 *
 * Output: a single JSON line with the structured result (safe fields only:
 * no Evidence content, absolute paths, storage_refs, SQL, or raw errors).
 * Exit codes: 0 = completed / already_imported / dry-run ok; 1 = failed or
 * dry-run not ok; 2 = usage error.
 *
 * No import-time side effects: main() runs only when executed directly.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runImport, type ImportRunResult, type DryRunReport } from "./importer.ts";
import { createXanthilWorkspacePort } from "./workspace-port.ts";

interface CliArgs {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly workspaceId: string;
  readonly xanthilDb: string;
  readonly dryRun: boolean;
  readonly initTarget: boolean;
}

function defaultXanthilDbPath(): string {
  const dataDir = process.env.XANTHIL_DATA_DIR;
  return dataDir && dataDir.trim().length > 0
    ? join(dataDir, "xanthil.db")
    : join(homedir(), ".pi-xanthil", "xanthil.db");
}

function parseArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    if (arg === "--dry-run" || arg === "--init-target") {
      booleans.add(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    flags.set(arg, value);
    i += 1;
  }
  const sourceRoot = flags.get("--source-root");
  const targetRoot = flags.get("--target-root");
  const workspaceId = flags.get("--workspace-id");
  if (!sourceRoot || !targetRoot || !workspaceId) {
    throw new Error(
      "Required: --source-root <dir> --target-root <dir> --workspace-id <id>",
    );
  }
  return {
    sourceRoot,
    targetRoot,
    workspaceId,
    xanthilDb: flags.get("--xanthil-db") ?? defaultXanthilDbPath(),
    dryRun: booleans.has("--dry-run"),
    initTarget: booleans.has("--init-target"),
  };
}

function resultExitCode(result: ImportRunResult | DryRunReport): number {
  if ("kind" in result) {
    return result.ok ? 0 : 1;
  }
  return result.status === "failed" ? 1 : 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        kind: "usage_error",
        message: (err as Error).message,
      }) + "\n",
    );
    return 2;
  }

  const result = await runImport({
    sourceDataRoot: args.sourceRoot,
    targetDataRoot: args.targetRoot,
    targetWorkspaceId: args.workspaceId,
    workspacePort: createXanthilWorkspacePort(args.xanthilDb),
    dryRun: args.dryRun,
    allowTargetInit: args.initTarget,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  return resultExitCode(result);
}

const invokedAsMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => {
      // Unexpected internal error: emit a fixed safe line, never raw errors.
      process.stdout.write(
        JSON.stringify({
          status: "failed",
          error: {
            code: "tx_failed",
            category: "transaction",
            message: "Import failed with an internal error; no details are exposed by design.",
          },
        }) + "\n",
      );
      process.exit(1);
    });
}
