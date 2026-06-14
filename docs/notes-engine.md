# 智能引擎域 · 领域笔记（Agent-E）

> **活文档**：长效领域知识，由 E 持续维护。蒸馏自旧 handoff：`工作流` `AnaX` `实验室` `探索`(对话/skill/业务需求部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-14 · 回流审核终审 + 文档审计修复（无功能改动，文档/口径对齐）。
- 进度：
  - **回流评审两项被证伪（基于旧快照）**：评审报「sql-loop URL 不匹配致 404」与「WorkflowTemplateLibraryPane 末尾废注释」在当前代码均不成立。实测 `api.ts:359` 与 `engine.ts:229` 都用 `/api/workspaces/:id/sql-loop/instantiate`（字符串一致，无 404）；pane 文件末尾无任何废注释。结论：不动代码（用户已手测模板实例化通过）。
  - **WorkflowDesignPane（454 行）逐行审 = 无 bug**：WS 通道 `send_flow`/`abort_flow`/`run_start`/`run_end`/`error`/`flow_event(message_end)` 在 web/server 两侧 `types.ts` 均已定义，属复用既有契约、非新增接缝；运行态恢复(1.5s 轮询 + flowIdRef 防重订阅 + 乐观用户消息 + role==="user" 早返回防重)自洽，守卫完整。
  - **3 个 readme pane 审完**：`ExploreReadmePane`/`AggregateReadmePane` 是 `Markdown + ?raw` 同构壳，零风险；内容在 `web/src/docs/*.md`，红线表述准确（数据探索永久无 LLM、原始行禁入 LLM）。`WorkflowReadmePane` 修了 2 处 doc drift（见改动清单）。
  - **文档双份隐患已消除**：`explore-readme.md`/`aggregate-readme.md` 曾在 `web/src/docs/`(被 `@/docs/?raw` 真消费) 与根 `docs/`(无人引用) 各存逐字相同一份；删除根 `docs/` 那两份，留单一真源。
  - **`onApplyToEditor` 接线审 + 修 2 处**：链路正确（设计页生成 workflow.json → `applyToEditor` 切 execute + bump `workflowRefreshKey` → 加载 effect 重新 `flowWorkflowGet` 拉新图），与顶部「执行」tab 同行为无分叉。修了路径上两处缺陷（`MultiAgentExecutionPane.tsx`）：**A** 加载 effect 缺 `.catch` → 拉取失败永久 spinner，已补兜底；**B** 进 execute 必 reload 会静默丢弃执行侧未保存节点修改，已给 `applyToEditor` 加 `workflowDirty` 守卫(`window.confirm`)，并让「执行」tab 复用它消除重复内联逻辑。
- 校验：`npm run typecheck` ✅；`npm run build` ✅（仅既有 chunk size warning）。本次纯 engine 域文档/pane，未触发 data 探索子树 LLM 隔离 grep。
- 下一步（非阻塞，承接上轮，建议优先级）：
  - ① 做一次浏览器交互 smoke：模板库实例化 3 个模板 → 设计表单生成写作 workflow → 迭代修改插入/回跳节点 → 执行页保存并打开 DAG。（sql-loop 用户已单点手测通过，其余链路尚未端到端跑）
  - ② 设计页运行态恢复目前只覆盖“进程仍在 activeFlowRuns 中”的 UI 恢复；真正断点续跑（server 重启/pi 异常后继续）未做。若要做第 2 层，需要持久化 design run 表单、patch 指令、systemPrompt、runId 和阶段状态。
  - ③ 设计页生成/patch 的 prompt 仍依赖 pi 遵守 schema；建议后续增加前端表单级校验和生成后 schema/edge/onBlock 可视化摘要，降低模型漏字段风险。
  - ④ 模板库清单当前前端硬编码；若模板继续增加，建议补后端 `GET /api/workflow-templates`，避免 UI 与后端模板漂移。
  - ⑤ 可选继续拆 `MultiAgentExecutionPane`：节点编辑器/EdgeEditor/ExecutionPanel 仍可做第二阶段深拆，但本轮未动。
- 阻塞：无代码阻塞。
- 开放问题（待总控/用户拍板）：
  - **越界归属待总控裁决**：上轮 E 接线模板库/设计 pane 时改了接缝层骨架（`App.tsx`/`lib/api.ts`/`constants.ts`/`DataTabs`/`EngineTabs`）。功能合理但按章程这些归总控。要追认归属还是回滚重接，需总控定。
  - **评审流程教训**：本轮评审的两个 actionable 项均因「未读当前文件、基于旧快照」而误报；与「typecheck/build 绿 ≠ 端到端通」同源——评审与 build 都不能替代对当前工作树的实读。是否要把「评审前强制重读目标文件」写进评审 SOP，待定。
  - 是否要把模板库清单上移到后端接口，并约定模板 id/name/sourceName/instantiateEndpoint 的稳定 schema。
  - 是否允许“设计”阶段在后端持久化 design run，用于真正断点续跑；若做，需要确定 DB 表和运行态清理策略。
  - `api.ts` 仍承载 legacy 聚合方法；本轮为最小接入继续在 `legacyApi` 增加 `instantiateSqlLoop/getFlowChatRuntime`，后续是否迁到 `lib/api/engine.ts` 需总控决定。
  - SQL loop 输入字段 `sql_connection_id / required_fields / schema_context / task` 命名是否固定；若接缝层将来有统一 workflow input schema 需对齐。
  - 预算停止经 `__run_budget_stop` blackboard update 落 trace，是否需专门 `run_budget_stop` trace/WS 事件。
  - 前端以 `agent_gate` 计数推导迭代轮次；是否需接缝层显式发 `iter`/`maxIterations` 以支持刷新恢复 + 多 gate 精确展示。
  - isDeterministicSqlGateNode 以 `node.id === "sql_gate"`(magic string)识别确定性 SQL gate；将来若多种确定性 gate，考虑改为按上游 tool 输出 kind 识别。
  - （tool-use 遗留，待核实是否仍开）ExtractionTool skill 注入时机、ToolLab 联动入口、`tool_result.content` 形态。

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| 探索·对话 | `ChatPane` `MessageRow` | session 路由(legacy) |
| 业务需求 | `BusinessRequirementPane` `useBusinessRequirementContexts` | `routes/engine.ts`(新) |
| 工作流 | `MultiAgentExecutionPane` `CreationPane` `WorkflowDagEditor` `DecisionTreePane` `TocPane` `RunOutputPanel` | `multi-agent-runner.ts` `flow-fs.ts` |
| AnaX | `AnaXPane` `HypothesisPane` `ChangeManagementPane` `AnaXReadmePane` | `anax-template.ts` `anax-gate.ts` |
| 实验室 | `SkillLabPane` `ToolLabPane` `ModelLabPane` `ModelBuilder` `OperationalModelPane` | `*-evaluation-runner.ts` `skill-{curator,distillation,retrieval,activation}.ts` `model-lab.ts` `web/src/data/models.ts` |

db 新表建 `db/engine.ts:initEngineTables`；HTTP 走 `routes/engine.ts`；前端方法进 `lib/api/engine.ts`。

> **导航变更（2026-06-10 快修）**：AnaX **一级 tab 已撤销，整体并入「实验室」(research_lab)**。实验室顶部横向 = workflow/skill/tool/model/DLF/**AnaX**；点开 AnaX 时其 4 个二级（工作视图/假设库/变更管理/readme）以**左侧竖栏**呈现。AnaX 4 pane 渲染条件已从 `anax` 改为 `research_lab + {anax_view,hypothesis,change_mgmt,readme}`（见 `EngineTabs.tsx`）；pane 本身与 `anax-template/anax-gate` 后端**逻辑未动**。导航接缝细节见 `notes-infra §四`。

---

## 二、领域约束 / 架构契约

- **每节点 = 独立 pi turn**（spawn 子进程隔离，可重试/可追溯）；节点间数据通过 prompt 里 `{{nodeId}}` 占位符（黑板）传递。
- **WorkflowDef 扩展字段全 optional**（role/icon/color/desc/inputs/layout），默认值由渲染/执行层兜底，向后兼容已有 `workflow.json`。
- **模型硬约束后端统一校验**：`normalizeWorkflowModels` 在 GET/PUT/执行入口校验，前端 prompt 仅辅助。
- **数据文件夹 scope 化**：`workspace_paths` 带 `session_id`/`flow_id`，三级 scope（workspace/session/flow）。
- **强制停止双层**：active handle 优先 + `pgrep`/`lsof` 兜底杀孤儿进程。
- **AnaX 数据安全适配**：data-curator 不读原始数据，改为基于已登记 `clean_data` 聚合数据做 6 维评分（与 `BLOCK_SAFETY` 一致）。
- **skill 落盘项目级** `<workspace>/.pi/skills/<slug>/SKILL.md`（被 `listSkills` 识别为 project skill），不落全局。
- **ChatPane fork/delegate 前端边界**：ChatPane 不能为此改 `App.tsx` 接线；从 `folderScope.type === "session"` 取活跃 session。fork 分支是一个真实 session，前端只复用现有 gateway `send`、`listMessages` 和 `pi_event` 订阅；delegate 子 agent 只走 REST + 轮询。回流一律作为主 session 普通 `onSend` 消息注入，不新增旁路写 transcript。
- **委派数据安全**：子 agent 选择 `020_clean` 文件时，前端只传 `WorkspacePath.path`，不读取文件内容，不把数据样本/列名/剖析结果送入任何前端 LLM 功能。
- **ChatPane ExtractionTool 展示边界**：前端只展示 X 透传的 tool event / pi content block，不直接触发工具执行；`tool_call` 映射为 running `tool_use`，`tool_result` 回填同 id 卡片，最终 `message_end` 再带同一 tool block 时按 `id/tool_use_id` 去重。真实红线仍在后端 `source=ai` 守卫，前端不得把 `draw_data` 内容或样本送入 LLM。
- **ExtractionTool skill 桥落盘策略**：生成到 `<workspace>/.pi/skills/xanthil-extraction-tools/SKILL.md`，带 `xanthil-generated-extraction-tool-skill` 标记；只更新带生成标记的文件，遇到用户手写同路径 skill 不覆盖。skill 只描述 MCP 工具契约与 clean_data 限制，不承担安全校验。
- **工作流活跃前端路径唯一化**：legacy `ExecutionPane` / `AgentFlowPane` / `FlowChatPane` / `FlowWorkflowPane` / `FlowEditorPane` 已删除；新功能只接入 `MultiAgentExecutionPane` 真路径。`execute_flow` WebSocket client message 已从 web types 移除，不得为兼容旧组件重新引入。
- **WorkflowNode.onBlock 权威契约**：唯一口径见 `docs/工作流-onblock契约.md`。仅 `kind:"gate"` 生效；blocked 时红线硬停优先于预算、预算优先于重试；可重试时回跳 `[retryFromNodeId, gate]` 闭区间，feedback 写入独立 blackboard key 并跨轮保留，loop 体节点 blackboard 需清理。
- **onBlock trace 兼容原则**：不配 `onBlock` 的 workflow 行为零变化，普通 gate 仍只写 `gates/<id>.json`。只有配置 `onBlock` 的 loop 体节点写 `runDir/<nodeId>/iter-<n>/`，gate 额外写 `gates/<id>-iter<n>.json`；`gates/<id>.json` 始终是最终轮。
- **onBlock 预算守卫边界**：runner 只消费 T-C4 `cache.ts evaluateRunBudget(workspaceId, runId, limits)`，不自造 token/cost 统计；生产预算是否启用取决于接缝层传入 `runBudget`。预算停止当前写 `blackboard["__run_budget_stop"]` 并调用 `onBlackboardUpdate`，通过既有 blackboard trace/WS 链路可见；gate blocked 时预算原因也写入 gate verdict reasons。
- **onBlock 前端接缝边界**：T-E3 按任务约束未改 `web/src/types.ts` / `server/src/types.ts` / WS 消息契约；`WorkflowDagEditor` 和 `MultiAgentExecutionPane` 用局部扩展类型读写 `node.onBlock`。执行面板轮次展示当前以本 run 内 `agent_gate` 事件计数推导，不能等同于刷新后可恢复的权威 trace 字段；若要精确恢复，需要后续接缝层显式携带 iter 或读取 run artifact。
- **SQL loop gate 边界**：`sql_gate` 是 deterministic gate，不启动 pi turn，不读取模型自报；只从 `run_sql` 结构化 JSON 判定 `code===0`、`success===true`、`rowCount>0`、`requiredFields ⊆ columns`。模板字段当前约定为 `input.sql_connection_id`、`input.required_fields`、`input.schema_context`、`input.task`。
- **SQL tool 节点失败语义**：内置 `run-sql-query` 的 SQL 执行失败必须保留为 tool output 内部失败，而不是 workflow node 非零退出；否则 runner 会在 tool 节点处直接停止，`sql_gate.onBlock` 无法拿到错误反馈并回跳修复。
- **工作流模板库当前边界（2026-06-13）**：模板库入口在工作流左栏，不新增 `templates` 二级 tab；当前清单前端硬编码 3 项并调用既有 instantiate API。若模板继续扩容，再补 `GET /api/workflow-templates`，避免现在为了 3 个模板过早扩展后端 schema。
- **工作流设计入口（2026-06-13）**：工作流内 tab 收敛为“设计 / 执行”。“设计”是表单式 workflow compiler，不是自由聊天；首次生成靠目标/输入/步骤/gate/输出表单约束，后续“迭代修改”才允许自然语言 patch，且必须最小修改当前 flow 的 `workflow.json`。
- **设计运行态恢复边界（2026-06-13）**：`GET /api/flows/:id/chat-runtime` 只读取内存 `activeFlowRuns`，用于切换 flow 后恢复 UI running 状态；这不是 checkpoint，也不保证 server 重启、pi 进程异常、WebSocket 断开后的断点续跑。
- **AnaX 与工作流主栈前端解耦**：AnaX 定位独立产品/后台系统（白皮书 type-B）。不要为了消除重复把 AnaXPane 的 WS 订阅/恢复逻辑抽到主栈共享 hook；`web/src/components/multi-agent/useMultiAgentRun.ts` 是 MultiAgentExecutionPane 私有 hook，不对 AnaX 承诺复用。

---

## 三、关键决策沉淀

**工作流**
- Flow `kind: single|multi`（DB 自动迁移 ALTER+DEFAULT）→ 后删单智能体，只留 multi；**更名仅改 label，内部 id `multi`/DB kind 不动**（零迁移）。
- 2026-06-13 前端清理确认：server 与 web 各有独立 `types.ts`，两侧解耦、可各自独立变绿；`execute_flow` 删除不需要与 server 同批。删 legacy 前端时先做精确引用扫描，确认每个文件除自身定义外引用链只指向同样无人渲染的组件。
- 2026-06-13 T-E1：onBlock 在 runner 内做成**可选 runner 能力**，未改 `routes/engine.ts` 接线；`runBudget` 也作为 `MultiAgentRunOptions` 可选项接入，避免本卡越界修改路由骨架。生产预算硬停是否启用取决于后续总控接线。
- 2026-06-13 T-E2：预算检查从 gate blocked 分支扩展到每个非 gate 节点成功后和 gate 裁决后；红线硬停优先级最高，不检查预算、不回跳。maxIterations 耗尽会追加明确 reason 到最终 gate verdict，以便失败上限通过现有 `agent_gate` trace 可见。
- 2026-06-13 T-E3：gate onBlock UI 同时接入 DAG overlay 与执行面板表单视图，避免“字段只能在一处配置”的双入口不一致；`retryFromNodeId` 选项按 topo 序限当前 gate 之前节点，删除/重命名回跳目标时同步清理/更新引用。
- 2026-06-13 T-E4：SQL loop 选择 runner 内置 `run-sql-query`，而不是注册到 `server/tools` 的 Python extraction tool。原因是 SQL 查询需要直接复用本地 `sql-connections.ts` 的连接存储、安全校验和查询执行；外部 extraction tool 无法自然访问该连接契约，且会把“工具进程执行失败”和“SQL 可修复失败”混在一起。
- 2026-06-13 T-E4：`sql_gate` 复用 `anax-verdict` 输出格式和既有 gate 文件/trace 链路，但 verdict 由 `evaluateSqlGate()` 确定性生成。这样不扩展 WS/types 接缝，也能让 `onBlock` 使用同一套 feedbackVar 回流。
- 2026-06-13 T-E5：SQL loop 的“真实实跑”不等于真 pi；T-E5 只要求真实 SQL tool 与真实数据收敛。因此测试允许 fake `runTurn` 生成两轮 SQL，但 `run_sql` 必须走真实 `run-sql-query`、真实 `sql-connections`、真实 SQLite 数据表。为避免 `sql-connections.ts` 模块级 `SQL_CONNECTIONS_PATH` 固定到默认数据目录，实跑测试用子进程传临时 `XANTHIL_DATA_DIR`。
- 2026-06-13 T-E6：拆 `MultiAgentExecutionPane` 时优先做“搬迁式拆分”，先抽私有 hook、纯工具、执行控制面板和 tool 配置；保留节点编辑主体在原文件，避免低优先卡引入大范围 JSX 行为变动。`useMultiAgentRun` 明确放在 `components/multi-agent/`，不是全局 `hooks/`，用于防止后续误解为跨 AnaX 共享能力。
- 2026-06-13 预算生产接线（总控补，闭合 T-E1/T-E2 遗留的“取决于后续总控接线”）：`config.ts` `RUN_BUDGET_LIMITS` 读 env `XANTHIL_RUN_MAX_TOKENS`/`XANTHIL_RUN_MAX_COST_USD`（>0 生效，未设=null 即不限、行为不变），`routes/engine.ts` handleExecuteMultiAgent 传 `runBudget`。决策：env 可选 > 硬编码魔法上限（误伤大 run）> DB 配置（过重）；per-workspace 限额 + UI 留待按需。接缝细节见 `notes-infra.md §六`。
- 2026-06-13 模板库入口决策：没有新增 `SubTab` 字面量和 `MULTI_SUB_TABS`，而是在工作流列表栏加“从模板新建”。理由：满足“一键实例化”需求，同时避开接缝层 tab 骨架变更；当前模板数量少，前端硬编码清单比新增列表端点更轻。
- 2026-06-13 设计入口决策：否决“创建”和“搭建”并行长期存在。两者对用户的视觉差异不明显，且都像对话框；最终合并为“设计”表单，要求用户先填写目标、输入、步骤、gate、回跳、输出，降低自由自然语言的不精确性。自然语言保留在“迭代修改”区，只用于已有 workflow 的局部 patch。
- 2026-06-13 运行态恢复决策：短期只做 active run UI 恢复，不做真正断点续跑。理由：`activeFlowRuns` 已有内存态，可低成本解决“切 flow 后回来不知道是否还在跑”；真正断点续跑需要 DB 持久化设计 run 与阶段状态，属于后续较大改造。
- 画布**纯预览只读**（`nodesDraggable=false` 等），所有变更经「pi 对话」自然语言完成。
- `workflow.json` 不存在时从**目录树自动推断节点**（数字前缀排序/单目录包裹展开，标 `inferred:true`）。
- 创建视图三区（架构+进度+对话）；黑板**正名融合**——把唯一真实价值（`{{id}}` 传递关系）显示在执行流节点卡，删重复输出汇总。
- run 文件读写用 **DB run.id**；客户端 `makeRunId` 经 `outputDir` basename 映射。
- 决策树/TOC 图保存为 **HTML**（SVG 无法内嵌系统 CJK 字体 → 字体变形）。
- 流程图库 = `@xyflow/react`（React Flow v12）。

**AnaX**（详见记忆 anax-integration）
- = 预置 flow 模板 `buildAnaxWorkflow()` 9 节点线性 DAG（business→plan→data→data_gate→insight→recommend→review_gate→verify→archive），懒加载物化复用现有 flow 引擎。
- **gate = 节点**：产出 ` ```anax-verdict ``` ` JSON；`evaluateGate` 抽 JSON 后按硬阈值（置信度≥medium/证据≥2/数据质量≥7）**确定性重算 blockers**，模型自报仅参考；缺裁决块=阻断。
- 并行假设 **fan-out**（`FanOutSpec`，concurrency:3 maxItems:12，与 plan 最多 12 假设一致）；假设库飞轮 + 剪枝（>20 条按关键词评分取 top-10）。

**实验室**
- Model Lab 模型定义解耦到 `web/src/data/models.ts`；101 模型 11 分类（**39 个 `auto_gen_model_*` 是模板凑数**，可逐步替换）。
- skill 检索 = **BM25 纯 TS 零依赖**；自主完成用 `--no-skills` + **检索路径注入**（非 system prompt 注入）。
- Archive 导出 = **零依赖内联 TS ZIP 构建器**（存储模式），Blob 下载。
- Workflow 编辑：表单式最小设计器 → ReactFlow 全屏 overlay + 保留表单；节点变更实时同步父状态，无「保存」按钮。
- Pairwise judge repeat 用**多数票聚合**；DB schema 自愈不清理旧 `/tmp` 数据。
- Tool 进 Workflow = 最小 `tool-run` step；tool node 输出进 blackboard，不接 Session artifacts tree。

**探索·对话/skill/业务需求**
- skill 提炼**压成单次 LLM 调用**（A 解构→B 提炼→C 写 SKILL.md 内嵌进一个 prompt），不做链式三次往返；**先预览可编辑再保存**（两个 API）。
- 业务需求来源引用 = 字段级 `sourceRefs` + quote 最小闭环，**不做字符 offset 定位**；业务需求上下文抽成前端共享 hook（Chat/报告版本/Golden Strategy 复用）。
- fork 分支/委派子 agent 的**回流不是特殊消息类型**：前端弹可编辑摘要框，用户确认后调用主线 `onSend`，保持主 transcript 只有用户主动回流的摘要/报告路径；分支中间多轮和子 agent 运行细节不污染主线。
- fork 前端不要回到旧 WebSocket 方案重新设计协议：后端契约已交付为 `POST /api/sessions/:id/fork` + 分支真实 session + 现有 gateway send/messages/pi_event；委派契约已交付为 REST delegate/task/abort + 轮询。
- Phase 2b 数据分析工具展示采用**事件容错层而非深绑 pi-adapter 类型**：E 侧只认 `tool_call`/`tool_result` 事件和 pi `tool_use`/`tool_result` content block，不改 `pi-adapter/index.ts/types`。这样 X 可继续收敛总控契约，前端只在 `App.tsx` 映射层适配字段差异。
- ExtractionTool 结果产物预览**复用现有工具预览端点** `/api/extraction-tools/preview`，不新增 ChatPane 专属 artifact API。结果卡从 `results[].outputs` 提取产物路径；若工具 summary 不含该字段，只展示原始 JSON。

---

## 四、踩坑 / 陷阱

- **pi CLI 调用**：`runPiPrompt()` 用 `--no-skills`，**不要用 `--no-extensions`**（会禁用模型 provider 扩展导致 LLM 调用失败）。见 `pi-adapter.ts`。
- **AnaX 结构块解析必须容忍真实 LLM 格式漂移**：MiniMax 真跑会输出 ````anax-verdict{...}` / ````anax-hypotheses-plan[...]`（marker 后无换行），也可能先在 `<think>` 中复述一个无效示例块，再在末尾输出有效块。解析器必须扫描所有同名 fenced block，跳过无效 JSON，取最后一个有效 JSON；只取第一个 block 会误判 gate/fan-out 失败。
- **AnaX data_gate 不应把分项风险当整体质量硬阻断**：真实数据报告可出现综合评分 8/10，但时效性/口径清晰度等分项 6/10。硬阈值只应卡整体数据质量 stage；分项风险通过 summary/下游硬约束透传，否则会把“可分析但有约束”的数据误杀。
- **AnaX fan-out 上限必须和 plan 假设数量一致**：plan 真跑可能生成 12 个假设；若 `maxItems` 仍是 8，H9-H12 永远不验证，review_gate 会因 evidence=0 / confidence=low 必然阻断。
- **AnaX archive flywheel 只读本轮回复会漏写**：真实 archive 可能把完整 `anax-hypotheses` 写进 `09-archive-summary.md`，但本轮回复只输出摘要，导致 `onBlackboardUpdate("archive")` backfill=0。prompt 已要求本轮回复末尾原样输出结构块；若仍不稳，下一步考虑 runner 从 `specs/09-archive-summary.md` 兜底读取。
- **skill distillation frontmatter 提取不能取第一个 `---`**：真实 LLM 可能在 `<think>` 中输出自查清单、fenced YAML 示例和最终 SKILL.md。`extractSkillMarkdown()` 应优先找最后一个 `--- + name:` frontmatter；否则保存后 `listSkills()` 会识别为 project source 但 `available:false`（缺 description）。
- **工具事件重复显示风险**：pi 可能先流式透传 `tool_call/tool_result`，最终 `message_end` 又带完整 `tool_use/tool_result` content。ChatPane 必须按 `id/tool_use_id` 去重，否则用户会看到两套工具卡。
- **ExtractionTool skill 不是红线本体**：skill 文字只能引导模型选择 clean_data；真正防泄漏必须依赖后端 `POST /api/extraction-tools/:id/run` 的 `source=ai`、`workspaceId` 和已登记 `clean_data` 校验。不要在前端或 skill 文案里把软约束误认为安全边界。
- **SQL loop 不能让 tool 节点非零退出**：普通 tool node 失败会在 runner 中立即 `return { code }`，下游 gate 不会执行。SQL loop 的可修复失败必须编码进 `run_sql` JSON 的 `code/success/error`，workflow 层保持 `code:0`，由 `sql_gate` block 并写入 `sql_error`。
- **SQL 关键字段校验依赖结果 columns，不依赖首行 row key**：空结果时 rows 无法提供字段信息；后续若要支持“空结果但 schema 字段完整”的场景，需要总控明确是否允许 `rowCount=0` pass。目前 T-E4 验收要求结果非空，所以 `rowCount=0` 一律 block。
- **设计页运行态恢复不是跨进程恢复**：`chat-runtime` 只反映当前 server 进程里的 `activeFlowRuns`。如果 server 重启或 pi 已异常退出，前端只能看到历史消息/已落盘 workflow，不能继续上一轮生成。不要把该能力描述成“断点续跑”。
- **设计/执行切换不应重复展示同一张图**：设计页去掉上半流程节点预览，避免和执行页 DAG/执行流重复。设计页承担“结构化输入 + 局部 patch + 生成状态”，执行页承担“查看/编辑节点配置 + DAG + 运行”。
- **readme 内容会随 UI 收敛漂移，改入口必须同步**：`WorkflowReadmePane` 是手写 JSX，里面写死了 tab 命名与生成入口口径。2026-06-14 修过两处漂移——把已收敛掉的「对话」生成入口改成表单式「设计 + 迭代修改」，把「聚合数据 → SQL连接」修正为「计算工具 → SQL连接」(`sql_connect` 实际挂在顶层 `aggregate`/计算工具 tab，见 `constants.ts AGGREGATE_SUB_TABS`，不在 `clean_data`/聚合数据 子 tab 下)。凡收敛 tab/入口/归属，必须回头扫 readme。
- **执行侧 workflow 加载与设计↔执行切换的两个雷**（2026-06-14 已修，列此防回归）：① `MultiAgentExecutionPane` 加载 effect 的 `flowWorkflowGet` 必须带 `.catch` 兜底 `setLoading(false)`，否则拉取失败会卡死无限 spinner（设计页自己的 refresh 有 try/catch，执行侧曾漏）。② 进入 execute 视图会按 `workflowRefreshKey` 从 server 重新加载并 `setWorkflowDirty(false)`，这会丢弃执行侧未保存的节点手改；任何触发「切到 execute + bump refreshKey」的入口（`applyToEditor` / 顶部「执行」tab）都应走带 `workflowDirty` 守卫的同一函数，不要各写内联 `setView+refreshKey`。「设计」tab 不 reload，无需守卫。
- **readme markdown 单一真源在 `web/src/docs/`**：`ExploreReadmePane`/`AggregateReadmePane` 用 `@/docs/*.md?raw` 导入，`@` 解析到 `web/src/`。不要在根 `docs/` 再放同名副本——`?raw` 只消费 `web/src/docs/` 那份，根目录副本无人引用且必然漂移（2026-06-14 已删根 `docs/explore-readme.md`/`aggregate-readme.md`）。
- `scope` 对象字面量每次渲染新引用 → `useCallback([scope])` 重建 → effect 清空画布。根治：Pane 内提取稳定原始值（scopeType/scopeSessionId/scopeFlowId）作 deps，不改 App.tsx 内联写法（项目惯例）。
- 流式响应中断（`Stream ended without finish_reason`）：建议切 MiniMax-M3 重试，长报告分块写文件。
- **onto-extract 文档抽取的两层硬上限**（2026-06-11 hotfix 已调）：①`CONTENT_LIMIT`（字符截断，原 6000 → 现 24000）是真正决定"能不能看到文档后半段"的开关；②prompt 配额（实体/关系/逻辑/动作 ≤N）是次级限制，长文档若超配额会被模型自行裁掉。**所有抽取调优必须双层一起看**，只调一层都不够。
- **onto-extract 分块抽取的"合并几乎免费"**：`processExtractionOutput` 是纯函数 + 已有同名去重（entity nameCn / logic nameCn / link `src|tgt|kind`）+ `resolveId` 模糊匹配，对同一 `ontologyId` 多次调用可天然合并落库。未来要做分块只需在 `extractOntologyFromText` 外层切分 + 串行多次跑 `runPiPrompt` + 逐次喂 `processExtractionOutput`，**不必动质检流水线**。但分块切分本身是难点：按段落边界（双换行/标题）切 + ~200 字 overlap，不要 `slice(0, N)`。
- **onto-extract "按名去重"对编辑不友好**：line 233-241 已存在则 `continue`，后入块即便 description 更富也不会更新。未来要做"以新换旧/取富者"需改这段逻辑；这是分块上线前要先解决的 TODO。

---

## 五、已接入缝变更（时间倒序）

### 2026-06-11：工作流与任务栏正式分离（A 方案）
- **总控主导**。`server/src/db.ts:859` — `listSessions` SQL 加 `AND workflow_id IS NULL`，任务栏不再返回带 workflowId 的 session。
- POST 端点 `workflowId` 参数透传、前端 `api.createSession` 的 `workflowId` 参数、sessions 表 `workflow_id` 列均**休眠保留**（不拆除）。
- `docs/wiki.html:511` done brief 备注同步更新。
- 验收：`typecheck` 绿（仅后端改动）。验证方法：工作流运行后 `/api/workspaces/:id/sessions` 应无 workflow 会话；无 `git` 操作。
- **红线检查**：未碰 `draw_data`/`clean_data`，未删表/列。

---

## 六、未验证 / 历史待办（真实优先级见 KICKOFF-P0）

- ⚠️ **AnaX 8 阶段链路从未真实 E2E 执行**（fan-out/flywheel/gate 全在 fake adapter 下跑通）；喂真实留存聚合数据（综合评分≥7）才跑得出价值，否则必卡 `data_gate` → **KICKOFF P0-C 核心**。
- skill 蒸馏全链路 smoke（提炼→预览→保存→listSkills 出现）未实跑，需验证 LLM frontmatter 稳定性 → P0-C。
- 全量 28/101 模型端到端验证未做；AnaX P3 变更管理 propose/apply + DAG cascade 按需。

---

## 七、P1：Notebook + 语义层消费

- Notebook（SQL/Python/MD 混排）为 E 域 P1。
- 指标语义层 `MetricDefinition`（总控定契约、D 实现）：E 生成 SQL 时**强制引用 metric 口径**，不自造。
