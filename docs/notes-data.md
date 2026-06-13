# 数据基座域 · 领域笔记（Agent-D）

> **活文档**：长效领域知识（约束/决策/踩坑/未验证清单/文件地图），由 D 在开发中持续维护。
> 蒸馏自旧 handoff：`计算工具` `Xan数据库` `规则记忆`(数据部分) `探索`(数据探索部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前的版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-13 · **D-v3 进阶算法工具（4 工具 + code review 修复）**
- 进度：
  - **新增 4 个 analysis 工具**（纯 numpy/scipy/pandas，未引入新依赖）：
    - `market-basket`：Apriori 频繁项集 + 关联规则（support/confidence/lift），支持长表（order×item）与宽表（order + items 分隔符串）双格式
    - `churn-risk`：Kaplan-Meier 群体存活估计 + 特征劣势分位综合打分 → 4 层风险分层（低/中/高/极高），含 KM 拟合 fallback
    - `clustering`：纯 numpy K-means++ 多重启 + 肘部+轮廓综合选 k，输出各群标准化与原始空间均值画像
    - `aarrr-flow`：阶段人数时序 → 阶段间转化率 + 整段关系加深率 + 环比变化 + 趋势探测（improving/stable/declining）
  - 4 工具均含 `tool.json`（全字段：riskLevel/allowedUse/forbiddenUse/failureHandling/parameters/resultColumns）+ `tests/cases.json`（各 4-5 个 case：field-presence + must-fail×3-4）+ `tests/fixtures/`
  - **code review 修复（2026-06-13）**：
    - 删除 `clustering.py` 死代码 `ids` 变量
    - 两处裸 `except Exception` → `except (ValueError, RuntimeError) as e` + 记录 fallback 原因（`clustering.py` / `churn_risk.py`）
    - `clustering.py` 距离矩阵从 `(n,k,f)` 一次性分配 → 逐中心分批计算（消除大样本 OOM 风险）
    - `market_basket.py` 修复 `find_col` 子串匹配导致 `items` 列被同时匹配为 `item` 和 `items_list` 的 bug，增加 `_is_wide_column` 自动检测分隔符判断格式
    - 新增 2 个测试 fixture：`market-basket/wide.csv`（宽表格式）、`churn-risk/no-monetary.csv`（无 monetary 可选列）
  - **工具总数**：13（9 analysis + 4 ingestion），全部被 registry 自动加载
- 校验：
  - `npm run typecheck`：✅ server + web 全绿
  - `npm run build`：✅ 全绿
  - 数据探索 LLM 隔离 grep：✅ 空匹配
  - 4 工具主路径全部用合成数据跑通（market-basket: beer→chips lift 5.0；churn-risk: KM 365 天降至 7%；clustering: 自动选 k=3 silhouette 0.84；aarrr-flow: 整段加深率 2.48% improving）
  - 4 工具错误路径全部验证（缺列/数据过少/非法扩展名）
  - 未引入 sklearn / mlxtend / lifelines 等未装依赖
- 下一步（接续优先级）：
  - ① **真机回归 ToolLab + tool-use 列表**（D-v2 遗留）：aggregate → tool-use 确认 13 工具列表 / 筛选 / 详情 / cases 查看正常
  - ② **pi-agent 经 MCP 端到端验证**（D-v2 遗留）：pi-agent 通过 MCP 调 analysis 工具，看输出能否被 LLM 正确解读
  - ③ **cohort 数据可用性确认**（D-v2 遗留）：确认是否有事件级订单流水可用
  - ④ **D-v3 工具生产数据验证**：用真实 clean_data 跑 4 工具，确认参数默认值合理、输出可解读
  - ⑤ （可选增强）暴露 `select_k` 权重（0.6/0.4）与 churn 混合权重（0.7/0.3）为 tool.json 参数
- 阻塞 / 待总控：
  - **clean_data 路径白名单**：Python 端无 `draw_data` 路径检查，纵深防御仅靠 server 端 `source=ai` 守卫
  - **cohort 数据源**：见下一步 ③
- 开放问题：
  - clean_data 路径白名单（Python 端纵深防御是否补强）
  - cohort-retention 在生产数据上能否实际产出（依赖事件级订单表）
  - `select_k` 与 churn 混合权重是否暴露为参数（当前硬编码，见下一步 ⑤）
  - `api.ts`（接缝层）legacy `listExtractionTools` / `runExtractionTool` 与 D 域 `dataApi` 同名方法并存（待总控收敛入口）

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| 计算工具·聚合 | `AggregatePane.tsx` · `lib/aggregate.ts` | `routes/data.ts`(新) |
| 计算工具·提取 | `ExtractionPane.tsx` | `server/tools/registry.ts` + `server/tools/*`（含 `_tool_utils.py` 共享模块） |
| 计算工具·tool-use | `ToolUsePane.tsx` | 复用 `server/tools/registry.ts` + `index.ts` `/api/extraction-tools*` |
| 计算工具·SQL | `SqlConnectPane.tsx` | `sql-connections.ts` |
| 数据探索 | `DataExplorationPane.tsx` + `data-exploration/*` · `lib/{duckdb,profiling,insights,joins}.ts` | 仅二进制文件流，**零 LLM** |
| 指标/业务环境/rules/案例 | `IndicatorsPane` `BusinessContextPane` `RulesPane` `CasesPane` | `db/data.ts`(新) · `memory-injection.ts` |
| Xan数据库 | `WeatherPane`(前端直连) · `IndustryPane`/`CompetitorPane`(经后端 pi) + 待建[商圈/the-crowd] | 天气=外部 API 前端直连；行业/竞品=`routes/data.ts` 的 `*/analyze` 经 `runPiPrompt` |

db 新表建在 `db/data.ts:initDataTables`；HTTP 走 `routes/data.ts`；前端方法进 `lib/api/data.ts`。

> **导航变更（2026-06-10 快修，脚手架）**：
> - **规则记忆 6 大模块**：`rules`→偏好记忆 / `indicators`→指标记忆 / `cases`→项目记忆（仅 label 改，id 与后端不动）；新增 `failure_memory`失败记忆 / `field_memory`字段记忆 / `process_memory`流程记忆（**占位 Placeholder**，后端 db/路由/api/pane + 记忆注入待补，参照 rules/indicators/cases 并接入 `App.tsx refreshRulesPromptInfo` 合计）。业务环境/trace/知识图谱保留并列。
> - **计算工具**新增二级 `tool_use`（tool-use，2026-06-12 Phase 1 落地，见 §0）。
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

**数据探索**
- 跨表 JOIN **物化成真实 duckdb 表**(`__joined_<ts>`)而非泛化 SQL → 出图/剖析/洞察管线**零改动复用**；DROP joined 表与源表独立。
- Layer 2 自动洞察**纯算法**：`computeCorrelationMatrix`(duckdb 原生 `corr()` 单查询)、`computeCategoryNumericAssociation`(η²)、`detectDataQualityFlags`(纯 JS)。**绝不用 LLM 生成文案**。
- 手动改列类型走**重新 profile + override map**，stats 按真实 SQL 类型 guard。

**规则记忆（数据部分）**
- AI 提取跳过逻辑用专属列 `kg_nodes.ai_extracted_hash`（仿 `hidden` 列），不用 `tags`（sync 会覆写 tags）。
- 知识图谱 Phase B 用原生 TS + `runPiPrompt`，放弃 LightRAG Python sidecar；图存储继续 SQLite，不迁 Kuzu。
- 记忆注入五源：`biz_ctx → rules → standards → cases → KG`。

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
