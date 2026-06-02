import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPiTurn, type PiRun } from "./pi-adapter.ts";
import type { PiEvent } from "./types.ts";

// ---- Minimal local types (kept independent of the web-side shape) ----

interface WorkflowNode {
  id: string;
  label: string;
  prompt: string;
  model?: string;
  role?: string;
  inputs?: string[];
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

interface WorkflowDef {
  version?: number;
  defaultModel?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  layout?: "sequential" | "dag";
}

export interface MultiAgentRunOptions {
  flowRoot: string;
  runId: string;
  runDir: string;
  inputs?: Record<string, string>;
  defaultModel?: string;
  contextPrefix?: string;
  systemPromptPrefix?: string;
  onStepStart: (nodeId: string) => void;
  onStepRun?: (nodeId: string, run: PiRun) => void;
  onStepEvent: (nodeId: string, event: PiEvent) => void;
  onStepEnd: (nodeId: string, code: number | null, output: string) => void;
  onBlackboardUpdate: (key: string, value: string) => void;
  isAborted?: () => boolean;
}

export interface MultiAgentRunResult {
  code: number | null;
  blackboard: Record<string, string>;
}

export function readWorkflow(flowRoot: string): WorkflowDef | null {
  try {
    const raw = readFileSync(join(flowRoot, "workflow.json"), "utf8");
    const def = JSON.parse(raw) as WorkflowDef;
    if (!Array.isArray(def.nodes) || !Array.isArray(def.edges)) return null;
    return def;
  } catch {
    return null;
  }
}

export function topoOrder(workflow: WorkflowDef): WorkflowNode[] {
  const idToNode = new Map(workflow.nodes.map((n) => [n.id, n] as const));
  const indeg = new Map<string, number>(workflow.nodes.map((n) => [n.id, 0]));
  const fwd = new Map<string, string[]>(workflow.nodes.map((n) => [n.id, []]));
  for (const e of workflow.edges) {
    if (!idToNode.has(e.source) || !idToNode.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    fwd.get(e.source)!.push(e.target);
  }
  const queue: string[] = [];
  for (const n of workflow.nodes) if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id);
  const out: WorkflowNode[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(idToNode.get(id)!);
    for (const nxt of fwd.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1);
      if ((indeg.get(nxt) ?? 0) <= 0) queue.push(nxt);
    }
  }
  for (const n of workflow.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_\-\u4e00-\u9fff.]+)\s*\}\}/g;

export function renderPrompt(
  template: string,
  blackboard: Record<string, string>,
  inputs: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (full, key: string) => {
    if (key.startsWith("input.")) {
      const k = key.slice("input.".length);
      return inputs[k] ?? full;
    }
    return blackboard[key] ?? inputs[key] ?? full;
  });
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function runMultiAgent(
  workflow: WorkflowDef,
  opts: MultiAgentRunOptions,
): Promise<MultiAgentRunResult> {
  const blackboard: Record<string, string> = {};
  const inputs = opts.inputs ?? {};
  const order = topoOrder(workflow);
  const fallbackModel = opts.defaultModel || workflow.defaultModel || "";

  for (const node of order) {
    if (opts.isAborted?.()) return { code: null, blackboard };
    opts.onStepStart(node.id);

    const nodeDir = join(opts.runDir, sanitizeId(node.id));
    mkdirSync(nodeDir, { recursive: true });

    const prompt = renderPrompt(node.prompt || node.label, blackboard, inputs);
    const model = node.model || fallbackModel || undefined;
    const nodeSystemPrompt = buildSystemPrompt(node);
    const systemPrompt = [opts.systemPromptPrefix, nodeSystemPrompt].filter(Boolean).join("\n\n") || undefined;

    const piSessionId = opts.runId + "-" + sanitizeId(node.id);

    let assistantText = "";
    const run = runPiTurn({
      workspaceRoot: nodeDir,
      piSessionId,
      text: `${opts.contextPrefix ?? ""}${prompt}`,
      model,
      systemPrompt,
      onEvent: (event: PiEvent) => {
        opts.onStepEvent(node.id, event);
        if (event.type === "message_end") {
          const msg = (event as { message?: { role?: string; content?: unknown } }).message;
          if (msg && msg.role === "assistant") {
            const text = extractText(msg.content);
            if (text) assistantText = text;
          }
        }
      },
    });
    opts.onStepRun?.(node.id, run);
    const code = await run.done;
    opts.onStepEnd(node.id, code, assistantText);

    if (assistantText) {
      blackboard[node.id] = assistantText;
      opts.onBlackboardUpdate(node.id, assistantText);
    }

    if (code !== 0) {
      return { code, blackboard };
    }
  }

  return { code: 0, blackboard };
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_").slice(0, 80) || "node";
}

function buildSystemPrompt(node: WorkflowNode): string | undefined {
  const parts: string[] = [];
  if (node.role) parts.push("你的角色：" + node.role);
  if (node.label) parts.push("节点名称：" + node.label);
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}
