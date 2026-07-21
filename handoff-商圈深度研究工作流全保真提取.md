# 商圈深度研究工作流全保真提取

> 生成时间：2026-07-21  
> 源 flow id：`7b8f0196-3512-4bac-a7c8-6660bc410762`  
> 源目录：`/Users/huangbo/.pi-xanthil/workspaces/76bc1a51-5278-4144-9c3a-b643ca786643/flows/7b8f0196-3512-4bac-a7c8-6660bc410762`  
> flow 名称：`商圈深度研究报告工作流`  
> 提取原则：前半部分做索引和结构化说明；后半部分保留源文件原文与 sha256，作为全保真核对依据。

## 目的

本文档把工作流模块中的「商圈深度研究报告工作流」单独提取出来，覆盖 pi-xanthil 运行时使用的 `workflow.json`，以及该 flow 自带的独立 `agent-tool` 原型中涉及的 agents、workflow、prompt、LLM、websearch 与本地代理配置。

## 使用方式

- 需要理解 pi-xanthil 当前执行逻辑时，优先看「运行契约」「节点与 Prompt」「边关系」。
- 需要复刻或迁移工作流时，以「源文件全量附录」为准，不要只依赖摘要。
- 需要核对是否被改写时，用附录中的 sha256 与源文件重新计算值对比。
- 本文档不包含运行产物报告正文；只提取工作流定义、agent 定义、prompt、工具与执行配置。

## 源文件清单

| 源文件 | 行数 | sha256 | 用途 |
|---|---:|---|---|
| workflow.json | 299 | 9e2d21eb5a41eea0ef9defcca076bcb6cc805a2e3d7015cdbe048be7b987b464 | pi-xanthil 执行契约，含 metadata、节点、边、prompt、模型、失败策略。 |
| agent-tool/js/agents.js | 188 | 4685b15d77e521e65946030f3c297f7b723060770fdd451e04e18fd66d1d5f28 | 独立 agent-tool 原型的 AGENTS 与 TEMPLATES，含四类 agent systemPrompt。 |
| agent-tool/js/flow.js | 568 | 511188ba0f6019d7e940bb34a5f945130631d14eac016d295be9829d30a07abe | 独立 agent-tool 原型的 7 阶段 live/demo 执行流程和阶段 user prompt。 |
| agent-tool/js/state.js | 115 | e2bc38480cefdbada9942d4a38937010502662022791087bde47af58d83292b6 | 独立 agent-tool 原型的默认模型、webSearch、agent 模型覆盖配置。 |
| agent-tool/js/llm.js | 113 | 74e1679198f51e1e5cc449bcc2a1c5214bf1564d455d7c0a186b74015ee08fe0 | 独立 agent-tool 原型的 LLM 调用封装，systemPrompt 注入方式。 |
| agent-tool/js/websearch.js | 178 | af39220523a355056b91b65ea1322b81d7bfbf35d3c396ed28318bf3c06f3c50 | 独立 agent-tool 原型的 MiniMax websearch 调用、正文抓取、证据格式化。 |
| agent-tool/js/sample-data.js | 125 | 070e4d995a05652d4b3b550bfa953bd92b55eac4a854574acddd76adfb4b11cc | 独立 agent-tool 原型的 demo 回放样例阶段、消息、证据。 |
| agent-tool/server.py | 532 | aa24aff4fed176d834ee02395a6d9ee950083ada7cf412c67e24e688c7aa7563 | 独立 agent-tool 本地 server，提供 /proxy/pi、/proxy/search、/proxy/fetch-page。 |
| .pi/skills/xanthil-extraction-tools/SKILL.md | 49 | 50aace627c27f80fa5607284d6fc49ab34557d77ef94c2055fe1a7c6287d0a16 | flow 注入的本地 skill，用于 Xanthil ExtractionTool bridge。 |

## 运行契约

- workflow version: `1`
- defaultModel: `minimax-cn/MiniMax-M3`
- metadata.name: `深度研究报告引擎`
- metadata.description: 基于多 Agent 协作的 7 阶段深度研究流水线，覆盖 init→research→write→review→fix→supplement→final 完整链路
- 模板类型：`mall`, `community`, `district`, `office`
- agent 角色：`main`, `researcher`, `writer`, `reviewer`
- 输入 key：`task`
- 输入格式：研究 [对象名称]，[地址]，[类型 mall|community|district|office]
- 失败策略：全局 maxRetries=3，backoffMs=2000

## 节点总览

| node id | label | role | model | desc |
|---|---|---|---|---|
| init | 项目初始化 | orchestrator | minimax-cn/MiniMax-M3 | 主控 Agent 初始化研究项目：判断对象类型，匹配 4 套模板之一，输出章节结构与关键维度 |
| research | 证据采集（并行双分支） | researcher | minimax-cn/MiniMax-M3 | researcher Agent 并行采证两个分支：区位客群 + 商业生态竞品，输出带 A/B/C 等级标注的证据清单 |
| write | 报告撰写 | writer | minimax-cn/MiniMax-M3 | writer Agent 按模板章节结构撰写完整报告草稿，人群画像≥3 个×7 维度，策略可量化 |
| review | 质量评审 | reviewer | minimax-cn/MiniMax-M3 | reviewer Agent 六维度量化打分，输出 verdict + issues 清单，附章节级问题定位 |
| fix | 修复整合 | writer | minimax-cn/MiniMax-M3 | writer Agent 逐条修复 review issues，输出修复后完整报告 + 修复对照表 |
| supplement | 搜索补证 | researcher | minimax-cn/MiniMax-M3 | researcher 缺口识别 + 网络搜索 → writer 补证整合，三步串行完成第二轮证据增强 |
| final | 终稿输出 | orchestrator | minimax-cn/MiniMax-M3 | 主控 Agent 输出完整终稿 Markdown 报告全文，结构 5 段式：执行摘要 + 目录 + 正文 + 商圈竞品分析表(12 维) + 附录 |

## 边关系

- init -> research (e1)
- research -> write (e2)
- write -> review (e3)
- review -> fix (e4)
- fix -> supplement (e5)
- supplement -> final (e6)

## 模板映射

```json
{
  "mall": "9+1 章节（区域型购物中心）",
  "community": "7+1 章节（社区商业）",
  "district": "8+1 章节（街区/商圈）",
  "office": "6+1 章节（写字楼）"
}
```

## 模型分配与外部依赖

### workflow metadata 原始模型分配

```json
{
  "default": "kimi-k2.6",
  "exceptions": {
    "research": "MiniMax/MiniMax-M3",
    "supplement": "MiniMax/MiniMax-M3",
    "review": "glm-5.1"
  },
  "availableModels": [
    "kimi-k2.6",
    "glm-5.1",
    "MiniMax-M3"
  ],
  "providerMap": {
    "volcengine-plan": [
      "kimi-k2.6",
      "glm-5.1"
    ],
    "MiniMax": [
      "MiniMax-M3"
    ]
  },
  "rationale": "research + supplement 使用 MiniMax/MiniMax-M3，与 minimax_websearch 端到端同供应商对齐，降低跨供应商数据流转延迟、单一审计链路。 review 仍用 glm-5.1，与 write/fix 的 kimi-k2.6 形成异源评审，避免 self-bias。 init / write / fix / final 保持 kimi-k2.6 默认，编排/撰写类任务的主力模型。",
  "provider": "multi (volcengine-plan + MiniMax via Pi CLI)"
}
```

### 当前可执行模型状态

当前 `workflow.json` 已把 `defaultModel` 和所有节点 `model` 调整为 `minimax-cn/MiniMax-M3`，以匹配当前 pi-agent 启用模型。metadata 中的 `modelAssignment` 保留了历史设计意图，未作为执行字段直接生效。

### 外部依赖

```json
{
  "webSearch": {
    "provider": "minimax_websearch",
    "endpoint": "https://api.minimaxi.com/v1/coding_plan/search",
    "auth": "Token Plan API Key (独立于模型 API Key)",
    "costPerCall": "0.03 元/次",
    "customHeader": "MM-API-Source: DR-Agent-Workbench",
    "usedByNodes": [
      "research",
      "supplement"
    ]
  },
  "llmProviders": [
    {
      "provider": "volcengine-plan",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
      "models": [
        "kimi-k2.6",
        "glm-5.1"
      ],
      "usedByNodes": [
        "init",
        "write",
        "review",
        "fix",
        "final"
      ],
      "role": "主力 LLM：编排、撰写、评审、修复、终稿"
    },
    {
      "provider": "MiniMax",
      "baseUrl": "https://api.minimaxi.com/v1",
      "apiKeySource": "MINIMAX_CODING_API_KEY (Token Plan Key)",
      "models": [
        "MiniMax-M3"
      ],
      "usedByNodes": [
        "research",
        "supplement"
      ],
      "role": "研究 LLM：与 minimax_websearch 同供应商，端到端研究流水线",
      "pairedWith": "minimax_websearch"
    }
  ]
}
```

## 节点与 Prompt

### init · 项目初始化

- role: orchestrator
- model: minimax-cn/MiniMax-M3
- desc: 主控 Agent 初始化研究项目：判断对象类型，匹配 4 套模板之一，输出章节结构与关键维度

```text
你是深度研究报告引擎的主控 Agent。

# 任务
{{task}}

# 你的职责
1. 根据用户输入的研究对象与地址，判断对象类型：
   - mall：区域型购物中心（MALL）→ 9+1 章节结构
   - community：社区商业 → 7+1 章节结构
   - district：街区/商圈 → 8+1 章节结构
   - office：写字楼 → 6+1 章节结构
2. 明确本次研究选用的模板章节清单
3. 列出研究范围界定（地理半径、辐射商圈、时间窗口）
4. 列出关键维度清单（≥5 项，如：区位/客群/竞品/商业生态/趋势）

# 输出格式
Markdown 结构化输出：
- 对象类型与模板
- 章节结构清单（按模板展开）
- 研究范围
- 关键维度
- 预期产出形态（章节级大纲）
```

**onFailure**

```json
{
  "detect": "output 包含 \"⚠️ 等待输入\" 或 OUTPUT-A 标记",
  "action": "pause_and_prompt_user",
  "promptUser": "请输入研究对象信息（格式：研究 [名称]，[地址]，[类型 mall|community|district|office]）",
  "resumeFrom": "init",
  "injectAs": "task",
  "maxPrompts": 3,
  "onMaxPromptsExceeded": "abort_workflow"
}
```

### research · 证据采集（并行双分支）

- role: researcher
- model: minimax-cn/MiniMax-M3
- desc: researcher Agent 并行采证两个分支：区位客群 + 商业生态竞品，输出带 A/B/C 等级标注的证据清单

```text
你是 district-researcher 证据采集 Agent。

# 任务上下文
- 研究对象：{{task}}
- 项目初始化结果：{{init}}

# 你的职责
**本节点需并行执行两个采证分支**，输出合并后的证据清单。

## 分支 A：区位与客群
- 区域规划与定位（板块属性、行政归属）
- 交通条件（地铁/公交/主干道/接驳）
- 周边住宅分布与价格（500m/1000m/3000m 圈层）
- 人口数据（街道/区级：常住、年龄、家庭、收入）
- 周边 POI 结构（学校/医院/办公/公园）

## 分支 B：商业生态与竞品
- 项目体量/开业时间/设计特色/开发商背景
- 主力店与品牌组合（已签约/已开业）
- 业态结构（零售/餐饮/亲子/娱乐/服务占比）
- 竞品项目体量/定位/差异化（≥3 个直接+间接竞品）
- 运营表现（如可获取：客流/坪效/出租率）

# 证据等级
- A 级：官方数据/政府公报/权威媒体一手报道
- B 级：行业报告/专业平台数据/二次整理信息
- C 级：论坛/社交媒体/个人博客（需交叉验证）

# 输出格式
按分支 A/B 分别输出：
[来源] [等级] [内容]

推断必须显式标注：「推断：...（置信度：高/中/低）」

末尾给出 2-3 条「数据缺口提示」，供下一轮补证使用。
```

**onFailure**

```json
{
  "detect": "LLM 调用失败或输出无法解析",
  "action": "retry_with_fallback",
  "maxRetries": 2,
  "fallbackModel": "kimi-k2.6",
  "fallbackPrompt": "MiniMax/MiniMax-M3 调用失败，已降级到 kimi-k2.6。请完成相同的采集任务，跳过网络搜索，纯 LLM 推理输出。"
}
```

### write · 报告撰写

- role: writer
- model: minimax-cn/MiniMax-M3
- desc: writer Agent 按模板章节结构撰写完整报告草稿，人群画像≥3 个×7 维度，策略可量化

```text
你是 district-writer 报告撰写 Agent。

# 任务上下文
- 研究对象：{{task}}
- 项目初始化（章节模板）：{{init}}
- 已采证证据：{{research}}

# 你的职责
按照 init 阶段选定的模板章节结构，撰写完整研究报告草稿。

# 写作要求
1. 每个章节都要有实质内容，禁止空泛套话
2. 所有数据点必须标注来源：[检索]/[底座]/[推断] 三选一
3. 核心人群画像章节必须包含 ≥3 个典型画像
4. 每个画像按 7 维度展开：
   - 维度 1：人物速写（姓名/性别/年龄/职业/收入/居住/核心标签）
   - 维度 2：人口底盘（规模占比+依据）
   - 维度 3：心理驱动与消费逻辑（动机/痛点/价值观）
   - 维度 4：到访行为画像（频次/停留/客单/品类）
   - 维度 5：信息触点与社交传播（App/社群/线下触点）
   - 维度 6：典型一天（07:00/12:00/18:00/21:00/周末）
   - 维度 7：商业启示（业态/产品/服务/可执行动作）
5. 策略建议必须可执行、可量化（如「提升 XX 占比至 XX%」）
6. 推断与事实严格分离，推断使用「推断：」前缀+置信度

# 输出格式
完整 Markdown 报告，按模板章节顺序逐章输出，每章节末尾标注「证据密度：高/中/低」。
```

**onFailure**

```json
{
  "detect": "LLM 调用失败或输出无法解析",
  "action": "retry_with_fallback",
  "maxRetries": 2,
  "fallbackModel": "glm-5.1",
  "fallbackPrompt": "kimi-k2.6 调用失败，已降级到 glm-5.1。请完成相同任务。"
}
```

### review · 质量评审

- role: reviewer
- model: minimax-cn/MiniMax-M3
- desc: reviewer Agent 六维度量化打分，输出 verdict + issues 清单，附章节级问题定位

```text
你是 district-reviewer 质量评审 Agent。

# 任务上下文
- 研究对象：{{task}}
- 报告草稿：{{write}}

# 你的职责
逐章检查报告质量，输出结构化评审结论。

# 评审维度
1. 证据充分性：核心论断是否有 A/B 级证据支撑
2. 事实推断区分：是否有未标注的推断
3. 估算口径：同类数据口径是否一致
4. 人群画像：是否覆盖人口/年龄/家庭/收入/消费偏好/分层
5. 竞品对比：对比维度是否对称
6. 策略可执行性：是否包含量化指标

# 输出格式（必须严格遵守 JSON 结构）
``\`json
{
  "verdict": "APPROVED|CONDITIONALLY_APPROVED|REJECTED",
  "score": {
    "evidence": 0-10,
    "factInference": 0-10,
    "estimation": 0-10,
    "persona": 0-10,
    "competition": 0-10,
    "actionability": 0-10
  },
  "issues": [
    {"chapter": "章节名", "severity": "high|medium|low", "desc": "具体问题描述"}
  ],
  "summary": "评审摘要（≤200 字）"
}
``\`

# 评审原则
- APPROVED：六维度均 ≥8 分，可直接出终稿
- CONDITIONALLY_APPROVED：存在 ≤5 个 medium 或 ≤2 个 high 问题，需修复后复审
- REJECTED：存在 ≥3 个 high 问题或单维度 <5 分，需大幅重写
```

**onFailure**

```json
{
  "detect": "LLM 调用失败或输出无法解析",
  "action": "retry_with_fallback",
  "maxRetries": 2,
  "fallbackModel": "kimi-k2.6",
  "fallbackPrompt": "glm-5.1 调用失败，已降级到 kimi-k2.6。请完成评审任务（注意：你与 writer 同模型，评审时请格外严格避免 self-bias）。"
}
```

### fix · 修复整合

- role: writer
- model: minimax-cn/MiniMax-M3
- desc: writer Agent 逐条修复 review issues，输出修复后完整报告 + 修复对照表

```text
你是 district-writer 报告修复 Agent。

# 任务上下文
- 研究对象：{{task}}
- 报告草稿：{{write}}
- 评审意见（含 issues 清单）：{{review}}

# 你的职责
根据 reviewer 提出的 issues 清单逐条修复报告。

# 修复要求
1. 逐条解决 issues 数组中的每个 high/medium 问题
2. 数值类数据补充来源标注（[检索]/[底座]/[推断]）
3. 推断与事实严格分离，未标注的推断补上「推断：」前缀
4. 估算口径统一（同类数据使用同一时间窗口与统计口径）
5. 保留原文中已经合格的章节，避免无谓重写
6. 末尾追加「修复对照表」：列出每条 issue 的修复方式与对应章节

# 输出格式
完整修复后 Markdown 报告 + 末尾修复对照表。
```

**onFailure**

```json
{
  "detect": "LLM 调用失败或输出无法解析",
  "action": "retry_with_fallback",
  "maxRetries": 2,
  "fallbackModel": "glm-5.1",
  "fallbackPrompt": "kimi-k2.6 调用失败，已降级到 glm-5.1。请完成相同任务。"
}
```

### supplement · 搜索补证

- role: researcher
- model: minimax-cn/MiniMax-M3
- desc: researcher 缺口识别 + 网络搜索 → writer 补证整合，三步串行完成第二轮证据增强

```text
你是 district-researcher + district-writer 联合补证 Agent。

# 任务上下文
- 研究对象：{{task}}
- 修复后报告：{{fix}}
- 已有证据：{{research}}

# 你的职责（顺序三步）

## 第一步：缺口识别（researcher）
检查报告中的数据缺口，输出 3-5 条最需要补证的关键问题。
- 优先补：官方规划、项目公开信息、商圈/人口/交通/竞品/消费力数据
- 每条 query 必须包含研究对象名称或地址关键词
- 禁止输出「报告分析、问题分析、需求规划、帮我看报告」等泛化搜索词

缺口识别 JSON 格式：
``\`json
[
  {"query": "对象名 地址关键词 维度关键词", "reason": "为什么这条最重要"}
]
``\`

## 第二步：网络搜索（researcher）
调用网络搜索工具执行上述 query，召回每条结果：
- 剔除 C 级低质来源（论坛/模板站/个人博客）
- 剔除与对象无关的噪声结果（关键词不命中）
- 每个 query 保留 ≤3 条相关结果

## 第三步：补证整合（writer）
- 将新证据整合到对应章节，标注来源
- 用新数据替换之前的推断（如有）
- 替换时显式说明「原推断：X → 现数据：Y（来源）」
- 输出完整更新后的报告（Markdown 格式）

# 输出格式
按以下顺序输出：
1. 缺口识别 JSON
2. 补证材料清单（按 query 分组）
3. 更新后完整报告
```

**onFailure**

```json
{
  "detect": "LLM 调用失败或输出无法解析",
  "action": "retry_with_fallback",
  "maxRetries": 2,
  "fallbackModel": "kimi-k2.6",
  "fallbackPrompt": "MiniMax/MiniMax-M3 调用失败，已降级到 kimi-k2.6。请完成相同的采集任务，跳过网络搜索，纯 LLM 推理输出。"
}
```

### final · 终稿输出

- role: orchestrator
- model: minimax-cn/MiniMax-M3
- desc: 主控 Agent 输出完整终稿 Markdown 报告全文，结构 5 段式：执行摘要 + 目录 + 正文 + 商圈竞品分析表(12 维) + 附录

```text
你是深度研究报告引擎的终稿生成 Agent。

# 任务上下文
- 研究对象：{{task}}
- 终稿报告（含补证整合）：{{supplement}}

# 你的职责
接收 supplement 节点的完整更新报告，输出**完整终稿 Markdown 报告全文**。

# 终稿结构（5 段式）
1. **执行摘要**（前置）：报告开头加「执行摘要」章节（≤500 字）：
   - 一句话定位（≤30 字）
   - 3-5 条核心结论（按重要性降序）
   - 证据强度（A/B/C 级证据数量）
2. **目录**：执行摘要后加 Markdown 目录（基于正文章节结构自动列出）
3. **完整正文**：保留 supplement 的所有章节内容，**不要简化、不要删减、不要省略**
4. **商圈竞品分析表**（正文与附录之间）：12 行 × 2 列 Markdown 表格，对照 020_clean/ 商圈竞品分析标准模板与样例.xlsx 的 12 维度
5. **附录**（末尾追加）：
   - 研究方法说明
   - 证据清单汇总（A/B/C 级条目数）
   - 研究边界（哪些维度受数据可获得性限制）
   - 下一步研究方向（≥2 条）

# 商圈竞品分析表规范
**位置**：正文结束之后、附录之前，单独一个「## 商圈竞品分析」二级章节。

**表格结构**（12 行，顺序固定不得重排）：

| 对比维度 | 研究对象描述 |
|---|---|
| 项目性质 | ... |
| 所在区位 | ... |
| 商业级别与体量 | ... |
| 开业时间 | ... |
| 周边3公里人口 | ... |
| 核心客群 | ... |
| 日均客流 | ... |
| 交通条件 | ... |
| 核心定位 | ... |
| 最大优势 | ... |
| 最大短板 | ... |
| 业绩参考 | ... |

**填写规则**：
1. **必须基于真实证据**：每行 content 必须来自 research/supplement 节点的证据，禁止编造
2. **来源标注**：数据点内联标注 [检索]/[底座]/[推断]+置信度
3. **数据缺口**：暂未获取的字段填「未获取（数据缺口）」，并在附录「研究边界」中提及
4. **字数梯度**（参考 020_clean/ 样表观察）：
   - 短维度（开业时间/业绩参考/周边3公里人口）：30-50 字
   - 中维度（区位/客群/交通/商业体量/日均客流）：45-80 字
   - 长维度（核心定位）：60-80 字
   - 分析维度（最大优势/最大短板）：100-180 字
5. **纯文本**：表格内不要 markdown 符号/换行/代码块，每行一段描述

# 过程标注清理
- 删除修复对照表（原文中过程性标注）
- 「原推断：X → 现数据：Y」转化为正式脚注或来源标注
- 章节末尾的「证据密度：高/中/低」标注保留

# 统一格式
- 所有数据点保留来源标注（[检索]/[底座]/[推断]+置信度）
- 标题层级一致（# 一级 / ## 二级 / ### 三级）
- 表格/列表风格统一

# 质量自检
- 章节数量符合 init 阶段选定的模板（mall=9+1 / community=7+1 / district=8+1 / office=6+1）
- 人群画像数量 ≥ 3 个且每画像 7 维度
- 策略建议均包含量化指标
- **商圈竞品分析表 12 行齐全、顺序正确、无空行**

**严禁**：
- 只输出摘要或简化报告
- 商圈竞品分析表缺行、重排或留空
- 编造无证据支撑的内容
```

**onFailure**

```json
{
  "detect": "LLM 调用失败或输出无法解析",
  "action": "retry_with_fallback",
  "maxRetries": 2,
  "fallbackModel": "glm-5.1",
  "fallbackPrompt": "kimi-k2.6 调用失败，已降级到 glm-5.1。请完成相同任务。"
}
```

## agent-tool 原型说明

该 flow 目录下还包含一套独立的浏览器原型 `agent-tool`。它不是 pi-xanthil 当前 `workflow.json` 执行的唯一入口，但包含早期/演示版 agent 定义、live prompt、demo 回放、websearch 和本地 proxy 逻辑。为保证全保真，以下附录保留全部相关源文件原文。

## 注意事项

- `workflow.json` 是 pi-xanthil 工作流执行的直接契约；`agent-tool/js/*.js` 是该 flow 自带的独立原型实现。
- `workflow.metadata.modelAssignment` 中仍记录旧模型设计，例如 `kimi-k2.6`、`glm-5.1`；真实执行字段以每个节点的 `model` 和 root `defaultModel` 为准。
- `.pi/skills/xanthil-extraction-tools/SKILL.md` 只允许 registered `clean_data` 路径，禁止把 `draw_data` 原始行级数据送入 LLM。
- `agent-tool/server.py` 中 API Key 只内存转发，不落盘、不打日志；`pi_trace.jsonl` 只记录调用审计，不记录 prompt 或 key。

# 源文件全量附录

## workflow.json

- sha256: `9e2d21eb5a41eea0ef9defcca076bcb6cc805a2e3d7015cdbe048be7b987b464`
- lines: 299
- 说明: pi-xanthil 执行契约，含 metadata、节点、边、prompt、模型、失败策略。

```json
{
  "version": 1,
  "defaultModel": "minimax-cn/MiniMax-M3",
  "metadata": {
    "name": "深度研究报告引擎",
    "description": "基于多 Agent 协作的 7 阶段深度研究流水线，覆盖 init→research→write→review→fix→supplement→final 完整链路",
    "templates": [
      "mall",
      "community",
      "district",
      "office"
    ],
    "agents": [
      "main",
      "researcher",
      "writer",
      "reviewer"
    ],
    "templateMapping": {
      "mall": "9+1 章节（区域型购物中心）",
      "community": "7+1 章节（社区商业）",
      "district": "8+1 章节（街区/商圈）",
      "office": "6+1 章节（写字楼）"
    },
    "modelAssignment": {
      "default": "kimi-k2.6",
      "exceptions": {
        "research": "MiniMax/MiniMax-M3",
        "supplement": "MiniMax/MiniMax-M3",
        "review": "glm-5.1"
      },
      "availableModels": [
        "kimi-k2.6",
        "glm-5.1",
        "MiniMax-M3"
      ],
      "providerMap": {
        "volcengine-plan": [
          "kimi-k2.6",
          "glm-5.1"
        ],
        "MiniMax": [
          "MiniMax-M3"
        ]
      },
      "rationale": "research + supplement 使用 MiniMax/MiniMax-M3，与 minimax_websearch 端到端同供应商对齐，降低跨供应商数据流转延迟、单一审计链路。 review 仍用 glm-5.1，与 write/fix 的 kimi-k2.6 形成异源评审，避免 self-bias。 init / write / fix / final 保持 kimi-k2.6 默认，编排/撰写类任务的主力模型。",
      "provider": "multi (volcengine-plan + MiniMax via Pi CLI)"
    },
    "externalDeps": {
      "webSearch": {
        "provider": "minimax_websearch",
        "endpoint": "https://api.minimaxi.com/v1/coding_plan/search",
        "auth": "Token Plan API Key (独立于模型 API Key)",
        "costPerCall": "0.03 元/次",
        "customHeader": "MM-API-Source: DR-Agent-Workbench",
        "usedByNodes": [
          "research",
          "supplement"
        ]
      },
      "llmProviders": [
        {
          "provider": "volcengine-plan",
          "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
          "models": [
            "kimi-k2.6",
            "glm-5.1"
          ],
          "usedByNodes": [
            "init",
            "write",
            "review",
            "fix",
            "final"
          ],
          "role": "主力 LLM：编排、撰写、评审、修复、终稿"
        },
        {
          "provider": "MiniMax",
          "baseUrl": "https://api.minimaxi.com/v1",
          "apiKeySource": "MINIMAX_CODING_API_KEY (Token Plan Key)",
          "models": [
            "MiniMax-M3"
          ],
          "usedByNodes": [
            "research",
            "supplement"
          ],
          "role": "研究 LLM：与 minimax_websearch 同供应商，端到端研究流水线",
          "pairedWith": "minimax_websearch"
        }
      ]
    },
    "inputs": {
      "task": {
        "type": "string",
        "required": true,
        "description": "用户研究任务字符串，由 orchestrator 在执行 init 节点前注入到 {{task}} 占位符",
        "format": "研究 [对象名称]，[地址]，[类型 mall|community|district|office]",
        "placeholder": "研究沈阳中海环宇城，沈阳市和平区南京南街368号，mall",
        "fallbackBehavior": "orchestrator 未注入时，init 节点输出 OUTPUT-A 占位结构并终止，由 orchestrator 提示用户补全后重新执行",
        "onMissing": "pause_workflow_and_prompt_user",
        "promptMessage": "请输入研究对象信息（格式：研究 [名称]，[地址]，[类型 mall|community|district|office]）",
        "maxPromptAttempts": 3,
        "onMaxAttemptsExceeded": "abort_workflow"
      }
    },
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMs": 2000,
      "retryableConditions": [
        "node output matches OUTPUT-A pattern (missing input)",
        "LLM call returns HTTP 429/500/502/503",
        "node execution timeout"
      ],
      "nonRetryableConditions": [
        "LLM call returns HTTP 401/403 (auth failure)",
        "node output contains \"FATAL\" keyword",
        "maxRetries exceeded"
      ],
      "perNode": {
        "init": {
          "onMissingInput": "pause_and_prompt_user",
          "promptUserMessage": "请输入研究对象信息（格式：研究 [名称]，[地址]，[类型 mall|community|district|office]）",
          "resumeFrom": "init",
          "allowSkip": false,
          "maxPromptAttempts": 3,
          "onMaxAttemptsExceeded": "abort_workflow"
        }
      }
    }
  },
  "nodes": [
    {
      "id": "init",
      "label": "项目初始化",
      "prompt": "你是深度研究报告引擎的主控 Agent。\n\n# 任务\n{{task}}\n\n# 你的职责\n1. 根据用户输入的研究对象与地址，判断对象类型：\n   - mall：区域型购物中心（MALL）→ 9+1 章节结构\n   - community：社区商业 → 7+1 章节结构\n   - district：街区/商圈 → 8+1 章节结构\n   - office：写字楼 → 6+1 章节结构\n2. 明确本次研究选用的模板章节清单\n3. 列出研究范围界定（地理半径、辐射商圈、时间窗口）\n4. 列出关键维度清单（≥5 项，如：区位/客群/竞品/商业生态/趋势）\n\n# 输出格式\nMarkdown 结构化输出：\n- 对象类型与模板\n- 章节结构清单（按模板展开）\n- 研究范围\n- 关键维度\n- 预期产出形态（章节级大纲）",
      "model": "minimax-cn/MiniMax-M3",
      "role": "orchestrator",
      "icon": "◆",
      "color": "#6c8cff",
      "desc": "主控 Agent 初始化研究项目：判断对象类型，匹配 4 套模板之一，输出章节结构与关键维度",
      "onFailure": {
        "detect": "output 包含 \"⚠️ 等待输入\" 或 OUTPUT-A 标记",
        "action": "pause_and_prompt_user",
        "promptUser": "请输入研究对象信息（格式：研究 [名称]，[地址]，[类型 mall|community|district|office]）",
        "resumeFrom": "init",
        "injectAs": "task",
        "maxPrompts": 3,
        "onMaxPromptsExceeded": "abort_workflow"
      }
    },
    {
      "id": "research",
      "label": "证据采集（并行双分支）",
      "prompt": "你是 district-researcher 证据采集 Agent。\n\n# 任务上下文\n- 研究对象：{{task}}\n- 项目初始化结果：{{init}}\n\n# 你的职责\n**本节点需并行执行两个采证分支**，输出合并后的证据清单。\n\n## 分支 A：区位与客群\n- 区域规划与定位（板块属性、行政归属）\n- 交通条件（地铁/公交/主干道/接驳）\n- 周边住宅分布与价格（500m/1000m/3000m 圈层）\n- 人口数据（街道/区级：常住、年龄、家庭、收入）\n- 周边 POI 结构（学校/医院/办公/公园）\n\n## 分支 B：商业生态与竞品\n- 项目体量/开业时间/设计特色/开发商背景\n- 主力店与品牌组合（已签约/已开业）\n- 业态结构（零售/餐饮/亲子/娱乐/服务占比）\n- 竞品项目体量/定位/差异化（≥3 个直接+间接竞品）\n- 运营表现（如可获取：客流/坪效/出租率）\n\n# 证据等级\n- A 级：官方数据/政府公报/权威媒体一手报道\n- B 级：行业报告/专业平台数据/二次整理信息\n- C 级：论坛/社交媒体/个人博客（需交叉验证）\n\n# 输出格式\n按分支 A/B 分别输出：\n[来源] [等级] [内容]\n\n推断必须显式标注：「推断：...（置信度：高/中/低）」\n\n末尾给出 2-3 条「数据缺口提示」，供下一轮补证使用。",
      "model": "minimax-cn/MiniMax-M3",
      "role": "researcher",
      "icon": "🔬",
      "color": "#4ecdc4",
      "desc": "researcher Agent 并行采证两个分支：区位客群 + 商业生态竞品，输出带 A/B/C 等级标注的证据清单",
      "onFailure": {
        "detect": "LLM 调用失败或输出无法解析",
        "action": "retry_with_fallback",
        "maxRetries": 2,
        "fallbackModel": "kimi-k2.6",
        "fallbackPrompt": "MiniMax/MiniMax-M3 调用失败，已降级到 kimi-k2.6。请完成相同的采集任务，跳过网络搜索，纯 LLM 推理输出。"
      }
    },
    {
      "id": "write",
      "label": "报告撰写",
      "prompt": "你是 district-writer 报告撰写 Agent。\n\n# 任务上下文\n- 研究对象：{{task}}\n- 项目初始化（章节模板）：{{init}}\n- 已采证证据：{{research}}\n\n# 你的职责\n按照 init 阶段选定的模板章节结构，撰写完整研究报告草稿。\n\n# 写作要求\n1. 每个章节都要有实质内容，禁止空泛套话\n2. 所有数据点必须标注来源：[检索]/[底座]/[推断] 三选一\n3. 核心人群画像章节必须包含 ≥3 个典型画像\n4. 每个画像按 7 维度展开：\n   - 维度 1：人物速写（姓名/性别/年龄/职业/收入/居住/核心标签）\n   - 维度 2：人口底盘（规模占比+依据）\n   - 维度 3：心理驱动与消费逻辑（动机/痛点/价值观）\n   - 维度 4：到访行为画像（频次/停留/客单/品类）\n   - 维度 5：信息触点与社交传播（App/社群/线下触点）\n   - 维度 6：典型一天（07:00/12:00/18:00/21:00/周末）\n   - 维度 7：商业启示（业态/产品/服务/可执行动作）\n5. 策略建议必须可执行、可量化（如「提升 XX 占比至 XX%」）\n6. 推断与事实严格分离，推断使用「推断：」前缀+置信度\n\n# 输出格式\n完整 Markdown 报告，按模板章节顺序逐章输出，每章节末尾标注「证据密度：高/中/低」。",
      "model": "minimax-cn/MiniMax-M3",
      "role": "writer",
      "icon": "✍️",
      "color": "#ff6b6b",
      "desc": "writer Agent 按模板章节结构撰写完整报告草稿，人群画像≥3 个×7 维度，策略可量化",
      "onFailure": {
        "detect": "LLM 调用失败或输出无法解析",
        "action": "retry_with_fallback",
        "maxRetries": 2,
        "fallbackModel": "glm-5.1",
        "fallbackPrompt": "kimi-k2.6 调用失败，已降级到 glm-5.1。请完成相同任务。"
      }
    },
    {
      "id": "review",
      "label": "质量评审",
      "prompt": "你是 district-reviewer 质量评审 Agent。\n\n# 任务上下文\n- 研究对象：{{task}}\n- 报告草稿：{{write}}\n\n# 你的职责\n逐章检查报告质量，输出结构化评审结论。\n\n# 评审维度\n1. 证据充分性：核心论断是否有 A/B 级证据支撑\n2. 事实推断区分：是否有未标注的推断\n3. 估算口径：同类数据口径是否一致\n4. 人群画像：是否覆盖人口/年龄/家庭/收入/消费偏好/分层\n5. 竞品对比：对比维度是否对称\n6. 策略可执行性：是否包含量化指标\n\n# 输出格式（必须严格遵守 JSON 结构）\n``\`json\n{\n  \"verdict\": \"APPROVED|CONDITIONALLY_APPROVED|REJECTED\",\n  \"score\": {\n    \"evidence\": 0-10,\n    \"factInference\": 0-10,\n    \"estimation\": 0-10,\n    \"persona\": 0-10,\n    \"competition\": 0-10,\n    \"actionability\": 0-10\n  },\n  \"issues\": [\n    {\"chapter\": \"章节名\", \"severity\": \"high|medium|low\", \"desc\": \"具体问题描述\"}\n  ],\n  \"summary\": \"评审摘要（≤200 字）\"\n}\n``\`\n\n# 评审原则\n- APPROVED：六维度均 ≥8 分，可直接出终稿\n- CONDITIONALLY_APPROVED：存在 ≤5 个 medium 或 ≤2 个 high 问题，需修复后复审\n- REJECTED：存在 ≥3 个 high 问题或单维度 <5 分，需大幅重写",
      "model": "minimax-cn/MiniMax-M3",
      "role": "reviewer",
      "icon": "🔍",
      "color": "#ffd93d",
      "desc": "reviewer Agent 六维度量化打分，输出 verdict + issues 清单，附章节级问题定位",
      "onFailure": {
        "detect": "LLM 调用失败或输出无法解析",
        "action": "retry_with_fallback",
        "maxRetries": 2,
        "fallbackModel": "kimi-k2.6",
        "fallbackPrompt": "glm-5.1 调用失败，已降级到 kimi-k2.6。请完成评审任务（注意：你与 writer 同模型，评审时请格外严格避免 self-bias）。"
      }
    },
    {
      "id": "fix",
      "label": "修复整合",
      "prompt": "你是 district-writer 报告修复 Agent。\n\n# 任务上下文\n- 研究对象：{{task}}\n- 报告草稿：{{write}}\n- 评审意见（含 issues 清单）：{{review}}\n\n# 你的职责\n根据 reviewer 提出的 issues 清单逐条修复报告。\n\n# 修复要求\n1. 逐条解决 issues 数组中的每个 high/medium 问题\n2. 数值类数据补充来源标注（[检索]/[底座]/[推断]）\n3. 推断与事实严格分离，未标注的推断补上「推断：」前缀\n4. 估算口径统一（同类数据使用同一时间窗口与统计口径）\n5. 保留原文中已经合格的章节，避免无谓重写\n6. 末尾追加「修复对照表」：列出每条 issue 的修复方式与对应章节\n\n# 输出格式\n完整修复后 Markdown 报告 + 末尾修复对照表。",
      "model": "minimax-cn/MiniMax-M3",
      "role": "writer",
      "icon": "🔧",
      "color": "#ff6b6b",
      "desc": "writer Agent 逐条修复 review issues，输出修复后完整报告 + 修复对照表",
      "onFailure": {
        "detect": "LLM 调用失败或输出无法解析",
        "action": "retry_with_fallback",
        "maxRetries": 2,
        "fallbackModel": "glm-5.1",
        "fallbackPrompt": "kimi-k2.6 调用失败，已降级到 glm-5.1。请完成相同任务。"
      }
    },
    {
      "id": "supplement",
      "label": "搜索补证",
      "prompt": "你是 district-researcher + district-writer 联合补证 Agent。\n\n# 任务上下文\n- 研究对象：{{task}}\n- 修复后报告：{{fix}}\n- 已有证据：{{research}}\n\n# 你的职责（顺序三步）\n\n## 第一步：缺口识别（researcher）\n检查报告中的数据缺口，输出 3-5 条最需要补证的关键问题。\n- 优先补：官方规划、项目公开信息、商圈/人口/交通/竞品/消费力数据\n- 每条 query 必须包含研究对象名称或地址关键词\n- 禁止输出「报告分析、问题分析、需求规划、帮我看报告」等泛化搜索词\n\n缺口识别 JSON 格式：\n``\`json\n[\n  {\"query\": \"对象名 地址关键词 维度关键词\", \"reason\": \"为什么这条最重要\"}\n]\n``\`\n\n## 第二步：网络搜索（researcher）\n调用网络搜索工具执行上述 query，召回每条结果：\n- 剔除 C 级低质来源（论坛/模板站/个人博客）\n- 剔除与对象无关的噪声结果（关键词不命中）\n- 每个 query 保留 ≤3 条相关结果\n\n## 第三步：补证整合（writer）\n- 将新证据整合到对应章节，标注来源\n- 用新数据替换之前的推断（如有）\n- 替换时显式说明「原推断：X → 现数据：Y（来源）」\n- 输出完整更新后的报告（Markdown 格式）\n\n# 输出格式\n按以下顺序输出：\n1. 缺口识别 JSON\n2. 补证材料清单（按 query 分组）\n3. 更新后完整报告",
      "model": "minimax-cn/MiniMax-M3",
      "role": "researcher",
      "icon": "🌐",
      "color": "#9b59b6",
      "desc": "researcher 缺口识别 + 网络搜索 → writer 补证整合，三步串行完成第二轮证据增强",
      "onFailure": {
        "detect": "LLM 调用失败或输出无法解析",
        "action": "retry_with_fallback",
        "maxRetries": 2,
        "fallbackModel": "kimi-k2.6",
        "fallbackPrompt": "MiniMax/MiniMax-M3 调用失败，已降级到 kimi-k2.6。请完成相同的采集任务，跳过网络搜索，纯 LLM 推理输出。"
      }
    },
    {
      "id": "final",
      "label": "终稿输出",
      "prompt": "你是深度研究报告引擎的终稿生成 Agent。\n\n# 任务上下文\n- 研究对象：{{task}}\n- 终稿报告（含补证整合）：{{supplement}}\n\n# 你的职责\n接收 supplement 节点的完整更新报告，输出**完整终稿 Markdown 报告全文**。\n\n# 终稿结构（5 段式）\n1. **执行摘要**（前置）：报告开头加「执行摘要」章节（≤500 字）：\n   - 一句话定位（≤30 字）\n   - 3-5 条核心结论（按重要性降序）\n   - 证据强度（A/B/C 级证据数量）\n2. **目录**：执行摘要后加 Markdown 目录（基于正文章节结构自动列出）\n3. **完整正文**：保留 supplement 的所有章节内容，**不要简化、不要删减、不要省略**\n4. **商圈竞品分析表**（正文与附录之间）：12 行 × 2 列 Markdown 表格，对照 020_clean/ 商圈竞品分析标准模板与样例.xlsx 的 12 维度\n5. **附录**（末尾追加）：\n   - 研究方法说明\n   - 证据清单汇总（A/B/C 级条目数）\n   - 研究边界（哪些维度受数据可获得性限制）\n   - 下一步研究方向（≥2 条）\n\n# 商圈竞品分析表规范\n**位置**：正文结束之后、附录之前，单独一个「## 商圈竞品分析」二级章节。\n\n**表格结构**（12 行，顺序固定不得重排）：\n\n| 对比维度 | 研究对象描述 |\n|---|---|\n| 项目性质 | ... |\n| 所在区位 | ... |\n| 商业级别与体量 | ... |\n| 开业时间 | ... |\n| 周边3公里人口 | ... |\n| 核心客群 | ... |\n| 日均客流 | ... |\n| 交通条件 | ... |\n| 核心定位 | ... |\n| 最大优势 | ... |\n| 最大短板 | ... |\n| 业绩参考 | ... |\n\n**填写规则**：\n1. **必须基于真实证据**：每行 content 必须来自 research/supplement 节点的证据，禁止编造\n2. **来源标注**：数据点内联标注 [检索]/[底座]/[推断]+置信度\n3. **数据缺口**：暂未获取的字段填「未获取（数据缺口）」，并在附录「研究边界」中提及\n4. **字数梯度**（参考 020_clean/ 样表观察）：\n   - 短维度（开业时间/业绩参考/周边3公里人口）：30-50 字\n   - 中维度（区位/客群/交通/商业体量/日均客流）：45-80 字\n   - 长维度（核心定位）：60-80 字\n   - 分析维度（最大优势/最大短板）：100-180 字\n5. **纯文本**：表格内不要 markdown 符号/换行/代码块，每行一段描述\n\n# 过程标注清理\n- 删除修复对照表（原文中过程性标注）\n- 「原推断：X → 现数据：Y」转化为正式脚注或来源标注\n- 章节末尾的「证据密度：高/中/低」标注保留\n\n# 统一格式\n- 所有数据点保留来源标注（[检索]/[底座]/[推断]+置信度）\n- 标题层级一致（# 一级 / ## 二级 / ### 三级）\n- 表格/列表风格统一\n\n# 质量自检\n- 章节数量符合 init 阶段选定的模板（mall=9+1 / community=7+1 / district=8+1 / office=6+1）\n- 人群画像数量 ≥ 3 个且每画像 7 维度\n- 策略建议均包含量化指标\n- **商圈竞品分析表 12 行齐全、顺序正确、无空行**\n\n**严禁**：\n- 只输出摘要或简化报告\n- 商圈竞品分析表缺行、重排或留空\n- 编造无证据支撑的内容",
      "model": "minimax-cn/MiniMax-M3",
      "role": "orchestrator",
      "icon": "◆",
      "color": "#6c8cff",
      "desc": "主控 Agent 输出完整终稿 Markdown 报告全文，结构 5 段式：执行摘要 + 目录 + 正文 + 商圈竞品分析表(12 维) + 附录",
      "onFailure": {
        "detect": "LLM 调用失败或输出无法解析",
        "action": "retry_with_fallback",
        "maxRetries": 2,
        "fallbackModel": "glm-5.1",
        "fallbackPrompt": "kimi-k2.6 调用失败，已降级到 glm-5.1。请完成相同任务。"
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "init",
      "target": "research"
    },
    {
      "id": "e2",
      "source": "research",
      "target": "write"
    },
    {
      "id": "e3",
      "source": "write",
      "target": "review"
    },
    {
      "id": "e4",
      "source": "review",
      "target": "fix"
    },
    {
      "id": "e5",
      "source": "fix",
      "target": "supplement"
    },
    {
      "id": "e6",
      "source": "supplement",
      "target": "final"
    }
  ],
  "promptVariables": {
    "task": "原始研究任务（用户输入：研究对象 + 地址 + 类型）",
    "init": "init 节点输出：对象类型 + 模板章节 + 关键维度",
    "research": "research 节点输出：分支 A/B 合并证据清单",
    "write": "write 节点输出：报告草稿（完整 Markdown）",
    "review": "review 节点输出：JSON 结构化评审结论",
    "fix": "fix 节点输出：修复后报告 + 修复对照表",
    "supplement": "supplement 节点输出：缺口识别 + 补证材料 + 更新后报告"
  },
  "allowWeb": true
}
```

## agent-tool/js/agents.js

- sha256: `4685b15d77e521e65946030f3c297f7b723060770fdd451e04e18fd66d1d5f28`
- lines: 188
- 说明: 独立 agent-tool 原型的 AGENTS 与 TEMPLATES，含四类 agent systemPrompt。

```javascript
const AGENTS = {
  main: {
    id: 'main',
    name: '主 Agent',
    icon: '◆',
    color: '#6c8cff',
    desc: '编排决策 · 流程调度',
    systemPrompt: `你是深度研究报告引擎的主控 Agent。你的职责：
1. 根据研究对象类型选择研究模板
2. 协调各专业 Agent 的工作流程
3. 汇总最终结论并输出报告摘要
4. 严格遵循「先模板后采证」方法论

研究对象类型与模板映射：
- MALL（区域型购物中心）→ 9+1章节结构
- 社区商业 → 7+1章节结构
- 街区/商圈 → 8+1章节结构
- 写字楼 → 6+1章节结构

输出要求：每个阶段输出结构化状态，使用 markdown 格式。`
  },

  researcher: {
    id: 'researcher',
    name: 'district-researcher',
    icon: '🔬',
    color: '#4ecdc4',
    desc: '证据采集 · 信息检索',
    systemPrompt: `你是深度研究引擎的证据采集 Agent。你的职责：
1. 根据主 Agent 指定的维度搜索信息
2. 对每条证据标注来源和置信等级（A/B/C）
3. 严格区分事实与推断
4. 优先采集 A 级强证据

证据等级定义：
- A级：官方数据/政府公报/权威媒体一手报道
- B级：行业报告/专业平台数据/二次整理信息
- C级：论坛/社交媒体/个人博客（需交叉验证）

输出格式：每条证据包含 [来源] [等级] [内容] 三要素。
推断必须显式标注：「推断：...（置信度：高/中/低）」`
  },

  writer: {
    id: 'writer',
    name: 'district-writer',
    icon: '✍️',
    color: '#ff6b6b',
    desc: '报告撰写 · 内容生成',
    systemPrompt: `你是深度研究引擎的报告撰写 Agent。你的职责：
1. 按照指定模板结构撰写研究报告
2. 所有数据点必须标注来源或推断性质
3. 人群画像必须包含至少3个深度画像，每个画像按7维度展开
4. 策略建议必须可执行、可量化

MALL模板（9+1章节）：
1. 核心摘要（3-5条结论+一句话定位）
2. 研究对象与项目概况（含基础信息表）
3. 项目演化与发展阶段
4. 区位条件与空间基础
5. 核心人群画像（见下方详细要求）
6. 商业生态深度分析（租户组合/主力店/品牌能级/运营/客流引擎）
7. 竞争格局与替代分析
8. SWOT分析
9. 趋势研判与策略建议
10. 附录：证据来源与估算口径说明

【核心人群画像·详细要求】
5.1 人群速览
- 小区/项目定位（年代/档次/物业/在售或二手价位）
- 周边POI结构与人群基盘（500m/1000m/3000m圈层分析）
- 主要客群分层（4-5个画像名称+一句话定位）
- 关键消费场景（早/午/晚/周末各时段）
- 反例客群（非目标人群及排除理由）

5.2 深度人物画像（至少3个，每个按以下7维度展开）
维度1：人物速写 — 姓名、性别、年龄、职业、收入、居住状态、核心标签
维度2：人口底盘 — 该画像在周边的规模占比估算、依据
维度3：心理驱动与消费逻辑 — 核心动机、痛点、价值观
维度4：到访行为画像 — 频次、停留时长、客单价区间、消费品类
维度5：信息触点与社交传播 — 常用App、社群、线下触点、高效触达方式
维度6：典型一天 — 按时间段（07:00/12:00/18:00/21:00/周末）展开具体行为
维度7：商业启示 — 适合业态、产品/服务建议、具体可执行动作

写作规范：
- 推断与事实严格分离，推断使用「推断：」前缀+置信度
- 数值类数据必须标注来源
- 证据标注格式：[检索] = 网络检索结果，[底座] = 基础数据，[推断] = 逻辑推断
- 策略建议含量化目标（如"提升XX占比至XX%"）`
  },

  reviewer: {
    id: 'reviewer',
    name: 'district-reviewer',
    icon: '🔍',
    color: '#ffd93d',
    desc: '质量评审 · 事实核查',
    systemPrompt: `你是深度研究引擎的质量评审 Agent。你的职责：
1. 逐章检查报告质量
2. 核查证据充分性、推断与事实区分、估算口径一致性
3. 评估人群画像详尽度
4. 检查竞品对比的公平性和一致性
5. 评估策略建议的可执行性

评审维度：
- 证据充分性：核心论断是否有A/B级证据支撑
- 事实推断区分：是否有未标注的推断
- 估算口径：同一类数据口径是否一致
- 人群画像：是否覆盖人口/年龄/家庭/收入/消费偏好/分层
- 竞品对比：对比维度是否对称
- 策略可执行性：是否包含量化指标

评审结论：
- APPROVED：可直接出终稿
- CONDITIONALLY_APPROVED：需修复N项问题
- REJECTED：需大幅重写

输出格式：
{
  "verdict": "APPROVED|CONDITIONALLY_APPROVED|REJECTED",
  "issues": ["问题1", "问题2", ...],
  "summary": "评审摘要"
}`
  }
};

const TEMPLATES = {
  mall: {
    id: 'mall',
    name: '区域型购物中心 (MALL)',
    chapters: [
      { id: 'summary', title: '核心摘要' },
      { id: 'overview', title: '研究对象与项目概况' },
      { id: 'evolution', title: '项目演化与发展阶段' },
      { id: 'location', title: '区位条件与空间基础' },
      { id: 'demographics', title: '核心人群画像' },
      { id: 'commerce', title: '商业生态深度分析' },
      { id: 'competition', title: '竞争格局与替代分析' },
      { id: 'swot', title: 'SWOT分析' },
      { id: 'strategy', title: '趋势研判与策略建议' },
      { id: 'conclusion', title: '结论' },
      { id: 'appendix', title: '附录：证据来源与估算口径' }
    ]
  },
  community: {
    id: 'community',
    name: '社区商业',
    chapters: [
      { id: 'summary', title: '核心摘要' },
      { id: 'overview', title: '研究对象与项目概况' },
      { id: 'location', title: '区位条件与客群底盘' },
      { id: 'demographics', title: '核心人群画像' },
      { id: 'commerce', title: '业态组合与运营分析' },
      { id: 'competition', title: '竞争格局' },
      { id: 'strategy', title: '趋势研判与策略建议' },
      { id: 'appendix', title: '附录' }
    ]
  },
  district: {
    id: 'district',
    name: '街区/商圈',
    chapters: [
      { id: 'summary', title: '核心摘要' },
      { id: 'overview', title: '研究对象与范围界定' },
      { id: 'evolution', title: '发展脉络与阶段' },
      { id: 'location', title: '区位条件与交通网络' },
      { id: 'demographics', title: '核心人群画像' },
      { id: 'commerce', title: '商业生态分析' },
      { id: 'competition', title: '竞争格局' },
      { id: 'strategy', title: '趋势研判与策略建议' },
      { id: 'appendix', title: '附录' }
    ]
  },
  office: {
    id: 'office',
    name: '写字楼',
    chapters: [
      { id: 'summary', title: '核心摘要' },
      { id: 'overview', title: '研究对象与项目概况' },
      { id: 'location', title: '区位条件与交通' },
      { id: 'tenants', title: '租户结构与产业分析' },
      { id: 'competition', title: '竞争格局' },
      { id: 'strategy', title: '趋势研判与策略建议' },
      { id: 'appendix', title: '附录' }
    ]
  }
};
```

## agent-tool/js/flow.js

- sha256: `511188ba0f6019d7e940bb34a5f945130631d14eac016d295be9829d30a07abe`
- lines: 568
- 说明: 独立 agent-tool 原型的 7 阶段 live/demo 执行流程和阶段 user prompt。

```javascript
const Flow = {
  _abortCtrl: null,

  async runDemo() {
    State.reset();
    State.setMode('demo');
    State.setRunning(true);
    State.startTimer();
    App.log('[系统] 样例回放模式启动');

    const stages = SAMPLE.stages;
    for (let i = 0; i < stages.length; i++) {
      if (!State.running) break;
      State.setStage(i);
      const st = stages[i];
      State.setAgent(st.agent);
      App.log(`[阶段 ${i + 1}/7] ${st.label}`);

      if (st.parallel && st.branches) {
        await this._runDemoParallel(st);
      } else {
        await this._runDemoMessages(st.messages, st.agent);
      }

      if (st.review) {
        State.setReview(st.review);
      }

      if (st.id === 'write' || st.id === 'fix' || st.id === 'supplement' || st.id === 'final') {
        await this._revealReport();
      }
      await this._delay(800);
    }

    State.setRunning(false);
    State.setStage(stages.length);
    State.setAgent(null);
    State.stopTimer();
    App.log('[系统] 样例回放完成');
  },

  async _runDemoMessages(messages, defaultAgent) {
    for (const msg of messages) {
      if (!State.running) break;
      const agentId = msg.role === 'system' ? 'system' : (msg.agent || defaultAgent || msg.role);
      if (msg.role === 'system') {
        App.addSystemMessage(msg.text);
      } else {
        await App.addAgentMessage(agentId, msg.text, true);
      }
      await this._delay(600);
    }
  },

  async _runDemoParallel(stage) {
    const maxLen = Math.max(...stage.branches.map(b => b.messages.length));
    for (let i = 0; i < maxLen; i++) {
      if (!State.running) break;
      for (const branch of stage.branches) {
        if (i < branch.messages.length) {
          const msg = branch.messages[i];
          if (msg.role === 'system') {
            App.addSystemMessage(`[${branch.name}] ${msg.text}`);
          } else {
            await App.addAgentMessage('researcher', `**[${branch.name}]** ${msg.text}`, true);
          }
        }
      }
      await this._delay(600);
    }
    for (const branch of stage.branches) {
      if (branch.evidences) {
        branch.evidences.forEach(ev => State.addEvidence({ ...ev, branch: branch.name }));
      }
    }
  },

  async _revealReport() {
    if (SAMPLE.fullReportMd && !State.reportMd) {
      const md = SAMPLE.fullReportMd;
      const chunkSize = Math.ceil(md.length / 30);
      for (let i = 0; i < md.length; i += chunkSize) {
        if (!State.running) break;
        State.appendReport(md.slice(i, i + chunkSize));
        App.renderReport();
        await this._delay(50);
      }
    }
  },

  async runLive(targetName, targetAddress, targetType) {
    State.reset();
    State.setMode('live');
    State.setRunning(true);
    State.startTimer();
    this._abortCtrl = new AbortController();
    App.log('[系统] 实时 LLM 模式启动');

    const template = TEMPLATES[targetType] || TEMPLATES.mall;
    const agentDefs = AGENTS;

    try {
      await this._liveStage_init(targetName, targetAddress, targetType, template);
      await this._liveStage_research(targetName, targetAddress);
      await this._liveStage_write(targetName, targetAddress, template);
      await this._liveStage_review();
      await this._liveStage_fix();
      await this._liveStage_supplement(targetName, targetAddress);
      await this._liveStage_final();
    } catch (err) {
      if (err.name !== 'AbortError') {
        App.log(`[错误] ${err.message}`);
        console.error('[runLive] stage failed:', err);
      }
    }

    State.setRunning(false);
    State.setStage(7);
    State.setAgent(null);
    State.stopTimer();
    App.log('[系统] 研究流程结束');
  },

  async _llmCall(agentId, userMessages) {
    let result = '';
    let error = null;
    let usedModel = '';
    let traceId = '';
    console.log(`[_llmCall] agentId=${agentId} prompt_len=${userMessages.map(m=>m.content.length).join(',')}`);
    await LLM.chat(userMessages, {
      agentId,
      onChunk(delta) { result += delta; },
      onDone(full) { result = full; },
      onError(err) { error = err; },
      onMeta(meta) { usedModel = meta.model; traceId = meta.traceId || ''; },
      signal: this._abortCtrl?.signal
    });
    if (error) {
      console.error(`[_llmCall] ${agentId} error:`, error.message);
      throw error;
    }
    const agentName = AGENTS[agentId]?.name || agentId;
    App.log(`[${agentName}] 模型: ${usedModel}${traceId ? ' · Trace: ' + traceId : ''}`);
    console.log(`[_llmCall] ${agentId} result_len=${result.length}`);
    return result;
  },

  async _liveStage_init(name, address, type, template) {
    State.setStage(0);
    State.setAgent('main');
    App.log('[阶段 1/7] 项目初始化');

    const prompt = `初始化研究项目：
- 研究对象：${name}
- 地址：${address}
- 类型：${template.name}

请输出：
1. 对象类型判断
2. 选用模板及章节结构
3. 研究范围界定
4. 需要采集的关键维度清单`;

    const result = await this._llmCall('main', [{ role: 'user', content: prompt }]);
    await App.addAgentMessage('main', result, false);
  },

  async _liveStage_research(name, address) {
    State.setStage(1);
    State.setAgent('researcher');
    App.log('[阶段 2/7] 并行采证');

    const prompts = [
      { branch: '区位与客群', prompt: `采集「${name}」(${address})的区位与客群证据：
1. 区域规划与定位
2. 交通条件（地铁/公交/主干道）
3. 周边住宅分布与价格
4. 人口数据（街道/区级）
5. 年龄/家庭/收入结构

每条证据标注来源和等级(A/B/C)。` },
      { branch: '商业生态与竞品', prompt: `采集「${name}」(${address})的商业生态与竞品证据：
1. 项目体量/开业时间/设计特色
2. 主力店与品牌组合
3. 业态结构
4. 竞品项目体量/定位/差异化

每条证据标注来源和等级(A/B/C)。` }
    ];

    const branchQueries = {
      '区位与客群': [
        `${name} ${address} 区域规划 定位`,
        `${name} ${address} 周边住宅 房价 人口`,
        `${name} ${address} 交通 地铁 公交`
      ],
      '商业生态与竞品': [
        `${name} ${address} 主力店 品牌 业态`,
        `${name} ${address} 项目体量 开业 商业`,
        `${name} ${address} 竞品 商场 对比`
      ]
    };

    const ws = State.config.webSearch || {};
    const useSearch = !!ws.enabled;

    const results = await Promise.all(prompts.map(async p => {
      let evidenceBlock = '';
      let searchNote = '';
      if (useSearch) {
        try {
          const sr = await WebSearch.runQueries(branchQueries[p.branch] || [], {});
          evidenceBlock = WebSearch.formatAsEvidence(sr);
          const hit = sr.results.reduce((s, g) => s + g.items.length, 0);
          searchNote = `（已检索 ${sr.results.length} 条 query / ${hit} 条结果${sr.errors.length ? `，${sr.errors.length} 条失败` : ''}）`;
          for (const qr of sr.results) {
            for (const item of qr.items) {
              const sourceName = item.title || item.href || '';
              const sourceUrl = item.href || '';
              const isGovt = /gov\.cn|gov\.com|官方|政府|公报/.test(sourceName + sourceUrl);
              const isMedia = /新华网|人民网|央视|中国网|中新网|澎湃|第一财经|证券时报/.test(sourceName);
              const isForum = /贴吧|微博|知乎|豆瓣|小红书|抖音|bilibili|b站|论坛|博客|个人/.test(sourceName + sourceUrl);
              const grade = isGovt ? 'A' : isMedia ? 'A' : isForum ? 'C' : 'B';
              State.addEvidence({ branch: p.branch, source: sourceName, grade, content: (item.title || '') + (item.body ? ' — ' + item.body : '') });
            }
          }
          if (sr.errors.length) {
            App.log(`[搜索告警·${p.branch}] ${sr.errors.join(' | ')}`);
          }
        } catch (err) {
          App.log(`[搜索失败·${p.branch}] ${err.message}，已降级为纯 LLM`);
          searchNote = '（网络搜索失败，已降级为纯 LLM 推理）';
        }
      }

      const finalPrompt = evidenceBlock
        ? `${p.prompt}\n\n参考以下网络检索到的事实材料（请优先引用并注明来源 URL）：\n\n${evidenceBlock}`
        : p.prompt;

      const text = await this._llmCall('researcher', [{ role: 'user', content: finalPrompt }]);
      return { ...p, text, searchNote };
    }));

    for (const r of results) {
      const prefix = r.searchNote ? ` ${r.searchNote}` : '';
      await App.addAgentMessage('researcher', `**[${r.branch}]**${prefix}\n\n${r.text}`, false);
    }
  },

  async _liveStage_write(name, address, template) {
    State.setStage(2);
    State.setAgent('writer');
    App.log('[阶段 3/7] 合并撰写');

    const chapterList = template.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n');
    const prompt = `基于已采集的证据，按照以下模板撰写完整研究报告：

研究对象：${name}
地址：${address}
模板章节：
${chapterList}

要求：
- 每个章节都要有实质内容
- 数据标注来源，推断标注置信度
- 人群画像至少3个典型画像
- 策略建议包含量化目标
- 使用 Markdown 格式`;

    let result = '';
    let error = null;
    let usedModel = '';
    let traceId = '';
    State.setReport('');
    await LLM.chat([{ role: 'user', content: prompt }], {
      agentId: 'writer',
      onChunk(delta) {
        result += delta;
        State.setReport(result);
        App.renderReport();
      },
      onDone(full) { result = full; },
      onError(err) { error = err; },
      onMeta(meta) { usedModel = meta.model; traceId = meta.traceId || ''; },
      signal: this._abortCtrl?.signal
    });
    if (error) throw error;
    App.log(`[撰写] 模型: ${usedModel}${traceId ? ' · Trace: ' + traceId : ''}`);

    App.addSystemMessage('报告草稿撰写完成');
    State.setReport(result);
    App.renderReport();
    await App.addAgentMessage('writer', '报告草稿撰写完成', false);
  },

  async _liveStage_review() {
    State.setStage(3);
    State.setAgent('reviewer');
    App.log('[阶段 4/7] 质量评审');

    const prompt = `请对以下研究报告进行质量评审：

${State.reportMd}

评审维度：证据充分性、事实推断区分、估算口径一致性、人群画像详尽度、竞品对比公平性、策略可执行性。

输出JSON格式：
{
  "verdict": "APPROVED|CONDITIONALLY_APPROVED|REJECTED",
  "issues": ["问题1", "问题2"],
  "summary": "评审摘要"
}`;

    const result = await this._llmCall('reviewer', [{ role: 'user', content: prompt }]);
    await App.addAgentMessage('reviewer', result, false);

    try {
      let parsed = null;
      const jsonMatch = result.match(/``\`json\s*([\s\S]*?)``\`/) || result.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        parsed = JSON.parse(jsonStr);
      }
      if (parsed && parsed.verdict) {
        State.setReview(parsed);
      }
    } catch (_) {}
  },

  async _liveStage_fix() {
    State.setStage(4);
    State.setAgent('writer');
    App.log('[阶段 5/7] 修复整合');

    const issues = State.review?.issues?.join('\n') || '无明确问题';
    const prompt = `根据评审意见修复报告：

评审问题：
${issues}

当前报告：
${State.reportMd}

请输出修复后的完整报告（Markdown格式），确保所有问题已修正。`;

    let result = '';
    let error = null;
    let usedModel = '';
    let traceId = '';
    State.setReport('');
    await LLM.chat([{ role: 'user', content: prompt }], {
      agentId: 'writer',
      onChunk(delta) {
        result += delta;
        State.setReport(result);
        App.renderReport();
      },
      onDone(full) { result = full; },
      onError(err) { error = err; },
      onMeta(meta) { usedModel = meta.model; traceId = meta.traceId || ''; },
      signal: this._abortCtrl?.signal
    });
    if (error) throw error;
    App.log(`[修复] 模型: ${usedModel}${traceId ? ' · Trace: ' + traceId : ''}`);

    State.setReport(result);
    App.renderReport();
    await App.addAgentMessage('writer', '根据评审意见修复完成', false);
  },

  _contextKeywords(name, address) {
    const raw = [name, address, ...(String(address || '').split(/[\s,，、;；()（）-]+/))];
    return [...new Set(raw.map(s => String(s || '').trim()).filter(s => s.length >= 2))];
  },

  _hasContext(text, keywords) {
    const haystack = String(text || '').toLowerCase();
    return keywords.some(k => haystack.includes(k.toLowerCase()));
  },

  _isBadSupplementHit(item) {
    const text = `${item.title || ''} ${item.body || ''} ${item.href || ''}`;
    return /C语言|格式输出|精子|家庭医生在线|即问即答|文档猫|咨信网|docx?|pptx?|培训需求|统计分析报告|工作报告|范文|模板|论文|作文|下载/i.test(text);
  },

  _gradeEvidence(item) {
    const sourceName = item.title || item.href || '';
    const sourceUrl = item.href || '';
    const isGovt = /gov\.cn|gov\.com|官方|政府|公报/.test(sourceName + sourceUrl);
    const isMedia = /新华网|人民网|央视|中国网|中新网|澎湃|第一财经|证券时报/.test(sourceName);
    const isForum = /贴吧|微博|知乎|豆瓣|小红书|抖音|bilibili|b站|论坛|博客|个人/.test(sourceName + sourceUrl);
    const isDocSite = /文档猫|咨信网|docx?|pptx?|范文|模板|下载/i.test(sourceName + sourceUrl);
    return isGovt || isMedia ? 'A' : isForum || isDocSite ? 'C' : 'B';
  },

  _parseSupplementQueries(text, name, address) {
    const keywords = this._contextKeywords(name, address);
    const out = [];
    const pushQuery = q => {
      const query = String(q || '').replace(/^[\s\d.、\-]+/, '').trim();
      if (query.length < 4 || query.length > 80) return;
      if (!this._hasContext(query, keywords)) return;
      if (/^(报告|分析|问题|需求|规划|补证|搜索|关键问题)$/i.test(query)) return;
      if (!out.includes(query)) out.push(query);
    };

    try {
      const jsonMatch = text.match(/``\`json\s*([\s\S]*?)``\`/) || text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => pushQuery(item.query || item.keyword || item.search || item));
        }
      }
    } catch (_) {}

    if (out.length === 0) {
      text.split('\n').forEach(line => {
        const cn = line.indexOf('：');
        const en = line.indexOf(':');
        const idxs = [cn, en].filter(i => i >= 0);
        const idx = idxs.length ? Math.min(...idxs) : -1;
        pushQuery(idx >= 0 ? line.slice(0, idx) : line);
      });
    }

    return out.slice(0, 5);
  },

  _filterSupplementSearchResult(searchResult, name, address) {
    const keywords = this._contextKeywords(name, address);
    const results = (searchResult.results || []).map(group => {
      const items = (group.items || [])
        .filter(item => !this._isBadSupplementHit(item))
        .filter(item => this._hasContext(`${item.title || ''} ${item.body || ''} ${item.href || ''}`, keywords))
        .slice(0, 3)
        .map(item => ({
          ...item,
          body: String(item.body || '').slice(0, 1200).replace(/\s+$/, '')
        }));
      return { ...group, items };
    }).filter(group => group.items.length > 0);
    return { ...searchResult, results };
  },

  async _liveStage_supplement(name, address) {
    State.setStage(5);
    State.setAgent('researcher');
    App.log('[阶段 6/7] 第二轮搜索补证');

    const gapPrompt = `检查以下研究报告的数据缺口，输出3-5个最需要补证的关键问题。

研究对象：${name}
地址：${address}

要求：
1. 只输出 JSON 数组，不要输出解释文字。
2. 每个 query 必须包含研究对象名称、城市、街道或地址关键词之一。
3. 禁止输出“报告分析、问题分析、需求规划、帮我看报告”等泛化搜索词。
4. 优先补：官方规划、项目公开信息、商圈/人口/交通/竞品/消费力数据。

格式：
[
  {"query":"${name} ${address} 商圈 人口 消费力", "reason":"缺少客群消费力证据"}
]

报告内容：
${State.reportMd.slice(0, 4000)}`;

    const gapResult = await this._llmCall('researcher', [{ role: 'user', content: gapPrompt }]);
    await App.addAgentMessage('researcher', `**缺口识别：**\n\n${gapResult}`, false);

    const queries = this._parseSupplementQueries(gapResult, name, address);

    let searchEvidence = '';
    const ws = State.config.webSearch || {};
    if (ws.enabled && queries.length > 0) {
      App.log(`[补证搜索] 生成 ${queries.length} 条 query`);
      try {
        const sr = await WebSearch.runQueries(queries, {});
        const filteredSr = this._filterSupplementSearchResult(sr, name, address);
        searchEvidence = WebSearch.formatAsEvidence(filteredSr);
        const hit = sr.results.reduce((s, g) => s + g.items.length, 0);
        const kept = filteredSr.results.reduce((s, g) => s + g.items.length, 0);
        App.log(`[补证搜索] 命中 ${hit} 条结果，保留 ${kept} 条相关证据`);
        if (kept === 0) searchEvidence = '';
        for (const qr of filteredSr.results) {
          for (const item of qr.items) {
            const sourceName = item.title || item.href || '';
            const grade = this._gradeEvidence(item);
            State.addSupplement({ source: sourceName, grade, content: (item.title || '') + (item.body ? ' — ' + item.body : '') });
          }
        }
      } catch (err) {
        App.log(`[补证搜索失败] ${err.message}`);
      }
    }

    if (searchEvidence) {
      State.setAgent('writer');
      App.log('[补证整合] 将新证据写入报告');

      const fixPrompt = `以下是第二轮搜索补证到的新事实材料，请将其整合到报告中，修正或补充相关数据点：

补证材料：
${searchEvidence}

当前报告：
${State.reportMd}

要求：
1. 将新证据整合到对应章节，标注来源
2. 用新数据替换之前的推断（如有）
3. 输出完整更新后的报告（Markdown格式）`;

      let result = '';
      let error = null;
      let usedModel = '';
      let traceId = '';
      State.setReport('');
      await LLM.chat([{ role: 'user', content: fixPrompt }], {
        agentId: 'writer',
        onChunk(delta) {
          result += delta;
          State.setReport(result);
          App.renderReport();
        },
        onDone(full) { result = full; },
        onError(err) { error = err; },
        onMeta(meta) { usedModel = meta.model; traceId = meta.traceId || ''; },
        signal: this._abortCtrl?.signal
      });
      if (error) throw error;
      App.log(`[补证整合] 模型: ${usedModel}${traceId ? ' · Trace: ' + traceId : ''}`);
      State.setReport(result);
      App.renderReport();
      await App.addAgentMessage('writer', '第二轮补证已整合到报告中', false);
    } else {
      App.log('[补证] 无新搜索结果，跳过整合');
      await App.addAgentMessage('researcher', '未获取到新搜索结果，报告维持现状', false);
    }
  },

  async _liveStage_final() {
    State.setStage(6);
    State.setAgent('main');
    App.log('[阶段 7/7] 终稿输出');

    const prompt = `确认报告终稿，输出核心摘要（3-5条结论+一句话定位）：

${State.reportMd.slice(0, 2000)}`;

    const result = await this._llmCall('main', [{ role: 'user', content: prompt }]);
    await App.addAgentMessage('main', result, false);
    App.addSystemMessage('深度研究报告生成完毕');
  },

  abort() {
    if (this._abortCtrl) this._abortCtrl.abort();
    State.setRunning(false);
    State.stopTimer();
  },

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
};
```

## agent-tool/js/state.js

- sha256: `e2bc38480cefdbada9942d4a38937010502662022791087bde47af58d83292b6`
- lines: 115
- 说明: 独立 agent-tool 原型的默认模型、webSearch、agent 模型覆盖配置。

```javascript
const State = {
  running: false,
  mode: 'demo',
  currentStage: -1,
  currentAgent: null,
  reportMd: '',
  evidences: [],
  supplements: [],
  review: null,
  tokens: 0,
  startTime: null,
  timerHandle: null,

  config: {
    piAgent: {
      defaultModel: 'volcengine-plan/glm-5.1'
    },
    webSearch: {
      enabled: true,
      provider: 'minimax_websearch',
      apiHost: 'https://api.minimaxi.com/v1',
      apiKey: '',
      maxResults: 6,
      maxQueries: 3,
      timeoutSeconds: 30,
      pageFetchEnabled: true,
      deepPageFetch: false
    },
    agents: {
      main:       { model: '' },
      researcher: { model: '' },
      writer:     { model: '' },
      reviewer:   { model: '' }
    }
  },

  piModels: [],

  _parseModelKey(key) {
    if (!key || !key.includes('/')) return { provider: '', model: '' };
    const i = key.indexOf('/');
    return { provider: key.slice(0, i), model: key.slice(i + 1) };
  },

  resolveAgentConfig(agentId) {
    const g = this.config;
    const a = g.agents[agentId] || {};
    const selected = a.model || g.piAgent.defaultModel || '';
    const parsed = this._parseModelKey(selected);
    return {
      piProvider: parsed.provider || 'volcengine-plan',
      piModel:    parsed.model    || 'kimi-k2.6'
    };
  },

  _listeners: [],

  on(fn) { this._listeners.push(fn); },
  emit(key) { this._listeners.forEach(fn => fn(key)); },

  setRunning(v) { this.running = v; this.emit('running'); },
  setMode(v) { this.mode = v; this.emit('mode'); },
  setStage(idx) { this.currentStage = idx; this.emit('stage'); },
  setAgent(name) { this.currentAgent = name; this.emit('agent'); },
  setReport(md) { this.reportMd = md; this.emit('report'); },
  appendReport(chunk) { this.reportMd += chunk; this.emit('report'); },
  addEvidence(ev) { this.evidences.push(ev); this.emit('evidence'); },
  addSupplement(ev) { this.supplements.push(ev); this.emit('supplement'); },
  setReview(rv) { this.review = rv; this.emit('review'); },
  addTokens(n) { this.tokens += n; this.emit('tokens'); },

  startTimer() {
    this.startTime = Date.now();
    this.timerHandle = setInterval(() => this.emit('timer'), 1000);
  },
  stopTimer() {
    if (this.timerHandle) { clearInterval(this.timerHandle); this.timerHandle = null; }
  },
  getElapsed() {
    if (!this.startTime) return '—';
    const s = Math.floor((Date.now() - this.startTime) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  },

  reset() {
    this.running = false;
    this.currentStage = -1;
    this.currentAgent = null;
    this.reportMd = '';
    this.evidences = [];
    this.supplements = [];
    this.review = null;
    this.tokens = 0;
    this.startTime = null;
    this.stopTimer();
    ['running','stage','agent','report','evidence','supplement','review','tokens','timer'].forEach(k => this.emit(k));
  },

  loadConfig() {
    try {
      const raw = localStorage.getItem('dr_config');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.webSearch) this.config.webSearch = { ...this.config.webSearch, ...saved.webSearch };
        if (saved.piAgent) this.config.piAgent = { ...this.config.piAgent, ...saved.piAgent };
        if (saved.agents) this.config.agents = { ...this.config.agents, ...saved.agents };
      }
    } catch (_) {}
  },
  saveConfig() {
    localStorage.setItem('dr_config', JSON.stringify(this.config));
  }
};
```

## agent-tool/js/llm.js

- sha256: `74e1679198f51e1e5cc449bcc2a1c5214bf1564d455d7c0a186b74015ee08fe0`
- lines: 113
- 说明: 独立 agent-tool 原型的 LLM 调用封装，systemPrompt 注入方式。

```javascript
const LLM = {
  async ping(agentId) {
    const cfg = State.resolveAgentConfig(agentId);
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(location.origin + '/proxy/pi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          provider: cfg.piProvider,
          model: cfg.piModel,
          stream: false,
          max_tokens: 4
        }),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const ms = Math.round(performance.now() - t0);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 160)}`);
    }
    const data = await resp.json().catch(() => ({}));
    const reply = data?.choices?.[0]?.message?.content ?? '';
    const model = data?.model || cfg.piModel || 'unknown';
    return { ms, model, endpoint: 'pi://' + cfg.piProvider, sample: String(reply).slice(0, 80) };
  },

  async chat(messages, { agentId, onChunk, onDone, onError, onMeta, signal } = {}) {
    const cfg = State.resolveAgentConfig(agentId);
    console.log(`[LLM.chat] agentId=${agentId} piProvider=${cfg.piProvider} piModel=${cfg.piModel}`);

    const agentDef = AGENTS[agentId];
    const sysPrompt = (agentDef ? agentDef.systemPrompt : '') || '你是一位专业的商业地产深度研究分析师。';
    const fullMessages = [{ role: 'system', content: sysPrompt }, ...messages];

    try {
      const resp = await fetch(location.origin + '/proxy/pi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: fullMessages,
          provider: cfg.piProvider,
          model: cfg.piModel,
          stream: true
        }),
        signal
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`API ${resp.status}: ${errBody.slice(0, 200)}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      let usage = null;
      let stopped = false;
      let respModel = '';
      let traceId = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') { stopped = true; break; }

          try {
            const json = JSON.parse(payload);
            if (!respModel && json.model) respModel = json.model;
            if (!traceId && json.trace_id) traceId = json.trace_id;
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              if (onChunk) onChunk(delta);
            }
            if (json.usage) usage = json.usage;
            if (json.choices?.[0]?.finish_reason && usage) {
              stopped = true;
              break;
            }
          } catch (_) {}
        }
        if (stopped) break;
      }

      if (usage) State.addTokens(usage.total_tokens || 0);
      if (onMeta) onMeta({ model: respModel || cfg.piModel || 'unknown', traceId });
      if (onDone) onDone(full);

    } catch (err) {
      if (err.name === 'AbortError') return;
      if (onError) onError(err);
    }
  }
};
```

## agent-tool/js/websearch.js

- sha256: `af39220523a355056b91b65ea1322b81d7bfbf35d3c396ed28318bf3c06f3c50`
- lines: 178
- 说明: 独立 agent-tool 原型的 MiniMax websearch 调用、正文抓取、证据格式化。

```javascript
const WebSearch = {
  _clip(text, maxChars) {
    const s = String(text || '').trim();
    return s.length > maxChars ? s.slice(0, maxChars).replace(/\s+$/, '') + '...' : s;
  },

  _normalizeHost(apiHost) {
    let host = (apiHost || 'https://api.minimaxi.com/v1').trim().replace(/\/+$/, '');
    if (host.endsWith('/v1')) host = host.slice(0, -3);
    return host || 'https://api.minimaxi.com';
  },

  _normalizeResults(payload, maxResults, bodyMaxChars) {
    let items = [];
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && typeof payload === 'object') {
      items = payload.organic || payload.webpages || payload.results || payload.data || [];
      if (items && !Array.isArray(items) && typeof items === 'object') {
        items = items.results || items.organic || items.webpages || [];
      }
    }
    const out = [];
    for (const item of (items || []).slice(0, maxResults)) {
      if (!item || typeof item !== 'object') continue;
      let snippet = item.snippet || item.body || item.summary || '';
      const raw = item.content || item.rawContent || item.raw_content || '';
      if (raw) {
        const extra = String(raw).trim();
        if (extra && !snippet.includes(extra)) {
          snippet = snippet ? (snippet + '\n' + extra) : extra;
        }
      }
      if (bodyMaxChars > 0 && snippet.length > bodyMaxChars) {
        snippet = snippet.slice(0, bodyMaxChars).replace(/\s+$/, '') + '...';
      }
      out.push({
        title: item.title || item.name || '',
        body: snippet,
        href: item.link || item.url || item.href || ''
      });
    }
    return out;
  },

  async _minimaxSearch(query, { apiHost, apiKey, maxResults, timeoutSeconds, signal }) {
    if (!apiKey) throw new Error('未配置 MiniMax Search API Key');
    const upstream = this._normalizeHost(apiHost) + '/v1/coding_plan/search';
    const proxyUrl = location.origin + '/proxy/search';

    const ctrl = new AbortController();
    const externalSignal = signal;
    if (externalSignal) externalSignal.addEventListener('abort', () => ctrl.abort());
    const timer = setTimeout(() => ctrl.abort(), Math.max(3000, (timeoutSeconds || 30) * 1000));

    let resp;
    try {
      resp = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'X-Upstream-URL': upstream,
          'X-Upstream-Key': apiKey,
          'Content-Type': 'application/json',
          'MM-API-Source': 'DR-Agent-Workbench'
        },
        body: JSON.stringify({ q: query }),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`MiniMax Search HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (data && typeof data === 'object' && data.base_resp) {
      const br = data.base_resp;
      if (br.status_code !== undefined && br.status_code !== 0 && br.status_code !== null) {
        throw new Error(`MiniMax Search API Error: ${br.status_code}-${br.status_msg || ''}`);
      }
    }
    return this._normalizeResults(data, maxResults, 600);
  },

  async _fetchPage(url, { maxChars, signal }) {
    const resp = await fetch(location.origin + '/proxy/fetch-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, maxChars }),
      signal
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Fetch page HTTP ${resp.status}: ${txt.slice(0, 120)}`);
    }
    return resp.json();
  },

  async _enhanceResultsWithPages(items, cfg) {
    if (!cfg.pageFetchEnabled) return items;
    const topN = cfg.deepPageFetch ? 4 : 2;
    const maxChars = cfg.deepPageFetch ? 6000 : 3000;
    const targets = items.filter(it => it.href).slice(0, topN);

    await Promise.all(targets.map(async item => {
      try {
        const page = await this._fetchPage(item.href, { maxChars, signal: cfg.signal });
        if (!page.text) return;
        const title = page.title && !item.title ? page.title : item.title;
        item.title = title || item.title;
        const pageText = this._clip(page.text, 900);
        item.body = this._clip(`${item.body || ''}\n\n[网页正文摘录]\n${pageText}`, 1200);
        item.href = page.url || item.href;
        item.pageFetched = true;
      } catch (err) {
        item.pageFetchError = err.message;
      }
    }));

    return items;
  },

  async runQuery(query, opts = {}) {
    const ws = State.config.webSearch || {};
    const cfg = {
      apiHost: opts.apiHost || ws.apiHost || 'https://api.minimaxi.com/v1',
      apiKey:  opts.apiKey  || ws.apiKey,
      maxResults: opts.maxResults || ws.maxResults || 6,
      timeoutSeconds: opts.timeoutSeconds || ws.timeoutSeconds || 30,
      pageFetchEnabled: opts.pageFetchEnabled ?? ws.pageFetchEnabled ?? true,
      deepPageFetch: opts.deepPageFetch ?? ws.deepPageFetch ?? false,
      signal: opts.signal
    };
    const items = await this._minimaxSearch(query, cfg);
    return this._enhanceResultsWithPages(items, cfg);
  },

  async runQueries(queries, opts = {}) {
    const ws = State.config.webSearch || {};
    const maxQueries = opts.maxQueries || ws.maxQueries || 3;
    const used = (queries || []).filter(Boolean).slice(0, maxQueries);
    if (used.length === 0) return { results: [], errors: ['无有效检索词'] };

    const results = [];
    const errors = [];
    await Promise.all(used.map(async q => {
      try {
        const r = await this.runQuery(q, opts);
        results.push({ query: q, items: r });
      } catch (err) {
        if (err.name !== 'AbortError') {
          errors.push(`${q}: ${err.message}`);
        }
      }
    }));
    return { results, errors };
  },

  formatAsEvidence(searchResult) {
    if (!searchResult || !searchResult.results || searchResult.results.length === 0) {
      return '（无可用网络检索结果）';
    }
    const blocks = [];
    for (const group of searchResult.results) {
      const lines = [`### 检索: ${group.query}`];
      group.items.forEach((it, i) => {
        lines.push(`${i + 1}. **${it.title || '(无标题)'}**`);
        if (it.body) lines.push(`   - ${this._clip(it.body, 1200)}`);
        if (it.href) lines.push(`   - 来源: ${it.href}`);
      });
      blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
  }
};
```

## agent-tool/js/sample-data.js

- sha256: `070e4d995a05652d4b3b550bfa953bd92b55eac4a854574acddd76adfb4b11cc`
- lines: 125
- 说明: 独立 agent-tool 原型的 demo 回放样例阶段、消息、证据。

```javascript
const SAMPLE = {
  target: {
    name: '沈阳中海环宇城',
    address: '沈阳市和平区南京南街368号',
    type: 'mall',
    typeName: '区域型购物中心 (MALL)'
  },

  fullReportMd: null,

  stages: [
    {
      id: 'init',
      label: '项目初始化',
      agent: 'main',
      messages: [
        { role: 'main', text: '开始初始化研究项目...\n\n研究对象：**沈阳中海环宇城**\n地址：沈阳市和平区南京南街368号\n对象类型：**区域型购物中心 (MALL)**\n\n✅ 判断对象类型 → MALL\n✅ 选择研究模板 → `mall` 模板（9+1章节结构）\n✅ 初始化研究目录\n✅ 生成首稿骨架\n\n研究范围界定：长白岛板块全域（规划面积约10.84平方公里），兼顾跨区竞品分析。' },
        { role: 'system', text: '首稿骨架已生成。进入并行采证阶段，将同时启动区位客群和商业生态两路采集。' }
      ]
    },
    {
      id: 'research',
      label: '并行采证',
      agent: 'researcher',
      parallel: true,
      branches: [
        {
          name: '区位与客群',
          messages: [
            { role: 'researcher', text: '📍 **区位与客群采证** 启动\n\n正在搜索：长白岛区域规划、人口数据、交通条件、住宅分布...' },
            { role: 'researcher', text: '采集到关键证据：\n\n- <span class="evidence-tag grade-a">A级</span> 长白岛规划面积10.84平方公里，和平区重点发展综合性滨水新城区\n- <span class="evidence-tag grade-a">A级</span> 地铁9号线长白南站2019年开通，4号线覆盖\n- <span class="evidence-tag grade-a">A级</span> 长白街道常住人口100,658人（七普数据）\n- <span class="evidence-tag grade-a">A级</span> 和平区常住人口730,785人\n- <span class="evidence-tag grade-a">A级</span> 区域年龄结构：15-59岁主力占比63.86%\n- <span class="evidence-tag grade-b">B级</span> 中高端住宅为主（中海国际社区120万㎡、万科城100万㎡）\n- <span class="evidence-tag grade-b">B级</span> 二手房均价10,000-22,000元/㎡' }
          ],
          evidences: [
            { source: '百度百科「长白岛」', grade: 'A', body: '长白岛位于沈阳市城区南部、浑河南岸，规划面积约10.84平方公里，定位"和谐岛城"综合性滨水新城区。2025年更名为沈阳长白岛经济开发区。' },
            { source: '方舆-人口地理（七普）', grade: 'A', body: '长白街道常住人口100,658人（2020年），下辖11个社区。和平区常住人口730,785人。' },
            { source: '国家统计局/沈阳市统计局', grade: 'A', body: '和平区年龄结构：0-14岁占13.89%，15-59岁占63.86%，60岁以上占22.25%。' },
            { source: '吉屋网/安居客', grade: 'B', body: '中海国际社区120万㎡约10000户，二手房均价约21,181元/㎡；万科城100万㎡，约12,000元/㎡。' }
          ]
        },
        {
          name: '商业生态与竞品',
          messages: [
            { role: 'researcher', text: '🏬 **商业生态与竞品采证** 启动\n\n正在搜索：中海环宇城品牌信息、业态数据、竞品分析...' },
            { role: 'researcher', text: '采集到关键证据：\n\n- <span class="evidence-tag grade-a">A级</span> 购物中心16万㎡，综合体约42万㎡\n- <span class="evidence-tag grade-a">A级</span> 2023年1月13日正式开业\n- <span class="evidence-tag grade-a">A级</span> JERDE设计，退台式+下沉广场+地下地铁直连\n- <span class="evidence-tag grade-b">B级</span> 230+品牌，16家东北及沈阳首店\n- <span class="evidence-tag grade-b">B级</span> 主力店：山姆会员店（约6万㎡沈阳唯一）、奈尔宝（超4000㎡沈城首家）\n- <span class="evidence-tag grade-b">B级</span> 超13,000㎡亲子空间，签约率90%+\n- <span class="evidence-tag grade-a">A级</span> 长白万象汇约6万㎡，2020年开业' }
          ],
          evidences: [
            { source: '辽宁省官方新闻+中建集团官网', grade: 'A', body: '沈阳中海环宇城2023年1月13日正式开业，购物中心建筑面积16万㎡。' },
            { source: 'JERDE建筑官网', grade: 'A', body: 'JERDE操刀设计，退台式建筑+多个下沉广场+4号线/9号线地下直连。外立面以沈阳市花玫瑰为核心。' },
            { source: '北国网/中建官网', grade: 'B', body: '230+品牌，16家东北及沈阳首店。主力店：山姆会员店约6万㎡（沈阳唯一）、奈尔宝超4000㎡（沈城首家）。' },
            { source: '沈阳消费网+CRR', grade: 'A', body: '长白万象汇约6万㎡，2020年开业。开业首日客流超10万人，销售额1,731万元。会员超10万人。' }
          ]
        }
      ]
    },
    {
      id: 'write',
      label: '合并撰写',
      agent: 'writer',
      messages: [
        { role: 'writer', text: '✍️ **district-writer** 开始合并撰写\n\n基于两路采证证据，按照 MALL 模板9+1章节结构生成完整草稿...\n\n核心摘要 → 项目概况 → 区位条件 → 核心人群画像 → 商业生态 → 竞品分析 → SWOT → 策略建议 → 结论 → 附录' },
        { role: 'writer', text: '正在撰写 **核心摘要**：\n\n1. **定位判断**：区域型购物中心，2023年1月开业，16万㎡，地铁9号线+4号线地下直连\n2. **区位价值**：长白岛南部，和平区重点发展滨水新城区\n3. **客群底盘**：长白街道10万人，和平区73万人，15-59岁主力占比63.86%\n4. **商业生态**：230+品牌，16家首店，山姆+奈尔宝稀缺主力店\n5. **竞争格局**：体量大幅领先万象汇(16万vs6万)，但开业晚3年' },
        { role: 'writer', text: '正在撰写 **核心人群画像**...\n\n核心客群：30-45岁已婚家庭（子女3-12岁，月收入1.5-3万）\n次核心客群：25-35岁年轻家庭/新婚夫妻\n潜力客群：周边办公白领、跨区夜间消费客、银发健康客群\n\n典型画像：\n- 张小姐，31岁，写字楼白领，午间轻食\n- 李先生，38岁，家庭居民，周末亲子\n- 王阿姨，58岁，退休居民，早间生鲜' },
        { role: 'writer', text: '正在撰写 **商业生态深度分析** 和 **竞争格局**...\n\n业态结构：超市25-30% / 零售25-30% / 餐饮20-25% / 亲子10-15% / 娱乐5-10%\n\nvs 长白万象汇：体量16万vs6万 | 品牌230+vs近300 | 开业2023vs2020\n核心差异：场景差异化(退台/水系/空中花园) + 体量优势 + 亲子密度' },
        { role: 'system', text: '草稿撰写完成，进入质量评审阶段。' }
      ]
    },
    {
      id: 'review',
      label: '质量评审',
      agent: 'reviewer',
      messages: [
        { role: 'reviewer', text: '🔍 **district-reviewer** 开始质量评审\n\n逐项检查：证据充分性 / 推断与事实区分 / 估算口径 / 人群画像详尽度 / 竞品对比一致性 / 策略可执行性' },
        { role: 'reviewer', text: '评审发现以下问题：\n\n1. **竞品对比确定性过强**：部分对比数据标注为"确认"但来源仅为推断，需修正为"推断"并增加置信度列\n2. **策略缺少量化指标**：建议增加可量化的预期效果指标\n3. **推断标注不统一**：部分推断未显式标注推断性质和置信度\n4. **项目发展阶段判断缺数据支撑**：开业时间等核心节点需补强' },
        { role: 'reviewer', text: '**评审结论：<span class="review-verdict review-verdict--conditional">CONDITIONALLY_APPROVED</span>**\n\n需修复4项问题后可出终稿。' }
      ],
      review: {
        verdict: 'CONDITIONALLY_APPROVED',
        issues: [
          '竞品对比中确定性表述需修正，增加置信度列',
          '策略建议缺少量化预期效果',
          '推断标注不统一，需显式标注推断性质和置信度',
          '项目发展阶段判断缺数据支撑'
        ]
      }
    },
    {
      id: 'fix',
      label: '修复整合',
      agent: 'writer',
      messages: [
        { role: 'writer', text: '🔧 **district-writer** 根据评审意见修复\n\n✅ 修正竞品对比中的确定性表述 → 改为"推断"并增加置信度列\n✅ 策略建议增加量化指标（如"提升周末家庭客群占比至60%+"）\n✅ 统一推断标注格式\n✅ 补充项目发展阶段判断的推断依据' },
        { role: 'system', text: '修复完成。进入第二轮搜索补证阶段。' }
      ]
    },
    {
      id: 'supplement',
      label: '第二轮搜索补证',
      agent: 'researcher',
      messages: [
        { role: 'researcher', text: '🔎 **第二轮搜索补证** 启动\n\n针对原报告缺口进行定向搜索...\n\n缺口清单：开业时间 / 商业体量 / 品牌组合 / 人口底盘 / 竞品数据 / 建筑设计' },
        { role: 'researcher', text: '补齐结果：\n\n| 缺口 | 补齐结果 |\n|------|----------|\n| 开业时间 | ✅ 2023年1月13日正式开业 |\n| 商业体量 | ✅ 购物中心16万㎡，综合体约42万㎡ |\n| 品牌组合 | ✅ 230+品牌，16家首店 |\n| 人口底盘 | ✅ 长白街道常住人口100,658人 |\n| 竞品数据 | ✅ 长白万象汇约6万㎡、近300品牌 |\n| 建筑设计 | ✅ JERDE设计，退台式+下沉广场 |\n\n所有核心缺口已补齐，证据等级已升级。' },
        { role: 'system', text: '第二轮补证完成，证据已升级，报告已更新为终稿。' }
      ]
    },
    {
      id: 'final',
      label: '终稿输出',
      agent: 'main',
      messages: [
        { role: 'main', text: '📋 **终稿确认**\n\n✅ 报告9+1章节全部完成\n✅ A级证据15项 / B级证据8项 / 推断项已标注\n✅ 评审4项问题已修复\n✅ 第二轮补证6项缺口已补齐\n\n**报告摘要**：\n\n沈阳中海环宇城是长白岛南部"体量16万㎡+双地铁地下直连+沈阳唯一山姆+沈城首家奈尔宝"的区域型家庭购物中心，核心差异化在于JERDE退台式稀缺场景+亲子业态90%+签约率+夜经济街区。' },
        { role: 'system', text: '✅ 深度研究报告生成完毕。可在右侧预览区查看完整报告，或点击「导出 MD」/「导出 HTML」下载。' }
      ]
    }
  ]
};

(function loadReport() {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'sample-report.md', true);
  xhr.onload = function () {
    if (xhr.status === 200) SAMPLE.fullReportMd = xhr.responseText;
  };
  xhr.send();
})();
```

## agent-tool/server.py

- sha256: `aa24aff4fed176d834ee02395a6d9ee950083ada7cf412c67e24e688c7aa7563`
- lines: 532
- 说明: 独立 agent-tool 本地 server，提供 /proxy/pi、/proxy/search、/proxy/fetch-page。

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DR Agent Workbench 本地服务器
- 静态文件托管（同 python -m http.server 行为）
- /proxy/pi      调用本机 pi CLI（LLM 统一走 Pi）
- /proxy/search  透传网络搜索请求到上游 API（规避浏览器 CORS）

客户端约定（前端 fetch 时使用）：
- 调 LLM（Pi）：POST /proxy/pi
    Body  : {"messages":[...], "provider":"...", "model":"...", "stream":true}
- 调搜索：POST /proxy/search
    Header X-Upstream-URL : 完整搜索 URL
    Header X-Upstream-Key : Bearer token
    Body  : {"q":"..."}
- 抓网页正文：POST /proxy/fetch-page
    Body  : {"url":"https://...", "maxChars":3000}

Key 仅在内存中转发，不落盘、不打日志。
"""

import sys
import os
import json
import time
import shutil
import threading
import subprocess
import re
import html
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

PORT = int(os.environ.get("PORT", "8765"))
BIND = os.environ.get("BIND", "127.0.0.1")
ROOT = os.path.dirname(os.path.abspath(__file__))
PI_TRACE_LOG = os.path.join(ROOT, "pi_trace.jsonl")
_user_home = os.environ.get("USERPROFILE", os.path.expanduser("~"))
PI_MODELS_PATH = Path(_user_home) / ".pi" / "agent" / "models.json"

PROXY_TIMEOUT = 60  # 秒


def _append_pi_trace(record):
    """Append one pi invocation audit record without prompts or API keys."""
    try:
        with open(PI_TRACE_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _clean_cli_text(value):
    """Remove characters that cannot be passed safely through Windows CLI args."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    value = value.replace("\x00", "")
    return re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", " ", value)


def _resolve_pi_exe():
    """多策略查找 pi CLI，返回可直接 Popen 的列表 [node, cli.js] 或 [pi.cmd]。"""
    appdata = os.environ.get("APPDATA", "")
    cli_js = os.path.join(appdata, "npm", "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js") if appdata else ""
    if cli_js and os.path.isfile(cli_js):
        import shutil as _sh
        node_exe = _sh.which("node")
        if node_exe:
            return [node_exe, cli_js]
    for name in ("pi.cmd", "pi.exe", "pi.bat", "pi"):
        p = shutil.which(name)
        if p:
            return [p]
    return []


def _read_pi_models():
    """读取 Pi CLI models.json，返回 [{"provider":"...", "model":"...", "name":"..."}, ...]"""
    try:
        with open(PI_MODELS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    result = []
    for prov_name, prov_cfg in (data.get("providers") or {}).items():
        for m in (prov_cfg.get("models") or []):
            result.append({
                "provider": prov_name,
                "model": m.get("id", ""),
                "name": m.get("name", m.get("id", "")),
                "contextWindow": m.get("contextWindow", 0),
                "maxTokens": m.get("maxTokens", 0)
            })
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---- 静默常规访问日志，只打代理与错误 ----
    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/proxy/" in msg or " 5" in msg or " 4" in msg:
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), msg))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type,Authorization,X-Upstream-URL,X-Upstream-Key,MM-API-Source")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/pi-models":
            return self._json(200, _read_pi_models())
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/proxy/pi":
            return self._handle_pi()
        if path == "/proxy/search":
            return self._handle_proxy()
        if path == "/proxy/fetch-page":
            return self._handle_fetch_page()
        self.send_error(405, "Method Not Allowed")

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw or b"{}")
        except Exception:
            return None

    def _extract_page_text(self, raw, content_type):
        charset = ""
        m = re.search(r"charset=([\w\-]+)", content_type or "", re.I)
        if m:
            charset = m.group(1)

        text = ""
        for enc in (charset, "utf-8", "gb18030"):
            if not enc:
                continue
            try:
                text = raw.decode(enc, errors="ignore")
                break
            except Exception:
                pass
        if not text:
            text = raw.decode("utf-8", errors="ignore")

        title = ""
        mt = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        if mt:
            title = html.unescape(re.sub(r"\s+", " ", mt.group(1))).strip()

        text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<!--([\s\S]*?)-->", " ", text)
        text = re.sub(r"</?(p|br|div|section|article|h[1-6]|li|tr|td|th)[^>]*>", "\n", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html.unescape(text)
        text = _clean_cli_text(text)
        title = _clean_cli_text(title)
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r"\n\s*\n+", "\n", text)
        return title, text.strip()

    def _handle_fetch_page(self):
        body = self._read_json_body()
        if body is None:
            return self._json(400, {"error": "invalid JSON"})

        url = (body.get("url") or "").strip()
        max_chars = int(body.get("maxChars") or 3000)
        max_chars = max(500, min(max_chars, 12000))
        if not url.lower().startswith(("http://", "https://")):
            return self._json(400, {"error": "invalid url"})

        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DR-Agent-Workbench/1.0",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        }, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = resp.status
                final_url = resp.geturl()
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read(2 * 1024 * 1024)
        except urllib.error.HTTPError as e:
            return self._json(e.code, {"error": "fetch http error", "detail": str(e)})
        except urllib.error.URLError as e:
            return self._json(502, {"error": "fetch unreachable", "detail": str(e.reason)})
        except Exception as e:
            return self._json(500, {"error": "fetch error", "detail": str(e)})

        title, text = self._extract_page_text(raw, content_type)
        return self._json(200, {
            "url": final_url,
            "status": status,
            "title": title,
            "text": text[:max_chars],
            "truncated": len(text) > max_chars,
            "chars": min(len(text), max_chars)
        })

    # ---------- 代理核心 ----------
    def _handle_proxy(self):
        upstream_url = self.headers.get("X-Upstream-URL", "").strip()
        upstream_key = self.headers.get("X-Upstream-Key", "").strip()
        mm_source = self.headers.get("MM-API-Source", "DR-Agent-Workbench")

        if not upstream_url:
            return self._json(400, {"error": "missing X-Upstream-URL header"})
        if not upstream_url.lower().startswith(("http://", "https://")):
            return self._json(400, {"error": "invalid X-Upstream-URL"})

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""

        req_headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            "Accept": self.headers.get("Accept", "*/*"),
        }
        if upstream_key:
            req_headers["Authorization"] = "Bearer " + upstream_key
        if mm_source:
            req_headers["MM-API-Source"] = mm_source

        req = urllib.request.Request(upstream_url, data=body, headers=req_headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as resp:
                status = resp.status
                ct = resp.headers.get("Content-Type", "application/octet-stream")
                data = resp.read()
        except urllib.error.HTTPError as e:
            status = e.code
            ct = e.headers.get("Content-Type", "text/plain") if e.headers else "text/plain"
            try:
                data = e.read()
            except Exception:
                data = str(e).encode("utf-8")
        except urllib.error.URLError as e:
            return self._json(502, {"error": "upstream unreachable", "detail": str(e.reason)})
        except Exception as e:
            return self._json(500, {"error": "proxy error", "detail": str(e)})

        # 透传响应体；强制同源 CORS
        self.send_response(status)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---------- pi-agent 代理 ----------
    def _handle_pi(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw)
        except Exception:
            return self._json(400, {"error": "invalid JSON"})

        messages = body.get("messages", [])
        provider = _clean_cli_text(body.get("provider", ""))
        model = _clean_cli_text(body.get("model", ""))
        stream = body.get("stream", True)
        max_tokens = body.get("max_tokens", 0)
        trace_id = "pi-%d-%d" % (int(time.time() * 1000), threading.get_ident())
        trace = {
            "trace_id": trace_id,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "provider_requested": provider,
            "model_requested": model,
            "stream": bool(stream),
            "max_tokens": max_tokens,
            "message_count": len(messages),
            "system_chars": 0,
            "user_chars": 0,
            "pid": None,
            "model_returned": None,
            "usage": None,
            "response_ids": [],
            "event_count": 0,
            "text_delta_count": 0,
            "tool_call_seen": False,
            "exit_code": None,
            "stderr_tail": "",
            "errors": []
        }

        if not messages:
            return self._json(400, {"error": "messages is empty"})

        # 拆分 messages: system → --system-prompt (替换默认 coding prompt), user → 位置参数
        system_parts = []
        user_prompt = ""
        for m in messages:
            role = m.get("role", "user")
            raw_content = m.get("content", "")
            content = raw_content
            if isinstance(content, list):
                content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
            content = _clean_cli_text(content)
            if "\x00" in str(raw_content):
                trace["nul_removed"] = True
            if role == "system":
                system_parts.append(content)
                trace["system_chars"] += len(content)
            else:
                user_prompt = content
                trace["user_chars"] = len(content)

        pi_parts = _resolve_pi_exe()
        if not pi_parts:
            return self._json(503, {
                "error": "pi CLI not found",
                "hint": "tried PATH and %APPDATA%\\npm; install with: npm i -g @mariozechner/pi-coding-agent"
            })

        cmd = pi_parts + ["--print", "--no-tools", "--no-session", "--mode", "json"]
        if provider:
            cmd += ["--provider", provider]
        if model:
            cmd += ["--model", model]
        if system_parts:
            pi_override = "IMPORTANT: You are in pure chat mode. Do NOT ask clarifying questions. Do NOT create files or projects. Do NOT use any tools. Respond directly with your answer in Chinese."
            cmd += ["--system-prompt", pi_override + "\n\n" + "\n\n".join(system_parts)]
        cmd.append(user_prompt or " ")

        sse_id = "chatcmpl-pi-%d" % int(time.time() * 1000)
        stream_started = False

        def ensure_sse_headers():
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

        def sse(event, data):
            chunk = "event: %s\ndata: %s\n\n" % (event, json.dumps(data, ensure_ascii=False))
            try:
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
            except Exception:
                pass

        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL, cwd=ROOT
            )
            trace["pid"] = proc.pid
        except Exception as e:
            trace["errors"].append("failed to start pi: " + str(e))
            _append_pi_trace(trace)
            return self._json(500, {"error": "failed to start pi", "detail": str(e)})

        full_text = ""
        model_name = model or "pi"
        usage_info = None
        stop_reason = "stop"

        for raw_line in proc.stdout:
            try:
                line = raw_line.decode("utf-8", errors="replace").strip()
            except Exception:
                continue
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            trace["event_count"] += 1

            etype = ev.get("type", "")

            if etype == "message_end":
                msg = ev.get("message", {})
                model_name = msg.get("model") or model_name
                trace["model_returned"] = model_name
                response_id = msg.get("responseId") or msg.get("response_id")
                if response_id and response_id not in trace["response_ids"]:
                    trace["response_ids"].append(response_id)
                err_msg = msg.get("errorMessage") or msg.get("error")
                if err_msg:
                    trace["errors"].append(str(err_msg))
                u = msg.get("usage")
                if u:
                    usage_info = {
                        "prompt_tokens": u.get("input", 0),
                        "completion_tokens": u.get("output", 0),
                        "total_tokens": u.get("totalTokens", 0)
                    }
                    trace["usage"] = usage_info
                content_text = ""
                c = msg.get("content")
                if isinstance(c, list):
                    content_text = "".join(
                        x.get("text", "") for x in c
                        if isinstance(x, dict) and x.get("type") == "text"
                    )
                elif isinstance(c, str):
                    content_text = c
                if content_text:
                    full_text = content_text

            elif etype == "message_update":
                ame = ev.get("assistantMessageEvent", {})
                sub = ame.get("type", "")
                if sub == "text_delta":
                    trace["text_delta_count"] += 1
                    delta = ame.get("delta", "")
                    full_text += delta
                    if stream:
                        if not stream_started:
                            ensure_sse_headers()
                            stream_started = True
                        sse("delta", {
                            "id": sse_id,
                            "object": "chat.completion.chunk",
                            "model": model_name,
                            "choices": [{"index": 0, "delta": {"content": delta}, "finish_reason": None}]
                        })
                msg2 = ame.get("message", {})
                m2 = msg2.get("model")
                if m2:
                    model_name = m2
                    trace["model_returned"] = model_name
                response_id2 = msg2.get("responseId") or msg2.get("response_id")
                if response_id2 and response_id2 not in trace["response_ids"]:
                    trace["response_ids"].append(response_id2)
                u2 = msg2.get("usage")
                if u2 and u2.get("totalTokens"):
                    usage_info = {
                        "prompt_tokens": u2.get("input", 0),
                        "completion_tokens": u2.get("output", 0),
                        "total_tokens": u2.get("totalTokens", 0)
                    }
                    trace["usage"] = usage_info

            elif etype == "tool_call":
                trace["tool_call_seen"] = True
                proc.terminate()
                break

        try:
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                pass
        trace["exit_code"] = proc.returncode
        try:
            stderr_text = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
            trace["stderr_tail"] = stderr_text[-1000:]
            if stderr_text:
                trace["errors"].append("stderr: " + stderr_text[-300:])
        except Exception:
            pass
        trace["model_returned"] = model_name
        if usage_info and not trace["usage"]:
            trace["usage"] = usage_info
        _append_pi_trace(trace)

        if stream:
            if not stream_started:
                ensure_sse_headers()
            sse("delta", {
                "id": sse_id,
                "object": "chat.completion.chunk",
                "model": model_name,
                "trace_id": trace_id,
                "usage": usage_info,
                "choices": [{"index": 0, "delta": {}, "finish_reason": stop_reason}]
            })
            # 发送 [DONE] 标记，与 OpenAI SSE 协议一致
            try:
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except Exception:
                pass
        else:
            self._json(200, {
                "id": sse_id,
                "object": "chat.completion",
                "model": model_name,
                "trace_id": trace_id,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": full_text}, "finish_reason": stop_reason}],
                "usage": usage_info or {}
            })


    def _json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def main():
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    sys.stderr.write("DR Agent Workbench server running at http://%s:%d/  (Ctrl+C to stop)\n" % (BIND, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("shutting down\n")
        httpd.server_close()


if __name__ == "__main__":
    main()
```

## .pi/skills/xanthil-extraction-tools/SKILL.md

- sha256: `50aace627c27f80fa5607284d6fc49ab34557d77ef94c2055fe1a7c6287d0a16`
- lines: 49
- 说明: flow 注入的本地 skill，用于 Xanthil ExtractionTool bridge。

```markdown
---
name: xanthil-extraction-tools
description: Use local Xanthil ExtractionTool tools for data-analysis chat. Only registered clean_data paths may be used.
---
<!-- xanthil-generated-extraction-tool-skill -->

# Xanthil ExtractionTool Bridge

Use this skill when the user asks pi to run a local data-analysis ExtractionTool during ChatPane data analysis.

## Contract

- Tools are exposed through the workspace MCP server as tool names matching the ExtractionTool id.
- The required input key is `cleanDataPath`.
- `cleanDataPath` must be an absolute path from the workspace registered `clean_data` list.
- Never use `draw_data`, raw detail files, copied raw content, column samples, or unregistered paths.
- Pass only paths and scalar parameters to tools. Do not paste data contents into the prompt.
- Tool results may include `runId`, `success`, `failed`, `results[].outputs`, `stdout`, and `stderr`.
- Summarize the tool result for the user and cite output file paths when the tool created artifacts.
- If a tool rejects the input as non-`clean_data`, stop and ask the user to register an allowed aggregate file.

## Registered Tools

- aarrr-flow: AARRR 关系流转分析. 对阶段人数时序做 AARRR / 消费者关系阶段流转分析。期望 CSV 列: period（或 date / week / 期数）+ 至少两个阶段人数列。可识别别名 (大小写+中文): awareness/认知, interest/兴趣, consideration/考虑, purchase/购买/转化, loyalty/忠诚/复购, advocacy/推荐 等；上游也可直接用 stage1..stageN 兜底。算法：(1) 每期阶段间转化率 = 后阶段人数 / 前阶段人数；(2) 关系周加深率 = 末阶段人数 / 首阶段人数；(3) 期间环比变化（每期相对上一期同阶段人数变化）。输出漏斗、分期转化矩阵、整段关系加深曲线 markdown + json。
- apparel-structure: 服饰商品结构分析. 对服饰类商品/SKU 聚合 CSV 进行商品结构分析，包含价格带分桶分布、连带率(UPT)、动销率、售罄率、库销比、SKU 宽深度等指标，输出结构化 Markdown 报告和 JSON 数据。输入数据需包含商品 SKU 级别的价格、吊牌价、销量、库存、入库等字段。 Parameters: price_bands: 价格带区间，逗号分隔; inventory_window_days: 计算库销比时使用的时间窗口（天），用于将累计销量折算为日均销量.
- audience-cluster: 人群分簇. 基于业务规则的电商单品画像人群分簇工具（GenZ、成熟人群等） Parameters: top100_xlsx: 包含商品ID、名称及GMV等指标的总表路径; genz_a_min: A_GenZ主导簇的下限; genz_b_min: B_年轻白领簇的下限; mature_d_min: D_成熟偏好簇的下限; male_keyword: 匹配为 E_男装独立款.
- calculate-similarity: 号货匹配度计算. 批量计算商品人群与账号人群的匹配度 Parameters: account_file required: 账号基准人群文件路径 (CSV格式).
- churn-risk: 会员流失预警 (Kaplan-Meier + 风险打分). 客户级流失风险预警。期望客户级 RFM CSV，列（含别名）：customer_id；recency（自上次购买至截止日的天数，距今天数口径）；frequency（历史购买次数）；monetary（累计或均额，可选）。算法：(1) Kaplan-Meier 估计基于 churn_threshold_days 的群体存活函数；(2) 个体风险 = (1 - S(recency)) × 0.7 + 频次/金额劣势分位 × 0.3；(3) 按分位分四层 低/中/高/极高风险。纯 numpy/scipy 实现，无 lifelines 依赖。输出聚合分层规模与 top 高风险客户表（仅含脱敏 customer_id 占位）。 Parameters: churn_threshold_days: recency > 此值视为已流失（用于 KM 事件标注）; top_n: 高风险客户列表保留前 N 条.
- clustering: 数值特征聚类分群 (K-means + 轮廓). 对实体级数值特征表做无监督聚类。期望 CSV 第 1 列为实体 id（自动识别 customer_id/user_id/sku/entity_id 等别名，识别失败则取首列），其余所有数值列作为特征；非数值列自动忽略。算法：z-score 标准化 → k 在 [k_min, k_max] 区间用纯 numpy K-means(k-means++ 初始化, 多次重启) 拟合 → 用肘部 (相邻 k 间 SSE 改善率) 与轮廓系数 (silhouette, 抽样上限 1500) 综合选 k → 输出群标签 + 各群规模 + 各群标准化空间均值画像 + 原始空间均值画像。纯 numpy 实现，无 sklearn 依赖。 Parameters: k_min: 搜索 k 的下界 (>=2); k_max: 搜索 k 的上界 (<=20); n_init: 每个 k 的随机重启次数; max_iter: 单次 K-means 最大迭代步数; random_state: 保证可复现.
- clv-prediction: 客户终身价值预测 (BG/NBD + Gamma-Gamma). 基于 BG/NBD（期望交易数）+ Gamma-Gamma（客单价）模型预测客户终身价值（CLV）。期望客户级 RFM-T CSV，列（含别名）: customer_id；frequency（重复购买次数，BG/NBD 口径，首单不计入）；recency（首购到末购的间隔天数）；T（观察期/客户年龄，从首购到截止日的天数）；monetary（客户均订单金额，仅在 frequency>0 时有效）。算法：scipy.optimize 极大似然拟合 BG/NBD 与 Gamma-Gamma；输出每客户预测期内期望交易数、预测客单价、CLV，并按分位数分四层（高/中/低/沉睡）。无需 lifetimes 第三方库。 Parameters: horizon_days: 向前预测的天数，默认 365 天; discount_rate: 年化贴现率（0-1），0 表示不贴现.
- cohort-retention: 同期群留存/复购分析. 事件级 cohort 留存分析。期望 CSV 为事件/期级表（同一 customer_id 多行），列（含别名）: customer_id；purchase_date（或 order_date/event_date/购买日期/下单日期）。⚠ 粒度要求：每位客户必须有 ≥1 行，且总行数显著大于客户数（即存在重复购买记录），否则报错。算法：按首购期分 cohort → 留存率三角矩阵（cohort × periodOffset），可选 weekly/monthly 粒度，默认 monthly。输出留存矩阵、cohort 规模、整体留存曲线 (period 0..N 平均留存率) 与 markdown 表格。 Parameters: granularity: cohort 划分粒度，默认按月; max_periods: 矩阵最多展示的 period offset 数（含 period 0），默认 12.
- duckdb-aggregate: DuckDB SQL 聚合查询. 在服务端 DuckDB 实例中对 CSV/TSV/Parquet/JSON/JSONL 数据执行只读 SELECT 聚合 SQL。输入文件或目录会注册为 input_data 视图，SQL 必须输出聚合结果，不得输出原始明细行。 Parameters: sql required: 只读 SELECT 查询。输入数据视图名固定为 input_data；必须输出聚合结果，禁止明细行。.
- extract-labels: 动态提取标签. 支持批量处理文件夹，自动按条件提取占比和TGI
- extract-sycm-member: 提取生意参谋会员分析. 从生意参谋『会员分析』导出的 HTML 文件中提取 AI 诊断、核心指标看板、会员资产结构、复购概览与复购商品 TOP 排行，输出排版优化的 Markdown 与结构化 JSON。
- extract-tmall-profile: 提取天猫人群画像. 从天猫数据银行 HTML 文件中提取人群画像，按标签规则输出 Markdown 和 JSON。
- extract-xhs-insight: 提取小红书灵犀人群画像. 从小红书灵犀人群画像导出的 HTML 文件中提取 AI 解读与结构化标签（性别、年龄、地域、城市等级、消费特征、兴趣类目、关键词、博主偏好、生活方式等），输出 Markdown 和 JSON。
- generate-summary-table: 横向单品优质特征汇总宽表. 将提取的长表转换为横向单品优质特征汇总宽表（取占比与TGI的交集）
- market-basket: 购物篮关联规则分析 (Apriori). 对订单-商品级 CSV 做购物篮分析。期望列（含别名）: order_id（或 order/transaction_id/订单号）；item（或 sku/product_id/商品/商品ID/商品名称）。支持两种粒度: (a) 每行一条 order×item 长表; (b) 每行一个 order_id + items 列（逗号/分号/竖线分隔的商品列表）。算法：Apriori 频繁项集 + 关联规则 (support / confidence / lift)，纯 pandas/numpy 实现，无 mlxtend 依赖。输出 top-N 频繁项集与按 lift 排序的 top-N 关联规则（聚合衍生产物，不含原始订单行）。 Parameters: min_support: 频繁项集最小支持度 (0-1)，默认 0.02; min_confidence: 关联规则最小置信度 (0-1)，默认 0.3; max_len: 频繁项集最大长度 (>=2)，默认 3; top_n: 频繁项集与规则各保留前 N 条，默认 30.
- md5-format-converter: MD5平台格式转换工具. MD5平台格式转换工具 - 自动注册
- member-portrait-analysis: 会员人群画像分析. 会员人群画像分析 - 自动注册
- member-purchase-analysis: 会员购买商品分析. 会员购买商品分析 - 自动注册
- merge-and-extract: 合并与提取工具. 合并与提取工具 - 自动注册
- multi-platform-portrait-extract: 多平台人群画像核心数据提取. 多平台人群画像核心数据提取 - 自动注册
- old-customer-extractor: 老客提取工具. 老客提取工具 - 自动注册
- phone-cleaner: 会员手机号清洗与人群包导出. 批量读取 Excel/CSV 中的会员手机号，清洗去重后生成小红书、天猫和京东、抖音三种营销平台的人群包文件（含 MD5 加密）。原始明细不会发送到 LLM。
- rfm-segmentation: RFM 会员分群. 对客户级去标识聚合 CSV 进行 RFM 分群。期望列（含别名）: customer_id（或 顾客ID/用户ID/member_id）、recency（或 最近购买日期/last_purchase_date/recency_days，日期会换算为距今天数）、frequency（或 购买频次/购买次数/orders）、monetary（或 累计金额/总消费/amount/sales）。算法：每维 5 分位打分（1=最差,5=最佳，R 反向）→ 经典 8 群（重要价值/重要发展/重要保持/重要挽留/一般价值/一般发展/一般保持/一般挽留）。输出群规模/占比/各维均值与画像 md+json。 Parameters: reference_date: 若 recency 列为日期，按该日计算 recency_days；空则取数据中最大日期。格式 YYYY-MM-DD。.
- seasonal-forecast: 季节性分解与预测. 对时序聚合 CSV（日期+指标）进行 STL 季节分解（趋势/季节/残差分量）和 Holt-Winters 指数平滑预测，输出下 N 期预测值及 95% 置信区间。特别适用于服饰等强季节性品类的销售、流量或其他 KPI 预测。输入文件需包含日期列和指标列。 Parameters: seasonal_period: 季节周期长度（天/周/月），默认 7 表示按周; forecast_horizon: 向前预测的期数.
- store-member-operation-analysis: 门店会员运营分析. 门店会员运营分析 - 自动注册
```
