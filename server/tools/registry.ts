import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface ToolParameter {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
  description?: string;
}

export interface ExtractionToolManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  runtime: "python3";
  input: {
    accept: string[];
    modes: Array<"file" | "directory">;
  };
  output: string[];
  timeoutMs?: number;
  parameters?: ToolParameter[];
  resultColumns?: Array<{ key: string; label: string }>;
  riskLevel?: "L0" | "L1" | "L2" | "L3";
  allowedUse?: string;
  forbiddenUse?: string;
  failureHandling?: string;
  traceFields?: string[];
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
      return [{ ...manifest, rootPath, entryPath }];
    });
}

const tools = loadTools();
const toolsById = new Map(tools.map((tool) => [tool.id, tool]));

export function listExtractionTools(): ExtractionToolManifest[] {
  return tools.map(({ rootPath: _rootPath, entryPath: _entryPath, ...manifest }) => manifest);
}

export function getExtractionTool(id: string): RegisteredExtractionTool | null {
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
