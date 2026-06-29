# 可视交付域 · 领域笔记（Agent-V）

> **活文档**：长效领域知识，由 V 持续维护。蒸馏自旧 handoff：`Dashboard` `探索`(报告/汇报/审核/黄金策部分) `规则记忆`(trace/token/知识图谱部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

> 📌 **v2.3 已发布（2026-06-26，总控）·「零幻觉·数据可信地基」**：交付已归档进 `docs/wiki.html` CHANGELOG v2.3（current），v2.2 归档、2.3 阶段进行中。本 §0 工作记录由域 owner 续维护。

- 最近更新：2026-06-29 · **V-KG1（图谱边关系与来源筛选）+ V-KG2（前端启发式节点质量提示）done**。
- 进度：
  - **V-KG1**（done，本次）：在图谱视图 toolbar 增加边 relation 筛选与来源（自动/手工）筛选，基于前端内存 `rawEdges` 过滤，确保不影响节点显示（`gcNodes` 不变）。
  - **V-KG2**（done，本次）：增加纯前端的启发式节点质量提示，计算逻辑涵盖无入边、无出边、孤立节点、低关联、以及久未更新等维度的判断；列表页与详情面板新增提示区。
  - **V-TRACE1**（done，本次）：重构 `TracePane.tsx` 为分面视图模式（运行看板、失败分析、巡检建议、记忆注入、规则提炼、说明），降低信息密度，分离职责。
  - **V-TRACE5**（done，本次）：在失败分析页增加状态过滤与标记（全部、open、fixed、distilled、ignored）。卡片集成 inline 按钮支持快速填写 note，并做乐观本地渲染+局部 API 更新回滚。
  - **V-TRACE7**（done，本次）：新增独立的“巡检建议” Tab。接入 E-TRACE6 端点（`listTraceInspectionFindings`），展示 7/14/30 天异常窗口（如失败峰值）并附带一键复制 targetId/errorType 快捷操作及修复建议的闭环操作 UI。
- 校验：
  - `node --experimental-strip-types --test server/src/knowledge-graph-preview.test.ts` ✅ 2/2
  - `npm run typecheck` ✅
  - `npm run build` ✅（仅既有 Echarts dynamic-import / chunk-size warning）
  - 数据探索 LLM 隔离 grep ✅ 0 匹配
- 下一步：
  - 用户 review 后手动 `git add/commit`。
  - 知识图谱 preview / history 本轮只接 API wrapper，后续如需要可单开前端接入卡，在 `KnowledgeGraphPane` 说明页或独立历史抽屉中展示。
  - 等待用户进行 KG 图谱筛选、节点质量提示、trace 失败状态闭环与巡检建议的浏览器人工实跑点检。
  - 推进 `KICKOFF-P0.md` 其他项。
- 阻塞 / 待总控：无。
- 开放问题：
  - KG 既有 node/edge mutation API 仍是 legacy id-scoped 端点；如需强化跨 workspace 写隔离，后续应新增 workspace-scoped patch/delete 路由并迁移前端调用。
  - KG history eventType 实装为 `sync` / `extract` / `edge_added` 等短枚举，与最初 wiki 建议的 `sync_summary` / `extract_summary` 命名不同；已按实际类型验收，后续不要混用。
  - V-TRACE5 的失败状态更新动作目前为了快速处理，设计成免二次确认的短按钮 + prompt() 形式，并依赖后端或本地重刷回滚；若后续发生大面积误触问题，再考虑补齐二次弹窗确认流程。

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| Dashboard·BI | `BiDashboardPane` `BiImportDialog` `NewMemberRetentionPane` `OldMemberRecallPane` `lib/{useBiDataset,biDatasetParser}.ts` | `bi-datasets`(legacy) |
| 报告历史 | `ReportHistoryPane` `ReportPreviewDrawer` `lib/useReportHistory.ts` | `reports.ts` + `report_tags` 表 |
| 模型历史 | `ModelRunHistoryDashboard` | model-lab 统计 |
| 报告输出/汇报/审核/黄金策 | `PreviewPane` `PresentationVersionPane` `ReportReviewPane` `GoldenStrategyPane` `Markdown` | `report-review.ts` `html-report.ts` |
| trace/token/知识图谱 | `TracePane` `TokenStatsPane` `KnowledgeGraphPane` `ProcessTrace` | `knowledge-graph.ts` |

db 新表建 `db/viz.ts:initVizTables`（P0-B 的 `dashboards` 表在此）；HTTP 走 `routes/viz.ts`；前端方法进 `lib/api/viz.ts`。

---

## 二、领域约束 / 安全契约

- **报告内容（md/html 原文）不发送给任何 LLM**（Drawer 仅本地渲染）——与 AGENTS.md 探索红线策略一致，报告历史虽不在探索模块内但策略统一。
- **高质量 HTML 报告**用 `runPiPrompt` 排版，要求模型产出单文件自包含 HTML、**完全隔离外链防数据泄漏**。
- 报告审核**涉及 LLM 是预期行为**（审核/修改本就需要 LLM），不受数据探索零-LLM 约束。
- `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` 是**一次性授权**改过的文件，AGENTS.md 未更新 → 仍按"他人成果"对待，改前确认。
- **onto 大文档抽取必须异步 job 化**：单批抽取同时受 prompt 数量上限、`CONTENT_LIMIT` 截断、300s 超时三重限制；V 后续实现必须用 `ExtractJob` + `extract_jobs` 表 + REST 轮询，不要再把大文档抽取做成单次同步 API。
- **报告消费面板统一走「报告输出」登记路径（2026-06-15）**：报告消费与推理面板（汇报版本/报告审核/黄金策/行动/决策树）一律以 `listSessionPaths/listFlowPaths/listWorkspacePaths(...,"report")` + `workspacePathTree` 为数据源，按 `pathId/relPath` 经 `workspacePathFileGet` 读取、经端点 `getWorkspacePath→outputDir(=dir? entry.path : dirname)/sourceRelPath→readFlowFile` 解析（范式见 `generatePresentationVersion`）。**禁止再扫 session/flow 原生 artifact/run tree**（那样会漏掉登记在标准目录外的报告——黄金策/行动/决策树的旧 bug 根因）。对应的后端端点（如 golden-strategy、actions/extract、decision-tree/generate）已全部从旧的 `{source,path,runId}` 强参数形态切换为 `{pathId,relPath}` 的标准规范。
- **ActionItem.reportPath 口径（2026-06-14）**：action-items 以 `reportPath = \`${pathId}:${relPath}\`` 作为报告关联/去重 key。2026-06-14 从旧 artifact-relative path 切换为该格式，**向前生效不迁移**，旧 action items 失联但不删（与业务需求 requirementInput backfill 决策一致）。

---

## 三、关键决策沉淀

**Dashboard / BI**
- 报告历史从 BI 内嵌上提为**独立二级 tab**（与 BI/模型历史平级，避免 BI 页过载）。
- 标签 = 独立表 `report_tags(report_id, tag)` 多对多，**不复用 favorites**（单值布尔会撑歪 schema）；编辑入口在 Drawer footer chips（不做卡片 hover 编辑，防误触）；筛选多选下拉 OR 语义；`allTags` 从内存 entries `useMemo` 算 count（不二次拉 API）。
- BI dataset 存储 = 独立 `bi_datasets` 表 + `~/.pi-xanthil/bi-datasets/` 目录（**不复用 workspace_paths**，避免引 workspaceId 上下文/选目录流程）；**双副本**（原文件 + 解析后 columns/rows JSON 入 SQLite，`/active` 零再解析直返）；列匹配宽松（alias 归一 + 数值 >1.5 自动 /100）；**上传即生效 + slot 单激活**。
- 会员表语义（最终版）：每行=统计当月，每列=回看 M-N 月，单元格=当月回购老客里上次购买在 N 月前的占比/人数；删期数切换器，改占比/人数二选一；**着色始终基于原始占比**（切人数视图仍有热力强度）。
- 看板画布数据聚合格式统一：各图表聚合输出类型强制统一为 `Array<{ name: string; value: number }>`，无维度时返回 `name: "总计"`。此机制根除了不同图表组件间因聚合数据结构不一致导致的 TypeScript Union 类型推导冲突。
- Dashboard / API 路由约定：所有业务路由必须带有 `/api` 前缀（由于 `index.ts` 中 `app.use(vizRouter)` 未指定前缀，因此 `viz.ts` 内部必须显式声明如 `/api/dashboards`）。
- Dashboard 交互容错与默认行为：空列表状态下不再自动建表（避免误导用户产生脏数据），改为友好的空状态引导加"一键生成"按钮；所有 API 错误均在 UI 层给予显式反馈（如 alert），禁止静默 `console.error`；旧版留存/召回的固定图表组件不再保留独立入口，功能已完全并入多图画布的默认配置中。
- **目标测算保存流程（2026-06-27）**：`HealthTargetPane` 保存走 `createTargetPlan` → `adoptTargetPlan` 两步（创建 draft 后立即 adopt），adopt 返回 `goalDatasetPathId` 写入 monitor_config 的 datasetBindings（role=goal）。观星台通过 `listTargetPlans` 筛选 `status === "adopted"` 展示绑定状态。D-MONITOR-TARGET3 未实装前前端调用会 404，但契约已对齐。

**模型历史 dashboard**
- row 对齐 = **id 优先，无 id 回退下标**（自动）；diff 导出 MD 单文件全量（meta+字段+行级）；删除接口 `onlyFailed` **缺省 true**（防误删成功记录），显式传 false 才按时间删全部；单行删除按钮**仅失败行**显示（成功记录是有价值历史）；diff 走 `summarizeResult()` 扁平输出，不递归 row-level（28 模型 row 结构差异大，按需展开 UI 复杂度爆炸）。

**报告审核 / 汇报 / 黄金策**
- LLM 评审输出**结构化 JSON**（`reviewMarkdown` + `annotations[]` + `totalScore`），而非纯 Markdown → 行内批注与评分可解析。
- 审核历史**物化为 `review_history/*.json` 文件**（按 `pathId+relPath` 过滤），不走数据库。
- Diff 复用 `BusinessRequirementPane` 的 **LCS 行级算法，前端计算**，不新增后端 API；AI 修改后自动切 Diff tab。
- **LLM 长任务「切 tab 续跑」范式**（2026-06-11 hotfix 已落）：黄金策 / 审核(含 autoFix) / 汇报版本 / TOC / 决策树 / 业务需求 / 聚合 等 Pane 的「进行中标志 + 结果」一律**不放组件 `useState`**，改用 `web/src/lib/resumableTask.ts` 的 `useResumableTask(key)`（module 层 store，unmount 不 abort，mount 自动 rehydrate）。范式与 key 约定细节见 notes-data 同名条（D 域 canonical）。**落文件的 Pane**（汇报/业务需求/TOC/决策树等）原 `onGenerated`/`loadHistory` 回调**保留**，续传与落库不冲突。新增此类长任务 Pane 一律走此范式，勿再用本地 useState 存 loading/data。
- **专题 (zhuanti) 报告链路渲染路由**：`VizTabs` 中的报告五件套支持 `zhuanti` tab；其中 `golden_strategy` 与 `actions` 的 scope 强制构造为 `{ type: "flow", flow: ctx.zhuantiChatFlow }`。若 flow 尚处于 ensure 中（未就绪），则通过可选链安全降级为 `flow: null`，交由 Pane 自身去处理渲染逻辑。
- **chartSpecs 契约（2026-06-19，V→D 承接）**：汇报版本接 BI dataset 出图走「服务端确定性聚合 + 前端 ReactECharts 透传 option」范式，**不让 LLM 选图/造 option**。
  - X 契约：`Array<{ id: string; title: string; option: Record<string, unknown> }>`，`option` 即 echarts EChartsOption，前端 `<ReactECharts option={spec.option} />` 原样喂。
  - 数据隔离铁律：服务端 `getBiDatasetById` 拿到的 dataset 是已脱敏聚合 BI dataset（slot 限定 `member_retention` / `member_recall`），可用其 row 跑确定性聚合产 option；但**只能把 schema + 数值列 min/max/mean 摘要喂 LLM**（`summarizeDatasetForLlm`），row 级数据永不进 prompt。该约束写在 `presentation-charts.ts` 文件头注释，扩展 slot 时务必沿用。
  - 模块边界：聚合实现在 `server/src/presentation-charts.ts` 自包含（不走 D 域 `routes/data.ts` 的 BiAggregationData 通路，因为汇报版本只读 BI dataset 单源、不需要跨域聚合查询）；前端聚合复用 `web/src/lib/biDatasetParser.ts` 的 alias / `toRatio` 算法（服务端复刻一份，没用 import 跨包以保持服务端独立 build）。
  - 故事线 iframe 不渲图：iframe `sandbox=""` 禁脚本，echarts 进不去；图表块只在汇报 Markdown 预览面板上方栅格渲染（lg:grid-cols-2，h-64/卡片）。后续若要让单文件故事线 HTML 也带图，需走 SVG 内联或 PNG base64 路线，需总控拍板。

**知识图谱 / trace**（可视化部分）
- 知识图谱挂「规则记忆」二级 tab（非顶栏独立）；Phase A 结构化图谱优先（无 LightRAG 依赖）；摄入 = 手动触发 + 变更累积；注入折叠进 `injectRulesPrompt` 开关；节点**隐藏而非物理删除**。
- onto-xanthil 文档抽取分批方案：CSV 按行切分、普通文本按字符窗口切分；每批顺序调用既有 `processExtractionOutput`。**不要重造跨批合并逻辑**，因为 `processExtractionOutput` 每批都会重读库 `listObjectTypes`，并通过 `resolveId` 模糊解析让后批看见前批实体、正确连边。
- `extract_jobs` 表属于 V 域 schema，放 `db/viz.ts:initVizTables`，字段口径以 `ExtractJob` 为准；与 `onto_*` / `action_*` 同模式走 `CREATE TABLE IF NOT EXISTS`，不 ALTER 他域表、不加 FK。
- 大文档抽取前端进度应复用长任务续跑范式：后台 REST 起 job，DB 持久化进度，前端轮询 `ExtractJob`；切 tab / unmount 后重新 mount 仍可恢复进度。
- **图谱视图过滤与质量提示**（2026-06-29）：知识图谱关系筛选（V-KG1）与质量提示（V-KG2）全部基于前端 `rawNodes` / `rawEdges` 在内存计算。为防页面变卡并维持组件整洁，质量提示主要作为辅助视觉信号（不进入数据库）；边过滤不引起独立节点隐身，从而维持稳定视角。

**规则记忆 4 Pane · 全局池化 UI 范式**
- 列表数据源 = 全局池（`api.listRules/Standards/Cases/BusinessContexts/Metrics` 返回所有 ws 的条目，`workspaceId` 字段表示 origin）；启用态 = `sharedApi.listMemoryEnablements(ws, kind)` 索引 Map。两路独立拉取、独立更新。
- kind 映射固定：偏好=`rule`、指标=`metric`、参考文件=`standard`、项目=`case`、业务环境=`business_context`（与 `MemoryItemKind` 类型一致；勿在 UI 自创映射）。
- **toggle 用乐观更新 + 函数式 setState**：`setEnablements(prev => { const m = new Map(prev); m.set(id, next); return m; })`。直接 `new Map(enablements).set(...)` 会捕获 stale closure，快速连点丢更新。`bulkSetEnabled` 同理，循环 set 在函数式 reducer 内做。
- **创建/编辑/删除一律 `await refresh()` 全量重拉，不本地 patch**：全局池语义下编辑跨 ws 生效，本地 `Date.now()` 假装更新会与真实状态漂移；总控保证创建时 `enableForOrigin` 自动建启用关系，但前端必须 refresh 才能看到新条目的勾选态。
- **删除提示必须说"全局池删除，所有工作区都将失效"**：避免用户误以为只删本 ws。
- 视觉契约：来源徽标（`item.workspaceId !== workspaceId` 时渲染琥珀色"来源"）+ toggle 按钮文案统一为"本工作区启用/停用"+ emerald/灰二态分色。
- `IndicatorsPane` 特殊：metric + reference_file 在同一 Pane 用 `StandardSection` 复用渲染，但 toggle 走不同 kind（`metric` vs `standard`），所以 `listMemoryEnablements(ws)` 不带 kind 过滤，一次拉全，按 id 索引（metric/standard 表 id 不冲突）。
- `workspaceId!` non-null 断言不可作为类型保证（UI 守卫不被 TS 信任）；toggle 入口必须显式 `if (!workspaceId) return;`。
- **Ontology 隐式级联**：本体（Ontology）采用了“整体验收”原则，对象/关系/指标/逻辑/动作等从属于本体的条目不设立独立的启用开关，均追随其父本体的启用状态。

---

## 四、踩坑 / 陷阱

- `scope` 对象引用 bug（同 E）：决策树/TOC Pane 因 `useCallback([scope])` 引用变化每次重渲染清空画布；根治在 Pane 内提取稳定原始值作 deps + `scopeRef` 持最新 scope；内容加载 effect 依赖 `selectedReport?.id`（字符串）而非对象。
- 报告类文件识别：`report/报告/result/summary/.md` 文件图标高亮琥珀色；运行中每 4s 刷新文件树。
- DND 排序中 `moved` 元素类型残留：`array.splice` 返回的对象解构后，在 TypeScript 中可能被推导为包含 `undefined`，直接传回 `splice` 插入会引发类型报错。必须使用 `if (moved)` 守卫做存在性包裹以消除编译器报警。
- API 契约调用陷阱：跨域（V 调用 D 的 REST 接口）获取数据源数据时，必须直接复用已封装的领域 `dataApi.getBiAggregationData` 方法。如果在 V 域侧自行硬编码 `fetch` 拼接路径，极易因对方实际路由细节（如尾部 `/:pathId/data` 的后缀设计）导致偶发的 404 Not Found 漏洞。
- **全局池 toggle 的 stale closure 陷阱**：写 `setEnablements(new Map(enablements).set(id, next))` 看似 OK，实则 `enablements` 是 render 快照，快速连点第二次仍读旧 Map → 第一次更新丢失。必须用函数式 setState `setEnablements(prev => { const m = new Map(prev); m.set(id, next); return m; })`。同坑在所有"Map/Set state + 高频 toggle"场景重现。
- **全局池创建后启用态显示停用**：总控约定创建时自动 `enableForOrigin`，但前端如果只 `setItems(...prev, created)` 而不重拉 enablements，新建条目因 enablements Map 里没记录，`get(id) ?? false` 显示"停用"。规避：所有 create/update/delete 一律 `await refresh()` 全量重拉，别想省那一次 round-trip。
- **调用 LLM 提取陷阱（pi-adapter.ts）**：使用 `runPiPrompt` 提取策略报告时，注意该接口源码已内建 `--no-skills`, `--no-tools`, `--no-context-files` 参数（针对独立分析/重排任务优化），调用方切勿通过 `extraArgs` 或 `prompt` 中再多此一举传入；同时其返回的纯文本应基于 `try/catch + RegExp` 处理 Markdown Json block，以防部分模型输出絮叨开头（如 `Here is the JSON...`）导致解析阻断。
- **跨域私有工具方法导出**：若在路由层（如 `routes/viz.ts`）尝试复用其它域的 `validateArtifactPath`（挂载于 `index.ts` 私有域），TypeScript 跨文件 import 将报 2305 错。应对方式：若不想扰乱原文件的导出契约，可以在自身域就近实现无害等价物或走正当重构（抽取 `flow-fs.ts` 或 `output-paths.ts`）。
- **TS Re-export Type 陷阱**：`ValidationIssue` 在 `server/src/types.ts` 中仅作为 `import type` 引入供接口定义使用，并未 `export`。如果在其它文件（如 `db/viz.ts`）中尝试从 `types.ts` 导入它，会报 TS2459 错误。正确做法是直接从源头 `onto-validator.ts` 导入。
- **轮询定时器泄漏**：使用 `setInterval` 轮询 job 进度时，必须在 job 达到终态（`success` / `failed` / `aborted`）时在轮询回调内显式调用 `clearInterval`，否则即便组件未卸载，前端仍会持续发起无效的 fetch。
- **故事线 iframe sandbox 与 echarts 不兼容**（2026-06-19）：`PresentationVersionPane` 故事线 tab 用 `<iframe sandbox="">` 渲染 storylineHtml（无脚本、无外链，防 XSS / 数据回传），echarts 需要 JS 运行时，因此**图表块不能直接嵌进 storylineHtml**。当前选择把 chartSpecs 渲染在汇报版本 Markdown 上方的卡片栅格里，故事线 HTML 仍是无图的纯文字流程。若后续要让 storylineHtml 带图，必须走静态 SVG 内联或 PNG base64（不能解 sandbox），属于独立功能项，不要在 chartSpecs 渲染分支里临时撕口子。
- **echarts-for-react 静/动态 import 警告**（2026-06-19，无害）：`PresentationVersionPane` 静态 import `echarts-for-react`，与 `BiDashboardPane` 同模式；但仓库里 `CompetitorPane` / `IndustryPane` / `WeatherPane` 是动态 import，rollup build 会打 warning："dynamic import will not move module into another chunk"。这是历史遗留组合（V 域三个 Pane 用动态 import），新增 Pane 默认跟 `BiDashboardPane` 走静态 import 即可，不要为了消警告改既有动态 import 的 Pane。
- **体检模块·跨域数据读取必须走 fetch D 域 API**（2026-06-22，四轮终审教训）：V-HEALTH2 run 编排最初直接 import `getWorkspacePath` + `readFileSync` + `parseAggregationBuffer` 读 clean_data 行数据，被终审判为"绕过跨域调用口径 + 跨 workspace pathId 无校验导致数据泄漏"。正确做法：服务端 `fetch(http://localhost:${PORT}/api/bi/aggregations?workspaceId=…)` 先列表校验 pathId 归属本 ws，再逐集 `fetch(…/:pathId/data)` 取行数据。**禁止 V 域路由直接 import D 域 db 函数或 workspace_paths 表读取函数用于 health**——这既是安全边界（pathId 归属校验），也是 Orchestration §五.3 跨域走 HTTP 的契约要求。
- **体检模块·非本 ws pathId 必须 400 拒绝、不落空 run**（2026-06-22）：pathId 归属校验必须在 `insertHealthRun` **之前**完成，有非法 pathId 直接 400 返回、不落 running 状态的空 run。否则会留下 status=running 永不结束的孤儿 run 记录。
- **体检模块·lifecycle priorFindings 必须按 suite + datasetPathIds 组合匹配**（2026-06-22）：跨 run 比对取 priorFindings 时，不能只按 workspace 取最近一次 run——切换套餐（daily→monthly）或换数据集后，旧 run 的 findings 会被误标为 resolved。`listFindingsByRun` 必须接受 suite + datasetPathIds 参数，按排序后组合键匹配同配置的上一 run。
- **体检模块·findings 路由必须 workspace-scoped + runId 归属校验**（2026-06-22）：`GET /api/health/runs/:runId/findings` 不带 workspaceId 是安全漏洞——任何 runId 可被任意 ws 访问。必须改为 `GET /api/workspaces/:id/health/runs/:runId/findings` + 校验 runId 归属本 ws。
- **体检模块·接入面板必须调 addWorkspacePath 登记产物**（2026-06-22）：SQL export / extraction-tool run 产出的文件不会自动进 clean_data 聚合集列表——必须调 `api.addWorkspacePath(workspaceId, "clean_data", path, "file")` 登记。SQL export 用 `result.path`（规范化路径）不要用用户原始输入；tool run 读 `run.results[].outputs` 过滤表格文件（.csv/.tsv/.xlsx/.xls）逐个登记，登记失败不吞 catch、收集错误显示给用户。
- **体检模块·跨 ws 切换需 effect cancellation guard**（2026-06-22）：报告页 useEffect 在 workspaceId 变化时除了清空 state，还必须加 `cancelled` flag + cleanup return——否则旧 ws 的异步请求晚返回时会覆盖新 ws 的 state。
- **体检模块·HTML 导出复用 renderMarkdownReportToHtml**（2026-06-22）：新增 `POST /api/workspaces/:id/health/export-html` 端点，server 端调 `html-report.ts` 的 `renderMarkdownReportToHtml`，前端 POST markdown 内容获取渲染后 HTML 下载。不要在前端拼 `<pre>` 假装 HTML 报告。
- **体检模块跨域数据读取必须走 HTTP fetch**（2026-06-22）：V-HEALTH2 run 编排读行数据时，不能直接 `import { getWorkspacePath } from "../db.ts"` + `readFileSync` + `parseAggregationBuffer`——这绕过了 D 域 `/api/bi/aggregations` 端点的 workspace 归属校验，导致任意 pathId 可读其他 workspace 的 clean_data（终审阻断项）。正确做法：服务端 `fetch("http://localhost:${PORT}/api/bi/aggregations?workspaceId=...")` 先列表校验 pathId 归属，再逐集 `fetch(".../:pathId/data")` 取行数据。这遵循 Orchestration §五.3 跨域走 HTTP fetch 而非直接 import。
- **体检 pathId 校验必须在落 run 之前**（2026-06-22）：非本 workspace 的 pathId 不能静默跳过（会落一个空 run 返回成功，误导用户）。正确做法：先 fetch 列表端点校验全部 pathId 归属，有非法直接 400 返回，不 insertHealthRun。
- **体检 lifecycle 比对必须限定同 suite + 同数据集组合**（2026-06-22）：`listFindingsByRun` 若只按 workspace 取最近 run，切换套餐或选集后会产生错误的 resolved/recurring。正确做法：传 suite + datasetPathIds 参数，按排序后组合键匹配 prior run。
- **体检 findings 路由必须 workspace-scoped**（2026-06-22）：全局 `/api/health/runs/:runId/findings` 缺 workspace 归属校验。正确做法：`/api/workspaces/:id/health/runs/:runId/findings` + 校验 runId 归属本 workspace。
- **体检跨 pane runId 传递用 module store**（2026-06-22）：不能用 `ctx.activeSessionId` 传 health runId（语义不符且默认空）。正确做法：`web/src/lib/health-ui-state.ts` module-level 变量 `getHealthSelectedRunId/setHealthSelectedRunId`，dashboard run 后 set、report mount 时 get。跨 workspace 切换时 report useEffect 清空 state + cancelled guard 防旧请求覆盖。
- **体检接入面板必须调 addWorkspacePath 登记产物**（2026-06-22）：SQL export / extraction tool run 产出的文件不会自动进入 clean_data 聚合集列表。正确做法：SQL export 后用 `result.path`（exportSql 返回的规范化路径，非用户原始输入）调 `api.addWorkspacePath(workspaceId, "clean_data", path, "file")`；tool run 后遍历 `run.results[].outputs` 过滤表格文件(.csv/.tsv/.xlsx/.xls)逐个登记。登记失败不吞 catch，收集错误显示给用户。
- **体检 HTML 导出必须复用 renderMarkdownReportToHtml**（2026-06-22）：不能在前端拼 `<pre>` 放 Markdown——那不是渲染后的 HTML 报告。正确做法：新增 `POST /api/workspaces/:id/health/export-html` 端点，server 端调 `renderMarkdownReportToHtml(reportName, markdown)` 返回 HTML，前端 fetch 后下载。
- **Express 同一路径重复注册**（2026-06-22）：`vizRouter.post("/api/.../export-html", ...)` 重复注册两次时，第二个 handler 永远不可达，不报错但功能失效。多文件 cat >> 追加时尤其注意。
- **TracePane 状态局部更新机制（2026-06-29）**：对于 V-TRACE5 失败卡片状态变更（如 mark as fixed），如果先 `await api.updateTraceFailureStatus` 再重刷列表，网络延迟会造成操作手感滞后或冻结。因此必须采用乐观更新（Optimistic Update）：用 `setFailures` 在本地映射到新状态再调用 API，但若 API 异常抛出，则在 catch 块必须重新 fetch 原数据来回滚 UI，避免留下幽灵状态。

---

## 五、未验证 / 历史待办（真实优先级见 KICKOFF-P0）

- 报告历史累积 ~19 步浏览器端到端实测未做；BI dataset `/active` 的 LLM 接入（Session 10 遗留）。
- 报告审核 8 项创新（闭环验证/分维度修改/模板库/批量审核/类型识别/置信度/导出/Checklist）未动。
- 全量 28 模型端到端验证。
- **当前主线 = KICKOFF P0-B 看板画布**（拖拽多图 + 图表推荐 + 联动；首用 `db/viz.ts` 的 `dashboards` 表）。

---

## 六、P1：报告交付 + 看板取数走语义层

- 报告交付：周/月/专题模板库 + PPT/Word/PDF 导出 + 定时推送（飞书/企微）+ 移动端适配。
- 看板取数**强制引用** `MetricDefinition`（总控定契约、D 实现），不自造口径。
