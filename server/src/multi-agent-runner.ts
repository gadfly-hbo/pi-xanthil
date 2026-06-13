import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { runPiTurn as defaultRunPiTurn, type PiRun, type RunPiOptions } from "./pi-adapter.ts";
import {
  deterministicRedLineCheck,
  evaluateGate,
  evaluateSqlGate,
  formatSqlGateOutput,
  type GateThresholds,
  type GateVerdict,
} from "./anax-gate.ts";
import { evaluateRunBudget, type RunBudgetLimits, type RunBudgetStatus } from "./cache.ts";
import type { PiEvent } from "./types.ts";
import type { ChildProcessListener } from "./child-processes.ts";
import { getExtractionTool, validateExtractionInput, type RegisteredExtractionTool } from "../tools/registry.ts";
import { runExtractionToolProcess, type ToolEvalToolRun } from "./tool-evaluation-runner.ts";
import { executeQuery, getConnection, validateSql } from "./sql-connections.ts";
import { RUN_SQL_QUERY_TOOL_ID } from "./sql-loop-template.ts";

/**
 * Pluggable pi-turn launcher. Defaults to the real `runPiTurn` from
 * `pi-adapter.ts`; tests inject a deterministic fake so the runner can be
 * exercised without spawning the real pi binary.
 */
export type PiTurnFn = (opts: RunPiOptions) => PiRun;
export type WorkflowToolRunFn = (opts: WorkflowToolRunOptions) => Promise<ToolEvalToolRun>;
export type WorkflowGetToolFn = (id: string) => RegisteredExtractionTool | null;

export interface WorkflowToolRunOptions {
  tool: RegisteredExtractionTool;
  inputPath: string;
  outputPath: string;
  summaryPath: string;
  timeoutMs: number;
}

// ---- Minimal local types (kept independent of the web-side shape) ----

/**
 * Fan-out config: run this node's prompt concurrently, once per item parsed
 * from an upstream node's structured output. Each child pi session sees the
 * item's fields injected as `{{itemVar.<field>}}` (and `{{itemVar}}` = full
 * JSON). Results are merged back into the blackboard under the node id.
 * When the source output carries no parseable array, the node degrades to a
 * single ordinary turn — fan-out is an optimization, never a hard requirement.
 */
export interface FanOutSpec {
  /** Upstream node id whose output carries the item array. */
  source: string;
  /** Fenced marker holding a JSON array, e.g. "anax-hypotheses-plan". */
  marker: string;
  /** Max concurrent pi sessions. Default 3. */
  concurrency?: number;
  /** Hard cap on items (guards against a model emitting an unbounded list). Default 8. */
  maxItems?: number;
  /** Placeholder prefix each item is injected under. Default "item". */
  itemVar?: string;
}

export interface GateOnBlock {
  /** Upstream node id to rerun when the gate blocks. Must appear before this gate in topo order. */
  retryFromNodeId: string;
  /** Total loop-body executions including the first pass. Default: 3. */
  maxIterations?: number;
  /** Blackboard key used to inject the previous failed verdict into the loop body. */
  feedbackVar?: string;
}

export interface WorkflowNode {
  id: string;
  label: string;
  prompt: string;
  model?: string;
  role?: string;
  inputs?: string[];
  /** Node-level skill override. Empty array disables workflow default skills for this node. */
  skillPaths?: string[];
  /** AnaX: deliverable filename; node output is also written to runDir/specs/<spec>. */
  spec?: string;
  /** AnaX: "gate" nodes parse a structured verdict and may block the flow. */
  kind?: "agent" | "gate" | "tool";
  /** Tool step: registered extraction tool id. */
  toolId?: string;
  /** Tool step: input file/directory path template. Supports {{input.*}} and upstream node placeholders. */
  inputPath?: string;
  /** Tool step: output directory path template. Defaults to the node run directory. */
  outputDir?: string;
  /** Tool step: execution timeout in milliseconds. */
  timeoutMs?: number;
  /** AnaX: when set, the node fans out into one concurrent turn per upstream item. */
  fanOut?: FanOutSpec;
  /** Gate-only controlled retry loop. See docs/工作流-onblock契约.md. */
  onBlock?: GateOnBlock;
}

const DEFAULT_FANOUT_CONCURRENCY = 3;
const DEFAULT_FANOUT_MAX_ITEMS = 8;
const DEFAULT_GATE_MAX_ITERATIONS = 3;
const RUN_BUDGET_BLACKBOARD_KEY = "__run_budget_stop";

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDef {
  version?: number;
  defaultModel?: string;
  /** Workflow-level skill fallback for nodes without their own skillPaths. */
  defaultSkillPaths?: string[];
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
  /** Fired after a `kind:"gate"` node runs, with its parsed verdict. */
  onStepGate?: (nodeId: string, verdict: GateVerdict) => void;
  /** Per-workspace threshold overrides. Defaults to built-in constants when absent. */
  gateThresholds?: GateThresholds;
  onChildProcess?: ChildProcessListener;
  isAborted?: () => boolean;
  /**
   * Pre-populated blackboard entries from a previous run. Used when resuming
   * from a mid-flow node so upstream outputs are available for prompt rendering
   * without re-executing those nodes.
   */
  initialBlackboard?: Record<string, string>;
  /**
   * When set, execution skips all nodes that appear before this node in topo
   * order. Combined with `initialBlackboard`, this resumes the flow mid-way.
   */
  resumeFromNodeId?: string;
  /**
   * Optional override for spawning a pi turn. Tests inject a deterministic
   * fake here; production code leaves it undefined to use the real pi binary.
   */
  runTurn?: PiTurnFn;
  /** Optional override for running a workflow tool node. Tests inject a fake. */
  runTool?: WorkflowToolRunFn;
  /** Optional override for resolving a registered extraction tool. Tests inject a fake. */
  getTool?: WorkflowGetToolFn;
  /** Optional run-level budget guard. When absent, budget checks are disabled. */
  runBudget?: { workspaceId: string; limits: RunBudgetLimits };
}

export interface MultiAgentRunResult {
  code: number | null;
  blackboard: Record<string, string>;
}

export function readWorkflow(flowRoot: string): WorkflowDef | null {
  try {
    const raw = readFileSync(join(flowRoot, "workflow.json"), "utf8");
    const def = JSON.parse(raw) as WorkflowDef;
    validateWorkflow(def);
    return def;
  } catch {
    return null;
  }
}

export function validateWorkflow(value: unknown): asserts value is WorkflowDef {
  if (typeof value !== "object" || value === null) throw new Error("workflow must be an object");
  const workflow = value as Partial<WorkflowDef>;
  if (!Array.isArray(workflow.nodes)) throw new Error("workflow.nodes must be an array");
  if (!Array.isArray(workflow.edges)) throw new Error("workflow.edges must be an array");
  if (workflow.version !== undefined && typeof workflow.version !== "number") {
    throw new Error("workflow.version must be a number when provided");
  }
  if (workflow.defaultModel !== undefined && typeof workflow.defaultModel !== "string") {
    throw new Error("workflow.defaultModel must be a string when provided");
  }
  if (workflow.defaultSkillPaths !== undefined && !isStringArray(workflow.defaultSkillPaths)) {
    throw new Error("workflow.defaultSkillPaths must be a string array when provided");
  }
  if (workflow.layout !== undefined && workflow.layout !== "sequential" && workflow.layout !== "dag") {
    throw new Error("workflow.layout must be 'sequential' or 'dag' when provided");
  }

  const ids = new Set<string>();
  for (const [index, node] of workflow.nodes.entries()) {
    if (typeof node !== "object" || node === null) throw new Error(`workflow.nodes[${index}] must be an object`);
    const n = node as Partial<WorkflowNode>;
    const id = typeof n.id === "string" ? n.id.trim() : "";
    if (!id) throw new Error(`workflow.nodes[${index}].id is required`);
    if (ids.has(id)) throw new Error(`workflow node id is duplicated: ${id}`);
    ids.add(id);
    if (n.label !== undefined && typeof n.label !== "string") {
      throw new Error(`workflow.nodes[${index}].label must be a string when provided`);
    }
    if (n.prompt !== undefined && typeof n.prompt !== "string") {
      throw new Error(`workflow.nodes[${index}].prompt must be a string when provided`);
    }
    if (!String(n.prompt ?? n.label ?? "").trim()) {
      throw new Error(`workflow.nodes[${index}] must provide prompt or label`);
    }
    if (n.model !== undefined && typeof n.model !== "string") {
      throw new Error(`workflow.nodes[${index}].model must be a string when provided`);
    }
    if (n.role !== undefined && typeof n.role !== "string") {
      throw new Error(`workflow.nodes[${index}].role must be a string when provided`);
    }
    if (n.spec !== undefined && typeof n.spec !== "string") {
      throw new Error(`workflow.nodes[${index}].spec must be a string when provided`);
    }
    if (n.kind !== undefined && n.kind !== "agent" && n.kind !== "gate" && n.kind !== "tool") {
      throw new Error(`workflow.nodes[${index}].kind must be 'agent', 'gate', or 'tool' when provided`);
    }
    if (n.kind === "tool") {
      if (typeof n.toolId !== "string" || !n.toolId.trim()) {
        throw new Error(`workflow.nodes[${index}].toolId is required for tool nodes`);
      }
      if (typeof n.inputPath !== "string" || !n.inputPath.trim()) {
        throw new Error(`workflow.nodes[${index}].inputPath is required for tool nodes`);
      }
      if (n.outputDir !== undefined && typeof n.outputDir !== "string") {
        throw new Error(`workflow.nodes[${index}].outputDir must be a string when provided`);
      }
      if (n.timeoutMs !== undefined && (typeof n.timeoutMs !== "number" || !Number.isFinite(n.timeoutMs) || n.timeoutMs < 1)) {
        throw new Error(`workflow.nodes[${index}].timeoutMs must be a number >= 1 when provided`);
      }
    }
    if (n.inputs !== undefined && (!Array.isArray(n.inputs) || !n.inputs.every((input) => typeof input === "string"))) {
      throw new Error(`workflow.nodes[${index}].inputs must be a string array when provided`);
    }
    if (n.skillPaths !== undefined && !isStringArray(n.skillPaths)) {
      throw new Error(`workflow.nodes[${index}].skillPaths must be a string array when provided`);
    }
    if (n.fanOut !== undefined) {
      const fo = n.fanOut as Partial<FanOutSpec>;
      if (typeof fo !== "object" || fo === null) throw new Error(`workflow.nodes[${index}].fanOut must be an object`);
      if (typeof fo.source !== "string" || !fo.source.trim()) throw new Error(`workflow.nodes[${index}].fanOut.source is required`);
      if (typeof fo.marker !== "string" || !fo.marker.trim()) throw new Error(`workflow.nodes[${index}].fanOut.marker is required`);
      if (fo.concurrency !== undefined && (typeof fo.concurrency !== "number" || !Number.isFinite(fo.concurrency) || fo.concurrency < 1)) {
        throw new Error(`workflow.nodes[${index}].fanOut.concurrency must be a number >= 1 when provided`);
      }
      if (fo.maxItems !== undefined && (typeof fo.maxItems !== "number" || !Number.isFinite(fo.maxItems) || fo.maxItems < 1)) {
        throw new Error(`workflow.nodes[${index}].fanOut.maxItems must be a number >= 1 when provided`);
      }
      if (fo.itemVar !== undefined && typeof fo.itemVar !== "string") {
        throw new Error(`workflow.nodes[${index}].fanOut.itemVar must be a string when provided`);
      }
    }
    if (n.onBlock !== undefined) {
      const onBlock = n.onBlock as Partial<GateOnBlock>;
      if (typeof onBlock !== "object" || onBlock === null) throw new Error(`workflow.nodes[${index}].onBlock must be an object`);
      if (n.kind !== "gate") throw new Error(`workflow.nodes[${index}].onBlock is only allowed for gate nodes`);
      if (typeof onBlock.retryFromNodeId !== "string" || !onBlock.retryFromNodeId.trim()) {
        throw new Error(`workflow.nodes[${index}].onBlock.retryFromNodeId is required`);
      }
      if (
        onBlock.maxIterations !== undefined
        && (!Number.isInteger(onBlock.maxIterations) || onBlock.maxIterations < 1)
      ) {
        throw new Error(`workflow.nodes[${index}].onBlock.maxIterations must be an integer >= 1 when provided`);
      }
      if (onBlock.feedbackVar !== undefined && (typeof onBlock.feedbackVar !== "string" || !onBlock.feedbackVar.trim())) {
        throw new Error(`workflow.nodes[${index}].onBlock.feedbackVar must be a non-empty string when provided`);
      }
    }
  }

  for (const node of workflow.nodes as WorkflowNode[]) {
    if (node.fanOut && !ids.has(node.fanOut.source)) {
      throw new Error(`workflow node ${node.id} fanOut.source references missing node: ${node.fanOut.source}`);
    }
  }

  for (const [index, edge] of workflow.edges.entries()) {
    if (typeof edge !== "object" || edge === null) throw new Error(`workflow.edges[${index}] must be an object`);
    const e = edge as Partial<WorkflowEdge>;
    const source = typeof e.source === "string" ? e.source.trim() : "";
    const target = typeof e.target === "string" ? e.target.trim() : "";
    if (e.id !== undefined && typeof e.id !== "string") {
      throw new Error(`workflow.edges[${index}].id must be a string when provided`);
    }
    if (!source) throw new Error(`workflow.edges[${index}].source is required`);
    if (!target) throw new Error(`workflow.edges[${index}].target is required`);
    if (!ids.has(source)) throw new Error(`workflow.edges[${index}].source references missing node: ${source}`);
    if (!ids.has(target)) throw new Error(`workflow.edges[${index}].target references missing node: ${target}`);
  }

  const order = topoOrder(workflow as WorkflowDef);
  const topoIndex = new Map(order.map((node, index) => [node.id, index] as const));
  for (const node of workflow.nodes as WorkflowNode[]) {
    if (!node.onBlock) continue;
    const gateIndex = topoIndex.get(node.id);
    const retryIndex = topoIndex.get(node.onBlock.retryFromNodeId);
    if (retryIndex === undefined) {
      throw new Error(`workflow node ${node.id} onBlock.retryFromNodeId references missing node: ${node.onBlock.retryFromNodeId}`);
    }
    if (gateIndex === undefined || retryIndex >= gateIndex) {
      throw new Error(`workflow node ${node.id} onBlock.retryFromNodeId must appear before the gate in topo order`);
    }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract a JSON array fenced under ```<marker>``` from a node's output.
 * Returns null when absent or unparseable (callers degrade to a single turn).
 */
export function extractMarkerArray(text: string, marker: string): unknown[] | null {
  const blocks = text.matchAll(new RegExp("```" + escapeRegExp(marker) + "(?:[ \\t]*\\r?\\n|[ \\t]*)?([\\s\\S]+?)```", "g"));
  let latest: unknown[] | null = null;
  for (const match of blocks) {
    if (!match[1]) continue;
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown;
      if (Array.isArray(parsed)) latest = parsed;
    } catch {
      // Keep scanning: models may quote an invalid example before the final block.
    }
  }
  return latest;
}

/**
 * Flatten one fan-out item into placeholder bindings: each field becomes
 * `<itemVar>.<key>` and the whole item is also exposed as `<itemVar>`.
 * Bindings are merged into `inputs` so renderPrompt resolves `{{item.xxx}}`.
 */
function flattenItem(itemVar: string, item: unknown): Record<string, string> {
  if (typeof item === "string") return { [itemVar]: item };
  if (typeof item !== "object" || item === null) return { [itemVar]: String(item) };
  const out: Record<string, string> = { [itemVar]: JSON.stringify(item) };
  for (const [key, value] of Object.entries(item)) {
    out[`${itemVar}.${key}`] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
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
  validateWorkflow(workflow);
  const blackboard: Record<string, string> = { ...opts.initialBlackboard };
  const inputs = opts.inputs ?? {};
  const order = topoOrder(workflow);
  const topoIndex = new Map(order.map((n, index) => [n.id, index] as const));
  const gateIterations = new Map<string, number>();
  const fallbackModel = opts.defaultModel || workflow.defaultModel || "";
  const fallbackSkillPaths = workflow.defaultSkillPaths;

  const resumeIdx = opts.resumeFromNodeId
    ? Math.max(0, order.findIndex((n) => n.id === opts.resumeFromNodeId))
    : 0;

  let cursor = resumeIdx;
  while (cursor < order.length) {
    if (opts.isAborted?.()) return { code: null, blackboard };
    const node = order[cursor]!;
    opts.onStepStart(node.id);

    const trace = activeLoopTrace(order, cursor, gateIterations);
    const nodeDir = trace
      ? join(opts.runDir, sanitizeId(node.id), `iter-${trace.iteration}`)
      : join(opts.runDir, sanitizeId(node.id));
    mkdirSync(nodeDir, { recursive: true });

    const model = node.model || fallbackModel || undefined;
    const skillPaths = node.skillPaths ?? fallbackSkillPaths;
    const nodeSystemPrompt = buildSystemPrompt(node);
    const systemPrompt = [opts.systemPromptPrefix, nodeSystemPrompt].filter(Boolean).join("\n\n") || undefined;
    const turnBase = { model, skillPaths, systemPrompt };

    // Fan-out only when the node opts in AND the upstream output actually
    // carries a parseable item array; otherwise fall back to a single turn.
    const fanItems = node.fanOut
      ? extractMarkerArray(blackboard[node.fanOut.source] ?? "", node.fanOut.marker)
      : null;

    let code: number | null;
    let assistantText: string;
    if (node.kind === "tool") {
      ({ code, text: assistantText } = await executeToolNode(node, blackboard, inputs, nodeDir, opts));
    } else if (isDeterministicSqlGateNode(node)) {
      const verdict = evaluateSqlGate(blackboard);
      code = 0;
      assistantText = formatSqlGateOutput(verdict);
    } else if (node.fanOut && fanItems && fanItems.length > 0) {
      ({ code, text: assistantText } = await runFanOut(node, node.fanOut, fanItems, blackboard, inputs, nodeDir, turnBase, opts));
    } else {
      const prompt = renderPrompt(node.prompt || node.label, blackboard, inputs);
      const piSessionId = opts.runId + "-" + sanitizeId(node.id);
      ({ code, text: assistantText } = await executeTurn(node, { prompt, piSessionId, nodeDir, ...turnBase }, opts));
    }
    opts.onStepEnd(node.id, code, assistantText);

    if (assistantText) {
      blackboard[node.id] = assistantText;
      opts.onBlackboardUpdate(node.id, assistantText);

      // AnaX: persist the node's deliverable under specs/ so downstream gate
      // nodes (and humans) can reference it as a named artifact.
      if (node.spec) {
        const specsDir = join(opts.runDir, "specs");
        mkdirSync(specsDir, { recursive: true });
        writeFileSync(join(specsDir, node.spec), assistantText, "utf8");
      }
    }

    if (code !== 0) {
      return { code, blackboard };
    }

    if (node.kind !== "gate") {
      const budgetStatus = evaluateRunBudgetForRun(opts);
      if (budgetStatus.exceeded) {
        recordRunBudgetStop(blackboard, opts, budgetStatus);
        return { code: 1, blackboard };
      }
    }

    // AnaX: a gate node re-derives a pass/block decision from its structured
    // verdict. A blocked gate halts the flow (equivalent to anax `gate` != 0).
    if (node.kind === "gate") {
      const verdict = isDeterministicSqlGateNode(node)
        ? evaluateSqlGate(blackboard)
        : evaluateGate(assistantText, node.id, opts.gateThresholds);
      // Layer on top: deterministic checks that don't rely on the LLM reporting
      // its own violations (guards against RL03/RL06/RL07 being silently missed).
      const extraReasons = deterministicRedLineCheck(blackboard, node.id, opts.gateThresholds);
      if (extraReasons.length > 0) {
        verdict.reasons.push(...extraReasons);
        verdict.blockers += extraReasons.length;
        verdict.verdict = "blocked";
      }
      const budgetStatus = extraReasons.length === 0 ? evaluateRunBudgetForRun(opts) : { exceeded: false, reason: null, totalTokens: 0, totalCost: 0 };
      if (budgetStatus.exceeded) {
        verdict.reasons.push(budgetStatus.reason ?? "run budget exceeded");
        verdict.blockers += 1;
        verdict.verdict = "blocked";
      }
      const gateIteration = currentGateIteration(node, gateIterations);
      const maxIterations = node.onBlock?.maxIterations ?? DEFAULT_GATE_MAX_ITERATIONS;
      const retryIndex = node.onBlock ? topoIndex.get(node.onBlock.retryFromNodeId) : undefined;
      const canRetry = verdict.verdict === "blocked"
        && extraReasons.length === 0
        && !budgetStatus.exceeded
        && node.onBlock
        && retryIndex !== undefined
        && gateIteration < maxIterations;
      if (
        verdict.verdict === "blocked"
        && extraReasons.length === 0
        && !budgetStatus.exceeded
        && node.onBlock
        && !canRetry
      ) {
        verdict.reasons.push(`重试轮次已耗尽：第 ${gateIteration} 轮 / 共 ${maxIterations} 轮`);
        verdict.blockers += 1;
      }
      const gatesDir = join(opts.runDir, "gates");
      mkdirSync(gatesDir, { recursive: true });
      if (node.onBlock) {
        writeFileSync(join(gatesDir, `${sanitizeId(node.id)}-iter${gateIteration}.json`), JSON.stringify(verdict, null, 2), "utf8");
      }
      writeFileSync(join(gatesDir, `${sanitizeId(node.id)}.json`), JSON.stringify(verdict, null, 2), "utf8");
      opts.onStepGate?.(node.id, verdict);
      if (verdict.verdict === "blocked") {
        if (extraReasons.length > 0) {
          return { code: 1, blackboard };
        }
        if (budgetStatus.exceeded) {
          recordRunBudgetStop(blackboard, opts, budgetStatus);
          return { code: 1, blackboard };
        }
        if (canRetry) {
          const feedbackVar = feedbackVarForGate(node);
          blackboard[feedbackVar] = formatGateFeedback(verdict, gateIteration, maxIterations);
          resetLoopBlackboard(blackboard, order, retryIndex!, cursor);
          opts.onBlackboardUpdate(feedbackVar, blackboard[feedbackVar]);
          gateIterations.set(node.id, gateIteration + 1);
          cursor = retryIndex;
          continue;
        }
        return { code: 1, blackboard };
      }
    }
    cursor += 1;
  }

  return { code: 0, blackboard };
}

interface LoopTrace {
  iteration: number;
}

function activeLoopTrace(order: WorkflowNode[], nodeIndex: number, gateIterations: Map<string, number>): LoopTrace | null {
  for (let gateIndex = nodeIndex; gateIndex < order.length; gateIndex += 1) {
    const gate = order[gateIndex]!;
    if (gate.kind !== "gate" || !gate.onBlock) continue;
    const retryIndex = order.findIndex((node) => node.id === gate.onBlock?.retryFromNodeId);
    if (retryIndex >= 0 && retryIndex <= nodeIndex && nodeIndex <= gateIndex) {
      return { iteration: currentGateIteration(gate, gateIterations) };
    }
  }
  return null;
}

function currentGateIteration(node: WorkflowNode, gateIterations: Map<string, number>): number {
  return gateIterations.get(node.id) ?? 1;
}

function evaluateRunBudgetForRun(opts: MultiAgentRunOptions): RunBudgetStatus {
  if (!opts.runBudget) return { totalTokens: 0, totalCost: 0, exceeded: false, reason: null };
  return evaluateRunBudget(opts.runBudget.workspaceId, opts.runId, opts.runBudget.limits);
}

function recordRunBudgetStop(
  blackboard: Record<string, string>,
  opts: MultiAgentRunOptions,
  status: RunBudgetStatus,
): void {
  const text = status.reason ?? "run budget exceeded";
  blackboard[RUN_BUDGET_BLACKBOARD_KEY] = text;
  opts.onBlackboardUpdate(RUN_BUDGET_BLACKBOARD_KEY, text);
}

function feedbackVarForGate(node: WorkflowNode): string {
  const configured = node.onBlock?.feedbackVar?.trim();
  return configured || `${node.id}__feedback`;
}

function formatGateFeedback(verdict: GateVerdict, iteration: number, maxIterations: number): string {
  const reasons = verdict.reasons.length > 0 ? verdict.reasons : ["门禁未通过，但未返回具体原因。"];
  return [
    `## 上一轮门禁未通过（第 ${iteration} 轮 / 共 ${maxIterations} 轮）`,
    ...reasons.map((reason) => `- ${reason}`),
    "请仅针对以上问题修正，不要改动其他无关部分。",
  ].join("\n");
}

function resetLoopBlackboard(
  blackboard: Record<string, string>,
  order: WorkflowNode[],
  retryIndex: number,
  gateIndex: number,
): void {
  for (let i = retryIndex; i <= gateIndex; i += 1) {
    delete blackboard[order[i]!.id];
  }
}

interface WorkflowToolOutput {
  kind: "tool";
  toolId: string;
  inputPath: string;
  outputPath: string;
  summaryPath: string;
  code: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  summary: unknown;
  artifacts: string[];
}

async function executeToolNode(
  node: WorkflowNode,
  blackboard: Record<string, string>,
  inputs: Record<string, string>,
  nodeDir: string,
  opts: MultiAgentRunOptions,
): Promise<{ code: number | null; text: string }> {
  try {
    const toolId = String(node.toolId ?? "").trim();
    if (toolId === RUN_SQL_QUERY_TOOL_ID) {
      return await executeSqlQueryToolNode(node, blackboard, inputs);
    }
    const tool = (opts.getTool ?? getExtractionTool)(toolId);
    if (!tool) throw new Error(`registered extraction tool not found: ${toolId}`);
    const inputPath = resolveWorkflowPath(renderPrompt(String(node.inputPath ?? ""), blackboard, inputs), opts.flowRoot);
    const outputPath = node.outputDir && node.outputDir.trim()
      ? resolveWorkflowPath(renderPrompt(node.outputDir, blackboard, inputs), opts.runDir)
      : join(nodeDir, "output");
    const summaryPath = join(nodeDir, "summary.json");
    const timeoutMs = node.timeoutMs ?? 60_000;
    mkdirSync(outputPath, { recursive: true });
    validateExtractionInput(tool, inputPath);

    const runTool = opts.runTool ?? runExtractionToolProcess;
    const result = await runTool({ tool, inputPath, outputPath, summaryPath, timeoutMs });
    const summary = readJsonIfExists(summaryPath);
    const output = serializeToolOutput({
      kind: "tool",
      toolId: tool.id,
      inputPath,
      outputPath,
      summaryPath,
      code: result.code,
      success: result.code === 0 && !toolSummaryHasError(summary),
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      summary,
      artifacts: listRelativeFiles(outputPath),
    });
    return { code: result.code === 0 && !toolSummaryHasError(summary) ? 0 : 1, text: output };
  } catch (err) {
    return {
      code: 1,
      text: serializeToolOutput({
        kind: "tool",
        toolId: String(node.toolId ?? ""),
        inputPath: String(node.inputPath ?? ""),
        outputPath: node.outputDir ?? join(nodeDir, "output"),
        summaryPath: join(nodeDir, "summary.json"),
        code: 1,
        success: false,
        stdout: "",
        stderr: String(err),
        summary: { error: String(err) },
        artifacts: [],
      }),
    };
  }
}

interface WorkflowSqlToolOutput {
  kind: "sql_tool";
  toolId: typeof RUN_SQL_QUERY_TOOL_ID;
  connectionId: string;
  sql: string;
  code: number;
  success: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  capped: boolean;
  requiredFields: string[];
  error?: string;
  validation?: unknown;
}

async function executeSqlQueryToolNode(
  node: WorkflowNode,
  blackboard: Record<string, string>,
  inputs: Record<string, string>,
): Promise<{ code: number | null; text: string }> {
  const connectionId = String(inputs.sql_connection_id ?? inputs.connection_id ?? "").trim();
  const requiredFields = parseRequiredFields(inputs.required_fields ?? inputs.requiredFields ?? "");
  const sqlSource = renderPrompt(String(node.inputPath ?? ""), blackboard, inputs);
  const sql = extractSqlFromText(sqlSource);

  const base = {
    kind: "sql_tool" as const,
    toolId: RUN_SQL_QUERY_TOOL_ID,
    connectionId,
    sql,
    columns: [] as string[],
    rows: [] as Record<string, unknown>[],
    rowCount: 0,
    executionMs: 0,
    capped: false,
    requiredFields,
  };

  if (!connectionId) {
    return { code: 0, text: serializeSqlToolOutput({ ...base, code: 1, success: false, error: "missing input.sql_connection_id" }) };
  }
  if (!sql) {
    return { code: 0, text: serializeSqlToolOutput({ ...base, code: 1, success: false, error: "missing SQL block or SQL text" }) };
  }

  const validation = validateSql(sql);
  if (!validation.safe) {
    return { code: 0, text: serializeSqlToolOutput({ ...base, code: 1, success: false, validation, error: validation.risks.join("; ") }) };
  }

  const connection = getConnection(connectionId);
  if (!connection) {
    return { code: 0, text: serializeSqlToolOutput({ ...base, code: 1, success: false, validation, error: `SQL connection not found: ${connectionId}` }) };
  }

  try {
    const result = await executeQuery(connection, sql, 500);
    return {
      code: 0,
      text: serializeSqlToolOutput({
        ...base,
        code: 0,
        success: true,
        validation,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        executionMs: result.executionMs,
        capped: result.capped,
      }),
    };
  } catch (err) {
    return { code: 0, text: serializeSqlToolOutput({ ...base, code: 1, success: false, validation, error: String(err) }) };
  }
}

function parseRequiredFields(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    // Fall through to comma/newline parsing.
  }
  return trimmed.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function extractSqlFromText(text: string): string {
  const blocks = text.matchAll(/```sql(?:[ \t]*\r?\n|[ \t]*)?([\s\S]+?)```/gi);
  let latest = "";
  for (const match of blocks) {
    if (match[1]?.trim()) latest = match[1].trim();
  }
  return latest || text.trim();
}

function serializeSqlToolOutput(output: WorkflowSqlToolOutput): string {
  return JSON.stringify(output, null, 2);
}

function isDeterministicSqlGateNode(node: WorkflowNode): boolean {
  return node.kind === "gate" && node.id === "sql_gate";
}

interface TurnArgs {
  prompt: string;
  piSessionId: string;
  nodeDir: string;
  model?: string;
  skillPaths?: string[];
  systemPrompt?: string;
}

/** Run a single pi turn for a node, wiring events/run callbacks and capturing the assistant text. */
async function executeTurn(
  node: WorkflowNode,
  args: TurnArgs,
  opts: MultiAgentRunOptions,
): Promise<{ code: number | null; text: string }> {
  let assistantText = "";
  const runTurn = opts.runTurn ?? defaultRunPiTurn;
  const run = runTurn({
    workspaceRoot: args.nodeDir,
    piSessionId: args.piSessionId,
    text: `${opts.contextPrefix ?? ""}${args.prompt}`,
    model: args.model,
    systemPrompt: args.systemPrompt,
    skillPaths: args.skillPaths,
    onChildProcess: opts.onChildProcess,
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
  return { code, text: assistantText };
}

/**
 * Run `node` once per item with bounded concurrency. Each child gets its own pi
 * session id and sub-directory, with the item's fields injected as
 * `{{itemVar.<field>}}`. Outputs are merged in original item order. Any
 * non-zero child exit fails the whole node — same "non-zero halts" contract as
 * the sequential path. Children all report under `node.id`, so the node still
 * looks like a single step to callers (and the UI).
 */
async function runFanOut(
  node: WorkflowNode,
  spec: FanOutSpec,
  items: unknown[],
  blackboard: Record<string, string>,
  inputs: Record<string, string>,
  nodeDir: string,
  turnBase: { model?: string; skillPaths?: string[]; systemPrompt?: string },
  opts: MultiAgentRunOptions,
): Promise<{ code: number | null; text: string }> {
  const limited = items.slice(0, spec.maxItems ?? DEFAULT_FANOUT_MAX_ITEMS);
  const itemVar = spec.itemVar ?? "item";
  const concurrency = Math.max(1, Math.floor(spec.concurrency ?? DEFAULT_FANOUT_CONCURRENCY));
  const results = new Array<{ code: number | null; text: string } | undefined>(limited.length);

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.isAborted?.()) return;
      const index = cursor++;
      if (index >= limited.length) return;
      const itemInputs = { ...inputs, ...flattenItem(itemVar, limited[index]) };
      const prompt = renderPrompt(node.prompt || node.label, blackboard, itemInputs);
      const childDir = join(nodeDir, String(index + 1));
      mkdirSync(childDir, { recursive: true });
      const piSessionId = opts.runId + "-" + sanitizeId(node.id) + "-" + (index + 1);
      results[index] = await executeTurn(node, { prompt, piSessionId, nodeDir: childDir, ...turnBase }, opts);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, limited.length) }, () => worker()));

  const parts: string[] = [];
  let failing: { code: number | null } | undefined;
  for (let i = 0; i < limited.length; i++) {
    const r = results[i];
    if (!r) continue;
    if (r.code !== 0 && !failing) failing = r;
    parts.push(`## 假设 ${i + 1}\n\n${r.text}`);
  }
  return { code: failing ? failing.code : 0, text: parts.join("\n\n---\n\n") };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function resolveWorkflowPath(value: string, baseDir: string): string {
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? trimmed : join(baseDir, trimmed);
}

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    return { error: `invalid summary JSON: ${String(err)}` };
  }
}

function toolSummaryHasError(summary: unknown): boolean {
  if (typeof summary !== "object" || summary === null) return false;
  const item = summary as { error?: unknown; failed?: unknown; results?: unknown };
  if (typeof item.error === "string" && item.error.trim()) return true;
  if (typeof item.failed === "number" && item.failed > 0) return true;
  if (Array.isArray(item.results)) {
    return item.results.some((result) =>
      typeof result === "object"
      && result !== null
      && typeof (result as { error?: unknown }).error === "string"
      && String((result as { error?: unknown }).error).trim().length > 0
    );
  }
  return false;
}

function listRelativeFiles(rootPath: string): string[] {
  if (!existsSync(rootPath)) return [];
  const out: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute, rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  if (statSync(rootPath).isDirectory()) visit(rootPath, "");
  return out.sort();
}

function serializeToolOutput(output: WorkflowToolOutput): string {
  return JSON.stringify(output, null, 2);
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
