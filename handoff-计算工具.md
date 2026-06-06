# Handoff Log — 计算工具 · 聚合计算与数据提取

---

## 📌 Session 2 — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 补齐 Session 1 遗留的三个 P1 任务（提取产物预览、聚合结果确认发送 LLM、tool-free 通道），并完整实现 SQL连接 MVP（连接管理 + Schema 浏览 + 查询 + 导出注册）。「计算工具」二级 Tab 从 2 个扩展到 3 个（聚合计算 | 数据提取 | SQL连接）。

**关键决策**:
1. **tool-free 通道用 `runPiPrompt` 实现**：不是真正的无工具 channel，但因为聚合数据以文本内嵌而非文件路径传递，pi 的 agent 工具没有明细可读，风险可接受。
2. **SQL 连接凭证明文存 JSON**：本地单用户工具，无多用户共享场景，不加密。后续如有需求再引入系统 keychain。
3. **导出与路径注册两步走**：export API 只写 CSV 文件，前端再调用已有 `addWorkspacePath` 注册——不在后端耦合工作区逻辑。

**新增阻塞/问题**: 无功能阻塞。SQL 连接模块 [未验证] 真实数据库端到端（本 session 只做了 typecheck）。

**下一步重点**:
1. SQL连接真实场景端到端验证（连接 PostgreSQL 或 MySQL 实测取数 → 导出 → 注册路径）
2. SQL连接 P1 迭代：参数化查询、增量取数水位线

---

### 1. 项目元信息

```
项目名称: pi-xanthil — 计算工具模块
项目类型: 代码开发
Session 编号: 第 2 次交接
本次 Session 起止: 从「P1 任务全部待启动、SQL连接为空占位」推进到「P1 全部完成、SQL连接 MVP 上线」
最后更新: 2026-06-05
```

### 2. 项目目标（North Star）

延续 Session 1，目标范围扩展：

- **一句话目标**: 提供本地优先的数据获取与处理能力（数据库取数 + 表格聚合 + 文档提取），在不向 LLM 暴露原始明细的前提下完成数据分析前的数据准备工作。
- **成功标准**（新增）:
  - 外部数据库查询结果可写入本地 `draw_data` 或 `clean_data` 路径，并注册到工作区。✅（MVP 完成，[待验证]真实连接）
  - 提取产物（MD/JSON）可在页面内直接预览，无需打开文件管理器。✅
  - 聚合结果可经用户确认后直接发送 LLM 分析，响应内联展示。✅
- **明确的非目标**: SQL 编辑器不提供语法补全/高亮（引入 Monaco/CodeMirror 等重型编辑器不在范围内）；数据库凭证不做云端同步。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 顶部「计算工具」入口 | ✅完成 | `MainHeader.tsx` | Tab id = `aggregate` |
| 二级 Tab：聚合计算 / 数据提取 / SQL连接 | ✅完成 | `constants.ts` `AGGREGATE_SUB_TABS` | Session 2 新增 SQL连接 |
| 表格本地读取 + DSL 聚合 | ✅完成 | `web/src/lib/aggregate.ts` | 不变 |
| 聚合结果确认发送 LLM（P1-2）| ✅完成 | `AggregatePane.tsx` | 接收 `model/models` prop，调用 `/api/llm/prompt` |
| tool-free LLM 通道（P1-3）| ✅完成 | `server/src/index.ts` `POST /api/llm/prompt` | 用 `runPiPrompt` + 独立 `DIRECT_LLM_ROOT` |
| 提取工具注册表 + API | ✅完成 | `server/tools/registry.ts` | 不变 |
| 天猫人群画像提取 | ✅完成 | `server/tools/extract-tmall-profile/` | 不变 |
| 提取产物页面内预览（P1-1）| ✅完成 | `ExtractionPane.tsx` + `GET /api/extraction-tools/preview` | 右侧 PreviewPanel，MD/JSON/CSV 差异渲染 |
| ExtractionPane 工具专属列配置 | ✅完成（用户自行完成）| `ExtractionPane.tsx` `TOOL_COLUMNS` | tmall-profile / xhs-insight / phone-cleaner / sycm-member |
| SQL连接 MVP | ✅完成 [未验证真实 DB] | `server/src/sql-connections.ts` `SqlConnectPane.tsx` | SQLite + PostgreSQL + MySQL |
| SQL连接 参数化查询 | ⏳待启动 | — | P1 |
| SQL连接 增量取数 | ⏳待启动 | — | P1 |
| 工具专属参数协议（manifest parameters）| ⏳待启动 | — | P1 |
| Python 子进程隔离 | ⏳待启动 | — | P1 |
| 聚合页 bundle 拆分（SheetJS 动态 import）| ⏳待启动 | — | P2 |

### 4. 关键决策与权衡

**决策 1: tool-free 通道用 `runPiPrompt`（而非真正无工具 API）**
- 选择: `POST /api/llm/prompt` 内部调用 `runPiPrompt`，每次创建独立 fresh session，session 存入 `~/.pi-xanthil/direct-llm/`
- 备选 A: 直接调用 LLM provider API（绕过 pi）——需解析 pi 的配置文件获取 API key，维护成本高
- 备选 B: pi 增加 `--no-tools` 标志——不确定 pi 是否支持，未验证
- 理由: 聚合数据以文本嵌入 prompt，不含文件路径，pi 的工具能力无敏感文件可读；fresh session 无历史上下文，风险可接受
- 影响范围: 此通道不能用于发送文件路径（那样 pi 可能 Read 文件）；用于发送文本内容安全
- 可逆性: 高（接口不变，未来可换实现）

**决策 2: SQL 连接凭证明文存 JSON**
- 选择: `~/.pi-xanthil/sql-connections.json` 存储，password 字段明文
- 备选: macOS Keychain / 加密存储
- 理由: 单用户本地工具，配置文件权限 600 已足够；引入加密增加跨平台复杂度，不值得
- 影响范围: API 返回时 password 脱敏为 `"***"`；前端 PATCH 时若 password 为 `"***"` 则保留原值
- 可逆性: 高（存储格式不变，加密层可后加）

**决策 3: SQL连接作为「计算工具」二级 Tab**
- 选择: `AGGREGATE_SUB_TABS` 中新增 `{ id: 'sql_connect', label: 'SQL连接' }`
- 背景: 初始实现错误地添加为顶级 Tab，用户发现后纠正
- 理由: SQL连接是数据获取工具，与聚合计算、数据提取同属「计算工具」范畴；顶级 Tab 已经较多

**决策 4: 导出两步走（写文件 + 手动注册）**
- 选择: `POST /api/sql-connections/:id/export` 只负责写 CSV；前端 ExportPanel 执行成功后展示「注册到工作区路径」按钮，调用已有 `addWorkspacePath`
- 备选: export API 直接接受 `workspaceId + folder` 一步完成注册
- 理由: 解耦 SQL 模块与工作区逻辑；用户可能不总是需要注册（临时导出）；现有 `addWorkspacePath` 接口已稳定
- 可逆性: 高

### 5. 技术细节快照（本 session 新增部分）

**SQL连接核心文件**

- `server/src/sql-connections.ts`（新建）：连接 CRUD（JSON 文件持久化）+ `testConnection` + `getSchema` + `executeQuery`（预览上限 500 行）+ `exportQueryToCsv`（全量，写 UTF-8 BOM CSV）
- `server/src/config.ts`：新增 `SQL_CONNECTIONS_PATH = DATA_ROOT/sql-connections.json`、`DIRECT_LLM_ROOT = DATA_ROOT/direct-llm/`
- `server/package.json`：新增依赖 `pg@^8.21.0`、`mysql2@^3.22.4`、`@types/pg`；SQLite 用 `node:sqlite`（已有）
- `web/src/components/SqlConnectPane.tsx`：完整 UI，包含 `ConnForm`（三种 DB 类型差异化表单）、`SchemaPanel`（折叠表/列）、`ResultTable`、`ExportPanel`（写文件 + 注册两步）

**Schema 查询方式（各 DB 类型）**
- SQLite: `sqlite_master` + `PRAGMA table_info`
- PostgreSQL: `information_schema.tables` + `information_schema.columns`（只查 `public` schema）
- MySQL: `SHOW TABLES` + `DESCRIBE tableName`

**API 端点（SQL连接，共 8 个）**
```
GET    /api/sql-connections
POST   /api/sql-connections
PATCH  /api/sql-connections/:id
DELETE /api/sql-connections/:id
POST   /api/sql-connections/:id/test
GET    /api/sql-connections/:id/schema
POST   /api/sql-connections/:id/query    body: { sql }
POST   /api/sql-connections/:id/export   body: { sql, outputPath }
```

**tool-free LLM 通道**
```
POST /api/llm/prompt   body: { text, model?, systemPrompt? }
```
内部调用 `runPiPrompt({ workspaceRoot: DIRECT_LLM_ROOT, text, model, systemPrompt })`，每次用随机 session id，无历史。

**提取产物预览**
```
GET /api/extraction-tools/preview?path=<绝对路径>&outputRoot=<输出目录>
```
安全校验：`resolve(path)` 必须以 `resolve(outputRoot) + sep` 开头。只读 `TEXT_PREVIEW_EXTENSIONS`，最大 2 MB。

**AggregatePane props 变更**
```ts
interface Props { model?: string; models?: PiModel[] }
```
App.tsx 中调用：`<AggregatePane model={model} models={models} />`

### 6. 未完成事项与下一步

- [ ] **SQL连接真实场景验证** — P0（当前 session 只通过 typecheck）
  - 上下文: MVP 代码已完成，但未接真实 PostgreSQL/MySQL 跑过端到端
  - 完成标准: 能连接本机 PostgreSQL，执行 SELECT，预览结果，导出 CSV，注册到工作区路径
  - 潜在难点: `pg` / `mysql2` ESM import 在 `--experimental-strip-types` 模式下是否有兼容性问题 [未验证]

- [ ] **SQL连接参数化查询** — P1
  - 上下文: 周期性取数场景（如每周取上周数据），需要在 SQL 中嵌入 `{{start_date}}` 占位符，执行前弹出参数填写
  - 完成标准: manifest/query 支持参数定义，前端按参数自动渲染表单，替换后执行

- [ ] **SQL连接增量取数** — P1
  - 上下文: 避免每次全量导出，记录上次取数的 watermark（最大时间戳 / 自增 ID），追加写入已有 CSV
  - 完成标准: ExportPanel 可选「增量追加」模式，自动生成 `WHERE updated_at > ?`

- [ ] **工具专属参数协议** — P1
  - 上下文: 当前所有提取工具只有 input/output，manifest 没有自定义参数描述
  - 完成标准: `tool.json` 支持 `parameters` 字段（JSON Schema 风格），前端 ExtractionPane 按 schema 渲染表单

- [ ] **Python 子进程隔离** — P1
  - 上下文: 注册工具的 Python 进程继承本机环境，理论上可访问文件系统和网络
  - 完成标准: 确定审查流程文档（短期）；或增加超时 + 输出大小限制（中期）

- [ ] **聚合页 SheetJS bundle 拆分** — P2
  - 上下文: SheetJS 进入主 bundle，Vite 提示 chunk > 500 kB
  - 完成标准: `xlsx` 改为动态 import，首屏加载不含 SheetJS

### 7. 开放问题与待确认事项

- ❓ **SQL连接 ESM 兼容性**: `pg` 和 `mysql2` 以 CommonJS 发布，在 `node --experimental-strip-types` + ESM 模式下是否需要特殊处理？
  - 当前倾向: 直接 named import 应可工作，TypeScript 类型已有 `@types/pg`；`mysql2` 自带类型
  - 需要: 真实连接测试验证
  - 阻塞: SQL连接端到端验证

- ❓ **SQL连接 PostgreSQL 只查 `public` schema**：是否需要支持多 schema？
  - 当前倾向: `public` 覆盖大多数场景，多 schema 支持放 P2
  - 需要: 用户确认

- ❓ **ExtractionPane `TOOL_COLUMNS` 由用户维护还是从 manifest 读取**？
  - 背景: 用户在本 session 手动在前端维护了 `tmall-profile / xhs-insight / phone-cleaner / sycm-member` 四个工具的列映射
  - 当前倾向: 短期由前端硬编码维护；中期应迁移到 tool.json manifest 的 `resultColumns` 字段，由注册机制统一管理
  - 阻塞: 下一个工具接入时会再暴露此问题

### 8. 上下文与约定

延续 Session 1 的安全约定：
- 外部数据库查询结果写入磁盘后，可以注册到 `draw_data`（原始）或 `clean_data`（聚合）；两者都可被 pi 的 agent 工具读取，用户应自行确保不含不可外泄的明细
- `tool-free LLM 通道`（`/api/llm/prompt`）只应发送聚合文本，不应发送本地文件路径

新增约定：
- SQL 连接配置文件 `~/.pi-xanthil/sql-connections.json` 不纳入 git，密码明文存储，用户需自行保护文件权限

### 9. 下一个 Session 启动指令

> 先读「本次更新摘要」和「未完成事项」两节。
>
> 最紧迫的是 **SQL连接真实场景验证**：启动服务器，连接一个本机 PostgreSQL 或 SQLite 文件，执行 SELECT，确认预览表格正常，导出 CSV，注册到工作区。若遇到 `pg`/`mysql2` ESM import 报错，在 `sql-connections.ts` 中改用 `createRequire` 或动态 `import()` 兼容。
>
> 验证通过后，可继续 P1：参数化查询 或 `TOOL_COLUMNS` 迁移到 manifest。
>
> 注意：`/api/llm/prompt` 是 tool-free 通道，但 pi 实际上仍有工具能力——只能发送文本，不能发送文件路径给它。

---

## Session 1 — 2026-06-02

### 0. 本次更新摘要（Changelog）

**本次推进**: 将顶部原「聚合计算」入口升级为「计算工具」，落地两类本地数据处理能力：表格聚合计算和注册制文档数据提取。核心目标是保护明细数据：原始 CSV / Excel / HTML 不直接发送给 LLM。

1）**顶部入口与二级 Tab** ✅ — `MainHeader.tsx` 顶部主 Tab 文案改为「计算工具」；`App.tsx` 为该入口定义专属二级 Tab：`聚合计算 | 数据提取`。

2）**CSV / Excel 本地聚合计算** ✅ — 新增 `web/src/lib/aggregate.ts` 与 `web/src/components/AggregatePane.tsx`。浏览器本地读取 `CSV / XLSX / XLS`，推断字段名、类型和空值数量；用户通过 DSL 配置分组字段、日期粒度和聚合指标，在浏览器内完成计算并导出汇总 CSV。

3）**最小分组阈值** ✅ — DSL 默认启用 `count >= 5`，低于阈值的分组不会出现在汇总结果中，降低单条或少量明细被反推的风险。

4）**Python 高级模式** ✅ — 聚合页可基于 schema、阈值和用户需求生成本地 Python 代码请求 prompt。该模式只生成并复制 prompt，不复用当前具有 agent 工具能力的 `pi`，不在应用内自动执行任意 Python。

5）**SheetJS 安全依赖处理** ✅ — npm registry 中 `xlsx@0.18.5` 存在 high 漏洞。已按 SheetJS 官方 bundler 文档改用官方 CDN tarball：`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`。

6）**数据提取页面** ✅ — 新增 `web/src/components/ExtractionPane.tsx`。页面展示已注册工具，支持选择输入 HTML 文件或目录、选择输出目录、本地运行、查看日志、成功/失败数量、匹配率和生成产物路径。

7）**注册制提取工具管理** ✅ — 新增 `server/tools/registry.ts`。启动时扫描 `server/tools/*/tool.json`，校验 manifest、目录名和 `tool.id` 一致性，并要求 entry 位于工具目录内部。执行 API 只接受注册后的 `tool.id`，不允许用户传入任意脚本路径。

8）**首个提取工具：天猫人群画像** ✅ — 将外部工具整理到 `server/tools/extract-tmall-profile/`。脚本已改为 CLI，支持单文件和目录批量处理，输出 Markdown、JSON 和统一 summary。修复了空 HTML 除零和默认占位标签导致匹配率虚高的问题。

9）**登记路径复制按钮** ✅ — `FolderPathsPane.tsx` 在每条已登记路径的删除按钮前新增复制按钮，适用于 `原始数据 / 聚合数据 / 报告输出` 的文件和文件夹路径。复制成功后短暂显示勾选状态，方便将路径粘贴到其他目录配置。

**关键决策**: 1）原始表格在浏览器本地解析，不上传 BFF；2）文档提取由本地 BFF 调用白名单 Python 工具，不经过 LLM；3）工具统一纳入 `server/tools/` 并通过 manifest 注册；4）当前 `pi` 默认具备 agent 工具能力，不能作为"绝对不读取明细"的代码生成通道；5）聚合结果发送给 LLM 前仍需人工确认。

**新增阻塞/问题**: 无功能阻塞。前端生产构建仍提示 bundle 大于 `500 kB`，主要来自 Excel 解析库，当前不影响使用。

**下一步重点**: 1）继续接入更多数据提取工具，验证 manifest 是否需要支持工具专属参数；2）为提取结果增加页面内 Markdown / JSON 预览；3）增加 tool-free LLM 调用通道后，再将 Python 高级模式从"复制 prompt"升级为应用内生成代码；4）评估对本地 Python 子进程增加更严格的网络和文件系统隔离。

---

### 1. 项目目标（North Star）

- **一句话目标**: 在不向 LLM 暴露原始明细的前提下，用本地 DSL 和注册制 Python 工具完成表格聚合与文档结构化提取。
- **成功标准**:
  - CSV / Excel 明细仅在浏览器内存中处理。✅
  - HTML 等文档仅由本地白名单 Python 工具读取。✅
  - 聚合结果默认过滤 `count < 5` 的分组。✅
  - 工具统一放入 `server/tools/`，新增工具可通过 manifest 注册。✅
  - 未注册脚本无法通过 API 执行。✅
  - 结果产物由用户确认后再用于后续分析。✅

### 2. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 顶部「计算工具」入口 | ✅完成 | `web/src/components/MainHeader.tsx` | 内部 Tab id 仍为 `aggregate` |
| 二级 Tab：聚合计算 / 数据提取 | ✅完成 | `web/src/App.tsx` | `AGGREGATE_SUB_TABS` |
| 表格本地读取 | ✅完成 | `web/src/lib/aggregate.ts` | 支持 CSV / XLSX / XLS |
| DSL 本地聚合 | ✅完成 | `web/src/lib/aggregate.ts` | groupBy / 日期粒度 / sum / avg / min / max / count |
| 汇总 CSV 导出 | ✅完成 | `AggregatePane.tsx` | 浏览器 Blob 下载 |
| Python 高级模式 prompt | ✅完成 | `AggregatePane.tsx` | 仅复制，不调用 pi |
| 提取工具注册表 | ✅完成 | `server/tools/registry.ts` | 启动时同步扫描 |
| 提取工具 REST API | ✅完成 | `server/src/index.ts` | list + run |
| 天猫人群画像提取 | ✅完成 | `server/tools/extract-tmall-profile/` | HTML → MD + JSON |
| 路径复制按钮 | ✅完成 | `FolderPathsPane.tsx` | 三类目录共用 |
| 提取产物页面内预览 | ⏳待启动 | — | 当前显示路径和日志 |
| tool-free LLM 生成代码 | ⏳待启动 | — | 当前没有安全调用通道 |

### 3. 安全边界

**聚合计算链路**

```text
浏览器选择 CSV / XLSX / XLS
  ↓ File.arrayBuffer()
浏览器内存读取明细
  ↓
本地推断 schema + 本地 DSL 聚合
  ↓
用户预览并导出汇总 CSV
```

- 原始表格不上传 BFF。
- LLM 最多接收 schema、阈值和计算需求。
- schema 中字段名也可能敏感，发送前需人工检查和脱敏。
- 汇总结果也可能泄露明细，默认过滤 `count < 5` 分组。

**数据提取链路**

```text
用户选择本地 HTML 文件或目录
  ↓ POST /api/extraction-tools/:id/run
BFF 根据已注册 tool.id 定位白名单 entry
  ↓ execFile("python3", [entry, "--input", ..., "--output", ...])
本地 Python 读取原文并输出 MD / JSON
```

- HTML 原文不进入 LLM。
- 后端使用 `execFile` 参数数组，不经过 shell。
- API 不接受用户提供的脚本路径。
- output 必须是已存在目录。
- BFF 会过滤工具 summary 中越出 output 目录的产物路径。

### 4. 聚合计算实现快照

**关键文件**

- `web/src/lib/aggregate.ts`
  - `readLocalDataset(file)`：使用 SheetJS 读取第一个工作表。
  - `inferColumns(rows)`：推断 `number | date | boolean | text` 和空值数。
  - `runAggregation(rows, dsl)`：本地分组聚合并过滤低于阈值的分组。
  - `toCsv(rows)`：导出 CSV。
  - `buildPythonPrompt(columns, requirement, minGroupSize)`：生成不含明细行的 Python 请求 prompt。
- `web/src/components/AggregatePane.tsx`
  - 文件选择、schema 展示、DSL 配置、结果预览、CSV 下载、Python prompt 复制。

**DSL 类型**

```ts
interface AggregateDsl {
  groupBy: string[];
  dateColumn: string | null;
  dateGranularity: "day" | "month" | "year";
  metrics: Array<{
    column: string | null;
    operation: "sum" | "count" | "avg" | "min" | "max";
  }>;
  minGroupSize: number;
}
```

### 5. 数据提取注册机制

**目录结构**

```text
server/tools/
├── registry.ts
└── extract-tmall-profile/
    ├── tool.json
    ├── extract_tmall.py
    └── 天猫标签分类对应表.md
```

**manifest 示例**

```json
{
  "id": "extract-tmall-profile",
  "name": "提取天猫人群画像",
  "version": "1.0.0",
  "description": "从天猫数据银行 HTML 文件中提取人群画像，按标签规则输出 Markdown 和 JSON。",
  "entry": "extract_tmall.py",
  "runtime": "python3",
  "input": {
    "accept": [".html"],
    "modes": ["file", "directory"]
  },
  "output": [".md", ".json"]
}
```

**注册校验**

- `id` 仅允许小写字母、数字和 `-`。
- `tool.id` 必须等于工具目录名。
- 当前 runtime 仅允许 `python3`。
- entry 必须位于工具目录内并且是文件。
- 文件输入会校验扩展名；目录输入由工具自行遍历允许的文件。

**新增工具步骤**

1. 在 `server/tools/` 下新建与 `tool.id` 同名的目录。
2. 放入 Python entry 和工具所需规则文件。
3. 新建符合协议的 `tool.json`。
4. entry 实现统一 CLI 参数：

```bash
python3 entry.py \
  --input "/path/to/file-or-dir" \
  --output "/path/to/output-dir" \
  --json-summary "/path/to/summary.json"
```

5. summary 至少返回：

```json
{
  "success": 1,
  "failed": 0,
  "results": [
    {
      "file": "sample.html",
      "outputs": ["/path/to/output.md", "/path/to/output.json"]
    }
  ]
}
```

6. 重启 BFF。当前注册表在模块加载时扫描，不支持运行时热加载。

### 6. REST API

```text
GET  /api/extraction-tools
POST /api/extraction-tools/:id/run
```

运行请求：

```json
{
  "inputPath": "/local/input.html",
  "outputPath": "/local/output-folder"
}
```

运行响应：

```json
{
  "runId": "uuid",
  "toolId": "extract-tmall-profile",
  "success": 1,
  "failed": 0,
  "stdout": "...",
  "stderr": "",
  "results": [
    {
      "file": "sample.html",
      "crowdName": "接口测试",
      "totalTags": 1,
      "matchedTags": 1,
      "matchRate": "100.0%",
      "outputs": ["/local/output-folder/接口测试_人群画像.md", "/local/output-folder/接口测试_人群画像.json"]
    }
  ]
}
```

### 7. 已验证项

- ✅ `npm run typecheck`
- ✅ `npm run build`
- ✅ `git diff --check`
- ✅ 聚合 smoke：低于阈值的分组被过滤，生成 prompt 不包含测试明细值。
- ✅ 注册表 smoke：能列出 `extract-tmall-profile`，任意脚本路径无法作为 tool id 获取。
- ✅ Python fixture smoke：普通 HTML 和空 HTML 均能处理；空 HTML 匹配率为 `0.0%`；正常样例匹配率为 `100.0%`；每个输入生成 MD + JSON。
- ✅ REST API smoke：已注册工具可列出并执行；未注册工具返回 `404`。
- ✅ 路径复制按钮：`npm -w web run typecheck` 与 `git diff --check` 通过。

### 8. 已知限制与后续事项

- [ ] **提取产物页面内预览** — P1
  - 当前: `ExtractionPane` 只显示产物绝对路径和执行日志。
  - 建议: 增加只读预览接口，限制只能读取本次工具输出目录下的 MD / JSON / CSV。

- [ ] **工具专属参数协议** — P1
  - 当前: 所有工具只有 input/output。
  - 建议: manifest 增加 `parameters` JSON Schema 风格描述，前端按 schema 自动渲染表单。

- [ ] **Python 子进程隔离** — P1
  - 当前: 工具必须注册，但注册后的 Python 进程仍继承本机环境。
  - 建议: 明确工具审查流程；后续按平台增加网络限制、超时、输出大小和目录访问控制。

- [ ] **tool-free LLM 通道** — P1
  - 当前: Python 高级模式仅复制 prompt。
  - 原因: 现有 `pi` 调用默认具备 agent 工具能力，无法证明不会读取本地明细。
  - 建议: 增加无工具的模型调用通道，仅发送 schema 和用户需求，再允许用户审查生成代码。

- [ ] **聚合页 bundle 拆分** — P2
  - 当前: SheetJS 进入主 bundle，Vite 提示 chunk 超过 `500 kB`。
  - 建议: 将 `xlsx` 改为动态 import，仅在打开聚合页或选择表格文件后加载。

- [ ] **聚合结果进入后续分析的确认流程** — P1
  - 当前: 可导出汇总 CSV，但未提供"确认后发送给 LLM"按钮。
  - 建议: 增加结果审查和显式确认步骤，并记录本次阈值、分组规则和发送摘要。

### 9. 关键文件清单

```text
web/src/components/MainHeader.tsx
web/src/App.tsx
web/src/components/AggregatePane.tsx
web/src/components/ExtractionPane.tsx
web/src/components/FolderPathsPane.tsx
web/src/lib/aggregate.ts
web/src/lib/api.ts
web/src/types.ts
server/src/config.ts
server/src/index.ts
server/tools/registry.ts
server/tools/extract-tmall-profile/tool.json
server/tools/extract-tmall-profile/extract_tmall.py
server/tools/extract-tmall-profile/天猫标签分类对应表.md
```

### 10. 下一个 Session 启动指令

> 先阅读本文件的「本次更新摘要」「安全边界」「已知限制与后续事项」。
>
> 启动后优先验证：1）顶部「计算工具」下显示 `聚合计算 | 数据提取`；2）聚合页导入 CSV / Excel 后能在浏览器本地生成汇总 CSV；3）数据提取页能列出「提取天猫人群画像」，选择本地 HTML 和输出目录后生成 MD + JSON；4）`原始数据 / 聚合数据 / 报告输出` 中登记路径的复制按钮可用。
>
> 接入下一个提取工具时，沿用 `server/tools/<tool-id>/tool.json` 注册协议，不新增允许执行任意脚本路径的接口。
