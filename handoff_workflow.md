# Handoff Log — Workflow Tab（单 agent 任务入口）

---

## 📌 Session 3 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 将顶部「对话」tab 替换为「Workflow」tab；新增 WorkflowPickerPane（推荐工作流卡片网格 + 更多搜索弹窗），用户先选择工作流任务模板，再进入对话，会话以模板名命名。
- **关键决策**: ①不修改既有 Session 数据模型，工作流仅作为会话命名与入口引导；②picker 与 chat 共用同一 tab slot，用 `showWorkflowPicker` 布尔值切换，不引入额外路由；③重复点击 Workflow tab 回到 picker（tab 作为「首页」）；④13 个工作流模板全部硬编码在前端，不依赖 BFF 接口（已足够当前阶段，未来可迁移到 `GET /api/workflow-templates`）。
- **无破坏性改动**: AgentFlow tab、侧栏、BFF、db 均未改动；`Tab` 类型从 `"chat"` 改为 `"workflow"` 是纯前端重命名，TypeScript 已全量检查通过（`tsc --noEmit` 无报错）。
- **下一步重点**: ① 工作流选择后在对话首轮注入任务系统提示（把模板 description 当初始 context）；② 工作流历史会话在侧栏与 picker 联动；③ 图表/数据实体 Phase 2。

### 1. 项目元信息

```
Session 编号: 第 3 次交接
本次 Session 起止: Workflow tab 重构（纯前端，无 BFF 改动）
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
```

### 2. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Workflow tab（替代对话 tab） | ✅完成 | `MainHeader.tsx` | `Tab` 类型 `"chat"` → `"workflow"` |
| WorkflowPickerPane（推荐 6 张卡片） | ✅完成 | `web/src/components/WorkflowPickerPane.tsx` | 3 列网格，响应亮/暗色 |
| 「更多」搜索弹窗 | ✅完成 | `WorkflowPickerPane.tsx` | 全部 13 个模板可搜索 |
| 工作流选择 → 创建 Session → 进入对话 | ✅完成 | `App.tsx:onSelectWorkflow` | 会话名 = 模板名 |
| 侧栏「新建会话」→ 跳回 picker | ✅完成 | `App.tsx:newSession` | 不再直接创建空会话 |
| 侧栏点击已有 session → 直接进对话 | ✅完成 | `App.tsx:handleSelectSession` | 绕过 picker |
| 模板系统提示注入（首轮 context） | ⏳待启动 | — | 见 Action Items |
| 工作流模板后端接口 | ⏳待启动 | — | 当前纯前端硬编码 |
| Phase 2 数据实体 | ⏳待启动 | — | 沿用 Session 2 Action Items |

### 3. 关键决策与权衡 ⭐

**决策 7: `showWorkflowPicker` 布尔值切换，不引入路由**
- 选择: `App.tsx` 增加 `useState<boolean>` 控制同一 tab slot 下展示 picker 还是 ChatPane。
- 备选: React Router 为 workflow/picker 和 workflow/chat 分配独立路由（被否决）。
- 理由: 项目无路由依赖，当前场景不需要 URL 可分享；布尔状态足够，引入路由是过度设计。
- 影响范围: `App.tsx` 约 30 行改动；`MainHeader.tsx` tab ID 重命名；`WorkflowPickerPane.tsx` 新文件。
- 可逆性: 高。

**决策 8: 工作流模板硬编码在前端**
- 选择: 6 个推荐 + 7 个扩展（共 13 个）全部定义在 `WorkflowPickerPane.tsx` 常量中。
- 备选: `GET /api/workflow-templates` BFF 接口读磁盘 JSON（被推迟）。
- 理由: 当前阶段模板变化频率低；硬编码零运行时依赖；待用户确认模板集稳定后再迁移后端。
- 影响范围: 仅 `WorkflowPickerPane.tsx`；未来迁移只需改该文件的数据源，接口契约不变。
- 可逆性: 高。

**决策 9: picker 选择只改 Session 标题，不注入系统提示**
- 选择: `onSelectWorkflow` 仅以模板 `name` 创建 session，不在首轮发送任何 pi 消息。
- 备选: 创建 session 后立即通过 gateway 发送一条系统 context 消息（推迟）。
- 理由: 注入时机需要确认 pi 对 system prompt 的支持方式（`--system-prompt` flag 或首轮 user 消息伪装）；当前宁可留白让用户主导，避免引入不可预期的 pi 行为。
- 影响范围: `App.tsx:onSelectWorkflow`；未来只需在此处加 `gateway.send(...)` 一行。
- 可逆性: 高。

### 4. 技术/方案细节快照

**新增文件**
- `web/src/components/WorkflowPickerPane.tsx` — 完整组件，包含：
  - `WorkflowTemplate` interface（`id/name/description/icon: LucideIcon`）
  - `RECOMMENDED[6]` + `ALL[13]` 常量（数据分析领域模板）
  - 3 列卡片网格，hover 态 `border-neutral-300`
  - 「更多」按钮 → `searchOpen` state → 全屏遮罩弹窗 + `<input autoFocus>` + 实时过滤列表
  - 导出 `WorkflowTemplate` type 供 `App.tsx` 使用

**改动文件**
- `web/src/components/MainHeader.tsx`
  - `Tab` 类型: `"chat"` → `"workflow"`
  - `TABS[0]`: `{ id: "workflow", label: "Workflow", icon: Layers }`（图标从 `MessageSquare` 换为 `Layers`）
- `web/src/App.tsx`
  - 新增 import: `WorkflowPickerPane`, `WorkflowTemplate`
  - 新增 state: `showWorkflowPicker: boolean`（默认 `true`）
  - `activeTab` 初始值: `"workflow"`（原 `"chat"`）
  - workspace effect: session 有记录时 `setShowWorkflowPicker(false)`，无记录时 `setShowWorkflowPicker(true)`
  - `newSession`: 改为 `setShowWorkflowPicker(true); setActiveTab("workflow")`（不再直接创建空会话）
  - 新增 `handleSelectSession`: 设置 activeSessionId + `setShowWorkflowPicker(false)` + 切 workflow tab
  - 新增 `onSelectWorkflow`: 创建 session（以模板名命名）+ `setShowWorkflowPicker(false)`
  - 新增 `handleTabChange`: 重复点击当前 workflow tab 时 `setShowWorkflowPicker(true)`
  - Sidebar 的 `onSelectSession` prop 改用 `handleSelectSession`
  - MainHeader 的 `onTabChange` prop 改用 `handleTabChange`
  - 渲染条件: `activeTab === "workflow" && showWorkflowPicker` → `<WorkflowPickerPane>`；`activeTab === "workflow" && !showWorkflowPicker` → `<ChatPane>`
  - PreviewPane 可见条件: `activeTab === "workflow" && !showWorkflowPicker`

**13 个工作流模板清单**

| id | 名称 | 说明 | 是否推荐 |
|---|---|---|---|
| explore | 数据探查 | 快速了解数据集的基本情况、分布与质量 | ✅ |
| clean | 数据清洗 | 处理缺失值、异常值与格式问题 | ✅ |
| eda | 探索性分析 | 深入挖掘数据规律与变量间关联 | ✅ |
| viz | 数据可视化 | 生成图表与可视化展示 | ✅ |
| stats | 统计分析 | 描述性统计、假设检验与相关性 | ✅ |
| report | 报告生成 | 整理分析结论并生成结构化报告 | ✅ |
| timeseries | 时序分析 | 分析时间序列数据的趋势与周期 | — |
| anomaly | 异常检测 | 识别数据中的异常点与离群值 | — |
| correlation | 相关性分析 | 量化变量间的关联强度与方向 | — |
| compare | 分组对比 | 多组数据的差异分析与对比 | — |
| modeling | 预测建模 | 构建回归或分类预测模型 | — |
| text | 文本分析 | 提取文本特征、情感与关键词 | — |
| custom | 自定义任务 | 描述任意数据分析任务 | — |

**用户交互流程**
```
点击「Workflow」tab
  → showWorkflowPicker=true → WorkflowPickerPane（推荐 6 张卡片）
      ↓ 点卡片
  → onSelectWorkflow(template) → api.createSession(name=template.name)
      → showWorkflowPicker=false → ChatPane（正常对话）
      
  → 点「更多」→ searchOpen=true → 搜索弹窗（全部 13 个，实时过滤）
      ↓ 点结果行
  → onSelectWorkflow(template)（同上）

侧栏点已有 session → handleSelectSession(id) → showWorkflowPicker=false → ChatPane
侧栏「新建会话」按钮 → newSession() → showWorkflowPicker=true → WorkflowPickerPane
重复点击「Workflow」tab → handleTabChange → showWorkflowPicker=true → WorkflowPickerPane
```

### 5. 未完成事项与下一步（Action Items）

- [ ] **工作流选择后注入系统提示（首轮 context）** — P1
  - 上下文: 当前选择工作流仅改了 session 名称，对话内容与空白 session 无区别；用户期望 pi 默认以该工作流的任务背景开始。
  - 方案 A（推荐）: `onSelectWorkflow` 中创建 session 后，立即通过 gateway 发一条 user 消息（如 `"你的任务是：${template.description}，请等待我提供数据和具体要求。"`），pi 会以此为首轮上下文。
  - 方案 B: `--system-prompt` flag（需确认 pi 0.77 是否支持该 flag，以及 `--mode json` 下是否生效）。
  - 完成标准: 选「数据探查」后对话中 pi 能以数据探查的角色自我介绍或等待用户输入。
  - 潜在难点: 方案 A 会在对话列表多出一条用户消息（可用 CSS 隐藏，或加 `isSystemContext` 标记过滤渲染）。

- [ ] **工作流模板迁移到 BFF 接口** — P2
  - 上下文: 当前 13 个模板硬编码在 `WorkflowPickerPane.tsx`；当模板需要定制（加 systemPrompt 字段、支持用户自定义）时应由后端维护。
  - 输入: `GET /api/workflow-templates` 返回 `WorkflowTemplate[]`（加 `systemPrompt?: string` 字段）；模板存 SQLite 或 JSON 文件。
  - 完成标准: 前端从接口加载模板，硬编码常量删除；`WorkflowTemplate` type 移到 `types.ts`。

- [ ] **侧栏 session 显示工作流来源** — P2
  - 上下文: 侧栏的会话列表目前只显示标题和时间；工作流创建的会话与手动创建的会话外观相同，难以区分。
  - 方案: 在 `sessions` 表增加 `workflowId` 字段，侧栏 session 行在标题下显示工作流名称小标签。
  - 完成标准: 工作流来源 session 在侧栏有 badge 区分。

- [ ] **Phase 2：文件上传 + 数据网格 + 图表 + Excel 预览** — P1（沿用 Session 2）
- [ ] **流式增量渲染** — P2（沿用 Session 2）

### 6. 开放问题与待确认事项

- ❓ **工作流模板的 systemPrompt 是否由用户维护还是内置**
  - 当前: 无 systemPrompt，仅 name/description 用于 session 命名。
  - 影响: 决定模板迁移到后端的优先级和字段设计。
  - 需要: 用户确认偏好（内置固定提示 vs 用户可自定义提示词）。

- ❓ **picker 的「推荐」列表是否需要可配置**
  - 当前: 推荐 6 个硬编码，剩余放入「更多」。
  - 影响: 如需可配置，需要后端接口支持 `recommended: boolean` 字段。
  - 建议: 先保持硬编码，用户使用一段时间后再根据频率调整。

- ❓ **`pi` 0.77 是否支持 `--system-prompt` flag**（继承自 Session 2 未确认）
  - 阻塞: 工作流系统提示注入方案选型（方案 A vs B）。
  - 验证方式: `pi --help | grep system-prompt`。

### 7. 上下文与约定

- 用户偏好（全局 CLAUDE.md）: 中文回答、代码英文、最小改动、先思考后动手、删除/覆盖前确认、证据优先（先读再改）。
- 项目记忆已落盘: `~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/pi-xanthil-overview.md`。
- 视觉约定（沿用）: lucide `strokeWidth={1.75}`；小密排版 11/12.5/13px；neutral 色系，亮暗双色适配。

### 8. 下一个 Session 启动指令

> 读本 Session「本次更新摘要」与「未完成事项」两节，跑 `npm run dev`（gateway:8787 + web:5173）确认 Workflow tab 能正常显示 picker、选卡片能进入对话。
> 最紧迫任务：**工作流选择后注入系统提示**——在 `App.tsx:onSelectWorkflow` 创建 session 后立即发一条 user 消息（方案 A），让 pi 以工作流背景开始对话。
> 实现前先确认：① `pi --help | grep system-prompt` 看是否有 flag（方案 B）；② 与用户确认是否希望 systemPrompt 字段内置还是可编辑。
> 继续 Phase 2（ECharts 图表 + 数据网格 + 文件上传）前，需先与用户确认图表库选型。
> 注意沿用陷阱：判别联合开放成员破坏类型收窄 → `as Extract`；`node:sqlite` 返回需 `as unknown as T`。
