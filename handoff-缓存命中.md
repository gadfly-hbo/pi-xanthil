# Handoff Log — 缓存命中 Harness（降低 token 消耗）

---

## 📌 Session 2 — 2026-06-02

### 0. 本次更新摘要（Changelog）

- **本次推进**: 实现文件分析**自动回填**（Session 1 的 P1 Action Item）。至此 Phase 1/2/3 核心链路全部闭环。
- **关键改动**:
  - `prompt-blocks.ts`: 新增 `BLOCK_FILE_ANALYSIS`（字段字典输出约束），加入 `assembleSystemPrompt` 作为 Block 03；`PROMPT_SCHEMA_VERSION` 从 `v1` → `v2`
  - `index.ts`: 新增 `extractFieldDicts`（正则提取 ` ```field-dict:/path ``` ` 块）+ `backfillAnalysisFromMessage`（路径→hash 查表→`setFileAnalysis`）；在 `handleSend` 的 `onEvent` 里 `message_end` 后钩入
- **验证**: `tsc --noEmit` 0 错误
- **下一步重点**: 真实对话验证回填效果（新建 session A 分析 CSV → 新建 session B 检查 contextPrefix 是否含字段说明）；可选：清理 web 端 3 个 TS 错误

---

## 📌 Session 1 — 2026-06-02

### 0. 本次更新摘要（Changelog）

- **本次推进**: 为 pi-xanthil 搭建缓存命中 harness 的前三层——①Token 用量/缓存命中监控；②Prompt 前缀稳定化；③文件 hash + 分析缓存。目标是降低数据分析场景的长期 token 消耗。
- **核心约束（必读）**: pi-xanthil **不直接调模型**，所有请求经 `pi` CLI（`runPiTurn` spawn 子进程，`--session-id` 复用会话 + `--system-prompt` 注入）。因此**无法直接设 `cache_control` 断点**，只能靠「稳定字节前缀」让 provider 的 prompt/prefix cache 自动命中。所有优化都围绕这一点展开。
- **关键决策**: ①缓存命中率口径统一为 `cacheRead / (input + cacheRead + cacheWrite)`；②稳定 prompt 块前置、role/workflow prompt 后置，块内容改动须 bump `PROMPT_SCHEMA_VERSION`；③文件分析缓存以 SHA-256 `file_hash` 为 key，跨 session 复用；④语义缓存（Phase 3）暂不做（依赖 embedding，与 local-first/隐私冲突）。
- **验证**: server 端 `tsc --noEmit` 0 错误；文件 hash→analysis→contextPrefix 注入链路端到端测试通过。
- **下一步重点**: 文件分析**自动回填**（让前两层闭环），见 Action Items P1。

### 1. 项目元信息

```
Session 编号: 缓存 harness 第 1 次交接
本次 Session 起止: 监控层 + 稳定前缀层 + 文件分析缓存层（后端完整）
最后更新: 2026-06-02
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
项目记忆: ~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/cache-harness.md
```

### 2. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Token 用量/缓存命中监控 | ✅完成 | `server/src/cache.ts`、`session_token_stats` 表 | 钩入 `observeSessionEvent` |
| 监控 API（3 个） | ✅完成 | `index.ts:497/502/507` | session / workspace / by-session |
| MainHeader 缓存命中率显示 | ✅完成 | `web/src/components/MainHeader.tsx` | `↩XX%` 绿/黄/灰分级 |
| TokenStatsPane 明细面板 | ✅完成 | `web/src/components/TokenStatsPane.tsx` | 规则记忆 tab 下 `token统计` 子页 |
| Prompt Block 稳定化 | ✅完成 | `server/src/prompt-blocks.ts` | `PROMPT_SCHEMA_VERSION="v1"` |
| folder 顺序固定化 | ✅完成 | `server/src/output-paths.ts` | `clean_data → report` 固定序 |
| 文件 SHA-256 hash | ✅完成 | `server/src/file-hash.ts` | 注册文件时自动算 |
| `file_analysis_cache` 表 + CRUD | ✅完成 | `db.ts:793/800/808` | key = file_hash |
| contextPrefix 注入字段说明 | ✅完成 | `output-paths.ts:buildRegisteredPathContext` | 仅 clean_data 有缓存时注入 |
| 分析缓存 API（GET/PUT） | ✅完成 | `index.ts:1195/1203` | 手动 PUT 仍可用 |
| 文件分析自动回填 | ✅完成 | `index.ts:extractFieldDicts/backfillAnalysisFromMessage` | agent 输出 ` ```field-dict ``` ` 块时自动回写 |
| `BLOCK_FILE_ANALYSIS` + v2 版本 | ✅完成 | `prompt-blocks.ts` | Block 03；字段字典输出指令 |
| 报告片段缓存 | ⏳待启动 | — | Action Items P2 |
| 语义缓存（Phase 3） | ❌不做 | — | 隐私/依赖冲突 |

### 3. 关键决策与权衡 ⭐

**决策 1: 经 pi CLI 间接优化，不直接设 cache_control**
- 选择: 所有缓存优化通过「稳定前缀工程」+ pi 的 `--session-id` 会话复用间接命中 provider cache。
- 备选: 在 pi-xanthil 内自建 LLM Gateway 直连模型 API、显式设 `cache_control`（被否决）。
- 理由: pi-xanthil 的核心架构是 pi CLI 套壳，绕过 pi 直连模型会丢失 pi 的工具/会话/安全能力，成本过高。
- 影响范围: 决定了后续所有手段都是「让前缀字节稳定」而非「显式断点」。
- 可逆性: 中（若未来改为直连，监控层与文件缓存层可复用，前缀层需重做）。

**决策 2: 缓存命中率口径**
- 选择: `cacheHitRate = cacheRead / (input + cacheRead + cacheWrite)`，分母不含 output。
- 理由: 衡量的是「输入侧有多少被缓存命中」，output 是生成不涉及缓存。
- 影响范围: 前后端统一（`cache.ts` / `MainHeader` / `TokenStatsPane` / by-session endpoint 内联计算一致）。

**决策 3: Prompt Block 前置 + 版本号**
- 选择: `assembleSystemPrompt(extra?)` 固定拼 `[BLOCK_SAFETY, BLOCK_BASE_BEHAVIOR, extra?]`，稳定块永远在前。
- 理由: 稳定前缀从 ~150 tok 扩到 ~402 tok，更易触达 provider prefix cache 阈值；同一 workflowId 的所有请求前 402 tok 字节一致。
- 关键约束: **改 BLOCK 内容必须 bump `PROMPT_SCHEMA_VERSION`**，否则无法关联 prompt 变更与命中率波动。
- 影响范围: `pi-adapter.ts:runPiTurn` 改用 `assembleSystemPrompt`，移除原内联 `GLOBAL_DATA_SAFETY_PROMPT`。

**决策 4: 文件分析缓存以 file_hash 为 key**
- 选择: 注册文件时算 SHA-256 存 `workspace_paths.file_hash`；分析结果存 `file_analysis_cache`（PK=file_hash），跨 session/workspace 复用。
- 理由: 文件内容不变则 hash 不变，同一文件在任意 session 都能复用字段说明，无需重新探查。
- 影响范围: 三个 POST 路径注册路由改 async 算 hash；4 个 `buildRegisteredPathContext` 调用点装载 analyses 传入。
- 可逆性: 高（migration 加列向后兼容，旧 path 无 hash 自动跳过注入）。

**决策 5: 语义缓存暂不做**
- 选择: 推迟 Phase 3（embedding 相似问题复用）。
- 理由: 需要 embedding 模型，与项目 local-first/隐私数据不出本机的原则冲突；前两层收益已足够。

### 4. 技术/方案细节快照

**新增文件**
- `server/src/cache.ts` — `trackSessionUsage(sessionId, usage)` / `getSessionTokenStats(sessionId)` / `getWorkspaceTokenStats(workspaceId)`。命中率在此统一计算。
- `server/src/prompt-blocks.ts` — `PROMPT_SCHEMA_VERSION` + `BLOCK_SAFETY`（数据安全约束）+ `BLOCK_BASE_BEHAVIOR`（通用 agent 行为规范）+ `assembleSystemPrompt(extra?)`。
- `server/src/file-hash.ts` — `computeFileHash(path): Promise<string|null>`（流式 SHA-256，I/O 错误返回 null）+ `getFileSize`。
- `web/src/components/TokenStatsPane.tsx` — 工作区 token 概览卡片 + 按会话明细表 + token 分布条。

**改动文件**
- `server/src/db.ts`
  - migration: `ALTER TABLE workspace_paths ADD COLUMN file_hash TEXT`
  - 新表 `session_token_stats`（session_id PK，input/output/cacheRead/cacheWrite/turn_count/total_cost）
  - 新表 `file_analysis_cache`（file_hash PK，content，updated_at）
  - 新函数: `accumulateSessionTokenStats` / `getRawSessionTokenStats` / `listRawSessionTokenStatsByWorkspace` / `listRawSessionTokenStatsWithTitles` / `getFileAnalysis` / `setFileAnalysis` / `getFileAnalysesByPathIds` / `updateWorkspacePathHash`
  - `addWorkspacePath` 末参新增 `fileHash`；`workspace_paths` 的 SELECT 都加了 `file_hash AS fileHash`
- `server/src/pi-adapter.ts` — `runPiTurn` 改用 `assembleSystemPrompt(opts.systemPrompt)`；删除内联 `GLOBAL_DATA_SAFETY_PROMPT`
- `server/src/output-paths.ts` — `FOLDER_DISPLAY_ORDER=["clean_data","report"]` 固定序；`buildRegisteredPathContext(paths, ctx, fileAnalyses?)` 第 3 参注入「已缓存字段说明」
- `server/src/index.ts`
  - `observeSessionEvent` 的 `message_end` 钩入 `trackSessionUsage`
  - 3 个监控 endpoint + 2 个 analysis endpoint（见下）
  - 3 个路径注册 POST 改 async + `computeFileHash`（仅 `kind==="file"`）
  - 4 个 `buildRegisteredPathContext` 调用点：先 `getFileAnalysesByPathIds(clean_data 文件 id)` 再传入
- `web/src/lib/api.ts` — `getSessionTokenStats` / `getWorkspaceTokenStats` / `getWorkspaceTokenStatsBySession`
- `web/src/components/MainHeader.tsx` — 新增 `cacheHitRate` prop，header 右侧 `↩XX%` 着色（绿≥50%/黄≥20%/灰）
- `web/src/App.tsx` — `totals` 扩 `input/cacheRead/cacheWrite`；派生 `cacheHitRate` 传给 MainHeader
- `web/src/types.ts` / `server/src/types.ts` — `SessionTokenStats`、`WorkspacePath.fileHash`、`FileAnalysis`

**API 契约**

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/sessions/:id/token-stats` | 单会话 token + 命中率 |
| GET | `/api/workspaces/:id/token-stats` | 工作区聚合 |
| GET | `/api/workspaces/:id/token-stats-by-session` | 按会话明细（含 title） |
| GET | `/api/workspace-paths/:pathId/analysis` | 读文件分析缓存（无 hash 返回 content:null） |
| PUT | `/api/workspace-paths/:pathId/analysis` | 写文件分析缓存（body `{content}`） |

**表结构**
```sql
CREATE TABLE session_token_stats (
  session_id TEXT PRIMARY KEY, input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  turn_count INTEGER, total_cost REAL, updated_at INTEGER );
CREATE TABLE file_analysis_cache (
  file_hash TEXT PRIMARY KEY, content TEXT, updated_at INTEGER );
-- workspace_paths 新增列: file_hash TEXT
```

**contextPrefix 注入效果（端到端实测）**
```
[已登记文件路径]
聚合数据:
  - /path/to/agg.csv
    [已缓存字段说明]
    字段说明:
    - city: 城市名(string)
    - members: 会员数(int)
    ...
[内容输出路径约束]
...
```

### 5. 未完成事项与下一步（Action Items）

- [ ] **文件分析自动回填** — P1（最高优先，让前两层闭环）
  - 上下文: 当前 `file_analysis_cache` 只能手动 PUT 填充；理想是 explore session 首次分析完文件后自动把字段说明写回缓存，后续 session 自动命中。
  - 方案 A（推荐）: explore 类 session 结束后，解析助手输出里的字段/schema 描述，调 `setFileAnalysis(hash, content)` 回写。难点是从自由文本里稳定提取结构化字段说明。
  - 方案 B: 在 system prompt 里要求 agent 分析完后产出一段固定格式的「字段字典」块，服务端按标记截取回写。更可控。
  - 完成标准: 同一聚合文件在新 session 打开时，contextPrefix 已含字段说明，无需重新探查。

- [ ] **报告片段缓存** — P2
  - 上下文: 报告整体生成，重复生成时全量耗 token。
  - 方案: 报告按章节拆分，每节按 `(数据版本 hash + 章节 + 风格版本 + 模型)` 缓存，未命中章节才调 LLM。

- [ ] **修复 web 端 3 个 TS 错误** — P1（非本主题引入，属并行 WIP）
  - `App.tsx:622,647` — `FolderPathsPane` 新增 required `models` prop，两处调用未传。
  - `DecisionTreePane.tsx:225` — `buildDecisionTree` 未定义。
  - 备注: 不影响后端缓存能力；属 trace/decision-tree 功能开发中状态。

- [ ] **命中率基准观测** — P2
  - 跑几轮真实对话，对比 Phase 2 前后稳定前缀的命中率变化，验证 ~402 tok 前缀是否实际提升命中。

### 6. 开放问题与待确认事项

- ❓ **自动回填的字段说明格式** — 方案 A vs B（自由文本提取 vs 固定标记块）。倾向 B，更稳定可控，需用户确认是否接受在 system prompt 里加「产出字段字典」的硬要求。
- ❓ **provider 是否真的对 ~402 tok 前缀命中** — 不同 provider（MiniMax / Anthropic / …）prefix cache 阈值不同，需用真实 `cacheRead` 数据验证；若阈值更高（如 1024 tok），需进一步扩稳定前缀（如把工具定义、指标口径字典也前置）。
- ❓ **report 子页未设报告路径时，contextPrefix 仍稳定吗** — 当前 fallback 到工作目录，路径变化会破坏前缀，需评估是否影响命中。

### 7. 上下文与约定

- 用户偏好（全局 CLAUDE.md）: 中文回答、代码英文、最小改动、先思考后动手、删除/覆盖前确认、证据优先（先读再改）。
- 数据安全铁律: 原始数据（draw_data）绝不进 LLM；`BLOCK_SAFETY` 是 system prompt 第一块，不可被覆盖。
- 命中率口径全局统一: `cacheRead / (input + cacheRead + cacheWrite)`。
- 改 prompt 块内容必须 bump `PROMPT_SCHEMA_VERSION`。
- TS 陷阱（沿用）: 判别联合开放成员破坏类型收窄 → `as Extract`；`node:sqlite` 返回需 `as unknown as T`。

### 8. 下一个 Session 启动指令

> 读本 Session「摘要」「进度全景」「Action Items」三节。跑 `npm run dev`（gateway:8787 + web:5173），先 `npx tsc -p server/tsconfig.json --noEmit` 确认 server 0 错误。
> 最紧迫任务：**文件分析自动回填**（Action Items P1）——优先方案 B：在 explore system prompt 里加「分析完产出固定标记的字段字典块」，服务端在 `observeSessionEvent` 或 run 结束时按标记截取，调 `setFileAnalysis(hash, content)` 回写。回写前需把文件 path 映射到 file_hash（查 `workspace_paths.file_hash`）。
> 验证命中：注册一个聚合 CSV → 在 session A 触发分析回填 → 新建 session B → 检查 contextPrefix 是否已含字段说明（可用 `buildRegisteredPathContext` 直接 node 调试，见本 Session 实测片段）。
> 顺手可清掉 web 端 3 个 TS 错误（FolderPathsPane models prop ×2、buildDecisionTree 未定义），但属并行 WIP，先与用户确认。
> 注意：所有缓存手段的有效性最终要看真实 `cacheRead` 数据——别只看代码，跑几轮对话看 MainHeader 的 `↩XX%`。
