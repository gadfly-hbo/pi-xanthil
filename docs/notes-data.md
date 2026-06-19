# 数据基座域 · 领域笔记（Agent-D）

> **活文档**：长效领域知识（约束/决策/踩坑/未验证清单/文件地图），由 D 在开发中持续维护。
> 蒸馏自旧 handoff：`计算工具` `Xan数据库` `规则记忆`(数据部分) `探索`(数据探索部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前的版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-19 · **记忆重构阶段3：D-PANEL 统一记忆面板 + review 队列**
- 进度：
  - **D-PANEL**（本期完成）：
    - `RulesPane.tsx` 完全重建为统一记忆面板：5 个 tab（constraint / experience / episode / fact 投影 / review 复核）
    - CRUD：新建（type/scope/title/body）、编辑、删除，`busyId` 防并发
    - 启用/停用：checkbox toggle，调 `updateMemoryItem(enabled)` 联动后端
    - 注入预览：`GET /memory/preview` 实时展示 chat/workflow scope 下 `buildMemoryPrompt` 产物 + char/token/item/fact 计数
    - 反馈入口：thumbs up/down → `recordMemoryItemFeedback`，即时更新 positiveSignals/negativeSignals
    - review 复核队列：`listMemoryReviews(pending)` + 一键采纳/拒绝，采纳后 item 自动入列表
    - fact 投影 tab：只读展示 business_context / metric_definition / reference_file 投影
    - 风险标签 `RiskBadge`：按 severity 着色展示 instruction_injection/pii/weak_evidence/overbroad
    - 过期检测：`validUntil < Date.now()` 显示"已过期"徽章
    - supersedes 链：显示"supersedes"徽章
  - **Types 增量**（`web/src/types.ts`）：
    - `MemoryReview` / `MemoryReviewStatus`：复核队列条目类型
    - `ProjectedFactItem` / `ProjectedFactKind`：fact adapter 投影类型（前端展示用）
    - `MemoryItemListResponse`：`{ items, facts }` 联合响应
    - `MemoryPromptPreview`：注入预览响应 `{ prompt, charCount, tokenEstimate, itemCount, factCount }`
  - **dataApi 增量**（`web/src/lib/api/data.ts`）：9 个新方法
    - `listMemoryItems` / `createMemoryItem` / `updateMemoryItem` / `deleteMemoryItem`
    - `recordMemoryItemFeedback` / `previewMemoryPrompt`
    - `listMemoryReviews` / `acceptMemoryReview` / `rejectMemoryReview`
  - **Server 增量**（`server/src/routes/data.ts`）：
    - `GET /api/workspaces/:id/memory/preview`：薄壳调 `buildMemoryPrompt`，返回 prompt + 统计
    - try/catch 守卫防止 `buildMemoryPrompt` 异常泄露 500
  - **CasesPane 退役**（`web/src/tabs/DataTabs.tsx`）：
    - `rule_memory.cases` 子 tab 渲染替换为 Placeholder（"案例已并入 experience"）
    - `CasesPane.tsx` 文件保留，子 tab 列表不动等总控下线
  - **Code Review 修复**（本期）：
    - `acceptReview` 加 `if (!out)` 守卫（防止已处理 review 导致崩溃）
    - `rejectReview` 处理 `window.prompt` 取消（`null` 时提前 return）
    - `refresh` 拆分为 `refreshData`（items + reviews，仅依赖 workspaceId）和 `refreshPreview`（preview，依赖 workspaceId + previewScope），避免切换 scope 时重取 items
  - **D-INGEST**（上期完成，见 git log）
  - **D-RETRIEVAL**（上期完成，见 git log）
  - **D-DATA**（上期完成，见 git log）
- 校验：
  - `npm run typecheck`：✅ 全绿（server + web）
  - `npm run build`：✅
  - 数据探索 LLM 隔离 grep：✅ 空匹配
- 下一步（接续优先级）：
  - ① **总控一行改**：engine 默认 ingestPath 翻到 `/api/workspaces/:id/memory/ingest`（`routes/engine.ts:156` + `routes/engine.ts:1194`）
  - ② **总控终审**：`rule_memory.cases` 子 tab 正式下线（`constants.ts` 移除 + `CasesPane.tsx` 删除）
  - ③ **E-DISTILL / E-WIRING**：蒸馏 runner + 调用点对齐（依赖 D-RETRIEVAL + D-INGEST 完成）
  - ④ **fact adapter 补强**：reference 文件若需读正文摘要（当前仅元数据）
  - ⑤ **真机联调专题数据三件套**（前次遗留）
  - ⑥ **真机联调 subagents/command/LLM 管理**（前次遗留）
- 阻塞 / 待总控：
  - `MemoryItemType` 联合需加 `'fact'`：当前 fact adapter 用 D 域内部 `ProjectedFactItem` 规避
  - legacy `/memory/feedback` `/memory/injections` 与新 `/memory/items*` 共存：合并时机交总控终审
  - `rule_memory.cases` 子 tab 正式下线：`constants.ts` 归总控，D 域不动
- 开放问题：
  - `listMemoryReviews` 无分页（与 `listMemoryItems` 一致）；review 队列积累多时需加 `LIMIT ? OFFSET ?`
  - `acceptMemoryReview` 与 `ingestMemoryCandidate` 共享 "create item + supersede" 模式（2 个调用点，YAGNI 暂不提取）
  - `ProjectedFactItem` 与 `MemoryItem` 重叠字段多但类型不兼容
  - clean_data 路径白名单 / hooks PUT 无认证 / hooks-triggers.jsonl 大文件全量读（前次遗留）
  - `RulesPane.tsx` 455 行，后续可拆 `MemoryItemCard` / `ReviewCard` / `FactCard` 子组件

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| 计算工具·聚合 | `AggregatePane.tsx` · `lib/aggregate.ts` | `routes/data.ts`(新) |
| 计算工具·提取 | `ExtractionPane.tsx` | `server/tools/registry.ts` + `server/tools/*`（含 `_tool_utils.py` 共享模块） |
| 计算工具·tool-use | `ToolUsePane.tsx` | 复用 `server/tools/registry.ts` + `index.ts` `/api/extraction-tools*` |
| 计算工具·SQL | `SqlConnectPane.tsx` | `sql-connections.ts` |
| 计算工具·skill 管理 | `SkillManagementPane.tsx` + `CreateSkillModal.tsx` + `EvalSkillModal.tsx` · `SkillSelector.tsx`(增强) | `routes/engine.ts`(E 域端点，D 跨域调) |
| 计算工具·hooks 管理 | `HooksManagementPane.tsx` | `server/src/index.ts`(legacy) |
| 计算工具·command 管理 | `CommandManagementPane.tsx` | `routes/engine.ts`(E 域端点，D 跨域调) |
| 计算工具·subagents 管理 | `SubAgentManagementPane.tsx` | `server/src/index.ts`(legacy，邻近委派 runner) |
| 计算工具·插件管理 | `PluginManagementPane.tsx` | `server/src/index.ts`(legacy) |
| 计算工具·LLM 管理 | `LlmManagementPane.tsx` | `server/src/index.ts`(legacy) |
| 数据探索 | `DataExplorationPane.tsx` + `data-exploration/*` · `lib/{duckdb,profiling,insights,joins}.ts` | 仅二进制文件流，**零 LLM** |
| 指标/业务环境/rules/案例 | `IndicatorsPane` `BusinessContextPane` `RulesPane` `CasesPane` | `db/data.ts`(新) · `memory-injection.ts` |
| 统一记忆 memory_items（v2 重构） | 待建 D-PANEL | `db/data.ts`(CRUD+fact adapter) · `routes/data.ts`(/memory/items*) |
| Xan数据库 | `WeatherPane`(前端直连) · `IndustryPane`/`CompetitorPane`(经后端 pi) + 待建[商圈/the-crowd] | 天气=外部 API 前端直连；行业/竞品=`routes/data.ts` 的 `*/analyze` 经 `runPiPrompt` |

db 新表建在 `db/data.ts:initDataTables`；HTTP 走 `routes/data.ts`；前端方法进 `lib/api/data.ts`。

> **导航变更（2026-06-10 快修，脚手架）**：
> - **规则记忆 6 大模块**：`rules`→偏好记忆 / `indicators`→指标记忆 / `cases`→项目记忆（仅 label 改，id 与后端不动）；新增 `failure_memory`失败记忆 / `field_memory`字段记忆 / `process_memory`流程记忆（**占位 Placeholder**，后端 db/路由/api/pane + 记忆注入待补，参照 rules/indicators/cases 并接入 `App.tsx refreshRulesPromptInfo` 合计）。业务环境/trace/知识图谱保留并列。
> - **计算工具**新增二级 `tool_use`（tool-use，2026-06-12 Phase 1 落地，见 §0）；新增二级 `skills_mgmt`（skill 管理，2026-06-14 落地，见 §0）；新增二级 `command_mgmt`（command 管理，2026-06-16 落地）；新增二级 `subagents_mgmt`（subagents 管理，2026-06-16 落地）。
> - **探索·工作视图红线只读栏**：新增 `components/CleanDataDocsColumn.tsx`，在 explore+view 左侧列 `clean_data` 文档并支持预览 + 一键复制内容。**红线范式：展示聚合数据仅走只读路径 API**（`list*Paths`/`workspacePathTree`/`workspacePathFileGet`），零 LLM、无写入、无删除——可作后续"只读展示 clean_data"的安全模板。导航接缝细节见 `notes-infra §四`。

---

## 二、铁律 / 领域约束（不可破）

1. **数据安全分级**：`draw_data`(原始) 永久禁 LLM；`clean_data`(聚合) 受控可 LLM 但需用户知情；数据探索模块**纯前端 duckdb-wasm，零 LLM 调用**。
2. **数据探索改动后必跑隔离校验**（应无匹配）：
   ```bash
   grep -rE "(generate|chat|extract|clarify|sink|distill).*api\." \
     web/src/components/DataExplorationPane.tsx web/src/components/data-exploration/ \
     web/src/lib/insights.ts web/src/lib/joins.ts web/src/lib/profiling.ts
   ```
3. **业务需求 → 数据探索 单向**：只传字段名 `string[]`（`ExploreSeed`），不带数据、不自动选文件/映射；禁止反向把数据回流 LLM。
4. **SQL 安全**：危险操作（DROP/DELETE/UPDATE/INSERT/ALTER/CREATE/TRUNCATE/GRANT/EXEC…）被 `validateSql()` 拦截返回 400，不可绕过。
5. **风险分层 L0–L3**：L0 自动(预览)/L1 自动+trace(只读查询·探查·提取默认)/L2 需确认(SQL导出·L2工具)/L3 默认禁止(危险SQL)。
6. **SQL 凭证明文存 JSON**：本地单用户，不加密（如需再引 keychain）。
7. **tool-use 管理控制台**：`ToolUsePane` 是工具管理控制台（列表/详情/验证），**不在此跑工具、不在此选 clean_data 路径**。analysis 工具由 pi-agent 经 MCP 调用（后端 `source=ai` 守卫强制 clean_data），ingestion 工具由「数据提取」面板手动触发。
8. **Python 工具依赖必须沉淀**（2026-06-13）：新增/修改 `server/tools/*` 工具引入新第三方包，**必须同步**改 `server/tools/requirements.txt` + `server/tools/README.md` 工具×依赖映射表。tool-runner 复用宿主机 system Python，不打包 venv，依赖必须可被 `pip install -r server/tools/requirements.txt` 一键复现，否则 `/run` 会以 `ModuleNotFoundError` 失败。

---

## 三、关键决策沉淀

**聚合/提取/SQL**
- `tool-free LLM 通道`= `/api/llm/prompt` 用 `runPiPrompt` + 独立 `DIRECT_LLM_ROOT`：聚合数据以**文本内嵌**而非文件路径传递，pi agent 工具无明细可读 → 风险可接受。**只能发文本，不能发文件路径**。
- 导出与路径注册**两步走**：export API 只写 CSV，前端再调 `addWorkspacePath` 注册，后端不耦合工作区逻辑。
- SQL 校验用**关键词+模式双重正则**（~40 行，无依赖），不用 AST 解析器（太重、方言兼容差）。
- trace 写入由可选 `workspaceId` 触发，保持计算工具模块独立性。
- 提取工具 manifest 扩展 `riskLevel/allowedUse/forbiddenUse/failureHandling/traceFields`。
- **tool-use 数据源约束（2026-06-12 修订）**：旧"试跑"模式已作废。新管理控制台模式不在此跑工具；analysis 工具由 pi-agent 经 MCP 调用，后端 `POST /api/extraction-tools/:id/run` 的 `source=ai` 守卫强制输入必须是已登记 clean_data，draw_data 永久禁止（403）。ingestion 工具由「数据提取」面板手动触发。
- **tool-use 与 ExtractionPane 差异**：ExtractionPane 允许手动输入任意本地路径（通用提取工具），ToolUsePane 仅允许 clean_data 已登记路径（计算工具链安全约束）。
- **工具用途分类体系（2026-06-12）**：`ExtractionToolManifest.category` ∈ `"ingestion" | "analysis"`，由 `registry.ts` 的 `normalizeCategory` 默认 `"ingestion"`。`ingestion`=读 HTML/原始 Excel 等半结构化数据，仅「数据提取」面板手动触发，不向 AI 暴露；`analysis`=读 clean_data 聚合 CSV 产出分析结果，经 MCP 暴露给 pi-agent。分类是 manifest 内禀属性，UI 只展示不强改。
- **ToolUsePane 定位修正（2026-06-12）**：推翻旧"试跑"设计（选 clean_data 跑工具产出结果），重做为**管理控制台**（列表/详情/验证/跳 ToolLab）。工具新增/修改的代码仍由开发者放 `server/tools/`，UI 不写代码、不在此跑用户数据。理由：tool-use 的工具是给 pi-agent 经 MCP 用的，前端不该像数据提取那样"在 UI 拿工具跑用户数据"。
- **analysis 工具筛选原则（2026-06-13）**：MCP 暴露给 pi-agent 的 analysis 工具应满足 ① 强领域特色（行业 know-how，不可被通用 SQL/duckdb 替代）② 算法复杂度足（如 STL/Holt-Winters，不是单条 `df.describe()`）③ 单输入聚合 CSV 即可产出结构化结论。**反例**：`csv-summary-stats`（dtype/缺失率/min/max/mean）这种描述统计被判定"太简单不该建"——它属于**探索模块**本职范畴（前端 duckdb-wasm `computeProfile()` 已覆盖），让 LLM 通过 MCP 重做一遍纯属浪费 token。**正例**：apparel-structure（服饰六大行业指标）/ seasonal-forecast（STL+Holt-Winters）。
- **可选字段缺失处理范式（2026-06-13）**：当 CSV 缺可选字段（如 apparel-structure 缺"商品编号"），**必须返回 None 让该指标完全不出现在输出**，禁止注入伪值（如 `hash(file_path) % 10000` 作伪 ID 会让 SKU 宽深度恒为 1，误导用户）。MD 渲染层用 `if metric in r:` guard 跳过缺失项。这是分析工具数据完整性的核心约束。
- **时序预测 CI 必须扇形扩张（2026-06-13）**：Holt-Winters / ARIMA 等序列预测的 95% 置信区间应随预测距离平方根扩张（`band = 1.96 * sigma * sqrt(h)`），不能用单一 sigma 平铺所有期。平铺会让用户严重低估远期不确定性。如 statsmodels 直接给的 `model.get_prediction()` 也支持，自实现需注意此点。
- **会员价值三件套设计原则（2026-06-13）**：RFM / CLV / Cohort 三工具构成"会员价值方法论"闭环——RFM 做现状分群、CLV 做未来预测、Cohort 做时间维度留存。三工具均吃去标识客户级聚合 CSV，产物为聚合层（群均值/分层/矩阵），不含原始客户行。每个工具在 manifest description + 代码里声明并校验期望列，缺列给清晰中文报错。
- **BG/NBD + Gamma-Gamma 纯算法实现（2026-06-13）**：CLV 工具用 `scipy.optimize.minimize`(Nelder-Mead) + `scipy.special.{gammaln,hyp2f1}` 自实现似然函数，不引 lifetimes 第三方库。scipy 已是 statsmodels 的传递依赖（seasonal-forecast 在用），无需新增依赖。参数空间做 log-transform 保证正约束；3 seed 多起点防局部最优；拟合失败回退均值估计并标注 `fallback=true`。
- **cohort 粒度硬校验策略（2026-06-13）**：cohort-retention 严格要求事件级表（同一 customer_id 多行），`总行数 < 客户数 × 1.2` 时报错"数据粒度不符"。**不做近似**——客户级单行汇总表（仅含首/末购日 + 频次）无法重建事件序列，强行近似会误导用户。若生产数据无事件级表，该工具在生产上会触发合规报错（设计如此）。
- **共享工具模块 `_tool_utils.py`（2026-06-13）**：提取 `find_col` / `run_tool` / `main_tool` 三个在 rfm/clv/cohort 中完全重复的函数。`main_tool` 统一 argparse + 参数解析 + 异常兜底，各工具只需提供 `process_fn` / `format_fn` / `report_suffix`。新 analysis 工具应复用此模块，不再复制样板代码。
- **D-v3 进阶算法工具设计原则（2026-06-13）**：4 工具（market-basket/churn-risk/clustering/aarrr-flow）全部纯 numpy/scipy/pandas 实现，不引入 sklearn/mlxtend/lifelines 等未装依赖。算法选型优先"已装依赖可实现"而非"最省代码"——Apriori 纯 numpy 而非 mlxtend、KM 纯 numpy 而非 lifelines、K-means 纯 numpy 而非 sklearn。每个工具声明并校验期望列，缺列清晰报错；产物均为聚合/衍生（频繁项集、分层统计、群均值、转化率），不含原始行。输入按红线新政策可读 draw_data 明细，输出只含聚合产物。

**hooks 管理（D-v4, 2026-06-14）**
- **server 端白名单校验是唯一安全门**：`coerceHook` 用 `SUPPORTED_HOOK_EVENTS`（11 种 event）和 `SUPPORTED_HOOK_ACTIONS`（仅 command|log）做 Set 白名单，外发动作（http/webhook 等）类型层不暴露 + server 拒收双重防护。前端 UI 的灰显/红线提示是 UX 层防御，不能替代 server 校验。
- **PUT /api/hooks 无认证**：本地单用户工具 bind localhost 可接受，已加注释标注。若未来 bind 非 localhost，必须在此加 auth 中间件（command 类 hook 可执行任意 shell 命令，是远程代码执行向量）。
- **hooks.json 与 px-hook-runner 兼容**：`readHooksFile` / `writeHooksFile` 兼容顶层数组和 `{hooks:[]}` 两种格式，统一写顶层数组。`px-hook-runner/index.ts` 的 `loadHooks` 已支持两种格式。
- **trigger 流水倒序扫描**：`readTriggers` 全量读文件后倒序扫描取最近 N 条（limit 上限 5000）。P1 应改 stream 逐行倒读（`readline` + `fs.createReadStream` 反向 seek），避免大文件撑爆内存。
- **HookExtensionInfo 类型未上提 types.ts**：因接缝层 types.ts 由卡 1 拥有，此类型仅在 `web/src/lib/api/data.ts` 内置导出。server 端 `LoadedExtensionInfo` 同结构但独立定义。若后续多模块消费需考虑上提。

**skill 管理（D-v5, 2026-06-14）**
- **跨域调用模式**：skill registry 端点归属 E（engine），前端 client 写在 `api/engine.ts`（注释标明 D 跨域调用）。`SkillManagementPane` 在 D slot 渲染但调 E 端点——这是项目首个 D→E 跨域 UI 模式。
- **全局池 + 按工作区启用**：复用 `RulesPane` 范式——`sharedApi.memory-enablements` (kind="skill")。SkillSelector 在 workspace scope 下并行拉 registry + enablements，按"启用 → 池内 → 文件系统"分组排序。
- **创建/版本更新统一走 POST**：`POST /api/workspaces/:id/skill-registry`，变更原因作为 `<!-- 变更原因 (vN): ... -->` 注释追加到 SKILL.md 末尾（便于回滚溯源）。
- **归档 = DELETE 端点**：文件保留可回滚，UI 二次确认（`window.confirm`）。
- **内联评测替代跨 tab 跳转**：受接缝骨架约束（TabContext 无 `setActiveTab`），改为在本页内联调 `/api/skill-registry/:id/evaluate`，结果回写 score/activationRate 后刷新表格。UI 内提示 "可前往实验室 → skill_eval 查看 evaluationId=..."。
- **SkillSelector 增强**：workspace scope 下叠加 registry 信息——启用项置顶 + 版本号徽章 + 归档项灰禁 + 启用徽标(Sparkles)。非 workspace scope（flow）保持原逻辑。
- **skill 文件路径形态**：`<workspace>/.pi/skills/<slug>/SKILL.md`；用正则 `/\.pi\/skills\/([^/]+)\/SKILL\.md$/` 从 `PiSkill.path` 反查 slug 关联 registry。
- **评测回写**：server 端 `recordSkillRegistryUsageForPaths`（注入埋点累计 `usageCount`）和 `skillRegistryMetricsFromEvaluation`（评测回写 score/activationRate）。
- **code review 关键修复**：`beginUpdate` 保留 `entry.source` 而非硬编码 `"curated"`；低分提示文案用"或"而非"/"；`evalSetId` useEffect 用函数式 setState 避免循环依赖；评测结果从 `lastEvaluation.metrics` 读取而非可能过时的 `entries`。
- **组件拆分**：`CreateSkillModal` + `EvalSkillModal` 独立文件，主 Pane 从 795 行降至 ~430 行。
- **列表分页**：每页 20 条，含翻页控件（`ChevronLeft`/`ChevronRight`），`totalPages` / `paged` 均 `useMemo` 缓存。

**LLM 接入管理（D-v6, 2026-06-16）**
- **真源直写模式**：前端 PUT `/api/llm/providers` / `/api/llm/settings` 直接改写 `~/.pi/agent/{models.json,settings.json}`，不经过 pi CLI、不通过 workspace 隔离。后端 `llm-config.ts` 的 `coerceProviderInput` 做白名单校验 + apiKey 哨兵处理 + 原子写。
- **apiKey 不回显**：`LlmProviderView` 类型层只有 `hasApiKey: boolean`，无 `apiKey` 字段。前端输入框 `type=password` + `autoComplete="new-password"`，value 恒空，用户键入存 `apiKeyDrafts`（组件本地 state），保存时仅在非空时发送。server 端 `shouldKeepPreviousApiKey(""/"****")` 决定保留旧值还是覆盖。
- **OAuth provider 凭证隔离**：OAuth 凭证由 `pi auth` 管理（`auth.json`），本面板只读展示授权态（蓝色 dot + "已授权"标签），apiKey 输入框不渲染。
- **两条独立 dirty/save 链**：providers 链（PUT /api/llm/providers）与 settings 链（PUT /api/llm/settings）各自独立 dirty flag + 保存按钮。**关键修复**：`saveProviders` 成功后若 `settingsDirty` 为 true，自动连发 `saveLlmSettings`——防止删除 model 后 settings.enabledModels 残留孤儿引用，导致 `/api/models` 向下游暴露不存在的 model id。
- **`refreshModels` 回调**：任一保存成功后调 `ctx.refreshModels()`（`App.tsx` 的 `api.listModels().then(setModels)`），让 ChatPane/CreationPane 的 ModelSelect 即时反映启用/默认变更。
- **测试连通**：POST `/api/llm/providers/:id/test`，server 端 `testProvider` 用 `AbortController` 8s 超时 + `replaceAll(key,"****")` 脱敏 message。前端仅对已保存 provider 可测（`isNewProvider || providersDirty` 时禁用）。
- **`key={idx}` 风险**：models 子表用数组索引作 React key，中间删除会导致后续行 input 重新挂载丢焦点。当前以追加为主，影响小；若后续支持拖拽排序需改用稳定 key。
- **opencode write 工具大小限制（第四次触发）**：LlmManagementPane（756 行）分 8 个 `cat >> file <<'EOF'` heredoc 片段拼接落地，每块 < 4K char。

**command 管理（D-v7, 2026-06-16）**
- **全局注册表模式**：commands.json 是全局单文件（`COMMANDS_CONFIG_PATH`），不按 workspace 隔离。与 hooks.json 同为单文件覆盖式 PUT。server `coerceCommand` 为最终裁决——客户端预校验仅做 UX 提示，保存时 server 静默丢弃非法/重复条目。
- **命名契约与 server 对齐**：`SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/` 用于 name / param.key / skillSlug，与 server `coerceCommand` 的 `SAFE_COMMAND_NAME` 完全一致。`param.label` 必填、`type==="select"` 必须有 options、`source` 仅 `"custom"`、`param.source(file)` 仅 `"clean_data"`。
- **skillSlugs 数据源设计权衡**：commands 是全局的，但 skillSlugs 下拉从当前 workspace 的 active skill 列表拉取。这是合理妥协——command 实际触发时知道当前 workspace，且 skillSlug 是字符串契约不依赖 workspace。文本输入始终保留作为回退（兼容外部 slug / 未注册 skill）。
- **整体覆盖式 PUT + 丢条目提示**：`saveCommands` 全量 PUT，server 返回清理后的列表。前端比对 `saved.length !== commands.length` 时以红色 error 提示"server 丢弃了 N 条非法命令"，避免用户困惑数据"消失"。
- **race condition 防护**：skill fetch 的 `useEffect` 加 `cancelled` flag，防止 workspace 快速切换时旧响应覆盖新结果。`reload` 的 `useCallback` 稳定（空 deps），无 race 风险。
- **opencode write 工具大小限制（第五次触发）**：CommandManagementPane（696 行）分 6 个 `cat >> file <<'EOF'` heredoc 片段拼接落地，每块 < 4K char。与第四次（LlmManagementPane）模式相同。

**数据探索**
- 跨表 JOIN **物化成真实 duckdb 表**(`__joined_<ts>`)而非泛化 SQL → 出图/剖析/洞察管线**零改动复用**；DROP joined 表与源表独立。
- Layer 2 自动洞察**纯算法**：`computeCorrelationMatrix`(duckdb 原生 `corr()` 单查询)、`computeCategoryNumericAssociation`(η²)、`detectDataQualityFlags`(纯 JS)。**绝不用 LLM 生成文案**。
- 手动改列类型走**重新 profile + override map**，stats 按真实 SQL 类型 guard。

**规则记忆（数据部分）**
- AI 提取跳过逻辑用专属列 `kg_nodes.ai_extracted_hash`（仿 `hidden` 列），不用 `tags`（sync 会覆写 tags）。
- 知识图谱 Phase B 用原生 TS + `runPiPrompt`，放弃 LightRAG Python sidecar；图存储继续 SQLite，不迁 Kuzu。
- 记忆注入五源：`biz_ctx → rules → standards → cases → KG`。
- **memory_items CRUD（v2 重构阶段1, 2026-06-18）**：
  - 全局池 + 按工作区启用：与 rule/standard/case/metric 同范式，走 `workspace_memory_enablements(item_kind='memory_item')`。`enableForOrigin` 创建时默认启用。
  - feedback/usage 解耦：直接落 memory_items 表 `positive_signals`/`negative_signals`/`used_count`/`last_used_at` 列，不再与旧 `memory_usage_stats` 合表（item 维度自治）。
  - `updateMemoryItem` 的 `enabled` 字段**必须**联动 `setMemoryEnablement` 同步 enablement 表——`listEnabledMemoryItems` 读的是 enablement 表，不是 item 自身 enabled 列。漏同步会导致禁用不生效。
  - `listEnabledMemoryItems` 必须传 `workspaceId` 到 `listMemoryItems` 利用索引过滤——否则全表扫描后内存筛。
- **fact adapter（v2 重构阶段1, 2026-06-18）**：
  - 设计原则：实时投影、不写表、不接管生命周期。business_contexts/metric_definitions/reference 文件投影为统一 `ProjectedFactItem` 形态参与检索。
  - 数据安全：仅投影元数据（title/content/formula/caliber/filePath/fileSize），不读 draw_data 原始行、不读 reference 文件正文。
  - `ProjectedFactItem` 是 D 域内部类型（type='fact' 暂不入 `MemoryItemType` 联合），回流总控决议后收敛。
  - `listProjectedFacts` 每次调用触发 6 次 DB 查询（3 类 × 各 2 次）；本地 SQLite 数据量小可接受，上生产需加缓存。
- **/memory/items* 路由策略（v2 重构阶段1, 2026-06-18）**：
  - 新路径 `/memory/items*` 承载 memory_item 维度 CRUD + 反馈 + 历史快照；legacy `/memory/feedback` `/memory/injections` 仍在 index.ts 不动。
  - `/memory/items/_/injections` 用 `_` 占位段避免与 `/:itemId` 冲突；当前与 legacy 同源（trace_events 中 MemoryInjectionSnapshot），D-RETRIEVAL 写入 'memory_item' 维度后自动贯通。
  - `parseRiskFlags` / `coerceRiskFlags` 已补 severity 白名单校验（`low|medium|high`），与 code 白名单同层；路由层复用 `coerceRiskFlags` 而非重复实现。
  - `recordMemoryItemFeedback` 用两分支分别写死列名（`positive_signals` / `negative_signals`），避免动态 SQL 拼接——项目 SQL 风格统一用 `?` 占位符。
- **D-RETRIEVAL 多信号检索引擎（v2 重构阶段1, 2026-06-18）**：
  - 打分公式：`score = 0.45·relevance + 0.2·recency + 0.2·feedback + 0.15·typePriority`。权重内置常量，后续可经 `MemorySelectionPolicy` 注入。
  - relevance：query token ∩ (title+body) token / |query|。复用 `knowledge-graph.ts` 的 `extractWords`/`sharedWordCount` 词法重叠思路（中英文 stopword + 长度≥2 过滤），零新依赖。embedding 作为后续可插拔增强。
  - recency：半衰期 30d 指数衰减 `0.5^(age/halfLife)`。
  - feedback：(pos-neg)/(pos+neg+1) → [0,1]，neutral=0.5。
  - typePriority：constraint(1.0) > fact(0.85) > experience(0.6) > episode(0.4)。
  - 治理过滤（打分前执行，不参与 score）：expired(validUntil < now 或 staleAfterDays 超时)、poison(含 high severity riskFlag)、superseded(被另一条 supersedesId 指向)、suppressed(neg ≥ pos+3)。
  - 候选池 = `listEnabledMemoryItems`(constraint/experience/episode) ∪ `listProjectedFacts`(business_context/metric_definition/reference_file)。
  - scope 过滤：global 通吃所有 targetScope，chat/workflow 只匹配同 scope。与旧 rules 的 scope 过滤同口径。
  - memory_item 作为第 6 个 source kind（priority=25，介于 rules(20) 与 standards(30) 之间），prompt 块格式 `<xanthil-memory-items>...`。
  - `MemorySelectionPolicy.memoryItemTopK` 默认 8；实际入注入数受 token 预算二次裁剪。
  - snapshot.sources 恒定 6 项，每条 source 含 `selected/omittedReason/itemIds`；`memory_item.meta` 暴露 `candidateCount/survivedCount/filteredCount/topK/topScore` 供 V-OBS 观测。
  - `ScoredCandidate.signals` 已计算但未暴露到 snapshot.meta——V-OBS 阶段3 注入检查器需要 per-candidate 分数时补。
  - source 级负反馈压制与 item 级统一用 `SUPPRESS_NEG_DELTA` 常量（=3）。

**Xan数据库**
- 天气直连 Open-Meteo 公开 API（CORS 开放，无需后端代理/Key）；`echarts-for-react` 出图；预置城市 + Geocoding 双模式选城。
- **行业/竞品 走后端而非前端直连**（区别于天气）：因 pi 进程 spawn 在 server 端（`runPiPrompt`），故必须经 `routes/data.ts` 的 `*/analyze` 端点。LLM 产出走「文本输入→结构化 JSON→`extractJson` 去 fenced→防御式 coerce」范式（同 index.ts TOC/KG 套路，但 coerce 在 data 域本地实现，不 import index.ts 私有函数）。
- **数据安全**：行业/竞品属"外部公开情报"层，请求只发用户输入的行业名/品牌名，**不读任何 workspace 原始/聚合数据**——故不违反数据安全铁律，与天气同级（外部数据）。
- pi 默认 model 现可用（memory 旧记的 `deepseek-v4-flash` 报 developer-role 400 已不复现）；server spawn 需要 pi 绝对路径时用 `XANTHIL_PI_BIN` 覆盖（`pi` 是 shell function，`which pi` 解析不到，真实路径 `~/Dev/Env/npm-global/bin/pi`）。
- **行业/竞品长任务"切 tab 续跑"范式**（2026-06-11 hotfix）：长任务（>10s 的 LLM 调用）禁用本地组件 useState 存 loading/data/error，必须用 `web/src/lib/resumableTask.ts` 的 `useResumableTask(key)`。store 在 module 层，promise 不绑组件生命周期，组件 unmount 不影响后台 fetch；mount 时 `useSyncExternalStore` 自动 rehydrate。**key 约定**："业务前缀:" + 业务上下文 id（如 `industry:` + workspaceId）；同 key 重复发起会复用在飞 promise，不重复请求。短任务（秒级 + 已有 useEffect 自动重拉，如 Weather）不必接入。
- **LLM 结构化 JSON 占位符兜底**（2026-06-11 hotfix）：`routes/data.ts:extractJson` 现有 `sanitizeBarePlaceholders` 二级兜底——thinking 模型在无法估算数值时常写裸 `X` / `N/A` / `待定` / `未知`，导致 `JSON.parse` 整段炸返 500。Sanitize 仅在值位置（`:` / `[` / `,` 之后）替换裸非法 token 为 `0`，字符串字面量内部不动；配合 coerce 层 `asNum` 自然 clamp。**新增同类路由（黄金策等）若复用 `extractJson` 模式，建议把 sanitize 提到 `server/src/json-utils.ts` 共用 + 同步加 prompt "数值字段必须阿拉伯数字，无法估算填 0；严禁 X/N/A/待定/未知"**。

---

## 四、踩坑记录

- `listKgNodes` 两个 SELECT 分支（含 `includeHidden=false` 默认路径）**都**要 `ai_extracted_hash AS aiExtractedHash`，否则跳过逻辑失效。
- `pg`/`mysql2` 在 `--experimental-strip-types` 下的 ESM import 兼容性**未验证**；若报错改 `createRequire` 或动态 `import()`。
- WeatherPane：`Record` 常量结尾 `};` 勿写成 `);`；数组访问/`toISOString().split` 返回含 `undefined`，需 `!`/`?? ""` 兜底。
- **resumableTask snapshot 引用稳定性**（2026-06-11）：`useResumableTask` 内用 `WeakMap<Entry, snapshot>` 缓存——`useSyncExternalStore` 要求 `getSnapshot` 在状态未变时返回**同一对象引用**，否则触发 React 18 "getSnapshot should be cached" 警告 + 无限重渲染。任何复制此 hook 到其他模块的人必须保留 WeakMap 缓存逻辑。
- **resumableTask key 命名硬约束**：按字符串拼，不用模板字符串（避免拼写抖动）；同一上下文必须 key 唯一在飞。当前 store 是 module 单例 + 永不 GC，工作区数量级 OK；未来高频 key 需评估 LRU。
- **sanitizeBarePlaceholders 已知不完美点**：字符串型字段被 LLM 写裸占位符（如 `"summary": 待定`）会被替换为 `0` 而非 `""`，前端会显示字面 "0"。可接受（不致命），如需精细化需按字段类型映射，但 parse 时无类型信息——本次不做。
- **scope 对象引用不稳定**（2026-06-12）：`TabContext.folderScope` 来自 `App.tsx`，每帧重建新对象。若 `useCallback` / `useEffect` 直接依赖 `scope`（对象），会导致每帧触发 → API 调用 → setState → 重渲染 → 死循环。**修复**：用 `useMemo(() => scopeKey(scope), [scope])` 转为稳定字符串 key，所有依赖链改用字符串。此模式适用于任何从 `tabCtx` 消费 `folderScope` 的组件。
- **opencode 工具 input arg 大小限制（2026-06-12）**：单次 `write` / `edit` / `bash` 的 input arg 约 16K char 上限，超大 TSX（含中文）会被 JSON parser 截断报 `Unterminated string`。**workaround**：先 `awk 'NR<=N' > tmp` truncate 文件 + 多次 `cat >> file <<'EOF'` heredoc append（每块 < 4K char）。本次 ToolUsePane 重做用此法分 4 chunk 落地。
- **`pd.to_datetime` 静默把整数转纳秒时间戳（2026-06-13）**：用 `pd.to_datetime(df[col])` 检测某列是否是日期列**不可靠**——纯数值列（如 `[100, 110, 120]`）会被静默转为 `Timestamp('1970-01-01 00:00:00.000000100')` 而非 raise，导致后续把销售额误识为日期列。**修复**：检测前先 `pd.api.types.is_numeric_dtype(df[col])` 跳过数值列；并对解析后用 `parsed.notna().sum() >= len(df) // 2` 二次验证。任何"自动列检测"逻辑都应警惕这个陷阱。
- **`argparse` 参数名 dash/underscore 转换（2026-06-13）**：`parser.add_argument("--param-price_bands")` 在 namespace 上是 `args.param_price_bands`（dash 全部转 underscore，但已有 underscore 保留）。Server 端 `index.ts:5065` 通过 `--param-${param.name}` 拼接 CLI 参数，所以 tool.json 里的 `parameters[].name` 用 underscore 就好（如 `inventory_window_days`）；用 dash 也合法但 Python 端访问要相应改。**统一约定：tool.json 参数名用 underscore_case**。
- **`statsmodels` 不在 stdlib（2026-06-13 已收口）**：seasonal-forecast 在函数体内 lazy import `statsmodels.tsa.seasonal.STL` + `statsmodels.tsa.holtwinters.ExponentialSmoothing`（无依赖兜底分支，缺包必 ImportError）。2026-06-13 总控终审打回时确认本条事实，已通过 `server/tools/requirements.txt` 沉淀（`statsmodels>=0.14`，本机 0.14.6）+ `server/tools/README.md` 工具依赖表 + §七 同步登记。**经验教训**：扫描 Python 第三方依赖必须容许任意缩进（`^[[:space:]]*(import|from)`），否则函数体内 lazy import 会被锚定行首的 grep 漏扫——这正是首版 requirements.txt 漏 statsmodels 的根因。
- **lazy import 与 requirements 同步**（2026-06-13）：lazy import 是合理的（启动加速 / 失败回退），但容易让依赖在静态扫描中"消失"。约定：① 任何 lazy import 在 `requirements.txt` 注释里标 "lazy import"；② lazy import 改回顶层 / 删除 / 替换时同步检查 `requirements.txt` 是否还需该包。
- **`hyp2f1` 在极端参数下返回 NaN（2026-06-13）**：BG/NBD 期望交易数计算中 `hyp2f1(r+x, b+x, a+b+x-1, z)` 当 `a+b+x-1` 接近 0 或负数时返回 NaN，传播到 CLV 输出。**修复**：`np.nan_to_num(hyp, nan=1.0)` 兜底。任何使用 `hyp2f1` 的地方都应加 NaN guard。
- **`pd.Period` 减法返回 Offset 对象（2026-06-13）**：`(period_a - period_b)` 返回 `pandas._libs.tslibs.offsets.MonthEnd`（非 int），需 `.n` 属性取期数差。老版本 pandas 可能无 `.n`，需 `hasattr` 回退。cohort-retention 已加注释说明。
- **opencode write 工具 input arg 大小限制（2026-06-13 再次确认）**：单次 `write` 约 16K char 上限，超大会被 JSON parser 截断报 `Unterminated string`。**workaround**：① 用 `write` 写前半 + `cat >> file <<'PYEOF'` heredoc append 后半 ② 或分多个小 `write`。本次三工具均用此法。
- **`find_col` 子串匹配导致列歧义（2026-06-13）**：`_tool_utils.find_col` 的 fallback 逻辑用 `if alias.lower() in col.lower()` 做子串匹配，导致 `items` 列被同时匹配为 `item`（ITEM_ALIASES 含 `item`）和 `items_list`（ITEMS_LIST_ALIASES 含 `items`）。**修复**：在 `build_transactions` 中检测两别名是否指向同一列 + 用 `_is_wide_column` 采样前 20 行判断是否含分隔符（`,;；|\s`），含分隔符走宽表路径，否则走长表路径。**通用教训**：任何依赖 `find_col` 且别名间有子串包含关系的工具，都应在业务逻辑层做二次消歧，不能假设别名匹配唯一。
- **裸 `except Exception` 吞异常信息（2026-06-13）**：`clustering.py` 和 `churn_risk.py` 的 fallback 路径用裸 `except Exception`，不记录任何诊断信息，用户只能看到 `fallback=true` 但不知道原因。**修复**：改为 `except (ValueError, RuntimeError) as e` + 记录 `fallback_reasons` / `fallback_reason` 到输出。**通用约定**：工具 fallback 路径必须记录失败原因，方便用户和后续维护者排查。
- **opencode write 工具大小限制（2026-06-14 第三次触发）**：单次 `write` / `edit` 约 16K char 上限，超大 TSX 会被 JSON parser 截断报 `Unterminated string`。本次 HooksManagementPane（676 行）用分 5 个片段 `write` + `cat` 拼接落地。**通用 workaround**：① 分多个小 `write` 写片段 ② `cat` 拼接 ③ 或用 `bash` heredoc 追加。
- **opencode write 工具大小限制（2026-06-16 第五次触发）**：CommandManagementPane（696 行）分 6 个 `cat >> file <<'EOF'` heredoc 片段拼接落地，每块 < 4K char。与第四次（LlmManagementPane）模式相同。**经验**：含大量 Tailwind class 的 TSX 组件 > 500 行基本必超，预估时直接按 4K/块 分段。
- **opencode write 工具大小限制（2026-06-19 第七次触发）**：RulesPane 重建（455 行 TSX + 中文）远超 16K char 上限，单次 `write` / `edit` / `bash heredoc` 均被 JSON parser 截断报 `Unterminated string`。**workaround**：分 3 个 `write` 写到临时文件（`_render_part1/2/3.txt`），再用 `cat` 拼接 `>>` 追加到目标文件。**通用策略**：> 400 行 TSX 新文件 → ① write 骨架（~20 行）→ ② 逐函数 edit 替换（每段 < 200 行）→ ③ 最后 edit 追加尾部子组件。edit 的 oldString 匹配比 heredoc 拼接更安全。
- **subagents 管理 D·P0 前端决策（2026-06-16）**：SubAgentManagementPane 仿 CommandManagementPane 的左列表 + 右表单 + 全量覆盖式 PUT 模式。ToolPicker 复用 `api.listExtractionTools()` 拉工具清单，按 `category` 分组、`riskLevel` 徽章，支持过滤 + checkbox 多选 + 文本兜底。`hasExternalUrl` 是 server `coerceSubAgentTemplate` 逻辑的前端副本（仅 UX 校验，最终裁决在 server），注释标明同步要求。`Field` 组件在 CommandManagementPane 与 SubAgentManagementPane 中重复——按 "third use" 原则暂不提取，下次新增 pane 时提为共享组件。dataScope UI 不提供 draw_data 选项，`updateSelected` 强制覆盖 `dataScope: "clean_data"` / `source: "custom"`。

**统一记忆面板 D-PANEL（v2 重构阶段3, 2026-06-19）**
- **RulesPane 重建为多 tab 面板**：5 个 tab（constraint/experience/episode/fact 投影/review 复核），每个 tab 独立渲染，用 `activeTab` state 切换。tab 标签带计数徽章（`grouped.get(type)?.length` / `facts.filter(enabled).length` / `reviews.length`）。
- **busyId 防并发模式**：所有异步操作（toggle/save/delete/feedback/create/accept/reject）共享 `busyId` state，操作中禁用同条目按钮，防止双击重复请求。`submitCreate` 用哨兵值 `"__create__"` 避免与真实 id 冲突。
- **refresh 拆分策略**：`refreshData`（items + reviews，仅依赖 workspaceId）与 `refreshPreview`（preview，依赖 workspaceId + previewScope）独立 `useCallback` + `useEffect`，避免切换 chat↔workflow scope 时重取 items。各 CRUD 操作后调 `refreshPreview()` 保持预览即时更新。
- **acceptReview 空守卫**：`api.acceptMemoryReview` 可能返回 `undefined`（review 已被另一 tab/session 处理），必须 `if (!out)` 检查并清理 stale review。
- **rejectReview 取消处理**：`window.prompt` 返回 `null` 时（用户点取消）应提前 return，不发送空 reason 请求。
- **server /memory/preview try/catch**：`buildMemoryPrompt` 可能抛异常（如 workspace 无 memory_items 表），必须 try/catch 返回 500 而非裸异常泄露。
- **CasesPane 退役策略**：`DataTabs.tsx` 中 `rule_memory.cases` 子 tab 渲染替换为 Placeholder，`CasesPane.tsx` 文件保留、子 tab 列表（`constants.ts`）不动——接缝层归总控，D 域只改渲染。

---

## 五、未验证 / 历史待办（真实优先级见 KICKOFF-P0）

- **SQL连接真实库端到端**（未接真实 PostgreSQL/MySQL 跑过）→ 并入 KICKOFF P0-C（E 域协作）。
- 提取工具 `TOOL_COLUMNS` 前端硬编码，中期迁 `tool.json` manifest `resultColumns`。
- SQL 参数化查询(`{{start_date}}`)、增量取数水位线、Python 子进程隔离 — 历史 P1。
- 商圈/行业/竞品/the-crowd 看板待建（数据源待定）。
- Python 工具运行时缺依赖的"友好提示"（ImportError → summary.json 引导 `pip install`）与 server 启动 `pip check` / import 预热 — 低优可选增强（见 §0 下一步 ④⑤）。

---

## 六、P1 前置：指标语义层（总控定契约，D 实现）

总控将在 `server/src/types.ts` + `web/src/types.ts` 定义 `MetricDefinition`（id/name/expression/grain/caliber/lineage/version…，草案见 `KICKOFF-P0.md`）。D 负责：`db/data.ts` 建 `metrics`/`metric_lineage` 表 + `routes/data.ts` CRUD + `IndicatorsPane` 升级为可执行 metric store。E 写 SQL / V 看板取数**强制引用** metric，根治"同一指标多口径"。

---

## 七、Python 工具运行依赖（D-v2 终审遗留，2026-06-13）

`server/tools/*` 下 `runtime: python3` 的工具由 `/api/extraction-tools/:id/run`（`server/src/lib/tool-runner.ts`）直接调用宿主机 `python3` 执行，**不打包 venv**。新机器/新部署必须先装依赖，否则 `/run` 会以 `ModuleNotFoundError` 失败（错误会出现在 `summary.json` 的 stderr 字段）。

清单与版本见 `server/tools/requirements.txt`，安装：

```bash
pip install -r server/tools/requirements.txt
# 校验
python3 -c "import pandas, numpy, scipy, statsmodels, bs4, openpyxl, xlrd; print('ok')"
```

覆盖范围：
- 9 个分析工具：apparel-structure / churn-risk / clv-prediction / clustering / cohort-retention / market-basket / rfm-segmentation = pandas + numpy（+ scipy 仅 clv-prediction）；**seasonal-forecast = pandas + numpy + statsmodels**（STL + Holt-Winters，函数体 lazy import，无兜底分支，缺 statsmodels 必 ImportError）；aarrr-flow = pandas + numpy。
- 4 个摄取工具：phone-cleaner = pandas + openpyxl(.xlsx) + xlrd(.xls)；extract-sycm-member = beautifulsoup4（用 `html.parser`，**不需 lxml**）；extract-tmall-profile / extract-xhs-insight 仅标准库。

新增依赖时同步改 `server/tools/requirements.txt` + `server/tools/README.md`。
