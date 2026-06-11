# 横切基础设施 · 领域笔记（总控持有）

> **活文档**：总控持有的横切基础设施知识（缓存 harness / prompt 契约 / 接缝层指针）。
> 蒸馏自旧 handoff：`缓存命中`。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> 接缝重构（routes/db/api/tabs 拆分）记录见 `Orchestration.md §四`。

---

## 0. 当前状态（总控维护，覆盖式）

- 最近更新：2026-06-11 · 总控（UI 导航批 + pi 超时根因修复 + 侧栏改造）
- **本 session(06-11) 快修批 ✅**（总控直接执行+终审，typecheck+build 全绿，详见 wiki 快修台账 + §四）：① UI 导航改造(实验室并入 AnaX 两级/规则记忆 6 模块/Xan前移/onto-xanthil 一级 tab/黄金策业务洞见占位/探索红线只读栏 `CleanDataDocsColumn`) ② 随手记 `QuickNotesPane` 落地(localStorage,仿 wiki) ③ **侧栏改造**:精选收藏下线(删 UI 入口,后端休眠)、「探索」→「任务」、工作流移入「工作流·工作视图」左竖栏(`FlowListColumn`) ④ **pi `runPiPrompt` 超时根因修复**(见 §三) ⑤ decision 模块**确定暂缓/取消**(并入需求池)，孤儿残留 `web/src/tabs/DecisionTabs.tsx` 已删、typecheck/build 转绿（接线派卡作废）
- 进度（接缝/治理底座）：接缝重构批1~3✅ · 文档治理✅ · 连续性 SOP+`/px-*`✅ · 协作闭环(机制A)+归档✅ · wiki(5 tab)✅ · 快修通道固化✅ · 随手记✅ · 缓存 harness 三层闭环(回填未真验) · P0-A/B/D 均终审+实跑✅；**仅剩 P0-C E2E 验证(E)待进场**
- **onto-xanthil 全期交付完毕 ✅**（2026-06-10 总控独立开发，详见 `docs/onto-xanthil-design.md` + wiki 已完成区）：数据语义层(Palantir 取向·借 nano 工程·做轻)。P1 契约/db/路由/前端骨架+聚合集生成 · P2a 共享 `GraphCanvas`(KG 改用同底座) · P2b/P2b' **metric 完全切源**(`metric_definitions` 唯一真源，3 注入管线+IndicatorsPane 全切，启动迁移先拷后删旧行) · P3 文档导入+pi LLM 抽取(`onto-extract.ts`)。五能力(对象/关系/指标/图谱/导入)齐活，均实跑通过
- **onto-xanthil 差距对齐 P4~P8 ✅**（2026-06-10 总控独立开发，对照参考产品 `nano-ontoprompt` 全量核查，详见 `docs/onto-xanthil-design.md §9`）：**P4** 质检 `onto-validator.ts` 2→7 检查(结构/字段/引用/去重/kind白名单/function_code启发式/linked语义引用) · **P5** `onto-export.ts` 五格式导出(JSON/YAML/CSV/HTML/Turtle，纯字符串零依赖,超 nano 无需 rdflib/pyyaml) · **P6** `logic_rules`/`onto_actions` 两表(Logic Rule+Action 层全链路:契约/db/8路由/前端两Section/2子tab/导出并入) · **P7** 抽取覆盖四类(entity/relation/logic/action)+四类校准+拆出可测 `processExtractionOutput` · **P8** `onto_prompts` 表 prompt 管理(模板版本化,{{content}}占位)+文档上传(.md/.txt/.csv 客户端FileReader)。全绿+实跑 63 项
- **onto-xanthil readme + 左竖栏 + 滚动修复 ✅**（2026-06-10）：①加二级 tab `onto_readme`「说明」(纯静态文档:概念表/各子页操作详解/供应链示例)，设为 onto 默认落地页 ②onto 全部二级 tab **改左侧竖栏**呈现(顶部条对 onto 隐藏,仿 AnaX `LAB_ANAX_SUB_TABS` 范式) ③修 `OntologyPane` 根容器无滚动 bug(父级 `min-h-0` 裁切超长内容→加 `h-full overflow-y-auto` 外壳)
- 下一步：① **P0-C E2E 验证(E)** 待进场，P0 齐活后归档 changelog v2.1；② **onto-xanthil 全部新 UI 仍未浏览器实跑点检**(逻辑/动作/说明子tab、左竖栏切换、导出下拉、文件上传、prompt 编辑器、metric 切源注入)，强烈建议 `npm run dev` 走一遍真实交互(逻辑/db 层已 63 项实跑，但浏览器渲染/交互未验)；③ 工作流「创建」链路 E 前端待联调(见下)；④ **本 session UI 改动同样未浏览器实跑点检**(侧栏任务/工作流左栏、实验室 AnaX 左竖栏、随手记增删/导入导出、黄金策洞见栏)，建议 `npm run dev` 走一遍；⑤ ~~decision 模块导航/渲染接线~~ **作废**(2026-06-11)：decision 确定暂缓并入需求池，孤儿 `DecisionTabs.tsx` 已删，不再接线
- 开放问题：① 缓存回填效果待真实双 session 验证 ② onto metric 切源动了 D 域 live 注入功能，须真实对话验证指标注入生效 ③ onto 抽取的 `function_code` 仅启发式校验(TS 侧无法 ast.parse Python)，若要真语法门禁需接 pi(按需) ④ Turtle 导出对 logic/action 暂未映射(OWL 语义有限,按需)
- **工作流「创建」链路修复 ✅ done(2026-06-11，终审+联调实跑通过)**：三层协同——总控后端 `index.ts captureWorkflowFromText` 三路捕获+回填 + E `MultiAgentExecutionPane` prompt 硬化(禁提问+钉死 flow 目录+输出目录约束不适用 workflow.json) + `CreationPane` 重试轮询/提问可回复/超时空态引导。浏览器联调实跑(创建带输出目录约束→workflow.json 落 flow 目录→UI 显节点；pi 提问可回复)通过
- UI 导航台账：实验室重组 + 规则记忆 6 模块 + tab 增删排序 + 探索红线只读栏 + **onto-xanthil 8 子tab(说明/对象/关系/指标/逻辑/动作/图谱/导入)·左竖栏呈现**，详见 §四
- **关键约束/坑**：① `node:sqlite` 的 `DatabaseSync` **无 `.transaction()`**(better-sqlite3 才有)，事务用 `db.exec("BEGIN"/"COMMIT"/"ROLLBACK")` ② metric 真源 = `metric_definitions`(非 `analysis_standards`)，analysis_standards 仅留 `reference_file`
- **终审教训**：仅 typecheck/build 绿 ≠ 功能可用；终审一律加运行时端到端实跑门禁

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

---

## 三、本机已知坑（pi 侧，非本项目 bug）

- 扩展 `ptk-memory-inject` 的 better-sqlite3 NODE_MODULE_VERSION 不匹配 → 本项目选 `node:sqlite` 免疫原生编译坑。
- 默认 model `volcengine-plan/deepseek-v4-flash` 报 `developer` role 400 → 跑真实对话前需切模型。
- `runPiPrompt` 用 `--no-skills`，**勿用 `--no-extensions`**（禁用 provider 扩展致 LLM 调用失败）。
- **`runPiPrompt` 超时根因（2026-06-11 实测取证）**：一次性纯文本补全若不带 `--no-tools`，pi 每次都加载完整 agent 环境（工具 schema + MCP + 扩展）——极简 "回复ok" 就吃 **28738 input tokens**；叠加文档正文 + thinking 模型（如 `minimax-cn/MiniMax-M3` 的 `<think>` 长推理）→ 真实抽取轻松 >90s 触发 `pi prompt timed out`。**修复 = 加 `--no-tools --no-context-files`**（保留 provider，input ↓92% 至 ~2.3k）+ 放宽超时（默认 180s）。已落地于 `pi-adapter.ts:runPiPrompt`；调用方按需传 `timeoutMs`（抽取类建议 ≥120s）。坑：`--thinking off` 对 MiniMax-M3 实测**无效**（模型仍输出 `<think>`），故解析侧需 `text.replace(/<think>[\s\S]*?<\/think>/gi,"")` 再扫 JSON（见 `onto-extract.ts:parseExtractJson`）。
- `node:sqlite` 的 `DatabaseSync` **无 `.transaction()`**（那是 better-sqlite3 API）→ 事务一律用 `db.exec("BEGIN")` / `"COMMIT"` / `"ROLLBACK"`（db.ts 既有范式）。

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

**规则记忆（rule_memory）9 项**：6 大记忆模块（`rules`偏好 / `indicators`指标 / `cases`项目 / `failure_memory`失败 / `field_memory`字段 / `process_memory`流程）+ 业务环境/trace/知识图谱并列。`token_stats`/`quick_notes`（随手记）为 header 按钮跳转的隐藏子页，不入二级条（沿用 token_stats 既有范式）。

**新增占位 subtab**（脚手架，后端待补）：`tool_use` `failure_memory` `field_memory` `process_memory`；均用 `Placeholder` 组件。

**已实现（2026-06-10 快修）**：`quick_notes` 随手记 = `components/QuickNotesPane.tsx`，仿 `wiki.html` 随手记的纯前端 localStorage 实现（key `xanthil-quick-notes`，笔记 `{id,text,ts}`）——保存 / ⌘·Ctrl+Enter / 勾选合并复制（未勾选则全部）/ 删除 / 导出导入(按 id 去重合并)。零后端、零 LLM。

**探索·工作视图红线只读栏**：`App.tsx` 在 `explore + view` 内容区左侧挂 `CleanDataDocsColumn`（聚合数据只读+复制，详见 `notes-data` 红线范式）。

**左侧主栏改造（2026-06-11）**：`Sidebar.tsx` 现仅 工作区 / **任务**（原「探索」会话区重命名，一个会话=一个任务）两区。① **精选收藏下线**：删侧栏区块 + 工作流行收藏星标按钮 + `App.tsx` 的 favorites state/handler/bootstrap（`noUnusedLocals` 要求）；后端 favorites 表/路由/api 方法**保留休眠**（未删，可恢复）。② **工作流列表移出主栏** → 迁入「工作流·工作视图」内容区左竖栏 `components/FlowListColumn.tsx`（选择/新建/重命名/删除，可收起，排除 AnaX 模板派生 flow），在 `App.tsx` `multi + view` 渲染。Sidebar 的 flows/favorites 相关 props 已删。"跑工作流也建任务" 暂为人工约定（用户定，未做 flow↔task 自动联动）。

**decision 一级 tab（接缝层占位，2026-06-11）**：`MainHeader.Tab` 含 `"decision"`、`constants.SubTab` 含 `decision_board/workbench/assistant/review`（仅类型字面量，为 `DecisionTabs.tsx` 转绿）。**但 `TABS` 数组未加 decision 项、无 `DECISION_SUB_TABS`/`getSubTabsForTab` 分支、`App.tsx` 未渲染 `DecisionTabs`** → 该 tab 当前不可达。导航/渲染接线 = 已派卡（wiki TASKS dom=X），owner 总控续做；功能落地 P2–P5 见 `docs/decision-intelligence-plan.md`。

**已知小回归（非阻断）**：AnaX 内层子项（假设库/变更管理/readme）不在 `getSubTabsForTab(research_lab)` 中 → SettingsModal 不能单独隐藏（AnaX 已降为二级，可接受）。
