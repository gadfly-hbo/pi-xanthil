# 探索模块 操作手册

> 「探索」是 pi-Xanthil 的主分析入口，覆盖**从需求到行动**的完整链路：定义业务问题 → 准备数据 → 自由探索 → 与 AI 协作分析 → 输出报告 → 审核与汇报 → 沉淀策略与行动。
>
> 本文按二级 tab 的真实使用顺序讲解每个 tab 的功能、典型操作与样例，配合走完一遍即可掌握全模块。

---

## 0. 总览

进入路径：顶部主导航选中「**探索**」（`activeTab === "explore"`）。

二级 tab 共 10 个，按完整工作流顺序排列：

| # | 二级 tab | 一句话定位 | 与 LLM 关系 |
|---|---|---|---|
| 1 | **业务需求** | 把模糊的业务问题结构化为可分析的需求文档 | 调用 LLM 抽取结构化字段 |
| 2 | **原始数据** | 登记 / 浏览 `draw_data` 文件路径（红线域） | 文件名/结构可读，**原始行禁入 LLM** |
| 3 | **聚合数据** | 登记 / 浏览 `clean_data` 文件路径 | 允许进 LLM，UI 有琥珀色提示 |
| 4 | **数据探索** | 浏览器内拖拽式 BI（DuckDB-WASM） | **永久禁止** LLM 调用 |
| 5 | **数据分析** | 与 AI 对话进行分析，左侧附 `clean_data` 只读文档 | 主对话区，全 LLM |
| 6 | **报告输出** | 登记 / 浏览 `report` 输出目录 | 衍生产物，可读 |
| 7 | **汇报版本** | 把详细报告精炼为汇报版 + 故事线 | LLM 改写 |
| 8 | **报告审核** | 多模型对报告打分 + 给出修改建议 + 自动修复 | LLM 评审 |
| 9 | **黄金策** | 用商业框架（决策树/TOC/SWOT…）生成策略图 | 多模型并行 |
| 10 | **行动** | 把报告中的建议拆为可执行 action item | LLM + 任务管理 |

> ⚠️ 数据安全分级见 `AGENTS.md §一`。「数据探索」tab 严禁触发任何 LLM 调用，**这是项目的核心安全契约**。

---

## 1. 业务需求（`business_requirement`）

### 功能

- 通过表单字段（项目名、业务背景、业务目标、业务问题、决策场景、相关方、已知数据、约束、产出偏好、补充提示词）填入业务上下文。
- 可挂接「业务需求源文档」（来自 workspace 路径或本地路径），让模型阅读已有 PRD/调研材料。
- 点击「生成」后，LLM 输出**结构化业务需求**：业务事实、推断需求、分析问题、关键指标定义、维度、数据需求清单（含字段与优先级 P0/P1/P2）、未解问题、风险点。
- 字段级**来源引用**（`sourceRefs`）：每个推断都附带原文 quote，最小闭环可追溯。
- 历史版本管理：每次生成自动归档为 `RequirementVersion`，可回滚。
- **单向跳转能力**：在「数据需求」中点击字段名，会带 `fieldHints`（仅字段名，不带数据）跳到「数据探索」做字段验证。

### 典型操作

1. 在表单填写最少必填项（项目名 + 业务背景 + 业务目标）。
2. 可选：挂接 1~3 份背景材料（如 `clean_data/` 中的口径说明、PRD）。
3. 点「生成业务需求文档」，等待 30~60s。
4. 审视产出，对 `dataNeeds[].fields` 中的字段名点击，跳到「数据探索」。

### 案例：电商月度复盘

```
项目名：2025-Q4 复购率下滑归因
业务背景：双 11 后 30 天复购率从 28% 跌到 19%，需要在 12 月底前给出原因与对策。
业务目标：定位下滑的主驱动因子，量化贡献度，输出可执行干预方案。
业务问题：哪些品类/客群/渠道贡献了下滑？是否与价格策略变动相关？
```

点击生成后，LLM 输出（节选）：

- `metrics`：复购率 = 30 日内重复下单用户数 / 首购用户数
- `dataNeeds[0]`：订单明细（字段 `user_id, order_time, sku_id, channel, price, gmv`，P0）
- `dataNeeds[1]`：用户标签（字段 `user_id, segment, registered_at`，P1）
- `analysisQuestions`：① 渠道维度对比 ② 价格分桶下沉变化 ③ 新老客拆分

随后点击 `channel` 跳到「数据探索」，自动高亮已加载表中的同名字段，进入字段维度的探索。

---

## 2. 原始数据（`draw_data`） 🔴

### 功能

- 添加文件 / 文件夹路径到 workspace（**仅登记路径，不复制文件**）。
- 支持本地路径粘贴和系统选择器拾取。
- 浏览目录树，点击 markdown 可在右侧预览。
- 红线域标识：UI 有 `ShieldAlert` 提示，原始行级数据禁止进 LLM。
- 一键将路径复制为 `{{input.data_path}}` 等占位符（用于工作流参数化）。

### 操作步骤

1. 点「+ 添加文件」或「+ 添加文件夹」。
2. 粘贴绝对路径或用文件选择器。
3. 确认登记后，目录树展开浏览。
4. **不要**在 ChatPane 把整个 csv 内容粘进去——这等同于绕过红线。

### 案例

登记 `/Users/me/data/orders_2025q4.csv`。表头预览只在前端展示，**不会进 LLM**；后续在「数据探索」tab 里加载它做剖析。如果要让 AI 看明细，需要先用注册工具（`/api/extraction-tools/:id/run`）做聚合，把产物落到 `clean_data/`。

---

## 3. 聚合数据（`clean_data`） 🟡

### 功能

- 与「原始数据」相同的目录管理 UI，但 folder 维度不同。
- 用于登记**聚合后**的数据/文档：透视表、KPI 看板、字段口径说明、数据字典。
- 允许 LLM 读取，UI 有 `CircleAlert` 琥珀色提示「此数据将被 AI 读取」。
- 在「数据分析」工作视图**左侧**会以只读文档竖栏自动展示该目录下的 markdown，便于复制原文。

### 操作步骤

1. 登记 `clean_data/` 路径。
2. 把口径文档（`字段口径.md`、`KPI 定义.md`）丢进去。
3. 切到「数据分析」tab，左栏自动列出这些 md，点击展开预览，一键复制到 ChatPane。

### 案例

`clean_data/复购口径.md` 写明「复购 = 同 user_id 在 30 日内 ≥2 单」。在 ChatPane 提问时不必重复粘贴定义，AI 通过路径访问；左栏文档供你随时核对，避免你和模型对口径产生分歧。

---

## 4. 数据探索（`data_exploration`） 🔒 永久无 LLM

> **核心安全契约**：本 tab 永久禁止任何 LLM 调用。所有计算在浏览器内 DuckDB-WASM 执行，server 端只流式提供二进制文件。

### 功能

- **加载文件**：从 `draw_data` 或 `clean_data` 拾取 csv/xlsx，浏览器端解析。
- **字段剖析**（`ProfileReport`）：每列的类型推断（`number / string / time / boolean`）、缺失率、唯一值数、Top-K 值、IQR 异常上下界。
- **拖拽 BI**（`ChartCanvas` + `ConfigPanel`）：拖字段到 X / Y / 颜色，选图表（bar / line / pie / scatter / heatmap）、聚合（sum/avg/count/min/max）、过滤、时间粒度、行数限制。
- **JOIN 构建器**（`JoinBuilder`）：浏览器内多表 inner/left join，得到衍生表。
- **多 sheet 支持**：xlsx 多 sheet 切换。
- **手动改字段类型**：剖析错时用 `kindOverrides` 覆盖。
- **业务需求 seed**：点击业务需求中字段名跳过来时，字段列表自动高亮匹配列，缺失列用 `Sparkles` 标记。

### 三视图

- **图表（chart）**：拖拽出图。
- **剖析（profile）**：表格展示每列剖析结果。
- **洞察（insights）**：纯算法洞察（相关性、IQR 异常、分布偏度），**不调用 LLM**。

### 案例

1. 在「业务需求」点击 `channel`，跳到本 tab。
2. 加载 `orders_2025q4.csv`，自动剖析。
3. 字段列表中 `channel` 高亮（seed 命中），`promo_code` 带 `Sparkles`（业务需求提到但表里没有，提醒补口径）。
4. 拖 `channel` 到 X 轴，`gmv` 到 Y 轴，聚合 `sum`，过滤 `order_time >= 2025-12-01`。
5. 切到「洞察」视图，看到 `channel=直播` 在过滤期 GMV 同比下降 38%，为后续对话提供定性线索。

> 📌 校验本子树无 LLM 调用：
>
> ```bash
> grep -rE "(generate|chat|extract|clarify|sink|distill).*api\." \
>   web/src/components/DataExplorationPane.tsx \
>   web/src/components/data-exploration/
> # 应无任何匹配
> ```

---
## 5. 数据分析（`view`，工作视图）

### 功能

- **主对话区**（`ChatPane`）：与 AI 协作完成分析任务。
- 顶部模型选择器（按 provider 分组）。
- **左侧**：`CleanDataDocsColumn`（只读 `clean_data` 文档竖栏，可折叠）。
- **右侧**：`PreviewPane`，预览 LLM 生成的报告/HTML 产物，可折叠。
- 工具栏能力：
  - **Skill 选择器**：注入指定技能（如 `consumer-insight-analyst`、`audience-trend-analyst`）。
  - **业务需求上下文**：把当前 session 关联的需求文档一键作为系统上下文注入对话。
  - **Fork 分支**：从某条消息分叉新 session 探索另一假设。
  - **Delegate Sub-Agent**：派发子任务给独立 agent。
  - **Manual Analysis Tool**：触发「人工分析工具卡」（清洗 / 指标计算 / RFM / market-basket / churn-risk / clustering / aarrr-flow 等注册工具，由 `/api/extraction-tools/:id/run` 执行，产物聚合后才回灌 LLM）。
- **运行时**：右上 token / 上下文余量；过载时一键 `compactContext()` 压缩历史。
- **沉淀**：完成任务后可「沉淀为工作流」（参数化路径）或「沉淀 skill」（提炼 SKILL.md）。

### 操作步骤

1. 顶部选择模型（推荐与任务匹配：长文本用 `glm-4.6` / `claude-sonnet`，结构化抽取用 `minimax-m3`）。
2. 在工具栏选择 1~3 个 Skill（避免冲突）。
3. 下拉「业务需求」选已生成的版本，自动注入背景。
4. 输入分析问题，回车发送。AI 会调用工具（`run-extraction-tool`、`read-clean-data`）产出 markdown 报告，落到 `report/` 路径。
5. 右侧 `PreviewPane` 实时预览生成的报告。

### 案例

接续第 1 节的复购下滑案例，在 ChatPane 输入：

> 基于已挂接的业务需求和 `clean_data/复购口径.md`，先调用 `customer-touch-order-matching` 工具把触达表与订单匹配，再用 `churn-risk` 输出风险分层；生成《2025-Q4 复购下滑归因报告 v1》md 落到 `report/`。

AI 流程：

1. 调 `customer-touch-order-matching` → 输出匹配明细（聚合层，落 `clean_data/touched_orders.csv`）。
2. 调 `churn-risk` → 4 层风险分层（低/中/高/极高）+ KM 存活曲线。
3. 拼接洞察 → markdown，写入 `report/2025-Q4-复购下滑归因-v1.md`。
4. 右侧自动预览。

---

## 6. 报告输出（`report`）

### 功能

- 与 `draw_data` / `clean_data` 同款目录管理 UI，folder = `report`。
- 默认行为：未显式登记时，AI 把报告写到「最近加载的数据源所在目录」。
- 显式登记 `report/` 后，所有 LLM 产物（md / html / 图表 png）统一落入此目录。
- 内置「生成 HTML」按钮：把 md 报告一键转换为可分享的 html（自带样式 + 目录）。

### 操作步骤

1. 登记 `report/` 目录（如 `/Users/me/projects/q4-recall/report/`）。
2. 在「数据分析」tab 让 AI 写报告，自动落入此目录。
3. 在本 tab 浏览历史报告，预览 md 内容。
4. 选某份 md → 点「生成 HTML」→ 得到 `*.html`，可发邮件 / 投屏。

### 案例

`report/2025-Q4-复购下滑归因-v1.md` 已生成。点击预览查看；点「生成 HTML」得到 `2025-Q4-复购下滑归因-v1.html`，发给业务方。下一轮迭代由「报告审核」与「汇报版本」继续处理。

---
## 7. 汇报版本（`presentation_version`）

### 功能

- 选择一份原详细报告（来自 `report/`）。
- 用默认或自定义 prompt 让 LLM 输出**汇报版**（更短、保留核心结论 / 数据 / 风险 / 下一步）。
- 同时生成**故事线**（HTML，按"背景 → 发现 → 结论 → 行动"的演讲叙事顺序）。
- 双视图切换：汇报版 markdown ↔ 故事线 HTML。
- 自动落档到 `presentation_versions/` 目录。

### 操作步骤

1. 选择源报告（`*.md`）。
2. 可选：编辑 prompt（默认强调"保留核心 + 简化语言"）。
3. 关联业务需求版本（让模型校验关键问题是否被回应）。
4. 点「生成」→ 等 30~60s。
5. 切换"汇报版 / 故事线"两视图审阅。

### 案例

源：`report/2025-Q4-复购下滑归因-v1.md`（约 4000 字）。
生成结果：

- 汇报版（约 1200 字）：去掉中间过程，留下"核心结论 + 三大归因 + 量化贡献 + 五条干预动作 + 风险提示"。
- 故事线 HTML：分 6 屏 ——「双 11 后我们丢了 9% 的复购率」→「三个真凶」→「价格策略变化贡献 43%」→「直播渠道老客流失」→「我们要做什么」→「如果不做会怎样」。

直接拿故事线投屏汇报。

---

## 8. 报告审核（`report_review`）

### 功能

- 选择一份报告（来自 `report/`）让 LLM 评审：
  - **5 维度打分**（每维 X/10）：逻辑完整性、数据准确性、结论合理性、表达清晰度、行动指导性。
  - **综合分**（XX/50）。
  - **P0/P1/P2 修改建议**（带 quote 定位 + issue + suggestion + severity）。
  - **修改方向总结**。
- 多模型对比：勾选多个模型并行评审，看分歧点（不同模型在哪些维度看法不同 → 暴露报告真正薄弱处）。
- **自动修复**：基于 P0/P1 标注一键调用 LLM 改写，新版本落到 `report/` 自动归档。
- **diff 视图**：旧版 vs 新版 unified diff。
- **edit 视图**：手动二次编辑落档。
- **历史**：每次评审记录在本地，可回看。

### 操作步骤

1. 选源报告。
2. 勾选 1~3 个评审模型（推荐："严苛"模型 + "宽容"模型组合，看共识与分歧）。
3. 点「开始评审」。
4. 看 review / annotations / diff / edit 四个 tab。
5. 满意则点「自动修复 P0+P1」，得到 `*-v2.md`。
6. 切回「汇报版本」基于 v2 重新生成。

### 案例

`v1.md` 经评审：综合 36/50，最大问题是「价格分桶贡献度数据未给置信区间」（P0）和「干预动作①缺少负责人字段」（P1）。一键自动修复后得到 `v2.md`：综合 44/50，diff 视图显示新增了置信区间表与责任人列。

---
## 9. 黄金策（`golden_strategy`）

### 功能

- 选一份报告，让多个**商业框架模型**并行解构生成策略图（基于 `@xyflow/react`）：
  - **决策树**：拆决策因子 → 证据 → 结论建议
  - **TOC 约束理论**：主约束 → 根因链 → 五步法动作
  - **SWOT** / **PESTEL** / **Porter 五力** / **价值链** / **BCG 矩阵** / **Ansoff 矩阵** / **4P 营销** / **商业模式画布**
- 每次最多并行 3 个框架，得到 3 张策略图（可视化节点 + 边）。
- 系统会基于报告关键词自动**推荐**最契合的 1~2 个框架（关键词命中度排序）。
- 一键导航到「行动」tab，把策略落为 action item。

### 操作步骤

1. 选源报告。
2. 系统推荐框架已勾选，可手动改（最多 3 个）。
3. 选模型（默认 `minimax-cn/MiniMax-M3`）。
4. 点「生成策略图」→ 30~90s。
5. 在 ReactFlow 画布查看节点 / 关系 / 建议。
6. 点「导航到行动」，把策略卡传过去。

### 案例

报告关键词命中：『瓶颈』『卡点』→ 推荐 TOC；『竞争』『议价』→ 推荐 Porter 五力。

生成结果：

- **TOC 图**：主约束 = "高价值老客触达通道单一"；根因链 = 「直播 KOL 集中度↑ → 老客触达漂移 → 复购意向流失」；五步法动作 = ①识别 ②挖掘 ③依从 ④提升 ⑤循环。
- **Porter 五力图**：买方议价↑（替代品多）；新进入者→中（私域门槛）→ 战略建议侧重私域加固。

---

## 10. 行动（`actions`）

### 功能

- 选一份报告（或继承黄金策传来的策略卡）。
- LLM 拆解为**可执行 action items**：
  - 每条含：标题 / 目标 / 负责人占位 / 优先级 / 预估工时 / 验收标准 / 依赖。
  - 状态流：`draft → ready → running → done`。
- **Run**：把单条 action 触发为后台 task，执行结果回灌（如自动写脚本 / 调外部工具 / 出 SQL）。
- **Feedback**：执行完打分（成功 / 部分 / 失败 + 备注），沉淀为「失败记忆」/「项目记忆」（→ 规则记忆模块）。
- 与黄金策、报告审核闭环：审核出问题 → 黄金策给策略 → 行动给执行清单 → 反馈回写记忆。

### 操作步骤

1. 选源报告。
2. 点「拆解 action items」。
3. 逐条审视，编辑负责人 / 优先级。
4. 对可自动化的（如「跑 SQL 验证 X」），点 ▶ Run，等任务完成。
5. 给每条打反馈，提交后写入项目记忆。

### 案例

接续 v2 报告 + TOC 策略图，拆出 8 条 action：

| # | 标题 | 优先级 | 自动化 |
|---|---|---|---|
| 1 | 验证直播渠道复购同比 SQL | P0 | ▶ Run |
| 2 | 拉取价格策略变更日志 | P0 | ▶ Run |
| 3 | 设计私域召回 A/B 实验 | P1 | 手动 |
| 4 | 触达老客 SMS（A 组） | P1 | 手动 |
| 5 | 触达老客 EDM（B 组） | P1 | 手动 |
| 6 | 7 天后效果回收 | P0 | ▶ Run |
| 7 | 价格策略评审会议 | P1 | 手动 |
| 8 | 复盘并归档项目记忆 | P2 | 手动 |

action #1 / #2 / #6 由 AI 直接产出 SQL 并执行；其它由对应 owner 推进。完成后每条打反馈，正反例进入「规则记忆 → 项目记忆 / 失败记忆」。

---

## 端到端最佳实践流（电商复购下滑场景全链路）

> 以「Q4 复购下滑归因」为例，一次完整跑完探索模块所有 10 个 tab。

```
1. 业务需求           → 填项目背景 → 生成结构化需求 v1（拿到 dataNeeds.fields）
2. 原始数据           → 登记 orders_2025q4.csv / touch_list.csv（不进 LLM）
3. 聚合数据           → 写 复购口径.md / KPI 定义.md（允许进 LLM，左栏可见）
4. 数据探索           → 从业务需求点 channel 跳过来 → DuckDB 拖拽剖析 → 看到直播渠道异常
5. 数据分析（对话）   → 注入 Skill + 业务需求 → AI 调聚合工具 → 落 report/v1.md
6. 报告输出           → 浏览 v1.md，生成 HTML 发给业务方
7. 报告审核           → 多模型评审 36/50 → 自动修复 P0/P1 → 得到 v2.md（44/50）
8. 汇报版本           → 基于 v2 生成精简版 + 故事线 → 投屏汇报
9. 黄金策             → TOC + Porter 双图 → 主约束 = 老客触达通道单一
10. 行动              → 拆 8 条 action → 自动跑 3 条 SQL → 反馈回写项目记忆
```

每一步的产物都是下一步的输入，所有 LLM 产物落在 `report/` / `presentation_versions/` / `golden_strategy/` 自动归档，不污染 `draw_data`，不破坏数据安全分级。

---

## 数据安全 · 速查清单

| 操作 | 允许吗？ |
|---|---|
| 在「数据探索」加载 csv 用于剖析 | ✅ 浏览器内，无 LLM |
| 在「数据探索」点「让 AI 推荐图表」 | ❌ 永久禁止，违反核心契约 |
| 在「数据分析」让 AI 读 `clean_data/口径.md` | ✅ 已聚合，允许 |
| 在「数据分析」直接粘贴 csv 内容到对话 | ❌ 等同绕过红线 |
| 让 AI 调注册工具读 `draw_data` 做聚合 | ✅ 经 `/api/extraction-tools/:id/run`，工具只回灌聚合结果 |
| 让 AI 直接读 `draw_data/*.csv` 全文 | ❌ 红线域，原始行不进 LLM |
| 在「报告审核」让 AI 评审 `report/*.md` | ✅ 衍生产物 |

详情见 `AGENTS.md §一`。

---

## 故障排查（FAQ）

- **业务需求生成失败 / JSON 不合法**：缩短源文档或 prompt，换更稳定的结构化抽取模型（`minimax-m3`）。
- **数据探索剖析报错**：检查文件是否真的是 csv/xlsx；多 sheet 切到非空 sheet；实在不行降级用「手动改字段类型」。
- **数据分析 token 撑爆**：点「压缩上下文」`compactContext()` 或开新 session 用 Fork 继承关键消息。
- **报告审核打分总很低**：检查源报告是否含真实数据支撑；用多模型对比看是模型偏严还是真有问题。
- **黄金策图节点为空**：源报告太短或缺乏战略要素（如纯数据描述无结论）；先补结论段再重跑。
- **行动 ▶ Run 卡住**：检查后台 task 状态；查 `rule_memory → trace` tab 的执行轨迹。

---

## 文件地图（开发者参考）

| 二级 tab | 主要源文件 |
|---|---|
| 业务需求 | `web/src/components/BusinessRequirementPane.tsx` |
| 原始数据 / 聚合数据 / 报告输出 | `web/src/components/FolderPathsPane.tsx`（folder 参数区分） |
| 数据探索 | `web/src/components/DataExplorationPane.tsx` + `data-exploration/*` |
| 数据分析（对话） | `web/src/components/ChatPane.tsx` + `CleanDataDocsColumn.tsx` + `PreviewPane.tsx` |
| 汇报版本 | `web/src/components/PresentationVersionPane.tsx` |
| 报告审核 | `web/src/components/ReportReviewPane.tsx` |
| 黄金策 | `web/src/components/GoldenStrategyPane.tsx` |
| 行动 | `web/src/components/ActionsPane.tsx` |
| Tab 路由 | `web/src/lib/constants.ts`（`EXPLORE_SUB_TABS`） + `web/src/tabs/{Data,Engine,Viz}Tabs.tsx` |
