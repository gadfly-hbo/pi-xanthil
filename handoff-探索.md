# Handoff Log — 苍耳 pi-Xanthil（数据分析 AI 工作台）

---

## 📌 Session 19 — 2026-06-07

### 0. 本次更新摘要（Changelog）

**本次推进**: 在「报告输出」二级 Tab 界面，新增“生成高质量 HTML 报告”的一键转换与美化功能，且支持自主选择 pi-agent 模型进行生成。
**关键决策**: ①利用 \`runPiPrompt\` 执行高级 HTML 排版 Prompt，要求模型渲染带玻璃态、优雅明暗主题、响应式侧边导航、指标卡片与微动效的单文件自包含 HTML，完全隔离外链防止数据泄漏；②在前端 \`FolderPathsPane.tsx\` 的预览面板顶部增加漂亮的工具条，实现预览与生成一键绑定；③成功生成后自动调用 \`refreshAll()\` 更新路径与文件树，并在提示横幅提供复制新报告路径功能。
**下一步重点**: 校验不同规模报告（特别是多图表、长篇 Markdown）的渲染效率与自适应排版效果；在前端提供直接在外部浏览器预览 HTML 文件成果的快捷接口。

### 1. 项目元信息

项目名称: 苍耳 pi-Xanthil（数据分析 AI 工作台）
项目类型: 代码开发
Session 编号: 第 19 次交接
本次 Session 起止: 从「仅支持 md 原始预览」推进到「支持选择 pi-agent 模型一键美化为高质量自包含 HTML 报告并自动落盘刷新」
最后更新: 2026-06-07

### 2. 项目目标（North Star）

为分析师提供将粗糙分析草稿（Markdown）快速润色并输出为可直接汇报/预览的高级响应式 HTML 报告的能力，提高交互性能及汇报专业感，同时确保数据安全。

---

## 📌 Session 18（探索模块最新） — 2026-06-06

### 0. 本次更新摘要（Changelog）

**本次推进**: 在「聚合数据」与「报告输出」之间新增「数据探索」二级 tab，落地 Layer 0（自动剖析）+ Layer 1（拖拽式 BI 探索），采用 duckdb-wasm 纯前端引擎、echarts 渲染、dnd-kit 拖拽。同时建立项目级 `AGENTS.md` 写入数据安全分级硬约束。
**关键决策**: ①数据探索模块**永久禁止调用任何 LLM**（含未来 Layer 2/3），通过子树 grep 校验；②文件读取走前端 fetch + duckdb-wasm 浏览器内计算，server 端只提供二进制流；③依赖走动态 import，echarts/duckdb 拆到独立 chunk。
**新增阻塞/问题**: 仅手动 sanity check 未做；主 bundle 仍 1.9MB，未来加 Layer 2 需引入 `manualChunks`。
**下一步重点**: 用真实 csv/xlsx 走一遍 dev server smoke（导入→剖析→拖图）；后续按需评估 Layer 2（纯算法洞察）。

### 1. 项目元信息

项目名称: 苍耳 pi-Xanthil（数据分析 AI 工作台）
项目类型: 代码开发
Session 编号: 第 18 次交接
本次 Session 起止: 从「Session 17 探索模块 Action Items 清零」推进到「数据探索 tab L0+L1 上线 + AGENTS.md 写入数据安全分级硬约束」
最后更新: 2026-06-06

### 2. 项目目标（North Star）

延续 Session 17，无变化。新增子目标：让用户能在不调用 LLM 的前提下，对原始/聚合数据做交互式探索，发现相关性、逻辑与隐藏关系，并把发现单向反哺到业务需求/对话（不携带数据回 LLM）。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 数据探索 tab 导航 | ✅完成 | `web/src/lib/constants.ts` | `SubTab` 新增 `data_exploration`；位置在 `clean_data` 与 `report` 之间 |
| AGENTS.md 数据安全分级 | ✅完成 | `AGENTS.md`（项目根新建） | 明确 `draw_data`/`data_exploration` 永久禁止 LLM；含 grep 校验命令 |
| 二进制文件流 API | ✅完成 | `server/src/index.ts` `GET /api/workspace-paths/:pathId/file-binary` | 仅 draw_data/clean_data、仅 csv/tsv/xlsx/xls、≤100MB |
| duckdb-wasm 懒加载 | ✅完成 | `web/src/lib/duckdb.ts` | jsDelivr bundle + worker；csv 走 `read_csv_auto`，xlsx 走 sheet→json→`read_json_auto` |
| 列剖析算法 | ✅完成 | `web/src/lib/profiling.ts` | 类型推断 number/datetime/boolean/category/text/id；数值含 Q1/Q3/IQR/outlier/histogram；类别含 TOP10 |
| 文件选择器 | ✅完成 | `web/src/components/data-exploration/FileSelector.tsx` | 列出 draw_data + clean_data 已登记路径，仅显示 csv/tsv/xlsx/xls |
| 字段列表（可拖拽） | ✅完成 | `data-exploration/FieldList.tsx` | dnd-kit `useDraggable` |
| 配置面板（drop zone） | ✅完成 | `data-exploration/ConfigPanel.tsx` | X/Y/颜色 drop slot + 聚合 + 筛选 + 时间粒度 + 结果上限 |
| 图表渲染（8 类） | ✅完成 | `data-exploration/ChartCanvas.tsx` | 柱/折线/面积/散点/热力/箱线/饼/表格；echarts 动态 import |
| 剖析报告 UI | ✅完成 | `data-exploration/ProfileReport.tsx` | 数值统计、类别 TOP 值条形分布、缺失率 |
| 主组件 | ✅完成 | `web/src/components/DataExplorationPane.tsx` | 顶部红色 ShieldAlert 安全条；左中右三栏；图表/剖析 tab 切换 |
| App.tsx 挂载 | ✅完成 | explore/multi 两处 | scope 继续复用 `folderScope` |
| typecheck / build | ✅完成 | `npm run typecheck` / `npm run build` | duckdb (200KB) + echarts (1.1MB) 自动 split 到独立 chunk |
| LLM 隔离校验 | ✅完成 | grep 子树 0 匹配 LLM API | FileSelector 仅用 `listWorkspacePaths`/`workspacePathTree` 路径元数据 API |
| 真实 dev server smoke | ⏳待启动 | — | 未跑过浏览器端实际选 csv 流程 |

### 4. 关键决策与权衡 ⭐

**决策 31: 数据探索模块永久禁止调用 LLM（硬约束写入 AGENTS.md）**
- 选择: `DataExplorationPane` 及子树绝不 import `chat*/generate*/extract*/clarify*` 等 LLM API；server 端 binary 接口零 LLM；未来 Layer 2 也只能用纯算法（相关系数/IQR/cramer's V）。
- 备选: ①允许 LLM 推荐图表（被否决：列名+样本即可推断业务）；②允许 LLM 解读自动剖析摘要（被否决：摘要也含敏感分布）；③允许 NL 问数据（被否决：必然要把数据送 LLM）。
- 理由: 原始数据是项目内最高敏感等级；探索模块直接处理原始数据，必须与 LLM 链路硬隔离才能让用户敢上传敏感数据。
- 影响范围: 所有探索模块改动必须先跑 grep 校验；Layer 3 联动方向只能单向（业务需求→探索，不带数据回 LLM）。
- 可逆性: 低（属于安全契约，违反等同数据泄漏）。

**决策 32: 技术栈选型 duckdb-wasm + echarts + dnd-kit**
- 选择: ①duckdb-wasm（列式 OLAP + SQL，~200KB chunk）；②echarts + echarts-for-react（图表类型最全，11 类我用了 8 类，1.1MB 独立 chunk）；③`@dnd-kit/core`（轻量、TS 友好）。
- 备选: arquero/danfojs（无 SQL、性能弱）；recharts/visx（缺箱线/热力）；react-beautiful-dnd（已弃维）。
- 理由: 浏览器内 100MB 级数据交互式分析需要列式存储 + SQL；图表覆盖广度优先于打包体积；dnd 只需基础 drop slot 不需要 sortable。
- 影响范围: web bundle 拆分为 index/duckdb/echarts 三个 chunk；首屏不影响。

**决策 33: 文件入口只读已登记路径，不允许临时上传**
- 选择: 文件选择器只列出 `draw_data`/`clean_data` 已登记路径下的 csv/tsv/xlsx/xls；新文件需先在「原始数据」/「聚合数据」tab 登记。
- 备选: 允许直接拖拽上传（被否决：与现有路径管理原则冲突，安全边界变模糊）。
- 理由: 沿用 Session 12+ 统一路径登记策略；权限/审计/scope 隔离全部复用。
- 影响范围: 用户使用流程：先登记→再探索；UI 文案提示在 `FileSelector.tsx`。

**决策 34: 本期只做 L0+L1，砍掉 L2 自动洞察文案与 L3 反向联动**
- 选择: L0=自动剖析（类型+统计+缺失+TOP+离群点）；L1=8 类图表拖拽 BI；L2/L3 后续按需。
- 理由: 用户需求是"能交互探索"，自动洞察文案和反向联动都需要更多设计；先把交互闭环跑通。
- 边界: L2 必须用纯算法（相关系数矩阵 / cramer's V / 类别×数值差异）；L3 单向：业务需求 → 跳转到探索（不带数据回 LLM）。

### 5. 技术/方案细节快照

**数据探索模块文件树**
```
web/src/lib/
  ├── duckdb.ts            duckdb-wasm 单例 + registerFile（csv/xlsx）+ runQuery
  └── profiling.ts         inferKind + profileTable（含 IQR/histogram/TOP10）

web/src/components/
  ├── DataExplorationPane.tsx                  主组件：红色安全条 + DndContext + 三栏
  └── data-exploration/
      ├── FileSelector.tsx    已登记路径列表（draw_data + clean_data）
      ├── FieldList.tsx       字段列表，每项 useDraggable
      ├── ConfigPanel.tsx     X/Y/颜色 drop slot + 聚合/筛选/粒度/Top N
      ├── ChartCanvas.tsx     8 类图表渲染 + SQL 构建
      └── ProfileReport.tsx   剖析报告 UI

server/src/index.ts
  └── GET /api/workspace-paths/:pathId/file-binary   纯二进制流，零 LLM
```

**关键约束（必读）**
- `DataExplorationPane.tsx` 及 `data-exploration/` 子树**禁止** import `web/src/lib/api.ts` 中任何 `chat*/generate*/extract*/clarify*/sink*/distill*` 方法
- 当前唯一允许的 api.ts 调用：`listWorkspacePaths/listSessionPaths/listFlowPaths/workspacePathTree`（路径元数据）
- server `/api/workspace-paths/:pathId/file-binary` 只接受 `folder ∈ {draw_data, clean_data}`，扩展名白名单 `.csv/.tsv/.xlsx/.xls`，文件大小硬上限 100MB
- duckdb 引擎单例懒加载，首次访问时从 jsDelivr CDN 拉 wasm bundle（1-2s 延迟），生产部署可考虑自托管
- xlsx 多 sheet 当前默认取第一个 sheet（`registerFile` 已预留 `sheets` 返回字段，UI 选择器未实现）

**8 类图表 + 聚合函数**
- 图表：`bar / line / area / scatter / heatmap / boxplot / pie / table`
- 聚合：`sum / avg / count / min / max / count_distinct`
- datetime X 轴自动支持粒度：`day / week / month / quarter / year`

**bundle 拆分（实测）**
```
dist/assets/index-*.js        1.9 MB   主 bundle（含 React/Tailwind/业务组件）
dist/assets/duckdb-*.js       205 KB   duckdb-wasm，懒加载
dist/assets/echarts-*.js      1.1 MB   echarts + echarts-for-react，懒加载
```

### 6. 未完成事项与下一步（Action Items）

- [ ] **真实 dev server smoke check** — P0
  - 步骤：①启动 `npm run dev`；②在 explore 或 multi tab 切到「数据探索」；③选一个 csv 文件；④拖字段到 X/Y/颜色；⑤切到「剖析报告」tab。
  - 完成标准：8 类图表都能渲染；剖析报告正确显示；首次 duckdb 加载有 loading 状态。
  - 阻塞风险：duckdb-wasm CDN 拉取可能失败（jsDelivr 国内速度）；多 sheet xlsx 默认取首 sheet 可能不是用户预期。

- [ ] **xlsx 多 sheet UI 选择器** — P1
  - 当前状态：`registerFile()` 已返回 `sheets: string[]`，但 UI 写死取 `sheets[0]`。
  - 完成标准：FileSelector 在 xlsx 文件下显示 sheet 下拉，选择后重新 register。

- [ ] **主 bundle 1.9MB 拆分** — P1
  - 加 `vite.config.ts` 的 `manualChunks`（拆 React/Radix/Tailwind/业务）。
  - 完成标准：首屏 bundle < 1MB。

- [ ] **Layer 2 自动洞察（纯算法）** — P2
  - 内容：相关性矩阵（Pearson/Spearman）、类别×数值差异（cramer's V/η²）、跨表 join 候选（列名+类型+取值重叠率）。
  - 硬约束：**不调 LLM**，全部本地算法 + 客观文案模板。

- [ ] **Layer 3 单向联动：业务需求 → 探索** — P2
  - 业务需求 tab 增加「打开数据探索」按钮，跳转时传入 fileId+预设字段，不带任何数据回 LLM。

### 7. 开放问题与待确认事项

- ❓ **duckdb-wasm 自托管 vs CDN**
  - 当前从 jsDelivr 拉，国内可能慢。
  - 待评估：是否把 `@duckdb/duckdb-wasm/dist/*` 放到 server 静态目录，由 `/api/static/duckdb/` 提供。

- ❓ **datetime 自动识别保守度**
  - 当前 `inferKind` 用前 N 行 sample 判断 ISO/常见格式。
  - 待确认：是否给用户手动改类型的 UI（覆盖自动推断）。

- ❓ **L2 自动洞察触发方式**
  - 自动跑 vs 手动按钮？数据量大时全跑相关性可能慢。
  - 倾向：手动按钮 + 进度条；数值列对超过 20 个时分页。

### 8. 重要陷阱

- **绝对不要**给 `DataExplorationPane` 子树加任何 LLM 链路；任何"AI 推荐图表/解读"功能都违反数据安全契约。
- AGENTS.md 是本项目首次出现的全局约定文件，所有未来 agent 启动**必须先读**。
- ChartCanvas.tsx 写入过程中曾因 edit 工具 oldString 匹配到首次出现位置导致文件结构破损，最终用 `head` + `cat` 重组修复；当前文件状态健康。
- duckdb-wasm 引擎是**全局单例**，切换文件时要先 `unregisterFile` 再 `registerFile`，否则旧数据残留。
- xlsx → duckdb 走的是 SheetJS 解析后再喂 duckdb，超大 xlsx（>50MB）可能 OOM；csv 直接走 duckdb 流式解析。
- 仓库存在大量他人 dirty changes，**不要**清理或回滚；本次改动只涉及上文列出的文件。

### 9. 下一个 Session 启动指令

> 先读 `AGENTS.md`（项目根，本 Session 新建，含数据安全分级）。
> 然后读本 Session 顶部「本次更新摘要」「关键决策与权衡」「重要陷阱」。
> 跑 `npm run typecheck` 和 `npm run build` 确认现状。
> 最紧迫：**真实 dev server smoke check**，选一个 csv/xlsx 走通"导入 → 拖字段 → 渲染图表 → 切剖析报告"完整链路，捕捉 duckdb CDN/多 sheet 等真实问题。
> **绝对不要**在数据探索模块加任何 LLM 调用，校验命令见 AGENTS.md「校验方式」一节。

---


---

## 📌 Session 17 — 2026-06-06

### 0. 本次更新摘要（Changelog）

**本次推进**: 延续 Session 16 的探索模块 Action Items，完成业务需求来源引用、业务需求 UI 交互验收、业务需求下游报告/数据 workflow 深化，并确认探索 tab 待开发项已清零。
**关键决策**: ①来源引用先落地“来源文档 + 字段级可校验 quote”的最小闭环；②业务需求上下文抽成前端共享 hook，供 Chat、报告版本、Golden Strategy 复用；③全局 `git diff --check` 的无关 trailing whitespace 项由用户明确跳过，不作为探索模块继续项。
**新增阻塞/问题**: 无探索模块硬阻塞；仓库仍有大量既有 modified/untracked 文件，且全局 diff check 仍可能被无关文件尾随空格阻塞。
**下一步重点**: 探索模块当前无必做待开发项；若继续推进，应先由用户指定新方向或切换到其他 handoff 模块。

### 1. 项目元信息

项目名称: 苍耳 pi-Xanthil（数据分析 AI 工作台）
项目类型: 代码开发
Session 编号: 第 17 次交接
本次 Session 起止: 从「Session 16 遗留来源引用、UI 验收、全局 diff check、下游 workflow 深化」推进到「除用户明确跳过的无关全局 diff check 外，探索模块 Action Items 全部完成并通过 typecheck/build」
最后更新: 2026-06-06

### 2. 项目目标（North Star）

延续 Session 16，无变化。探索模块继续服务于本地优先的数据分析 AI 工作台，让业务需求从前期资料、结构化框架、人工编辑、版本比对，进一步成为后续探索对话、报告版本和策略生成的显式上下文。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 业务需求来源文档展示 | ✅完成 | `server/src/index.ts`、`web/src/components/BusinessRequirementPane.tsx` | 生成 Markdown 与 UI 均展示本次使用的 source documents |
| 字段级来源引用/source refs | ✅完成 | `server/src/index.ts`、`BusinessRequirementPane.tsx` | LLM schema 增加 `sourceRefs`；服务端规范化/过滤 `D1/D2` 文档引用与 quote；Markdown/UI 展示字段来源引用 |
| 业务需求 UI 交互级验收 | ✅完成 | Playwright smoke、截图 `/tmp/pi-xanthil-ui-source-desktop.png`、`/tmp/pi-xanthil-ui-source-mobile.png` | 桌面与窄屏验证来源文档展示，无明显布局重叠 |
| 业务需求下游报告/数据 workflow 深化 | ✅完成 | `useBusinessRequirementContexts.ts`、`ChatPane.tsx`、`PresentationVersionPane.tsx`、`GoldenStrategyPane.tsx`、`web/src/lib/api.ts`、`server/src/index.ts` | 业务需求上下文可注入探索 Chat、报告版本生成、Golden Strategy 单/批量生成 prompt |
| 移动端侧栏布局修复 | ✅完成 | `web/src/App.tsx`、截图 `/tmp/pi-xanthil-sidebar-mobile.png` | 修复移动端 sidebar 占用主内容宽度导致横向溢出的问题，并通过 Playwright smoke |
| 全局 `git diff --check` | ⏭️跳过 | `handoff-规则记忆.md`、`server/src/index.ts` 既有无关尾随空格 | 用户明确“第 3 项不做”；不要为追求全局绿色主动改无关 handoff |
| 探索模块待开发项 | ✅清零 | `handoff-探索.md` | 2026-06-06 复核后确认无下一项 |

### 4. 关键决策与权衡 ⭐

**决策 28: source spans 首版采用字段级 `sourceRefs`，不做字符 offset 定位**
- 选择: 让 LLM 返回 `sourceRefs: Record<fieldPath, {documentId, quote}[]>`，服务端只接受白名单字段路径、有效文档编号和短 quote，再在 Markdown/UI 展示。
- 备选: 做精确字符 offset / range 定位；或只展示 source document metadata。
- 理由: docx/xlsx 转文本后 offset 容易失真，精确 span 成本高；仅 metadata 又无法解释字段依据。字段路径 + quote 是当前可校验、低侵入的折中。
- 影响范围: 业务需求 JSON schema、Markdown 渲染、结果 UI 字段来源面板。
- 可逆性: 中。

**决策 29: 业务需求上下文前端复用 hook，后端复用安全读取逻辑**
- 选择: 新增 `useBusinessRequirementContexts()` 扫描当前 scope report paths 与版本列表；Chat、报告版本、Golden Strategy 共享同一上下文选择模型。后端复用 `loadBusinessRequirementContextForChat()` 的路径校验和 Markdown 读取能力。
- 备选: 各 pane 各自扫描版本；或前端直接传完整 Markdown。
- 理由: 避免重复拉取/选择逻辑，也避免前端把长文档塞进请求和历史消息；服务端继续统一限制 `business_requirements/*.md`。
- 影响范围: `ChatPane`、`PresentationVersionPane`、`GoldenStrategyPane`、API payload、presentation/golden prompt 构建。
- 可逆性: 中。

**决策 30: 用户跳过的无关全局 diff check 不继续推进**
- 选择: 保持 `handoff-规则记忆.md` 等无关文件原状，只记录全局 diff check 可能仍非绿色。
- 备选: 顺手删除无关 trailing whitespace。
- 理由: 用户已明确第 3 项不做；仓库脏改动很多，按最小改动原则不改无关文件。
- 影响范围: 后续验证应优先报告相关文件 diff check/typecheck/build；不要把全局 diff check 失败误判为探索模块未完成。
- 可逆性: 高。

### 5. 技术/方案细节快照

- `server/src/index.ts`
  - `formatRequirementDocuments()` 给输入文档分配 `D1/D2/...` 标签。
  - `BusinessRequirementStructuredOutput` 增加 `sourceRefs?: Record<string, BusinessRequirementSourceRef[]>`。
  - `normalizeBusinessRequirementSourceRefs()` / `filterBusinessRequirementSourceRefs()` 限制字段路径、文档编号、quote 长度和每字段引用数量。
  - `renderBusinessRequirementMarkdown()` 输出“来源文档”和“字段来源引用”。
  - Presentation / Golden Strategy 生成链路新增 `businessRequirementContext`，在 prompt 中注入业务需求 Markdown，并保留“未确认问题不是事实”的约束。

- `web/src/components/useBusinessRequirementContexts.ts`
  - 扫描当前 workspace/session/flow scope 的 report paths，调用 `api.listBusinessRequirementVersions(path.id)`，输出 `contexts/selectedId/selectedContext/loading`。

- `web/src/components/ChatPane.tsx`
  - 已改为使用共享 hook，行为与 Session 16 的业务需求 Chat 上下文选择保持一致。

- `web/src/components/PresentationVersionPane.tsx` / `GoldenStrategyPane.tsx`
  - 新增业务需求上下文 select，并把 `{ pathId, markdownPath, jsonPath? }` 传给对应 API。

- `web/src/App.tsx`
  - 移动端 sidebar 拆成 fixed drawer + overlay，桌面保留普通 flex sidebar；Playwright 验证移动端主内容宽度 390、无横向溢出。

- 验证结果:
  - `npm run typecheck` ✅
  - `npm run build` ✅，仅 Vite large chunk warning。
  - `npm -w web run typecheck`、`node --experimental-strip-types --check server/src/index.ts` 在相关阶段均通过。
  - Playwright UI smoke ✅：业务需求来源展示桌面/移动端、移动端 sidebar 关闭/展开。
  - 全局 `git diff --check` 未作为完成标准继续推进；历史上会被无关 trailing whitespace 阻塞。

### 6. 未完成事项与下一步（Action Items）

当前探索模块无必做待开发项。

- [ ] **新探索方向确认** — 优先级 P2
  - 上下文: `handoff-探索.md` Session 16 的 P1/P2 Action Items 已完成，用户明确跳过全局 diff check。
  - 输入: 用户指定新的探索 tab 需求，或切换到其他模块 handoff（如工作流、AnaX、实验室、计算工具）。
  - 完成标准: 明确新的目标、完成标准和涉及文件后再执行。
  - 潜在难点: 当前仓库脏改动很多，新任务前需先确认是否与既有未跟踪组件冲突。

### 7. 开放问题与待确认事项

- ❓ 后续是否需要从字段级 quote 升级到精确 span / offset？
  - 当前倾向: 暂不升级；现有 `sourceRefs` 已满足可解释来源的最小闭环。
  - 阻塞了什么: 不阻塞当前探索模块。
  - 需要谁/什么来解决: 用户提出更高粒度需求，或真实文档验收发现 quote 不够用。

- ❓ 是否允许未来单独修复无关 trailing whitespace 以恢复全局 `git diff --check`？
  - 当前倾向: 本轮不修，因用户明确跳过第 3 项。
  - 阻塞了什么: 只阻塞全局 diff check 绿色，不阻塞探索功能。
  - 需要谁/什么来解决: 用户单独授权。

### 8. 上下文与约定

无变化，延续既有约定：默认中文回复；改前先读文件和 grep；最小改动；不要回滚脏工作区中非本任务改动；删除/覆盖/重命名前必须确认。当前仓库存在大量 modified/untracked 文件，后续 agent 必须把它们视为用户或其他 session 的工作成果。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。
> 探索模块当前无必做待开发项；不要继续寻找“下一项”而误改无关文件。
> 如果用户要求继续开发，请先让用户指定新方向，或载入其他模块 handoff。
> 注意全局 `git diff --check` 的失败可能来自用户已跳过的无关 trailing whitespace，不要主动修。

---

## 📌 Session 16（探索模块最新） — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 按 Session 15 优先级继续推进探索模块，完成全局路径状态刷新、业务需求真实 E2E smoke、Markdown 编辑后 JSON 失效策略、业务需求驱动探索对话，以及版本 Markdown diff。

**关键决策**:
1. 全局登记路径列表由后端实时附加文件系统状态，前端刷新目录树时重新读取，避免改名/删除后 UI 仍显示旧状态。
2. Markdown 人工编辑后不做反向结构化解析，改为显式标记 JSON stale，并禁止基于过期 JSON 沉淀业务环境。
3. 业务需求作为探索 Chat 的可选上下文注入，只把 Markdown 内容送入 pi 输入，不污染历史用户消息。

**新增阻塞/问题**: 字段级来源引用/source spans 尚未实现；全局 `git diff --check` 仍受既有无关文件 `handoff-规则记忆.md` 两处 trailing whitespace 影响。

**下一步重点**: 优先补齐业务需求文档来源引用的最小可用版本；之后可考虑 UI screenshot/交互级验收，或修复无关 handoff 文件尾随空格以恢复全局 diff check。

### 1. 项目元信息

项目名称: 苍耳 pi-Xanthil（数据分析 AI 工作台）
项目类型: 代码开发
Session 编号: 第 16 次交接
本次 Session 起止: 从「业务需求 tab 已实现但 P0/P1/P2 后续能力未闭环」推进到「路径刷新、E2E smoke、JSON stale、Chat 上下文注入、版本 diff 均已实现并通过 typecheck/build」
最后更新: 2026-06-05

### 2. 项目目标（North Star）

延续 Session 15，无变化。探索模块继续服务于本地优先的数据分析 AI 工作台；本 session 重点是让业务需求链路从“可生成”推进到“可验证、可编辑、可驱动后续分析对话，并能明确展示版本变化与 JSON 过期状态”。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 全局成果树/路径状态刷新 | ✅完成 | `server/src/index.ts`、`server/src/types.ts`、`web/src/types.ts`、`web/src/components/FolderPathsPane.tsx` | 路径列表返回 `exists/currentKind/size/mtime/status`；前端新增刷新按钮并重新拉取展开目录 |
| 业务需求真实 E2E smoke | ✅完成 | `server/src/index.ts`、临时 `/tmp` 数据目录 | md/docx/xlsx 预览、extract、clarify、generate、version、edit、tree、sink API 已跑通 |
| xlsx ESM 文件访问修复 | ✅完成 | `server/src/index.ts` | 启动时执行 `XLSX.set_fs({ readFileSync })`，解决 `XLSX.readFile()` 报 `Cannot access file` |
| 业务需求 generate timeout | ✅完成 | `server/src/index.ts` | LLM timeout 从 `180_000` 提高到 `300_000` |
| Markdown 编辑后 JSON stale | ✅完成 | `server/src/index.ts`、`web/src/components/BusinessRequirementPane.tsx`、`web/src/lib/api.ts` | 保存 Markdown 后写入 `markdownEditedAt/jsonStaleReason`；UI 标记“已编辑/JSON 已过期”，沉淀按钮禁用 |
| 业务需求驱动探索 Chat | ✅完成 | `server/src/types.ts`、`web/src/types.ts`、`web/src/App.tsx`、`web/src/components/ChatPane.tsx`、`server/src/index.ts` | Chat composer 可选择业务需求版本；服务端安全读取 `business_requirements/*.md` 并注入 pi 输入 |
| 版本 Markdown diff | ✅完成 | `web/src/components/BusinessRequirementPane.tsx` | 前端本地 LCS 行级 diff；当前版本可与上一版比较 |
| 字段级来源引用/source spans | ⏳待启动 | 业务需求文档 metadata / LLM schema 待设计 | 当前只保存 source document metadata，没有字段级片段定位 |

### 4. 关键决策与权衡 ⭐

**决策 24: 路径状态由列表 API 实时附加，不新增独立扫描任务**
- 选择: `GET /api/workspaces/:id/paths`、`/api/sessions/:id/paths`、`/api/flows/:id/paths` 返回登记路径时同步 `stat` 文件系统，附加 `ok/missing/kind_mismatch` 状态。
- 备选: 增加后台 watcher 或全量重建 artifacts cache（暂不做）。
- 理由: 用户反馈的改名/新增/删除问题首先需要 UI 能看到真实路径状态；实时 `stat` 改动小、可验证、不会引入后台进程生命周期复杂度。
- 影响范围: workspace/session/flow 三类 path API、`WorkspacePath` 类型、`FolderPathsPane` 展示和刷新行为。
- 可逆性: 高。

**决策 25: Markdown 编辑后标记 JSON 过期，而不是反向解析**
- 选择: `PUT /api/business-requirements/version` 保存 Markdown 后同步更新对应 `.json` 的 `version.markdownEditedAt` 与 `version.jsonStaleReason`；前端阻止基于 stale JSON 沉淀业务环境。
- 备选: 从 Markdown 反向解析为结构化 JSON；或继续静默保留旧 JSON（均否决）。
- 理由: 反向解析会把格式自由度变成数据一致性风险；静默保留旧 JSON 会误导用户。stale 标记能明确表达“可读稿已改、结构化稿未同步”的事实。
- 影响范围: 版本列表、版本读取、保存提示、沉淀按钮与沉淀 API 调用前检查。
- 可逆性: 高。

**决策 26: 业务需求上下文只注入本轮 pi 输入，不写入用户历史消息**
- 选择: Chat composer 选择业务需求版本后，客户端只传 `{ pathId, markdownPath, jsonPath }` 引用；服务端读取 Markdown 并拼接到 `textForPi`，但 `addMessage()` 仍保存用户原始输入。
- 备选: 前端把完整 Markdown 拼进用户消息；或把业务需求自动沉淀到长期 memory 后再注入。
- 理由: 保持历史消息可读且不重复存储长文档；同时避免把未确认 openQuestions 当成长期事实。服务端校验路径可减少任意文件读取风险。
- 影响范围: `ClientMessage` 类型、`ChatPane` composer、`App` gateway、`handleSend()`。
- 可逆性: 中。

**决策 27: 版本 diff 首版放在前端做 Markdown 行级 diff**
- 选择: `BusinessRequirementPane.tsx` 内用 LCS 做行级 diff，比较当前版本与上一版 Markdown。
- 备选: 新增后端 diff API；或做结构化字段级 diff。
- 理由: P2 需求先解决“能看版本变化”；Markdown diff 不改变存储结构，落地快。字段级 diff 与 source spans 可以在后续统一设计。
- 影响范围: 仅业务需求结果区 tab 和按钮。
- 可逆性: 高。

### 5. 技术/方案细节快照

- `server/src/index.ts`
  - 新增 `withWorkspacePathStatus()` / `withWorkspacePathStatuses()`；三类 paths API 均返回真实文件状态。
  - `XLSX.set_fs({ readFileSync })` 修复 xlsx ESM 环境读取文件失败。
  - 业务需求 generate LLM timeout 调整为 `300_000`。
  - `BusinessRequirementVersionMetadata` 增加 `markdownEditedAt?: number`、`jsonStaleReason?: string`；版本列表暴露 `jsonStale`。
  - 新增 `loadBusinessRequirementContextForChat(ref)`，只允许读取 report 输出目录下 `business_requirements/*.md`，最多注入 40,000 字符。

- `web/src/components/FolderPathsPane.tsx`
  - 路径面板新增“刷新路径和文件树”按钮。
  - 展开目录时重新读取 tree；刷新时对已展开目录重新拉取；删除路径时清理 `trees/treeErrors/preview`。
  - `missing` 与 `kind_mismatch` 有 UI 状态提示。

- `web/src/components/BusinessRequirementPane.tsx`
  - 保存 Markdown 后本地立即标记 stale，展示“JSON 已过期”提示。
  - stale 时禁用“沉淀业务环境”，并在调用前再次检查。
  - 新增 `buildLineDiff(previous, current)` 与“版本差异”结果 tab。

- `web/src/components/ChatPane.tsx` / `web/src/App.tsx`
  - `ChatPane` 根据当前 workspace/session/flow 的 report paths 加载 business requirement versions。
  - composer select 展示 `projectName · generatedAt`，stale 版本带“已编辑”标识。
  - `onSend` 第三个参数传业务需求上下文引用。

- 为恢复全仓 typecheck，顺手修了既有脏改动中的类型问题:
  - `server/src/db.ts` 补 `SkillCurationProposalRecord` import。
  - `web/src/components/SkillLabPane.tsx` 删除未渲染 queue 相关 unused state/function/import。
  - 注意这些文件当时已有 modified/untracked 状态，后续不要误当成可回滚的纯本 session 新文件。

- 验证结果:
  - `npm run typecheck` ✅
  - `npm run build` ✅，仅 Vite large chunk warning。
  - 本轮相关文件 `git diff --check` ✅
  - 全局 `git diff --check` ⚠️，失败点是既有无关文件 `handoff-规则记忆.md:9`、`:15` trailing whitespace。
  - API smoke ✅：登记 report dir、tree 新文件刷新、改名后 `status:"missing"`、md/docx/xlsx preview、extract、clarify、generate、versions、version get/put、sink 均已验证。

### 6. 未完成事项与下一步（Action Items）

- [ ] **业务需求来源引用/source spans 最小实现** — 优先级 P1
  - 上下文: Session 15 的“版本 diff 与来源引用”中 diff 已完成，但来源引用仍未做。当前 `sourceDocuments` 只有文档 metadata，没有字段级来源。
  - 输入: `server/src/index.ts` 的业务需求 LLM schema、`BusinessRequirementPane.tsx` 的结果区、已保存 `.json` 的 `sourceDocuments`。
  - 完成标准: 至少在生成 Markdown 和 UI 中列出本次使用的来源文档；若继续做字段级 spans，则草稿字段能显示来自哪个文档/片段。
  - 潜在难点: 字段级 span 需要让 LLM 返回可校验引用，且要处理截断文档和 docx/xlsx 转文本后的定位误差。

- [ ] **业务需求 UI 交互级验收** — 优先级 P1
  - 上下文: 已有 API smoke、typecheck、build，但未用浏览器截图验证新 select、stale 提示、diff tab 和路径刷新按钮的实际布局。
  - 输入: 一个可用 dev server、至少两个业务需求版本、一个 stale 版本。
  - 完成标准: 桌面和窄屏下无文字重叠；选择业务需求后 Chat 可发送；diff tab 可读；stale 提示和禁用状态明确。
  - 潜在难点: 当前工作区 UI 文件改动很多，截图问题可能来自其他未提交改动。

- [ ] **恢复全局 `git diff --check`** — 优先级 P2
  - 上下文: 业务相关文件 diff check 已通过，但全局检查被 `handoff-规则记忆.md` 尾随空格挡住。
  - 输入: 用户允许修改无关 handoff 文件。
  - 完成标准: 全局 `git diff --check` 通过。
  - 潜在难点: 这是无关文件，按最小改动原则最好先确认再修。

- [ ] **业务需求下游报告/数据工作流深化** — 优先级 P2
  - 上下文: 现在业务需求已能注入探索 Chat，但尚未直接驱动原始数据、聚合数据、报告输出等 tab 的专用 prompt。
  - 输入: 明确哪些 JSON 字段应进入各下游 workflow；是否排除 openQuestions。
  - 完成标准: 业务需求能作为后续数据处理和报告生成的显式上下文输入，并保留“未确认问题不是事实”的约束。
  - 潜在难点: 不同 tab 的 prompt 注入点不同，需避免重复注入和 token 过量。

### 7. 开放问题与待确认事项

- ❓ source spans 要做到什么粒度？
  - 当前倾向: 先做最小来源文档引用，再评估字段级 spans。
  - 阻塞了什么: 是否需要修改 LLM schema、JSON 存储结构和 UI 字段展示。
  - 需要谁/什么来解决: 用户确认期望粒度，或先落地最小实现。

- ❓ 是否允许修 `handoff-规则记忆.md` 的尾随空格？
  - 当前倾向: 不主动改无关文件；如果用户只想恢复全局校验，可以删除两处 trailing whitespace。
  - 阻塞了什么: 全局 `git diff --check` 绿色结果。
  - 需要谁/什么来解决: 用户授权。

### 8. 上下文与约定

无变化，延续既有约定：默认中文回复；修改前读文件和 grep；保持最小改动；不要回滚脏工作区中非本任务改动。当前仓库存在大量 modified/untracked 文件，后续 agent 必须把它们视为用户/其他 session 的工作成果，除非用户明确要求，否则不要清理或回滚。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」和「未完成事项」。
> 当前最紧迫的是补齐业务需求来源引用/source spans；如果范围不明确，先做最小来源文档引用，不要直接大改 LLM schema。
> 注意 `BusinessRequirementPane.tsx`、`ChatPane.tsx`、`server/src/index.ts` 都已有本 session 逻辑，继续前先 grep 现有函数和类型。
> 全局 `git diff --check` 的失败来自无关 `handoff-规则记忆.md` 尾随空格；未获确认前不要为追求绿色而改它。

---

## 📌 Session 15（探索模块最新） — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 探索模块新增并基本闭环「业务需求」二级 tab，用于数据分析项目前期业务需求沟通、导入需求调研文档、抽取需求草稿、生成澄清问题、转译为数据分析需求并输出可编辑分析框架。

**关键决策**:
1. 「业务需求」放在「业务环境」之前，定位为业务沟通与需求转译入口，不替代业务环境 memory。
2. 导入文档首版支持 `md/txt/csv/docx/xlsx/xls`，本地解析后送入本地 pi/LLM 链路，不新增第三方云服务。
3. 分析框架输出 Markdown + JSON 双产物；人工编辑当前只保存 Markdown，JSON 保留生成时结构化版本。

**新增阻塞/问题**: 业务需求模块已通过 typecheck / build / diff check，但尚未用真实会议纪要、docx、xlsx 做完整端到端验收；全局成果树/路径缓存刷新问题仍未系统修复。

**下一步重点**: 优先修复全局成果树/路径刷新机制；随后做业务需求模块真实 E2E 验收，并决定人工编辑 Markdown 后是否需要同步/失效 JSON。

### 1. 项目元信息

项目名称: 苍耳 pi-Xanthil（数据分析 AI 工作台）
项目类型: 代码开发
Session 编号: 第 15 次交接
本次 Session 起止: 从「只有工作视图、业务环境、原始数据、聚合数据、报告输出等 tab，缺少前期业务需求沟通入口」推进到「业务需求 tab 可导入文档、提取草稿、生成澄清问题与分析框架、版本管理、编辑保存、沉淀业务环境」
最后更新: 2026-06-05

### 2. 项目目标（North Star）

延续 Session 14，无变化。探索模块仍围绕“本地优先的数据分析 AI 工作台”推进；本 session 新增的业务需求模块强化前期需求沟通能力，让用户能在正式数据处理前把业务语言转译成可执行的数据分析需求、分析路径和后续上下文。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 业务需求 tab | ✅完成 | `web/src/lib/constants.ts`、`web/src/App.tsx`、`web/src/components/BusinessRequirementPane.tsx` | 位于「业务环境」之前；explore / multi 均挂载 |
| 需求文档导入 | ✅完成 | `BusinessRequirementPane.tsx`、`POST /api/business-requirements/documents/preview` | 支持登记路径与本地文件；类型支持 `md/txt/csv/docx/xlsx/xls` |
| 文档解析依赖 | ✅完成 | `server/package.json`、`package-lock.json` | 新增 `mammoth` 解析 docx、`xlsx` 解析 Excel |
| 需求草稿提取 | ✅完成 | `POST /api/business-requirements/extract` | 从导入文档抽取表单字段；默认只填空字段，可勾选覆盖已填 |
| 澄清问题生成 | ✅完成 | `POST /api/business-requirements/clarify` | 生成 P0/P1/P2 需求追问表 |
| 分析框架生成 | ✅完成 | `POST /api/business-requirements/generate` | 结构化 JSON + Markdown 输出到 `business_requirements/` |
| 版本管理 | ✅完成 | `GET /api/business-requirements/versions`、`GET /api/business-requirements/version` | 可打开历史版本 |
| Markdown 编辑保存 | ✅完成 | `PUT /api/business-requirements/version` | 只允许写 `business_requirements/*.md`，不会改 JSON |
| 沉淀业务环境 | ✅完成 | `api.createBusinessContext()` | 将事实/目标/指标数据需求/风险沉淀到 business context |
| 需求质量检查 | ✅完成 | `BusinessRequirementPane.tsx` | 7 类要素完整度提示：项目识别、目标问题、决策场景、使用对象、可用数据、限制风险、输出偏好 |
| 刷新/路径 bug 修复 | ✅完成 | `BusinessRequirementPane.tsx`、`server/src/index.ts` | 修复 tab 无限刷新；修复旧目录 `/聚合数据/0-小红书/` ENOENT 报错 |
| 真实 E2E 验收 | ⏳待启动 | — | 需用真实会议纪要、docx、xlsx 跑完整链路 |
| 全局成果树/路径缓存刷新 | ⏳待启动 | artifacts/tree、workspace paths 相关 API 待查 | 用户反馈项目文件夹改名、聚合数据新增文件夹后 UI 不更新；本 session 仅修业务需求局部 stale 文档 |

### 4. 关键决策与权衡 ⭐

**决策 20: 「业务需求」作为业务环境之前的独立二级 tab**
- 选择: 在 `SUB_TABS` 中新增 `business_requirement`，位置在 `business_context` 之前。
- 备选: 把需求录入直接放进「业务环境」tab（否决）。
- 理由: 业务需求是分析项目前期沟通与转译过程，业务环境是沉淀后的长期上下文。两者生命周期不同，拆开能避免把未确认会议纪要直接污染 memory。
- 影响范围: 导航、token 统计标签、App pane 挂载、业务环境联动。
- 可逆性: 中。

**决策 21: 导入需求文档走本地解析 + 当前模型提取，不引入云文档服务**
- 选择: 后端本地读取登记路径/本地文件；docx 用 `mammoth`，xlsx/xls 用 `xlsx` 转文本；再交给当前 pi/LLM 生成草稿、澄清问题和框架。
- 备选: 只允许手填；或接第三方 OCR/文档理解 API（暂不做）。
- 理由: 用户明确会议纪要/调研文档可能直接导入；项目约定本地部署优先，隐私数据不走第三方 API。
- 影响范围: `server/package.json` 新依赖、文档大小限制、路径安全检查、预览/提取/生成 API。
- 可逆性: 中。

**决策 22: 生成结果双产物，人工编辑只保存 Markdown**
- 选择: 生成时写 `.md` 与 `.json`；历史版本以 JSON metadata 列表为准；用户编辑分析框架时只更新 Markdown。
- 备选: Markdown 编辑后反向解析并更新 JSON（暂不做）。
- 理由: 反向解析 Markdown 到结构化 JSON 容易丢字段或误解析，P0 先保证用户可读稿件可修订。JSON 是否失效需要后续显式策略。
- 影响范围: `PUT /api/business-requirements/version`、沉淀业务环境仍基于当前打开的结构化 JSON。
- 可逆性: 高。

**决策 23: 局部修复业务需求 stale 路径，不顺手重构全局 artifact cache**
- 选择: 业务需求扫描后自动剔除已不存在的 workspace 文档；后端对不存在/目录项给出清晰错误。
- 备选: 本 session 直接重写全局成果树缓存/刷新机制（未做）。
- 理由: 用户当场遇到业务需求报错，需要先止血；全局刷新牵涉 artifacts/tree、workspace path、session/flow scope，应单独定位。
- 影响范围: 当前只保证业务需求导入文档链路更稳，不代表全部 tab 已解决改名/新增目录不刷新问题。
- 可逆性: 高。

### 5. 技术/方案细节快照

- 前端关键文件:
  - `web/src/components/BusinessRequirementPane.tsx`
    - 新组件，包含需求模板、文档导入/预览、草稿提取、质量检查、表单、澄清问题、分析框架、版本打开、Markdown 编辑保存、沉淀业务环境。
    - 注意已修复一次无限刷新：`loadPaths` 不能依赖 `selectedPathId`，版本加载交给 `selectedPath` effect。
    - 重新扫描 `documentOptions` 后会清理 stale workspace 文档，避免旧路径继续参与生成。
  - `web/src/lib/api.ts`
    - 新增业务需求相关 API client：generate、preview、extract、clarify、versions、version get/put。
  - `web/src/App.tsx`
    - explore / multi 两处挂载 `BusinessRequirementPane`，`onGenerated` 刷新成果，`onBusinessContextChanged` 刷新 memory 注入提示。
  - `web/src/lib/constants.ts`、`web/src/types.ts`、`web/src/components/TokenStatsPane.tsx`
    - 新增 `business_requirement` tab / 类型 / token 标签。

- 后端关键文件:
  - `server/src/index.ts`
    - `DEFAULT_BUSINESS_REQUIREMENT_MODEL`
    - `BusinessRequirementInput`、`BusinessRequirementStructuredOutput`、版本 metadata、文档 source/metadata 类型。
    - `loadRequirementDocuments()` 对 clean_data/report 登记路径、本地文件做解析；限制最多 8 个文档、单文件 50MB、内容 80k chars。
    - `extractBusinessRequirementDraftWithLlm()`：从会议纪要/文档抽取表单字段。
    - `generateBusinessRequirementClarifyingQuestionsWithLlm()`：生成澄清问题 JSON，再渲染 Markdown。
    - `generateBusinessRequirementWithLlm()`：生成结构化业务需求/分析框架 JSON，再渲染 Markdown。
    - `resolveBusinessRequirementOutputDir()`：只允许 report 路径作为输出目录。
    - `PUT /api/business-requirements/version`：只允许写 `business_requirements/*.md`。
  - `server/package.json`、`package-lock.json`
    - 新增 `mammoth`、`xlsx`。

- 已修 bug:
  - 无限刷新: `loadPaths` 内部更新 `selectedPathId`，但 `loadPaths` 又依赖 `selectedPathId`，导致 `useEffect([loadPaths])` 循环。已移除该依赖。
  - `ENOENT stat '/.../聚合数据/0-小红书/'`: 旧登记目录残留被当需求文档读取。已在前端清 stale 文档、后端 `existsSync/isFile` 防护。

- 验证结果:
  - 多次执行 `npm run typecheck` ✅
  - 多次执行 `npm run build` ✅
  - 多次执行 `git diff --check` ✅
  - build 仍只有 Vite 既有 large chunk warning。

### 6. 未完成事项与下一步（Action Items）

- [ ] **全局成果树/路径缓存刷新机制修复** — 优先级 P0
  - 上下文: 用户反馈项目文件夹名称改了、聚合数据新增文件夹和文档，但界面没有变化，重启服务无效。本 session 仅局部处理业务需求文档 stale 状态。
  - 输入: 需要排查 artifacts tree、workspace paths、session/flow scope、文件 hash/cache 相关 API 与前端刷新触发。
  - 完成标准: 改名/新增/删除聚合数据或报告输出文件后，UI 刷新能看到真实文件树；业务需求、聚合数据、报告输出、成果区一致。
  - 潜在难点: 可能有 DB 登记路径与真实文件系统路径分离、artifact tree 缓存、前端状态复用多处叠加。

- [ ] **业务需求真实 E2E 验收** — 优先级 P0
  - 上下文: 功能已编码通过构建，但尚未用真实会议纪要/调研文档跑完整链路。
  - 输入: 至少一份真实 md/txt、docx、xlsx；一个 report 输出目录；可用模型。
  - 完成标准: 导入 → 预览 → 提取草稿 → 澄清问题 → 生成分析框架 → 编辑保存 → 打开历史版本 → 沉淀业务环境 → 成果树刷新，全部可用。
  - 潜在难点: docx/xlsx 解析文本质量、LLM JSON repair 成功率、真实长文档截断策略。

- [ ] **Markdown 编辑后 JSON 同步/失效策略** — 优先级 P1
  - 上下文: 当前编辑保存只更新 `.md`，结构化 `.json` 保持生成时状态；沉淀业务环境仍基于 JSON。
  - 输入: 用户确认希望“编辑后同步 JSON”“编辑后标记 JSON 过期”“沉淀时基于 Markdown 再解析”哪一种。
  - 完成标准: UI 明确提示 JSON 状态；沉淀行为不再让用户误以为基于最新人工稿。
  - 潜在难点: Markdown 反向结构化可能不稳定，需要设计失败回退。

- [ ] **业务需求驱动后续数据/报告工作流** — 优先级 P1
  - 上下文: 目前业务需求可沉淀到业务环境，但尚未直接驱动原始数据、聚合数据、报告输出 prompt 或黄金策。
  - 输入: 确定业务需求 JSON 中哪些字段应进入下游 prompt / data requirements。
  - 完成标准: 用户生成的业务需求能一键作为后续数据分析对话或报告生成上下文输入。
  - 潜在难点: 避免把未确认 openQuestions 当成事实注入。

- [ ] **版本 diff 与来源引用** — 优先级 P2
  - 上下文: 历史版本可打开，但不能比较；提取草稿没有显示字段来源。
  - 输入: 需要确定是否做简单 Markdown diff，还是字段级 diff；是否保存 source spans。
  - 完成标准: 能比较两个版本差异；草稿字段能追溯来自哪个文档/段落。
  - 潜在难点: 当前没有保存文档原文片段定位 metadata。

### 7. 开放问题与待确认事项

- ❓ 用户是否接受“人工编辑 Markdown 后 JSON 不同步”的短期行为？
  - 当前倾向: P1 做明确提示或失效标记，不立即做反向解析。
  - 阻塞了什么: 沉淀业务环境和下游联动是否应该使用最新人工稿。
  - 需要谁/什么来解决: 用户决策 + 一次真实 E2E 后评估。

- ❓ 全局路径刷新问题的根因在前端 state、后端 tree/cache，还是 DB 登记路径？
  - 当前倾向: 先从 artifacts/tree 和 workspacePathTree API 入手，用真实改名/新增目录复现。
  - 阻塞了什么: 所有依赖文件树的 tab 的可靠性。
  - 需要谁/什么来解决: 本地复现和代码排查。

### 8. 上下文与约定

- 用户明确：业务需求模块的目的不是普通表单，而是“数据分析项目前期业务需求沟通，并将业务需求转化为数据分析需求，输出分析框架”。
- 用户明确：需求调研不一定手工填写，可能导入会议纪要/需求文档作为需求文档。
- 默认继续遵守项目 AGENTS 约定：中文回复；改前先读；最小改动；涉及删除/覆盖/重命名需确认；不安装未确认依赖。本 session 中 `mammoth`/`xlsx` 已作为用户确认后的功能依赖进入项目。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。
> 当前最紧迫的是 P0：全局成果树/路径缓存刷新机制修复。用户已经明确遇到“文件夹改名、新增聚合数据文件夹和文档后 UI 不变，重启服务也无效”。
> 注意不要把业务需求局部 stale 文档修复误认为全局问题已解决；需要重新复现并排查 artifacts/tree、workspacePathTree、DB 登记路径和前端刷新触发。
> 若继续业务需求功能，优先做真实 E2E 验收，再决定 Markdown 编辑后 JSON 同步/失效策略。

---

## 📌 Session 14（探索模块最新） — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 探索模块把「决策树」「TOC」两个独立 tab 合并升级为「黄金策」tab，支持对已生成报告进行 10 种商业分析模型的图示化模拟分析，并新增报告规则推荐与最多 3 个模型并行生成。

**关键决策**:
1. 「黄金策」替代「决策树」「TOC」导航，保留旧 API / 旧 pane 文件兼容，不删除历史代码。
2. 10 种模型为：决策树、TOC、SWOT、PESTEL、Porter 五力、价值链、BCG、Ansoff、4P、商业模式画布。
3. 推荐逻辑首版采用前端本地规则评分，不新增 LLM 调用；多选上限固定为 3，后端 batch API 也做同样限制。

**新增阻塞/问题**: 黄金策已通过 typecheck / build / diff check，但尚未用真实长报告反复回归模型推荐质量、并行生成成功率和产物视觉质量。

**下一步重点**: 用真实报告回归黄金策；继续评估是否需要把规则推荐升级为 LLM 推荐或受控模型元数据配置。

### 1. 项目元信息

项目名称: 苍耳 pi-Xanthil（数据分析 AI 工作台）
项目类型: 代码开发
Session 编号: 第 14 次交接
本次 Session 起止: 从「决策树 / TOC 分散在独立 tab，黄金策尚不存在」推进到「黄金策统一 10 模型、支持推荐与最多 3 模型并行生成」
最后更新: 2026-06-05

### 2. 项目目标（North Star）

延续 Session 13，无变化。探索模块继续围绕“基于本地 pi 的数据分析 AI 工作台”推进，重点是让已生成报告能被二次提炼、结构化诊断、图示化表达，并安全落盘到受控报告输出目录。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 黄金策 tab | ✅完成 | `web/src/components/GoldenStrategyPane.tsx`、`web/src/lib/constants.ts`、`web/src/App.tsx` | 「决策树」「TOC」从导航移除，统一进入「黄金策」 |
| 10 种分析模型 | ✅完成 | `server/src/index.ts`、`web/src/types.ts` | 每个模型有 allowed / required node kind、schema 示例、专家角色和 prompt 目标 |
| 报告规则推荐 | ✅完成 | `GoldenStrategyPane.tsx` | 基于报告名 + 报告前 8000 字符关键词评分，推荐 3 个模型并显示理由 |
| 多选与并行生成 | ✅完成 | `POST /api/golden-strategy/generate-batch` | 前后端均限制最多 3 个模型；后端 `Promise.allSettled` 并行，单个失败不拖垮全部 |
| 成果落盘与刷新 | ✅完成 | `golden_strategy/*.html`、`onGenerated()` | session 写入解析后的报告输出目录；flow-run 写入 run 输出目录 |
| 真实样本回归 | ⏳待启动 | — | 尚未用多份真实长报告验证推荐质量、JSON repair 成功率和 HTML 可读性 |

### 4. 关键决策与权衡 ⭐

**决策 17: 「黄金策」统一承载决策树、TOC 与 8 个经典模型**
- 选择: 新增 `golden_strategy` 子 tab，导航只显示「黄金策」；旧 `decision_tree` / `toc` 类型、pane 和 API 保留兼容。
- 备选: 继续保留决策树 / TOC tab，并新增黄金策作为第三个入口（被否决）。
- 理由: 用户目标是减少分散入口，黄金策应成为报告二次分析的统一工作台。
- 影响范围: `SUB_TABS`、`App.tsx`、`GoldenStrategyPane.tsx`、`server/src/index.ts`。
- 可逆性: 中。

**决策 18: 推荐逻辑首版本地规则化，不调用 LLM**
- 选择: 用报告名 + 报告前 8000 字符进行关键词评分，推荐 3 个模型并给出命中理由。
- 备选: 每次选报告都调用 LLM 生成推荐（暂不做）。
- 理由: 推荐是辅助入口，不应增加额外等待、token 成本和 JSON repair 风险；规则版足够轻量可控。
- 影响范围: 推荐质量依赖关键词覆盖，后续可演进为可配置规则或 LLM 推荐。
- 可逆性: 高。

**决策 19: 多模型并行上限为 3**
- 选择: 前端多选最多 3 个，后端 batch API 也拒绝超过 3 个模型。
- 备选: 允许一次选满 10 个（被否决）。
- 理由: 并行 LLM 调用会增加成本、耗时和 provider 压力；3 个模型与“推荐 3 个”一致，用户已确认该上限。
- 影响范围: `MAX_SELECTED_MODELS = 3`、`MAX_GOLDEN_STRATEGY_BATCH_MODELS = 3`。
- 可逆性: 高。

### 5. 技术/方案细节快照

- 前端新增 / 关键改动:
  - `web/src/components/GoldenStrategyPane.tsx`
    - 扫描报告、读取报告内容；
    - `recommendAnalysisModels()` 基于关键词推荐 3 个模型；
    - `selectedAnalysisModels` 管理最多 3 个多选；
    - 调用 `api.generateGoldenStrategyBatch()`；
    - 多结果按模型按钮切换 ReactFlow 画布。
  - `web/src/lib/constants.ts`
    - `SUB_TABS` 中移除对用户可见的 `decision_tree` / `toc`，新增 `golden_strategy`。
  - `web/src/App.tsx`
    - explore / multi 均挂载 `GoldenStrategyPane`，生成成功后刷新成果中心。
  - `web/src/lib/api.ts`、`web/src/types.ts`
    - 新增 `GoldenStrategyBatchResult`、`GoldenStrategyError`、`generateGoldenStrategyBatch()`。

- 后端新增 / 关键改动:
  - `server/src/index.ts`
    - `GOLDEN_STRATEGY_MODELS`: 10 个模型定义，含 `allowedKinds`、`requiredKinds`、`schemaExample`、`objective`；
    - `generateGoldenStrategyWithLlm()`: 统一 LLM 结构化生成 + repair；
    - `generateGoldenStrategyHtml()`: 后端根据 nodes 生成自包含 HTML；
    - `generateGoldenStrategyArtifact()`: 单个模型生成并落盘；
    - `POST /api/golden-strategy/generate-batch`: 最多 3 个模型并行，返回 `{ results, errors }`。

- 验证结果:
  - `npm run typecheck` ✅
  - `npm run build` ✅（仅保留 Vite bundle > 500 kB warning）
  - `git diff --check` ✅
  - 本地服务验证：后端 health OK；batch API 空请求返回预期 `path required`；前端 Vite 可访问。

### 6. 未完成事项与下一步（Action Items）

- [ ] **黄金策真实报告回归** — P1
  - 上下文: 当前只做了类型、构建和路由级验证，尚未用真实报告跑 10 模型 / 3 并行组合。
  - 输入: 多份已生成 Markdown / text 报告，覆盖战略、营销、增长、运营、行业竞争等场景。
  - 完成标准: 推荐 3 模型大体合理；并行生成成功落盘；失败项能单独展示；成果中心能刷新到 `golden_strategy/*.html`。
  - 潜在难点: 模型 JSON 输出仍可能失败，repair 成功率需观察。

- [ ] **推荐规则质量增强** — P2
  - 上下文: 当前关键词规则写在前端组件里，适合首版但可维护性一般。
  - 输入: 真实使用中收集误推荐样本。
  - 完成标准: 规则抽离为独立配置 / helper；每个模型关键词和推荐理由更稳定；必要时再评估 LLM 推荐。

- [ ] **黄金策图示视觉与导出优化** — P2
  - 上下文: HTML 由后端模板生成，ReactFlow 画布与 HTML 模板都可用但未做移动端/长节点专项调优。
  - 输入: 真实生成的多个 HTML 产物。
  - 完成标准: 长标题/长 body 不溢出；不同模型视觉区分明确；成果中心预览可读。

- [ ] **接入 tool 级文件权限扩展或 OS sandbox** — P0 安全加固
  - 上下文: 延续 Session 12/13，成果 API 和黄金策路径限制不等价于 pi tool 权限限制。
  - 完成标准: 原始数据目录无法被 pi 工具读取；写操作只能落在解析后的报告输出目录；bash 受到命令与 cwd 限制。

### 7. 开放问题与待确认事项

- ❓ **推荐逻辑是否需要 LLM 化**
  - 当前倾向: 先保持本地规则推荐，真实样本证明不够时再升级。
  - 阻塞了什么: 不阻塞黄金策使用，只影响推荐准确性上限。
  - 需要谁/什么解决: 真实使用反馈与误推荐样本。

- ❓ **多模型并行是否需要队列 / 并发控制器**
  - 当前倾向: 先用最多 3 个 + `Promise.allSettled`，暂不引入队列。
  - 阻塞了什么: 不阻塞当前功能；如果 provider 压力或超时明显，再加全局并发限制。
  - 需要谁/什么解决: 真实并行生成耗时和失败率数据。

### 8. 上下文与约定

无变化，延续既有约定：中文回答、代码英文、最小改动、证据优先、删除/覆盖前确认；当前 worktree 有大量并行 dirty changes，不要回滚未确认内容。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」「关键决策与权衡」「未完成事项」三节。
> 当前最紧迫的是用真实长报告回归「黄金策」：验证推荐 3 模型是否合理、batch 并行是否稳定、HTML 图示是否可读、成果中心是否刷新。
> 注意多选上限已被用户确认固定为 3；不要擅自改成 10。
> 安全加固仍是 P0：黄金策和成果 API 的路径限制不能替代 pi tool 级文件权限 / sandbox。

---

## 📌 Session 13（探索模块最新） — 2026-06-04

### 0. 本次更新摘要（Changelog）

**本次推进**: 探索模块新增「汇报版本」tab，把本任务报告产物二次提炼为可沟通的简版 Markdown，并同步生成图文故事线 HTML；同时移除「决策树」「TOC」tab 的报告正文预览侧栏，让推理图画布占满主区域。

1）**新增「汇报版本」tab** ✅ — 在「报告输出」后新增「汇报版本」。用户可从已登记的报告输出路径中选择 Markdown / text 报告，填写自由 prompt，调用大模型生成简化汇报稿。

2）**汇报稿与故事线同次生成** ✅ — 后端 `POST /api/report-versions/generate` 基于原详细报告 + 用户 prompt 同次生成：
   - Markdown 汇报稿：`presentation_versions/*-汇报版本-*.md`
   - HTML 故事线：`presentation_versions/*-故事线-*.html`
   前端结果区提供「汇报版本 / 故事线」切换；故事线使用 sandboxed `iframe srcDoc` 预览。

3）**故事线 HTML 约束** ✅ — 故事线要求为完整自包含 HTML 文档，禁止外链资源、远程字体、外链图片和 script；后端会移除 `<script>` 与 inline event handler，再保存到报告输出目录。

4）**LLM JSON repair 回退** ✅ — 初版要求模型直接返回严格 JSON，真实调用出现 `LLM response is not valid JSON`。现已增加 repair 回退：首次解析失败时，使用原始模型输出 + 原报告内容 + schema 再调用一次 JSON 修复，修复后重新校验 `presentationMarkdown` 与 `storylineHtml`。

5）**决策树 / TOC 去除报告预览侧栏** ✅ — `DecisionTreePane` 和 `TocPane` 不再显示左侧「报告内容预览」模块；报告内容仍在后台读取用于生成，主区域只展示决策树或 TOC 推理图。

6）**生成结果刷新成果中心** ✅ — 汇报版本生成成功后触发 `artifactRefreshKey`，右侧「成果」中心可刷新到新生成的 Markdown / HTML 文件。

**验证结果**:
- `npm run typecheck` ✅
- `npm run build` ✅（仅保留 Vite bundle 超过 500 kB 的 warning）
- `git diff --check` ✅

### 1. 当前架构快照

```text
探索模块子 tab
├── 工作视图：任务对话 + context 工具栏 + 沉淀为工作流
├── 报告输出：登记输出路径，影响统一 output policy
├── 汇报版本：选择报告 → prompt 提炼 → Markdown 汇报稿 + HTML 故事线
├── 决策树：选择报告 → LLM 生成推理图，画布全宽展示
└── TOC：选择报告 → LLM 生成约束推理图，画布全宽展示

汇报版本生成链路
├── 前端：PresentationVersionPane
│   ├── 扫描 report 路径内的 Markdown / text 报告
│   ├── 自由 prompt
│   └── 结果切换：Markdown / sandboxed HTML iframe
└── 后端：POST /api/report-versions/generate
    ├── 只读取 workspace_paths 中 folder=report 的登记路径
    ├── LLM 输出 schema：presentationMarkdown + storylineHtml
    ├── JSON parse 失败时走 repair 回退
    └── 写入同一报告输出根目录下的 presentation_versions/
```

### 2. 关键文件

| 文件 | 作用 |
|---|---|
| `web/src/components/PresentationVersionPane.tsx` | 「汇报版本」tab：报告选择、prompt、Markdown / HTML 故事线预览 |
| `web/src/lib/constants.ts` | 新增 `presentation_version` 子 tab，位置在「报告输出」之后 |
| `web/src/App.tsx` | 挂载「汇报版本」tab，并在生成后刷新成果中心 |
| `web/src/lib/api.ts` | `generatePresentationVersion()` 返回 Markdown 与故事线 HTML 字段 |
| `server/src/index.ts` | `POST /api/report-versions/generate`、HTML 清理、JSON repair 回退 |
| `web/src/components/DecisionTreePane.tsx` | 去除报告内容预览侧栏，保留后台报告读取与图生成 |
| `web/src/components/TocPane.tsx` | 去除报告内容预览侧栏，保留后台报告读取与图生成 |

### 3. 关键决策与边界 ⭐

**决策 14: 「汇报版本」不是新路径类型，而是 report 路径内的二次产物生成**
- 选择: 不新增 `WorkspaceFolderName`；复用 `folder=report` 的登记路径。
- 理由: 汇报稿和故事线都是基于当前任务报告输出的二次产物，应继续落在统一报告输出目录中。
- 约束: 只能读取已登记的「报告输出」路径；生成文件写入同一输出根目录的 `presentation_versions/`。

**决策 15: 故事线保存为 HTML，并用 sandboxed iframe 预览**
- 选择: HTML 文件独立保存，前端用 `iframe srcDoc` 展示。
- 理由: 故事线需要图文并茂展示讲解顺序，Markdown 不足以稳定表达流程卡片、箭头、时间线和视觉脉络。
- 约束: HTML 必须自包含；禁止 script 与外链资源。当前后端做基础清理，但这不是完整 HTML sanitizer。

**决策 16: LLM 结构化输出必须有 repair 回退**
- 选择: 汇报版本先要求严格 JSON；解析失败时二次 repair。
- 理由: 真实模型会输出非 JSON 或混入解释文字，直接失败会影响用户体验。
- 注意: repair 仍可能失败；前端已将底层 JSON 错误转为更可读提示。

### 4. 已知问题与下一步（Action Items）

- [ ] **汇报版本真实样本回归** — P1
  - 当前已验证: typecheck / build / diff check；已修复一次真实调用暴露的 JSON parse 失败。
  - 待验证: 使用多份真实长报告反复生成，确认 Markdown 质量、HTML 故事线可读性和 repair 成功率。
  - 完成标准: 长报告也能稳定生成 `.md` + `.html`；故事线在深色/浅色 UI 中均可读。

- [ ] **故事线 HTML 安全与质量增强** — P1
  - 当前状态: prompt 禁止外链/script，后端移除 `<script>` 与 inline event handler，iframe 使用 sandbox。
  - 下一步: 考虑引入更完整的 HTML sanitizer 或改成受控 JSON story schema + 前端模板渲染。
  - 完成标准: HTML 预览不会执行脚本，且视觉结构稳定、移动端不溢出。

- [ ] **成果中心继续结构化** — P1
  - 当前状态: 汇报稿与故事线会进入 `presentation_versions/`；成果中心仍按文件树展示。
  - 下一步: 对 `presentation_versions/` 增加分组、文件类型标识、更新时间和来源报告。

- [ ] **接入 tool 级文件权限扩展或 OS sandbox** — P0 安全加固
  - 仍沿用 Session 12 结论：成果预览和汇报版本 API 的路径限制不等价于 pi tool 权限限制。
  - 完成标准: 原始数据目录无法被 pi 工具读取；写操作只能落在解析后的报告输出目录；bash 受到命令与 cwd 限制。

- [ ] **用真实长 session 验证成功 compact** — P1
  - 仍未验证真实 provider 对足够长历史生成 summary 后 contextPercent 实际下降。

### 5. 开放问题

- ❓ **故事线产物格式**
  - 当前为模型直接生成 HTML。
  - 待评估: 是否改为 `storylineJson` + 前端固定模板，以提升安全性、视觉一致性和可编辑性。

- ❓ **汇报版本 prompt 模板**
  - 当前仅自由输入。
  - 待确认: 是否增加场景模板，例如老板汇报、客户沟通、项目复盘、销售战报。

- ❓ **成果中心展示优先级**
  - 待确认: `presentation_versions/` 是否应在成果中心置顶，并把 Markdown 与 HTML 故事线按同一批次关联展示。

### 6. 重要陷阱

- 汇报版本 API 只应读取 `folder=report` 的已登记路径，不要改成任意路径读取。
- 故事线 HTML 不要用 `dangerouslySetInnerHTML`；继续使用 sandboxed iframe 或改为受控模板渲染。
- 模型结构化输出不稳定；任何依赖 JSON 的链路都要保留 parse + repair + validate。
- 生成文件写入 `presentation_versions/`，不要覆盖原详细报告。
- 当前 worktree 有大量并行开发 dirty changes（AnaX、规则记忆、技能评测等）；不要回滚未确认内容。

### 7. 下一个 Session 启动指令

> 先读本 Session 的「本次更新摘要」「关键决策与边界」「重要陷阱」，再运行 `npm run typecheck` 和 `npm run build` 确认现状。
> 下一步优先用真实长报告回归「汇报版本」：确认 JSON repair 成功率、故事线 HTML 质量、`presentation_versions/` 文件落盘和成果中心刷新。
> 如果继续增强故事线，优先评估受控 JSON story schema + 前端模板渲染，避免让模型直接决定完整 HTML 结构。
> 安全加固仍需回到 P0：pi tool 级文件权限 / sandbox，成果 API 路径限制不能替代 tool 权限限制。

---

## 📌 Session 12（探索模块最新） — 2026-06-02

### 0. 本次更新摘要（Changelog）

**本次推进**: 探索模块从“原始 pi 对话壳”升级为面向数据分析任务的工作台：统一输出目录治理、成果中心、对话降噪、对话沉淀工作流、session 级上下文可观测与手动 compact，并修复 compact 被 RPC EOF 提前中止的问题。

1）**默认 model 固定为 MiniMax-M3** ✅ — 探索 composer 默认优先选择 `minimax-cn/MiniMax-M3`；不存在时才回退到 pi 配置默认或模型列表首项。长报告流式中断提示也明确建议切换到 MiniMax-M3。

2）**统一内容输出路径规则** ✅ — 所有 agent 与对话生成内容统一遵循：
   - 优先写入当前 scope（session / flow）在「报告输出」tab 登记的路径；
   - 未登记报告路径时，写入最近加载的聚合数据源所在目录；
   - 再无聚合数据路径时，才回退当前工作目录；
   - 原始数据路径不会注入 LLM context。
   后端集中实现于 `server/src/output-paths.ts`，每轮探索对话、flow 对话、单/多节点执行都复用 `buildRegisteredPathContext()`。

3）**「报告输出」路径警示** ✅ — 子 tab 未登记报告路径时持续显示琥珀色警示图标；添加路径后消失。`FolderPathsPane` 文案同步说明未配置时的 fallback 策略。

4）**探索对话可沉淀为工作流** ✅ — 工作视图顶部新增「沉淀为工作流」。任务完成后可选择“最近一次任务”或“完整对话”，服务端创建 multi flow，并通过 workflow compiler 将方法、步骤、判断规则和输出格式提炼为参数化 `workflow.json` + `README.md`。硬约束：不得复制本机绝对路径；输入统一使用 `{{input.data_path}}`，报告目录统一使用 `{{input.report_dir}}`。

5）**工作视图降噪** ✅ — 默认业务视图只显示用户消息、agent 纯文本答复和错误；`thinking`、`tool_use`、`tool_result` 仍完整保存在 SQLite，但折叠到「查看执行详情」中，避免套壳产品把 agent 内部执行过程当成主界面。

6）**右侧「产物预览」改为「成果」** ✅ — 不再镜像最后一条 assistant 正文。现在展示：
   - 任务状态、成果根目录、文件数；
   - 未配置报告目录时的 fallback 警示；
   - 最新结论摘要；
   - 当前输出目录内的报告、表格、图表文件树；
   - 点击文件后 Markdown / 文本预览；
   - 运行中每 4s 刷新，run 完成后立即刷新。
   服务端成果文件 API 强制限制在解析后的输出根目录内，拒绝 `../`、隐藏路径和内部 `flows` 路径。

7）**上下文治理** ✅ — 保留原有 `pi -p --mode json --session-id` 单轮执行模型，同时新增短生命周期 RPC 控制通道：
   - `get_session_stats` 查询权威 `contextUsage.tokens/contextWindow/percent`；
   - `compact` 手动整理上下文；
   - JSON 流继续监听 pi 原生 `compaction_start` / `compaction_end` 自动整理事件；
   - SQLite 新增 `session_runtime`，持久化状态、context 占用、compact 次数、最近整理时间和错误；
   - UI 展示上下文占用、整理按钮和重新检测按钮；
   - session turn、stats 查询、compact 共用控制锁，避免多个 pi 进程同时操作同一 session。

8）**compact EOF bug 修复** ✅ — 初版 RPC client 使用 `child.stdin.end(command)`，但 pi RPC 把 stdin EOF 视为 shutdown；`get_session_stats` 较快通常成功，耗时 compact 会被提前中止并返回 `Compaction cancelled`。现改为 `stdin.write(command)`，等待响应后才关闭控制通道。`Compaction cancelled`、`Nothing to compact`、`Already compacted` 同时降级为正常 no-op，不再污染 runtime 为 error。

9）**token / cache 统计补充** ✅ — SQLite 新增 `session_token_stats`，服务端暴露 session / workspace token stats；顶部显示累计 token、累计成本和 provider cache 命中率 `cacheRead / (input + cacheRead + cacheWrite)`。注意：累计 token 与当前 context 占用是两个不同指标。

**验证结果**:
- `npm run typecheck` ✅
- `npm run build` ✅（仅保留 Vite bundle 超过 500 kB 的 warning）
- `git diff --check` ✅
- 输出目录策略 smoke test ✅：未配置报告路径时落到最近聚合数据源目录，配置后切换到报告目录。
- 成果路径安全 smoke test ✅：`../etc/passwd` 与 `.pi-sessions/*` 均返回 400。
- RPC stats smoke test ✅：本机 pi 返回真实 `contextWindow` 与 `contextUsage.percent`。
- 延迟 RPC smoke test ✅：模拟 300ms 响应时可正常等待，不再被 EOF 中止。
- compact no-op smoke test ✅：返回 `compacted:false` 和“当前上下文较短，暂无可整理的历史内容”，runtime 保持 `idle`、`lastError=null`。
- runtime refresh smoke test ✅：模拟历史 error 后重新检测，状态恢复 `idle` 并清除旧错误。

### 1. 当前架构快照

```text
探索工作视图
├── 中央：任务对话（业务消息默认可见，执行详情折叠）
├── 顶栏：上下文占用 / 重新检测 / 整理上下文 / 沉淀为工作流
└── 右栏：成果（摘要 + 输出目录 + 受限文件树 + 文件预览）

Node BFF
├── turn：pi -p --mode json --session-id <sessionId>
├── control：pi --mode rpc --session-id <sessionId>
│   ├── get_session_stats
│   └── compact
├── SQLite：messages / session_runtime / session_token_stats / workspace_paths
└── output policy：报告路径 > 最近聚合数据源目录 > 当前工作目录 fallback
```

### 2. 关键文件

| 文件 | 作用 |
|---|---|
| `server/src/output-paths.ts` | 统一解析输出根目录，构造所有 agent 复用的输出路径 prompt |
| `server/src/pi-adapter.ts` | JSON turn runner + 短生命周期 RPC 控制通道；注意 RPC stdin 不得提前 EOF |
| `server/src/index.ts` | runtime / compact / token-stats / artifacts / promote-to-flow API；session 控制锁 |
| `server/src/db.ts` | `session_runtime`、`session_token_stats`、scoped `workspace_paths` 持久化 |
| `server/src/cache.ts` | token usage 累积与 cache hit rate 聚合 |
| `web/src/components/ChatPane.tsx` | 业务对话投影、执行详情折叠、context 工具栏 |
| `web/src/components/PreviewPane.tsx` | 右侧成果中心 |
| `web/src/components/FolderPathsPane.tsx` | 原始数据 / 聚合数据 / 报告输出路径登记 |
| `web/src/App.tsx` | 探索页 orchestration、runtime 刷新、compact 操作、工作流沉淀弹窗 |

### 3. 关键决策与边界 ⭐

**决策 10: 保留 JSON turn runner，只用短生命周期 RPC 做控制面**
- 选择: turn 继续使用 `-p --mode json`；stats 与 compact 使用独立 RPC 进程。
- 理由: 先获得 context 可观测与手动整理能力，不一次性重写成熟的 turn 执行链。
- 约束: RPC stdin 必须保持开启直到响应返回；session 控制锁必须覆盖 turn / stats / compact。

**决策 11: 原始消息完整保存，默认 UI 只做业务投影**
- 选择: SQLite 保留 user / assistant / tool content blocks；UI 默认隐藏 trace。
- 理由: 用户无需阅读 agent 思考过程，但排错仍需原始证据。
- 边界: 当前纯文本 assistant 回复直接显示；后续可进一步识别“澄清问题 / 最终摘要 / 状态事件”并使用结构化卡片。

**决策 12: 成果中心按受限输出根目录读取，不扫描任意文件系统**
- 选择: 右栏成果 API 复用统一 output policy，并以 `safeResolve()` 阻断路径逃逸。
- 理由: 去除重复正文，同时避免预览接口成为任意本机文件读取入口。
- 边界: 该限制仅作用于 Xanthil 成果预览 API，不等价于约束外部 pi 内置工具。

**决策 13: compact no-op 不是错误**
- 选择: `Compaction cancelled`、`Nothing to compact`、`Already compacted` 返回 `compacted:false` 和用户提示。
- 理由: 短会话、已经整理过的会话或无可压缩历史都属于正常状态。
- 注意: 真正 provider / RPC / session 文件错误仍返回 500，并显示“上下文维护失败”。

### 4. 已知问题与下一步（Action Items）

- [ ] **接入 tool 级文件权限扩展或 OS sandbox** — P0 安全加固
  - 当前状态: prompt 已禁止原始数据访问，成果预览 API 已限制根目录，但 pi 内置 `read/bash/edit/write` 仍运行在宿主权限下。
  - 可选方案: 使用 pi `tool_call` extension 对路径和 bash 命令 fail-closed；更强方案是引入可信 sandbox runtime。
  - 完成标准: 原始数据目录无法被 pi 工具读取；写操作只能落在解析后的报告输出目录；bash 受到命令与 cwd 限制。
  - 注意: 这涉及安全策略和潜在新增依赖，实施前需单独审阅。

- [ ] **用真实长 session 验证成功 compact** — P1
  - 当前已验证: RPC 延迟等待、stats 查询、no-op 映射和 refresh 清错。
  - 未验证: 使用真实 provider 对足够长历史生成 summary 后，contextPercent 实际下降。
  - 完成标准: compact 返回 `compacted:true`，`compactCount + 1`，后续对话能继承目标、路径、结论和待办。

- [ ] **成果中心继续结构化** — P1
  - 当前状态: 文件树 + 摘要 + 文本 / Markdown 预览已可用。
  - 下一步: 增加 artifact metadata、表格专用预览、图表预览、文件更新时间与来源 turn。

- [ ] **业务消息投影继续细化** — P2
  - 当前状态: 默认隐藏 tool / thinking，保留纯文本回复。
  - 下一步: 结构化区分 agent 澄清问题、阶段状态、最终摘要和错误，进一步减少长报告正文占据中央对话。

- [ ] **流式增量渲染** — P2
  - 当前状态: `message_update` delta 已观测，但探索页仍主要按 `message_end` 追加。
  - 完成标准: assistant 文本逐块出现，且不重复持久化。

### 5. 开放问题

- ❓ **tool 级安全策略**
  - 是否仅限制原始数据目录，还是默认 deny、只允许登记的聚合数据读取路径和报告写入路径？
  - 建议: 默认 deny + allowlist，避免 prompt injection 绕过。

- ❓ **成果中心优先展示规则**
  - 当前展示输出根目录完整文件树。
  - 待确认: 是否默认只展示本次 turn 新增 / 修改产物，并将历史文件折叠。

- ❓ **context 自动整理阈值**
  - pi 自带 auto-compaction，默认阈值由 pi settings 管理。
  - 待确认: Xanthil 是否在 contextPercent 达到 80% 时主动提示，或在发送前自动执行 compact。

### 6. 重要陷阱

- `pi --mode rpc` 的 stdin EOF 会触发 shutdown。耗时命令必须使用 `stdin.write()` 并等待 response 后再 `end()`。
- 累计 token、provider cache 命中率、当前 contextPercent 是三个不同指标，UI 和文案不可混用。
- compact no-op 不应标记为 runtime error。
- 原始数据路径禁止注入 LLM context；`draw_data` 仅供本地工具处理。
- Xanthil 成果预览目录限制不等于 pi tool 权限限制。
- 工作区已有大量并行开发改动；不要回滚未确认的 dirty worktree 内容。

### 7. 下一个 Session 启动指令

> 先读本 Session 的「本次更新摘要」「已知问题与下一步」「重要陷阱」，再运行 `npm run typecheck` 和 `npm run build` 确认现状。
> 探索模块下一优先级是：**审阅并落地 tool 级文件权限策略**。优先采用默认 deny + allowlist：只允许读取登记的聚合数据路径，只允许写入统一解析后的报告输出目录；bash 需要额外约束。
> compact 继续调试时，务必使用足够长的真实 session，并区分 `compacted:true` 与正常 no-op。
> 工作流模块的详细演进记录见 `handoff-工作流.md`；缓存命中专题见 `handoff-缓存命中.md`。

---

## 📌 Session 2 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 诊断并解决了 P0 阻塞——pi 默认 model 报 400 的根因，新增了 UI 端的模型选择器，用户现在可直接在 composer 下拉选择可用模型，对话首次跑通。
- **关键决策**: ①不修改 pi 全局配置，而是在每轮 spawn 时通过 `--model provider/id` 注入所选 model（无副作用，与全局 pi 设置隔离）；②`GET /api/models` 直接读 `~/.pi/agent/settings.json` 的 `enabledModels` 列表，不解析 `pi --list-models` 文本表（更稳定）。
- **已解决阻塞**: `volcengine-plan` 全系 model 不支持 pi 发出的 `developer` role → 改用 `openai-codex` 或 `minimax-cn` 的 model 即可跑通。
- **下一步重点**: Phase 2 数据分析实体（文件上传 + ECharts + TanStack 数据网格 + Excel 预览）；先确认图表库选型（ECharts）。

### 1. 项目元信息

```
Session 编号: 第 2 次交接
本次 Session 起止: P0 model 诊断 + 模型选择器 UI
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
```

### 2. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 项目脚手架（npm workspaces） | ✅完成 | 根 `package.json`，`server/` + `web/` | `npm run dev` 同起两端 |
| Node BFF（Express+ws+sqlite） | ✅完成 | `server/src/{index,db,config,pi-adapter,types}.ts` | gateway :8787 |
| pi 适配器（spawn+NDJSON） | ✅完成 | `server/src/pi-adapter.ts` | 已实测事件流贯通 |
| 工作区/会话 CRUD | ✅完成 | REST + `web/src/lib/api.ts` | 增删改查均实测 |
| 会话持久化（user/assistant/tool） | ✅完成 | `server/src/db.ts` | `node:sqlite` |
| 前端三栏布局 + PilotDeck 视觉 | ✅完成 | `web/src/components/*` | zinc/neutral 设计系统 |
| **模型选择器** | **✅完成** | `web/src/components/ChatPane.tsx` | 按 provider 分组下拉；默认选 list[0] |
| **GET /api/models** | **✅完成** | `server/src/index.ts` | 读 `~/.pi/agent/settings.json` |
| **P0 model 修复** | **✅完成** | — | 改用 minimax-cn/openai-codex，对话已跑通 |
| ProcessTrace 工具调用渲染 | 🚧待验证 | `web/src/components/ProcessTrace.tsx` | 防御式实现，需触发真实 tool_use 观测 |
| 明暗主题/复制/侧栏拖拽/重命名删除 | ✅完成 | `Sidebar.tsx` `lib/theme.ts` | 实测通过 |
| 流式增量渲染 | ⏳待启动 | — | `-p` 模式观测到 `message_update` 事件，含 delta |
| Phase 2 数据实体（上传/图表/表格/Excel） | ⏳待启动 | tab 已占位 | 见 Action Items |

### 3. 关键决策与权衡 ⭐

**决策 5: spawn 时注入 `--model`，不修 pi 全局配置**
- 选择: 每轮 `runPiTurn()` 将 UI 选中的 `provider/modelId` 传为 `--model` 参数。
- 备选: 改写 `~/.pi/agent/settings.json` 的 `defaultModel`（被否决）。
- 理由: 全局配置改动影响用户日常 pi 使用；spawn 注入无副作用，scope 仅限 Xanthil。
- 影响范围: `server/src/pi-adapter.ts`（已有 `model?` 参数），`server/src/index.ts`（ws send 透传）。
- 可逆性: 高。

**决策 6: `/api/models` 读 `settings.json`，不解析 `pi --list-models` 文本输出**
- 选择: 直接 `readFileSync(~/.pi/agent/settings.json)` 取 `enabledModels` 列表。
- 备选: 解析 `pi --list-models` 文本表（被否决）。
- 理由: 文本表格格式脆弱、依赖 pi 版本；`settings.json` 结构固定、无网络调用。
- 影响范围: `server/src/index.ts` 加 3 个 import + 25 行 endpoint。
- 可逆性: 高。

### 4. pi model 诊断结论（⭐ 重要存档）

**根因**: pi 内部将 system prompt 发送为 `role:"developer"`（OpenAI Responses API 格式），而 `volcengine-plan` 的 Volces API 仅支持 `system/user/assistant/tool`，遂报：
```
400 The parameter `messages.role` specified in the request are not valid: invalid value: `developer`
```

**受影响 provider**: `volcengine-plan`（deepseek-v4-flash、deepseek-v4-pro、glm-5.1、kimi-k2.6）——这是 pi 侧 bug，非本项目可修。

**可用 provider**（已实测）:
- `openai-codex/gpt-5.4-mini` ✅（OAuth，`api:"openai-codex-responses"`）
- `minimax-cn/MiniMax-M2.7` ✅（API Key，`api:"anthropic-messages"`）

**处理策略**: UI 下拉默认选中 `enabledModels[0]`（当前为 `minimax-cn/MiniMax-M2.7`），每轮对话都通过 `--model` 显式指定，绕过 pi 全局默认。

### 5. 技术/方案细节快照（增量，与 Session 1 合并阅读）

**新增文件/关键改动**
- `server/src/index.ts:1-3` — 新增 `readFileSync`、`homedir`、`join` import。
- `server/src/index.ts:29-54` — `GET /api/models` endpoint，读 `~/.pi/agent/settings.json`，返回 `{id,provider,model,isDefault}[]`。
- `web/src/types.ts:3-8` — 新增 `PiModel` interface（`id/provider/model/isDefault`）。
- `web/src/lib/api.ts` — 新增 `listModels(): Promise<PiModel[]>`。
- `web/src/App.tsx` — bootstrap 时并发加载 models，预选 `list[0].id`；传 `models` prop 给 `ChatPane`。
- `web/src/components/ChatPane.tsx` — 新增 `ModelSelect` 子组件（provider `<optgroup>` 分组 `<select>`），有 models 时替换原自由文本 input；无 models 时降级显示 "加载中…" input。

**`pi --list-models` 实测可用模型（2026-05-30）**
```
provider         model                   thinking  images
minimax-cn       MiniMax-M2.7            yes       no    ✅
minimax-cn       MiniMax-M2.7-highspeed  yes       no    (未测)
openai-codex     gpt-5.2                 yes       yes   (未测)
openai-codex     gpt-5.3-codex           yes       yes   (未测)
openai-codex     gpt-5.4-mini            yes       yes   ✅
openai-codex     gpt-5.5                 yes       yes   (未测)
volcengine-plan  deepseek-v4-flash       yes       no    ❌ developer role
volcengine-plan  deepseek-v4-pro         yes       no    ❌ developer role
volcengine-plan  glm-5.1                 no        no    ❌ developer role（推测）
volcengine-plan  kimi-k2.6               no        yes   ❌ developer role（推测）
```

**观测到新事件类型**（Session 2 实测，补充 Session 1 事件清单）
- `message_update`：pi 在 `-p` 模式下也会吐 delta 事件（含 `assistantMessageEvent.type:"text_delta"` 和 `"text_end"`），可用于流式渲染。结构：`{type:"message_update", assistantMessageEvent:{type:"text_delta"|"text_end", contentIndex, delta?, content?}, message:{...}}`。

### 6. 未完成事项与下一步（Action Items）

- [x] ~~**修复 pi 侧以跑通真实对话**~~ — P0 ✅ 已解决
- [ ] **验证 ProcessTrace 真实 tool_use 渲染** — P0（次优先）
  - 上下文: ProcessTrace 防御式实现未经真实数据验证；现在 model 可用，触发一个带工具调用的任务即可观测。
  - 完成标准: `tool_use`（工具名+输入参数）和 `tool_result`（输出/is_error）均正确渲染。
  - 步骤: 发一个会触发文件读写的任务（如"列出当前目录文件"），观测 `message_end` 的 content blocks 实际结构，按需微调 `ProcessTrace.tsx`。
- [ ] **Phase 2：文件上传 + 数据网格 + 图表 + Excel 预览** — P1
  - 上下文: 数据分析工作台核心价值在右侧预览区；当前 tab（文件/数据表/仪表盘）是占位。
  - 输入: react-dropzone + multer（升 2.x）；ECharts（待用户确认）；TanStack Table；SheetJS(xlsx)。
  - 完成标准: 能拖拽上传 Excel/CSV 到工作区、在数据表 tab 预览、在仪表盘 tab 出图。
- [ ] **流式增量渲染** — P2
  - 上下文: Session 2 实测确认 `-p` 模式也会吐 `message_update` delta 事件，可直接做流式。
  - 完成标准: assistant 文本逐块出现（接 `text_delta` 事件叠加到当前 message）。
- [ ] **composer 工具栏扩展**（thinking 级别下拉 + CircleGauge 用量）— P2

### 7. 开放问题与待确认事项

- ❓ **Phase 2 图表库选型 ECharts vs Recharts**
  - 当前倾向: ECharts（中文生态、报表能力强）。
  - 需要: 用户确认后开始实现。
- ❓ **volcengine-plan 的 `developer` role 问题是否有解**
  - 如 pi 后续版本修复了该 bug，volcengine 系 model 即可正常使用；届时无需 Xanthil 侧改动（spawn 已透传 `--model`）。

### 8. 上下文与约定

- 用户偏好（全局 CLAUDE.md）: 中文回答、代码英文、最小改动、先思考后动手、删除/覆盖前确认、证据优先（先读再改）。
- 项目记忆已落盘: `~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/pi-xanthil-overview.md`。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」与「未完成事项」两节，并跑 `npm run dev`（gateway:8787 + web:5173）确认现状。
> 最紧迫任务：**验证 ProcessTrace 真实 tool_use 渲染**——在 UI 中选 minimax-cn/MiniMax-M2.7 或 openai-codex 任意 model，发一个会触发工具调用的任务，观测 content blocks 实际结构，按需微调 `ProcessTrace.tsx`。
> 然后与用户确认图表库选型（倾向 ECharts），再开始 Phase 2。
> 注意陷阱（沿用）：①判别联合的开放成员会破坏类型收窄，用 `as Extract` 处理；②`node:sqlite` 返回需 `as unknown as T`。

---

## 📌 Session 1 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 从零搭建并端到端验证了 `pi` cli 套壳的数据分析 Web 工作台骨架（Phase 0–1），随后按 PilotDeck 真实 UI 源码做了高保真视觉重写。
- **关键决策**: ①每轮 `spawn pi -p --mode json --session-id` 而非常驻 rpc 进程；②用 Node 内置 `node:sqlite` 规避 better-sqlite3 原生编译坑；③借鉴而非 fork PilotDeck（AGPL），用同栈干净重写。
- **新增阻塞/问题**: 本机 `pi` 默认 model（`volcengine-plan/deepseek-v4-flash`）报 400、扩展 `ptk-memory-inject` 的 better-sqlite3 版本不匹配——导致**无法跑通真实对话**，因此 ProcessTrace 工具调用渲染仅类型层验证、未见真实数据。
- **下一步重点**: ①修复 pi 侧 model/扩展以跑通真实对话；②Phase 2 数据分析实体（文件上传 + ECharts + TanStack 数据网格 + Excel 预览）。

### 1. 项目元信息

```
项目名称: 苍耳 pi-Xanthil
项目类型: 代码开发（Web 前端 + Node BFF，套壳 pi cli）
Session 编号: 第 1 次交接
本次 Session 起止: 从「空目录 + 一份产品理念草稿」推进到「可运行的工作台骨架 + PilotDeck 风格 UI + 会话/工作区 CRUD」
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
```

### 2. 项目目标（North Star）

- **一句话目标**: 把本地 `pi` cli 包成一个以 WorkSpace 为单位组织的数据分析 AI 工作台 Web 应用。
- **成功标准**:
  1. 浏览器内创建工作区/会话，与 pi 多轮对话，流式看到任务过程与产物。
  2. 右侧预览区能渲染报告 / 图表 / 数据表（Excel、CSV、Markdown）。
  3. 数据隔离按工作区组织，会话可持久化、可回看。
- **明确的非目标**: 不 fork/分发 PilotDeck 代码（AGPL）；当前不做多用户鉴权（本地单人工具）；不替 pi 重新实现 agent 逻辑。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 项目脚手架（npm workspaces） | ✅完成 | 根 `package.json`，`server/` + `web/` | `npm run dev` 同起两端 |
| Node BFF（Express+ws+sqlite） | ✅完成 | `server/src/{index,db,config,pi-adapter,types}.ts` | gateway :8787 |
| pi 适配器（spawn+NDJSON） | ✅完成 | `server/src/pi-adapter.ts` | 已实测事件流贯通 |
| 工作区/会话 CRUD | ✅完成 | REST + `web/src/lib/api.ts` | 增删改查均实测 |
| 会话持久化（user/assistant/tool） | ✅完成 | `server/src/db.ts` | `node:sqlite` |
| 前端三栏布局 + PilotDeck 视觉 | ✅完成 | `web/src/components/*` | zinc/neutral 设计系统 |
| ProcessTrace 工具调用渲染 | 🚧进行中 | `web/src/components/ProcessTrace.tsx` | 防御式实现，**未见真实数据** |
| 明暗主题/复制/侧栏拖拽/重命名删除 | ✅完成 | `Sidebar.tsx` `lib/theme.ts` | 实测通过 |
| 流式增量渲染 | ⏳待启动 | — | 需先跑通 pi model 观察 delta 事件 |
| Phase 2 数据实体（上传/图表/表格/Excel） | ⏳待启动 | tab 已占位 | 见 Action Items |
| 跑通真实对话 | ⚠️阻塞 | — | pi 侧 model/扩展问题 |

### 4. 关键决策与权衡 ⭐

**决策 1: 每轮 `spawn` + `--session-id`，而非常驻 rpc 进程**
- 选择: 用户每次发言执行一次 `pi -p --mode json --session-id <我方sessionId> --session-dir <工作区>/.pi-sessions`，由 pi 自身持久化会话。
- 备选: `pi --mode rpc` 常驻双向进程（被否决）。
- 理由: 服务端无状态、最简、最稳；会话连续性交给 pi。rpc 协议未知、需维护长连接生命周期。
- 影响范围: server 不需进程池管理；多轮上下文依赖 pi 的 session 文件。
- 可逆性: 中（未来要真流式可切 rpc）。

**决策 2: 用 Node 内置 `node:sqlite`，不用 better-sqlite3**
- 选择: `node:sqlite`（Node 22+ 内置）。
- 备选: better-sqlite3（被否决）。
- 理由: 本机 Node 26（NODE_MODULE_VERSION 147）下 better-sqlite3 需重编译；用户的 pi 扩展正因此报错。内置模块零编译、免疫该坑。
- 影响范围: `db.ts` 用 `DatabaseSync`；`.all()/.get()` 返回 `Record`，需 `as unknown as T` 转换。
- 可逆性: 中。

**决策 3: 借鉴 PilotDeck，不 fork（AGPL 规避）**
- 选择: 读其 `ui/` 源码提取设计系统（zinc/neutral 令牌、布局、组件类名），用同栈（React18+Vite7+Tailwind3.4+Radix/shadcn 模式）干净重写。
- 备选: 整仓复制 UI（被否决）。
- 理由: PilotDeck 是 AGPL-3.0，复制并部署为网络服务义务重；底层库均 MIT，重写产物可保持私有。
- 影响范围: 所有 UI 自写；视觉对齐其真实 token（见第 5 节）。
- 可逆性: 低（已成既定路线）。

**决策 4: 消息模型用 pi content blocks，而非纯文本 [修正 Session 内早期实现]**
- 选择: 端到端保留 pi 的 content blocks（text/tool_use/tool_result/thinking），server 持久化 user/assistant/**tool** 全角色。
- 推翻原因: 初版把消息拍平成纯文本，无法渲染工具调用过程（ProcessTrace）。
- 影响范围: `MessageRow.tsx` 按块渲染；server `index.ts` 改为按 `role` 持久化（跳过 pi 的 user 回显避免与 send 时持久化重复）。
- 可逆性: 中。

### 5. 技术/方案细节快照

**架构**
```
浏览器(React18+Vite7+Tailwind3.4+Radix) ──WS(/ws)+HTTP(/api)──> Node BFF(Express+ws+node:sqlite)
                                                                      │ 每轮 spawn
                                                              pi 0.77 (-p --mode json)
数据根: ~/.pi-xanthil/（XANTHIL_DATA_DIR 可覆盖）；每工作区: <root>/workspaces/<id>/{files,.pi-sessions}
```

**pi `--mode json` 事件（实测，NDJSON）**: `session{id,cwd}` → `agent_start` → `turn_start` → `message_start{message}` → `message_end{message}` → `turn_end` → `agent_end`。assistant 消息带 `usage{input,output,totalTokens,cost{total,...}}`、`model/provider`、`errorMessage`。适配器对非 JSON 行（扩展报错）静默忽略，stderr 转 `{type:"stderr"}` 事件。

**关键文件**
- `server/src/pi-adapter.ts`: `runPiTurn()` spawn + readline 逐行解析。
- `server/src/index.ts`: REST（workspaces/sessions CRUD + messages history）+ ws gateway（`send` → spawn → 转发事件 + 持久化）。
- `server/src/db.ts`: schema `workspaces/sessions/messages`；删工作区只清 DB 行，**磁盘文件保留**。
- `web/src/index.css` + `tailwind.config.js`: PilotDeck **zinc/neutral 令牌**（hue 0、饱和 0%；如 dark `--background:0 0% 4%`、`--border:0 0% 15%`、`--radius:0.5rem`），InterVariable 字体，`@tailwindcss/typography`。
- `web/src/components/`: `Sidebar`（项目中心、可拖拽宽度、hover 重命名/删除、主题切换）、`MainHeader`（h-12 面包屑 + 标签条 对话/文件/数据表/仪表盘）、`ChatPane`（消息列 + composer）、`MessageRow` + `ProcessTrace`（content blocks 渲染）、`PreviewPane`（右侧产物预览，可折叠）。

**视觉签名（务必沿用）**: lucide 图标统一 `strokeWidth={1.75}`；小密排版 11/12.5/13/14px；用户消息=右侧 `rounded-[22px]` pill 气泡；助手消息=裸 prose 无头像。

**已踩的坑**
- 判别联合里加了开放式 `{type:string;[k]:unknown}` 成员，会**破坏 `message_end` 类型收窄** → 用 `as Extract<PiEvent,{type:"message_end"}>` 或对 block 字段 `as {text?:string}` 显式转换。
- `node:sqlite` 的 `.all()/.get()` 返回类型需 `as unknown as T`。
- `db.ts` 在模块导入时即 `new DatabaseSync`，必须在其前调用 `ensureDirs()`（否则 "unable to open database file"）。
- macOS 无 `timeout` 命令（测试脚本注意）。

**依赖提醒**: `multer@1.x` 有漏洞告警，Phase 2 接文件上传时升 2.x。

### 6. 未完成事项与下一步（Action Items）

- [ ] **修复 pi 侧以跑通真实对话** — P0
  - 上下文: 默认 model 报 `developer` role 400；`ptk-memory-inject` 扩展 better-sqlite3 版本不匹配。不修则看不到真实 assistant 输出与工具调用。
  - 输入: 在 pi 顶栏 model 框填可用 model，或修 pi 配置 / `npm rebuild` 扩展。
  - 完成标准: 一轮对话能看到非空 assistant 文本 + 至少一次 tool_use 在 ProcessTrace 中渲染。
  - 潜在难点: tool_use/tool_result 真实结构未观测，可能需按真实数据微调 `ProcessTrace.tsx`。
- [ ] **Phase 2：文件上传 + 数据网格 + 图表 + Excel 预览** — P1
  - 上下文: 数据分析工作台核心价值在右侧预览区；当前 tab（文件/数据表/仪表盘）是占位。
  - 输入: react-dropzone + multer（升 2.x）；ECharts；TanStack Table；SheetJS(xlsx)。
  - 完成标准: 能拖拽上传 Excel/CSV 到工作区、在数据表 tab 预览、在仪表盘 tab 出图。
- [ ] **流式增量渲染** — P2
  - 上下文: 当前按 `message_end` 整段渲染；`-p` 模式是否吐 delta 未知。
  - 输入: 跑通 model 后观察 NDJSON 是否有 content delta 事件名。
  - 完成标准: assistant 文本逐字/逐块出现。
- [ ] **composer 工具栏下拉**（run-mode/thinking、权限、用量 CircleGauge）— P2
  - 完成标准: thinking 级别下拉能映射到 pi `--thinking` 并生效。

### 7. 开放问题与待确认事项

- ❓ **pi 的 tool_use/tool_result content block 真实字段结构**
  - 当前倾向: 按 `{name,input}` / `{content,is_error,tool_use_id}` 防御式解析。
  - 阻塞了什么: ProcessTrace 真实渲染保真度。
  - 需要谁/什么解决: 跑通一次带工具调用的真实对话后观测。
- ❓ **Phase 2 图表库选型 ECharts vs Recharts**
  - 当前倾向: ECharts（中文生态、报表能力强）。
  - 需要: 用户确认。

### 8. 上下文与约定

- 用户偏好（全局 CLAUDE.md）: 中文回答、代码英文、最小改动、先思考后动手、删除/覆盖前确认、证据优先（先读再改）。
- 项目记忆已落盘: `~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/pi-xanthil-overview.md`。
- 产品命名草稿: `产品名称及理念.txt`（苍耳 / pi-Xanthil，理念/功能两节待补）。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」与「未完成事项」两节，并跑 `npm run dev`（gateway:8787 + web:5173）确认现状。
> 当前最紧迫的是 **P0：修复 pi 侧 model/扩展以跑通真实对话**——否则看不到真实 assistant 输出与工具调用，无法验证 ProcessTrace 保真度。
> 注意两个关键陷阱：①判别联合的开放成员会破坏 `message_end` 类型收窄，按既有 `as Extract` 写法处理；②`node:sqlite` 返回需 `as unknown as T`。
> 开始 Phase 2 前，请先与用户确认图表库选型（ECharts vs Recharts）。
