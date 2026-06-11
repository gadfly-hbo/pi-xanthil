import { Router } from "express";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { listWorkspacePaths, getWorkspacePath, getWorkspace } from "../db.ts";
import { parseAggregationBuffer } from "../bi-dataset-parser.ts";
import { runPiPrompt } from "../pi-adapter.ts";
import type { BiAggregationDataset, BiAggregationData, IndustryIntel, CompetitorIntel, IndustryForce, CompetitorProfile } from "../types.ts";

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
