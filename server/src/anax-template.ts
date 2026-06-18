// AnaX workflow template builders.
// Produces the WorkflowDef JSON for the 9-node full analysis and the 3-node
// quick analysis modes. These are materialised into a flow's workflow.json
// when the user clicks "AnaX 商业分析" or "AnaX 快速分析" instantiation.

import type { WorkflowDef } from "./multi-agent-runner.ts";

// ---- Shared prompt fragments ----

const HYPOTHESES_BLOCK = `

**重要**: 在分析末尾，输出一个结构化假设计划块，用于下游并行验证。格式如下：

\`\`\`anax-hypotheses-plan
[
  {
    "id": "H1",
    "hypothesis": "假设描述",
    "priority": "high|medium|low",
    "dataNeeded": "验证所需数据",
    "method": "验证方法",
    "crossValidate": true/false
  }
]
\`\`\`

每个假设必须包含 id、hypothesis、priority、dataNeeded、method 字段。如果假设需要交叉验证，将 crossValidate 设为 true。`;

const RECOMMENDATIONS_BLOCK = `

**重要**: 在建议末尾，输出一个结构化建议块，用于自动生成变更提案草稿。格式如下：

\`\`\`anax-recommendations
[
  {
    "title": "建议标题",
    "description": "建议详情",
    "expectedImpact": "预期影响"
  }
]
\`\`\`

约束：即使你已经把完整归档报告写入文件，也必须在本轮回复末尾原样输出上述 \`\`\`anax-hypotheses\`\`\` 块；系统只会读取本轮回复中的结构块来写入假设库。`;

const ARCHIVE_HYPOTHESES_BLOCK = `

**重要**: 在归档总结末尾，输出一个结构化假设验证结果块，用于写入假设库飞轮。格式如下：

\`\`\`anax-hypotheses
[
  {
    "scene": "业务场景",
    "hypothesis": "假设内容",
    "verdict": "confirmed|rejected|partial",
    "evidence": "支撑证据摘要",
    "impact": "业务影响"
  }
]
\`\`\``;

const VERDICT_BLOCK_INSTRUCTIONS = `

你必须在回复末尾输出一个结构化裁决块，格式如下：

\`\`\`anax-verdict
{
  "stage": "阶段名称",
  "redLines": [{"id": "RL编号", "desc": "违规描述"}],
  "stages": [
    {
      "stage": "子阶段名称",
      "confidence": "low|medium|high",
      "evidence": 证据数量,
      "dataQuality": 数据质量评分(仅数据阶段)
    }
  ],
  "summary": "裁决总结",
  "modelVerdict": "pass|blocked"
}
\`\`\`

注意：最终 pass/blocked 由系统硬阈值决定（置信度≥medium、证据≥2、数据质量≥7），你的 modelVerdict 仅作参考。

裁决字段约束：
- redLines 只填写真正需要阻断的违规项；通过项、未触发项、PASS 项不要放入 redLines。
- stages[].confidence 表示你对该阶段"验证结论"的置信度，不表示假设是否成立。假设被证据推翻但证据充分时，confidence 仍应为 medium/high。
- 分项风险（如时效性、口径清晰度）可在 summary 中说明；只有整体数据质量或关键阶段低于阈值时才设为 blocked。`;

// ---- Full 9-node workflow (AnaX v3.0) ----

export function buildAnaxWorkflow(): WorkflowDef {
  return {
    version: 1,
    layout: "dag",
    nodes: [
      {
        id: "business",
        label: "B·商务问题定义",
        role: "商务分析师",
        spec: "01-brief.md",
        prompt: [
          "你是一位资深商务分析师。请根据用户提供的任务描述和数据背景，完成以下工作：",
          "",
          "1. 明确核心商务问题（Business Question）",
          "2. 拆解为 2-4 个可验证的子问题",
          "3. 初步识别关键指标（KPI）和分析维度",
          "4. 列出需要的数据范围和可能的数据局限",
          "",
          "任务描述：{{input.task}}",
          "可用数据文件：{{input.data_files}}",
          "",
          "请输出结构化的商务问题定义报告（01-brief.md）。",
        ].join("\n"),
      },
      {
        id: "plan",
        label: "P·分析计划",
        role: "分析规划师",
        spec: "02-spec.md",
        inputs: ["business"],
        prompt: [
          "你是一位分析规划师。基于上游商务问题定义，制定详细的分析计划：",
          "",
          "商务问题定义：",
          "{{business}}",
          "",
          "请完成：",
          "1. 针对每个子问题，提出 1-3 个可验证假设",
          "2. 为每个假设指定验证方法、所需数据、优先级",
          "3. 标注需要交叉验证的假设（crossValidate: true）",
          "4. 规划分析路径和依赖关系",
          "若任务描述或商务问题定义中已经包含初始假设，请优先采纳这些假设并补全至不超过 12 条；不要用全新脑补假设覆盖用户已给出的假设。",
          "",
          "输出分析计划报告（02-spec.md）。",
          HYPOTHESES_BLOCK,
        ].join("\n"),
      },
      {
        id: "data",
        label: "D·数据质量评估",
        role: "数据质量评估官",
        spec: "03-data-quality.md",
        inputs: ["plan"],
        prompt: [
          "你是数据质量评估官。请评估以下聚合数据文件的质量和分析就绪度：",
          "",
          "分析计划：",
          "{{plan}}",
          "",
          "可用数据文件：{{input.data_files}}",
          "",
          "请完成：",
          "1. 数据完整性检查（缺失值、异常值）",
          "2. 数据一致性检查（跨文件、跨时段）",
          "3. 数据时效性和覆盖度评估",
          "4. 给出综合评分（1-10 分）：综合评分：X/10",
          "5. 列出关键风险项和建议",
          "",
          "输出数据质量报告（03-data-quality.md）。",
          "",
          "在评分部分使用格式：综合评分：X/10（系统会解析此数值）。",
        ].join("\n"),
      },
      {
        id: "data_gate",
        label: "G·数据门禁",
        role: "质量门禁审核官",
        kind: "gate",
        inputs: ["data"],
        prompt: [
          "你是 AnaX 数据质量门禁审核官。请审查上游数据质量报告，判断数据是否达到分析就绪标准。",
          "",
          "数据质量报告：",
          "{{data}}",
          "",
          "审核标准：",
          "- 综合评分 ≥ 7 为通过",
          "- 综合评分 < 5 触发 RL03 红线（硬阻断）",
          "- 置信度至少 medium",
          "- 至少 2 条独立证据支撑",
          "",
          "请评估后给出裁决。",
          VERDICT_BLOCK_INSTRUCTIONS,
        ].join("\n"),
      },
      {
        id: "insight",
        label: "I·洞察验证",
        role: "数据分析师",
        spec: "04-insights.md",
        inputs: ["plan", "data"],
        fanOut: {
          source: "plan",
          marker: "anax-hypotheses-plan",
          concurrency: 3,
          maxItems: 12,
          itemVar: "item",
        },
        prompt: [
          "你是一位数据分析师。请针对以下假设进行深入验证分析：",
          "",
          "待验证假设：",
          "- ID: {{item.id}}",
          "- 假设: {{item.hypothesis}}",
          "- 优先级: {{item.priority}}",
          "- 所需数据: {{item.dataNeeded}}",
          "- 验证方法: {{item.method}}",
          "",
          "数据质量报告：",
          "{{data}}",
          "",
          "可用数据文件：{{input.data_files}}",
          "",
          "请完成：",
          "1. 使用指定方法分析数据，验证或推翻假设",
          "2. 提供关键数据证据（含具体数值）",
          "3. 给出置信度评估（low/medium/high）和证据数量",
          "4. 如果标注了 crossValidate，需提供交叉验证结果",
          "",
          "输出洞察分析报告。",
        ].join("\n"),
      },
      {
        id: "recommend",
        label: "R·决策建议",
        role: "商务顾问",
        spec: "05-recommendations.md",
        inputs: ["insight", "plan"],
        prompt: [
          "你是一位资深商务顾问。基于洞察分析结果，提出可落地的决策建议：",
          "",
          "分析计划：",
          "{{plan}}",
          "",
          "洞察分析：",
          "{{insight}}",
          "",
          "请完成：",
          "1. 汇总关键发现和结论",
          "2. 针对每个发现提出具体的行动建议",
          "3. 每条建议必须包含以下七要素：",
          "   - 标题",
          "   - 背景与理由",
          "   - 具体措施",
          "   - 负责人（建议部门/角色）",
          "   - 时间节点",
          "   - 成功标准（量化指标）",
          "   - 验证方案（如何确认建议效果）",
          "4. 优先级排序和资源投入建议",
          "",
          "注意：所有建议详情（含负责人、成功标准、验证方案）必须直接写在本输出中，",
          "不要写入外部文件。系统会检查输出中是否包含这些关键要素。",
          "",
          "输出决策建议报告（05-recommendations.md）。",
          RECOMMENDATIONS_BLOCK,
        ].join("\n"),
      },
      {
        id: "review_gate",
        label: "G·综合审核门禁",
        role: "质量门禁审核官",
        kind: "gate",
        inputs: ["recommend", "insight", "plan", "data"],
        prompt: [
          "你是 AnaX 综合审核门禁官。请全面审查从数据到建议的完整分析链路质量。",
          "",
          "数据质量报告：",
          "{{data}}",
          "",
          "分析计划：",
          "{{plan}}",
          "",
          "洞察分析：",
          "{{insight}}",
          "",
          "决策建议：",
          "{{recommend}}",
          "",
          "审核维度：",
          "- 每个阶段的置信度是否 ≥ medium",
          "- 每个阶段的证据数量是否 ≥ 2",
          "- 假设标注了 crossValidate 的是否完成了交叉验证（RL06）",
          "- 建议是否包含完整七要素：负责人、成功标准、验证方案等（RL07）",
          "- 是否存在逻辑断裂或结论无数据支撑",
          "",
          "请逐阶段评估后给出综合裁决。",
          VERDICT_BLOCK_INSTRUCTIONS,
        ].join("\n"),
      },
      {
        id: "verify",
        label: "V·验证复核",
        role: "交叉验证员",
        spec: "08-verify.md",
        inputs: ["review_gate", "insight", "recommend"],
        prompt: [
          "你是交叉验证复核员。请对通过门禁的分析成果进行最终验证：",
          "",
          "洞察分析：",
          "{{insight}}",
          "",
          "决策建议：",
          "{{recommend}}",
          "",
          "请完成：",
          "1. 核实关键数据引用的准确性",
          "2. 检查结论与证据的逻辑一致性",
          "3. 识别潜在偏差或遗漏",
          "4. 给出最终可信度评估",
          "",
          "输出验证复核报告（08-verify.md）。",
        ].join("\n"),
      },
      {
        id: "archive",
        label: "A·归档总结",
        role: "知识归档员",
        spec: "09-archive-summary.md",
        inputs: ["verify", "recommend", "insight", "plan", "business"],
        prompt: [
          "你是知识归档员。请将本次分析的完整成果归档总结：",
          "",
          "商务问题：",
          "{{business}}",
          "",
          "分析计划：",
          "{{plan}}",
          "",
          "洞察分析：",
          "{{insight}}",
          "",
          "决策建议：",
          "{{recommend}}",
          "",
          "验证复核：",
          "{{verify}}",
          "",
          "请完成：",
          "1. 整理最终结论和关键发现",
          "2. 归纳已验证的假设及其结果",
          "3. 记录方法论和可复用模式",
          "4. 标注后续跟踪事项",
          "",
          "输出归档总结报告（09-archive-summary.md）。",
          ARCHIVE_HYPOTHESES_BLOCK,
        ].join("\n"),
      },
    ],
    edges: [
      { id: "e-business-plan", source: "business", target: "plan" },
      { id: "e-plan-data", source: "plan", target: "data" },
      { id: "e-data-data_gate", source: "data", target: "data_gate" },
      { id: "e-data_gate-insight", source: "data_gate", target: "insight" },
      { id: "e-plan-insight", source: "plan", target: "insight" },
      { id: "e-data-insight", source: "data", target: "insight" },
      { id: "e-insight-recommend", source: "insight", target: "recommend" },
      { id: "e-plan-recommend", source: "plan", target: "recommend" },
      { id: "e-recommend-review_gate", source: "recommend", target: "review_gate" },
      { id: "e-insight-review_gate", source: "insight", target: "review_gate" },
      { id: "e-plan-review_gate", source: "plan", target: "review_gate" },
      { id: "e-data-review_gate", source: "data", target: "review_gate" },
      { id: "e-review_gate-verify", source: "review_gate", target: "verify" },
      { id: "e-insight-verify", source: "insight", target: "verify" },
      { id: "e-recommend-verify", source: "recommend", target: "verify" },
      { id: "e-verify-archive", source: "verify", target: "archive" },
      { id: "e-recommend-archive", source: "recommend", target: "archive" },
      { id: "e-insight-archive", source: "insight", target: "archive" },
      { id: "e-plan-archive", source: "plan", target: "archive" },
      { id: "e-business-archive", source: "business", target: "archive" },
    ],
  };
}

// ---- Quick 3-node workflow (AnaX v3.0 Quick) ----
// brief → analyze → archive — no gates, medium confidence disclaimer.

export function buildAnaxQuickWorkflow(): WorkflowDef {
  return {
    version: 1,
    layout: "sequential",
    nodes: [
      {
        id: "brief",
        label: "B·商务问题",
        role: "商务分析师",
        spec: "01-brief.md",
        prompt: [
          "你是一位资深商务分析师。请根据用户提供的任务描述和数据背景，快速定义核心商务问题：",
          "",
          "任务描述：{{input.task}}",
          "可用数据文件：{{input.data_files}}",
          "",
          "请完成：",
          "1. 明确核心商务问题",
          "2. 列出 2-3 个关键分析方向",
          "3. 识别主要指标",
          "",
          "输出简明的商务问题定义。",
        ].join("\n"),
      },
      {
        id: "analyze",
        label: "ADIR·快速分析",
        role: "数据分析师",
        spec: "02-analysis.md",
        inputs: ["brief"],
        prompt: [
          "你是一位数据分析师。请基于商务问题定义，对数据进行快速分析：",
          "",
          "商务问题：",
          "{{brief}}",
          "",
          "可用数据文件：{{input.data_files}}",
          "",
          "请完成：",
          "1. 针对关键分析方向进行数据探查和分析",
          "2. 提出假设并用数据初步验证",
          "3. 总结关键发现和初步建议",
          "",
          "⚠️ 注意：快速分析模式未经完整的数据质量门禁和交叉验证，",
          "所有结论的置信度为 medium，标注 [无数据支撑，仅为假设推断] 的结论请谨慎使用。",
          "",
          "输出快速分析报告。",
          HYPOTHESES_BLOCK,
        ].join("\n"),
      },
      {
        id: "archive",
        label: "Arch·归档",
        role: "知识归档员",
        spec: "09-archive-summary.md",
        inputs: ["analyze", "brief"],
        prompt: [
          "你是知识归档员。请将本次快速分析的成果归档：",
          "",
          "商务问题：",
          "{{brief}}",
          "",
          "分析报告：",
          "{{analyze}}",
          "",
          "请完成：",
          "1. 整理关键发现和结论",
          "2. 归纳已识别的假设及其初步验证结果",
          "3. 标注置信度为 medium 的免责说明",
          "4. 列出后续深入分析的建议方向",
          "",
          "输出归档总结报告（09-archive-summary.md）。",
          ARCHIVE_HYPOTHESES_BLOCK,
        ].join("\n"),
      },
    ],
    edges: [
      { id: "e-brief-analyze", source: "brief", target: "analyze" },
      { id: "e-analyze-archive", source: "analyze", target: "archive" },
      { id: "e-brief-archive", source: "brief", target: "archive" },
    ],
  };
}
