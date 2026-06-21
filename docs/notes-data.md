# 数据基座域 · 领域笔记（Agent-D）

> **活文档**：长效领域知识（约束/决策/踩坑/未验证清单/文件地图），由 D 在开发中持续维护。
> 蒸馏自旧 handoff：`计算工具` `Xan数据库` `规则记忆`(数据部分) `探索`(数据探索部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前的版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

> 📌 **v2.2 已发布（2026-06-20，总控）**：2026-06-11→06-20 全域交付已归档进 `docs/wiki.html` CHANGELOG v2.2，v2.1 关闭、2.2 阶段启动。本 §0 工作记录由域 owner 续维护。

- 最近更新：2026-06-21 · **记忆 v2.0 缺口1 面板补全（注入预览显式 tag 硬过滤 UI 点亮）**
- 进度：
  - **本期 D-MEM2-PREVIEW-TAGS 卡完成**（依赖 X-MEM2-CTX 契约绿：`RetrievalContext.tags` + 引擎 `filterTags` 硬过滤已就绪）：把「显式结构化精筛」在 RulesPane 注入预览区接通——用户在面板选 tag 即可看到「这些 tag 下会注入哪些记忆」（untagged / 非命中被硬过滤）。纯 D 域接线，接缝零触碰。
    - **① 后端 `server/src/routes/data.ts` GET /memory/preview（:824）**：入参增 tags——复用既有 `readTagsQuery`（同文件 :1121，`?tag=a&tag=b` 重复参数范式）解析 `req.query.tag`；ctx 构造改为 `(query || tags.length) ? { query, tags } : undefined`，透传 `buildMemoryPrompt` → 引擎 `filterTags` 硬过滤。`itemCount` 由全量 `listEnabledMemoryItems().length` 改为**硬过滤后命中数**（OR 命中 `it.tags.some(t => tagSet.has(t))`，与引擎 :363 预过滤同向；**无显式 tags 时退回全量，行为不变**）。
    - **② web api `web/src/lib/api/data.ts` previewMemoryPrompt（:233）**：options 加 `tags?: string[]`，按 `q.append("tag", t)` 重复参数拼接（同 `listPromptTemplates` 范式 :308）。
    - **③ 面板 `web/src/components/RulesPane.tsx` 注入预览区**：新增「模拟检索」控件——独立 state `previewTags: Set<string>` + `previewQuery: string`；跨 type `allTags` memo（预览不分 type 取全量条目 tag）；`togglePreviewTag`；预览块内虚线框控件区（tag chips 硬过滤 + 可选 query 输入 boost + 清除按钮）；`refreshPreview` 带上 tags+query（变更即重拉，依赖数组加 `previewQuery`/`previewTags`）。
- 关键设计决策（详见正文「记忆 v2.0 缺口1：tags 分层标签」段补记）：
  - **预览 tag 用独立 state（`previewTags`），不复用列表 `tagFilter`**：卡里"强烈建议"复用列表 tagFilter 一套驱动列表+预览，但 `tagFilter`/`availableTags` 是 **activeTab type-scoped**（只在 constraint/experience/episode tab 有值），而注入预览**跨 type 全局**。复用会让选 tag 同时污染列表过滤、且 tag 集不全。取"独立控件 + 跨 type `allTags`"路径——更直观零耦合。否决"复用列表 filter"方案。
  - **`itemCount` 硬过滤后命中数在 route 直算，不走 snapshot.sourceCount**：曾试 `buildMemoryInjectionSnapshot().sourceCount`，但 `sourceCount` 统计的是注入**部件/kind 数**（businessContext/rules/standards/cases/KG/memory_item 六类各算一），非单条 item 数，granularity 错。改为 route 内对 `listEnabledMemoryItems` 直接按 tagSet OR 过滤计数，与引擎 :363 同向、口径正确。
  - **不碰 types 接缝**：`MemoryPromptPreview` 维持 5 字段，卡里"可选回带 requestedTagCount"会需要加字段碰 types → YAGNI 跳过，`itemCount` 下降已足够体现"选 tag→条目下降"。
- 校验：
  - `npm run typecheck`（server+web）：✅ 0 错误
  - `npm run build`（web）：✅ 仅遗留 chunk size 警告（与本卡无关）
  - `node --test src/memory-*.test.ts`：✅ **83/83 全过**（本卡未加测：preview tag 过滤逻辑薄，引擎 filterTags 已被既有用例覆盖）
  - 数据探索 LLM 隔离 grep：✅ EXIT=1 无匹配（本卡未碰探索子树）
- 下一步（接续优先级）：
  - ① 本卡可选增强（YAGNI 暂不做）：`requestedTagCount` 回带 + UI 显示「精筛前 N→后 M」（需总控审 types 扩 `MemoryPromptPreview`）；预览 tag 与列表 tagFilter 联动跳转（选列表 tag → 一键带入预览）；query 解析 tag 误命中收口（白名单前缀过滤，见开放问题）。
  - ② 上期遗留：`汇报版本数据可视化` 整条（X 契约未铺，需总控先审 types 双侧加 `datasetId? / chartSpecs?`）。
  - ③ 长尾：`MemoryItemType` 加 `'fact'`、legacy 记忆路由合并、`cases` 子 tab 下线、KB 内联编辑、混合 tokenizer 拆 `text-search-tokenize.ts`、`listMemoryReviews` 分页、`RulesPane.tsx` 拆分（本卡又加 ~35 行，拆分压力略增）。
- 阻塞 / 待总控：
  - 无新阻塞。未碰任何接缝层骨架（`index.ts`/`db.ts`/`App.tsx`/`api.ts`/`constants.ts`/`types.ts` 真源全未碰）；`buildMemoryPrompt` 守冻结签名（仅消费已就绪的 `ctx.tags`，未改签名）。
- 开放问题：
  - **query 解析 tag 的误命中（上期遗留，仍未收）**：`前缀:值` 正则会把 query 里偶然的 `http://`、`时间:10点` 当 tag 信号；本卡预览的 query 输入框同样触发该 boost 解析。当前预过滤"有交集即留"，误命中 tag 若不在候选集则全被过滤 → 召回空（潜在坑）。**升级路径**：解析按软约定前缀白名单过滤（仅认 task/industry/method/data/problem:），或显式 tags 走 RetrievalContext（已就绪，本卡预览的硬过滤已用显式 tags 路径，boost query 仍走词法解析）。
  - **tag 软约定前缀是否硬约束**：当前自由 string、前缀仅软约定（着色+解析宽进任意 `x:y`）。契约明确"非硬枚举便于 LLM 蒸馏与未来收紧"，暂不收。
  - **预览精筛前后计数是否需可视化**：见下一步①，需总控审 types 扩字段决策。

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
| 知识库 knowledge_docs/chunks（D 卡片 2026-06-19） | `KnowledgeBasePane.tsx`(资料库+检索双视图) · `KnowledgeBaseReadmePane.tsx`(readme) | `db/data.ts`(CRUD+chunkKnowledgeText) · `knowledge-retrieval.ts`(BM25) · `routes/data.ts`(/knowledge*) |
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

**统一记忆 memory_items（v2 重构系列）**
- **D-INGEST 语义 dedup 设计原则（2026-06-19）**：词法 dedup（`findMemoryItemDuplicate` title normalize + 子串包含）覆盖不了"同主题措辞差异大"的近重复（如"排查 workflow 失败先看 gate"vs"工作流挂了应该看哪个节点"），升级为**词法兜底 + LLM-judge + 成本门控**三层：① 词法命中即跳过 LLM；② 词法漏判才取同 type 已启用 peer 的 token 重叠 shortlist（前 k=8）；③ shortlist 非空才调 judge，每候选 ≤1 次 LLM。**核心成本门控原则**：LLM 是最后兜底，词法 / shortlist 任一过滤即停。
- **judge 健壮性约束（2026-06-19）**：`judgeSemanticDuplicate` 任何抛错 / 超时 / 非法 JSON 输出一律 catch → null（兜回词法结果），**绝不阻断 ingest**——记忆质量降级远远好于 ingest 失败导致信号丢失。两处 catch 都 `console.warn` 含错误消息，避免静默退化无法观测。LLM 返回的 id 必须在 `allowedIds`（shortlist id 集合）内，防 LLM 幻觉编出不存在的 id。默认 timeout 15s（judge prompt 极小，比 memory-consolidation 的 180s 短一个量级）。
- **token 切分（中英混合）不引外部分词器**（2026-06-19）：`tokenizeForOverlap` 英文非字母数字拆 + lower、中文 2-gram；只服务 shortlist 排序，不追求语言学严谨。原则：dedup gate 是工程性近似，无需 jieba/spacy 级别精度，本期连同语义 judge 一起把准确率撑到目标线。

---

**记忆 v2.0 缺口1：tags 分层标签（D-MEM2-TAG, 2026-06-21）**
- **tags 是检索的"结构化精筛"维度**，弥补"唯 scope/type 两维 + 词法 relevance"在大库下少/准/可控的短板。软分层约定（非硬枚举、自由 string）：前缀 `task:/industry:/method:/data:/problem:`（对齐方法论 5 层）。`normalizeTags` 只做 trim+去空+去重+保序+上限 32，**不校验前缀白名单**——契约明确"便于 LLM 蒸馏产出与未来收紧，零 schema churn"。
- **migration 写在 `initDataTables()` 自己内部，不碰 db.ts 接缝层**：项目无 MIGRATIONS 版本注册器（契约注释里"递增版本注册 MIGRATIONS"是 aspirational 措辞），实际就是 db.ts 既有的 `PRAGMA table_info(t)` + 条件 `ALTER TABLE t ADD COLUMN` idempotent 范式。新库走 CREATE TABLE 自带列，旧库走 ALTER 补列，两路都对。**两表循环**（memory_items + memory_reviews）一段搞定。
- **tag 信号从 query 解析，而非改 RetrievalContext**：`RetrievalContext`（types.ts 真源）是冻结接缝层，只有 `query/recentMessages/dataPaths`，D 不能加 `tags` 字段。故 `parseRequestedTags(ctx)` 从 `ctx.query` 用正则 `/(?:^|\s)([a-z_]+:[^\s，。；,;]+)/gi` 抠 `前缀:值` 形态 token 当请求 tag（用户决策：取零接缝改动路径）。显式 tags 入参等总控审定扩 RetrievalContext 再接。**已知坑**：query 里偶然出现的 `http://` / `时间:10点` 会被误当 tag 信号；当前预过滤是"候选 tag ∩ 请求 tag 有交集即留"，误命中 tag 若不在任何候选 tag 集合里 → 全候选被过滤 → 召回空。升级路径：解析按软约定前缀白名单过滤，或走扩展后的 RetrievalContext。
- **结构化预过滤（"SQL 精筛为主"对齐）先于打分**：请求 tag 非空时，治理过滤同一循环里加一道"无 tag 交集即出局"，收窄候选池后再多信号打分。这把 tag 当硬筛而非软加权——与"指定 tag 时先按 tag 收窄候选再排序"语义一致。`tagMatchScore = 命中数 / |请求 tag|` 归一 [0,1]，再以 0.13 权重叠加。
- **SCORE_WEIGHTS 重新归一不破基线**：四维 0.45/0.2/0.2/0.15 → 五维 0.4/0.18/0.17/0.12/0.13（和=1）。**关键性质**：无 tag 信号时 tagMatch=0，五维退化为原四维的等比例缩放，相对排序不变——既有 11 个 ranking/governance 用例零修改全过。任何后续加打分维度都应保此性质（新维度在"无信号"时贡献 0，老用例才不破）。
- **采纳成 item 不丢标签**：candidate→review→accept 三段路径全程透传 tags（`MemoryIngestInput.tags` → `insertMemoryReview` 落 review.tags → `acceptMemoryReview` 读 review.tags 传 createMemoryItem）。这是契约里 memory_reviews 也要加 tags 列的根因——否则采纳时标签断链。单测 `tags: review accept does not drop tags` 守此不变量。
- **RulesPane tag UI 复用既有范式**：`parseCsvTags` 同 KnowledgeBasePane csv 范式；`tagTone` 按前缀着色（task紫/industry绿/method蓝/data琥珀/problem玫红/其余中性）；筛选 bar 多选 **AND** 语义（选中 tag 全命中才留），与检索预过滤的"交集"方向一致但前端是全包含、检索是有交集——两者口径不同是有意的（面板要精确收窄，检索要宽召回）。
- **注入预览显式 tag 硬过滤 UI（D-MEM2-PREVIEW-TAGS, 2026-06-21）**：GET /memory/preview 入参增 `?tag=`（`readTagsQuery` 解析），ctx 透传 `{query, tags}` → 引擎 `filterTags` 走**显式 tags 路径**（非 query 词法解析），untagged/非命中被硬过滤。`itemCount` 改为硬过滤后命中数（route 内直算 `listEnabledMemoryItems` OR 过滤，**非** snapshot.sourceCount——后者是 kind 部件数 granularity 错）。面板预览区「模拟检索」控件用**独立 state**（`previewTags`/`previewQuery`）+ **跨 type `allTags`**，刻意不复用列表 `tagFilter`（那是 activeTab type-scoped，预览是跨 type 全局）。**两条 tag 路径并存**：预览硬过滤=显式 tags（精确）；boost query 输入框=仍走 query 词法解析（有上述误命中坑）。未碰 types（`MemoryPromptPreview` 维持 5 字段），`requestedTagCount` 回带留待总控审字段。

---


**知识库 knowledge_docs/chunks（D 卡片，2026-06-19）**
- **定位区分（与 memory_items 的边界）**：知识库 = 用户上传/登记的非结构化**参考资料**（按需检索），memory_items = 系统沉淀的**规则/经验/事实/情景**（主动注入 system prompt）。两者目标场景不同：知识库面向"问答时拉一段 SOP/口径文档"，memory_items 面向"每次对话前注入既有约束/经验"。当前**不**自动合并，跨 source 合并（知识库 chunk 是否进 memory_injection prompt）需总控决议。
- **数据安全位面**：folder kind = `'knowledge'`，与 `draw_data`(原始) 严格隔离。文档内容由用户主动提交（upload / 注册元数据），是衍生产物可参与 LLM。`path` 字段当前**仅作元数据**（来源展示），server 端不基于它做 fs 读取——任何后续把 `doc.path` 用于 readFileSync 的代码必须先 `safeResolve()` 工作区沙箱（路由头部已加 grep-able 注释）。
- **分块策略（参 onto-extract.chunkText 但更细粒度）**：budget=1200 chars / overlap=120 chars（约 600~800 tokens 中英混合）。段落优先（`\n\n` lookback），无段落则行（`\n` lookback），都失败才硬切。**修复版**用 `[end..length)` 拼前片（不重复已写区），尾片 ≤ overlap 直接合并避免微碎片。**踩坑**：第一版照抄 onto-extract 的 `[start..length)` 拼法，在小窗口下会让"chunk N+1 是 N 的子串"——BM25 命中倍增 + 存储浪费（review 抓到，已修）。
- **BM25 检索引擎（零新依赖）**：标准 BM25 (k1=1.5, b=0.75, idf +0.5 平滑负值 clamp) + recency (半衰期 60d) + idfBoost (命中稀有词 tie-breaker)，权重 `0.7/0.2/0.1`。relevance 用最大 BM25 归一到 [0,1] 再加权。候选池只对 query token 集合统计 df/tf（bounded by query size，不全词扫）。
- **混合 tokenizer（CJK bigram + ASCII 词）**：ASCII 按空格切（length≥2 + stopword）；CJK 用 char-bigram（"复购率" → "复购","购率"）。比 memory-injection 的 whitespace-split 在中文场景下召回明显更准（whitespace-split 把整段中文切成单 token，BM25 几乎无法工作——这也是 memory-injection 中文召回粗的隐性 bug，但本卡按"最小改动"未动它）。后续提取 `text-search-tokenize.ts` 共享模块时再统一。
- **半衰期 60d 取舍**：相对 memory_item(30d) 慢一倍——知识库存放长期参考资料（口径文档、SOP），不应像即时学习记忆一样快速过期。注释已写在 `recencyScore` 函数上方。
- **5 MB 内容硬上限**：POST + PATCH 都加 413 守卫（`Buffer.byteLength(content, "utf8")`），避免 50MB 文档单同步循环阻塞 Node event loop。超大文档应客户端先拆分再上传。
- **node:sqlite 事务必须用 BEGIN/COMMIT/ROLLBACK**（**不**用 `db.transaction()`）：`node:sqlite` 的 `DatabaseSync` 不存在 `transaction()` 方法（typecheck 会报 `Did you mean 'isTransaction'?`）。本卡用 `db.exec("BEGIN")` + try/COMMIT/catch/ROLLBACK，与 `db.ts:764` 同款。**踩坑沉淀**：第一版照抄 better-sqlite3 风格的 `db.transaction(() => {...})()` 直接 typecheck 失败。
- **`as unknown as Row[]` 必须的两次桥**：`db.prepare().all()` 返回 `Record<string, SQLOutputValue>[]`，TS 直接 `as Row[]` 不合法。本卡用 `as unknown as Row[]`（`getKnowledgeDoc` / `listKnowledgeDocs` / `listKnowledgeChunks` / `listKnowledgeChunksForRetrieval`），与 `data.ts:272` 同款。
- **更新仅在 content 真变时重写 chunks**：`patch.content !== existing.content` 才 DELETE+INSERT，title/tags/path 改动不触发重切分。代价：若未来改 chunk 大小阈值（`KNOWLEDGE_CHUNK_BUDGET`），需新建迁移脚本——不在本卡范围。
- **`ponytail:` BM25 性能上限标注**：当前每次 search 重新 tokenize 全工作区 chunk（O(N·avg_chunk_len)）。本地单用户 + 中小工作区可接受；当 chunk ≳ 5k 或 P95 > 50ms 时加 `(workspaceId, max(updated_at))` → tokens 进程内缓存。注释已加在 `searchKnowledgeChunks` 第一次 tokenize 处。
- **路由 ownership 校验范式**：所有 `/knowledge/:docId` 端点先 `getWorkspace(req.params.id)` 校 workspace 存在 → 再 `doc.workspaceId !== req.params.id` 校归属（403）。与 `/memory/items/:itemId` 同款，本卡新增端点直接复用此 pattern。

---

**知识库 D-PANEL（前端面板，2026-06-19）**
- **单文件双视图模式**：`KnowledgeBasePane({ workspaceId, view })` 按 `view: "docs" | "search"` prop 派发 DocsView / SearchView。避免开两个组件文件 + 共享工具函数（`fmtTs/fmtSize/highlightChunk`）。与 SkillManagementPane 的"管理控制台单一入口"范式一致。
- **上传走纯文本白名单**：`file.text()` 仅接受 `.md/.markdown/.txt/.csv/.tsv/.json/.log`，二进制（pdf/docx）由用户先转 markdown——避免引 mammoth/xlsx 解析依赖到前端 bundle，同时与 server 5MB 守卫匹配。客户端预校验 `file.size > MAX_CONTENT_BYTES` 即拦。
- **检索分数全透明**：每条命中显示 `score/rel/rec/idf` 四个数值（小数点 3 位 + tooltip），便于调试 BM25 ranking weights，无需开发者刷服务端日志。
- **命中高亮用 manual exec loop**：`highlightChunk` 不依赖 `text.split(re)`（capturing group 会导致 alternation 歧义），改用 `while (re.exec(text))` 手动推进 + string/object 判别联合数组。空 token 时返回 `[<span>text</span>]` 统一类型。
- **删除二次确认**：`window.confirm` 明确"级联删除所有 chunks + 不可撤销"语义，与 SkillManagementPane 归档确认范式一致。
- **`group` class 陷阱**：删除按钮用 `group-hover:opacity-100` 但父 `<li>` 缺 `group` class → 按钮永久 `opacity-0` 不可见。review 抓到，已修。**通用教训**：任何 Tailwind `group-*` 修饰符必须确认父元素有 `group` class；`group-hover` 与 `hover` 同时存在时，`hover` 在父元素上也需 `group` 才能级联。
- **`new Blob()` 每击键分配**：新建模态用 `new Blob([draftContent]).size` 显示实时字节数，每次击键分配 5MB 上限的 Blob。review 建议改为 `new TextEncoder().encode(draftContent).length`——零分配、同结果。已修。
- **SearchView docs fetch 补 cancelled flag**：DocsView 的 detail fetch 有 cancelled，SearchView 的 doc list fetch 缺——review 抓到，已补 cleanup。
- **文档列表无分页**：当前全量加载，<100 docs 够用。超 500 时加分页（或至少加个 note）。暂不做。
- **内联编辑 UI 缺失**：PATCH 端点已就绪但前端只有新建+删除，无编辑入口。需总控确认是否本期补还是下期。

---

**prompts 模板库 prompt_templates（D 卡片，2026-06-19）**
- **定位区分（与 memory_items 的边界）**：prompt_templates = 用户自定义的可复用 **prompt 文本模板**（含 `{{变量}}` 占位），调用方各自渲染；memory_items = 系统沉淀的规则/经验/事实/情景，主动注入 system prompt。两者互不混用——本表不参与 `buildMemoryPrompt`，由调用方（chat / workflow / 工具）按需取用。系统 prompt 只读聚合走 E 卡（subagents/hooks/skills/system_prompt 源），与本表是平行的两条 prompt 来源。
- **workspace_id 可空 = 全局模板范式**：`prompt_templates.workspace_id` 列不带 NOT NULL，`NULL` 即全局模板（所有 ws 可见可读）。`listPromptTemplates(ws, { includeGlobal: true })` 默认返回 `(本 ws ∪ 全局)`，`includeGlobal: false` 仅本 ws。**与 memory_items 的差异**：memory_items 用 `scope='global'` 列表达，本表用 NULL 直接走列约束（少一列，省一处过滤）。两套范式都合法，**新表选哪种看是否需要"列出仅全局"这种独立维度**——memory_items 的 scope 还要区分 chat/workflow，本表只要二元 ws-scoped vs global，所以 NULL 够用。
- **`{{变量}}` 仅存储不渲染**：`extractPromptVariables(body)` 用 regex `/\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g` 抽取占位符 name 列表（去重保序），存到 `variables` 列。**渲染（替换/校验）由调用方负责**——data 层不做变量校验、不做缺失变量报错、不做类型检查。这样设计是因为同一模板可能被 chat / workflow / 工具用不同方式渲染（chat 走用户输入，workflow 走 node param，工具走 manifest）。
- **body 改动 → 自动重抽 variables，但 patch 显式传 variables → 以 patch 为准**：`updatePromptTemplate` 检测到 `patch.body !== existing.body` 且 `patch.variables === undefined` 时自动重抽并写入；若 patch 同时显式传了 variables（例如用户手动维护变量描述），patch 优先。**这避免两种问题**：① 用户改 body 但忘了改 variables 列导致漂移；② 用户故意删除某变量但保留旧 body 的过渡期。
- **tags JSON 数组 LIKE OR 兜底范式（可复用）**：tags 列存 `JSON.stringify(string[])`，过滤用 `tags LIKE ?` + param `%"<tag>"%`。**关键点**：① `%"<tag>"%` 用引号包夹 tag 子串，避免 `"ab"` 误中 `"abc"`；② tag 内含 `% _ " \` 这类 SQL/JSON 元字符的直接拒（`/[%_"\\]/.test(t)` filter 掉），不走 ESCAPE——标签量级 < 1k 用不到，简单优先；③ 多 tag OR 用 `(tags LIKE ? OR tags LIKE ? ...)`。**ponytail 标注**：注释里写明"chunk ≳ 5k 或 P95 > 50ms 时升级 FTS / 单独 tags 表"。后续 prompts 面板搞按调用次数排序、按 enabled 分组之类的聚合需求才需要重构。
- **路由 ownership 校验范式（与 knowledge 同款）**：所有 `/prompt-templates/:tid` 端点先 `getWorkspace(req.params.id)` 校 workspace 存在 → 再判 `tpl.workspaceId !== null && tpl.workspaceId !== req.params.id`（403）。全局模板（`workspaceId === null`）任意 ws 可读/可改/可删——这是设计意图，全局模板是共享资产。本卡新增端点直接复用此 pattern。
- **256 KB body 上限**：远小于知识库 5 MB——prompt 模板量级合理上限是 token-级（约 256K bytes ≈ 60K~80K tokens 中英），更大应当拆模板。POST + PATCH 都加 413 守卫。
- **X 接缝缺漏的工程教训**：本卡触发时发现 wiki §X 标 done 但仓库实际只落地 web 端（constants），types 双侧 + db schema 均缺。**通用做法**：D 卡执行前先 grep 验证 X 卡声明的资产是否真落地（`grep -rn "PromptTemplate\|prompt_templates" server/ web/src/types.ts`），漏盘的就在本卡内一并补救（顺手做不绕路），开放问题里上报让总控决议。**反对**：等 X 卡修好再做 D（任务卡明确写【依赖】X，但 wiki 标 done 是可信凭证缺失，等待会导致整个 prompts 模块阻塞）。沉淀这条是因为同样的"声明 done 但未落地"模式可能在其他模块（hooks/skills/subagents）的 X 接缝里复现。

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
- **chunker overlap 拼前片必须用未读区 `[end..length)` 而非已写区 `[start..length)`（2026-06-19）**：知识库 `chunkKnowledgeText` 第一版照抄 `onto-extract.chunkText` 拼法（`chunks[last] += slice(start)`），在小 budget(1200)+无段落断点场景下产生 `[1200, 121, 239]` 末两片是同一段 tail 的重复——chunk N 与 chunk N+1 完全包含 chunk N+2，BM25 命中倍增 + 存储浪费。**修复**：尾片 ≤ overlap 时拼 `slice(end)`（未读尾巴），不再拼 `slice(start)`（重叠区已写过）。回归测试断言"任意 chunk 不可全包含另一 chunk"。**通用教训**：任何 sliding-window 切分代码改 budget/overlap 时，必先用 (budget, budget+1, 2·budget, 3·budget) 边界值跑一遍打印 chunks lens 看分布。
- **Tailwind `group-hover` 必须确认父元素有 `group` class（2026-06-19）**：KnowledgeBasePane 删除按钮用 `group-hover:opacity-100` 但父 `<li>` 缺 `group` → 按钮永久 `opacity-0` 不可见。review 抓到，已修。**通用教训**：任何 `group-*` 修饰符（`group-hover`/`group-focus`/`group-data-*`）必须确认直接父元素或祖先有 `group` class；`hover` 与 `group-hover` 同时存在时，`hover` 在父元素上也需 `group` 才能级联。建议写 `group-*` 后立刻 grep 确认 `group` 存在——这个 bug 肉眼很难发现（按钮在 DOM 里，只是透明）。


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
