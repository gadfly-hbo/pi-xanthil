/**
 * E-MONITOR2: LLM 指标体系草案生成
 *
 * 根据 clean_data 元数据（字段列表/统计画像/行数）+ 已启用 ontology（对象/指标/逻辑规则/动作）
 * 调用 LLM 生成 MonitorMetricSystemDraft。
 *
 * 安全约定（等同 AGENTS.md §一）：
 *   - LLM prompt 只送：字段名、FieldKind、行数、非空率、distinct count、min/max、top values 摘要
 *   - 不送原始行、不送 draw_data 内容、不送整表行级明细
 *   - 无 ontology 或 clean_data 时降级指出 missingData
 */

import { runPiPrompt } from "./pi-adapter.ts";
import { biAggregationToMetricSnapshots, renderMetricSnapshotsBlock } from "./monitor-metric-snapshot.ts";
import type { MonitorMetricDraft, MonitorMetricSystemDraft, MonitorMetricBinding, MonitorMetricDependency, MonitorRuleDraft, ObjectType, MetricDefinition, LinkType, LogicRule, BiAggregationDataset, HealthFinding } from "./types.ts";

export interface DraftInput {
  aggregations: BiAggregationDataset[];
  objects: ObjectType[];
  metrics: MetricDefinition[];
  links: LinkType[];
  logicRules: LogicRule[];
  /** D-METRIC3：可选监测 finding 列表（衍生字段），用于在 prompt 头部注入 MetricSnapshot 数字锁块。
   *  传入即启用 snapshot 注入，否则降级到原 columns/rowCount 模式（向后兼容）。
   *  调用方负责保证 findings 不携带原始行级数据（finding 本身即为衍生产物）。 */
  findings?: HealthFinding[];
}

export interface DraftResult {
  draft: MonitorMetricSystemDraft | null;
  error?: string;
}

export function buildDraftPrompt(input: DraftInput): string {
  const { aggregations, objects, metrics, links: _links, logicRules, findings } = input;

  // D-METRIC3：findings 非空 → 头部注入 MetricSnapshot[] 数字锁块；空/未传 → 走 fallback。
  // 注意：这里的 findings 是监测引擎纯函数产物（衍生字段），不含原始行级数据。
  const snapshotBlock = findings && findings.length > 0
    ? renderMetricSnapshotsBlock(biAggregationToMetricSnapshots(findings))
    : "";

  let aggText = "";
  if (aggregations.length > 0) {
    aggText = aggregations.map((a) =>
      `  - "${a.name}" (${a.rowCount}行, 字段: ${a.columns.join(", ")})`
    ).join("\n");
  } else {
    aggText = "  (无可用聚合数据集)";
  }

  let objText = "  (无)";
  if (objects.length > 0) {
    objText = objects.map((o) => `  - ${o.nameCn}${o.boundPathId ? ` [绑定: ${o.boundPathId}]` : ""}`).join("\n");
  }

  let metricText = "  (无)";
  if (metrics.length > 0) {
    metricText = metrics.map((m) => `  - ${m.name} (${m.category}): ${m.description} [口径: ${m.formula}]`).join("\n");
  }

  let logicText = "  (无)";
  if (logicRules.length > 0) {
    logicText = logicRules.map((r) => `  - ${r.nameCn}${r.formula ? `: ${r.formula}` : ""}`).join("\n");
  }

  return `你是一位经营分析专家。请基于以下工作区的数据资产，设计一套观测指标体系。
${snapshotBlock ? `\n${snapshotBlock}\n` : ""}
## 可用的聚合数据集
${aggText}

## 已注册的本体对象（可能绑定了数据集）
${objText}

## 已注册的指标
${metricText}

## 逻辑规则
${logicText}

## 输出要求
请输出严格 JSON（不要 Markdown fence、不要注释），格式如下：
{
  "metrics": [
    {
      "name": "指标名（英文，如 revenue）",
      "description": "指标说明",
      "formula": "计算公式或口径说明",
      "unit": "单位（如 万元/%/人次）",
      "objectIds": [/* 关联的本体对象 id（空数组可） */],
      "bindings": [
        {
          "metricId": "指标名",
          "datasetPathId": "数据集路径id（选择最匹配的聚合数据集名）",
          "valueColumn": "数值列名",
          "timeColumn": "时间列名（如有）",
          "targetMetricId": "如该指标有目标值对应，写目标指标名",
          "benchmarkMetricId": "如该指标有行业基准对应，写基准指标名",
          "competitorMetricId": "如该指标有竞品对比，写竞品指标名"
        }
      ],
      "confidence": 0.0~1.0
    }
  ],
  "dependencies": [
    {
      "metricId": "指标A",
      "relatedMetricId": "指标B",
      "relation": "driver|guardrail|derived|benchmark|competing",
      "rationale": "为什么关联"
    }
  ],
  "monitorRules": [
    {
      "title": "规则名",
      "comparisonKinds": ["target", "history", "industry", "competitor"],
      "metricIds": ["涉及指标列表"],
      "threshold": 可选阈值,
      "rationale": "为什么监视此规则"
    }
  ],
  "assumptions": ["分析前提假设列表"],
  "missingData": ["当前缺失的关键数据"]
}

## 原则
- metrics 3-10 个，覆盖收入/成本/用户/效率等核心维度
- 优先绑定到已有的聚合数据集和本体对象
- 缺失数据标记在 missingData 中，不编造
`;
}

function parseDraftJson(text: string): MonitorMetricSystemDraft | null {
  try {
    const stripped = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped);
    const raw = fenced?.[1] ?? stripped;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return null;

    const metrics: MonitorMetricDraft[] = (Array.isArray(parsed.metrics) ? parsed.metrics : []).map((m: unknown) => {
      const obj = m as Record<string, unknown>;
      return {
        name: String(obj.name ?? ""),
        description: String(obj.description ?? ""),
        formula: typeof obj.formula === "string" ? obj.formula : undefined,
        unit: typeof obj.unit === "string" ? obj.unit : undefined,
        objectIds: Array.isArray(obj.objectIds) ? obj.objectIds.filter((x): x is string => typeof x === "string") : [],
        bindings: (Array.isArray(obj.bindings) ? obj.bindings : []).map((b: unknown) => {
          const bo = b as Record<string, unknown>;
          const binding: MonitorMetricBinding = {
            metricId: String(bo.metricId ?? ""),
            datasetPathId: String(bo.datasetPathId ?? ""),
            valueColumn: String(bo.valueColumn ?? ""),
            timeColumn: typeof bo.timeColumn === "string" ? bo.timeColumn : undefined,
            targetMetricId: typeof bo.targetMetricId === "string" ? bo.targetMetricId : undefined,
            benchmarkMetricId: typeof bo.benchmarkMetricId === "string" ? bo.benchmarkMetricId : undefined,
            competitorMetricId: typeof bo.competitorMetricId === "string" ? bo.competitorMetricId : undefined,
          };
          return binding;
        }),
        confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
      };
    });

    const dependencies: MonitorMetricDependency[] = (Array.isArray(parsed.dependencies) ? parsed.dependencies : []).map((d: unknown) => {
      const obj = d as Record<string, unknown>;
      return {
        metricId: String(obj.metricId ?? ""),
        relatedMetricId: String(obj.relatedMetricId ?? ""),
        relation: (["driver", "guardrail", "derived", "benchmark", "competing"].includes(String(obj.relation)) ? String(obj.relation) : "driver") as MonitorMetricDependency["relation"],
        rationale: String(obj.rationale ?? ""),
      };
    });

    const monitorRules: MonitorRuleDraft[] = (Array.isArray(parsed.monitorRules) ? parsed.monitorRules : []).map((r: unknown) => {
      const obj = r as Record<string, unknown>;
      return {
        title: String(obj.title ?? ""),
        comparisonKinds: Array.isArray(obj.comparisonKinds) ? obj.comparisonKinds.filter((k: unknown): k is "target" | "history" | "industry" | "competitor" => ["target", "history", "industry", "competitor"].includes(String(k))) : [],
        metricIds: Array.isArray(obj.metricIds) ? obj.metricIds.filter((x: unknown): x is string => typeof x === "string") : [],
        threshold: typeof obj.threshold === "number" ? obj.threshold : undefined,
        rationale: String(obj.rationale ?? ""),
      };
    });

    const assumptions: string[] = Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((x: unknown): x is string => typeof x === "string") : [];
    const missingData: string[] = Array.isArray(parsed.missingData) ? parsed.missingData.filter((x: unknown): x is string => typeof x === "string") : [];

    return { metrics, dependencies, monitorRules, assumptions, missingData };
  } catch {
    return null;
  }
}

export async function draftMetricSystem(
  workspaceRoot: string,
  input: DraftInput,
  model?: string,
): Promise<DraftResult> {
  if (input.aggregations.length === 0) {
    return {
      draft: {
        metrics: [],
        dependencies: [],
        monitorRules: [],
        assumptions: [],
        missingData: ["无可用聚合数据集，请先登记 clean_data 聚合数据"],
      },
    };
  }

  const prompt = buildDraftPrompt(input);
  try {
    const text = await runPiPrompt({
      workspaceRoot,
      text: prompt,
      model: model ?? "doubao-pro-32k",
      systemPrompt: "你输出纯 JSON，不要 Markdown fence、不要额外文字。",
      timeoutMs: 120_000,
    });
    const draft = parseDraftJson(text);
    if (!draft) return { draft: null, error: "LLM 输出无法解析为 JSON" };
    return { draft };
  } catch (err) {
    return { draft: null, error: String(err) };
  }
}