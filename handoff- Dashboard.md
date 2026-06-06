# Handoff Log — 模型工坊 (Model Lab)

---

## 📌 Session 10 (最新) — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 为 Dashboard 中两张「会员表」(会员新客复购留存表 / 会员老客复购召回表)新增数据导入能力。完成全链路：server 端 `bi_datasets` SQLite schema + 5 个 REST 端点 (upload/list/active/activate/delete) + csv/xlsx 解析落库；web 端共享 hook `useBiDataset` + 列模糊匹配解析器 `biDatasetParser` + 共享 `ImportDialog`；两个 Pane 顶部加「导入数据」按钮 + 数据源徽章 + fallback mock。
**关键决策**: ① 存储走独立 `bi_datasets` 表 + `~/.pi-xanthil/bi-datasets/` 目录,不复用 `workspace_paths` (避免引入 workspaceId 上下文与本地目录挑选流程);② 双副本存储 (原文件 + 已解析的 columns/rows JSON 入 SQLite),`/active` 端点零再解析直返;③ 列匹配走宽松策略 (alias 归一 + 数值 > 1.5 自动 /100);④ 用户授权改 `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx`,但 AGENTS.md 不更新 (即下个 session 仍要把这两个文件当「他人成果」对待,本次是一次性授权)。
**新增阻塞/问题**: 无。Baseline tsc 错误未变。
**下一步重点**: ① P0 浏览器端到端实测 (Session 6-9 累积 13 步未跑);② P1 新增任务: LLM 提示词工程接入 `/api/bi-datasets/active`,让聊天能看到导入数据 (端点已就绪)。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab) / Dashboard
- 项目类型: 代码开发
- Session 编号: 第 10 次交接
- 本次 Session 起止: 从「Session 9 完成 5 项 diff/cleanup 增强 (1115→1456 行,server typecheck + vite build 通过)」推进到「为两张会员表新增导入数据能力,新增 5 个 server 端点 + 7 个新建/修改的前端文件,server typecheck + vite build 通过」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 1-9,无变化。本次仅在既有 Dashboard 架构上完成「mock 数据 → 真实导入数据」的可替换链路。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| `bi_datasets` SQLite schema + CRUD | ✅完成 (本次) | `server/src/db.ts:insertBiDataset / listBiDatasets / getActiveBiDataset / getBiDatasetById / deleteBiDataset / setActiveBiDataset` | 表字段: id/slot/filename/storage_path/columns_json/rows_json/row_count/column_count/size_bytes/uploaded_at/active |
| Server upload 端点 | ✅完成 (本次) | `server/src/index.ts` POST `/api/bi-datasets/upload` | multer memoryStorage + xlsx 解析,落 `BI_DATASETS_ROOT/<slot>/<ts>_<uuid>.<ext>` |
| Server active/get 端点 (LLM 接入点) | ✅完成 (本次) | GET `/api/bi-datasets/active?slot=` + GET `/:id` | `/active` 返回 `{columns, rows}` 全量结构化 JSON |
| Server activate/delete 端点 | ✅完成 (本次) | POST `/:id/activate` + DELETE `/:id` | delete 连带删本地文件 |
| Frontend api.ts 6 个函数 | ✅完成 (本次) | `web/src/lib/api.ts` | uploadBiDataset / listBiDatasets / getActiveBiDataset / getBiDataset / activateBiDataset / deleteBiDataset |
| 共享 hook `useBiDataset` | ✅完成 (本次) | `web/src/lib/useBiDataset.ts` (新) | 封装 active state / history / import / switch / delete |
| 共享列解析器 `biDatasetParser` | ✅完成 (本次) | `web/src/lib/biDatasetParser.ts` (新) | matchColumn / toNumber / toRatio / parseRetentionRows / parseRecallRows / detectChannels |
| 共享 `BiImportDialog` 组件 | ✅完成 (本次) | `web/src/components/BiImportDialog.tsx` (新, ~170 行) | 上传按钮 + 历史列表 + 切换/删除二次确认 |
| NewMemberRetentionPane 集成 | ✅完成 (本次) | `web/src/components/NewMemberRetentionPane.tsx` (286→288 行) | 顶部加 Database 徽章 (mock/数据源) + 导入按钮 + fallback MOCK_COHORTS |
| OldMemberRecallPane 集成 | ✅完成 (本次) | `web/src/components/OldMemberRecallPane.tsx` (388→约 410 行) | 同上模式;channels 用动态检测的渠道列表 |
| server typecheck | ✅完成 (本次) | - | 无新增错误 (baseline 错误未变) |
| vite build | ✅完成 (本次) | 主 entry 844 KB / gzip 196 KB | Session 9: 832/192,+12/+4 合理 |
| 浏览器端到端实测 (13 步累积) | ⏳待启动 | - | Session 6-9 遗留,本次未跑 |
| LLM 接入 `/active` 端点 | ⏳待启动 | - | 本次新增 P1,端点已就绪 |
| 全量 28 模型端到端验证 | ⏳待启动 | - | Session 3 遗留 |

### 4. 关键决策与权衡 ⭐

**决策 1: BI dataset 存储 = 独立 `bi_datasets` 表 + `BI_DATASETS_ROOT` 目录**
- 选择: 新建 SQLite 表 (bi_datasets) + 专属目录 `~/.pi-xanthil/bi-datasets/<slot>/`;上传后服务端解析,**双副本存储** —— 原始文件 + 结构化 JSON (columns/rows) 入 SQLite
- 备选: ① 复用 `workspace_paths` (folder=clean_data) —— 需要 workspaceId 上下文且用户要先「挑本地目录」再「注册」,与「上传即用」诉求不符;② 仅 in-memory —— 刷新即丢,不符合「与聚合数据一个级别」诉求;③ 只入 SQLite 不留文件 —— 失去未来用新策略重新解析的可能
- 理由: 用户明确说「与聚合数据一个级别可被 LLM 调用」,这里核心诉求是「LLM 可读 + 持久化」,而非「必须复用 `path_registry` schema」。独立表给完整 schema 控制 (slot/filename/active flag)。双副本让 `/active` 端点零再解析直返 JSON,同时保留原文件用于未来扩展。
- 影响范围: LLM 通过 `GET /api/bi-datasets/active?slot=member_retention|member_recall` 拉全量 `{columns, rows}`;需要新 session 把这个端点接入聊天提示词构建逻辑 (P1 新任务)
- 可逆性: 高 (独立子系统,不影响其他模块)

**决策 2: 列匹配走宽松策略 (alias 归一 + 数值 > 1.5 自动 /100)**
- 选择: `biDatasetParser.ts` 内对列名做 normalize (去空格/下划线/横线+小写) + alias 列表匹配 + substring 兜底;数值类字段如以 `%` 结尾或值 > 1.5 自动判断为百分比并 /100
- 备选: ① 严格 schema —— 列名不命中预定义就报错,用户摩擦大;② UI 手动映射列 —— 灵活但工作量 +50%;③ server 端自动 infer + 用户预览 —— 首版过重
- 理由: 用户在问题里明确选「宽松:列名按位置/模糊匹配,缺失补 null,超列忽略」。parser 是纯函数,后续可替换/追加策略,无需动 UI 或 API
- 影响范围: retention 自动识别 cohort + newUsers 列,其余列当成 M+1..M+N 期数;recall 通过后缀 `_(rate|gmv)` 或中文「率/GMV」识别渠道;**最坏情况**: 列名完全无法识别时,会得到全 null 或 0 数据,用户需自行重命名列再上传
- 可逆性: 高 (纯函数)

**决策 3: 「上传即生效 + slot 单激活」机制**
- 选择: 每个 slot (member_retention / member_recall) 同时只有一个 dataset active=1;新上传自动激活旧版本 active=0;`ImportDialog` 历史列表支持手动切换回旧版本
- 备选: ① 多版本同存,用户手动指定 active —— 太多步;② 上传即覆盖,不留历史 —— 误操作不可恢复
- 理由: 用户明确选「上传即生效 + 自动归档」。历史保留 + 一键切换给到「上传错文件能回退」的安全感;active flag 持久化在 SQLite,服务重启不丢
- 影响范围: 非 active 数据集占用磁盘 + DB 行,简单清理通过 dialog 删除按钮
- 可逆性: 高

**决策 4: 一次性授权改 `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx`,但 AGENTS.md 不更新**
- 选择: 本次允许改造这两个文件,完成 BI dataset 集成;但 AGENTS.md「他人成果不动」列表保持原样,不把这两个文件从列表中移除
- 备选: ① 同时更新 AGENTS.md 把这两个文件转移所有权 —— 用户明确否决;② 完全不改,在外层包一层 Wrapper Pane —— 工作量翻倍且引入间接性
- 理由: 用户明确选「授权改这两个文件 + 不更新 AGENTS.md」。当前事实: 这两个文件在 git 里是 untracked (不是已 commit 的他人成果),修改风险较低
- 影响范围: **下个 session 必须知道** —— 这是一次性授权,不是永久转移所有权;若再次需要改这两个文件需重新询问用户;`BiDashboardPane.tsx` 及 AGENTS.md 列出的其他文件仍受约束
- 可逆性: 高 (改动局限在 Pane 内部 + 新增的 hook/parser/dialog,可整体回滚)

### 5. 技术/方案细节快照 (本次变化)

**Server**
- `server/src/config.ts`: 新增常量 `BI_DATASETS_ROOT = join(DATA_ROOT, "bi-datasets")` + `ensureDirs()` 创建该目录
- `server/src/types.ts`: 新增 `BiDatasetSlot = "member_retention" | "member_recall"`、`BiDatasetSummary`、`BiDatasetDetail`
- `server/src/db.ts`:
  - schema 新增 `bi_datasets` 表 + 两个索引 (slot+uploaded_at / slot+active)
  - 6 个 CRUD 函数: `insertBiDataset` / `listBiDatasets` / `getBiDatasetById` / `getActiveBiDataset` / `deleteBiDataset` / `setActiveBiDataset`
  - 事务用 `db.exec("BEGIN/COMMIT/ROLLBACK")` 而非 `db.transaction()` —— node:sqlite **不支持** `transaction` 方法 (重要踩坑)
- `server/src/index.ts`:
  - 新增 5 个端点: `POST /upload` (multer memoryStorage,独立于全局 disk-storage `upload` 实例,避免 block-scoped 引用错误) / `GET ?slot=` / `GET /active?slot=` / `GET /:id` / `POST /:id/activate` / `DELETE /:id`
  - 共享 `parseBiDatasetFromBuffer` 函数: csv/tsv 走 `XLSX.read(text, {type: "string"})`,xlsx/xls 走 `XLSX.read(buf, {type: "buffer"})`,统一抽取 `sheet_to_json(header: 1)` -> 首行 header + 后续 row,空行跳过

**Frontend (新建文件)**
- `web/src/lib/useBiDataset.ts`: hook,封装 `dataset / history / loading / importing / error / toast` 状态 + `refresh / importFile / switchTo / remove` actions,所有更新自动 refresh
- `web/src/lib/biDatasetParser.ts`: 纯函数集
  - `matchColumn(columns, aliases)`: normalize + exact + substring 三级匹配
  - `toNumber(v)`: 解析 `1,234.5` / `12.3%` / number
  - `toRatio(v)`: 值 > 1.5 或 `%` 结尾 → /100
  - `parseRetentionRows(detail)` / `parseRecallRows(detail)`: 对应 slot 的解析
  - `detectChannels(columns)`: 通过列名 `_(rate|gmv)` 后缀或中文「率/GMV」自动检测渠道,返回 `{id, rateKey?, gmvKey?}[]`
- `web/src/components/BiImportDialog.tsx`: 模态 dialog,集成 上传按钮 + 当前 active 提示 + 历史列表 (切换 / 二次确认删除),~170 行

**Pane 集成模式 (两 Pane 一致)**
```
const { dataset, history, importing, importFile, switchTo, remove } = useBiDataset("member_retention");
const parsed = useMemo(() => dataset ? parseRetentionRows(dataset) : null, [dataset]);
const cohorts = isRealData && parsed ? parsed.rows : MOCK_COHORTS;
// 其余 JSX 用 `cohorts` 替代原 `MOCK_COHORTS`,header 加 Database 徽章显示数据源
```

**关键陷阱 (本次踩坑)**
- `db.transaction(...)` 在 `node:sqlite` (Node 22+ 内置) 中**不存在**,与 `better-sqlite3` 不兼容;改用 `db.exec("BEGIN")` / `db.exec("COMMIT")` / `db.exec("ROLLBACK")` 显式控制事务
- `multer` 全局 `upload` 实例是 `const` block-scoped,在文件早期端点直接引用会触发 `TS2448 used before declaration`;**规避**: BI 上传端点用 `multer({ storage: multer.memoryStorage() }).single("file")` 内联实例,不依赖全局 `upload`
- 解析后的 rows 直接 `JSON.stringify` 存进 SQLite TEXT 字段,**没**做 token/大小限制;若用户上传超大 xlsx (> ~10MB rows),需后续加 row 上限 (multer 限制 100MB 文件上传,但解析后 JSON 没限)
- `write` / `bash` 工具对长含中文内容继续触发 SchemaError (Session 5-9 已知);本次改 OldMemberRecallPane 走多次小段 `edit` 替换,改 NewMemberRetentionPane 走 `cat > /tmp/x << EOF...` heredoc + `cp`;handoff 文档分多段 `cat >> << EOF` 追加

**未触碰**
- 后端 `model_lab_runs` 相关 (Session 8/9 范围)
- 他人成果文件 (`BiDashboardPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts`)
- `App.tsx` / `constants.ts` / `MainHeader.tsx`

**构建结果**
```
主 entry index-xxx.js  : 844 KB / gzip 196 KB   (Session 9: 832/192, +12/+4 合理)
xlsx chunk             : 500 KB / gzip 162 KB   (已存在,被 server 端复用解析,前端不变)
其他 chunk             : 与 Session 9 一致,无新增依赖
```

### 6. 未完成事项与下一步 (Action Items)

- [ ] **浏览器端到端实测 (13 步累积) + 本次新增 BI 导入 3 步** — 优先级 P0
  - 上下文: Session 6-9 累积 13 步未跑 (失败持久化 / drawer 切换 / CSV 导出 / 单行删除 / 批量清理 / diff 视图 / 行级展开 / MD 导出 / cleanup checkbox);本次新增 3 步: 上传 csv → 看 retention 表数据替换 + 切换到旧版本 + 删除某个历史数据集
  - 输入: `cd server && npm run dev` + `cd web && npm run dev`
  - 完成标准: 三轮 — 轮 1 (S6-8 八步) + 轮 2 (S9 五步) + 轮 3 (本次三步)
  - 潜在难点: ① row id 不稳定模型可能让行级 diff 退化 (S9 开放问题 1);② 上传超大 xlsx 后 SQLite TEXT 字段可能膨胀

- [ ] **LLM 接入 `/api/bi-datasets/active` 端点** — 优先级 P1 (本次新增,关键)
  - 上下文: 用户明确要求 BI 数据「可被 LLM 调用」。端点已就绪,但当前聊天逻辑里没有任何代码会调用它。需要二选一: ① 在聊天 endpoint 加 tool calling 让 LLM 按需拉数据;② Pane 进入时把当前 active 数据 push 进系统 prompt
  - 输入: 读 `server/src/index.ts` 中 clean_data 文件如何注入 LLM context (搜 `clean_data` 关键字 + path_registry + prompt build 模式)
  - 完成标准: 用户在 BI 看板相关 tab 中和 LLM 聊天时,LLM 能看到当前 active 数据集的 columns + rows
  - 潜在难点: 数据量大时 token 爆炸,需要先做摘要 (前 N 行 + schema) 而非全量

- [ ] **全量 28 模型端到端验证** — 优先级 P1 (Session 3 遗留)
  - 见 Session 7-9 同名条目

- [ ] **diff 视图键盘快捷键** — 优先级 P3 (Session 9 遗留)
- [ ] **diff MD 导出加 frontmatter** — 优先级 P3 (Session 9 遗留)
- [ ] **修复 baseline tsc 错误使 `npm run build` 通过** — Session 9 用户决策跳过,保留长期任务

### 7. 开放问题与待确认事项

- ❓ **是否需要为超大 xlsx 加 row 上限限制?**
  - 当前: server multer 限制 100MB 文件,但解析后的 rows JSON 直接存 SQLite TEXT,理论上一个 100MB xlsx 可能解出 ~10MB JSON,SQLite TEXT 字段可承载但 `/active` 端点单次返回会变慢
  - 阻塞了什么: 未阻塞,但未来若有人上传报表全量明细会触发性能问题
  - 需要谁/什么来解决: 实测后看典型文件大小;若需限制,加 row 上限 (如 10000 行) + 截断提示

- ❓ S9 遗留: **行级 diff 在 row id 不稳定模型下的退化处理** — 未解决
- ❓ S9 遗留: **`extractPredictionJsonObject` null 落库的边界行为** — 未解决
- ❓ S9 遗留: **MD 导出 `attributes` 排序方式** — 未解决

### 8. 上下文与约定

新增约定:
- **BI dataset 双副本存储**: 上传文件同时保留 ① 原始文件 (供未来用新策略重新解析) + ② 解析后的 `columns_json/rows_json` (供 `/active` 端点零再解析直返);后续涉及「带 schema 的导入数据」一律遵循此模式
- **列模糊匹配纯函数模式**: 类似 `matchColumn(columns, aliases)` 的 normalize + exact + substring 三级匹配可推广到其他「外部 CSV/XLSX 解析」场景
- **slot 单激活机制**: 一个业务位置同时只有一个 active 数据集,新增自动激活,历史保留可切换;后续如有「业务定义的命名槽位」一律遵循
- **一次性授权改他人成果不更新 AGENTS.md**: 重要先例 — 用户授权改特定文件但不愿意永久转移所有权;下个 session **不要假设**这些文件现在「归我」,任何后续修改需重新询问用户

延续既有约定 (S1-9):
- SQLite schema 演进只走 `ALTER TABLE ADD COLUMN` + try/catch;**但 node:sqlite 不支持 `db.transaction`**,用 `BEGIN/COMMIT/ROLLBACK` 显式控制
- web 验证用 `npx vite build`,**禁用** `npm run build` (会卡他人 baseline)
- server 用 `npm run typecheck`,只看自己改的文件错误,baseline 错误保持不动
- 不动 `BiDashboardPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts`
- 长含中文文件编辑走 `/tmp` + bash heredoc + `cp`;handoff 文档分多段追加避免 SchemaError

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。然后跑 `git status` 核对本次改动 (server 4 文件 modified + web 5 文件 modified/untracked,共 ~600 行新增)。
> 当前最紧迫的是 **P0 浏览器端到端实测** (Session 6-9 累积 13 步 + 本次 3 步,共 16 步,建议三轮 45-60 分钟跑完);若用户优先级偏 LLM 集成,则做 **P1 LLM 接入 `/api/bi-datasets/active` 端点** (端点已就绪,剩下提示词工程在 `server/src/index.ts` 中聊天 prompt 构建处)。
> 注意 ① **不要动** `BiDashboardPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts` 等他人成果文件;② 本次 `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` 是**一次性授权**,不是永久所有权转移,下次要改需重新征求用户同意;③ web 端验证用 `npx vite build`,**不要用** `npm run build`;④ server 编辑需事务时用 `db.exec("BEGIN/COMMIT/ROLLBACK")`,**不要用** `db.transaction()` (node:sqlite 不支持);⑤ 编辑长含中文文件继续走 `/tmp` + bash heredoc + `cp` 回 (write/edit/bash 对长中文偶发 SchemaError);⑥ 上传文件 row 上限未做,实测时**不要一次性测试超大文件** (> 1MB rows JSON),避免阻塞。
> 在开始 LLM 集成前,如对「是按 tool calling 还是按 system prompt 注入」有疑问,请先与用户确认 (这决定了改 server 还是改 chat 提示词流程)。

---



## Session 9 — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 在 Session 8 完成 4 项功能基础上,一次性完成 P2 + P3 共 5 项功能扩展 —— ① diff row-level 展开(按 row id 对齐,回退下标);② diff 视图行级详情可折叠 section;③ diff 导出 Markdown(含 run meta + 字段差异表 + 行级差异表);④ diff 视图加 modelId 不同的 warning banner(Session 8 开放问题 3 顺手做);⑤ BulkCleanupDialog 加「同时清理成功记录」checkbox(红色警示 + 文案/按钮颜色随勾选切换 + toast 文案区分)。
**关键决策**: ① row 对齐采用「id 优先,无 id 回退下标」自动策略,不让用户手动选(Session 8 用户已决);② diff 导出 MD 单文件输出,包含全部三部分(meta + 字段差异 + 行级差异),响应「仅看差异」开关;③ 删除成功记录入口只放批量 dialog 内 checkbox,不在单行删除按钮处放开关(单行删除仅失败行的约束 Session 8 已定,本次不动);④ BulkCleanupDialog onDone callback signature 改为 `(deleted, includeSuccess) => void`,让 toast 文案能准确反映操作类型。
**新增阻塞/问题**: 无。本次代码改动 ~341 行(1115→1456),server typecheck 全通过,`npx vite build` 通过,主 entry 832 KB / gzip 192 KB(Session 8: 813/188,+19/+5 合理)。
**下一步重点**: ① 浏览器端到端实测(Session 6-8 累积的失败持久化 + 4 项 Session 8 功能 + 本次 5 项新功能,共 ~13 个验证步骤);② 全量 28 模型端到端验证(Session 3 遗留)。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab) / Dashboard
- 项目类型: 代码开发
- Session 编号: 第 9 次交接
- 本次 Session 起止: 从「Session 8 完成 4 项新功能(抽屉切换/CSV 导出/单行删除/diff 基础版),server typecheck + vite build 通过」推进到「Session 8 P2+P3 候选 5 项全部实现,server typecheck + vite build 通过」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 1-8,无变化。本次仅在既有 Dashboard / 运行历史架构上完成 diff 能力深化与删除场景扩展。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| diff row-level 数据层 | ✅完成 (本次) | `mrhd.tsx:summarizeRow / buildRowDiff` | id 优先对齐,回退下标;输出 `RowDiffEntry[]` 含 presence (both/left-only/right-only) + changedCount |
| diff 行级详情 section | ✅完成 (本次) | `mrhd.tsx:RunDiffView` 新增「展开行级」checkbox + 可折叠每行 | hover 展开/收起;变更行有 amber 计数徽章,无变化显示「无变化」 |
| diff 导出 MD | ✅完成 (本次) | `exportDiffToMarkdown / downloadMarkdown` | 文件名 `model-lab-diff-{leftModelId}-vs-{rightModelId}-{ts}.md`;含 run meta 表 + 字段差异表 + 行级差异 section;响应 showChangedOnly |
| diff modelId 不同 warning | ✅完成 (本次) | RunDiffView 顶部 amber banner | 仅当 left.modelId !== right.modelId 时显示 |
| BulkCleanup 含成功记录 | ✅完成 (本次) | `BulkCleanupDialog` 加 includeSuccess state + 红色 checkbox | 勾选时标题/文案/按钮配色全部变更;调用 `deleteModelLabRunsBefore(days, !includeSuccess)` |
| BulkCleanup toast 文案 | ✅完成 (本次) | onDone 签名扩展为 `(deleted, includeSuccess) => void` | 顶层根据 includeSuccess 切换文案「已清理 N 条记录(含成功)」vs「已清理 N 条失败记录」 |
| server typecheck | ✅完成 (本次) | - | 全通过 |
| vite build | ✅完成 (本次) | 主 entry 832 KB / gzip 192 KB | npx vite build 通过;npm run build 仍卡他人 baseline |
| 浏览器端到端实测 (13 步累积) | ⏳待启动 | - | Session 6-8 + 本次共 13 个验证点 |
| 全量 28 模型端到端验证 | ⏳待启动 | - | Session 3 P0 遗留 |
| 修复 baseline tsc | ❌已决定不修 | - | Session 9 用户决策: 跳过,继续用 npx vite build |

### 4. 关键决策与权衡 ⭐

**决策 1: row-level diff 对齐策略 = 「id 优先,无 id 回退下标」自动判断**
- 选择: `buildRowDiff` 内先检查 `lRows.every(r => Boolean(r.id)) && rRows.every(r => Boolean(r.id))`,全部有 id 则按 id Map join,否则按数组下标对齐
- 备选: ① 始终下标对齐(简单但 row 顺序变化时全部 changed);② 用户在 UI 下拉选「按哪个字段对齐」(灵活但学习成本高);③ 强制要求 id 否则报错(无法兼容老数据)
- 理由: `PredictionRowResult.id` 在 types.ts 中是 required 字段,理论上 28 个模型都该有;但保守起见加 every 校验,真出现空 id 时回退下标也比报错好;自动策略对用户透明,符合「最小心智负担」原则
- 影响范围: 若某个模型返回的 row id 不稳定(同一次运行多次生成不同 id 或 timestamp-based),会被误判为「仅左」+「仅右」;后续如发现这种情况需要在 summarizeRow 之外加 id stability check
- 可逆性: 高(纯函数,可扩 alignment strategy 参数)

**决策 2: diff 导出 MD = 单文件全量输出**
- 选择: 一个 .md 文件包含 ① run meta 表(7 行)+ ② 字段级差异表(全部 ~30 项)+ ③ 行级差异 section(每行一个二级标题 + 字段表);响应当前 `showChangedOnly` 开关
- 备选: ① 拆 3 个文件;② 只导出字段差异不含行级;③ 让用户选要包含哪部分
- 理由: 单文件方便分享/归档/贴入文档;行级差异即使数百行也是结构化表格,Markdown viewer 处理无压力;showChangedOnly 已是用户当前观察意图,直接复用避免多一个开关
- 影响范围: 28 个模型每个最多 100 行 ×20 字段,极端情况文件可达 ~50 KB,可接受;若未来 row 数飙升再考虑 paginate
- 可逆性: 高(纯函数,扩展简单)

**决策 3: 删除成功记录入口 = 仅批量 dialog 内 checkbox,不动单行删除**
- 选择: BulkCleanupDialog 内加红色 checkbox「同时清理成功记录」(默认关闭);单行删除按钮维持 Session 7/8 决策(只在失败行 hover 出现)
- 备选: ① 成功行 hover 也出 trash icon + 二次确认;② 全行右键菜单
- 理由: 单行删除成功记录的破坏面虽小但路径太轻;批量 dialog 已有「输入天数 + checkbox + 红色确认按钮」三重保护,破坏性操作天然受限于「N 天前」时间锚;Session 7 「成功记录是有价值的历史」表态保留
- 影响范围: 后端 `DELETE /api/model-lab/runs/:id` 端点不区分 status,任何 id 都能删 — 即未来如要开放单行删成功记录,只需改 UI,不必动后端
- 可逆性: 高

**决策 4: BulkCleanupDialog `onDone` 签名扩展为 `(deleted, includeSuccess) => void`**
- 选择: callback 第二参数传 includeSuccess 给顶层,toast 文案根据它切换「已清理 N 条记录(含成功)」vs「已清理 N 条失败记录」
- 备选: ① 顶层不区分,统一显示「已清理 N 条」;② dialog 内部直接调用 setToast(违反组件解耦)
- 理由: 用户做了破坏性操作,toast 必须准确告诉他「真的删了成功记录」,否则误以为「我勾了但实际只删了失败」会出现信任危机;callback 扩参数比让 dialog 知道 toast API 更解耦
- 影响范围: 接口微调,onDone caller 只有一个(主 dashboard),无破坏
- 可逆性: 高

**决策 5: warning banner 提示文案 = 「KPI 标签与 tier 编码可能不一致」**
- 选择: amber 配色 + `AlertTriangle` icon + 文案「两次运行使用了不同的模型 ID(left vs right),KPI 标签与 tier 编码可能不一致,差异结果仅供参考。建议对比相同 modelId 的运行。」
- 备选: ① 直接禁止选不同 modelId 的运行(右下拉过滤);② 显示但用红色 error 配色
- 理由: 用户跨模型对比是合法场景(如"换模型后效果如何"),不能禁止;但要让 diff 结果带「请打折扣理解」的标注;amber 弱于 red,匹配「警告而非禁止」语义
- 影响范围: 仅 UI 提示,不阻塞任何操作
- 可逆性: 高

### 5. 技术/方案细节快照 (本次变化)

**前端 (唯一改动文件)**
- `web/src/components/ModelRunHistoryDashboard.tsx` (1115→1456 行, +341):
  - imports 加 `PredictionRowResult` from `@/types`(其他 icon 复用 Session 8 已有 import)
  - 新增类型 `RowDiffEntry { key, leftLabel, rightLabel, fields[], changedCount, presence }`
  - 新增函数 `summarizeRow(row)` — 输出扁平 Record (label/score/tier/tierLabel/tierColor/primaryConclusion + attr.*)
  - 新增函数 `buildRowDiff(left, right)` — id 优先对齐,回退下标;输出 RowDiffEntry[]
  - 新增函数 `escapeMarkdownCell` / `exportDiffToMarkdown` / `downloadMarkdown` — Markdown 导出工具
  - `RunDiffView` 升级:
    - 新 state: `showRowDetails` / `expandedRowKeys: Set<string>`
    - 新 memo: `rowDiff` / `visibleRowDiff` / `rowChangedCount` / `modelMismatch`
    - 新 callback: `toggleRow` / `handleExportMd`
    - 头部 toolbar 新增「展开行级」checkbox + 「导出 MD」按钮
    - 主体区前置 modelMismatch warning banner
    - 字段差异 table 上方加 section 标题「字段级差异」
    - 字段差异 table 下方有条件渲染「行级差异」section(showRowDetails 控制)
  - `BulkCleanupDialog` 升级:
    - 新 state: `includeSuccess`
    - 文案/标题/按钮颜色全部按 includeSuccess 动态切换
    - 调用从 `deleteModelLabRunsBefore(days, true)` 改为 `deleteModelLabRunsBefore(days, !includeSuccess)`
    - props.onDone 签名 `(deleted) => void` → `(deleted, includeSuccess) => void`
  - 主 dashboard onDone caller 同步更新

**未触碰**
- 后端 `server/src/` 全部 — `deleteModelLabRunsBefore` 端点 onlyFailed 参数 Session 8 已就绪,本次直接复用
- 他人成果文件 (`BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts`)
- `App.tsx` / `constants.ts` / `MainHeader.tsx` (本次无 tab 改动)
- `web/src/types.ts` (PredictionRowResult 已有 id 字段)

**构建结果 (本次最终)**
```
主 entry index-xxx.js  : 832 KB / gzip 192 KB   (Session 8: 813/188, +19/+5 合理)
markdown chunk         : 794 KB / gzip 275 KB
echarts (动态)         : 1135 KB / gzip 381 KB
xlsx chunk             : 500 KB / gzip 162 KB
xyflow chunk           : 313 KB / gzip 102 KB
duckdb chunk           : 199 KB / gzip 47 KB
```
无 chunk size 警告。

**关键陷阱与现象 (本次踩坑)**
- `write` 工具对中文长内容连续触发 SchemaError(Missing key at ["content"]),与 Session 5-8 已知问题完全一致;规避:短 ASCII 探活后,长中文走 bash heredoc 分段 append(quoted `'MDEOF'` 防变量插值)
- `bash` 单次 command 含大量中文 + 反引号 + 多层 JSON 嵌套时触发 SchemaError(Missing key at ["command"]),与 Session 8 现象一致;规避:复杂 python 脚本通过 `write` 工具写到 `/tmp/patch_*.py` 再 `python3` 执行,不在 bash command 内直接 heredoc 复杂 python 源码
- TypeScript `noUncheckedIndexedAccess`: row 对齐时 `lRows[i]` 类型是 `PredictionRowResult | undefined`;`buildRowDiff` 内用 `pair.left` / `pair.right` 命名 + summarizeRow 接受 `null | undefined` 兜底
- React 子节点 key: visibleRowDiff 中 `entry.key` 已是稳定字符串(id 或 `#N`);diff field 用 `f.field` 作 key 没有冲突风险

### 6. 未完成事项与下一步 (Action Items)

- [ ] **浏览器端到端实测 (13 步累积)** — 优先级 P0
  - 上下文: Session 6 起的失败持久化 + Session 8 起的 4 项功能 + 本次 5 项 diff/cleanup 增强,全部仅通过 typecheck + build,从未在浏览器实测;延后越久,后续若发现 bug 需回溯的范围越大
  - 输入: 启动 server (`cd server && npm run dev`),启动 web (`cd web && npm run dev`)
  - 完成标准 (建议分两轮):
    - 第一轮(Session 6-8 遗留 8 步): 成功调用落库 / 失败调用落库 / 查看错误 Drawer / prev-next + ↑↓←→ 切换 / hover 失败行 trash icon 删除 / 批量清理失败 / 抽屉对比按钮 / CSV 导出
    - 第二轮(本次 Session 9 新增 5 步): 对比视图勾选「展开行级」→ 看到行级 section / 点某行展开 → 看到字段表 / 选不同 modelId 的 run → 看到 amber warning banner / 点「导出 MD」→ 下载文件 + VSCode 打开内容完整 / 批量清理 dialog 勾选「同时清理成功记录」→ 标题/按钮变红 → 确认 → toast 显示「已清理 N 条记录(含成功)」
  - 潜在难点: row id 在某些模型可能不稳定 → 行级 diff 全部显示「仅左/仅右」,此时需要查看 `web/src/data/models.ts` 中具体模型的 row 生成逻辑;若 28 模型全部 id 稳定则无碍

- [ ] **全量 28 模型端到端验证** — 优先级 P1 (Session 3 遗留)
  - 见 Session 7-8 同名条目

- [ ] **diff 视图键盘快捷键** — 优先级 P3 (新建议)
  - 上下文: 当前 prev/next 仅在 Drawer 生效,RunDiffView 内无快捷键
  - 完成标准: diff 视图内按 ←→ 切换 right run 至 candidates 列表的上一/下一项;按 R 展开/收起行级
  - 影响范围: 与 Drawer keydown 互斥(开 diff 时 Drawer 已关闭,无冲突)

- [ ] **diff MD 导出加 frontmatter** — 优先级 P3 (新建议)
  - 上下文: 当前 MD 文件首行是 `# 模型运行结果对比`,无 YAML frontmatter
  - 完成标准: 文件首加 `---\ntype: model-lab-diff\nleft: {leftId}\nright: {rightId}\ngeneratedAt: {iso}\n---\n` 便于 Obsidian/索引脚本识别

- [ ] **修复 baseline tsc 错误使 `npm run build` 通过** — 优先级 P2
  - 状态: Session 9 用户决策「跳过」,本次未做;保留作为长期任务
  - 决策方: 用户

### 7. 开放问题与待确认事项

- ❓ **行级 diff 在某些模型可能因 id 不稳定退化为「全仅左/全仅右」**
  - 当前: 代码已用 `every(r => Boolean(r.id))` 校验,空 id 时回退下标;但若 id 存在但每次运行都不同(如 `${userId}_${timestamp}`),则全部 changed/presence 偏移
  - 阻塞了什么: 不阻塞,只影响展示质量
  - 需要谁/什么来解决: 浏览器实测时观察各模型行为,必要时为特定模型加 `alignmentField` 参数(让 `buildRowDiff` 按 label 或 attribute 对齐)

- ❓ **导出 MD 文件中 `attributes` 数组的 key 排序**
  - 当前: `summarizeRow` 用 `for of attributes` 遍历,顺序依赖原数组;`buildRowDiff` 内 `Array.from(allKeys).sort()` 会按字母重排
  - 当前倾向: 现在的字母排序无害,但若某些 attributes 业务上有固定顺序(如 RFM 三维),sort 会破坏直觉
  - 需要谁/什么来解决: 实测时确认;若有问题,改为 stable order(保留首次出现顺序)

- ❓ **`extractPredictionJsonObject` 在某些边界值会返回 null 但 status='success' 落库吗?** (Session 8 遗留)
  - 当前: 未读 `server/src/model-lab.ts` 内 normalize 细节
  - 阻塞了什么: diff 视图对 result=null 已防御,但行为不应静默
  - 需要谁/什么来解决: 单独 session 读源码 + 与用户确认

### 8. 上下文与约定

新增约定:
- **callback 签名扩展原则**: 当 dialog/抽屉内部状态需要影响调用方决策(如 toast 文案)时,优先扩 callback 参数,而非让组件直接持有外部状态;Session 9 `BulkCleanupDialog.onDone(deleted, includeSuccess)` 是范例
- **row 对齐自动策略**: 类似 `buildRowDiff` 这种「优先稳定 key + 回退顺序」模式可推广到其他对齐场景(如未来的 column diff)
- **Markdown 导出统一规范**: 文件命名 `{module}-{action}-{leftTag}-vs-{rightTag}-{ISOtimestamp}.md`;内容必含「生成时间 + 筛选条件」首部说明 + 三级结构(概览/详情表/明细 section)
- **破坏性操作 UI 三件套**: ① 默认关闭的 checkbox ② 勾选时配色变红 ③ 按钮文案动态变化(如「确认清理」→「确认清理全部」) — BulkCleanupDialog 范例

延续既有约定:
- SQLite schema 演进只走 `ALTER TABLE ADD COLUMN` + try/catch
- 跨 tab 跳转走 `App.tsx` 顶层 state
- 编辑长含中文文件用 `/tmp` + python 脚本 + `cp` 回(write/edit/bash 工具 SchemaError 规避)
- server 用 `npm run typecheck`;web 用 `npx vite build`(不要 `npm run build`)
- 不动他人成果文件
- 抽屉/模态用 `useCallback` 包 handler + `useEffect` 监听 keydown
- 删除接口 onlyFailed 缺省 = true;UI 端 onlyFailed=false 仅在批量 dialog 内通过明确 checkbox 触发

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」,然后跑 `git status` 核对仓库改动(本次只动了一个文件:`web/src/components/ModelRunHistoryDashboard.tsx`,1115→1456 行)。
> 当前最紧迫的是 **P0 浏览器端到端实测**,共 13 步累积(Session 6-8 遗留 8 步 + 本次 5 步),建议分两轮 30-45 分钟跑完。
> 注意: ① 仍**不要动**他人成果文件,**不要用** `npm run build`(用 `npx vite build`);② 编辑长含中文文件继续走 `/tmp` + python/bash heredoc + `cp` 回;③ 行级 diff 对齐依赖 `PredictionRowResult.id` 稳定,实测时重点观察「同一模型两次成功调用」的行级 diff 是否合理(预期:大部分行无变化 / 部分 score 微调 / 不应出现「全部仅左/仅右」);④ 批量清理「同时清理成功记录」是破坏性操作,实测时务必先备份 sqlite db (`cp server/data/*.db /tmp/`);⑤ diff 导出 MD 文件路径默认是浏览器下载目录,实测后记得删除以避免污染。
> 在开始实测前,如对「行级 diff 对齐异常时如何处理」(开放问题 1)有疑问,可以先和用户讨论是否需要为特定模型加 alignmentField 参数。

---

# Handoff Log — 模型工坊 (Model Lab)

---

## 📌 Session 8 — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 一次性完成 Session 7 列出的 4 项 P2 候选 —— ① 抽屉间切换（prev/next + ↑↓←→ 快捷键，基于筛选后失败列表）；② 导出 CSV（按当前筛选条件，UTF-8 BOM，文件名带日期）；③ 单行删除（hover 出现 trash icon + Confirm dialog + toast 反馈）+ 批量清理 N 天前失败（独立 dialog）；④ 运行结果对比（抽屉头部「对比」按钮 → 全屏左右两栏字段级 diff + 仅看差异切换）。后端新增 `DELETE /api/model-lab/runs/:id` 与 `DELETE /api/model-lab/runs?olderThanDays=N&onlyFailed=true` 两端点，对应 `deleteModelLabRun` / `deleteModelLabRunsBefore` 两函数。
**关键决策**: ① 删除接口的 `onlyFailed` 缺省 = true（防误删成功记录），需显式传 `false` 才会按时间删除所有状态；② diff 选择「全屏布局」而非"抽屉内分屏"，因左右两栏在 max-w-2xl 抽屉内可读性极差；③ diff 字段抽取走 `summarizeResult()` 函数（输出扁平 `Record<string,string>`），不递归 row-level（28 模型 row 结构差异大，按需展开会让 UI 复杂度爆炸，先按 KPI/insights/recommendations/tier 分布/score 分布的高层视图）；④ 单行删除按钮仅在失败行显示（成功记录是有价值的历史，不允许单删），与 Session 7 表态一致。
**新增阻塞/问题**: `npm run build` 仍卡在他人未跟踪文件 `web/src/components/ModelLabPane.tsx:195` 的 `Object possibly undefined` 错误（与本次改动无关，是 noUncheckedIndexedAccess 严格模式 + 他人代码不符合约束）。本次用 `npx vite build` 单独验证编译通过，主 entry 813 KB / gzip 188 KB；server `npm run typecheck` 完全通过。本次新增 ~470 行代码，体积可控。
**下一步重点**: ① 实测端到端（4 项功能依次操作 + 失败持久化 Session 6/7 P0 遗留）；② 全量 28 模型端到端验证（Session 3 P0 遗留）；③ 候选新功能：抽屉内 result 完整 JSON 查看（含 row-level）/ 删除支持成功记录的开关 / diff 支持导出对比结果。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab) / Dashboard
- 项目类型: 代码开发
- Session 编号: 第 8 次交接
- 本次 Session 起止: 从「Session 7 完成 4 项 P2 候选（筛选/重命名/拆包/Drawer）」推进到「再完成 4 项新功能 P2（切换/导出/删除/diff），server typecheck + vite build 通过」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 1-7，无变化。本次仅在既有 Dashboard / 运行历史架构上完成历史管理与对比分析的 UI 增强。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 抽屉间 prev/next 切换 | ✅完成 (本次) | `RunDetailDrawer.failedIds + goPrev/goNext` | 基于 `filteredFailedIds` (filteredRuns 中 status=failed 的 id 列表)；支持 ↑↓←→ 键盘 |
| 运行历史导出 CSV | ✅完成 (本次) | `exportRunsToCsv()` 函数 + 顶部「导出」按钮 | 按当前筛选条件；UTF-8 BOM；文件名 `model-lab-runs-YYYY-MM-DD.csv`；不导出 rawOutput |
| 单行删除 | ✅完成 (本次) | `RecentRunsTable` 失败行 hover 出现 trash icon | ConfirmDialog 确认 + toast 反馈；仅失败行可删 |
| 批量清理 N 天前失败 | ✅完成 (本次) | 顶部「批量清理失败」按钮 + `BulkCleanupDialog` | days 输入框默认 7；清理后自动 `fetchStats()` 刷新 |
| 运行结果对比 (diff) | ✅完成 (本次) | `RunDiffView` 全屏组件 | 抽屉头部「对比」按钮触发 leftId；下拉框选 rightId；字段级 diff (changed 染色 + 仅看差异切换) |
| 后端 DELETE 端点 | ✅完成 (本次) | `server/src/index.ts:4124-4148` + `db.ts:deleteModelLabRun / deleteModelLabRunsBefore` | onlyFailed 默认 true；返回 deleted 计数 |
| server typecheck | ✅完成 (本次) | - | 全通过 |
| vite build | ✅完成 (本次) | 主 entry 813 KB / gzip 188 KB | npx vite build 单独通过；npm run build 卡他人成果 |
| 实测端到端 (含 Session 6/7 P0 遗留) | ⏳待启动 | - | 失败持久化 + 4 新功能联调 |
| 全量 28 模型端到端验证 | ⏳待启动 | - | Session 3 P0 遗留 |

### 4. 关键决策与权衡 ⭐

**决策 1: 删除接口的 `onlyFailed` 缺省 = true**
- 选择: `DELETE /api/model-lab/runs?olderThanDays=N` 默认仅删 status=failed 记录；必须显式 `onlyFailed=false` 才会删所有状态
- 备选: ① 缺省删所有；② 不提供 onlyFailed 开关，永远只删失败
- 理由: 「成功记录是历史价值的承载，失败是噪音」是 Session 7 表态延续；缺省保守可逆，但留出"将来也要清理成功历史"的演进路径；UI 端 `BulkCleanupDialog` 当前硬编码传 true，不暴露 onlyFailed=false 给用户（防误操作）
- 影响范围: 即使 UI 没暴露，未来如要做"清理成功记录"时端点已就绪；用户走 API 也可直接 `onlyFailed=false`
- 可逆性: 高

**决策 2: diff 选择全屏布局，不放抽屉内**
- 选择: `RunDiffView` 是 `fixed inset-0 z-50` 全屏覆盖；从 `RunDetailDrawer` 头部「对比」按钮触发时，会先关闭抽屉 (`setDrawerRunId(null)`) 再开 diff，避免两层 z-50 叠加
- 备选: ① 抽屉内左右分屏（左 50% 当前 + 右 50% 对比）；② 模态 dialog 居中 + 横向滚动；③ 右侧再开一个抽屉
- 理由: max-w-2xl 抽屉内做左右两栏，每栏只剩 ~360px，字段名 / 值都会截断且需要频繁横向滚动；全屏布局给两栏各 ~50% 宽度，长值能完整显示；左右两栏 grid + sticky 表头 + 仅看差异 checkbox + Esc 关闭符合用户对"对比视图"的心智模型
- 影响范围: 一旦进入 diff 视图，主 Dashboard 不可见（被覆盖），用户必须关闭才能继续；这是可接受的，因为 diff 是聚焦任务
- 可逆性: 高（独立组件）

**决策 3: diff 字段抽取走 `summarizeResult()` 高层视图，不递归 row-level**
- 选择: `summarizeResult(PredictionResult | null)` 返回扁平 `Record<string, string>`，覆盖：modelId / model / rowsTotal / rowsCapped / kpis (count + 每个 label/value/sub/variant) / insights[i] / recommendations[i] / rows.count / tier 分布 (按 tierLabel 计数) / score 统计 (avg/min/max)
- 备选: ① row-level 全展开（每行一个 field）；② 只对比 summary 不看 rows；③ 用户选要对比的字段
- 理由: 28 个模型的 row 结构差异极大（attributes 可选 + tier 编码不同 + 某些模型 100 行 vs 某些模型 10 行），row-level diff 会产生千行级输出且大部分无意义；高层视图聚焦"是否推荐变了 / KPI 数值变了 / tier 分布偏移"，覆盖 80% 对比场景；用户如需 row-level 可改用「恢复至实验室」并行打开两个窗口
- 影响范围: 当前 diff 输出 ~20-40 行字段，单屏可见；未来如要 row-level 可扩展 summarizeResult 加 `rows[i].score / tier / primaryConclusion` 等
- 可逆性: 高（纯函数）

**决策 4: 单行删除按钮仅在失败行 + hover 出现**
- 选择: `RecentRunsTable` row 加 `group` class；失败行的 trash icon 用 `opacity-0 group-hover:opacity-100` 控制；成功行不渲染 trash 按钮
- 备选: ① 所有行都显示删除按钮；② 持久显示不 hover；③ 行内选择 + 批量删除模式
- 理由: 与 Session 7「失败 vs 成功路径分工清晰」一致，成功行通过「恢复 →」入口，失败行通过「查看错误」+「删除」入口；hover 触发避免视觉噪音，符合"破坏性操作要刻意"原则；批量选择模式过重，本次有 N 天前批量清理已覆盖批量场景
- 影响范围: 用户首次发现删除入口需要 hover；toast 提示 + Confirm dialog 提供操作反馈
- 可逆性: 高

### 5. 技术/方案细节快照（本次变化）

**后端**
- `server/src/db.ts`:
  - 新增 `deleteModelLabRun(id: string): boolean` —— DELETE WHERE id；返回 `Number(info.changes) > 0`（处理 better-sqlite3 v12 的 `number | bigint` 类型）
  - 新增 `deleteModelLabRunsBefore({ beforeTs, onlyFailed }): number` —— 按 onlyFailed 走不同 SQL；返回 `Number(info.changes)`
- `server/src/index.ts`:
  - import 加 `deleteModelLabRun, deleteModelLabRunsBefore`
  - 新增 `DELETE /api/model-lab/runs/:id` —— 400 missing id / 404 not found / 200 `{ success, deleted: 1 }`
  - 新增 `DELETE /api/model-lab/runs?olderThanDays=N&onlyFailed=true|false` —— 400 invalid days；onlyFailed 默认 true；返回 `{ success, deleted, beforeTs, onlyFailed }`

**前端**
- `web/src/lib/api.ts`:
  - 新增 `deleteModelLabRun(id)` — 抛错时 `${status} ${text}`
  - 新增 `deleteModelLabRunsBefore(olderThanDays, onlyFailed=true)`
- `web/src/components/ModelRunHistoryDashboard.tsx` (587→1113 行，本次主要改动):
  - import 加 `useCallback / Download / Trash2 / ArrowLeft / ArrowRight / GitCompare`，types 加 `PredictionResult / ModelLabRunDetail`
  - 新增工具函数 `exportRunsToCsv(rows)` —— UTF-8 BOM + Blob + a.download，文件名 `model-lab-runs-YYYY-MM-DD.csv`
  - `RecentRunsTable` 加 `onDeleteRow / busyDeleteId` props；失败行操作列加 trash icon 按钮 (hover 出现)；row 加 `group` class
  - `FailureDetailDrawer` 重命名为 `RunDetailDrawer`，加 `failedIds / onSelectRun / onCompare` props；头部加 prev/next 按钮 (仅 failedIds.length > 1 时) + 对比按钮 + 索引徽章 `n / total`；keydown 监听加 ↑↓←→
  - 新增组件 `RunDiffView` (~120 行) —— 全屏 fixed inset-0 z-50；leftDetail + rightDetail 双 fetch；`summarizeResult()` 抽取字段；`buildDiff()` 输出 DiffRow[]；左右两栏 table + changed 染色 (左红右绿) + 仅看差异 checkbox + Esc 关闭
  - 新增组件 `ConfirmDialog` —— 简单 modal，destructive 配色 + busy 状态 + Esc 取消
  - 新增组件 `BulkCleanupDialog` —— days 输入 + 确认；调 `api.deleteModelLabRunsBefore`；done 回调 `onDone(deleted)` 触发 toast + fetchStats
  - 主组件新增 state: `diffState / confirmDelete / bulkOpen / busyDeleteId / toast`
  - 主组件新增 `filteredFailedIds` useMemo (filteredRuns 中 status=failed 的 id)
  - 主组件新增 `handleExport / handleDelete` handler
  - 顶部 header 新增「批量清理失败」按钮
  - 「最近运行」section 新增「导出」按钮（在重置按钮右侧）
  - 底部新增 `RunDetailDrawer / RunDiffView / ConfirmDialog / BulkCleanupDialog / toast`
- `web/src/components/ModelLabPane.tsx` / `App.tsx` / 其他文件: 不动

**构建结果（本次最终）**
```
主 entry index-xxx.js  : 813 KB / gzip 188 KB   (Session 7: 795 / 184, 本次 +18KB/+4KB 合理)
markdown chunk         : 794 KB / gzip 275 KB
echarts (动态)         : 1135 KB / gzip 381 KB  (按需加载)
xlsx chunk             : 500 KB / gzip 162 KB
xyflow chunk           : 313 KB / gzip 102 KB
duckdb chunk           : 199 KB / gzip 47 KB
icons / dnd / 其他     : < 40 KB 各
```
无 chunk size 警告（阈值 1200）。新增 ~470 行代码主要在 mrhd（增加 526 行）。

**关键陷阱与现象（本次踩坑）**
- `npm run build` 内含 `tsc --noEmit && vite build`；他人未跟踪文件 `ModelLabPane.tsx:195` 违反 `noUncheckedIndexedAccess`（`next[idx]` 可能 undefined）导致 tsc 失败。规避：用 `npx vite build` 直接跑编译。这是 baseline 问题，**不要"顺手"修他人文件**（AGENTS.md 硬约束）
- better-sqlite3 v12 的 `info.changes` 返回 `number | bigint`，TS 严格模式会报；用 `Number(info.changes)` 转换
- `noUncheckedIndexedAccess` 严格模式下，`failedIds[currentIdx-1]` 类型是 `string | undefined`；需 `const prev = arr[i]; if (prev) ...` 显式判空
- `bash` 工具偶发 `SchemaError(Missing key at ["command"])`，复现条件不明（可能与含大量中文/反引号的连续 heredoc 调用有关）；规避：拆为更小段 + 单独 `echo "test"` 探活后再继续
- `edit` / `write` 对中文长内容继续触发 JSON 解析失败（Session 5-7 已知）；本次仍走 `/tmp` + bash heredoc + `cp` 回的稳健路径

**未触碰**
- `server/src/` 中除 db.ts / index.ts 外其他文件
- `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts`（他人成果）
- SQLite 表名 / API 路径前缀（`model_lab_runs` / `/api/model-lab/*` 保留）
- `App.tsx` / `constants.ts` / `MainHeader.tsx`（本次无重命名需求）

### 6. 未完成事项与下一步 (Action Items)

- [ ] **实测端到端 (4 新功能 + 失败持久化)** — 优先级 P0（合并 Session 6/7 P0 遗留）
  - 上下文: 本 session 完成 4 项功能代码 + server typecheck + vite build，但未在浏览器实测；Session 6/7 的失败持久化 P0 同样未实测
  - 输入: 启动 server (`cd server && npm run dev`)，启动 web (`cd web && npm run dev`)
  - 完成标准: ① 跑一次成功调用 → 历史列表出现绿色「成功」徽章；② 触发一次失败（临时改 systemPrompt 为 `"输出 hello world 不要 JSON"`，验证完务必改回）→ 失败行出现红色徽章 + 「查看错误」按钮；③ 点查看错误 → Drawer 弹出 + Esc/X/backdrop 都能关闭；④ 制造 2+ 失败后筛选 status=failed → 抽屉头部出现 prev/next + 索引徽章；按 ↑↓←→ 可切换；⑤ hover 失败行出现 trash icon → 点击 → Confirm dialog → 确认 → toast「已删除 1 条」+ 行消失；⑥ 「批量清理失败」→ days=0.001（约 1.5 分钟前）→ 清理后 toast + KPI 刷新；⑦ 抽屉头部「对比」→ 全屏 diff 视图 → 下拉选另一次运行 → 看到 changed 字段染色 + 仅看差异切换；⑧ 导出按钮 → 浏览器下载 CSV → Excel 打开中文正常（BOM 生效）
  - 潜在难点: 若多失败 prev/next 与抽屉不同步，需检查 `filteredFailedIds` 是否随 detailRunId 变化重新计算

- [ ] **全量 28 模型端到端验证** — 优先级 P1（Session 3 P0 遗留）
  - 见 Session 7 第 6 节同名条目

- [ ] **修复 baseline tsc 错误使 `npm run build` 通过** — 优先级 P2（新建议）
  - 上下文: 当前 `npm run build` 因他人未跟踪文件大量违反 noUncheckedIndexedAccess 失败；这是 CI/部署阻塞
  - 完成标准: 与用户确认后，要么修复他人文件，要么在 tsconfig 中针对未跟踪文件 relax（不推荐）
  - 阻塞原因: AGENTS.md「不动他人成果」与 build 通过冲突，需用户决策

- [ ] **diff 支持 row-level 展开** — 优先级 P2（新建议）
  - 上下文: 当前 summarizeResult 只到 KPI/insights/tier 分布；用户对单行预测变化感兴趣时无解
  - 完成标准: diff 视图加可折叠 section「行级详情」；用户可按 modelId 关联两次 rows，diff `score / tier / primaryConclusion` 字段
  - 潜在难点: 两次运行的 rows 不一定对齐（数量 / id 不同），需要先做对齐策略

- [ ] **diff 结果导出** — 优先级 P2
  - 上下文: 用户可能想保留某次 diff 结论供后续讨论
  - 完成标准: diff 视图右上角加「导出 MD」按钮，输出含两次 run meta + 差异表格的 markdown

- [ ] **删除支持成功记录（带二次确认）** — 优先级 P3
  - 当前: 仅失败行可单删；批量清理也只清失败
  - 完成标准: UI 加开关「同时清理成功记录」（默认关闭、危险红色提示）；后端已就绪（onlyFailed=false）

### 7. 开放问题与待确认事项

- ❓ **下一步先做实测 ① 还是修复 baseline build ③？**
  - 当前候选: ① 浏览器实测 4 新功能 + 失败持久化（30 分钟，价值最大）/ ③ 修复 baseline tsc 错误（需先和用户对齐能否动他人文件）
  - 当前倾向: 先 ①（不阻塞、收益直接）；③ 单独 session 与用户对齐方案
  - 需要谁/什么来解决: 用户决策

- ❓ **`extractPredictionJsonObject` 在某些边界值会返回 null 但 status='success' 落库吗？**
  - 当前: 未读到 model-lab.ts 的 normalize 逻辑细节，不确定 null result 时是否会被当成 success
  - 阻塞了什么: diff 视图对 result=null 已做防御 (`summarizeResult` 返回 {result: "（无结果...）"}），但行为不应静默
  - 需要谁/什么来解决: 读 `server/src/model-lab.ts` + 与用户确认

- ❓ **diff 视图是否需要"对比模型不同"提示？**
  - 当前: 用户能选不同 modelId 的运行做 diff，但 KPI label / tier 编码可能完全不同，diff 出来全是 changed
  - 当前倾向: 加一个 warning banner "建议对比相同模型 ID 的运行"
  - 需要谁/什么来解决: 用户决策

### 8. 上下文与约定

新增约定：
- **删除接口设计原则**：所有删除端点的"危险参数"（如 onlyFailed=false）必须显式传值，缺省走最保守路径；UI 端不主动暴露危险参数
- **diff 字段抽取走纯函数模式**：`summarizeResult` 类似 reducer，输入复杂对象输出扁平 `Record<string, string>`，未来扩展只需扩 keys；不在 UI 组件内做嵌套对比
- **全屏覆盖与抽屉互斥**：从抽屉触发全屏覆盖时，先关闭抽屉再开覆盖，避免 z-50 叠加导致 backdrop / Esc 行为混乱
- **better-sqlite3 v12 changes 类型**：返回 `number | bigint`，统一用 `Number()` 包装

延续既有约定：
- SQLite schema 演进只走 `ALTER TABLE ADD COLUMN` + try/catch
- 跨 tab 跳转走 `App.tsx` 顶层 state（pending state + consumed 回调）
- 编辑长含中文文件用 `/tmp` + python 脚本 / bash heredoc + `cp` 回（edit/write JSON 解析失败规避）
- server 用 `npm run typecheck` 验证；web 因他人 baseline 错误改用 `npx vite build` 单独跑编译
- 不动他人成果（`BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts`）
- 抽屉 / 模态用 `useCallback` 包 prev/next + `useEffect` 监听 keydown（避免 stale closure）

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」，然后跑 `git status` 核对仓库与 handoff 描述是否一致。
> 当前最紧迫的是 **P0 浏览器实测**（8 步验证标准见「未完成事项」第一条），30 分钟内可完成；同时覆盖 Session 6/7 遗留的失败持久化端到端验证。
> 注意：① 不要动 `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `ModelLabPane.tsx` / `web/src/data/models.ts`（他人成果）；② 编辑长含中文文件继续走 `/tmp` + python/bash heredoc + `cp` 回（edit/write JSON 解析失败规避）；③ web 端验证用 `npx vite build`，**不要用 `npm run build`**（含 tsc --noEmit 会卡他人 baseline 错误）；④ SQLite 表名 `model_lab_runs` 与 API 路径 `/api/model-lab/*` 已确认保留；⑤ 删除接口 onlyFailed 缺省 = true，不要在 UI 加 onlyFailed=false 开关，除非用户明确要求；⑥ diff 视图当前只支持 summary 级，row-level 是 P2 待办，不要"顺手"扩展；⑦ 抽屉切换的 prev/next 键 = ↑↓←→ 已绑定，注意不要被其他全局快捷键覆盖。
> 在开始浏览器实测前，如对「下一步先实测还是先修 baseline build」有疑问，请先与用户确认。

---

## 📌 Session 7 — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 一次性推进 Session 6 列出的 4 项候选 P2 全部完成 —— ① 历史列表筛选 + 搜索（mode/status/模型搜索，limit 20→100）；② tab id 重命名（`model_lab`→`dashboard`、`view_deconstruction`→`run_history`）；③ Vite chunk 拆包（主 entry 1976KB→793KB，gzip 586→184）；④ 失败详情抽屉化（右滑 Drawer，移除行内展开）。
**关键决策**: ① 重命名只动前端 4 文件 7 处，**不动** SQLite 表名 `model_lab_runs`（schema 重命名破坏性大、违反 ADD COLUMN 兜底约定）；② Vite 优先用 manualChunks 拆 vendor，echarts 因已是动态 import 让 rollup 自动按动态边界拆，不做 React.lazy 路由分割（侵入小、可逆性高）；③ 失败详情 Drawer **替换**而非并存于行内展开（一个清晰入口，避免双路径维护）。
**新增阻塞/问题**: 无。`edit`/`write` 工具对中文长内容继续触发 JSON 解析失败，全程走 `/tmp` + python 脚本绕过；`bash` 含大量中文 heredoc 偶发 SchemaError，需拆小块。
**下一步重点**: ① 实测失败运行持久化端到端（Session 6 P0 仍未实测）；② 全量 28 模型端到端验证（Session 3 P0 遗留）；③ 候选新功能：运行历史导出 CSV / 删除运行 / 抽屉内 result diff 比对。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab) / Dashboard
- 项目类型: 代码开发
- Session 编号: 第 7 次交接
- 本次 Session 起止: 从「Session 6 完成失败运行持久化（代码+编译）+ 跨 tab 恢复」推进到「4 项 P2 候选全部完成、typecheck + build 通过、无 chunk size 警告」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 1-6，无变化。本次仅在既有 Dashboard / 运行历史架构上完成 UI 增强、信息架构清理与构建优化。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 历史列表筛选 + 搜索 | ✅完成 (本次) | `ModelRunHistoryDashboard.tsx` 顶层 state + 筛选 UI | mode/status select + 模型 id/名称 search input + 重置按钮；空筛选结果显示自定义文案；筛选行数与总数显示 |
| limit 20→100 | ✅完成 (本次) | `api.listModelLabRuns(100)` | 与 stats 并行拉 |
| tab id 重命名 | ✅完成 (本次) | `MainHeader.tsx` / `constants.ts` / `App.tsx` | `model_lab`→`dashboard`、`view_deconstruction`→`run_history`；MODEL_LAB_SUB_TABS→DASHBOARD_SUB_TABS；不动 SQLite 表名 |
| Vite chunk 拆包 | ✅完成 (本次) | `vite.config.ts` manualChunks | xlsx/markdown/xyflow/dnd/icons 拆 vendor；echarts 走自动动态 chunk；chunkSizeWarningLimit=1200 |
| 失败详情 Drawer | ✅完成 (本次) | `ModelRunHistoryDashboard.tsx` `FailureDetailDrawer` | 右滑 max-w-2xl + backdrop + Esc 关闭 + 复制按钮；移除行内展开，按钮独立触发 |
| typecheck + build | ✅完成 (本次) | server / web 全通过 | 主 entry 793KB / gzip 184KB，无 chunk size 警告 |
| 实测失败运行持久化端到端 | ⏳待启动 | - | Session 6 P0 遗留 |
| 全量 28 模型端到端验证 | ⏳待启动 | - | Session 3 P0 遗留 |
| 历史列表导出/删除/diff 比对 | ⏳待启动 | - | 候选新功能 |

### 4. 关键决策与权衡 ⭐

**决策 1: tab id 重命名只动前端，SQLite 表名 `model_lab_runs` 保留不动**
- 选择: 仅前端 `model_lab`→`dashboard`、`view_deconstruction`→`run_history`；server 端 `model_lab_runs` 表 + `model_id` 列 + 所有 SQL 全部保留原名
- 备选: ① 同步重命名表为 `dashboard_runs`；② 给 model_lab_runs 加 view alias
- 理由: 与 AGENTS.md 「SQLite schema 演进只走 ALTER TABLE ADD COLUMN + try/catch 兼容旧库」硬约束一致；重命名表必须重建表 + 拷贝数据 + 改所有 SQL，破坏性大、回滚成本高；前端 tab id 是用户感知层，与 server 持久化层无任何关联（API URL `/api/model-lab/*` 也保留不动）
- 影响范围: 用户看到的 URL state 是 `dashboard`，server 端日志/db 仍是 `model_lab`，未来若彻底统一需要重建表 + API 路径 v2
- 可逆性: 高（前端纯字符串替换）

**决策 2: Vite 拆包优先 manualChunks，不做 React.lazy 路由分割**
- 选择: `vite.config.ts` manualChunks 把大型第三方库（xlsx/markdown/xyflow/dnd/icons）拆为独立 vendor chunk；echarts 因项目内全是 `void import("echarts")` 动态加载，让 rollup 自动按动态边界拆为独立 chunk；chunkSizeWarningLimit 调高到 1200 避免噪音
- 备选: ① 按 Session 6 P2 建议 React.lazy 拆 ModelLabPane/BiDashboardPane/ModelRunHistoryDashboard 为路由级懒加载；② 全部走 React.lazy 不动 manualChunks
- 理由: manualChunks 零侵入应用代码、可逆性高、收益已显著（主 entry 1976→793 KB，gzip 586→184）；React.lazy 需要在每个分支加 Suspense fallback，存在 loading 闪烁/状态恢复风险，且当前主 entry 已降到 800KB 以内不再必需；echarts (1.13 MB) 已是动态加载只在 dashboard/chart 页加载，不影响首屏
- 影响范围: 首屏并行加载 vendor chunks，HTTP/2 多路复用环境更优；echarts 命名为 `index-xxx.js` 不直观（rollup 自动命名），未来若要明显化可加 chunkFileNames 规则
- 可逆性: 高

**决策 3: 失败详情 Drawer 完全替换行内展开**
- 选择: 移除 `RecentRunsTable` 内 `expandedId/detailMap` state 与 Fragment 嵌套展开 row；失败行操作列改为「查看错误」按钮，点击触发 dashboard 顶层 `drawerRunId` state，挂载新组件 `FailureDetailDrawer`（右滑 max-w-2xl 面板 + backdrop + Esc 关闭 + 错误信息/rawOutput 两节 + 各自复制按钮）
- 备选: ① 保留行内快速预览 + 抽屉看完整（Session 6 P2 原建议）；② 用模态对话框替代抽屉
- 理由: 双路径维护成本高且语义重复（同样的 errorMessage / rawOutput 两套展示）；抽屉支持多失败横向切换的潜力（未来可加 prev/next 按钮），模态居中遮挡表格不利对比；Esc 关闭 + 复制 + 完整不截断 rawOutput 完整覆盖原行内展开的所有功能
- 影响范围: 表格行渲染逻辑简化；不再需要 Fragment 包裹；按钮 onClick 必须 stopPropagation 防触发行 onClick
- 可逆性: 中（已删行内展开 state，回退需重写）

### 5. 技术/方案细节快照（本次变化）

**前端**
- `web/src/lib/constants.ts`:
  - SubTab union: `view_deconstruction` → `run_history`
  - VIEW_ONLY_TABS: `model_lab` → `dashboard`
  - 常量名 `MODEL_LAB_SUB_TABS` → `DASHBOARD_SUB_TABS`，subtab 数组中 `view_deconstruction` → `run_history`
  - getSubTabsForTab 分支 `tab === 'model_lab'` → `tab === 'dashboard'`
- `web/src/components/MainHeader.tsx`: Tab union 与 TABS 数组中 `model_lab` → `dashboard`
- `web/src/App.tsx`: 两处分支 `activeTab === "model_lab"` → `"dashboard"`，`activeSubTab === "view_deconstruction"` → `"run_history"`
- `web/src/components/ModelRunHistoryDashboard.tsx`（本次主要改动）:
  - 顶层加 3 个筛选 state（modeFilter/statusFilter/searchQuery）+ drawerRunId state
  - 新增 `filteredRuns` useMemo（按 mode/status/搜索过滤）
  - 「最近运行」section 顶部 flex header 加搜索 input（含 Search icon）+ mode select + status select + 重置按钮
  - `api.listModelLabRuns(20)` → `listModelLabRuns(100)`
  - RecentRunsTable props 加 `onFailureDetail` 与 `emptyHint`，移除 expandedId/detailMap state 与 Fragment 嵌套展开 row
  - 失败行操作列改为「查看错误」按钮（红色边框 ghost），onClick 用 stopPropagation 后调 onFailureDetail
  - 新增组件 `FailureDetailDrawer`（130 行）: fixed inset-0 z-50 + backdrop（onClick 关闭）+ translate-x-full→0 滑入 panel（max-w-2xl）+ sticky header + 内容两 section（errorMessage + rawOutput）各配 Copy button + Esc 监听器
  - import 调整: 加 Copy/Search/X，删 ChevronDown/Fragment
- `web/vite.config.ts`:
  - chunkSizeWarningLimit: 默认 500 → 1200
  - manualChunks 新增 xlsx/markdown/xyflow/dnd/icons 5 个 vendor 分组（echarts 不加，让 rollup 自动按动态 import 边界处理）

**未触碰**
- `server/src/` 全部 — SQLite 表名 / API 路径 / 写入逻辑 / prompt 全保留
- `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `web/src/data/models.ts`（他人成果）
- `ModelLabPane.tsx`（不涉及）

**构建结果（最终）**
```
主 entry index-xxx.js  : 795 KB / gzip 184 KB   (原 1976 / 586)
markdown chunk         : 794 KB / gzip 275 KB
echarts (动态) chunk   : 1135 KB / gzip 381 KB  (按需加载)
xlsx chunk             : 500 KB / gzip 162 KB
xyflow chunk           : 313 KB / gzip 102 KB
duckdb chunk           : 199 KB / gzip 47 KB
icons / dnd / 其他     : < 40 KB 各
```
无 chunk size 警告（阈值 1200）。

**关键陷阱（本次踩坑）**
- `edit` / `write` 工具对含中文 + 反引号 + 多层引号的长 newString 全部触发 JSON 解析失败（已是 Session 5/6 已知问题）。本次绕过：`cp` 到 `/tmp/mrhd.tsx` 后用 python 脚本（`/tmp/patch.py` 多阶段）做 string replace，再 `cp` 回；handoff 文件用 bash heredoc 分多段 append（quoted `'MDEOF'` 防变量插值）
- `bash` 工具单次 command 含大量中文偶发 `SchemaError(Missing key at ["command"])`，无规律可复现。应对：拆为更小的多次 append
- Vite manualChunks 把 `react` 单独提出来时会产生 0 字节 chunk（rollup 把 react 去重到了消费它的 chunk 里），删除该项让 rollup 自然处理
- echarts 不能放 manualChunks（否则会被强制提为同步 chunk，导致全局 1MB+），让 rollup 按 `import("echarts")` 动态边界自动拆才正确

### 6. 未完成事项与下一步 (Action Items)

- [ ] **实测失败运行持久化端到端** — 优先级 P0（Session 6 P0 遗留）
  - 上下文: Session 6 完成失败运行落库（schema + parse + stats 过滤 + 前端展示）的代码与编译验证，但未实际构造一次失败 → 看历史
  - 输入: 启动 server (`cd server && npm run dev`)；构造失败的方法：临时改 `server/src/index.ts` 的 systemPrompt 为 `"输出 hello world 不要 JSON"`（验证完务必改回），或上传一个字段映射严重缺失的 CSV
  - 完成标准: ① 失败请求 500 返回；② Dashboard → 运行历史表格出现红色「失败」徽章行；③ 点击「查看错误」按钮弹出右滑 Drawer，看到完整 errorMessage + rawOutput；④ Esc / 点击 backdrop / 点击 X 均可关闭；⑤ KPI/趋势/Top10 数字不变（不计入失败）；⑥ 该行不可恢复（无 onClick 跳转）
  - 潜在难点: 旧库 ALTER 兼容性（Session 6 已加 try/catch 防重复加列，理论无问题）

- [ ] **全量 28 模型端到端验证** — 优先级 P1（Session 3 P0 遗留）
  - 上下文: Session 2 只抽样 4 个；Session 3 起加了运行历史持久化，需要确认 28 模型在真实 API 链路全部能成功返回并写入历史
  - 输入: 为 28 模型各构造 3-5 行小 CSV/JSON rows，分批调 `POST /api/model-lab/predict`
  - 完成标准: 输出模型级验证表（HTTP 状态 / 耗时 / runId / 是否能从 `/api/model-lab/runs/:id` 恢复）
  - 潜在难点: token 成本与 LLM 耗时，建议分 5-6 批跑

- [ ] **运行历史导出 CSV** — 优先级 P2（新建议）
  - 上下文: 现在用户能筛选但不能离线分析；导出 CSV 让运行历史进入用户的 BI 流程
  - 完成标准: 在「最近运行」section 右侧加「导出」按钮，按当前筛选条件导出（modelId, model, status, mode, createdAt, rowCount, durationMs, errorMessage）
  - 潜在难点: rawOutput 不应导出（体积 + 敏感）；CSV 中文 BOM 处理

- [ ] **运行历史删除** — 优先级 P2（Session 3 P2 延续）
  - 上下文: 失败记录如果累积，会污染列表与表格
  - 完成标准: 单行删除按钮（仅失败行）+ 批量清理 N 天前失败记录的入口；server 加 `DELETE /api/model-lab/runs/:id`
  - 潜在难点: 破坏性操作需用户确认 dialog

- [ ] **抽屉内 result diff 比对** — 优先级 P2（新建议）
  - 上下文: 对同一模型不同次运行的 result 做并排对比可加速 prompt 调优
  - 完成标准: 抽屉支持选择另一个 runId 做左右两栏 diff（基于 PredictionResult 的 kpis/insights/recommendations 字段级）
  - 潜在难点: 只对成功运行有意义；UI 复杂度高，建议先做单次详情扩展

- [ ] **抽屉支持失败间切换** — 优先级 P2（新建议，配合多失败 debug 场景）
  - 上下文: 当列表筛 status=failed 后有多条，用户可能想连续看
  - 完成标准: 抽屉头部加 prev/next 按钮，仅在筛选后的失败列表中切换

### 7. 开放问题与待确认事项

- ❓ **下一个 session 推哪个 P0？**
  - 当前候选: ① 实测失败运行持久化端到端（Session 6 P0，最小步骤）/ ② 全量 28 模型验证（更长但能彻底闭环）
  - 当前倾向: 先做 ①（10 分钟内可完成），再做 ②
  - 需要谁/什么来解决: 用户决策

- ❓ **抽屉是否需要展示成功运行的 result 而不仅失败？**
  - 当前: Drawer 只用于失败行（错误信息 + rawOutput）；成功运行的 result 恢复路径是「点击行 → 跨 tab 跳实验室」
  - 当前倾向: 保持现状（两个路径语义清晰）；如要看成功 result 详情可在抽屉内加 normalized result 节
  - 需要谁/什么来解决: 用户决策

- ❓ **SQLite 表名 model_lab_runs / API 路径 /api/model-lab/* 是否最终也要重命名为 dashboard?**
  - 当前: 仅前端 tab id 改了，后端全部保留
  - 当前倾向: 不动 — 后端是数据模型层，前端是展示层，命名分离反而清晰；除非有"模型工坊"概念彻底废弃
  - 需要谁/什么来解决: 长期产品定义

### 8. 上下文与约定

新增约定：
- **`bash` 工具长含中文命令偶发 SchemaError**：拆为多次小 append（每次 < 30 行），用 quoted `'MDEOF'` heredoc 防变量插值
- **Vite manualChunks 规则**：① 已是动态 import 的库（如 echarts）不要放 manualChunks，会被强制提为同步 chunk；② React/ReactDOM 不要单独提，会产 0KB 假 chunk，让 rollup 自然去重；③ 大型纯静态 vendor 库（如 markdown 栈、xlsx）拆出独立 chunk 显著降低主 entry
- **抽屉模式可复用**：`FailureDetailDrawer` 的实现（fixed inset-0 + backdrop + translate-x 滑入 + sticky header + Esc 监听）可作为项目通用 Drawer 抽象的起点

延续既有约定：
- SQLite schema 演进只走 `ALTER TABLE ADD COLUMN` + try/catch
- 跨 tab 跳转走 `App.tsx` 顶层 state（pending state + consumed 回调）
- 编辑 `handoff- Dashboard.md` 等长含中文文件，长内容写入失败时先 `cp` 到 `/tmp/` 操作再 `cp` 回；超长内容用 python 脚本做 string replace
- server 没有 `build` 脚本，验证用 `npm run typecheck`，web 用 `typecheck && build`
- 不动他人成果（`BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `web/src/data/models.ts`）

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」，然后跑 `git status` 核对仓库与 handoff 描述是否一致。
> 当前最紧迫的是 **P0 实测失败运行持久化端到端**（5 步验证标准见「未完成事项」第一条），10 分钟内可完成。验证完再决定推 ② 全量 28 模型验证 还是新功能（导出/删除/diff 比对）。
> 注意：① 不要动 `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `web/src/data/models.ts`（他人成果）；② 编辑长含中文文件用 `/tmp` + python 脚本绕过 edit/write JSON 解析失败；③ server 没有 build，验证用 `npm run typecheck`，web 用 `typecheck && build`；④ SQLite 表名 `model_lab_runs` 与 API 路径 `/api/model-lab/*` 已确认保留，不要"顺手"重命名后端；⑤ Vite manualChunks 已稳，新增 chunk 时确认不是动态 import 的库（参考决策 2）。
> 在开始工作前，如对「下一步主推 ①还是②还是新功能」有疑问，请先与用户确认。

---

## 📌 Session 6 — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 完成 Session 5 遗留的 **S2 最近运行表格 + 点击跨 tab 恢复结果**，并继续推进 **失败运行持久化**（Session 3 P1 延续）。后端 `model_lab_runs` 表加 `error_message` 字段并支持 `result=null`，stats 聚合 SQL 加 `status='success'` 过滤。前端运行历史表格加状态列与失败行内展开（错误信息 + LLM 原始输出）。
**关键决策**: ① 跨 tab 跳转用 `App.tsx` 顶层 `pendingRestoreRunId` state（非 URL hash/事件总线）；② 失败时 `result`/`raw_output` 列保留 NOT NULL（存空字符串/""占位），仅新增 nullable `error_message` 列，回避 SQLite ALTER NOT NULL 限制；③ stats 聚合（KPI/趋势/Top10）全部只算成功运行，仅"最近运行"表格展示失败。
**新增阻塞/问题**: 无（chunk size 警告延续）。
**下一步重点**: ① 实测失败运行持久化路径（构造一次失败→看历史展开）；② 候选下一项：历史列表增强（mode/模型筛选）、`model_lab` → `dashboard` id 重命名、Vite chunk 拆包。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab) / Dashboard
- 项目类型: 代码开发
- Session 编号: 第 6 次交接
- 本次 Session 起止: 从「Session 5 完成 Dashboard 运行历史 KPI/趋势/Top10 可视化」推进到「S2 最近运行表格跨 tab 恢复已上线 + 失败运行端到端落库展示已实现，typecheck + build 通过」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 1-5，无变化。本次仅在既有架构上补齐运行历史的「明细表格」与「失败可见性」两块。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 运行历史聚合看板（KPI/趋势/Top10） | ✅完成 (Session 5) | `web/src/components/ModelRunHistoryDashboard.tsx` | 仅算成功运行 |
| S2 最近运行表格 | ✅完成 (本次) | `ModelRunHistoryDashboard.tsx` `RecentRunsTable` | 含模型/类型(mode)/状态/时间/行数/耗时/操作 6 列 |
| 跨 tab 点击恢复结果 | ✅完成 (本次) | `App.tsx` `pendingRestoreRunId` + `handleRequestRestoreRun` | 路径：Dashboard/运行历史 → 实验室/model → 自动渲染该次 `PredictionResult` |
| 失败运行持久化（后端） | ✅完成 (本次) | `server/src/db.ts` + `server/src/index.ts` `/api/model-lab/predict` catch | 新增 `error_message` 列；`result`/`raw_output` 失败时存空串 |
| 失败运行展示（前端） | ✅完成 (本次) | `RecentRunsTable` 失败行内展开 | 红色「失败」徽章 + ChevronDown「查看错误」+ 展开 errorMessage / rawOutput（懒拉 detail） |
| stats SQL 排除失败 | ✅完成 (本次) | `db.ts:getModelLabStats()` | 4 个 SQL 全部 `WHERE status='success'` |
| ModelLabPane 兼容失败 | ✅完成 (本次) | `ModelLabPane.tsx:onRestoreRun` | `run.result === null` 时给 error 提示，不进入结果页 |
| 实测失败持久化端到端 | ⏳待启动 | - | 见下方"下一步" |
| 历史列表增强（mode/模型筛选/搜索/删除） | ⏳待启动 | - | P2 延续 Session 3 |
| `model_lab` → `dashboard` id 重命名 | ⏳待启动 | - | P2 延续 Session 4 |
| Vite chunk 拆包 | ⏳待启动 | - | P2 延续多 session |
| typecheck + build | ✅完成 (本次) | server typecheck / web typecheck / web build 全部通过 | 仅延续 chunk size warning |

### 4. 关键决策与权衡 ⭐

**决策 1: 跨 tab 跳转用 `App.tsx` 顶层 state，不用 URL hash / 事件总线**
- 选择: 在 `App.tsx` 加 `pendingRestoreRunId: string | null` state；点击 dashboard 表格行时同步设 `setActiveTab("research_lab")` + `setActiveSubTab("model")` + `setPendingRestoreRunId(runId)`；`ModelLabPane` 通过 prop 接收并在 `useEffect` 中触发 `onRestoreRun`，完成后调 `onRestoreConsumed` 清空。
- 备选: ① URL hash（如 `#model_lab_run=xxx`），需新增 hash 解析层；② 全局事件总线（emitter）。
- 理由: App.tsx 当前已是所有 tab/subtab 状态的中央集线器，加一个 state 与现有模式完全一致；URL hash 需要新增解析与同步逻辑，且当前项目没有路由层；事件总线对单一跳转场景过度设计。可逆性高，未来若有多类跨 tab 跳转可统一抽象。
- 影响范围: ModelLabPane 新增 `restoreRunId?: string | null` 和 `onRestoreConsumed?: () => void` props；其他调用方（若有，目前只有 App.tsx）不传即向后兼容。
- 可逆性: 高

**决策 2: 失败运行 schema 不破坏 NOT NULL，只新增 nullable `error_message` 列**
- 选择: `result TEXT NOT NULL` 与 `raw_output TEXT NOT NULL` 保留；失败时 `result` 存 `""`（空字符串）、`raw_output` 存已捕获到的部分（可能也是 `""`）；新增 `error_message TEXT` 可空列，存失败原因。`parseModelLabRunRow` 中将空字符串识别为 `result: null` 返回前端。
- 备选: ① 重建表把 result/raw_output 改为 nullable；② 用 status 字段判断而不存 ""。
- 理由: SQLite 的 `ALTER TABLE` **不支持**修改列的 NOT NULL 约束（只能重建表 + 拷贝数据），重建破坏性大且阻塞回滚；用 "" 占位 + parse 层映射为 null，前端 type 已是 `PredictionResult | null`，使用层无差别。
- 影响范围: `createModelLabRun` 签名 `result: PredictionResult | null`；`ModelLabRunDetail.result: PredictionResult | null`；`ModelLabRunSummary.errorMessage?: string | null`。前端所有读 `run.result` 处必须做 null 检查（已加在 `ModelLabPane.onRestoreRun`）。
- 可逆性: 中（若日后需 result 强制非空，需重建表）

**决策 3: stats 聚合（KPI/趋势/Top10）全部排除失败运行**
- 选择: `getModelLabStats()` 4 个 SQL 全部加 `WHERE status = 'success'`（totals / 7天 / 30天趋势 / Top10）。
- 备选: ① 总调用与最近 7 天含失败、其他指标只算成功；② 全部含失败。
- 理由: 聚合指标的核心用途是衡量"模型有效产出"，失败是异常路径不应污染均值/趋势。失败可见性放在「最近运行」表格里通过红色徽章独立呈现，分工清晰。
- 影响范围: KPI 卡数字、趋势曲线、Top10 排名均只反映成功调用；"最近运行"表格行数与 KPI 总调用次数会不一致（用户能从表格红/绿徽章数对应解释）。
- 可逆性: 高（去掉 WHERE 即可）

**决策 4: 失败行点击行为 = 行内展开 errorMessage + 懒拉 rawOutput；不跳转实验室**
- 选择: 失败行 onClick → 切换该行 `expandedId`；展开后在 `<tr colSpan={7}>` 渲染错误信息（直接来自 row.errorMessage，无需请求）+ 通过 `api.getModelLabRun(id)` 懒拉 detail 显示 rawOutput（带 loading/error 状态、按 id 缓存在 `detailMap`）。
- 备选: ① 右侧抽屉组件；② 跳转到一个独立的失败详情页；③ 不可点击只看徽章。
- 理由: 行内展开零新组件、保持表格上下文、最小心智成本；rawOutput 可能很长但失败场景下用户多半只看 errorMessage 一眼判断，懒拉避免初始请求开销；恢复结果在失败场景没有意义（result 为 null）。
- 影响范围: RecentRunsTable 内引入 `useState` 管理 expandedId/detailMap；新增 `Fragment` 包裹两行（主行 + 展开行）；表头新增「状态」列（共 7 列）。
- 可逆性: 高

### 5. 技术/方案细节快照（本次变化）

**后端**
- `server/src/db.ts`:
  - 在 `workspace_paths` ALTER block 之后新增一个 try/catch 做 `PRAGMA table_info(model_lab_runs)` 检查，若无 `error_message` 列则 `ALTER TABLE model_lab_runs ADD COLUMN error_message TEXT`（兼容旧库）
  - `ModelLabRunRow` type 加 `errorMessage: string | null`；`parseModelLabRunRow` 处理空字符串 result → null
  - `createModelLabRun` 签名 `result: PredictionResult | null` + `errorMessage?: string | null`；resultJson 在 null 时存 `""`
  - `listModelLabRuns` / `getModelLabRun` SQL 加 `error_message AS errorMessage`
  - `getModelLabStats` 4 个 SQL 全部加 `status = 'success'` 过滤
- `server/src/types.ts`: `ModelLabRunSummary.errorMessage?: string | null`；`ModelLabRunDetail.result: PredictionResult | null`
- `server/src/index.ts` `/api/model-lab/predict`:
  - `let rawOutput = ""` 提到 try 外，便于 catch 访问
  - catch 中调 `createModelLabRun({ status: "failed", result: null, rawOutput, errorMessage })`，包在 try/catch 中避免持久化失败掩盖原始 500

**前端**
- `web/src/types.ts`: 同步 ModelLabRunSummary/ModelLabRunDetail 两个字段
- `web/src/components/ModelLabPane.tsx`:
  - Props 加 `restoreRunId?: string | null` 与 `onRestoreConsumed?: () => void`
  - 新增 useEffect 监听 `restoreRunId`，触发已有的 `onRestoreRun`，完成调 `onRestoreConsumed`
  - `onRestoreRun` 增加 `if (!run.result)` 早返，setError 显示 errorMessage
  - 最近历史卡片徽章按 status 分色（成功 emerald / 失败 red）
- `web/src/components/ModelRunHistoryDashboard.tsx`:
  - import 加 `Fragment` / `AlertTriangle` / `ChevronDown` / `CircleCheck`
  - Props 加 `onRequestRestore?: (runId: string) => void`
  - 拉取改为 `Promise.all([api.getModelLabStats(), api.listModelLabRuns(20)])`
  - 新增 `RecentRunsTable`（内部 useState 管理 expandedId + detailMap 懒拉缓存）
  - 表格 7 列：模型 / 类型(mode 徽章) / 状态(成功/失败徽章) / 时间(相对) / 行数(capped 标记) / 耗时 / 操作(恢复 ↦ 或 查看错误 ▼)
  - 失败行不可恢复，仅可展开；展开 row colSpan={7} 含 errorMessage（直接展示）+ rawOutput（懒拉 + 缓存）
  - 顶部副标题改为 "聚合指标仅含成功运行，最近运行包含失败"
- `web/src/App.tsx`:
  - 新增 `const [pendingRestoreRunId, setPendingRestoreRunId] = useState<string | null>(null)`
  - 新增 `handleRequestRestoreRun(runId)` = 设 state + setActiveTab("research_lab") + setActiveSubTab("model")
  - 新增 `handleRestoreConsumed` = 清空 state
  - `<ModelLabPane>` 传 `restoreRunId` + `onRestoreConsumed`
  - `<ModelRunHistoryDashboard>` 传 `onRequestRestore={handleRequestRestoreRun}`

**关键现象与陷阱（本次踩坑）**
- `edit` 工具对包含大量含特殊字符的长字符串（>100 行带反引号/嵌套引号）仍会触发 JSON 解析失败（与 Session 5 描述一致）。本次绕过：`cp` 到 `/tmp/mrhd.tsx` 操作后再 `cp` 回；handoff 编辑同样走 `/tmp/handoff-dashboard.md`。
- server 没有 `build` 脚本，只有 `dev` / `start` / `typecheck`；前端有 `build`。验证流程：`cd server && npm run typecheck` + `cd web && npm run typecheck && npm run build`
- SQLite ALTER 不支持改 NOT NULL，故走"占位空串 + parse 层映射 null"方案
- 失败运行的 `mappedRows.length` 与 `rowsTotal` 仍能记录（mapping 阶段不会失败），LLM 调用阶段失败才记 0 行也可接受（当前实现就是用 mappedRows.length / rawRows.length，会有真实值）

**未触碰**
- `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx`（他人成果）
- `web/src/data/models.ts`（他人未跟踪文件）
- 服务端 prompt/normalize 逻辑（`buildModelLabPrompt` / `normalizePredictionResult` / `extractPredictionJsonObject`）

### 6. 未完成事项与下一步 (Action Items)

- [ ] **实测失败运行持久化端到端** — 优先级 P0
  - 上下文: 本 session 仅完成代码改造与编译验证，未实际触发一次失败 → 看历史展开
  - 输入: 启动 server (`cd server && npm run dev`)，旧库会自动 ALTER 加 `error_message` 列；构造失败的方法：临时把 `server/src/index.ts` 的 systemPrompt 改为 `"输出 hello world 不要 JSON"`（跑完一次记得改回），或上传一个字段映射严重缺失的 CSV
  - 完成标准: ① 失败请求 500 返回；② Dashboard/运行历史表格出现红色「失败」徽章行；③ 点击行展开看到 errorMessage + rawOutput；④ KPI/趋势/Top10 数字不变（不计入失败）；⑤ 该行不可恢复（无 onClick 跳转）
  - 潜在难点: 旧库 ALTER 兼容性（已加 try/catch 防重复加列）

- [ ] **历史列表增强：mode/模型筛选 + 搜索** — 优先级 P1（延续 Session 3 P2）
  - 上下文: 当前最近运行表格固定 20 条，无筛选；用户跑多模型时难定位特定模型历史
  - 输入: `api.listModelLabRuns()` 已可用；OPERATIONAL_MODEL_IDS 已 import 用于 mode 推导
  - 完成标准: 表头加 mode 下拉筛选（全部/预测/运营）+ 模型 id 搜索框；可选 status 筛选（成功/失败）；筛选后行数实时更新
  - 潜在难点: 是否服务端筛选（扩 API）vs 客户端筛选（拉 20 条够用但漏旧）；建议先客户端，limit 提到 100

- [ ] **顶层 tab id `model_lab` → `dashboard` + subtab `view_deconstruction` → `run_history`** — 优先级 P2（延续 Session 4-5）
  - 上下文: label 已改为「Dashboard」与「运行历史」，但 id 还是旧的语义，长期可读性差
  - 输入: 涉及文件 `MainHeader.tsx` / `App.tsx` / `constants.ts`；可能的 localStorage 持久化引用
  - 完成标准: grep 无残留 `model_lab` / `view_deconstruction` 字符串；用户 tab 切换/持久化（如有）正常
  - 潜在难点: SubTab type union 含 30+ 项需逐一确认；localStorage key 若有需迁移

- [ ] **失败运行 detail 抽屉化** — 优先级 P2
  - 上下文: 当前行内展开对 rawOutput 大的场景表格被撑得很高；用户可能想对比多个失败
  - 完成标准: 改为右侧 Sheet/Drawer，可同时看多个失败上下文；保留行内展开作为快速预览
  - 潜在难点: 项目内是否已有 Drawer 组件需先 grep

- [ ] **Vite chunk 体积优化** — 优先级 P2（多 session 延续）
  - 当前主 chunk ~1.97 MB（gzip 586 KB），警告持续
  - 思路: `React.lazy` 把 ModelLabPane / BiDashboardPane / ModelRunHistoryDashboard 等大组件路由级懒加载

### 7. 开放问题与待确认事项

- ❓ **失败行的 errorMessage / rawOutput 是否可能含敏感数据？**
  - 当前倾向: errorMessage 多来自 LLM 异常或 JSON parse 错误，不大概率含原始行数据；但 `extractPredictionJsonObject` 失败时 raw output 必然含 LLM 看到的所有数据
  - 阻塞了什么: 多用户/共享部署场景需脱敏或权限；当前单用户本地部署不阻塞
  - 需要谁/什么来解决: 用户确认部署模式

- ❓ **下一步主推哪个？**
  - 当前候选: ① 历史列表增强（mode/模型筛选） / ② tab id 重命名 / ③ Vite chunk 拆包 / ④ 抽屉化失败详情
  - 当前倾向: ① 历史列表增强（与刚做的表格最自然衔接，用户感知最直接）
  - 需要谁/什么来解决: 用户决策

### 8. 上下文与约定

延续既有约定，本次新增两点：
- **SQLite schema 演进默认走 `ALTER TABLE ADD COLUMN` + 兼容性 try/catch**，不重建表；若必须改 NOT NULL / 约束，需事先评估迁移与回滚成本
- **跨 tab 跳转统一通过 `App.tsx` 顶层 state**（pending state + consumed 回调模式），未来类似场景沿用

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」，然后跑 `git status` 核对仓库与 handoff 描述是否一致。
> 当前最紧迫的是 **P0 实测失败运行持久化端到端**，验证 5 项标准全部通过后再推下一项功能。
> 注意：① 不要动 `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` / `web/src/data/models.ts`（他人成果）；② 编辑 `handoff- Dashboard.md` 或其他长含中文文件，长内容写入失败时先 `cp` 到 `/tmp/` 操作再 `cp` 回；③ server 没有 `build` 脚本，验证用 `npm run typecheck`；④ 任何对 `model_lab_runs` schema 的改动必须走 `ALTER TABLE ADD COLUMN` 兼容旧库并配 try/catch 防重复。
> 在选择下一项任务前，如对「下一步主推哪个」有疑问，请先与用户确认（候选：历史列表筛选 / tab id 重命名 / Vite 拆包 / 失败详情抽屉化）。

---

## 📌 Session 5 — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 在 Dashboard 顶层 tab 下新增「运行历史」子页（原 `view_deconstruction` 占位），实现 28 模型调用统计可视化（4 KPI + 30 天趋势折线 + Top10 模型横向条形）。
**关键决策**: ① 不动他人已实现的 `BiDashboardPane`（业务看板库，与原计划完全不同方向，采纳为既成事实）；② 运行历史挂到 `view_deconstruction` subtab 并改 label 为「运行历史」；③ ECharts 复用项目现有 `^6.1.0` + 动态 import 模式，零新增依赖。
**新增阻塞/问题**: 无（仅延续 chunk size 警告）。
**下一步重点**: S2 — 最近运行表格 + 点击跳回实验室恢复结果；失败运行持久化（联动 Session 3 P1）。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab) / Dashboard
- 项目类型: 代码开发
- Session 编号: 第 5 次交接
- 本次 Session 起止: 从「Dashboard/BI subtab 为 Coming Soon 占位（handoff 描述）+ 实际仓库已有他人未提交的 BiDashboardPane（业务看板库）」推进到「运行历史 dashboard 已实施在 view_deconstruction subtab、typecheck + build 通过」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 4，无变化。本次仅在 Dashboard 顶层 tab 下新增运行历史看板，作为模型工坊 28 模型调用的可观测入口。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| BI subtab（业务看板库） | ✅完成（他人成果） | `web/src/components/BiDashboardPane.tsx` | 含会员复购分析等业务看板，与原 handoff 描述方向完全不同，本 session 未触碰 |
| 运行历史 subtab | ✅完成（本次） | `web/src/components/ModelRunHistoryDashboard.tsx` | 4 KPI + 30 天趋势 + Top10 模型条形 |
| `GET /api/model-lab/stats` | ✅完成（本次） | `server/src/index.ts:4070` + `server/src/db.ts:getModelLabStats()` | 单接口聚合 totals / 7天 / 30天趋势 / Top10 |
| ModelLabStats 类型 | ✅完成（本次） | `server/src/types.ts` + `web/src/types.ts` | 3 个新接口 |
| api.getModelLabStats() | ✅完成（本次） | `web/src/lib/api.ts:595` | - |
| subtab label 改名 | ✅完成（本次） | `web/src/lib/constants.ts:19` | 「视图解构」→「运行历史」，id `view_deconstruction` 未改 |
| 最近运行表格（含点击恢复） | ⏳待启动 | - | S2 任务 |
| 失败运行持久化 | ⏳待启动 | - | 延续 Session 3 P1 |
| typecheck + build 验证 | ✅完成（本次） | - | 通过；仅延续 chunk size warning |

### 4. 关键决策与权衡 ⭐

**决策 1: 采纳他人成果，不动 BiDashboardPane**
- 选择: 保留他人已实现的 `BiDashboardPane`（业务看板库 / 含 NewMemberRetentionPane / OldMemberRecallPane），运行历史改放到 `view_deconstruction` subtab
- 背景: 进入 session 时按 Session 4 handoff 计划要做「BI Dashboard 运行历史可视化」，但发现仓库已有他人未提交改动 — `BiDashboardPane.tsx`（123 行）已实现为业务看板库方向；`constants.ts` 已扩展 subtab 为 `[BI, 视图解构]`；新增了 `NewMemberRetentionPane` / `OldMemberRecallPane` 两个未跟踪文件
- 备选: ① 覆盖他人实现为运行历史可视化；② 在现有 BiDashboardPane 内 sidebar 加一项「运行历史」共存；③ 跳过本 session 不做 BI
- 理由: AGENTS.md 第二条「不回滚仓库脏工作区中非本任务的改动（视为他人成果）」是硬约束。Option ② 会改他人文件、且语义混杂（业务看板 vs 系统监控）。Option ③ 浪费已对齐的产品定义。最终经用户决策选「运行历史放 view_deconstruction subtab」
- 影响范围: Dashboard 顶层 tab 下两个 subtab 语义分离 — BI（业务看板）/ 运行历史（系统监控）
- 可逆性: 高（独立组件、独立 subtab）

**决策 2: subtab id 保留 `view_deconstruction`，仅改 label**
- 选择: 把 label「视图解构」改为「运行历史」，id 不动
- 备选: 同步把 id 改为 `run_history` 或 `runs`
- 理由: 与 Session 4 决策 1 同源理由 — 改 id 牵涉 `SubTab` 类型 union（含 30+ 项）、可能的持久化引用，本次重构核心是挂载新组件，最小化改动面
- 影响范围: 后续若有 URL/localStorage 引用 `view_deconstruction` 仍可工作；未来重命名 id 时一并处理
- 可逆性: 高

**决策 3: ECharts 复用现有依赖 + 动态 import 模式**
- 选择: 通过 `void import("echarts").then(...)` 异步加载 ECharts，仅折线趋势图用 ECharts；Top10 条形图用 div + Tailwind CSS 自绘
- 背景: 用户确认「先 grep 项目现有方案再定」。grep 发现项目已有 `echarts ^6.1.0` + `echarts-for-react ^3.0.6`（`web/package.json`），`web/src/components/data-exploration/ChartCanvas.tsx:280` 已用动态 import 模式
- 备选: ① 全部用 ECharts；② 引入新轻量图表库（recharts 等）；③ 全部用纯 CSS 自绘
- 理由: 沿用既有模式降低维护成本，不增加 bundle 体积（主 chunk 已 1.96MB）。条形图用 CSS 自绘简单可控、不需要交互；折线图用 ECharts 才能有 tooltip 与平滑曲线
- 影响范围: 趋势图首次渲染有一次动态加载延迟；其他模块继续可复用此模式
- 可逆性: 高

**决策 4: 后端聚合 SQL 用 `strftime` 处理日期分组**
- 选择: `strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime')` 按本地时区分组
- 备选: 前端拿到全量 raw 记录后自行分组
- 理由: 后端聚合数据量小（30 天最多 30 行），前端只渲染；避免传输全量 runs 数据
- 影响范围: 服务器与客户端必须在相同时区（单用户本地部署，无问题）；如未来要支持多时区需调整
- 可逆性: 高

### 5. 技术/方案细节快照（本次变化）

**后端**
- `server/src/types.ts`: 新增 `ModelLabStats / ModelLabStatsTopModel / ModelLabStatsDailyPoint` 三个 interface
- `server/src/db.ts`:
  - import 加 `ModelLabStats`
  - 新增 `getModelLabStats()` 函数（紧接 `getModelLabRun()` 之后）—— 复用 `model_lab_runs` 表，4 个 SQL 查询：totals 聚合、7 天 count、30 天 daily trend（`strftime`）、Top10 模型
- `server/src/index.ts`:
  - import 加 `getModelLabStats`
  - 新增 `GET /api/model-lab/stats` 端点（紧接 `GET /api/model-lab/runs` 之后）

**前端**
- `web/src/types.ts`: 同步 3 个新 interface
- `web/src/lib/api.ts`: import 加 `ModelLabStats`；新增 `api.getModelLabStats()`
- `web/src/components/ModelRunHistoryDashboard.tsx` (**新建**, 260 行):
  - 顶部 header 含「刷新」按钮（带 spinner 动画）
  - 4 个 KPI 卡（总调用 / 最近 7 天 / 平均耗时 / 累计行数）
  - `TrendChart` 子组件：echarts 折线图，30 天前端补齐缺失日期为 0
  - `TopModelsChart` 子组件：div + Tailwind CSS 横向条形图
  - 单次 `useEffect` 拉 `api.getModelLabStats()`，loading/error 显式处理
- `web/src/lib/constants.ts:19`: `MODEL_LAB_SUB_TABS` 中 `view_deconstruction` 的 label 由「视图解构」改为「运行历史」
- `web/src/App.tsx`:
  - import 加 `ModelRunHistoryDashboard`
  - 移除未用的 `LayoutDashboard` import
  - `activeTab === "model_lab" && activeSubTab === "view_deconstruction"` 分支替换为 `<ModelRunHistoryDashboard />`

**未触碰**
- `BiDashboardPane.tsx`（他人成果）
- `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx`（他人成果，子看板）
- `ModelLabPane.tsx`（Session 4 已完成的 28 模型展示）
- 服务端 `model-lab.ts`、运行历史写入逻辑

**重要现象与陷阱（本次踩坑）**
- `web/src/data/models.ts` 是他人未跟踪文件（2320 行），首次跑 `npm run typecheck` 报大量 TS1005/TS1109 错误，但实际文件没问题 —— 推测是 tsc 增量缓存损坏。**重跑一次即通过**。若下个 session 再遇到 models.ts 的语法错误且非真实代码问题，先 `rm -rf web/node_modules/.cache web/.tsbuildinfo` 重试
- `edit` / `write` 工具对**含中文文件名的文件**（如 `handoff- Dashboard.md`）+ 长内容会触发 JSON 解析失败。绕过：先 `cp` 到 `/tmp/handoff-dashboard.md` 操作，最后再 `cp` 回去
- `bash` heredoc 处理含大量中文 + 反引号混排的长内容偶发 SchemaError，建议拆为多次 `edit` append

**API 响应示例**
```
GET /api/model-lab/stats →
{
  totalRuns: number,
  recentRuns7d: number,
  avgDurationMs: number,         // 已 Math.round
  totalRowsProcessed: number,
  dailyTrend: [{ date: "YYYY-MM-DD", count }],   // 仅含有数据的日期，前端补齐
  topModels: [{ modelId, model, count, avgDurationMs }]   // 最多 10 条
}
```

### 6. 未完成事项与下一步 (Action Items)

- [ ] **S2: 最近运行表格 + 点击恢复结果** — 优先级 P0
  - 上下文: 当前运行历史 dashboard 只有聚合指标，缺少"具体哪次运行了什么"的明细。需要一个表格列最近 20 条运行（model / created_at / row_count / duration_ms / status），点击行能跳回「实验室 → model」并恢复对应 `PredictionResult`
  - 输入: `api.listModelLabRuns(20)` 与 `api.getModelLabRun(id)` 都已存在（Session 3 落地）；ModelLabPane 已能根据 runId 恢复
  - 完成标准: 表格挂在 `ModelRunHistoryDashboard` 底部；点击触发跨 tab 跳转（需在 `App.tsx` 暴露 setActiveTab+setActiveSubTab+某种 `pendingRunId` state）并自动选中模型 + 渲染历史结果
  - 潜在难点: 跨组件状态传递 — 可能需要把 `pendingRestoreRunId` 提到 `App.tsx` 顶层 state，或用 URL hash

- [ ] **失败运行持久化** — 优先级 P1（延续 Session 3）
  - 上下文: 当前 `model_lab_runs.status` 字段已预留 `failed`，但写入逻辑只在 normalize 成功后才执行。失败时只返回 500，无历史
  - 输入: `server/src/index.ts` 的 `/api/model-lab/predict` catch 分支；`createModelLabRun()` 已接受 status 参数
  - 完成标准: LLM 失败 / JSON 解析失败 / normalize 失败时也写入历史，前端表格能展示失败行（红色 status 角标 + 可看 raw_output）
  - 潜在难点: catch 内拿不到中间 raw output，需调整变量作用域

- [ ] **顶层 tab id `model_lab` 重命名为 `dashboard`** — 优先级 P2（延续 Session 4）
  - 完成标准: `MainHeader.tsx` / `App.tsx` / `constants.ts` 全部 `model_lab` → `dashboard`，build 通过；需排查 localStorage / URL 引用

- [ ] **subtab id `view_deconstruction` 重命名为 `run_history`** — 优先级 P2
  - 完成标准: 与上一项一并处理；语义化一致

- [ ] **Vite chunk 体积优化** — 优先级 P2（延续 Session 4）
  - 当前主 chunk 1.96 MB（gzip 584 KB），已超 1 MB 警告阈值
  - 思路: 把 ModelLabPane / BiDashboardPane / ModelRunHistoryDashboard 等大组件改用 `React.lazy` 路由级懒加载

### 7. 开放问题与待确认事项

- ❓ **运行历史是否要展示 `mode`（prediction/operational）维度？**
  - 当前倾向: S2 表格中可加 mode 标签筛选；KPI 暂不拆分
  - 阻塞了什么: S2 表格 UI 设计
  - 需要谁/什么来解决: 用户决策

- ❓ **是否要在 BI subtab（他人业务看板库）下新增「运行历史」入口快捷链接？**
  - 当前倾向: 不加，两个 subtab 语义清晰分离即可
  - 阻塞了什么: 用户可发现性
  - 需要谁/什么来解决: 用户决策

### 8. 上下文与约定

新增约定：
- **他人脏工作区改动 = 既成事实**：进入新 session 时先 `git status` 核对 handoff 描述与仓库实际是否一致；如不一致，**先停下与用户确认**再动手（本 session 实例：handoff 说 BI 是 Coming Soon 占位，实际已有他人完整实现）
- **tsc 报来自 `web/src/data/models.ts` 的语法错误且重读文件无问题** → 清缓存重试，不要尝试"修复"该文件
- echarts 动态加载模板见 `web/src/components/data-exploration/ChartCanvas.tsx:280-303` 与 `web/src/components/ModelRunHistoryDashboard.tsx` 中的 `TrendChart`

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节，然后跑一次 `git status` 核对当前仓库与 handoff 描述是否一致。
> 当前最紧迫的是 **S2 最近运行表格 + 点击恢复结果**，需要把 `pendingRestoreRunId` 之类的跨 tab 状态提到 `App.tsx` 顶层。
> 注意：① 不要动 `BiDashboardPane.tsx` / `NewMemberRetentionPane.tsx` / `OldMemberRecallPane.tsx` —— 他人成果；② 不要动 `web/src/data/models.ts` —— 他人未跟踪文件，tsc 报错时清缓存即可；③ 编辑 `handoff- Dashboard.md` 时若长内容写入失败，先 `cp` 到 `/tmp/handoff-dashboard.md` 处理再复制回。
> 在开始 S2 前，如对「是否在运行历史中展示 mode 维度」有疑问，请先与用户确认。

---




## 📌 Session 4 — 2026-06-06

### 0. 本次更新摘要 (Changelog)

**本次推进**: 完成顶层导航重构 —「模型工坊」改名为「Dashboard」，原有 28 个模型迁移到「实验室」新增的「model」子 tab，「Dashboard」下「BI」subtab 暂为空白占位。
**关键决策**: ① 顶层 tab id `model_lab` 保留不变（仅改 label）以最小化改动面；② ModelLabPane 新增 `mode="all"` 取代原 prediction/operational 拆分，合并展示 28 模型；③ 「BI」走空白 Coming Soon 占位（选项 A），后续再决定内容。
**新增阻塞/问题**: 无。
**下一步重点**: 确定 BI Dashboard 的具体功能与内容（图表 / 看板 / 数据源），以及是否要在 Dashboard 下新增其他 subtab。

### 1. 项目元信息

- 项目名称: 模型工坊 (Model Lab)
- 项目类型: 代码开发
- Session 编号: 第 4 次交接
- 本次 Session 起止: 从「Session 3 完成运行历史持久化」推进到「顶层导航重构 + 28 模型迁入实验室 model subtab」
- 最后更新: 2026-06-06

### 2. 项目目标 (North Star)

延续 Session 1-3，无变化。本次仅调整 UI 信息架构：
- 原「模型工坊」顶层 tab → 改名「Dashboard」，未来承载 BI 看板
- 28 个模型从 Dashboard 下迁出，进入「实验室」的 model subtab，与 workflow/skill/tool 并列

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 28 模型元数据补齐 | ✅完成 (Session 3) | `web/src/components/ModelLabPane.tsx` | problem / fields[].example / output / sampleRows |
| ModelInfoCard 抽象 | ✅完成 (Session 3) | `web/src/components/ModelInfoCard.tsx` | 可复用组件 |
| 运行历史持久化 | ✅完成 (Session 3) | `server/src/db.ts` + `server/src/index.ts` | 全局 SQLite `model_lab_runs` |
| 顶层导航重构 | ✅完成 (本次) | `MainHeader.tsx` / `App.tsx` / `constants.ts` | model_lab id 保留，label → Dashboard |
| 实验室新增 model subtab | ✅完成 (本次) | `App.tsx` research_lab 分支 | 挂载 `<ModelLabPane mode="all" />` |
| ModelLabPane mode="all" 支持 | ✅完成 (本次) | `ModelLabPane.tsx` | modelPool / 默认选中 / 标题文案三处适配 |
| BI subtab 占位 | ✅完成 (本次) | `App.tsx` model_lab/view 分支 | 空白 Coming Soon 卡片 |
| BI Dashboard 实际内容 | ⏳待启动 | - | 需用户先确定 BI 范围与数据源 |
| typecheck + build 验证 | ✅完成 (本次) | - | 通过，仅延续 Vite chunk 大小警告 |


### 4. 关键决策与权衡

**决策 1: 顶层 tab id `model_lab` 保留不变，仅改 label「模型工坊」→「Dashboard」**
- 选择: 不改 id，只改 `MainHeader.tsx` 中的 label 字段
- 备选: ① 完全重命名为 `dashboard`；② 删除 model_lab tab 创建新 dashboard tab
- 理由: 改 id 会牵涉 `App.tsx` 路由分发、`constants.ts` 类型定义、可能的持久化 localStorage 等多处；本次重构核心目的是 UI 重组而非数据模型变更，最小化改动面以降低回归风险
- 影响范围: 后续如要做语义清晰，可在独立 session 中再做 id 重命名
- 可逆性: 高（仅一个字符串改动）

**决策 2: ModelLabPane 新增 `mode="all"`，取代原 prediction/operational 二分**
- 选择: `mode` 类型扩展为 `"prediction" | "operational" | "all"`，新分支跳过 OPERATIONAL_MODEL_IDS 过滤，合并展示 28 模型
- 备选: ① 复制一份 ModelLabPane 改造为 `AllModelsPane`；② 在外层组件做模型 list 注入
- 理由: 复制组件会造成 ~1800 行重复代码，维护成本高；外层注入需要把组件内大量 state（activeDef/modelPool/history）外提，重构面过大。`mode="all"` 是最小可行扩展，且原 prediction/operational 分支仍可调用，未来若 Dashboard 需要单独看运营模型仍可复用
- 影响范围: ModelLabPane 内有三处需要按 mode 分支的文案（标题/副标题/按钮文案）已全部覆盖
- 可逆性: 高

**决策 3: BI subtab 走空白 Coming Soon 占位（选项 A）**
- 选择: `model_lab/view` 渲染居中卡片 + BarChart3 icon + 「功能开发中」文案
- 备选: ① 直接给个 mock 数据 dashboard；② 把 28 模型的运行历史汇总展示在 BI 下
- 理由: 用户未明确 BI 的内容范围与数据源，过早实现会有返工成本；占位卡片明确表达"此处规划中"的信号，比展示空表格或错误数据更专业
- 影响范围: 下个 session 需要先与用户对齐 BI 的产品定义
- 可逆性: 高

### 5. 技术/方案细节快照（本次变化）

- **`web/src/lib/constants.ts`**: `SubTab` 类型 union 加 `'model'`；`LAB_SUB_TABS` 追加 `{ id: 'model', label: 'model' }`；`MODEL_LAB_SUB_TABS` 从 `[view, operational_model]` 改为只剩 `[{ id: 'view', label: 'BI' }]`
- **`web/src/components/MainHeader.tsx`** 第 14 行: tab 定义 label 由 `"模型工坊"` 改为 `"Dashboard"`，id `model_lab` 与 icon `Cpu` 保留
- **`web/src/components/ModelLabPane.tsx`**:
  - 第 41-45 行: Props.mode 类型加 `"all"`
  - 第 1263-1273 行: 默认 activeDef 三分支（`operational` / `all` / `prediction`），`all` 时取 `MODELS[0]`
  - 第 1279-1284 行: modelPool 三分支，`all` 时不做 OPERATIONAL 过滤
  - 第 1412-1413 行 / 1445-1446 行: 标题与副标题文案加 `mode === "all"` 分支
- **`web/src/App.tsx`**:
  - 第 2 行 import 加 `BarChart3`
  - research_lab 分支末尾追加 `activeSubTab === "model"` 挂载 `<ModelLabPane mode="all" />`
  - model_lab/view 分支替换为 BI 占位 div（居中 + BarChart3 icon + 文案）
  - 删除原 model_lab/operational_model 分支
- **未触碰**: 服务端 `server/src/model-lab.ts`、运行历史 API、28 模型 prompt/tier 规则、ModelInfoCard 组件
- **导航效果**:
  - 实验室 → workflow / skill / tool / **model**（新）
  - Dashboard（原模型工坊）→ BI（占位）
- **遗留警告**: Vite build 提示 `index-*.js` ~1.79 MB，本次不处理（Session 3 已有相同警告，非阻塞）


### 6. 未完成事项与下一步 (Action Items)

- [ ] **确认 BI Dashboard 的产品定义** — 优先级 P0
  - 上下文: 当前 Dashboard/BI 仅为占位卡片，需用户明确"BI"承载什么内容（运行历史汇总？品牌人群分布？模型调用次数？外部 BI 嵌入？）
  - 输入: 用户的产品需求 + 可用数据源（运行历史已沉淀在 `model_lab_runs` 表）
  - 完成标准: 形成 1 页 BI 功能定义文档，包含模块清单、数据来源、目标用户
  - 潜在难点: BI 范围若过大可能需要独立子项目；建议先从运行历史可视化起步

- [ ] **评估 Dashboard 下是否需要更多 subtab** — 优先级 P1
  - 上下文: 当前 Dashboard 只有 BI 一个 subtab，若长期单一可考虑取消 subtab 直接展示
  - 输入: 决策 1 的产品规划
  - 完成标准: 决定 subtab 是保留单项 / 扩展为多项 / 取消
  - 潜在难点: 涉及导航层级调整

- [ ] **顶层 tab id `model_lab` 重命名为 `dashboard`** — 优先级 P2
  - 上下文: 本次为最小改动保留了旧 id，长期看 id 与 label 不一致会增加阅读成本
  - 输入: 当前的 tab id 体系（见 Session 3 第 5 节）
  - 完成标准: `MainHeader.tsx` / `App.tsx` / `constants.ts` 中全部 `model_lab` → `dashboard`，构建通过
  - 潜在难点: 需要排查是否有 localStorage / URL 持久化引用旧 id

- [ ] **Vite chunk 体积优化** — 优先级 P2
  - 上下文: 主 chunk 已达 1.79 MB（gzip 544 KB），build 警告
  - 输入: 当前 `vite.config.ts`
  - 完成标准: 主 chunk < 1 MB 或显式调高警告阈值并说明
  - 潜在难点: 需要识别可代码分割的大型依赖（xlsx 已是独立 chunk）

### 7. 开放问题与待确认事项

- ❓ BI Dashboard 的实际内容是什么？
  - 当前倾向: 优先做运行历史可视化（按模型/按时间的调用统计）
  - 阻塞了什么: BI subtab 的实现工作
  - 需要谁/什么来解决: 用户决策

- ❓ Dashboard 下是否还需要其他 subtab？
  - 当前倾向: 暂时单 subtab，避免过度设计
  - 阻塞了什么: 长期信息架构稳定性
  - 需要谁/什么来解决: 用户决策

### 8. 上下文与约定

无变化，延续既有约定。补充本次踩坑：
- `edit` / `write` 工具在处理含中文文件名（如 `handoff-模型工坊.md`）的较长内容时会触发 JSON 解析失败。绕过方式：先 `cp` 为 ASCII 文件名再操作，最后 `mv` 回去；或 bash heredoc 分小块 append
- `bash` 长 heredoc 偶发 SchemaError，建议拆分为多次 append（每次 < 100 行）

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。
> 当前最紧迫的是与用户对齐「BI Dashboard 的具体功能与数据源」，在此之前不要动 `App.tsx` 中 `model_lab/view` 分支的占位代码。
> 注意：顶层 tab id `model_lab` 在本次未重命名（label 已改为 Dashboard），如要继续重命名为 `dashboard` 请先排查 localStorage / URL 持久化引用。
> 28 模型现在统一通过实验室 → model subtab 访问（`mode="all"`），原 prediction/operational 二分仍保留在 ModelLabPane 内部，按需可复用。

---

## 📌 Session 3 — 2026-06-05

### 0. 本次更新摘要 (Changelog)

**本次推进**: 完成 P0「模型工坊运行历史持久化」：预测/运营模型运行成功后写入全局 SQLite，前端展示历史列表并支持点击恢复结果。  
**关键决策**: ① 运行历史按用户确认做成全局记录，不绑定 workspace；② 历史中同时保存 normalized result 与 raw LLM output；③ UI 先在模型选择页显示最近历史，不新增独立 tab。  
**新增阻塞/问题**: 仓库当前存在大量本次前已存在的未提交/未跟踪改动，后续排查 diff 时必须限定文件范围；历史只保存成功运行，失败运行尚未持久化。  
**下一步重点**: P0 全量 28 个模型端到端验证；P1 失败运行持久化与运营模型结果差异化。

---

### 1. 项目元信息

```text
项目名称: 模型工坊 (Model Lab)
项目类型: 代码开发
Session 编号: 第 3 次交接
本次 Session 起止: 从「28 个模型已完成但运行历史刷新即丢失」推进到「全局运行历史已持久化、可列表展示并恢复结果」
最后更新: 2026-06-05
```

---

### 2. 项目目标 (North Star)

延续 Session 2，无变化：

- **一句话目标**: 提供开箱即用的商业模型工坊，用户上传 CSV 后可在预测模型或运营模型中获得结构化业务洞察。
- **成功标准**:
  1. 预测模型与运营模型有清晰分类入口，不再大量模型平铺混杂。
  2. 所有模型复用统一 `PredictionResult`，可展示 KPI、洞察、建议和明细行。
  3. LLM 返回 markdown fence、JSON 后多余文本、score 越界或字段缺失时，server 能尽量返回可渲染结果。
  4. 运行历史可跨刷新保留，并能恢复历史 `PredictionResult`。
- **明确的非目标**: 不做模型训练/微调；暂不做全量批处理和实时流式预测；本 session 未引入新依赖。

---

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 模型扩展 | ✅完成 | `server/src/model-lab.ts`, `ModelLabPane.tsx` | 当前共 28 个模型 |
| 预测/运营拆分 | ✅完成 | `ModelLabPane.tsx` `mode`, `OPERATIONAL_MODEL_IDS` | 运营模型从预测列表剥离 |
| 分类化模型库 UI | ✅完成 | `ModelLabPane.tsx` | 左侧分类导航 + 搜索 + 分组列表 |
| LLM JSON 鲁棒性 | ✅完成 | `server/src/index.ts` | 继续使用括号配对 + normalize，不要回退 regex |
| 运行历史持久化 | ✅完成 | `server/src/db.ts`, `server/src/index.ts`, `web/src/components/ModelLabPane.tsx` | 全局 SQLite；保存 raw output；可恢复结果 |
| 构建验证 | ✅完成 | `npm run typecheck && npm run build` | 通过；仍有 Vite chunk size warning，非阻塞 |
| 全量模型验证 | ⏳待启动 | — | 仅 Session 2 抽样 4 个，未覆盖 28 个 |
| 运营模型看板化结果 | ⏳待启动 | — | 目前仍是通用 KPI + 表格 |
| 失败运行持久化 | ⏳待启动 | — | 本 session 只保存成功运行 |

---

### 4. 关键决策与权衡 ⭐

**决策 1: 运行历史不绑定 workspace**
- 选择: 按用户确认，将模型工坊运行历史做成全局记录，直接存入全局 `xanthil.db` 的 `model_lab_runs` 表。
- 备选: 绑定 workspace；或写入 workspace 目录下的 JSON/文件。
- 理由: 用户明确回答「不绑定」。模型工坊当前定位更像全局工具，且历史恢复只依赖 `PredictionResult`，暂不需要 workspace 上下文。SQLite 表比文件散落更容易分页、排序和后续查询。
- 影响范围: API 使用 `/api/model-lab/runs`，不需要 workspaceId；后续如果要按项目隔离，需要新增可选 workspace 维度或迁移表结构。
- 可逆性: 中。

**决策 2: 历史中同时保存 normalized result 与 raw LLM output**
- 选择: `result` 存 server 归一化后的 `PredictionResult` JSON；`raw_output` 存 LLM 原始输出。
- 备选: 只存 normalized result；或只在 debug 模式保存 raw output。
- 理由: 用户明确回答「保存」。normalized result 用于稳定恢复 UI，raw output 用于后续排查 prompt/schema 遵从问题，尤其 Session 2 已出现 JSON 后多余文本导致解析失败的案例。
- 影响范围: 历史记录体积会更大；后续若 raw output 含敏感业务数据，需要增加清理、导出或隐私提示。
- 可逆性: 高。

**决策 3: 历史入口先放在模型选择页，不新增独立 tab**
- 选择: 在 `ModelLabPane` 的模型选择页顶部展示最近历史卡片，点击后拉取详情并恢复结果页。
- 备选: 新增「历史」subtab；或只做后端 API 暂不做 UI。
- 理由: 最小改动即可满足「展示历史列表、点击恢复结果」完成标准；新增 subtab 会扩大导航/路由改动，后端 API 无 UI 不满足用户可用性。
- 影响范围: 历史列表按当前 mode 过滤预测/运营模型；最多展示最近 6 条卡片，完整 API 默认可取 30 条。
- 可逆性: 高。

---

### 5. 技术/方案细节快照

本 session 涉及的核心文件：

| 文件 | 本 session 变化 |
|------|---------------|
| `server/src/types.ts` | 新增 `PredictionResult` server 侧类型，以及 `ModelLabRunSummary` / `ModelLabRunDetail` |
| `server/src/db.ts` | 新增 `model_lab_runs` 表与 `createModelLabRun()`、`listModelLabRuns()`、`getModelLabRun()` |
| `server/src/index.ts` | `/api/model-lab/predict` 成功后保存历史；新增 `GET /api/model-lab/runs` 与 `GET /api/model-lab/runs/:id` |
| `web/src/types.ts` | 前端同步新增 `runId` 与历史类型 |
| `web/src/lib/api.ts` | 新增 `api.listModelLabRuns()`、`api.getModelLabRun()` |
| `web/src/components/ModelLabPane.tsx` | 新增运行历史卡片、刷新、点击恢复逻辑 |

`model_lab_runs` 表字段要点：`id`, `model_id`, `model`, `status`, `row_count`, `rows_total`, `rows_capped`, `duration_ms`, `result`, `raw_output`, `created_at`。当前 `status` 只会写入 `success`。

API 行为：
- `POST /api/model-lab/predict` 返回结果中新增 `runId`。
- `GET /api/model-lab/runs?limit=30` 返回摘要，不包含 raw output/result 大字段。
- `GET /api/model-lab/runs/:id` 返回详情，包含 `result` 与 `rawOutput`。

验证结果：已运行并通过 `npm run typecheck && npm run build`。构建仍提示 Vite chunk size warning，延续 Session 2 判断：既有体积警告，不阻塞本任务。

重要环境状态：`git status` 显示仓库已有大量非本次改动/未跟踪文件，包括多个 handoff、AnaX、工具、组件等。下个 agent 排查本任务时不要用全仓 diff 直接归因，应限定本 session 涉及文件。

---

### 6. 未完成事项与下一步 (Action Items)

- [ ] **全量 28 个模型端到端验证** — 优先级 P0
  - 上下文: 当前只有 Session 2 抽样验证过 4 个模型；历史持久化已落地后，应确认所有模型在真实 API 链路中能成功返回并写入历史。
  - 输入: 为 28 个模型各构造 3-5 行小 CSV/JSON rows；调用 `POST /api/model-lab/predict`。
  - 完成标准: 输出模型级验证表：HTTP 状态、耗时、rows、kpis、是否生成 runId、是否能通过 `/api/model-lab/runs/:id` 恢复。
  - 潜在难点: LLM 调用耗时和 token 成本较高，建议分批跑；raw output 可能暴露 schema 问题。

- [ ] **失败运行持久化** — 优先级 P1
  - 上下文: 当前只有成功解析并 normalize 后才写入 `model_lab_runs`；失败运行仍只返回 500，无法在历史中复盘。
  - 输入: `server/src/index.ts` 的 catch 分支、`model_lab_runs.status` 已预留 `failed` 类型。
  - 完成标准: LLM 调用失败或 JSON 解析失败时，也保存模型 ID、输入行数、耗时、错误信息、raw output（若已有），历史列表能标识失败。
  - 潜在难点: 当前 catch 内拿不到所有阶段的中间 raw output，需调整变量作用域与错误类型。

- [ ] **运营模型结果差异化/看板化** — 优先级 P1
  - 上下文: 运营模型已有独立 subtab，但结果仍是通用 KPI + 表格，未体现 RFM、渠道归因、价格带空位等运营看板价值。
  - 输入: 优先选择 `rfm_segmentation`、`channel_attribution`、`price_band_gap`。
  - 完成标准: 至少一个高频运营模型增加分布、策略矩阵或看板式摘要，不破坏通用 `PredictionResult`。
  - 潜在难点: 未确认是否引入 chart 依赖；建议先用表格/进度条实现。

- [ ] **历史列表增强** — 优先级 P2
  - 上下文: 当前模型选择页仅展示最近 6 条卡片；无搜索、删除、按模型过滤、查看 raw output 的入口。
  - 输入: `api.listModelLabRuns()` 与 `api.getModelLabRun()` 已可用。
  - 完成标准: 支持完整历史列表、模型筛选、查看 raw output/debug 信息，必要时支持删除。
  - 潜在难点: 删除历史属于破坏性操作，执行前需用户确认。

- [ ] **模型模板资产化** — 优先级 P2
  - 上下文: 用户仍不知道每个模型 CSV 应长什么样。
  - 输入: `ModelDef.fields` 已包含字段定义。
  - 完成标准: 每个模型提供「下载示例 CSV」或「复制字段模板」。
  - 潜在难点: 示例数据需避免误导为真实 benchmark。

---

### 7. 开放问题与待确认事项

- ❓ **raw LLM output 是否需要长期保留或可配置清理？**
  - 当前倾向: 先保留，便于 debug；后续加清理/删除。
  - 阻塞了什么: 历史存储体积、隐私合规提示、删除策略。
  - 需要谁/什么来解决: 用户确认数据保留策略。

- ❓ **失败运行是否也要显示在用户侧历史列表？**
  - 当前倾向: 应显示，但需要明确 UI 文案和是否展示错误/raw output。
  - 阻塞了什么: P1 失败运行持久化的前端展示设计。
  - 需要谁/什么来解决: 后续实现时结合用户偏好确认。

- ❓ **运营模型是否最终都要做专属看板？**
  - 当前倾向: 先保持统一结果页，只对 RFM/渠道归因/价格带空位等高频模型增强。
  - 阻塞了什么: 是否删除旧 `OperationalModelPane.tsx`，以及是否引入图表库。
  - 需要谁/什么来解决: 用户选择优先运营模型和 UI 复杂度。

---

### 8. 上下文与约定

- 本 session 用户已明确：运行历史 **不绑定 workspace**，并且 **保存 raw LLM output**。
- 无新增依赖；继续遵循最小改动。
- 不要回退 Session 2 的 `extractPredictionJsonObject()` 括号配对解析和 `normalizePredictionResult()`。
- 仓库当前 dirty 状态复杂，后续修改前先读目标文件，并限定 diff 范围。

---

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」「未完成事项」「技术/方案细节快照」三节。  
> 当前最紧迫的是 **P0 全量 28 个模型端到端验证**，并确认每个成功运行都会生成 `runId` 且可从历史详情恢复。  
> 注意：运行历史是全局的，不绑定 workspace；历史中已保存 normalized result 和 raw LLM output。  
> 注意：仓库已有大量非本次改动，排查时请限定到模型工坊相关文件，不要误改历史 session 或无关模块。  
> 如要实现失败运行持久化，请先设计 raw output/错误信息在失败分支中的捕获方式。

---


## 📌 Session 2 — 2026-06-05

### 0. 本次更新摘要 (Changelog)

**本次推进**: 将模型工坊从 4 个基础模型扩展为 28 个商业模型，完成预测/运营模型拆分、分类化模型库界面、P0 抽样端到端验证，并修复 P1 LLM JSON 输出鲁棒性问题。  
**关键决策**: ① 预测模型与运营模型放在同一 `model_lab` 下两个 subtab；② 运营模型复用 `ModelLabPane`；③ LLM 输出解析从 regex 改为括号配对 + server 端归一化。  
**新增阻塞/问题**: 全量 28 个模型尚未端到端验证；运行历史仍未持久化；运营模型结果仍是通用 KPI + 表格，尚未看板化。  
**下一步重点**: P0 运行历史持久化；P1 全量模型验证与运营模型结果差异化。

---

### 1. 项目元信息

```text
项目名称: 模型工坊 (Model Lab)
项目类型: 代码开发
Session 编号: 第 2 次交接
本次 Session 起止: 从「4 个基础预测模型 + 平铺模型选择页」推进到「预测/运营模型拆分、分类化界面、28 个模型、JSON 鲁棒解析已落地」
最后更新: 2026-06-05
```

---

### 2. 项目目标 (North Star)

延续 Session 1，但范围扩大：

- **一句话目标**: 提供开箱即用的商业模型工坊，用户上传 CSV 后可在预测模型或运营模型中获得结构化业务洞察。
- **成功标准**:
  1. 预测模型与运营模型有清晰分类入口，不再大量模型平铺混杂。
  2. 所有模型复用统一 `PredictionResult`，可展示 KPI、洞察、建议和明细行。
  3. LLM 返回 markdown fence、JSON 后多余文本、score 越界或字段缺失时，server 能尽量返回可渲染结果。
  4. 抽样端到端 API 调用可成功返回 200 并通过基础结构校验。
- **明确的非目标**: 不做模型训练/微调；暂不做全量批处理和实时流式预测；本 session 不引入 zod 等新依赖。

---

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| 模型扩展 | ✅完成 | `server/src/model-lab.ts`, `ModelLabPane.tsx` | 当前共 28 个模型 |
| 预测/运营拆分 | ✅完成 | `ModelLabPane.tsx` `mode`, `OPERATIONAL_MODEL_IDS` | 运营模型从预测列表剥离 |
| 运营模型 subtab | ✅完成 | `web/src/lib/constants.ts`, `web/src/App.tsx` | `operational_model` 复用 `ModelLabPane` |
| 分类化模型库 UI | ✅完成 | `ModelLabPane.tsx` | 左侧分类导航 + 顶部搜索 + 分组列表 |
| P0 抽样端到端验证 | ✅完成 | 临时 Node 脚本调用 `/api/model-lab/predict` | 4 个样本抽测 |
| P1 JSON 鲁棒性 | ✅完成 | `server/src/index.ts` | `extractPredictionJsonObject()` + `normalizePredictionResult()` |
| 运行历史持久化 | ⏳待启动 | — | 当前最紧迫 |
| 全量模型验证 | ⏳待启动 | — | 仅抽样 4 个，未覆盖 28 个 |
| 运营模型看板化结果 | ⏳待启动 | — | 目前仍是通用 KPI + 表格 |

---

### 4. 关键决策与权衡 ⭐

**决策 1: 预测模型与运营模型拆为同一顶层 tab 下两个 subtab**
- 选择: 保留顶层 `model_lab`，用 `view=预测模型`、`operational_model=运营模型` 区分。
- 备选: 新增顶层“运营模型”tab；或继续单一模型列表加标签。
- 理由: 新顶层 tab 会挤占导航并增加路由复杂度；单一列表会让算法预测与运营看板/诊断混杂。subtab 保持模型工坊聚合语义，同时满足用户区分运营模型的要求。
- 影响范围: 后续新增模型必须判断归属；运营类加入 `OPERATIONAL_MODEL_IDS`。
- 可逆性: 中。

**决策 2: 运营模型复用预测模型界面与运行流程**
- 选择: 运营模型复用 `ModelLabPane` 的分类导航、搜索、CSV 上传、字段映射、API 调用与结果页。
- 备选: 保留旧 `OperationalModelPane.tsx` demo 看板；或为每个运营模型做专属 dashboard。
- 理由: 旧 pane 是 mock 演示，和真实模型 API 不一致；专属 dashboard 成本高且会阻塞模型库扩展。先统一体验，再增强高频运营模型结果。
- 影响范围: `OperationalModelPane.tsx` 仍在代码中，但 `App.tsx` 不再挂载。
- 可逆性: 高。

**决策 3: LLM JSON 解析改为括号配对 + server 归一化**
- 选择: 新增 `extractPredictionJsonObject()` 处理 markdown fence 和 JSON 后多余文本；新增 `normalizePredictionResult()` 兜底 `score`、`tierColor`、`variant`、缺失字段。
- 备选: 继续 regex `/\{[\s\S]*\}/`；或引入 zod。
- 理由: 抽样验证中 `sales_forecast` 因 JSON 后多余字符报错；regex 会吞掉多余文本。zod 需新增依赖，当前用最小手写校验即可解决核心问题。
- 影响范围: 所有模型输出都会被归一化，前端更稳定；但可能掩盖 prompt 质量问题，后续可记录 raw output 或 warnings。
- 可逆性: 中。

---

### 5. 技术/方案细节快照

| 文件 | 本 session 变化 |
|------|---------------|
| `server/src/model-lab.ts` | 新增 24 个模型 prompt 与 `ModelLabId`；当前共 28 个模型 |
| `web/src/components/ModelLabPane.tsx` | UI 重构；增加 `mode`、`OPERATIONAL_MODEL_IDS`、分类配置、搜索筛选 |
| `web/src/App.tsx` | `model_lab/view` 渲染预测模型；`model_lab/operational_model` 渲染运营模型 |
| `server/src/index.ts` | `/api/model-lab/predict` 改用 `extractPredictionJsonObject()` + `normalizePredictionResult()` |

运营模型清单：`rfm_segmentation`, `member_lifecycle`, `channel_attribution`, `basket_affinity`, `benefit_match`, `price_band_gap`, `sku_keep_or_drop`, `product_pricing`, `campaign_roi`。其余默认属于预测模型。

P0 抽样验证：`user_churn`, `rfm_segmentation`, `campaign_roi` 初次通过；`sales_forecast` 初次失败，原因是 LLM 返回 JSON 后有额外非空白字符。修复后 `sales_forecast` 复测返回 200，3 rows，4 KPIs，scores 为 `0.82,0.15,0.92`。

验证命令多次通过：`npm run typecheck && npm run build`。仍有 Vite chunk size warning，属于既有构建体积警告，不阻塞。

---

### 6. 未完成事项与下一步 (Action Items)

- [ ] **运行历史持久化** — 优先级 P0
  - 上下文: 当前预测/运营模型结果刷新即丢失，用户无法回看、对比或复用历史运行。
  - 输入: 复用现有 SQLite/工作区存储机制；需确认是否与 workspace 绑定。
  - 完成标准: 展示历史列表（时间、模型、行数、状态）；点击可恢复 `PredictionResult`。
  - 潜在难点: `rows` 可能较大，建议 JSON blob 存储并沿用 200 行上限。

- [ ] **全量模型端到端验证** — 优先级 P1
  - 上下文: 当前只抽样验证 4 个模型，仍有 24 个模型未跑 API 链路。
  - 输入: 为每个模型构造 3-5 行小样本；调用 `http://localhost:8787/api/model-lab/predict`。
  - 完成标准: 输出模型级验证表：HTTP 状态、耗时、rows、kpis、validation warnings。
  - 潜在难点: LLM 调用耗时和 token 成本较高，建议分批跑。

- [ ] **运营模型结果差异化** — 优先级 P1
  - 上下文: 运营模型已迁移到独立 subtab，但结果仍是预测模型的 KPI + 明细表。
  - 输入: 优先选 RFM、渠道归因、价格带空位。
  - 完成标准: 至少增加分层分布、策略矩阵或看板式摘要，不破坏通用 `PredictionResult`。
  - 潜在难点: 是否引入 chart 依赖未确认；可先用表格/进度条实现。

- [ ] **模型模板资产化** — 优先级 P2
  - 上下文: 用户目前不知道每个模型 CSV 应长什么样。
  - 输入: `ModelDef.fields` 已包含字段定义，可生成示例 CSV。
  - 完成标准: 每个模型提供“下载示例 CSV”或“复制字段模板”。
  - 潜在难点: 示例数据需避免误导为真实 benchmark。

- [ ] **SQL 数据源接入** — 优先级 P2
  - 上下文: 现有 `SqlConnectPane` 已能查询数据库，但模型工坊只支持 CSV 上传。
  - 输入: 复用 `api.listSqlConnections()` 与 query/export 能力。
  - 完成标准: configure 步骤可选择 SQL 查询结果作为 rows。
  - 潜在难点: 字段映射、查询行数限制和敏感数据处理。

---

### 7. 开放问题与待确认事项

- ❓ **运行历史是否绑定 workspace？**
  - 当前倾向: 绑定 workspace，便于后续报告、SQL 数据源、历史复用一致。
  - 阻塞了什么: P0 运行历史持久化的数据表/文件路径设计。
  - 需要谁/什么来解决: 用户确认产品定位。

- ❓ **运营模型是否最终都要做专属看板？**
  - 当前倾向: 先保持统一结果页，只对 RFM/渠道归因/价格带空位等高频模型做增强。
  - 阻塞了什么: 是否删除旧 `OperationalModelPane.tsx`，以及是否引入图表库。
  - 需要谁/什么来解决: 用户选择优先运营模型和 UI 复杂度。

- ❓ **是否需要保留 raw LLM output 供调试？**
  - 当前倾向: 历史记录中存 normalized result，debug 模式再存 raw output。
  - 阻塞了什么: 进一步排查 prompt 质量和 schema 遵从问题。
  - 需要谁/什么来解决: 后续实现运行历史时一并决策。

---

### 8. 上下文与约定

- **预测模型**: 偏概率预测、风险判断、趋势预测，例如流失、复购、销量、库存风险、退货风险。
- **运营模型**: 不一定需要算法预测，更像运营看板、诊断分层或策略决策，例如 RFM、生命周期、渠道归因、价格带空位、SKU 去留。
- 新增模型后必须判断归属；运营类加入 `OPERATIONAL_MODEL_IDS`，否则默认出现在预测模型。

---

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」「未完成事项」「开放问题」三节。  
> 当前最紧迫的是 **P0 运行历史持久化**，先确认是否绑定 workspace，再设计存储结构。  
> 注意：`OperationalModelPane.tsx` 已不再挂载，运营模型实际复用 `ModelLabPane mode="operational"`。  
> 注意：LLM 输出解析已修复为 `extractPredictionJsonObject()`，不要回退到 regex。  
> 若用户未明确历史记录是否绑定 workspace，请先确认后再动手。

---


## 📌 Session 1 — 2026-06-05

### 本次更新摘要

**本次推进**: 从零完成模型工坊 tab 的完整 P0 实现，包含 4 个业务预测模型（用户流失 / 会员生命周期 / 商品定价 / 活动利益点测算）的前后端全链路。  
**关键决策**: ① 采用通用 `PredictionResult` 结构替代 churn 专属字段，所有模型共用一套渲染逻辑；② 预测引擎复用 `runPiPrompt`（LLM 直连，无 tool-use）；③ 字段映射默认自动匹配 + 手动覆盖。  
**新增阻塞/问题**: LLM 输出稳定性未线上验证（JSON 解析依赖 regex 提取）；无运行历史持久化。  
**下一步重点**: ① 真实数据端到端测试；② P1：运行历史 + 结果本地保存。

---

### 1. 项目元信息

```
项目名称: 模型工坊 (Model Lab)
项目类型: 代码开发
Session 编号: 第 1 次交接
本次 Session 起止: 从「空占位 tab」推进到「4 个模型完整可用的预测模块」
最后更新: 2026-06-05
```

---

### 2. 项目目标

- **一句话目标**: 提供开箱即用的商业预测能力，用户上传 CSV 即可获得业务洞察，无需建模背景
- **成功标准**:
  1. 4 个模型全部可选、可运行、可导出结果
  2. 字段自动映射准确率 ≥ 80%（常规命名），支持手动纠正
  3. LLM 返回 valid JSON 的成功率在正常网络条件下 ≥ 90%
  4. 从上传到看到结果 ≤ 60 秒（200 行数据）
- **明确的非目标**:
  - 不做模型训练 / 微调（纯 LLM 推断）
  - 不做实时流式预测（单次 POST → 同步等待）
  - 不持久化历史运行记录（P0 内存态，刷新即失）

---

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| Tab 注册（模型工坊） | ✅完成 | `MainHeader.tsx` TABS 数组 | 图标 `Cpu`，排 AnaX 后 |
| 路由/渲染挂载 | ✅完成 | `App.tsx` model_lab 分支 | VIEW_ONLY_TABS，只有 view subtab |
| 通用类型定义 | ✅完成 | `web/src/types.ts` Model Lab 节 | `PredictionKpi / PredictionRowResult / PredictionResult` |
| API client | ✅完成 | `web/src/lib/api.ts` `predictModel()` | POST `/api/model-lab/predict` |
| Server 路由 | ✅完成 | `server/src/index.ts` `/api/model-lab/predict` | 调用 `buildModelLabPrompt` |
| 模型 Prompt 逻辑 | ✅完成 | `server/src/model-lab.ts` | 4 个 prompt builder |
| ModelLabPane UI | ✅完成 | `web/src/components/ModelLabPane.tsx` | 4-step 状态机 |
| 用户流失预测 | ✅完成 | model id: `user_churn` | 6 字段，排序降序 |
| 会员生命周期 | ✅完成 | model id: `member_lifecycle` | 7 字段，排序升序 |
| 商品定价建议 | ✅完成 | model id: `product_pricing` | 7 字段，排序升序 |
| 活动利益点测算 | ✅完成 | model id: `campaign_roi` | 7 字段，排序降序 |
| 运行历史持久化 | ⏳待启动 | — | P1 |
| SQL 直连数据源 | ⏳待启动 | — | P2，复用 SqlConnectPane |
| 结果可视化图表 | ⏳待启动 | — | P2 |

---

### 4. 关键决策与权衡 ⭐

**决策 1: 通用 PredictionResult 结构而非模型专属类型**
- 选择: `{ modelId, summary: { kpis[], keyInsights[], recommendations[] }, rows: PredictionRowResult[] }`
- 备选: 为每个模型定义独立接口（ChurnResult / LifecycleResult / ...）
- 理由: 4 个模型的结果渲染逻辑 90% 相同，专属类型会导致大量重复 UI 代码；KPI 卡片 + 层级表格结构足以表达所有模型语义
- 影响范围: server prompt 必须严格输出该 JSON schema，任何新模型复用同一前端渲染
- 可逆性: 中（若某模型需要特殊 chart，可在 results 步骤按 modelId 做条件渲染扩展）

**决策 2: 预测引擎用 runPiPrompt（LLM 直连，不走 tool-use）**
- 选择: 复用现有 `runPiPrompt` → `DIRECT_LLM_ROOT`，一次调用返回完整 JSON
- 备选: ① 走 pi 会话（有 tool-use，可读文件）；② 调用外部统计 API
- 理由: 预测逻辑完全在 prompt 中表达（分级规则 + 业务语义），不需要读本地文件；pi 会话有启动开销和状态管理复杂度；外部统计 API 引入外部依赖
- 影响范围: 数据上限 200 行（token 限制），不适合大规模批量
- 可逆性: 高

**决策 3: 字段映射默认自动 + 手动覆盖**
- 选择: 前端用 `autoMap()` 做启发式字符串匹配（规范化 → 精确 → 分段 → 标签），结果可 select 改
- 备选: ① 纯手动映射；② 用 LLM 做字段语义匹配
- 理由: 手动映射摩擦太高；LLM 语义匹配需要额外 API 调用且延迟不可接受；启发式匹配对 80% 常规命名已足够
- 可逆性: 高

**决策 4: 数据行数硬上限 200 行**
- 选择: server 端截断到前 200 行，前端展示警告
- 理由: LLM context 限制 + 推断成本，200 行 JSON ≈ 20-30K tokens output；超出部分通过 `rowsCapped: true` 字段标注
- 可逆性: 中（P2 可做分批调用 + 结果合并）

**决策 5: 排序方向由 ModelDef.defaultSortAsc 控制**
- 选择: churn / campaign_roi → 降序（高风险 / 高 ROI 优先）；lifecycle / pricing → 升序（最需关注的最上面）
- 理由: 每个模型的 score 语义不同（churn score=风险概率，lifecycle score=健康分），默认排序要反映"最需要运营关注"的行优先

---

### 5. 技术细节快照

**关键文件**

| 文件 | 作用 |
|------|------|
| `web/src/components/ModelLabPane.tsx` | 全部前端逻辑（~380 行），4-step 状态机 |
| `server/src/model-lab.ts` | 4 个模型的 prompt builder，导出 `buildModelLabPrompt` / `SUPPORTED_MODELS` |
| `server/src/index.ts` ~2450 行附近 | `/api/model-lab/predict` POST 路由 |
| `web/src/types.ts` Model Lab 节 | `PredictionKpi`, `PredictionRowResult`, `PredictionResult`, `PredictionTierColor`, `PredictionVariant` |
| `web/src/lib/api.ts` 末尾 | `api.predictModel()` |
| `web/src/lib/constants.ts` | `VIEW_ONLY_TABS` 加入 `model_lab` |
| `web/src/components/MainHeader.tsx` | Tab 类型加 `"model_lab"`，TABS 数组加 Cpu 图标 |

**通用 JSON schema（LLM 必须输出）**

```typescript
{
  modelId: string,
  summary: {
    kpis: { label, value, sub?, variant: "neutral|success|warning|danger" }[],
    keyInsights: string[],
    recommendations: string[]
  },
  rows: {
    id: string, label?: string,
    score: number,           // 0-1
    tier: string,            // tier_key
    tierLabel: string,       // 中文标签
    tierColor: "red|orange|amber|green|blue|purple|neutral",
    primaryConclusion: string,
    attributes?: { key, value }[]
  }[]
}
```

**LLM 输出解析**

```typescript
const jsonMatch = output.match(/\{[\s\S]*\}/);   // regex 提取最外层 JSON
if (!jsonMatch) throw new Error("LLM 返回内容不含有效 JSON");
JSON.parse(jsonMatch[0]);
```
风险：若 LLM 输出含多个 `{}` 块，regex 只取最后匹配的最外层。目前 systemPrompt 强制"不含 markdown 代码块"来规避，但未做单测验证。

**前端 4-step 状态机**

```
select_model → configure → running → results
                ↑                        ↓
                └──── 返回调整 / 重新运行 ──┘
```

**模型字段必填规则**

`requiredMapped = fields.filter(f => f.required).every(f => mappings[f.key])` — 只要必填字段都有映射，按钮激活。

**CSV 解析**

前端自研简单 parser（`parseCsv()`），支持双引号转义，最多读取 500 行（再截），server 再截 200 行。不依赖 papaparse。

**autoMap 匹配顺序**（精度从高到低）

1. normalize 后精确匹配 key
2. key 所有 `_` 分段都出现在列名中
3. key 任意一个分段出现在列名中
4. label normalize 后 contains 匹配

---

### 6. 未完成事项与下一步

- [ ] **端到端真实数据测试** — 优先级 P0
  - 上下文: 代码通过 TypeScript 编译但未做过完整链路测试；LLM 输出 schema 遵从度未验证
  - 输入: 准备4个模型的各一份测试 CSV（可手工构造，50行以内）
  - 完成标准: 4 个模型各跑一次，结果 JSON 解析成功，UI 正常展示 KPI 卡片 + 行表格
  - 潜在难点: LLM 可能在 `attributes` 字段输出不一致的 key 命名；score 可能超出 0-1 范围

- [ ] **运行历史持久化** — 优先级 P1
  - 上下文: 当前刷新即丢失结果，用户无法回看历史预测
  - 输入: 考虑复用现有 `db.ts` SQLite 或写入工作区文件夹
  - 完成标准: 历史记录列表展示（时间 / 模型 / 行数）；点击可恢复结果视图
  - 潜在难点: PredictionResult 含大量 rows，存 JSON blob 可能较大

- [ ] **LLM 输出鲁棒性增强** — 优先级 P1
  - 上下文: 当前 regex 解析脆弱，未处理 score 超范围 / tierColor 非法值 / kpis 数组为空等情况
  - 完成标准: server 端对输出做 schema validation（zod 或手动检查），前端有兜底显示
  - 潜在难点: 不同模型对 LLM 的遵循度可能差异较大

- [ ] **SQL 直连数据源** — 优先级 P2
  - 上下文: 现有 `SqlConnectPane` 已支持 SQL 查询，可考虑"从已连接数据库直接取数"流程
  - 完成标准: configure 步骤新增"从 SQL 获取"入口，复用 SqlConnection

- [ ] **结果可视化** — 优先级 P2
  - 上下文: 当前 KPI 卡片 + 表格，缺乏 tier 分布 bar chart / 散点图等可视化
  - 潜在难点: 需引入图表库（当前无 recharts / chart.js 依赖）

---

### 7. 开放问题与待确认事项

- ❓ **200 行上限是否足够覆盖主要场景？**
  - 当前倾向: 对分析场景（样本代表性 > 全量）够用，但活动利益点测算通常 < 20 行，用户流失可能想跑数万行
  - 阻塞了什么: P2 分批调用方案设计
  - 需要谁解决: 用户确认"最多同时预测多少行"的业务诉求

- ❓ **是否需要将预测结果写回工作区文件夹（如 report/ 目录）？**
  - 当前倾向: 暂不写入，只提供"导出 CSV"按钮
  - 需要谁解决: 用户确认，若需要集成进报告流程则需改造

- ❓ **模型工坊是否应与工作区（workspace）绑定？**
  - 当前状态: 完全独立，不读取任何 workspaceId，与当前工作区无关
  - 如果需要绑定工作区：可将历史记录存在 workspace 目录下
  - 需要谁解决: 用户确认定位——是「全局工具」还是「工作区上下文工具」

---

### 8. 上下文与约定

**产品定位约定（2026-06-05 确认）**
- 模型工坊 = 应用而非建模，用户带数据来，工坊给答案
- 汇总预测（整体结论 + KPI 卡片）优先，行级预测（逐用户/商品）作为运营落地补充
- 4 个模型 P0 全部实现，无「即将推出」占位

**开发约定**
- 新增模型：① `server/src/model-lab.ts` 加 prompt builder + `SUPPORTED_MODELS`；② `ModelLabPane.tsx` `MODELS` 数组加 `ModelDef`；不需要改其他文件
- LLM 输出解析统一在 server 端，不在前端做 schema adaptation

---

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。
> 当前最紧迫的是**端到端真实数据测试**：为4个模型各准备一份小 CSV（50行内），跑完整链路，验证 LLM 输出解析是否稳定。
> 注意：LLM 返回 JSON 的解析用 `output.match(/\{[\s\S]*\}/)` regex 提取，若 LLM 返回 markdown 代码块会导致解析失败，需检查 systemPrompt 是否足够约束。
> 在开始工作前，如对「200行上限」或「是否绑定工作区」有疑问，请先与用户确认。
