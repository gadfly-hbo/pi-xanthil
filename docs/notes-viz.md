# 可视交付域 · 领域笔记（Agent-V）

> **活文档**：长效领域知识，由 V 持续维护。蒸馏自旧 handoff：`Dashboard` `探索`(报告/汇报/审核/黄金策部分) `规则记忆`(trace/token/知识图谱部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-08 · 总控建档
- 进度：P0-B「看板画布」待启动
- 下一步：见 `KICKOFF-P0.md` → Agent-V P0-B（首用 `db/viz.ts` 的 `dashboards` 表）
- 阻塞 / 待总控：`dashboards` 表 schema 需先报总控审
- 开放问题：无

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

---

## 三、关键决策沉淀

**Dashboard / BI**
- 报告历史从 BI 内嵌上提为**独立二级 tab**（与 BI/模型历史平级，避免 BI 页过载）。
- 标签 = 独立表 `report_tags(report_id, tag)` 多对多，**不复用 favorites**（单值布尔会撑歪 schema）；编辑入口在 Drawer footer chips（不做卡片 hover 编辑，防误触）；筛选多选下拉 OR 语义；`allTags` 从内存 entries `useMemo` 算 count（不二次拉 API）。
- BI dataset 存储 = 独立 `bi_datasets` 表 + `~/.pi-xanthil/bi-datasets/` 目录（**不复用 workspace_paths**，避免引 workspaceId 上下文/选目录流程）；**双副本**（原文件 + 解析后 columns/rows JSON 入 SQLite，`/active` 零再解析直返）；列匹配宽松（alias 归一 + 数值 >1.5 自动 /100）；**上传即生效 + slot 单激活**。
- 会员表语义（最终版）：每行=统计当月，每列=回看 M-N 月，单元格=当月回购老客里上次购买在 N 月前的占比/人数；删期数切换器，改占比/人数二选一；**着色始终基于原始占比**（切人数视图仍有热力强度）。

**模型历史 dashboard**
- row 对齐 = **id 优先，无 id 回退下标**（自动）；diff 导出 MD 单文件全量（meta+字段+行级）；删除接口 `onlyFailed` **缺省 true**（防误删成功记录），显式传 false 才按时间删全部；单行删除按钮**仅失败行**显示（成功记录是有价值历史）；diff 走 `summarizeResult()` 扁平输出，不递归 row-level（28 模型 row 结构差异大，按需展开 UI 复杂度爆炸）。

**报告审核 / 汇报 / 黄金策**
- LLM 评审输出**结构化 JSON**（`reviewMarkdown` + `annotations[]` + `totalScore`），而非纯 Markdown → 行内批注与评分可解析。
- 审核历史**物化为 `review_history/*.json` 文件**（按 `pathId+relPath` 过滤），不走数据库。
- Diff 复用 `BusinessRequirementPane` 的 **LCS 行级算法，前端计算**，不新增后端 API；AI 修改后自动切 Diff tab。

**知识图谱 / trace**（可视化部分）
- 知识图谱挂「规则记忆」二级 tab（非顶栏独立）；Phase A 结构化图谱优先（无 LightRAG 依赖）；摄入 = 手动触发 + 变更累积；注入折叠进 `injectRulesPrompt` 开关；节点**隐藏而非物理删除**。

---

## 四、踩坑 / 陷阱

- `scope` 对象引用 bug（同 E）：决策树/TOC Pane 因 `useCallback([scope])` 引用变化每次重渲染清空画布；根治在 Pane 内提取稳定原始值作 deps + `scopeRef` 持最新 scope；内容加载 effect 依赖 `selectedReport?.id`（字符串）而非对象。
- 报告类文件识别：`report/报告/result/summary/.md` 文件图标高亮琥珀色；运行中每 4s 刷新文件树。

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
