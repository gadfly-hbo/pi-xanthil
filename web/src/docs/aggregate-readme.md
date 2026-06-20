# 控制模块 操作手册

> **模块定位**：「控制」（顶部 tab `aggregate`）是 pi-Xanthil 的 **AI 工程基元统一控制台**——把驱动整个系统的底层能力（工具 / hooks / skills / 斜杠命令 / 插件 / 子 agent / LLM 接入 / prompt 模板）集中到一处做**查看、治理与实验**。它管的是「AI 怎么跑」，而不是「数据怎么算」。
>
> 📅 更新日期：2026-06-20
>
> ⚠️ 模块已重构：旧版的「聚合计算 / 数据提取 / SQL 连接」等**数据加工**能力已迁出到**日常 / 专题**模块的数据链路；控制模块现在专注于 **harness 基元的管理控制台**。

---

## 0. 总览

进入路径：顶部主导航选中「**控制**」（`activeTab === "aggregate"`），默认落在 readme。

二级 tab 共 10 个（`AGGREGATE_SUB_TABS`）：

| # | 二级 tab | 一句话定位 | 与 AI / LLM 关系 |
|---|---|---|---|
| 1 | **tool-use** | 已注册本地工具的管理控制台 + **运行看板** | analysis 类经 MCP 暴露给 AI；看板只读 trace 脱敏字段 |
| 2 | **hooks管理** | 用户定义 hooks（生命周期**护栏 + 传感器**）+ 运行看板 | 拦截 / 改写 tool_call；看板读 px-hook-runner 脱敏字段，不调 LLM |
| 3 | **skills管理** | 项目级 skill 生命周期注册表 | 决定 AI 在本工作区可调用哪些技能 |
| 4 | **command管理** | pi-xanthil 自有的斜杠命令注册表 + 服务端展开器 | 命令在服务端展开为 prompt 再下发 |
| 5 | **插件管理** | pi 已加载扩展 / 包一览（只读） | 反映 pi 运行时挂载的 plugin |
| 6 | **subagents管理** | 子 agent 模板图形化 CRUD + 全局运行看板 | 子 agent 的 dataScope **恒为 clean_data**（红线） |
| 7 | **LLM管理** | LLM 接入管理（直写 `~/.pi/agent` 真源）+ token 用量 | 决定可选模型 / provider；OAuth 凭证由 `pi auth` 管 |
| 8 | **prompts管理** | prompt 模板库 CRUD（工作区级 / 全局） | 模板供各处复用，`{{变量}}` 渲染由调用方做 |
| 9 | **实验场** | skill 深度测评 / 实验工作台 | 跑 skill、比对、LLM-judge 评分 |
| 10 | **readme** | 本操作手册 | — |

> 🟢 **共性边界**：控制模块多为**管理 / 观测**面板——UI 不写业务代码、不在此跑用户数据；工具 / hooks / skill 等的源码仍由开发者放在仓库对应目录，面板侧只做注册、治理与可视化。涉及看板的面板（tool-use / hooks / subagents）只读已脱敏字段，不读 message / 明细原文、不自主调 LLM。

> 🔭 **运行看板**是控制下多个子模块的共性能力：tool-use、hooks管理、subagents管理 均提供「运行流水 + 计数汇总」，用于观测各基元的实际使用情况。

---

## 1. tool-use（`tool_use`，工具管理控制台）

**定位**：统一查看 `server/tools/` 下所有已注册本地工具的元数据，并观测其运行情况。

**主要能力**
- **工具台账**：工具清单 + 分类筛选（全部 / 摄取 ingestion / 分析 analysis）。
  - **摄取（amber）**：读 HTML / 原始 Excel，仅由「数据提取」面板手动触发，**不暴露给 AI**。
  - **分析（emerald + Bot）**：经 MCP 暴露给 pi-agent，AI 按需调用，产物聚合后才回灌 LLM。
  - 工具详情卡：id / version / runtime / 输入输出 / 风险等级 / 适用·禁止 / 参数定义 / 结果列 / 失败处理；可加载 `tests/cases.json` 查看断言。
- **运行看板**（顶部「工具台账 / 运行看板」切换）：
  - 运行总览（总次数 / 成功 / 失败 + 最近 N 条）。
  - 按工具汇总（调用次数 / 成功 / 失败 / 手动·AI / 平均耗时 / 最近运行）。
  - 最近运行流水（时间 / 工具 / 来源 / 状态 / 成功·失败 / 耗时）。
  - 数据源 = `trace_events` 中的工具运行记录（手动运行与 AI/MCP 调用都计入），只读脱敏字段。

**操作要点**：本面板只读；新增 / 改工具去 IDE 编辑 `server/tools/<id>/`，重启 server 后点「刷新」重载。实际触发：摄取类去「日常/专题 → 数据提取」，分析类在对话中让 AI 调。

---

## 2. hooks管理（`hooks_mgmt`）

**定位**：管理**用户定义的 hooks**——挂在 pi 生命周期上的**护栏（拦截 / 改写）+ 传感器（观测）**，而非 pi 的插件。

**主要能力**
- **Hook 管理**：注册 / 启停 / 编辑 hooks，按事件（如 tool_call 前后）与匹配条件配置动作（block 拦截 / 改参 / notify）。
- **运行看板**：实时触发流水 + 计数（成功 / 失败 / 是否拦截），可选最近 100 / 200 / 500 / 2000 条。看板只展示 `px-hook-runner` 已脱敏字段，**不读 message / tool 原文、不调任何 LLM**。

**操作要点**：hooks 是生命周期护栏，区别于「插件管理」（pi 已加载的扩展/包）。执行由 `px-hook-runner` 落地。

---

## 3. skills管理（`skills_mgmt`）

**定位**：项目级 skill 的生命周期注册表 UI——决定本工作区里 AI 可调用哪些技能。

**主要能力**：skill 的注册 / 启停 / 查看；与「实验场」联动（实验场跑评测、本面板管装配）。

**操作要点**：需先选工作区。skill 资产本体在仓库，面板管的是「本工作区启用哪些 / 状态如何」。

---

## 4. command管理（`command_mgmt`）

**定位**：pi-xanthil **自有的「斜杠命令注册表」**——因实证 `pi -p` 不会展开 slash 命令，本项目自建注册表 + 服务端展开器闭环。

**主要能力**：登记 / 编辑斜杠命令及其展开模板；命令在**服务端展开为 prompt** 后再下发给模型。

**操作要点**：与系统内置 CLI 命令无关；这里管的是产品自有命令的注册与展开。

---

## 5. 插件管理（`plugin_mgmt`）

**定位**：pi 运行时**已加载的扩展 / 包一览（只读）**。原属 hooks 管理的「已加载扩展」视图，按职责拆出——扩展/包 = pi 插件（plugin），与用户定义 hooks 是两回事。

**主要能力**：浏览当前 pi 挂载的 plugin 列表与状态（只读）。

**操作要点**：只读视图；增删插件走 pi 自身的扩展机制，不在本面板操作。

---

## 6. subagents管理（`subagents_mgmt`）

**定位**：子 agent 模板（`subagents.json`）的图形化 CRUD + 全局运行看板。

**主要能力**
- **模板视图**：新建 / 编辑 / 删除子 agent 模板。
- **运行看板**：全局子 agent 运行情况观测。
- 顶部「运行看板 / 模板」切换。

> 🔴 **数据红线**：子 agent 的 `dataScope` **编译期 + 运行期双锁恒为 `clean_data`**，禁止触达 `draw_data`（见 `AGENTS.md §一`）。

---

## 7. LLM管理（`llm_mgmt`）

**定位**：LLM 接入管理——**直写 `~/.pi/agent` 真源**，决定系统里可选的模型 / provider；并附 token 用量统计。

**主要能力**
- 增删改 provider / 模型接入配置（直接落到 pi 的真源文件）。
- token 用量统计（`LlmWithTokenStats`）。

**操作要点**：OAuth 类 provider 的凭证由 `pi auth` 管理，本面板灰掉不可改（只提示）。改动直接影响全局可用模型清单。

---

## 8. prompts管理（`prompts_mgmt`）

**定位**：prompt 模板库的 CRUD——工作区级或全局（`workspaceId=null` 即跨工作区可见）。

**主要能力**：新建 / 编辑模板（标题 / 分类 / 正文 / 标签 / `{{变量}}`）；按分类与标签筛选。模板正文里的 `{{变量}}` 仅存储，**渲染由调用方做**。

**操作要点**：作为可复用的提示词资产库，供对话 / 工作流 / 各面板引用。

---

## 9. 实验场（`skill`，SkillLabPane）

**定位**：skill 的**深度测评 / 实验工作台**——跑 skill、比对输出、LLM-judge 评分。

**主要能力**：选 skill + 模型，跑评测集，看 Skill 测评报告（pairwise / 单跑结果 / 评分）。

**操作要点**：与「skills管理」分工——管理 = 装配启停，实验场 = 跑评测看效果。工具的深度评测同样在「实验室 → tool」一侧。

---

## 数据安全 · 速查清单

| 操作 | 允许吗？ |
|---|---|
| 在「tool-use」查看工具元数据 / 运行看板 | ✅ 只读脱敏字段，不读输入输出明细内容 |
| 在「tool-use」改工具代码 | ❌ 面板只读，代码请编辑 `server/tools/` |
| 让 AI 主动调用 ingestion（摄取）类工具 | ❌ 仅 analysis 类经 MCP 暴露给 AI |
| 子 agent 读取 `draw_data` 原始明细 | ❌ dataScope 双锁恒为 `clean_data`（红线） |
| 在「hooks 管理」运行看板读 message 原文 | ❌ 只展示 px-hook-runner 脱敏字段 |
| 在「LLM 管理」改 OAuth provider 凭证 | ❌ 由 `pi auth` 管理，面板只读提示 |
| 在「LLM 管理」增删 API-Key 类 provider | ✅ 直写 `~/.pi/agent` 真源 |

详见 `AGENTS.md §一`。

---

## 故障排查（FAQ）

- **tool-use 工具列表为空**：点「刷新」；检查 `server/tools/` 是否有 `tool.json`；看 server 启动日志 registry 是否报错。
- **tool-use 运行看板为空**：当前工作区还没跑过工具——手动跑在「数据提取」，AI 调用经 MCP；也确认顶部已选工作区。
- **hooks 不生效**：检查 hook 是否启用、事件 / 匹配条件是否命中；运行看板看触发流水与 block 计数。
- **斜杠命令没展开**：命令在服务端展开，确认已在 command 管理登记且模板正确。
- **LLM 管理改了没生效**：直写 `~/.pi/agent` 后可能需重载模型清单（部分入口有 `refreshModels`）；OAuth 凭证须用 `pi auth`。
- **subagents 运行看板无数据 / 红线告警**：确认 dataScope 未被改写（恒 clean_data）。

---

## 文件地图（开发者参考）

| 二级 tab | 主要源文件 |
|---|---|
| tool-use | `web/src/components/ToolUsePane.tsx`（台账 + 运行看板 `ToolRunBoard`）；运行数据 `GET /api/workspaces/:id/tool-runs` |
| hooks管理 | `web/src/components/HooksManagementPane.tsx` + `pi-extensions/px-hook-runner` |
| skills管理 | `web/src/components/SkillManagementPane.tsx` |
| command管理 | `web/src/components/CommandManagementPane.tsx` |
| 插件管理 | `web/src/components/PluginManagementPane.tsx` |
| subagents管理 | `web/src/components/SubAgentManagementPane.tsx`（+ `subagents.json`） |
| LLM管理 | `web/src/components/LlmManagementPane.tsx`（直写 `~/.pi/agent`） + token stats |
| prompts管理 | `web/src/components/PromptsManagementPane.tsx` |
| 实验场 | `web/src/components/SkillLabPane.tsx` |
| Tab 路由 | `web/src/lib/constants.ts`（`AGGREGATE_SUB_TABS`）+ `web/src/tabs/DataTabs.tsx`（readme/各管理 pane）/ `EngineTabs.tsx`（实验场） |

> 进一步背景见 `docs/notes-data.md`（数据基座域 · 领域笔记）。
