import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import { WebSocketServer, type WebSocket } from "ws";
import { PORT, UPLOAD_TMP_ROOT, ensureDirs } from "./config.ts";
import {
  addFlowMessage,
  addMessage,
  addWorkspacePath,
  createFlow,
  createFlowRun,
  createSession,
  createWorkspace,
  deleteFlow,
  deleteSession,
  deleteWorkspace,
  finishFlowRun,
  getFlow,
  getFlowRun,
  getSession,
  getWorkspace,
  listFlowMessages,
  listFlowRuns,
  listFlows,
  listMessages,
  listSessions,
  listWorkspacePaths,
  listWorkspaces,
  removeWorkspacePath,
  renameFlow,
  renameSession,
  renameWorkspace,
  updateFlowSourceName,
} from "./db.ts";
import { copyFlowSnapshot, copyLocalFolderIntoFlow, inferWorkflow, moveAllFiles, readFlowFile, readTree, writeFlowFile } from "./flow-fs.ts";
import { runPiTurn } from "./pi-adapter.ts";
import type { ClientMessage, PiEvent, ServerMessage } from "./types.ts";

ensureDirs();

// System prompts injected via --system-prompt on the first (and every) pi turn for workflow sessions.
const WORKFLOW_SYSTEM_PROMPTS: Record<string, string> = {
  explore:
    "你是一个数据探查专家。帮助用户快速了解数据集的基本情况、分布与数据质量。用户提供数据文件路径后，主动分析：行列数、数据类型、缺失值统计、各列基本统计量（均值/中位数/最大最小值），以及潜在的质量问题。请等待用户提供数据。",
  clean:
    "你是一个数据清洗专家。帮助用户处理缺失值、异常值与格式不一致问题。先诊断数据质量问题，提出清洗方案并请用户确认，再执行清洗操作并输出清洗后的数据。请等待用户提供数据。",
  eda: "你是一个探索性数据分析（EDA）专家。深入挖掘数据中的规律、异常与变量间关联，提出有价值的洞察与假设。请等待用户提供数据。",
  viz: "你是一个数据可视化专家。为用户的数据选择合适的图表类型（折线图、柱状图、散点图、热力图等），生成清晰的可视化图表并提供可执行代码。请等待用户提供数据和可视化需求。",
  stats:
    "你是一个统计分析专家。提供描述性统计、假设检验、相关性分析等。分析时给出统计量、p 值、置信区间等关键指标，并解释其实际意义。请等待用户提供数据。",
  report:
    "你是一个数据分析报告专家。将分析结论整理为结构清晰的报告，包含执行摘要、核心发现、方法说明与行动建议，输出 Markdown 格式。请等待用户提供分析结果或数据。",
  timeseries:
    "你是一个时间序列分析专家。分析时序数据的趋势、周期性、季节性和异常，提供分解分析或预测。请等待用户提供时序数据。",
  anomaly:
    "你是一个异常检测专家。使用统计方法或机器学习算法识别数据中的异常点与离群值，并解释其可能原因。请等待用户提供数据。",
  correlation:
    "你是一个相关性分析专家。量化变量间的关联强度与方向，区分相关性与因果性，提供相关矩阵与可视化。请等待用户提供数据。",
  compare:
    "你是一个分组对比分析专家。对多组数据进行差异分析，使用适当的统计检验（t 检验、方差分析等）验证差异显著性。请等待用户提供数据和分组信息。",
  modeling:
    "你是一个预测建模专家。帮助用户构建回归或分类预测模型，包括特征工程、模型选择、训练与评估。请等待用户提供数据和建模目标。",
  text: "你是一个文本分析专家。从文本数据中提取特征、分析情感倾向、识别关键词与主题。请等待用户提供文本数据。",
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

// ---- REST: models ----
app.get("/api/models", (_req, res) => {
  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      enabledModels?: string[];
      defaultProvider?: string;
      defaultModel?: string;
    };
    const enabled: string[] = settings.enabledModels ?? [];
    const defaultId =
      settings.defaultProvider && settings.defaultModel
        ? `${settings.defaultProvider}/${settings.defaultModel}`
        : null;
    const models = enabled.map((id) => {
      const slash = id.indexOf("/");
      return {
        id,
        provider: slash >= 0 ? id.slice(0, slash) : id,
        model: slash >= 0 ? id.slice(slash + 1) : id,
        isDefault: id === defaultId,
      };
    });
    res.json(models);
  } catch {
    res.json([]);
  }
});

// ---- REST: workspaces ----
app.get("/api/workspaces", (_req, res) => res.json(listWorkspaces()));
app.post("/api/workspaces", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  res.json(createWorkspace(name));
});

app.patch("/api/workspaces/:id", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameWorkspace(req.params.id, name);
  res.json({ ok: true });
});
app.delete("/api/workspaces/:id", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  deleteWorkspace(req.params.id);
  res.json({ ok: true });
});

// ---- REST: sessions ----
app.get("/api/workspaces/:id/sessions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listSessions(req.params.id));
});
app.post("/api/workspaces/:id/sessions", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const title = String(req.body?.title ?? "新会话").trim() || "新会话";
  const workflowId = typeof req.body?.workflowId === "string" ? req.body.workflowId : null;
  res.json(createSession(req.params.id, title, workflowId));
});

app.patch("/api/sessions/:id", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  renameSession(req.params.id, title);
  res.json({ ok: true });
});
app.delete("/api/sessions/:id", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  deleteSession(req.params.id);
  res.json({ ok: true });
});

// ---- REST: messages (history) ----
app.get("/api/sessions/:id/messages", (req, res) => {
  if (!getSession(req.params.id)) return res.status(404).json({ error: "session not found" });
  res.json(listMessages(req.params.id));
});

// ---- REST: flows ----
app.get("/api/workspaces/:id/flows", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listFlows(req.params.id));
});
app.post("/api/workspaces/:id/flows", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const name = String(req.body?.name ?? "新工作流").trim() || "新工作流";
  const kind = req.body?.kind === "multi" ? "multi" : "single";
  res.json(createFlow(req.params.id, name, null, kind));
});
app.patch("/api/flows/:id", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  renameFlow(req.params.id, name);
  res.json({ ok: true });
});
app.delete("/api/flows/:id", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  deleteFlow(req.params.id);
  res.json({ ok: true });
});

app.get("/api/flows/:id/messages", (req, res) => {
  if (!getFlow(req.params.id)) return res.status(404).json({ error: "flow not found" });
  res.json(listFlowMessages(req.params.id));
});

app.get("/api/flows/:id/tree", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    res.json(readTree(flow.folderPath));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/flows/:id/file", (req, res) => {
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

app.put("/api/flows/:id/file", (req, res) => {
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

app.post("/api/flows/:id/import-local", (req, res) => {
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
app.get("/api/flows/:id/workflow", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    const content = readFlowFile(flow.folderPath, "workflow.json").content;
    if (content === null) {
      res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
    } else {
      res.json({ workflow: JSON.parse(content), inferred: false });
    }
  } catch {
    res.json({ workflow: inferWorkflow(flow.folderPath), inferred: true });
  }
});

// Write workflow.json
app.put("/api/flows/:id/workflow", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  try {
    writeFlowFile(flow.folderPath, "workflow.json", JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/flows/:id/runs", (req, res) => {
  const flow = getFlow(req.params.id);
  if (!flow) return res.status(404).json({ error: "flow not found" });
  res.json(listFlowRuns(flow.id));
});

app.get("/api/flows/:id/runs/:runId/tree", (req, res) => {
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

app.get("/api/flows/:id/runs/:runId/file", (req, res) => {
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

// ---- REST: workspace paths ----
app.get("/api/workspaces/:id/paths", (req, res) => {
  if (!getWorkspace(String(req.params.id ?? ""))) return res.status(404).json({ error: "workspace not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(listWorkspacePaths(String(req.params.id ?? ""), folder));
});

app.post("/api/workspaces/:id/paths", (req, res) => {
  if (!getWorkspace(String(req.params.id ?? ""))) return res.status(404).json({ error: "workspace not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  if (!folder || !path) return res.status(400).json({ error: "folder and path required" });
  try {
    res.json(addWorkspacePath(String(req.params.id ?? ""), folder, path));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/workspaces/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- REST: session paths ----
app.get("/api/sessions/:id/paths", (req, res) => {
  const session = getSession(String(req.params.id ?? ""));
  if (!session) return res.status(404).json({ error: "session not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(listWorkspacePaths(session.workspaceId, folder, session.id));
});

app.post("/api/sessions/:id/paths", (req, res) => {
  const session = getSession(String(req.params.id ?? ""));
  if (!session) return res.status(404).json({ error: "session not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  if (!folder || !path) return res.status(400).json({ error: "folder and path required" });
  try {
    res.json(addWorkspacePath(session.workspaceId, folder, path, session.id));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/sessions/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- REST: flow paths ----
app.get("/api/flows/:id/paths", (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const folder = String(req.query.folder ?? "") || undefined;
  res.json(listWorkspacePaths(flow.workspaceId, folder, undefined, flow.id));
});

app.post("/api/flows/:id/paths", (req, res) => {
  const flow = getFlow(String(req.params.id ?? ""));
  if (!flow) return res.status(404).json({ error: "flow not found" });
  const folder = String(req.body?.folder ?? "").trim();
  const path = String(req.body?.path ?? "").trim();
  if (!folder || !path) return res.status(400).json({ error: "folder and path required" });
  try {
    res.json(addWorkspacePath(flow.workspaceId, folder, path, null, flow.id));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete("/api/flows/:id/paths/:pathId", (req, res) => {
  removeWorkspacePath(Number(req.params.pathId));
  res.json({ ok: true });
});

// ---- macOS native file/folder picker ----
app.post("/api/pick-path", (req, res) => {
  const mode = String(req.body?.mode ?? "file");
  const script =
    mode === "dir"
      ? "POSIX path of (choose folder)"
      : "POSIX path of (choose file)";
  execFile("osascript", ["-e", script], (err, stdout) => {
    if (err) return res.status(400).json({ error: "cancelled" });
    res.json({ path: stdout.trim() });
  });
});

// ---- flow import (webkitdirectory upload) ----
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

app.post("/api/flows/:id/import", upload.any(), (req, res) => {
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

const server = app.listen(PORT, () => {
  console.log(`[xanthil] gateway listening on http://localhost:${PORT}`);
});

// ---- WebSocket gateway ----
const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return send(ws, { type: "error", message: "invalid json" });
    }
    if (msg.type === "send") void handleSend(ws, msg);
    else if (msg.type === "send_flow") void handleSendFlow(ws, msg);
    else if (msg.type === "execute_flow") void handleExecuteFlow(ws, msg);
  });
});

const FOLDER_LABELS: Record<string, string> = {
  draw_data: "原始数据",
  clean_data: "清洗数据",
  report: "报告",
};

function buildContextPrefix(workspaceId: string): string {
  const paths = listWorkspacePaths(workspaceId);
  if (paths.length === 0) return "";
  const grouped: Record<string, string[]> = {};
  for (const p of paths) (grouped[p.folder] ??= []).push(p.path);
  const lines = Object.entries(grouped)
    .map(([f, ps]) => `${FOLDER_LABELS[f] ?? f}:\n${ps.map((p) => `  - ${p}`).join("\n")}`)
    .join("\n");
  return `[工作区已登记的文件路径]\n${lines}\n\n`;
}

async function handleSend(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "send" }>,
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) return send(ws, { type: "error", sessionId: msg.sessionId, message: "session not found" });
  const ws_ = getWorkspace(session.workspaceId);
  if (!ws_) return send(ws, { type: "error", sessionId: msg.sessionId, message: "workspace not found" });

  // Persist the user turn immediately (original text, without injected context).
  addMessage(session.id, "user", [{ type: "text", text: msg.text }]);
  send(ws, { type: "run_start", sessionId: session.id });

  // Prepend workspace path context so pi knows what files are available.
  const contextPrefix = buildContextPrefix(session.workspaceId);
  const textForPi = contextPrefix ? `${contextPrefix}${msg.text}` : msg.text;

  const systemPrompt = session.workflowId ? WORKFLOW_SYSTEM_PROMPTS[session.workflowId] : undefined;

  const run = runPiTurn({
    workspaceRoot: ws_.rootPath,
    piSessionId: session.id,
    text: textForPi,
    model: msg.model,
    systemPrompt,
    onEvent: (event: PiEvent) => {
      send(ws, { type: "pi_event", sessionId: session.id, event });
      // Persist completed assistant/tool messages with their usage. The user
      // turn is already persisted at send time, so skip pi's user echo to
      // avoid duplicating it.
      if (event.type === "message_end") {
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role !== "user") addMessage(session.id, m.role, m.content, m.usage ?? null);
      }
    },
  });

  const code = await run.done;
  send(ws, { type: "run_end", sessionId: session.id, code });
}

async function handleSendFlow(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "send_flow" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, message: "flow not found" });

  addFlowMessage(flow.id, "user", [{ type: "text", text: msg.text }]);
  send(ws, { type: "run_start", flowId: flow.id });

  const run = runPiTurn({
    // pi runs *inside* the flow folder so its file tools see the workflow as cwd.
    workspaceRoot: flow.folderPath,
    piSessionId: flow.id,
    text: msg.text,
    model: msg.model,
    onEvent: (event: PiEvent) => {
      send(ws, { type: "flow_event", flowId: flow.id, event });
      if (event.type === "message_end") {
        const { message: m } = event as Extract<PiEvent, { type: "message_end" }>;
        if (m.role !== "user") addFlowMessage(flow.id, m.role, m.content, m.usage ?? null);
      }
    },
  });

  const code = await run.done;
  send(ws, { type: "run_end", flowId: flow.id, code });
}

async function handleExecuteFlow(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "execute_flow" }>,
): Promise<void> {
  const flow = getFlow(msg.flowId);
  if (!flow) return send(ws, { type: "error", flowId: msg.flowId, runId: msg.runId, message: "flow not found" });

  const runsRoot = join(flow.folderPath, "runs");
  const runDir = join(runsRoot, msg.runId);
  mkdirSync(runsRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  copyFlowSnapshot(flow.folderPath, runDir);

  const runRow = createFlowRun(flow.id, { text: msg.text }, runDir);
  send(ws, { type: "run_start", flowId: flow.id, runId: runRow.id });

  const run = runPiTurn({
    workspaceRoot: runDir,
    piSessionId: runRow.id,
    text: msg.text,
    model: msg.model,
    onEvent: (event: PiEvent) => {
      send(ws, { type: "flow_run_event", flowId: flow.id, runId: runRow.id, event });
    },
  });

  const code = await run.done;
  finishFlowRun(runRow.id, code === 0 ? "success" : "failed");
  send(ws, { type: "run_end", flowId: flow.id, runId: runRow.id, code });
}
