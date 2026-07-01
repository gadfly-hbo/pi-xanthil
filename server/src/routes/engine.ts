import express, { Router, type Request, type Response } from "express";
import multer from "multer";
import type { WebSocket } from "ws";
import { dirname, resolve, join, sep } from "node:path";
import { rmSync, statSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  getFlow, listFlowMessages, listFlowRuns, getFlowRun, updateFlowSourceName,
  getWorkspace, getWorkspacePath, listFlows, createFlow, renameFlow, deleteFlow,
  listWorkflowFavorites, getWorkflowFavoriteBySourceFlowId, updateWorkflowFavorite,
  getWorkflowFavorite, createWorkflowFavorite, removeWorkflowFavorite,
  getStaleNodes, markNodesStale, listWorkspacePaths, addWorkspacePath, removeWorkspacePath,
  addFlowMessage, getFileAnalysesByPathIds, createFlowRun, finishFlowRun,
  recordMemoryInjectionUsage, buildHypothesisLibraryContext, getAnaxGateConfig, upsertAnaxGateConfig,
  upsertHypothesisFromArchive, createChangeProposal,
  listSessions, listMessages, getSession, getSessionRuntime, createSession,
  addTraceEvent, getTraceTimeline, db,
  listBusinessContexts, listEnabledMetricDefinitions,
  listCollectSessions, createCollectSession, setCollectSessionFolder,
  renameSession, deleteSession, COLLECT_WORKSPACE_ID,
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
  createPromptEvalSet,
  deletePromptEvalSet,
  getPromptEvalSet,
  getPromptEvaluation,
  listPromptEvalSets,
  listPromptEvaluations,
  savePromptEvaluation,
  updatePromptEvalSet,
  createCommandCaseSet,
  deleteCommandCaseSet,
  getCommandCaseSet,
  getCommandEvaluation,
  listCommandCaseSets,
  listCommandEvaluations,
  saveCommandEvaluation,
  updateCommandCaseSet,
  createSubAgentEvalSet,
  deleteSubAgentEvalSet,
  getSubAgentEvalSet,
  getSubAgentEvaluation,
  listSubAgentEvalSets,
  listSubAgentEvaluations,
  saveSubAgentEvaluation,
  updateSubAgentEvalSet,
  createHookEvalSet,
  deleteHookEvalSet,
  getHookEvalSet,
  getHookEvaluation,
  listHookEvalSets,
  listHookEvaluations,
  saveHookEvaluation,
  updateHookEvalSet,
  createToolCaseSet,
  getToolCaseSet,
  listToolCaseSets,
  updateToolCaseSet,
  deleteToolCaseSet,
  saveToolEvaluation,
  listToolEvaluations,
  getToolEvaluation,
  createSkillEvalSet,
  getSkillEvalSet,
  listSkillEvalSets,
  updateSkillEvalSet,
  deleteSkillEvalSet,
  saveSkillEvaluation,
  listSkillEvaluations,
  getSkillEvaluation,
  saveChangeManifest,
  getChangeManifest,
  listChangeManifests,
  saveScopedRevision,
  getScopedRevision,
  listScopedRevisions,
  saveHarnessVariant,
  listHarnessVariants,
  saveAgentTrajectory,
  listAgentTrajectories,
  createEvalRecord,
  upsertEvalRecordForFinding,
  getEvalRecord,
  listEvalRecords,
  updateEvalRecordStatus,
  listCollectFolders,
  getCollectFolder,
  createCollectFolder,
  renameCollectFolder,
  reorderCollectFolder,
  deleteCollectFolder,
} from "../db/engine.ts";
import { finishFlowNodeRun, listEnabledItemIds, startFlowNodeRun } from "../db/shared.ts";
import { recordBusinessContextInjectionTraces, recordMetricInjectionTraces } from "../db/viz.ts";
import { readTree, readFlowFile, writeFlowFile, copyLocalFolderIntoFlow, copyFlowSnapshot, inferWorkflow, moveAllFiles } from "../flow-fs.ts";
import { normalizeWorkflowModels, normalizeWorkflowSkills, type WorkflowLike } from "../workflow-config.ts";
import { withWorkspacePathStatuses } from "../workspace-path-status.ts";
import { getDownstreamNodeIds } from "../change-management.ts";
import { computeFileHash } from "../file-hash.ts";
import { send, getActiveChatRun, activeFlowRuns, activeMultiAgentRuns, type ActiveMultiAgentRun } from "../runtime.ts";
import { traceFlowEvent } from "../flow-trace.ts";
import { trackUsageEvent } from "../cache.ts";
import { buildMemoryInjectionSnapshot, withRulesPrompt, buildMemoryPrompt } from "../memory-injection.ts";
import { buildKnowledgePrompt, withKnowledgePrompt } from "../knowledge-injection.ts";
import { buildRegisteredPathContext } from "../output-paths.ts";
import { standardDirIn } from "../workspace-dirs.ts";
import { readWorkflow, runMultiAgent, topoOrder } from "../multi-agent-runner.ts";
import { runPiPrompt, runPiTurn } from "../pi-adapter.ts";
import { fireMemoryConsolidation, postMemoryCandidateToDIngest, runMemoryConsolidation, type MemoryConsolidationTargetKind } from "../memory-consolidation.ts";
import { runMemoryMaintenance } from "../memory-maintenance.ts";
import { runMemoryAgingInspection, type CounterfactualProbeRun } from "../memory-aging-inspector.ts";
import { DEFAULT_MEMORY_SKILL_THRESHOLDS, fetchMemoryExperiences, runMemoryToSkillPromotion, type MemorySkillThresholds } from "../memory-to-skill.ts";
import { runPromptDistillation } from "../prompt-distillation.ts";
import { validateSkillPaths } from "../skills.ts";
import { flowMessageText } from "../message-text.ts";
import type { AgentTrajectory, ClientMessage, EvalAnnotationStatus, Flow, MetricSnapshot, PiEvent, RetrievalContext, Session } from "../types.ts";
import { appendMetricVerificationBlock, collectMetricSnapshotsFromEvent } from "../metric-verification-events.ts";
import { buildAnaxWorkflow, buildAnaxQuickWorkflow } from "../anax-template.ts";
import { buildSqlLoopWorkflow } from "../sql-loop-template.ts";
import { moveManagedDirToTrash } from "../trash.ts";
import { listSkills } from "../skills.ts";
import { buildSkillDistillationPrompt, buildSkillRevisionPrompt, extractSkillMarkdown, parseSkillName, SKILL_DISTILL_SYSTEM_PROMPT, SKILL_REVISE_SYSTEM_PROMPT, slugifySkillName } from "../skill-distillation.ts";
import { parseSkillEvaluationRunRequest } from "../skill-evaluation-api.ts";
import { buildLabTimelines } from "../lab-timeline.ts";
import { evaluateRegressionGate, parseRegressionGateThresholds } from "../regression-gate.ts";
import type { ChangeOutcome, HarnessComponent, LabKind } from "../types.ts";
import { parsePromptEvaluationRunRequest } from "../prompt-evaluation-api.ts";
import { runPromptEvaluation } from "../prompt-evaluation-runner.ts";
import { archivePromptEvaluation } from "../evaluation-archive.ts";
import { parseCommandEvaluationRunRequest, parseCommandEvaluationCases } from "../command-evaluation-api.ts";
import { runCommandEvaluation } from "../command-evaluation-runner.ts";
import { archiveCommandEvaluation } from "../evaluation-archive.ts";
import { parseSubAgentEvaluationCases, parseSubAgentEvaluationRunRequest } from "../subagent-evaluation-api.ts";
import { runSubAgentEvaluation } from "../subagent-evaluation-runner.ts";
import { archiveSubAgentEvaluation } from "../evaluation-archive.ts";
import { parseHookEvaluationCases, parseHookEvaluationRunRequest } from "../hook-evaluation-api.ts";
import { runHookEvaluation } from "../hook-evaluation-runner.ts";
import { runToolEvaluation } from "../tool-evaluation-runner.ts";
import { runSkillEvaluation } from "../skill-evaluation-runner.ts";
import { parseToolEvaluationCases, parseToolEvaluationRunRequest } from "../tool-evaluation-api.ts";
import { parseDocumentEvaluationRunRequest } from "../document-eval-api.ts";
import {
  buildChangeManifestFromEvalRecord,
  buildEvalRecordFromFinding,
  buildFlowFailureTrajectory,
  buildMonitorFindingTrajectory,
  sanitizeTrajectoryText,
  shouldCreateEvalFromFinding,
} from "../evolve-engine.ts";
import { runDocumentEvaluation } from "../document-evaluation-runner.ts";
import { getExtractionTool, listExtractionTools } from "../../tools/registry.ts";
import { listAiExposedToolIds } from "../tool-policy.ts";
import { archiveHookEvaluation } from "../evaluation-archive.ts";
import { type DocumentEvalResult, type Hook } from "../types.ts";
import { autoTriggerCuration } from "../skill-curator.ts";
import { applySkillCurationProposalsGated } from "../skill-curator.ts";
import { runRewriteCandidateEvaluation, type SkillRewriteGateConfig } from "../skill-rewrite-gate.ts";
import { listRejectedEdits, deleteRejectedEdit, insertRejectedEdit } from "../skill-rejected-buffer.ts";
import { createSkillSandbox, verifyCreatorIsolation, verifyEvaluatorIsolation } from "../skill-sandbox.ts";
import { retrieveSkills, rankSkillSimilarity } from "../skill-retrieval.ts";
import { analyzeSkillCoverageGaps, type SkillCoverageGapCluster, type SkillCoverageTask } from "../skill-coverage-gap.ts";
import { attributeHarnessEdit } from "../ahe-attribute.ts";
import { expandCommand } from "../command-expand.ts";
import { COMMANDS_CONFIG_PATH, FAVORITES_ROOT, HOOKS_CONFIG_PATH, PORT, RUN_BUDGET_LIMITS, UPLOAD_TMP_ROOT } from "../config.ts";
import { listSystemPromptOverviews } from "../system-prompts.ts";
import type { SkillRegistryConflict, SkillRegistryConflictsResult, SkillRegistryEntry, SkillSource, SkillStatus, XanCommand, XanCommandParam, XanCommandParamType } from "../types.ts";
import {
  maybeRunSkillVersionRetest,
  parseSkillRegressionThresholds,
  runSkillRegistryRetest,
} from "../skill-regression.ts";
import { runSimulationLab } from "../simulation-lab.ts";
import { parseSimulationRunRequest } from "../simulation-lab.ts";
import {
  parseRequirementCommunicationRequest,
  parseRequirementCommunicationConfirmInput,
  parseRequirementImportDocumentsRequest,
  parseAnalysisFrameworkFromConfirmedRequest,
  validateRequirementImportDocumentAccess,
  buildAnalysisFrameworkFromConfirmedTracePayload,
  buildConfirmedBusinessRequirement,
  buildRequirementCommunicationRecord,
  buildRequirementConfirmationTracePayload,
  buildRequirementImportTracePayload,
  buildRequirementReviewContext,
  isConfirmedBusinessRequirementJsonPath,
  makeRequirementImportDocumentFromText,
  renderAnalysisFrameworkFromConfirmedMarkdown,
  renderConfirmedBusinessRequirementMarkdown,
  runAnalysisFrameworkFromConfirmedRequirement,
  runRequirementCommunicationClarification,
  runRequirementImportDocuments,
  type BusinessRequirementAnalysisFrameworkStructured,
  type RequirementImportDocumentForPrompt,
  type RequirementImportDocumentInput,
  type RequirementCommunicationPathMeta,
  type ConfirmedBusinessRequirementStructured,
} from "../business-requirement-communication.ts";

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

const documentEvalResults = new Map<string, { workspaceId: string; results: DocumentEvalResult[]; createdAt: number }>();

function hasAnalysisExtractionTools(): boolean {
  return listExtractionTools().some((tool) => tool.category === "analysis");
}

engineRouter.get("/api/prompts/system", (_req, res) => {
  res.json(listSystemPromptOverviews());
});

engineRouter.get("/api/workspaces/:id/prompt-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listPromptEvaluations(req.params.id));
});

engineRouter.get("/api/workspaces/:id/prompt-eval-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listPromptEvalSets(req.params.id));
});

engineRouter.post("/api/workspaces/:id/prompt-eval-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const tasks = parsePromptEvalTasks(req.body?.tasks);
  if (!name) return res.status(400).json({ error: "name required" });
  if (tasks.length === 0) return res.status(400).json({ error: "tasks required" });
  res.json(createPromptEvalSet(req.params.id, name, tasks));
});

engineRouter.patch("/api/prompt-eval-sets/:id", (req, res) => {
  const existing = getPromptEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "prompt eval set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const tasks = req.body?.tasks === undefined ? existing.tasks : parsePromptEvalTasks(req.body.tasks);
  if (!name) return res.status(400).json({ error: "name required" });
  if (tasks.length === 0) return res.status(400).json({ error: "tasks required" });
  res.json(updatePromptEvalSet(existing.id, name, tasks));
});

engineRouter.delete("/api/prompt-eval-sets/:id", (req, res) => {
  const existing = getPromptEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "prompt eval set not found" });
  res.json({ ok: deletePromptEvalSet(existing.id) });
});

engineRouter.get("/api/prompt-evaluations/:id", (req, res) => {
  const evaluation = getPromptEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "prompt evaluation not found" });
  res.json(evaluation);
});

engineRouter.post("/api/workspaces/:id/prompt-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parsePromptEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const summary = await runPromptEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      model: parsed.value.model,
      variants: parsed.value.variants,
      tasks: parsed.value.tasks,
      repeat: parsed.value.repeat,
      judgeRepeat: parsed.value.judgeRepeat,
      dataContextPaths: parsed.value.dataContextPaths,
    });
    res.json(savePromptEvaluation(workspace.id, parsed.value.model, parsed.value.repeat, parsed.value.variants, parsed.value.tasks, summary));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/prompt-evaluations/:id/archive", (req, res) => {
  const evaluation = getPromptEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "prompt evaluation not found" });
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  res.json(archivePromptEvaluation(workspace.rootPath, evaluation));
});

engineRouter.get("/api/workspaces/:id/command-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listCommandEvaluations(req.params.id));
});

engineRouter.get("/api/workspaces/:id/command-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const commandId = typeof req.query.commandId === "string" && req.query.commandId.trim() ? req.query.commandId.trim() : undefined;
  res.json(listCommandCaseSets(req.params.id, commandId));
});

engineRouter.post("/api/workspaces/:id/command-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const commandId = String(req.body?.commandId ?? "").trim();
  const cases = parseCommandEvaluationCases(req.body?.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!commandId) return res.status(400).json({ error: "commandId required" });
  if (cases.length === 0) return res.status(400).json({ error: "cases required" });
  res.json(createCommandCaseSet(req.params.id, name, commandId, cases));
});

engineRouter.patch("/api/command-case-sets/:id", (req, res) => {
  const existing = getCommandCaseSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "command case set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const commandId = req.body?.commandId === undefined ? existing.commandId : String(req.body.commandId ?? "").trim();
  const cases = req.body?.cases === undefined ? existing.cases : parseCommandEvaluationCases(req.body.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!commandId) return res.status(400).json({ error: "commandId required" });
  if (cases.length === 0) return res.status(400).json({ error: "cases required" });
  res.json(updateCommandCaseSet(existing.id, name, commandId, cases));
});

engineRouter.delete("/api/command-case-sets/:id", (req, res) => {
  const existing = getCommandCaseSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "command case set not found" });
  res.json({ ok: deleteCommandCaseSet(existing.id) });
});

engineRouter.get("/api/command-evaluations/:id", (req, res) => {
  const evaluation = getCommandEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "command evaluation not found" });
  res.json(evaluation);
});

engineRouter.post("/api/workspaces/:id/command-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseCommandEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const allCommands = readCommandsFile();
  const command = allCommands.find((candidate) => candidate.id === parsed.value.commandId && candidate.enabled);
  if (!command) return res.status(400).json({ error: "command not found or disabled" });
  try {
    const summary = await runCommandEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      command,
      allCommands,
      cases: parsed.value.cases,
      repeat: parsed.value.repeat,
      model: parsed.value.model,
    });
    res.json(saveCommandEvaluation(workspace.id, command.id, parsed.value.repeat, parsed.value.cases, summary));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/command-evaluations/:id/archive", (req, res) => {
  const evaluation = getCommandEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "command evaluation not found" });
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  res.json(archiveCommandEvaluation(workspace.rootPath, evaluation));
});

engineRouter.get("/api/workspaces/:id/subagent-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSubAgentEvaluations(req.params.id));
});

engineRouter.get("/api/workspaces/:id/subagent-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSubAgentEvalSets(req.params.id));
});

engineRouter.post("/api/workspaces/:id/subagent-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const cases = parseSubAgentEvaluationCases(req.body?.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!cases.length) return res.status(400).json({ error: "cases required" });
  res.json(createSubAgentEvalSet(req.params.id, name, cases));
});

engineRouter.patch("/api/subagent-case-sets/:id", (req, res) => {
  const existing = getSubAgentEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "subagent case set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const cases = req.body?.cases === undefined ? existing.cases : parseSubAgentEvaluationCases(req.body.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!cases.length) return res.status(400).json({ error: "cases required" });
  res.json(updateSubAgentEvalSet(existing.id, name, cases));
});

engineRouter.delete("/api/subagent-case-sets/:id", (req, res) => {
  const existing = getSubAgentEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "subagent case set not found" });
  res.json({ ok: deleteSubAgentEvalSet(existing.id) });
});

engineRouter.get("/api/subagent-evaluations/:id", (req, res) => {
  const evaluation = getSubAgentEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "subagent evaluation not found" });
  res.json(evaluation);
});

engineRouter.post("/api/workspaces/:id/subagent-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSubAgentEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const summary = await runSubAgentEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      model: parsed.value.model,
      repeat: parsed.value.repeat,
      cases: parsed.value.cases,
    });
    res.json(saveSubAgentEvaluation(workspace.id, parsed.value.repeat, parsed.value.cases, summary));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/subagent-evaluations/:id/archive", (req, res) => {
  const evaluation = getSubAgentEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "subagent evaluation not found" });
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  res.json(archiveSubAgentEvaluation(workspace.rootPath, evaluation));
});

// hooks lab：读全局 hooks.json（与 px-hook-runner / dataRouter GET /api/hooks 同源），只取顶层数组或 { hooks }。
function readHooksForEval(): Hook[] {
  if (!existsSync(HOOKS_CONFIG_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(HOOKS_CONFIG_PATH, "utf8")) as unknown;
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { hooks?: unknown })?.hooks)
        ? (parsed as { hooks: unknown[] }).hooks
        : [];
    return arr.filter((item): item is Hook => {
      if (typeof item !== "object" || item === null) return false;
      const hook = item as Record<string, unknown>;
      return typeof hook.id === "string" && typeof hook.event === "string" && typeof hook.action === "object" && hook.action !== null;
    });
  } catch {
    return [];
  }
}

engineRouter.get("/api/workspaces/:id/hook-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listHookEvaluations(req.params.id));
});

engineRouter.get("/api/workspaces/:id/hook-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listHookEvalSets(req.params.id));
});

engineRouter.post("/api/workspaces/:id/hook-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const cases = parseHookEvaluationCases(req.body?.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!cases.length) return res.status(400).json({ error: "cases required" });
  res.json(createHookEvalSet(req.params.id, name, cases));
});

engineRouter.patch("/api/hook-case-sets/:id", (req, res) => {
  const existing = getHookEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "hook case set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const cases = req.body?.cases === undefined ? existing.cases : parseHookEvaluationCases(req.body.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!cases.length) return res.status(400).json({ error: "cases required" });
  res.json(updateHookEvalSet(existing.id, name, cases));
});

engineRouter.delete("/api/hook-case-sets/:id", (req, res) => {
  const existing = getHookEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "hook case set not found" });
  res.json({ ok: deleteHookEvalSet(existing.id) });
});

engineRouter.get("/api/hook-evaluations/:id", (req, res) => {
  const evaluation = getHookEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "hook evaluation not found" });
  res.json(evaluation);
});

engineRouter.post("/api/workspaces/:id/hook-evaluations/run", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseHookEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const summary = runHookEvaluation({
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      hooks: readHooksForEval(),
      cases: parsed.value.cases,
      repeat: parsed.value.repeat,
    });
    res.json(saveHookEvaluation(workspace.id, parsed.value.repeat, parsed.value.cases, summary));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.post("/api/hook-evaluations/:id/archive", (req, res) => {
  const evaluation = getHookEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "hook evaluation not found" });
  const workspace = getWorkspace(evaluation.workspaceId);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  res.json(archiveHookEvaluation(workspace.rootPath, evaluation));
});

engineRouter.post("/api/workspaces/:id/document-eval/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseDocumentEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const resultId = randomUUID();
  try {
    const results = await runDocumentEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: resultId,
      model: parsed.value.model,
      cases: parsed.value.cases,
    });
    documentEvalResults.set(resultId, { workspaceId: workspace.id, results, createdAt: Date.now() });
    res.json({ resultId });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.get("/api/workspaces/:id/document-eval/results/:resultId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const item = documentEvalResults.get(req.params.resultId);
  if (!item || item.workspaceId !== req.params.id) return res.status(404).json({ error: "document evaluation result not found" });
  res.json(item.results);
});

// ---- tool evaluations（从 index.ts 迁入·P5-C0 批1·只搬不改，路径不变）----
engineRouter.post("/api/workspaces/:id/tool-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseToolEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tool = getExtractionTool(parsed.value.toolId);
  if (!tool) return res.status(404).json({ error: "extraction tool not found" });
  try {
    const summary = await runToolEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      tool,
      cases: parsed.value.cases,
      repeat: parsed.value.repeat,
    });
    const evaluation = saveToolEvaluation(
      workspace.id,
      parsed.value.toolId,
      parsed.value.repeat,
      parsed.value.cases,
      summary,
    );
    res.json(evaluation);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

engineRouter.get("/api/workspaces/:id/tool-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listToolEvaluations(req.params.id));
});

engineRouter.get("/api/workspaces/:id/tool-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const toolId = typeof req.query.toolId === "string" && req.query.toolId.trim() ? req.query.toolId.trim() : undefined;
  res.json(listToolCaseSets(req.params.id, toolId));
});

engineRouter.post("/api/workspaces/:id/tool-case-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const toolId = String(req.body?.toolId ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  if (!toolId) return res.status(400).json({ error: "toolId required" });
  if (!getExtractionTool(toolId)) return res.status(404).json({ error: "extraction tool not found" });
  const cases = parseToolEvaluationCases(req.body?.cases);
  if (cases.length === 0) return res.status(400).json({ error: "cases required" });
  res.json(createToolCaseSet(req.params.id, name, toolId, cases));
});

engineRouter.patch("/api/tool-case-sets/:id", (req, res) => {
  const existing = getToolCaseSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "tool case set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const toolId = req.body?.toolId === undefined ? existing.toolId : String(req.body.toolId ?? "").trim();
  const cases = req.body?.cases === undefined ? existing.cases : parseToolEvaluationCases(req.body.cases);
  if (!name) return res.status(400).json({ error: "name required" });
  if (!toolId) return res.status(400).json({ error: "toolId required" });
  if (!getExtractionTool(toolId)) return res.status(404).json({ error: "extraction tool not found" });
  if (cases.length === 0) return res.status(400).json({ error: "cases required" });
  res.json(updateToolCaseSet(existing.id, name, toolId, cases));
});

engineRouter.delete("/api/tool-case-sets/:id", (req, res) => {
  const existing = getToolCaseSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "tool case set not found" });
  res.json({ ok: deleteToolCaseSet(existing.id) });
});

engineRouter.get("/api/tool-evaluations/:id", (req, res) => {
  const evaluation = getToolEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "tool evaluation not found" });
  res.json(evaluation);
});

// ---- skill evaluations（从 index.ts 迁入·P5-C0 批2·只搬不改，路径不变；curate/apply/archive 仍留 index.ts）----
engineRouter.get("/api/workspaces/:id/skill-evaluations", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSkillEvaluations(req.params.id));
});

const LAB_KINDS: LabKind[] = ["skill", "tool", "prompt", "command", "subagent", "hook"];

function parseLabKind(value: unknown): LabKind | undefined {
  return LAB_KINDS.includes(value as LabKind) ? (value as LabKind) : undefined;
}

const HARNESS_COMPONENTS: HarnessComponent[] = ["prompt", "command", "subagent", "hook", "skill", "memory", "tool"];
const CHANGE_OUTCOMES: ChangeOutcome[] = ["accept", "revise", "reject", "defer"];

function parseHarnessComponent(value: unknown): HarnessComponent | undefined {
  return HARNESS_COMPONENTS.includes(value as HarnessComponent) ? (value as HarnessComponent) : undefined;
}

function parseChangeOutcome(value: unknown): ChangeOutcome | undefined {
  return CHANGE_OUTCOMES.includes(value as ChangeOutcome) ? (value as ChangeOutcome) : undefined;
}

function parseEvalAnnotationStatus(value: unknown): EvalAnnotationStatus | undefined {
  return value === "candidate" || value === "confirmed" || value === "rejected" ? value : undefined;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function getLabEvaluation(lab: LabKind, evaluationId: string): unknown {
  if (!evaluationId.trim()) return null;
  if (lab === "skill") return getSkillEvaluation(evaluationId);
  if (lab === "tool") return getToolEvaluation(evaluationId);
  if (lab === "prompt") return getPromptEvaluation(evaluationId);
  if (lab === "command") return getCommandEvaluation(evaluationId);
  if (lab === "subagent") return getSubAgentEvaluation(evaluationId);
  if (lab === "hook") return getHookEvaluation(evaluationId);
  return null;
}

engineRouter.get("/api/harness/change-manifests", (req, res) => {
  const component = typeof req.query.component === "string" ? parseHarnessComponent(req.query.component) : undefined;
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  res.json(listChangeManifests({ component, limit }));
});

engineRouter.post("/api/harness/change-manifests", (req, res) => {
  const component = parseHarnessComponent(req.body?.component);
  const outcome = parseChangeOutcome(req.body?.outcome ?? "defer");
  if (!component) return res.status(400).json({ error: "component required" });
  if (!outcome) return res.status(400).json({ error: "invalid outcome" });
  const predictedFix = parseStringList(req.body?.predictedFix);
  const predictedRegression = parseStringList(req.body?.predictedRegression);
  if (predictedFix.length === 0 && predictedRegression.length === 0) {
    return res.status(400).json({ error: "predictedFix or predictedRegression required" });
  }
  res.json(saveChangeManifest({
    editId: typeof req.body?.editId === "string" && req.body.editId.trim() ? req.body.editId.trim() : undefined,
    component,
    failureEvidence: String(req.body?.failureEvidence ?? "").trim(),
    rootCause: String(req.body?.rootCause ?? "").trim(),
    targetedFix: String(req.body?.targetedFix ?? "").trim(),
    predictedFix,
    predictedRegression,
    outcome,
    outcomeReason: typeof req.body?.outcomeReason === "string" ? req.body.outcomeReason.trim() || undefined : undefined,
  }));
});

engineRouter.get("/api/harness/change-manifests/:editId", (req, res) => {
  const manifest = getChangeManifest(req.params.editId);
  if (!manifest) return res.status(404).json({ error: "change manifest not found" });
  res.json(manifest);
});

engineRouter.get("/api/harness/change-manifests/:editId/revisions", (req, res) => {
  res.json(listScopedRevisions(req.params.editId));
});

engineRouter.post("/api/harness/scoped-revisions", (req, res) => {
  const component = parseHarnessComponent(req.body?.component);
  if (!component) return res.status(400).json({ error: "component required" });
  const manifestEditId = String(req.body?.manifestEditId ?? "").trim();
  if (!manifestEditId || !getChangeManifest(manifestEditId)) return res.status(400).json({ error: "valid manifestEditId required" });
  const resourceId = String(req.body?.resourceId ?? "").trim();
  const scope = String(req.body?.scope ?? "").trim();
  if (!resourceId || !scope) return res.status(400).json({ error: "resourceId and scope required" });
  res.json(saveScopedRevision({
    component,
    resourceId,
    scope,
    beforeSnapshot: String(req.body?.beforeSnapshot ?? ""),
    afterSnapshot: String(req.body?.afterSnapshot ?? ""),
    manifestEditId,
  }));
});

engineRouter.post("/api/harness/scoped-revisions/:editId/rollback", (req, res) => {
  const revision = getScopedRevision(req.params.editId);
  if (!revision) return res.status(404).json({ error: "scoped revision not found" });
  res.json({
    revision,
    rollback: {
      component: revision.component,
      resourceId: revision.resourceId,
      scope: revision.scope,
      restoredSnapshot: revision.beforeSnapshot,
      applied: false,
      reason: "typed scoped revision resolved; component-specific writeback must be applied by the owning editor",
    },
  });
});

engineRouter.post("/api/harness/change-manifests/:editId/attribute", (req, res) => {
  const manifest = getChangeManifest(req.params.editId);
  if (!manifest) return res.status(404).json({ error: "change manifest not found" });
  const lab = parseLabKind(req.body?.lab);
  if (!lab) return res.status(400).json({ error: "valid lab required" });
  const before = getLabEvaluation(lab, String(req.body?.beforeEvaluationId ?? ""));
  const after = getLabEvaluation(lab, String(req.body?.afterEvaluationId ?? ""));
  if (!before || !after) return res.status(404).json({ error: "before/after evaluation not found" });
  const result = attributeHarnessEdit({ manifest, lab, beforeEvaluation: before, afterEvaluation: after });
  if (result.variant) saveHarnessVariant(result.variant);
  res.json(result);
});

engineRouter.get("/api/harness/variants", (req, res) => {
  const baseEditId = typeof req.query.baseEditId === "string" && req.query.baseEditId.trim() ? req.query.baseEditId.trim() : undefined;
  res.json(listHarnessVariants(baseEditId));
});

function parseAgentTrajectory(value: unknown): AgentTrajectory | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const runId = typeof raw.runId === "string" ? raw.runId.trim() : "";
  const module = raw.module;
  const outcome = raw.outcome;
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = stepsRaw
    .map((step) => {
      if (typeof step !== "object" || step === null) return null;
      const s = step as Record<string, unknown>;
      const stage = typeof s.stage === "string" ? s.stage.trim() : "";
      const input = typeof s.input === "string" ? s.input : "";
      const output = typeof s.output === "string" ? s.output : "";
      if (!stage) return null;
      // 红线兜底：入站轨迹（含 D-EVOLVE2 手动构造路径）一律再脱敏，不信任客户端——
      // 抓 draw_data/0NN_raw 裸路径串 + 强制 2400 截断，与自动沉淀路径同口径。
      const parsed: AgentTrajectory["steps"][number] = {
        stage,
        input: sanitizeTrajectoryText(input),
        output: sanitizeTrajectoryText(output),
      };
      if (typeof s.citation === "string" && s.citation.trim()) parsed.citation = s.citation.trim();
      return parsed;
    })
    .filter((step): step is AgentTrajectory["steps"][number] => Boolean(step));
  if (!runId || (module !== "monitor" && module !== "anax" && module !== "flow" && module !== "chat")) return null;
  if (outcome !== "pass" && outcome !== "fail") return null;
  return { runId, module, steps, outcome };
}

engineRouter.get("/api/workspaces/:id/evolve/trajectories", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const module = typeof req.query.module === "string" && ["monitor", "anax", "flow", "chat"].includes(req.query.module) ? req.query.module as AgentTrajectory["module"] : undefined;
  const runId = typeof req.query.runId === "string" && req.query.runId.trim() ? req.query.runId.trim() : undefined;
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  res.json(listAgentTrajectories({ workspaceId: req.params.id, runId, module, limit }));
});

engineRouter.post("/api/workspaces/:id/evolve/trajectories", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const trajectory = parseAgentTrajectory(req.body?.trajectory ?? req.body);
  if (!trajectory) return res.status(400).json({ error: "valid trajectory required" });
  res.json(saveAgentTrajectory({ workspaceId: req.params.id, trajectory }));
});

engineRouter.get("/api/workspaces/:id/evolve/eval-records", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const annotationStatus = req.query.status === undefined ? undefined : parseEvalAnnotationStatus(req.query.status);
  if (req.query.status !== undefined && !annotationStatus) return res.status(400).json({ error: "invalid status" });
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  res.json(listEvalRecords({ workspaceId: req.params.id, annotationStatus, limit }));
});

engineRouter.post("/api/workspaces/:id/evolve/eval-records", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const failingTrace = parseAgentTrajectory(req.body?.failingTrace);
  if (!failingTrace) return res.status(400).json({ error: "valid failingTrace required" });
  const expectedOutput = String(req.body?.expectedOutput ?? "").trim();
  const passCondition = String(req.body?.passCondition ?? "").trim();
  if (!expectedOutput || !passCondition) return res.status(400).json({ error: "expectedOutput and passCondition required" });
  const annotationStatus = parseEvalAnnotationStatus(req.body?.annotationStatus ?? "candidate");
  if (!annotationStatus) return res.status(400).json({ error: "invalid annotationStatus" });
  res.json(createEvalRecord(req.params.id, {
    sourceFindingId: typeof req.body?.sourceFindingId === "string" && req.body.sourceFindingId.trim() ? req.body.sourceFindingId.trim() : undefined,
    failingTrace,
    expectedOutput,
    passCondition,
    annotationStatus,
  }));
});

engineRouter.get("/api/workspaces/:id/evolve/eval-records/:recordId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const record = getEvalRecord(req.params.id, req.params.recordId);
  if (!record) return res.status(404).json({ error: "eval record not found" });
  res.json(record);
});

engineRouter.patch("/api/workspaces/:id/evolve/eval-records/:recordId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const annotationStatus = parseEvalAnnotationStatus(req.body?.annotationStatus);
  if (!annotationStatus) return res.status(400).json({ error: "valid annotationStatus required" });
  const record = updateEvalRecordStatus(req.params.id, req.params.recordId, annotationStatus);
  if (!record) return res.status(404).json({ error: "eval record not found" });
  res.json(record);
});

engineRouter.post("/api/workspaces/:id/evolve/eval-records/:recordId/change-manifest", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const record = getEvalRecord(req.params.id, req.params.recordId);
  if (!record) return res.status(404).json({ error: "eval record not found" });
  const component = req.body?.component === undefined ? undefined : parseHarnessComponent(req.body.component);
  if (req.body?.component !== undefined && !component) return res.status(400).json({ error: "invalid component" });
  const manifest = saveChangeManifest(buildChangeManifestFromEvalRecord({ record, component }));
  res.json({ manifest, applied: false, humanGate: true });
});

// 跨 lab 回归看板：聚合六类评测历史为统一时间线（只读，不重算/不触发评测）
engineRouter.get("/api/workspaces/:id/lab-timelines", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const lab = typeof req.query.lab === "string" ? parseLabKind(req.query.lab) : undefined;
  const resourceId = typeof req.query.resourceId === "string" ? req.query.resourceId : undefined;
  res.json(buildLabTimelines(req.params.id, { lab, resourceId }));
});

// CI gate：给定资源 + 阈值判 pass/regression
engineRouter.post("/api/workspaces/:id/lab-regression-gate", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const lab = parseLabKind(req.body?.lab);
  if (!lab) return res.status(400).json({ error: "lab required (skill|tool|prompt|command|subagent|hook)" });
  const resourceId = String(req.body?.resourceId ?? "").trim();
  if (!resourceId) return res.status(400).json({ error: "resourceId required" });
  const thresholds = parseRegressionGateThresholds(req.body);
  res.json(evaluateRegressionGate({ workspaceId: req.params.id, lab, resourceId, thresholds }));
});

engineRouter.get("/api/workspaces/:id/skill-eval-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSkillEvalSets(req.params.id));
});

engineRouter.post("/api/workspaces/:id/skill-eval-sets", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  const tasks = parseSkillEvalSetTasks(req.body?.tasks);
  if (!name) return res.status(400).json({ error: "name required" });
  if (tasks.length === 0) return res.status(400).json({ error: "tasks required" });
  res.json(createSkillEvalSet(req.params.id, name, tasks));
});

engineRouter.patch("/api/skill-eval-sets/:id", (req, res) => {
  const existing = getSkillEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "skill eval set not found" });
  const name = req.body?.name === undefined ? existing.name : String(req.body.name ?? "").trim();
  const tasks = req.body?.tasks === undefined ? existing.tasks : parseSkillEvalSetTasks(req.body.tasks);
  if (!name) return res.status(400).json({ error: "name required" });
  if (tasks.length === 0) return res.status(400).json({ error: "tasks required" });
  res.json(updateSkillEvalSet(existing.id, name, tasks));
});

engineRouter.delete("/api/skill-eval-sets/:id", (req, res) => {
  const existing = getSkillEvalSet(req.params.id);
  if (!existing) return res.status(404).json({ error: "skill eval set not found" });
  res.json({ ok: deleteSkillEvalSet(existing.id) });
});

engineRouter.get("/api/skill-evaluations/:id", (req, res) => {
  const evaluation = getSkillEvaluation(req.params.id);
  if (!evaluation) return res.status(404).json({ error: "skill evaluation not found" });
  res.json(evaluation);
});

engineRouter.post("/api/workspaces/:id/skill-evaluations/run", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseSkillEvaluationRunRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const variants = parsed.value.variants.map((variant) => ({
      ...variant,
      skillPaths: validateSkillPaths(workspace.rootPath, variant.skillPaths, { mode: "strict" }) ?? [],
    }));
    const summary = await runSkillEvaluation({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      evaluationId: randomUUID(),
      model: parsed.value.model,
      variants,
      tasks: parsed.value.tasks,
      repeat: parsed.value.repeat,
      judgeRepeat: parsed.value.judgeRepeat,
      contextPrefix: parsed.value.contextPrefix,
      dataContextPaths: parsed.value.dataContextPaths,
    });
    const evaluation = saveSkillEvaluation(
      workspace.id,
      parsed.value.model,
      parsed.value.repeat,
      variants,
      parsed.value.tasks,
      parsed.value.contextPrefix,
      summary,
    );
    res.json(evaluation);
    autoTriggerCuration({
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      model: parsed.value.model,
      evaluation,
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

function parseSkillEvalSetTasks(value: unknown): Array<{ id: string; prompt: string; expectedPoints?: string[]; rubric?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) return [];
    const raw = item as Record<string, unknown>;
    const prompt = String(raw.prompt ?? "").trim();
    if (!prompt) return [];
    const id = String(raw.id ?? `task_${index + 1}`).trim() || `task_${index + 1}`;
    const expectedPoints = Array.isArray(raw.expectedPoints)
      ? raw.expectedPoints.map((point) => String(point).trim()).filter(Boolean)
      : [];
    const rubric = String(raw.rubric ?? "").trim();
    return [{
      id,
      prompt,
      ...(expectedPoints.length ? { expectedPoints } : {}),
      ...(rubric ? { rubric } : {}),
    }];
  });
}

function parsePromptEvalTasks(value: unknown): import("../types.ts").PromptEvalTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) return [];
    const raw = item as Record<string, unknown>;
    const prompt = String(raw.prompt ?? "").trim();
    if (!prompt) return [];
    const id = String(raw.id ?? `task_${index + 1}`).trim() || `task_${index + 1}`;
    const expectedPoints = Array.isArray(raw.expectedPoints)
      ? raw.expectedPoints.filter((point): point is string => typeof point === "string" && point.trim().length > 0).map((point) => point.trim())
      : undefined;
    const rubric = typeof raw.rubric === "string" && raw.rubric.trim() ? raw.rubric.trim() : undefined;
    return [{ id, prompt, expectedPoints, rubric }];
  });
}

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

function traceEngineSessionEvent(
  session: Session,
  type: string,
  status: string,
  detail?: string | null,
  payload?: unknown,
): string {
  return addTraceEvent({
    workspaceId: session.workspaceId,
    targetKind: "session",
    targetId: session.id,
    type,
    target: session.title,
    status,
    detail,
    payload,
  }).id;
}

function updateEngineSessionTrace(eventId: string, status: "success" | "failed", detail: string, payload: unknown): void {
  db.prepare("UPDATE trace_events SET status = ?, detail = ?, payload = ? WHERE id = ?")
    .run(status, detail, JSON.stringify(payload), eventId);
}

function countSessionConsolidations(workspaceId: string, sessionId: string): number {
  return getTraceTimeline(workspaceId, "session", sessionId)
    .filter((event) => event.type === "memory_consolidation")
    .length;
}

function buildFlowMemoryRetrievalContext(flowId: string, query: string): RetrievalContext {
  const recentMessages = listFlowMessages(flowId)
    .slice(-8)
    .flatMap((message) => {
      const text = flowMessageText(message.content).trim();
      return text ? [`${message.role}: ${text}`] : [];
    });
  // X-MEM2-CTX：flow 名下 clean_data 文件路径 → data:<stem> 检索 boost 信号（不参与硬过滤）。
  const flow = getFlow(flowId);
  const dataPaths = flow
    ? listWorkspacePaths(flow.workspaceId, "clean_data", undefined, flowId)
        .filter((p) => p.kind === "file")
        .map((p) => p.path)
    : [];
  return {
    query: query.trim(),
    ...(recentMessages.length > 0 ? { recentMessages } : {}),
    ...(dataPaths.length > 0 ? { dataPaths } : {}),
  };
}

function maybeTriggerFlowMemoryConsolidation(input: {
  workspace: { id: string; rootPath: string };
  flow: Flow;
  targetKind: Extract<MemoryConsolidationTargetKind, "flow" | "flow_run">;
  targetId: string;
  traceRunId?: string;
}): void {
  fireMemoryConsolidation({
    workspaceId: input.workspace.id,
    workspaceRoot: input.workspace.rootPath,
    targetKind: input.targetKind,
    targetId: input.targetId,
    label: `自动记忆沉淀：${input.flow.name}`,
    onError: (err) => {
      traceFlowEvent(input.flow.id, "memory_consolidation_failed", "failed", String(err), {
        targetKind: input.targetKind,
        targetId: input.targetId,
      }, input.traceRunId);
    },
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
  const content = readFlowFile(flow.folderPath, "workflow.json").content;
  if (content === null) {
    return res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
  }

  let workflow: WorkflowLike;
  try {
    workflow = JSON.parse(content) as WorkflowLike;
  } catch (err) {
    return res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true, warning: `workflow.json is invalid: ${String(err)}` });
  }

  try {
    const normalized = normalizeWorkflowSkills(flow.folderPath, normalizeWorkflowModels(structuredClone(workflow)));
    return res.json({ workflow: normalized, inferred: false });
  } catch (err) {
    // A valid workflow file is the source of truth even when its runtime model/skill
    // configuration is stale. Returning an inferred workflow here hides user changes.
    return res.json({ workflow, inferred: false, warning: String(err) });
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

// 知识库「收集」联网聊天（X-COLLECT3）：收集独立于业务工作区，所有收集 session 挂全局容器 ws，
// 走 /api/collect/* 全局路由（不接受业务 :workspaceId）。多会话 + 文件夹分类。
// 注：X-COLLECT0 的 POST /api/workspaces/:id/collect-session 单例路由已废弃（被本组路由替代）。
engineRouter.get("/api/collect/sessions", (_req, res) => {
  res.json(listCollectSessions());
});
engineRouter.post("/api/collect/sessions", (req, res) => {
  const title = String(req.body?.title ?? "新会话").trim() || "新会话";
  const folderId = typeof req.body?.folderId === "string" ? req.body.folderId : null;
  if (folderId && !getCollectFolder(folderId)) return res.status(404).json({ error: "collect folder not found" });
  res.json(createCollectSession(title, folderId));
});
// 收集 session 改名 / 改文件夹归属（folderId: string 归入 / null 移出到未分类）。
engineRouter.patch("/api/collect/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session || session.workspaceId !== COLLECT_WORKSPACE_ID) return res.status(404).json({ error: "collect session not found" });
  if (typeof req.body?.title === "string") {
    const t = req.body.title.trim();
    if (t) renameSession(req.params.id, t);
  }
  if ("folderId" in (req.body ?? {})) {
    const folderId = typeof req.body.folderId === "string" ? req.body.folderId : null;
    if (folderId && !getCollectFolder(folderId)) return res.status(404).json({ error: "collect folder not found" });
    setCollectSessionFolder(req.params.id, folderId);
  }
  res.json(listCollectSessions().find((item) => item.id === req.params.id) ?? getSession(req.params.id));
});
engineRouter.delete("/api/collect/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session || session.workspaceId !== COLLECT_WORKSPACE_ID) return res.status(404).json({ error: "collect session not found" });
  deleteSession(req.params.id);
  res.json({ ok: true });
});
engineRouter.get("/api/collect/folders", (_req, res) => {
  res.json(listCollectFolders());
});
engineRouter.post("/api/collect/folders", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  res.json(createCollectFolder(name));
});
engineRouter.patch("/api/collect/folders/:id", (req, res) => {
  if (!getCollectFolder(req.params.id)) return res.status(404).json({ error: "collect folder not found" });
  let updated = getCollectFolder(req.params.id);
  if (typeof req.body?.name === "string") {
    const name = req.body.name.trim();
    if (!name) return res.status(400).json({ error: "name required" });
    updated = renameCollectFolder(req.params.id, name);
  }
  if (req.body?.sort !== undefined) {
    const sort = Number(req.body.sort);
    if (!Number.isFinite(sort)) return res.status(400).json({ error: "sort must be a number" });
    updated = reorderCollectFolder(req.params.id, sort);
  }
  res.json(updated);
});
engineRouter.delete("/api/collect/folders/:id", (req, res) => {
  if (!deleteCollectFolder(req.params.id)) return res.status(404).json({ error: "collect folder not found" });
  res.json({ ok: true });
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

const COMMAND_KEYS = new Set(["id", "name", "enabled", "description", "argumentHint", "template", "params", "skillSlugs", "toolIds", "toolParamMap", "source"]);
const COMMAND_PARAM_KEYS = new Set(["key", "label", "required", "type", "options", "source"]);
const COMMAND_PARAM_TYPES = new Set<XanCommandParamType>(["text", "select", "file"]);
const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function coerceCommand(input: unknown): XanCommand | null {
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

  let toolIds: string[] | undefined;
  if (o.toolIds !== undefined) {
    if (!Array.isArray(o.toolIds)) return null;
    const analysisToolIds = listAiExposedToolIds(listExtractionTools());
    toolIds = [];
    for (const rawToolId of o.toolIds) {
      const toolId = asCommandString(rawToolId);
      if (!toolId || !analysisToolIds.has(toolId)) return null;
      if (!toolIds.includes(toolId)) toolIds.push(toolId);
    }
  }

  let toolParamMap: Record<string, string> | undefined;
  if (o.toolParamMap !== undefined) {
    const map = toRecord(o.toolParamMap);
    if (Array.isArray(o.toolParamMap)) return null;
    toolParamMap = {};
    for (const [key, value] of Object.entries(map)) {
      if (!SAFE_COMMAND_NAME.test(key)) return null;
      const target = asCommandString(value);
      if (!target || !SAFE_COMMAND_NAME.test(target)) return null;
      toolParamMap[key] = target;
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
    ...(toolIds && toolIds.length > 0 ? { toolIds } : {}),
    ...(toolParamMap && Object.keys(toolParamMap).length > 0 ? { toolParamMap } : {}),
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

engineRouter.get("/api/workspaces/:id/sessions/:sessionId/consolidation-count", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (session.workspaceId !== workspace.id) return res.status(403).json({ error: "session belongs to another workspace" });
  res.json({ count: countSessionConsolidations(workspace.id, session.id) });
});

// 记忆 v2.0 缺口3 · Dream Worker 手动触发：纯算术维护(升/降 confidence、老化退役)。
// dryRun=true 只返回拟调整明细不落库；供面板按钮/手动跑（搭车触发已在 fireMemoryConsolidation）。
engineRouter.post("/api/workspaces/:id/memory/maintain", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const dryRun = (req.body as { dryRun?: unknown } | null)?.dryRun === true;
  try {
    res.json(runMemoryMaintenance({ workspaceId: workspace.id, dryRun }));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

function parseCounterfactualProbeRuns(value: unknown): CounterfactualProbeRun[] {
  if (!Array.isArray(value)) return [];
  const out: CounterfactualProbeRun[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const write = record.write === "agent" || record.write === "oracle" ? record.write : null;
    const read = record.read === "agent" || record.read === "oracle" ? record.read : null;
    const accuracy = typeof record.accuracy === "number" && Number.isFinite(record.accuracy) ? record.accuracy : null;
    if (!write || !read || accuracy === null) continue;
    out.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `${write}-${read}`,
      write,
      read,
      accuracy: Math.max(0, Math.min(1, accuracy)),
    });
  }
  return out;
}

function parseScoreSeries(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .map((item) => Math.max(0, Math.min(1, item)));
}

// AgingBench · E-AGING1：Dream Worker 记忆老化巡检（干扰/修订 + 反事实归因）。
// 只读即时诊断，不落库、不调 LLM；probes/scoreSeries 可由人工 oracle 小验证集传入。
engineRouter.post("/api/workspaces/:id/memory/aging-inspect", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    res.json(runMemoryAgingInspection({
      workspaceId: workspace.id,
      probes: parseCounterfactualProbeRuns(body.probes),
      scoreSeries: parseScoreSeries(body.scoreSeries),
    }));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// 记忆 v2.0 缺口4：把 Dream Worker 提纯后的高频 experience 聚类升级为 skill candidate。
// 记忆读取只走 D API；dryRun 不调 LLM、不写 registry；正式执行复用既有 skill distillation + candidate 门禁。
engineRouter.post("/api/workspaces/:id/memory/promote-skills", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseMemorySkillPromotionBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const result = await runMemoryToSkillPromotion({
      workspaceId: workspace.id,
      dryRun: parsed.value.dryRun,
      thresholds: parsed.value.thresholds,
      maxPromotions: parsed.value.maxPromotions,
      listExperiences: (workspaceId) => fetchMemoryExperiences(requestBaseUrl(req), workspaceId),
      distillCluster: (cluster, transcript) => distillSkillCandidate({
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
        transcript,
        model: parsed.value.model,
        timeoutMs: parsed.value.timeoutMs,
        duplicateThreshold: parsed.value.duplicateThreshold,
        dryRun: false,
        originSessionId: null,
        usageTargetId: `memory-cluster:${cluster.tag}`,
        usageTitle: `记忆升级 Skill：${cluster.tag}`,
      }),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

engineRouter.post("/api/workspaces/:id/sessions/:sessionId/consolidate-trace", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (session.workspaceId !== workspace.id) return res.status(403).json({ error: "session belongs to another workspace" });

  const traceEventId = traceEngineSessionEvent(session, "memory_consolidation", "running", "手动沉淀 trace", { trigger: "manual" });
  const baseUrl = requestBaseUrl(req);
  try {
    const result = await runMemoryConsolidation({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      targetKind: "session",
      targetId: session.id,
      dryRun: false,
      timeoutMs: 60_000,
      onEvent: (event) => trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: "session",
        targetId: session.id,
        title: "手动记忆沉淀",
      }, event),
      ingestCandidate: (candidate, context) => postMemoryCandidateToDIngest(
        baseUrl,
        "/api/workspaces/:id/memory/ingest",
        candidate,
        context,
      ),
    });
    const ingested = result.ingested.filter((item) => item.ok && Boolean(item.itemId)).length;
    const review = result.ingested.filter((item) => item.ok && !item.itemId).length;
    const failedItems = result.ingested.filter((item) => !item.ok);
    const failures = failedItems.map((item) => item.error ?? "候选未通过记忆门禁");
    const detail = `手动沉淀完成：候选 ${result.candidates.length} 条，新增 ${ingested} 条，待复核 ${review} 条`;
    updateEngineSessionTrace(traceEventId, "success", detail, {
      trigger: "manual",
      candidates: result.candidates.length,
      ingested,
      review,
      failures: failures.length,
    });
    res.json({
      count: countSessionConsolidations(workspace.id, session.id),
      candidates: result.candidates.length,
      ingested,
      review,
      ok: failedItems.length === 0,
      ...(failures.length > 0 ? { error: failures.join("；") } : {}),
    });
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err);
    updateEngineSessionTrace(traceEventId, "failed", `手动沉淀失败：${error}`, { trigger: "manual", error });
    traceEngineSessionEvent(session, "memory_consolidation_failed", "failed", error, {
      targetKind: "session",
      targetId: session.id,
    });
    res.status(500).json({
      count: countSessionConsolidations(workspace.id, session.id),
      candidates: 0,
      ingested: 0,
      review: 0,
      ok: false,
      error,
    });
  }
});

engineRouter.post("/api/workspaces/:id/sessions/:sessionId/distill-prompt", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (session.workspaceId !== workspace.id) return res.status(403).json({ error: "session belongs to another workspace" });

  const traceEventId = traceEngineSessionEvent(session, "prompt_distillation", "running", "手动沉淀 prompt", { trigger: "manual" });
  const model = String(req.body?.model ?? "").trim() || undefined;
  try {
    const draft = await runPromptDistillation({
      workspaceRoot: workspace.rootPath,
      sessionId: session.id,
      messages: listMessages(session.id),
      model,
      timeoutMs: 180_000,
      onEvent: (event) => trackUsageEvent({
        workspaceId: workspace.id,
        targetKind: "session",
        targetId: session.id,
        title: "手动 Prompt 沉淀",
      }, event),
    });
    updateEngineSessionTrace(
      traceEventId,
      "success",
      draft ? `Prompt 草稿已生成：${draft.title}` : "本轮无可沉淀 Prompt",
      { trigger: "manual", hasDraft: Boolean(draft) },
    );
    res.json({ draft });
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err);
    updateEngineSessionTrace(traceEventId, "failed", `Prompt 沉淀失败：${error}`, { trigger: "manual", error });
    traceEngineSessionEvent(session, "prompt_distillation_failed", "failed", error, {
      targetKind: "session",
      targetId: session.id,
    });
    res.status(500).json({ error });
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

type ParsedMemorySkillPromotion =
  | {
    ok: true;
    value: {
      dryRun: boolean;
      model?: string;
      timeoutMs: number;
      duplicateThreshold: number;
      maxPromotions: number;
      thresholds: MemorySkillThresholds;
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

function parseMemorySkillPromotionBody(body: unknown): ParsedMemorySkillPromotion {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const timeoutMs = raw.timeoutMs === undefined ? 180_000 : Number(raw.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    return { ok: false, error: "timeoutMs must be an integer between 10000 and 600000" };
  }
  const duplicateThreshold = raw.duplicateThreshold === undefined ? 50 : Number(raw.duplicateThreshold);
  if (!Number.isFinite(duplicateThreshold) || duplicateThreshold <= 0) return { ok: false, error: "duplicateThreshold must be positive" };
  const maxPromotions = raw.maxPromotions === undefined ? 5 : Number(raw.maxPromotions);
  if (!Number.isInteger(maxPromotions) || maxPromotions < 1 || maxPromotions > 10) {
    return { ok: false, error: "maxPromotions must be an integer between 1 and 10" };
  }
  const thresholds: MemorySkillThresholds = {
    highConfidence: raw.highConfidence === undefined ? DEFAULT_MEMORY_SKILL_THRESHOLDS.highConfidence : Number(raw.highConfidence),
    minHighConfidenceItems: raw.minHighConfidenceItems === undefined ? DEFAULT_MEMORY_SKILL_THRESHOLDS.minHighConfidenceItems : Number(raw.minHighConfidenceItems),
    minUsedCount: raw.minUsedCount === undefined ? DEFAULT_MEMORY_SKILL_THRESHOLDS.minUsedCount : Number(raw.minUsedCount),
    minPositiveSignals: raw.minPositiveSignals === undefined ? DEFAULT_MEMORY_SKILL_THRESHOLDS.minPositiveSignals : Number(raw.minPositiveSignals),
  };
  if (!Number.isFinite(thresholds.highConfidence) || thresholds.highConfidence < 0 || thresholds.highConfidence > 1) {
    return { ok: false, error: "highConfidence must be between 0 and 1" };
  }
  if (!Number.isInteger(thresholds.minHighConfidenceItems) || thresholds.minHighConfidenceItems < 1 || thresholds.minHighConfidenceItems > 20) {
    return { ok: false, error: "minHighConfidenceItems must be an integer between 1 and 20" };
  }
  if (!Number.isInteger(thresholds.minUsedCount) || thresholds.minUsedCount < 0 || thresholds.minUsedCount > 100_000) {
    return { ok: false, error: "minUsedCount must be an integer between 0 and 100000" };
  }
  if (!Number.isInteger(thresholds.minPositiveSignals) || thresholds.minPositiveSignals < 0 || thresholds.minPositiveSignals > 100_000) {
    return { ok: false, error: "minPositiveSignals must be an integer between 0 and 100000" };
  }
  const model = String(raw.model ?? "").trim() || undefined;
  return {
    ok: true,
    value: {
      dryRun: raw.dryRun !== false,
      model,
      timeoutMs,
      duplicateThreshold,
      maxPromotions,
      thresholds,
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

export async function distillSkillCandidate(input: {
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
  distillText?: (prompt: string) => Promise<string>;
}): Promise<DistillCandidateResult> {
  try {
    const prompt = buildSkillDistillationPrompt(input.transcript);
    const rawOutput = input.distillText
      ? await input.distillText(prompt)
      : await runPiPrompt({
        workspaceRoot: input.workspaceRoot,
        text: prompt,
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

function buildSkillUtilityByPath(workspaceId: string, workspaceRoot: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of listSkillRegistryEntries(workspaceId)) {
    if (entry.status === "archived") continue;
    const quality = entry.prodActivationRate ?? entry.activationRate ?? entry.score ?? 0.5;
    const usageBoost = Math.min(0.15, Math.log1p(Math.max(0, entry.usageCount)) / 40);
    const regressionPenalty = entry.regressionStatus === "regression" ? 0.25 : 0;
    out[resolve(registrySkillPath(workspaceRoot, entry.slug))] = Math.max(0, Math.min(1, quality + usageBoost - regressionPenalty));
  }
  return out;
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
    skillPaths = validateSkillPaths(flow.folderPath, requestedSkillPaths.length > 0 ? requestedSkillPaths : []);
  } catch (err) {
    return send(ws, { type: "error", flowId: flow.id, message: String(err) });
  }
  if (workspace) recordSkillRegistryUsageForPaths(flow.workspaceId, workspace.rootPath, skillPaths);

  const memoryRetrievalContext = buildFlowMemoryRetrievalContext(flow.id, commandExpansion.expandedText);
  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow", {}, memoryRetrievalContext);
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);
  recordMetricInjectionTraces(flow.workspaceId, "workflow", "flow", flow.id, memoryInjection);
  recordBusinessContextInjectionTraces(flow.workspaceId, "workflow", "flow", flow.id, memoryInjection);

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
  const metricSnapshotsThisTurn: MetricSnapshot[] = [];
  const run = runPiTurn({
    // pi runs *inside* the flow folder so its file tools see the workflow as cwd.
    workspaceRoot: flow.folderPath,
    piSessionId: flow.id,
    text: `${contextPrefix}${commandExpansion.expandedText}`,
    model: msg.model,
    injectExtractionToolSystem: hasAnalysisExtractionTools(),
    systemPrompt: withKnowledgePrompt(
      flow.workspaceId,
      msg.injectKnowledgePrompt,
      commandExpansion.expandedText,
      msg.injectRulesPrompt ? withRulesPrompt(flow.workspaceId, "workflow", msg.systemPrompt, memoryRetrievalContext) : msg.systemPrompt,
    ),
    skillPaths,
    allowWeb: false,
    onEvent: (event: PiEvent) => {
      metricSnapshotsThisTurn.push(...collectMetricSnapshotsFromEvent(event));
      const eventForClient: PiEvent = event.type === "message_end"
        ? { ...event, message: appendMetricVerificationBlock((event as Extract<PiEvent, { type: "message_end" }>).message, metricSnapshotsThisTurn) }
        : event;
      trackUsageEvent({
        workspaceId: flow.workspaceId,
        targetKind: "flow",
        targetId: flow.id,
        title: `工作流聊天：${flow.name}`,
      }, eventForClient);
      send(ws, { type: "flow_event", flowId: flow.id, event: eventForClient });
      if (eventForClient.type === "message_end") {
        const { message: m } = eventForClient as Extract<PiEvent, { type: "message_end" }>;
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
  const memoryQuery = Object.entries(msg.inputs ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const memoryRetrievalContext = buildFlowMemoryRetrievalContext(flow.id, memoryQuery || flow.name);
  const memoryInjection = buildMemoryInjectionSnapshot(flow.workspaceId, msg.injectRulesPrompt, "workflow", {}, memoryRetrievalContext);
  recordMemoryInjectionUsage(flow.workspaceId, memoryInjection);
  recordMetricInjectionTraces(flow.workspaceId, "workflow", "flow_run", runRow.id, memoryInjection);
  recordBusinessContextInjectionTraces(flow.workspaceId, "workflow", "flow_run", runRow.id, memoryInjection);
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
      systemPromptPrefix: [
        msg.injectKnowledgePrompt ? buildKnowledgePrompt(flow.workspaceId, memoryQuery || flow.name) : "",
        msg.injectRulesPrompt ? buildMemoryPrompt(flow.workspaceId, "workflow", {}, memoryRetrievalContext) : "",
      ].filter(Boolean).join("\n\n") || undefined,
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
      nodeRunWriter: {
        start: (node) => startFlowNodeRun({
          flowRunId: runRow.id,
          flowId: flow.id,
          nodeId: node.id,
          role: node.role,
          kind: node.kind ?? "agent",
        }).id,
        finish: (nodeRunId, status, outputPath) => {
          finishFlowNodeRun(nodeRunId, { status, outputPath });
        },
      },
      isAborted: () => active.aborted,
      initialBlackboard,
      resumeFromNodeId: msg.resumeFromNodeId,
      gateThresholds: isAnaxFlow ? (() => { const c = getAnaxGateConfig(flow.workspaceId); return { minConfidence: c.minConfidence, minEvidenceCount: c.minEvidenceCount, minDataQualityScore: c.minDataQualityScore }; })() : undefined,
      runBudget: RUN_BUDGET_LIMITS ? { workspaceId: flow.workspaceId, limits: RUN_BUDGET_LIMITS } : undefined,
      dynamicSkillUtilityByPath: workspace ? buildSkillUtilityByPath(flow.workspaceId, workspace.rootPath) : undefined,
    });
    if (activeMultiAgentRuns.get(clientRunId) === active) activeMultiAgentRuns.delete(clientRunId);
    finishFlowRun(runRow.id, active.aborted ? "aborted" : result.code === 0 ? "success" : "failed");
    if (active.aborted || result.code !== 0) {
      saveAgentTrajectory({
        workspaceId: flow.workspaceId,
        trajectory: buildFlowFailureTrajectory({
          runId: runRow.id,
          module: isAnaxFlow ? "anax" : "flow",
          flowId: flow.id,
          flowName: flow.name,
          code: result.code,
          aborted: active.aborted,
          blackboard: result.blackboard,
        }),
      });
    }
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
    saveAgentTrajectory({
      workspaceId: flow.workspaceId,
      trajectory: buildFlowFailureTrajectory({
        runId: runRow.id,
        module: isAnaxFlow ? "anax" : "flow",
        flowId: flow.id,
        flowName: flow.name,
        code: null,
        aborted: active.aborted,
        error: String(err),
      }),
    });
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
      skillPaths: [],
      allowWeb: false,
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
// ══════════════════════════════════════════════════════════════
// E-MONITOR2: 监测指标体系草案 + 监测引擎运行
// ══════════════════════════════════════════════════════════════

import { PORT as MON_PORT } from "../config.ts";
import { draftMetricSystem } from "../monitor-llm.ts";
import { runMonitorChecks, type MonitorDatasetInput, type MonitorRunContext } from "../monitor-engine.ts";
import { summarizeMonitorRun } from "../monitor-priority.ts";
import {
  createMonitorMetricSystem, getMonitorMetricSystem, listMonitorMetricSystems,
  deleteMonitorMetricSystem, insertMonitorRun, finishMonitorRun, insertMonitorFindings,
  listMonitorRuns as listMonRuns, listMonitorFindings, findPriorMonitorFindings,
  archiveMonitorWatchlist, createMonitorWatchlist, getMonitorWatchlist, listMonitorWatchlists, updateMonitorWatchlist,
  type MonitorWatchlist, type MonitorWatchlistInput, type MonitorWatchlistType,
} from "../db/engine.ts";
import type { ActionItemDraft, BiAggregationDataset, BiCell, HealthFinding, HealthSuite, LinkType, LogicRule, MetricDefinition, MonitorDatasetBinding, MonitorMetricSystemDraft, MonitorSourceRole, ObjectType } from "../types.ts";

const MON_BASE = `http://localhost:${MON_PORT}`;
const VALID_MSUITE = new Set<HealthSuite>(["daily","weekly","monthly","quarterly","yearly"]);
const VALID_MONITOR_ROLES = new Set<MonitorSourceRole>(["goal", "source", "industry", "competitor"]);
const VALID_WATCHLIST_TYPES = new Set<MonitorWatchlistType>(["daily", "campaign", "member", "store", "custom"]);
const DEFAULT_WATCHLIST_ID = "default";

type LegacyMonitorConfig = {
  suite?: HealthSuite;
  datasetBindings?: MonitorDatasetBinding[];
  metricSystemId?: string;
  thresholds?: Record<string, number>;
  createdAt?: number;
  updatedAt?: number;
};

type ResolvedWatchlist = MonitorWatchlist & { virtual?: boolean };

async function fetchMonitorAggregations(workspaceId: string): Promise<BiAggregationDataset[]> {
  const resp = await fetch(`${MON_BASE}/api/bi/aggregations?workspaceId=${encodeURIComponent(workspaceId)}`);
  if (!resp.ok) throw new Error(`aggregations fetch: ${resp.status}`);
  return await resp.json() as BiAggregationDataset[];
}

async function fetchMonitorOntologyIds(workspaceId: string): Promise<string[]> {
  const resp = await fetch(`${MON_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/ontologies`);
  if (!resp.ok) throw new Error(`ontologies fetch: ${resp.status}`);
  const rows = await resp.json() as Array<{ id: string }>;
  return rows.map((o) => o.id);
}

async function fetchMonitorOntologyContext(ontologyIds: string[]): Promise<{ objects: ObjectType[]; links: LinkType[]; logics: LogicRule[] }> {
  let objects: ObjectType[] = [];
  let links: LinkType[] = [];
  let logics: LogicRule[] = [];
  for (const oid of ontologyIds) {
    const [objR, lkR, lgR] = await Promise.all([
      fetch(`${MON_BASE}/api/ontologies/${encodeURIComponent(oid)}/objects`),
      fetch(`${MON_BASE}/api/ontologies/${encodeURIComponent(oid)}/links`),
      fetch(`${MON_BASE}/api/ontologies/${encodeURIComponent(oid)}/logic-rules`),
    ]);
    if (objR.ok) objects = objects.concat((await objR.json()) as ObjectType[]);
    if (lkR.ok) links = links.concat((await lkR.json()) as LinkType[]);
    if (lgR.ok) logics = logics.concat((await lgR.json()) as LogicRule[]);
  }
  return { objects, links, logics };
}

async function fetchMonitorMetrics(workspaceId: string): Promise<MetricDefinition[]> {
  const resp = await fetch(`${MON_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/metrics`);
  return resp.ok ? await resp.json() as MetricDefinition[] : [];
}

async function fetchMonitorConfig(workspaceId: string): Promise<LegacyMonitorConfig | null> {
  const resp = await fetch(`${MON_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/monitor/config`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`monitor config fetch: ${resp.status}`);
  return await resp.json() as LegacyMonitorConfig | null;
}

async function validateTargetPlan(workspaceId: string, targetPlanId: string | undefined): Promise<string | null> {
  if (!targetPlanId) return null;
  const resp = await fetch(`${MON_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/monitor/target-plans/${encodeURIComponent(targetPlanId)}`);
  if (resp.status === 404) return "targetPlanId not found in this workspace";
  if (!resp.ok) return `targetPlanId validation failed: ${resp.status}`;
  return null;
}

function normalizeThresholds(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseWatchlistInput(body: unknown, base?: ResolvedWatchlist): MonitorWatchlistInput {
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : base?.name ?? "默认监测";
  const description = typeof raw.description === "string" ? raw.description.trim() : base?.description ?? "";
  if (raw.type !== undefined && !VALID_WATCHLIST_TYPES.has(raw.type as MonitorWatchlistType)) {
    throw new Error("invalid watchlist type");
  }
  if (raw.suite !== undefined && !VALID_MSUITE.has(raw.suite as HealthSuite)) {
    throw new Error("invalid suite");
  }
  const type = VALID_WATCHLIST_TYPES.has(raw.type as MonitorWatchlistType)
    ? raw.type as MonitorWatchlistType
    : base?.type ?? "custom";
  const suite = VALID_MSUITE.has(raw.suite as HealthSuite)
    ? raw.suite as HealthSuite
    : base?.suite ?? "monthly";
  const frequency = typeof raw.frequency === "string" && raw.frequency.trim() ? raw.frequency.trim() : base?.frequency;
  const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : base?.owner;
  const datasetBindings = Array.isArray(raw.datasetBindings)
    ? parseMonitorDatasetBindings(raw.datasetBindings)
    : base?.datasetBindings ?? [];
  const targetPlanId = typeof raw.targetPlanId === "string" && raw.targetPlanId.trim() ? raw.targetPlanId.trim() : base?.targetPlanId;
  const goalDatasetPathId = typeof raw.goalDatasetPathId === "string" && raw.goalDatasetPathId.trim() ? raw.goalDatasetPathId.trim() : base?.goalDatasetPathId;
  const metricSystemId = typeof raw.metricSystemId === "string" && raw.metricSystemId.trim() ? raw.metricSystemId.trim() : base?.metricSystemId;
  const thresholdPolicy = typeof raw.thresholdPolicy === "string" && raw.thresholdPolicy.trim() ? raw.thresholdPolicy.trim() : base?.thresholdPolicy;
  const thresholds = raw.thresholds !== undefined ? normalizeThresholds(raw.thresholds) : base?.thresholds;
  return { name, description, type, suite, frequency, owner, datasetBindings, targetPlanId, goalDatasetPathId, metricSystemId, thresholdPolicy, thresholds };
}

function parseMonitorDatasetBindings(rawBindings: unknown[]): MonitorDatasetBinding[] {
  return rawBindings.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const datasetPathId = typeof item.datasetPathId === "string" ? item.datasetPathId.trim() : "";
    const role = item.role as MonitorSourceRole;
    if (!datasetPathId || !VALID_MONITOR_ROLES.has(role)) {
      throw new Error(`invalid binding: ${JSON.stringify(raw)}`);
    }
    const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined;
    const updatedAt = typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now();
    return { datasetPathId, role, label, updatedAt };
  });
}

function buildVirtualDefaultWatchlist(workspaceId: string, config: LegacyMonitorConfig | null): ResolvedWatchlist {
  const goalBinding = (config?.datasetBindings ?? []).find((binding) => binding.role === "goal");
  const now = Date.now();
  return {
    id: DEFAULT_WATCHLIST_ID,
    workspaceId,
    name: "默认监测",
    description: "兼容旧 monitor config 的虚拟默认计划",
    type: "custom",
    suite: config?.suite ?? "monthly",
    frequency: "manual",
    status: "active",
    datasetBindings: config?.datasetBindings ?? [],
    goalDatasetPathId: goalBinding?.datasetPathId,
    metricSystemId: config?.metricSystemId,
    thresholdPolicy: "legacy-config",
    thresholds: config?.thresholds,
    createdAt: config?.createdAt ?? now,
    updatedAt: config?.updatedAt ?? now,
    archivedAt: null,
    virtual: true,
  };
}

async function listWatchlistsWithDefault(workspaceId: string): Promise<ResolvedWatchlist[]> {
  const real = listMonitorWatchlists(workspaceId);
  if (real.length > 0) return real;
  const config = await fetchMonitorConfig(workspaceId);
  return [buildVirtualDefaultWatchlist(workspaceId, config)];
}

async function resolveWatchlist(workspaceId: string, watchlistId: string): Promise<ResolvedWatchlist | null> {
  if (watchlistId === DEFAULT_WATCHLIST_ID) {
    return buildVirtualDefaultWatchlist(workspaceId, await fetchMonitorConfig(workspaceId));
  }
  const watchlist = getMonitorWatchlist(watchlistId);
  if (!watchlist || watchlist.workspaceId !== workspaceId || watchlist.status === "archived") return null;
  return watchlist;
}

async function validateMonitorWatchlistInput(workspaceId: string, input: MonitorWatchlistInput): Promise<string | null> {
  if (!VALID_MSUITE.has(input.suite)) return "invalid suite";
  const pathIds = new Set<string>();
  for (const binding of input.datasetBindings ?? []) pathIds.add(binding.datasetPathId);
  if (input.goalDatasetPathId) pathIds.add(input.goalDatasetPathId);
  if (pathIds.size > 0) {
    const aggs = await fetchMonitorAggregations(workspaceId);
    const valid = new Set(aggs.map((agg) => agg.pathId));
    const invalid = Array.from(pathIds).filter((pathId) => !valid.has(pathId));
    if (invalid.length > 0) return `pathIds not in this workspace clean_data: ${invalid.join(",")}`;
  }
  if (input.metricSystemId) {
    const metricSystem = getMonitorMetricSystem(input.metricSystemId);
    if (!metricSystem || metricSystem.workspaceId !== workspaceId) return "metricSystemId not found in this workspace";
  }
  return await validateTargetPlan(workspaceId, input.targetPlanId);
}

engineRouter.get("/api/workspaces/:id/monitor/watchlists", async (req, res) => {
  const wid = req.params.id;
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    res.json(await listWatchlistsWithDefault(wid));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

engineRouter.post("/api/workspaces/:id/monitor/watchlists", async (req, res) => {
  const wid = req.params.id;
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    const input = parseWatchlistInput(req.body);
    const validationError = await validateMonitorWatchlistInput(wid, input);
    if (validationError) { res.status(400).json({ error: validationError }); return; }
    res.json(createMonitorWatchlist(wid, input));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

engineRouter.patch("/api/workspaces/:id/monitor/watchlists/:watchlistId", async (req, res) => {
  const wid = req.params.id;
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  try {
    const current = await resolveWatchlist(wid, req.params.watchlistId);
    if (!current) { res.status(404).json({ error: "watchlist not found" }); return; }
    const input = parseWatchlistInput(req.body, current);
    const validationError = await validateMonitorWatchlistInput(wid, input);
    if (validationError) { res.status(400).json({ error: validationError }); return; }
    if (current.virtual) {
      res.json(createMonitorWatchlist(wid, input));
      return;
    }
    const updated = updateMonitorWatchlist(current.id, input);
    res.json(updated);
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

engineRouter.delete("/api/workspaces/:id/monitor/watchlists/:watchlistId", (req, res) => {
  const wid = req.params.id;
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  if (req.params.watchlistId === DEFAULT_WATCHLIST_ID) { res.status(400).json({ error: "default watchlist cannot be archived" }); return; }
  const current = getMonitorWatchlist(req.params.watchlistId);
  if (!current || current.workspaceId !== wid) { res.status(404).json({ error: "watchlist not found" }); return; }
  const archived = archiveMonitorWatchlist(current.id);
  res.json(archived);
});

engineRouter.get("/api/workspaces/:id/monitor/metric-systems", (req, res) => {
  const wid = req.params.id;
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  try { res.json(listMonitorMetricSystems(wid)); } catch (e) { res.status(500).json({ error: String(e) }); }
});

engineRouter.delete("/api/workspaces/:id/monitor/metric-systems/:msId", (req, res) => {
  const ms = getMonitorMetricSystem(req.params.msId);
  if (!ms || ms.workspaceId !== req.params.id) { res.status(404).json({ error: "not found" }); return; }
  try { deleteMonitorMetricSystem(req.params.msId); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

engineRouter.post("/api/workspaces/:id/monitor/metric-system/draft", async (req, res) => {
  const wid = req.params.id;
  const ws = getWorkspace(wid);
  if (!ws) { res.status(404).json({ error: "workspace not found" }); return; }
  const body = req.body ?? {};
  const ontologyId = typeof body.ontologyId === "string" ? body.ontologyId : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;
  try {
    const aggs = await fetchMonitorAggregations(wid);
    let objects: ObjectType[] = [], links: LinkType[] = [], logics: LogicRule[] = [];
    if (ontologyId) {
      const workspaceOntologyIds = await fetchMonitorOntologyIds(wid);
      if (!workspaceOntologyIds.includes(ontologyId)) { res.status(400).json({ error: "ontologyId not found in this workspace" }); return; }
      const ctx = await fetchMonitorOntologyContext([ontologyId]);
      objects = ctx.objects; links = ctx.links; logics = ctx.logics;
    }
    const metrics = await fetchMonitorMetrics(wid);
    const result = await draftMetricSystem((ws as { rootPath?: string }).rootPath ?? process.cwd(), { aggregations: aggs, objects, metrics, links, logicRules: logics }, model);
    if (!result.draft) { res.status(500).json({ error: result.error ?? "draft failed" }); return; }
    res.json({ draft: result.draft });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

engineRouter.post("/api/workspaces/:id/monitor/metric-system/adopt", (req, res) => {
  const wid = req.params.id;
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  const draft = req.body?.draft as MonitorMetricSystemDraft | undefined;
  if (!draft || !Array.isArray(draft.metrics)) { res.status(400).json({ error: "draft required" }); return; }
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name : `metric-system-${new Date().toISOString().slice(0, 10)}`;
  try { const e = createMonitorMetricSystem(wid, name, draft); res.json({ metricSystemId: e.id, entry: e }); } catch (err) { res.status(500).json({ error: String(err) }); }
});

async function runMonitorForWorkspace(req: Request, res: Response, forcedWatchlistId?: string): Promise<void> {
  const wid = req.params.id;
  if (!wid) { res.status(400).json({ error: "workspace id required" }); return; }
  if (!getWorkspace(wid)) { res.status(404).json({ error: "workspace not found" }); return; }
  const requestedWatchlistId = forcedWatchlistId ?? (typeof req.body?.watchlistId === "string" ? req.body.watchlistId : undefined);
  const watchlist = requestedWatchlistId ? await resolveWatchlist(wid, requestedWatchlistId) : null;
  if (requestedWatchlistId && !watchlist) { res.status(404).json({ error: "watchlist not found" }); return; }
  const cfg = requestedWatchlistId ? null : await fetchMonitorConfig(wid);
  if (req.body?.suite !== undefined && !VALID_MSUITE.has(req.body.suite as HealthSuite)) {
    res.status(400).json({ error: "invalid suite" });
    return;
  }
  const suite = VALID_MSUITE.has(req.body?.suite as HealthSuite)
    ? req.body.suite as HealthSuite
    : watchlist?.suite ?? cfg?.suite ?? "monthly";
  let msId: string | null = typeof req.body?.metricSystemId === "string" ? req.body.metricSystemId : null;
  let thresh: Record<string, number> | undefined = normalizeThresholds(req.body?.thresholds);
  let ms: MonitorMetricSystemDraft | null = null;
  let runRec: ReturnType<typeof insertMonitorRun> | null = null;
  try {
    if (!msId) msId = watchlist?.metricSystemId ?? cfg?.metricSystemId ?? null;
    if (!thresh) thresh = watchlist?.thresholds ?? cfg?.thresholds;
    if (watchlist) {
      const validationError = await validateMonitorWatchlistInput(wid, watchlist);
      if (validationError) { res.status(400).json({ error: validationError }); return; }
    }
    if (msId) { const e = getMonitorMetricSystem(msId); if (!e || e.workspaceId !== wid) { res.status(404).json({ error: "metric-system not found" }); return; } ms = e.draft; }
    if (!ms) { res.status(400).json({ error: "metricSystemId required: initialize and adopt a monitor metric system first" }); return; }
    const pids = new Set<string>();
    for (const m of ms.metrics) for (const b of m.bindings) if (b.datasetPathId) pids.add(b.datasetPathId);
    for (const binding of watchlist?.datasetBindings ?? []) pids.add(binding.datasetPathId);
    if (watchlist?.goalDatasetPathId) pids.add(watchlist.goalDatasetPathId);
    const aggs = await fetchMonitorAggregations(wid);
    const validPathIds = new Set(aggs.map((a) => a.pathId));
    const invalid = Array.from(pids).filter((pid) => !validPathIds.has(pid));
    if (invalid.length > 0) {
      res.status(400).json({ error: `pathIds not in this workspace clean_data: ${invalid.join(",")}` });
      return;
    }
    runRec = insertMonitorRun(wid, suite, msId, watchlist && !watchlist.virtual ? watchlist.id : null);
    const datasets: MonitorDatasetInput[] = [];
    for (const pid of pids) {
      const dr = await fetch(`${MON_BASE}/api/bi/aggregations/${encodeURIComponent(pid)}/data?limit=100000`);
      if (!dr.ok) throw new Error(`failed to fetch data for pathId ${pid}: ${dr.status}`);
      const d = await dr.json() as { columns: string[]; rows: Array<Record<string, BiCell>> };
      datasets.push({ pathId: pid, columns: d.columns, rows: d.rows });
    }
    const ontologyIds = await fetchMonitorOntologyIds(wid);
    const ontoCtx = await fetchMonitorOntologyContext(ontologyIds);
    const metrics = await fetchMonitorMetrics(wid);
    const prior = findPriorMonitorFindings(wid, suite, msId, runRec.id, runRec.watchlistId);
    const { findings } = runMonitorChecks({ suite, datasets, metricSystem: ms, metrics, links: ontoCtx.links, objects: ontoCtx.objects, logicRules: ontoCtx.logics, thresholds: thresh, priorFindings: prior }, runRec.id);
    insertMonitorFindings(findings);
    const pc = findings.filter((f) => f.kind === "问题").length;
    const rc = findings.filter((f) => f.kind === "风险").length;
    finishMonitorRun(runRec.id, { problemCount: pc, riskCount: rc, status: "done" });
    const finishedRun = { ...runRec, finishedAt: Date.now(), problemCount: pc, riskCount: rc, status: "done" as const };
    const evolve = findings
      .filter(shouldCreateEvalFromFinding)
      .map((finding) => {
        const trajectory = buildMonitorFindingTrajectory(finishedRun, finding);
        const trajectoryRecord = saveAgentTrajectory({ workspaceId: wid, trajectory });
        const evalResult = upsertEvalRecordForFinding(wid, buildEvalRecordFromFinding(finding, trajectory));
        return { findingId: finding.id, trajectoryId: trajectoryRecord.id, evalRecordId: evalResult.record.id, created: evalResult.created };
      });
    res.json({
      run: finishedRun,
      findings,
      summary: summarizeMonitorRun(findings),
      evolve: {
        scannedFindings: findings.length,
        candidateFindings: evolve.length,
        createdEvalRecords: evolve.filter((item) => item.created).length,
        records: evolve,
      },
    });
  } catch (e) {
    if (runRec) finishMonitorRun(runRec.id, { problemCount: 0, riskCount: 0, status: "error" });
    res.status(500).json({ error: String(e) });
  }
}

engineRouter.post("/api/workspaces/:id/monitor/runs", async (req, res) => {
  await runMonitorForWorkspace(req, res);
});

engineRouter.post("/api/workspaces/:id/monitor/watchlists/:watchlistId/run", async (req, res) => {
  await runMonitorForWorkspace(req, res, req.params.watchlistId);
});

engineRouter.get("/api/workspaces/:id/monitor/runs", (req, res) => {
  try {
    const watchlistId = typeof req.query.watchlistId === "string" ? req.query.watchlistId : undefined;
    if (watchlistId === DEFAULT_WATCHLIST_ID) { res.json(listMonRuns(req.params.id, { watchlistId: null })); return; }
    res.json(watchlistId ? listMonRuns(req.params.id, { watchlistId }) : listMonRuns(req.params.id));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

engineRouter.get("/api/workspaces/:id/monitor/runs/:runId/findings", (req, res) => {
  try {
    const runs = listMonRuns(req.params.id);
    if (!runs.some((r) => r.id === req.params.runId)) { res.status(404).json({ error: "run not found" }); return; }
    res.json(listMonitorFindings(req.params.runId));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

engineRouter.get("/api/workspaces/:id/monitor/runs/:runId/summary", (req, res) => {
  try {
    const runs = listMonRuns(req.params.id);
    if (!runs.some((r) => r.id === req.params.runId)) { res.status(404).json({ error: "run not found" }); return; }
    res.json(summarizeMonitorRun(listMonitorFindings(req.params.runId)));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

function parseMonitorActionDrafts(text: string): ActionItemDraft[] {
  const stripped = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped);
  const raw = (fenced?.[1] ?? stripped).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) return [];
  const scenes = new Set(["开业", "日常", "假日", "大促"]);
  const lifecycles = new Set(["A获取", "A激活", "R培育", "R复购", "R裂变"]);
  const priorities = new Set(["high", "medium", "low"]);
  return parsed.map((rawDraft) => {
    const d = (rawDraft ?? {}) as Record<string, unknown>;
    return {
      title: String(d.title ?? "").trim() || "未命名行动项",
      rationale: String(d.rationale ?? "").trim() || "来自监测 finding",
      scene: scenes.has(String(d.scene)) ? String(d.scene) as ActionItemDraft["scene"] : undefined,
      lifecycle: lifecycles.has(String(d.lifecycle)) ? String(d.lifecycle) as ActionItemDraft["lifecycle"] : undefined,
      expectedImpact: String(d.expectedImpact ?? "").trim() || "待验证",
      metricRef: typeof d.metricRef === "string" ? d.metricRef : undefined,
      priority: priorities.has(String(d.priority)) ? String(d.priority) as ActionItemDraft["priority"] : "medium",
      effort: priorities.has(String(d.effort)) ? String(d.effort) as ActionItemDraft["effort"] : "medium",
      confidence: typeof d.confidence === "number" && Number.isFinite(d.confidence) ? Math.max(0, Math.min(1, d.confidence)) : 0.5,
    };
  }).filter((d) => d.title.trim().length > 0);
}

function buildMonitorActionsFallback(findings: HealthFinding[]): ActionItemDraft[] {
  return findings.slice(0, 5).map((f) => ({
    title: `处理监测发现：${f.title}`,
    rationale: `${f.kind} · ${f.severity} · ${f.lifecycle}。${f.diagnosis?.summary ?? f.suggestion ?? "需结合关联指标进一步定位。"}`,
    expectedImpact: f.suggestion ?? "缩小关键经营指标差距",
    metricRef: f.boundTo?.column ?? f.category,
    priority: f.severity === "critical" ? "high" : f.severity === "warn" ? "medium" : "low",
    effort: "medium",
    confidence: f.severity === "critical" ? 0.72 : 0.62,
  }));
}

engineRouter.post("/api/workspaces/:id/monitor/actions/draft", async (req, res) => {
  const wid = req.params.id;
  const ws = getWorkspace(wid);
  if (!ws) { res.status(404).json({ error: "workspace not found" }); return; }
  const runId = typeof req.body?.runId === "string" ? req.body.runId : "";
  const findingIds = Array.isArray(req.body?.findingIds) ? req.body.findingIds.filter((id: unknown): id is string => typeof id === "string") : [];
  const model = typeof req.body?.model === "string" ? req.body.model : undefined;
  if (!runId) { res.status(400).json({ error: "runId required" }); return; }
  const runs = listMonRuns(wid);
  if (!runs.some((r) => r.id === runId)) { res.status(404).json({ error: "run not found" }); return; }
  const allFindings = listMonitorFindings(runId);
  const selected = findingIds.length > 0 ? allFindings.filter((f) => findingIds.includes(f.id)) : allFindings;
  if (selected.length === 0) { res.json({ drafts: [] }); return; }

  const findingsText = selected.map((f, idx) => ({
    idx: idx + 1,
    id: f.id,
    kind: f.kind,
    severity: f.severity,
    lifecycle: f.lifecycle,
    category: f.category,
    title: f.title,
    suggestion: f.suggestion,
    comparisons: f.comparisons ?? [],
    diagnosis: f.diagnosis,
  }));
  const systemPrompt = `你是经营监测行动项提炼引擎。请只基于输入的监测 findings 生成可执行行动项，输出严格 JSON 数组，不要 Markdown。
数组元素格式：
{
  "title": "行动项标题",
  "rationale": "依据哪条监测发现/差距/诊断",
  "scene": "开业|日常|假日|大促，可省略",
  "lifecycle": "A获取|A激活|R培育|R复购|R裂变，可省略",
  "expectedImpact": "预期指标影响",
  "metricRef": "关联指标或对象",
  "priority": "high|medium|low",
  "effort": "high|medium|low",
  "confidence": 0.0到1.0
}`;
  const userPrompt = `工作区 ${wid} 的监测 run=${runId} 发现如下。输入是衍生产物，不包含原始行级数据：\n${JSON.stringify(findingsText).slice(0, 16000)}\n\n请生成 1-8 条行动项 JSON 数组。`;

  try {
    const outText = await runPiPrompt({
      workspaceRoot: (ws as { rootPath?: string }).rootPath ?? process.cwd(),
      text: userPrompt,
      systemPrompt,
      model: model ?? "minimax-cn/MiniMax-M3",
      timeoutMs: 120_000,
    });
    const drafts = parseMonitorActionDrafts(outText);
    res.json({ drafts: drafts.length > 0 ? drafts : buildMonitorActionsFallback(selected) });
  } catch {
    res.json({ drafts: buildMonitorActionsFallback(selected) });
  }
});

function summarizeBusinessContextsForRequirementCommunication(workspaceId: string): string {
  const now = Date.now();
  const enabledIds = new Set(listEnabledItemIds(workspaceId, "business_context"));
  return listBusinessContexts()
    .filter((item) => enabledIds.has(item.id) && (item.validUntil === null || item.validUntil >= now))
    .slice(0, 20)
    .map((item) => `- [${item.category}] ${item.title}${item.content ? `：${item.content}` : ""}`.slice(0, 800))
    .join("\n");
}

function summarizeMetricsForRequirementCommunication(workspaceId: string): string {
  return listEnabledMetricDefinitions(workspaceId)
    .slice(0, 30)
    .map((metric) => {
      const parts = [metric.name, metric.category ? `[${metric.category}]` : "", metric.description ? `含义:${metric.description}` : "", metric.formula ? `公式:${metric.formula}` : "", metric.caliber ? `口径:${metric.caliber}` : "", metric.unit ? `单位:${metric.unit}` : ""].filter(Boolean);
      return `- ${parts.join(" · ")}`.slice(0, 800);
    })
    .join("\n");
}

function basenameOnly(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function listPathMetadataForRequirementCommunication(workspaceId: string): RequirementCommunicationPathMeta[] {
  return listWorkspacePaths(workspaceId).map((entry) => ({
    id: entry.id,
    folder: entry.folder,
    kind: entry.kind,
    name: basenameOnly(entry.path),
  }));
}

function sanitizeRequirementFilenamePart(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, "-").slice(0, 80);
  return cleaned || "business-requirement";
}

function requirementTimestampForFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function resolveRequirementOutputDirForEngine(pathId: number, workspaceId: string): { outputDir: string; pathName: string } {
  const entry = getWorkspacePath(pathId);
  if (!entry) throw new Error("path not found");
  if (entry.workspaceId !== workspaceId) throw new Error("path belongs to another workspace");
  if (entry.folder !== "report") throw new Error("only report output paths can store business requirements");
  return {
    outputDir: entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path)),
    pathName: basenameOnly(entry.path),
  };
}

function readLatestConfirmedRequirement(outputDir: string): { jsonPath: string; structured: ConfirmedBusinessRequirementStructured } | null {
  const dir = join(outputDir, "business_requirements");
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const abs = join(dir, name);
      try { return { name, mtimeMs: statSync(abs).mtimeMs }; } catch { return null; }
    })
    .filter((item): item is { name: string; mtimeMs: number } => item !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    try {
      const jsonPath = `business_requirements/${candidate.name}`;
      const structured = JSON.parse(readFlowFile(outputDir, jsonPath).content) as ConfirmedBusinessRequirementStructured;
      if (structured.communication?.confirmedAt) return { jsonPath, structured };
    } catch {
      // Ignore malformed legacy files.
    }
  }
  return null;
}

function resolveRequirementImportPathMeta(input: RequirementImportDocumentInput, workspaceId: string): RequirementCommunicationPathMeta | undefined {
  if (input.source === "localText") return undefined;
  if (input.pathId === undefined) throw new Error(`${input.source} document requires pathId`);
  const entry = getWorkspacePath(input.pathId);
  if (!entry) throw new Error("path not found");
  if (entry.workspaceId !== workspaceId) throw new Error("path belongs to another workspace");
  return { id: entry.id, folder: entry.folder, kind: entry.kind, name: input.relPath ?? basenameOnly(entry.path) };
}

function validateRequirementImportRelPath(path: string): void {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) throw new Error("document relPath contains forbidden segments");
}

function prepareRequirementImportDocuments(input: ReturnType<typeof parseRequirementImportDocumentsRequest>, workspaceId: string): RequirementImportDocumentForPrompt[] {
  return input.documents.map((document, index) => {
    const meta = resolveRequirementImportPathMeta(document, workspaceId);
    validateRequirementImportDocumentAccess(document, meta);
    if (document.source === "localText") {
      return makeRequirementImportDocumentFromText(document, index, document.localText ?? "");
    }
    if (document.source === "clean_data") {
      const entry = getWorkspacePath(document.pathId!);
      if (!entry) throw new Error("path not found");
      const content = [
        "仅提供 clean_data 路径元信息，未读取正文。",
        `folder=${entry.folder}`,
        `kind=${entry.kind}`,
        `name=${basenameOnly(entry.path)}`,
      ].join("\n");
      return makeRequirementImportDocumentFromText(document, index, content, ["clean_data body not read"]);
    }
    const entry = getWorkspacePath(document.pathId!);
    if (!entry) throw new Error("path not found");
    const root = entry.kind === "dir" ? resolve(entry.path) : dirname(resolve(entry.path));
    const relPath = document.relPath ?? basenameOnly(entry.path);
    validateRequirementImportRelPath(relPath);
    if (document.source === "business_requirements" && !relPath.startsWith("business_requirements/")) {
      throw new Error("business_requirements relPath must be under business_requirements/");
    }
    const read = readFlowFile(root, relPath);
    const warnings = read.truncated ? [`file truncated at ${read.content.length} chars`] : [];
    return makeRequirementImportDocumentFromText({ ...document, name: document.name ?? basenameOnly(relPath) }, index, read.content, warnings);
  });
}

function confirmedRequirementMarkdownPath(jsonPath: string): string {
  return jsonPath.replace(/\.json$/, ".md");
}

function readConfirmedRequirementForFramework(outputDir: string, jsonPath: string): { jsonPath: string; markdownPath?: string; markdown?: string; structured: ConfirmedBusinessRequirementStructured } {
  if (!isConfirmedBusinessRequirementJsonPath(jsonPath)) throw new Error("confirmedRequirementJsonPath must point to a confirmed requirement json");
  const structured = JSON.parse(readFlowFile(outputDir, jsonPath).content) as ConfirmedBusinessRequirementStructured;
  if (!structured.communication?.confirmedAt) throw new Error("confirmed requirement json is invalid");
  const markdownPath = confirmedRequirementMarkdownPath(jsonPath);
  try {
    return { jsonPath, markdownPath, markdown: readFlowFile(outputDir, markdownPath).content, structured };
  } catch {
    return { jsonPath, structured };
  }
}

function attachAnalysisFrameworkVersion(
  structured: BusinessRequirementAnalysisFrameworkStructured,
  markdownPath: string,
  jsonPath: string,
  model: string,
): BusinessRequirementAnalysisFrameworkStructured {
  structured.version = {
    generatedAt: Date.now(),
    model,
    markdownPath,
    jsonPath,
    source: "from_confirmed_requirement",
    sourceConfirmedRequirement: structured.sourceConfirmedRequirement,
    requirementInput: {
      projectName: structured.projectName,
      businessBackground: structured.businessFacts.join("\n"),
      businessGoal: structured.businessFacts.find((item) => item.startsWith("目标：")) ?? structured.projectName,
      businessQuestions: structured.analysisQuestions.join("\n"),
      decisionScenario: structured.dimensions.join("\n"),
      stakeholders: "",
      knownData: structured.metrics.map((item) => item.name).join("\n"),
      constraints: [...structured.risks, ...structured.openQuestions.map((item) => `待确认：${item}`)].join("\n"),
      outputPreference: structured.deliverables.join("\n"),
      extraPrompt: "基于确认需求生成",
    },
  };
  return structured;
}

engineRouter.post("/api/workspaces/:id/business-requirement-communication/import-documents", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const input = parseRequirementImportDocumentsRequest(req.body);
    const documents = prepareRequirementImportDocuments(input, req.params.id);
    const result = await runRequirementImportDocuments(
      input,
      documents,
      ({ systemPrompt, prompt }) => runPiPrompt({
        workspaceRoot: (workspace as { rootPath?: string }).rootPath ?? process.cwd(),
        text: prompt,
        systemPrompt,
        model: input.model ?? "minimax-cn/MiniMax-M3",
        timeoutMs: 120_000,
      }),
    );
    const tracePayload = buildRequirementImportTracePayload(input, documents, result);
    addTraceEvent({
      workspaceId: req.params.id,
      targetKind: "business_requirement",
      targetId: `communication-import:${Date.now()}`,
      type: "business_requirement_documents_imported",
      target: input.scene,
      status: "success",
      detail: `需求沟通材料导入 · ${documents.length} 材料 · ${result.extractedQuestions.length} 问题`,
      payload: tracePayload,
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "import documents failed";
    return res.status(400).json({ error: message });
  }
});

engineRouter.post("/api/workspaces/:id/business-requirement-communication/clarify", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const input = parseRequirementCommunicationRequest(req.body);
    const result = await runRequirementCommunicationClarification(
      input,
      {
        businessContextSummary: summarizeBusinessContextsForRequirementCommunication(req.params.id),
        metricSummary: summarizeMetricsForRequirementCommunication(req.params.id),
        pathMetas: listPathMetadataForRequirementCommunication(req.params.id),
      },
      ({ systemPrompt, prompt }) => runPiPrompt({
        workspaceRoot: (workspace as { rootPath?: string }).rootPath ?? process.cwd(),
        text: prompt,
        systemPrompt,
        model: input.model ?? "minimax-cn/MiniMax-M3",
        timeoutMs: 120_000,
      }),
    );
    addTraceEvent({
      workspaceId: req.params.id,
      targetKind: "business_requirement",
      targetId: `communication:${Date.now()}`,
      type: "business_requirement_clarification_generated",
      target: input.scene,
      status: "success",
      detail: `需求澄清问题生成 · ${result.clarifyingQuestions.length} 问题 · ${result.assumptions.length} 假设`,
      payload: {
        scene: input.scene,
        questionCount: result.clarifyingQuestions.length,
        assumptionCount: result.assumptions.length,
        questionCategories: [...new Set(result.clarifyingQuestions.map((item) => item.category))].slice(0, 12),
        questionStatuses: result.clarifyingQuestions.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {}),
      },
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "clarify failed";
    return res.status(400).json({ error: message });
  }
});

engineRouter.post("/api/workspaces/:id/business-requirement-communication/confirm", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const input = parseRequirementCommunicationConfirmInput(req.body);
    const { outputDir, pathName } = resolveRequirementOutputDirForEngine(input.pathId, req.params.id);
    const now = Date.now();
    const slug = sanitizeRequirementFilenamePart(input.title);
    const stamp = requirementTimestampForFilename(new Date(now));
    const markdownPath = `business_requirements/${slug}-确认需求-${stamp}.md`;
    const jsonPath = `business_requirements/${slug}-确认需求-${stamp}.json`;
    const communicationRecordPath = `business_requirements/communications/${slug}-沟通记录-${stamp}.json`;
    const structured = buildConfirmedBusinessRequirement(input, communicationRecordPath, now);
    structured.version = {
      generatedAt: now,
      model: "confirmed_by_user",
      markdownPath,
      jsonPath,
      requirementInput: {
        projectName: input.title,
        businessBackground: structured.businessFacts.join("\n"),
        businessGoal: input.requirementDraft.objective,
        businessQuestions: structured.analysisQuestions.join("\n"),
        decisionScenario: structured.dimensions.join("\n"),
        stakeholders: "",
        knownData: structured.metrics.map((item) => item.name).join("\n"),
        constraints: [...structured.risks, ...structured.deferredQuestions.map((q) => `未确认：${q}`)].join("\n"),
        outputPreference: [...structured.deliverables, ...input.requirementDraft.successCriteria].join("\n"),
        extraPrompt: "",
      },
    };
    const record = buildRequirementCommunicationRecord(input, randomUUID(), now, markdownPath, jsonPath);
    const markdown = renderConfirmedBusinessRequirementMarkdown(structured);
    writeFlowFile(outputDir, markdownPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    writeFlowFile(outputDir, jsonPath, `${JSON.stringify(structured, null, 2)}\n`);
    writeFlowFile(outputDir, communicationRecordPath, `${JSON.stringify(record, null, 2)}\n`);
    const tracePayload = buildRequirementConfirmationTracePayload(input, structured);
    const assumptionStatuses = tracePayload.assumptionStatuses as Record<string, number>;
    addTraceEvent({
      workspaceId: req.params.id,
      targetKind: "business_requirement",
      targetId: input.sourceCommunicationId ?? jsonPath,
      type: "business_requirement_assumptions_reviewed",
      target: input.title,
      status: "success",
      detail: `需求假设确认 · confirmed ${assumptionStatuses.confirmed ?? 0} · deferred ${assumptionStatuses.deferred ?? 0} · rejected ${assumptionStatuses.rejected ?? 0}`,
      payload: { scene: input.scene, assumptionStatuses, confirmedCount: assumptionStatuses.confirmed ?? 0 },
    });
    addTraceEvent({
      workspaceId: req.params.id,
      targetKind: "business_requirement",
      targetId: jsonPath,
      type: "business_requirement_confirmed",
      target: input.title,
      status: "success",
      detail: `业务需求确认 · ${input.title}`,
      payload: { ...tracePayload, pathName },
    });
    return res.json({ path: markdownPath, jsonPath, communicationRecordPath, content: markdown, structured });
  } catch (error) {
    const message = error instanceof Error ? error.message : "confirm failed";
    return res.status(400).json({ error: message });
  }
});

engineRouter.post("/api/workspaces/:id/business-requirements/analysis-framework-from-confirmed", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const input = parseAnalysisFrameworkFromConfirmedRequest(req.body);
    const { outputDir, pathName } = resolveRequirementOutputDirForEngine(input.pathId, req.params.id);
    const source = readConfirmedRequirementForFramework(outputDir, input.confirmedRequirementJsonPath);
    const model = input.model ?? "minimax-cn/MiniMax-M3";
    const generated = await runAnalysisFrameworkFromConfirmedRequirement(
      source.structured,
      { jsonPath: source.jsonPath, markdownPath: source.markdownPath, markdown: source.markdown },
      ({ systemPrompt, prompt }) => runPiPrompt({
        workspaceRoot: (workspace as { rootPath?: string }).rootPath ?? process.cwd(),
        text: prompt,
        systemPrompt,
        model,
        timeoutMs: 120_000,
      }),
    );
    const stamp = requirementTimestampForFilename();
    const slug = sanitizeRequirementFilenamePart(generated.projectName || source.structured.projectName);
    const markdownPath = `business_requirements/${slug}-分析框架-${stamp}.md`;
    const jsonPath = `business_requirements/${slug}-分析框架-${stamp}.json`;
    const structured = attachAnalysisFrameworkVersion(generated, markdownPath, jsonPath, model);
    const content = renderAnalysisFrameworkFromConfirmedMarkdown(structured);
    writeFlowFile(outputDir, markdownPath, content.endsWith("\n") ? content : `${content}\n`);
    writeFlowFile(outputDir, jsonPath, `${JSON.stringify(structured, null, 2)}\n`);
    const tracePayload = buildAnalysisFrameworkFromConfirmedTracePayload(structured);
    addTraceEvent({
      workspaceId: req.params.id,
      targetKind: "business_requirement",
      targetId: jsonPath,
      type: "business_requirement_analysis_framework_generated",
      target: structured.projectName,
      status: "success",
      detail: `基于确认需求生成分析框架 · ${structured.projectName}`,
      payload: { ...tracePayload, generatedMarkdownBasename: basenameOnly(markdownPath), generatedJsonBasename: basenameOnly(jsonPath), pathName },
    });
    return res.json({
      path: markdownPath,
      jsonPath,
      content,
      structured,
      sourceConfirmedRequirement: structured.sourceConfirmedRequirement,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "analysis framework generation failed";
    return res.status(400).json({ error: message });
  }
});

engineRouter.get("/api/workspaces/:id/business-requirement-communication/review-context", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const pathId = Number(req.query.pathId);
  if (!Number.isFinite(pathId)) return res.status(400).json({ error: "pathId required" });
  try {
    const { outputDir } = resolveRequirementOutputDirForEngine(pathId, req.params.id);
    const jsonPath = typeof req.query.jsonPath === "string" ? req.query.jsonPath : "";
    const item = jsonPath
      ? (() => {
        if (!isConfirmedBusinessRequirementJsonPath(jsonPath)) throw new Error("jsonPath must point to a confirmed business requirement json");
        return { jsonPath, structured: JSON.parse(readFlowFile(outputDir, jsonPath).content) as ConfirmedBusinessRequirementStructured };
      })()
      : readLatestConfirmedRequirement(outputDir);
    if (!item?.structured.communication?.confirmedAt) return res.json({ context: "", requirement: null });
    return res.json({ context: buildRequirementReviewContext(item.structured), requirement: item.structured, jsonPath: item.jsonPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "review context failed";
    return res.status(400).json({ error: message });
  }
});

// ---- SkillOpt: 受控回写器 ----

// POST /api/workspaces/:id/skill-rewrite/evaluate
// 对候选 skill 内容跑 held-out 评测，返回严格接受门裁决
engineRouter.post("/api/workspaces/:id/skill-rewrite/evaluate", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown>;
  const registryId = typeof body?.registryId === "string" ? body.registryId : "";
  const candidateContent = typeof body?.candidateContent === "string" ? body.candidateContent : "";
  const heldOutTasks = Array.isArray(body?.heldOutTasks) ? body.heldOutTasks as Array<{ id: string; prompt: string }> : [];
  const heldOutModel = typeof body?.heldOutModel === "string" ? body.heldOutModel : "minimax-cn/MiniMax-M3";
  const heldOutRepeat = typeof body?.heldOutRepeat === "number" && body.heldOutRepeat > 0 ? body.heldOutRepeat : 1;
  const heldOutJudgeRepeat = typeof body?.heldOutJudgeRepeat === "number" && body.heldOutJudgeRepeat > 0 ? body.heldOutJudgeRepeat : 1;
  const scoreMetric = body?.scoreMetric === "efc" ? "efc" as const : "evaluation" as const;

  if (!registryId || !candidateContent) {
    return res.status(400).json({ error: "registryId and candidateContent are required" });
  }
  if (heldOutTasks.length === 0) {
    return res.status(400).json({ error: "heldOutTasks must be a non-empty array" });
  }

  const entry = getSkillRegistryEntry(registryId);
  if (!entry) return res.status(404).json({ error: "skill registry entry not found" });

  const config: SkillRewriteGateConfig = {
    mode: "strict",
    scoreMetric,
    heldOutTasks: heldOutTasks.map((t) => ({ id: t.id, prompt: t.prompt })),
    heldOutModel,
    heldOutRepeat,
    heldOutJudgeRepeat,
  };

  try {
    const result = await runRewriteCandidateEvaluation({
      workspaceRoot: workspace.rootPath,
      entry,
      candidateContent,
      config,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/workspaces/:id/skill-rewrite/accept
// 接受通过严格门的候选，写入 skill 文件
engineRouter.post("/api/workspaces/:id/skill-rewrite/accept", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown>;
  const registryId = typeof body?.registryId === "string" ? body.registryId : "";
  const candidateContent = typeof body?.candidateContent === "string" ? body.candidateContent : "";
  const slug = typeof body?.slug === "string" ? body.slug : "";

  if (!registryId || !candidateContent || !slug) {
    return res.status(400).json({ error: "registryId, candidateContent, and slug are required" });
  }

  const entry = getSkillRegistryEntry(registryId);
  if (!entry) return res.status(404).json({ error: "skill registry entry not found" });

  const result = applySkillCurationProposalsGated({
    workspaceRoot: workspace.rootPath,
    workspaceId: workspace.id,
    slug,
    proposals: [{
      type: "update",
      targetPath: resolve(workspace.rootPath, ".pi", "skills", slug, "SKILL.md"),
      suggestedContent: candidateContent,
      rationale: "SkillOpt 严格接受门通过",
      confidence: 1,
      evidence: [],
    }],
  });

  res.json(result);
});

// POST /api/workspaces/:id/skill-rewrite/reject
// 拒绝候选，写入 rejected buffer
engineRouter.post("/api/workspaces/:id/skill-rewrite/reject", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown>;
  const registryId = typeof body?.registryId === "string" ? body.registryId : "";
  const candidateContent = typeof body?.candidateContent === "string" ? body.candidateContent : "";
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const reason = typeof body?.reason === "string" ? body.reason : "rejected by user";
  const evaluationId = typeof body?.evaluationId === "string" ? body.evaluationId : null;

  if (!registryId || !slug) {
    return res.status(400).json({ error: "registryId and slug are required" });
  }

  const edit = insertRejectedEdit({
    workspaceId: workspace.id,
    registryId,
    slug,
    edit: { kind: "replace", after: candidateContent.slice(0, 500) },
    candidateContent,
    reason,
    evaluationId,
  });

  res.json({ ok: true, edit });
});

// GET /api/workspaces/:id/skill-rewrite/rejected
// 列出被拒编辑
engineRouter.get("/api/workspaces/:id/skill-rewrite/rejected", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
  res.json(listRejectedEdits(workspace.id, slug));
});

// DELETE /api/skill-rewrite/rejected/:id
engineRouter.delete("/api/skill-rewrite/rejected/:id", (req, res) => {
  const ok = deleteRejectedEdit(req.params.id);
  res.json({ ok });
});

// POST /api/workspaces/:id/skill-sandbox/verify
// 验证 Creator/Evaluator 隔离
engineRouter.post("/api/workspaces/:id/skill-sandbox/verify", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown>;
  const role = typeof body?.role === "string" ? body.role : "";
  const paths = Array.isArray(body?.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];

  if (role === "creator") {
    res.json(verifyCreatorIsolation(workspace.rootPath, paths));
  } else if (role === "evaluator") {
    res.json(verifyEvaluatorIsolation(workspace.rootPath, paths));
  } else {
    res.status(400).json({ error: "role must be 'creator' or 'evaluator'" });
  }
});

engineRouter.post("/api/simulation-lab/run", async (req, res) => {
  try {
    const input = parseSimulationRunRequest(req.body);
    const result = await runSimulationLab(input);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("invalid") || msg.includes("only supports") || msg.includes("required") || msg.includes("does not accept")) {
      res.status(400).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});
