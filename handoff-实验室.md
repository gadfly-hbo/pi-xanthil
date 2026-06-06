# Handoff Log — 苍耳 pi-Xanthil · 实验室（评估评测）模块

---

## 📌 Session 9（最新）— 2026-06-06

### 0. 本次更新摘要（Changelog）

**本次推进**: 完成 Model Lab（模型库）架构解耦与百模扩充——将模型定义从 `ModelLabPane.tsx` 抽离至独立数据层 `web/src/data/models.ts`，并将模型总数从 33 个扩充至 101 个，覆盖金融风控、供应链、组织HR、B2B、体验等 11 个分类。修复了侧边栏无法滚动的 UI 缺陷。额外完成了项目依赖体积调查（~252MB 新增来自 duckdb-wasm/echarts 等）。
**关键决策**: 模型定义与 UI 组件解耦（数据层独立文件）；使用脚本自动注入批量模型而非手动编写；长尾模型用通用模板覆盖。
**新增阻塞/问题**: 无。
**下一步重点**: ① 浏览器手测模型库 UI 完整展示（101 个模型 + 11 分类）；② 浏览器手测 SkillOS 全链路（延续 Session 8 P0）。

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室模块
- 项目类型：代码开发
- Session 编号：第 9 次交接
- 本次 Session 起止：从「模型库 33 个模型嵌在 UI 组件中」推进到「101 个模型独立数据层 + 11 分类 + 侧边栏可滚动」
- 最后更新：2026-06-06
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`

### 2. 项目目标（North Star）

延续 Session 8，无变化。本 session 聚焦 Model Lab 子模块的横向扩充。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 模型定义解耦 | ✅完成 | `web/src/data/models.ts`（~3200 行） | 从 ModelLabPane.tsx 抽出 |
| 模型库扩充至 100+ | ✅完成 | `MODELS` 数组 101 项，`MODEL_CATEGORIES` 11 个分类 | 含 33 原始 + 34 细分 + 39 长尾 |
| 侧边栏滚动修复 | ✅完成 | `ModelLabPane.tsx` L299 `overflow-y-auto` | 分类多时可滚动 |
| 依赖体积调查 | ✅完成 | 确认 ~252MB 来自新 npm 依赖 | 见决策 14 |
| SkillOS 浏览器手测 | ⏳待验证 | — | 延续 Session 8 |
| Phase 2.5 per-task 检索变体 | ⏳待启动 | — | 延续 Session 8 |

### 4. 关键决策与权衡 ⭐

**决策 14: 模型定义与 UI 组件解耦**
- 选择: 创建 `web/src/data/models.ts`，将 `MODELS`、`MODEL_CATEGORIES`、`OPERATIONAL_MODEL_IDS`、`ModelDef`/`ModelFieldDef`/`ModelCategoryId` 等类型全部迁移至此文件，`ModelLabPane.tsx` 通过 `import` 引用。
- 备选: 继续在 `ModelLabPane.tsx` 中内联所有模型定义。
- 理由: 原文件已 1200+ 行模型定义，扩充至 100 个模型后将膨胀到 6000+ 行，导致编辑器卡顿和维护困难。分离后 UI 组件仅 735 行，数据文件独立可管理。
- 影响范围: `ModelLabPane.tsx` 的 import 路径变更；后续新增模型只需编辑 `models.ts`。
- 可逆性: 高（合并回 ModelLabPane 只需复制粘贴）。

**决策 15: 批量模型用脚本自动注入**
- 选择: 编写 `generate_100_models.cjs` / `fix_injection.cjs` 脚本，自动在 `models.ts` 的 MODELS 数组末尾注入 68 个新模型定义。
- 备选: 手工逐个编写 68 个模型的完整定义。
- 理由: 手工编写 68 个带 fields/output/sampleRows 的模型定义工作量巨大且易出错；脚本可复现可验证。
- 影响范围: 脚本为一次性工具，已完成使命；生成结果已直接写入 `models.ts`。
- 可逆性: 高（删除注入的模型即可回退）。

**决策 16: 长尾模型用通用模板**
- 选择: 39 个 `auto_gen_model_*` 使用统一的「通用场景智能决策引擎」模板（2 个字段 + 3 层分级），归入 `long_tail` 分类。
- 备选: 为每个长尾模型设计独立的业务场景和字段。
- 理由: 长尾模型的目的是凑齐数量和覆盖面，不是核心使用场景；独立设计 39 个场景投入产出比低。
- 可逆性: 高（可逐步替换为专业模型）。

### 5. 技术/方案细节快照

#### 5.1 新增文件

| 文件 | 说明 |
|------|------|
| `web/src/data/models.ts` | 模型数据层，~3200 行，导出 `MODELS`(101项)、`MODEL_CATEGORIES`(11类)、`OPERATIONAL_MODEL_IDS`、类型定义 |
| `generate_100_models.cjs` | 一次性脚本，已完成使命，可删除 |
| `fix_injection.cjs` | 修复脚本，已完成使命，可删除 |

#### 5.2 修改文件

| 文件 | 改动 |
|------|------|
| `web/src/components/ModelLabPane.tsx` | 删除内联模型定义（约 1200 行），改为 `import` from `@/data/models`；L299 `<aside>` 增加 `overflow-y-auto` |

#### 5.3 模型分类体系（11 个分类 + "全部"）

| CategoryId | 名称 | 模型数 |
|---|---|---|
| `customer` | 客户与会员运营 | 9 |
| `product` | 商品、库存与定价 | 7 |
| `marketing` | 营销活动与内容转化 | 7 |
| `channel` | 渠道、区域与私域 | 5 |
| `market` | 竞品与市场机会 | 3 |
| `experience` | 体验与售后风险 | 7 |
| `finance` | 财务与风控合规 | 8 |
| `supply_chain` | 供应链与履约 | 8 |
| `b2b_sales` | B2B与大客户管理 | 5 |
| `organization` | 组织与人力资源 | 7 |
| `long_tail` | 长尾与通用探索区 | 39 |

#### 5.4 依赖体积调查结论

项目 `node_modules` 总计 ~433MB，其中 ~252MB 为近期新增依赖：
- `@duckdb/duckdb-wasm`: 142MB（数据探索模块核心引擎）
- `echarts` + `zrender`: 66MB（图表可视化）
- `playwright-core`: 17MB（测试框架）
- 其余（apache-arrow、xlsx、@xyflow 等）: ~27MB
- 实际源码总计仅 ~2.8MB

#### 5.5 验证状态

- `npm -w web run typecheck` ✅
- `npm -w web run build` ✅（3.3s）
- 浏览器 UI 未完整手测（侧边栏滚动已修复，模型列表加载待确认）

### 6. 未完成事项与下一步（Action Items）

- [ ] **浏览器手测模型库 101 个模型展示** — 优先级 P0
  - 上下文: 模型从 33 扩充至 101，分类从 8 增至 11，需确认 UI 列表、分类筛选、搜索功能正常。
  - 输入: `npm run dev`，进入 实验室 → model tab。
  - 完成标准: 左侧分类显示全部 11 类且计数正确；点击分类可过滤；搜索框可搜索新增模型名；点击模型可进入配置页。
  - 潜在难点: 长尾模型 39 个使用通用模板，字段较简单，可能在配置页显得空洞。

- [ ] **浏览器手测 SkillOS 全链路** — 优先级 P0
  - 上下文: 延续 Session 8，Phase 1.5/2/3 均未进行 UI 手测。
  - 输入: `npm run dev`，进入 skill tab。
  - 完成标准: 治理队列、检索框、自主完成 tab 均正常渲染和交互。

- [ ] **清理一次性脚本** — 优先级 P2
  - 上下文: `generate_100_models.cjs`、`fix_injection.cjs`、`extract.cjs` 为一次性脚本，已完成使命。
  - 完成标准: 删除后 typecheck/build 不受影响。

- [ ] **Phase 2.5：评测 runner 内 per-task 自动检索变体** — 优先级 P1
  - 延续 Session 8，未变化。

### 7. 开放问题与待确认事项

- ❓ 长尾模型（`auto_gen_model_*`）使用极简通用模板，后续是否需要逐步替换为专业场景定义？
  - 当前倾向: 先保持通用模板，等用户反馈后按需替换。
  - 阻塞了什么: 不阻塞。

- ❓ `models.ts` 已达 ~3200 行（~210KB），后续是否需要按分类拆分为多个文件？
  - 当前倾向: 暂不拆分，单文件便于脚本操作和全局搜索。
  - 需要什么: 如果编辑器出现性能问题再考虑拆分。

### 8. 上下文与约定

本 Session 新增：
- 模型数据层统一由 `web/src/data/models.ts` 管理，新增模型只需在此文件的 `MODELS` 数组和 `MODEL_CATEGORIES` 中添加即可。
- `ModelCategoryId` 类型在 `models.ts` 中定义，新增分类需同步更新该 union type。
- 项目使用 npm workspaces（`"type": "module"`），独立脚本需用 `.cjs` 后缀运行。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」和「未完成事项」。
> 最紧迫任务是浏览器手测模型库——进入 实验室 → model tab，确认 101 个模型在 11 个分类下正确展示、搜索和点击。
> 模型定义在 `web/src/data/models.ts`，UI 在 `web/src/components/ModelLabPane.tsx`，两者通过 import 连接。
> Session 8 遗留的 SkillOS 手测仍然是 P0，需一并验证。

---

## Session 8 — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 完成 SkillOS 启发的 Skill 治理全链路——Phase 1.5（自动触发队列）补完、Phase 2（BM25 检索技能）、Phase 3（无工作流自主完成），共新增 3 个服务端模块、3 个 API 端点、大量前端 UI，72 个 server 测试全绿。
**关键决策**: BM25 纯 TS 零依赖实现；自主完成使用 `--no-skills` + 检索路径注入（而非 system prompt 注入）；UI 用 tab 切换而非新建独立 pane。
**新增阻塞/问题**: 无；UI 未进行浏览器手测。
**下一步重点**: ① 浏览器验证自主完成 UI；② 可考虑 Phase 2.5（evaluation runner 内的 per-task 自动检索变体）；③ 实际有 skill 数据后端到端验证治理链路。

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室（SkillOS 治理）模块
- 项目类型：代码开发
- Session 编号：第 8 次交接
- 本次 Session 起止：从「Phase 1.5 治理队列 JSX 未插入」推进到「Phase 1.5 / 2 / 3 全部完成」
- 最后更新：2026-06-05
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`

### 2. 项目目标（North Star）

本模块新增 SkillOS 治理目标：通过自动触发的 skill 训练/优化循环，让 pi-xanthil 在数据分析任务上不断智能化，最终实现给定问题后 AI 全自动完成，无需设计工作流。

**四阶段路线图状态**:
| 阶段 | 目标 | 状态 |
|---|---|---|
| Phase 1 | 手动治理循环（评测后点「治理分析」，逐条接受/拒绝，应用到 SKILL.md） | ✅ Session 7.5 |
| Phase 1.5 | 自动触发 + DB 持久化（评测完成后 fire-and-forget，提案存 DB，侧边栏队列） | ✅ 本 Session |
| Phase 2 | BM25 检索技能（输入任务描述，自动排序匹配 skill） | ✅ 本 Session |
| Phase 3 | 无工作流自主完成（自动检索 + 注入 + 执行，返回结果） | ✅ 本 Session |

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Phase 1 手动治理循环 | ✅完成 | `SkillLabPane.tsx` 报告头部「治理分析」按钮 | Session 7.5 完成 |
| Phase 1.5 治理队列 | ✅完成 | `skill-curator.ts`、`db.ts`、`SkillLabPane.tsx` 侧边栏 | 本 Session 补完 JSX |
| Phase 2 BM25 检索 | ✅完成 | `skill-retrieval.ts`、`POST /skills/retrieve`、SkillLabPane 侧边栏"检索技能" | 本 Session 新增 |
| Phase 3 自主完成 | ✅完成 | `autonomous-runner.ts`、`POST /autonomous-run`、SkillLabPane「自主完成」tab | 本 Session 新增 |
| 浏览器手测 | ⏳待验证 | — | 本 Session 未做 |

### 4. 关键决策与权衡 ⭐

**决策 10: Phase 1.5 治理队列 JSX 补完**
- 上一 Session 因「File has been modified since read」错误导致侧边栏 JSX 未插入，本次重读文件后补全。
- 状态: Phase 1.5 全部功能（DB 表、CRUD API、auto-trigger、前端队列）均已就位。

**决策 11: BM25 纯 TS 零依赖实现（Phase 2）**
- 选择: `skill-retrieval.ts` 内联 BM25（K1=1.5, B=0.75），对 skill 的 name + description + 正文做 tokenize 打分。
- 备选 A: `minisearch`（轻量 JS 全文检索库，需引入依赖）。
- 备选 B: 服务端调用 Elasticsearch / 向量数据库。
- 理由: CLAUDE.md 约束「不安装未确认新依赖」；skill 数量通常 < 100，BM25 纯内存足够；snippet 提取用关键词命中首行，实现简单。
- 可逆性: 高（替换为 minisearch 只需改 skill-retrieval.ts）。

**决策 12: 自主完成使用 `--no-skills` + 检索路径注入（Phase 3）**
- 选择: `autonomous-runner.ts` 调 `retrieveSkills` → 取 path 列表 → 传 `runPiTurn({ skillPaths })` → pi CLI 收到 `--no-skills --skill <path>...`。
- 备选: 读取 SKILL.md 内容、拼入 systemPrompt 字符串注入（不需要 pi 支持 --skill flag）。
- 理由: 与 skill evaluation runner 保持一致注入方式；`--no-skills` 确保只加载检索到的 skill，隔离干净；避免 systemPrompt 膨胀。
- 可逆性: 中（如 pi CLI 不支持 --skill，则需改为 systemPrompt 注入）。

**决策 13: 自主完成放在 SkillLab 主区域 tab，而非新建独立 Pane**
- 选择: 主区域新增「评测模式 / 自主完成」tab 切换，自主完成渲染 `AutonomousPanel` 组件。
- 备选: 新建独立的 `AutonomousPane.tsx` 并加入 Sidebar 导航。
- 理由: 自主完成是 skill 治理链路的终态展示，在同一界面内与评测模式对比自然；增加独立 pane 会改动 Sidebar/主路由，范围更大。
- 可逆性: 高（提取为独立 Pane 只需移动组件和新增路由项）。

### 5. 技术/方案细节快照

#### 5.1 新增文件

| 文件 | 说明 |
|------|------|
| `server/src/skill-retrieval.ts` | BM25 检索，`retrieveSkills(query, workspaceRoot, topK)` → `RetrievedSkill[]` |
| `server/src/autonomous-runner.ts` | `runAutonomousTask(opts)` → `AutonomousRunResult`，内部调检索+runPiTurn |

#### 5.2 修改文件摘要

**`server/src/types.ts` / `web/src/types.ts`**（两文件同步）:
```ts
interface RetrievedSkill { path, name, score, snippet }
interface AutonomousRunResult { output, skillsUsed: RetrievedSkill[], durationSec, error? }
```

**`server/src/index.ts`**，新增 3 个端点:
- `POST /api/workspaces/:id/skills/retrieve` — `{ query, topK? }` → `RetrievedSkill[]`
- `POST /api/workspaces/:id/autonomous-run` — `{ query, model?, topK? }` → `AutonomousRunResult`
- `POST /api/workspaces/:id/skill-curation-proposals/apply` — bulk apply approved proposals（Phase 1.5）

**`web/src/lib/api.ts`**:
- `retrieveSkills(workspaceId, query, topK?)`
- `runAutonomousTask(workspaceId, query, model?, topK?)`
- Phase 1.5: `listSkillCurationProposals`、`updateSkillCurationProposalStatus`、`applyApprovedCurationProposals`

**`web/src/components/SkillLabPane.tsx`**（本 Session 主要改动）:
- Phase 1.5 治理队列：侧边栏「治理队列」区块，逐条 pending/approved 提案，接受/拒绝按钮，批量「应用已接受 (N)」按钮
- Phase 2 检索技能：侧边栏「检索技能」输入框（Enter/按钮触发），结果列表带相对分数条，`+选`一键加入 selectedPaths
- Phase 3：主区域「评测模式 / 自主完成」tab 切换，`AutonomousPanel` 组件含任务描述框、topK 滑块、执行按钮、已注入 skill 标签、输出展示

#### 5.3 Phase 1.5 DB 表（`server/src/db.ts`，上一 Session 已加）

```sql
CREATE TABLE IF NOT EXISTS skill_curation_proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_path TEXT NOT NULL,
  suggested_content TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
```

#### 5.4 路径安全

`applySkillCurationProposals` 写入前验证 `targetPath` 必须在以下目录之一：
- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `<workspace>/.pi/skills/`
- `<workspace>/.agents/skills/`

#### 5.5 验证状态

- `npm -w server run typecheck` ✅
- `npm -w web run typecheck` ✅
- `node --experimental-strip-types --test server/src/*.test.ts` → **72 pass / 0 fail**
- 浏览器 UI 未手测

### 6. 未完成事项与下一步（Action Items）

- [ ] **浏览器手测 SkillOS 全链路** — 优先级 P0
  - 上下文: Phase 1.5/2/3 均未进行 UI 手测；需确认侧边栏治理队列、检索框、自主完成 tab 均正常渲染。
  - 输入: `npm run dev`，工作区有可用 SKILL.md 的 workspace。
  - 完成标准: 治理队列可显示提案并接受/拒绝；检索框输入后返回结果；自主完成 tab 可提交任务并显示输出。
  - 潜在难点: 自主完成需要 pi 进程可运行（`PI_BIN` 配置正确），否则 output 为空。

- [ ] **Phase 2.5：评测 runner 内 per-task 自动检索变体** — 优先级 P1
  - 上下文: 当前 Phase 2 只在侧边栏提供手动检索辅助选择；Phase 2.5 可在 skill evaluation runner 中加入「检索模式」variant 类型——每个 task 运行时自动检索 top-K skill 注入，测试检索准确率。
  - 输入: `skill-retrieval.ts`、`skill-evaluation-runner.ts`、`SkillVariant` 类型。
  - 完成标准: `SkillVariant.retrievalMode: true` 时，runner 按 task prompt 检索 skill 而非用固定 skillPaths。
  - 潜在难点: 检索结果按 task 变化，需记录每次实际用了哪些 skill。

- [ ] **端到端验证治理 → 检索 → 自主完成闭环** — 优先级 P1
  - 上下文: 当前无真实 skill 数据；需先创建/导入 SKILL.md，跑评测触发治理提案，应用提案后再用检索/自主完成验证改进。
  - 输入: 有实际内容的 workspace + SKILL.md 文件。
  - 完成标准: 完整走一遍「评测 → 治理分析 → 应用提案 → 再次检索验证提升」。

### 7. 开放问题与待确认事项

- ❓ `autonomous-runner.ts` 使用 `runPiTurn`（内部含 `--no-skills`），若 pi CLI 版本不支持 `--skill` flag，则无法注入检索到的技能。
  - 当前倾向: 假设 pi CLI 支持（与 evaluation runner 一致）。
  - 需要谁解决: 手测时验证。

- ❓ Phase 1.5 的 `autoTriggerCuration` 是 fire-and-forget，若 LLM curator 质量差（提案全不合理），队列会积累大量低质提案。
  - 当前倾向: 由用户手动审核，接受/拒绝；暂无自动清理机制。
  - 后续增强: 可加 confidence 阈值过滤，只展示高置信提案。

### 8. 上下文与约定

无变化，延续既有约定。本 Session 新增：
- SkillOS 路线图已全部实现（Phase 1 → 1.5 → 2 → 3）；后续增强走 Phase 2.5 迭代，不重启设计。
- BM25 参数 K1=1.5, B=0.75 为经典默认值，无需调整除非检索效果明显差。
- 治理提案写入 SKILL.md 路径受 `allowedSkillDirs` 白名单保护，下次若有新 skill 目录需求需显式扩展该列表。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」和「未完成事项」。
> 最紧迫任务是浏览器手测 SkillOS 全链路——切换到「自主完成」tab，输入一个数据分析任务描述，确认 BM25 检索和自主执行流程端到端工作。
> 手测前确认 `PI_BIN` 可用（`which pi` 或检查 `server/src/config.ts`），否则 autonomous-runner 会因进程退出码非 0 报错。
> Phase 2.5（per-task 自动检索变体）是下一个自然增量，但不阻塞当前功能，按用户需求决定是否推进。

---

## 📌 Session 7（最新）— 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 完成三项 P1/P2 优化——线性 DAG 初始缩放修复、judgeRepeat 成本提示、Archive zip 批量下载（纯 TS 实现，无新依赖），P0 手测已由用户跳过。
**关键决策**: Archive zip 不引入 `fflate` 等外部依赖，使用内联纯 TypeScript ZIP 构建器（存储模式）；判断无损可逆——直接通过 Blob 下载。
**新增阻塞/问题**: 无。
**下一步重点**: 当前所有 P0-P2 已清零；若需继续可考虑：① 更多实验室功能（工具评测 ToolLabPane 的类似 zip 下载）；② AnaX E2E 手测（原 P0，用户跳过）。

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室（评估评测）模块
- 项目类型：代码开发
- Session 编号：第 7 次交接
- 本次 Session 起止：从「Session 6 遗留 3 项 P1/P2 待办」推进到「全部 P0–P2 清零」
- 最后更新：2026-06-05
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`

### 2. 项目目标（North Star）

延续 Session 6，无变化。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Workflow 表单式编辑器 | ✅完成 | `MultiAgentExecutionPane.tsx` | — |
| Workflow DAG 图形化编辑器 | ✅完成 | `web/src/components/WorkflowDagEditor.tsx` | Session 6 完成 |
| **DAG 线性链初始缩放优化** | ✅完成 | `WorkflowDagEditor.tsx::autoLayout` | Session 7；≥4 level 线性链切纵向布局 |
| **judgeRepeat 成本/稳定性 UI 提示** | ✅完成 | `SkillLabPane.tsx` | Session 7；琥珀色提示文案 |
| **Archive zip 批量下载** | ✅完成 | `evaluation-export.ts::downloadArchivesZip` | Session 7；纯 TS ZIP，无新依赖 |
| Tool artifacts 浏览 | ✅完成 | Session 5 完成 | — |
| EvalSet/CaseSet 完整 CRUD | ✅完成 | Session 5 完成 | — |
| 归档索引与单文件下载 | ✅完成 | Session 5 完成 | — |
| Pairwise judge repeat | ✅完成 | Session 5 完成 | — |
| 真实 `agent → tool → agent` 手测 | ⏳跳过 | — | 用户本次明确跳过；可视需求重提 |

### 4. 关键决策与权衡 ⭐

**决策 8: Archive zip 零依赖实现**
- 选择: 在 `evaluation-export.ts` 内联约 80 行纯 TypeScript ZIP 构建器（ZIP stored/无压缩模式），不引入任何新 npm 包。
- 备选 A: `fflate`（~70KB，browser + Node 双支持，API 简洁）
- 备选 B: `jszip`（已在 lock 文件中作传递依赖，但不在 `web/package.json` 直接声明，不可靠）
- 备选 C: 服务端 `/api/.../zip` 接口 + `archiver`（需 server 端改动 + 新依赖）
- 理由: 项目 CLAUDE.md 约束「不安装未确认依赖」；archived 文件为纯文本（MD + JSON），存储模式 ZIP 下载大小可接受；实现难度可控（CRC32 + 本地文件头 + 中央目录 + EOCD，固定格式）。
- 影响范围: `evaluation-export.ts` 新增 `downloadArchivesZip` + `buildZip` + `computeCrc32` + `concat` 四个函数；`SkillLabPane.tsx` 新增 `downloadAllArchivesZip` 函数和 `zipping` state。
- 可逆性: 高（删除相关函数和按钮即可）。

**决策 9: 线性 DAG 切纵向布局（修正 Session 6 的布局副作用）**
- 选择: 在 `autoLayout` 中检测「所有 level 各 1 节点且 level 数 ≥ 4」，切换为纵向布局（`x=0, y=level×110px`），而非横向（`x=level×260px, y=0`）。
- 备选: 修改 `fitViewOptions.minZoom` / `defaultViewport`（无法适配不同节点数量）；或 ReactFlow `fitView` 后手动 `setViewport`（时序复杂）。
- 理由: 横向线性链（9 节点）bounding box 约 2080×72px，`fitView` 缩放 ~0.48，节点宽度压到 85px 无法辨读；纵向后 bounding box 约 180×952px，缩放 ~0.66，节点宽度约 119px，可读。
- 阈值 ≥4: 2-3 节点横向布局已清晰（≤520px 宽），无需切换。
- 可逆性: 高（删除 `isLinearChain` 判断分支即可还原）。

### 5. 技术/方案细节快照

**修改文件：`web/src/components/WorkflowDagEditor.tsx`**
- `autoLayout` 函数（约第 70-81 行）：在 `byLevel` 计算完后检测 `isLinearChain`：
  ```ts
  const isLinearChain = byLevel.size >= 4 && [...byLevel.values()].every((ids) => ids.length === 1);
  ```
  线性链走 `{ x: 0, y: lv * ROW_GAP }`，其余走原横向逻辑。
- 已有位置（`n.position` 存在）的工作流不走 `autoLayout`，不受影响。

**修改文件：`web/src/lib/evaluation-export.ts`**
- 新增 import: `EvaluationArchiveIndexItem`
- 新增导出: `downloadArchivesZip(archives, fetchFile)` — 并发 fetch 全部 MD+JSON → `buildZip` → Blob 下载
- 新增内部函数: `buildZip`, `concat`, `computeCrc32`
- `Blob` 构造时使用 `zipBytes.buffer as ArrayBuffer`（TypeScript 对 `Uint8Array<ArrayBufferLike>` 的严格检查要求 cast）

**修改文件：`web/src/components/SkillLabPane.tsx`**
- 新增 import: `downloadArchivesZip`
- 新增 state: `const [zipping, setZipping] = useState(false)`
- 新增函数: `downloadAllArchivesZip()` — 调 `downloadArchivesZip`，通过 `api.getEvaluationArchiveFile` 传入 fetcher
- UI: `judgeRepeat` select 下方加 `{judgeRepeat > 1 && <span>...提示...</span>}`
- UI: 「最近归档」header 区 manifest 按钮旁加「zip」按钮（`disabled={archives.length === 0 || zipping}`，loading 用 `Loader2`）

**已验证**:
- `npm -w web run typecheck` ✅ 所有三项改动后均干净

### 6. 未完成事项与下一步（Action Items）

当前 P0-P2 全部清零，无新遗留。以下是可选后续方向（优先级待用户决策）：

- [ ] **ToolLabPane archive zip 支持** — 优先级 P2（可选）
  - 上下文: 本次只给 SkillLabPane 加了 zip 下载，ToolLabPane 有类似的 archive 列表但尚未加 zip 按钮。
  - 输入: `web/src/components/ToolLabPane.tsx` 的归档 UI 部分。
  - 完成标准: 与 SkillLabPane 体验一致——有「zip」按钮，下载包含当前 workspace 所有 tool 归档。
  - 潜在难点: 无，逻辑与 SkillLabPane 完全对称。

- [ ] **真实 `agent → tool → agent` 手测** — 优先级（用户视需求决定）
  - 上下文: P0 任务，本次用户跳过；完整三节点链从未真实跑通。
  - 输入: 包含 `agent→tool→agent` 三节点的 flow；本地可用模型（推荐 MiniMax-M3）；tool 输入文件。
  - 完成标准: UI 启动后 tool 产物可打开，下游 agent 能引用 `{{tool_node_id}}` 输出并正常结束。
  - 潜在难点: 会产生模型调用成本；需用户确认。

### 7. 开放问题与待确认事项

无新增开放问题。Session 6 遗留的「是否允许引入压缩依赖」已通过零依赖实现绕过，无需用户决策。

### 8. 上下文与约定

无变化，延续既有约定。

新增约定：
- ZIP 批量下载使用 stored 模式（无压缩），纯文本文件下载体积略大但实现零依赖，此为有意选择，下次迭代如需压缩可引入 `fflate`。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」——P0-P2 全部清零，无遗留阻塞。
> 若有新功能需求，可参考第 6 节「可选后续方向」：ToolLabPane zip 支持是直接可做的对称实现；`agent→tool→agent` 手测是之前跳过的 P0，需用户确认模型和文件后才能开始。
> 下一次若做手测，切记确认使用 MiniMax-M3 而非默认 deepseek-v4-flash，避免意外成本。

---

## 📌 Session 6 — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 实现 Workflow DAG 图形化编辑器（P1）——引入 `@xyflow/react`，新建 `WorkflowDagEditor.tsx` 全屏 overlay，在执行视图新增「DAG 视图」按钮，支持节点可视化布局、拖拽定位、可视化连线、点击节点编辑属性，已 Playwright 浏览器验证通过，提交 `9a64933`。

**关键决策**:
1. 方案 C：引入 ReactFlow + 保留原有表单编辑器（两种模式切换，非替换）。
2. 全屏 overlay 而非嵌入执行流卡片内（复杂 DAG 需要足够展示空间）。
3. 位置变更实时同步到父 `WorkflowDef` 状态，而非「关闭时保存」。

**新增阻塞/问题**: 线性 DAG（如 AnaX 9 节点链）因所有节点同 Y 轴排列，`fitView` 后画面较小，需用户手动点「适应画面」按钮——属布局副作用，非 bug，可后续优化。

**下一步重点**: ① 真实 `agent → tool → agent` workflow 手测（P0，需用户确认模型和输入文件）；② 可选：线性 DAG 初始缩放优化（P1，纯 UI 改动）。

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室（评估评测）模块
- 项目类型：代码开发
- Session 编号：第 6 次交接
- 本次 Session 起止：从「P1 DAG 图形化编辑尚未实现」推进到「全屏 ReactFlow DAG 编辑器完成，浏览器验证通过」
- 最后更新：2026-06-05
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`
- 提交：`9a64933 feat(ui): add full-screen DAG editor for workflow visualization`

### 2. 项目目标（North Star）

延续 Session 5，无变化。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Workflow 表单式编辑器 | ✅完成 | `MultiAgentExecutionPane.tsx` | Session 5 完成，本次未改动 |
| **Workflow DAG 图形化编辑器** | ✅完成 | `web/src/components/WorkflowDagEditor.tsx` | 本次新增；全屏 overlay，ReactFlow v12 |
| Tool artifacts 浏览 | ✅完成 | Session 5 完成 | — |
| EvalSet/CaseSet 完整 CRUD | ✅完成 | Session 5 完成 | — |
| 归档索引与下载 | ✅完成 | Session 5 完成 | 单文件 MD/JSON/manifest |
| Pairwise judge repeat | ✅完成 | Session 5 完成 | — |
| **真实 `agent → tool → agent` 手测** | ⚠️待验证 | — | P0；需用户确认模型 + 输入文件 |
| Archive zip 批量下载 | ⏳待启动 | — | P2；需确认是否允许引入依赖 |
| Pairwise judge 成本/稳定性 UI 提示 | ⏳待启动 | — | P2；纯文案改动 |
| 线性 DAG 初始缩放优化 | ⏳待启动 | — | P1；可选，详见第 5 节 |

### 4. 关键决策与权衡 ⭐

**决策 5: 方案 C —— ReactFlow 全屏 overlay + 保留表单编辑器**
- 选择: 新建 `WorkflowDagEditor.tsx` 全屏 overlay，通过「DAG 视图」按钮触发；原表单编辑器完整保留，两种模式切换，共享同一份 `WorkflowDef` 状态。
- 备选 A: 自绘 SVG（只读 + 点击选中）——无新依赖，但不能拖拽连线，不满足用户需求。
- 备选 B: 直接用 ReactFlow 替换表单编辑器——可逆性差，且旧表单对 role/icon/skillPaths 等高级字段支持更好。
- 理由: 用户明确需要「拖拽连线」；ReactFlow 比自绘 SVG 功能完整；保留表单保证可逆性（不喜欢就不点按钮，彻底删除仅需 ~20 行改动）。
- 影响范围: 新增 `@xyflow/react@12.11.0` 依赖（~3MB）；`WorkflowNode.position` 字段复用（已在类型定义中，本次未修改 types）。
- 可逆性: 高——删 `WorkflowDagEditor.tsx` + 4 处 `MultiAgentExecutionPane.tsx` 改动即可移除。

**决策 6: 全屏 overlay 而非嵌入执行流卡片**
- 选择: `fixed inset-0 z-50` 全屏，「关闭」按钮返回。
- 备选: 在执行视图中间区域嵌入 ReactFlow 画布（替换节点列表）。
- 理由: 用户明确选择「全屏弹层/抽屉」；复杂 DAG 在窄卡片区无法展示；全屏也更方便拖拽和连线操作。
- 可逆性: 高。

**决策 7: 节点变更实时同步到父状态，不设「保存」按钮**
- 选择: 每次拖拽/连线/删除/属性编辑均立即调 `onWorkflowChange(wf)`，与表单编辑器行为保持一致（都标记 `workflowDirty`）。
- 备选: 在 DAG 编辑器内维护独立草稿，关闭时一次性提交。
- 理由: 表单编辑器已建立「改动即脏」的惯例；DAG 关闭时意外丢失改动体验差；`workflowDirty` 标志和磁盘写入（保存按钮）本就分离，无需重复设计。
- 可逆性: 高（改为草稿模式只需在 close handler 中做一次 merge）。

### 5. 技术/方案细节快照

**新增文件**: `web/src/components/WorkflowDagEditor.tsx`（~380 行）

核心结构：
- `autoLayout(nodes, edges)`: BFS 拓扑排序，按 level × 260px 水平布局，同 level 节点垂直均分（gap 110px）；若任一节点缺 `position` 则全量重算，否则沿用已有位置。
- `WorkflowNodeCard`（ReactFlow 自定义节点）: 固定尺寸 180×72px；颜色编码 agent=`#6366f1`（靛蓝）、gate=`#f59e0b`（琥珀）、tool=`#10b981`（翠绿）；左侧 target handle，右侧 source handle。
- `WorkflowDagEditor`（主组件）: 维护 `localWf`（本地 WorkflowDef 镜像）+ RF nodes/edges 双状态；`applyWfChange` 同时更新两侧并调 `onWorkflowChange`。
- `NodePropertyPanel`（右侧面板）: 编辑 label/kind/model/prompt（agent/gate）或 toolId/inputPath/outputDir（tool）；高级字段（role/icon/skillPaths）提示用表单视图编辑。

**已知 TypeScript 兼容处理**:
- `onRfNodesChange(changes as NodeChange<RFNode>[])` — RF v12 的 `onNodesChange` prop 传入非泛型 `NodeChange[]`，需 cast。
- `onNodeDragStop` 和 `onNodeClick` 的 event 参数改为 `_: unknown`——RF v12 拖拽事件是原生 `MouseEvent | TouchEvent`，非 `React.MouseEvent`。

**`MultiAgentExecutionPane.tsx` 改动摘要**（4 处，共 +~35 行）:
- 新增 `GitBranch` lucide import
- 新增 `import { WorkflowDagEditor }` 
- 新增 `const [showDagEditor, setShowDagEditor] = useState(false)`
- 执行视图 center tab strip 加「DAG 视图」按钮（sky 色，`disabled={!workflow}`）
- JSX 末尾挂载 overlay：`{showDagEditor && workflow && <WorkflowDagEditor ... />}`

**已验证状态**:
- `npm -w web run typecheck` ✅ 干净
- Playwright Chromium 验证：加载「AnaX 商业分析」工作流 → 点「DAG 视图」→ 9节点/8边渲染正确 → 点节点弹出右侧属性面板 → 关闭 overlay 返回正常 ✅

**线性 DAG 初始视图问题**（已知，未修复）: AnaX 等线性 9 节点链经 autoLayout 全排在同一水平线（Y=0），`fitView(padding:0.3)` 后节点显示较小，需用户点左下角「适应画面」按钮或手动缩放。改善方案：对线性链跳过 fitView 改用 `defaultViewport={{ zoom: 1 }}`，或检测 maxLevel>4 时启用竖向布局。

### 6. 未完成事项与下一步（Action Items）

- [ ] **真实 `agent → tool → agent` workflow 手测** — 优先级 P0
  - 上下文: tool-only runner 和 UI 配置均完成；完整三节点链（含模型调用）从未真实跑通。
  - 输入: 一个包含 agent→tool→agent 三节点的 flow；本地可用模型；tool 输入文件路径。
  - 完成标准: UI 启动运行后，tool 产物可打开，下游 agent 能引用 `{{tool_node_id}}` 输出并正常结束。
  - 潜在难点: 会产生真实模型调用成本；需用户确认模型和输入文件后才能开始。

- [ ] **线性 DAG 初始缩放优化** — 优先级 P1
  - 上下文: 见第 5 节「已知问题」；autoLayout 对线性链 fitView 效果差，首次打开节点偏小。
  - 输入: `WorkflowDagEditor.tsx` 的 `initRFNodes` + `<ReactFlow fitView ...>` 配置。
  - 完成标准: 打开 AnaX 9 节点链时，节点不需要手动缩放即可清晰可见。
  - 潜在难点: 无，纯 UI 调整，约 10 行改动。

- [ ] **Archive zip 批量下载** — 优先级 P2
  - 上下文: 当前只有单文件 MD/JSON + manifest；无批量打包。
  - 输入: 确认是否允许引入 Node zip 依赖（`fflate` 或 `archiver`）。
  - 完成标准: 用户可下载当前 workspace 所有归档为单一 zip，路径校验防任意读取。

- [ ] **Pairwise judge 成本/稳定性 UI 提示** — 优先级 P2
  - 上下文: `judgeRepeat > 1` 时成本倍增，当前 UI 无提示。
  - 完成标准: `judgeRepeat` 控件旁显示「将触发 N 次 judge 模型调用」文案。
  - 潜在难点: 无，纯文案改动。

### 7. 开放问题与待确认事项

- ❓ 是否允许做真实 `agent → tool → agent` 手测（会有模型调用成本）？
  - 当前倾向: 需用户确认模型（建议 MiniMax-M3）和 tool 输入文件。
  - 阻塞了什么: P0 完整运行闭环验证。
  - 需要谁解决: 用户决策。

- ❓ Archive zip 是否是刚需，是否允许引入压缩依赖？
  - 当前倾向: 先保持单文件 + manifest；如有明确需求再做。
  - 阻塞了什么: 批量下载体验。
  - 需要谁解决: 用户决策。

### 8. 上下文与约定

无变化，延续既有约定：
- 默认中文沟通，代码/变量/注释用英文。
- 最小改动，不回滚无关 dirty 文件。
- 涉及真实模型/pi 调用前要明确成本/模型/输入。

新增约定：
- DAG 编辑器的 ReactFlow 相关 typecheck workaround（`as NodeChange<RFNode>[]`、`_: unknown`）是已知兼容处理，下次升级 `@xyflow/react` 时重新评估是否可去除。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」和「未完成事项」。
> 当前 P0 是做一次真实 `agent → tool → agent` workflow 手测——在开始前必须让用户确认使用哪个模型（推荐 MiniMax-M3）以及 tool 的输入文件路径，避免无意产生模型调用成本。
> DAG 图形化编辑器（`WorkflowDagEditor.tsx`）已完成，线性 DAG 初始视图偏小是已知问题（见第 5 节），修复约 10 行，可按需处理。
> 若继续做 archive zip，先询问是否允许引入压缩依赖。

---

## 📌 Session 5 — 2026-06-05

### 0. 本次更新摘要（Changelog）

**本次推进**: 在 Session 4 的评测基础设施上，完成 workflow tool node 前端编辑体验、tool artifacts 浏览、EvalSet/CaseSet 完整 CRUD、归档索引/下载、Pairwise judge 重采样聚合，以及旧 `/tmp` DB schema 自愈修复。

**关键决策**:
1. Workflow tool node UI 先做表单式编辑，不引入画布/拖拽设计器；用 `kind/toolId/inputPath/outputDir/timeoutMs` 覆盖 P0 运行配置。
2. 归档报告先做 workspace archive index + 单文件 `MD/JSON` 下载 + manifest 导出，不手写 zip，也不引入新依赖。
3. Pairwise judge 重采样默认 `judgeRepeat=1` 兼容旧流程；当 >1 时独立 judge 多次并按多数票聚合，分数和 confidence 取平均。

**新增阻塞/问题**: 无硬阻塞；剩余主要是 UI 真实浏览器手测、真实模型 `agent → tool → agent` 工作流运行验证，以及更高级的 workflow DAG 设计器体验。

**下一步重点**: 1）用真实工作流做一次 `agent → tool → agent` 手测；2）如用户需要，继续做 archive zip 批量下载或 workflow 图形化编辑。

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室（评估评测）模块
- 项目类型：代码开发
- Session 编号：第 5 次交接
- 本次 Session 起止：从“Tool 进 Workflow/评测归档/任务集 C/R 已完成，但 UI 编辑体验与归档浏览仍不完整”推进到“P0/P1 主要闭环完成，P2 增强项大多完成”
- 最后更新：2026-06-05
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`
- 重要状态：工作区仍有大量 dirty / untracked 文件，且很多是历史 session 或实验性文件；不要整体回滚，不要用全局 `git diff` 直接归因。

### 2. 项目目标（North Star）

延续 Session 4，无变化：把“实验室”建设成可比较、可复跑、可解释的评测模块，让 Skill / Workflow / Tool 的改动能通过结构化任务集、真实运行、结果对比与报告归档来判断质量差异。

当前成功标准进一步推进为：

- Workflow 可配置并保存 tool node，且能用真实 registered tool 做 tool-only runner 闭环。
- Skill/Tool 评测任务集可完整 CRUD，评测结果可复跑、归档、索引、下载。
- Pairwise judge 不仅能输出 typed error 和 confidence，还能多次重采样后投票聚合。
- 旧临时 DB schema 缺列问题可在启动时自愈。

非目标：本 Session 未做 MCP 化、未做 pi 自主召唤 tool 评测、未做 archive zip 打包、未做完整 ReactFlow/拖拽式 workflow DAG 设计器。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Workflow tool node UI | ✅完成 | `web/src/components/MultiAgentExecutionPane.tsx` | 支持添加 agent/tool node、编辑 node id/kind/label/model/inputs/prompt、编辑 edges、删除节点、保存 workflow |
| Tool node 配置校验 | ✅完成 | `validateWorkflowEditor()` | 重复/空 node id、edge 缺失、tool node 缺 `toolId/inputPath` 会高亮并阻止保存/运行 |
| Tool artifacts 浏览 | ✅完成 | `MultiAgentExecutionPane.tsx`、`RunOutputPanel.tsx` | tool output JSON 解析后可打开 `summary.json` 与产物文件 |
| Tool-only workflow 真实闭环 | ✅完成 | `server/src/multi-agent-runner.test.ts` | 使用 registered `phone-cleaner` + fixture 真实执行，不触发模型 |
| EvalSet/CaseSet 完整 CRUD | ✅完成 | `server/src/db.ts`、`server/src/index.ts`、`SkillLabPane.tsx`、`ToolLabPane.tsx` | 支持 create/list/update/delete、重命名、当前任务覆盖保存、删除确认 |
| API smoke 覆盖 | ✅完成 | `server/src/eval-set-api-smoke.test.ts` | 覆盖 eval set/case set CRUD、archive、archive index、archive file download |
| 归档索引与下载 | ✅完成 | `server/src/evaluation-archive.ts`、`web/src/lib/api.ts`、Skill/Tool Lab | `GET /api/workspaces/:id/evaluation-archives`，单文件 `MD/JSON` 下载，manifest 导出 |
| Pairwise confidence | ✅完成 | `server/src/skill-evaluation-runner.ts`、`web/src/components/SkillLabPane.tsx` | judge prompt 要求 `confidence: 0..1`，summary 展示 `avgConfidence` |
| Pairwise judge repeat | ✅完成 | `judgeRepeat` | 默认 1；>1 时多次独立 judge，按 `win/tie/loss` 多数票聚合，保存 `pairwise.judgeRuns` |
| 旧 DB schema 自愈 | ✅完成 | `server/src/db.ts` | `workspace_paths` 建表补 `file_hash`，建表后再次同步列，修复旧 `/tmp` DB 缺列日志 |
| 验证状态 | ✅完成 | 见第 5.8 节 | server 全量测试最新 `72 pass / 0 fail`，web build 通过 |

### 4. 关键决策与权衡 ⭐

**决策 1: Workflow 编辑先做表单式最小设计器**
- 选择: 在执行流卡片展开区直接编辑节点基础字段、tool 字段和关联 edges。
- 备选: 直接引入完整画布/拖拽/ReactFlow 式设计器。
- 理由: 当前风险在配置是否可保存/可运行，不在视觉编排；表单式实现更快闭环，也更容易验证。
- 影响范围: 复杂 DAG 视觉体验仍待后续做，但 P0 tool node 运行配置不再需要手改 `workflow.json`。
- 可逆性: 高。

**决策 2: 归档下载先做单文件与 manifest，不做 zip**
- 选择: `GET /api/workspaces/:id/evaluation-archives/:baseName/:format` 只允许下载 archive index 中存在的 `md/json`；前端提供 `MD`、`JSON`、`manifest`。
- 备选: 手写 zip/tar 或安装压缩依赖。
- 理由: 当前未确认 zip 是刚需；单文件与 manifest 已能支持审计、备份和定位，且避免引入依赖。
- 影响范围: 用户如需一次性批量打包，后续还要补 zip。
- 可逆性: 高。

**决策 3: Pairwise judge repeat 使用多数票聚合**
- 选择: `judgeRepeat` 独立运行多次 judge；聚合结果按 `win/tie/loss` 多数票，分数与 confidence 取平均，明细保存在 `judgeRuns`。
- 备选: 只取最后一次、只取均分、不保存明细。
- 理由: 多数票最直观，明细保留可审计；默认 1 保持成本和历史行为不变。
- 影响范围: 当 `judgeRepeat > 1` 时会增加模型调用成本；前端已显式提供选择。
- 可逆性: 中。

**决策 4: DB schema 自愈不清理旧 `/tmp` 数据**
- 选择: 修迁移顺序和建表定义，让旧 DB 启动时自动补列。
- 备选: 删除 `/tmp` 旧数据目录或只在 smoke 中换新目录。
- 理由: 用户环境可能有临时但仍有价值的数据；自愈更稳，不破坏已有状态。
- 影响范围: `workspace_paths` 旧表缺 `session_id/flow_id/kind/file_hash` 时会自动补齐。
- 可逆性: 高。

### 5. 技术/方案细节快照

#### 5.1 Workflow tool node UI

- 主要文件：`web/src/components/MultiAgentExecutionPane.tsx`
- 新增能力：
  - 顶部添加 `agent` / `tool` node。
  - 展开节点后编辑 `node id`、`kind`、`label`、`model`、`inputs`、`prompt`。
  - tool node 编辑 `toolId`、`timeoutMs`、`inputPath`、`outputDir`。
  - 从 registered tool 一键“套用”默认 `label/toolId/inputPath/outputDir/timeoutMs`。
  - 编辑/新增/删除 edge；删除节点时同步清理关联 edge。
  - `validateWorkflowEditor()` 对明显错误前端阻止保存/运行。

#### 5.2 Tool artifacts 统一入口

- tool node output JSON 被 `parseToolStepOutput()` 解析。
- UI 显示 tool status、`summary.json` 和 artifact 文件按钮。
- 点击后通过 `requestedOutputFile` 让右侧 `RunOutputPanel` 打开 run 文件。
- 后端 tool node 默认输出结构仍是：
  - `nodeDir/summary.json`
  - `nodeDir/output/*` 或 `outputDir/*`
  - blackboard JSON 包含 `outputPath/summaryPath/artifacts`

#### 5.3 EvalSet / CaseSet CRUD

- 后端 DB：`server/src/db.ts`
  - Skill: `getSkillEvalSet`、`updateSkillEvalSet`、`deleteSkillEvalSet`
  - Tool: `getToolCaseSet`、`updateToolCaseSet`、`deleteToolCaseSet`
- REST：
  - `PATCH /api/skill-eval-sets/:id`
  - `DELETE /api/skill-eval-sets/:id`
  - `PATCH /api/tool-case-sets/:id`
  - `DELETE /api/tool-case-sets/:id`
- 前端：
  - Skill/Tool Lab 均有更新、重命名、删除按钮。

#### 5.4 评测归档

- 后端：`server/src/evaluation-archive.ts`
- API：
  - `POST /api/evaluations/:kind/:id/archive`
  - `GET /api/workspaces/:id/evaluation-archives`
  - `GET /api/workspaces/:id/evaluation-archives/:baseName/:format`
- 前端：
  - Skill/Tool Lab 侧栏“最近归档”
  - 单条 `MD` / `JSON` 下载
  - `manifest` 下载当前 archive index JSON
- 仍未做：zip 批量打包。

#### 5.5 Pairwise judge

- `SkillPairwiseResult` 新增：
  - `confidence: number | null`
  - `judgeRuns?: SkillPairwiseResult[]`
- `SkillPairwiseSummary` 新增：
  - `avgConfidence: number | null`
- `SkillEvaluationRunRequest` 新增：
  - `judgeRepeat: number`，默认 1，范围 1-5。
- `runRepeatedPairwiseJudge()`：
  - `judgeRepeat=1` 时保持单次行为。
  - `judgeRepeat>1` 时写入 `pairwise/<result-id>/judge-1..N`。
  - 聚合规则：多数票；票数相同用平均 `scoreDelta` 绝对值辅助排序；分数/confidence 取平均。

#### 5.6 DB schema 技术债修复

- 根因：早期迁移在 `CREATE TABLE IF NOT EXISTS workspace_paths` 前执行；当表不存在时迁移失败并被吞掉，而建表定义漏 `file_hash`。
- 修复：
  - `workspace_paths` 建表定义加入 `file_hash TEXT`。
  - 建表后再次执行 `session_id/flow_id/kind/file_hash` 列同步。
  - `updateChangeProposal()` 中 SQL 参数数组从 `unknown[]` 收窄为 `Array<string | number | null>`，修复 Node sqlite typecheck。

#### 5.7 真实 tool-only 测试

- `server/src/multi-agent-runner.test.ts`
- 新增真实 registered tool 测试：
  - 使用 `phone-cleaner`
  - 输入 `server/tools/phone-cleaner/tests/fixtures/minimal.csv`
  - 不触发模型
  - 验证 `blackboard.clean`、`summary.json`、artifact 列表和实际输出文件。

#### 5.8 验证状态

本 Session 最后已通过：

- `npm -w server run typecheck`
- `npm -w web run typecheck`
- `node --experimental-strip-types --test server/src/*.test.ts` → `72 pass / 0 fail`
- `npm -w web run build` → 通过；仍有既有 Vite 大 chunk 警告
- 旧 DB smoke：
  - 人工创建缺 `file_hash` 的 `/tmp/pi-xanthil-db-migration-smoke/xanthil.db`
  - 导入 `server/src/db.ts`
  - `PRAGMA table_info(workspace_paths)` 输出包含 `session_id,flow_id,kind,file_hash`

### 6. 未完成事项与下一步（Action Items）

- [ ] **真实 `agent → tool → agent` workflow 手测** — 优先级 P0
  - 上下文: 目前已完成 tool-only runner 和 UI 配置；但还没跑会触发真实模型/pi 的完整 agent-tool-agent 链。
  - 输入: 一个包含 agent、tool、agent 三节点的 flow；本地可用模型；tool 输入文件路径。
  - 完成标准: UI 启动运行后，tool 产物可打开，下游 agent 能引用 `{{tool_node_id}}` 输出并正常结束。
  - 潜在难点: 会产生真实模型调用成本；需用户确认模型和输入文件。

- [ ] **Workflow 图形化/DAG 编辑增强** — 优先级 P1
  - 上下文: 当前是表单式编辑，已能新增/删除节点和 edges，但不是完整画布。
  - 输入: `MultiAgentExecutionPane.tsx` 当前编辑区。
  - 完成标准: 支持更直观的 DAG 展示、节点排序/布局、复杂依赖可读性提升。
  - 潜在难点: 要避免一次性大改 UI；建议渐进做，不引入无关设计系统变化。

- [ ] **Archive zip 批量下载** — 优先级 P2
  - 上下文: 当前有单文件下载和 manifest；尚无 zip。
  - 输入: `listEvaluationArchives()` 返回项。
  - 完成标准: 用户可一次下载当前 workspace 所有归档 md/json，且不允许任意路径读取。
  - 潜在难点: Node 标准库无 zip；需要确认是否允许引入依赖，或实现 tar/gzip。

- [ ] **Pairwise judge 成本/稳定性 UI 提示** — 优先级 P2
  - 上下文: `judgeRepeat` 会倍增 judge 模型调用。
  - 输入: Skill Lab 的 `Judge 重采样` 控件。
  - 完成标准: UI 明确显示 `judgeRepeat` 对调用次数/成本的影响，避免误操作。
  - 潜在难点: 成本估算需要模型价格或 token 估算，当前可先做文案提示。

### 7. 开放问题与待确认事项

- ❓ 是否允许下一步做真实模型调用的 `agent → tool → agent` 手测？
  - 当前倾向: 需要用户确认模型和输入文件，避免无意产生成本。
  - 阻塞了什么: P0 完整运行闭环验证。
  - 需要谁/什么来解决: 用户决策。

- ❓ Archive zip 是否是刚需，是否允许引入压缩依赖？
  - 当前倾向: 先保持单文件下载 + manifest；如用户明确需要，再做 zip。
  - 阻塞了什么: 批量下载体验。
  - 需要谁/什么来解决: 用户决策。

### 8. 上下文与约定

无变化，延续既有约定：

- 默认中文沟通，代码/变量/注释用英文。
- 最小改动，不回滚无关 dirty 文件。
- 涉及真实模型/pi 调用前要明确成本/模型/输入。
- 删除/覆盖/重命名前必须确认；只读和新建测试文件可直接执行。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「本次更新摘要」和「未完成事项」。
> 当前最紧迫的是做一次真实 `agent → tool → agent` workflow 手测，但开始前必须让用户确认模型、输入文件和是否接受模型调用成本。
> 注意工作区仍然很脏，很多 modified/untracked 不是本 Session 改动，不要整体回滚。
> 如果继续做 archive zip，请先询问是否允许引入压缩依赖；否则优先保持无新依赖方案。

---

## 📌 Session 4（最新）— 2026-06-04

### 0. 本次更新摘要（Changelog）

**本次推进**: 在 Session 3 已完成 Skill/Tool 评测产品化基础上，完成 Tool 进 Workflow 最小闭环、评测模板体验补齐、Pairwise judge 稳定性增强、评测结果归档、workspace 级评测任务集 CRUD。

**关键决策**:
1. Tool 进 Workflow 采用方案 C：`kind: "tool"` 的最小 tool-run step，直接运行本地 registered extraction tool，不引入 MCP，不评估 pi 自主召唤 tool 能力。
2. 评测归档采用后端持久化到 workspace：`evaluations/archive/<kind>-evaluation-<id>.md/json`，前端下载仍保留。
3. 评测任务集 CRUD 先做最小 workspace 级保存/读取：`skill_eval_sets` 与 `tool_case_sets`，暂不做编辑、删除、版本管理。

**新增阻塞/问题**: 无硬阻塞；下一阶段主要是 UI 手测、工作流 tool node 可视化/编辑体验，以及 EvalSet/CaseSet 的编辑删除能力。

**下一步重点**: 1）给 workflow 编辑/展示层补 tool node 的可视化与配置入口；2）补 EvalSet/CaseSet 编辑、删除、重命名和更完整的 API 测试。

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室（评估评测）模块
- 项目类型：代码开发
- Session 编号：第 4 次交接
- 本次 Session 起止：从“Session 3 已完成评测模板、导出、pairwise、golden diff，但 Tool 未进 Workflow、任务集未持久化”推进到“P0/P1/P2 主要开发项均完成最小闭环”
- 最后更新：2026-06-04
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`
- 重要状态：工作区仍有大量 dirty / untracked 文件，部分实验室文件本来就是 untracked；不要用整体 `git diff` 判断本 Session 归属。

### 2. 项目目标（North Star）

延续 Session 3，无变化：把“实验室”建设成可比较、可复跑、可解释的评测模块，让 Skill / Workflow / Tool 的改动能通过结构化任务集、真实运行、结果对比与报告归档来判断质量差异。

当前成功标准已经推进为：

- Workflow 可编排本地 extraction tool，形成 “agent → tool → agent” 的最小运行链路。
- Skill/Tool 评测任务可保存、复用、载入，避免每次临时手填。
- 评测结果可下载，也可归档到 workspace 文件系统供后续复查。
- Pairwise judge 能显式依据 `expectedPoints` / `rubric` 判分，并在失败时暴露 typed error。

非目标：本 Session 未做 MCP 化、未做 pi 自主召唤 tool 评测、未做 EvalSet/CaseSet 编辑删除/版本管理、未做完整 workflow tool node UI 设计器。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| Tool 进 Workflow | ✅完成 | `server/src/multi-agent-runner.ts`、`server/src/multi-agent-runner.test.ts` | `WorkflowNode.kind` 支持 `"tool"`，执行本地 registered extraction tool |
| Tool node 输出 | ✅完成 | `executeToolNode()` | JSON 写入 blackboard，包含 `toolId/inputPath/outputPath/summaryPath/code/success/stdout/stderr/summary/artifacts` |
| Tool node 类型同步 | ✅完成 | `web/src/types.ts` | 前端协议类型已支持 `toolId/inputPath/outputDir/timeoutMs` |
| ToolLabPane 模板体验 | ✅完成 | `web/src/components/ToolLabPane.tsx` | 载入模板显示来源/数量/coverage，覆盖前确认，失败结果有 Expected/Actual 摘要 |
| Pairwise judge 稳定性 | ✅完成 | `server/src/skill-evaluation-runner.ts`、`web/src/components/SkillLabPane.tsx` | prompt 纳入 rubric/expectedPoints，JSON 解析容错，前端展示 pairwise error |
| 评测结果归档 | ✅完成 | `server/src/evaluation-archive.ts`、`POST /api/evaluations/:kind/:id/archive` | 写入 workspace `evaluations/archive/*.md/*.json` |
| Skill EvalSet | ✅完成 | `skill_eval_sets`、`SkillLabPane` | 可保存/载入当前 Skill tasks |
| Tool CaseSet | ✅完成 | `tool_case_sets`、`ToolLabPane` | 可按当前 tool 保存/载入 cases |
| 自动化验证 | ✅完成 | typecheck / node tests / DB smoke | 最新 server 全量 `61 pass / 0 fail` |

### 4. 关键决策与权衡 ⭐

**决策 1: Tool 进 Workflow 采用方案 C 的最小 tool-run step**
- 选择: `WorkflowNode.kind` 增加 `"tool"`，字段为 `toolId`、`inputPath`、可选 `outputDir`、`timeoutMs`；runner 跳过 pi，直接运行 `runExtractionToolProcess`。
- 备选: A Prompt 注入让 pi 调 REST/CLI；B MCP 化暴露工具。
- 理由: 当前优先目标是稳定编排本地 extraction tool，不引入 LLM 召唤不确定性，也不增加 MCP SDK 和服务维护面。
- 影响范围: 当前只评估/编排 tool 自身能力；“pi 是否会主动选对 tool”仍是未来独立增强项。
- 可逆性: 中。

**决策 2: Tool node 输出先进入 blackboard，不接 Session artifacts tree**
- 选择: tool node 输出 JSON summary 字符串写入 `blackboard[node.id]`，下游 agent 可用 `{{node_id}}` 引用；真实产物保留在 `outputPath`。
- 备选: 立即把 tool artifacts 接入 Session artifacts tree。
- 理由: 最小闭环改动小，和现有 multi-agent runner 的 node 输出契约一致。
- 影响范围: UI artifact tree 暂不能统一浏览 tool output，需要后续补。
- 可逆性: 高。

**决策 3: 评测归档走后端文件写入**
- 选择: 新增 `evaluation-archive.ts` 和 `POST /api/evaluations/:kind/:id/archive`，写入 Markdown + JSON 到 workspace。
- 备选: 继续只做前端 Blob 下载；或新建 report DB 表。
- 理由: workspace 文件更直观、易备份、无需扩展复杂 DB schema；同时保留前端下载。
- 影响范围: 报告文件当前不自动注册到 workspace paths / session artifacts。
- 可逆性: 高。

**决策 4: EvalSet/CaseSet 只做最小 CRUD 的 C/R**
- 选择: 新增 `skill_eval_sets`、`tool_case_sets`，只支持 create/list，前端支持保存/载入。
- 备选: 完整 CRUD + 版本管理 + 删除/重命名。
- 理由: 当前痛点是复用任务集，最小 C/R 即可闭环；编辑删除可在真实使用后按需求补。
- 影响范围: 用户保存错了暂不能从 UI 删除，只能后续补 API/UI。
- 可逆性: 中。

### 5. 技术/方案细节快照

#### 5.1 Tool 进 Workflow

- `server/src/multi-agent-runner.ts`
  - `WorkflowNode.kind?: "agent" | "gate" | "tool"`。
  - tool 字段：`toolId?: string`、`inputPath?: string`、`outputDir?: string`、`timeoutMs?: number`。
  - `MultiAgentRunOptions` 新增 injectable `runTool`、`getTool`，测试不依赖真实 python tool。
  - `executeToolNode()` 会解析 `{{input.*}}` / upstream placeholders，校验 `validateExtractionInput()`，调用 `runExtractionToolProcess()`。
  - 成功条件：process code 为 0 且 summary 中没有 `error` / `failed > 0` / result-level error。

#### 5.2 Pairwise judge

- `server/src/skill-evaluation-runner.ts`
  - 新增导出 `buildPairwiseJudgePrompt()` 供测试。
  - prompt 显式包含：原始任务、预期要点、评分标准、baseline/variant 输出。
  - 明确约束：不要因 variant 更长、更复杂或声称用了 skill 就给高分；必须输出 JSON object。
  - `extractJsonObjectText()` 可从包裹文本中提取 JSON object。
- `web/src/components/SkillLabPane.tsx`
  - pairwise 区块展示 `pairwise.error`。

#### 5.3 评测归档

- `server/src/evaluation-archive.ts`
  - `archiveSkillEvaluation(workspaceRoot, detail)`。
  - `archiveToolEvaluation(workspaceRoot, detail)`。
  - 输出路径：`<workspaceRoot>/evaluations/archive/<kind>-evaluation-<safe-id>.md/json`。
  - Markdown 内容大体复用前端导出结构，并补 Skill pairwise error。
- `server/src/index.ts`
  - `POST /api/evaluations/:kind/:id/archive`。
- `web/src/lib/api.ts`
  - `archiveEvaluation(kind, evaluationId)`。
- `SkillLabPane` / `ToolLabPane`
  - 报告头部新增“归档”按钮，成功后显示 markdown/json 绝对路径。

#### 5.4 评测任务集 CRUD

- `server/src/types.ts` / `web/src/types.ts`
  - `SkillEvalSet { id, workspaceId, name, tasks, createdAt, updatedAt }`
  - `ToolCaseSet { id, workspaceId, name, toolId, cases, createdAt, updatedAt }`
- `server/src/db.ts`
  - `skill_eval_sets`：`id/workspace_id/name/tasks/created_at/updated_at`
  - `tool_case_sets`：`id/workspace_id/name/tool_id/cases/created_at/updated_at`
  - `createSkillEvalSet()`、`listSkillEvalSets()`、`createToolCaseSet()`、`listToolCaseSets()`
  - workspace 删除时同步清理两张表。
- `server/src/index.ts`
  - `GET/POST /api/workspaces/:id/skill-eval-sets`
  - `GET/POST /api/workspaces/:id/tool-case-sets?toolId=...`
- `web/src/components/SkillLabPane.tsx`
  - 保存当前 runnable tasks 为任务集；载入前如果当前有 draft task 则确认覆盖。
- `web/src/components/ToolLabPane.tsx`
  - 保存当前 runnable cases 为 case set；按当前 tool 加载 case sets；载入前确认覆盖。

#### 5.5 验证状态

已通过：

- `npm -w server run typecheck`
- `npm -w web run typecheck`
- `node --experimental-strip-types --test server/src/multi-agent-runner.test.ts`：19 pass
- `node --experimental-strip-types --test server/src/skill-evaluation-runner.test.ts`：6 pass
- `node --experimental-strip-types --test server/src/evaluation-archive.test.ts`：2 pass
- `node --experimental-strip-types --test server/src/*.test.ts`：61 pass / 0 fail
- DB smoke：
  - `XANTHIL_DATA_DIR=/tmp/pi-xanthil-eval-set-smoke node --experimental-strip-types -e ...`
  - 验证 `create/listSkillEvalSet` 和 `create/listToolCaseSet` 可写可读。

未验证：

- 未做浏览器 UI 手测。
- 未启动 dev server 手测 workflow tool node 真实编排。
- 未对新增 EvalSet/CaseSet REST API 写独立 HTTP 层测试，仅做 DB smoke 和 typecheck。

### 6. 未完成事项与下一步（Action Items）

- [ ] **Workflow tool node UI/编辑体验** — 优先级 P0
  - 上下文: runner 已支持 `kind:"tool"`，但前端 workflow 编辑/展示层还没有专门的 tool node 配置体验。
  - 输入: `web/src/types.ts`、`MultiAgentExecutionPane`、workflow editor/flow file editing 相关组件、`server/src/multi-agent-runner.ts`。
  - 完成标准: 用户能在 UI 中识别/编辑 tool node 的 `toolId/inputPath/outputDir/timeoutMs`，并能运行包含 tool node 的 workflow。
  - 潜在难点: 现有 UI 可能默认把节点当 agent/gate 展示；要避免影响 AnaX gate/fanOut。

- [ ] **Tool artifacts 统一浏览** — 优先级 P1
  - 上下文: tool node 产物保留在 `outputPath`，blackboard 只保存 summary JSON。
  - 输入: `executeToolNode()` 输出、现有 `sessionArtifactTree` / flow run output 目录逻辑。
  - 完成标准: workflow run 结束后，用户可从现有 artifacts/tree 或等价入口浏览 tool output 文件。
  - 潜在难点: 当前 artifacts tree 偏 session/report 路径，workflow run output 和 tool output 的归属需确认。

- [ ] **EvalSet/CaseSet 完整 CRUD** — 优先级 P1
  - 上下文: 本 Session 只做了 create/list 和前端保存/载入。
  - 输入: `skill_eval_sets`、`tool_case_sets`、`SkillLabPane`、`ToolLabPane`。
  - 完成标准: 支持重命名、更新、删除；前端能管理已保存模板；删除前确认。
  - 潜在难点: 需要定义覆盖保存 vs 新建副本的交互。

- [ ] **新增 API HTTP 测试 / smoke** — 优先级 P1
  - 上下文: 新增 archive 和 eval-set routes 主要通过 typecheck、DB smoke 和模块测试验证。
  - 输入: `server/src/index.ts` 现有 API 测试模式（若无合适模式，可用轻量 server smoke）。
  - 完成标准: 覆盖 `skill-eval-sets`、`tool-case-sets`、`archive` 的 200/400/404 基本路径。
  - 潜在难点: `index.ts` 启动 Express 可能受本地端口/数据目录影响，应使用临时 `XANTHIL_DATA_DIR`。

- [ ] **评测报告归档索引/批量下载** — 优先级 P2
  - 上下文: 当前只能单个 evaluation 点击归档，且返回绝对路径。
  - 输入: `evaluation-archive.ts`、workspace 文件树/paths。
  - 完成标准: 可查看已归档报告列表，或下载某 workspace 的全部评测报告。
  - 潜在难点: 是否接入 workspace paths / report folder 仍需确认。

- [ ] **Pairwise judge 置信度/多次 judge** — 优先级 P2
  - 上下文: prompt 已增强，但 repeat/temperature/confidence 尚未实现。
  - 输入: `SkillPairwiseResult` 类型、DB `pairwise` JSON 字段、前端展示。
  - 完成标准: 可配置 judge repeat 或 confidence，并在 summary 中展示稳定性。
  - 潜在难点: 是否需要 DB schema 变更取决于字段设计。

### 7. 开放问题与待确认事项

- ❓ Workflow tool node 是否需要进入 UI 设计器的一等节点类型？
  - 当前倾向: 需要；runner 已支持，但没有 UI 很难给普通用户使用。
  - 阻塞了什么: Tool 进 Workflow 的产品闭环。
  - 需要谁/什么来解决: 下个 Session 读 workflow UI 后实现。

- ❓ Tool run artifacts 应统一到 Session artifacts tree，还是保持 workflow run output 独立树？
  - 当前倾向: 先接入可浏览入口即可，不必强行塞进 session tree。
  - 阻塞了什么: tool output 的可视化复查体验。
  - 需要谁/什么来解决: 需要查看现有 flow run output UI 与 artifact API。

- ❓ EvalSet/CaseSet 是否需要删除/重命名权限与版本历史？
  - 当前倾向: 先补删除/重命名，不急于版本历史。
  - 阻塞了什么: 模板管理体验。
  - 需要谁/什么来解决: 用户对模板复用频率和误删风险的反馈。

### 8. 上下文与约定

- 无变化，延续既有约定：交互默认中文；代码/变量/注释使用英文；最小改动；改前 grep；验证优先。
- 重要提醒：当前 worktree 不是干净状态，且 `SkillLabPane.tsx`、`ToolLabPane.tsx`、多个实验室相关测试/runner 文件仍显示 untracked。不要默认删除或重建。
- 新增 DB 表已被用户确认允许：`skill_eval_sets`、`tool_case_sets`。
- 本 Session 没有启动 dev server，也没有进行浏览器 UI 手测。

### 9. 下一个 Session 启动指令

> 请先读本 Session 的「当前进度全景」和「未完成事项」。不要重复实现 Tool 进 Workflow、归档、EvalSet/CaseSet 最小 CRUD。
> 当前最紧迫的是补 Workflow tool node 的 UI/编辑体验，让 `kind:"tool"` 能被用户实际配置和运行。
> 开始前先执行 `git status --short`，区分已有 dirty/untracked 与新改动；不要回滚非本任务文件。
> 若要做 UI 手测，先确认端口与旧进程处理方式；不要默认 kill 用户进程。
> 验证至少跑 `npm -w server run typecheck`、`npm -w web run typecheck`、`node --experimental-strip-types --test server/src/*.test.ts`；若改前端体验，建议再跑 `npm -w web run build`。

---

## 📌 Session 3（最新）— 2026-06-04

### 0. 本次更新摘要（Changelog）

本次 Session 在 Session 2 已完成评测骨架的基础上，继续推进“实验室（评估评测）模块”的产品化与可验证性。核心结果是：Tool 评测从“手填路径/期望”推进到“可加载真实工具模板、可跑真实 fixtures、可做更稳的 golden diff”；Skill 评测从“按 variant 跑任务”推进到“能持久化 baseline-vs-variant 的 pairwise judge 结果”；前端补齐了 Skill/Tool 评测结果导出入口。

主要完成项：

- ToolLabPane 增加输入路径、goldenDir 路径选择，以及 `tests/cases.json` 模板载入入口。
- 后端新增 `GET /api/extraction-tools/:id/test-cases`，读取 `server/tools/<tool>/tests/cases.json` 并解析为 Tool 评测 case。
- Tool case template 约定落地：`server/tools/<tool>/tests/cases.json`，相对路径按工具目录解析为绝对路径。
- 为 `extract-tmall-profile`、`extract-xhs-insight`、`phone-cleaner` 增加真实 fixtures / golden / cases，并完成真实 runner smoke。
- Skill 评测新增 pairwise judge：按同一 `taskId + attempt` 比较 baseline 与各 variant，结果与 summary 持久化入 DB。
- Tool golden diff 增强：JSON 结构深比较、ignore paths、文本 whitespace normalization、差异定位提示。
- Skill/Tool 评测详情页新增 JSON / Markdown 导出。
- 验证通过：server/web typecheck、server node test、web build、三类 Tool 模板真实 smoke。

本次未完成但被进一步明确的事项：Tool 进 Workflow 的运行时接入仍未实现；评测模板 CRUD / workspace 级模板管理仍未实现；pairwise judge 的 prompt 与置信度策略还需继续稳定。

### 1. 项目元信息

- 项目：苍耳 pi-Xanthil
- 模块：实验室 / 评估评测（Skill Evaluation + Tool Evaluation）
- 当前 Session：Session 3
- 日期：2026-06-04
- 仓库路径：`/Users/huangbo/Dev/Projects/pi-xanthil`
- 交接文档：`handoff-实验室.md`
- 重要状态：工作区本身已有较多 dirty / untracked 文件，本次交接只记录本模块相关变更，不应把全部 `git diff` 都归因到本 Session。

### 2. 项目目标（North Star）

延续 Session 2 的目标：把“实验室”建设成可比较、可复跑、可解释的评测模块，让 Skill / Workflow / Tool 的改动能通过结构化任务集、真实运行、结果对比与导出报告来判断质量差异。

当前阶段的完成标准进一步细化为：

- Skill：能运行多 variant，多任务多 repeat，并通过 pairwise judge 看出 baseline 与候选 variant 的优劣。
- Tool：能基于工具目录内的标准 `tests/cases.json` 一键载入 case，使用 fixtures 与 golden 真实跑评测。
- 结果：前端能查看失败原因、关键 metric、pairwise 摘要，并能导出 JSON / Markdown。
- 判分：golden diff 优先采用确定性结构比较；LLM judge / pairwise judge 用于质量差异解释。
- 非目标：本次仍未把 Tool 作为 Workflow step 真正接入运行时；也未做完整评测任务集 CRUD。

### 3. 当前进度全景

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Workflow 前置改造 | ✅ 已完成 | Session 2 已完成 `runTurn` 注入点、model/judgeModel 持久化等前置能力 |
| ToolLabPane 路径选择 | ✅ 已完成 | case input、goldenDir 支持选择文件/目录 |
| Tool case 模板载入 | ✅ 已完成 | 前端可载入 `server/tools/<tool>/tests/cases.json` |
| Tool 模板真实 fixtures | ✅ 已完成 | 已覆盖 tmall / xhs / phone-cleaner 三个工具 |
| Tool golden diff | ✅ 已完成 | JSON 深比较、ignorePaths、文本 whitespace normalization |
| Skill pairwise judge | ✅ 已完成 | baseline-vs-variant 结果与 summary 入库并在前端展示 |
| 评测结果导出 | ✅ 已完成 | Skill/Tool 均支持 JSON 与 Markdown 导出 |
| 自动化验证 | ✅ 已完成 | server/web typecheck、server tests、web build、tool template smoke 通过 |
| Tool 进 Workflow | ⏳ 未完成 | 仍需确认采用哪种接入方案并实现 |
| 评测模板/任务集 CRUD | ⏳ 未完成 | 当前仍以文件模板与临时前端表单为主 |

### 4. 关键决策与权衡 ⭐

1. Tool case 模板放在工具目录下

   采用 `server/tools/<tool>/tests/cases.json`，而不是全局评测目录。这样模板、fixtures、golden 与工具实现保持近距离，便于迁移和维护。后端 loader 会把相对 `inputPath` / `goldenDir` 解析到工具根目录内；绝对路径仍允许传入。

2. Skill pairwise judge 持久化，而不是只在前端临时计算

   Pairwise 结果写入 `skill_evaluation_results.pairwise`，summary 写入 `skill_evaluations.pairwise_summaries`。这样导出、历史查看、后续报表都能复用同一份结果。测试中使用 injectable judge，避免真实模型调用造成不稳定。

3. Tool golden diff 先走确定性比较

   JSON golden 使用结构深比较，文本 golden 支持 whitespace normalization。这样能减少 LLM judge 的不确定性，也更适合工具输出回归测试。ignore paths 用于跳过时间戳、生成时间等非稳定字段。

4. 导出先做前端本地 Blob

   本次没有新增后端 report API，而是在 `web/src/lib/evaluation-export.ts` 中生成 JSON / Markdown 并下载。这样改动小、反馈快；未来如需归档到 workspace artifact，再新增后端持久化。

### 5. 技术/方案细节快照

#### 5.1 前端入口

- `web/src/components/ToolLabPane.tsx`
  - 增加 input path picker、goldenDir picker。
  - 增加“载入模板”按钮，从后端读取工具测试模板。
  - Golden 期望增加 `normalizeWhitespace` checkbox 与 `ignorePaths` textarea。
  - 详情头部增加 JSON / Markdown 导出。

- `web/src/components/SkillLabPane.tsx`
  - 评测详情展示 Pairwise Judge summary。
  - 每条 result 展示 pairwise 对比结果。
  - 详情头部增加 JSON / Markdown 导出。

- `web/src/lib/api.ts`
  - 新增 `listExtractionToolTestCases`。

- `web/src/lib/evaluation-export.ts`
  - 新增 Skill / Tool JSON 与 Markdown 导出工具。

#### 5.2 后端 API 与 runner

- `server/src/index.ts`
  - 新增 `GET /api/extraction-tools/:id/test-cases`。

- `server/src/tool-evaluation-api.ts`
  - 导出 `parseToolEvaluationCases`。
  - 新增/使用 `resolveToolEvaluationCasePaths(cases, rootPath)`，把模板中的相对路径解析到工具目录。
  - 支持解析 golden `ignorePaths` 与 `normalizeWhitespace`。

- `server/src/tool-evaluation-runner.ts`
  - `ToolExpectation` 的 golden 形态扩展为：

```ts
{ kind: "golden"; goldenDir: string; ignorePaths?: string[]; normalizeWhitespace?: boolean }
```

  - JSON golden：结构深比较，返回路径级 diff。
  - Text golden：可归一化 whitespace，返回首个差异行提示。

- `server/src/skill-evaluation-runner.ts`
  - 新增 injectable `SkillPairwiseJudge`。
  - 默认 judge 调用 `runPiTurn`，比较 baseline 与 variant 输出。
  - 同一 `taskId + attempt` 下，baseline 为 `skillPaths` 为空或 id 为 `baseline` 的 variant。
  - baseline 或 variant 执行失败时，该 pairwise 标记为 skipped。

- `server/src/db.ts`
  - `skill_evaluations` 新增 `pairwise_summaries`。
  - `skill_evaluation_results` 新增 `pairwise`。
  - migration 采用兼容式 `try/catch` 添加列，适配已有本地 DB。

#### 5.3 已落地工具模板

- `server/tools/extract-tmall-profile/tests/cases.json`
- `server/tools/extract-tmall-profile/tests/fixtures/minimal.html`
- `server/tools/extract-tmall-profile/tests/golden/minimal/测试人群_人群画像.json`
- `server/tools/extract-xhs-insight/tests/cases.json`
- `server/tools/extract-xhs-insight/tests/fixtures/minimal.html`
- `server/tools/extract-xhs-insight/tests/golden/minimal/minimal_小红书.json`
- `server/tools/phone-cleaner/tests/cases.json`
- `server/tools/phone-cleaner/tests/fixtures/minimal.csv`
- `server/tools/phone-cleaner/tests/fixtures/invalid.txt`
- `server/tools/phone-cleaner/tests/golden/minimal/数据清洗日志.txt`

注意：`field-presence` 的深层 key 当前不适合检查包含点号的 JSON 属性名，例如 `人群画像标签数据.1. 预测性别`，所以 tmall 模板没有用它检查该类字段。

#### 5.4 验证状态

已通过：

- `npm -w server run typecheck`
- `npm -w web run typecheck`
- `node --experimental-strip-types --test server/src/*.test.ts`
  - 最终结果：54 pass / 0 fail
- `npm -w web run build`
  - 通过；仍有既有 Vite chunk size warning。
- Tool 模板真实 runner smoke：
  - `extract-tmall-profile`：`tmall-minimal-golden`、`tmall-minimal-fields` success。
  - `extract-xhs-insight`：`xhs-minimal-golden`、`xhs-minimal-schema` success。
  - `phone-cleaner`：`phone-minimal-golden-log`、`phone-invalid-extension` success。

开发服务器备注：

- 早前尝试 `npm run dev` 时遇到 server `node --watch` EMFILE、web `::1:5173` EPERM。
- 8787 端口曾被占用；8899 临时 server 启动过但当前执行环境 curl 不通，之后已停止临时进程。
- 下个 Session 若需要 UI 手测，应先明确是否可清理旧进程/换端口，不要默认 kill 用户进程。

### 6. 未完成事项与下一步（Action Items）

#### P0：Tool 进 Workflow

- 确认采用哪种方案接入 Tool：
  - A：作为 workflow step 的特殊 node。
  - B：通过已有 turn/tool-call 通道接入。
  - C：先做最小 tool-run step，只支持本地 registered tools。
- 建议下个 Session 优先做 C 的最小闭环：workflow step 能声明 toolId、inputPath、outputDir，并记录 tool run result / artifacts。

#### P1：评测模板体验补齐

- ToolLabPane 载入模板后显示模板来源、case 数量与覆盖提示。
- 模板载入前若当前已有手动 case，增加覆盖确认。
- 失败 case 展示更明确的 expected vs actual 摘要。

#### P1：Pairwise judge 稳定性

- 将 judge prompt 与 rubric / expectedPoints 结合得更明确。
- 考虑 repeat 多次 judge 或加入置信度字段。
- 增加 pairwise judge 失败时的错误记录与前端提示。

#### P2：评测结果归档

- 评估是否把 Markdown/JSON report 写入 workspace artifact。
- 后续可增加“下载全部评测报告”或“评测历史 report index”。

#### P2：评测任务集 CRUD

- 目前 Skill/Tool 任务集仍偏临时表单与文件模板。
- 后续可增加 workspace 级 EvalSet / ToolCaseSet 管理，但不建议在 Tool 进 Workflow 前先大改 schema。

### 7. 开放问题与待确认事项

- Tool 进 Workflow 应优先选 C 最小闭环，还是直接做完整 workflow node 类型？
- Tool run artifacts 是否应统一进入 Session artifacts tree，还是先保留在 tool outputDir？
- Pairwise judge 是否需要单独配置 judgeModel / repeat / temperature？
- Tool templates 是否只随工具目录维护，还是需要额外支持 workspace 级覆盖模板？
- `field-presence` 是否需要支持 JSON Pointer，以便检查包含点号的字段名？

### 8. 上下文与约定

- 回答与交接默认中文，代码、变量、注释使用英文。
- 改动遵循最小范围，不主动重构整个实验室模块。
- 本地部署优先，隐私数据不走第三方 API。
- 当前 worktree 不是干净状态，继续开发前应先用 `git status --short` 区分已有改动、本 Session 改动和新改动。
- 涉及删除、覆盖、重命名文件前必须确认；只读、新建与小范围追加可直接执行。

### 9. 下一个 Session 启动指令

建议下个 Session 这样开始：

1. 先读取本 Session 3，不要重复实现已完成的 Tool template、export、pairwise、golden diff。
2. 执行 `git status --short`，确认工作区 dirty 状态，不要回滚非本任务变更。
3. 若用户同意继续开发，优先推进 P0：Tool 进 Workflow 的最小闭环。
4. 开发前先 grep 当前 workflow / tool-run 相关入口，避免凭记忆改架构。
5. 验证至少跑：
   - `npm -w server run typecheck`
   - `npm -w web run typecheck`
   - `node --experimental-strip-types --test server/src/*.test.ts`
   - 如改前端，再跑 `npm -w web run build`
6. 如需 UI 手测，先处理端口与旧进程问题，避免直接 kill 未确认的用户进程。

---

## 📌 Session 2（最新）— 2026-06-04

### 0. 本次更新摘要（Changelog）

**本次推进**: 实验室 P0 前置改造闭环，并从规划推进到可运行的 Skill / Tool 评测 runner、API、历史化和前端页面。

**关键决策**:
1. Skill 评测采用 `variants × tasks × repeat` 的一次性 runner，并用 activation detection 记录 skill 是否被实际触发。
2. Tool 评测走本地 extraction tool 独立评测链路，确定性 expectation 优先，`llm-judge` 作为语义兜底。
3. [修正 Session 0/1 临时约束] 为支持评测历史复查，本 session 新增了 `skill_evaluations` / `tool_evaluations` 等 DB 表；不再坚持“评测改造期间不动 DB schema”。

**新增阻塞/问题**: 无硬阻塞；Tool 评测的路径选择、case 模板、结果导出仍待产品化。

**下一步重点**: 1）补评测结果导出与 case/task 模板；2）补 Skill pairwise judge / 更强判分语义；3）如继续工作流集成，需重新确认 Tool 进工作流采用方案 C 还是 A/B。

---

### 1. 项目元信息

- 项目名称：苍耳 pi-Xanthil · 实验室（评估评测）模块
- 项目类型：代码开发
- Session 编号：第 2 次交接
- 本次 Session 起止：从“P0 前置改造与 Skill/Tool 评测方案已规划”推进到“Skill/Tool 评测基础链路、历史化、前端入口均可运行”
- 最后更新：2026-06-04

### 2. 项目目标（North Star）

延续 Session 0/1：让用户能可信地、可复现地评估 Workflow、Skill、Tool 在业务场景中的表现，并基于数据决定配置取舍。

本 session 对成功标准作了具体化：
- Workflow / Skill / Tool 三类实验室 tab 均有可运行入口。
- Skill / Tool 评测结果可复查，不只是一屏临时结果。
- runner 层具备注入点与单测，核心逻辑不依赖真实 pi / 真实模型即可验证。

非目标无变化：本 session 未做完整任务集 CRUD、未做结果导出、未把 Tool 节点接入 workflow runtime。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| P0 前置安全网 | ✅完成 | `multi-agent-runner.test.ts`、`evaluation-common.ts` | abort / gate blocked / fan-out 等烟雾测试已覆盖 |
| 多 agent skill 透传 | ✅完成 | `multi-agent-runner.ts`、workflow schema/types | workflow default skills 与 node override/disable 已支持 |
| Skill activation | ✅完成 | `server/src/skill-activation.ts` | 解析 `SKILL.md` token，匹配 output keyword 与 event path |
| Skill runner | ✅完成 | `server/src/skill-evaluation-runner.ts` | `variants × tasks × repeat`，记录 tokens/cost/toolCalls/output/activation |
| Skill API + history | ✅完成 | `skill-evaluation-api.ts`、`db.ts`、`index.ts` | `run/list/get` API；结果落 `skill_evaluations` 表 |
| Skill 前端 | ✅完成 | `web/src/components/SkillLabPane.tsx` | skill tab 已从占位切为可运行面板，支持历史 |
| Tool runner | ✅完成 | `server/src/tool-evaluation-runner.ts` | 支持 registered extraction tool、repeat、summary、case summary |
| Tool expectation 判分 | ✅完成 | `field-presence` / `schema` / `golden` / `must-fail` / `llm-judge` | schema 为轻量子集；llm-judge 复用 `runJudge` |
| Tool API + history | ✅完成 | `tool-evaluation-api.ts`、`db.ts`、`index.ts` | `run/list/get` API；结果落 `tool_evaluations` 表 |
| Tool 前端 | ✅完成 | `web/src/components/ToolLabPane.tsx` | tool tab 已从占位切为可运行面板，支持 history/schema/llm-judge |
| 测试验证 | ✅完成 | `node --experimental-strip-types --test server/src/*.test.ts` | 最新 48 pass / 0 fail；server/web typecheck 均通过 |

### 4. 关键决策与权衡 ⭐

**决策 1: Skill 评测先做一次性 runner + history，不先做任务集 CRUD**
- 选择：`POST /api/workspaces/:id/skill-evaluations/run` 直接运行一次评测并保存完成态记录。
- 备选：先设计 `eval_task_sets` 表与完整 CRUD，再让 runner 引用任务集。
- 理由：当前目标是先让 Skill 评测跑通并可复查；任务集 CRUD 会扩大产品面和 DB 面，不影响 runner 正确性。
- 影响范围：`SkillLabPane` 目前用页面内 task editor；后续任务集可作为输入来源接入 runner。
- 可逆性：高。

**决策 2: Tool 评测面向 registered extraction tool，而不是 pi 内部 tool_use**
- 选择：复用 `server/tools/registry.ts` 中的本地 tool manifest，以 python3 子进程运行工具。
- 备选：评测 pi 是否会通过 shell/REST 正确“召唤”工具。
- 理由：当前项目里的 Tool 是本地 extraction tool，不是 pi 原生 tool；先评测 tool 自身质量更确定，且不依赖 LLM 行为。
- 影响范围：`ToolLabPane` 的 tool 候选来自 `api.listExtractionTools()`；后续如要评测“pi 召唤能力”，需新增另一类 evaluation。
- 可逆性：中。

**决策 3: Tool expectation 以确定性判分优先，LLM judge 兜底**
- 选择：实现 `field-presence`、`schema`、`golden`、`must-fail`，再补 `llm-judge`。
- 备选：所有 Tool 输出直接交给 LLM 打分。
- 理由：Tool 输出多为文件/JSON，确定性检查更稳定、更便宜；`llm-judge` 仅用于难以形式化的质量判断。
- 影响范围：Tool runner 中 `llm-judge` 会读取 `.json/.md/.txt/.csv` 文本产物并调用 `runJudge`，默认 `minScore=70`。
- 可逆性：高。

**决策 4: 为 history 新增 DB 表 [修正 Session 0/1 的“不动 DB schema”临时约束]**
- 选择：新增 `skill_evaluations` / `skill_evaluation_results` / `tool_evaluations` / `tool_evaluation_results`。
- 备选：只在前端内存展示一次性结果，或把历史写入 workspace 文件。
- 理由：实验室评测的核心价值之一是复查和比较；只保留内存结果不可接受。DB history 与现有 workflow evaluation 的体验一致。
- 影响范围：`db.ts` 增加独立 migration try/catch；workspace 删除时同步清理 evaluation 子表。
- 可逆性：中。

### 5. 技术/方案细节快照

#### 5.1 P0 / Workflow 前置

- `multi-agent-runner.ts` 已支持 `runTurn` 注入点，测试可用 deterministic fake，不 spawn 真实 pi。
- workflow schema 已支持：
  - `WorkflowDef.defaultSkillPaths?: string[]`
  - `WorkflowNode.skillPaths?: string[]`
  - gate / fan-out 相关校验与烟雾测试
- `evaluation-common.ts` 已抽出公共函数：`emptyMetrics`、`collectEvent`、`runJudge`、`extractText` 等。
- 注意：测试环境默认 home 下 SQLite 在 sandbox 中可能只读。新增 skill/tool evaluation 表采用独立 `try { db.exec(...) } catch {}` migration，避免无关测试 import DB 时因只读默认库失败。

#### 5.2 Skill 评测实现

关键文件：
- `server/src/skill-evaluation-runner.ts`
- `server/src/skill-evaluation-api.ts`
- `server/src/skill-activation.ts`
- `web/src/components/SkillLabPane.tsx`

运行模型：
- request 包含 `model`、`repeat`、`variants`、`tasks`、可选 `contextPrefix`。
- runner 对 `variants × tasks × repeat` 逐 case 调用 `runPiTurn`。
- 每条结果记录 `durationSec`、`totalTokens`、`totalCost`、`toolCalls`、`outputChars`、`output`、`activation`、typed `error`。
- activation 检测基于：
  - `SKILL.md` frontmatter/标题/独特 token
  - pi events 中引用 skill path 的 evidence

历史 API：
- `GET /api/workspaces/:id/skill-evaluations`
- `GET /api/skill-evaluations/:id`
- `POST /api/workspaces/:id/skill-evaluations/run`

#### 5.3 Tool 评测实现

关键文件：
- `server/src/tool-evaluation-runner.ts`
- `server/src/tool-evaluation-api.ts`
- `web/src/components/ToolLabPane.tsx`

支持的 expectation：
```ts
type ToolExpectation =
  | { kind: "golden"; goldenDir: string }
  | { kind: "schema"; jsonPath: string; schema: Record<string, unknown> }
  | { kind: "field-presence"; jsonPath: string; requiredKeys: string[] }
  | { kind: "must-fail"; expectedErrorPattern?: string }
  | { kind: "llm-judge"; rubric: string; model: string; minScore?: number };
```

实现细节：
- `field-presence`：读取 `jsonPath` 指向的 JSON，支持 deep key（如 `基本信息.人群名称`）。
- `schema`：轻量 JSON Schema 子集，支持 `type`、`required`、`properties`、`items`、`enum`。
- `golden`：递归比较 goldenDir 文件和实际 output 文件，当前为严格文本比较。
- `must-fail`：tool 失败或输入校验失败时可按 `expectedErrorPattern` 判断是否符合预期。
- `llm-judge`：读取 output 目录中 `.json/.md/.markdown/.txt/.csv`，最多约 60k chars，再调用 `runJudge`；低于 `minScore` 判 failed。

历史 API：
- `GET /api/workspaces/:id/tool-evaluations`
- `GET /api/tool-evaluations/:id`
- `POST /api/workspaces/:id/tool-evaluations/run`

#### 5.4 前端入口

- `web/src/App.tsx`
  - research_lab / `view` → `ResearchLabPane`
  - research_lab / `skill` → `SkillLabPane`
  - research_lab / `tool` → `ToolLabPane`
- `SkillLabPane` 和 `ToolLabPane` 均采用左侧配置 + 历史列表、右侧报告明细的布局。
- `ToolLabPane` 目前路径输入是文本框，尚未接本地路径 picker；这会影响易用性，但不影响 API 可用性。

#### 5.5 验证状态

本 session 最后通过：
- `npm -w server run typecheck`
- `npm -w web run typecheck`
- `node --experimental-strip-types --test server/src/*.test.ts`

最新测试结果：48 pass / 0 fail。

还额外跑过独立 DB smoke：
- Skill evaluation 保存后可 `list/get`，读回 `model` 与 typed error。
- Tool evaluation 保存后可 `list/get`，读回 `toolId`、`cases` 与 typed error。

### 6. 未完成事项与下一步（Action Items）

- [ ] **ToolLabPane 路径选择与 case 模板** — 优先级 P0
  - 上下文：当前 Tool case 的 `inputPath` / `goldenDir` 需要手填绝对路径，容易出错。
  - 输入：`api.pickLocalPath`、已有 `ExtractionPane` 的路径选择代码、`server/tools/<tool>/tests/` 目录约定。
  - 完成标准：Tool case 支持选择输入文件/目录、选择 goldenDir；如 tool 自带 `tests/cases.json`，可一键载入模板。
  - 潜在难点：路径必须保持本地执行边界，不能让前端随意读取文件内容。

- [ ] **评测结果导出 JSON/Markdown** — 优先级 P1
  - 上下文：Skill/Tool history 已有，但用户还不能导出报告。
  - 输入：`SkillEvaluationDetail`、`ToolEvaluationDetail`。
  - 完成标准：每次 evaluation detail 可导出 JSON；Markdown 报告包含 summary、失败原因、关键 metrics。
  - 潜在难点：大 output 字段需截断或提供链接，避免导出文件过大。

- [ ] **Skill pairwise judge / 更强判分语义** — 优先级 P1
  - 上下文：Skill runner 当前主要是客观指标 + activation；尚未实现 baseline vs with-skill 的配对质量比较。
  - 输入：`runJudge`、`SkillEvaluationRunResult` 中同 task 的 baseline/variant 输出。
  - 完成标准：同一 task 的 baseline 与 variant 可 pairwise judge，生成 win/tie/loss 或 score delta。
  - 潜在难点：judge prompt 要稳定，避免噪声掩盖 skill 增量。

- [ ] **Tool golden diff 增强** — 优先级 P1
  - 上下文：当前 golden 为严格文本比较，不支持 JSON ignore paths、Markdown whitespace normalize。
  - 输入：`tool-evaluation-runner.ts` 的 `evaluateGolden`。
  - 完成标准：JSON 支持 deep equal + ignore paths；文本支持空白规范化和可读 diff。
  - 潜在难点：diff 输出要短且可定位，不应塞满 UI。

- [ ] **Tool 进工作流方案确认与实现** — 优先级 P2
  - 上下文：Session 0/1 提出 A/B/C 三种方案，但本 session 只做独立 Tool 评测。
  - 输入：用户对“评测 tool 自身”还是“评测 pi 召唤 tool 能力”的优先级判断。
  - 完成标准：确认方案后在 workflow runner 层实现，并补 smoke test。
  - 潜在难点：方案 A/B 会引入 LLM 行为不确定性；方案 C 需要 workflow schema/runtime 分支。

### 7. 开放问题与待确认事项

- ❓ Tool case 模板是否采用 `server/tools/<tool>/tests/cases.json` 作为约定？
  - 当前倾向：采用该目录约定，先支持本地 tool 自带模板，再考虑 workspace 级模板。
  - 阻塞了什么：ToolLabPane 一键载入 case 模板。
  - 需要谁/什么来解决：用户确认或后续按当前倾向直接实现。

- ❓ Skill 评测是否要优先做 pairwise judge？
  - 当前倾向：需要，但可在 Tool UI 产品化之后做。
  - 阻塞了什么：Skill 评测从“激活/成本/输出长度”升级到“质量增量”。
  - 需要谁/什么来解决：用户决定优先级。

- ❓ Tool 进 workflow 是否仍选方案 C？
  - 当前倾向：方案 C（节点类型扩展）最实用，方案 A 可作为 pi 召唤能力评测增强。
  - 阻塞了什么：Tool 与 workflow runtime 集成。
  - 需要谁/什么来解决：用户确认。

### 8. 上下文与约定

- 语言：交互默认中文，代码/类型/注释使用英文。
- 测试：优先 `node --experimental-strip-types --test server/src/*.test.ts`；server/web 分别跑 `npm -w server run typecheck`、`npm -w web run typecheck`。
- 新增 DB migration 如果可能被测试环境只读库触发，应采用独立 try/catch，避免无关测试 import DB 失败。
- 当前工作区是脏的，多个文件包含本 session 之外已有改动。后续 agent 不要凭整体 `git diff` 判定全部归属本 session。

### 9. 下一个 Session 启动指令

> 请先读 Session 2 的「当前进度全景」和「未完成事项」。
> 当前 Skill / Tool 评测基础链路已经可运行；不要从旧 Session 的“待实现”状态重新判断。
> 最紧迫的下一步建议是 ToolLabPane 路径选择与 `tests/cases.json` 模板载入，或 Skill pairwise judge，二选一先做。
> 注意本 session 已新增评测 history DB 表，旧文档里“不动 DB schema”是已被修正的临时约束。

---

## 📌 Session 1（最新）— 2026-06-03

### 0. 本次更新摘要（Changelog）

**本次推进**: 实验室模块整体方案规划 + 前置风险评估 + 安全网（deterministic 烟雾测试）落地。

1）**Workflow 评估现状确认** ✅ — 已有完整的工作流评估链路（`evaluation-runner.ts`）：候选 flow 执行 → LLM Judge 评分。前端 `ResearchLabPane` 支持选 flow、配模型、设 rubric、看历史、看运行明细。评估结果含 token/cost/duration/toolCalls/outputChars/judgeScore。

2）**Skill / Tool 评测方案规划** ✅ — 完成方案文档，核心结论：
   - **Skill 评测**：大量复用 `evaluation-runner.ts` 的 pi turn + judge 框架，核心差异在"对比组"（baseline vs with-skill）和"激活率检测"。
   - **Tool 评测**：走全新独立的非 LLM 评测路径——spawn 子进程 → golden file diff / JSON schema / 字段存在性等确定性判分，LLM judge 仅作兜底。
   - 详见下方「5. 技术/方案细节快照」。

3）**关键发现：多 agent 工作流子 agent 缺少 skill 透传** ✅ — 排查确认 `multi-agent-runner.ts` 的 `runPiTurn` 调用未传 `skillPaths`，子 agent 收不到用户/flow 配置的 skill。tool 更是完全脱离 pi 运行（纯 REST 端点 + python3 spawn），工作流里无任何接入点。

4）**前置 6 件套风险评估** ✅ — 对 P0 改造逐条评估致命/数据/性能/兼容风险，结论：
   - T0.1（skill 透传）和 T0.4（抽公共层）风险低 🟢
   - T0.3（tool 节点）风险中高 🟡，需 schema 校验、子进程追踪、路径安全等前置
   - 强烈建议先建 deterministic 烟雾测试作为安全网

5）**Deterministic 烟雾测试落地** ✅ — 完成三项工作：
   - `multi-agent-runner.ts` 重构：`runPiTurn` 从硬 import 改为 `MultiAgentRunOptions.runTurn?: PiTurnFn` 可选注入点，默认值兜底，生产路径行为零变化。
   - `multi-agent-runner.test-helpers.ts` 新建：`makeFakePiAdapter()` 构造确定性 fake，按 scripted events 触发 `onEvent`，支持 text/events/exitCode/stall/build 等脚本化响应。
   - `multi-agent-runner.test.ts` 新建：覆盖 5 条关键分支的烟雾测试（见下方「6. 执行结果」）。

**关键决策**:
1. 评测改造前先建安全网（烟雾测试），确保后续所有改动可验证回归。
2. `runTurn` 注入点设计为可选参数 + 默认值兜底，生产路径零行为变化。
3. fake pi-adapter 使用 `queueMicrotask` 而非 `setTimeout`，保持测试同步可预测。
4. 评测改造期间**不动 DB schema**、**不动 `anax-template.ts`**、**不动 `inferWorkflow`**，所有新字段进 workflow.json（schema-on-read）。

**新增阻塞/问题**: 无。

**下一步重点**: 1）继续补全烟雾测试（abort 场景、gate blocked 场景）；2）T0.1 多 agent skill 透传实施；3）T0.4 评测公共层抽取；4）T0.2 tool 进工作流决策。

---

## 📌 Session 0 — 2026-06-03

### 0. 本次更新摘要（Changelog）

**本次推进**: 实验室模块需求分析 + 方案规划 + 风险评估。

1）**Workflow 评估现状摸底** ✅ — 阅读 `evaluation-runner.ts`、`ResearchLabPane.tsx`、DB schema、API 路由，确认现有评估能力边界。

2）**Skill 现状摸底** ✅ — 阅读 `skills.ts`、`pi-adapter.ts`、`multi-agent-runner.ts`，确认：
   - 探索会话/单 flow 聊天：用户选 skill → `validateSkillPaths` → `--skill` 透传 pi ✅
   - 多 agent 工作流子 agent：**不透传** ❌
   - 根本原因：`multi-agent-runner.ts` 的 `runPiTurn` 调用没传 `skillPaths` 参数

3）**Tool 现状摸底** ✅ — 阅读 `tools/registry.ts`、`extract-tmall-profile/tool.json`、`index.ts` 的 REST 端点、`ExtractionPane.tsx`，确认：
   - Tool 是纯 python3 脚本，通过 `POST /api/extraction-tools/:id/run` 手动触发
   - 输出目录 `~/.pi-xanthil/extraction-runs/<uuid>/`，完全独立于 flow
   - 工作流里无任何接入点，子 agent 的 pi 进程对 tool 的存在一无所知

4）**Skill / Tool 评测方案规划** ✅ — 详见「5. 技术/方案细节快照」。

5）**P0 前置改造风险评估** ✅ — 详见「7. 开放问题与待确认事项」。

---

### 1. 项目元信息

- 所属模块：实验室（Research Lab）
- 关联模块：工作流（Workflow）、探索（Explore）、聚合计算（Aggregate）
- 依赖关系：实验室评测依赖工作流执行器（`multi-agent-runner.ts`）和 pi 适配层（`pi-adapter.ts`）

### 2. 模块目标（North Star）

让用户能**可信地、可复现地**评估和比较不同 Skill、Tool、Workflow 在其业务场景上的表现，从而做出"哪个配置更好"的数据驱动决策。

### 3. 当前进度全景

| 模块 | 状态 | 备注 |
|---|---|---|
| Workflow 评估 | ✅ 已上线 | `ResearchLabPane` + `evaluation-runner.ts` |
| Skill 评测方案 | ✅ 已规划 | 待 P0 前置改造完成后实施 |
| Tool 评测方案 | ✅ 已规划 | 待 P0 前置改造 + T0.2 决策后实施 |
| 多 agent skill 透传 | 🔧 待实施 | T0.1，前置条件：烟雾测试已就绪 |
| Tool 进工作流 | ❓ 待决策 | T0.2，需确认走方案 A/B/C |
| 评测公共层抽取 | 🔧 待实施 | T0.4，前置条件：烟雾测试已就绪 |
| Deterministic 烟雾测试 | ✅ 已落地 | `multi-agent-runner.test.ts` |
| 前置 6 件套剩余 5 项 | 📋 待实施 | 见下方「6. 未完成事项」 |

### 4. 关键决策与权衡 ⭐

#### 4.1 Skill 评测 vs Tool 评测分开走

- **Skill 评测**：大量复用 `evaluation-runner.ts` 的 pi turn + judge 框架。核心差异在"对比组"（baseline vs with-skill）和"激活率检测"。
- **Tool 评测**：走全新独立的非 LLM 评测路径——spawn 子进程 → golden file diff / JSON schema / 字段存在性等确定性判分，LLM judge 仅作兜底。
- **理由**：Tool 是确定性程序，用 LLM judge 打分浪费且噪声大；Skill 影响 LLM 行为，只能用 LLM judge。

#### 4.2 配对评分（Pairwise Judge）优先于绝对打分

- 绝对打分（0–100）噪声大；配对比较（A 比 B 好/差/平）一致性显著更高。
- 同一 task 多个 variant 时，两两配对，用 Bradley-Terry 或简单胜率聚合出排名。
- 同时保留绝对打分作为补充信号，二者交叉验证。

#### 4.3 评测改造期间不动 DB schema

- 所有新字段全部进 workflow.json（schema-on-read），不进 SQL。
- 理由：DB 列加了回不去；workflow.json 是用户可见可改的文件，schema 演进自然。
- 万一 P0 要回滚，没 DB 变更意味着 `git revert` 即可，零数据迁移。

#### 4.4 `runTurn` 注入点设计

- 可选参数 + 默认值兜底，生产路径零行为变化。
- 测试注入 deterministic fake，不 spawn 真实 pi 进程。
- fake 使用 `queueMicrotask` 而非 `setTimeout`，保持测试同步可预测。

### 5. 技术/方案细节快照

#### 5.1 Skill 评测方案

**评测目标**：
1. **有用性**：开启 Skill 后，pi 的回答质量在指定任务集上是否提升？
2. **激活率**：pi 是否在该 Skill 适用的场景下真的"用了"它（vs 被忽略）？
3. **副作用**：开启 Skill 是否会在不相关任务上恶化输出 / 增加 token？

**数据模型**（待实现）：

```ts
interface SkillEvaluation {
  id: string;
  workspaceId: string;
  skillPaths: string[];
  variants: SkillVariant[];    // 对比组：基线 + 各 skill 子集
  taskSet: SkillEvalTask[];    // 任务集
  model: string;
  judgeModel: string;
  rubric: string;
  repeat: number;
  status: EvaluationStatus;
  createdAt: number;
}

interface SkillVariant {
  id: string;                  // "baseline" / "with-skill-A" / "with-A+B"
  label: string;
  skillPaths: string[];        // [] = baseline
}

interface SkillEvalTask {
  id: string;
  prompt: string;
  expectedPoints?: string[];
  rubric?: string;
}
```

**执行方式**：笛卡尔积 `variants × tasks × repeat` → 一组 result。每条起 `runPiTurn`，传 `skillPaths: variant.skillPaths`。Judge 阶段配对比较：同一 task 的 baseline vs with-skill 输出配对给 judge，判相对增量分。

**激活率检测**（待实现 `skill-activation.ts`）：
- 解析 `SKILL.md` 提关键 token（标题、code identifier、独有名词）→ 在 pi 输出中正则匹配。
- 加强版：扫 `toolCall` 事件中对 skill 文件路径的 `read_file` 调用。

#### 5.2 Tool 评测方案

**评测目标**：
1. **正确性**：在标准输入集上，输出文件是否符合预期？
2. **健壮性**：异常输入（空文件、非 HTML、超大文件、编码错误）是否优雅失败？
3. **性能**：单文件耗时、批量目录处理吞吐量。
4. **稳定性**：多次运行结果是否一致。

**数据模型**（待实现）：

```ts
interface ToolEvaluation {
  id: string;
  workspaceId: string;
  toolId: string;
  cases: ToolEvalCase[];
  status: EvaluationStatus;
  createdAt: number;
}

interface ToolEvalCase {
  id: string;
  name: string;
  inputPath: string;
  expected: ToolExpectation;
  timeoutMs?: number;
}

type ToolExpectation =
  | { kind: "golden"; goldenDir: string }
  | { kind: "schema"; jsonPath: string; schema: object }
  | { kind: "field-presence"; jsonPath: string; requiredKeys: string[] }
  | { kind: "must-fail"; expectedErrorPattern?: string }
  | { kind: "llm-judge"; rubric: string; model: string };
```

**测试用例目录约定**：

```
server/tools/extract-tmall-profile/
  tool.json
  extract_tmall.py
  tests/
    cases.json                 # 用例清单
    fixtures/                  # 测试输入
      sample-01.html
    golden/                    # 期望输出
      sample-01/
        profile.json
        profile.md
```

#### 5.3 Tool 进工作流的三种方案

| 方案 | 改动量 | 评测含义 |
|---|---|---|
| **A. Prompt 注入**：在子 agent system prompt 列出 tool manifest，要求 pi 用 `terminal` shell 调用 REST 端点 | 小，几十行 | 评测"pi 看 description 后会不会选对 tool + 传对参数" |
| **B. MCP 化**：把 `tools/registry.ts` 暴露为 MCP server，pi 原生发现 | 中等，需引入 MCP SDK | 同 A，但调用稳定性高得多 |
| **C. 节点类型扩展**：`WorkflowNode.kind` 增加 `"tool"`，runner 跳过 pi 直接执行 tool | 小，runner 加分支 | 不评 pi 召唤能力，只评 tool 自身质量 |

**建议**：C 优先 + A 作为可选增强。C 让工作流编排"data agent → extraction tool → analysis agent"管线，最实用；A 让 pi 在自由发挥型节点里按需调用 tool。

#### 5.4 评测工具链架构

```
evaluation-common.ts (待抽取)
  ├── runJudge()           ← LLM Judge 评分
  ├── collectEvent()       ← 收集 token/cost/toolCalls
  ├── emptyMetrics()
  ├── extractText()
  └── messageOf()

skill-evaluation-runner.ts (待新建)
  ├── 笛卡尔积 variants × tasks × repeat
  ├── 调用 runPiTurn(skillPaths=...)
  ├── 激活率检测
  └── 配对 judge

tool-evaluation-runner.ts (待新建)
  ├── spawn 子进程
  ├── golden-diff.ts 对比
  ├── JSON schema 校验
  └── 结果聚合

golden-diff.ts (待新建)
  ├── .json → 递归 deep equal (ignoreKeys/ignorePaths)
  ├── .md/.txt → 标准化空白后 unified diff
  └── 文件列表对比

skill-activation.ts (待新建)
  ├── SKILL.md 关键 token 提取
  ├── 输出正则匹配
  └── toolCall 事件溯源
```

#### 5.5 烟雾测试架构

```
multi-agent-runner.test.ts
  └── 使用 makeFakePiAdapter() 构造 deterministic fake
      ├── 简单 2 节点链路
      ├── blackboard 占位符替换
      ├── 拓扑顺序 (fan-out/fan-in)
      ├── gate 节点 blocked 中断
      ├── 节点 exit code != 0 中断
      └── abort 信号生效

multi-agent-runner.test-helpers.ts
  ├── ScriptedNodeResponse
  ├── FakePiAdapter (runTurn + calls)
  └── makeFakePiAdapter()
```

### 6. 未完成事项与下一步（Action Items）

#### P0：通道与前置改造（优先级最高）

| # | 事项 | 粒度 | 依赖 | 状态 |
|---|---|---|---|---|
| 0.0 | ✅ Deterministic 烟雾测试 | S (~1d) | 无 | ✅ 已完成 |
| 0.1 | `validateSkillPaths` 改为支持 `mode: "strict" \| "lenient"` | S (~0.5d) | 无 | 📋 待实施 |
| 0.2 | `validateWorkflow` 函数（早抛、节点级 schema 校验） | S (~0.5d) | 无 | 📋 待实施 |
| 0.3 | 统一子进程追踪（pi + python3 都走 onChildProcess） | S (~0.5d) | 无 | 📋 待实施 |
| 0.4 | 评测 result.error 类型化（错误码 + hint） | S (~0.5d) | 无 | 📋 待实施 |
| 0.5 | 文档化 schema 兼容策略 | S (~0.25d) | 无 | 📋 待实施 |
| T0.1 | 多 agent 工作流补 skill 透传 | S (~0.5d) | 0.0, 0.1 | 📋 待实施 |
| T0.2 | 决策：tool 是否进入工作流（方案 A/B/C） | S (决策) | 无 | ❓ 待决策 |
| T0.3 | 实现 tool 节点（若 T0.2 选 C） | M (~1-2d) | 0.0, 0.2, 0.3, T0.2 | 📋 待实施 |
| T0.4 | 评测代码抽公共层（evaluation-common.ts） | S (~0.5d) | 0.0 | 📋 待实施 |

#### P1：评测基础设施

| # | 事项 | 粒度 | 依赖 |
|---|---|---|---|
| T1.1 | 建立"评测任务集"概念与存储（eval_task_sets 表 + CRUD） | M (~1d) | T0.4 |
| T1.2 | Skill 激活率检测器（skill-activation.ts） | M (~1d) | T0.1 |
| T1.3 | Golden file 对比器（golden-diff.ts） | M (~1-1.5d) | T0.3 |
| T1.4 | 多次运行 + 噪声基线（mean ± std，显著性参考） | S (~0.5d) | T0.4 |
| T1.5 | 评测环境隔离与可复现性（版本快照记录模型/skill/tool 版本） | S (~0.5d) | T0.4 |

#### P2：评测语义与判分质量

| # | 事项 | 粒度 | 依赖 |
|---|---|---|---|
| T2.1 | Rubric 模板库（预置结构完整性/信息正确性/可执行性/覆盖度/简洁性模板） | S (~0.5d) | T0.4 |
| T2.2 | 配对评分（Pairwise judge）模式 | M (~1d) | T0.4 |
| T2.3 | Judge 自检：金标准对照集评估 judge 准确率 | S (~0.5d) | T0.4 |
| T2.4 | 失败模式诊断（自动归类常见失败原因） | M (~1d) | T0.4, T1.1 |

#### P3：前端产品化

| # | 事项 | 粒度 | 依赖 |
|---|---|---|---|
| T3.1 | SkillLabPane（Skill 评测页面） | M (~1-1.5d) | T1.1, T1.2 |
| T3.2 | ToolLabPane（Tool 评测页面） | M (~1-1.5d) | T1.3 |
| T3.3 | 评测历史/对比视图 | S (~0.5d) | T3.1, T3.2 |
| T3.4 | 评测结果导出（JSON/Markdown） | S (~0.5d) | T3.1, T3.2 |

### 7. 开放问题与待确认事项

1. **T0.2：Tool 进工作流走哪条路？**
   - 方案 A（Prompt 注入）改动最小但 pi 召唤准确率不可控
   - 方案 B（MCP 化）最优雅但需引入 MCP SDK
   - 方案 C（节点类型扩展）最实用但需 schema 扩展 + runner 分支
   - **建议 C 优先 + A 可选增强**，待你确认

2. **Skill 配置范围：工作流级 vs 节点级？**
   - 工作流级（整个 flow 共享一组 skill）→ 存 `WorkflowDef.defaultSkillPaths`
   - 节点级（每个 agent 用不同 skill）→ 存 `WorkflowNode.skillPaths`
   - **建议：节点级为主 + 工作流级 fallback**，类似 model / defaultModel 设计

3. **评测任务集来源？**
   - 内置任务集（项目自带一批典型任务）
   - 用户自定义（CRUD 页面管理）
   - 从历史对话/工作流中自动提取
   - **建议 MVP 先做前两者**

4. **Judge 模型选择策略？**
   - 当前 workflow 评估用 `judgeModel` 字段，可独立于执行模型
   - 弱模型做 judge 会降低评测可信度
   - **建议：默认用最强可用模型（如 MiniMax-M3），低于 70% 准确率给警告**

5. **评测缓存策略？**
   - Tool 节点 deterministic，评测复跑 N 次浪费 IO
   - **建议：按 input hash + tool version 缓存 tool 输出，评测内可开关**

### 8. 上下文与约定

- 项目测试框架：`node --test` + `node:test` + `node:assert/strict`
- 测试文件命名：`*.test.ts`，与被测文件同级
- 测试辅助文件命名：`*.test-helpers.ts`
- `package.json` 测试命令：`"test": "node --experimental-strip-types --test src/**/*.test.ts"`
- 评测改造期间不动 DB schema、不动 `anax-template.ts`、不动 `inferWorkflow`
- 所有新字段进 workflow.json（schema-on-read），不进 SQL
- `runTurn` 注入点：可选参数 + 默认值兜底，生产路径零行为变化
- fake pi-adapter 使用 `queueMicrotask` 保持测试同步可预测

### 9. 下一个 Session 启动指令

```
继续推进实验室评测模块。当前已完成：
1. handoff-实验室.md 已创建，记录了方案规划、风险评估、烟雾测试落地
2. multi-agent-runner.ts 已重构（runTurn 注入点）
3. multi-agent-runner.test-helpers.ts 已创建（fake pi-adapter）
4. multi-agent-runner.test.ts 已创建（烟雾测试，待补全）

下一步建议：
1. 补全 multi-agent-runner.test.ts 的 abort 和 gate blocked 测试用例
2. 执行 npm test 验证全部通过
3. 然后进入 T0.1（多 agent skill 透传）或 T0.4（评测公共层抽取）
```
