# 横切基础设施 · 领域笔记（总控持有）

> **活文档**：总控持有的横切基础设施知识（缓存 harness / prompt 契约 / 接缝层指针）。
> 蒸馏自旧 handoff：`缓存命中`。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> 接缝重构（routes/db/api/tabs 拆分）记录见 `Orchestration.md §四`。

---

## 0. 当前状态（总控维护，覆盖式）

- 最近更新：2026-07-01 · infra 总控 session 收尾。
- 进度：
  - 当前仓库门禁通过：`npm run typecheck` 通过，`npm run build` 通过；build 仅保留既有 Vite/ECharts dynamic import 与 chunk-size warning。
  - 本次收尾未改业务代码；仅按 SOP 收敛 infra notes 的当前状态，避免 `§0` 继续堆叠历史批次。历史决策仍保留在下方正文专题章节。
  - 已完成专题的当前可靠锚点：tool-use 治理中枢 v1、业务需求沟通闭环、业务需求双子 tab 与确认需求贯通链路均已终审；接缝层骨架继续冻结，新增能力仍落各域 slot。
  - 数据安全红线继续有效：`draw_data` 原始行与 `data_exploration` 字段值/样本/剖析结果不得进入 LLM；`clean_data` 只按受控说明/元信息路径进入允许链路。
- 下一步：
  - 优先补浏览器点击级 smoke：业务需求日常 / 专题 / 重复三入口各跑一条“需求沟通 → 确认正式需求 → 基于确认需求生成分析框架 → 查看版本 / review context”链路。
  - 继续做知识库新模块运行时终审：全局 / 专属 scope、enablement、检索注入、system prompt 聚合与旧库迁移需要逐卡实跑。
  - command 场景调用框仍需总控复核：跑 command 相关单测、typecheck/build，并确认 `ChatPane` / `ManualAnalysisToolCard` 仍只经 `@工具` 与 `/api/extraction-tools/:id/run` 的 `source=ai` 闸门。
  - 数字锁真实 tool-use smoke 待补：用 analysis 工具返回 `metricSnapshots`，验证模型改写数值时 `metric_verification` block 可见，正常引用时无告警；同时覆盖 flow chat。
  - LLM 管理补测：逐行复核 `llm-config.ts` 脱敏链路，并补 key 保留、OAuth 不写 key、settings 局部写的 node:test。
- 阻塞：
  - 无代码阻塞。真实数字锁 smoke 依赖本机可用模型与 analysis 工具运行环境。
- 开放问题（待总控 / 后续拍板）：
  - `metric_verification` block 当前随消息 content 持久化；是否需要在 DB / trace 中单独索引为可筛选质量信号。
  - 数字锁是否从 best-effort 告警升级为自动纠偏 / 重试，需要结合预算上限与误报风险另行设计。
  - 工作区跨批次改动是否按专题分批提交，仍由用户手动决定；本 SOP 不做 git 操作。

---

## 一、缓存命中 Harness（降 token 消耗）

**核心约束（必读）**：pi-xanthil **不直接调模型**，所有请求经 `pi` CLI（`runPiTurn` spawn 子进程 + `--session-id` 复用会话 + `--system-prompt` 注入）。因此**无法直接设 `cache_control` 断点**，只能靠「稳定字节前缀」让 provider 的 prompt/prefix cache 自动命中——所有优化围绕这一点。

三层设计（均已闭环）：

| 层 | 机制 | 位置 |
|---|---|---|
| ① Token/缓存监控 | 钩入 `observeSessionEvent` 累计用量 | `cache.ts` · `session_token_stats` 表 · MainHeader `↩XX%` |
| ② Prompt 前缀稳定化 | 稳定块前置、role/workflow prompt 后置；块内容改动须 bump `PROMPT_SCHEMA_VERSION` | `prompt-blocks.ts:assembleSystemPrompt` |
| ③ 文件 hash + 分析缓存 | SHA-256 `file_hash` 为 key，跨 session 复用字段字典 | `file-hash.ts` · `setFileAnalysis` |

**关键决策**：
- 缓存命中率口径统一 = `cacheRead / (input + cacheRead + cacheWrite)`。
- 文件分析缓存以 SHA-256 为 key 跨 session 复用。
- **语义缓存（embedding）不做**——与 local-first/隐私冲突。
- 文件分析**自动回填**：`extractFieldDicts`（正则提取 ` ```field-dict:/path ``` ` 块）+ `backfillAnalysisFromMessage`（路径→hash 查表→`setFileAnalysis`），钩在 `handleSend` 的 `message_end` 后。`BLOCK_FILE_ANALYSIS` 为 Block 03。

**未验证**：真实对话验证回填效果（session A 分析 CSV → session B 检查 contextPrefix 是否含字段说明）。

---

## 二、接缝层（绞杀者重构，第 0 步已完成）

详见 `Orchestration.md`。要点：
- legacy `index.ts`/`db.ts` 冻结归总控；新功能进各域 slot（`routes/<域>.ts` · `db/<域>.ts` · `lib/api/<域>.ts` · `tabs/<域>Tabs.tsx`）。
- `db` 实例已从 `db.ts` 导出；各域 `db/<域>.ts:init*Tables` 在 base schema 后调用。
- `api.ts` = `legacyApi` + 域片段 spread；`App.tsx` render 委派给 `DataTabs/EngineTabs/VizTabs`，共享 `TabContext` 契约（总控持有）。
- 跨域类型（`MetricDefinition` 等）由总控在 `types.ts` 定义（双侧 server + web）。
- **onto-xanthil 数据语义层**（总控持有，V 域同源）：表在 `db/viz.ts`(ontologies/object_types/property_types/link_types/metric_definitions)、路由在 `routes/viz.ts`、抽取在 `onto-extract.ts`(经 pi)、前端 `OntologyPane`/`GraphCanvas`(KG 与 onto 共用的通用图渲染层)。详见 `docs/onto-xanthil-design.md`。
- **metric 真源 = `metric_definitions`**（P2b' 完全切源）：`buildEnabledStandardsPrompt`/`memory-injection`/`knowledge-graph` 的 metric 均读此表；`analysis_standards` 仅留 `reference_file`。改 metric 注入勿再碰 analysis_standards。
- **数据分析对话 fork 分支 + 委派子 agent 契约**（总控持有，infra/接缝层；E 域消费）：解决 pi session(ChatPane「数据分析」)多轮上下文撑爆。**统一心智 = 开子 pi session 干重活，只把结论回流主 session，主上下文只吃精炼结论**。
  - **契约**：`ForkBranch`/`SubAgentTask`/`SubAgentTaskInput`(types.ts 双侧)；表 `fork_branches`/`subagent_tasks`(db/shared.ts，总控)。E 引用类型 import 自 @/types，勿本地重声明(参 actions 收敛教训)。
  - **Fork 分支 = 一个真实 session**：`POST /api/sessions/:id/fork` 建分支 session(createSession)+fork_branches 行；分支 mini-chat 直接**复用现有 send/messages/abort**(对 branchSessionId)。`pi-adapter.RunPiOptions.forkFrom` → `runPiTurn` 加 `--fork <父>`；`handleSend` 检测"未播种分支"(getForkBranchByBranchSession && !seeded)→首轮播种、之后正常多轮、markForkBranchSeeded。**分支 session 从主任务列表排除**(`GET /api/workspaces/:id/sessions` 用 listBranchSessionIds 过滤——分支是子产物非独立任务)。
  - **委派子 agent = REST 起后台 + DB 轮询(非 WS)**：`POST /api/sessions/:id/delegate{brief,dataFiles,model}` → subagent_tasks 行 + 后台 `runDelegatedSubAgent`(index.ts)：全新聚焦子 session(`subagent-<taskId>`)、systemPrompt 硬约束(只读指定 020_clean 数据/报告写 060_reports/末条给结论摘要)、`pi -p` 单轮自主跑完(读数据→分析→写报告→摘要)。完成存 summary(末条 assistant 文本)+reportPath(060_reports 按 mtime 取最新)。`GET /api/sessions/:id/subagent-tasks`(轮询) · `GET /api/subagent-tasks/:id` · `POST /api/subagent-tasks/:id/abort`(subagentRuns map kill)。
  - **回流 = 无后端**：前端把"可编辑摘要+060_reports 报告链接"作为一条**普通消息发给主 session**(现有 onSend/gateway send)，主当 user turn 整合。这是"主只吃结论不吃过程"的关键，也是为何无需 reflux 端点/WS。
  - **标准目录**：fork/子 agent 同属当前任务 → 读 `standardDirIn(sessionDir(root,主sessionId),"clean_data")`、写 `...,"report"`(060_reports)；产物自动进右侧成果面板。注意 standardDirIn 的 folder 名是 `clean_data`/`report`(非 clean/reports)。
  - **⚠ 未运行时实跑(待 X+E 联调点检)**：① pi `--fork <父> --session-id <分支>` 组合是否把父历史播种进指定分支 id(若 pi 自生成 id 则偏差) ② 子 agent `-p` 单轮是否如期用工具读数据/写报告到 060_reports、末条摘要捕获是否命中 ③ 分支 messages/runtime 复用顺滑度。
- **actions 行动闭环契约**（总控持有，V 域同源）：表在 `db/viz.ts`(action_items/action_tasks/action_feedback，FK CASCADE)、路由在 `routes/viz.ts`(`/api/actions/extract` 经 pi + `/api/action-items`·`/api/action-tasks`·`.../:id/feedback` CRUD)、前端 `ActionsPane`(探索「行动」subtab)。**契约单一真源铁律**：`ActionItem/ActionTask/ActionFeedback/ActionItemDraft` 等只在 `types.ts` 定义(双侧)，`db/viz.ts` 与 `lib/api/viz.ts` 一律 import 引用、**禁止本地重声明**（V 首版曾各自重声明致漂移，已收敛）；api/viz.ts 用 `export type {...} from "@/types"` re-export 供 ActionsPane 消费。**enum = 中文规范标签**：`ActionScene="开业"|"日常"|"假日"|"大促"`(单店模型场景)、`ActionLifecycle="A获取"|"A激活"|"R培育"|"R复购"|"R裂变"`(会员 AARRR SOP)——直接用中文字面量做 union，LLM 返中文即 enum、UI 直接渲染，**省掉 label 映射层**；后端 extract 须约束 LLM 取值 + 归一化(非法→省略)，三表 scene/lifecycle 为 `TEXT NOT NULL`→空值存 `""`、parse 回 `undefined`。**未来接入点**：`ActionItem.metricRef` 关联 `metric_definitions`(D 语义层，P2)、行动项↔`onto_actions` 可执行动作目录桥接(下轮)。

---

## 二·五、deleteWorkspace 漏删子表 + 测试污染真实库（2026-06-13 修）

> 🚫 **「deleteWorkspace 全量补齐」已放弃（2026-06-27）**：对应 wiki 卡已删除、不再做。「侧边栏清爽」诉求改由**工作区归档**满足（归档=标记位隐藏、不删任何数据、零风险，X-ARCHIVE0/E-ARCHIVE1 已上线，见 §八之后归档实现 / wiki CHANGELOG）。下方的缺口重盘点（53 表/漏 27 硬 FK + origin 语义三选项）**仅留作 schema 参考**：若将来确实要做物理删除（如清理磁盘/合规删档），这份盘点是起点，但当前**无对应待办**，勿当 TODO 误读。

- **症状**：UI 删工作区报错/删不掉（删除按钮在行 hover 才显示，但点了也 500）。根因 = `deleteWorkspace` 抛 `FOREIGN KEY constraint failed`：它没清掉所有带 `workspace_id` 外键的子表。**已补 `token_usage_stats` + `token_usage_daily_stats`**（每个用过的工作区都会累积 token 统计，不补则任何用过的工作区都删不掉）。
- **⚠ 仍不完整（2026-06-27 重新盘点，原"11 张"清单已严重过时）**：当前 schema 共 **53 张**带 `workspace_id` 列的表，其中 **43 张有硬 FK `REFERENCES workspaces(id)`**（真正阻断删除）。`deleteWorkspace` 现仅处理 16 类，**仍漏 27 张硬 FK 表 + 7 张孤儿表**。
  - **现已删（16）**：sessions·workspace_paths·workflow/memory/skill/tool_evaluations(+results)·skill_eval_sets·tool_case_sets·skill_curation_proposals·memory_proposals·memory_usage_stats·rule_conflicts·memory_failure_attributions·flows(经 deleteFlow→flow_messages/flow_runs)·token_usage_stats/daily。
  - **缺口 A·硬 FK 阻断（27 张，真 bug「删不掉/500」）**：
    - ⚠️ **记忆重构(新)**：`memory_items`(核心记忆库)、`memory_reviews` —— **原笔记"memory_* 已处理"是 clean-slate 重建前的过时说法**；这俩是重建后主表，FK 阻断 → **任何存过记忆的工作区现在都删不掉**（最普遍的现行阻塞，可先热修止血）。
    - **数据/语义(卡内)**：analysis_cases·analysis_standards·business_contexts·metric_definitions·ontologies(+嵌套 object_types/property_types/link_types/logic_rules/onto_actions)·onto_prompts·rule_memories·hypothesis_library·dashboards·change_proposals·trace_events。
    - **监测/体检(新)**：monitor_configs·monitor_runs·monitor_metric_systems（monitor_findings 已 `ON DELETE CASCADE` 随 runs 走）·health_runs。
    - **知识库(新)**：knowledge_docs(+ knowledge_chunks 子表，无 cascade，须先删)。
    - **prompts 池(新)**：prompt_templates。
    - **4 类新 eval(新)**：command/hook/prompt/subagent_evaluations（各带 `*_results` 子表，须 results 先删）+ 对应 command_case_sets/hook_eval_sets/prompt_eval_sets/subagent_eval_sets。
  - **缺口 B·孤儿行（7 张，无硬 FK 不阻断删除但留垃圾）**：anax_gate_config·kg_nodes·kg_edges·skill_registry·skill_registry_eval_history·workflow_favorites·**workspace_memory_enablements**（无 FK 但 origin 语义**必须**清，否则留下指向已删工作区的启用记录）。
    - **缺口 B·补登（subagents 进阶 2026-06-27，3 张，无硬 FK）**：`composite_subagent_runs`（parent_session_id 关联，**无 workspace_id 列**）·`flow_node_runs`（flow_run/flow 关联，无 workspace_id）·`subagent_blackboard_entries`（有 workspace_id 列但无 FK）——删 workspace 连带删 session/flow 后均留孤儿；按现政策（归档替代物理删除）**无待办**，仅备登。
  - **三个结构性难点**：① 嵌套删除顺序（ontologies 子表 / 4 类 eval 的 results / knowledge_chunks 须子表先删）；② `deleteWorkspace` **无事务包裹**（裸 DELETE 串，中途 FK 失败留半删状态）→ 补全须 `db.exec("BEGIN"/"COMMIT"/"ROLLBACK")`（node:sqlite 无 `.transaction()`）；③ **枚举式天然脆弱**——每新增一张 `workspace_id` 表就静默重现此 bug（本次过时即明证），更耐久修法待评估：建表统一 `ON DELETE CASCADE` / 维护"工作区级表"中央清单做通用 `DELETE WHERE workspace_id=?` / 加 schema 自检测试遍历断言覆盖。
  - **P0 阻塞·全局池 origin 语义（仍未拍板，范围由 6→8 张）**：池化表现为 metric_definitions·rule_memories·memory_items·analysis_standards·analysis_cases·business_contexts·ontologies·**prompt_templates·knowledge_docs**（后两张卡后新池化）。删 origin 工作区时三选一须先定：(a) 连带删全局定义(他工作区会丢内容) / (b) 仅删 enablement 保定义为孤儿 / (c) 改派 origin 给其他工作区；无论哪个都要同步清 `workspace_memory_enablements`。**勿盲目补 DELETE，先定语义。**
- **测试污染真实库（已修）**：`multi-agent-runner.test.ts` 预算用例 `createWorkspace("runner budget stop")` 曾静态 import db.ts、未隔离 → 多次跑测试在真实 `~/.pi-xanthil` 堆了 12 个测试工作区。**已按 memory-injection.test.ts 范式修**：import 任何经 cache→db 的模块前先 `process.env.XANTHIL_DATA_DIR = mkdtempSync(...)` + 动态 import。**铁律：任何 *.test.ts 在碰 db.ts 前必须先设临时 XANTHIL_DATA_DIR，否则污染真实库**（db.ts 在 import 期即按 env 打开 DB_PATH）。已清掉 12 个污染工作区（经 API/直连，保留森马会员）。
- **测试污染真实库再发（2026-06-29 已清理）**：`metric-injection-trace.test.ts` / `okh-metric-import.test.ts` / `okh-metric-ontology-link.test.ts` / `business-context-governance.test.ts` / `okh-full-acceptance.test.ts` 因 ESM static import 在设置 env 前加载 `db.ts`，在真实库写入 337 个 archived 测试工作区及其 metric/businessContext/ontology/trace/enablement 子记录。已改成 `process.env.XANTHIL_DATA_DIR = mkdtempSync(...)` 后 `await import("./db.ts")` / `await import("./db/data.ts")` / `await import("./db/viz.ts")`，并清理真实 `~/.pi-xanthil/xanthil.db` 污染记录，保留 `会员` 与 `收集（全局）`。**补充铁律**：凡测试会 import `db.ts` 或调用 `createWorkspace()`，必须在动态 import 之前设置临时 `XANTHIL_DATA_DIR`；ESM static import 不能保证隔离生效，禁止用于会触发 `db.ts` runtime 初始化的模块。

## 三、本机已知坑（pi 侧，非本项目 bug）

- 扩展 `ptk-memory-inject` 的 better-sqlite3 NODE_MODULE_VERSION 不匹配 → 本项目选 `node:sqlite` 免疫原生编译坑。
- 默认 model `volcengine-plan/deepseek-v4-flash` 报 `developer` role 400 → 跑真实对话前需切模型。
- `runPiPrompt` 用 `--no-skills`，**勿用 `--no-extensions`**（禁用 provider 扩展致 LLM 调用失败）。
- **`runPiPrompt` 超时根因（2026-06-11 实测取证）**：一次性纯文本补全若不带 `--no-tools`，pi 每次都加载完整 agent 环境（工具 schema + MCP + 扩展）——极简 "回复ok" 就吃 **28738 input tokens**；叠加文档正文 + thinking 模型（如 `minimax-cn/MiniMax-M3` 的 `<think>` 长推理）→ 真实抽取轻松 >90s 触发 `pi prompt timed out`。**修复 = 加 `--no-tools --no-context-files`**（保留 provider，input ↓92% 至 ~2.3k）+ 放宽超时（默认 180s）。已落地于 `pi-adapter.ts:runPiPrompt`；调用方按需传 `timeoutMs`（抽取类建议 ≥120s）。坑：`--thinking off` 对 MiniMax-M3 实测**无效**（模型仍输出 `<think>`），故解析侧需 `text.replace(/<think>[\s\S]*?<\/think>/gi,"")` 再扫 JSON（见 `onto-extract.ts:parseExtractJson`）。
- `node:sqlite` 的 `DatabaseSync` **无 `.transaction()`**（那是 better-sqlite3 API）→ 事务一律用 `db.exec("BEGIN")` / `"COMMIT"` / `"ROLLBACK"`（db.ts 既有范式）。
- **循环 import 下模块级 const TDZ 坑（2026-06-12 实遇）**：`db/shared.ts` ←→ `db.ts` 互相 import；`db.ts` boot 期(顶层)调 `backfillMemoryEnablements()`。若 `index.ts` 在 `db.ts` import **之前** 直接 import `db/shared.ts`（如我加 fork/subagent 函数时），会让 `db/shared.ts` 先开始求值、在 `import db.ts` 处暂停 → `db.ts` boot 调用早于 `db/shared.ts` 的模块级 `const` 初始化 → `ReferenceError: Cannot access 'X' before initialization`（typecheck/build 全绿，仅运行时炸）。**规避**：被 boot 期跨模块调用的函数，其依赖的数据**用函数内局部 const**（非模块级 const），与 import 求值序解耦。教训同「终审须加运行时实跑」——纯静态检查抓不到。

---

## 四、UI 导航台账（接缝层归总控，2026-06-10 快修批）

导航 = 接缝层，改动只在总控 slot：一级 tab `MainHeader.TABS`（`Tab` 类型）；二级 tab `lib/constants.ts` 各 `*_SUB_TABS` + `getSubTabsForTab`；渲染分发 `tabs/{DataTabs,EngineTabs,VizTabs}.tsx`；布局/二级条/侧栏在 `App.tsx`。

**一级 tab 现序**：探索 · 工作流 · 计算工具 · 规则记忆 · **实验室** · **Xan数据库** · Dashboard · **onto-xanthil**。
- `anax` 一级 tab 已**移除**（并入实验室）；`onto_xanthil` 已落地（**已移出 `VIEW_ONLY_TABS`**，`ONTO_SUB_TABS` **8 子tab：说明/对象/关系/指标/逻辑/动作/图谱/导入**；pane=`OntologyPane`，渲染分发在 VizTabs；默认子tab `onto_readme` 在 `App.tsx handleTabChange`）。
  - **二级 tab 全部以左侧竖栏呈现**（2026-06-10，仿 AnaX 范式）：`App.tsx` 顶部二级条对 `onto_xanthil` 隐藏（`activeTab !== "onto_xanthil"` 守卫），改在内容区左侧渲染 `ONTO_SUB_TABS` 竖栏（`isVisible` 过滤，与 AnaX `LAB_ANAX_SUB_TABS` 同款样式）。`onto_logic`/`onto_actions`(P6) + `onto_readme`(说明页，纯静态文档，无需 workspace/本体即可看) 三子tab 后加。
  - **⚠ 坑：内容区 pane 必须自带 `overflow-y-auto`**。内容容器是 `min-h-0 flex-1`（弹性高度），pane 根若无滚动样式，超出视口的内容会被**直接裁切**（无滚动条）。`OntologyPane` 曾因此 readme 长内容看不到下半屏 → 根包一层 `h-full min-h-0 flex-1 overflow-y-auto` 修复。新建长内容 pane 一律加此外壳。

**实验室（research_lab）= 两级嵌套**：
- 顶部横向 `LAB_SUB_TABS` = workflow/skill/tool/model/DLF/**AnaX**（AnaX 顶部 tab id 复用 `anax_view`）。
- 仅当 `activeSubTab ∈ LAB_ANAX_SUB_IDS`（anax_view/hypothesis/change_mgmt/readme）时，`App.tsx` 在内容区左侧渲染 `LAB_ANAX_SUB_TABS` 竖栏；顶部 AnaX tab 在任一子项激活时保持高亮。复用单一 `activeSubTab`，无额外状态。AnaX 4 pane 渲染条件已迁到 `research_lab + 上述子 id`（EngineTabs）。
- **`document_eval`「文档评测」第 7 个测评台（E-QEVAL2，2026-06-26 接缝追认）**：E 卡接线时在 `constants.ts`（接缝层·总控 slot）加了 `document_eval` 到 `SubTab` union + `LAB_SUB_TABS` + `LAB_SUB_IDS`。**总控裁决：追认**——足迹严格遵循既有 lab-subtab 范式（与 prompts_lab/command_lab 同构、三处同步），是接 lab 子栏的唯一方式，回滚等于删能跑接线再原样重写（纯 churn）。同模板库前端接缝追认先例（§六）。渲染分发在 `EngineTabs`（`aggregate + document_eval` → `DocumentEvalPane`），`App.tsx` 左竖栏靠 `LAB_SUB_IDS` 既有泛型逻辑自动拾取、无需改。**后续同类「pane→后端」接线 E 仍应先报口径由总控加 constants enum。**

**规则记忆（rule_memory）9 项**：6 大记忆模块（`rules`偏好 / `indicators`指标 / `cases`项目 / `failure_memory`失败 / `field_memory`字段 / `process_memory`流程）+ 业务环境/trace/知识图谱并列。`token_stats`/`quick_notes`（随手记）为 header 按钮跳转的隐藏子页，不入二级条（沿用 token_stats 既有范式）。

**新增占位 subtab**（脚手架，后端待补）：`tool_use` `failure_memory` `field_memory` `process_memory`；均用 `Placeholder` 组件。

**已实现（2026-06-10 快修）**：`quick_notes` 随手记 = `components/QuickNotesPane.tsx`，仿 `wiki.html` 随手记的纯前端 localStorage 实现（key `xanthil-quick-notes`，笔记 `{id,text,ts}`）——保存 / ⌘·Ctrl+Enter / 勾选合并复制（未勾选则全部）/ 删除 / 导出导入(按 id 去重合并)。零后端、零 LLM。

**探索·工作视图红线只读栏**：`App.tsx` 在 `explore + view` 内容区左侧挂 `CleanDataDocsColumn`（聚合数据只读+复制，详见 `notes-data` 红线范式）。

**探索 subtab 序（2026-06-12）= 独立 `EXPLORE_SUB_TABS`**：业务需求·原始数据·聚合数据·数据探索·**数据分析**(=`view`,原名「工作视图」)·报告输出·汇报版本·报告审核·黄金策·**行动**(`actions`)。**关键：explore 与 multi 曾共用 `SUB_TABS`(getSubTabsForTab fallthrough)，但 `view` 在两 tab 渲染不同**(explore=`CleanDataDocsColumn`聚合文档列；multi=`FlowListColumn`工作流列表) → 改名/重排只对 explore：新增 `EXPLORE_SUB_TABS` + `getSubTabsForTab` 加 `if(tab==='explore')` 分支；**multi/工作流仍用 `SUB_TABS`**(view=「工作视图」保持首位不变)。`actions` 已加入 `SubTab` union + 两份列表。`App.tsx handleTabChange` 探索默认子 tab 仍为 `view`(现「数据分析」)。改探索 subtab 改名/排序走 `EXPLORE_SUB_TABS`，勿动 `SUB_TABS`(会波及工作流)。

**左侧主栏改造（2026-06-11）**：`Sidebar.tsx` 现仅 工作区 / **任务**（原「探索」会话区重命名，一个会话=一个任务）两区。① **精选收藏下线**：删侧栏区块 + 工作流行收藏星标按钮 + `App.tsx` 的 favorites state/handler/bootstrap（`noUnusedLocals` 要求）；后端 favorites 表/路由/api 方法**保留休眠**（未删，可恢复）。② **工作流列表移出主栏** → 迁入「工作流·工作视图」内容区左竖栏 `components/FlowListColumn.tsx`（选择/新建/重命名/删除，可收起，排除 AnaX 模板派生 flow），在 `App.tsx` `multi + view` 渲染。Sidebar 的 flows/favorites 相关 props 已删。"跑工作流也建任务" 暂为人工约定（用户定，未做 flow↔task 自动联动）。

**decision 一级 tab（接缝层占位，2026-06-11）**：`MainHeader.Tab` 含 `"decision"`、`constants.SubTab` 含 `decision_board/workbench/assistant/review`（仅类型字面量，为 `DecisionTabs.tsx` 转绿）。**但 `TABS` 数组未加 decision 项、无 `DECISION_SUB_TABS`/`getSubTabsForTab` 分支、`App.tsx` 未渲染 `DecisionTabs`** → 该 tab 当前不可达。导航/渲染接线 = 已派卡（wiki TASKS dom=X），owner 总控续做；功能落地 P2–P5 见 `docs/decision-intelligence-plan.md`。

**已知小回归（非阻断）**：AnaX 内层子项（假设库/变更管理/readme）不在 `getSubTabsForTab(research_lab)` 中 → SettingsModal 不能单独隐藏（AnaX 已降为二级，可接受）。

---

## 五、数据分析 tool-use spike 结论（Phase 2a，2026-06-12 取证）

> 目标：让数据分析 pi 对话（ChatPane）能调用已注册 `ExtractionTool`。spike 先行（wiki X 卡要求），结论如下，**改变了原卡「skill+bash」的暂定机制**。

**1 · pi 工具模型（`pi --help` 取证）**：内建工具 `read/bash/edit/write`；另支持 extension/custom tools + **MCP**（`pi list` 显示已装 `pi-mcp-adapter`）+ skill（`--skill <SKILL.md>`，纯指令非工具）。工具开关：`--no-tools` / `--no-builtin-tools`（禁内建保扩展/custom）/ `--tools`(allowlist) / `--exclude-tools`(denylist)。已装 `pi-sandbox` 扩展（可约束文件访问）。

**2 · 数据分析 session 现状红线姿态（`handleSend` index.ts:5536 取证）** ⚠️：
- `runPiTurn({ workspaceRoot: ws_.rootPath })` → **cwd = workspace 根**；内建工具**全开**（未传 `--no-tools`）。draw_data 物理在 `<root>/sessions/<id>/010_raw`（见 `workspace-dirs.ts:FOLDER_DIRS`）。
- 红线保护 = **路径不披露（behavioral）**：`buildRegisteredPathContext`(output-paths.ts:98/101) 显式排除 draw_data 路径、只给 clean_data/report **路径**；pi 靠内建 `read` 读这些路径来分析、写报告。
- 推论：保护**非硬沙箱**——pi 有 bash/read + cwd=root，理论上能 `ls`/`find`/`cat` 到 `sessions/*/010_raw`（draw_data）。属**既有潜在敞口**，靠"不告诉 pi 路径 + 不指示读"维持。**session 离不开内建 read/write**（读 clean_data、写报告），故不能简单 `--no-builtin-tools`。

**3 · 桥机制结论**：
- ❌ **skill+bash 不安全**：skill 让 pi 用 bash 跑工具二进制，且 bash 本就能读 draw_data。否决。
- ✅ **推荐 MCP**（`pi-mcp-adapter` 已装）：建一个 server 侧 MCP server，把 AI 可调 `ExtractionTool` 暴露为 MCP tool；handler 走既有 `/api/extraction-tools/:id/run` 并带 `source=ai` 来源标记。pi 经 MCP 调用；tool_call/tool_result 走 MCP 事件（PiEvent catch-all `{type:string;...}` + `turn_end.toolResults` + content `tool_use/tool_result` 可渲染）。
- **2026-06-13 更新**：原后端 clean_data 守卫已按用户红线政策移除；当前红线是禁止原始行/明细直接进 LLM，工具聚合/衍生产物可回流。

**4 · 决策（2026-06-12 用户拍板）**：① 桥机制 = **MCP**（确认，非原卡 skill+bash）；② 既有内建工具潜在敞口 = **单列独立红线卡**（wiki TASKS 已开「红线硬化·独立议题」，与本卡解耦）。

**5 · pi-mcp-adapter 接口取证（实现地基）**：
- 读 `.mcp.json`(cwd) / `~/.pi/agent/mcp.json`(全局) / `~/.config/mcp/mcp.json`；格式 `{mcpServers:{<name>:{command,args,env?,url?,directTools?}}}`(标准 MCP)。提供 proxy tool(~200 tokens)按需发现，server 用时才启。
- 全局 `~/.pi/agent/mcp.json` 已有多 server（context-mode/minimax/sqlite/filesystem→/Users/huangbo/Dev 等）。**注**：那个 `filesystem` MCP(directTools) 也能读 ~/Dev 任意文件 → 同属上述独立红线卡范围。
- **MCP SDK 不在本项目依赖**（pi 全局有，项目树无）。stdio MCP 协议仅 `initialize`/`tools/list`/`tools/call` 三 JSON-RPC 方法 → **决策：手写零依赖 stdio MCP server**（不加 `@modelcontextprotocol/sdk`，契合 onto-export 零依赖先例 + §十 不装未确认依赖）。

**6 · 实现（✅ 已落地 2026-06-12，总控自做+自检；server typecheck + web build + 隔离 grep 全绿）**：
- (a) ✅ `server/src/mcp/extraction-tools-mcp.ts`：手写**零依赖** stdio MCP server（JSON-RPC initialize/tools-list/tools-call/ping，newline-delimited）。纯 stdio→HTTP 代理，自身不读数据文件；`tools/call` → POST `/api/extraction-tools/:id/run` 带 `source=ai`。冒烟测 initialize/ping 通过；tools/list·call 需活体 API + pi 实跑。
- (b) ✅ `index.ts` `/run` 曾加 `source=ai` clean_data 守卫；2026-06-13 红线政策已反转，当前 `/run` 不再按 clean_data 白名单拦输入，`source=ai` 仅作来源标记，详见 §五.7。
- (c) ✅ 注册 = **每工作区 .mcp.json**（用户决策）：`server/src/mcp/register.ts:ensureWorkspaceMcpConfig`（合并写、保留他 server）在 `createWorkspace` 调 + 启动 `registerAllWorkspaceMcp()` 回填既有工作区。pi-mcp-adapter 读 cwd=workspaceRoot/.mcp.json → 工具仅在该工作区数据分析 session(handleSend cwd=ws.rootPath) 可见。
- (d) ✅ 契约：tool 事件走 PiEvent catch-all `{type:string;...}` + `turn_end.toolResults`，**未改 types.ts**（无新 WS union）。
- (e) ✅ E helper skill（Phase 2b）：`skills.ts:ensureExtractionToolSkill` 生成 `.pi/skills/xanthil-extraction-tools/SKILL.md`（列工具 + Contract「经 workspace MCP server 调、入参 cleanDataPath」），**指向 MCP 的引导 skill，非竞争桥、不教 bash**。**总控决策：不自动注入 runPiTurn**（MCP proxy 已可按需发现），保持 SkillSelector 可选；E 当前「可发现、未自动注入」即正确。小注：写文件在 listSkills 读路径(幂等+try/catch，可接受)。
- (f) ✅ **AI-safe 工具分类契约（2026-06-12 E 代笔，总控口径）**：`ExtractionTool.category?: "ingestion" | "analysis"` 双侧同义；缺省/非法值保守归一为 `ingestion`。`ingestion`=吃原始源文件的摄取型工具（如 .html/原始 Excel/PII 清洗），永不进 AI/tool-use；`analysis`=只读已备好的 clean_data 聚合数据，可被 AI 调用。MCP `tools/list` 和 `tools/call` 统一走 `isAiExposed(tool)`，当前条件仅 `category === "analysis"`；D 卡若接入 `enabled`，只把该函数改成 `category === "analysis" && enabled`。`GET /api/extraction-tools` 不过滤，消费方各自按 category 决策。
- **待实跑点检**（typecheck/build≠功能）：pi↔MCP 活体握手(pi-mcp-adapter 起 server / tools 发现) + AI 调工具经 `/run source=ai` 放行 draw_data 路径 + E 卡 ChatPane tool 渲染。

**7 · I4 决策更新：AI 可调工具输入放开，禁原始行直进 LLM（2026-06-13 用户红线政策决策）**——原“守卫单点拦 draw_data”已被政策反转。结论：
- **AI 路径**：MCP → `/run source=ai` 仍作为来源标记，但 `/run` 不再按 clean_data 白名单拦输入；AI 可调工具可读取已登记数据路径。
- **新红线**：`draw_data` 原始行级内容/明细禁止直接进 LLM；经注册工具处理后的聚合/衍生产物（不含原始行）允许进 LLM。
- **工具责任**：工具对其产物是否含原始行负责；禁止把 `draw_data` 原始行/明细整体回灌 LLM。`validateExtractionInput()` 仍保留格式与工具输入契约校验。
- **不变边界**：数据探索模块（`DataExplorationPane` 及其子树）纯前端零 LLM 的硬约束不变，绝不可动。

**8 · ExtractionTool registry 加载策略（2026-06-13 用户实跑发现 + E 代笔）**：
- **坑**：`server/tools/registry.ts` 原先模块级 `const tools = loadTools()` / `toolsById` 只在服务启动时加载一次；`tool.json` / `.py` 是 `readdirSync` 读取而非 import，`node --watch` 不会因工具目录增删自动重启；tool-use 控制台“刷新”只重发 GET，后端仍返回旧快照。
- **决策**：工具数量个位数，扫盘成本可忽略；registry 不做模块级缓存，`listExtractionTools()` 与 `getExtractionTool(id)` 每次调用实时 `loadTools()`。
- **影响面**：函数签名/返回类型不变，`index.ts`、MCP server、ToolLab、tool-use 控制台无需改；刷新按钮自然拿到最新工具列表。
- **验收口径**：不重启服务，新增/删除 `server/tools/<id>/` 后点击控制台“刷新”应反映最新工具与分类计数；MCP 经 HTTP 调 `/api/extraction-tools` 同样受益。

**9 · ChatPane `@工具` 人工触发 analysis 工具（2026-06-13）**：
- **定位**：补齐“用户手动指定调哪个工具”的空档，区别于 pi-agent 经 MCP 自主调工具。用户在探索「数据分析」对话中手动选择 `analysis` 工具、已登记数据文件和参数，运行后把结果作为普通消息回流当前 session。
- **实现边界**：E 侧最小闭环，新增 `ManualAnalysisToolCard` 并挂到 `ChatPane` 辅助面板；不改 `index.ts`/`types.ts`/`App.tsx`/`api.ts` 等接缝层骨架，不碰数据探索红线子树。
- **安全路径**：前端只展示 `category === "analysis"` 工具；专用 API 方法 `runAnalysisTool()` 调 `/api/extraction-tools/:id/run` 时强制带 `source: "ai"` 作为来源标记。不要用普通 `runExtractionTool()` 实现该入口，因为它默认是 manual 模式。
- **输入路径决策（2026-06-13 红线政策同步）**：输入选择不再 clean_data-only；`ManualAnalysisToolCard` 读取 workspace 已登记路径并只展示 `draw_data` / `clean_data` 文件，analysis 工具筛选仍不变。
- **输出路径决策**：`outputPath` 固定取当前任务 session 的 `report` 目录（标准 060_reports），UI 只读显示，不再提供多选下拉。复用现有 `api.listSessionPaths(sessionId, "report")`，无需新增后端 output-dir/session-reports 端点，不自动创建 `tool_runs`。
- **回流决策**：先做文本 summary + outputs 路径，可编辑后“发送到对话”；暂不做结构化结果卡、JSON viewer 或产物预览。pi 后续负责解释、整合、写作、下一步规划，不重复工具的确定性计算。

**10 · 数字锁产出侧校验 MetricVerification（2026-06-25，总控）**：
- **问题来源**：D-METRIC1/E-METRIC2/D-METRIC3 把工具/监测的确定性 `MetricSnapshot.value` 注入 LLM，并用 prompt 要求“只解读、不重新推导”。这只是输入侧软约束；若模型把 `12500` 复述成 `12000`，系统原先没有产出侧信号。
- **适用范围决策**：只打 **tool-use 链路**。tool-use 的 `MetricSnapshot[]` 经 MCP tool result 注入，assistant 会在自由文本里复述/解读数值，适合在 `message_end` 后回校。监测链路 `draftMetricSystem` 输出是结构化指标体系设计（metrics/dependencies/monitorRules），不复述 snapshot 数值，无可校数字，本期不碰。
- **契约与核心**：双侧 `types.ts` 增 `MetricVerification{verdict,hits}` / `MetricVerificationHit{name,expected,foundInText,status,relDiff}`；`server/src/metric-verification.ts:verifyMetricUsage()` 只读 `MetricSnapshot[] + answerText`，正则提数并归一千分位/小数/`万`/`亿`/百分比。容差首版固定：`relDiff <= 0.5%` → `matched`；`0.5% < relDiff <= 20%` 且同量级 → `suspect`；其他数字视为无关；没出现 → `unreferenced`；任一 suspect → `verdict="mismatch"`。
- **接入方式**：`server/src/metric-verification-events.ts` 从 `tool_result` / `turn_end.toolResults` / MCP 文本块中 best-effort 抽取本轮 snapshots；`index.ts:handleSend` 与 `routes/engine.ts:handleSendFlow` 在同一 turn 局部数组留存，assistant `message_end` 后校验。只有 mismatch 时在同条 assistant message 的 `content` 追加 `{type:"metric_verification", verification}`；前端 `MessageRow` 渲染琥珀色告警。无 snapshot 或 verdict ok 时完全不回传，向后兼容。
- **为什么用 content block**：不新增 `ClientMessage` 字段，不改 WS 顶层协议；沿用 pi content block 的宽松结构，历史消息持久化后也能复现告警。注意 `ChatPane` 的 business/trace 过滤要把 `metric_verification` 视为业务可见 block，否则会被折叠到“执行详情”。
- **安全与行为边界**：校验器不碰 `draw_data`、不读文件、不看 dataset rows；只消费 LLM 已产生文本和已注入的衍生 snapshot。首版只告警，不阻断、不改写、不自动重试；自动纠偏需另设预算和最大迭代，避免误报导致死循环。

---

## 六、工作流改造接缝层（0→1→2，2026-06-13 总控）

**背景**：把工作流模块从「三套重叠执行栈 + 孤儿代码」收敛为「单引擎 + 闭环」。方案 `docs/工作流模块改造方案.md`、派发书 `docs/工作流改造-任务派发.md`、闭环契约 `docs/工作流-onblock契约.md`、backlog `docs/backlog/agent-loop-工作流闭环.md`。闭环全貌见 `notes-engine.md §0`。

**核心铁律（迁路由时必守，已被本轮验证）**：`routes/<域>.ts` **只 import 共享模块**（db/flow-fs/cache/…），**绝不 import index.ts 本地 helper**。否则与 index.ts→engineRouter 形成循环依赖。故迁 flow handler 前，先把它依赖的 index.ts 本地 helper 按"跨域 vs flow-only"分流：
- **跨域 helper**（留下的代码 + 迁走的 handler 都用）→ **抽到共享模块**：`runtime.ts`(send/active-run maps/getActiveChatRun/abortChatRun) · `cache.ts`(trackUsageEvent) · `flow-trace.ts`(traceFlowEvent) · `message-text.ts`(flowMessageText) · `memory-injection.ts`(withRulesPrompt) · `workflow-config.ts`(normalizeWorkflow*) · `workspace-path-status.ts`。
- **flow-only helper**（仅 handler 用）→ 随 handler **搬进 engine.ts**（captureWorkflowFromText/parseWorkflowCandidate/backfill*）。

**接缝模块清单（本轮新建，server/src/）**：
- `runtime.ts` — WS 运行时句柄；**`wss` 不上移**（依赖 http server、仅 index.ts bootstrap 用，YAGNI）。
- `flow-trace.ts` / `message-text.ts` / `workflow-config.ts` / `workspace-path-status.ts` — 纯函数共享。
- `cache.ts` 加 `getRunTokenUsage`/`evaluateRunBudget`/`RunBudgetLimits`（run 级预算原语，读既有 flow_run token 统计，不改累计口径）。
- `sql-loop-template.ts` — SQL 修复 loop 预置模板（E 域内容，但 toolId 常量 `RUN_SQL_QUERY_TOOL_ID` 被 runner 引用）。

**flow 路由/handler 归位**：全部 flow REST + 3 个流式 WS handler 迁入 `routes/engine.ts`；`wss.on("connection")` 派发分支留 index.ts、反向 `import { handleSendFlow, handleExecuteMultiAgent, handleAnaxPrecheck, abortAnaxPrecheck } from "./routes/engine.ts"`。**engine.ts 不 import index.ts → 无循环依赖**。

**execute_flow 双侧解耦发现**：server 与 web 各有独立 `types.ts`，`execute_flow`(死单 agent 路径)的消费(server)与发送(web 孤儿文件)分处两侧 → 删除无需原子同批，各自独立可绿。

**run 预算接线（成本停止条件落地）**：`config.ts` `RUN_BUDGET_LIMITS` 读 env `XANTHIL_RUN_MAX_TOKENS`/`XANTHIL_RUN_MAX_COST_USD`（>0 生效，未设=null 即不限、行为不变）；`routes/engine.ts` handleExecuteMultiAgent 传 `runBudget`。**决策**：env 可选优于硬编码魔法上限（避免误伤大 run）优于 DB 配置（过重）；per-workspace 限额 + UI 留待按需。

**flows/:id/import(multer) 迁移（2026-06-13 完成）**：原以为 multer 基建多路由共用、需先抽共享；核查发现 `upload`/`uploadDirs`/`_uploadId` **仅该路由用**（`/api/bi-datasets/upload` 用自己内联的 `multer({...}).single`）→ 直接随路由整块搬进 `routes/engine.ts`（engine.ts 加 `import express, { Router }` + `import multer` + UPLOAD_TMP_ROOT/moveAllFiles）。端到端上传冒烟通过。**教训：迁移前先 grep 确认"基建是否真共用"，别想当然。**

**收官（2026-06-13）**：`anax-gate-config`(GET/PUT) 也已迁入 routes/engine.ts。**至此 index.ts 已无任何 flow/anax 业务路由**——工作流改造接缝迁移彻底完成。index.ts 仅余 legacy 非工作流路由(session/workspace/onto/bi/eval 等)与 wss.on bootstrap。

**模板库前端接缝·总控追认（2026-06-14，总控亲核）**：工作流模板库入口（wiki E 卡）上线时 E 接线碰了接缝层骨架。**总控 grep 核实**实际足迹**仅 2 处**，且评审点名的 `constants.ts/EngineTabs/DataTabs` 确未动（越界被高估）——证据：① `web/src/App.tsx:423` `instantiateWorkflowTemplate` handler（按 `template.id` 分发到 3 个 api 方法）+ `:837` 传 `onInstantiateTemplate` 给 `FlowListColumn`，与同处 `onNewFlow`/`onRenameFlow`/`onDeleteFlow` 同构；② `web/src/lib/api.ts:346-359` `legacyApi` 加 3 个 REST wrapper（`instantiateAnax`/`instantiateAnaxQuick`/`instantiateSqlLoop`），与既有 instantiate 方法同模式；③ `grep "template" constants.ts`=空、`EngineTabs/DataTabs` 无 template 渲染（未加 subtab/pane，模板实例化走 FlowListColumn 按钮）。**总控裁决：追认，不回滚**——足迹最小且严格遵循既有 seam 惯例，回滚等于删能跑的接线再原样重写（纯 churn）。后续同类「pane→后端」接线 E 仍应先报口径由总控加，但本次既成事实合规，正式归入接缝台账。（注：本段原由 D 在 hooks 卡2 工作中顺手写入，内容属实，已由总控核验并改以总控名义持有。）

---

## 七、LLM 管理后端真源（2026-06-16）

**归属与边界**：`/api/llm*` 属 shared/infra 总控 slot，后端落 `server/src/routes/shared.ts` + `server/src/llm-config.ts`。该能力直写 pi 全局真源 `~/.pi/agent/{models.json,settings.json}`，读取 `auth.json` 授权态；不得下沉到 data 路由，也不得绕过 `llm-config.ts` 直接写 pi 全局文件。

**真源结构**：
- `models.json`：`providers.<id>` 为 provider 配置，兼容 provider 级 `baseUrl/api/apiKey` 与 model 级 `baseUrl/api/apiKey` 两态。
- `settings.json`：本模块只维护 `enabledModels/defaultProvider/defaultModel`，`packages` 等其他键必须保留。
- `auth.json`：只读；OAuth 凭证归 `pi auth`，控制台不写 access/refresh/accountId，也不向 OAuth provider 写新 key。

**apiKey 安全铁律**：
- GET provider view 只出 `hasApiKey:boolean`，永不返回 `apiKey`。
- PUT provider 时 `apiKey` 为空、缺省或 `"****"` 均保留旧值；非 OAuth provider 的非空新值才覆盖；OAuth provider 忽略新 key。
- `testProvider()` 只在 server 内取有效 key 调 `/models`，返回 message 前必须 `replaceAll(key, "****")`。
- auth view 只返回 `{providerId,type,authorized:true}`，禁止返回 access/refresh/accountId。

**写入约束**：
- 所有 `models.json` / `settings.json` 写入必须经 `atomicWriteJson()`，即 temp 文件 + rename；写 `models.json` 后还原旧权限位。
- provider/model unknown fields 以旧 raw 为基底浅展开保留，避免前端表单往返误删 pi/OAuth/provider 扩展字段。
- provider 校验：当前 `LlmApiKind` 只允许 `"openai-completions"`；provider 级无 `baseUrl` 时，每个 model 必须有自己的 `baseUrl`，否则该 model 没有有效测试/调用地址。
- settings 校验：`enabledModels` 必须形如 `provider/model`；default provider/model 必须成对出现，且存在于 `models.json`，否则 400。

**测试/验收口径**：
- `npm run typecheck` 与 `npm run build` 必须绿。
- HTTP smoke 用 `XANTHIL_PI_MODELS/XANTHIL_PI_SETTINGS/XANTHIL_PI_AUTH` 指向 `/tmp` 隔离文件，避免碰真实 `~/.pi/agent`。
- 必测：providers/auth 无明文 key；PUT 往返保留旧 key/未知字段/model 级 `baseUrl`；settings 只改三键；错误 baseUrl 的 test 返回失败且不含 key。

**未来扩展**：新增 api 类型时，`types.ts` 的 `LlmApiKind`、`llm-config.ts` 的 `SUPPORTED_API_KINDS`、`coerceApiKind()`、`testProvider()` 分支必须同步扩；否则会出现 UI 能保存但 testProvider 不会测的漂移。

---

## 八、文档质量评测契约（X-QEVAL0，2026-06-26 总控自做）

**背景**：eval_plugin 盘点（2026-06-25）→ Python `eval_plugin` 移植为 TS。本卡=接缝契约先行，解锁 **D-QEVAL1**(runner) / **E-QEVAL2**(lab)。与现有六类评测（prompt/command/hook/skill/subagent/tool）并列，**不破坏、不混入**任何现有 `*-evaluation-runner.ts`。

**已交付（仅加法，不改现有业务代码）**：
- **双侧 `types.ts`** 4 类型（`HookEvaluationDetail` 后、`EvaluationArchiveResult` 前，字面一致）：`DocumentEvalRuleResult`{ruleName,passed,score,detail} · `DocumentEvalCase`{id,name,domain,reportPath,rubrics[]} · `DocumentSessionMetrics`{totalTokens,totalCost,subagentCount,wordCount,costPer1kWords} · `DocumentEvalResult`{caseId,ruleResults[],ruleTotalScore,judgeScore,judgeDetails[],combinedScore,consistencyAlerts[],sessionMetrics?}。`domain` 取 `"mall"|"return_profile"|string`（开放域）。
- **`server/src/document-eval-api.ts`**（HTTP 签名 + 入参校验，对齐 `command-evaluation-api.ts` 范式）：`DocumentEvaluationRunRequest`{cases,model} / `DocumentEvaluationRunResponse`{resultId} / `parseDocumentEvaluationRunRequest()` / `parseDocumentEvaluationCases()`（去重、reportPath 必填、rubric criterion 必填、weight 非有限回退 1）。**只定契约，不注册路由、不实现评测。**
  - `POST /workspaces/:id/document-eval/run {cases,model}` → `{resultId}`
  - `GET /workspaces/:id/document-eval/results/:resultId` → `DocumentEvalResult[]`

**接缝审定（D-QEVAL1/E-QEVAL2 必守）**：
1. **复用 `evaluation-common.ts:runJudge`**（单次 LLM judge）。**3 次取中位数逻辑在 runner 层实现**，勿改 runJudge 本身。
2. **新建 `document-evaluation-runner.ts`** 与现有 `*-evaluation-runner.ts` 并列，独立文件，不混入现有 runner。
3. **不新增 lab 类型枚举**——lab 落点（实验场 subtab/范式 A or B）归 E-QEVAL2 自行判断。
4. 路由落 `routes/`（engine 域），前端 api 方法落 `api/engine.ts`（E slot）——本契约卡均**未碰**，留给下游。

**验证**：server + web typecheck 绿、build 绿，现有业务代码零改动。

---

## 九、Harness 自进化接缝契约（X-HARNESS0，2026-06-27 总控自做）

**背景**：harness 论文集精读两条 backlog —— `EFC-反馈效率度量.md`（arxiv 2605.29682）+ `AHE-可证伪编辑契约.md`（2604.25850）—— 落地。本卡=**接缝契约 + 无-git 回滚预研**，仅定单一真源 + 定签名 + 审定口径，**不实装打分/对照/回滚逻辑**（归 E）。解锁两张 E 卡：**E-EFC1**（EFC 打分器）/ **E-AHE1**（manifest 对照器 + 组件级回滚）。

**已交付（仅加法，零业务改动）**：
- **双侧 `types.ts`**（镜像，插在 `EvaluationArchiveResult` 后、跨 lab 回归看板前，字面一致）：
  - `HarnessComponent`（7 类组件 prompt/command/subagent/hook/skill/memory/tool）—— **刻意独立于既有 `LabKind`**：LabKind=6 个测评台；HarnessComponent=AHE 组件动作空间，**含 memory（非 lab）**，语义不同，禁合并复用。
  - **EFC 侧**：`FeedbackEvent{I,V,R,M∈[0,1],raw}` + `EFC_KAPPA=10`（值导出）+ `TaskDemand{L,H_tool,S_state,N_obs,V_oracle}`（D_task 归一化输入）+ `EfcScore{efc,normalized,eta}`（三视角：原始/EFC÷D_task/EFC÷C_raw）。
  - **AHE 侧**：`ChangeOutcome`（accept/revise/reject/defer，SkillHone 四态升级，原 AHE 只有 verdict）+ `ChangeManifest`（含 `outcomeReason?`/`createdAt`——决策史 ℋ_{<t} 检索需「为何被拒」+ 时序排序）+ `EditVerdict`（四率 + `regressedSolvedTasks`——HarnessX seesaw 无回归门可校验字段）+ `HarnessVariant{variantId,baseEditId,perTaskRouting}`（冲突编辑 fork 变体）+ `ScopedRevision`（typed scoped revision 回滚底座）。
- **`cache.ts` C_raw 只读 getter（总控持有签名）**：`RawComputeUsage{totalTokens,toolCalls}` + `getRawComputeForSession()` / `getRawComputeForRun()`。**纯读既有 token 统计、不改累计口径**；`toolCalls` cache 不采集，由 E 从 trace 传入回填（缺省 0），避免新起采集管线。`prompt-blocks.ts` 本卡未碰（无 block 内容改动 → `PROMPT_SCHEMA_VERSION` 不 bump）。

**对原 brief 字段的两处增补（总控自审，已写死供 E 施工）**：
1. `ChangeManifest` 加 `createdAt:number` + `outcomeReason?:string` —— 把单轮对照升级为可检索经验库（按 createdAt 排序取 ℋ_{<t}，按 outcomeReason 复用「上个方案为何被拒」）。
2. `EditVerdict` 加 `regressedSolvedTasks:string[]` —— HarnessX「确定性 seesaw 无回归门」做成可校验字段（非空=候选回归了已解任务=未过门，比纯回滚严）。

**回滚底座审定（无-git 难点结论，E-AHE1 必守）**：
- **不用 git**：实验场编辑流程无 git（见 px-hotfix/px-wrapup），AHE 的「组件级回滚 / 可证伪提交」缺底座。
- **方案 = typed scoped revision（SkillHone 取向）**，非整体快照回滚：每次编辑落一条 `ScopedRevision`，回退时按 `scope` 定位 offending part 精准还原，**保留同次编辑里其他 useful edits**。`beforeSnapshot/afterSnapshot` 提供精准还原内容，`manifestEditId` 关联根因。
- **持久化落点 = `db/engine.ts`（E slot），schema 实装如下**（按 §四/§五：engine 域表、总控审 schema、注册进 `initEngineTables`）：
  - `harness_edits`（存 `ScopedRevision`）：`edit_id TEXT PK · component TEXT NOT NULL · resource_id TEXT NOT NULL · scope TEXT NOT NULL · before_snapshot TEXT NOT NULL · after_snapshot TEXT NOT NULL · manifest_edit_id TEXT NOT NULL · created_at INTEGER NOT NULL`。索引 `(component, resource_id)` 便于按组件回退、`(manifest_edit_id)`。
  - `change_manifests`（存 `ChangeManifest`，决策史经验库）：`edit_id TEXT PK · component TEXT NOT NULL · failure_evidence/root_cause/targeted_fix TEXT NOT NULL DEFAULT '' · predicted_fix/predicted_regression TEXT NOT NULL DEFAULT '[]'(JSON) · outcome TEXT NOT NULL · outcome_reason TEXT · created_at INTEGER NOT NULL`。索引 `created_at DESC` + `(component, created_at DESC)` 供 ℋ_{<t} 时序/按组件检索。
  - `harness_variants`（存 `HarnessVariant`，E-AHE1 新增）：`variant_id TEXT PK · base_edit_id TEXT NOT NULL · per_task_routing TEXT NOT NULL(JSON) · created_at INTEGER NOT NULL`。索引 `(base_edit_id)`。
  - **⚠ 总控订正审定（2026-06-27，E-AHE1 终审）：三表落地为「全局」表（无 `workspace_id`/无硬 FK），而非我原审定的 per-workspace。** 裁决采纳 E 的全局设计——harness（prompt/skill/tool/hook/subagent/memory 组件）是**项目级资产**（AHE「harness 资产模型无关」本意），change manifest 的 verdict 跨整个测评套件聚合、决策史 ℋ 要跨轮跨任务，绑工作区会割裂经验库。路由亦端到端无 `workspaceId`，设计自洽。原「记得登记 `deleteWorkspace`」**作废**：① 三表无 `workspace_id` 无需删；② 物理删除已于 2026-06-27 放弃改用归档（见 §二·五 开头）。**流程提醒：E 偏离总控审定 schema（per-workspace→全局）未在回报中显式标注，下次改审定 schema 须先报总控复核（§五.1）——本次因纠偏正确予以追认。**
- **E-AHE1 边界**：建表 + manifest 对照器 + scoped 回滚执行；**不碰接缝层骨架**（types/cache 已由本卡定死，引用即可）。**E-EFC1 边界**：四因子打分 + 估计器 ÊFC + η 标量合成；C_raw 经 `getRawCompute*` 取数。

**验证**：server + web typecheck 绿、build 绿，现有业务代码零改动。

---

## 十、产品 Agent 自进化接缝契约（X-EVOLVE0，2026-06-27 总控自做）

**背景**：backlog `生产失败驱动的产品Agent自进化闭环.md`（OpenAI 税务 Agent「失败→eval→约束修改」闭环）落地。前置 E-AHE1 P0 跑通后解冻。本卡=接缝契约，仅定单一真源，**不实装**轨迹持久化/eval 沉淀/注释入口。解锁 **E-EVOLVE1**（引擎：失败轨迹持久化 + eval 自动沉淀，复发 finding 触发）/ **D-EVOLVE2**（监测行动环/report-review 加「采纳·标注失败环节→eval 候选」入口·红线卡）。

**已交付（双侧 `types.ts` 镜像，插在 X-HARNESS0 块后、跨 lab 回归看板前）**：
- `AgentTrajectoryModule`（'monitor'|'anax'|'flow'|'chat'）+ `AgentTrajectoryStep{stage,input,output,citation?}` + `AgentTrajectory{runId,module,steps,outcome:'pass'|'fail'}` —— 失败/对照轨迹，**脱敏后存**（input/output 为聚合/衍生文本，不含 draw_data 原始明细，沿用 E-MONITOR8 口径）。
- `EvalAnnotationStatus`（candidate/confirmed/rejected）+ `EvalRecord{id,sourceFindingId?,failingTrace,expectedOutput,passCondition,annotationStatus,createdAt}` —— failing trace 沉淀的 eval 目标；`sourceFindingId` 关联既有 `HealthFinding.id`（监测真源，string 引用无前向依赖）。
- **bounded-change 规格复用 AHE `ChangeManifest`（§九 X-HARNESS0），不新造。**

**总控增补**：`EvalRecord` 加 `createdAt:number`（原 brief 字段表未列）——持久化排序 + 按 `sourceFindingId` 去重所需，对齐 ChangeManifest/ScopedRevision 范式。

**接缝审定（E-EVOLVE1/D-EVOLVE2 必守）**：
- 表落 `db/engine.ts`（E slot）。轨迹与 eval 记录持久化是否 per-workspace 由 E 按语义定——**注意区别于 §九 harness 表**：EVOLVE 轨迹/eval 绑具体 workspace 的生产运行（monitor/anax/flow/chat run），**应 per-workspace**（与 harness 全局资产不同）；若加 `workspace_id`，按 §二·五 现政策**无需补 deleteWorkspace**（物理删除已弃用改归档），但表设计须自洽。
- **红线（D-EVOLVE2）**：注释入口在监测行动环/report-review，**只读衍生物**（findings/报告/聚合），轨迹 input/output 已脱敏；绝不把 draw_data 原始明细写入 `AgentTrajectoryStep`。
- 路由落 `routes/engine.ts`，前端 api 落 `api/engine.ts`；本契约卡均未碰，留下游。

**验证**：server + web typecheck 绿、build 绿（双侧各 9 处类型引用对齐），现有业务代码零改动。

---

## 十一、记忆老化度量接缝契约（X-AGING0，2026-06-27 总控自做）

**背景**：backlog `AgingBench-记忆老化巡检.md`（arxiv 2605.26302）落地。AgingBench 结论：**即使权重冻结，记忆运营态会随时间退化**，且「行为测试通过≠事实准确」（老化对常规行为测试不可见）。本卡=接缝契约，仅定单一真源，**不实装**探针执行/度量/修复。解锁 **E-AGING1**（Dream Worker 夜间巡检：干扰卡冲突 + 修订回扫 + 反事实探针 + 定向修复建议）/ **D-AGING2**（memory-injection 老化信号：卡冲突检测 + 事实更新回扫）。

**已交付（双侧 `types.ts` 镜像，接在 X-EVOLVE0 块后、跨 lab 回归看板前，字面一致）**：
- `AgingKind`（compression/interference/revision/maintenance = 写 W/读 R/用 U/存 S 四阶段老化）。
- `CounterfactualProbe{id,write,read}`——oracle 替换探针；**论文三档 util 恒 agent，仅 write/read 在 agent↔oracle 间变**（P1=agent/agent · P2=agent/oracle · P3=oracle/oracle），故契约无 util 字段。
- `AgingMetric{halfLife,decaySlope,finalScore + accumulatorError?/interferenceResistance?/forgetAccuracy?/shockDelta?}`——曲线三项必填、按类诊断项可选（仅对应老化类填）。
- `ErrorAttribution{writeErr,readErr,utilErr}`——由 P1/P2/P3 的 Acc 差算（util=1−Acc_P3 · write=Acc_P3−Acc_P2 · read=Acc_P2−Acc_P1）。

**接缝审定（E-AGING1/D-AGING2 必守）**：
- 与 **EFC M_t 记忆信号互补**（X-HARNESS0 §九）：老化巡检可反哺 EFC 的记忆更新质量信号。
- E-AGING1 落记忆 eval/Dream Worker（新建 `memory-aging-inspector.ts`，E-MEM2-DREAM 同源）；D-AGING2 落记忆 store/注入（`memory-injection.ts`、`db/data.ts`、`RulesPane`）。
- **红线（D-AGING2）**：守 AGENTS.md 数据安全，老化信号产出走数据探索隔离 grep。
- **方法论锚点**：修订老化是**表征问题非容量问题**——靠显式状态维护（Typed-State Overlay）而非堆模型规模；先做最痛的「干扰 + 修订」巡检即有价值，反事实探针初期可小验证集人工标 oracle。

**✅ E-AGING1 终审通过（2026-06-27）**：`memory-aging-inspector.ts`（纯函数：干扰检测 similarity≥0.35 / 修订检测 supersedes 链 + 旧引用回扫 / P1-P3 反事实归因 / 老化曲线 halfLife·OLS decaySlope）+ 只读端点 `POST /memory/aging-inspect`（不落库、不调 LLM）+ 前端 `inspectMemoryAging()`。归因公式精确（util=1−Acc_P3 等）、`CounterfactualProbeRun extends CounterfactualProbe`（E 域扩展非重声明）、纯函数无 LLM/draw_data/self-HTTP。测试 18/18（aging 4 + maintenance 11 + eval 3）、typecheck/build 绿。
- **⚠ 总控订正审定**：原写「卡冲突走 D 的 GET、不被 E import」过于理想化。实际 E-AGING1 直接 `import { listMemoryItems } from "./db/data.ts"`，**裁决追认**——① 与既有 `memory-maintenance.ts:12` 同款先例一致（记忆治理 E 侧本就直读 store）；② **老化巡检语义上必须读完整 store（含已退役/superseded 条目）**，走 `memory-injection.ts` 检索过滤反而隐藏巡检要查的失效卡，故直读比走检索 facade 更正确（区别于 notes-engine.md:264「评测走 memory-injection」——那是检索保真口径，不适用老化扫描）。D-AGING2 的 GET 用于前端/跨进程消费，非服务端内巡检。

**✅ D-AGING2 终审通过（2026-06-27）**：`memory-aging-signals.ts`（纯算法：干扰对检测 similarity≥0.35 + reason enum + pairId 稳定排序 + MAX_ITEMS=600 防 O(N²) / 修订回扫 supersedes 链 + 旧引用）+ 只读 GET `/api/workspaces/:id/memory/aging-signals`（routes/data.ts·D slot）+ `RulesPane`「查看老化信号」面板。零 LLM、显式数据安全文档（只读 memory_items 衍生字段、不碰 draw_data/clean_data）、本域消费类型不上提接缝、未碰 E 域。测试 8/8、数据探索隔离 grep 净、typecheck/build 绿。

**⚠ 重叠裁决（D 开放问题⑧ → 总控，2026-06-27）**：E-AGING1 `memory-aging-inspector.ts` 与 D-AGING2 `memory-aging-signals.ts` **各自实现了一套干扰/修订检测算法**（similarity/referencesMemory/isActive/conflict/staleRef ~100 行重复），违反单一真源。**根因**=总控先终审 E-AGING1 时 D-AGING2 未回流，追认了 E 自实现+直读，没预见与 D 本职重叠。**裁决**：D 的检测算法是正源（X-AGING0「D 真源」设计），收敛方案=**总控抽共享核 `memory-aging-core.ts`**（§四 shared helper 归总控），D-signals + E-inspector 同 import、删本地副本、各自只加域层。

**✅ X-AGING-DEDUP done（2026-06-27，总控自做·纯重构）**：新建 `server/src/memory-aging-core.ts`（总控持有，type-only 依赖 `MemoryItem`、零 runtime 副作用），导出 6 原语 `isMemoryActive`/`memorySimilarity`/`sharedMemoryTags`/`memoryReferences`/`memoryTokens`/`jaccard`。E-inspector + D-signals 删各自本地副本、改 import 共享核；E 保留 `hasConflictingSignals`/反事实/曲线/建议，D 保留 `severityRank`/reason enum/截断（域层各自留）。`similarity` 共享版返回未 round（D 口径，E 失去内部 round3 但展示处仍 round3、检测阈值碰撞≈0 行为等价）。**验证**：去重 grep（原语只在 core）、各 test 文件单独全绿（signals 8/8 · inspector 4/4 · maintenance 11/11）、server+web typecheck/build 绿。AgingBench 全链干净收口。
- **✅ 顺带收口预存测试隔离缺陷（§二·五 铁律，2026-06-27）**：`memory-aging-signals.test.ts` / `memory-aging-inspector.test.ts` 原未在 import 前设临时 `XANTHIL_DATA_DIR`——两文件用注入 `items`（纯函数、runtime 不查 DB），但 import 链触发 `db.ts` boot 开真实 `~/.pi-xanthil` 库，**多文件同进程合并跑时 `initSharedTables` 报 `database is locked`**（单文件跑无碍）。已按 `collect-db.test.ts` 范式修：`import type` 保留静态（编译期擦除不触发 runtime）+ `process.env.XANTHIL_DATA_DIR=mkdtempSync(tmpdir/...)` 后 `await import` 被测模块。验证：合并跑 23/23（signals 8+inspector 4+maintenance 11）+ 12/12 稳定无 locked、typecheck/build 绿。同款修 `memory-maintenance.test.ts`（原同样未自设隔离），三个 memory test 文件现各自独立隔离、不靠加载顺序兜底，任意组合合并跑均无 locked（复验 23/23）。

**验证**：server + web typecheck 绿、build 绿（双侧各 4 处 export 对齐）。

---

## 十二、Harness 轨迹级安全审计契约（X-AUDIT0，2026-06-27 总控自做·P2）

**背景**：backlog `HarnessAudit-轨迹级安全审计.md`（arxiv 2605.14271）落地。核心警示「任务完成≠执行安全」——harness 能返回正确答案，途中却越权访问资源/把私有 context 泄漏给错的 agent；违规中途发生、终审查不出；多 agent 放大风险面（SAR 0.91→0.58）。**P2**：随多 agent 协作规模扩大才紧迫（用户授意先解冻、契约先行，捞出前先评估价值是否随规模显现）。本卡=接缝契约，仅定单一真源，**不实装**轨迹日志/checker/SAR 报表。解锁 **E-AUDIT1**（结构化轨迹日志 px-hook-runner + 确定性 access checker Judge + SAR 报表）。

**已交付（双侧 `types.ts` 镜像，接在 X-AGING0 块后、跨 lab 回归看板前，字面一致·8 export）**：
- **harness 形式化 Π/Φ/Σ**：`HarnessPolicy{permissions:Π, infoFlow:Φ, coordination:Σ}` + `RolePermission`（Π·工具三层 required/forbidden/unnecessary + 资源参数白名单 resourceWhitelist）+ `InfoFlowPolicy`（Φ·allowPairs/denyPairs + defaultTopology hub-spoke + leakRules 数据泄露规则）+ `CoordinationPolicy`（Σ·hubRole + requireResultCheck）。**= YAML 策略规约 schema**（E-AUDIT1 将 YAML 解析为此结构）。
- **四类违规 + 度量**：`ViolationClass`（V-OT 工具/V-OR 资源/V-IC 路由/V-ID 泄露）+ `Violation{class,severity:'low'|'high',actingRole,evidence}` + `SafetyAdherence{tool,resource,flow}` 三通道 SAR + `SAR_WEIGHTS{low:0.15,high:0.3}` 常量。

**接缝审定（E-AUDIT1 必守）**：
- 落点 multi-agent/hooks（E：`multi-agent-runner.ts`、px-hook-runner、`health-check-engine.ts` 扩 Judge 钩子）。
- **后验审计、非在线拦截起步**：先记结构化轨迹（append-only JSONL）+ 事后判 SAR 出报表，验证「完成≠安全」真实存在，再谈在线门禁；与多 agent 总控终审互补（终审看产出对错，本机制看途中越权）。
- **先做 V-IC/V-ID（信息流）**：多 agent 跌最狠是信息流(0.58)/资源(0.63)；先审 D/E/V handoff 是否把不该传的产物传给不该收的域；**默认 hub-spoke**（三域不直连经总控中转）。
- 与 Orchestration「冲突协议」互补——冲突协议管冲突，本机制管信息流越权与资源越界。

**验证**：server + web typecheck 绿、build 绿（双侧各 8 export 对齐），现有业务代码零改动。

---

## 十三、监测目标测算接缝契约（X-MONITOR-TARGET0，2026-06-27 总控自做）

**背景**：用户要求监测模块新增“目标测算”，用于全年 KPI（销售/利润等）与大促活动销售测算。总控裁决：目标测算不是观星台的差距发现，而是**监测前的目标生成/推演/拆解**；用户确认后写回监测目标，复用现有 `R-GAP-TARGET` actual vs target 监测。

**已交付（仅契约，未实现 UI/API/公式）**：
- **双侧 `types.ts` 镜像**（放在监测契约块内、`MonitorDatasetBinding` 前）：
  - `TargetScenarioKind = "yearly_kpi" | "campaign" | "rolling_monthly"`
  - `TargetMetricKind = "gmv" | "revenue" | "gross_profit" | "profit" | "orders"`
  - `TargetCase = "conservative" | "baseline" | "stretch"`
  - `TargetPlanStatus = "draft" | "adopted" | "archived"`
  - `TargetAssumptions`：`traffic/conversionRate/aov/refundRate/grossMarginRate/marketingCost/fixedCost/upliftFactor`，均为可选 number。
  - `TargetCalculationInput`：`scenarioKind/metric/periodStart/periodEnd/targetValue/assumptions`。
  - `TargetCaseResult`：三情景结果，含 `requiredTraffic/requiredOrders/requiredAov/requiredConversionRate/gmv/revenue/grossProfit/profit/roi`，可为 `number | null`，避免除零产生 `Infinity`。
  - `TargetBreakdownItem`：`period/case/targetValue`。
  - `TargetCalculationResult`：`cases + breakdown`。
  - `TargetPlan`：`id/workspaceId/name/input/result/status/goalDatasetPathId?/createdAt/updatedAt/adoptedAt?`。

**红线与边界（下游卡必守）**：
- 首版只做确定性测算，**零 LLM**：不得调用 `chat*` / `generate*` / `extract*` / `clarify*` / `runPiPrompt`。
- **零 raw row**：不得读取 `draw_data` 原始行；目标计划只保存用户输入参数、测算结果与聚合目标值。
- 目标测算结果是可复算的衍生产物，adopt 后允许写入 `clean_data/monitor/` 并绑定 `MonitorSourceRole="goal"`。
- adopt 不得静默覆盖既有 `monitor_configs`：必须保留 `suite/ontologyId/metricSystemId/thresholds/source` 等既有配置；已有 goal 绑定时需显式策略（追加/选择/替换确认）。

**下游分工审定**：
- `E-MONITOR-TARGET1`：实现纯函数目标测算与单测；无 IO、无 fetch、无 LLM。
- `F-MONITOR-TARGET2`：新增 `HealthTargetPane` 与 `health_target` 二级 tab；可先本地计算，公式稳定后切 E 真源。
- `D-MONITOR-TARGET3`：目标计划持久化 + adopt 写 `clean_data/monitor/` + 更新 `monitor_configs.datasetBindings(role="goal")`。
- `F-MONITOR-TARGET4`：保存成功后跳转观星台、观星台显示目标绑定状态；不改 `monitor-engine`。
- `QA-MONITOR-TARGET5`：全链验收 + 红线核查。

**建议 API 签名（D 卡落地前仍为契约，不代表已实现）**：
- `POST /api/workspaces/:id/monitor/target-plans`
- `GET /api/workspaces/:id/monitor/target-plans`
- `GET /api/workspaces/:id/monitor/target-plans/:planId`
- `POST /api/workspaces/:id/monitor/target-plans/:planId/adopt`

**验证**：X 卡仅新增双侧类型 + wiki/notes 契约；未注册路由、未接 UI、未改监测引擎。

---

## 十四、行动闭环模拟实验接缝契约（X-DLF0，2026-06-28 总控自做）

**背景**：用户要求在日常/专题/重复模块的「行动闭环 → 模拟实验」中，对分析报告产出的行动策略、活动方案、新品方案、增长方案等，用数字生命体进行模拟预测。典型用例：门店零售活动方案的目标客群接受度、新品概念测款、用户增长方案专家投票。

**首版定位**：
- 模拟实验是**行动前预测 / 方案试压**，不是统计预测模型，不承诺真实市场结果。
- 输入是报告/方案/行动项等衍生产物 + persona 假设；输出是可解释的接受度、反对点、接受条件、修改建议和下一步验证实验。
- 数字生命体首版是 **SubAgentTemplate persona 复用层**：可以选择 subagents 管理中已有模板，也可以手填 manual persona。
- **不启动真实 subagent runner**：不调用 `runSubAgentTurn` / 委派任务，不继承 `toolIds`，不产生子 agent trace。v2 再考虑独立 runner、多轮辩论、历史校准。

**已交付（仅契约，未实现 API/UI）**：
- 双侧 `types.ts` 镜像新增：
  - `SimulationScenario = "consumer_campaign" | "product_concept" | "expert_panel"`
  - `DigitalLifeFormSource = "subagent_template" | "manual_persona"`
  - `SimulationVerdict = "go" | "revise" | "hold" | "reject"`
  - `SimulationStance = "support" | "conditional" | "oppose" | "uncertain"`
  - `DigitalLifeForm{id,name,source,persona,templateId?}`：`templateId` 仅指向 `SubAgentTemplate.id`，只复用 persona。
  - `SimulationRunInput{pathId,relPath?,scenario,model,lifeForms,prompt?,businessContext?}`
  - `SimulationRoleAssessment{lifeFormId,name,stance,score,rationale,acceptanceConditions,objections,evidenceQuotes,suggestions}`
  - `SimulationRunResult{scenario,verdict,overallScore,summary,roleAssessments,risks,recommendedChanges,validationExperiments,artifactPaths?,model}`

**数据红线（下游卡必守）**：
- 允许进入 LLM：`report`、`business_requirements/`、`golden_strategy/`、`actions` 等衍生产物。
- 禁止进入 LLM：`draw_data` 原始行级内容、数据探索模块中的数据内容/列名/字段值/剖析样本、错误日志样本片段。
- `clean_data` 如后续接入，必须另立卡并用户知情；首版不接聚合数据选择器。
- `DigitalLifeForm.persona` 是 prompt 文本，不是执行权限；`SubAgentTemplate.toolIds` 不得进入 simulation API payload，不得被后端解释为工具授权。

**下游分工审定**：
- `E-DLF1`：实现 `POST /api/simulation-lab/run`，只读 report 登记路径；严格 JSON + repair；产物落 `simulation_lab/*.json` 和 `*.md`。
- `V-DLF2`：新增 `SimulationLabPane` 替换 `dlf` placeholder；因 V-agent 已停用，委派 Agent-D 代笔，回流总控终审。
- `D/V-DLF3`：读取 `/api/subagents` 作为数字生命体候选，只取 `id/name/persona`，不展示/不传递 `toolIds`。
- `E-DLF4`：补后端 API 单测 + 数据红线核查，确认不读 `draw_data`、不调 subagent runner。
- `X-DLF5`：补产品说明与 v2 演进路线。

**建议 API 签名（E-DLF1 落地前仍为契约，不代表已实现）**：
- `POST /api/simulation-lab/run`
- body = `SimulationRunInput`
- response = `SimulationRunResult`

**验证**：X-DLF0 仅新增双侧类型 + notes 契约；未注册路由、未接 UI、未改 subagent runner。

**✅ E-DLF1 终审通过（2026-06-28）**：新增 `server/src/simulation-lab.ts` 与 `routes/engine.ts` 端点 `POST /api/simulation-lab/run`。实现读取 report 登记路径文本、构造 DLF persona 模拟 prompt、JSON parse + repair、产物落 `simulation_lab/*.json` 与 `*.md`。总控收口：① 返回值对齐 X-DLF0，为完整 `SimulationRunResult`，`artifactPaths` 嵌入结果；② 路径改走 `readFlowFile/writeFlowFile` + `validateReportRelPath`，禁止 hidden/`..` 段，file path 不接受 `relPath`，返回相对 artifact path，不泄漏本地绝对路径；③ `businessContext` 纳入 prompt，并对 `summary/model/scenario/roleAssessments` 做后端归一化。红线核查：不调用 subagent runner，不继承 `toolIds`，不读 `draw_data`。验证：`npm run typecheck`、`npm run build`、数据探索隔离 grep 全通过。

**✅ V-DLF2 + D/V-DLF3 终审通过（2026-06-28，Agent-D 代笔）**：新增 `SimulationLabPane`，dlf 占位替换为真实工作台；日常/重复/专题均可进入。页面支持报告选择、三类 scenario、subagent template 多选、显示停用模板、手填 persona、模拟重点输入、运行与结构化结果展示。新增 `api.runSimulationLab()`。SubAgentTemplate 只作为 persona 候选：前端只组装 `id/name/persona/source/templateId`，不展示/不传 `toolIds`，UI 明示“仅 persona 模拟 · 不挂载工具 · 不读取 draw_data”。总控收口：专题 dlf scope 改用 `zhuantiChatFolderScope` / `zhuantiChatFlow`，对齐黄金策与行动，避免误扫 workspace 报告。验证：`npm run typecheck`、`npm run build`、数据探索隔离 grep 全通过；grep 确认 `SimulationLabPane` 无 `chat/generate/extract/clarify` 类 API 调用。

**✅ E-DLF4 终审通过（2026-06-28）**：新增 `server/src/simulation-lab.test.ts` 26 个 node:test 用例；`simulation-lab.ts` 抽出 `parseSimulationRunRequest()` / `buildSimulationPrompts()` 纯函数，导出 `validateReportRelPath` / `extractJsonObject` / `normalizeSimulationResult`，并给 `runSimulationLab(input, { runPi? })` 增加 fake runner 注入点。路由改走 `parseSimulationRunRequest()`，避免路由层重复硬编码 enum。测试覆盖：请求 shape 守卫、路径守卫、prompt 不含 `toolIds/templateId`、JSON loose repair、artifact 相对路径落盘、fake runPi 单次调用、源码级 subagent/autonomous runner 黑名单、`folder !== "report"` 守卫。读取范围固定为 report folder 下 `.md/.markdown/.txt`；禁止 `draw_data` / `clean_data` / `knowledge`、非文本报告、hidden/`..` 段、`toolIds/templateId` 入 prompt。验证：`node --experimental-strip-types --test server/src/simulation-lab.test.ts` 26/26、`npm run typecheck`、`npm run build`、数据探索隔离 grep 全通过。

**✅ X-DLF5 专题收尾（2026-06-28）**：模拟实验首版产品说明已定稿。目的：在行动闭环执行前，对报告产出的策略、活动方案、新品方案、增长方案做“方案试压”，输出可解释的接受度、反对点、接受条件、风险、修改建议和下一步验证实验。使用方式：在日常/重复/专题的 `dlf` 子 tab 选择一份 report 文本，选择 `consumer_campaign` / `product_concept` / `expert_panel` 场景，从 subagents 管理中选择 persona 模板或手填 manual persona，补充模拟重点后运行；结果落到报告同目录 `simulation_lab/*.json` 与 `*.md`，供后续行动方案修订与人工复核。典型示例：① 门店零售活动方案用目标客群 persona 检查利益点、门槛和活动方式是否可接受；② 新品开发方案用消费者生命体测款，找购买阻碍、接受条件和需验证假设；③ 用户增长方案用专家阵容模拟投票，指出增长逻辑漏洞、执行风险和优化建议。

**注意事项 / 边界**：模拟实验不是统计预测模型，不输出真实市场销量、转化率或财务承诺；结论只代表“基于当前报告文本与 persona 假设的 LLM 推演”。首版 DLF 只复用 `SubAgentTemplate.persona`，不继承 `toolIds`，不启动真实 subagent runner，不读取 `draw_data`、数据探索样本、`clean_data` 或 `knowledge`。如用户需要把聚合数据纳入判断，必须另立卡并在 UI 明示 clean_data 知情使用。

**v2 演进路线**：① 生命体独立 runner：每个 DLF 可独立上下文、多轮记忆和 trace，但必须重新设计权限，不得默认继承 subagent 工具；② 多轮辩论 / 交叉质询：支持消费者互评、专家 challenge、主持人归纳，输出分歧与收敛条件；③ 历史模拟库：保存不同方案、persona、模型和结果，支持横向对比与复盘；④ 执行反馈校准：将真实行动反馈、A/B test、复盘结论沉淀为校准集，用于修正 persona 和评估口径；⑤ clean_data 聚合接入：只允许用户知情选择聚合指标，禁止原始行级内容进入 LLM。

---

## 十五、tool-use 治理中枢契约（X-TOOLUSE0，2026-06-30 总控自做）

**定位**：tool-use 是 pi-xanthil 的受控计算能力层，承载数据摄取工具、数据分析 Python 固化代码、MCP/Chat/command/subagent/workflow/eval 的计算能力引用。它不是单一工具列表页；治理重点是注册源、执行网关、暴露策略、运行证据与质量闭环统一。

**单一真源与网关**：
- 工具唯一注册源：`server/tools/<id>/tool.json`，由 `server/tools/registry.ts` 实时扫盘加载；不要在 Chat、MCP、command、subagent、workflow 里复制工具 schema。
- 工具唯一执行网关：`POST /api/extraction-tools/:id/run`。人工、Chat `@工具`、MCP、command、subagent、workflow、eval 的真实执行最终都必须回到这个端点。
- AI/MCP 路径必须带 `source:"ai"`。`source` 是来源标记，不是授权本体；授权裁决仍由 manifest 分类、调用方候选过滤、row guard、工具输出契约共同完成。

**manifest v2 最小口径**：
- 已审定字段：`category?: "ingestion" | "analysis"`、`tags?: string[]`、`riskLevel?: "L0"|"L1"|"L2"|"L3"`、`allowedUse?`、`forbiddenUse?`、`failureHandling?`、`input`、`output`、`parameters?`、`resultColumns?`、`metricHints?`。
- `category` 缺省或非法值一律归一为 `ingestion`，保守不暴露给 AI。
- `tags` 只用于搜索、筛选、治理和候选理解，不代表权限；加载时 trim、去重、过滤空字符串。数据分析 Python 工具建议至少包含 `python-analysis`，并补业务域/任务/算法标签，如 `membership`、`retention`、`rfm`、`forecast`。
- 预留但本轮不实现：`owner`、`deprecated`、`replacementToolId`、`aiExposure`、`outputContract`。这些字段需要另立卡，不要由 D/E/V 私自扩展语义。

**工具分类与能力矩阵**：

| 能力入口 | 暴露规则 | 执行规则 |
|---|---|---|
| manual | ingestion / analysis 均可人工运行 | 仍走 `/api/extraction-tools/:id/run` |
| AI / MCP | 仅 `analysis` | MCP `tools/list` 过滤；`tools/call` 走 `/run source=ai` |
| Chat `@工具` | 仅 `analysis` | 前端装配，后端网关执行 |
| command | 只绑定 `analysis toolIds` | 不自动绕过用户确认；可预填 `@工具` 卡 |
| subagent | 只进入 template `toolIds` 白名单 | scoped MCP allowlist 仍只按白名单注入 |
| workflow | 只保存 `toolId + params` | 不复制工具描述或参数 schema |
| eval / ToolLab | 复用 `tests/cases.json` | 可用于准入、回归、失败样本候选 |

**当前实现基线（2026-06-30 X-TOOLUSE6 终审核实）**：
- `registry.ts` 已支持 `tags`、`category`、`metricHints` 归一化，且 `listExtractionTools()` / `getExtractionTool()` 每次实时 `loadTools()`，新增/删除工具后刷新即可生效。
- `server/src/tool-policy.ts` 统一 server 侧 analysis 暴露策略；MCP tools/list 与 tools/call、command coerce、subagent server coerce 均复用或对齐该口径。
- `ToolUsePane` 已具备 tags/search/filter、risk/category 筛选、跨模块能力矩阵、test cases 读取和运行台账视图；`ToolLab` 已接 category/risk/tags/query 过滤、cases/eval 状态与 policy 缺失提示。
- 运行看板当前基于 `trace_events(target_kind='extraction_tool', type='tool_run')` 的脱敏字段生成 `ToolRunRecord`，不是独立 `tool_runs` 表；payload 记录 basename、路径分类、artifact basename、计数、耗时、caller/source/status、rowGuard、metricSnapshotsCount、errorCode 等 metadata，不保存绝对输入路径、文件正文、样本行或 SQL 明细。
- `/run` 已接 row guard 与 `MetricSnapshot` 数字锁；Chat/MCP 路径经 `source:"ai"` 触发 AI 行级输出守卫与 MetricVerification 后续链路。

**安全红线**：
- 数据探索模块（`DataExplorationPane.tsx` 及其子树）永久禁止接 LLM/tool-use 自动调用；相关改动必须跑 AGENTS.md 中的数据探索隔离 grep。
- `ingestion` 工具永不进入 AI/MCP/command/subagent/workflow 自动候选；只允许人工摄取路径。
- `analysis` 工具可以经 `source:"ai"` 处理已登记数据路径，但产物必须是聚合/衍生结果，不得包含 draw_data 原始行级明细、客户明细、订单样本、错误日志样本片段。
- run ledger / trace / eval case 沉淀只记录元数据、artifact 路径和脱敏摘要，不保存文件正文、样本行或原始 SQL 结果明细。
- 前端只负责展示和装配，不承担安全裁决；安全裁决集中在 registry 分类、后端网关、MCP 过滤、row guard 与工具输出契约。

**后续卡边界**：
- **D-TOOLUSE1**：完善 tags/SOP 与现有 analysis 工具标签，不改网关语义。
- **E-TOOLUSE2**：统一 Tool Run Ledger；可先复用 trace_events，也可提出 `tool_runs` schema 给总控审。
- **V-TOOLUSE3**：完善 ToolUsePane 治理视图与运行台账筛选，不自行扩大 AI 暴露规则。
- **E-TOOLUSE4**：MCP/command/subagent/workflow 统一从 manifest 派生候选和参数说明。
- **E-TOOLUSE5**：ToolLab 准入、cases 回归、失败 run 转候选 case；不得复制原始数据内容。
- **X-TOOLUSE6**：全链验收、安全红线、wiki/notes 收口。

---

## 十六、业务需求沟通闭环接缝契约（X-BRC0，2026-06-30 总控自做）

**背景**：用户指出日常 / 专题 / 重复三个模块都有“业务需求”，但在业务需求正式确定前，实际存在重要的业务需求沟通环节。总控裁决：这不是业务需求表单的一段附属聊天，而是正式业务需求前的轻量工作台，负责把模糊诉求澄清为可确认、可追溯、可执行的分析任务说明。

**首版定位**：
- 主链路为 **业务诉求沟通 → 需求澄清 → 业务需求确认 → 分析 / workflow / 报告**。
- 沟通环节的产物不是报告，也不是直接执行任务，而是一份用户确认后的 `RequirementDraft`。
- 后续分析链路只消费确认后的业务需求，不直接消费未定稿沟通全文，避免把上下文噪声和未确认假设带入分析。

**三场景口径**：
- **日常**：轻量快问快答，优先澄清 2-3 个会导致跑偏的关键项，如时间范围、指标口径、对比对象、输出物。
- **专题**：项目制 brief，覆盖背景、目标、边界、数据范围、交付物、owner、评审点、成功标准。
- **重复**：模板化复用，识别本次与历史需求的差异，固化参数和澄清项，减少下次沟通成本。

**结构化沟通模型**：
- 沟通记录：保留用户诉求与系统追问，但不直接作为最终需求。
- 澄清清单：目标、对象、时间范围、指标口径、维度、输出物、成功标准、风险假设。
- 问题优先级：`must_confirm` / `should_confirm` / `can_defer`。
- 回答状态：`pending` / `answered` / `skipped` / `assumed` / `deferred`。
- 需求草案：背景、目标、范围、数据使用边界、指标与口径、分析问题、输出物、风险与假设。
- 确认动作：用户确认后才写入现有 `business_requirements` 产物链路。

**数据红线**：
- 允许进入 LLM：用户自然语言诉求、已确认业务背景、指标名称/口径说明、已登记路径元信息、历史需求/报告摘要。
- 禁止进入 LLM：`draw_data` 原始行级内容、数据探索字段值/样本/剖析结果、错误日志样本片段、客户/订单/明细级数据。
- `clean_data` 首版不读取文件正文；如用于澄清提示，只允许路径元信息/聚合说明，并在 UI 明示受控数据知情。
- 被跳过或 deferred 的问题不得写成已确认事实；正式业务需求必须显式区分 confirmed facts 与 assumptions。

**下游分工审定**：
- `E-BRC1`：需求澄清引擎 + 结构化草案 API；server 侧 JSON parse/repair；不直接写业务需求。
- `D/V-BRC2`：需求沟通工作台 + 日常/专题/重复三入口接入；前端只调用专题专用 API，不自行调用通用 `chat/generate/extract/clarify`。
- `E-BRC3`：确认成业务需求 + trace/review 闭环；只写确认后的草案，trace 只存脱敏 metadata。
- `X-BRC4`：全链验收、安全红线和 wiki/notes 收口。

**✅ E-BRC1 终审通过（2026-06-30）**：新增 `server/src/business-requirement-communication.ts` 与 `POST /api/workspaces/:id/business-requirement-communication/clarify`。实现请求解析（`scene/message/contextRefs/history/model`）、server 侧 JSON slice/fence/comment/trailing-comma repair、结构化输出校验与归一化（`clarifyingQuestions/assumptions/requirementDraft/riskNotes`），prompt 明确“未确认项必须以问题或假设呈现，不得擅自定稿”。路由接入已启用 `business_context` 与 `metric_definitions` 摘要，已登记路径只传 `id/folder/kind/basename` 元信息，不传绝对路径、文件正文或样本。API 只返回结构化澄清结果，不写业务需求文件。

**总控收口**：E 初版问题优先级用 `P0/P1/P2`、状态用 `open/answered/dismissed`，偏离 X-BRC0 长期契约；已改回 `must_confirm/should_confirm/can_defer` 与 `pending/answered/skipped/assumed/deferred`，并同步 prompt schema 与测试。后续前端必须消费这套枚举，不要再引入本地映射真源。

**验证口径**：E-BRC1 已通过 `node --experimental-strip-types --test server/src/business-requirement-communication.test.ts` 5/5、`npm run typecheck`、`npm run build`；数据探索隔离 grep 无输出。尚未新增 DB、未扩双侧 `types.ts`、未接 UI；下游 D/V-BRC2 接前端，E-BRC3 接确认写入与 trace/review。

**✅ D/V-BRC2 终审通过（2026-06-30）**：`BusinessRequirementPane` 已新增“需求沟通”工作台，支持用户诉求输入、沟通记录、澄清清单、假设处理、草案预览与应用到表单；确认前只维护前端状态，不写正式业务需求。`EngineTabs` 在日常 / 专题 / 重复三个业务需求入口分别传 `daily` / `topic` / `recurring`，`web/src/lib/api/engine.ts` 新增 `runRequirementCommunication()` 且只调用 E-BRC1 专用端点。

**总控收口**：D/V 初版把沟通 API 的 workspace id 绑定到 `scope.type === "workspace"`，导致普通 session/flow scope 下三入口 UI 会提示不可用；已改为 `EngineTabs` 透传 `activeWorkspaceId` 给沟通 API。该 id 只用于 E-BRC1 读取 workspace 级 business_context / metric_definitions / 路径元信息，报告路径读取、版本加载、正式业务需求生成仍按原 `scope` 执行，避免改变产物归属。

**验证口径**：D/V-BRC2 已复跑 `npm run typecheck`、`npm run build`；数据探索隔离 grep 无输出。浏览器点击级 smoke 未自动化，后续需手工从三入口确认“沟通草案应用到表单”与“生成分析框架前不写正式需求”的 UI 流程。

**✅ E-BRC3 终审通过（2026-06-30）**：`server/src/business-requirement-communication.ts` 新增确认输入解析、正式需求结构转换、Markdown 渲染、review 对照上下文、trace metadata 纯函数；正式需求结构显式区分 `confirmedFacts`、`confirmedAssumptions`、`deferredQuestions`、`rejectedAssumptions`，`deferred/skipped/pending` 问题不会进入 confirmed facts。`POST /api/workspaces/:id/business-requirement-communication/confirm` 写正式需求到 `business_requirements/*-确认需求-*.md/json`，沟通记录写入 `business_requirements/communications/*.json`；前端 `BusinessRequirementPane` 新增“确认成正式需求”按钮，确认后刷新既有业务需求版本列表。

**review / trace 接线**：新增 `GET /api/workspaces/:id/business-requirement-communication/review-context`，返回确认后的目标、成功标准、确认假设、未确认问题，供报告审核展示或拼接；trace 记录 `business_requirement_clarification_generated`、`business_requirement_assumptions_reviewed`、`business_requirement_confirmed`，payload 只含 scene、数量、状态分布、路径名等 metadata，不含数据文件正文或样本。

**总控收口**：E 初版 `review-context` 显式 `jsonPath` 可读取同 outputDir 下任意 JSON 并尝试解释为确认需求；已新增 `isConfirmedBusinessRequirementJsonPath()`，只允许 `business_requirements/*-确认需求-*.json`，拒绝普通分析框架 JSON 与 `communications` 沟通记录，避免误读和非确认结构暴露。

**验证口径**：E-BRC3 已通过 `node --experimental-strip-types --test server/src/business-requirement-communication.test.ts` 8/8、`npm run typecheck`、`npm run build`；数据探索隔离 grep 无输出。未新增 DB；如后续需要跨 workspace 查询沟通历史，再另立 DB 表。

**✅ X-BRC4 全链验收通过（2026-06-30）**：业务需求沟通闭环专题完成，`X-BRC0 / E-BRC1 / D/V-BRC2 / E-BRC3 / X-BRC4` 全部 done。新增确定性验收覆盖三场景：日常轻量诉求、专题完整 brief、重复历史口径复用与本次差异；验证链路为澄清问题（优先级/状态）→ 假设处理 → 正式确认需求 → review context → trace metadata。确认结构继续显式区分 `confirmedFacts`、`confirmedAssumptions`、`deferredQuestions`、`rejectedAssumptions`；`skipped/deferred/pending/assumed` 均不会进入 confirmed facts。

**总控收口**：`assumed` 问题原本不会成为事实，但也不会出现在未确认问题清单，容易让“按假设推进”的待复核点在 review 阶段丢失；已纳入 `deferredQuestions/openQuestions`，正式需求 Markdown 的 Deferred / Skipped Questions 与 review context 都能看到。

**最终验证口径**：`node --experimental-strip-types --test server/src/business-requirement-communication.test.ts` 9/9、`npm run typecheck`、`npm run build` 通过；数据探索隔离 grep 无输出；`docs/wiki.html` script parse 通过。浏览器点击级 smoke 未自动化，仍建议人工从日常 / 专题 / 重复各跑一条确认链路。

---

## 十七、业务需求模块瘦身接缝契约（X-BREQ-SPLIT0，2026-06-30 总控自做）

**背景**：BRC 闭环完成后，`BusinessRequirementPane` 同时承载“需求沟通、草案确认、正式需求版本、分析框架生成、报告框架、沉淀与字段验证”，用户反馈业务需求模块过于臃肿。总控裁决：不新增全局一级/二级 subtab，不改接缝层，只在业务需求组件内部按生命周期拆成两个子 tab。

**产品边界**：
- 一级入口仍为“业务需求”。
- 内部子 tab：
  - **需求沟通**：确认前工作台，处理模糊诉求、澄清问题、假设、草案预览和确认成正式需求。
  - **分析框架**：确认后管理台，消费确认需求，处理版本、生成分析框架、报告框架、编辑、沉淀和下游联动。
- 确认成功后的推荐行为：刷新正式需求版本列表，并自动切到“分析框架”。
- 日常 / 专题 / 重复入口默认进入“需求沟通”；从报告审核 / workflow 回看需求时可优先进入“分析框架”，首版未实现自动判断也不阻断，必须保留显式切换。

**工程边界**：
- 首版只改 `web/src/components/BusinessRequirementPane.tsx`，`RequirementCommunicationPane` / `AnalysisFrameworkPane` 为同文件内部组件，避免扩大 diff。
- 不改 `App.tsx` / `constants.ts` / `tabs/types.ts` / 后端路由 / BRC API。
- `runRequirementCommunication()` / `confirmRequirementCommunication()` 继续是需求沟通专用 API；分析框架主路径已由 E-BREQ-LINK4 / D/V-BREQ-LINK5 切到确认需求专用生成链路，`generateBusinessRequirement()` 仅保留在折叠的 legacy fallback。
- 不改变 `business_requirements/*-确认需求-*.md/json`、`business_requirements/communications/*.json`、trace/review context 结构。

**✅ D/V-BREQ-SPLIT1~3 终审通过（2026-06-30）**：
- `BusinessRequirementPane` 已有“需求沟通 / 分析框架”双子 tab，父容器保留 path、版本、scene、workspace id 等共享状态。
- `RequirementCommunicationPane` 区域承接确认前链路，不展示“生成分析框架”主操作。
- `AnalysisFrameworkPane` 区域承接确认后链路，包含生成分析框架、版本列表、预览、编辑、报告框架、沉淀与字段验证。
- 确认成正式需求后会刷新版本列表并切换到“分析框架”。

**安全红线**：
- 需求沟通 tab 不 import 通用 `chat/generate/extract/clarify` API，不读取 `draw_data` 原始行，不读取 `data_exploration` 字段值/样本/剖析结果。
- 分析框架 tab 延续既有业务需求生成链路，仍只能读允许的需求文档/聚合说明/报告等受控产物。
- 数据探索联动保持单向：业务需求 → 数据探索字段名提示，不携带数据内容。

**验证口径**：
- `npm run typecheck`、`npm run build` 通过；build 仅既有 Vite/ECharts chunk warning。
- `node --experimental-strip-types --test server/src/business-requirement-communication.test.ts` 9/9 通过。
- 数据探索隔离 grep 无输出。
- `docs/wiki.html` script parse 通过。

**历史残留 / LINK6 收口**：
- 未跑浏览器点击级 smoke；需从日常 / 专题 / 重复三入口各走一条“需求沟通 → 确认正式需求 → 自动切入分析框架 → 生成/查看分析框架”。
- 版本列表已防御性过滤 communications 记录，并标注 `[确认需求]` / `[分析框架]` / `[旧版本]`；X-BREQ-LINK6 已确认主路径收口，legacy fallback 后续只作为折叠过渡能力继续观察。
- 两个 pane 仍在同一文件内部，若后续继续膨胀，再开纯 UI 文件拆分卡，不和本次生命周期拆分混做。

---

## 十八、业务需求模块贯通接缝契约（X-BREQ-LINK0，2026-06-30 总控自做）

**背景**：双子 tab 已拆，但用户指出“需求沟通”和“分析框架”的连接度仍不够。总控裁决：业务需求模块不应只是两个并列 UI，而应是同一份确认需求在两个阶段流转。需求沟通前置承接线下材料、口头诉求、历史需求/报告摘要；确认后产物成为分析框架的输入源。

**产品链路**：
- 导入线下需求文档 / 输入诉求 → 需求沟通 → 确认正式需求 → 自动进入分析框架 → 基于确认需求生成分析框架。
- 需求沟通 tab 新增“导入沟通材料”：会议纪要、brief、邮件整理、访谈记录、PRD、历史需求和历史报告摘要。
- 分析框架 tab 左侧改为“确认需求源面板”：展示确认需求版本、目标、成功标准、confirmed facts、confirmed assumptions、open/deferred questions、风险与限制。
- 分析框架主路径不再要求用户二次导入和重填需求表单；旧表单如保留，只能作为默认折叠的过渡 fallback。

**工程边界**：
- 前端父容器应维护 `activeConfirmedRequirement`，来源包括刚确认的需求、用户选择的确认需求版本、报告审核/workflow 反查入口。
- BRC 导入材料能力必须走专用 API，不复用通用 `chat/generate/extract/clarify` client。
- 基于确认需求生成分析框架建议走专用 API 或现有 API 的 `mode:"from_confirmed_requirement"` 兼容扩展。
- 不改全局 subtab，不改 `App.tsx` / `constants.ts` / `tabs/types.ts`。

**✅ E-BREQ-LINK2 终审通过（2026-06-30）**：
- 新增 `POST /api/workspaces/:id/business-requirement-communication/import-documents`。
- 请求支持 `scene/documents/message/model`；document source 白名单为 `localText` / `report` / `business_requirements` / `clean_data`。
- `localText` 只接收用户显式粘贴/上传文本，禁止携带 server path；`report` / `business_requirements` 可读登记 report 输出目录内正文；`clean_data` 首版只导入路径元信息/聚合说明，不读取正文。
- `draw_data` / `data_exploration` 不在 source 白名单内，路径访问校验也会拒绝对应 folder。
- 输出结构为 `documentSummaries/extractedFacts/extractedQuestions/extractedAssumptions/suggestedMessage/riskNotes`，用于后续沟通，不直接成为 confirmed facts。
- trace 事件 `business_requirement_documents_imported` 只记录 metadata，不保存材料正文。

**✅ D/V-BREQ-LINK1 终审通过（2026-06-30）**：
- `BusinessRequirementPane` 父容器新增 `activeConfirmedRequirement`，保存 `markdownPath/jsonPath/content/structured/source/scene/confirmedAt`。
- `confirmRequirementCommunication` 成功后会把确认需求写入 active source、回填 draft、刷新版本列表、选中刚确认版本，并自动切到“分析框架”。
- `openVersion` 只在 `jsonPath` 命中 `business_requirements/*-确认需求-*.json` 时同步 active confirmed；打开旧分析框架版本只更新预览，不覆盖确认需求源。
- 分析框架顶部展示“当前基于确认需求”，无确认需求时引导回“需求沟通”确认，不再把重填表单作为首选路径。
- 总控收口：同文件中已无入口的旧提取草稿逻辑已移除；沟通材料只能形成待确认材料。

**✅ D/V-BREQ-LINK3 UI 骨架终审通过（2026-06-30）**：
- `需求沟通` tab 已新增“导入沟通材料”工作区，可添加已登记材料、粘贴文本、上传文本文件。
- 材料卡展示摘要、待确认问题与假设；“应用到本轮沟通”只写入沟通输入、澄清清单与假设区，不直接写正式需求或 confirmed facts。
- `clean_data` 只展示元信息/知情提示，不读取字段值、样本或正文。
- 分析框架生成传 `documents: []`，已移除旧“导入需求文档 / 提取草稿 / 本地文件”主入口，避免材料绕过确认链路。
- 未使用 `pickLocalPath`，未新增通用 `chat/extract/clarify` API 调用。

**✅ D/V-BREQ-LINK3B 终审通过（2026-06-30）**：
- `web/src/lib/api/engine.ts` 新增 `runRequirementImportDocuments()`，前端导入材料主路径消费 E-BREQ-LINK2 专用 `import-documents` API。
- 已登记材料导入按来源传 `report` / `business_requirements` / `clean_data`；`clean_data` 只传 `pathId/relPath/name` 元信息并展示 warning。
- 粘贴和上传文本走 `localText`，只上传用户显式提供的文本内容，不传本机路径。
- API 返回的 `documentSummaries/extractedQuestions/extractedAssumptions/suggestedMessage/riskNotes` 映射到 material card 和“应用到本轮沟通”。
- API 失败才 fallback 到本地启发式，并明确显示“本地启发式，未走服务端导入”；fallback 也只进入沟通输入、澄清清单、假设与风险提示。

**✅ E-BREQ-LINK4 终审通过（2026-06-30）**：
- 新增 `POST /api/workspaces/:id/business-requirements/analysis-framework-from-confirmed`，采用专用 API 方案，不改 legacy 旧表单生成端点。
- 请求只接受 `business_requirements/*-确认需求-*.json`；普通 `*-分析框架-*.json` 与 `business_requirements/communications/*.json` 会在 parse 阶段拒绝。
- 输出仍写 `business_requirements/*-分析框架-*.md/json`，现有版本列表可继续消费。
- 生成结果必须保留 `sourceConfirmedRequirement`，并在 Markdown 中声明“来源：基于确认需求生成”。
- `deferred/skipped/assumed/pending` 未确认问题只进入 `openQuestions` / `risks` / `zeroHallucinationCheck`，不进入 `businessFacts`。
- trace 只记录确认需求 basename、问题/风险/框架数量和生成结果 basename，不记录确认需求正文或沟通正文。

**✅ D/V-BREQ-LINK5 终审通过（2026-06-30）**：
- `web/src/lib/api/engine.ts` 新增 `generateAnalysisFrameworkFromConfirmed()`，前端分析框架主路径接 E-BREQ-LINK4 专用 API。
- 分析框架左侧改为“确认需求源”面板，展示确认需求版本、确认时间、scene、来源、业务目标、成功标准、confirmed facts、confirmed assumptions、open questions、风险限制。
- 主按钮文案为“基于确认需求生成分析框架”；无确认需求时提示回“需求沟通”，不展示旧大表单作为主路径。
- 旧表单和 legacy `generateBusinessRequirement()` 仅保留在折叠的“旧路径 / 直接生成（不推荐）”高级区。
- 版本列表过滤 `business_requirements/communications/` 记录，并标注 `[确认需求] / [分析框架] / [旧版本]`。
- 打开确认需求版本只更新 `activeConfirmedRequirement` 与左侧确认源，不覆盖当前分析框架预览 / 编辑区。

**✅ X-BREQ-LINK6 全链验收通过（2026-06-30）**：
- 需求沟通导入链路成立：已登记 `report/business_requirements`、用户显式 `localText`、`clean_data` 元信息进入 import-documents 专用 API；导入结果只进入摘要、待确认问题、假设、建议诉求和风险提示，不直接成为 confirmed facts。
- 确认需求链路成立：`confirmRequirementCommunication()` 写正式确认需求和沟通记录；`activeConfirmedRequirement` 保存 `markdownPath/jsonPath/content/structured/source/scene/confirmedAt`，确认成功后刷新版本并自动切到“分析框架”。
- 分析框架链路成立：左侧为“确认需求源”面板，主按钮走 `generateAnalysisFrameworkFromConfirmed()`；服务端只接受 `business_requirements/*-确认需求-*.json`，拒绝普通分析框架 JSON 与 `business_requirements/communications/*.json`。
- 下游链路成立：`review-context` 仍只读取确认需求 JSON，并返回目标、成功标准、confirmed assumptions 与 deferred questions；trace 继续只记录 basename、数量、状态等 metadata。
- 安全红线成立：`draw_data` / `data_exploration` 不可作为 import source，路径守卫也拒绝对应 folder；`clean_data` 仅限元信息/聚合说明；新 UI 不 import 通用 `chat/generate/extract/clarify` API。
- 总控小修：打开历史确认需求版本时同步 `scene` 到 `activeConfirmedRequirement`，避免契约只靠 structured fallback 成立。
- 验证：BRC node:test 19/19、typecheck、build、数据探索隔离 grep、BusinessRequirementPane 残留 grep、wiki script parse 均通过；API smoke 由用户手动完成。

**安全红线**：
- `report` / `business_requirements` 是衍生产物，允许作为沟通材料正文来源。
- `clean_data` 只允许元信息/聚合说明，UI 接入时必须有受控数据知情提示。
- `draw_data` 原始行、客户/订单/明细级内容、`data_exploration` 字段值/样本/剖析结果禁止进入 LLM。
- 导入材料只能形成澄清问题、候选事实、假设和草案；确认前不得写成正式事实。

**验证口径**：
- `node --experimental-strip-types --test server/src/business-requirement-communication.test.ts` 16/16 通过。
- `npm run typecheck`、`npm run build` 通过；build 仅既有 Vite/ECharts chunk warning。
- 安全 grep 无生产读取 `draw_data` / `data_exploration` 的 `readFlowFile` 路径命中。

**后续顺序**：
- 本组专题完成。后续可另开低优先级卡做浏览器点击级 smoke 自动化，或把 legacy fallback 从主组件继续外移。
