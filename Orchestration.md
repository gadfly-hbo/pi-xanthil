# pi-Xanthil 总控章程（Orchestration）

> 本文件是多 Agent 协同开发的**唯一调度基线**。任何 Agent 开工前必须先读本文件 + `AGENTS.md`。
> 总控 = Claude（Opus）：负责架构、接缝层、接口契约、db migration 审批、跨域集成、**全部代码终审**。
> 三个编程 Agent 在各自域的 **slot 文件**内开发，**永不触碰接缝层骨架文件**。

最后更新：2026-06-08 · 状态：**第 0 步接缝重构完成** ✅ —— 批1(server routes)✅ 批2a(web api)✅ 批2b(App.tsx 域模块)✅ 批3(db slot)✅；server+web typecheck 全绿(baseline 错误已清)、build 通过。三 agent 可全面并行。

---

## 一、角色与职责

| 角色 | 模型 | 职责边界 |
|---|---|---|
| **总控（Claude Opus）** | — | 产品架构、接缝重构、`types.ts` 契约、db migration 审批、跨域集成、终审 merge |
| **Agent-D** 数据基座 | opencode（deepseek-v4-pro / glm-5.1）| 数据接入 + 准备 + 指标语义层 |
| **Agent-E** 智能引擎 | codex（GPT-5.5）| Agent 对话 + 工作流 + AnaX + Eval/Harness |
| **Agent-V** 可视交付 | antigravity（Gemini）| 看板 + 图表 + 报告交付 |

匹配理由：deepseek/glm → CRUD 密集 + 中文业务 + 连接器（数据域）；GPT-5.5 → 复杂状态机 + 流式事件 + gate 逻辑严谨（引擎域）；Gemini → 大上下文 + echarts/图表推荐 + PPT/PDF（交付域）。

---

## 二、产品框架：沿价值链重组为 4 域

```
[接缝层·总控] index/db/App/api/types/constants（重构为各域 slot）
      │
数据进 ─D─ 准备 ─D─ 语义层 ─D─ 分析 ─E─ 可视化 ─V─ 看板报告 ─V─ 沉淀复用 ─E─ 治理(分摊)
      └──── Agent-D 数据基座 ────┘  └ Agent-E ┘ └──── Agent-V 可视交付 ────┘
```

治理域横切分摊：Eval/缓存 harness → E（引擎同源）；知识图谱/trace/token 看板 → V（可视化同源）；rules/案例库/记忆注入 → D（数据同源）。缓存 harness 契约（`cache.ts`/`prompt-blocks.ts`）由总控持有。

---

## 三、分工明细表

### 🟦 Agent-D · 数据基座（opencode）

| 项 | 内容 |
|---|---|
| **tab/subtab** | 计算工具(聚合/提取/SQL连接) · 探索→原始数据/聚合数据/数据探索 · Xan数据库(the-crowd/天气/商圈/行业/竞品) · 规则记忆→指标体系/业务环境/rules/案例库 |
| **前端文件** | `AggregatePane` `ExtractionPane` `SqlConnectPane` `DataExplorationPane` + `data-exploration/`(ChartCanvas/ConfigPanel/FieldList/FileSelector/InsightsReport/JoinBuilder/ProfileReport) · `WeatherPane` + 待建[商圈/行业/竞品/the-crowd]Pane · `IndicatorsPane` `BusinessContextPane` `RulesPane` `CasesPane` · `lib/{duckdb,aggregate,profiling,insights,joins,biDatasetParser}.ts` |
| **server slot** | `routes/data.ts` · `db/data.ts` · `sql-connections.ts` · `memory-injection.ts` |
| **P0** | **上传即用**：拖拽 Excel/CSV → duckdb 画像（替代当前路径登记式） |
| **P1** | **指标语义层**：IndicatorsPane 升级为可执行 metric store（定义→血缘→口径版本）· 清洗 pipeline + 派生字段持久化 · 连接测试/定时同步 |
| **铁律** | 严守 `AGENTS.md` 数据安全：`draw_data` 禁 LLM、数据探索纯前端零 LLM。改完跑隔离 grep 校验 |

### 🟩 Agent-E · 智能引擎（codex）

| 项 | 内容 |
|---|---|
| **tab/subtab** | 探索→工作视图(对话)/业务需求 · 工作流(全部) · AnaX(全部) · 实验室→skill/tool/model/DLF |
| **前端文件** | `ChatPane` `BusinessRequirementPane` `useBusinessRequirementContexts` · `MultiAgentExecutionPane` `CreationPane` `FlowEditorPane` `FlowWorkflowPane` `WorkflowDagEditor` `DecisionTreePane` `TocPane` `FlowChatPane` `AgentFlowPane` `RunOutputPanel` `ExecutionPane` · `AnaXPane` `AnaXReadmePane` `HypothesisPane` `ChangeManagementPane` · `SkillLabPane` `SkillSelector` `ToolLabPane` `ModelLabPane` `ModelBuilder` `ModelInfoCard` `OperationalModelPane` |
| **server slot** | `routes/engine.ts` · `db/engine.ts` · `multi-agent-runner.ts` `anax-template.ts` `anax-gate.ts` `autonomous-runner.ts` `flow-fs.ts` `change-management.ts` · `*-evaluation-runner.ts` `evaluation-*.ts` `skill-{curator,distillation,retrieval,activation}.ts` `skills.ts` `model-lab.ts` `tool-evaluation-*.ts` `memory-evaluation-*.ts` |
| **P0** | **E2E 验证补课**：AnaX 8 阶段喂真实聚合数据真跑 · skill 蒸馏全链路 smoke · SQL 真实库连接 |
| **P1** | Notebook(SQL/Python/MD 混排) · 清理 101 模型中 39 个 `auto_gen_model_*` 凑数模板 |

### 🟪 Agent-V · 可视交付（antigravity）

| 项 | 内容 |
|---|---|
| **tab/subtab** | Dashboard(BI/报告历史/模型历史) · 探索→报告输出/汇报版本/报告审核/黄金策 · 规则记忆→知识图谱/trace/token统计 |
| **前端文件** | `BiDashboardPane` `BiImportDialog` `ReportHistoryPane` `ReportPreviewDrawer` `ModelRunHistoryDashboard` · `PreviewPane` `PresentationVersionPane` `ReportReviewPane` `GoldenStrategyPane` `Markdown` `CopyButton` · `KnowledgeGraphPane` `TracePane` `TokenStatsPane` `ProcessTrace` · `NewMemberRetentionPane` `OldMemberRecallPane` · `lib/{reportTypeClassifier,evaluation-export,useReportHistory,useBiDataset,theme}.ts` |
| **server slot** | `routes/viz.ts` · `db/viz.ts` · `reports.ts` `html-report.ts` `report-review.ts` `knowledge-graph.ts` |
| **P0** | **看板画布**：拖拽多图组合 + 字段类型自动推荐图表 + 图表点击联动 |
| **P1** | **报告交付**：周/月/专题模板库 + PPT/Word/PDF 导出 + 定时推送(飞书/企微) · 移动端适配 |

---

## 四、接缝重构目标结构（总控第 0 步交付）

**原则**：6 个骨架文件变薄为"注册表"，业务逻辑下沉到各域 slot。重构**只搬运不改逻辑**，保证 typecheck/build 绿。

### server 端

```
server/src/
├── index.ts          【总控】仅保留：app 启动 + 中间件 + ws + registerRoutes(app) 调用
├── routes/
│   ├── index.ts      【总控】registerRoutes：依次挂载 data/engine/viz/shared
│   ├── data.ts       【D】  /api/sql-connections /api/extraction-tools /api/bi-datasets …
│   ├── engine.ts     【E】  /api/flows /api/sessions /api/runs /api/hypotheses /api/*-evaluations …
│   ├── viz.ts        【V】  /api/reports /api/report-review /api/golden-strategy /api/kg /api/toc /api/decision-tree …
│   └── shared.ts     【总控】/api/workspaces /api/workspace-paths /api/health /api/llm /api/pick-path
├── db.ts             【总控】schema 注册表 + 连接 + migration runner，re-export db/*
├── db/
│   ├── data.ts       【D】  数据源/指标语义层 表与 CRUD
│   ├── engine.ts     【E】  flows/sessions/eval/skill 表与 CRUD
│   ├── viz.ts        【V】  reports/report_tags/kg 表与 CRUD
│   └── shared.ts     【总控】workspaces/workspace_paths/token_stats 表
├── types.ts          【总控】跨域共享类型唯一源（agent 只读引用，不新增跨域类型）
└── （其余 *.ts 按§三 server slot 归属，文件级独占）
```

### web 端

```
web/src/
├── App.tsx           【总控】保留顶层状态/布局；render 块按域拆为 3 个渲染模块并 lazy 加载
├── tabs/             （各域独占渲染模块；pane props 异构，故不用统一 registry）
│   ├── DataTabs.tsx  【D】  data 域所有 subtab 的渲染分支
│   ├── EngineTabs.tsx【E】  engine 域所有 subtab 的渲染分支
│   └── VizTabs.tsx   【V】  viz 域所有 subtab 的渲染分支
├── lib/
│   ├── api.ts        【总控】仅 re-export api/*
│   ├── api/
│   │   ├── data.ts   【D】
│   │   ├── engine.ts 【E】
│   │   ├── viz.ts    【V】
│   │   └── shared.ts 【总控】
│   └── constants.ts  【总控】SubTab 枚举 + 各域 SUB_TABS（agent 提 PR 由总控合入）
└── components/
    ├── ui/           【总控】shadcn 共享组件
    └── *Pane.tsx     按§三前端文件归属，文件级独占
```

`App.tsx` 目标形态（域渲染模块，非统一 registry —— 因 pane props 异构）：

```tsx
// App.tsx 保留 activeTab/activeSubTab/scope/state，render 区委派给域模块
<DataTabs   tab={activeTab} subTab={activeSubTab} scope={scope} .../>
<EngineTabs tab={activeTab} subTab={activeSubTab} models={models} .../>
<VizTabs    tab={activeTab} subTab={activeSubTab} .../>
// 各域模块内部用 React.lazy(() => import("@/components/XxxPane")) 实现代码分割
```

---

## 五、接口契约规范

1. **db migration**：每域在 `db/<域>.ts` 内写建表 SQL，注册到 `db.ts` 的 `MIGRATIONS` 数组（带递增版本号）。**新表/改列必须先提 PR 给总控审**，防 schema 撞车。禁止 `ALTER` 他域表。
2. **类型契约**：跨域共享类型（`MetricDefinition` 语义层、`ReportEntry`、`WorkspacePath`、WS 事件）只能由总控在 `types.ts` 定义；agent 引用不新增跨域类型，域内私有类型放各自 slot。
3. **API 命名**：`/api/<域前缀>/...`，域前缀归属见 §四 routes。跨域读取走对方已暴露的 GET，不直接 import 对方 db 函数。
4. **WS 事件**：新增事件类型先在 `types.ts` 注册 union，再实现。
5. **指标语义层（P1 关键跨域契约）**：`MetricDefinition` 由总控定义 → **D 实现** metric store + CRUD → **E** 生成 SQL 时强制引用口径 → **V** 看板取数走统一口径。三方依赖同一契约，不各自造轮子。

---

## 六、冲突管理协议（强制）

- **接缝层只写权归总控**：`index.ts` `db.ts`(注册表部分) `App.tsx` `api.ts` `types.ts` `constants.ts`。agent 需求变更 → 提 issue/PR 给总控改。
- **文件级独占**：§三列出的 pane / server slot 文件，每个仅一个 owner，不交叉编辑。
- **分支**：`feat/data-*`（D）/ `feat/engine-*`（E）/ `feat/viz-*`（V）。总控 rebase 集成 + 终审 merge → master。
- **每次提交必跑**：`npm run typecheck`（server+web）+ `npm run build`。Agent-D 额外跑数据探索 LLM 隔离校验：
  ```bash
  grep -rE "(generate|chat|extract|clarify|sink|distill).*api\." \
    web/src/components/DataExplorationPane.tsx web/src/components/data-exploration/
  # 应无任何匹配
  ```
- 已知 baseline 报错（`db.ts:2386-2389`、`memory-governance.test.ts:55`）与新改动无关，重构后应顺带清除。

---

## 七、启动顺序（关键路径）

```
第0步【总控】接缝重构：拆 index→routes/ · db→db/ · App→TAB_REGISTRY · api→api/   ← 解锁并行的前提
   ↓ 重构 PR 合入 master、typecheck+build 绿后开放各域分支
第1步【D/E/V 并行】P0：D=上传即用 · E=E2E验证补课 · V=看板画布
   ↓
第2步【D/E/V 并行】P1：D=指标语义层(总控先定契约) · E=Notebook · V=报告交付
   ↓
第3步【总控】跨域集成 + 终审 + P2(协作权限/治理补全，届时再分)
```

---

## 八、当前状态 / 待办

- [x] **批1 server routes slot** — `routes/{data,engine,viz,shared}.ts` + `registerDomainRoutes`，index.ts 一行挂载；server typecheck 零新增错误
- [x] **批2a web api slot** — `lib/api/{_http,data,engine,viz,shared}.ts`；api.ts 改为 legacyApi + 域片段 spread 合并；web typecheck + build 绿
- [x] **批2b App.tsx 域渲染模块** — `tabs/types.ts`(TabContext 契约) + `tabs/{DataTabs,EngineTabs,VizTabs}.tsx`；App.tsx render 块缩为 3 行 + 装配 tabCtx，删 32 个 pane import；全部 subtab 1:1 等价；web typecheck + build 绿。（lazy 代码分割延后做优化批）
- [x] **批3 db.ts slot** — `db.ts` 导出 `db` 实例 + `db/{shared,data,engine,viz}.ts` 扩展点(init*Tables)，base schema 后调用；清除全部 baseline 错误(db.ts 守卫/元组 + 测试 `!`)；server typecheck 零错误、3 tests 绿
- [ ] **(优化批，可选)** App.tsx 域模块改 React.lazy 代码分割（named→default 包装）
- [ ] `MetricDefinition` 语义层契约定义 — 总控（P1 前置）
- [ ] 三个 agent 接入开发环境 + 阅读本章程 + `AGENTS.md`
- 参考：审计结论见会话「总纲领-传统BI-AI数据分析工作台」；模块边界速查见 `AGENTS.md §三`

---

## 九、领域背景笔记（各域开工前读对应一份）

旧 9 份 handoff（单链 session 交接，已蒸馏并 `git rm`，原文见 commit 95528cd 之前）→ 改为按域**活文档**，长效知识为主，agent 在开发中持续维护：

| 文件 | 域 | 内容来源（旧 handoff） |
|---|---|---|
| `docs/notes-data.md` | D | 计算工具 · Xan数据库 · 规则记忆(数据) · 探索(数据探索) |
| `docs/notes-engine.md` | E | 工作流 · AnaX · 实验室 · 探索(对话/skill/业务需求) |
| `docs/notes-viz.md` | V | Dashboard · 探索(报告/汇报/审核/黄金策) · 规则记忆(trace/token/KG) |
| `docs/notes-infra.md` | 总控 | 缓存命中(缓存 harness) + 接缝层指针 |

**交接机制改革**：停用按-tab 单链巨型 handoff；跨 session 连续性靠 **各域 notes §0 状态快照 + 本章程总览 + 用户手动提交的 commit 历史**。不再产生 changelog 堆叠。

---

## 十、Session 连续性 SOP（替代旧 handoff-generate / handoff-load）

**原则**：信息分层 + 状态**覆盖**不堆叠。`notes-<域>.md §0` 是该域"当前状态快照"，agent 独占编辑（零并发冲突）。
**所有 agent（含 Claude 总控）一律不碰 git** —— 提交时机 / 粒度 / 拆分全部由用户在合适节点手动决定。

| 信息类型 | 载体 | 谁写 |
|---|---|---|
| 当前状态（干到哪/下一步/阻塞） | `notes-<域>.md §0`（覆盖式） | 域 agent |
| 长效知识（为什么/踩坑/约束） | `notes-<域>.md` 正文（追加） | 域 agent |
| 本次改了什么（改动清单） | 收尾时列出 → 用户据此手动提交 | agent 列、用户提交 |
| 跨域里程碑/集成状态 | 本章程 §八 | 总控 |

### Session 收尾（4 步，无 git）
1. `npm run typecheck` + `npm run build`（D 另跑数据探索隔离 grep）→ 全绿；不绿则修复。
2. **覆盖**自己域 `notes-<域>.md §0`（进度/下一步/阻塞/开放问题）——这是下个 session 接续的唯一可靠依据，务必写充分。
3. 新踩坑 / 决策(含"为什么") / 约束 → 追加进 `notes-<域>.md` 正文。
4. 列本次改动文件清单（逐条说明），提示用户自行 review 后提交。**不执行任何 git 操作。**

### Session 开场（3 步，无 git）
1. 读自己域 `notes-<域>.md §0`（上次状态+下一步）+ 本章程 §八。
2. 读 `notes-<域>.md` 正文 + `KICKOFF-P0.md` + `AGENTS.md`。
3. 先汇报（本域状态/上次遗留/本次下一步与第一步动作/阻塞），用户确认后再开干。**不执行 git。**

### 谁更新什么
- **域 agent**：自己域 `notes §0`（覆盖）+ 正文（追加长效）+ 收尾列改动清单。**不碰** git / Orchestration / 他域 notes / 接缝层。
- **总控**：本章程 §八 + `notes-infra.md` + 跨域契约（`types.ts`）。
- **用户**：在合适节点手动 `git add/commit`（决定时机与粒度）。

### 命令与通用 prompt
- **通用 prompt（任意 agent 复制即用）**：`docs/prompts/px-wrapup.prompt.md`、`docs/prompts/px-resume.prompt.md`（纯文本、无 git、无 Claude Code 特性）。三个外部 agent（opencode/codex/antigravity）直接复制正文使用。
- **Claude Code 项目命令**：`/px-wrapup [域]`、`/px-resume [域]`（`.claude/commands/`，用 `@` 引用上面同一份 prompt → 单一来源不重复）。`px-` 前缀避免与内置 `/resume` 混淆。
- 旧 `handoff-generate` / `handoff-load`（全局 skill，他项目仍用）→ **本项目停用**。
