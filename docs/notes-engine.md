# 智能引擎域 · 领域笔记（Agent-E）

> **活文档**：长效领域知识，由 E 持续维护。蒸馏自旧 handoff：`工作流` `AnaX` `实验室` `探索`(对话/skill/业务需求部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-15 · skill auto-distill sweep：近期完成 session 自动沉淀为 distilled candidate。
- 进度：
  - **新增 sweep 端点**：`POST /api/workspaces/:id/skill-auto-distill` 已在 `routes/engine.ts` 落地；参数支持 `since`、`limit`、`model`、`dryRun`、`timeoutMs`、`duplicateThreshold`，供 `/loop` / cron / 手动调度调用。
  - **不改会话结束 seam**：没有触碰 `index.ts` 或会话完成 hook；MVP 是可调度端点，不做 inline 自动触发，避免普通任务链路被 LLM 蒸馏拖慢或引入失败面。
  - **候选落库边界**：只扫描同 workspace 近期非 workflow session；过滤 runtime `running/compacting/error`，且必须有 assistant 文本回复。蒸馏只读 messages transcript，不读 `draw_data` / 文件内容。产物固定写 `.pi/skills/<slug>/SKILL.md` + version snapshot，并创建 registry `source="distilled"`、`status="candidate"`、`originSessionId=session.id`，绝不自动 active。
  - **去重门已接入**：创建前先查同 slug / 现有 skill 文件，再复用 registry conflict BM25；高相似结果返回 `skipped`，不重复造 skill。`extractSkillMarkdown()` 继续沿用“取最后一个带 `name:` frontmatter”的防漂移策略。
  - **测试覆盖**：新增 `server/src/skill-auto-distill.test.ts`，用 fake pi 覆盖 candidate 创建、frontmatter 稳定抽取、高相似去重跳过、候选不自动 active。
- 校验：
  - `npm run typecheck` ✅
  - `npm run build` ✅（仅既有 Vite chunk size / dynamic import warning）
  - `node --experimental-strip-types --test server/src/skill-auto-distill.test.ts server/src/skill-registry.test.ts server/src/skill-retrieval.test.ts` ✅
  - 数据探索隔离 grep：本次目标域为 engine，未改数据探索子树，SOP 未要求。
  - 未改 App/api/constants/index/db 接缝骨架；零新依赖；未执行 git add/commit/push。
- 下一步：
  - **真实 LLM sweep smoke**：在用户确认可消耗模型额度后，用真实 provider 对一个近期完成 session 调 `skill-auto-distill`，确认 frontmatter 稳定、候选内容质量和 BM25 去重阈值体感。
  - **MVP 调度入口**：总控需决定先用 `/loop`、cron routine，还是先加前端/内部按钮手动触发；当前后端端点已可被调度，但没有自动计划器。
  - **候选筛选信号升级**：当前只用“近期完成 session + limit”；后续可接入生产激活缺口、同类任务重复出现、session 成功信号/用户收藏等排序，避免低价值 session 占用蒸馏额度。
  - **去重阈值校准**：默认 `duplicateThreshold=1.5` 是工程默认值；真实样本跑完后需总控确认是否按 score/severity 分层跳过或只标疑似重复。
- 阻塞：无代码阻塞。
- 开放问题（待总控/用户拍板）：
  - auto-distill 的 MVP 调度方式选 `/loop`、cron routine 还是前端按钮先手动。
  - 真实运行默认模型选哪一个便宜/本地模型，以及是否允许 sweep 端点默认不传 `model` 继承 pi 配置。
  - 去重命中时是否只 `skipped`，还是需要把“疑似重复”候选记录进 registry/治理队列供人审查看。

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
- **LLM→JSON 解析统一入口（2026-06-14 快修2.1）**：所有把 LLM 输出转结构化 JSON 的链路一律走 `server/src/index.ts` 的 `parseJsonObject` / `extractJsonObject`，二者已内置字符串感知的 `repairLooseJson()` 兜底（剥 `//`、`/* */` 注释 + 尾逗号；字符串内的 `//`、`,]` 受保护不误伤）。解析顺序 `原文 → 切片([首{,末}]) → repair 切片`；**禁止在各 LLM 功能里各自直接 `JSON.parse`**。最终仍无法解析时抛带原文片段的领域错误（如 `LLM response is not valid JSON: <前300字>`），不得让裸 V8 `SyntaxError` 冒泡成 500。新增 LLM 链路复用此入口，配合既有 `repairJsonObject`（二次 LLM 修复）兜底。
- **数据文件夹 scope 化**：`workspace_paths` 带 `session_id`/`flow_id`，三级 scope（workspace/session/flow）。
- **强制停止双层**：active handle 优先 + `pgrep`/`lsof` 兜底杀孤儿进程。
- **AnaX 数据安全适配**：data-curator 不读原始数据，改为基于已登记 `clean_data` 聚合数据做 6 维评分（与 `BLOCK_SAFETY` 一致）。
- **skill 落盘项目级** `<workspace>/.pi/skills/<slug>/SKILL.md`（被 `listSkills` 识别为 project skill），不落全局。
- **skill progressive disclosure（2026-06-15）**：支持目录形态 `<skill>/SKILL.md + scripts/ references/ resources/`。`listSkills()` 只发现每个目录的 `SKILL.md`，命中后不展开子目录；`retrieveSkills()` 的 BM25 文档只允许使用 `name + description + SKILL.md` 首屏摘要（当前正文摘要上限 2400 chars），禁止把子资源或整篇长正文纳入检索。命中后注入给 pi 的仍是 `SKILL.md` 路径，由 pi 按文内相对路径懒加载子资源。
- **skill registry 生命周期（2026-06-14）**：内容真源仍是 `<workspace>/.pi/skills/<slug>/SKILL.md`，`skill_registry` 只存元数据/生命周期态。`status` 为 `draft|candidate|active|archived`；归档只更新 status 并关闭当前 workspace 的 enablement，**不删除文件**。版本链用 `version + supersedesId`，沿用 RuleMemory 的“留档可回滚”范式。
- **skill 自进化人审门（2026-06-14 P1 A）**：`candidate` 表示待评测/评测中/低分候选，评测达阈值后自动转 `draft`，`draft` 在 skill registry 语境中表示“达标待人审采纳”。`active` 必须由人审 PATCH 触发；`source=distilled|curated` 置 active 需 `confirmed=true`，禁止全自动 active。
- **skill 自进化触发口径（2026-06-15 更新）**：普通 pi 任务结束仍**不会 inline 自动产 skill**；新增的自动沉淀是**可调度 sweep**：`POST /api/workspaces/:id/skill-auto-distill` 扫近期完成 session，读取 transcript，跑 `buildSkillDistillationPrompt()`，用 `extractSkillMarkdown()` 清洗，经过 slug/文件/BM25 去重后，落 `<workspace>/.pi/skills/<slug>/SKILL.md` + version snapshot，并创建 registry `source="distilled"`、`status="candidate"`、`originSessionId=session.id`。它不接会话结束 seam，不自动 active，不绕过 distilled/curated 的 `confirmed=true` 人审门。原手动链路仍存在：`POST /api/sessions/:id/distill-skill` 只返回 markdown 供预览/编辑，保存另走 `save-skill`。curation 仍只在「实验室 skill 评测」跑完后生成改进提案，不创建新 skill、不落盘。
- **skill auto-distill 调度入口 = 手动一键按钮（2026-06-15 定，撤销定时）**：MVP 调度入口最终选**手动按钮**，不用 cron/`/loop` 定时（session-only 本地定时每日节奏天然易错过、且自动跑会无人值守烧 LLM 额度）。`SkillManagementPane`(D 域前端)工具栏加「自动沉淀」控件组：**limit 下拉(1/3/5，默认 3)** + **模型下拉(默认=继承 pi 配置，否则从 `ctx.models` 按 provider 分组，与 ChatPane ModelSelect 一致)** + 按钮 → `engineApi.runSkillAutoDistill(workspaceId, { limit, model })`(`web/src/lib/api/engine.ts`) → `POST /api/workspaces/:id/skill-auto-distill`(since 仍用端点默认近 7 天)；返回 `SkillAutoDistillResult`(双侧 web types)，前端弹结果横幅(扫描/新增/跳过/失败 + 新候选 slug)并 `refresh()`。注：sweep 后端是 `for..of + await` **顺序执行**非并发，limit 只是单次处理上限/成本闸。**会真实调 LLM 蒸馏，故必须用户显式点击**，不自动触发。后端端点/逻辑/人审门/去重一字未改，只换触发方式与参数入口；`SkillManagementPane` 新增 `models: PiModel[]` prop(DataTabs 传 `ctx.models`)。
- **skill 查看/编辑 UI（2026-06-15，D 域 SkillManagementPane）**：① **只读查看**——点名称或操作列「查看」按钮，弹只读 modal 显示 SKILL.md（`getSkillVersionContent` 读版本快照，无快照的老条目给提示不崩）。② **版本更新两模式**：`beginUpdate` 现**载入当前 SKILL.md 原文**到编辑框（非空白模板；无快照回退模板），即「修改原文模式」；CreateSkillModal 在编辑态新增「AI 改写」框——填修改说明 + 选模型 → `POST /api/workspaces/:id/skill-revise`（`buildSkillRevisionPrompt`+`SKILL_REVISE_SYSTEM_PROMPT`，对请求体 `content` 做最小修改、`extractSkillMarkdown` 清洗、返回内容**仅预览不写盘**）→ 回填编辑框，用户可再手改后走既有「保存为新版本」。两模式都不绕过版本链/人审门。usage 记 `targetKind:"skill"`（双侧 TokenUsageTargetKind 新增）。真实 smoke：revise 最小修改、保 name/结构 ✅。
- **skill registry 启用与 usage 口径**：创建 registry entry 后调用 `enableForOrigin(workspaceId, "skill", id)`，归档调用 `setMemoryEnablement(... false)`。`usageCount` 当前表示“被注入路径使用过”，不是模型真实激活；flow chat 显式 `skillPaths` 与 workflow `defaultSkillPaths/node.skillPaths` 会按 registry path 匹配后累加。
- **skill 生产激活遥测（A 卡，2026-06-15 总控直做完成）**：`skill_registry` 加 `prod_injected_count`/`prod_activated_count` 两列（`db/shared.ts`，NOT NULL DEFAULT 0 + 存量库 ALTER 补列），双侧 `SkillRegistryEntry` 加 `prodInjectedCount`/`prodActivatedCount` 及**派生** `prodActivationRate`（`mapSkillRegistryRow` 算 `activated/injected`，injected=0 时 `null`，不落列）。语义独立于评测分与 `usageCount`：这两列只记**生产真实运行**的注入/激活，`activationRate`(评测)与 `usageCount`(注入埋点)口径不变、不被覆盖。写入：`db/engine.ts` `recordSkillActivationOutcome(id, activated)`(prod_injected+1 / 激活则 prod_activated+1) + `recordSkillActivationForRun({workspaceId, workspaceRoot, skillPaths, output})`(按 `.pi/skills/<slug>/SKILL.md` 映射回 registry、过滤归档、用 `detectSkillActivation` 的 evidence.skillPath 集判每 skill 激活)。**接线点 = run 完成、成功且非 abort 的三条生产链路**：flow chat(`routes/engine.ts handleSendFlow`，output=capturedText)/ workflow(`handleExecuteMultiAgent`，output=各节点 blackboard 拼接)/ autonomous(`autonomous-runner.ts runAutonomousTask`，output=末条 assistant)。**关键边界：`runMultiAgent` 同被 `evaluation-runner.ts` 调用，故只在 routes 生产处接，不进 runner，评测口径不污染**。createSkillRegistryEntry 的 INSERT 未列这两列、靠 DEFAULT 0，未改写入；usage 注入埋点 `recordSkillRegistryUsageForPaths`(注入时点)保留不动。
- **skill registry 去重/冲突边界（2026-06-14 P1 A）**：`/api/workspaces/:id/skill-registry/conflicts` 只做即时 BM25 相似度计算，过滤 archived，不自动归档、不落冲突表。返回结构按 RuleConflict 风格给 B/D 展示“疑似重复/建议归档”，最终处理仍走人审。
- **workflow skill 子集配置（2026-06-14 P1 C）**：`WorkflowDef.defaultSkillPaths` 是 workflow 级 fallback；`node.skillPaths === undefined` 继承 workflow 默认，`node.skillPaths = []` 明确禁用默认 skill，非空数组则只注入该节点专属子集。runner 的权威逻辑是 `node.skillPaths ?? workflow.defaultSkillPaths`。
- **ChatPane 抽屉化布局契约（2026-06-14，2026-06-15 polish）**：三个助手面板（Fork/@工具/委派）不再内联在 composer 列，改为 ChatPane 内部右侧可调宽抽屉。ChatPane 根容器横向 flex（左主列 flex-1 + 右抽屉 shrink-0），不动 App 布局、不动成果面板、不动后端。抽屉宽度 clamp [360px, 容器 60%]，localStorage 持久化（key `chatpane.assistDrawerWidth`），零新依赖；拖拽和 mount/window resize 必须共用同一 clamp 逻辑，避免已存大宽度在窄屏把主列压没。ForkBranchPanel 满高 flex 列（去 max-h-[360px]），分支 tabs/输入 shrink-0，会话区 flex-1 overflow-y-auto。抽屉头是三助手标题唯一显示位置，子组件内不再重复标题；ManualAnalysisToolCard / DelegateSubAgentCard 在抽屉内通过 `embedded` 态去自身外层 border/rounded/bg/padding，避免边框套边框，默认非嵌入 card 样式保持不变。
- **ChatPane fork/delegate 前端边界**：ChatPane 不能为此改 `App.tsx` 接线；从 `folderScope.type === "session"` 取活跃 session。fork 分支是一个真实 session，前端只复用现有 gateway `send`、`listMessages` 和 `pi_event` 订阅；delegate 子 agent 只走 REST + 轮询。回流一律作为主 session 普通 `onSend` 消息注入，不新增旁路写 transcript。
- **Fork 分支路径作用域回退父 session（2026-06-14 快修2.3）**：fork 分支是独立 session、名下无注册路径。`handleSend` 解析输出/数据路径时必须把作用域回退到父任务 session：`pathScopeSessionId = forkBranch ? forkBranch.parentSessionId : session.id`，用于 `buildRegisteredPathContext` 的 `sessionId` 与 `fallbackOutputDir`。否则 `output-paths.selectOutputPath` 逐级回退（scoped report→scoped clean_data→workspace report→workspace clean_data）会坍缩到 workspace 级最近 clean_data 源目录，导致分支产物写到数据源目录而非任务 `060_reports`。数据安全不受影响：fork 继承的是父 clean_data，`draw_data` 仍被 `buildRegisteredPathContext` 排除且永不作为输出目标。
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
- **skill 冲突 API 客户端调用规范（2026-06-14 P1-B）**：D slot 通过 `engineApi.listSkillConflicts(workspaceId, {slug?, content?})` 调用。`content` 走 GET querystring 有 URL 长度上限（浏览器/反向代理通常 8KB），客户端层在 `engine.ts` 内置 `truncateConflictContent`（4KB 上限），任何新增冲突调用方必须复用同一方法、不绕开截断；A 域如未来支持 POST body，前端可移除截断但保持同名方法。
- **skill 信任门 `confirmed` 字段语义边界（2026-06-14 P1-B）**：A 域 `hasConfirmedReview` 仅在 `source ∈ {distilled, curated}` 且 `status → active` 时强校验 `confirmed=true`。前端 PATCH 必须**仅在敏感来源传 `confirmed: true`**，其他来源不带该字段；不可"反正传上无副作用"地一律传 true，否则未来若 A 域扩展信任门到所有来源，前端会静默旁路。

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
- 2026-06-14 skill registry 后端决策：只在 E slot 新增 `db/engine.ts` CRUD 与 `routes/engine.ts` registry 路由，不迁移 `index.ts` 中既有 skill-evaluation legacy 端点。原因是用户约束“仅 E slot、不碰接缝骨架”，而 runner/db 保存函数已经可复用；registry evaluate 端点直接调用现有 runner 与保存函数即可闭环。
- 2026-06-14 skill registry 评测回写口径：registry evaluate 端点临时构造 baseline + skill variant，复用 `runSkillEvaluation()` 与 `saveSkillEvaluation()`。score 暂定为 pairwise `0.5 + avgScoreDelta/20` 截断到 0..1；无 pairwise 时用 successRate 与 activationRate 均值。该口径是工程接线默认值，不是最终实验室评分标准。
- 2026-06-14 skill 采纳写文件决策：POST registry 端点负责写 `<workspace>/.pi/skills/<slug>/SKILL.md`，并限制 slug/path，拒绝路径逃逸。没有新增全局 skill 写入，也不写 `.agents/skills`，避免影响用户全局环境。
- 2026-06-14 P1 A 阈值状态机决策：不新增 SkillStatus，复用卡1契约中的 `candidate/draft/active/archived`。原因是表/类型归卡1/总控，E 卡不能扩接缝；因此把 `draft` 明确定义为“达标待采纳”，由 UI 文案解释，而不是改 schema。
- 2026-06-14 P1 A 信任门决策：用 `confirmed=true` 作为 distilled/curated 采纳的人审轻量标记。它只防止后端被无意直接置 active，不记录 reviewer；若未来要审计，需要总控扩表或新增审计事件。
- 2026-06-14 P1 C 前端落点决策：节点 skill 子集配置先放 `MultiAgentExecutionPane` 表单视图，不放 `WorkflowDagEditor`。原因是 DAG 已提示高级字段到表单视图编辑，且表单视图能同时编辑 workflow/default 与 node override，避免两个编辑入口状态漂移。
- 2026-06-14 P1-B Modal 拆分决策：`AdoptConfirmModal` 抽到独立文件而非内联在 `SkillManagementPane.tsx`。原因是 D slot 既有惯例（`CreateSkillModal.tsx`/`EvalSkillModal.tsx` 都是平级独立文件），且采纳确认 modal 自身 ~150 行逻辑足够独立；同时弹窗内引入独立 `adoptError` state，避免错误显示在主面板被遮住。
- 2026-06-14 P1-B 共享 utility 决策：`severityLabel` / `severityTone` / `truncateConflictContent` 抽到 `web/src/lib/skillConflict.ts`，被 `CreateSkillModal` 与 `AdoptConfirmModal` 同时复用。否决了在每个 modal 内本地复制实现的方案——本次 code-review 已踩到一处实现漂移（行内复制）。utility 模块小（~20 行）但能消除"两份实现一改一漏"的隐患。
- 2026-06-14 P1-B race 防护决策：`AdoptConfirmModal` 不用 `AbortController`，而是用 `adoptRequestTokenRef` 自增 token。原因是冲突 API 是非幂等查询、无副作用，简单 token 即足以丢弃旧回调；`AbortController` 会让 `fetch` 抛 AbortError，反而需要在 catch 内额外区分 abort 与真错。token-ref 范式可在后续类似场景复用（弹窗预查询 + 用户连续切换目标）。
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
- skill 提炼**压成单次 LLM 调用**（A 解构→B 提炼→C 写 SKILL.md 内嵌进一个 prompt），不做链式三次往返；**先预览可编辑再保存**（两个 API）。源模板 `~/.pi/agent/prompts/skill-distillation-prompts.md`（用户维护的 4-prompt 链式库 A/B/C/D），单次版是其 A+B+C 的折叠；D（多案例融合）对应 curator/版本融合、不在此。
- **distillation prompt 增强（2026-06-15）**：`buildSkillDistillationPrompt`（`server/src/skill-distillation.ts`，auto-distill 与手动 `/distill-skill` 共用）第三步与自查清单新增两节**必需输出**——① 「关键变量清单」表格（`变量名 | 含义 | 典型取值范围`，逐个列正文 `{变量}`）；② 「常见陷阱与对策」章节（从对话提炼隐性经验/坑→对策，复用价值最高；**有坑才写、无坑省略，禁止硬编占位**）。这两块从用户 prompt 库的 A-E/B 回灌，旧版只在内部思考里提及、不进输出。架构不变（仍单次调用）。真实 smoke 验证（MiniMax-M3，`/distill-skill` 预览）：两节均稳定产出且质量达标（变量表含取值范围、6 条带现象/对策的真实陷阱）。
- 业务需求来源引用 = 字段级 `sourceRefs` + quote 最小闭环，**不做字符 offset 定位**；业务需求上下文抽成前端共享 hook（Chat/报告版本/Golden Strategy 复用）。
- 业务需求版本恢复依赖 `structured.version.requirementInput`：后端生成版本必须写入原始 draft 输入，手动编辑 markdown 时必须保留已有 requirementInput；前端打开历史版本/刷新恢复左侧 draft 时只读该字段，旧 JSON 缺字段时不应臆造完整业务背景。
- fork 分支/委派子 agent 的**回流不是特殊消息类型**：前端弹可编辑摘要框，用户确认后调用主线 `onSend`，保持主 transcript 只有用户主动回流的摘要/报告路径；分支中间多轮和子 agent 运行细节不污染主线。
- fork 前端不要回到旧 WebSocket 方案重新设计协议：后端契约已交付为 `POST /api/sessions/:id/fork` + 分支真实 session + 现有 gateway send/messages/pi_event；委派契约已交付为 REST delegate/task/abort + 轮询。
- Phase 2b 数据分析工具展示采用**事件容错层而非深绑 pi-adapter 类型**：E 侧只认 `tool_call`/`tool_result` 事件和 pi `tool_use`/`tool_result` content block，不改 `pi-adapter/index.ts/types`。这样 X 可继续收敛总控契约，前端只在 `App.tsx` 映射层适配字段差异。
- ExtractionTool 结果产物预览**复用现有工具预览端点** `/api/extraction-tools/preview`，不新增 ChatPane 专属 artifact API。结果卡从 `results[].outputs` 提取产物路径；若工具 summary 不含该字段，只展示原始 JSON。

---

## 四、踩坑 / 陷阱

- **pi CLI 调用**：`runPiPrompt()` 用 `--no-skills`，**不要用 `--no-extensions`**（会禁用模型 provider 扩展导致 LLM 调用失败）。见 `pi-adapter.ts`。
- **pi skill 子资源读取能力已实测（2026-06-15）**：`pi -p --no-skills --skill /tmp/.../SKILL.md --tools read` 可在 skill 激活后读取 `SKILL.md` 内写的 `./scripts/answer.txt` 相对路径并输出文件 marker。注意：临时隔离 `PI_CODING_AGENT_DIR` 会丢失用户 provider 配置导致 `No API key found`；做真实 smoke 需要允许 pi 读取现有配置。实测时出现过无关 `ptk-memory-inject` 扩展的 `better-sqlite3` Node ABI warning，不代表 skill 子资源失败。
- **AnaX 结构块解析必须容忍真实 LLM 格式漂移**：MiniMax 真跑会输出 ````anax-verdict{...}` / ````anax-hypotheses-plan[...]`（marker 后无换行），也可能先在 `<think>` 中复述一个无效示例块，再在末尾输出有效块。解析器必须扫描所有同名 fenced block，跳过无效 JSON，取最后一个有效 JSON；只取第一个 block 会误判 gate/fan-out 失败。
- **AnaX data_gate 不应把分项风险当整体质量硬阻断**：真实数据报告可出现综合评分 8/10，但时效性/口径清晰度等分项 6/10。硬阈值只应卡整体数据质量 stage；分项风险通过 summary/下游硬约束透传，否则会把“可分析但有约束”的数据误杀。
- **AnaX fan-out 上限必须和 plan 假设数量一致**：plan 真跑可能生成 12 个假设；若 `maxItems` 仍是 8，H9-H12 永远不验证，review_gate 会因 evidence=0 / confidence=low 必然阻断。
- **AnaX archive flywheel 只读本轮回复会漏写**：真实 archive 可能把完整 `anax-hypotheses` 写进 `09-archive-summary.md`，但本轮回复只输出摘要，导致 `onBlackboardUpdate("archive")` backfill=0。prompt 已要求本轮回复末尾原样输出结构块；若仍不稳，下一步考虑 runner 从 `specs/09-archive-summary.md` 兜底读取。
- **skill distillation frontmatter 提取不能取第一个 `---`**：真实 LLM 可能在 `<think>` 中输出自查清单、fenced YAML 示例和最终 SKILL.md。`extractSkillMarkdown()` 应优先找最后一个 `--- + name:` frontmatter；否则保存后 `listSkills()` 会识别为 project source 但 `available:false`（缺 description）。
- **skill registry POST 必须和文件路径强绑定**：registry 的 `slug` 同时决定 DB 行和 `<workspace>/.pi/skills/<slug>/SKILL.md` 路径。不要接受带 `/`、`\`、`..` 的 slug，也不要从请求体直接信任目标路径；否则会把“采纳 skill”变成任意文件写入。
- **registry usageCount 不等于 activation**：`usageCount` 只说明系统把某 skill path 注入了一次；模型是否真正用了它要看评测 `activationRate` 或未来生产激活事件。不要用 usageCount 直接判断 skill 有效性。
- **candidate→draft 是语义复用，不是普通草稿**：P1 A 为避免扩 `SkillStatus`，把 `draft` 用作“达标待人审采纳”。任何 UI/文档展示都应写“待采纳”而不是只写“草稿”，否则会误导用户以为尚未评测。
- **workflow skillPaths 保存时会规范化并过滤无效路径**：`GET/PUT /api/flows/:id/workflow` 调用 `normalizeWorkflowSkills()`，沿用 lenient 规则。无效路径会被剔除而不是 400；前端保存后应以重新加载结果为准，不要假设用户输入的每个 path 都落盘。
- **node.skillPaths 三态不要混淆**：`undefined` 是继承 workflow 默认，`[]` 是明确禁用默认 skill，非空数组是指定子集。前端 patch 时如果想恢复继承必须把字段设为 `undefined`，不能写空数组。
- **工具事件重复显示风险**：pi 可能先流式透传 `tool_call/tool_result`，最终 `message_end` 又带完整 `tool_use/tool_result` content。ChatPane 必须按 `id/tool_use_id` 去重，否则用户会看到两套工具卡。
- **ExtractionTool skill 不是红线本体**：skill 文字只能引导模型选择 clean_data；真正防泄漏必须依赖后端 `POST /api/extraction-tools/:id/run` 的 `source=ai`、`workspaceId` 和已登记 `clean_data` 校验。不要在前端或 skill 文案里把软约束误认为安全边界。
- **SQL loop 不能让 tool 节点非零退出**：普通 tool node 失败会在 runner 中立即 `return { code }`，下游 gate 不会执行。SQL loop 的可修复失败必须编码进 `run_sql` JSON 的 `code/success/error`，workflow 层保持 `code:0`，由 `sql_gate` block 并写入 `sql_error`。
- **SQL 关键字段校验依赖结果 columns，不依赖首行 row key**：空结果时 rows 无法提供字段信息；后续若要支持“空结果但 schema 字段完整”的场景，需要总控明确是否允许 `rowCount=0` pass。目前 T-E4 验收要求结果非空，所以 `rowCount=0` 一律 block。
- **设计页运行态恢复不是跨进程恢复**：`chat-runtime` 只反映当前 server 进程里的 `activeFlowRuns`。如果 server 重启或 pi 已异常退出，前端只能看到历史消息/已落盘 workflow，不能继续上一轮生成。不要把该能力描述成“断点续跑”。
- **设计/执行切换不应重复展示同一张图**：设计页去掉上半流程节点预览，避免和执行页 DAG/执行流重复。设计页承担“结构化输入 + 局部 patch + 生成状态”，执行页承担“查看/编辑节点配置 + DAG + 运行”。
- **readme 内容会随 UI 收敛漂移，改入口必须同步**：`WorkflowReadmePane` 是手写 JSX，里面写死了 tab 命名与生成入口口径。2026-06-14 修过两处漂移——把已收敛掉的「对话」生成入口改成表单式「设计 + 迭代修改」，把「聚合数据 → SQL连接」修正为「计算工具 → SQL连接」(`sql_connect` 实际挂在顶层 `aggregate`/计算工具 tab，见 `constants.ts AGGREGATE_SUB_TABS`，不在 `clean_data`/聚合数据 子 tab 下)。凡收敛 tab/入口/归属，必须回头扫 readme。
- **依赖 workflow 的 effect 会被「每次编辑换引用」反复触发**（2026-06-14 已修，列此防回归）：`useMultiAgentRun` 恢复 effect 原把 `workflow` 放进 deps（为了读 `workflow.nodes` 做目录→step 映射），但 `setWorkflow` 每次编辑都建新对象，导致 effect 每次编辑重跑、反复打 `listFlowRuns`/`flowRunTree`。通用解法：把「网络拉取（只依赖 flowId）」与「依赖 workflow 的纯映射」拆成两个 effect，纯映射用一个中转 state（如 `restoreDirs`）承接，映射后置空使其「一次即消费」。凡 effect 依赖频繁换引用的大对象、却只想跑一次，都按此拆。
- **执行侧 workflow 加载与设计↔执行切换的两个雷**（2026-06-14 已修，列此防回归）：① `MultiAgentExecutionPane` 加载 effect 的 `flowWorkflowGet` 必须带 `.catch` 兜底 `setLoading(false)`，否则拉取失败会卡死无限 spinner（设计页自己的 refresh 有 try/catch，执行侧曾漏）。② 进入 execute 视图会按 `workflowRefreshKey` 从 server 重新加载并 `setWorkflowDirty(false)`，这会丢弃执行侧未保存的节点手改；任何触发「切到 execute + bump refreshKey」的入口（`applyToEditor` / 顶部「执行」tab）都应走带 `workflowDirty` 守卫的同一函数，不要各写内联 `setView+refreshKey`。「设计」tab 不 reload，无需守卫。
- **readme markdown 单一真源在 `web/src/docs/`**：`ExploreReadmePane`/`AggregateReadmePane` 用 `@/docs/*.md?raw` 导入，`@` 解析到 `web/src/`。不要在根 `docs/` 再放同名副本——`?raw` 只消费 `web/src/docs/` 那份，根目录副本无人引用且必然漂移（2026-06-14 已删根 `docs/explore-readme.md`/`aggregate-readme.md`）。
- `scope` 对象字面量每次渲染新引用 → `useCallback([scope])` 重建 → effect 清空画布。根治：Pane 内提取稳定原始值（scopeType/scopeSessionId/scopeFlowId）作 deps，不改 App.tsx 内联写法（项目惯例）。
- 流式响应中断（`Stream ended without finish_reason`）：建议切 MiniMax-M3 重试，长报告分块写文件。
- **onto-extract 文档抽取的两层硬上限**（2026-06-11 hotfix 已调）：①`CONTENT_LIMIT`（字符截断，原 6000 → 现 24000）是真正决定"能不能看到文档后半段"的开关；②prompt 配额（实体/关系/逻辑/动作 ≤N）是次级限制，长文档若超配额会被模型自行裁掉。**所有抽取调优必须双层一起看**，只调一层都不够。
- **onto-extract 分块抽取的"合并几乎免费"**：`processExtractionOutput` 是纯函数 + 已有同名去重（entity nameCn / logic nameCn / link `src|tgt|kind`）+ `resolveId` 模糊匹配，对同一 `ontologyId` 多次调用可天然合并落库。未来要做分块只需在 `extractOntologyFromText` 外层切分 + 串行多次跑 `runPiPrompt` + 逐次喂 `processExtractionOutput`，**不必动质检流水线**。但分块切分本身是难点：按段落边界（双换行/标题）切 + ~200 字 overlap，不要 `slice(0, N)`。
- **onto-extract "按名去重"对编辑不友好**：line 233-241 已存在则 `continue`，后入块即便 description 更富也不会更新。未来要做"以新换旧/取富者"需改这段逻辑；这是分块上线前要先解决的 TODO。
- **GET querystring 传业务文本会触发 414**（2026-06-14 P1-B 已规避）：`/api/workspaces/:id/skill-registry/conflicts?content=...` 这类把整段 SKILL.md 文本塞进 query 的设计，浏览器侧 ~8KB、nginx 默认 8KB、其他反向代理 4-16KB 不等，实测踩到的不是 fetch 失败而是 414/400。规避：客户端 `truncateConflictContent` 4KB 上限（`web/src/lib/skillConflict.ts`）。**任何后端读 `req.query` 中长文本字段的端点都应：① 改 POST body；或 ② 客户端必须有上限**；不要假设 GET 想塞多少就能塞多少。
- **`AbortController` 不是 race 防护的唯一解**（2026-06-14 P1-B 已修，列此供后续参考）：弹窗预查询 + 用户连续切换目标场景下，`AbortController` 会让旧请求抛 AbortError，需要在 catch 内手动区分；用 `useRef<number>` 自增 token + 回调首行校验 `token === ref.current` 就够了，简单且不污染 catch 分支。该范式已在 `SkillManagementPane.tsx` `adoptRequestTokenRef` 落地。
- **窗口内 fetch 回调的 setError 写到主面板会被遮住**（2026-06-14 P1-B 已修）：弹窗渲染于 `fixed inset-0` 全屏遮罩之上，主面板的 error banner 被遮罩盖住，用户根本看不到。所有 modal 内异步操作都应有**弹窗内独立 errorState**（如 `adoptError`），不要复用主面板 `error`；同时 `try/catch/finally` 中复位 `submitting=false` 必须用 `finally`，否则成功路径与失败路径状态机容易漂移。

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
