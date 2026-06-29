import { Router } from "express";
import multer from "multer";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { listWorkspacePaths, getWorkspacePath, getWorkspace, listMemoryInjectionRecords, addTraceEvent, addWorkspacePath } from "../db.ts";
import {
  getConnection as getSqlConnection,
  getSchema as getSqlSchema,
  inferColumnTypes,
  sanitizeIdentifier,
  quoteIdent,
  importRowsToDb,
  exportTableQuery,
  rowsToCsv,
  rowsToJson,
  validateSql,
  executeQuery,
  type ImportColumn,
  type ImportPreviewResult,
} from "../sql-connections.ts";
import {
  createMemoryItem,
  getMemoryItem,
  listMemoryItems,
  listEnabledMemoryItems,
  updateMemoryItem,
  deleteMemoryItem,
  recordMemoryItemFeedback,
  listProjectedFacts,
  listMetricTemplates,
  applyMetricTemplates,
  detectMetricConflicts,
  inspectStandardFiles,
  previewOkhMetricImport,
  commitOkhMetricImport,
  exportOkhMetrics,
  listOkhMetricOntologyLinks,
  listOkhMetricOntologyLinksByTarget,
  listOkhMetricOntologyLinksByOntology,
  replaceOkhMetricOntologyLinks,
  deleteOkhMetricOntologyLink,
  coerceRiskFlags,
  ingestMemoryCandidate,
  findMemoryItemDuplicate,
  findSemanticDedupShortlist,
  listMemoryReviews,
  getMemoryReview,
  acceptMemoryReview,
  rejectMemoryReview,
  createKnowledgeDoc,
  getKnowledgeDoc,
  listKnowledgeDocs,
  updateKnowledgeDoc,
  deleteKnowledgeDoc,
  setKnowledgeDocSummary,
  listKnowledgeChunks,
  createPromptTemplate,
  getPromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
  deletePromptTemplate,
  type MemoryItemPatch,
  type MemoryIngestInput,
  type MemoryReview,
} from "../db/data.ts";
import { searchKnowledgeChunks, searchKnowledgeDocs } from "../knowledge-retrieval.ts";
import { parseAggregationBuffer } from "../bi-dataset-parser.ts";
import { decodeUploadOriginalName } from "../upload-filename.ts";
import { runPiPrompt } from "../pi-adapter.ts";
import { buildMemoryPrompt } from "../memory-injection.ts";
import { judgeSemanticDuplicate, type JudgeFn } from "../memory-dedup.ts";
import { computeMemoryAgingSignals } from "../memory-aging-signals.ts";
import {
  assertSafeInput,
  collectApiTopologyFromTrace,
  collectSqlSkeletonsFromTrace,
  distillProposals,
  listSafeReportPaths,
} from "../safe-distiller.ts";
import {
  approveSkillProposal,
  getSkillProposal,
  listSkillProposals,
  rejectSkillProposal,
  upsertSkillProposal,
  type SkillProposalStatus,
  createCrowdDataset,
  getCrowdDataset,
  listCrowdDatasets,
  updateCrowdDataset,
  deleteCrowdDataset,
  listCrowdTagDictionary,
  saveCrowdTagDictionary,
  createCrowdSegment,
  getCrowdSegment,
  listCrowdSegments,
  updateCrowdSegment,
  deleteCrowdSegment,
  createCrowdProfile,
  getCrowdProfile,
  listCrowdProfiles,
  updateCrowdProfile,
  deleteCrowdProfile,
  createCrowdProfileVersion,
  getCrowdProfileVersion,
  listCrowdProfileVersions,
  createCrowdProfileFeedback,
  getCrowdProfileFeedback,
  listCrowdProfileFeedback,
  updateCrowdProfileFeedbackStatus,
  adoptFeedbackToVersion,
  rollbackProfileToVersion,
  buildCrowdSubAgentDraft,
  type CrowdDatasetCreateInput,
  type CrowdDatasetPatch,
  type CrowdTagDictionaryEntryInput,
  type CrowdSegmentCreateInput,
  type CrowdSegmentPatch,
  type CrowdProfileCreateInput,
  type CrowdProfilePatch,
  type CrowdProfileVersionCreateInput,
  type CrowdProfileFeedbackCreateInput,
} from "../db/data.ts";
import { evaluateSegment, validateSegmentRule } from "../crowd-segment.ts";
import { computeFieldProfiles, computeTagDetailFieldProfiles, crowdFieldProfilesToLlmAggregateCsv } from "../crowd-import.ts";
import { importAggregateDataset, autoTagDictionary, createDefaultSegment } from "../crowd-aggregate.ts";
import { HOOKS_CONFIG_PATH, HOOKS_LOG_PATH } from "../config.ts";
import { PORT } from "../config.ts";
import type {
  BiAggregationDataset,
  BiAggregationData,
  IndustryIntel,
  CompetitorIntel,
  IndustryForce,
  CompetitorProfile,
  Hook,
  HookAction,
  HookEvent,
  HookActionKind,
  HookMatch,
  HookTriggerRecord,
  MemoryItemInput,
  MemoryItemType,
  KnowledgeDocPatch,
  PromptTemplatePatch,
  CrowdSegmentRuleGroup,
  OkhMetricOntologyLink,
  OkhTemplateScenario,
} from "../types.ts";

/**
 * 【Agent-D · 数据基座域】HTTP 路由 slot —— owner: opencode(deepseek/glm)
 *
 * 覆盖：数据接入 / 数据准备 / 指标语义层。
 *   /api/sql-connections* · /api/extraction-tools* · /api/bi-datasets* · /api/metrics*(语义层,待建) …
 *
 * 约定：
 *   - 新路由写在本文件：`dataRouter.post("/api/metrics", (req, res) => { ... })`
 *   - 复用 db CRUD：`import { listSqlConnections } from "../db.ts"`
 *   - 复用 LLM 调用：`import { runPiPrompt } from "../pi-adapter.ts"`
 *   - 跨域读取走对方 GET，禁止 import 他域 db 函数
 *
 * 禁止：
 *   - 触碰 index.ts（legacy 冻结，归总控）/ 他域 router
 *   - 违反 AGENTS.md 数据安全铁律：draw_data 禁 LLM、数据探索纯前端零 LLM
 */
export const dataRouter = Router();

// ── P0-D 看板聚合数据源 API ──

const DEFAULT_LIMIT = 5000;

// 仅表格文件可作看板数据源（与 bi-datasets 上传白名单一致）；排除 .md/报告等非表格 clean_data 文件
const TABULAR_EXT = new Set([".csv", ".tsv", ".xlsx", ".xls"]);

dataRouter.get("/api/bi/aggregations", (req, res) => {
  try {
    const workspaceId = String(req.query.workspaceId ?? "");
    if (!workspaceId) return res.status(400).json({ error: "workspaceId required" });
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });

    const paths = listWorkspacePaths(workspaceId, "clean_data");
    const files = paths.filter(
      (p) => p.kind === "file" && TABULAR_EXT.has(extname(p.path).toLowerCase()),
    );

    const datasets: BiAggregationDataset[] = [];
    for (const entry of files) {
      try {
        const buf = readFileSync(entry.path);
        const { columns, rows } = parseAggregationBuffer(buf, entry.path);
        if (columns.length === 0) continue;
        datasets.push({
          pathId: String(entry.id),
          name: entry.path.split("/").pop() ?? entry.path,
          columns,
          rowCount: rows.length,
        });
      } catch {
        // skip unparseable files
      }
    }

    res.json(datasets);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.get("/api/bi/aggregations/:pathId/data", (req, res) => {
  try {
    const pathId = Number(req.params.pathId);
    if (!Number.isFinite(pathId)) return res.status(400).json({ error: "invalid pathId" });

    const entry = getWorkspacePath(pathId);
    if (!entry) return res.status(404).json({ error: "path not found" });

    if (entry.folder === "draw_data") {
      return res.status(403).json({ error: "draw_data access forbidden" });
    }
    if (entry.folder !== "clean_data") {
      return res.status(400).json({ error: "only clean_data aggregations are supported" });
    }
    if (entry.kind !== "file") {
      return res.status(400).json({ error: "path is not a file" });
    }

    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 100000);
    const buf = readFileSync(entry.path);
    const { columns, rows } = parseAggregationBuffer(buf, entry.path);

    const result: BiAggregationData = {
      columns,
      rows: rows.slice(0, limit) as BiAggregationData["rows"],
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Xan 数据库 · 行业/竞品情报 (pi agent 联网检索生成) ──
//
// 数据安全：仅把用户输入的行业名/品牌名发给 pi，不读取任何工作区原始/聚合明细。
// 产出为外部公开情报，与天气模块同属"外部数据"层。

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`LLM response has no JSON object: ${raw.slice(0, 200)}`);
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch (err) {
    const sanitized = sanitizeBarePlaceholders(slice);
    if (sanitized === slice) throw err;
    try {
      return JSON.parse(sanitized) as unknown;
    } catch {
      throw err;
    }
  }
}

/**
 * 兜底：将值位置（`:` 或 `[` 或 `,` 之后）的裸非法 token（如 X / N/A / 待定 / 未知 / 无）
 * 替换为 0；字符串字面量内部不动。配合 coerce 层的 asNum，X→0 能被正常 clamp。
 * 字符串型字段被替换成 0 后，asStr 仍能兜成 "0"，不至于整段炸。
 */
function sanitizeBarePlaceholders(s: string): string {
  let out = "";
  let i = 0;
  const len = s.length;
  while (i < len) {
    const ch = s[i]!;
    if (ch === '"') {
      // copy whole string literal verbatim (handle escaped quotes)
      out += ch;
      i++;
      while (i < len) {
        const c = s[i]!;
        out += c;
        if (c === "\\" && i + 1 < len) {
          out += s[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (c === '"') break;
      }
      continue;
    }
    if (ch === ":" || ch === "[" || ch === ",") {
      out += ch;
      i++;
      // skip whitespace
      while (i < len && /\s/.test(s[i]!)) {
        out += s[i];
        i++;
      }
      if (i >= len) continue;
      const next = s[i]!;
      // already a valid value start
      if (next === '"' || next === "{" || next === "[" || next === "-" || (next >= "0" && next <= "9")) continue;
      // capture bare token until comma / closing bracket / newline / whitespace
      let j = i;
      while (j < len && !/[,}\]\n\r]/.test(s[j]!)) j++;
      const token = s.slice(i, j).trim();
      if (!token) continue;
      // keep valid JSON literals
      if (token === "true" || token === "false" || token === "null") continue;
      // bare placeholder → replace with 0
      out += "0";
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const asStr = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const asNum = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) ? n : d;
};
const asStrArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => asStr(x)).filter(Boolean) : []);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? v as Record<string, unknown> : {});

function coerceIndustry(input: unknown, industry: string): IndustryIntel {
  const o = asRecord(input);
  return {
    industry,
    summary: asStr(o.summary),
    marketSize: asStr(o.marketSize),
    marketGrowth: asStr(o.marketGrowth),
    concentration: asStr(o.concentration),
    trends: asStrArr(o.trends),
    forces: (Array.isArray(o.forces) ? o.forces : []).map((f): IndustryForce => {
      const r = asRecord(f);
      return { label: asStr(r.label), score: clamp(asNum(r.score), 0, 100), note: asStr(r.note) };
    }).filter((f) => f.label),
    benchmarks: (Array.isArray(o.benchmarks) ? o.benchmarks : []).map((b) => {
      const r = asRecord(b);
      return { name: asStr(r.name), value: asStr(r.value) };
    }).filter((b) => b.name),
    risks: asStrArr(o.risks),
    opportunities: asStrArr(o.opportunities),
  };
}

function coerceCompetitor(input: unknown, brand: string): CompetitorIntel {
  const o = asRecord(input);
  return {
    brand,
    summary: asStr(o.summary),
    profiles: (Array.isArray(o.profiles) ? o.profiles : []).map((p): CompetitorProfile => {
      const r = asRecord(p);
      return {
        name: asStr(r.name),
        positioning: asStr(r.positioning),
        marketSharePct: clamp(asNum(r.marketSharePct), 0, 100),
        priceLevel: asStr(r.priceLevel),
        strengths: asStrArr(r.strengths),
        weaknesses: asStrArr(r.weaknesses),
        recentMoves: asStrArr(r.recentMoves),
      };
    }).filter((p) => p.name),
    comparison: (Array.isArray(o.comparison) ? o.comparison : []).map((c) => {
      const r = asRecord(c);
      return { dimension: asStr(r.dimension), self: asStr(r.self), rivals: asStr(r.rivals) };
    }).filter((c) => c.dimension),
    substitutionRisk: asStr(o.substitutionRisk),
    recommendations: asStrArr(o.recommendations),
  };
}

const INDUSTRY_SYSTEM =
  "你是资深行业研究分析师。基于公开可得的行业信息(如有联网检索能力请优先检索最新公开数据)输出客观、可核查的行业情报，不确定处标注为估算。只输出 JSON，不要解释。";

function buildIndustryPrompt(industry: string): string {
  return `请对「${industry}」行业产出结构化情报，严格按以下 JSON schema 输出(全部中文，数值用阿拉伯数字)：
{
  "summary": "一段 100 字以内行业概览",
  "marketSize": "市场规模，如 约 1.2 万亿元",
  "marketGrowth": "增速，如 年复合增速约 8%",
  "concentration": "集中度定性，如 CR5≈35%，中度集中",
  "trends": ["关键趋势1", "趋势2", "趋势3"],
  "forces": [
    {"label": "现有竞争", "score": 60, "note": "简述"},
    {"label": "供应商议价", "score": 50, "note": "简述"},
    {"label": "买方议价", "score": 50, "note": "简述"},
    {"label": "替代品威胁", "score": 40, "note": "简述"},
    {"label": "新进入者威胁", "score": 40, "note": "简述"}
  ],
  "benchmarks": [{"name": "毛利率", "value": "约 30%"}],
  "risks": ["风险1", "风险2"],
  "opportunities": ["机会1", "机会2"]
}
score 取 0-100，表示该力对行业的压力强度(越高压力越大)。所有数值字段必须是阿拉伯数字，无法估算请填 0；严禁使用 X / N/A / 待定 / 未知 等占位符（会导致 JSON 解析失败）。`;
}

const COMPETITOR_SYSTEM =
  "你是资深竞争情报分析师。基于公开可得信息(如有联网检索能力请优先检索)输出客观竞品情报，不确定处标注为估算。只输出 JSON，不要解释。";

function buildCompetitorPrompt(brand: string, competitors: string[]): string {
  const rivalLine = competitors.length
    ? `重点分析这些竞品：${competitors.join("、")}。`
    : `请自动识别该品牌的 3-5 个主要竞品。`;
  return `站在「${brand}」的视角产出竞争情报。${rivalLine} 严格按以下 JSON schema 输出(全部中文)：
{
  "summary": "一段 100 字以内竞争格局概览",
  "profiles": [
    {"name": "竞品名", "positioning": "定位", "marketSharePct": 20, "priceLevel": "价格带定性", "strengths": ["优势1"], "weaknesses": ["劣势1"], "recentMoves": ["近期动作1"]}
  ],
  "comparison": [
    {"dimension": "价格", "self": "${brand}的表现", "rivals": "竞品对比"},
    {"dimension": "产品力", "self": "...", "rivals": "..."},
    {"dimension": "渠道", "self": "...", "rivals": "..."}
  ],
  "substitutionRisk": "替代风险定性评估",
  "recommendations": ["策略建议1", "建议2"]
}
marketSharePct 取 0-100，表示该竞品估计市场份额百分比。所有数值字段必须是阿拉伯数字，无法估算请填 0；严禁使用 X / N/A / 待定 / 未知 等占位符（会导致 JSON 解析失败）。`;
}

dataRouter.post("/api/workspaces/:id/industry/analyze", async (req, res) => {
  try {
    const workspace = getWorkspace(String(req.params.id ?? ""));
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const industry = typeof req.body?.industry === "string" ? req.body.industry.trim() : "";
    if (!industry) return res.status(400).json({ error: "industry is required" });
    const model = typeof req.body?.model === "string" && req.body.model ? req.body.model : undefined;
    const output = await runPiPrompt({
      workspaceRoot: workspace.rootPath,
      model,
      systemPrompt: INDUSTRY_SYSTEM,
      text: buildIndustryPrompt(industry),
      timeoutMs: 180_000,
    });
    res.json(coerceIndustry(extractJson(output), industry));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.post("/api/workspaces/:id/competitor/analyze", async (req, res) => {
  try {
    const workspace = getWorkspace(String(req.params.id ?? ""));
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const brand = typeof req.body?.brand === "string" ? req.body.brand.trim() : "";
    if (!brand) return res.status(400).json({ error: "brand is required" });
    const competitors = Array.isArray(req.body?.competitors)
      ? (req.body.competitors as unknown[]).map((c) => (typeof c === "string" ? c.trim() : "")).filter(Boolean)
      : [];
    const model = typeof req.body?.model === "string" && req.body.model ? req.body.model : undefined;
    const output = await runPiPrompt({
      workspaceRoot: workspace.rootPath,
      model,
      systemPrompt: COMPETITOR_SYSTEM,
      text: buildCompetitorPrompt(brand, competitors),
      timeoutMs: 180_000,
    });
    res.json(coerceCompetitor(extractJson(output), brand));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── 计算工具·hooks 管理 + 插件管理 ──
//
// 数据安全（AGENTS.md §一 等同红线对待）：
//   - hook 动作类型层只暴露 command|log|block|mutate|notify，server 侧再做白名单校验，外发(HTTP)动作绝不受理。
//     block/mutate 为护栏（拦截/改参），仅 tool_call 事件有效；其余为传感器/旁路。
//   - trigger 流水读 px-hook-runner 已脱敏的 JSONL，server 不增加任何对话原文回灌。
//   - 插件清单仅返回包名/路径/来源，不读扩展实现内容。
//
// 设计：hooks.json / hooks-triggers.jsonl 路径直接复用 config.ts 常量，与 px-hook-runner 端
// PX_HOOKS_CONFIG / PX_HOOKS_LOG 注入值同源（pi-adapter.ts 已注入），UI 改写后扩展下次触发即生效。
//
// 插件管理（GET /api/plugins）= 列 pi 已加载扩展/包（原 hooks/extensions，按职责拆到插件管理模块）。

type PluginSource = "package" | "global" | "project" | "local";

interface PluginInfo {
  id: string;
  name: string;
  source: PluginSource;
  enabled: boolean;
  path?: string;
}

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const PI_GLOBAL_EXT_DIR = join(PI_AGENT_DIR, "extensions");
const PI_PROJECT_EXT_DIR = join(process.cwd(), ".pi", "extensions");

function readDirSafe(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function readSettingsExtensions(): { packages: string[]; extensions: string[] } {
  const settingsPath = join(PI_AGENT_DIR, "settings.json");
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { packages?: unknown; extensions?: unknown };
    const packages = Array.isArray(parsed.packages)
      ? parsed.packages.filter((x): x is string => typeof x === "string")
      : [];
    const extensions = Array.isArray(parsed.extensions)
      ? parsed.extensions.filter((x): x is string => typeof x === "string")
      : [];
    return { packages, extensions };
  } catch {
    return { packages: [], extensions: [] };
  }
}

dataRouter.get("/api/plugins", (_req, res) => {
  try {
    const { packages, extensions } = readSettingsExtensions();
    const items: PluginInfo[] = [];

    for (const pkg of packages) {
      items.push({ id: `pkg:${pkg}`, name: pkg, source: "package", enabled: true, path: pkg });
    }
    for (const dir of readDirSafe(PI_GLOBAL_EXT_DIR)) {
      items.push({
        id: `global:${dir}`,
        name: dir,
        source: "global",
        enabled: true,
        path: join(PI_GLOBAL_EXT_DIR, dir),
      });
    }
    for (const dir of readDirSafe(PI_PROJECT_EXT_DIR)) {
      items.push({
        id: `project:${dir}`,
        name: dir,
        source: "project",
        enabled: true,
        path: join(PI_PROJECT_EXT_DIR, dir),
      });
    }
    for (const local of extensions) {
      const abs = resolve(local);
      items.push({ id: `local:${abs}`, name: local, source: "local", enabled: true, path: abs });
    }

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// MCP 管理（GET /api/mcp-servers）= 列 pi 已配置的 MCP servers（与插件/包并列的另一类扩展能力）。
// 扫 ~/.pi/agent/mcp.json（全局）+ <cwd>/.mcp.json（项目）。纯只读。
// 隐私红线：env 仅回传**变量名**（如 MINIMAX_API_KEY），**绝不回传值**（防 API key 泄露到前端）。

type McpTransport = "stdio" | "remote";

interface McpServerInfo {
  id: string;
  name: string;
  source: "global" | "project";
  transport: McpTransport;
  detail: string; // stdio: command + args；remote: url
  envKeys: string[]; // 仅变量名，无值
  enabled: boolean;
}

function readMcpServers(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // 兼容两种写法：{ mcpServers: {...} } 或顶层即 servers 表。
    const servers = (parsed.mcpServers ?? parsed) as unknown;
    return servers && typeof servers === "object" ? (servers as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

dataRouter.get("/api/mcp-servers", (_req, res) => {
  try {
    const items: McpServerInfo[] = [];
    const sources: { source: "global" | "project"; path: string }[] = [
      { source: "global", path: join(PI_AGENT_DIR, "mcp.json") },
      { source: "project", path: join(process.cwd(), ".mcp.json") },
    ];
    for (const { source, path } of sources) {
      for (const [name, raw] of Object.entries(readMcpServers(path))) {
        const cfg = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const url = typeof cfg.url === "string" ? cfg.url : "";
        const command = typeof cfg.command === "string" ? cfg.command : "";
        const args = Array.isArray(cfg.args)
          ? cfg.args.filter((x): x is string => typeof x === "string")
          : [];
        const env = cfg.env && typeof cfg.env === "object" ? (cfg.env as Record<string, unknown>) : {};
        const transport: McpTransport = url ? "remote" : "stdio";
        items.push({
          id: `${source}:${name}`,
          name,
          source,
          transport,
          detail: url || [command, ...args].filter(Boolean).join(" "),
          envKeys: Object.keys(env), // 只暴露变量名，不暴露值
          enabled: cfg.disabled === true ? false : true,
        });
      }
    }
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const SUPPORTED_HOOK_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  "session_start", "session_shutdown",
  "before_agent_start", "agent_start", "agent_end",
  "turn_start", "turn_end",
  "tool_execution_start", "tool_execution_end", "tool_call",
  "message_end",
]);

const SUPPORTED_HOOK_ACTIONS: ReadonlySet<HookActionKind> = new Set<HookActionKind>([
  "command", "log", "block", "mutate", "notify",
]);

function coerceHook(input: unknown): Hook | null {
  const o = asRecord(input);
  const id = asStr(o.id).trim();
  const name = asStr(o.name).trim();
  const rawEvent = asStr(o.event);
  const event = SUPPORTED_HOOK_EVENTS.has(rawEvent as HookEvent) ? (rawEvent as HookEvent) : null;
  if (!id || !name || !event) return null;

  const actionRaw = asRecord(o.action);
  const kind = asStr(actionRaw.kind) as HookActionKind;
  // 类型层不暴露的外发动作（http/webhook 等）走到这里会被白名单拒绝。
  if (!SUPPORTED_HOOK_ACTIONS.has(kind)) return null;
  // 护栏 block/mutate 仅 tool_call 事件有效（pi 的拦截/改参点）。
  if ((kind === "block" || kind === "mutate") && event !== "tool_call") return null;

  let action: HookAction;
  if (kind === "command") {
    const command = asStr(actionRaw.command).trim();
    if (!command) return null;
    action = { kind, command };
  } else if (kind === "block" || kind === "notify") {
    const reason = asStr(actionRaw.reason).trim();
    action = reason ? { kind, reason } : { kind };
  } else if (kind === "mutate") {
    const setRaw = asRecord(actionRaw.set);
    const set: Record<string, string> = {};
    for (const [k, v] of Object.entries(setRaw)) {
      const key = k.trim();
      if (key) set[key] = asStr(v);
    }
    if (Object.keys(set).length === 0) return null;
    action = { kind, set };
  } else {
    action = { kind: "log" };
  }

  let match: HookMatch | undefined;
  if (o.match && typeof o.match === "object") {
    const m = asRecord(o.match);
    const toolName = asStr(m.toolName).trim();
    const pattern = asStr(m.pattern).trim();
    if (toolName || pattern) {
      match = {};
      if (toolName) match.toolName = toolName;
      if (pattern) match.pattern = pattern;
    }
  }

  return {
    id,
    name,
    enabled: o.enabled !== false,
    event,
    ...(match ? { match } : {}),
    action,
  };
}

function readHooksFile(): Hook[] {
  if (!existsSync(HOOKS_CONFIG_PATH)) return [];
  try {
    const raw = readFileSync(HOOKS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { hooks?: unknown })?.hooks)
        ? (parsed as { hooks: unknown[] }).hooks
        : [];
    return arr.map((it) => coerceHook(it)).filter((h): h is Hook => h !== null);
  } catch {
    return [];
  }
}

function writeHooksFile(hooks: Hook[]): void {
  mkdirSync(dirname(HOOKS_CONFIG_PATH), { recursive: true });
  // 与 px-hook-runner 兼容：统一写顶层数组。
  writeFileSync(HOOKS_CONFIG_PATH, JSON.stringify(hooks, null, 2), "utf8");
}

dataRouter.get("/api/hooks", (_req, res) => {
  try {
    res.json(readHooksFile());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 安全提示：本端点无认证（本地单用户工具，仅 bind localhost）。
// 若未来 bind 非 localhost，必须在此加 auth 中间件，否则存在远程代码执行风险（command 类 hook）。
dataRouter.put("/api/hooks", (req, res) => {
  try {
    const body = req.body as unknown;
    const list: unknown[] = Array.isArray(body)
      ? body
      : Array.isArray((body as { hooks?: unknown })?.hooks)
        ? (body as { hooks: unknown[] }).hooks
        : [];
    const cleaned: Hook[] = [];
    const seen = new Set<string>();
    for (const it of list) {
      const h = coerceHook(it);
      if (!h) continue;
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      cleaned.push(h);
    }
    writeHooksFile(cleaned);
    res.json(cleaned);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const TRIGGER_DEFAULT_LIMIT = 200;
const TRIGGER_MAX_LIMIT = 5000;

function readTriggers(limit: number, hookId: string | null, event: string | null): HookTriggerRecord[] {
  if (!existsSync(HOOKS_LOG_PATH)) return [];
  let raw: string;
  try {
    // P1 TODO: 大文件改用 stream 逐行倒读（readline + fs.createReadStream 反向 seek），
    // 避免全量 readFileSync 撑爆内存。当前倒序扫描 + limit 上限 5000 可兜底。
    raw = readFileSync(HOOKS_LOG_PATH, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const out: HookTriggerRecord[] = [];
  // 倒序扫描取最近 N 条（避免大文件全量解析）。
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const r = asRecord(rec);
    const ev = asStr(r.event);
    const hid = asStr(r.hookId);
    if (hookId && hid !== hookId) continue;
    if (event && ev !== event) continue;
    out.push({
      ts: asNum(r.ts),
      hookId: hid,
      event: ev as HookEvent,
      matched: r.matched !== false,
      actionKind: (asStr(r.actionKind) as HookActionKind) || "log",
      ok: r.ok !== false,
      ...(typeof r.exitCode === "number" ? { exitCode: r.exitCode } : {}),
      durationMs: asNum(r.durationMs),
      ...(asStr(r.sessionId) ? { sessionId: asStr(r.sessionId) } : {}),
      ...(asStr(r.argsPreview) ? { argsPreview: asStr(r.argsPreview) } : {}),
      ...(asStr(r.reason) ? { reason: asStr(r.reason) } : {}),
      ...(r.blocked === true ? { blocked: true } : {}),
    });
  }
  return out;
}

dataRouter.get("/api/hooks/triggers", (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : TRIGGER_DEFAULT_LIMIT, TRIGGER_MAX_LIMIT),
    );
    const hookId = typeof req.query.hookId === "string" && req.query.hookId ? req.query.hookId : null;
    const event = typeof req.query.event === "string" && req.query.event ? req.query.event : null;
    res.json(readTriggers(limit, hookId, event));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── 统一记忆 memory_items（规则记忆重构 v2 · D-DATA 实装） ──
//
// 路径策略：legacy /memory/feedback /memory/injections 仍挂在 index.ts 不动；本卡新增
// /memory/items* 系列承载新模型 memory_item 维度的 CRUD + 反馈 + 历史快照。等 D-RETRIEVAL
// 把 'memory_item' 写入 MemoryInjectionSnapshot.sources 后，本端点自然贯通。
//
// 数据安全：memory_items 已是 LLM 可读的衍生记忆条目，title/body 由 D-INGEST 风险门禁
// 把关；本路由不读 draw_data。fact adapter 投影同样不接触原始数据。

const VALID_MEM_TYPES: ReadonlySet<MemoryItemType> = new Set(["constraint", "experience", "episode"]);

function asStringArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseMemoryItemInput(workspaceId: string, body: unknown): { ok: true; value: MemoryItemInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const type = b.type;
  if (typeof type !== "string" || !VALID_MEM_TYPES.has(type as MemoryItemType)) {
    return { ok: false, error: "type must be one of: constraint | experience | episode" };
  }
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return { ok: false, error: "title required" };
  const bodyText = typeof b.body === "string" ? b.body : "";
  const source = b.source === "trace" || b.source === "derived" || b.source === "manual" ? b.source : undefined;
  const scope = b.scope === "chat" || b.scope === "workflow" || b.scope === "global" ? b.scope : undefined;
  const confidence = typeof b.confidence === "number" ? b.confidence : undefined;
  const validUntil = b.validUntil === null ? null : (typeof b.validUntil === "number" ? b.validUntil : undefined);
  const supersedesId = b.supersedesId === null ? null : (typeof b.supersedesId === "string" ? b.supersedesId : undefined);
  const staleAfterDays = typeof b.staleAfterDays === "number" ? b.staleAfterDays : undefined;
  return {
    ok: true,
    value: {
      workspaceId,
      type: type as MemoryItemType,
      title,
      body: bodyText,
      tags: asTagsArr(b.tags),
      source,
      sourceEventIds: asStringArr(b.sourceEventIds),
      confidence,
      riskFlags: coerceRiskFlags(b.riskFlags),
      validUntil,
      supersedesId,
      staleAfterDays,
      scope,
    },
  };
}

dataRouter.get("/api/workspaces/:id/memory/items", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const typeQ = typeof req.query.type === "string" ? req.query.type : undefined;
  const type = typeQ && VALID_MEM_TYPES.has(typeQ as MemoryItemType) ? (typeQ as MemoryItemType) : undefined;
  const enabledOnly = req.query.enabledOnly === "1" || req.query.enabledOnly === "true";
  const includeFacts = req.query.includeFacts === "1" || req.query.includeFacts === "true";
  const items = enabledOnly
    ? listEnabledMemoryItems(req.params.id, type)
    : listMemoryItems({ workspaceId: req.params.id, type });
  // fact 投影由 query 控；默认不混入，避免 PANEL 误把投影当作可写 item。
  const facts = includeFacts ? listProjectedFacts(req.params.id) : [];
  res.json({ items, facts });
});

dataRouter.post("/api/workspaces/:id/memory/items", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseMemoryItemInput(req.params.id, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    res.json(createMemoryItem(parsed.value));
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/memory/items/:itemId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const item = getMemoryItem(req.params.itemId);
  if (!item) return res.status(404).json({ error: "memory item not found" });
  if (item.workspaceId !== req.params.id) return res.status(403).json({ error: "memory item belongs to another workspace" });
  res.json(item);
});

dataRouter.patch("/api/workspaces/:id/memory/items/:itemId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getMemoryItem(req.params.itemId);
  if (!existing) return res.status(404).json({ error: "memory item not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "memory item belongs to another workspace" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: MemoryItemPatch = {};
  if (typeof b.title === "string") patch.title = b.title;
  if (typeof b.body === "string") patch.body = b.body;
  if (Array.isArray(b.tags)) patch.tags = asTagsArr(b.tags);
  if (typeof b.type === "string") {
    if (!VALID_MEM_TYPES.has(b.type as MemoryItemType)) {
      return res.status(400).json({ error: "invalid type" });
    }
    patch.type = b.type as MemoryItemType;
  }
  if (typeof b.confidence === "number") patch.confidence = b.confidence;
  if (Array.isArray(b.riskFlags)) patch.riskFlags = coerceRiskFlags(b.riskFlags);
  if (Array.isArray(b.sourceEventIds)) patch.sourceEventIds = asStringArr(b.sourceEventIds);
  if (b.validUntil === null || typeof b.validUntil === "number") patch.validUntil = b.validUntil;
  if (b.supersedesId === null || typeof b.supersedesId === "string") patch.supersedesId = b.supersedesId;
  if (typeof b.staleAfterDays === "number") patch.staleAfterDays = b.staleAfterDays;
  if (b.scope === "global" || b.scope === "chat" || b.scope === "workflow") patch.scope = b.scope;
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  try {
    const updated = updateMemoryItem(req.params.itemId, patch);
    if (!updated) return res.status(404).json({ error: "memory item not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.delete("/api/workspaces/:id/memory/items/:itemId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getMemoryItem(req.params.itemId);
  if (!existing) return res.status(404).json({ error: "memory item not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "memory item belongs to another workspace" });
  const ok = deleteMemoryItem(req.params.itemId);
  res.json({ ok });
});

// /memory/items/:itemId/feedback —— 接 recordMemoryFeedback 语义但目标维度=memory_item
// （旧 sourceKind 维度仍由 index.ts 的 legacy /memory/feedback 处理）。
dataRouter.post("/api/workspaces/:id/memory/items/:itemId/feedback", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getMemoryItem(req.params.itemId);
  if (!existing) return res.status(404).json({ error: "memory item not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "memory item belongs to another workspace" });
  const signal = req.body?.signal;
  if (signal !== "positive" && signal !== "negative") {
    return res.status(400).json({ error: "signal must be positive or negative" });
  }
  const updated = recordMemoryItemFeedback(req.params.itemId, signal);
  if (!updated) return res.status(404).json({ error: "memory item not found" });
  res.json(updated);
});

// /memory/items/_/injections —— 历史快照。当前与 legacy /memory/injections 同源（trace_events 中
// MemoryInjectionSnapshot），D-RETRIEVAL 把 memory_item 写进 snapshot.sources 后即贯通。
// 路径中以 `_` 占位避免与 /memory/items/:itemId 冲突。
dataRouter.get("/api/workspaces/:id/memory/items/_/injections", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  res.json(listMemoryInjectionRecords(req.params.id, limit));
});

// /memory/preview —— D-PANEL 注入预览：薄壳调 buildMemoryPrompt，返回字符数 + token 估算 + 启用条目数。
// 用于面板侧实时预览"如果现在发起一次 chat / workflow 会注入什么"，不写库不发 LLM。
dataRouter.get("/api/workspaces/:id/memory/preview", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const targetScopeRaw = typeof req.query.targetScope === "string" ? req.query.targetScope : "chat";
  const targetScope: "chat" | "workflow" = targetScopeRaw === "workflow" ? "workflow" : "chat";
  const query = typeof req.query.query === "string" ? req.query.query : "";
  // 显式 tags（?tag=a&tag=b 重复参数）→ 引擎 filterTags 硬过滤（untagged / 非命中被剔）。
  const tags = readTagsQuery(req.query.tag);
  const ctx = query || tags.length ? { query, tags } : undefined;
  let prompt: string;
  try {
    prompt = buildMemoryPrompt(req.params.id, targetScope, {}, ctx);
  } catch (err) {
    return res.status(500).json({ error: "failed to build memory prompt" });
  }
  const charCount = prompt.length;
  // 与 memory-injection.ts 估算口径一致：~4 chars/token（粗算，仅用于 UI 展示）。
  const tokenEstimate = Math.ceil(charCount / 4);
  const enabled = listEnabledMemoryItems(req.params.id);
  // itemCount 反映硬过滤后命中条目数：与引擎 filterTags 同向（OR 命中，untagged 被剔）。
  // 无显式 tags 时退回全量 enabled，行为不变。
  const tagSet = new Set(tags);
  const matched = tagSet.size > 0
    ? enabled.filter((it) => it.tags.some((t) => tagSet.has(t)))
    : enabled;
  const facts = listProjectedFacts(req.params.id);
  res.json({
    prompt,
    charCount,
    tokenEstimate,
    itemCount: matched.length,
    factCount: facts.filter((f) => f.enabled).length,
  });
});

// /memory/aging-signals —— D-AGING2 老化信号 GET 端点（read-only）。
// 真源：computeMemoryAgingSignals（D 域自有，不依赖 E inspector）。
// 消费方：① RulesPane 展示老化提示区；② E-AGING1 巡检（通过 HTTP fetch，不允许 import）。
// 安全：仅扫 memory_items 衍生字段；零 LLM；零 draw_data。
dataRouter.get("/api/workspaces/:id/memory/aging-signals", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    const result = computeMemoryAgingSignals({ workspaceId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ── onto-knowhow · 指标模板池 + 治理（D-OKH1 / D-OKH2）──
// 模板/冲突/体检均为确定性本地逻辑；标准文件体检只做 stat/access/扩展名，不读取正文，不走 LLM。

const OKH_SCENARIOS = new Set(["retail", "member", "ecommerce", "supply_chain", "finance", "custom"]);

dataRouter.get("/api/workspaces/:id/onto-knowhow/templates", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const rawScenario = typeof req.query.scenario === "string" ? req.query.scenario : undefined;
  const scenario = rawScenario && OKH_SCENARIOS.has(rawScenario) ? rawScenario as OkhTemplateScenario : undefined;
  res.json(listMetricTemplates(scenario));
});

dataRouter.post("/api/workspaces/:id/onto-knowhow/templates/apply", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const packId = typeof req.body?.packId === "string" ? req.body.packId : undefined;
  const templateIds = Array.isArray(req.body?.templateIds)
    ? req.body.templateIds.filter((x: unknown): x is string => typeof x === "string")
    : undefined;
  if (!packId && (!templateIds || templateIds.length === 0)) return res.status(400).json({ error: "packId or templateIds required" });
  try {
    res.json(applyMetricTemplates({ workspaceId: req.params.id, packId, templateIds, enable: req.body?.enable !== false }));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/onto-knowhow/conflicts", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    const includeDisabled = req.query.includeDisabled === "true" || req.query.includeDisabled === "1";
    res.json(detectMetricConflicts(req.params.id, includeDisabled));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});


dataRouter.get("/api/workspaces/:id/onto-knowhow/ontologies/:ontologyId/targets/:targetKind/:targetId/metric-links", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    const targetKind = req.params.targetKind as OkhMetricOntologyLink["targetKind"];
    if (targetKind !== "object" && targetKind !== "link" && targetKind !== "logic") {
      return res.status(400).json({ error: "invalid targetKind" });
    }
    res.json(listOkhMetricOntologyLinksByTarget(req.params.id, req.params.ontologyId, targetKind, req.params.targetId));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/onto-knowhow/ontologies/:ontologyId/metric-links", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    res.json(listOkhMetricOntologyLinksByOntology(req.params.id, req.params.ontologyId));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/onto-knowhow/standard-health", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    res.json(inspectStandardFiles(req.params.id));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.post("/api/workspaces/:id/onto-knowhow/standard-health/check", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const standardIds = Array.isArray(req.body?.standardIds)
    ? req.body.standardIds.filter((x: unknown): x is string => typeof x === "string")
    : undefined;
  try {
    res.json(inspectStandardFiles(req.params.id, standardIds));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.post("/api/workspaces/:id/onto-knowhow/import/preview", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  const format = req.body?.format === "json" ? "json" : req.body?.format === "csv" ? "csv" : null;
  if (!format) return res.status(400).json({ error: "format must be csv or json" });
  if (!content.trim()) return res.status(400).json({ error: "content required" });
  try {
    res.json(previewOkhMetricImport(req.params.id, content, format));
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.post("/api/workspaces/:id/onto-knowhow/import/commit", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const conflictPolicy = req.body?.conflictPolicy === "create_version" ? "create_version" : "skip";
  try {
    res.json(commitOkhMetricImport({ workspaceId: req.params.id, rows, enable: req.body?.enable !== false, conflictPolicy }));
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/onto-knowhow/export", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const format = req.query.format === "json" ? "json" : "csv";
  const enabledOnly = req.query.enabledOnly !== "false" && req.query.enabledOnly !== "0";
  try {
    const content = exportOkhMetrics(req.params.id, enabledOnly, format);
    res.setHeader("Content-Type", format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="onto-knowhow-metrics.${format}"`);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/onto-knowhow/metrics/:metricId/ontology-links", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    res.json(listOkhMetricOntologyLinks(req.params.id, req.params.metricId));
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

function parseOkhMetricOntologyLinksBody(body: unknown): Array<{ ontologyId: string; targetKind: OkhMetricOntologyLink["targetKind"]; targetId: string }> {
  const maybeLinks = typeof body === "object" && body !== null && "links" in body
    ? (body as { links?: unknown }).links
    : undefined;
  if (!Array.isArray(maybeLinks)) throw new Error("links must be an array");
  return maybeLinks.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) throw new Error(`links[${index}] must be an object`);
    const link = raw as { ontologyId?: unknown; targetKind?: unknown; targetId?: unknown };
    if (typeof link.ontologyId !== "string" || !link.ontologyId.trim()) throw new Error(`links[${index}].ontologyId is required`);
    if (link.targetKind !== "object" && link.targetKind !== "link" && link.targetKind !== "logic") throw new Error(`links[${index}].targetKind is invalid`);
    if (typeof link.targetId !== "string" || !link.targetId.trim()) throw new Error(`links[${index}].targetId is required`);
    return { ontologyId: link.ontologyId, targetKind: link.targetKind, targetId: link.targetId };
  });
}

dataRouter.put("/api/workspaces/:id/onto-knowhow/metrics/:metricId/ontology-links", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  try {
    const links = parseOkhMetricOntologyLinksBody(req.body);
    res.json(replaceOkhMetricOntologyLinks(req.params.id, req.params.metricId, links));
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.delete("/api/workspaces/:id/onto-knowhow/metric-ontology-links/:linkId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json({ ok: deleteOkhMetricOntologyLink(req.params.id, req.params.linkId) });
});


// ============================================================================
// 候选记忆入库门禁端点（D-INGEST · 阶段2）
// ----------------------------------------------------------------------------
// E 蒸馏 runner 通过本端点写入候选, 门禁返回:
//   - 200 + { id, ... }       自动入库 (E 据此记 itemId)
//   - 200 + { reviewId, ... } 进入复核队列 (E 视为治理保留, 不算失败)
//   - 400 + { error }         高危拒绝 / 字段非法
//
// 总控协调: 把 engine 默认 ingestPath 翻到 /api/workspaces/:id/memory/ingest
// (engine 调用点归 E, 见 routes/engine.ts:156 + 1194 默认值).
// ============================================================================

const VALID_TYPES_INGEST: ReadonlySet<MemoryItemType> = new Set(["constraint", "experience", "episode"]);
const VALID_SCOPES_INGEST = new Set(["global", "chat", "workflow"] as const);

// 测试注入钩子: 单测可通过 __setIngestJudgeOverride 注入 mock judge 函数,
// 避免在测试里跑真实 pi 进程. 生产路径默认 undefined -> judgeSemanticDuplicate 走 runPiPrompt.
let ingestJudgeOverride: JudgeFn | undefined;
export function __setIngestJudgeOverride(fn: JudgeFn | undefined): void {
  ingestJudgeOverride = fn;
}

function parseIngestBody(workspaceId: string, body: unknown): { ok: true; value: MemoryIngestInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const type = b.type;
  if (typeof type !== "string" || !VALID_TYPES_INGEST.has(type as MemoryItemType)) {
    return { ok: false, error: "type must be one of: constraint | experience | episode" };
  }
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return { ok: false, error: "title required" };
  const bodyText = typeof b.body === "string" ? b.body : "";
  if (!bodyText.trim()) return { ok: false, error: "body required" };
  const scopeRaw = typeof b.scope === "string" ? b.scope : "global";
  const scope = (VALID_SCOPES_INGEST as ReadonlySet<string>).has(scopeRaw)
    ? (scopeRaw as MemoryIngestInput["scope"])
    : "global";
  const sourceEventIds = Array.isArray(b.sourceEventIds)
    ? b.sourceEventIds.filter((x): x is string => typeof x === "string")
    : [];
  const confidence = typeof b.confidence === "number" && Number.isFinite(b.confidence)
    ? Math.max(0, Math.min(1, b.confidence))
    : 0.5;
  const targetKind = typeof b.targetKind === "string" ? b.targetKind : null;
  const targetId = typeof b.targetId === "string" ? b.targetId : null;
  return {
    ok: true,
    value: {
      workspaceId,
      type: type as MemoryItemType,
      title,
      body: bodyText,
      tags: asTagsArr(b.tags),
      scope,
      sourceEventIds,
      confidence,
      riskFlags: coerceRiskFlags(b.riskFlags),
      targetKind,
      targetId,
    },
  };
}

dataRouter.post("/api/workspaces/:id/memory/ingest", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const parsed = parseIngestBody(req.params.id, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    // 成本门控: 词法命中直接走旧路径, 不调 LLM. 词法漏判 + shortlist 非空才 judge.
    let semanticDupId: string | null = null;
    const lexicalDup = findMemoryItemDuplicate(parsed.value.workspaceId, parsed.value.type, parsed.value.title);
    if (!lexicalDup) {
      const shortlist = findSemanticDedupShortlist(
        parsed.value.workspaceId,
        parsed.value.type,
        parsed.value.title,
        parsed.value.body,
      );
      if (shortlist.length > 0) {
        semanticDupId = await judgeSemanticDuplicate(
          { title: parsed.value.title, body: parsed.value.body },
          shortlist,
          { workspaceRoot: workspace.rootPath },
          ingestJudgeOverride,
        );
      }
    }
    const verdict = ingestMemoryCandidate(parsed.value, semanticDupId);
    if (verdict.kind === "rejected") {
      return res.status(400).json({ error: verdict.reason, riskFlags: verdict.riskFlags });
    }
    if (verdict.kind === "review") {
      return res.json({
        status: "review",
        reviewId: verdict.review.id,
        review: verdict.review,
      });
    }
    // accepted —— 与 E ingester 契约对齐: 顶层 id = memory_item.id
    return res.json({
      id: verdict.item.id,
      status: "accepted",
      item: verdict.item,
      supersededId: verdict.supersededId,
      riskFlags: verdict.riskFlags,
      confidence: verdict.confidence,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ---- review 队列端点 (供 D-PANEL 一键采纳/拒绝) ----

dataRouter.get("/api/workspaces/:id/memory/reviews", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const statusQ = typeof req.query.status === "string" ? req.query.status : undefined;
  const status: MemoryReview["status"] | undefined =
    statusQ === "pending" || statusQ === "accepted" || statusQ === "rejected" ? statusQ : undefined;
  res.json(listMemoryReviews(req.params.id, status));
});

dataRouter.post("/api/workspaces/:id/memory/reviews/:reviewId/accept", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getMemoryReview(req.params.reviewId);
  if (!existing) return res.status(404).json({ error: "review not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "review belongs to another workspace" });
  if (existing.status !== "pending") return res.status(409).json({ error: `review already ${existing.status}` });
  const out = acceptMemoryReview(req.params.reviewId);
  if (!out) return res.status(500).json({ error: "failed to accept review" });
  res.json(out);
});

dataRouter.post("/api/workspaces/:id/memory/reviews/:reviewId/reject", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getMemoryReview(req.params.reviewId);
  if (!existing) return res.status(404).json({ error: "review not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "review belongs to another workspace" });
  if (existing.status !== "pending") return res.status(409).json({ error: `review already ${existing.status}` });
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  const out = rejectMemoryReview(req.params.reviewId, reason);
  if (!out) return res.status(500).json({ error: "failed to reject review" });
  res.json(out);
});

// ============================================================================
// 知识库 knowledge_docs / knowledge_chunks（D-DATA + D-RETRIEVAL 实装）
// ----------------------------------------------------------------------------
// /api/workspaces/:id/knowledge          GET 列表 / POST 新建
// /api/workspaces/:id/knowledge/:docId   GET 详情(含 chunks) / PATCH / DELETE
// /api/workspaces/:id/knowledge/search   POST { query, topK?, docIds? } → BM25 召回
//
// 数据安全: 文档 = 用户上传/登记的非结构化资料(folder kind 'knowledge'); 分块策略段落
// 优先, 不接 draw_data 原始数据; 检索零新依赖, 复用现有 BM25 词法+多信号范式。
//
// path 字段语义: 仅作为元数据存储（来源/原始文件位置展示），server 端不会基于它做
// readFileSync / 路径解析。任何后续把 doc.path 用于 fs 读取的代码必须先过 safeResolve()
// 工作区沙箱校验，否则即引入路径穿越漏洞。
// ============================================================================

const KNOWLEDGE_CONTENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB; 超大文档应先在客户端拆分再上传

function asTagsArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && !!t) : [];
}

dataRouter.get("/api/workspaces/:id/knowledge", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  res.json(listKnowledgeDocs(req.params.id));
});

dataRouter.post("/api/workspaces/:id/knowledge", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return res.status(400).json({ error: "title required" });
  const content = typeof b.content === "string" ? b.content : "";
  if (!content.trim()) return res.status(400).json({ error: "content required" });
  if (Buffer.byteLength(content, "utf8") > KNOWLEDGE_CONTENT_MAX_BYTES) {
    return res.status(413).json({ error: `content too large (max ${KNOWLEDGE_CONTENT_MAX_BYTES} bytes)` });
  }
  const sourceType = b.sourceType === "path" ? "path" : "upload";
  // D-POOL1: scope 默认 'workspace'(项目专属)；显式 'global' 入池跨工作区可启用。
  const scope: "global" | "workspace" = b.scope === "global" ? "global" : "workspace";
  try {
    const doc = createKnowledgeDoc({
      workspaceId: req.params.id,
      title,
      sourceType,
      path: typeof b.path === "string" ? b.path : null,
      content,
      tags: asTagsArr(b.tags),
      scope,
    });
    // D-KB2: 异步生成摘要，不阻塞上传响应
    const ws = getWorkspace(req.params.id);
    if (ws) {
      const summaryContent = content;
      const summaryDocId = doc.id;
      setImmediate(async () => {
        try {
          const summary = await runPiPrompt({
            workspaceRoot: ws.rootPath,
            text: `请用 200 字以内概括这篇文档的核心方法/决议/要点，保留关键术语。\n\n文档标题：${title}\n\n文档内容：\n${summaryContent.slice(0, 8000)}`,
            timeoutMs: 30_000,
          });
          const trimmed = summary.trim().slice(0, 200);
          if (trimmed) setKnowledgeDocSummary(summaryDocId, trimmed);
        } catch {
          // 摘要生成失败不影响主流程
        }
      });
    }
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// D-KB1: doc 级聚合检索（GET，纯 UI 入口，不注册 agent tool）
// 必须注册在 /knowledge/:docId 之前，否则 Express 按注册顺序会把 "search" 当 docId 处理。
dataRouter.get("/api/workspaces/:id/knowledge/search", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const query = typeof req.query.q === "string" ? req.query.q : "";
  if (!query.trim()) return res.status(400).json({ error: "query required" });
  const topK = typeof req.query.topK === "string" ? Math.min(50, Math.max(1, parseInt(req.query.topK, 10) || 10)) : 10;
  try {
    const results = searchKnowledgeDocs(req.params.id, query, { topK, tokenizationMode: "weighted" });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/knowledge/:docId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const doc = getKnowledgeDoc(req.params.docId);
  if (!doc) return res.status(404).json({ error: "knowledge doc not found" });
  // D-POOL1: global 文档跨工作区可读；workspace 私有仅 origin ws 可读。
  if (doc.scope !== "global" && doc.workspaceId !== req.params.id) {
    return res.status(403).json({ error: "doc belongs to another workspace" });
  }
  const chunks = listKnowledgeChunks(doc.id);
  res.json({ doc, chunks });
});

dataRouter.patch("/api/workspaces/:id/knowledge/:docId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getKnowledgeDoc(req.params.docId);
  if (!existing) return res.status(404).json({ error: "knowledge doc not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "doc belongs to another workspace" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.content === "string" && Buffer.byteLength(b.content, "utf8") > KNOWLEDGE_CONTENT_MAX_BYTES) {
    return res.status(413).json({ error: `content too large (max ${KNOWLEDGE_CONTENT_MAX_BYTES} bytes)` });
  }
  const patch: KnowledgeDocPatch = {};
  if (typeof b.title === "string") patch.title = b.title;
  if (b.path === null || typeof b.path === "string") patch.path = b.path;
  if (typeof b.content === "string") patch.content = b.content;
  if (Array.isArray(b.tags)) patch.tags = asTagsArr(b.tags);
  try {
    const updated = updateKnowledgeDoc(existing.id, patch);
    if (!updated) return res.status(404).json({ error: "knowledge doc not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.delete("/api/workspaces/:id/knowledge/:docId", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getKnowledgeDoc(req.params.docId);
  if (!existing) return res.status(404).json({ error: "knowledge doc not found" });
  if (existing.workspaceId !== req.params.id) return res.status(403).json({ error: "doc belongs to another workspace" });
  res.json({ ok: deleteKnowledgeDoc(existing.id) });
});

dataRouter.post("/api/workspaces/:id/knowledge/search", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const query = typeof b.query === "string" ? b.query : "";
  if (!query.trim()) return res.status(400).json({ error: "query required" });
  const topK = typeof b.topK === "number" && b.topK > 0 ? Math.min(50, Math.floor(b.topK)) : 10;
  const docIds = Array.isArray(b.docIds)
    ? (b.docIds as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;
  const minScore = typeof b.minScore === "number" ? b.minScore : undefined;
  try {
    const hits = searchKnowledgeChunks(req.params.id, query, { topK, docIds, minScore });
    res.json({ hits });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ============================================================================
// prompts 模板库 prompt_templates（D-DATA 实装 · 总控 X 接缝审定）
// ----------------------------------------------------------------------------
// /api/workspaces/:id/prompt-templates           GET 列表 / POST 新建
// /api/workspaces/:id/prompt-templates/:tid      GET / PATCH / DELETE
//
// 列表过滤（query）：
//   - category=<str>        精确匹配
//   - tag=<str>             支持重复（&tag=a&tag=b 任一匹配 OR）
//   - includeGlobal=0|1     【D-POOL1 弃用】保留兼容；现为纯全局池，参数被忽略
// body 内 {{变量}} 占位仅存储；createPromptTemplate 在未显式传 variables 时自动抽取。
// ============================================================================

const PROMPT_BODY_MAX_BYTES = 256 * 1024; // 256 KB；超大 prompt 应当拆模板

function readTagsQuery(q: unknown): string[] {
  if (Array.isArray(q)) return q.filter((t): t is string => typeof t === "string" && !!t);
  if (typeof q === "string" && q) return [q];
  return [];
}

dataRouter.get("/api/workspaces/:id/prompt-templates", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const tags = readTagsQuery(req.query.tag);
  const includeGlobal = req.query.includeGlobal !== "0";
  res.json(listPromptTemplates(req.params.id, { category, tags, includeGlobal }));
});

dataRouter.post("/api/workspaces/:id/prompt-templates", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return res.status(400).json({ error: "title required" });
  const body = typeof b.body === "string" ? b.body : "";
  if (Buffer.byteLength(body, "utf8") > PROMPT_BODY_MAX_BYTES) {
    return res.status(413).json({ error: `body too large (max ${PROMPT_BODY_MAX_BYTES} bytes)` });
  }
  // workspaceId: 显式传 null = 全局；不传 = 默认绑当前 workspace。
  const wsId = b.workspaceId === null ? null
    : typeof b.workspaceId === "string" ? b.workspaceId
    : req.params.id;
  try {
    const tpl = createPromptTemplate({
      workspaceId: wsId,
      title,
      category: typeof b.category === "string" ? b.category : "",
      body,
      variables: Array.isArray(b.variables) ? asTagsArr(b.variables) : undefined,
      tags: asTagsArr(b.tags),
    });
    res.json(tpl);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/prompt-templates/:tid", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const tpl = getPromptTemplate(req.params.tid);
  if (!tpl) return res.status(404).json({ error: "prompt template not found" });
  // 全局模板（workspaceId=null）任意工作区可读；非全局只能本工作区。
  if (tpl.workspaceId !== null && tpl.workspaceId !== req.params.id) {
    return res.status(403).json({ error: "template belongs to another workspace" });
  }
  res.json(tpl);
});

dataRouter.patch("/api/workspaces/:id/prompt-templates/:tid", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getPromptTemplate(req.params.tid);
  if (!existing) return res.status(404).json({ error: "prompt template not found" });
  if (existing.workspaceId !== null && existing.workspaceId !== req.params.id) {
    return res.status(403).json({ error: "template belongs to another workspace" });
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.body === "string" && Buffer.byteLength(b.body, "utf8") > PROMPT_BODY_MAX_BYTES) {
    return res.status(413).json({ error: `body too large (max ${PROMPT_BODY_MAX_BYTES} bytes)` });
  }
  const patch: PromptTemplatePatch = {};
  if (typeof b.title === "string") patch.title = b.title;
  if (typeof b.category === "string") patch.category = b.category;
  if (typeof b.body === "string") patch.body = b.body;
  if (Array.isArray(b.variables)) patch.variables = asTagsArr(b.variables);
  if (Array.isArray(b.tags)) patch.tags = asTagsArr(b.tags);
  try {
    const updated = updatePromptTemplate(existing.id, patch);
    if (!updated) return res.status(404).json({ error: "prompt template not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.delete("/api/workspaces/:id/prompt-templates/:tid", (req, res) => {
  if (!getWorkspace(req.params.id)) return res.status(404).json({ error: "workspace not found" });
  const existing = getPromptTemplate(req.params.tid);
  if (!existing) return res.status(404).json({ error: "prompt template not found" });
  if (existing.workspaceId !== null && existing.workspaceId !== req.params.id) {
    return res.status(403).json({ error: "template belongs to another workspace" });
  }
  res.json({ ok: deletePromptTemplate(existing.id) });
});

// ============================================================================
// SQL 连接扩展 · 导入/导出/建表（D-SQL1）
// ----------------------------------------------------------------------------
// 新路由独立于 index.ts legacy SQL 路由，写库能力不走己 query 接口。
// 数据安全：文件内容由前端解析后传 rows 给 server，不涉及 draw_data 原始路径。
// SQLite 优先，PG/MySQL 写入暂返回 unsupported。
// ============================================================================

dataRouter.post("/api/sql-connections/:id/import/preview", (req, res) => {
  const conn = getSqlConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: "connection not found" });
  if (conn.type !== "sqlite") return res.status(400).json({ error: "导入暂仅支持 SQLite" });
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows required" });
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "data.csv";
    if (rows.length === 0) return res.json({ columns: [], totalRows: 0, risks: ["空文件"], fileName });
    const columns = inferColumnTypes(rows);
    const risks: string[] = [];
    // detect single-column
    if (columns.length <= 1) risks.push("只有 1 列，确认数据正确？");
    // detect suspicious column names
    for (const c of columns) {
      if (!c.name.trim()) risks.push("存在空列名，将自动生成列名");
      if (sanitizeIdentifier(c.name, "column") !== c.name) risks.push(`列名 "${c.name}" 含有非法字符，将自动清理`);
    }
    res.json({ columns, totalRows: rows.length, risks, fileName } as ImportPreviewResult);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.post("/api/sql-connections/:id/import/commit", (req, res) => {
  const conn = getSqlConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: "connection not found" });
  if (conn.type !== "sqlite") return res.status(400).json({ error: "导入暂仅支持 SQLite" });
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows required" });
    const rawTable = typeof req.body?.tableName === "string" ? req.body.tableName.trim() : "";
    if (!rawTable) return res.status(400).json({ error: "tableName required" });
    const tableName = sanitizeIdentifier(rawTable, "table");
    const mode = req.body?.mode === "append" ? "append" : "create";
    const columnsRaw = req.body?.columns;
    if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) return res.status(400).json({ error: "columns required" });
    const columns: { sourceName: string; name: string; type: string }[] = columnsRaw.map((c: Record<string, unknown>) => {
      const rawName = typeof c.name === "string" ? c.name : "col";
      // sourceName 必须用客户端传来的原始 key（rows 上的 key），未传则回退用 name 自身（向后兼容）
      const sourceName = typeof c.sourceName === "string" && c.sourceName ? c.sourceName : rawName;
      return {
        sourceName,
        name: sanitizeIdentifier(rawName, "column"),
        type: typeof c.type === "string" && ["INTEGER", "REAL", "TEXT"].includes(c.type) ? c.type : "TEXT",
      };
    });
    const result = importRowsToDb(conn, tableName, columns, rows, mode);
    // trace
    const wsId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
    if (wsId) {
      addTraceEvent({
        workspaceId: wsId,
        targetKind: "sql_connection",
        targetId: conn.id,
        type: "sql_import",
        target: conn.name,
        status: "success",
        detail: `导入 ${result.rowCount} 行 → ${tableName} · 模式=${mode}`,
        payload: { tableName, rowCount: result.rowCount, mode, riskLevel: "L2" },
      });
    }
    res.json({ tableName, rowCount: result.rowCount, mode });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.post("/api/sql-connections/:id/create-table", (req, res) => {
  const conn = getSqlConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: "connection not found" });
  if (conn.type !== "sqlite") return res.status(400).json({ error: "建表暂仅支持 SQLite" });
  try {
    const rawTable = typeof req.body?.tableName === "string" ? req.body.tableName.trim() : "";
    if (!rawTable) return res.status(400).json({ error: "tableName required" });
    const tableName = sanitizeIdentifier(rawTable, "table");
    const columnsRaw = req.body?.columns;
    if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) return res.status(400).json({ error: "columns required" });
    const columns = columnsRaw.map((c: Record<string, unknown>) => ({
      name: sanitizeIdentifier(typeof c.name === "string" ? c.name : "col", "column"),
      type: typeof c.type === "string" && ["INTEGER", "REAL", "TEXT"].includes(c.type) ? c.type : "TEXT",
    }));
    importRowsToDb(conn, tableName, columns, [], "create");
    const wsId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
    if (wsId) {
      addTraceEvent({
        workspaceId: wsId,
        targetKind: "sql_connection",
        targetId: conn.id,
        type: "sql_create_table",
        target: conn.name,
        status: "success",
        detail: `建表 ${tableName} · ${columns.length} 列`,
        payload: { tableName, columns: columns.map((c) => c.name), riskLevel: "L2" },
      });
    }
    res.json({ tableName, columns });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.post("/api/sql-connections/:id/export/table", async (req, res) => {
  const conn = getSqlConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: "connection not found" });
  try {
    const rawTable = typeof req.body?.tableName === "string" ? req.body.tableName.trim() : "";
    if (!rawTable) return res.status(400).json({ error: "tableName required" });
    const format = req.body?.format === "csv" ? "csv" : "json";
    const { columns, rows } = await exportTableQuery(conn, rawTable);
    const wsId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
    if (wsId) {
      addTraceEvent({
        workspaceId: wsId,
        targetKind: "sql_connection",
        targetId: conn.id,
        type: "sql_export",
        target: conn.name,
        status: "success",
        detail: `导出表 ${rawTable} → ${format} · ${rows.length} 行`,
        payload: { tableName: rawTable, format, rowCount: rows.length, riskLevel: "L1" },
      });
    }
    if (format === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.send(rowsToCsv(columns, rows));
    } else {
      res.json({ columns, rows, rowCount: rows.length, format });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dataRouter.post("/api/sql-connections/:id/export/query", async (req, res) => {
  const conn = getSqlConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: "connection not found" });
  try {
    const sql = typeof req.body?.sql === "string" ? req.body.sql.trim() : "";
    if (!sql) return res.status(400).json({ error: "sql required" });
    const validation = validateSql(sql);
    if (!validation.safe) return res.status(400).json({ error: "SQL 包含危险操作", validation });
    const format = req.body?.format === "csv" ? "csv" : "json";
    const params = typeof req.body?.params === "object" && req.body.params !== null
      ? req.body.params as Record<string, unknown>
      : undefined;
    const { columns, rows } = await exportTableQuery(conn, sql, params);
    const wsId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : undefined;
    if (wsId) {
      addTraceEvent({
        workspaceId: wsId,
        targetKind: "sql_connection",
        targetId: conn.id,
        type: "sql_export",
        target: conn.name,
        status: "success",
        detail: `导出查询 → ${format} · ${rows.length} 行`,
        payload: { sql: sql.slice(0, 200), format, rowCount: rows.length, riskLevel: "L1" },
      });
    }
    if (format === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.send(rowsToCsv(columns, rows));
    } else {
      res.json({ columns, rows, rowCount: rows.length, format });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// SQLite 新建 .db 文件：通过 connection 配置文件路径完成创建（仅创建空文件，等用户后续 upsert 连接）
dataRouter.post("/api/sql-connections/sqlite/create-db", (req, res) => {
  try {
    const filePath = typeof req.body?.filePath === "string" ? req.body.filePath.trim() : "";
    if (!filePath) return res.status(400).json({ error: "filePath required" });
    if (!filePath.endsWith(".db") && !filePath.endsWith(".sqlite") && !filePath.endsWith(".sqlite3")) {
      return res.status(400).json({ error: "filePath should end with .db / .sqlite / .sqlite3" });
    }
    if (existsSync(filePath)) {
      return res.status(409).json({ error: "目标文件已存在", path: filePath });
    }
    mkdirSync(dirname(filePath), { recursive: true });
    const db = new DatabaseSync(filePath);
    db.close();
    res.json({ path: filePath, created: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============================================================================
// 监测初始化导入（D-MONITOR6 · X-MONITOR5 口径）
// ----------------------------------------------------------------------------
// 单入口：POST /api/workspaces/:id/monitor/import-sql
//   - 把数据库连接（SQLite/PG/MySQL）的 table 或 SELECT SQL 导出为监测专用
//     clean_data 文件，登记 workspace_paths(folder=clean_data) 并返回 pathId。
//   - 物理路径固定在工作区 ${rootPath}/clean_data/monitor/ 下，文件名按 datasetName
//     sanitize 后落盘；同名自动生成版本文件；前端不传绝对 outputPath。
//   - SQL 走 validateSql 拒绝任何非 SELECT；tableName 模式自动构造安全 SELECT
//     `SELECT * FROM "<sanitized>"`（双引号 ident，禁止字符串拼接注入）。
//   - 不读 draw_data；不把 rows 发 LLM；只读端点（仅写本地 clean_data + 登记）。
//
// 配套：GET /api/workspaces/:id/monitor/imports
//   - 仅返回 clean_data/monitor/ 子树下的聚合集（path 前缀过滤），供初始化页只读列表使用，
//     不暴露工作区其他 clean_data。
// ============================================================================

const MONITOR_DIR = "clean_data/monitor";
const MONITOR_TABULAR_EXT = new Set([".csv", ".tsv", ".xlsx", ".xls", ".json"]);

function sanitizeMonitorFileName(raw: string, ext: ".csv" | ".json"): string {
  const base = raw.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_").replace(/^_+|_+$/g, "");
  const truncated = base.slice(0, 80) || "import";
  return `${truncated}${ext}`;
}

function resolveMonitorPath(workspaceRoot: string, fileName: string): string {
  const monitorBase = resolve(workspaceRoot, MONITOR_DIR);
  const target = resolve(monitorBase, fileName);
  if (target === monitorBase || !target.startsWith(monitorBase + "/")) {
    throw new Error(`unsafe path: ${fileName}`);
  }
  return target;
}

function uniqueMonitorFileName(workspaceRoot: string, fileName: string, ext: ".csv" | ".json"): string {
  if (!existsSync(resolveMonitorPath(workspaceRoot, fileName))) return fileName;
  const stem = fileName.slice(0, -ext.length);
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem}_${i}${ext}`;
    if (!existsSync(resolveMonitorPath(workspaceRoot, candidate))) return candidate;
  }
  throw new Error(`too many versions for monitor import: ${fileName}`);
}

dataRouter.post("/api/workspaces/:id/monitor/import-sql", async (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const connectionId = typeof req.body?.connectionId === "string" ? req.body.connectionId.trim() : "";
    if (!connectionId) return res.status(400).json({ error: "connectionId required" });
    const conn = getSqlConnection(connectionId);
    if (!conn) return res.status(404).json({ error: "sql connection not found" });

    const rawSql = typeof req.body?.sql === "string" ? req.body.sql.trim() : "";
    const rawTable = typeof req.body?.tableName === "string" ? req.body.tableName.trim() : "";
    if (!rawSql && !rawTable) return res.status(400).json({ error: "sql or tableName required" });

    const rawDatasetName = typeof req.body?.datasetName === "string" ? req.body.datasetName.trim() : "";
    if (!rawDatasetName) return res.status(400).json({ error: "datasetName required" });

    const formatRaw = typeof req.body?.format === "string" ? req.body.format : "csv";
    const format: "csv" | "json" = formatRaw === "json" ? "json" : "csv";

    let finalSql: string;
    if (rawSql) {
      const validation = validateSql(rawSql);
      if (!validation.safe) return res.status(400).json({ error: "SQL 包含危险操作（仅允许只读 SELECT）", validation });
      const upper = rawSql.toUpperCase();
      if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
        return res.status(400).json({ error: "仅允许只读 SELECT 查询" });
      }
      finalSql = rawSql;
    } else {
      const sanitizedTable = sanitizeIdentifier(rawTable, "table");
      if (conn.type === "sqlite") {
        const schema = await getSqlSchema(conn);
        if (!schema.some((t) => t.name === rawTable || t.name === sanitizedTable)) {
          return res.status(404).json({ error: `table not found: ${rawTable}` });
        }
        finalSql = `SELECT * FROM ${quoteIdent(rawTable)}`;
      } else {
        finalSql = `SELECT * FROM ${quoteIdent(rawTable)}`;
      }
    }

    const { columns, rows } = await exportTableQuery(conn, finalSql);

    const ext = format === "json" ? ".json" : ".csv";
    const fileName = uniqueMonitorFileName(workspace.rootPath, sanitizeMonitorFileName(rawDatasetName, ext), ext);
    const targetAbs = resolveMonitorPath(workspace.rootPath, fileName);
    mkdirSync(dirname(targetAbs), { recursive: true });
    const content = format === "json" ? rowsToJson(columns, rows) : rowsToCsv(columns, rows);
    writeFileSync(targetAbs, content, "utf8");

    const entry = addWorkspacePath(workspace.id, "clean_data", targetAbs, "file");

    addTraceEvent({
      workspaceId: workspace.id,
      targetKind: "sql_connection",
      targetId: conn.id,
      type: "sql_export",
      target: conn.name,
      status: "success",
      detail: `监测导入 ${rawDatasetName} · ${rows.length} 行 → ${MONITOR_DIR}/${fileName}`,
      payload: { mode: rawTable ? "table" : "sql", rowCount: rows.length, format, fileName, riskLevel: "L1" },
    });

    res.json({
      pathId: String(entry.id),
      name: fileName,
      path: targetAbs,
      columns,
      rowCount: rows.length,
      format,
    });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/monitor/imports", (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  try {
    const monitorBase = resolve(workspace.rootPath, MONITOR_DIR);
    const paths = listWorkspacePaths(workspace.id, "clean_data").filter((p) => {
      if (p.kind !== "file") return false;
      if (!MONITOR_TABULAR_EXT.has(extname(p.path).toLowerCase())) return false;
      const abs = resolve(p.path);
      return abs === monitorBase || abs.startsWith(monitorBase + "/");
    });

    const datasets: BiAggregationDataset[] = [];
    for (const entry of paths) {
      try {
        if (!existsSync(entry.path)) continue;
        const buf = readFileSync(entry.path);
        const { columns, rows } = parseAggregationBuffer(buf, entry.path);
        if (columns.length === 0) continue;
        datasets.push({
          pathId: String(entry.id),
          name: entry.path.split("/").pop() ?? entry.path,
          columns,
          rowCount: rows.length,
        });
      } catch {
        // skip unparseable files
      }
    }
    res.json(datasets);
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ============================================================================
// 子技能提案 skill_proposals（D-SAFEDISTILL1 · Safe Distiller）
// ----------------------------------------------------------------------------
// 流程：① scan 端点扫近 N 天 trace_events + clean_data/report 元数据 → 调
// safe-distiller 生成提案 → upsert 入 skill_proposals 表（同骨架 dedup）。
// ② RulesPane 拉 pending 列表 → 人审 → approve/reject。
// ③ approve 时 HTTP fetch self POST /api/workspaces/:id/skill-registry（E 域端点），
//    不 import E 域函数（守接缝纪律，复用 D-MONITOR1 范式）。
// 跨域消费：E-SUBSKILL1/E-SKILLINJECT1 通过 HTTP GET 拉提案，禁止 import D 域。
// ============================================================================

const SAFE_DISTILLER_SELF_BASE = `http://localhost:${PORT}`;
const DEFAULT_SCAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

dataRouter.post("/api/workspaces/:id/skill-proposals/scan", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const windowDaysRaw = Number(req.body?.windowDays ?? 30);
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw > 0 && windowDaysRaw <= 365 ? windowDaysRaw : 30;
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const occurrenceThresholdRaw = Number(req.body?.occurrenceThreshold ?? 3);
  const occurrenceThreshold = Number.isFinite(occurrenceThresholdRaw) && occurrenceThresholdRaw >= 2 && occurrenceThresholdRaw <= 20
    ? occurrenceThresholdRaw
    : 3;
  try {
    const sqlSkeletons = collectSqlSkeletonsFromTrace(workspaceId, sinceMs);
    const apiTopology = collectApiTopologyFromTrace(workspaceId, sinceMs);
    const reports = listSafeReportPaths(workspaceId);
    const input = { workspaceId, sqlSkeletons, apiTopology, reports };
    // 红线：再次断言输入安全（冗余防御，源头不含 draw_data 时 no-op）
    assertSafeInput(input);
    const proposals = distillProposals(input, { occurrenceThreshold });
    const summary = { created: 0, refreshed: 0, skipped: 0 };
    const written = [] as Array<{ kind: "created" | "refreshed" | "skipped"; id: string; signature: string }>;
    for (const p of proposals) {
      const result = upsertSkillProposal({
        workspaceId,
        signature: p.signature,
        draftTitle: p.draftTitle,
        draftBody: p.draftBody,
        evidence: p.evidence,
      });
      summary[result.kind] += 1;
      written.push({ kind: result.kind, id: result.proposal.id, signature: result.proposal.signature });
    }
    addTraceEvent({
      workspaceId,
      targetKind: "skill_proposal",
      targetId: "scan",
      type: "skill_proposal_scan",
      target: "safe-distiller",
      status: "success",
      detail: `生成 ${proposals.length} 个提案 · 新建 ${summary.created} · 刷新 ${summary.refreshed} · 跳过 ${summary.skipped}`,
      payload: { windowDays, occurrenceThreshold, summary, generated: proposals.length },
    });
    res.json({ generated: proposals.length, summary, items: written });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.get("/api/workspaces/:id/skill-proposals", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const statusQ = typeof req.query.status === "string" ? req.query.status : undefined;
  const status: SkillProposalStatus | undefined =
    statusQ === "pending" || statusQ === "approved" || statusQ === "rejected" ? statusQ : undefined;
  res.json(listSkillProposals(workspaceId, status));
});

dataRouter.post("/api/workspaces/:id/skill-proposals/:proposalId/approve", async (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const proposal = getSkillProposal(req.params.proposalId);
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  if (proposal.workspaceId !== workspaceId) {
    return res.status(403).json({ error: "proposal belongs to another workspace" });
  }
  if (proposal.status !== "pending") {
    return res.status(409).json({ error: `proposal already ${proposal.status}` });
  }
  // 允许 RulesPane 在采纳前编辑 draft：传入 title/body 覆盖最终落库内容
  const finalTitle = typeof req.body?.title === "string" && req.body.title.trim()
    ? req.body.title.trim()
    : proposal.draftTitle;
  const finalBody = typeof req.body?.body === "string" && req.body.body.trim()
    ? req.body.body
    : proposal.draftBody;

  try {
    // HTTP fetch self → E 域 skill-registry 端点（不 import E 函数，守接缝纪律）
    const resp = await fetch(`${SAFE_DISTILLER_SELF_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/skill-registry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: finalTitle,
        content: finalBody,
        source: "derived",
        status: "draft",
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return res.status(502).json({ error: `skill-registry POST failed (${resp.status})`, detail: errText.slice(0, 500) });
    }
    const created = await resp.json() as { entry?: { id?: string } };
    const skillId = String(created.entry?.id ?? "");
    const approved = approveSkillProposal(req.params.proposalId, skillId);
    if (!approved) return res.status(500).json({ error: "failed to mark proposal approved" });
    addTraceEvent({
      workspaceId,
      targetKind: "skill_proposal",
      targetId: approved.id,
      type: "skill_proposal_decision",
      target: approved.draftTitle,
      status: "success",
      detail: `已采纳 · skill=${skillId || "(unknown)"}`,
      payload: { decision: "approved", skillId },
    });
    res.json({ proposal: approved, skill: created });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

dataRouter.post("/api/workspaces/:id/skill-proposals/:proposalId/reject", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const proposal = getSkillProposal(req.params.proposalId);
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  if (proposal.workspaceId !== workspaceId) {
    return res.status(403).json({ error: "proposal belongs to another workspace" });
  }
  if (proposal.status !== "pending") {
    return res.status(409).json({ error: `proposal already ${proposal.status}` });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  const rejected = rejectSkillProposal(req.params.proposalId, reason);
  if (!rejected) return res.status(500).json({ error: "failed to reject proposal" });
  addTraceEvent({
    workspaceId,
    targetKind: "skill_proposal",
    targetId: rejected.id,
    type: "skill_proposal_decision",
    target: rejected.draftTitle,
    status: "success",
    detail: `已拒绝${reason ? ` · ${reason.slice(0, 100)}` : ""}`,
    payload: { decision: "rejected", reason },
  });
  res.json(rejected);
});

// ============================================================================
// the-crowd 路由（D-CROWD1 · X-CROWD0 契约实装）
// ============================================================================
// 红线：不提供"返回原始行列表给前端再送 LLM"的接口。
//       API 输出明细预览时只允许字段摘要、分布摘要、枚举 TopN，禁止用户级行样本。
//       删除/覆盖/重建版本类动作预留二次确认参数（?confirm=true）。
// ============================================================================

// ---- datasets ----

const crowdUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

dataRouter.post("/api/workspaces/:id/crowd/datasets/import", crowdUpload.single("file"), (req, res) => {
  const workspaceId = req.params.id;
  if (!workspaceId) return res.status(400).json({ error: "workspace id required" });
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file is required" });
  const originalName = decodeUploadOriginalName(file.originalname);
  const lower = originalName.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".tsv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    return res.status(400).json({ error: "unsupported file type, expected .csv/.tsv/.xlsx/.xls" });
  }
  try {
    const { columns, rows } = parseAggregationBuffer(file.buffer, originalName);
    if (columns.length === 0) return res.status(400).json({ error: "file has no columns" });
    const fieldProfiles = computeTagDetailFieldProfiles({ columns, rows }) ?? computeFieldProfiles({ columns, rows, normalizeEnums: true });
    const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : originalName.replace(/\.[^.]+$/, "");
    const source: CrowdDatasetCreateInput["source"] = lower.endsWith(".xlsx") || lower.endsWith(".xls") ? "upload_excel" : "upload_csv";
    const dataset = createCrowdDataset(workspaceId, {
      name,
      source,
      rowCount: rows.length,
      fieldCount: columns.length,
      fieldProfiles,
    });
    addTraceEvent({ workspaceId, targetKind: "crowd_dataset", targetId: dataset.id, type: "crowd_dataset_imported", target: dataset.name, status: "success", detail: `导入 crowd dataset · ${dataset.name} · ${rows.length} 行 ${columns.length} 列`, payload: { source, rowCount: rows.length, fieldCount: columns.length } });
    res.status(201).json(dataset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "import failed";
    res.status(400).json({ error: `import failed: ${msg}` });
  }
});

dataRouter.post("/api/workspaces/:id/crowd/datasets/import-sql", async (req, res) => {
  const workspaceId = req.params.id;
  if (!workspaceId) return res.status(400).json({ error: "workspace id required" });
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.connectionId !== "string" || typeof body.sql !== "string" || !body.sql.trim()) {
    return res.status(400).json({ error: "connectionId and sql are required" });
  }
  const conn = getSqlConnection(body.connectionId);
  if (!conn) return res.status(404).json({ error: "SQL connection not found" });
  const validation = validateSql(body.sql);
  if (!validation.safe) return res.status(400).json({ error: validation.risks.join("; ") || "unsafe SQL", validation });
  try {
    const result = await executeQuery(conn, body.sql, 50000);
    if (!result.columns || result.columns.length === 0) return res.status(400).json({ error: "query returned no columns" });
    const rows = result.rows as Array<Record<string, unknown>>;
    const fieldProfiles = computeFieldProfiles({ columns: result.columns, rows, normalizeEnums: true });
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : `sql_import_${Date.now()}`;
    const dataset = createCrowdDataset(workspaceId, {
      name,
      source: "sql_import",
      rowCount: rows.length,
      fieldCount: result.columns.length,
      fieldProfiles,
    });
    addTraceEvent({ workspaceId, targetKind: "crowd_dataset", targetId: dataset.id, type: "crowd_dataset_imported", target: dataset.name, status: "success", detail: `SQL 导入 crowd dataset · ${dataset.name} · ${rows.length} 行`, payload: { source: "sql_import", connectionId: body.connectionId, rowCount: rows.length } });
    res.status(201).json(dataset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "import failed";
    res.status(400).json({ error: `SQL import failed: ${msg}` });
  }
});

dataRouter.get("/api/workspaces/:id/crowd/datasets", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  res.json(listCrowdDatasets(workspaceId));
});

dataRouter.post("/api/workspaces/:id/crowd/datasets", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const input: CrowdDatasetCreateInput = {
    name: body.name,
    source: typeof body.source === "string" ? body.source as CrowdDatasetCreateInput["source"] : undefined,
    rowCount: typeof body.rowCount === "number" ? body.rowCount : undefined,
    fieldCount: typeof body.fieldCount === "number" ? body.fieldCount : undefined,
    fieldProfiles: Array.isArray(body.fieldProfiles) ? body.fieldProfiles as CrowdDatasetCreateInput["fieldProfiles"] : undefined,
  };
  const dataset = createCrowdDataset(workspaceId, input);
  addTraceEvent({ workspaceId, targetKind: "crowd_dataset", targetId: dataset.id, type: "crowd_dataset_created", target: dataset.name, status: "success", detail: `创建 crowd dataset · ${dataset.name}`, payload: { source: dataset.source } });
  res.status(201).json(dataset);
});

dataRouter.get("/api/workspaces/:id/crowd/datasets/:datasetId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const dataset = getCrowdDataset(req.params.datasetId);
  if (!dataset) return res.status(404).json({ error: "dataset not found" });
  if (dataset.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  res.json(dataset);
});

dataRouter.get("/api/workspaces/:id/crowd/datasets/:datasetId/llm-aggregate.csv", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const dataset = getCrowdDataset(req.params.datasetId);
  if (!dataset) return res.status(404).json({ error: "dataset not found" });
  if (dataset.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  const csv = crowdFieldProfilesToLlmAggregateCsv(dataset.fieldProfiles);
  const filename = `${dataset.name.replace(/[\\/:*?"<>|]/g, "_")}-llm-aggregate.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(`\uFEFF${csv}`);
});

dataRouter.patch("/api/workspaces/:id/crowd/datasets/:datasetId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdDataset(req.params.datasetId);
  if (!existing) return res.status(404).json({ error: "dataset not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body) return res.status(400).json({ error: "body required" });
  const patch: CrowdDatasetPatch = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.status === "string") patch.status = body.status as CrowdDatasetPatch["status"];
  if (typeof body.rowCount === "number") patch.rowCount = body.rowCount;
  if (typeof body.fieldCount === "number") patch.fieldCount = body.fieldCount;
  if (Array.isArray(body.fieldProfiles)) patch.fieldProfiles = body.fieldProfiles as CrowdDatasetPatch["fieldProfiles"];
  if (body.errorMessage === null || typeof body.errorMessage === "string") patch.errorMessage = body.errorMessage;
  const updated = updateCrowdDataset(req.params.datasetId, patch);
  if (!updated) return res.status(500).json({ error: "failed to update dataset" });
  res.json(updated);
});

dataRouter.delete("/api/workspaces/:id/crowd/datasets/:datasetId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdDataset(req.params.datasetId);
  if (!existing) return res.status(404).json({ error: "dataset not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  if (req.query.confirm !== "true") return res.status(400).json({ error: "confirm=true required to delete dataset" });
  deleteCrowdDataset(req.params.datasetId);
  addTraceEvent({ workspaceId, targetKind: "crowd_dataset", targetId: req.params.datasetId, type: "crowd_dataset_deleted", target: existing.name, status: "success", detail: `删除 crowd dataset · ${existing.name}` });
  res.json({ deleted: true });
});

// ---- tag dictionary ----

dataRouter.get("/api/workspaces/:id/crowd/datasets/:datasetId/tag-dictionary", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const dataset = getCrowdDataset(req.params.datasetId);
  if (!dataset) return res.status(404).json({ error: "dataset not found" });
  if (dataset.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  res.json(listCrowdTagDictionary(workspaceId, req.params.datasetId));
});

dataRouter.put("/api/workspaces/:id/crowd/datasets/:datasetId/tag-dictionary", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const dataset = getCrowdDataset(req.params.datasetId);
  if (!dataset) return res.status(404).json({ error: "dataset not found" });
  if (dataset.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || !Array.isArray(body.entries)) return res.status(400).json({ error: "entries array required" });
  const entries: CrowdTagDictionaryEntryInput[] = (body.entries as Array<Record<string, unknown>>).map((e) => ({
    field: typeof e.field === "string" ? e.field : "",
    label: typeof e.label === "string" ? e.label : "",
    description: typeof e.description === "string" ? e.description : undefined,
    dimension: typeof e.dimension === "string" ? e.dimension as CrowdTagDictionaryEntryInput["dimension"] : undefined,
    sensitivity: typeof e.sensitivity === "string" ? e.sensitivity as CrowdTagDictionaryEntryInput["sensitivity"] : undefined,
    weight: typeof e.weight === "number" ? e.weight : undefined,
    valueLabels: typeof e.valueLabels === "object" && e.valueLabels !== null && !Array.isArray(e.valueLabels) ? e.valueLabels as Record<string, string> : undefined,
    enabled: typeof e.enabled === "boolean" ? e.enabled : undefined,
  }));
  const invalid = entries.find((e) => !e.field.trim());
  if (invalid) return res.status(400).json({ error: "each entry must have a non-empty field" });
  const saved = saveCrowdTagDictionary(workspaceId, req.params.datasetId, entries);
  addTraceEvent({ workspaceId, targetKind: "crowd_tag_dictionary", targetId: req.params.datasetId, type: "crowd_tag_dict_saved", target: dataset.name, status: "success", detail: `保存标签字典 · ${saved.length} 条`, payload: { count: saved.length } });
  res.json(saved);
});

// ---- segments ----

dataRouter.get("/api/workspaces/:id/crowd/segments", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const datasetId = typeof req.query.datasetId === "string" ? req.query.datasetId : undefined;
  res.json(listCrowdSegments(workspaceId, datasetId));
});

dataRouter.post("/api/workspaces/:id/crowd/segments/preview", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.datasetId !== "string" || typeof body.rule !== "object" || body.rule === null) {
    return res.status(400).json({ error: "datasetId and rule are required" });
  }
  const dataset = getCrowdDataset(body.datasetId);
  if (!dataset) return res.status(404).json({ error: "dataset not found" });
  if (dataset.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  const rule = body.rule as CrowdSegmentRuleGroup;
  const valErrs = validateSegmentRule(rule, dataset.fieldProfiles);
  if (valErrs.length > 0) {
    return res.status(400).json({ error: "invalid rule", validationErrors: valErrs });
  }
  const result = evaluateSegment(rule, dataset.fieldProfiles, dataset.rowCount);
  res.json(result);
});

dataRouter.post("/api/workspaces/:id/crowd/segments", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.datasetId !== "string" || typeof body.name !== "string" || !body.name.trim()) {
    return res.status(400).json({ error: "datasetId and name are required" });
  }
  const dataset = getCrowdDataset(body.datasetId);
  if (!dataset) return res.status(404).json({ error: "dataset not found" });
  if (dataset.workspaceId !== workspaceId) return res.status(403).json({ error: "dataset belongs to another workspace" });
  const rule = (typeof body.rule === "object" && body.rule !== null ? body.rule : { logic: "and", conditions: [] }) as CrowdSegmentCreateInput["rule"];
  const valErrs = validateSegmentRule(rule!, dataset.fieldProfiles);
  if (valErrs.length > 0) {
    return res.status(400).json({ error: "invalid rule", validationErrors: valErrs });
  }
  const evalResult = evaluateSegment(rule!, dataset.fieldProfiles, dataset.rowCount);
  const input: CrowdSegmentCreateInput = {
    datasetId: body.datasetId,
    name: body.name,
    description: typeof body.description === "string" ? body.description : undefined,
    rule,
  };
  const segment = createCrowdSegment(workspaceId, input);
  const updated = updateCrowdSegment(segment.id, {
    sampleCount: evalResult.sampleCount,
    coverageRatio: evalResult.coverageRatio,
    tagDistribution: evalResult.tagDistribution,
  });
  addTraceEvent({ workspaceId, targetKind: "crowd_segment", targetId: segment.id, type: "crowd_segment_created", target: segment.name, status: "success", detail: `创建分群 · ${segment.name} · 样本 ${evalResult.sampleCount}`, payload: { datasetId: segment.datasetId, sampleCount: evalResult.sampleCount, coverageRatio: evalResult.coverageRatio } });
  res.status(201).json(updated ?? segment);
});

dataRouter.get("/api/workspaces/:id/crowd/segments/:segmentId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const segment = getCrowdSegment(req.params.segmentId);
  if (!segment) return res.status(404).json({ error: "segment not found" });
  if (segment.workspaceId !== workspaceId) return res.status(403).json({ error: "segment belongs to another workspace" });
  res.json(segment);
});

dataRouter.patch("/api/workspaces/:id/crowd/segments/:segmentId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdSegment(req.params.segmentId);
  if (!existing) return res.status(404).json({ error: "segment not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "segment belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body) return res.status(400).json({ error: "body required" });
  const patch: CrowdSegmentPatch = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.rule === "object" && body.rule !== null) {
    const rule = body.rule as CrowdSegmentPatch["rule"];
    const dataset = getCrowdDataset(existing.datasetId);
    if (dataset) {
      const valErrs = validateSegmentRule(rule!, dataset.fieldProfiles);
      if (valErrs.length > 0) {
        return res.status(400).json({ error: "invalid rule", validationErrors: valErrs });
      }
      const evalResult = evaluateSegment(rule!, dataset.fieldProfiles, dataset.rowCount);
      patch.rule = rule;
      patch.sampleCount = evalResult.sampleCount;
      patch.coverageRatio = evalResult.coverageRatio;
      patch.tagDistribution = evalResult.tagDistribution;
    } else {
      patch.rule = rule;
    }
  }
  if (typeof body.sampleCount === "number") patch.sampleCount = body.sampleCount;
  if (typeof body.coverageRatio === "number") patch.coverageRatio = body.coverageRatio;
  if (typeof body.tagDistribution === "object" && body.tagDistribution !== null) patch.tagDistribution = body.tagDistribution as CrowdSegmentPatch["tagDistribution"];
  const updated = updateCrowdSegment(req.params.segmentId, patch);
  if (!updated) return res.status(500).json({ error: "failed to update segment" });
  res.json(updated);
});

dataRouter.delete("/api/workspaces/:id/crowd/segments/:segmentId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdSegment(req.params.segmentId);
  if (!existing) return res.status(404).json({ error: "segment not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "segment belongs to another workspace" });
  if (req.query.confirm !== "true") return res.status(400).json({ error: "confirm=true required to delete segment" });
  deleteCrowdSegment(req.params.segmentId);
  addTraceEvent({ workspaceId, targetKind: "crowd_segment", targetId: req.params.segmentId, type: "crowd_segment_deleted", target: existing.name, status: "success", detail: `删除分群 · ${existing.name}` });
  res.json({ deleted: true });
});

dataRouter.post("/api/workspaces/:id/crowd/segments/:segmentId/copy", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdSegment(req.params.segmentId);
  if (!existing) return res.status(404).json({ error: "segment not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "segment belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name : `${existing.name} (copy)`;
  const dataset = getCrowdDataset(existing.datasetId);
  const evalResult = dataset
    ? evaluateSegment(existing.rule, dataset.fieldProfiles, dataset.rowCount)
    : { sampleCount: existing.sampleCount, coverageRatio: existing.coverageRatio, tagDistribution: existing.tagDistribution, errors: [] };
  const segment = createCrowdSegment(workspaceId, {
    datasetId: existing.datasetId,
    name,
    description: existing.description,
    rule: existing.rule,
  });
  const updated = updateCrowdSegment(segment.id, {
    sampleCount: evalResult.sampleCount,
    coverageRatio: evalResult.coverageRatio,
    tagDistribution: evalResult.tagDistribution,
  });
  addTraceEvent({ workspaceId, targetKind: "crowd_segment", targetId: segment.id, type: "crowd_segment_copied", target: name, status: "success", detail: `复制分群 · ${existing.name} → ${name}`, payload: { sourceSegmentId: existing.id } });
  res.status(201).json(updated ?? segment);
});

// ---- aggregate import + auto defaults (E-CROWD11) ----

dataRouter.post("/api/workspaces/:id/crowd/datasets/import-aggregate", crowdUpload.single("file"), (req, res) => {
  const workspaceId = req.params.id;
  if (!workspaceId) return res.status(400).json({ error: "workspace id required" });
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file is required" });
  const originalName = decodeUploadOriginalName(file.originalname);
  const lower = originalName.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".tsv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    return res.status(400).json({ error: "unsupported file type, expected .csv/.tsv/.xlsx/.xls" });
  }
  try {
    const { columns, rows } = parseAggregationBuffer(file.buffer, originalName);
    if (columns.length === 0) return res.status(400).json({ error: "file has no columns" });
    const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : originalName.replace(/\.[^.]+$/, "");
    const result = importAggregateDataset(workspaceId, name, columns, rows);
    addTraceEvent({ workspaceId, targetKind: "crowd_dataset", targetId: result.dataset.id, type: "crowd_aggregate_imported", target: result.dataset.name, status: "success", detail: `聚合导入 · ${result.dataset.name} · ${rows.length} 行 ${result.tagDictionary.length} 字段`, payload: { rowCount: rows.length, fieldCount: result.tagDictionary.length } });
    res.status(201).json({ dataset: result.dataset, tagDictionary: result.tagDictionary, segments: result.segments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "import failed";
    res.status(400).json({ error: `aggregate import failed: ${msg}` });
  }
});

dataRouter.post("/api/workspaces/:id/crowd/datasets/:datasetId/auto-tag-dictionary", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  try {
    const entries = autoTagDictionary(workspaceId, req.params.datasetId);
    addTraceEvent({ workspaceId, targetKind: "crowd_tag_dictionary", targetId: req.params.datasetId, type: "crowd_auto_tag_dict", target: req.params.datasetId, status: "success", detail: `自动生成标签字典 · ${entries.length} 条`, payload: { count: entries.length } });
    res.json(entries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-tag failed";
    const status = msg.includes("not found") ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

dataRouter.post("/api/workspaces/:id/crowd/datasets/:datasetId/default-segment", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  try {
    const segment = createDefaultSegment(workspaceId, req.params.datasetId);
    addTraceEvent({ workspaceId, targetKind: "crowd_segment", targetId: segment.id, type: "crowd_default_segment", target: segment.name, status: "success", detail: `创建默认分群 · ${segment.name}`, payload: { datasetId: req.params.datasetId } });
    res.status(201).json(segment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create default segment failed";
    const status = msg.includes("not found") ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

// ---- profiles ----

dataRouter.get("/api/workspaces/:id/crowd/profiles", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const segmentId = typeof req.query.segmentId === "string" ? req.query.segmentId : undefined;
  res.json(listCrowdProfiles(workspaceId, segmentId));
});

dataRouter.post("/api/workspaces/:id/crowd/profiles", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.segmentId !== "string" || typeof body.name !== "string" || !body.name.trim()) {
    return res.status(400).json({ error: "segmentId and name are required" });
  }
  const segment = getCrowdSegment(body.segmentId);
  if (!segment) return res.status(404).json({ error: "segment not found" });
  if (segment.workspaceId !== workspaceId) return res.status(403).json({ error: "segment belongs to another workspace" });
  const input: CrowdProfileCreateInput = {
    segmentId: body.segmentId,
    name: body.name,
    status: typeof body.status === "string" ? body.status as CrowdProfileCreateInput["status"] : undefined,
  };
  const profile = createCrowdProfile(workspaceId, input);
  addTraceEvent({ workspaceId, targetKind: "crowd_profile", targetId: profile.id, type: "crowd_profile_created", target: profile.name, status: "success", detail: `创建画像 · ${profile.name}`, payload: { segmentId: profile.segmentId } });
  res.status(201).json(profile);
});

dataRouter.get("/api/workspaces/:id/crowd/profiles/:profileId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  res.json(profile);
});

dataRouter.patch("/api/workspaces/:id/crowd/profiles/:profileId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdProfile(req.params.profileId);
  if (!existing) return res.status(404).json({ error: "profile not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body) return res.status(400).json({ error: "body required" });
  const patch: CrowdProfilePatch = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.status === "string") patch.status = body.status as CrowdProfilePatch["status"];
  if (body.currentVersionId === null) {
    patch.currentVersionId = null;
  } else if (typeof body.currentVersionId === "string") {
    const version = getCrowdProfileVersion(body.currentVersionId);
    if (!version) return res.status(404).json({ error: "current version not found" });
    if (version.profileId !== req.params.profileId || version.workspaceId !== workspaceId) {
      return res.status(403).json({ error: "current version belongs to another profile or workspace" });
    }
    patch.currentVersionId = body.currentVersionId;
  }
  if (body.publishedSubAgentTemplateId === null || typeof body.publishedSubAgentTemplateId === "string") patch.publishedSubAgentTemplateId = body.publishedSubAgentTemplateId;
  const updated = updateCrowdProfile(req.params.profileId, patch);
  if (!updated) return res.status(500).json({ error: "failed to update profile" });
  res.json(updated);
});

dataRouter.delete("/api/workspaces/:id/crowd/profiles/:profileId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const existing = getCrowdProfile(req.params.profileId);
  if (!existing) return res.status(404).json({ error: "profile not found" });
  if (existing.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  if (req.query.confirm !== "true") return res.status(400).json({ error: "confirm=true required to delete profile" });
  deleteCrowdProfile(req.params.profileId);
  addTraceEvent({ workspaceId, targetKind: "crowd_profile", targetId: req.params.profileId, type: "crowd_profile_deleted", target: existing.name, status: "success", detail: `删除画像 · ${existing.name}` });
  res.json({ deleted: true });
});

// ---- profile versions ----

dataRouter.get("/api/workspaces/:id/crowd/profiles/:profileId/versions", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  res.json(listCrowdProfileVersions(req.params.profileId));
});

dataRouter.post("/api/workspaces/:id/crowd/profiles/:profileId/versions", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.content !== "object" || body.content === null) {
    return res.status(400).json({ error: "content object required" });
  }
  const input: CrowdProfileVersionCreateInput = {
    content: body.content as CrowdProfileVersionCreateInput["content"],
    source: typeof body.source === "string" ? body.source as CrowdProfileVersionCreateInput["source"] : undefined,
    sourceFeedbackId: typeof body.sourceFeedbackId === "string" ? body.sourceFeedbackId : undefined,
  };
  if (input.sourceFeedbackId) {
    const feedback = getCrowdProfileFeedback(input.sourceFeedbackId);
    if (!feedback) return res.status(404).json({ error: "source feedback not found" });
    if (feedback.profileId !== req.params.profileId || feedback.workspaceId !== workspaceId) {
      return res.status(403).json({ error: "source feedback belongs to another profile or workspace" });
    }
  }
  try {
    const version = createCrowdProfileVersion(workspaceId, req.params.profileId, input);
    res.status(201).json(version);
  } catch (err) {
    res.status(500).json({ error: "failed to create profile version" });
  }
});

dataRouter.get("/api/workspaces/:id/crowd/profiles/:profileId/versions/:versionId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const version = getCrowdProfileVersion(req.params.versionId);
  if (!version) return res.status(404).json({ error: "version not found" });
  if (version.profileId !== req.params.profileId) return res.status(403).json({ error: "version belongs to another profile" });
  res.json(version);
});

// ---- profile generation (E-CROWD5) ----

dataRouter.post("/api/workspaces/:id/crowd/profile-generation/run", async (req, res) => {
  try {
    const { parseCrowdProfileRequest, runCrowdProfileGeneration } = await import("../crowd-profile-runner.ts");
    const input = parseCrowdProfileRequest(req.body);
    const workspaceId = req.params.id;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
    const segment = getCrowdSegment(input.segmentId);
    if (!segment) return res.status(404).json({ error: "segment not found" });
    if (segment.workspaceId !== workspaceId) return res.status(403).json({ error: "segment belongs to another workspace" });
    const result = await runCrowdProfileGeneration(input, { workspaceId });
    addTraceEvent({ workspaceId, targetKind: "crowd_profile", targetId: result.profile.id, type: "crowd_profile_generated", target: result.profile.name, status: "success", detail: `画像生成 · ${result.profile.name}`, payload: { segmentId: input.segmentId, model: input.model } });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("required") || msg.includes("invalid")) {
      res.status(400).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ---- subagent draft ----

dataRouter.post("/api/workspaces/:id/crowd/profiles/:profileId/versions/:versionId/subagent-draft", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const draft = buildCrowdSubAgentDraft(req.params.profileId, req.params.versionId);
  if (!draft) return res.status(404).json({ error: "version not found or mismatch" });
  res.json(draft);
});

// ---- feedback ----

dataRouter.get("/api/workspaces/:id/crowd/profiles/:profileId/feedback", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  res.json(listCrowdProfileFeedback(req.params.profileId));
});

dataRouter.post("/api/workspaces/:id/crowd/profiles/:profileId/feedback", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.profileVersionId !== "string") {
    return res.status(400).json({ error: "profileVersionId is required" });
  }
  const input: CrowdProfileFeedbackCreateInput = {
    profileVersionId: body.profileVersionId,
    sourceRunId: typeof body.sourceRunId === "string" ? body.sourceRunId : undefined,
    sourceLifeFormId: typeof body.sourceLifeFormId === "string" ? body.sourceLifeFormId : undefined,
    objections: Array.isArray(body.objections) ? body.objections.filter((x): x is string => typeof x === "string") : undefined,
    acceptanceConditions: Array.isArray(body.acceptanceConditions) ? body.acceptanceConditions.filter((x): x is string => typeof x === "string") : undefined,
    suggestions: Array.isArray(body.suggestions) ? body.suggestions.filter((x): x is string => typeof x === "string") : undefined,
  };
  let feedback;
  try {
    feedback = createCrowdProfileFeedback(workspaceId, req.params.profileId, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("profile version not found")) return res.status(404).json({ error: "profile version not found" });
    if (message.includes("another profile or workspace")) return res.status(403).json({ error: "profile version belongs to another profile or workspace" });
    throw err;
  }
  addTraceEvent({ workspaceId, targetKind: "crowd_feedback", targetId: feedback.id, type: "crowd_feedback_created", target: profile.name, status: "success", detail: `模拟反馈回写 · ${profile.name}`, payload: { profileVersionId: input.profileVersionId } });
  res.status(201).json(feedback);
});

dataRouter.patch("/api/workspaces/:id/crowd/profiles/:profileId/feedback/:feedbackId", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.status !== "string") return res.status(400).json({ error: "status is required (adopted | rejected)" });
  if (body.status !== "adopted" && body.status !== "rejected") return res.status(400).json({ error: "status must be 'adopted' or 'rejected'" });
  const existing = getCrowdProfileFeedback(req.params.feedbackId);
  if (!existing) return res.status(404).json({ error: "feedback not found" });
  if (existing.profileId !== req.params.profileId || existing.workspaceId !== workspaceId) {
    return res.status(403).json({ error: "feedback belongs to another profile or workspace" });
  }
  const updated = updateCrowdProfileFeedbackStatus(req.params.feedbackId, req.params.profileId, body.status);
  if (!updated) return res.status(404).json({ error: "feedback not found or already reviewed" });
  addTraceEvent({ workspaceId, targetKind: "crowd_feedback", targetId: updated.id, type: "crowd_feedback_reviewed", target: profile.name, status: "success", detail: `反馈审核 · ${updated.status}`, payload: { status: updated.status } });
  res.json(updated);
});

// ---- profile lifecycle ----

dataRouter.post("/api/workspaces/:id/crowd/profiles/:profileId/rollback", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  if (req.query.confirm !== "true") return res.status(400).json({ error: "confirm=true required to rollback" });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.versionId !== "string") return res.status(400).json({ error: "versionId is required" });
  const updated = rollbackProfileToVersion(req.params.profileId, body.versionId);
  if (!updated) return res.status(404).json({ error: "version not found or mismatch" });
  addTraceEvent({ workspaceId, targetKind: "crowd_profile", targetId: updated.id, type: "crowd_profile_rollback", target: updated.name, status: "success", detail: `回滚画像版本 · ${updated.name} → ${body.versionId}`, payload: { versionId: body.versionId } });
  res.json(updated);
});

dataRouter.post("/api/workspaces/:id/crowd/profiles/:profileId/feedback/:feedbackId/adopt", (req, res) => {
  const workspaceId = req.params.id;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: "workspace not found" });
  const profile = getCrowdProfile(req.params.profileId);
  if (!profile) return res.status(404).json({ error: "profile not found" });
  if (profile.workspaceId !== workspaceId) return res.status(403).json({ error: "profile belongs to another workspace" });
  const feedback = getCrowdProfileFeedback(req.params.feedbackId);
  if (!feedback) return res.status(404).json({ error: "feedback not found" });
  if (feedback.profileId !== req.params.profileId || feedback.workspaceId !== workspaceId) {
    return res.status(403).json({ error: "feedback belongs to another profile or workspace" });
  }
  if (feedback.status !== "pending") return res.status(409).json({ error: `feedback already ${feedback.status}` });
  try {
    const result = adoptFeedbackToVersion(req.params.feedbackId, workspaceId, req.params.profileId);
    if (!result) return res.status(500).json({ error: "failed to adopt feedback" });
    addTraceEvent({ workspaceId, targetKind: "crowd_profile", targetId: result.profile.id, type: "crowd_feedback_adopted", target: result.profile.name, status: "success", detail: `采纳反馈生成新版本 · ${result.profile.name} v${result.version.version}`, payload: { feedbackId: req.params.feedbackId, versionId: result.version.id } });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: "failed to adopt feedback" });
  }
});

// ---- templates / demo downloads (D-CROWD10) ----

const CROWD_TEMPLATE_WHITELIST = new Set([
  "template-detail.csv",
  "template-aggregate.csv",
  "demo-detail.csv",
  "demo-aggregate.csv",
]);

const CROWD_STATIC_DIR = join(import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)), "..", "static", "crowd");

dataRouter.get("/api/crowd/templates/:name", (req, res) => {
  const name = req.params.name;
  if (!CROWD_TEMPLATE_WHITELIST.has(name)) {
    return res.status(404).json({ error: "template not found" });
  }
  const filePath = join(CROWD_STATIC_DIR, name);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "template not found" });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.sendFile(filePath);
});
