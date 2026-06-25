import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { coerceMetricHints, type MetricHint } from "../src/extraction-tool-metric.ts";

export interface ToolParameter {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  description?: string;
}

export type ExtractionToolCategory = "ingestion" | "analysis";

export interface ExtractionToolManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  runtime: "python3";
  category?: ExtractionToolCategory;
  input: {
    accept: string[];
    modes: Array<"file" | "directory">;
  };
  output: string[];
  timeoutMs?: number;
  parameters?: ToolParameter[];
  resultColumns?: Array<{ key: string; label: string }>;
  // 期望输入数据表单（用于前端生成可下载 CSV 模板）；缺省=无固定表单（如任意 SQL/HTML 抓取）。
  inputTemplate?: {
    columns: Array<{ name: string; required?: boolean; description?: string; example?: string }>;
    note?: string;
  };
  riskLevel?: "L0" | "L1" | "L2" | "L3";
  allowedUse?: string;
  forbiddenUse?: string;
  failureHandling?: string;
  traceFields?: string[];
  // D-METRIC1: 可选指标提示，让 /run 响应额外附加 MetricSnapshot[]，给 MCP 数字锁注入用。
  // 无 hints = 行为零变化（向后兼容）。
  metricHints?: MetricHint[];
}

export interface RegisteredExtractionTool extends ExtractionToolManifest {
  rootPath: string;
  entryPath: string;
}

const TOOLS_ROOT = dirname(fileURLToPath(import.meta.url));

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isManifest(value: unknown): value is ExtractionToolManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const input = item.input as Record<string, unknown> | undefined;
  return typeof item.id === "string"
    && /^[a-z0-9-]+$/.test(item.id)
    && typeof item.name === "string"
    && typeof item.version === "string"
    && typeof item.description === "string"
    && typeof item.entry === "string"
    && item.runtime === "python3"
    && !!input
    && isStringArray(input.accept)
    && Array.isArray(input.modes)
    && input.modes.every((mode) => mode === "file" || mode === "directory")
    && isStringArray(item.output)
    && (item.timeoutMs === undefined || (typeof item.timeoutMs === "number" && Number.isInteger(item.timeoutMs) && item.timeoutMs > 0))
    && (!item.parameters || Array.isArray(item.parameters))
    && (!item.resultColumns || Array.isArray(item.resultColumns));
}

function normalizeCategory(value: unknown): ExtractionToolCategory {
  return value === "analysis" ? "analysis" : "ingestion";
}

function normalizeManifest(manifest: ExtractionToolManifest): ExtractionToolManifest {
  return {
    ...manifest,
    category: normalizeCategory(manifest.category),
    metricHints: coerceMetricHints(manifest.metricHints),
  };
}

function resolveInside(rootPath: string, relativePath: string): string {
  const absolute = resolve(rootPath, relativePath);
  if (absolute !== rootPath && !absolute.startsWith(rootPath + sep)) {
    throw new Error("tool entry must stay inside tool folder");
  }
  return absolute;
}

function loadTools(): RegisteredExtractionTool[] {
  return readdirSync(TOOLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const rootPath = join(TOOLS_ROOT, entry.name);
      const manifestPath = join(rootPath, "tool.json");
      if (!existsSync(manifestPath)) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (!isManifest(manifest)) throw new Error(`invalid extraction tool manifest: ${manifestPath}`);
      if (manifest.id !== entry.name) throw new Error(`tool id must match folder name: ${entry.name}`);
      const entryPath = resolveInside(rootPath, manifest.entry);
      if (!statSync(entryPath).isFile()) throw new Error(`tool entry not found: ${entryPath}`);
      return [{ ...normalizeManifest(manifest), rootPath, entryPath }];
    });
}

export function listExtractionTools(): ExtractionToolManifest[] {
  const tools = loadTools();
  return tools.map(({ rootPath: _rootPath, entryPath: _entryPath, ...manifest }) => manifest);
}

export function getExtractionTool(id: string): RegisteredExtractionTool | null {
  const toolsById = new Map(loadTools().map((tool) => [tool.id, tool]));
  return toolsById.get(id) ?? null;
}

export function validateExtractionInput(tool: RegisteredExtractionTool, inputPath: string): void {
  const stat = statSync(inputPath);
  const mode = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : null;
  if (!mode || !tool.input.modes.includes(mode)) throw new Error(`input mode is not supported: ${mode ?? "unknown"}`);
  if (mode === "file" && !tool.input.accept.includes(extname(inputPath).toLowerCase())) {
    throw new Error(`input extension is not supported: ${extname(inputPath)}`);
  }
}
