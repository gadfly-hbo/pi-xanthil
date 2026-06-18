import express, { Router, type Request } from "express";
import multer from "multer";
import type { WebSocket } from "ws";
import { dirname, resolve, join, sep } from "node:path";
import { rmSync, statSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  getFlow, listFlowMessages, listFlowRuns, getFlowRun, updateFlowSourceName,
  getWorkspace, listFlows, createFlow, renameFlow, deleteFlow,
  listWorkflowFavorites, getWorkflowFavoriteBySourceFlowId, updateWorkflowFavorite,
  getWorkflowFavorite, createWorkflowFavorite, removeWorkflowFavorite,
  getStaleNodes, markNodesStale, listWorkspacePaths, addWorkspacePath, removeWorkspacePath,
  addFlowMessage, getFileAnalysesByPathIds, createFlowRun, finishFlowRun,
  recordMemoryInjectionUsage, buildHypothesisLibraryContext, getAnaxGateConfig, upsertAnaxGateConfig,
  upsertHypothesisFromArchive, createChangeProposal,
  listSessions, listMessages, getSessionRuntime, createSession, db,
} from "../db.ts";
import {
  archiveSkillRegistryEntry,
  createSkillRegistryEntry,
  getSkillRegistryEntry,
  incrementSkillRegistryUsage,
  recordSkillActivationForRun,
  listSkillRegistryEntries,
  listSkillRegistryEvalHistory,
  updateSkillRegistryEntry,
} from "../db/engine.ts";
import { readTree, readFlowFile, writeFlowFile, copyLocalFolderIntoFlow, copyFlowSnapshot, inferWorkflow, moveAllFiles } from "../flow-fs.ts";
import { normalizeWorkflowModels, normalizeWorkflowSkills, type WorkflowLike } from "../workflow-config.ts";
import { withWorkspacePathStatuses } from "../workspace-path-status.ts";
import { getDownstreamNodeIds } from "../change-management.ts";
import { computeFileHash } from "../file-hash.ts";
import { send, getActiveChatRun, activeFlowRuns, activeMultiAgentRuns, type ActiveMultiAgentRun } from "../runtime.ts";
import { traceFlowEvent } from "../flow-trace.ts";
import { trackUsageEvent } from "../cache.ts";
import { buildMemoryInjectionSnapshot, withRulesPrompt, buildMemoryPrompt } from "../memory-injection.ts";
import { buildRegisteredPathContext } from "../output-paths.ts";
import { standardDirIn } from "../workspace-dirs.ts";
import { readWorkflow, runMultiAgent, topoOrder } from "../multi-agent-runner.ts";
import { runPiPrompt, runPiTurn } from "../pi-adapter.ts";
import { postMemoryCandidateToDIngest, runMemoryConsolidation, type MemoryConsolidationTargetKind } from "../memory-consolidation.ts";
import { validateSkillPaths } from "../skills.ts";
import { flowMessageText } from "../message-text.ts";
import type { ClientMessage, Flow, PiEvent, Session } from "../types.ts";
import { buildAnaxWorkflow, buildAnaxQuickWorkflow } from "../anax-template.ts";
import { buildSqlLoopWorkflow } from "../sql-loop-template.ts";
import { moveManagedDirToTrash } from "../trash.ts";
import { listSkills } from "../skills.ts";
import { buildSkillDistillationPrompt, buildSkillRevisionPrompt, extractSkillMarkdown, parseSkillName, SKILL_DISTILL_SYSTEM_PROMPT, SKILL_REVISE_SYSTEM_PROMPT, slugifySkillName } from "../skill-distillation.ts";
import { parseSkillEvaluationRunRequest } from "../skill-evaluation-api.ts";
import { autoTriggerCuration } from "../skill-curator.ts";
import { retrieveSkills, rankSkillSimilarity } from "../skill-retrieval.ts";
import { analyzeSkillCoverageGaps, type SkillCoverageGapCluster, type SkillCoverageTask } from "../skill-coverage-gap.ts";
import { expandCommand } from "../command-expand.ts";
import { COMMANDS_CONFIG_PATH, FAVORITES_ROOT, PORT, RUN_BUDGET_LIMITS, UPLOAD_TMP_ROOT } from "../config.ts";
import type { SkillRegistryConflict, SkillRegistryConflictsResult, SkillRegistryEntry, SkillSource, SkillStatus, XanCommand, XanCommandParam, XanCommandParamType } from "../types.ts";
import {
  maybeRunSkillVersionRetest,
  parseSkillRegressionThresholds,
  runSkillRegistryRetest,
} from "../skill-regression.ts";

/**
 * 【Agent-E · 智能引擎域】HTTP 路由 slot —— owner: codex(GPT-5.5)
 *
 * 覆盖：Agent 对话 / 工作流 / AnaX / Eval-Harness。
 *   /api/flows* · /api/sessions* · /api/runs* · /api/hypotheses* · /api/change-proposals*
 *   /api/skill-evaluations* · /api/tool-evaluations* · /api/memory-evaluations* · /api/evaluations* …
 *
 * 约定：
 *   - 新路由写在本文件：`engineRouter.post("/api/...", (req, res) => { ... })`
 *   - 复用 runner：`import { runMultiAgent } from "../multi-agent-runner.ts"`
 *   - 复用 gate：`import { evaluateGate } from "../anax-gate.ts"`
 *   - 需访问运行时状态(activeRuns/wss) 的流式 WS handler 暂留 index.ts（T-C2b 迁移）
 *
 * 禁止：触碰 index.ts（legacy 冻结，归总控）/ 他域 router。
 */
export const engineRouter = Router();

const ZHUANTI_ANAX_SOURCE_NAME = "AnaX 专题";

function findZhuantiAnaxFlow(workspaceId: string): ReturnType<typeof getFlow> {
  const row = db.prepare(
    "SELECT id FROM flows WHERE workspace_id = ? AND source_name = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
  ).get(workspaceId, ZHUANTI_ANAX_SOURCE_NAME) as { id: string } | undefined;
  return row ? getFlow(row.id) : undefined;
}

interface ZhuantiTask {
  flow: Flow;
  session: Session;
}

function listZhuantiAnaxFlows(workspaceId: string): Flow[] {
  const rows = db.prepare(
    "SELECT id FROM flows WHERE workspace_id = ? AND source_name = ? ORDER BY updated_at DESC, created_at DESC",
  ).all(workspaceId, ZHUANTI_ANAX_SOURCE_NAME) as Array<{ id: string }>;
  return rows.map((row) => getFlow(row.id)).filter((flow): flow is Flow => Boolean(flow));
}

// 取该 flow 的「主」对话 session：用最早 created_at（专题任务的主 session 在 createZhuantiTask 时随 flow 一并建，
// 是该 flow 的首个 session）。fork 分支会继承父 session 的 workflow_id（index.ts createSession(..., parent.workflowId)）、
// 但创建更晚，故按 created_at ASC 可稳定排除 fork 分支、不会把专题任务误关联到分支对话。
function findSessionByWorkflowId(workspaceId: string, workflowId: string): Session | undefined {
  return db.prepare(
    "SELECT id, workspace_id AS workspaceId, title, workflow_id AS workflowId, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE workspace_id = ? AND workflow_id = ? ORDER BY created_at ASC LIMIT 1",
  ).get(workspaceId, workflowId) as Session | undefined;
}

function createZhuantiTask(workspaceId: string, name?: string, sessionTitle?: string): ZhuantiTask {
  const taskName = String(name ?? "专题分析").trim() || "专题分析";
  const flow = createFlow(workspaceId, taskName, ZHUANTI_ANAX_SOURCE_NAME, "multi", null, "ready");
  writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(buildAnaxWorkflow(), null, 2));
  const title = String(sessionTitle ?? `${taskName} · 对话探索`).trim() || `${taskName} · 对话探索`;
  const session = createSession(workspaceId, title, flow.id);
  return { flow, session };
}

function listZhuantiTasks(workspaceId: string): ZhuantiTask[] {
  return listZhuantiAnaxFlows(workspaceId).map((flow) => ({
    flow,
    session: findSessionByWorkflowId(workspaceId, flow.id) ?? createSession(workspaceId, `${flow.name} · 对话探索`, flow.id),
  }));
}

function ensureLatestZhuantiTask(workspaceId: string, name?: string, sessionTitle?: string): ZhuantiTask {
  const flow = findZhuantiAnaxFlow(workspaceId);
  if (!flow) return createZhuantiTask(workspaceId, name, sessionTitle);
  return {
    flow,
    session: findSessionByWorkflowId(workspaceId, flow.id) ?? createSession(workspaceId, `${flow.name} · 对话探索`, flow.id),
  };
}

function memoryConsolidationAutoEnabled(): boolean {
  return process.env.XANTHIL_MEMORY_CONSOLIDATION_AUTO === "1";
}

function maybeTriggerFlowMemoryConsolidation(input: {
  workspace: { id: string; rootPath: string };
  flow: Flow;
  targetKind: Extract<MemoryConsolidationTargetKind, "flow" | "flow_run">;
  targetId: string;
  traceRunId?: string;
}): void {
  if (!memoryConsolidationAutoEnabled()) return;
  const baseUrl = `http://127.0.0.1:${PORT}`;
  void runMemoryConsolidation({
    workspaceId: input.workspace.id,
    workspaceRoot: input.workspace.rootPath,
    targetKind: input.targetKind,
    targetId: input.targetId,
    dryRun: false,
    timeoutMs: 180_000,
    // 总控协调（D-INGEST 落地后）：默认走门禁端点 /memory/ingest（风险/dedup/置信度→自动入库 or review），不再直写 /memory/items。
    ingestCandidate: (candidate, context) => postMemoryCandidateToDIngest(baseUrl, "/api/workspaces/:id/memory/ingest", candidate, context),
    onEvent: (event) => trackUsageEvent({
      workspaceId: input.workspace.id,
      targetKind: input.targetKind,
      targetId: input.targetId,
      title: `自动记忆沉淀：${input.flow.name}`,
    }, event),
  }).catch((err) => {
    traceFlowEvent(input.flow.id, "memory_consolidation_failed", "failed", String(err), {
      targetKind: input.targetKind,
      targetId: input.targetId,
    }, input.traceRunId);
  });
}

// ---- flow CRUD / 文件 / run 只读路由（T-C2a 从 index.ts 迁入，只搬不改）----

engineRouter.get("/api/flows/:id/messages", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  res.json(listFlowMessages(req.params.id));
});

engineRouter.get("/api/flows/:id/chat-runtime", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  const active = getActiveChatRun(activeFlowRuns, req.params.id);
  res.json(active ? { running: true, startedAt: active.startedAt } : { running: false, startedAt: null });
});

engineRouter.get("/api/flows/:id/tree", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    res.json(readTree(flow.folderPath));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

engineRouter.get("/api/flows/:id/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    res.json(readFlowFile(flow.folderPath, path));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.put("/api/flows/:id/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const path = String(req.body?.path ?? "");
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!path || content === null) return res.status(400).json({ error: "path & content required" });
  try {
    writeFlowFile(flow.folderPath, path, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/flows/:id/import-local", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const sourcePath = String(req.body?.path ?? "").trim();
  if (!sourcePath) return res.status(400).json({ error: "path required" });
  try {
    const result = copyLocalFolderIntoFlow(sourcePath, flow.folderPath);
    updateFlowSourceName(flow.id, result.sourceName);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// Read workflow.json — auto-infer from directory structure if not present
engineRouter.get("/api/flows/:id/workflow", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    const content = readFlowFile(flow.folderPath, "workflow.json").content;
    if (content === null) {
      res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
    } else {
      res.json({ workflow: normalizeWorkflowSkills(flow.folderPath, normalizeWorkflowModels(JSON.parse(content) as WorkflowLike)), inferred: false });
    }
  } catch {
    res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
  }
});

// Write workflow.json
engineRouter.put("/api/flows/:id/workflow", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    const workflow = normalizeWorkflowSkills(flow.folderPath, normalizeWorkflowModels(req.body as WorkflowLike));
    writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(workflow, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.get("/api/flows/:id/runs", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(listFlowRuns(flow.id));
});

engineRouter.get("/api/flows/:id/runs/:runId/tree", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const run = getFlowRun(req.params.runId);
  if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
  try {
    res.json(readTree(run.outputDir));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

engineRouter.get("/api/flows/:id/runs/:runId/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const run = getFlowRun(req.params.runId);
  if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try {
    res.json(readFlowFile(run.outputDir, path));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.put("/api/flows/:id/runs/:runId/file", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const run = getFlowRun(req.params.runId);
  if (!run || run.flowId !== flow.id) return res.status(404).json({ error: "run not found" });
  const path = String(req.body?.path ?? "");
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!path || content === null) return res.status(400).json({ error: "path & content required" });
  try {
    writeFlowFile(run.outputDir, path, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// ---- flow CRUD / list / create / 删除 / AnaX 实例化（T-C2a 第二批，只搬不改）----

engineRouter.get("/api/workspaces/:id/flows", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listFlows(req.params.id));
});
engineRouter.get("/api/flows/:id", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(flow);
});
engineRouter.post("/api/workspaces/:id/flows", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "新工作流").trim() || "新工作流";
  const kind = req.body?.kind === "multi" ? "multi" : "single";
  res.json(createFlow(req.params.id, name, null, kind));
});
// Materialise the built-in AnaX商业分析 methodology as a runnable multi-agent flow.
engineRouter.post("/api/workspaces/:id/anax/instantiate", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "AnaX 商业分析").trim() || "AnaX 商业分析";
  const flow = createFlow(req.params.id, name, "AnaX v3.0", "multi", null, "ready");
  writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(buildAnaxWorkflow(), null, 2));
  res.json(flow);
});
engineRouter.post("/api/workspaces/:id/anax/instantiate-quick", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "AnaX 快速分析").trim() || "AnaX 快速分析";
  const flow = createFlow(req.params.id, name, "AnaX v3.0 Quick", "multi", null, "ready");
  writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(buildAnaxQuickWorkflow(), null, 2));
  res.json(flow);
});
engineRouter.get("/api/workspaces/:id/zhuanti/tasks", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listZhuantiTasks(req.params.id));
});
engineRouter.post("/api/workspaces/:id/zhuanti/tasks", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = typeof req.body?.name === "string" ? req.body.name : undefined;
  res.json(createZhuantiTask(req.params.id, name));
});
engineRouter.post("/api/workspaces/:id/zhuanti/anax-chat", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const flowName = String(req.body?.flowName ?? "专题分析").trim() || "专题分析";
  const sessionTitle = String(req.body?.sessionTitle ?? "专题对话探索").trim() || "专题对话探索";
  res.json(ensureLatestZhuantiTask(req.params.id, flowName, sessionTitle));
});
engineRouter.post("/api/workspaces/:id/sql-loop/instantiate", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "SQL Loop").trim() || "SQL Loop";
  const flow = createFlow(req.params.id, name, "SQL Loop v1", "multi", null, "ready");
  writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(buildSqlLoopWorkflow(), null, 2));
  res.json(flow);
});
engineRouter.patch("/api/flows/:id", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameFlow(req.params.id, name);
  res.json({ ok: true });
});
engineRouter.delete("/api/flows/:id", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  if (req.query.deleteFiles === "true") {
    try { moveManagedDirToTrash(flow.folderPath); }
    catch (err) { return res.status(500).json({ error: String(err) }); }
  }
  deleteFlow(req.params.id);
  res.json({ ok: true });
});

// ---- workflow favorites ----
function assertFavoriteSnapshotPath(snapshotPath: string): string {
  const root = resolve(FAVORITES_ROOT);
  const absolutePath = resolve(snapshotPath);
  if (!absolutePath.startsWith(`${root}${sep}`)) throw new Error("invalid favorite snapshot path");
  return absolutePath;
}

function replaceFavoriteSnapshot(sourcePath: string, snapshotPath: string): void {
  const target = assertFavoriteSnapshotPath(snapshotPath);
  rmSync(target, { recursive: true, force: true });
  copyFlowSnapshot(sourcePath, target);
}

engineRouter.get("/api/workflow-favorites", (_req, res) => {
  res.json(listWorkflowFavorites());
});

engineRouter.post("/api/flows/:id/favorite", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const workspace = getWorkspace(flow.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const existing = getWorkflowFavoriteBySourceFlowId(flow.id);
  try {
    if (existing) {
      replaceFavoriteSnapshot(flow.folderPath, existing.snapshotPath);
      updateWorkflowFavorite(existing.id, flow, workspace);
      return res.json(getWorkflowFavorite(existing.id));
    }
    const snapshotPath = join(FAVORITES_ROOT, randomUUID());
    replaceFavoriteSnapshot(flow.folderPath, snapshotPath);
    try {
      return res.json(createWorkflowFavorite(flow, workspace, snapshotPath));
    } catch (err) {
      rmSync(snapshotPath, { recursive: true, force: true });
      throw err;
    }
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.delete("/api/workflow-favorites/:id", (req, res) => {
  const favorite = getWorkflowFavorite(req.params.id);
  if (!favorite) return res.status(404).json({ error: "favorite not found" });
  try {
    rmSync(assertFavoriteSnapshotPath(favorite.snapshotPath), { recursive: true, force: true });
    removeWorkflowFavorite(favorite.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/workflow-favorites/:id/reuse", (req, res) => {
  const favorite = getWorkflowFavorite(req.params.id);
  if (!favorite) return res.status(404).json({ error: "favorite not found" });
  const workspaceId = String(req.body?.workspaceId ?? "").trim();
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? `${favorite.name} 副本`).trim() || `${favorite.name} 副本`;
  let flow;
  try {
    const snapshotPath = assertFavoriteSnapshotPath(favorite.snapshotPath);
    if (!statSync(snapshotPath).isDirectory()) throw new Error("favorite snapshot is not a directory");
    flow = createFlow(workspaceId, name, favorite.name, favorite.kind);
    copyFlowSnapshot(snapshotPath, flow.folderPath);
    res.json(flow);
  } catch (err) {
    if (flow) {
      deleteFlow(flow.id);
      rmSync(flow.folderPath, { recursive: true, force: true });
    }
    res.status(400).json({ error: String(err) });
  }
});

// ---- flow skills ----
engineRouter.get("/api/flows/:id/skills", (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(listSkills(flow.folderPath));
});

const COMMAND_KEYS = new Set(["id", "name", "enabled", "description", "argumentHint", "template", "params", "skillSlugs", "source"]);
const COMMAND_PARAM_KEYS = new Set(["key", "label", "required", "type", "options", "source"]);
const COMMAND_PARAM_TYPES = new Set<XanCommandParamType>(["text", "select", "file"]);
const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function coerceCommand(input: unknown): XanCommand | null {
  const o = toRecord(input);
  if (!onlyKnownKeys(o, COMMAND_KEYS)) return null;

  const id = asCommandString(o.id);
  const name = asCommandString(o.name);
  const template = asPromptTemplate(o.template);
  if (!id || !name || !SAFE_COMMAND_NAME.test(name) || !template) return null;
  if (o.source !== "custom") return null;

  let params: XanCommandParam[] | undefined;
  if (o.params !== undefined) {
    if (!Array.isArray(o.params)) return null;
    params = [];
    const seen = new Set<string>();
    for (const rawParam of o.params) {
      const param = coerceCommandParam(rawParam);
      if (!param || seen.has(param.key)) return null;
      seen.add(param.key);
      params.push(param);
    }
  }

  let skillSlugs: string[] | undefined;
  if (o.skillSlugs !== undefined) {
    if (!Array.isArray(o.skillSlugs)) return null;
    skillSlugs = [];
    for (const rawSlug of o.skillSlugs) {
      const slug = asCommandString(rawSlug);
      if (!slug || !SAFE_COMMAND_NAME.test(slug)) return null;
      if (!skillSlugs.includes(slug)) skillSlugs.push(slug);
    }
  }

  const description = asOptionalString(o.description);
  const argumentHint = asOptionalString(o.argumentHint);
  return {
    id,
    name,
    enabled: o.enabled !== false,
    ...(description ? { description } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    template,
    ...(params && params.length > 0 ? { params } : {}),
    ...(skillSlugs && skillSlugs.length > 0 ? { skillSlugs } : {}),
    source: "custom",
  };
}

function coerceCommandParam(input: unknown): XanCommandParam | null {
  const o = toRecord(input);
  if (!onlyKnownKeys(o, COMMAND_PARAM_KEYS)) return null;
  const key = asCommandString(o.key);
  const label = asOptionalString(o.label);
  if (!key || !SAFE_COMMAND_NAME.test(key) || !label) return null;

  const type = o.type === undefined ? undefined : o.type;
  if (type !== undefined && (!isString(type) || !COMMAND_PARAM_TYPES.has(type as XanCommandParamType))) return null;

  let options: string[] | undefined;
  if (o.options !== undefined) {
    if (!Array.isArray(o.options)) return null;
    options = o.options.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (type === "select" && (!options || options.length === 0)) return null;

  const source = o.source === undefined ? undefined : o.source;
  if (source !== undefined && source !== "clean_data") return null;

  return {
    key,
    label,
    ...(o.required === true ? { required: true } : {}),
    ...(type ? { type: type as XanCommandParamType } : {}),
    ...(options && options.length > 0 ? { options } : {}),
    ...(source ? { source } : {}),
  };
}

export function readCommandsFile(): XanCommand[] {
  if (!existsSync(COMMANDS_CONFIG_PATH)) return [];
  try {
    const raw = readFileSync(COMMANDS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { commands?: unknown })?.commands)
        ? (parsed as { commands: unknown[] }).commands
        : [];
    return arr.map((it) => coerceCommand(it)).filter((cmd): cmd is XanCommand => cmd !== null);
  } catch {
    return [];
  }
}

function writeCommandsFile(commands: XanCommand[]): void {
  mkdirSync(dirname(COMMANDS_CONFIG_PATH), { recursive: true });
  writeFileSync(COMMANDS_CONFIG_PATH, JSON.stringify(commands, null, 2), "utf8");
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function onlyKnownKeys(record: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(record).every((key) => keys.has(key));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asCommandString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPromptTemplate(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLocalRequest(req: express.Request): boolean {
  const addresses = [req.ip, req.socket.remoteAddress].filter((value): value is string => typeof value === "string");
  return addresses.some((address) => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1");
}

engineRouter.get("/api/commands", (_req, res) => {
  try {
    res.json(readCommandsFile());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 本地单用户工具端点；服务当前仅监听 localhost，若未来开放网络绑定必须先加 auth。
engineRouter.put("/api/commands", (req, res) => {
  try {
    if (!isLocalRequest(req)) return res.status(403).json({ error: "localhost required" });
    const body = req.body as unknown;
    const list: unknown[] = Array.isArray(body)
      ? body
      : Array.isArray((body as { commands?: unknown })?.commands)
        ? (body as { commands: unknown[] }).commands
        : [];
    const cleaned: XanCommand[] = [];
    const seen = new Set<string>();
    for (const it of list) {
      const command = coerceCommand(it);
      if (!command) continue;
      if (seen.has(command.id) || seen.has(command.name)) continue;
      seen.add(command.id);
      seen.add(command.name);
      cleaned.push(command);
    }
    writeCommandsFile(cleaned);
    res.json(cleaned);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- skill registry ----
engineRouter.get("/api/workspaces/:id/skill-registry", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const status = parseSkillStatus(req.query.status);
  if (req.query.status !== undefined && !status) return res.status(400).json({ error: "invalid status" });
  res.json(listSkillRegistryEntries(req.params.id, status));
});

engineRouter.get("/api/workspaces/:id/skill-registry/conflicts", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const result = detectSkillRegistryConflicts({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      slug: typeof req.query.slug === "string" ? req.query.slug : undefined,
      content: typeof req.query.content === "string" ? req.query.content : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/workspaces/:id/skill-auto-distill", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillAutoDistillBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const sessions = collectAutoDistillSessions(workspace.id, parsed.value.since, parsed.value.limit);
  const results: SkillAutoDistillSessionResult[] = [];
  for (const session of sessions) {
    const transcript = buildAutoDistillTranscript(session.id);
    if (!transcript.trim()) {
      results.push({ sessionId: session.id, title: session.title, status: "skipped", reason: "empty_transcript" });
      continue;
    }
    const result = await distillSkillCandidate({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      transcript,
      model: parsed.value.model,
      timeoutMs: parsed.value.timeoutMs,
      duplicateThreshold: parsed.value.duplicateThreshold,
      dryRun: parsed.value.dryRun,
      originSessionId: session.id,
      usageTargetId: session.id,
      usageTitle: `自动沉淀 Skill：${session.title}`,
    });
    results.push({ sessionId: session.id, title: session.title, ...result });
  }

  res.json({
    workspaceId: workspace.id,
    since: parsed.value.since,
    limit: parsed.value.limit,
    model: parsed.value.model ?? "",
    dryRun: parsed.value.dryRun,
    scanned: sessions.length,
    created: results.filter((item) => item.status === "created").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  });
});

engineRouter.post("/api/workspaces/:id/skill-coverage-gaps", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillCoverageGapBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tasks = collectSkillCoverageTasks(workspace.id, parsed.value.since, parsed.value.limit);
  const clusters = analyzeSkillCoverageGaps({
    tasks,
    retrieve: (query, topK) => retrieveSkills(query, workspace.rootPath, topK),
    topK: parsed.value.topK,
    lowScoreThreshold: parsed.value.lowScoreThreshold,
    minClusterSize: parsed.value.minClusterSize,
    clusterSimilarityThreshold: parsed.value.clusterSimilarityThreshold,
    maxClusters: parsed.value.maxClusters,
  });
  res.json({
    workspaceId: workspace.id,
    since: parsed.value.since,
    limit: parsed.value.limit,
    scanned: tasks.length,
    lowScoreThreshold: parsed.value.lowScoreThreshold,
    minClusterSize: parsed.value.minClusterSize,
    clusters,
  });
});

engineRouter.post("/api/workspaces/:id/skill-coverage-gaps/distill", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillCoverageGapDistillBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const result = await distillSkillCandidate({
    workspaceId: workspace.id,
    workspaceRoot: workspace.rootPath,
    transcript: buildCoverageGapDistillTranscript(parsed.value.cluster),
    model: parsed.value.model,
    timeoutMs: parsed.value.timeoutMs,
    duplicateThreshold: parsed.value.duplicateThreshold,
    dryRun: parsed.value.dryRun,
    originSessionId: parsed.value.cluster.tasks[0]?.sessionId ?? null,
    usageTargetId: parsed.value.cluster.id,
    usageTitle: `覆盖缺口蒸馏：${parsed.value.cluster.title}`,
  });
  res.json({ workspaceId: workspace.id, clusterId: parsed.value.cluster.id, dryRun: parsed.value.dryRun, result });
});

engineRouter.post("/api/workspaces/:id/memory/consolidate", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseMemoryConsolidationBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const baseUrl = requestBaseUrl(req);
  try {
    const result = await runMemoryConsolidation({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      targetKind: parsed.value.targetKind,
      targetId: parsed.value.targetId,
      model: parsed.value.model,
      dryRun: parsed.value.dryRun,
      timeoutMs: parsed.value.timeoutMs,
      maxCandidates: parsed.value.maxCandidates,
      onEvent: (event) => trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: parsed.value.targetKind,
        targetId: parsed.value.targetId,
        title: `记忆沉淀：${parsed.value.targetKind}`,
      }, event),
      ingestCandidate: (candidate, context) => postMemoryCandidateToDIngest(baseUrl, parsed.value.ingestPath, candidate, context),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// 方式2：AI 改写——基于用户「修改说明」对给定 SKILL.md 内容做最小修改，返回改写结果供预览，
// 不写盘/不建版本（保存仍走既有「保存为新版本」）。operate on 请求体提供的 content（即编辑框当前文本），
// 既可改原文也可改用户未保存的草稿。
engineRouter.post("/api/workspaces/:id/skill-revise", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
  const model = String(req.body?.model ?? "").trim() || undefined;
  if (!content.trim()) return res.status(400).json({ error: "content is required" });
  if (!instruction) return res.status(400).json({ error: "instruction is required" });
  try {
    const raw = await runPiPrompt({
      workspaceRoot: workspace.rootPath,
      text: buildSkillRevisionPrompt(content, instruction),
      model,
      systemPrompt: SKILL_REVISE_SYSTEM_PROMPT,
      timeoutMs: 180_000,
      onEvent: (event) => trackUsageEvent({ workspaceId: workspace.id, targetKind: "skill", targetId: workspace.id, title: "Skill AI 改写" }, event),
    });
    res.json({ content: extractSkillMarkdown(raw) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

engineRouter.post("/api/workspaces/:id/skill-registry", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillRegistryCreateBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const skillPath = registrySkillPath(workspace.rootPath, parsed.value.slug);
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, parsed.value.content, "utf8");
    const entry = createSkillRegistryEntry(workspace.id, {
      slug: parsed.value.slug,
      name: parsed.value.name,
      status: parsed.value.status,
      source: parsed.value.source,
      version: parsed.value.version,
      supersedesId: parsed.value.supersedesId,
      originSessionId: parsed.value.originSessionId,
    });
    // P1-a：为该版本留内容快照，使回滚真可用。
    writeVersionSnapshot(workspace.rootPath, entry.slug, entry.version, parsed.value.content);
    let retest: Awaited<ReturnType<typeof maybeRunSkillVersionRetest>> | null = null;
    let retestError: string | null = null;
    if (entry.status === "active" && entry.supersedesId) {
      try {
        retest = await maybeRunSkillVersionRetest({
          workspaceRoot: workspace.rootPath,
          entry,
          thresholds: parseSkillRegressionThresholds(req.body),
        });
      } catch (err) {
        retestError = String(err);
      }
    }
    res.json({ entry: retest?.entry ?? entry, skillPath, retest, retestError });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/skill-registry/:id/export", (req, res) => {
  const entry = getSkillRegistryEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: "skill not found" });
  if (entry.status === "archived") return res.status(400).json({ error: "archived skill cannot be exported" });
  const workspace = getWorkspace(entry.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    res.json(buildSkillPackage(workspace.rootPath, entry));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/workspaces/:id/skill-registry/import", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillPackage(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const requestedSlug = parsed.value.registry.slug;
    const slug = uniqueImportedSkillSlug(workspace.id, workspace.rootPath, requestedSlug);
    const skillRoot = registrySkillRoot(workspace.rootPath, slug);
    const writtenFiles: string[] = [];
    for (const file of parsed.value.files) {
      const targetPath = resolveSkillPackageFilePath(skillRoot, file.path);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, file.content, "utf8");
      writtenFiles.push(targetPath);
    }
    const content = readFileSync(resolveSkillPackageFilePath(skillRoot, "SKILL.md"), "utf8");
    const entry = createSkillRegistryEntry(workspace.id, {
      slug,
      name: parsed.value.registry.name,
      status: "candidate",
      source: "imported",
    });
    writeVersionSnapshot(workspace.rootPath, entry.slug, entry.version, content);
    res.json({ entry, skillPath: registrySkillPath(workspace.rootPath, entry.slug), requestedSlug, writtenFiles });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.patch("/api/skill-registry/:id", (req, res) => {
  const existing = getSkillRegistryEntry(req.params.id);
  if (!existing) return res.status(404).json({ error: "skill not found" });
  const parsed = parseSkillRegistryPatchBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (
    parsed.value.status === "active"
    && (existing.source === "distilled" || existing.source === "curated")
    && !hasConfirmedReview(req.body)
  ) {
    return res.status(400).json({ error: "confirmed=true required to activate distilled/curated skill" });
  }
  try {
    const entry = updateSkillRegistryEntry({ id: req.params.id, ...parsed.value });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.delete("/api/skill-registry/:id", (req, res) => {
  const entry = archiveSkillRegistryEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: "skill not found" });
  res.json(entry);
});

// P1-a：读某版本的内容快照（供 D 回滚前预览/查看历史版本）。
engineRouter.get("/api/skill-registry/:id/content", (req, res) => {
  const entry = getSkillRegistryEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: "skill not found" });
  const workspace = getWorkspace(entry.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const content = readVersionSnapshot(workspace.rootPath, entry.slug, entry.version);
  if (content === null) return res.status(404).json({ error: "该版本无内容快照（P1-a 前创建）" });
  res.json({ version: entry.version, content });
});

// P1-a：回滚到某历史版本——以该版本快照内容创建新版本并写回 SKILL.md（不删旧行/旧快照）。
engineRouter.post("/api/skill-registry/:id/rollback", async (req, res) => {
  const target = getSkillRegistryEntry(req.params.id);
  if (!target) return res.status(404).json({ error: "skill not found" });
  const workspace = getWorkspace(target.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const content = readVersionSnapshot(workspace.rootPath, target.slug, target.version);
  if (content === null) return res.status(400).json({ error: "该版本无内容快照，无法回滚（P1-a 前创建）" });
  try {
    const skillPath = registrySkillPath(workspace.rootPath, target.slug);
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, content, "utf8");
    const entry = createSkillRegistryEntry(workspace.id, {
      slug: target.slug,
      name: target.name,
      status: "active",
      source: target.source,
      supersedesId: target.id, // 版本链：新版本由被回滚版本派生
      originSessionId: target.originSessionId,
    });
    writeVersionSnapshot(workspace.rootPath, entry.slug, entry.version, content);
    let retest: Awaited<ReturnType<typeof maybeRunSkillVersionRetest>> | null = null;
    let retestError: string | null = null;
    try {
      retest = await maybeRunSkillVersionRetest({
        workspaceRoot: workspace.rootPath,
        entry,
        thresholds: parseSkillRegressionThresholds(req.body),
      });
    } catch (err) {
      retestError = String(err);
    }
    res.json({ entry: retest?.entry ?? entry, retest, retestError });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/skill-registry/:id/evaluate", async (req, res) => {
  const entry = getSkillRegistryEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: "skill not found" });
  if (entry.status === "archived") return res.status(400).json({ error: "archived skill cannot be evaluated" });
  const workspace = getWorkspace(entry.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillEvaluationRunRequest({
    ...((typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>),
    variants: [{ id: "registry", label: "Registry", skillPaths: [] }],
  });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const result = await runSkillRegistryRetest({
      workspaceRoot: workspace.rootPath,
      entry,
      model: parsed.value.model,
      tasks: parsed.value.tasks,
      repeat: parsed.value.repeat,
      judgeRepeat: parsed.value.judgeRepeat,
      contextPrefix: parsed.value.contextPrefix,
      dataContextPaths: parsed.value.dataContextPaths,
      triggerKind: "manual_evaluate",
      thresholds: parseSkillRegressionThresholds(req.body),
    });
    res.json(result);
    autoTriggerCuration({ workspaceRoot: workspace.rootPath, workspaceId: workspace.id, model: parsed.value.model, evaluation: result.evaluation });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/workspaces/:id/skill-registry/retest-active", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillEvaluationRunRequest({
    ...((typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>),
    variants: [{ id: "registry", label: "Registry", skillPaths: [] }],
  });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const triggerKind = typeof req.body === "object"
    && req.body !== null
    && (req.body as { triggerKind?: unknown }).triggerKind === "model_upgrade"
    ? "model_upgrade"
    : "retest_all_active";
  const thresholds = parseSkillRegressionThresholds(req.body);
  const results: Array<{ skillId: string; slug: string; status: "success"; result: Awaited<ReturnType<typeof runSkillRegistryRetest>> } | { skillId: string; slug: string; status: "failed"; error: string }> = [];
  for (const entry of listSkillRegistryEntries(workspace.id, "active")) {
    try {
      const result = await runSkillRegistryRetest({
        workspaceRoot: workspace.rootPath,
        entry,
        model: parsed.value.model,
        tasks: parsed.value.tasks,
        repeat: parsed.value.repeat,
        judgeRepeat: parsed.value.judgeRepeat,
        contextPrefix: parsed.value.contextPrefix,
        dataContextPaths: parsed.value.dataContextPaths,
        triggerKind,
        thresholds,
      });
      results.push({ skillId: entry.id, slug: entry.slug, status: "success", result });
    } catch (err) {
      results.push({ skillId: entry.id, slug: entry.slug, status: "failed", error: String(err) });
    }
  }
  res.json({
    workspaceId: workspace.id,
    triggerKind,
    scanned: results.length,
    succeeded: results.filter((item) => item.status === "success").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  });
});

// G 卡：回归/漂移历史时间线只读查询。消费 skill_registry_eval_history 真源；
// 不重算回归、不触发评测、不暴露原始评测明细，仅返回时间序列点。
engineRouter.get("/api/workspaces/:id/skill-registry/eval-history", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const slug = typeof req.query.slug === "string" && req.query.slug.trim() ? req.query.slug.trim() : undefined;
  const registryId = typeof req.query.registryId === "string" && req.query.registryId.trim() ? req.query.registryId.trim() : undefined;
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) && (limitRaw as number) > 0 ? (limitRaw as number) : undefined;
  const items = listSkillRegistryEvalHistory({ workspaceId: workspace.id, slug, registryId, limit });
  res.json({ workspaceId: workspace.id, items });
});

type ParsedSkillAutoDistill =
  | {
    ok: true;
    value: {
      since: number;
      limit: number;
      model?: string;
      dryRun: boolean;
      timeoutMs: number;
      duplicateThreshold: number;
    };
  }
  | { ok: false; error: string };

type SkillAutoDistillSessionResult =
  | { sessionId: string; title: string; status: "created"; slug: string; name: string; entry: SkillRegistryEntry; skillPath: string }
  | { sessionId: string; title: string; status: "dry_run"; slug: string; name: string }
  | { sessionId: string; title: string; status: "skipped"; reason: string; slug?: string; name?: string; similarSkill?: SkillRegistryConflict }
  | { sessionId: string; title: string; status: "failed"; error: string };

type DistillCandidateResult =
  | { status: "created"; slug: string; name: string; entry: SkillRegistryEntry; skillPath: string }
  | { status: "dry_run"; slug: string; name: string }
  | { status: "skipped"; reason: string; slug?: string; name?: string; similarSkill?: SkillRegistryConflict }
  | { status: "failed"; error: string };

type ParsedSkillCoverageGaps =
  | {
    ok: true;
    value: {
      since: number;
      limit: number;
      topK: number;
      lowScoreThreshold: number;
      minClusterSize: number;
      clusterSimilarityThreshold: number;
      maxClusters: number;
    };
  }
  | { ok: false; error: string };

type ParsedSkillCoverageGapDistill =
  | {
    ok: true;
    value: {
      cluster: SkillCoverageGapCluster;
      model?: string;
      dryRun: boolean;
      timeoutMs: number;
      duplicateThreshold: number;
    };
  }
  | { ok: false; error: string };

type ParsedMemoryConsolidation =
  | {
    ok: true;
    value: {
      targetKind: MemoryConsolidationTargetKind;
      targetId: string;
      model?: string;
      dryRun: boolean;
      timeoutMs: number;
      maxCandidates: number;
      ingestPath: string;
    };
  }
  | { ok: false; error: string };

function parseSkillAutoDistillBody(body: unknown): ParsedSkillAutoDistill {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const now = Date.now();
  const defaultSince = now - 7 * 24 * 60 * 60 * 1000;
  const sinceValue = raw.since === undefined || raw.since === null || raw.since === ""
    ? defaultSince
    : typeof raw.since === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.since)
      ? Date.parse(raw.since)
      : Number(raw.since);
  if (!Number.isFinite(sinceValue) || sinceValue < 0) return { ok: false, error: "since must be a timestamp or date string" };
  const limit = raw.limit === undefined ? 5 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return { ok: false, error: "limit must be an integer between 1 and 20" };
  const timeoutMs = raw.timeoutMs === undefined ? 180_000 : Number(raw.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    return { ok: false, error: "timeoutMs must be an integer between 10000 and 600000" };
  }
  const duplicateThreshold = raw.duplicateThreshold === undefined ? 50 : Number(raw.duplicateThreshold);
  if (!Number.isFinite(duplicateThreshold) || duplicateThreshold <= 0) return { ok: false, error: "duplicateThreshold must be positive" };
  const model = String(raw.model ?? "").trim() || undefined;
  return { ok: true, value: { since: sinceValue, limit, model, dryRun: raw.dryRun === true, timeoutMs, duplicateThreshold } };
}

function parseSkillCoverageGapBody(body: unknown): ParsedSkillCoverageGaps {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const now = Date.now();
  const defaultSince = now - 14 * 24 * 60 * 60 * 1000;
  const sinceValue = parseSince(raw.since, defaultSince);
  if (!Number.isFinite(sinceValue) || sinceValue < 0) return { ok: false, error: "since must be a timestamp or date string" };
  const limit = raw.limit === undefined ? 20 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { ok: false, error: "limit must be an integer between 1 and 100" };
  const topK = raw.topK === undefined ? 3 : Number(raw.topK);
  if (!Number.isInteger(topK) || topK < 1 || topK > 10) return { ok: false, error: "topK must be an integer between 1 and 10" };
  const lowScoreThreshold = raw.lowScoreThreshold === undefined ? 1.0 : Number(raw.lowScoreThreshold);
  if (!Number.isFinite(lowScoreThreshold) || lowScoreThreshold < 0) return { ok: false, error: "lowScoreThreshold must be non-negative" };
  const minClusterSize = raw.minClusterSize === undefined ? 2 : Number(raw.minClusterSize);
  if (!Number.isInteger(minClusterSize) || minClusterSize < 1 || minClusterSize > 10) return { ok: false, error: "minClusterSize must be an integer between 1 and 10" };
  const clusterSimilarityThreshold = raw.clusterSimilarityThreshold === undefined ? 0.25 : Number(raw.clusterSimilarityThreshold);
  if (!Number.isFinite(clusterSimilarityThreshold) || clusterSimilarityThreshold < 0 || clusterSimilarityThreshold > 1) {
    return { ok: false, error: "clusterSimilarityThreshold must be between 0 and 1" };
  }
  const maxClusters = raw.maxClusters === undefined ? 10 : Number(raw.maxClusters);
  if (!Number.isInteger(maxClusters) || maxClusters < 1 || maxClusters > 50) return { ok: false, error: "maxClusters must be an integer between 1 and 50" };
  return { ok: true, value: { since: sinceValue, limit, topK, lowScoreThreshold, minClusterSize, clusterSimilarityThreshold, maxClusters } };
}

function parseSkillCoverageGapDistillBody(body: unknown): ParsedSkillCoverageGapDistill {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const cluster = parseSkillCoverageGapCluster(raw.cluster);
  if (!cluster) return { ok: false, error: "cluster is required" };
  const timeoutMs = raw.timeoutMs === undefined ? 180_000 : Number(raw.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    return { ok: false, error: "timeoutMs must be an integer between 10000 and 600000" };
  }
  const duplicateThreshold = raw.duplicateThreshold === undefined ? 50 : Number(raw.duplicateThreshold);
  if (!Number.isFinite(duplicateThreshold) || duplicateThreshold <= 0) return { ok: false, error: "duplicateThreshold must be positive" };
  const model = String(raw.model ?? "").trim() || undefined;
  return { ok: true, value: { cluster, model, dryRun: raw.dryRun === true, timeoutMs, duplicateThreshold } };
}

function parseMemoryConsolidationBody(body: unknown): ParsedMemoryConsolidation {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const targetKind = raw.targetKind;
  if (targetKind !== "session" && targetKind !== "flow" && targetKind !== "flow_run") {
    return { ok: false, error: "targetKind must be session | flow | flow_run" };
  }
  const targetId = String(raw.targetId ?? "").trim();
  if (!targetId) return { ok: false, error: "targetId is required" };
  const timeoutMs = raw.timeoutMs === undefined ? 180_000 : Number(raw.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    return { ok: false, error: "timeoutMs must be an integer between 10000 and 600000" };
  }
  const maxCandidates = raw.maxCandidates === undefined ? 6 : Number(raw.maxCandidates);
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 12) {
    return { ok: false, error: "maxCandidates must be an integer between 1 and 12" };
  }
  const ingestPath = String(raw.ingestPath ?? "").trim() || "/api/workspaces/:id/memory/ingest";
  if (!ingestPath.startsWith("/") || ingestPath.startsWith("//")) {
    return { ok: false, error: "ingestPath must be a local absolute API path" };
  }
  const model = String(raw.model ?? "").trim() || undefined;
  return {
    ok: true,
    value: {
      targetKind,
      targetId,
      model,
      dryRun: raw.dryRun === true,
      timeoutMs,
      maxCandidates,
      ingestPath,
    },
  };
}

function requestBaseUrl(req: Request): string {
  const host = req.get("host") || `127.0.0.1:${PORT}`;
  return `${req.protocol || "http"}://${host}`;
}

function parseSince(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value) : Number(value);
}

function collectAutoDistillSessions(workspaceId: string, since: number, limit: number): Session[] {
  const selected: Session[] = [];
  for (const session of listSessions(workspaceId)) {
    if (session.updatedAt < since) continue;
    const runtime = getSessionRuntime(session.id);
    if (runtime.status === "running" || runtime.status === "compacting" || runtime.status === "error") continue;
    const hasCompletedAssistantResponse = listMessages(session.id)
      .some((message) => message.role === "assistant" && extractStoredMessageText(message.content));
    if (!hasCompletedAssistantResponse) continue;
    selected.push(session);
    if (selected.length >= limit) break;
  }
  return selected;
}

function collectSkillCoverageTasks(workspaceId: string, since: number, limit: number): SkillCoverageTask[] {
  const tasks: SkillCoverageTask[] = [];
  for (const session of listSessions(workspaceId)) {
    if (session.updatedAt < since) continue;
    const runtime = getSessionRuntime(session.id);
    if (runtime.status === "running" || runtime.status === "compacting" || runtime.status === "error") continue;
    const userTexts = listMessages(session.id)
      .filter((message) => message.role === "user")
      .map((message) => extractStoredMessageText(message.content))
      .filter(Boolean);
    if (userTexts.length === 0) continue;
    tasks.push({
      id: session.id,
      sessionId: session.id,
      title: session.title,
      text: userTexts.join("\n\n").slice(-4000),
      updatedAt: session.updatedAt,
    });
    if (tasks.length >= limit) break;
  }
  return tasks;
}

function buildAutoDistillTranscript(sessionId: string): string {
  const transcript = listMessages(sessionId)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const text = extractStoredMessageText(message.content);
      return text ? `${message.role === "user" ? "用户" : "助手"}:\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return transcript.slice(-24_000);
}

function buildCoverageGapDistillTranscript(cluster: SkillCoverageGapCluster): string {
  const tasks = cluster.tasks
    .map((task, index) => [
      `任务 ${index + 1}：${task.title}`,
      `sessionId: ${task.sessionId}`,
      `最高 skill 命中分：${task.topScore.toFixed(3)}`,
      task.text,
    ].join("\n"))
    .join("\n\n---\n\n");
  return [
    "下面是一组反复出现、但现有 skill 检索无高分命中的任务。请把它们共同缺失的方法论蒸馏为一个可复用 Skill。",
    "",
    `覆盖缺口：${cluster.title}`,
    `任务数量：${cluster.taskCount}`,
    `关键词：${cluster.keywords.join("、") || "无"}`,
    "",
    "【低命中任务样本】",
    tasks,
  ].join("\n").slice(-24_000);
}

function parseSkillCoverageGapCluster(value: unknown): SkillCoverageGapCluster | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(parseSkillCoverageGapTask).filter((task): task is SkillCoverageGapCluster["tasks"][number] => Boolean(task)) : [];
  if (!id || !title || tasks.length === 0) return null;
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter((item): item is string => typeof item === "string") : [];
  const avgTopScore = Number(raw.avgTopScore);
  return {
    id,
    title,
    taskCount: Number.isInteger(Number(raw.taskCount)) ? Number(raw.taskCount) : tasks.length,
    avgTopScore: Number.isFinite(avgTopScore) ? avgTopScore : 0,
    keywords,
    tasks,
  };
}

function parseSkillCoverageGapTask(value: unknown): SkillCoverageGapCluster["tasks"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : id;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!id || !sessionId || !title || !text) return null;
  const topScore = Number(raw.topScore);
  return {
    id,
    sessionId,
    title,
    text,
    updatedAt: Number(raw.updatedAt) || Date.now(),
    topScore: Number.isFinite(topScore) ? topScore : 0,
    matches: [],
  };
}

async function distillSkillCandidate(input: {
  workspaceId: string;
  workspaceRoot: string;
  transcript: string;
  model?: string;
  timeoutMs: number;
  duplicateThreshold: number;
  dryRun: boolean;
  originSessionId: string | null;
  usageTargetId: string;
  usageTitle: string;
}): Promise<DistillCandidateResult> {
  try {
    const rawOutput = await runPiPrompt({
      workspaceRoot: input.workspaceRoot,
      text: buildSkillDistillationPrompt(input.transcript),
      model: input.model,
      systemPrompt: SKILL_DISTILL_SYSTEM_PROMPT,
      timeoutMs: input.timeoutMs,
      onEvent: (event) => trackUsageEvent({
        workspaceId: input.workspaceId,
        targetKind: "session",
        targetId: input.usageTargetId,
        title: input.usageTitle,
      }, event),
    });
    const content = extractSkillMarkdown(rawOutput);
    const name = parseSkillName(content) ?? "";
    const description = parseSkillDescription(content);
    if (!name || !description) return { status: "failed", error: "distilled SKILL.md missing name or description frontmatter" };
    const slug = sanitizeSkillSlug(slugifySkillName(name));
    if (!slug) return { status: "failed", error: "distilled skill name cannot form a valid registry slug" };
    const duplicate = findAutoDistillDuplicate(input.workspaceId, input.workspaceRoot, slug, content, input.duplicateThreshold);
    if (duplicate) return { status: "skipped", reason: duplicate.reason, slug, name, similarSkill: duplicate.similarSkill };
    if (input.dryRun) return { status: "dry_run", slug, name };
    const skillPath = registrySkillPath(input.workspaceRoot, slug);
    mkdirSync(dirname(skillPath), { recursive: true });
    const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
    writeFileSync(skillPath, normalizedContent, "utf8");
    const entry = createSkillRegistryEntry(input.workspaceId, {
      slug,
      name,
      status: "candidate",
      source: "distilled",
      originSessionId: input.originSessionId,
    });
    writeVersionSnapshot(input.workspaceRoot, entry.slug, entry.version, normalizedContent);
    return { status: "created", slug, name, entry, skillPath };
  } catch (err) {
    return { status: "failed", error: String(err) };
  }
}

function extractStoredMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object"
        && block !== null
        && (block as { type?: unknown }).type === "text"
        && typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseSkillDescription(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match?.[1]) return undefined;
  const descriptionLine = match[1].split("\n").find((line) => /^description\s*:/.test(line));
  if (!descriptionLine) return undefined;
  const value = descriptionLine.replace(/^description\s*:/, "").trim().replace(/^["']|["']$/g, "");
  return value || undefined;
}

function findAutoDistillDuplicate(
  workspaceId: string,
  workspaceRoot: string,
  slug: string,
  content: string,
  duplicateThreshold: number,
): { reason: string; similarSkill?: SkillRegistryConflict } | null {
  const existingSlug = listSkillRegistryEntries(workspaceId)
    .find((entry) => entry.slug === slug);
  if (existingSlug) {
    return {
      reason: "slug_exists",
      similarSkill: {
        id: `skill-conflict:${existingSlug.id}`,
        workspaceId,
        itemKind: "skill",
        itemId: existingSlug.id,
        slug: existingSlug.slug,
        name: existingSlug.name,
        version: existingSlug.version,
        status: existingSlug.status,
        score: Number.POSITIVE_INFINITY,
        severity: "high",
        reason: "同 slug 的非归档 skill 已存在，跳过自动沉淀。",
        snippet: "",
      },
    };
  }
  if (existsSync(registrySkillPath(workspaceRoot, slug))) return { reason: "skill_file_exists" };
  const activeEntries = new Set(
    listSkillRegistryEntries(workspaceId)
      .filter((entry) => entry.status === "active")
      .map((entry) => entry.id),
  );
  const conflicts = detectSkillRegistryConflicts({ workspaceId, workspaceRoot, content }).conflicts
    .filter((conflict) => activeEntries.has(conflict.itemId));
  const duplicate = conflicts.find((conflict) => conflict.score >= duplicateThreshold);
  return duplicate ? { reason: "similar_skill", similarSkill: duplicate } : null;
}

type ParsedSkillRegistryCreate =
  | {
    ok: true;
    value: {
      slug: string;
      name: string;
      content: string;
      source: SkillSource;
      status?: SkillStatus;
      version?: number;
      supersedesId?: string | null;
      originSessionId?: string | null;
    };
  }
  | { ok: false; error: string };

type ParsedSkillRegistryPatch =
  | { ok: true; value: { name?: string; status?: SkillStatus; version?: number; supersedesId?: string | null } }
  | { ok: false; error: string };

type SkillPackageFile = {
  path: string;
  content: string;
};

type SkillPackage = {
  format: "pi-xanthil.skill-package";
  formatVersion: 1;
  exportedAt: number;
  registry: {
    slug: string;
    name: string;
    version: number;
    source: SkillSource;
    status: SkillStatus;
    originSessionId: string | null;
  };
  files: SkillPackageFile[];
};

type ParsedSkillPackage =
  | { ok: true; value: SkillPackage }
  | { ok: false; error: string };

function parseSkillRegistryCreateBody(body: unknown): ParsedSkillRegistryCreate {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const contentRaw = raw.content ?? raw.skillMarkdown ?? raw.markdown;
  if (typeof contentRaw !== "string" || !contentRaw.trim()) return { ok: false, error: "content required" };
  const content = extractSkillMarkdown(contentRaw);
  const parsedName = parseSkillName(content);
  const name = String(raw.name ?? parsedName ?? "").trim();
  if (!name) return { ok: false, error: "name required" };
  const slug = sanitizeSkillSlug(String(raw.slug ?? slugifySkillName(name)));
  if (!slug) return { ok: false, error: "valid slug required" };
  const source = parseSkillSource(raw.source) ?? "manual";
  const status = raw.status === undefined ? undefined : parseSkillStatus(raw.status);
  if (raw.status !== undefined && !status) return { ok: false, error: "invalid status" };
  const version = raw.version === undefined ? undefined : Number(raw.version);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    return { ok: false, error: "version must be a positive integer" };
  }
  const supersedesId = raw.supersedesId === undefined ? undefined : nullableString(raw.supersedesId);
  const originSessionId = raw.originSessionId === undefined ? undefined : nullableString(raw.originSessionId);
  return { ok: true, value: { slug, name, content, source, status, version, supersedesId, originSessionId } };
}

function parseSkillRegistryPatchBody(body: unknown): ParsedSkillRegistryPatch {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const value: { name?: string; status?: SkillStatus; version?: number; supersedesId?: string | null } = {};
  if (raw.name !== undefined) {
    const name = String(raw.name ?? "").trim();
    if (!name) return { ok: false, error: "name must not be empty" };
    value.name = name;
  }
  if (raw.status !== undefined) {
    const status = parseSkillStatus(raw.status);
    if (!status) return { ok: false, error: "invalid status" };
    value.status = status;
  }
  if (raw.version !== undefined) {
    const version = Number(raw.version);
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: "version must be a positive integer" };
    value.version = version;
  }
  if (raw.supersedesId !== undefined) value.supersedesId = nullableString(raw.supersedesId);
  return { ok: true, value };
}

function buildSkillPackage(workspaceRoot: string, entry: SkillRegistryEntry): SkillPackage {
  const skillRoot = registrySkillRoot(workspaceRoot, entry.slug);
  const skillPath = registrySkillPath(workspaceRoot, entry.slug);
  if (!existsSync(skillPath)) throw new Error("SKILL.md not found");
  return {
    format: "pi-xanthil.skill-package",
    formatVersion: 1,
    exportedAt: Date.now(),
    registry: {
      slug: entry.slug,
      name: entry.name,
      version: entry.version,
      source: entry.source,
      status: entry.status,
      originSessionId: entry.originSessionId,
    },
    files: collectSkillPackageFiles(skillRoot),
  };
}

function collectSkillPackageFiles(skillRoot: string): SkillPackageFile[] {
  const files: SkillPackageFile[] = [];
  const visit = (dir: string): void => {
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      if (child.name === "." || child.name === ".." || child.name.startsWith(".")) continue;
      const childPath = resolve(dir, child.name);
      if (!isPathInside(skillRoot, childPath)) throw new Error("invalid skill package source path");
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        visit(childPath);
        continue;
      }
      if (!child.isFile()) continue;
      const relPath = childPath.slice(`${skillRoot}${sep}`.length).split(sep).join("/");
      assertSkillPackageRelPath(relPath);
      files.push({ path: relPath, content: readFileSync(childPath, "utf8") });
    }
  };
  visit(skillRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error("SKILL.md not found");
  return files;
}

function parseSkillPackage(body: unknown): ParsedSkillPackage {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (raw.format !== "pi-xanthil.skill-package") return { ok: false, error: "invalid skill package format" };
  if (raw.formatVersion !== 1) return { ok: false, error: "unsupported skill package version" };
  const registry = typeof raw.registry === "object" && raw.registry !== null ? raw.registry as Record<string, unknown> : null;
  if (!registry) return { ok: false, error: "registry metadata required" };
  const slug = sanitizeSkillSlug(String(registry.slug ?? ""));
  if (!slug) return { ok: false, error: "valid slug required" };
  const name = String(registry.name ?? "").trim();
  if (!name) return { ok: false, error: "name required" };
  const version = Number(registry.version ?? 1);
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: "version must be a positive integer" };
  const source = parseSkillSource(registry.source) ?? "manual";
  const status = parseSkillStatus(registry.status) ?? "candidate";
  if (!Array.isArray(raw.files)) return { ok: false, error: "files required" };
  const files: SkillPackageFile[] = [];
  for (const item of raw.files) {
    const file = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    if (typeof file.path !== "string" || typeof file.content !== "string") return { ok: false, error: "invalid package file" };
    const relPath = normalizeSkillPackageRelPath(file.path);
    if (!relPath) return { ok: false, error: `invalid package file path: ${file.path}` };
    files.push({ path: relPath, content: file.content });
  }
  if (!files.some((file) => file.path === "SKILL.md" && file.content.trim())) return { ok: false, error: "SKILL.md required" };
  return {
    ok: true,
    value: {
      format: "pi-xanthil.skill-package",
      formatVersion: 1,
      exportedAt: Number(raw.exportedAt) || Date.now(),
      registry: {
        slug,
        name,
        version,
        source,
        status,
        originSessionId: nullableString(registry.originSessionId),
      },
      files,
    },
  };
}

function uniqueImportedSkillSlug(workspaceId: string, workspaceRoot: string, requestedSlug: string): string {
  const existingSlugs = new Set(listSkillRegistryEntries(workspaceId).map((entry) => entry.slug));
  if (!existingSlugs.has(requestedSlug) && !existsSync(registrySkillRoot(workspaceRoot, requestedSlug))) return requestedSlug;
  for (let i = 2; i <= 999; i += 1) {
    const candidate = sanitizeSkillSlug(`${requestedSlug}-${String(i)}`);
    if (!candidate) continue;
    if (!existingSlugs.has(candidate) && !existsSync(registrySkillRoot(workspaceRoot, candidate))) return candidate;
  }
  throw new Error("cannot allocate unique imported skill slug");
}

function parseSkillStatus(value: unknown): SkillStatus | undefined {
  return value === "draft" || value === "candidate" || value === "active" || value === "archived" ? value : undefined;
}

function parseSkillSource(value: unknown): SkillSource | undefined {
  return value === "manual" || value === "distilled" || value === "curated" || value === "imported" ? value : undefined;
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function hasConfirmedReview(body: unknown): boolean {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  return raw.confirmed === true;
}

function sanitizeSkillSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) return "";
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) return "";
  return slug;
}

function registrySkillRoot(workspaceRoot: string, slug: string): string {
  const root = resolve(workspaceRoot, ".pi", "skills");
  const skillRoot = resolve(root, slug);
  if (!skillRoot.startsWith(`${root}${sep}`)) throw new Error("invalid skill slug");
  return skillRoot;
}

function registrySkillPath(workspaceRoot: string, slug: string): string {
  return resolveSkillPackageFilePath(registrySkillRoot(workspaceRoot, slug), "SKILL.md");
}

function normalizeSkillPackageRelPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  return isValidSkillPackageRelPath(normalized) ? normalized : "";
}

function assertSkillPackageRelPath(value: string): void {
  if (!isValidSkillPackageRelPath(value)) throw new Error(`invalid package file path: ${value}`);
}

function isValidSkillPackageRelPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function resolveSkillPackageFilePath(skillRoot: string, relPath: string): string {
  const normalized = normalizeSkillPackageRelPath(relPath);
  if (!normalized) throw new Error(`invalid package file path: ${relPath}`);
  const targetPath = resolve(skillRoot, normalized);
  if (!isPathInside(skillRoot, targetPath)) throw new Error(`package file escapes skill root: ${relPath}`);
  return targetPath;
}

function isPathInside(root: string, targetPath: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`);
}

// P1-a 版本内容快照：每版本一份内容存 .pi/skill-versions/<slug>/v<n>.md（**不在 .pi/skills 下，pi 不扫描**），
// 使"留档可回滚"真可用——SKILL.md 仍是当前版本真源，快照供回滚/查看历史版本内容。
function registryVersionPath(workspaceRoot: string, slug: string, version: number): string {
  const root = resolve(workspaceRoot, ".pi", "skill-versions");
  const versionPath = resolve(root, slug, `v${String(version)}.md`);
  if (!versionPath.startsWith(`${root}${sep}`)) throw new Error("invalid skill slug");
  return versionPath;
}

function writeVersionSnapshot(workspaceRoot: string, slug: string, version: number, content: string): void {
  const snapPath = registryVersionPath(workspaceRoot, slug, version);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, content, "utf8");
}

function readVersionSnapshot(workspaceRoot: string, slug: string, version: number): string | null {
  const snapPath = registryVersionPath(workspaceRoot, slug, version);
  return existsSync(snapPath) ? readFileSync(snapPath, "utf8") : null;
}

// SkillRegistryConflict / SkillRegistryConflictsResult 契约已上移至 types.ts（server+web 双份单源）。

function detectSkillRegistryConflicts(input: {
  workspaceId: string;
  workspaceRoot: string;
  slug?: string;
  content?: string;
}): SkillRegistryConflictsResult {
  const querySlug = input.slug ? sanitizeSkillSlug(input.slug) : "";
  if (input.slug && !querySlug) throw new Error("valid slug required");
  const queryEntry = querySlug
    ? listSkillRegistryEntries(input.workspaceId).find((entry) => entry.slug === querySlug && entry.status !== "archived")
    : undefined;
  const queryContent = input.content?.trim() || (queryEntry ? readRegistrySkillContent(input.workspaceRoot, queryEntry.slug) : "");
  if (!queryContent.trim()) throw new Error("content or slug with existing SKILL.md required");
  const documents = listSkillRegistryEntries(input.workspaceId)
    .filter((entry) => entry.status !== "archived" && entry.id !== queryEntry?.id)
    .map((entry) => {
      const content = readRegistrySkillContent(input.workspaceRoot, entry.slug);
      return content ? { id: entry.id, name: entry.name, content } : null;
    })
    .filter((item): item is { id: string; name: string; content: string } => item !== null);
  const entriesById = new Map(listSkillRegistryEntries(input.workspaceId).map((entry) => [entry.id, entry]));
  const conflicts = rankSkillSimilarity(queryContent, documents, 10)
    .map((match) => {
      const entry = entriesById.get(match.id);
      if (!entry) return null;
      const severity = match.score >= 1.5 ? "high" : match.score >= 0.75 ? "medium" : "low";
      return {
        id: `skill-conflict:${entry.id}`,
        workspaceId: input.workspaceId,
        itemKind: "skill" as const,
        itemId: entry.id,
        slug: entry.slug,
        name: entry.name,
        version: entry.version,
        status: entry.status,
        score: match.score,
        severity,
        reason: `疑似重复 skill：BM25 similarity ${match.score.toFixed(2)}，建议人工审查后采纳/归档。`,
        snippet: match.snippet,
      };
    })
    .filter((item): item is SkillRegistryConflict => item !== null);
  return { querySlug: querySlug || null, conflicts };
}

function readRegistrySkillContent(workspaceRoot: string, slug: string): string {
  const path = registrySkillPath(workspaceRoot, slug);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function recordSkillRegistryUsageForPaths(workspaceId: string, workspaceRoot: string, skillPaths: string[] | undefined): void {
  if (!skillPaths || skillPaths.length === 0) return;
  const byPath = new Map<string, SkillRegistryEntry>();
  for (const entry of listSkillRegistryEntries(workspaceId)) {
    if (entry.status === "archived") continue;
    byPath.set(resolve(registrySkillPath(workspaceRoot, entry.slug)), entry);
  }
  const seen = new Set<string>();
  for (const skillPath of skillPaths) {
    const entry = byPath.get(resolve(skillPath));
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    incrementSkillRegistryUsage(entry.id);
  }
}

function collectWorkflowSkillPaths(workflow: WorkflowLike): string[] {
  const paths = new Set<string>();
  if (Array.isArray(workflow.defaultSkillPaths)) {
    for (const item of workflow.defaultSkillPaths) {
      if (typeof item === "string") paths.add(item);
    }
  }
  for (const node of workflow.nodes ?? []) {
    if (!Array.isArray(node.skillPaths)) continue;
    for (const item of node.skillPaths) {
      if (typeof item === "string") paths.add(item);
    }
  }
  return Array.from(paths);
}

// ---- run stale-nodes / cascade（变更管理）----
engineRouter.get("/api/runs/:runId/stale-nodes", (req, res) => {
  res.json(getStaleNodes(req.params.runId));
});

// Manually mark downstream nodes stale from a given node (manual_edit cascade).
engineRouter.post("/api/runs/:runId/cascade", (req, res) => {
  const fromNodeId = String(req.body?.fromNodeId ?? "").trim();
  if (!fromNodeId) return res.status(400).json({ error: "fromNodeId required" });
  const downstream = getDownstreamNodeIds(fromNodeId);
  if (downstream.length === 0) return res.status(400).json({ error: "no downstream nodes" });
  markNodesStale(req.params.runId, downstream, "manual_edit");
  res.json({ ok: true, markedNodes: downstream });
});

// ---- flow 数据路径登记 ----
engineRouter.get("/api/flows/:id/paths", (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(withWorkspacePathStatuses(listWorkspacePaths(flow.workspaceId, folder, undefined, flow.id)));
});

engineRouter.post("/api/flows/:id/paths", async (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  const kind = String(req.body?.kind ?? "").trim();
  if (!folder || !path || !kind) return res.status(400).json({ error: "folder, path and kind required" });
  try {
    const fileHash = kind === "file" ? await computeFileHash(path) : null;
    res.json(addWorkspacePath(flow.workspaceId, folder, path, kind, null, flow.id, fileHash));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.delete("/api/flows/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- flow import (webkitdirectory upload)（T-C2b 残留迁入：multer 基建仅本路由用，随路由一起搬）----
// Each part name carries the original relative path (as posted from the browser).
// We stash files in a tmp dir keyed by a random upload id, then move them into
// the flow's folder root preserving the layout.
const uploadDirs = new Map<string, string>();
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      let id = (req as express.Request & { _uploadId?: string })._uploadId;
      if (!id) {
        id = randomUUID();
        (req as express.Request & { _uploadId?: string })._uploadId = id;
        const dir = join(UPLOAD_TMP_ROOT, id);
        uploadDirs.set(id, dir);
        try {
          mkdirSync(dir, { recursive: true });
        } catch {
          // ignore — moveAllFiles will recreate as needed
        }
      }
      cb(null, uploadDirs.get(id)!);
    },
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
});

engineRouter.post("/api/flows/:id/import", upload.any(), (req, res) => {
  const flowId = String(req.params.id ?? "");
  const flow = getFlow(flowId);
  if (!flow) return res.status(404).json({ error: "flow not found" });

  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) return res.status(400).json({ error: "no files" });

  // The browser sends each file's original `webkitRelativePath` in a parallel
  // text field (`paths[]`). multer with `.any()` collects everything into req.body.
  const paths = req.body?.paths;
  const pathList: string[] = Array.isArray(paths) ? paths.map(String) : paths ? [String(paths)] : [];

  const items = files.map((f, i) => ({
    tmpPath: f.path,
    relPath: pathList[i] ?? f.originalname,
  }));

  // Derive a readable source name from the top-level folder of the first item.
  const firstRel = items[0]?.relPath ?? "";
  const topFolder = firstRel.split(/[\\/]/)[0] ?? "imported";

  const uploadId = (req as express.Request & { _uploadId?: string })._uploadId;
  const tmpRoot = uploadId ? uploadDirs.get(uploadId)! : UPLOAD_TMP_ROOT;
  try {
    moveAllFiles(tmpRoot, flow.folderPath, items);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  } finally {
    if (uploadId) uploadDirs.delete(uploadId);
  }

  updateFlowSourceName(flow.id, topFolder);
  res.json({ ok: true, sourceName: topFolder, count: items.length });
});

// ---- AnaX gate config（从 index.ts 迁入，只搬不改）----
engineRouter.get("/api/workspaces/:id/anax-gate-config", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(getAnaxGateConfig(req.params.id));
});

engineRouter.put("/api/workspaces/:id/anax-gate-config", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const CONFIDENCES = ["low", "medium", "high"];
  const minConfidence = typeof b.minConfidence === "string" && CONFIDENCES.includes(b.minConfidence) ? b.minConfidence : undefined;
  const minEvidenceCount = typeof b.minEvidenceCount === "number" && b.minEvidenceCount >= 0 ? b.minEvidenceCount : undefined;
  const minDataQualityScore = typeof b.minDataQualityScore === "number" && b.minDataQualityScore >= 0 && b.minDataQualityScore <= 10 ? b.minDataQualityScore : undefined;
  res.json(upsertAnaxGateConfig(req.params.id, { minConfidence, minEvidenceCount, minDataQualityScore }));
});

// ===== 流式 WS handler（T-C2b：从 index.ts 迁入；wss.on("connection") 派发仍在 index.ts，反向 import 这些 handler）=====

function parseWorkflowCandidate(raw: string): WorkflowLike | null {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const wf = obj as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) return null;
  if (!Array.isArray(wf.edges)) return null;
  try { return normalizeWorkflowModels(obj as WorkflowLike); } catch { return null; }
}

// 创建链路兜底：pi 可能因用户的输出目录约束把 workflow.json 写到别处、或只在对话里给出 JSON。
// 从本轮 assistant 输出捕获 workflow：① fenced 代码块 ② pi 自报的 .../workflow.json 绝对路径文件 ③ 整段裸 JSON。
function captureWorkflowFromText(text: string): WorkflowLike | null {
  if (!text || !text.trim()) return null;
  const candidates: string[] = [];
  const fence = /```(?:json|workflow|JSON)?\s*([\s\S]*?)```/g;
  let fm: RegExpExecArray | null;
  while ((fm = fence.exec(text))) { if (fm[1]) candidates.push(fm[1].trim()); }
  const pathRe = /(\/[^\s"'`)]+?workflow\.json)/g;
  let pm: RegExpExecArray | null;
  while ((pm = pathRe.exec(text))) {
    const p = pm[1];
    try { if (p && existsSync(p) && statSync(p).isFile()) candidates.push(readFileSync(p, "utf8")); } catch { /* ignore unreadable path */ }
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) candidates.push(trimmed);
  for (const raw of candidates) {
    const wf = parseWorkflowCandidate(raw);
    if (wf) return wf;
  }
  return null;
}

// AnaX flywheel: extract validated hypotheses from the archive node's structured
// block and persist them into the workspace hypothesis library.
function backfillHypothesesFromArchive(workspaceId: string, archiveText: string): void {
  const match = archiveText.match(/```anax-hypotheses\s*\n([\s\S]+?)```/);
  if (!match?.[1]) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const verdicts = new Set(["confirmed", "rejected", "partial"]);
  for (const raw of parsed) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const scene = String(e.scene ?? "").trim();
    const hypothesis = String(e.hypothesis ?? "").trim();
    if (!scene || !hypothesis) continue;
    const verdict = verdicts.has(e.verdict as string) ? (e.verdict as "confirmed" | "rejected" | "partial") : "partial";
    upsertHypothesisFromArchive(
      workspaceId,
      { scene, hypothesis, verdict, evidence: String(e.evidence ?? "").trim(), impact: String(e.impact ?? "").trim() },
    );
  }
}

// AnaX P3 V2: extract actionable recommendations from the recommend node's
// structured block and auto-create draft change proposals in the workspace.
function backfillProposalsFromRecommend(workspaceId: string, runId: string, recommendText: string): void {
  const match = recommendText.match(/```anax-recommendations\s*\n([\s\S]+?)```/);
  if (!match?.[1]) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const raw of parsed) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const title = String(e.title ?? "").trim();
    if (!title) continue;
    createChangeProposal(workspaceId, {
      runId,
      sourceNodeId: "recommend",
      title,
      description: String(e.description ?? "").trim(),
      expectedImpact: String(e.expectedImpact ?? "").trim(),
    });
  }
}

export async function handleSendFlow(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "send_flow" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, message: "flow not found" });
  if (getActiveChatRun(activeFlowRuns, flow.id)) {
    send(ws, { type: "run_start", flowId: flow.id });
    return send(ws, { type: "error", flowId: flow.id, message: "flow already has a running turn; stop it before sending another message" });
  }
  const workspace = getWorkspace(flow.workspaceId);
  const commandExpansion = expandCommand(msg.text, readCommandsFile());
  const commandSkillRoot = workspace?.rootPath ?? flow.folderPath;
  const commandSkillPaths = commandExpansion.skillSlugs.map((slug) => join(commandSkillRoot, ".pi", "skills", slug, "SKILL.md"));
  const requestedSkillPaths = [
    ...(msg.skillPaths ?? []),
    ...commandSkillPaths,
  ];
  let skillPaths: string[] | undefined;
  try {
    skillPaths = validateSkillPaths(flow.folderPath, requestedSkillPaths.length > 0 ? requestedSkillPaths : undefined);
  } catch (err) {
    return send(ws, { type: "error", flowId: flow.id, message: String(err) });
  }
  if (workspace) recordSkillRegistryUsageForPaths(flow.workspaceId, workspace.rootPath, skillPaths);

  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow");
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);

  addFlowMessage(flow.id, "user", [{ type: "text", text: msg.text }]);
  traceFlowEvent(flow.id, "run_start", "running", msg.text.slice(0, 240), { model: msg.model, memoryInjection });
  send(ws, { type: "run_start", flowId: flow.id });
  const flowChatPaths = listWorkspacePaths(flow.workspaceId);
  const flowChatAnalyses = getFileAnalysesByPathIds(
    flowChatPaths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const contextPrefix = buildRegisteredPathContext(flowChatPaths, {
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    fallbackOutputDir: standardDirIn(flow.folderPath, "report"),
  }, flowChatAnalyses);

  let capturedText = "";
  const run = runPiTurn({
    // pi runs *inside* the flow folder so its file tools see the workflow as cwd.
    workspaceRoot: flow.folderPath,
    piSessionId: flow.id,
    text: `${contextPrefix}${commandExpansion.expandedText}`,
    model: msg.model,
    systemPrompt: msg.injectRulesPrompt ? withRulesPrompt(flow.workspaceId, "workflow", msg.systemPrompt) : msg.systemPrompt,
    skillPaths,
    onEvent: (event: PiEvent) => {
      trackUsageEvent({
        workspaceId: flow.workspaceId,
        targetKind: "flow",
        targetId: flow.id,
        title: `工作流聊天：${flow.name}`,
      }, event);
      send(ws, { type: "flow_event", flowId: flow.id, event });
      if (event.type === "message_end") {
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role !== "user") addFlowMessage(flow.id, m.role, m.content, m.usage ?? null);
        if (m.role === "assistant") capturedText += "\n" + flowMessageText(m.content);
        if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { role: m.role, stopReason: m.stopReason });
      }
    },
  });
  const active = { run, aborted: false, startedAt: Date.now() };
  activeFlowRuns.set(flow.id, active);
  try {
    const code = await run.done;
    // 兜底：若 flow 目录仍无合法 workflow.json（pi 写错目录/只在对话给出 JSON），从本轮输出捕获并回填。
    // pi 中途提问停住的情形捕获不到（无 workflow 产出），交由前端 CreationPane 提示用户应答。
    if (code === 0 && !active.aborted && !readWorkflow(flow.folderPath)) {
      try {
        const captured = captureWorkflowFromText(capturedText);
        if (captured) {
          writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(captured, null, 2));
          traceFlowEvent(flow.id, "workflow_captured", "success", "创建链路：从 pi 输出捕获并回填 workflow.json 到 flow 目录", {});
        }
      } catch (err) {
        traceFlowEvent(flow.id, "workflow_capture_failed", "failed", String(err), {});
      }
    }
    // A 卡：生产成功完成后记本轮注入 skill 的真实激活（独立于 usageCount/评测口径）。
    if (code === 0 && !active.aborted && workspace) {
      recordSkillActivationForRun({ workspaceId: flow.workspaceId, workspaceRoot: workspace.rootPath, skillPaths, output: capturedText });
    }
    traceFlowEvent(flow.id, "run_end", active.aborted ? "aborted" : code === 0 ? "success" : "failed", code === 0 ? null : `pi exited with code ${String(code)}`, { code, aborted: active.aborted });
    send(ws, { type: "run_end", flowId: flow.id, code, aborted: active.aborted });
    if (code === 0 && !active.aborted && workspace) {
      maybeTriggerFlowMemoryConsolidation({ workspace, flow, targetKind: "flow", targetId: flow.id });
    }
  } finally {
    if (activeFlowRuns.get(flow.id) === active) activeFlowRuns.delete(flow.id);
  }
}

export async function handleExecuteMultiAgent(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "execute_multi_agent" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, runId: msg.runId, message: "flow not found" });

  const workflow = readWorkflow(flow.folderPath);
  if (!workflow) {
    traceFlowEvent(flow.id, "error", "failed", "workflow.json not found or invalid. Ask pi to generate one first.", { phase: "load_workflow", runId: msg.runId });
    return send(ws, {
      type: "error",
      flowId: flow.id,
      runId: msg.runId,
      message: "workflow.json not found or invalid. Ask pi to generate one first.",
    });
  }

  try {
    normalizeWorkflowModels(workflow as WorkflowLike);
    normalizeWorkflowSkills(flow.folderPath, workflow);
  } catch (err) {
    traceFlowEvent(flow.id, "error", "failed", String(err), { phase: "normalize_workflow_models", runId: msg.runId });
    return send(ws, { type: "error", flowId: flow.id, runId: msg.runId, message: String(err) });
  }
  const workspace = getWorkspace(flow.workspaceId);
  if (workspace) recordSkillRegistryUsageForPaths(flow.workspaceId, workspace.rootPath, collectWorkflowSkillPaths(workflow));

  const runsRoot = join(flow.folderPath, "runs");
  const runDir = join(runsRoot, msg.runId);
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  copyFlowSnapshot(flow.folderPath, runDir);

  const runRow = createFlowRun(flow.id, { inputs: msg.inputs ?? {} }, runDir);
  const multiAgentPaths = listWorkspacePaths(flow.workspaceId);
  const multiAgentAnalyses = getFileAnalysesByPathIds(
    multiAgentPaths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const registeredContext = buildRegisteredPathContext(multiAgentPaths, {
    workspaceId: flow.workspaceId,
    flowId: flow.id,
    fallbackOutputDir: runDir,
  }, multiAgentAnalyses);
  // AnaX runs additionally see the workspace hypothesis library (flywheel read half).
  // Both full (v3.0) and quick (v3.0 Quick) flows participate in the flywheel.
  const isAnaxFlow = flow.sourceName === "AnaX v3.0" || flow.sourceName === "AnaX v3.0 Quick";
  const hypothesisContext = isAnaxFlow ? buildHypothesisLibraryContext(flow.workspaceId, msg.inputs?.task) : "";
  const contextPrefix = hypothesisContext ? `${hypothesisContext}\n\n${registeredContext}` : registeredContext;
  // If resuming from a mid-flow node, pre-populate the blackboard from the
  // previous run's spec deliverables so upstream outputs are available for
  // prompt rendering without re-executing those nodes.
  const initialBlackboard: Record<string, string> = {};
  if (msg.resumeFromNodeId && msg.previousRunId) {
    const prevRun = getFlowRun(msg.previousRunId);
    if (prevRun) {
      const order = topoOrder(workflow);
      const resumeIdx = order.findIndex((n) => n.id === msg.resumeFromNodeId);
      for (const node of order.slice(0, Math.max(0, resumeIdx))) {
        if (node.spec) {
          try {
            initialBlackboard[node.id] = readFileSync(join(prevRun.outputDir, "specs", node.spec), "utf8");
          } catch { /* spec not written yet — skip */ }
        }
      }
    }
  }

  const clientRunId = msg.runId;
  const active: ActiveMultiAgentRun = { currentRuns: new Set(), aborted: false, dbRunId: runRow.id, flowId: flow.id, ws };
  activeMultiAgentRuns.set(clientRunId, active);
  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow");
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);
  traceFlowEvent(flow.id, "run_start", "running", "multi-agent execution", { model: msg.model, inputs: msg.inputs, memoryInjection, resumeFromNodeId: msg.resumeFromNodeId }, runRow.id);
  send(ws, { type: "run_start", flowId: flow.id, runId: clientRunId });

  try {
    const result = await runMultiAgent(workflow, {
      flowRoot: flow.folderPath,
      runId: runRow.id,
      runDir,
      inputs: msg.inputs,
      defaultModel: msg.model,
      contextPrefix,
      systemPromptPrefix: msg.injectRulesPrompt ? (buildMemoryPrompt(flow.workspaceId, "workflow") || undefined) : undefined,
      onStepStart: (nodeId) => {
        traceFlowEvent(flow.id, "agent_step_start", "running", nodeId, { nodeId }, runRow.id);
        send(ws, { type: "agent_step_start", flowId: flow.id, runId: clientRunId, nodeId });
      },
      onStepRun: (_nodeId, run) => {
        active.currentRuns.add(run);
        void run.done.finally(() => active.currentRuns.delete(run));
      },
      onStepEvent: (nodeId, event) => {
        trackUsageEvent({
          workspaceId: flow.workspaceId,
          targetKind: "flow_run",
          targetId: runRow.id,
          title: `多智能体执行：${flow.name}`,
        }, event);
        if (event.type === "message_end") {
          const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
          if (m.errorMessage) traceFlowEvent(flow.id, "message_error", "failed", m.errorMessage, { nodeId, role: m.role, stopReason: m.stopReason }, runRow.id);
        }
        send(ws, { type: "agent_event", flowId: flow.id, runId: clientRunId, nodeId, event });
      },
      onStepEnd: (nodeId, code) => {
        traceFlowEvent(flow.id, "agent_step_end", code === 0 ? "success" : "failed", nodeId, { nodeId, code }, runRow.id);
        send(ws, { type: "agent_step_end", flowId: flow.id, runId: clientRunId, nodeId, code });
      },
      onBlackboardUpdate: (key, value) => {
        traceFlowEvent(flow.id, "blackboard_update", "success", key, { key, value: value.slice(0, 1000) }, runRow.id);
        send(ws, { type: "blackboard_update", flowId: flow.id, runId: clientRunId, key, value });
        // AnaX flywheel write half: archive node emits validated hypotheses → library.
        if (isAnaxFlow && key === "archive") backfillHypothesesFromArchive(flow.workspaceId, value);
        // AnaX P3 V2: recommend node emits actionable recommendations → change proposals.
        if (isAnaxFlow && key === "recommend") backfillProposalsFromRecommend(flow.workspaceId, runRow.id, value);
      },
      onStepGate: (nodeId, verdict) => {
        traceFlowEvent(flow.id, "agent_gate", verdict.verdict === "pass" ? "success" : "failed", nodeId, { nodeId, verdict }, runRow.id);
        send(ws, { type: "agent_gate", flowId: flow.id, runId: clientRunId, nodeId, verdict });
      },
      isAborted: () => active.aborted,
      initialBlackboard,
      resumeFromNodeId: msg.resumeFromNodeId,
      gateThresholds: isAnaxFlow ? (() => { const c = getAnaxGateConfig(flow.workspaceId); return { minConfidence: c.minConfidence, minEvidenceCount: c.minEvidenceCount, minDataQualityScore: c.minDataQualityScore }; })() : undefined,
      runBudget: RUN_BUDGET_LIMITS ? { workspaceId: flow.workspaceId, limits: RUN_BUDGET_LIMITS } : undefined,
    });
    if (activeMultiAgentRuns.get(clientRunId) === active) activeMultiAgentRuns.delete(clientRunId);
    finishFlowRun(runRow.id, active.aborted ? "aborted" : result.code === 0 ? "success" : "failed");
    // A 卡：生产成功完成后记本次工作流注入 skill 的真实激活（聚合各节点黑板输出）。
    if (result.code === 0 && !active.aborted && workspace) {
      recordSkillActivationForRun({ workspaceId: flow.workspaceId, workspaceRoot: workspace.rootPath, skillPaths: collectWorkflowSkillPaths(workflow), output: Object.values(result.blackboard).join("\n") });
    }
    traceFlowEvent(flow.id, "run_end", active.aborted ? "aborted" : result.code === 0 ? "success" : "failed", result.code === 0 ? null : `multi-agent exited with code ${String(result.code)}`, { code: result.code, aborted: active.aborted }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: clientRunId, code: result.code, aborted: active.aborted });
    if (result.code === 0 && !active.aborted && workspace) {
      maybeTriggerFlowMemoryConsolidation({ workspace, flow, targetKind: "flow_run", targetId: runRow.id, traceRunId: runRow.id });
    }
  } catch (err) {
    if (activeMultiAgentRuns.get(clientRunId) === active) activeMultiAgentRuns.delete(clientRunId);
    finishFlowRun(runRow.id, active.aborted ? "aborted" : "failed");
    traceFlowEvent(flow.id, "error", "failed", String(err), { phase: "multi_agent" }, runRow.id);
    send(ws, { type: "error", flowId: flow.id, runId: clientRunId, message: String(err) });
    traceFlowEvent(flow.id, "run_end", active.aborted ? "aborted" : "failed", String(err), { code: null, aborted: active.aborted }, runRow.id);
    send(ws, { type: "run_end", flowId: flow.id, runId: clientRunId, code: null, aborted: active.aborted });
  }
}

// ---- AnaX data quality precheck ----

const PRECHECK_PROMPT = [
  "你是数据质量快速评估官。请快速评估以下聚合数据文件是否具备 AnaX 商业分析的就绪条件。",
  "",
  "本次分析指定的聚合数据文件：",
  "{{DATA_FILES}}",
  "",
  "重要：只能读取和评估已登记的聚合(clean_data)文件，禁止读取原始明细数据。",
  "请用 Read 工具逐一读取上述文件，然后完成以下评估：",
  "",
  "1. 对每个文件给出 6 维度评分：完整性(25%) / 准确性(25%) / 时效性(20%) / 一致性(15%) / 有效性(10%) / 唯一性(5%)。",
  "2. 计算加权综合评分（0-10），**必须在输出中包含一行 `综合评分: X.X/10`**。",
  "3. 给出是否能通过 AnaX 数据门禁（阈值 ≥ 7）的预判，以及关键风险项（如有）。",
  "4. 给出 1-2 句改善建议（若评分 < 9）。",
  "输出保持简洁，重点突出评分和预判。",
].join("\n");

interface ActivePrecheck {
  run: ReturnType<typeof runPiTurn> | null;
}
const activePrechecks = new Map<string, ActivePrecheck>();

export async function handleAnaxPrecheck(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "execute_anax_precheck" }>,
): Promise<void> {
  const { precheckId, workspaceId, data_files, model } = msg;

  const paths = listWorkspacePaths(workspaceId);
  const analyses = getFileAnalysesByPathIds(
    paths.filter((p) => p.folder === "clean_data" && p.kind === "file").map((p) => p.id),
  );
  const contextPrefix = buildRegisteredPathContext(paths, { workspaceId, fallbackOutputDir: tmpdir() }, analyses);
  const prompt = PRECHECK_PROMPT.replace("{{DATA_FILES}}", data_files || "（未指定）");

  const sessionDir = join(tmpdir(), `pi-xanthil-precheck-${precheckId}`);
  mkdirSync(sessionDir, { recursive: true });

  const active: ActivePrecheck = { run: null };
  activePrechecks.set(precheckId, active);

  let assistantText = "";
  try {
    const run = runPiTurn({
      workspaceRoot: sessionDir,
      piSessionId: `precheck-${precheckId}`,
      text: `${contextPrefix}${prompt}`,
      model: model || undefined,
      onEvent: (event: PiEvent) => {
        send(ws, { type: "anax_precheck_event", precheckId, event });
        if (event.type === "message_end") {
          const m = (event as { message?: { role?: string; content?: unknown } }).message;
          if (m?.role === "assistant") {
            const parts = Array.isArray(m.content)
              ? (m.content as Array<{ type?: string; text?: string }>)
                  .filter((b) => b.type === "text")
                  .map((b) => b.text ?? "")
                  .join("\n")
                  .trim()
              : "";
            if (parts) assistantText = parts;
          }
        }
      },
    });
    active.run = run;
    await run.done;
  } catch (err) {
    activePrechecks.delete(precheckId);
    send(ws, { type: "anax_precheck_error", precheckId, message: String(err) });
    return;
  }

  activePrechecks.delete(precheckId);

  const scoreMatch = assistantText.match(/综合评分[：:]\s*(\d+(?:\.\d+)?)/);
  const score = scoreMatch?.[1] != null ? parseFloat(scoreMatch[1]) : null;
  const pass = score !== null && score >= 7;

  // Extract a one-line summary (first line that mentions 门禁/预判/pass/fail or first non-empty line).
  const summaryLine = assistantText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 10 && /门禁|预判|通过|阻断|建议|评分|风险/.test(l))
    ?? assistantText.split("\n").find((l) => l.trim().length > 10)
    ?? "";

  send(ws, { type: "anax_precheck_done", precheckId, score, pass, summary: summaryLine });
}

/** 中止进行中的 AnaX 预检 run（供 index.ts 的 abort_anax_precheck 派发调用）。 */
export function abortAnaxPrecheck(precheckId: string): void {
  const active = activePrechecks.get(precheckId);
  if (active) { active.run?.kill(); activePrechecks.delete(precheckId); }
}
