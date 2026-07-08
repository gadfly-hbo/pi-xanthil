# tool-use 治理中枢

> 状态：X-TOOLUSE7 v2 已验收。manifest 扩展 `aiExposure` / `outputContract` / `deprecated` / `replacementToolId` / `owner`；`/run` adapter 输出标准 `ToolRunOutput`；ToolUsePane 展示治理字段与能力矩阵；首版确定性推荐器已接入。

## 目的

`控制台 -> tool-use` 定位为 pi-xanthil 的受控计算能力层：所有模块可以引用工具，但工具注册、标签、权限、安全边界、评测与运行观测应从同一套 manifest 和网关派生。

## 当前批次（X-TOOLUSE7A-E，已验收）

- `ExtractionTool` manifest 增加可选 `tags`、`aiExposure`、`outputContract`、`deprecated`、`replacementToolId`，`owner` 在前端类型层占位（`owner?: string`），registry 尚未解析。支持按业务问题、算法、数据域、暴露策略、风险等级、退役状态检索与治理。
- `ToolUsePane` 增加工具搜索、标签/风险/AI 暴露/输出形态/退役筛选、标签展示、跨模块能力矩阵、治理 warnings/blockers。
- MCP tool description 透传 tags；`tools/list` / `tools/call` 按 `aiExposure` + `riskLevel` + `deprecated` 过滤。
- `/api/extraction-tools/:id/run` 经 adapter 输出统一 `ToolRunOutput`，校验 artifact 路径、row guard、`MetricSnapshot[]`、输出契约。
- 新增 `POST /api/workspaces/:id/tool-recommendations` 确定性推荐器，不调用 LLM，不读取文件内容。

## 后续计划

1. **统一运行台账**
   - 以 `/api/extraction-tools/:id/run` 为唯一执行网关，记录 caller、source、toolId、workspaceId、session/flow/subagent 关联、耗时、状态、row guard、output artifacts。
   - 当前 trace 事件可作为过渡；后续可独立成 `tool_runs` 表，支撑筛选、审计和失败回放。

2. **工具准入与生命周期**
   - manifest 扩展 `owner`、`deprecated`、`replacementToolId`、`aiExposure`、`outputContract`。
   - `category` 只表达工具性质；`aiExposure` 表达可被哪些自动化入口使用。旧 manifest 缺 `aiExposure` 时可由 adapter 暂按 `category` 推导，最终权限裁决应迁到 `aiExposure`。
   - analysis 工具上线需要 tests/cases.json；核心工具进入实验室 tool eval 回归集。

3. **场景装配复用**
   - command 只保存 `toolIds + toolParamMap`。
   - subagent template 只保存 `toolIds` 白名单。
   - workflow 节点只引用 `toolId + params`。
   - 表单、搜索、标签、风险说明全部从 manifest 派生，避免各模块重复声明。

4. **数据分析 Python 工具库**
   - 新增数据分析代码工具时必须维护 `tags`，建议至少包含一个业务域标签、一个算法/任务标签、`python-analysis`。
   - analysis 工具必须保证输出为聚合/衍生产物，不包含 draw_data 原始行级明细。

## 注意事项

- 不改变数据探索模块红线：数据探索仍保持纯前端 duckdb-wasm，永久不接 LLM/tool-use 自动调用。
- `ingestion` 工具只做人工摄取，不进入 AI/MCP 暴露。
- 安全判断集中在后端 `/run source=ai` 与工具自身输出契约，前端只展示和装配。

## X-TOOLUSE7 设计决策草案

- `category` 与 `aiExposure` 必须拆开：`category` 是工具性质，`aiExposure` 是权限/暴露策略。
- `aiExposure` 目标上替代 `category=analysis` 的权限语义，不只是 UI hint。
- `aiExposure` 使用多值能力集合，而不是单值枚举；一个工具可以同时允许 `manual_confirmed`、`workflow`、`eval` 等入口，也可以显式为空集合表示完全不自动暴露。
- 迁移期允许缺省 adapter：缺省 `aiExposure` 且 `category=analysis` 时推导为 v1 等价集合 `manual_confirmed` / `mcp` / `command` / `subagent` / `workflow` / `eval`；缺省 `aiExposure` 且 `category=ingestion` 时推导为空集合。
- 显式 `aiExposure` 完全覆盖迁移推导，不与默认集合合并。未来新增更强自动执行入口时，不得自动包含在旧 `category=analysis` 的推导集合里。
- 新增或迁移后的 manifest 应显式写 `aiExposure`，避免继续把工具性质当权限边界。
- `outputContract` 是 `/api/extraction-tools/:id/run` 的运行强契约，不只是治理 UI 说明字段。
- 迁移期由 `/run` adapter 兼容旧 `summary.json` / stdout 输出，统一转换成标准工具输出结构；adapter 之后，网关校验标准结构、artifact 路径、`MetricSnapshot[]`、row-level 风险声明与 row guard 结果。
- 工具脚本可逐步迁移到原生标准输出，但不得绕过网关 adapter 与契约校验。
- 标准输出对外只暴露 artifact id / 受控相对路径 / basename，不暴露绝对路径。artifact 必须落在本次 run 的 output/report 目录内；网关负责校验防穿越。LLM/MCP tool result 默认只拿 summary、metrics、artifact title/basename，不直接拿 artifact 正文。
- 标准输出默认禁止明细表 / 样本行进入 LLM。`summary` 必须是 LLM-safe 短摘要，`metrics` 必须是聚合/确定性指标，artifact 正文默认不进入 LLM。
- `outputContract.tableShape` 建议区分 `aggregate` / `row_level` / `unknown`。`row_level` 表示工具可落盘明细 artifact，但该 artifact 不得作为 MCP/Chat tool result 正文，也不得被推荐器当成可直接解释的 LLM-safe 输出；缺省或无法判断按 `unknown` 保守处理。
- 工具推荐器只能在当前入口 `aiExposure` 允许的候选集合里排序和解释，不能扩大权限。无合规候选时返回“无合规工具”，不得推荐禁用工具或建议绕到其他入口运行。
- 推荐器不得用历史成功率绕过 `deprecated`、`riskLevel`、`outputContract.tableShape` 或数据安全限制。
- `deprecated=true` 对自动化入口生效：MCP / command / subagent / workflow / recommender 不进入候选，历史绑定执行时后端拒绝并返回 `replacementToolId`。
- `deprecated=true` 不等于删除工具目录。控制台人工运行可保留迁移期兼容，但 UI 必须强提示退役和替代工具；Chat `@工具` 默认不展示退役工具，旧链接/历史触发时最多允许带 warning 的人工确认路径。
- `replacementToolId` 指向不存在或也 deprecated 时，registry / 治理 UI 应给 warning，不能静默通过。
- 标准化工具输出 canonical 命名：`ToolRunOutput` 表示 `/run` adapter 后的标准输出结构；`ToolRunArtifact` 表示标准输出里的 artifact 元数据；`ToolOutputContract` 表示 manifest 中声明输出能力与安全边界的契约；`LegacyToolSummary` 仅表示旧 `summary.json` adapter 内部输入，不作为产品领域概念。
- `ToolAiExposure`、`ToolRunOutput`、`ToolRunArtifact`、`ToolOutputContract`、`ToolTableShape` 应进入双侧 `server/src/types.ts` / `web/src/types.ts` 作为跨域共享契约。`LegacyToolSummary` 不进入双侧类型，只留 `/run` adapter 内部。
- `outputContract.tableShape="unknown"` 是迁移期合法状态，但按保守策略使用：人工确认入口可运行并提示输出安全形态未知；MCP/autonomous 入口不允许，除非 `llmSafeSummary=true` 且不是 `row_level`；command/subagent/workflow 可绑定但只能自动传递 artifact metadata，不得把 artifact 正文注入后续 LLM；推荐器只能面向人工确认低优先级推荐；eval 允许用于补齐契约。
- 第一轮迁移范围采用 adapter 优先：`/run` adapter 兼容旧 `summary.json` 并输出统一 `ToolRunOutput`，registry 为缺省 manifest 生成保守 `ToolOutputContract`，只挑 2-3 个核心 analysis 工具试点原生 `ToolRunOutput`。不一次性迁移全部 `server/tools/*`，不删除旧输出兼容，不把 artifact 正文注入 LLM，不新增独立 `tool_runs` 表，除非 trace_events 明显不够。
- 工具推荐器首版采用确定性 scorer，不调用 LLM。输入只允许用户意图文本、当前入口、manifest 元数据、已登记路径类型/扩展名/目录类别、run ledger 统计和 ToolLab 状态；不得读取文件内容、数据探索字段/样本、draw_data 原始行或失败内容正文。输出 top N、score、模板化 reasons/warnings/blockers。
- 工具推荐结果首版不持久化，不新增推荐事件表。推荐端点即时计算返回；用户采纳并运行后，由既有 `/run` ledger 记录 caller/source/status，供后续 scorer 使用。只有未来需要分析“推荐曝光→忽略/采纳→转化率”时，再评估 `tool_recommendation_events`。
- `owner` 首版计划为轻量治理对象 `{ name: string; contact?: string }`，只表示维护责任，不接用户/团队/RBAC，不参与执行授权。实际实现中，因 `server/tools/registry.ts` 尚未解析该字段，当前仅在前端类型声明为 `owner?: string` 并做 UI 展示与治理 warning；未来若要启用对象契约，需同时更新 registry 的 `ExtractionToolManifest` 与 `isManifest`。
- `riskLevel` 是 `aiExposure` 的硬安全上限。`L0/L1` 可按 exposure 暴露（L1 推荐降权）；`L2` 禁止 autonomous MCP，允许人工确认、workflow/eval 等带配置确认入口；`L3` 只能人工运行或 eval，不得进入 MCP / command / subagent / workflow / recommender 自动候选。manifest 写出冲突组合时，registry / policy 应保守过滤冲突 exposure 并给治理 warning。
- manifest / output governance 区分 blocking violation 与 governance warning。入口不在有效 `aiExposure`、风险上限过滤、自动化调用 deprecated、artifact 路径越界、`ToolRunOutput` 非法、row guard 与 `outputContract` 冲突等必须阻断相关入口；缺 owner、缺用途说明、`tableShape=unknown`、legacy adapter 兜底等只作为治理 warning，不阻断人工运行。
- 实施顺序必须先总控契约卡再派域卡：`X-TOOLUSE7A` 定双侧 types、policy、registry normalize/validation 与 adapter 口径；`E/D-TOOLUSE7B` 做 `/run` adapter、校验和核心工具试点迁移；`V-TOOLUSE7C` 做治理 UI；`E-TOOLUSE7D` 做确定性推荐器；`X-TOOLUSE7E` 做全链验收、wiki/notes 收口和必要 ADR。
- 验收门禁必须覆盖“旧行为不回退 + 新契约阻断”：旧 `category=analysis` manifest 在缺省 `aiExposure/outputContract` 时仍保持 v1 入口可见和可运行，旧 `ingestion` 仍不自动暴露；显式 `aiExposure=[]` 不自动暴露；风险上限冲突、deprecated 自动化调用、artifact 越界、非法 `ToolRunOutput`、row-level 进入 LLM、推荐禁用工具等必须被测试阻断。
