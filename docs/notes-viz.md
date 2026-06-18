# 可视交付域 · 领域笔记（Agent-V）

> **活文档**：长效领域知识，由 V 持续维护。蒸馏自旧 handoff：`Dashboard` `探索`(报告/汇报/审核/黄金策部分) `规则记忆`(trace/token/知识图谱部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-18 · VizTabs 支持 zhuanti 模式下的报告五件套
- 进度：
  - **专题 (zhuanti) 报告链路闭环**：`VizTabs` 中的 `report`, `presentation_version`, `report_review` 均已通过扩展条件 `exploreOrMultiOrZhuanti` 支持专题模式。`golden_strategy` 和 `actions` 面板也增加了专题的特定分支。
  - **专题 Flow Scope 降级**：通过 `ctx.zhuantiChatFlow?.kind === "multi" ? ctx.zhuantiChatFlow : null` 为 `golden_strategy` 和 `actions` 面板构造并传递了安全的作用域，与 `multi` 分支对齐。
- 校验：
  - `npm run typecheck`：✅ server + web 全绿。
  - `npm run build`：✅ 全绿；无底层骨架篡改。
- 下一步：
  - ① 需要总控（Claude）确认：`golden_strategy` 和 `actions` 面板中，若 `ctx.zhuantiChatFlow` 尚在 ensure 中未就绪，降级为 `flow: null` 交给 Pane 自身处理是否足够。
  - ② 确认 `DecisionTreePane` 的界面入口（上个 session 遗留）。
  - ③ KICKOFF P0-B 看板画布持续推进。
- 阻塞 / 待总控：
  - 无代码阻塞。
- 开放问题：
  - `ctx.zhuantiChatFlow` 为空或处于 ensure 过程中时，Pane 自身处理 `flow: null` 的行为，是否需要类似 explore 模式补充 session scope 的 fallback 降级？

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

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
- 看板数据源解耦重构：从原本绑死的双 slot（`member_retention` / `member_recall`）改造为基于 `api.getBiAggregations` 读取 D 域 `clean_data` 聚合结果池的动态模式。历史的预置看板被收拢为"从模板新建"入口以作向下兼容。

**模型历史 dashboard**
- row 对齐 = **id 优先，无 id 回退下标**（自动）；diff 导出 MD 单文件全量（meta+字段+行级）；删除接口 `onlyFailed` **缺省 true**（防误删成功记录），显式传 false 才按时间删全部；单行删除按钮**仅失败行**显示（成功记录是有价值历史）；diff 走 `summarizeResult()` 扁平输出，不递归 row-level（28 模型 row 结构差异大，按需展开 UI 复杂度爆炸）。

**报告审核 / 汇报 / 黄金策**
- LLM 评审输出**结构化 JSON**（`reviewMarkdown` + `annotations[]` + `totalScore`），而非纯 Markdown → 行内批注与评分可解析。
- 审核历史**物化为 `review_history/*.json` 文件**（按 `pathId+relPath` 过滤），不走数据库。
- Diff 复用 `BusinessRequirementPane` 的 **LCS 行级算法，前端计算**，不新增后端 API；AI 修改后自动切 Diff tab。
- **LLM 长任务「切 tab 续跑」范式**（2026-06-11 hotfix 已落）：黄金策 / 审核(含 autoFix) / 汇报版本 / TOC / 决策树 / 业务需求 / 聚合 等 Pane 的「进行中标志 + 结果」一律**不放组件 `useState`**，改用 `web/src/lib/resumableTask.ts` 的 `useResumableTask(key)`（module 层 store，unmount 不 abort，mount 自动 rehydrate）。范式与 key 约定细节见 notes-data 同名条（D 域 canonical）。**落文件的 Pane**（汇报/业务需求/TOC/决策树等）原 `onGenerated`/`loadHistory` 回调**保留**，续传与落库不冲突。新增此类长任务 Pane 一律走此范式，勿再用本地 useState 存 loading/data。
- **专题 (zhuanti) 报告链路渲染路由**：`VizTabs` 中的报告五件套支持 `zhuanti` tab；其中 `golden_strategy` 与 `actions` 的 scope 强制构造为 `{ type: "flow", flow: ctx.zhuantiChatFlow }`。若 flow 尚处于 ensure 中（未就绪），则通过可选链安全降级为 `flow: null`，交由 Pane 自身去处理渲染逻辑。

**知识图谱 / trace**（可视化部分）
- 知识图谱挂「规则记忆」二级 tab（非顶栏独立）；Phase A 结构化图谱优先（无 LightRAG 依赖）；摄入 = 手动触发 + 变更累积；注入折叠进 `injectRulesPrompt` 开关；节点**隐藏而非物理删除**。
- onto-xanthil 文档抽取分批方案：CSV 按行切分、普通文本按字符窗口切分；每批顺序调用既有 `processExtractionOutput`。**不要重造跨批合并逻辑**，因为 `processExtractionOutput` 每批都会重读库 `listObjectTypes`，并通过 `resolveId` 模糊解析让后批看见前批实体、正确连边。
- `extract_jobs` 表属于 V 域 schema，放 `db/viz.ts:initVizTables`，字段口径以 `ExtractJob` 为准；与 `onto_*` / `action_*` 同模式走 `CREATE TABLE IF NOT EXISTS`，不 ALTER 他域表、不加 FK。
- 大文档抽取前端进度应复用长任务续跑范式：后台 REST 起 job，DB 持久化进度，前端轮询 `ExtractJob`；切 tab / unmount 后重新 mount 仍可恢复进度。

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
