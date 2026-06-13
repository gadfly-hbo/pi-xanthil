import type { FlowTreeNode, PiEvent, WorkflowNode } from "@/types";
import type { EditableWorkflowDef, EditableWorkflowNode, ToolStepOutput, WorkflowIssue } from "./types";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_\-\u4e00-\u9fff.]+)\s*\}\}/g;
const INPUT_KEYS = new Set(["task", "prompt", "query"]);

export function upstreamRefs(prompt: string | undefined, nodeIds: Set<string>): string[] {
  if (!prompt) return [];
  const out = new Set<string>();
  for (const m of prompt.matchAll(PLACEHOLDER_RE)) {
    const key = m[1]!;
    if (key.startsWith("input.") || INPUT_KEYS.has(key)) continue;
    if (nodeIds.has(key)) out.add(key);
  }
  return [...out];
}

export function topoOrder(workflow: EditableWorkflowDef): EditableWorkflowNode[] {
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
  const out: EditableWorkflowNode[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(idToNode.get(id)!);
    for (const next of fwd.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if ((indeg.get(next) ?? 0) <= 0) queue.push(next);
    }
  }
  for (const n of workflow.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

export function nodesBeforeGate(workflow: EditableWorkflowDef | null, gateId: string): EditableWorkflowNode[] {
  if (!workflow) return [];
  const ordered = topoOrder(workflow);
  const gateIndex = ordered.findIndex((n) => n.id === gateId);
  return gateIndex > 0 ? ordered.slice(0, gateIndex) : [];
}

export function gateMaxIterations(node: EditableWorkflowNode): number {
  return node.onBlock?.maxIterations ?? 3;
}

export function nextUniqueId(base: string, used: Set<string>): string {
  const cleaned = base.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "node";
  if (!used.has(cleaned)) return cleaned;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${cleaned}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${cleaned}-${Date.now().toString(36)}`;
}

export function makeEdgeId(source: string, target: string, used: Set<string>): string {
  return nextUniqueId(`e-${source}-${target}`, used);
}

export function makeRunId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function collectTreeDirs(node: FlowTreeNode, out = new Set<string>()): Set<string> {
  if (node.kind === "dir") out.add(node.path);
  for (const child of node.children ?? []) collectTreeDirs(child, out);
  return out;
}

export function normalizedNodeKind(node: WorkflowNode): NonNullable<WorkflowNode["kind"]> {
  return node.kind ?? "agent";
}

export function nodeKindLabel(kind: NonNullable<WorkflowNode["kind"]>): string {
  if (kind === "tool") return "tool";
  if (kind === "gate") return "gate";
  return "agent";
}

export function validateWorkflowEditor(workflow: EditableWorkflowDef | null): WorkflowIssue[] {
  if (!workflow) return [];
  const issues: WorkflowIssue[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of workflow.nodes) {
    if (!node.id.trim()) issues.push({ level: "error", nodeId: node.id, message: "node id 不能为空" });
    if (seen.has(node.id)) duplicates.add(node.id);
    seen.add(node.id);
    if (!node.label.trim()) issues.push({ level: "warning", nodeId: node.id, message: `${node.id || "未命名节点"} 缺少节点名称` });
    if (normalizedNodeKind(node) === "tool") {
      if (!node.toolId?.trim()) issues.push({ level: "error", nodeId: node.id, message: `${node.id} 缺少 toolId` });
      if (!node.inputPath?.trim()) issues.push({ level: "error", nodeId: node.id, message: `${node.id} 缺少 inputPath` });
    }
    if (node.onBlock !== undefined && normalizedNodeKind(node) !== "gate") {
      issues.push({ level: "error", nodeId: node.id, message: `${node.id} 只有 gate 节点允许配置 onBlock` });
    }
    if (node.onBlock !== undefined) {
      if (!node.onBlock.retryFromNodeId.trim()) issues.push({ level: "error", nodeId: node.id, message: `${node.id} onBlock.retryFromNodeId 不能为空` });
      if (node.onBlock.maxIterations !== undefined && (!Number.isInteger(node.onBlock.maxIterations) || node.onBlock.maxIterations < 1)) {
        issues.push({ level: "error", nodeId: node.id, message: `${node.id} onBlock.maxIterations 必须是 >=1 的整数` });
      }
      if (node.onBlock.feedbackVar !== undefined && !node.onBlock.feedbackVar.trim()) {
        issues.push({ level: "error", nodeId: node.id, message: `${node.id} onBlock.feedbackVar 不能为空字符串` });
      }
    }
  }
  for (const id of duplicates) issues.push({ level: "error", nodeId: id, message: `node id 重复：${id}` });
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) issues.push({ level: "error", edgeId: edge.id, message: `${edge.id} source 不存在：${edge.source}` });
    if (!nodeIds.has(edge.target)) issues.push({ level: "error", edgeId: edge.id, message: `${edge.id} target 不存在：${edge.target}` });
    if (edge.source === edge.target) issues.push({ level: "warning", edgeId: edge.id, message: `${edge.id} 指向自身` });
  }
  const ordered = topoOrder(workflow);
  const topoIndex = new Map(ordered.map((node, index) => [node.id, index] as const));
  for (const node of workflow.nodes) {
    if (!node.onBlock) continue;
    const retryIndex = topoIndex.get(node.onBlock.retryFromNodeId);
    const gateIndex = topoIndex.get(node.id);
    if (retryIndex === undefined) {
      issues.push({ level: "error", nodeId: node.id, message: `${node.id} onBlock.retryFromNodeId 不存在：${node.onBlock.retryFromNodeId}` });
    } else if (gateIndex === undefined || retryIndex >= gateIndex) {
      issues.push({ level: "error", nodeId: node.id, message: `${node.id} onBlock.retryFromNodeId 必须位于当前 gate 之前` });
    }
  }
  return issues;
}

export function parseToolStepOutput(text: string): ToolStepOutput | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text) as Partial<ToolStepOutput>;
    if (
      value.kind !== "tool"
      || typeof value.toolId !== "string"
      || typeof value.outputPath !== "string"
      || typeof value.summaryPath !== "string"
      || typeof value.success !== "boolean"
      || !Array.isArray(value.artifacts)
      || !value.artifacts.every((item) => typeof item === "string")
    ) return null;
    return value as ToolStepOutput;
  } catch {
    return null;
  }
}

export function toRunRelativePath(runRoot: string | null, absoluteOrRelative: string): string | null {
  const value = absoluteOrRelative.trim();
  if (!value) return null;
  if (!runRoot) return value.startsWith("/") ? null : value;
  const normalizedRoot = runRoot.replace(/\/+$/, "");
  if (value === normalizedRoot) return "";
  if (value.startsWith(normalizedRoot + "/")) return value.slice(normalizedRoot.length + 1);
  return value.startsWith("/") ? null : value;
}

export function extractEventText(event: PiEvent): string {
  if (event.type !== "message_end") return "";
  const msg = (event as { message?: { role?: string; content?: unknown } }).message;
  if (!msg || msg.role !== "assistant") return "";
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function describePiEvent(event: PiEvent): string | null {
  if (event.type === "process_start") {
    const cwd = typeof event.cwd === "string" ? event.cwd : "";
    const command = typeof event.command === "string" ? event.command : "pi";
    return `启动 ${command} cwd=${cwd}`;
  }
  if (event.type === "spawn_error") return `spawn_error: ${typeof event.message === "string" ? event.message : JSON.stringify(event)}`;
  if (event.type === "stderr") {
    const text = typeof event.text === "string" ? event.text.trim() : JSON.stringify(event);
    return text ? `stderr: ${text}` : null;
  }
  if (event.type === "turn_start") return "pi turn_start";
  if (event.type === "agent_start") return "pi agent_start";
  return null;
}
