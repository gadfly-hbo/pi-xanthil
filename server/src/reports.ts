import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, extname, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { WORKSPACES_ROOT } from "./config.ts";
import type { ReportEntry, ReportFileType, ReportSource } from "./types.ts";

const SUPPORTED_EXT = new Set([".md", ".html"]);
const SKIP_DIR_NAMES = new Set([".pi-sessions", "node_modules", ".git", ".DS_Store"]);

const TYPE_RULES: Array<{ type: ReportFileType; keywords: string[] }> = [
  { type: "final_summary", keywords: ["final_summary", "final-summary", "最终总结", "最终报告"] },
  { type: "handoff_log", keywords: ["handoff_log", "handoff-log", "handoff", "交接"] },
  { type: "sample_report", keywords: ["sample-report", "sample_report"] },
  { type: "research_report", keywords: ["research_report", "research-report", "研究报告", "深度研究"] },
  { type: "supplement", keywords: ["supplement", "补充"] },
  { type: "draft", keywords: ["draft", "草稿"] },
  { type: "presentation", keywords: ["presentation", "汇报", "slides"] },
];

function classifyReportType(filename: string): ReportFileType {
  const normalized = filename.toLowerCase().replace(/[\s\-_]/g, "");
  for (const rule of TYPE_RULES) {
    for (const kw of rule.keywords) {
      const normKw = kw.toLowerCase().replace(/[\s\-_]/g, "");
      if (normalized.includes(normKw)) return rule.type;
    }
  }
  return "other";
}

function makeEntryId(workspaceId: string, relPath: string): string {
  return createHash("sha1").update(`${workspaceId}:${relPath}`).digest("hex").slice(0, 16);
}

interface ScanContext {
  workspaceId: string;
  workspaceName?: string;
  workspaceRoot: string;
  results: ReportEntry[];
  flowNameCache: Map<string, string | undefined>;
}

function readFlowName(flowDir: string, cache: Map<string, string | undefined>): string | undefined {
  if (cache.has(flowDir)) return cache.get(flowDir);
  const file = join(flowDir, "workflow.json");
  let name: string | undefined;
  try {
    if (existsSync(file)) {
      const raw = readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw) as { metadata?: { name?: string }; name?: string };
      name = parsed?.metadata?.name ?? parsed?.name;
      if (typeof name !== "string" || !name.trim()) name = undefined;
    }
  } catch {
    name = undefined;
  }
  cache.set(flowDir, name);
  return name;
}

function walkFlowRuns(ctx: ScanContext, flowsRoot: string): void {
  let flowDirs: string[];
  try {
    flowDirs = readdirSync(flowsRoot);
  } catch {
    return;
  }
  for (const flowId of flowDirs) {
    const flowDir = join(flowsRoot, flowId);
    let st;
    try {
      st = statSync(flowDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const flowName = readFlowName(flowDir, ctx.flowNameCache);
    const runsRoot = join(flowDir, "runs");
    if (!existsSync(runsRoot)) continue;
    let runDirs: string[];
    try {
      runDirs = readdirSync(runsRoot);
    } catch {
      continue;
    }
    for (const runId of runDirs) {
      const runDir = join(runsRoot, runId);
      try {
        if (!statSync(runDir).isDirectory()) continue;
      } catch {
        continue;
      }
      walkDir(ctx, runDir, "flow_run", { flowId, flowName, runId });
    }
  }
}

function walkDir(
  ctx: ScanContext,
  dir: string,
  source: ReportSource,
  flowInfo: { flowId?: string; flowName?: string; runId?: string },
  depth = 0,
): void {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkDir(ctx, full, source, flowInfo, depth + 1);
      continue;
    }
    const ext = extname(name).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) continue;
    const relPath = relative(ctx.workspaceRoot, full).split(sep).join("/");
    const id = makeEntryId(ctx.workspaceId, relPath);
    ctx.results.push({
      id,
      workspaceId: ctx.workspaceId,
      workspaceName: ctx.workspaceName,
      source,
      flowId: flowInfo.flowId,
      flowName: flowInfo.flowName,
      runId: flowInfo.runId,
      filename: basename(name),
      relativePath: relPath,
      absolutePath: full,
      extension: ext === ".md" ? "md" : "html",
      reportType: classifyReportType(name),
      sizeBytes: Number(st.size),
      createdAt: Number(st.mtimeMs),
    });
  }
}

function scanRoot(workspaceId: string, workspaceName: string | undefined): ReportEntry[] {
  const workspaceRoot = join(WORKSPACES_ROOT, workspaceId);
  if (!existsSync(workspaceRoot)) return [];
  const ctx: ScanContext = { workspaceId, workspaceName, workspaceRoot, results: [], flowNameCache: new Map() };

  // 1) workspace_root (浅扫,不进入 flows / .pi-sessions)
  let topEntries: string[] = [];
  try {
    topEntries = readdirSync(workspaceRoot);
  } catch {
    return [];
  }
  for (const name of topEntries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (name === "flows" || name === "evaluations" || name === "files") continue;
    const full = join(workspaceRoot, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) continue;
    const ext = extname(name).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) continue;
    const relPath = name;
    ctx.results.push({
      id: makeEntryId(workspaceId, relPath),
      workspaceId,
      workspaceName,
      source: "workspace_root",
      filename: name,
      relativePath: relPath,
      absolutePath: full,
      extension: ext === ".md" ? "md" : "html",
      reportType: classifyReportType(name),
      sizeBytes: Number(st.size),
      createdAt: Number(st.mtimeMs),
    });
  }

  // 2) flows/<flowId>/runs/<runId>/**
  const flowsRoot = join(workspaceRoot, "flows");
  if (existsSync(flowsRoot)) walkFlowRuns(ctx, flowsRoot);

  return ctx.results;
}

export function scanAllReports(
  workspaces: Array<{ id: string; name: string }>,
): ReportEntry[] {
  const all: ReportEntry[] = [];
  for (const ws of workspaces) {
    const entries = scanRoot(ws.id, ws.name);
    all.push(...entries);
  }
  return all;
}
