# 数据基座域 · 领域笔记（Agent-D）

> **活文档**：长效领域知识（约束/决策/踩坑/未验证清单/文件地图），由 D 在开发中持续维护。
> 蒸馏自旧 handoff：`计算工具` `Xan数据库` `规则记忆`(数据部分) `探索`(数据探索部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前的版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-11 · Xan数据库 3 个 hotfix（行业/竞品续跑 + 竞品占位符 500 容错）
- 进度：
  - **hotfix-1 · 行业/竞品 tab 切回进度不丢**：新建 `web/src/lib/resumableTask.ts`（module-level store + `useSyncExternalStore` hook）；`IndustryPane.tsx` / `CompetitorPane.tsx` 删本地 loading/error/data 三 useState，换 `useResumableTask`。key = `industry:` + workspaceId / `competitor:` + workspaceId。**Weather 未改**（open-meteo 秒级返回 + useEffect 自动重拉，体感无丢失，按总控授权取舍）。
  - **hotfix-2 · 竞品 `marketSharePct: X` 致命 500**：`routes/data.ts` 的 `extractJson` 失败时跑 `sanitizeBarePlaceholders`（字符串感知扫描器，仅替换值位置裸非法 token → `0`），重试 parse；行业 + 竞品 prompt 末尾补 "数值字段必须阿拉伯数字，无法估算填 0；严禁 X/N/A/待定/未知"。7 个 mock 用例（含 X / N/A / 中文占位符 / 嵌套 / 数组 / 字符串内 X / 合法 JSON）全过。
- 校验：
  - `cd server && npm run typecheck`：✅ 全绿
  - `cd web && npm run build`：✅ 全绿（2026-06-11 总控终审复跑；此前 `BusinessRequirementPane.tsx` 的 3 个 ts2552 已被 V 域「续传推广」改造一并修复，build 阻塞解除）。
  - 数据探索 LLM 隔离 grep：✅ 空匹配
- 下一步：
  - ① 行业/竞品 真机回归（tab 切走→1 分钟后切回是否仍在转圈/出结果）由用户实测。
  - ② `extractJson` 同源风险：黄金策、未来其他结构化 JSON 路由若复用该模式，建议把 `sanitizeBarePlaceholders` 提到 `server/src/json-utils.ts` 复用 + 同步加 prompt "禁占位符" 文案。
  - ③ `resumableTask` store 永不 GC，当前 key 量级（workspace 数）可忽略；未来若挂到探索/聚合等高频 key，需评估 LRU。
- 阻塞 / 待总控：无（hotfix 链路 typecheck 全绿、mock 验证全过）。
- 开放问题：
  - V 域 `BiDashboardPane.tsx:37` 直接 fetch 漏 `/data` 后缀（历史项，未核实是否已修）。
  - 「行业/竞品」属外部公开情报，pi 实际"联网"能力取决于 pi cli 自身工具；当前 prompt "有联网优先检索"，未强约束真实检索。
  - ~~web typecheck 被 `BusinessRequirementPane.tsx` 阻塞~~ **已解决**（2026-06-11：V 域续传推广改造该 Pane 时清掉 setGenerating/setClarifying 未定义错误，`npm run build` 全绿）。

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| 计算工具·聚合 | `AggregatePane.tsx` · `lib/aggregate.ts` | `routes/data.ts`(新) |
| 计算工具·提取 | `ExtractionPane.tsx` | `server/tools/registry.ts` + `server/tools/*` |
| 计算工具·SQL | `SqlConnectPane.tsx` | `sql-connections.ts` |
| 数据探索 | `DataExplorationPane.tsx` + `data-exploration/*` · `lib/{duckdb,profiling,insights,joins}.ts` | 仅二进制文件流，**零 LLM** |
| 指标/业务环境/rules/案例 | `IndicatorsPane` `BusinessContextPane` `RulesPane` `CasesPane` | `db/data.ts`(新) · `memory-injection.ts` |
| Xan数据库 | `WeatherPane`(前端直连) · `IndustryPane`/`CompetitorPane`(经后端 pi) + 待建[商圈/the-crowd] | 天气=外部 API 前端直连；行业/竞品=`routes/data.ts` 的 `*/analyze` 经 `runPiPrompt` |

db 新表建在 `db/data.ts:initDataTables`；HTTP 走 `routes/data.ts`；前端方法进 `lib/api/data.ts`。

> **导航变更（2026-06-10 快修，脚手架）**：
> - **规则记忆 6 大模块**：`rules`→偏好记忆 / `indicators`→指标记忆 / `cases`→项目记忆（仅 label 改，id 与后端不动）；新增 `failure_memory`失败记忆 / `field_memory`字段记忆 / `process_memory`流程记忆（**占位 Placeholder**，后端 db/路由/api/pane + 记忆注入待补，参照 rules/indicators/cases 并接入 `App.tsx refreshRulesPromptInfo` 合计）。业务环境/trace/知识图谱保留并列。
> - **计算工具**新增二级 `tool_use`（tool-use，占位）。
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

---

## 三、关键决策沉淀

**聚合/提取/SQL**
- `tool-free LLM 通道`= `/api/llm/prompt` 用 `runPiPrompt` + 独立 `DIRECT_LLM_ROOT`：聚合数据以**文本内嵌**而非文件路径传递，pi agent 工具无明细可读 → 风险可接受。**只能发文本，不能发文件路径**。
- 导出与路径注册**两步走**：export API 只写 CSV，前端再调 `addWorkspacePath` 注册，后端不耦合工作区逻辑。
- SQL 校验用**关键词+模式双重正则**（~40 行，无依赖），不用 AST 解析器（太重、方言兼容差）。
- trace 写入由可选 `workspaceId` 触发，保持计算工具模块独立性。
- 提取工具 manifest 扩展 `riskLevel/allowedUse/forbiddenUse/failureHandling/traceFields`。

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

---

## 五、未验证 / 历史待办（真实优先级见 KICKOFF-P0）

- **SQL连接真实库端到端**（未接真实 PostgreSQL/MySQL 跑过）→ 并入 KICKOFF P0-C（E 域协作）。
- 提取工具 `TOOL_COLUMNS` 前端硬编码，中期迁 `tool.json` manifest `resultColumns`。
- SQL 参数化查询(`{{start_date}}`)、增量取数水位线、Python 子进程隔离 — 历史 P1。
- 商圈/行业/竞品/the-crowd 看板待建（数据源待定）。

---

## 六、P1 前置：指标语义层（总控定契约，D 实现）

总控将在 `server/src/types.ts` + `web/src/types.ts` 定义 `MetricDefinition`（id/name/expression/grain/caliber/lineage/version…，草案见 `KICKOFF-P0.md`）。D 负责：`db/data.ts` 建 `metrics`/`metric_lineage` 表 + `routes/data.ts` CRUD + `IndicatorsPane` 升级为可执行 metric store。E 写 SQL / V 看板取数**强制引用** metric，根治"同一指标多口径"。
