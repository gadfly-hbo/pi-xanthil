# Handoff Log — 湘鉴 pi-Xanthil · AgentFlow 模块

---

## 📌 Session 8（最新）— 2026-05-31

### 0. 本次更新摘要（Changelog）

**本次推进**: 四项 UI 改造——1）Logo 去中文改英文 `Pi-Xanthil`；2）左侧工作区三类并行（探索/单智能体/多智能体）；3）顶部 Tab 从五合一改为三分类（探索/单智能体/多智能体）；4）原始数据/清洗数据/报告从顶部 Tab 下沉为子 Tab 条，嵌入每个主视图下方。

**关键决策**: 1）Flow 新增 `kind: "single" | "multi"` 字段，数据库自动迁移（ALTER TABLE + DEFAULT 'single'）；2）左侧 Sidebar "会话"→"探索"，"工作流"拆为"单智能体"+"多智能体"两个 Section；3）顶部 Tab 精简为 `explore | single | multi`，图标改为 Compass/Bot/Users；4）数据文件夹（原始数据/清洗数据/报告）不再作为顶级 Tab，改为子 Tab 条（`工作视图 | 原始数据 | 清洗数据 | 报告`），每个主 Tab 下都有；5）数据文件夹目前仍为 workspace 级别，后续需改为 per-session/per-flow。

**新增阻塞/问题**: 无。

**下一步重点**: 1）数据文件夹从 workspace 级别下沉到 per-session/per-flow（P1）；2）验证真实 pi 端到端（P0 阻塞仍存在）；3）流程图自动布局 dagre/elkjs（P2）。

### 1. 项目元信息

项目名称: `pi-xanthil`
项目类型: 代码开发 / 前端界面改造 / 本地 agent 工作流管理
Session 编号: 第 8 次交接
本次 Session 起止: 从「五 Tab + 会话/工作流双区」推进到「三 Tab + 探索/单智能体/多智能体三区 + 子 Tab 条」
最后更新: 2026-05-31

### 2. 项目目标（North Star）

- **一句话目标**: 工作区下三类并行（探索/单智能体/多智能体），顶部三 Tab 对应三类，数据文件夹作为子视图嵌入每个主视图。
- **成功标准**:
  - Logo 只显示英文 `Pi-Xanthil`。✅
  - 左侧 Sidebar 三个并列分类：探索（原会话）、单智能体、多智能体。✅
  - 顶部 Tab 只有三个：探索/单智能体/多智能体。✅
  - 数据文件夹作为子 Tab 条嵌入每个主视图。✅
  - Flow 有 kind 字段区分单/多智能体。✅
  - `npm run typecheck` 通过。✅
- **明确的非目标**:
  - 数据文件夹暂未改为 per-session/per-flow 存储（仍为 workspace 级别）。
  - 不改变 Flow 的后端存储路径结构。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| Logo 改英文 Pi-Xanthil | ✅完成 | `Sidebar.tsx` header | 去掉中文"湘鉴" |
| Sidebar 三类并行 | ✅完成 | `Sidebar.tsx` | 探索/单智能体/多智能体 |
| Flow.kind 字段 | ✅完成 | `server/src/types.ts` `db.ts` `index.ts` | 含 DB 迁移 |
| 前端 FlowKind 类型 | ✅完成 | `web/src/types.ts` `api.ts` | createFlow 传 kind |
| 顶部三 Tab | ✅完成 | `MainHeader.tsx` | explore/single/multi + 新图标 |
| App.tsx 适配 | ✅完成 | `web/src/App.tsx` | 新 Tab 映射 + 子 Tab 状态 |
| 子 Tab 条（数据文件夹） | ✅完成 | `App.tsx` SUB_TABS | 工作视图/原始数据/清洗数据/报告 |
| typecheck | ✅通过 | server + web 双绿 | |
| 数据文件夹 per-session/per-flow | ⏳未开始 | — | P1，当前仍为 workspace 级别 |
| 真实 pi 端到端验证 | ⚠️阻塞 | — | 同 Session 1–7 |
| 流程图自动布局 | ⏳未开始 | — | P2 |

### 4. 关键决策与权衡 ⭐

**决策 1: Flow.kind 字段区分单/多智能体**
- 选择: 在 flows 表新增 `kind TEXT NOT NULL DEFAULT 'single'`，前端按 kind 分组显示。
- 备选: 前端纯 UI 区分（如按名称前缀匹配），不修改数据模型。
- 理由: 数据模型驱动比名称约定更可靠；后端 API 已支持 kind 传参；旧数据自动归为 single（DEFAULT）。
- 影响范围: `server/src/types.ts` `db.ts` `index.ts` + 前端 `types.ts` `api.ts` `Sidebar.tsx` `App.tsx`。
- 可逆性: 高——kind 为可选字段，默认 single。

**决策 2: 数据文件夹从顶级 Tab 下沉为子 Tab**
- 选择: 移除顶部 draw_data/clean_data/report Tab，在内容区上方新增子 Tab 条（`工作视图 | 原始数据 | 清洗数据 | 报告`），每个主 Tab 下都有。
- 备选: 保留为顶级 Tab（但用户要求去掉）。
- 理由: 用户明确要求"放到每个探索/单智能体/多智能体工作流下"，子 Tab 更符合语义。
- 影响范围: `MainHeader.tsx` `App.tsx`。
- 可逆性: 高。

**决策 3: Sidebar 图标和标签**
- 选择: 探索用 MessageSquarePlus（保持原有会话图标），单/多智能体用 Workflow 图标；顶部 Tab 图标改为 Compass/Bot/Users。
- 备选: 统一使用新图标。
- 理由: Sidebar 保持与原有交互一致（点击行为不变），顶部 Tab 用更具区分度的图标。
- 可逆性: 高。

### 5. 技术/方案细节快照

**Flow.kind 数据链路**
```
DB: flows.kind TEXT NOT NULL DEFAULT 'single'
  ↓ migration (PRAGMA table_info 检测)
API: POST /api/workspaces/:id/flows  { name, kind }
  ↓
Frontend types.ts: FlowKind = "single" | "multi"
  ↓
Sidebar.tsx: flows.filter(f => f.kind === "single") / f.kind === "multi"
  ↓
App.tsx: newFlow(kind) → api.createFlow(wsId, name, kind)
```

**新的 Tab 类型体系**
```ts
// MainHeader.tsx
type Tab = "explore" | "single" | "multi";
TABS = [
  { id: "explore", label: "探索", icon: Compass },
  { id: "single", label: "单智能体", icon: Bot },
  { id: "multi", label: "多智能体", icon: Users },
];

// App.tsx
type SubTab = "view" | "draw_data" | "clean_data" | "report";
SUB_TABS = [
  { id: "view", label: "工作视图" },
  { id: "draw_data", label: "原始数据" },
  { id: "clean_data", label: "清洗数据" },
  { id: "report", label: "报告" },
];
```

**App.tsx 内容区映射**
```
activeTab=explore + subTab=view     → WorkflowPickerPane / ChatPane
activeTab=explore + subTab=draw_data → FolderPathsPane(folder="draw_data")
activeTab=single  + subTab=view     → AgentFlowPane(flow=kind===single)
activeTab=multi   + subTab=view     → AgentFlowPane(flow=kind===multi)
任意 tab + subTab=clean_data       → FolderPathsPane(folder="clean_data")
任意 tab + subTab=report           → FolderPathsPane(folder="report")
```

**修改文件清单**
- `server/src/types.ts` — 新增 FlowKind, Flow.kind
- `server/src/db.ts` — flows 表加 kind, 迁移, createFlow/listFlows/getFlow 更新
- `server/src/index.ts` — POST flows 接受 kind
- `web/src/types.ts` — 新增 FlowKind, Flow.kind
- `web/src/lib/api.ts` — createFlow 传 kind
- `web/src/components/Sidebar.tsx` — Logo + 三分类 + onNewFlow(kind)
- `web/src/components/MainHeader.tsx` — 三 Tab + 新图标
- `web/src/App.tsx` — 整体重构: 新 Tab 映射 + SubTab 状态 + 子 Tab 条

### 6. 未完成事项与下一步（Action Items）

- [ ] **数据文件夹 per-session/per-flow** — P1
  - 上下文: 当前 FolderPathsPane 使用 workspace_paths 表（workspace 级别），用户要求"对应到每个对话 session 和每一条工作流"。
  - 方案: 1）workspace_paths 表加 session_id/flow_id 字段；2）或改用 session/flow 文件夹下的子目录；3）FolderPathsPane 接受 scope 参数。
  - 完成标准: 每个 session/flow 有独立的原始数据/清洗数据/报告路径管理。

- [ ] **真实 pi 端到端验证** — P0（阻塞，同 Session 1–7）
  - 上下文: pi model/扩展问题未解。
  - 优先级: 应优先处理。

- [ ] **流程图自动布局** — P2
  - 上下文: 当前节点 position 为网格排列。需支持 dagre/elkjs。
  - 完成标准: 节点按拓扑序自动排列，无重叠。

- [ ] **验证 pi 对话编辑后预览刷新** — P1
  - 上下文: 预览模式下工作流变更通过 pi 对话完成。需确认 workflow.json 更新后预览视图自动刷新。

- [ ] **从对话历史自动生成 workflow.json** — P1
  - 上下文: 当前 workflow.json 需手工创建或目录推断。理想流程: pi 在改造工作流时直接产出 workflow.json。

### 7. 开放问题与待确认事项

- ❓ **数据文件夹存储层级**
  - 当前: workspace_paths 表存储 workspace 级别路径，FolderPathsPane 按 workspaceId 查询。
  - 用户要求: "只设三级，不设一级和二级文件夹，对应到每个对话 session 和每一条工作流"。
  - 需确认: 文件系统目录结构如何组织？是 `workspace/探索/<session-id>/原始数据/` 还是 `workspace/sessions/<id>/draw_data/`？
  - 当前倾向: 在 session/flow 文件夹下创建 draw_data/clean_data/report 子目录，FolderPathsPane 接受 sessionId/flowId 参数。

- ❓ **旧 Flow 数据的 kind 分类**
  - 当前: DB 迁移 DEFAULT 'single'，所有旧 Flow 自动归为单智能体。
  - 问题: 是否有旧 Flow 应归为多智能体？需要用户确认。

### 8. 上下文与约定

- 沿用 Session 1–7 全部约定。
- **新增核心约定**: 工作区下三类并行——探索（原会话）、单智能体、多智能体；顶部 Tab 对应三类。
- **新增导航约定**: 子 Tab 条（工作视图/原始数据/清洗数据/报告）嵌入每个主视图，切换主 Tab 时 subTab 重置为"工作视图"。
- **Logo 约定**: 只显示英文 `Pi-Xanthil`，不再使用中文"湘鉴"。
- **数据模型约定**: Flow.kind = "single" | "multi"，默认 "single"。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」。
> 当前最紧迫的是 **跑通真实 pi 端到端验证**（P0 阻塞已跨 8 个 Session）。
> 如果 pi 阻塞仍无法解除，优先推进 **数据文件夹 per-session/per-flow**（P1）——让 FolderPathsPane 支持 sessionId/flowId 参数，后端 workspace_paths 表加 session_id/flow_id 字段。
> 注意顶部 Tab 已改为三分类（探索/单智能体/多智能体），数据文件夹已下沉为子 Tab 条。

---

## 📌 Session 7 — 2026-05-30

### 0. 本次更新摘要（Changelog）

**本次推进**: 1）修复工作流节点视图空白问题——根因为 flow 目录下无 `workflow.json`，后端新增 `inferWorkflow()` 函数从目录结构自动推断 WorkflowDef；2）工作流画布迭代为预览模式——移除所有编辑能力，简化节点卡片为 agent 名称+模型+简要说明，重构布局为左侧画布+右侧产出预览。

**关键决策**: 1）`workflow.json` 不存在时，后端从目录树自动推断节点：扫描顶层目录/文件，按数字前缀排序，单目录包裹检测自动展开；推断结果标记 `inferred: true`，前端显示"自动推断"标签；2）工作流画布改为纯预览模式（`nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}`），所有变更通过「pi 对话」自然语言完成；3）节点卡片极度简化：Bot 图标+名称+一行描述(40字截断)+模型徽章；4）布局从左侧画布+右侧动态面板改为左侧画布+右侧产出预览(360px)，移除节点选中编辑面板、参数表单、"保存为 workflow.json"按钮等。

**新增阻塞/问题**: 无。

**下一步重点**: 1）验证真实 pi 运行后 workflow.json 自动生成闭环（P0 阻塞仍存在）；2）流程图自动布局 dagre/elkjs（P2）；3）验证 pi 对话中编辑工作流后预览视图自动刷新。

### 1. 项目元信息

项目名称: `pi-xanthil`
项目类型: 代码开发 / 前端界面改造 / 本地 agent 工作流管理
Session 编号: 第 7 次交接
本次 Session 起止: 从「工作流视图空白 + 可编辑画布」推进到「目录自动推断节点 + 预览模式画布 + 左侧画布/右侧产出」
最后更新: 2026-05-30

### 2. 项目目标（North Star）

- **一句话目标**: AgentFlow 工作流视图为纯预览模式，节点从目录结构自动推断，所有工作流变更通过「pi 对话」完成，画布左侧展示流程、右侧展示产出。
- **成功标准**:
  - workflow.json 不存在时自动从目录结构推断 WorkflowDef。✅
  - 工作流画布为只读预览模式（不可拖拽、连线、选中编辑）。✅
  - 节点卡片仅显示 agent 名称、模型、简要说明。✅
  - 布局为左侧画布 + 右侧产出预览。✅
  - `npm run typecheck` 通过。✅
- **明确的非目标**:
  - 不在画布中实现任何编辑能力（编辑在 pi 对话中完成）。
  - 不在此 session 实现自动布局算法（P2）。
  - 不重构 AgentFlowPane 的对话架构。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| `inferWorkflow()` 目录推断 | ✅完成 | `server/src/flow-fs.ts` | 数字前缀排序+单目录展开+README读取 |
| GET workflow API 自动推断 | ✅完成 | `server/src/index.ts:210-223` | 返回 `inferred: true` |
| 前端 inferred 标志处理 | ✅完成 | `web/src/lib/api.ts` `web/src/components/FlowWorkflowPane.tsx` | 显示"自动推断"标签 |
| FlowWorkflowPane 预览模式重写 | ✅完成 | `web/src/components/FlowWorkflowPane.tsx`（~400行） | 移除编辑+简化卡片+新布局 |
| MiniMap 缩略图 | ✅完成 | FlowWorkflowPane | 左下角 |
| typecheck | ✅通过 | `npm run typecheck` | server + web 双绿 |
| 从对话历史自动生成 workflow.json | ⏳未开始 | — | P1 |
| 流程图自动布局 | ⏳未开始 | — | P2 |
| 真实 pi 端到端验证 | ⚠️阻塞 | — | 同 Session 1–6 |

### 4. 关键决策与权衡 ⭐

**决策 1: 目录推断替代空状态回退**
- 选择: 当 `workflow.json` 不存在时，后端自动从目录结构推断 WorkflowDef，而非显示空状态。
- 备选: 保持空状态，等用户手动创建或 pi 生成（已证明体验差——用户导入工作流后看不到任何节点）。
- 理由: 用户通过 pi 生成的 workflow 都是文件树形式，自动推断让用户立即看到可视化结果。
- 影响范围: `server/src/flow-fs.ts` 新增 ~140 行。
- 可逆性: 高。

**决策 2: 单目录包裹检测**
- 选择: 如果 flow 根下只有一个子目录（如 `diary-workflow/`），自动展开该目录内容作为节点。
- 备选: 只扫描顶层目录（日记工作流只会显示 1 个节点，太粗糙）。
- 理由: 用户通过 pi 导入的工作流经常包裹在单一目录下，展开后能更细粒度展示。
- 影响范围: `inferWorkflow()` 逻辑。
- 可逆性: 高。

**决策 3: 预览模式（只读画布）**
- 选择: 工作流画布 `nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}`，完全禁用交互编辑。
- 备选: 保留可拖拽和选中编辑（但用户明确要求所有变更通过对话完成）。
- 理由: 用户要求「工作流画布只能预览而不能编辑」，统一交互模型。
- 影响范围: FlowWorkflowPane 组件结构大幅简化（664→~400 行）。
- 可逆性: 高。

**决策 4: 布局改为左侧画布 + 右侧产出**
- 选择: 左侧 React Flow 画布 + 右侧 360px 产出预览面板（运行历史、目录树、文件内容）。
- 备选: 保留三区布局（左画布+右面板+底控制条）但右面板为概览+编辑（已废弃）。
- 理由: 预览模式下不需要右侧编辑面板，产出预览是主要价值。
- 影响范围: FlowWorkflowPane 整个 return 结构。
- 可逆性: 高。

### 5. 技术/方案细节快照

**目录推断算法 (`inferWorkflow`)**
```
inferWorkflow(rootAbs)
  ├─ 扫描顶层 items（排除 runs, .pi-sessions, node_modules, .DS_Store, workflow.json）
  ├─ 单目录检测: topDirs.length===1 && topFiles.length<=1 → 展开该目录
  ├─ 排序: 数字前缀优先（01-xxx < 02-xxx），其次字母序
  ├─ 节点生成:
  │   ├─ 目录 → 读取 README.md/readme.md/index.md 作为 prompt
  │   ├─ .md/.txt/.prompt 文件 → 提取正文
  │   └─ .js/.ts/.py/.sh 文件 → 截取前 500 字符
  └─ 边生成: 按顺序串联所有节点
```

**节点卡片 AgentNodeCard**
```tsx
AgentNodeCard
  ├─ Handle(target, top)     // 小型 !h-1.5 !w-1.5
  ├─ Bot icon + label        // 名称
  ├─ description             // prompt 首行，≤40 字，line-clamp-1
  ├─ model badge             // sky 色圆角徽章
  └─ Handle(source, bottom)
```

**预览模式 ReactFlow 配置**
```tsx
<ReactFlow
  nodesDraggable={false}
  nodesConnectable={false}
  elementsSelectable={false}
  fitView
>
  <Background />
  <Controls showInteractive={false} />
  <MiniMap />  // 新增
</ReactFlow>
```

**产出预览面板结构**
```
aside (w-[360px])
  ├─ Header: "产出预览" + runId 短码
  ├─ 空状态: "运行后在此查看产出"
  ├─ 实时输出 section
  ├─ 运行历史 section
  └─ 产出目录 tree + 文件内容预览
```

**新增文件**
- 无新增文件

**修改文件**
- `server/src/flow-fs.ts` — 新增 `inferWorkflow()` 函数 (~140 行)
- `server/src/index.ts` — GET `/api/flows/:id/workflow` 调用 `inferWorkflow()`
- `web/src/lib/api.ts` — 返回类型增加 `inferred?: boolean`
- `web/src/components/FlowWorkflowPane.tsx` — 大幅重写（664→~400 行）

**推断效果验证**
- 日记工作流: 4 节点（diary, diary-workflow, install, README）
- 小说工作流: 10 节点（世界观设定→人物档案→故事大纲→…→README）

### 6. 未完成事项与下一步（Action Items）

- [ ] **从对话历史自动生成 workflow.json** — P1
  - 上下文: 当前 workflow.json 需手工创建或目录推断。理想流程: pi 在改造工作流时直接产出 workflow.json。
  - 方案: 在 PRIMING_PROMPT 中增加「请将工作流结构化为 workflow.json」指令。
  - 完成标准: pi 改造后 workflow.json 自动出现（覆盖目录推断结果）。

- [ ] **流程图自动布局** — P2
  - 上下文: 当前节点 position 为网格排列或为空时自动网格。需支持 dagre/elkjs 自动布局。
  - 完成标准: 节点按拓扑序自动排列，无重叠。

- [ ] **真实 pi 端到端验证** — P0（阻塞，同 Session 1–6）
  - 上下文: pi model/扩展问题未解。
  - 优先级: 应优先处理。

- [ ] **验证 pi 对话编辑后预览刷新** — P1
  - 上下文: 预览模式下工作流变更通过 pi 对话完成。需确认 workflow.json 更新后预览视图自动刷新。
  - 当前机制: FlowWorkflowPane 切换 view 时重新挂载，`useEffect([flowId])` 重新加载。

### 7. 开放问题与待确认事项

- ❓ **目录推断 vs. 真实 workflow.json 的优先级**
  - 当前: 如果 workflow.json 存在则用它，否则目录推断。推断结果标记 `inferred: true`。
  - 问题: 用户修改了目录结构后，推断结果会变化。是否需要提示用户"保存推断结果为 workflow.json"？
  - 当前倾向: 不需要——保持推断为纯展示层，workflow.json 由 pi 在对话中生成。

- ❓ **节点说明文本的提取策略**
  - 当前: 取 prompt 第一行，截断 40 字。
  - 备选: 取 prompt 中第一个 `# 标题` 行；或从 README 的 description 字段提取。
  - 需要: 用户确认期望。

- ❓ **MiniMap 是否需要**
  - 当前: 已添加 MiniMap。
  - 备选: 节点少时移除（显得冗余）。
  - 需要: 用户确认。

### 8. 上下文与约定

- 沿用 Session 1–6 全部约定。
- **新增核心约定**: 工作流画布为纯预览模式，所有变更通过「pi 对话」完成。
- **新增视觉约定**: 节点卡片极简——Bot 图标+名称+一行描述+模型徽章，不再显示完整 prompt 或选中高亮。
- **布局约定**: 左侧画布（弹性宽度）+ 右侧产出预览（360px 固定宽度），底部保留执行控制条。
- `nodrag` className: 保留在自定义节点 textarea 中（虽然当前无编辑 textarea，但预留）。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」。
> 当前最紧迫的是 **跑通真实 pi 端到端验证**（P0 阻塞已跨 7 个 Session）。
> 如果 pi 阻塞仍无法解除，优先推进 **从对话历史自动生成 workflow.json**（P1）——修改 PRIMING_PROMPT 让 pi 在改造文件夹时自动产出 workflow.json。
> 注意 FlowWorkflowPane 已改为预览模式，不再支持画布内编辑。

---

## 📌 Session 6 — 2026-05-30

### 0. 本次更新摘要（Changelog）

**本次推进**: 1）编写 `FlowWorkflowPane.tsx` 核心组件——合并原编辑+执行为统一流程图视图（左侧 React Flow 画布 + 右侧动态面板 + 底部执行控制条）；2）AgentFlowPane 子视图从 `"chat" | "editor" | "execute"` 合并为 `"chat" | "workflow"`；3）导入 `@xyflow/react/dist/style.css` 到 CSS 入口。

**关键决策**: 1）流程图视图采用左画布+右面板+底控制条三区布局；2）右侧面板根据选中状态动态切换——无选中=概览+参数+运行历史+产出树，选中节点=提示词编辑+模型切换+保存；3）移除 `editorRefreshKey` 状态，`FlowWorkflowPane` 自行管理数据加载与刷新；4）`runId` 改用 ref 而非 state（仅在 gateway 回调中读取，不触发重渲染）。

**新增阻塞/问题**: 无。Session 5 的 P0 未完成项已全部交付。

**下一步重点**: 1）从对话历史自动生成 workflow.json（P1）；2）流程图自动布局 dagre/elkjs（P2）；3）真实 pi 端到端验证闭环（P0 阻塞仍存在）。

### 1. 项目元信息

项目名称: `pi-xanthil`
项目类型: 代码开发 / 前端界面改造 / 本地 agent 工作流管理
Session 编号: 第 6 次交接
本次 Session 起止: 从「FlowWorkflowPane 未编码 + 子视图未合并」推进到「FlowWorkflowPane 完整实现 + 子视图合并 + typecheck 双绿」
最后更新: 2026-05-30

### 2. 项目目标（North Star）

- **一句话目标**: AgentFlow 子视图只有「pi 对话」与「工作流」两个，后者合并了原编辑+执行功能，通过 React Flow 流程图可视化展示 agent 节点，支持提示词编辑、模型配置和一键执行。
- **成功标准**:
  - AgentFlow 子视图只有「pi 对话」与「工作流」两个。✅
  - 流程图展示工作流的所有 agent 节点，每个节点显示名称、提示词摘要、配置的模型。✅
  - 点击节点可编辑提示词和切换模型，修改可保存到 `workflow.json`。✅
  - 流程图底部有执行按钮，点击后可触发 pi 运行。✅
  - `npm run typecheck` 通过。✅
- **明确的非目标**:
  - 本 session 不实现拖拽式节点连线编排（先做纯展示+编辑）。
  - 不做步骤化进度条、多运行对比等高级执行功能。
  - 不重构 AgentFlowPane 的对话/消息架构。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| React Flow CSS 导入 | ✅完成 | `web/src/index.css` | `@import '@xyflow/react/dist/style.css'` |
| `FlowWorkflowPane.tsx` 编写 | ✅完成 | `web/src/components/FlowWorkflowPane.tsx`（新，~640 行） | 合并编辑+执行的核心组件 |
| AgentFlowPane 子视图合并 | ✅完成 | `web/src/components/AgentFlowPane.tsx` | View 从 3→2，移除 editorRefreshKey |
| typecheck | ✅通过 | `npm run typecheck` | server + web 双绿 |
| 从对话历史自动生成 workflow.json | ⏳未开始 | — | P1 |
| 流程图自动布局 | ⏳未开始 | — | P2 |
| 真实 pi 端到端验证 | ⚠️阻塞 | — | 同 Session 1–5：pi model/扩展问题 |

### 4. 关键决策与权衡 ⭐

**决策 1: 三区布局（左画布+右面板+底控制条）**
- 选择: 左侧 React Flow 画布占满弹性宽度，右侧 340px 固定宽度动态面板，底部执行控制条。
- 备选: 无右侧面板，所有编辑在画布节点内联完成（太拥挤）。
- 理由: 流程图需要最大化画布空间；编辑提示词需要较大的文本区域，节点卡片内放不下；右侧面板按选中状态动态切换是常见 IDE 模式。
- 影响范围: FlowWorkflowPane 组件结构。
- 可逆性: 高。

**决策 2: 右侧面板动态切换（概览/编辑/执行产出）**
- 选择: 无节点选中时显示工作流概览+参数表单+运行历史+产出树；选中节点时显示提示词 textarea+模型下拉+保存按钮。
- 备选: 固定分区上下排列（概览在上、编辑在中、产出在下——太长需滚动）。
- 理由: 节点编辑和概览是互斥操作，切换比同屏更清晰。
- 影响范围: FlowWorkflowPane 右侧 aside 区域。
- 可逆性: 高。

**决策 3: 移除 `editorRefreshKey`**
- 选择: AgentFlowPane 不再持有 `editorRefreshKey` 状态。FlowWorkflowPane 在 `useEffect([flowId])` 中自行加载 workflow 数据。
- 理由: FlowEditorPane 依赖 refreshKey 是因为它需要 pi 运行后强制刷新文件树；FlowWorkflowPane 直接从 API 获取 workflow 数据，不需要外部驱动刷新。pi 运行结束后 workflow.json 如果被修改，用户切回工作流视图时组件重新挂载即自动加载最新数据。
- 影响范围: AgentFlowPane 删除 `editorRefreshKey` 状态和所有 `setEditorRefreshKey` 调用。
- 可逆性: 高。

**决策 4: `runId` 使用 ref 而非 state**
- 选择: gateway 回调中的 `runId` 只存入 `runIdRef`，不触发 `setRunId` 重渲染。
- 理由: `runId` 仅在 gateway subscribe 闭包中用于匹配 `flow_run_event`，不需要驱动 UI 渲染。`selectedRunId` 才是 UI 需要的状态。用 ref 避免不必要的重渲染和 TS6133 未使用变量警告。
- 影响范围: FlowWorkflowPane 内部实现。
- 可逆性: 高。

### 5. 技术/方案细节快照

**FlowWorkflowPane 组件结构**
```
FlowWorkflowPane (export)
  └─ ReactFlowProvider
       └─ FlowWorkflowPaneInner
            ├─ Left: ReactFlow canvas
            │    ├─ AgentNodeCard (自定义节点)
            │    │    ├─ Handle(target, top)
            │    │    ├─ Bot icon + label
            │    │    ├─ prompt summary (line-clamp-2)
            │    │    ├─ model badge (sky color)
            │    │    └─ Handle(source, bottom)
            │    ├─ Background
            │    └─ Controls
            └─ Bottom: execution bar (model select + run button + status)
            └─ Right: aside (340px)
                 ├─ selected node → prompt textarea + model select + save
                 └─ no selection → overview + params + output + history + run tree
```

**新增文件**
- `web/src/components/FlowWorkflowPane.tsx` (~640 行)

**修改文件**
- `web/src/index.css` — 新增 `@import '@xyflow/react/dist/style.css'`
- `web/src/components/AgentFlowPane.tsx` — View 类型合并、移除 FlowEditorPane/ExecutionPane 导入、移除 editorRefreshKey

**AgentFlowPane 当前子视图**
```ts
type View = "chat" | "workflow";
```
- chip 按钮: pi 对话 (MessageSquare) / 工作流 (Workflow)
- 渲染: chat→FlowChatPane, workflow→FlowWorkflowPane

**自定义节点 AgentNodeCard 要点**
- `nodrag` className 应用于 textarea 防止触发节点拖拽
- 选中节点通过 `data.selected` 字段传递，组件渲染 ring-2 高亮
- `onSelectionChange` 回调同步选中状态到 `selectedNodeId`

**typecheck 状态**: ✅ server + web 双绿

### 6. 未完成事项与下一步（Action Items）

- [ ] **从对话历史自动生成 workflow.json** — P1
  - 上下文: 当前 workflow.json 需手工创建或从外部导入。理想流程: 用户在「pi 对话」子视图中让 pi 改造工作流后，pi 产出 workflow.json，切换到「工作流」视图即可看到流程图。
  - 方案: 在 PRIMING_PROMPT 中增加「请将工作流结构化为 workflow.json」指令。
  - 完成标准: pi 改造后 workflow.json 自动出现，切换视图可见流程图。

- [ ] **流程图自动布局** — P2
  - 上下文: 当前节点 position 可为空，默认按 4 列网格排列。需自动计算布局（如 dagre/elkjs）。
  - 完成标准: 新建/导入工作流后节点自动排列，无重叠。

- [ ] **真实 pi 端到端验证 agentflow 闭环** — P0（阻塞，同 Session 1–5）
  - 上下文: pi model/扩展问题未解，agentflow + 工作流视图都需此前置。
  - 优先级: 应在流程图视图编码完成后立刻处理。

- [ ] **原 FlowEditorPane 的文件树浏览能力是否保留** — P1
  - 上下文: 合并后 FlowWorkflowPane 不包含文件树。若需要浏览原始文件，可切回「pi 对话」让 pi 操作，或后续加一个侧抽屉。
  - 需要: 用户确认。

### 7. 开放问题与待确认事项

- ❓ **workflow.json 不存在时的回退策略**（同 Session 5）
  - 当前实现: 显示空流程图 + 提示「在 pi 对话中让 ai 生成工作流，或手动添加节点」。
  - 备选: 从文件树自动推断节点。
  - 需要: 用户确认期望。

- ❓ **执行时 pi 的输入格式**（同 Session 5）
  - 当前实现: 按 README `## Inputs` 段解析参数，拼 JSON 后通过 `execute_flow` 协议发送。
  - 备选: 将整个 workflow 定义嵌入一条 priming prompt。
  - 影响: 决定后端 `execute_flow` 协议是否需要改变。

- ❓ **原 FlowEditorPane 文件树能力**
  - 当前: FlowWorkflowPane 无文件树。FlowEditorPane 仍存在但不再被 AgentFlowPane 引用。
  - 备选: 在流程图下方加可折叠文件树面板，或在右侧面板加 tab 切换。
  - 需要: 用户确认是否需要恢复文件树浏览。

### 8. 上下文与约定

- 沿用 Session 1–5 全部约定（中文回答、最小改动、先思考后动手、删除前确认、证据优先、视觉签名）。
- 新增约定: 流程图节点使用自定义 `AgentNodeCard` 组件，不使用 React Flow 默认节点。
- 新增视觉约定: AgentNode 卡片配色沿用 zinc/neutral 主调，选中节点用 sky ring，模型徽章用 sky/蓝灰色，执行状态复用 emerald/rose/amber 语义。
- 行为指令: **执行放在 AgentFlow 下一级**——已落实，FlowWorkflowPane 内含执行控制条。
- `nodrag` className: 自定义节点内的 textarea 必须加 `nodrag` 防止触发节点拖拽。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」。
> 当前最紧迫的是 **跑通真实 pi 端到端验证**（P0 阻塞已跨 6 个 Session）——在可用 pi 实例下验证：新建 flow → 导入文件夹 → pi 改造 → workflow.json 生成 → 切到「工作流」视图看到流程图 → 编辑提示词 → 点击运行。
> 如果 pi 阻塞仍无法解除，优先推进 **从对话历史自动生成 workflow.json**（P1）——修改 PRIMING_PROMPT 让 pi 在改造文件夹时自动产出 workflow.json。
> 注意 FlowWorkflowPane 的 textarea 需要 `nodrag` className。

---

## 📌 Session 5 — 2026-05-30

### 0. 本次更新摘要（Changelog）

**本次推进**: 1）将「执行」从顶部独立 tab 降级为 AgentFlow 内部子视图（用户明确要求「执行要放到 AgentFlow 下一级」）；2）启动「编辑+执行合并为工作流流程图视图」改造——定义了 `workflow.json` 结构化 schema，安装了 `@xyflow/react`，前后端 workflow 读写 API 已落盘。**FlowWorkflowPane 组件尚未编写**，是本 session 留下的主要未完成项。

**关键决策**: 1）「执行」不作为顶 tab，而是 AgentFlow 的第三子视图；2）后续合并编辑+执行为统一流程图视图时，子视图将从 3 个变为 2 个（chat | workflow）；3）工作流节点=agent（提示词+LLM 模型），数据存 flow 目录下的 `workflow.json`；4）流程图库选用 `@xyflow/react`（React Flow v12）。

**新增阻塞/问题**: FlowWorkflowPane 组件未编码，当前编辑+执行仍是两个独立子视图。

**下一步重点**: 编写 `FlowWorkflowPane.tsx`——左侧 React Flow 流程图展示节点（agent 卡片含提示词摘要+模型名），右侧选中节点的编辑面板（提示词 textarea + 模型下拉），底部执行按钮+运行状态。完成后替换 AgentFlowPane 中的 `editor` + `execute` 两个子视图为统一的 `workflow` 子视图。

### 1. 项目元信息

项目名称: `pi-xanthil`
项目类型: 代码开发 / 前端界面改造 / 本地 agent 工作流管理
Session 编号: 第 5 次交接
本次 Session 起止: 从「执行为顶 tab + 编辑/执行分离」推进到「执行降入 AgentFlow 子视图 + workflow.json schema 定义 + 前后端 API 就绪 + @xyflow/react 安装」
最后更新: 2026-05-30

### 2. 项目目标（North Star）

- **一句话目标**: 把 AgentFlow 的编辑与执行合并为可视化流程图界面，每个节点=一个 agent（提示词+LLM），支持提示词编辑和模型配置，并可在流程图中一键执行。
- **成功标准**:
  - AgentFlow 子视图只有「pi 对话」与「工作流」两个，后者合并了原编辑+执行功能。
  - 流程图展示工作流的所有 agent 节点，每个节点显示名称、提示词摘要、配置的模型。
  - 点击节点可编辑提示词和切换模型，修改自动保存到 `workflow.json`。
  - 流程图底部有执行按钮，点击后沿节点顺序执行，实时显示输出。
  - `npm run typecheck` 通过。
- **明确的非目标**:
  - 本 session 不实现拖拽式节点连线编排（先做纯展示+编辑）。
  - 不做步骤化进度条、多运行对比等高级执行功能。
  - 不重构 AgentFlowPane 的对话/消息架构。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 「执行」降入 AgentFlow 子视图 | ✅完成 | `AgentFlowPane.tsx`, `MainHeader.tsx`, `App.tsx` | 移除顶 tab execute，AgentFlow 新增第三子视图 |
| `workflow.json` schema 定义 | ✅完成 | `web/src/types.ts` 新增 `WorkflowNode/Edge/Def` | 节点含 id/label/prompt/model/position |
| 前端 workflow API | ✅完成 | `web/src/lib/api.ts` 新增 `flowWorkflowGet/Put` | 读写 flow 目录下的 workflow.json |
| 后端 workflow API | ✅完成 | `server/src/index.ts` 新增 GET/PUT `/api/flows/:id/workflow` | 复用 `readFlowFile`/`writeFlowFile` |
| `@xyflow/react` 安装 | ✅完成 | `node_modules/@xyflow/react` (hoist to root) | React Flow v12 |
| `FlowWorkflowPane` 组件 | ⏳未开始 | — | 合并编辑+执行的核心组件 |
| AgentFlowPane 子视图合并 | ⏳未开始 | — | 从 chat/editor/execute → chat/workflow |
| typecheck | ✅通过 | `npm run typecheck` | server + web 双绿 |

### 4. 关键决策与权衡 ⭐

**决策 1: 「执行」降入 AgentFlow 子视图**
- 选择: 从顶部独立 tab 移入 AgentFlow 作为第三子视图（chat/editor/execute），为后续合并编辑+执行做准备。
- 理由: 用户明确要求「执行要放到 AgentFlow 下一级」。
- 影响范围: MainHeader Tab 类型移除 `execute`，App.tsx 删除 execute 渲染分支，AgentFlowPane 新增 execute 子视图+PlayCircle chip。
- 可逆性: 高。

**决策 2: 编辑+执行合并为流程图视图**
- 选择: 将 editor + execute 两个子视图合并为一个 `workflow` 子视图，左侧 React Flow 流程图 + 右侧节点编辑面板 + 底部执行控制。
- 备选: 保持 editor/execute 两个子视图，流程图只替换 editor。
- 理由: 用户需求是「工作流显示预览流程图，流程图节点显示 agent（提示词+LLM），提示词支持修改，LLM 支持配置模型」——这本质上就是编辑+执行的融合体，分开反而割裂。
- 影响范围: AgentFlowPane 的 View 类型从 `"chat" | "editor" | "execute"` 变为 `"chat" | "workflow"`。
- 可逆性: 中。

**决策 3: 工作流结构化数据存 `workflow.json`**
- 选择: 在 flow 目录下新增 `workflow.json`，结构化描述节点和边。前端通过专用 API 读写，不再依赖文件树遍历推断。
- 备选: 从 README/目录结构动态推断节点（被否决——用户要的是「可编辑的提示词+模型配置」，纯推断不可编辑）。
- 理由: 结构化数据才能支持提示词编辑和模型切换的回写。
- 影响范围: 新增类型 `WorkflowDef/WorkflowNode/WorkflowEdge`；新增 2 个 REST 端点；新增 2 个前端 API 方法。
- 可逆性: 高（workflow.json 不存在时回退到空流程图）。

**决策 4: React Flow v12 (`@xyflow/react`)**
- 选择: 使用 `@xyflow/react` 作为流程图渲染库。
- 备选: 纯 CSS/SVG 手绘（太费工）；dagre + 自绘（无交互基础）。
- 理由: 类型安全、自定义节点能力强、支持 `nodrag` 交互（textarea 不触发拖拽）、社区活跃。
- 影响范围: 新增 npm 依赖 ~150KB gzip。
- 可逆性: 中（组件深度绑定后替换成本高）。

### 5. 技术/方案细节快照

**新增类型 (`web/src/types.ts`)**
```ts
export interface WorkflowNode {
  id: string;
  label: string;              // 显示名
  prompt: string;             // 提示词模板，支持 {{input_name}} 占位符
  model: string;              // 模型 id 如 "anthropic/claude-sonnet-4"，空=继承 defaultModel
  position?: { x: number; y: number }; // 画布位置
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDef {
  version: 1;
  defaultModel: string;       // 节点未指定模型时的默认值
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
```

**新增 REST 端点 (`server/src/index.ts`)**
- `GET /api/flows/:id/workflow` — 返回 `{ workflow: WorkflowDef | null }`，文件不存在返回 null
- `PUT /api/flows/:id/workflow` — 写入 `workflow.json`，body 即 WorkflowDef

**新增前端 API (`web/src/lib/api.ts`)**
- `flowWorkflowGet(flowId)` → `{ workflow: WorkflowDef | null }`
- `flowWorkflowPut(flowId, workflow: WorkflowDef)` → `{ ok: true }`

**AgentFlowPane 当前子视图**
```ts
type View = "chat" | "editor" | "execute";
```
- chip 按钮: pi 对话 (MessageSquare) / 工作流编辑面板 (Pencil) / 执行 (PlayCircle)
- 渲染: chat→FlowChatPane, editor→FlowEditorPane, execute→ExecutionPane
- **待改造**: 合并为 `"chat" | "workflow"`，workflow→FlowWorkflowPane

**MainHeader Tab 类型**
```ts
export type Tab = "chat" | "agentflow" | "files" | "data" | "dashboard";
```
- 已移除 `"execute"`

**已安装依赖**
- `@xyflow/react` — 安装在 root node_modules（npm workspaces hoist）
- 需在 CSS 入口 `@import '@xyflow/react/dist/style.css'`

**typecheck 状态**: ✅ server + web 双绿

**已踩的坑**
- server 端复用 `readFlowFile`/`writeFlowFile` 而非自造 `flowFileRead`/`flowFileWrite`，否则 TS2304。

### 6. 未完成事项与下一步（Action Items）

- [ ] **编写 FlowWorkflowPane 组件** — P0
  - 上下文: 这是本 session 的核心未完成项。合并原 FlowEditorPane（文件树+编辑）和 ExecutionPane（参数表单+运行）为统一流程图界面。
  - 组件结构（建议）:
    - 左侧 60%: React Flow 画布
      - 自定义节点 `AgentNode`: 卡片显示 agent 名称、提示词前 80 字摘要、模型徽章
      - 节点选中时右侧面板切换到该节点编辑
    - 右侧 40%: 动态面板
      - 无选中: 显示工作流概览（名称、节点数、默认模型）+ 执行按钮
      - 选中节点: 提示词 textarea + 模型下拉 + 保存按钮
      - 执行中: 实时输出 + 产出物
    - 底部: 执行控制条（模型选择 + [运行] 按钮 + 运行状态）
  - 数据流: 组件挂载时 `api.flowWorkflowGet()` → 无数据则从文件树推断初始结构 → 编辑后 `api.flowWorkflowPut()` 保存
  - 完成标准: 流程图可见、节点可选中编辑、提示词/模型修改可保存、执行按钮可触发 pi 运行。

- [ ] **AgentFlowPane 子视图合并** — P0（依赖上一个）
  - 上下文: FlowWorkflowPane 就绪后，将 View 从 `"chat" | "editor" | "execute"` 改为 `"chat" | "workflow"`。
  - 修改点: AgentFlowPane 的 View 类型、chip 按钮（移除 Pencil/PlayCircle，加 Workflow 图标「工作流」）、渲染分支。
  - 完成标准: 切到「工作流」子视图看到流程图+编辑+执行一体化界面。

- [ ] **从对话历史自动生成 workflow.json** — P1
  - 上下文: 当前 workflow.json 需手工创建或从外部导入。理想流程: 用户在「pi 对话」子视图中让 pi 改造工作流后，pi 产出 workflow.json，切换到「工作流」视图即可看到流程图。
  - 方案: 在 PRIMING_PROMPT 中增加「请将工作流结构化为 workflow.json」指令。
  - 完成标准: pi 改造后 workflow.json 自动出现，切换视图可见流程图。

- [ ] **React Flow CSS 导入** — P0（阻塞流程图渲染）
  - 上下文: `@xyflow/react` 需要导入其样式表。
  - 修改点: 在 `web/src/index.css` 或 `App.tsx` 顶部加 `@import '@xyflow/react/dist/style.css'`。

- [ ] **流程图自动布局** — P2
  - 上下文: 当前节点 position 可为空，需自动计算布局（如 dagre/elkjs）。
  - 完成标准: 新建/导入工作流后节点自动排列，无重叠。

### 7. 开放问题与待确认事项

- ❓ **workflow.json 不存在时的回退策略**
  - 当前倾向: 显示空流程图 + 提示「在 pi 对话中让 ai 生成工作流，或手动添加节点」。
  - 备选: 从文件树自动推断节点（如 README→入口、templates/→步骤、.pi/→配置）。
  - 需要: 用户确认期望。

- ❓ **执行时 pi 的输入格式**
  - 当前倾向: 按 workflow.json 的 edges 拓扑序，将每个节点的 prompt 作为 pi 的 system prompt，依次执行。
  - 备选: 将整个 workflow 定义嵌入一条 priming prompt，让 pi 自行编排执行。
  - 影响: 决定后端 `execute_flow` 协议是否需要改变。

- ❓ **原 FlowEditorPane 的文件树浏览能力是否保留**
  - 当前倾向: 流程图视图不包含文件树。若需要浏览原始文件，切回「pi 对话」让 pi 操作，或后续加一个侧抽屉。
  - 备选: 在流程图下方加一个可折叠的文件树面板。
  - 需要: 用户确认。

### 8. 上下文与约定

- 沿用 Session 1–4 全部约定（中文回答、最小改动、先思考后动手、删除前确认、证据优先、视觉签名）。
- 新增约定: 流程图节点使用自定义 `AgentNode` 组件，不使用 React Flow 默认节点。
- 新增视觉约定: AgentNode 卡片配色沿用 zinc/neutral 主调，模型徽章用 sky/蓝灰色，执行状态复用 ExecutionPane 已有的 emerald/rose/amber 语义。
- 行为指令（用户在本次 session 明确给出）: **执行要放到 AgentFlow 下一级**——这已落实，后续不应再提独立顶 tab。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」。
> 当前最紧迫的是 **编写 `FlowWorkflowPane.tsx`**——合并编辑+执行为统一流程图界面的核心组件。
> 组件要点:
> 1. 左侧 React Flow 画布，自定义 AgentNode（名称+提示词摘要+模型徽章）
> 2. 右侧动态面板：无选中=概览+执行；选中节点=提示词编辑+模型切换
> 3. 底部执行控制条（模型选择+运行按钮+状态）
> 4. 数据流: `api.flowWorkflowGet()` → 渲染 → 编辑 → `api.flowWorkflowPut()` 保存
> 5. 别忘了在 CSS 入口导入 `@xyflow/react/dist/style.css`
> 完成后修改 AgentFlowPane：View 从 `"chat"|"editor"|"execute"` 合并为 `"chat"|"workflow"`。
> 注意 `@xyflow/react` 的 custom node 里 textarea 需要 `nodrag` className 防止触发节点拖拽。

---

## 📌 Session 4 — 2026-05-30

### 0. 本次更新摘要（Changelog）

**本次推进**: 将 AgentFlow 的“工作流编辑面板”从纯文件预览改造成带可视化编排地图的编辑界面，并修复本机绝对路径工作流文件无法进入编辑器的问题。  
**关键决策**: 1）保留现有文件树/编辑器能力，在其上方增加可视化 orchestration map；2）不直接跨沙盒编辑 `/Users/...` 外部目录，而是提供“导入本机目录到 flow 沙盒”能力；3）从 README 内容自动识别 `file:///Users/...` 路径并展示导入入口。  
**新增阻塞/问题**: [待确认] 浏览器端热更新可能不覆盖新增 server API，用户需重启 `npm run dev` 后验证 UI。  
**下一步重点**: 先在真实页面验证“导入 `/Users/huangbo/Dev/novel-workflow/`”按钮是否出现、导入后文件树是否完整；再优化导入后的编排地图识别准确度与编辑体验。

### 1. 项目元信息

项目名称: `pi-xanthil`  
项目类型: 代码开发 / 前端界面改造 / 本地 agent 工作流管理  
Session 编号: 第 4 次交接（由 `handoff_log.md` 合并为 AgentFlow 模块最新交接）  
本次 Session 起止: 从“AgentFlow 编辑面板只能显示 README、缺少可视化编排与外部生成文件不可编辑”推进到“新增可视化编排地图，并可从 README 检测本机路径、导入外部工作流目录到沙盒后编辑”。  
最后更新: 2026-05-30

### 2. 项目目标（North Star）

- **一句话目标**: 把 `pi-xanthil` 的 AgentFlow 做成可导入、可分析、可视化编排、可编辑、可执行本地 agent 工作流的统一界面。
- **成功标准**:
  - AgentFlow 能展示工作流资产结构，而不是只显示单个 README。
  - 用户能在 UI 中看到工作流链路：入口、执行协议、参数配置、模板资产、产物/示例。
  - 外部本机工作流目录（如 `/Users/huangbo/Dev/novel-workflow/`）可进入当前 flow 沙盒并在左侧文件树中编辑。
  - `npm run typecheck` 与 `npm -w web run build` 均通过。
- **明确的非目标**:
  - 本 session 不实现完整图形化拖拽节点编排引擎。
  - 不直接在浏览器中任意编辑系统绝对路径文件，避免越权与安全边界混乱。
  - 不重构整个 AgentFlow / ExecutionPane 架构。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| AgentFlow 编辑面板视觉改造 | ✅完成 | `web/src/components/FlowEditorPane.tsx` | 新增 “Visual orchestration / 工作流编排地图” 顶部区域。 |
| 编排地图资产识别 | ✅完成 | `buildArtifacts()` 等 helper | 自动识别 README、OPERATION-GUIDE、`.pi`、`templates/`、examples/samples 或 fallback 文件。 |
| 文件树与编辑器原能力保留 | ✅完成 | `FlowEditorPane.tsx` | 保留 Markdown 预览、JSON/JSONL 结构化视图、保存、刷新。 |
| 本机目录引用检测 | ✅完成 | `extractLocalFolderRefs()` | 从当前文件内容检测 `file:///Users/...` 或 `/Users/...`。 |
| 本机目录导入 API | ✅完成 | `server/src/index.ts`, `server/src/flow-fs.ts`, `web/src/lib/api.ts` | 新增 `POST /api/flows/:id/import-local` 与前端 `api.importLocalFolder()`。 |
| 真实页面手动验收 | 🚧进行中 | `localhost:5173` | [未验证] 代码构建通过，但用户需刷新/重启 dev 后在 UI 实测。 |
| chunk 体积优化 | ⏳待启动 | Vite build warning | 构建成功但仍有 >500KB chunk 警告，本 session 未处理。 |

### 4. 关键决策与权衡 ⭐

**决策 1: 用“顶部编排地图 + 下方文件编辑器”替代纯文件编辑器**
- 选择: 在 `FlowEditorPane` 顶部增加一排卡片式 orchestration map，保留原左侧文件树与右侧编辑区。
- 备选: A）重做整页为 node canvas；B）只美化现有 README 预览。
- 理由: 用户截图中的痛点是“可视化编排界面不够像编排”，但项目当前没有图节点数据模型；直接上 node canvas 会引入大量状态与依赖，风险高。卡片式链路能立即表达“入口→协议→参数→模板→产物”，同时不破坏已有编辑能力。
- 影响范围: 后续若做拖拽编排，可复用这些资产识别 helper 作为节点来源。
- 可逆性: 高。

**决策 2: 外部本机目录不直接编辑，先复制进 flow 沙盒**
- 选择: 检测到 `/Users/huangbo/Dev/novel-workflow/` 后，提供“导入本机目录”按钮，把文件复制到当前 flow 的 `~/.pi-xanthil/workspaces/.../flows/<id>/` 下，再在编辑器中编辑。
- 备选: A）允许 `flowFileGet/Put` 直接读取任意绝对路径；B）只提示用户手动重新上传文件夹。
- 理由: 直接编辑任意绝对路径会绕过 `safeResolve()` 的沙盒安全边界；手动上传体验差，且用户明确指出路径问题导致无法编辑。复制到沙盒兼顾安全和可用性。
- 影响范围: flow 编辑器只承诺编辑沙盒内文件；外部目录变更不会自动同步，除非再次导入。
- 可逆性: 中。

**决策 3: 从 README 内容自动识别本机路径作为导入入口**
- 选择: 前端读取当前文件内容，匹配 `file:///Users/...` 与 `/Users/...`，在编辑器顶部提示条展示最多 3 个导入按钮。
- 备选: A）新增一个全局“输入本机路径”表单；B）只在后端 import 时处理路径。
- 理由: 用户的实际线索已经在 README 中（`[Context] file:///Users/huangbo/Dev/novel-workflow/`），自动识别最贴合当前问题，减少用户操作。全局表单后续可加，但不是本次最小闭环。
- 影响范围: 当前只在打开含路径的文件时出现提示；若路径在其它文件，需要先打开该文件。
- 可逆性: 高。

### 5. 技术/方案细节快照

- 关键前端文件：`web/src/components/FlowEditorPane.tsx`
  - 新增 `FlowArtifact`、`buildArtifacts()`、`OrchestrationMap()`、`normalizeLocalPath()`、`extractLocalFolderRefs()`。
  - `FlowEditorPane` 新增状态：`localImporting`、`localImportHint`。
  - 打开含 `/Users/...` 路径的文件后，会显示 sky 色提示条，按钮调用 `importLocalFolder(path)`。
- 关键后端文件：`server/src/flow-fs.ts`
  - 新增 `copyLocalFolderIntoFlow(srcAbs, dstRoot)`。
  - 会过滤 `.DS_Store`、`.pi-sessions`、`runs`，并拒绝 source 与 flow folder 互为父子目录，避免递归复制/覆盖风险。
- 关键 API：`server/src/index.ts`
  - 新增 `POST /api/flows/:id/import-local`。
  - body: `{ path: string }`，返回 `{ ok, sourceName, count }`。
- 前端 API：`web/src/lib/api.ts`
  - 新增 `importLocalFolder(flowId, path)`。
- 已确认事实：当前真实 flow 沙盒目录曾只包含 `README.md` 与 `.pi-sessions/...jsonl`；真实完整工作流在 `/Users/huangbo/Dev/novel-workflow/`，包含 10 个文件：`README.md`、`novel-workflow.js`、`使用指南.md`、`01-世界观设定/00-世界观总览.md` 等。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm -w web run build` ✅
- 已知构建提示：Vite 报 `Some chunks are larger than 500 kB`，这是警告，不影响功能，本 session 未处理。

### 6. 未完成事项与下一步（Action Items）

- [ ] **真实 UI 验收本机目录导入** — 优先级 P0
  - 上下文: 代码已实现，但用户截图页面仍需刷新/重启 dev 后实测。
  - 输入: 打开当前 flow 的 `README.md`，其中应包含 `file:///Users/huangbo/Dev/novel-workflow/`。
  - 完成标准: 页面出现“导入 /Users/huangbo/Dev/novel-workflow”按钮；点击后左侧文件树显示 10 个工作流文件；可编辑并保存其中任一 `.md`。
  - 潜在难点: server API 新增后 Vite 前端热更新不等于 Node server 热更新，必要时重启 `npm run dev`。

- [ ] **检查导入路径是否保留顶层目录** — 优先级 P1
  - 上下文: 当前 `copyLocalFolderIntoFlow()` 将源目录内容复制到 flow 根，不额外包一层 `novel-workflow/`。
  - 输入: 导入后的文件树。
  - 完成标准: 用户确认这种平铺方式符合预期；若希望保留顶层目录，则调整 copy 目标为 `flow.folderPath/sourceName/`。
  - 潜在难点: 平铺可能覆盖已有 README；当前设计是为了让 README 直接成为 flow 入口。

- [ ] **优化编排地图对小说工作流的语义识别** — 优先级 P1
  - 上下文: 当前地图是通用资产类型识别，不能自动把 `01-世界观设定`、`02-人物档案` 等展示成小说创作链路。
  - 输入: 导入后的 `novel-workflow` 文件树。
  - 完成标准: 地图能展示“世界观→人物→大纲→章节→润色→资料→最终稿件”等业务步骤。
  - 潜在难点: 需要决定是硬编码目录命名规则，还是从 README/目录动态抽取。

- [ ] **处理 build chunk 警告** — 优先级 P2
  - 上下文: 构建成功但 JS chunk 超过 500KB。
  - 输入: `web/package.json`、Vite config、依赖分析。
  - 完成标准: 通过 dynamic import 或 manualChunks 降低 warning，或明确记录忽略原因。
  - 潜在难点: 不是当前用户痛点，避免过早优化。

### 7. 开放问题与待确认事项

- ❓ 用户是否希望导入后仍与 `/Users/huangbo/Dev/novel-workflow/` 保持同步？
  - 当前倾向: 不自动双向同步，只复制到 flow 沙盒，保证安全与可复现。
  - 阻塞了什么: 后续是否需要“重新同步”“打开源目录”“覆盖导入”等功能。
  - 需要谁/什么来解决: 用户决策。

- ❓ 可视化编排最终是否需要拖拽式 node canvas？
  - 当前倾向: 先用可点击资产卡片闭环编辑，再根据真实工作流数据演进。
  - 阻塞了什么: 是否引入 React Flow 等新依赖。
  - 需要谁/什么来解决: 用户对交互形态的确认。

### 8. 上下文与约定

- 默认中文沟通，代码/变量/注释使用英文。
- 用户关注的是“工作流生成的文件能否被界面找到并编辑”，不是单纯视觉美化。
- 重要安全约定：不要为方便直接放开任意绝对路径读写；应通过受控导入进入 flow 沙盒。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」。  
> 当前最紧迫的是在真实浏览器中验证 `/Users/huangbo/Dev/novel-workflow/` 的导入按钮、文件树完整性和保存能力。  
> 注意新增了 server API，若页面没有变化，先让用户重启 `npm run dev`，不要只刷新前端。  
> 如果用户希望直接编辑源目录或双向同步，先确认安全边界与覆盖策略，再改后端。

---

## 📌 Session 2 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 在 Phase 0–1 既有骨架上，新增 `agentflow` 功能模块端到端实现。后端建表/REST/WS/multer 上传一次落地；前端新增 `AgentFlow` 顶部 tab + 侧栏「工作流」section + 三个新组件（`AgentFlowPane / FlowChatPane / FlowEditorPane`），实现「pi 对话视图」与「工作流编辑面板」双视图切换。
- **关键决策**: ①工作流以 **文件夹** 为载体（与 pi 既有约定一致），存于 `<workspace_root>/flows/<flowId>/`；②使用浏览器 `<input webkitdirectory>` 上传整个本地 agent 文件夹，server 端用 multer + 文件级 `paths[]` 重建目录层级；③导入完成后自动向 pi 发一条 "priming prompt"，让 pi 扫描文件夹并改造为可直接调用的 pi 工作流；④pi 进程 cwd 直接指向 flow 文件夹，使 pi 的 Read/Write 工具天然作用于工作流文件。
- **新增阻塞/问题**: 与 Session 1 相同 —— pi 默认 model 报 `developer` role 400 + `ptk-memory-inject` 扩展 better-sqlite3 版本不匹配。因此 **pi 真实改造 agent 文件夹的能力未经端到端验证**（前端/后端/协议/UI 链路均已 typecheck 通过，但需要可用的 pi 实例才能验证 priming prompt 的实际产出）。
### 1. 项目元信息

```
项目名称: 湘鉴 pi-Xanthil
模块: agentflow（Session 2 新增）
项目类型: 代码开发（Web 前端 + Node BFF，套壳 pi cli）
Session 编号: 第 2 次交接
本次 Session 起止: 从「Phase 0–1 骨架 + 一份对 agentflow 的产品需求」推进到「agentflow 模块全栈实现 + typecheck 通过」
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
前置交接: 见 handoff_log.md（Session 1，必读）
```

### 2. 模块目标（North Star）

- **一句话目标**: 让用户能在 Web 端选择一个本地任意格式的 agent 工作流文件夹，由 pi 自动分析并改造为 pi cli 能直接调用的工作流，且后续可在树形编辑器中持续微调。
- **成功标准**:
  1. 顶部点 AgentFlow → 选/新建一个工作流 → 在「pi 对话」子视图点「导入文件夹」选择一个本地文件夹 → 自动上传 + pi 自动开始分析改造 → 改造结果在「工作流编辑面板」立即可见。
  2. 若 pi 无法理解原格式，会主动向用户提问，对话往复后产出可调用的工作流。
  3. 双视图切换不丢状态，pi 在 flow 目录内的所有读写操作天然落到正确位置。
- **明确的非目标**: 不做 n8n/Dify 那种节点-连线可视化编辑（用户明确选 b：树形浏览 + 文本编辑）；不引入 monaco（用户明确选 textarea）；不解析特定来源格式（用户明确选 "任意格式都吃，让 pi 自己看着办"）。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 数据模型（flows + flow_messages 表） | ✅完成 | `server/src/db.ts` | 与 sessions/messages 同构 |
| flow 文件系统层（树/读/写/安全路径/移动） | ✅完成 | `server/src/flow-fs.ts`（新） | 含 path traversal 守护 + 2MB 文件读截断 |
| REST 路由（CRUD + tree + file + import） | ✅完成 | `server/src/index.ts` | 7 个新端点 |
| WS `send_flow` 协议 | ✅完成 | `server/src/index.ts` `handleSendFlow` | pi cwd 指向 flow 文件夹 |
| 文件夹上传（multer + webkitdirectory） | ✅完成 | `server/src/index.ts` upload | tmp dir → moveAllFiles 重建目录 |
| 前端协议/API 同步 | ✅完成 | `web/src/types.ts` `web/src/lib/api.ts` | 含 `importFlowFolder` |
| MainHeader AgentFlow tab | ✅完成 | `web/src/components/MainHeader.tsx` | 紧邻「对话」 |
| Sidebar 工作流 section | ✅完成 | `web/src/components/Sidebar.tsx` | 与会话平级，CRUD |
| AgentFlowPane（容器 + 子视图切换） | ✅完成 | `web/src/components/AgentFlowPane.tsx`（新） | 共享 flowId，独立 ws 订阅 |
| FlowChatPane（增强对话 + 导入按钮 + banner） | ✅完成 | `web/src/components/FlowChatPane.tsx`（新） | 常驻 banner 提示非通用对话 |
| FlowEditorPane（树形 + textarea） | ✅完成 | `web/src/components/FlowEditorPane.tsx`（新） | Cmd/Ctrl+S 保存，run_end 自动刷树 |
| typecheck 全绿 | ✅完成 | `npm run typecheck` | server + web 均通过 |
| 真实 pi 端到端验证 | ⚠️阻塞 | — | 同 Session 1：pi model/扩展问题 |
| 大文件夹/大文件容量调优 | ⏳待启动 | — | 当前 multer fileSize 50MB |
| markdown 预览（编辑器分屏） | ⏳可选 | — | textarea 已满足需求，看后续是否需要 |

### 4. 关键决策与权衡 ⭐

**决策 1: 工作流 = 文件夹（与 pi 既有约定对齐）**
- 选择: flow 实体在 DB 只存元数据 + `folder_path`，所有内容（README.md / OPERATION-GUIDE.md / templates/ / `.pi/` 等）以真实文件夹形式落在 `<workspace_root>/flows/<flowId>/`。
- 备选: ① 把 flow 编排成 JSON DSL 存 DB（被否决，pi 没有原生 DSL）；② 用 git 仓库管理（被否决，太重）。
- 理由: 用户给的案例（`district-crowd-deepresearch/`）就是文件夹形态，pi 通过读 md 文件理解步骤；保持同构便于 pi 用自己的 Read/Write 工具直接操作。
- 影响范围: pi 的 cwd 就是 flow 文件夹，pi 写入即落地；删除 flow 时**仅清 DB 行，磁盘文件保留**（与 workspace 删除语义一致）。
- 可逆性: 高（DB schema 可加字段；如果未来要加结构化层，可在文件夹基础上叠加 manifest）。

**决策 2: 浏览器 `<input webkitdirectory>` 上传整个文件夹**
- 选择: 用户在前端选本地文件夹 → 所有文件以 multipart 形式 POST 到 server，每文件附带 `webkitRelativePath`，server 端 multer 接收到 tmp dir 后用 `moveAllFiles` 按相对路径重建到 flow 目录。
- 备选: 让用户输入绝对路径 + server 端 `cp -r`（被否决，用户明确选浏览器方案）。
- 理由: 用户体验更接近"导入"语义；不依赖路径权限；跨机器/远程部署天然可用。
- 影响范围: 单次 POST 体积受 multer `limits.fileSize` (50MB/file) 和浏览器/网络限制；隐藏文件（如 `.pi/`）**会被浏览器一并上传**（符合预期）；OS 垃圾文件 `.DS_Store` 在 server 端读 tree 时被过滤。
- 可逆性: 中（前后端协议都改了，但加一个 "路径导入" 接口是叠加式扩展）。

**决策 3: 导入后自动喂 priming prompt 给 pi**
- 选择: import 接口成功后，前端立即 `gateway.send({ type:"send_flow", text: PRIMING_PROMPT })`，让 pi 扫描+理解+改造文件夹，必要时主动提问。
- 备选: 用户手动输入第一条消息（被否决，体验差且容易遗漏关键指令）。
- 理由: 整个产品体验承诺就是「导入 → pi 自动改造」，这一步不能让用户自己拼提示词。
- 影响范围: prompt 文本写死在 `AgentFlowPane.tsx` 的 `PRIMING_PROMPT` 常量；如效果不佳可在该处迭代。
- 可逆性: 高（纯前端字符串）。

**决策 4: 双视图（pi 对话 / 工作流编辑面板）由 AgentFlowPane 内部状态切换**
- 选择: 同一个 `AgentFlowPane` 组件内 `view: "chat" | "editor"` 条件渲染。pi 对话视图的 `messages` 状态在 `AgentFlowPane` 中持有，切换不丢；编辑器的 `file` 状态在 `FlowEditorPane` 内部，切换会重新加载（pi 运行结束时会主动 bump `editorRefreshKey` 强制重拉树）。
- 备选: tab 路由化（被否决，无路由库且功能简单）；两侧并排（被否决，宽度不够，违背"切换"需求）。
- 理由: 实现最简，状态边界清晰。
- 影响范围: 切换不丢对话历史；编辑器重拉是有意为之（pi 可能改了文件）。
- 可逆性: 高。

**决策 5: 主对话区订阅排除 flow 流量，避免互相干扰**
- 选择: `App.tsx` 的 gateway 订阅顶部加 `if (msg.type === "flow_event") return; if ("flowId" in msg && msg.flowId) return;`。flow 的事件完全由 `AgentFlowPane` 自己的订阅处理。
- 推翻原因: `ServerMessage` 类型把 `sessionId` 改为 optional 后，原 `App.tsx` 的 `if ("sessionId" in msg && msg.sessionId !== activeRef.current) return;` 会因 flow 的 run_start 没有 sessionId 而误判通过，污染主对话区的 `running` 状态。
- 影响范围: 两个组件各自独立订阅同一个 gateway，靠 flowId/sessionId 区分。
- 可逆性: 高。

### 5. 技术/方案细节快照

**数据模型（新增表）**
```sql
CREATE TABLE flows (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name         TEXT NOT NULL,
  folder_path  TEXT NOT NULL,    -- <workspace_root>/flows/<id>/
  source_name  TEXT,              -- 导入时识别的源文件夹顶层名（如 "district-crowd-deepresearch"）
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE flow_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES flows(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  usage TEXT,
  created_at INTEGER NOT NULL
);
```

**新增 REST 端点（全部在 `server/src/index.ts`）**
- `GET    /api/workspaces/:id/flows` — 列表
- `POST   /api/workspaces/:id/flows` — 新建 `{name}` → 返回 Flow（同时 mkdir 文件夹）
- `PATCH  /api/flows/:id` — 重命名 `{name}`
- `DELETE /api/flows/:id` — 删除（仅清 DB，文件夹保留）
- `GET    /api/flows/:id/messages` — 历史消息
- `GET    /api/flows/:id/tree` — 返回 `TreeNode`（递归，含 mtime/size）
- `GET    /api/flows/:id/file?path=...` — 读单个文件 `{content, truncated, size}`，>2MB 自动截断
- `PUT    /api/flows/:id/file` — 写单个文件 `{path, content}`
- `POST   /api/flows/:id/import` — multer `.any()`，配合 `paths[]` 字段重建目录层级

**WS 协议（`server/src/types.ts` 同时镜像到 `web/src/types.ts`）**
- `ClientMessage` 新增: `{ type:"send_flow", flowId, text, model? }`
- `ServerMessage` 新增: `{ type:"flow_event", flowId, event }`
- `run_start / run_end / error` 现在的 `sessionId` 和 `flowId` 都是可选，**只有其中之一会被赋值**（取决于本次运行是 session 还是 flow）

**pi 适配器复用**
- `runPiTurn` 完全不变。`handleSendFlow` 把 `workspaceRoot` 参数传成 `flow.folderPath`、`piSessionId` 传成 `flow.id`。
- pi 因此把 flow 文件夹当 cwd，`.pi-sessions` 子目录会被 pi 自动创建在 flow 内（这与 workspace session 的行为对称）。

**关键文件清单（本 session 新增/修改）**
- 新增: `server/src/flow-fs.ts`、`web/src/components/AgentFlowPane.tsx`、`web/src/components/FlowChatPane.tsx`、`web/src/components/FlowEditorPane.tsx`
- 修改: `server/src/{types,config,db,index}.ts`、`web/src/{types,App}.tsx`、`web/src/lib/api.ts`、`web/src/components/{MainHeader,Sidebar}.tsx`

**视觉签名（沿用 Session 1 约定）**
- lucide 图标 `strokeWidth={1.75}`；新组件全部用此值
- AgentFlow 顶部子视图切换器用 `h-7` chip，与现有 MainHeader tab 视觉一致
- pi 对话视图顶部多一条 `amber-50/amber-700` 常驻 banner（暗色 `amber-950/30 + amber-300`），是整个 UI 唯一一处暖色，用于标记"非通用对话"
- 编辑器树形采用 12px `paddingLeft = 6 + depth * 12` 缩进，文件夹优先排序

**已踩的坑**
- TS `noUncheckedIndexedAccess` 下，**仅在挂了 multer 中间件的 handler 里** `req.params.id` 会被推断成 `string | undefined`（其他 handler 不会）；用 `String(req.params.id ?? "")` 兜一道即可。
- multer storage `destination` 回调里不能用 ESM 顶层 `import` 之外的方式动态拿 fs；必须把 `mkdirSync` 提前 `import` 到顶部。
- 浏览器 `<input webkitdirectory>` 在 React 里属性名小写为 `webkitdirectory` 且需要 `declare module "react"` 增广 InputHTMLAttributes，否则 TSX 报错——已在 `FlowChatPane.tsx` 头部完成增广。
- 选过文件夹后若不重置 `e.target.value = ""`，再选同一文件夹**不会触发 onChange**。
- gateway 订阅一定要按 flow_event / pi_event 隔离主从两个区域，否则两边都会响应同一份事件。

### 6. 未完成事项与下一步（Action Items）

- [ ] **跑通真实 pi 端到端验证 agentflow 闭环** — P0（同 Session 1 的 P0 阻塞）
  - 上下文: 整个 agentflow 链路（导入 → 上传落盘 → priming prompt → pi 改造 → 编辑器刷新）已类型层完成且 typecheck 通过，但 pi 实际是否能按 priming prompt 改写文件夹未经验证。
  - 输入: 在 pi 顶栏切到可用 model，或修 ~/.pi 设置；准备一个真实的本地 agent 文件夹（例如用户提到的 `/Users/huangbo/Dev/archive/district-crowd-deepresearch/`）。
  - 完成标准: 新建 flow → 导入该文件夹 → 看到 pi 输出非空、可见至少一次 Read tool_use → flow 文件夹内 README/OPERATION-GUIDE 被 pi 写入或更新 → 切到编辑器树形看到新内容。
  - 潜在难点: priming prompt 可能需要根据 pi 真实工具能力（Read/LS/Edit/Write 等具体名称）微调；改造完成判定语义需用户/pi 共识。

- [ ] **观察并迭代 PRIMING_PROMPT** — P1（依赖 P0）
  - 上下文: 当前 prompt 在 `web/src/components/AgentFlowPane.tsx` 顶部 `PRIMING_PROMPT` 常量，硬编码 5 条指令。
  - 完成标准: 至少 3 个不同形态的本地 agent 文件夹（如 dify 导出/coze 导出/手写 md）都能被 pi 正确理解并产出可调用的 pi 工作流。

- [ ] **大文件夹/大文件上传容量调优** — P1
  - 上下文: 当前 multer `limits.fileSize = 50MB`；如导入文件夹中包含大数据文件会被拦截。
  - 输入: `server/src/index.ts` 中 multer 配置；可加 `limits.files`、`fields`。
  - 完成标准: 给出合理上限并在前端做提前校验提示。

- [ ] **编辑器：markdown 预览分屏（可选）** — P2
  - 上下文: 用户明确选 textarea，但若编辑文档变多会有需要。可复用现有 `Markdown` 组件做右侧实时预览。
  - 完成标准: 编辑器右侧可切「源码 / 预览 / 分屏」。

- [ ] **编辑器：新建文件/文件夹、删除、重命名** — P2
  - 上下文: 当前只支持读现有文件 + 改内容，不能在 UI 层新建/删/重命名。
  - 输入: 在 `flow-fs.ts` 加 mkdir/rm/rename 接口 + REST 端点 + 树形右键菜单。
  - 完成标准: 用户在编辑器内即可完整管理 flow 文件结构（pi 那边已经可以通过 Write/Bash 做这些）。

- [ ] **删除 flow 时同步删除磁盘文件夹的开关** — P3
  - 上下文: 当前删除仅清 DB，与 workspace 删除语义对齐。如需"彻底删"应给二次确认开关。

### 7. 开放问题与待确认事项

- ❓ **PRIMING_PROMPT 是否要让 pi 主动生成 `.pi/` 配置？**
  - 当前倾向: 让 pi 自行决定（prompt 第 4 条说"补全缺失的说明文档"包含 .pi/ 但不强制）。
  - 阻塞了什么: pi 是否真正读取 `.pi/` 来加载 agent 配置 —— 这需要确认 pi 的 agent loading 机制。
  - 需要谁解决: 用户或 pi 文档。

- ❓ **flow 与 session 是否需要"绑定"关系？**
  - 当前: 完全独立平级实体。
  - 备选: flow 创建时自动生成一个绑定 session（"用这个 flow 跑一次"）。
  - 需要: 等用户跑通真实场景后判断。

- ❓ **多用户/远程部署时，flow 文件夹路径在编辑器顶部的展示**
  - 当前: AgentFlowPane 子视图切换器右侧显示 `flow.folderPath`（绝对路径）。
  - 风险: 远程部署时这是 server 端路径，对用户无意义。
  - 建议: 等出现真实场景再决定是否隐藏。

### 8. 上下文与约定

- 沿用 Session 1 全部约定（中文回答、最小改动、先思考后动手、删除前确认、证据优先）。
- 新增组件视觉签名：banner 用 amber（这是 UI 中唯一暖色，专用于"该界面用途的元信息提示"），其他维持 zinc/neutral。
- 本 session 中 `write` 工具多次报 schema 错误（疑似工具栈对超长 content 的解析问题），改用 `edit` 分段追加完成本文件 —— 后续 session 遇到类似情况可参考此 workaround。

### 9. 下一个 Session 启动指令

> 请先读 `handoff_log.md`（Session 1）+ 本文件，并跑 `npm run typecheck` 确认现状。
> 当前最紧迫的是 **P0：在可用 pi 实例下跑通 agentflow 完整闭环**（新建 flow → 导入文件夹 → 等 pi 自动改造 → 切到编辑器查看新文件 → 必要时手工微调 textarea 内容并保存 → 再次切回 pi 对话继续迭代）。
> 验证过程中如果 priming prompt 效果不理想，直接改 `web/src/components/AgentFlowPane.tsx` 的 `PRIMING_PROMPT` 常量。
> 注意继续遵守 Session 1 的两个类型陷阱（判别联合的开放成员；node:sqlite 返回需 `as unknown as T`），并新增一条：**multer handler 的 `req.params` 在 noUncheckedIndexedAccess 下会被推断为 string | undefined**，必要时用 `String(req.params.id ?? "")` 兜底。
---

## 📌 Session 3 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 仅前端改动，针对 Session 2 留下的两个 UX 缺陷做精修；后端协议/数据模型完全未动。Task 1 与 Task 2 已完成并 typecheck 通过；Task 3 给出执行视图产品方案文档（未编码）。
- **关键决策**: ①编辑器"应用到编辑器"= 切视图 + 组件挂载时自动打开最佳候选文件（README.md > OPERATION-GUIDE.md > 任意 .md > 首个非隐藏文件），并自动展开父目录。②编辑器右侧改为按文件扩展名智能渲染（markdown/jsonl/json/text），但**严格保留 Session 2 的"树+textarea"骨架与"不引入 monaco / 不解析特定来源 DSL"约束**——所有新增视图都是"渲染层增强"，源文件依然是裸文本，textarea 仍是写入路径。③执行视图定位为独立顶 tab（与 AgentFlow 隔离），受众=使用者而非开发者。
- **新增阻塞/问题**: 无新增。Session 2 的 P0 阻塞（pi model/扩展问题导致真实端到端未跑通）仍在，但 Task 1/2 是纯前端，可在 mock 数据下验证 UI 链路。

### 1. 项目元信息

```
项目名称: 湘鉴 pi-Xanthil
模块: agentflow（Session 3 = 编辑器 UX 精修 + 执行视图产品方案）
项目类型: 代码开发（Web 前端，本 session 后端零改动）
Session 编号: 第 3 次交接
本次 Session 起止: 从「Session 2 typecheck 通过但编辑器 UX 缺陷」推进到「编辑器智能渲染 + 执行视图方案落定」
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
前置交接: 必读 handoff_log.md（Session 1）+ 本文件 Session 2 段
```

### 2. 本 Session 接收的需求（原话）

1. 工作流对话界面，点击"应用到编辑器"后，跳转到编辑器界面后，没有任何呈现
2. 工作流编辑界面，是个 jsonl 文档，可以编辑，但是非常不友好，这不是产品所规划的样子，需要改造
3. 补充一个功能：现在只有工作流的开发与改造功能，没有工作流的执行界面，工作流的执行界面比较复杂，先完成任务 1 和 2 的迭代后，先出工作流执行的产品方案

### 3. 当前进度全景（仅本 session 变化项）

| 任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Task 1: 编辑器自动打开最佳文件 | ✅完成 | `web/src/components/FlowEditorPane.tsx` 的 useEffect | 切到编辑器即见内容 |
| Task 2: 编辑器智能渲染 | ✅完成 | `FlowEditorPane.tsx` 整体重写 | md/jsonl/json 各自专属视图 |
| Task 3: 执行视图产品方案 | ✅完成（文档） | 见本 session 下文「执行视图方案」段 | 未编码 |
| 真实 pi 端到端验证 | ⚠️阻塞（同 Session 2） | — | model/扩展问题未解 |
| 大文件夹/容量调优 | ⏳待启动 | — | 同 Session 2 |

### 4. 关键决策与权衡 ⭐

**决策 1: "应用到编辑器"= 视图切换 + 组件挂载副作用，不引入 autoOpenSignal**
- 选择: `onApplyToEditor={() => setView("editor")}` 不变；改在 `FlowEditorPane` 的 `useEffect([flowId, refreshKey])` 内完成"加载树 + 自动打开最佳文件 + 展开父目录"。
- 备选: 引入 `autoOpenSignal: number` prop（递增）触发 force auto-open。
- 否决理由: `view==="chat"` 与 `view==="editor"` 是条件渲染，切到 editor 时组件全新挂载，effect 必跑一次。signal 是多余的状态机。
- 影响范围: 用户每次切到编辑器都会重置到"最佳文件"。若用户希望"保留上次位置"需后续叠加 localStorage 持久化。
- 可逆性: 高（加 signal 是无破坏性叠加）。

**决策 2: 最佳文件优先级硬编码**
- 选择: README.md > OPERATION-GUIDE.md > 任意 .md（跳过 . 开头隐藏目录）> 首个非隐藏文件。
- 否决备选: 让 pi 在 `.pi/manifest.json` 里声明"入口文件"。
- 理由: 当前阶段约定式比配置式简单；pi 改造后产出的文件夹 99% 会有 README.md。隐藏目录跳过是为了避免打开 `.pi-sessions/*.jsonl` 这类 pi 内部数据。
- 可逆性: 高（一旦 `.pi/manifest.json` 标准化即可前置该规则）。

**决策 3: 按扩展名智能渲染，但保留 textarea 写入路径**
- 选择: 同一份 `file.content` 状态，按 `fileCategory(path)` 决定右侧用 `Markdown` / `JsonlStructuredView` / `<pre>` pretty-json / `textarea`。
- viewMode: markdown 默认 preview、jsonl 默认 structured、json 默认 preview、text 默认 edit。所有非 text 类型都可手动切回 "edit" 进 textarea。
- 否决备选: ①Monaco（违反 Session 2 决策）②按文件类型拆出独立 sub-component（增加 prop drilling）③针对 jsonl 做行级可编辑卡片（复杂度爆炸，jsonl 多为只读 pi 日志）。
- 影响范围: jsonl 结构化视图是**只读**；用户要改 jsonl 必须切到"源码"模式（与"非破坏性"原则一致）。
- 可逆性: 高（删除任一 view 分支即回退到 textarea-only）。

**决策 4: textarea 增加 Tab 缩进**
- 选择: 截获 Tab 键插入两个空格，避免焦点跳出 textarea。
- 理由: 配置文件/templates 编辑必备。
- 不引入 Shift+Tab 反向缩进（与"最小改动"对齐，需要时再加）。

**决策 5: 执行视图独立顶 tab，不内嵌 AgentFlow**
- 选择: 与 `[对话] [AgentFlow]` 平级新增 `[执行]` tab。
- 否决备选: 在 AgentFlow 内加第三子视图（chat/editor/run）。
- 理由: 受众/频次/视觉语言完全不同——开发者用 AgentFlow（amber banner、自由对话），使用者用执行视图（表单、进度条、产出物预览）。混入 AgentFlow 会让 amber banner 干扰使用者。
- 可逆性: 中（顶 tab 加减成本低，但全局状态边界会变）。

### 5. 技术/方案细节快照

**FlowEditorPane 重构后的核心类型**
```ts
type ViewMode = "preview" | "edit" | "structured";
type FileCategory = "markdown" | "jsonl" | "json" | "text";

interface FileState {
  path: string;
  content: string;       // 始终保持原始文本，所有视图都从此派生
  dirty: boolean;
  truncated: boolean;
  loading: boolean;
  saving: boolean;
  viewMode: ViewMode;
  error?: string;
}
```

**渲染分支决策表**
| cat | viewMode=preview | viewMode=edit | viewMode=structured |
|---|---|---|---|
| markdown | `<Markdown>` 渲染 | textarea | （N/A） |
| jsonl | （N/A） | textarea | `<JsonlStructuredView>` 卡片列表（只读） |
| json | pretty-print `<pre>` | textarea | （N/A） |
| text | （fallback 到 edit） | textarea | （N/A） |

**JSONL 结构化视图实现**
- `parseJsonl(content)` 按 `\r?\n` split，逐行 `JSON.parse`，失败项标 `parseError`
- 每行渲染为一张卡片：role 徽章（user=blue / assistant=emerald / system=violet / tool=amber）+ 文本提取（从 content blocks 抽 type=text）+ tool_use 行（Wrench 图标 + name + input 摘要）+ 元数据（model / timestamp 中文化）
- 文本超 400 字符显示"展开/收起"按钮
- 顶部一行"共 N 条记录 · 只读视图（切换到「源码」可编辑）"作为模式提示

**关键文件清单（本 session 修改）**
- 修改: `web/src/components/FlowEditorPane.tsx`（510 行，相比 Session 2 的 219 行翻倍）
- **未改动**: `AgentFlowPane.tsx` / `FlowChatPane.tsx` / 任何后端文件 / 任何类型文件

**typecheck 状态**: `npm run typecheck` 全绿（server + web）

**视觉签名（沿用 + 新增）**
- 沿用 Session 1/2: lucide `strokeWidth={1.75}`，zinc/neutral 主调，amber 仅在 AgentFlow chat banner
- 新增: 角色徽章配色（blue/emerald/violet/amber），仅用于 jsonl 结构化视图。这些颜色**不应**扩散到其他界面，否则会污染 amber 的"专用提示"语义
- 文件头按钮: h-7 chip with border，markdown 用 Pencil/Eye 切换图标，jsonl 用 Code2/Eye

**已踩的坑（本 session 新增）**
- `cat >> EOF` 在 heredoc 里写 `"\n"` 会被 shell 视为字面 `\` + `n`，但写在 JS 字符串里又会被双反转义；最终改用 `.split(/\r?\n/)` 正则规避。教训：以后写入 ts 文件涉及换行符 split 一律用正则。
- 上一次 Session 2 提到的"write 工具对超长 content schema 报错"在本 session 复现并加重；最终改用 `cat >> heredoc` 分 6 次追加 + `edit` 修补单点错误的组合方式完成。**后续 session 写超过 ~400 行的新文件，优先用 heredoc 分段方案**。

### 6. 执行视图产品方案（Task 3 交付物）

> 本节为**产品方案文档**，未编码。下个 session 按"分期建议"逐步落地。

**核心定位**: 与"开发/改造"严格隔离的运行视图。开发者用 AgentFlow 打磨工作流；使用者用执行视图按钮式调用。两套界面共享 flow 文件夹，但交互对象不同。

**入口**: 顶部 tab 新增 `[执行]`，与 `[对话] [AgentFlow]` 平级。

**三层信息架构**
- **L1 工作流市场**: 当前 workspace 下所有 flows 的卡片网格（名称/描述/最近运行/平均成本/调用次数）。操作: [运行] [查看历史] [复制为新工作流]
- **L2 工作流详情**: 顶部元信息 + 左侧参数表单 + 右侧历史运行列表 + 底部 [开始运行] 大按钮
- **L3 运行实时视图**: 左=步骤进度条 / 中=流式输出 / 右=产出物预览 / 底=状态栏 + [停止]/[询问 pi]

**参数输入面板（关键创新）**
- 问题: pi 工作流是 markdown 文本，没有结构化参数定义
- 方案: 参数从 README 的 `## Inputs` 段提取
  ```markdown
  ## Inputs
  - `target_brand` (string, required): 目标品牌名
  - `period_a` (file:csv, required): A 期数据
  - `region` (enum[全国|华东|华南], default=全国): 区域筛选
  ```
- 解析后动态生成表单（文本框/文件上传/下拉框/日期范围）
- 回退: 无 `## Inputs` 段则显示自然语言 textarea "用一句话描述任务"
- 实现成本: 低，新增解析器 + 简单 schema 渲染器

**运行编排（后端新增协议）**
```ts
// ClientMessage 新增
| { type: "execute_flow"; flowId; inputs: Record<string, unknown>; model? }
| { type: "interrupt_flow"; runId; text? }

// ServerMessage 新增
| { type: "run_step_start"; runId; stepIndex; stepName }
| { type: "run_step_end";   runId; stepIndex; outputs?: string[] }
| { type: "run_artifact";   runId; path; kind: "file"|"image"|"chart" }
```
- pi 启动时把 inputs 渲染进 prompt 模板（README 中 `{{target_brand}}` 占位符替换），然后启动 pi turn
- 步骤识别（可选）: pi 在每个步骤开始/结束输出 `<!-- step:N 步骤名 -->`，前端据此推进进度条；无则回退单一视图
- 产出物: server 监听 flow 目录变更（chokidar），新文件即时 push `run_artifact`

**历史与产出物管理**
```sql
CREATE TABLE flow_runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT REFERENCES flows(id),
  inputs TEXT,           -- JSON
  status TEXT,           -- running | success | failed | aborted
  started_at INTEGER,
  ended_at INTEGER,
  cost REAL,
  tokens INTEGER,
  output_dir TEXT        -- flows/<flowId>/runs/<runId>/
);
```
- 每次运行隔离到 `runs/<runId>/` 子目录，避免污染原始工作流
- 单次运行产物可打包 zip 下载

**AgentFlow vs 执行视图边界**
| 维度 | AgentFlow | 执行视图 |
|---|---|---|
| 用户角色 | 开发者 | 使用者 |
| 主交互 | 自由对话 + 文件编辑 | 表单填写 + 一键运行 |
| pi cwd | flow 根目录 | runs/<runId>/ |
| 输出 | 修改 README/templates | 生成结果文件 |
| 中断 | 自由发消息 | 显式"询问"按钮 |

**分期建议（必须遵守）**
- **P0（下个 session 优先做）**: L2 详情页 + 简化运行视图（无步骤化、无产出物预览）。目标=打通"填表 → 跑 → 看结果"主链路。后端只需 `execute_flow` 一个新协议 + flow_runs 表 + 简化的 inputs 占位符替换
- **P1**: L1 市场卡片 + L2 历史列表 + 产出物预览（image/csv/markdown）
- **P2**: 步骤化进度条 + 运行中插入指令 + 多次运行对比
- **P3**: 参数 schema 标准化为 `.pi/inputs.yaml`（替代 README 段落解析），提升健壮性

### 7. 未完成事项与下一步（Action Items）

- [ ] **执行视图 P0 落地** — P0
  - 上下文: 本 session 已给出完整产品方案（见上文「执行视图方案」），下个 session 直接按 P0 范围编码
  - 范围: 顶 tab 新增 `[执行]` + L2 详情页 + 简化运行视图（无步骤进度、无产出物预览，先打通主链路）
  - 协议: 新增 `execute_flow` ClientMessage + `flow_runs` 表 + README `## Inputs` 段解析器
  - 完成标准: 用户能在执行视图选 flow → 填表 → 点运行 → 看到流式输出 → 运行结束在 `runs/<runId>/` 看到产物

- [ ] **跑通真实 pi 端到端验证 agentflow 闭环** — P0（同 Session 2，未解决）
  - 上下文: pi model/扩展问题未解，agentflow + 新执行视图都需此前置
  - 优先级: 应在执行视图 P0 编码完成后立刻处理（否则两套界面都跑不起来）

- [ ] **编辑器持久化"上次打开的文件"** — P2
  - 上下文: 本 session 决策 1 提到，当前每次切到编辑器都会重置到"最佳文件"。用户若希望"接着上次看"需 localStorage 持久化 `flowId → lastOpenedPath` 映射
  - 完成标准: 切走再切回不丢编辑位置

- [ ] **编辑器支持新建文件/文件夹、删除、重命名** — P2（继承 Session 2）

- [ ] **markdown 预览分屏（同时显示源码+预览）** — P3
  - 上下文: 当前是单视图切换。重度文档编辑可能希望并排
  - 完成标准: 编辑器加 `[源码 | 分屏 | 预览]` 三态切换器

### 8. 开放问题与待确认事项

- ❓ **执行视图入口位置最终确认**
  - 当前方案: 独立顶 tab `[执行]`（推荐）
  - 备选: AgentFlow 内第三子视图
  - 建议: 实现前与用户确认一次

- ❓ **参数定义规范**
  - 当前方案: README `## Inputs` 段约定式解析
  - 备选: `.pi/inputs.yaml` 配置式 / 两者兼容（yaml 优先回退 README）
  - 影响: 决定下个 session 解析器的复杂度
  - 建议: P0 先做 README 段解析，P3 升级到 yaml

- ❓ **运行隔离粒度**
  - 当前方案: 每次运行独立 `runs/<runId>/` 子目录
  - 备选: 原地执行（pi cwd 仍是 flow 根目录），靠 pi 自觉避免污染原始文件
  - 风险: 原地执行简单但易污染；隔离干净但需要 pi 把模板/配置软链接进 runs 子目录才能正常工作
  - 建议: P0 先做原地执行验证主链路，P1 再切隔离模式

- ❓ **产出物展示范围**
  - 选项 A: 仅新增/修改的文件（需 git-like diff）
  - 选项 B: 整个 `runs/<runId>/` 树
  - 建议: P0 用选项 B（简单），P1 加 A 的 diff 视图

- ❓ **jsonl 结构化卡片是否需要"内联编辑"**
  - 当前: 完全只读，要改必须切源码模式
  - 风险: 若 jsonl 是用户手写的工作流配置（非 pi 日志），强制切源码不友好
  - 建议: 等出现真实场景再决定

### 9. 上下文与约定

- 沿用 Session 1+2 全部约定（中文回答、最小改动、先思考后动手、删除前确认、证据优先、视觉签名）
- 新增视觉约定: 角色徽章配色（user=blue / assistant=emerald / system=violet / tool=amber）仅用于 jsonl 结构化卡片，不得扩散
- 新增工作流约定: 写超过 ~400 行的新文件优先用 `cat >> heredoc` 分段方案，规避 write 工具 schema 错误

### 10. 下一个 Session 启动指令

> 请先读 `handoff_log.md`（Session 1）+ 本文件全部 Session（按时间顺序 2→3），并跑 `npm run typecheck` 确认现状。
>
> 默认任务**按以下顺序执行**，除非用户明确改变优先级:
>
> 1. **解 pi 阻塞**: 切到可用 model 或修复 ~/.pi 扩展，目标=能跑通一次 agentflow 真实端到端
> 2. **执行视图 P0 编码**: 严格按本 session「执行视图产品方案」的 P0 范围实现。开工前先与用户口头确认 §8 的 4 个开放问题（入口位置、参数规范、运行隔离、产出物范围）
> 3. **若用户拒绝先确认**: 按本文档建议的"默认方案"直接动手（独立顶 tab / README 段解析 / 原地执行 / 整树展示）
>
> 编码守则提醒（继承自 Session 1+2 的类型陷阱）:
> - 判别联合的开放成员处理（参考 Session 1）
> - node:sqlite 返回需 `as unknown as T`（参考 Session 1）
> - multer handler 的 `req.params` 在 noUncheckedIndexedAccess 下推断为 `string | undefined`，用 `String(req.params.id ?? "")` 兜底（参考 Session 2）
> - 写超长文件用 `cat >> heredoc` 分段（参考 Session 3）
