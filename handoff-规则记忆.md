# Handoff Log — pi-xanthil / 规则记忆模块

---

## 📌 Session 4 (最新) — 2026-06-05

### 0. 本次更新摘要

**本次推进**: 完成三项任务——① 实测验证 AI 语义提取效果（质量良好）；② 确认 trace 规则去重早已落地（handoff 文档标注有误）；③ 实现 AI 提取结果持久化（跳过未变更报告）；④ 实现 trace_events 清理策略（API + 启动自动清理 + UI 按钮）。  
**关键决策**:
1. AI 提取跳过逻辑用 `ai_extracted_hash` 专属列（仿照 `hidden` 列的设计），不用 `tags` 字段（sync 会覆盖 tags）
2. trace events 清理采用三层机制：启动自动清理 90 天前、API 手动触发、UI 按钮（含天数选择）

**新增阻塞/问题**: 无。  
**下一步重点**: 用户已接受从 harness 工程视角继续增强规则记忆模块；原有存储/注入功能已完成，下一阶段转入记忆质量闭环、可观测、评估、guardrails 与动态 context selection。

---

### 1. 项目元信息

```
项目名称: pi-xanthil / 规则记忆模块
项目类型: 代码开发
Session 编号: 第 4 次交接
本次 Session 起止: 从「Session 3 遗留三项任务」推进到「规则记忆模块全部任务清零」
最后更新: 2026-06-05
```

### 2. 项目目标（North Star）

延续 Session 3，无变化。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| token 统计看板 | ✅ 完成 | `TokenStatsPane.tsx` | |
| trace 看板 | ✅ 完成 | `TracePane.tsx` | |
| rules tab（含编辑/删除） | ✅ 完成 | `RulesPane.tsx` | |
| 指标体系 tab | ✅ 完成 | `IndicatorsPane.tsx` | |
| 业务环境 tab | ✅ 完成 | `BusinessContextPane.tsx` | |
| 记忆注入五源 | ✅ 完成 | `buildMemoryPrompt()` in `index.ts` | biz_ctx → rules → standards → cases → KG |
| 知识图谱 Phase A | ✅ 完成 | `KnowledgeGraphPane.tsx` | |
| 知识图谱 Phase B（AI 提取） | ✅ 完成 | `knowledge-graph.ts` | 实测验证质量良好 |
| 分析案例库 tab | ✅ 完成 | `CasesPane.tsx` + `analysis_cases` 表 | |
| trace 规则去重 | ✅ 完成 | `db.ts createRuleMemory()` | 早已落地，本次确认 |
| **AI 提取跳过未变更报告** | ✅ 完成 | `kg_nodes.ai_extracted_hash` + `knowledge-graph.ts` | 本次新增 |
| **trace_events 清理策略** | ✅ 完成 | `db.ts` + `index.ts` + `TracePane.tsx` | 本次新增 |

**规则记忆模块当前基础功能已完成；新增 harness 工程增强计划已立项，见第 6 节。**

### 4. 关键决策与权衡 ⭐

**决策 1: AI 提取跳过逻辑用专属列 `ai_extracted_hash`，不用 `tags`**
- 选择: 在 `kg_nodes` 加 `ai_extracted_hash TEXT` 列；提取成功后写入 `reportNode.contentHash`；提取前比对，相等则跳过
- 备选: 在 `tags` 中存 `ai_extracted:{hash}` 标记
- 理由: `upsertKgNode`（sync 时调用）会完整覆写 `tags`，导致每次同步后提取标记丢失；专属列与 `hidden` 列完全同构，sync 不触碰，语义清晰
- 影响范围: `KgNode` / `KgExtractResult` 类型扩展；`listKgNodes` 的两个 SELECT 分支均需加列（曾因只改一处导致 bug）
- 可逆性: 高

**决策 2: trace_events 清理采用三层机制**
- 选择: ① 服务启动时 `pruneAllTraceEvents(90)` 自动清理全局 >90 天数据；② `DELETE /api/workspaces/:id/trace/events?retainDays=N` 手动 API；③ TracePane UI 顶部加天数下拉（7/14/30/90）+ "清理旧事件"按钮
- 备选: 仅启动时 prune（无 UI）；或仅 UI 按钮（无自动清理）
- 理由: 启动自动清理处理"长期不手动清理"的场景；API + UI 满足用户主动控制需求；三层互补，任何一层都不依赖另一层
- 影响范围: `db.ts` 新增两个函数；`index.ts` 新增端点 + listen 回调；`api.ts` + `TracePane.tsx`
- 可逆性: 高

### 5. 技术细节快照

#### 新增列（`kg_nodes` 表）
```sql
ALTER TABLE kg_nodes ADD COLUMN ai_extracted_hash TEXT;  -- migration-safe try/catch
```
- `upsertKgNode` 的 UPDATE 语句**不写** `ai_extracted_hash`（同 `hidden`），sync 后跳过状态保留
- `setKgNodeAiExtractedHash(id, hash)` 单独更新该列

#### `listKgNodes` 的两个 SELECT 都必须包含 `ai_extracted_hash AS aiExtractedHash`
- 曾经踩坑：`includeHidden=false` 分支（默认路径）未加该列，导致 `aiExtractedHash` 始终 null，跳过逻辑失效
- 当前两个分支均已修正

#### `extractKgEntitiesFromReports` 跳过逻辑
```typescript
const unprocessed = reportNodes.filter(
  (n) => !n.aiExtractedHash || n.aiExtractedHash !== n.contentHash,
);
const skippedReports = reportNodes.length - unprocessed.length;
const reports = unprocessed.slice(0, MAX_REPORTS_PER_RUN);
// ... 提取成功后：
if (reportNode.contentHash) setKgNodeAiExtractedHash(reportNode.id, reportNode.contentHash);
```
- `KgExtractResult` 新增 `skippedReports: number`
- UI 显示：`处理 N 篇 · 跳过 M 篇（内容未变）`（`skippedReports > 0` 时显示）

#### trace_events 清理函数
```typescript
// db.ts
pruneTraceEvents(workspaceId, retainDays)   // 单 workspace
pruneAllTraceEvents(retainDays)              // 全局（启动时用）
```
- API: `DELETE /api/workspaces/:id/trace/events?retainDays=30` → `{ deleted: N, retainedDays: 30 }`
- 启动回调：`pruneAllTraceEvents(90)`，有删除时 `console.log`
- UI：TracePane 顶部 toolbar，`[select: 7/14/30/90天] [清理旧事件]`，执行后 `writeResult` banner 显示删除数并刷新

#### AI 提取效果验证结果（2026-06-05 实测）
- Workspace：森马会员，4 篇报告（上海环球港商圈研究）
- 第一次提取：20 concept 节点，50 边，处理 4 篇
- 第二次提取（修复 SELECT bug 后）：0 节点，0 边，跳过 4 篇
- 概念质量：上海环球港、217亿销售业绩、三类客群叠加模型、四类首店矩阵等，贴合报告内容

### 6. 未完成事项与下一步

规则记忆模块当前基础功能已完成。用户已接受从 harness 工程视角追加下一阶段开发计划，优先级如下：

#### P0：记忆质量闭环

1. **Memory Injection Trace / 可回放快照**
   - 每次 chat / workflow 运行时记录实际注入的 `rules` / `standards` / `cases` / `biz_ctx` / KG nodes
   - 记录各来源 token 占比、prompt hash、targetScope、运行 id、对应 trace id
   - 目标：让一次 agent run 能回答“哪些记忆被注入、为什么注入、是否影响结果”

2. **Memory Eval Harness**
   - 建立“有记忆 vs 无记忆”“旧策略 vs 新策略”的 A/B eval
   - 指标覆盖：是否采纳正确规则、是否被陈旧规则误导、是否引用无关案例、输出质量、token 成本
   - 优先复用现有 workflow / skill / tool evaluation 基础设施，避免新建独立评估系统

3. **记忆写入 Guardrails + 人工确认队列**
   - trace 自动生成 rule 前增加候选队列：候选规则、证据 trace、置信度、冲突项、批准/拒绝状态
   - 校验并拦截 instruction injection、PII、无证据规则、过宽泛规则
   - 目标：所有高影响 memory write 都有证据和人工确认

#### P1：动态选择与治理

4. **Context Selection Policy Engine**
   - 在固定注入顺序 `biz_ctx → rules → standards → cases → KG` 之上增加选择策略
   - 按 `targetScope`、任务类型、token budget、最近成功案例、KG 相关度选择 Top-K
   - 避免无差别全量注入导致 token 膨胀和上下文污染

5. **记忆使用反馈与衰减机制**
   - 为规则/案例/KG 增加 `lastUsedAt`、`usedCount`、`positiveSignals`、`negativeSignals`、`confidence`、`staleAfterDays`
   - 长期未使用、导致 eval 失败或被标记误导的记忆自动降权，而不是继续默认注入

6. **冲突检测与版本治理**
   - 增加规则版本、`supersedes`、`conflictsWith`、source trace、变更理由
   - 在 UI 中提示同一场景下互相矛盾的规则，避免 agent 同时接收冲突指令

7. **失败归因到记忆层**
   - workflow / chat 出错后支持标记原因：规则缺失、规则错误、案例误导、业务背景过期、KG 提取错误、模型未遵守
   - 标记结果进入 eval dataset 和后续规则候选生成链路

#### P2：审计与体验增强

8. **KG 语义提取质量面板**
   - 展示 AI 提取节点的来源报告、证据片段、置信度、重复/合并建议
   - 支持隐藏、合并、确认，避免 KG 成为不可审计的黑箱记忆

9. **Memory Diff / Prompt Diff**
   - 规则、案例、业务背景或 KG 变化后，展示 memory prompt 相比上次变化了什么
   - 显示 token 增减和可能影响的 workflow

10. **Auditable Episode Package 导出**
   - 导出一次 agent run 的任务、注入记忆、trace、工具调用、输出、人工反馈、eval 结果
   - 目标：形成可审计、可复盘、可进入回归测试的数据包

以下为次低优先级想法（未立项，供未来参考）：
- 知识图谱 force-directed 布局（当前固定聚类中心，D3 力模拟可做但优先级极低）
- 分析案例库 localStorage 历史数据迁移（数量少，手动录入可接受）
- 规则记忆注入效果量化已升级为 P0 `Memory Eval Harness`

### 7. 开放问题与待确认事项

无。本 session 所有遗留问题均已闭环。

### 8. 上下文与约定

无新增约定，延续既有约定：
- `buildMemoryPrompt()` 五源注入：biz_ctx → rules → standards → cases → KG
- `upsertKgNode` 不覆盖 `hidden` 和 `ai_extracted_hash`（两个"只读"列）
- AI 提取使用 `DIRECT_LLM_ROOT`，model 默认 `minimax-cn/MiniMax-M3`，timeout 60s per report
- `MAX_REPORTS_PER_RUN = 5`，每篇截取前 3000 字

### 9. 下一个 Session 启动指令

> 规则记忆模块基础功能已全部完成；用户已接受从 harness 工程视角追加下一阶段开发计划。
> 下一 session 若继续规则记忆模块，优先从 P0 开始：Memory Injection Trace / 可回放快照、Memory Eval Harness、记忆写入 Guardrails + 人工确认队列。
> 开始实现前先确认本轮选择的 P0 子任务和验收标准。
> 注意：`listKgNodes` 的两个 SELECT 分支（`includeHidden=true/false`）都必须包含 `ai_extracted_hash AS aiExtractedHash`，修改时不要遗漏。
> 注意：`upsertKgNode` 的 UPDATE 不写 `hidden` 和 `ai_extracted_hash`，这是故意为之，不要修改。

---

## 📌 Session 3 (最新) — 2026-06-05

### 0. 本次更新摘要

**本次推进**: 完成三项任务——①确认 rules 编辑/删除已在上个 session 落地（handoff 文档标注有误）；②将分析案例库从 localStorage 迁移到 SQLite 后端并接入记忆注入链路；③实现 Phase B AI 语义提取（原生 TypeScript + minimax-cn/MiniMax-M3，无 Python sidecar），新增 `concept` 节点类型。  
**关键决策**:
1. Phase B 放弃 LightRAG Python sidecar，改用项目已有的 `runPiPrompt` 基础设施直接实现语义提取
2. 图存储继续用 SQLite（不引入 Kuzu），维持单一存储引擎
3. 分析案例库数据迁移到后端 SQLite（原 localStorage 方案无法注入 AI 执行链路）

**新增阻塞/问题**: 无阻塞；AI 提取质量待实际运行后评估。  
**下一步重点**: 实际测试知识图谱 AI 提取效果；可考虑补齐 trace 规则去重（P2）。

---

### 1. 项目元信息

```
项目名称: pi-xanthil / 规则记忆模块
项目类型: 代码开发
Session 编号: 第 3 次交接
本次 Session 起止: 从「知识图谱 Phase 1 全功能已上线」推进到「分析案例库后端化 + AI 语义提取上线」
最后更新: 2026-06-05
```

### 2. 项目目标（North Star）

延续 Session 2，无变化。补充本次新增目标：

- **分析案例库**: 案例数据持久化到 SQLite，启用的案例通过 `buildMemoryPrompt()` 注入 AI 执行链路，与 rules/standards/biz_ctx/KG 并列。
- **知识图谱 Phase B**: 从报告 Markdown 文件中 AI 提取核心概念节点和语义关联边，补充 Phase A keyword overlap 推断的精度不足。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| token 统计看板 | ✅ 完成 | `TokenStatsPane.tsx` | |
| trace 看板 | ✅ 完成 | `TracePane.tsx` | |
| rules tab（含编辑/删除） | ✅ 完成 | `RulesPane.tsx` | 编辑/删除在上个 session 已落地，本次确认 |
| 指标体系 tab | ✅ 完成 | `IndicatorsPane.tsx` | |
| 业务环境 tab | ✅ 完成 | `BusinessContextPane.tsx` | |
| 记忆注入五源 | ✅ 完成 | `buildMemoryPrompt()` in `index.ts` | biz_ctx → rules → standards → **cases** → KG |
| 知识图谱 Phase A | ✅ 完成 | `KnowledgeGraphPane.tsx` | 结构化摄入 + keyword 推断边 |
| **知识图谱 Phase B** | ✅ 完成 | `knowledge-graph.ts: extractKgEntitiesFromReports()` | AI 语义提取，新增 concept 节点类型 |
| **分析案例库 tab** | ✅ 完成 | `CasesPane.tsx` + `analysis_cases` 表 | localStorage → SQLite，接入注入链路 |
| trace 规则去重 | ⏳ 待启动 | `db.ts createRuleMemory()` | P2，同 title 跳过插入 |

### 4. 关键决策与权衡 ⭐

**决策 1: Phase B 用原生 TypeScript + runPiPrompt，放弃 LightRAG Python sidecar**
- 选择: 在 `knowledge-graph.ts` 中直接 import `runPiPrompt`，用 `minimax-cn/MiniMax-M3` 做实体提取，结果写入现有 `kg_nodes`/`kg_edges` 表
- 备选: LightRAG Python sidecar（lightrag-hku + kuzu）
- 理由: LightRAG 要求单独配置 minimax HTTP API key（与 pi CLI 调用链不同）；需新建 Python 运行时和 kuzu 图存储，引入双运行时；而 `runPiPrompt` 已有 DIRECT_LLM_ROOT 机制，与 TOC/黄金策略完全相同的调用模式，零新依赖
- 影响范围: knowledge-graph.ts 现在 import pi-adapter.ts（之前是纯 DB 模块），可接受
- 可逆性: 高（未来仍可并行接入 LightRAG，当前实现不冲突）

**决策 2: 图存储继续用 SQLite，不迁移 Kuzu**
- 选择: 保留 `kg_nodes`/`kg_edges` SQLite 表
- 备选: Kuzu 嵌入式图数据库
- 理由: 当前查询模式（list nodes、list edges、build prompt）不需要图原生能力；Kuzu 为第二存储引擎会增加维护复杂度；Phase A 已验证 SQLite 够用
- 可逆性: 高

**决策 3: 分析案例库数据迁移到后端 SQLite**
- 选择: 新建 `analysis_cases` 表，完整 CRUD API，`buildEnabledCasesPrompt()` 接入 `buildMemoryPrompt()`
- 备选: 保留 localStorage（零后端改动）
- 理由: localStorage 数据在客户端，无法在服务器端注入 AI 执行链路；与其他四类记忆数据（rules/standards/biz_ctx/KG）不一致；跨设备不同步
- 影响范围: 原 CasesPane 的 localStorage 数据需手动录入（无自动迁移脚本，数量通常较少）
- 可逆性: 高

**决策 4: AI 提取新增 `concept` 节点类型（第 6 类）**
- 选择: 新增 `KgNodeType = "concept"` 表示 AI 提取的语义概念节点
- 备选: 复用 `report` 或其他现有类型
- 理由: concept 节点来源和语义与其他 5 类完全不同（AI 抽象出的概念 vs 系统结构化数据）；UI 需要不同颜色和图标区分；聚类布局需要独立中心点
- 影响范围: KnowledgeGraphPane 所有 `Record<KgNodeType, ...>` 字典均已补充 concept 条目；concept 节点聚类中心为 `[0, -480]`（图谱顶部中央），颜色 `#a78bfa`（浅紫），图标 Sparkles
- 可逆性: 高

### 5. 技术细节快照

#### 新增文件/表
- `analysis_cases` 表（见 `server/src/db.ts`）：`id, workspace_id, title, category, scenario, approach, conclusion, enabled, created_at, updated_at`
- 无新增源文件，均为已有文件的扩展

#### 关键新增函数（`server/src/db.ts`）
- `listAnalysisCases` / `createAnalysisCase` / `updateAnalysisCase` / `updateAnalysisCaseEnabled` / `deleteAnalysisCase`
- `buildEnabledCasesPrompt()` — 生成 `<xanthil-cases>` 块，置于 standards 之后、KG 之前

#### AI 提取函数（`server/src/knowledge-graph.ts`）
```
extractKgEntitiesFromReports(workspaceId, model?)
```
- 默认 model: `"minimax-cn/MiniMax-M3"`
- 每次最多处理 5 篇报告（`MAX_REPORTS_PER_RUN = 5`），每篇截取前 3000 字
- 向 LLM 传入已有非 report 节点标题作为上下文，引导模型建立跨类型关联
- 返回 `KgExtractResult { newNodes, newEdges, processedReports, extractedAt }`
- concept 节点 `sourceKey` 格式：`concept:{workspaceId}:{title_slug}`，按 title 幂等去重
- report → concept 边 weight=1.2（relation=references），concept→existing 边 weight=1.0

#### 新增 API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspaces/:id/cases` | 列出案例 |
| POST | `/api/workspaces/:id/cases` | 新增案例 |
| PATCH | `/api/cases/:id` | 更新案例（含启停） |
| DELETE | `/api/cases/:id` | 删除案例 |
| GET | `/api/workspaces/:id/cases-prompt` | 获取注入内容及计数 |
| POST | `/api/workspaces/:id/kg/extract` | 触发 AI 语义提取 |

#### `buildMemoryPrompt()` 注入顺序（五源）
```
biz_ctx → rules → standards → cases → KG
```

#### UI 变更
- `CasesPane.tsx`: 全部改为调用后端 API，新增 `onChanged` prop（触发 `refreshRulesPromptInfo`）
- `KnowledgeGraphPane.tsx`: 新增「AI 语义提取」紫色按钮（`Sparkles` 图标），提取中显示 `animate-pulse`；提取完成后状态栏显示 `+N 概念 · +M 边 · 处理 K 篇报告`
- `App.tsx`: CasesPane 加 `onChanged` 回调；`refreshRulesPromptInfo` 改为五源（加 `getCasesPrompt`）

#### 注意事项
- `extractKgEntitiesFromReports` 用 `DIRECT_LLM_ROOT` 作为 pi session 目录（与 TOC/黄金策略相同模式）
- concept 节点在 `listKgNodes` 默认查询中会返回（无过滤），UI 已在图谱聚类布局中放在 `[0, -480]`
- AI 提取不调用 `clearKgAutoEdges`（那会清除 Phase A 的边），只追加写入；`insertKgEdges` 使用 `INSERT OR IGNORE`，重复运行安全

### 6. 未完成事项与下一步

- [ ] **验证 AI 语义提取实际效果** — 优先级 P0（功能已上线但未实际运行）
  - 上下文: `extractKgEntitiesFromReports` 已实现，需要有报告文件的 workspace 实测
  - 输入: 打开知识图谱 tab → 先「更新图谱」→ 再「AI 语义提取」
  - 完成标准: 图谱中出现紫色 concept 节点，且内容与报告语义相符
  - 潜在难点: minimax-cn/MiniMax-M3 JSON 输出格式是否稳定；报告文件路径是否能被服务器读取

- [ ] **trace 规则去重** — 优先级 P2
  - 上下文: 当前 trace 写入 rules 时未做去重，同 title 会重复插入
  - 输入: `db.ts createRuleMemory()`，加 `WHERE title = ?` 查询
  - 完成标准: 同 workspace 下 title 完全相同时跳过插入，返回已有规则

- [ ] **AI 提取结果持久化（跳过已提取报告）** — 优先级 P2
  - 上下文: 当前每次点击「AI 语义提取」都重新处理所有报告（最多 5 篇），不记录哪些已处理过
  - 输入: 可在 `kg_nodes` 的 `tags` 里存 `ai_extracted:true` 标记，或在 concept 节点 sourceKey 中编码报告 hash
  - 完成标准: 未变更的报告跳过 LLM 调用，只处理新增/变更的报告

### 7. 开放问题与待确认事项

- ❓ **AI 提取质量：JSON 输出是否稳定**
  - 当前倾向: `parseExtractJson` 已容错处理 Markdown fence 和格式错误，但 LLM 完全拒绝输出 JSON 时会静默跳过该报告
  - 阻塞了什么: 不阻塞，但影响提取率
  - 需要谁解决: 实际运行后观察；若质量差可加 `repairJsonObject` 重试逻辑

- ❓ **分析案例库 localStorage 数据迁移**
  - 当前倾向: 不做自动迁移（localStorage 内容通常较少，手动录入可接受）
  - 阻塞了什么: 不阻塞新功能
  - 需要谁解决: 用户判断是否需要迁移脚本

### 8. 上下文与约定

本 session 新增约定：
- **`buildMemoryPrompt()` 现为五源**：biz_ctx → rules → standards → **cases** → KG；顶栏 badge 计数为五源合计
- **concept 节点**：AI 语义提取专用，紫色 `#a78bfa`，Sparkles 图标，聚类中心 `[0, -480]`
- **AI 提取使用 `DIRECT_LLM_ROOT`** 作为 pi session 目录，timeout 60s per report

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。
> 最紧迫的是**实际测试 AI 语义提取**：在有报告文件的 workspace 中，先点「更新图谱」再点「AI 语义提取」，确认 concept 节点出现且内容合理。
> 注意：`extractKgEntitiesFromReports` 的 `parseExtractJson` 会静默跳过格式错误的 LLM 输出，若提取后节点数为 0，先检查服务端日志确认 pi runPiPrompt 是否正常返回。
> 注意：分析案例库的 localStorage 旧数据不会自动迁移，需用户手动录入或跳过。

---

## Session 2 — 2026-06-05（历史）

### 0. 本次更新摘要

**本次推进**: 在规则记忆下新增「知识图谱」二级 tab，完成 Phase 1 结构化图谱全链路（DB + 同步逻辑 + API + UI），并将图谱纳入记忆注入体系。  
**关键决策**:
1. 知识图谱作为规则记忆的二级 tab（非顶栏独立 tab）
2. Phase A 先做结构化图谱（无新依赖），LightRAG 作为可选 Phase B
3. 注入触发策略：手动触发 + 变更累积（"更新图谱"按钮），不做每次保存自动触发

**新增阻塞/问题**: 无阻塞；Phase B（LightRAG AI 提取）时机待用户决策。  
**下一步重点**: Phase B LightRAG 接入，或补齐规则记忆其他遗留项（rules 编辑删除、分析案例库）。

---

### 1. 项目元信息

```
项目名称: pi-xanthil / 规则记忆模块
项目类型: 代码开发
Session 编号: 第 2 次交接
本次 Session 起止: 从「规则记忆三源注入已落地」推进到「知识图谱 Phase 1 全功能上线」
最后更新: 2026-06-05
```

### 2. 项目目标（North Star）

延续 Session 1，无变化。补充本次新增的知识图谱目标：

- **知识图谱一句话目标**: 将 rules / 指标体系 / 业务环境 / workflow 报告融合为可视化知识网络，支持用户探索关联、AI 执行时自动召回相关子图。
- **成功标准**:
  1. 同步后图谱可视化展示节点（5 类）和边（4 种关系）
  2. 图谱内容通过 `injectRulesPrompt` 开关注入 AI 执行链路
  3. 隐藏节点不出现在图谱和 AI 注入中
  4. 手动连边可持久化

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---------|------|------------|------|
| token 统计看板 | ✅ 完成 | `TokenStatsPane.tsx`，按来源类型分组 | 已扩展为多来源（非仅 session） |
| trace 看板 | ✅ 完成 | `TracePane.tsx` | KPI + 事件流 + 失败分析 + 规则提炼 |
| rules tab | ✅ 完成 | `RulesPane.tsx` | 创建/启停，缺编辑/删除 |
| 指标体系 tab | ✅ 完成 | `IndicatorsPane.tsx` | metric + reference_file，文件 hash 检测 |
| 业务环境 tab | ✅ 完成 | `BusinessContextPane.tsx` | 6 分类，挂在探索和工作流顶层 tab 下 |
| 记忆注入三源 | ✅ 完成 | `buildMemoryPrompt()` in `index.ts:173` | business_context → rules → standards → KG |
| **知识图谱 tab** | ✅ 完成 | `KnowledgeGraphPane.tsx` | Phase 1 全功能，见下方详细 |
| 分析案例库 tab | ⏳ 待启动 | placeholder | 建议方向：案例/trace 闭环 |
| rules 编辑/删除 | ⏳ 待启动 | `RulesPane.tsx` | 当前只有创建/启停 |
| trace 规则去重 | ⏳ 待启动 | `db.ts` | title 相同时避免重复插入 |
| Phase B LightRAG | ⏳ 待启动 | — | AI 语义提取实体关系，待用户决策时机 |

### 4. 关键决策与权衡 ⭐

**决策 1: 知识图谱挂在「规则记忆」二级 tab，非顶栏独立 tab**
- 选择: 规则记忆第 6 个二级 tab（rules → 指标 → 案例库 → trace → token → 知识图谱）
- 备选: 新增顶栏 tab
- 理由: 知识图谱是记忆体系的延伸，与 rules/指标/业务环境同属"沉淀知识"范畴；避免顶栏继续扩张；用户确认后采用
- 影响范围: `web/src/lib/constants.ts` RULE_MEMORY_SUB_TABS 定义
- 可逆性: 高

**决策 2: Phase A 结构化图谱（无 LightRAG 依赖）优先**
- 选择: 直接从 SQLite 已有四源（rules/standards/biz_ctx/报告文件）映射节点，keyword overlap 推断边
- 备选: 直接接入 LightRAG（Python sidecar）
- 理由: LightRAG 要求额外 Python 环境，用户上手门槛高；结构化图谱零新依赖、立即可用；LightRAG 作为可选增强后续接入
- 影响范围: 边推断精度有限（keyword 而非语义），Phase B 可增强
- 可逆性: 高（Phase B 可在现有数据模型上叠加）

**决策 3: 摄入触发策略 —— 手动触发 + 变更累积**
- 选择: UI「更新图谱」按钮手动触发，底层检测 hash 变化批量提交
- 备选: 每次新增文档自动触发；夜间 cron
- 理由: 图构建有 LLM 调用开销（Phase B），单文档触发频繁小 batch 效果差；手动触发符合用户控制感；`upsertKgNode` 用 source_key 做幂等 upsert，多次触发不会重复
- 影响范围: 用户需要主动点同步才能更新图谱
- 可逆性: 高

**决策 4: 知识图谱注入 —— 折叠入现有 `injectRulesPrompt` 开关**
- 选择: `buildKgPrompt()` 结果追加到 `buildMemoryPrompt()` 末尾，复用现有开关
- 备选: 新增独立"注入 KG"开关
- 理由: 减少用户认知负担；注入内容（报告摘要 + 强关联边）天然附属于记忆体系
- 影响范围: 顶栏 badge 计数 = rules + standards + biz_ctx + KG（reportCount + edgeCount）
- 可逆性: 高

**决策 5: 节点隐藏而非物理删除**
- 选择: `kg_nodes.hidden` 字段（默认 0），`upsertKgNode` 不覆盖 hidden，同步后隐藏状态持久
- 备选: 物理删除（下次同步会重新摄入）
- 理由: 物理删除后同步必然复原，等于无效；hidden 状态跨 sync 持久，真正让用户控制不需要注入的节点
- 影响范围: `listKgNodes` 默认过滤 `hidden=1`，`buildKgPrompt` 只取可见节点的报告和边
- 可逆性: 高

### 5. 技术细节快照

#### 新增文件
- `server/src/knowledge-graph.ts` — 同步逻辑 + 边推断 + `buildKgPrompt()`
- `web/src/components/KnowledgeGraphPane.tsx` — 完整 UI（ReactFlow + 节点列表 + 连线/隐藏/搜索）

#### 新增 DB 表
```sql
kg_nodes (id, workspace_id, type, source_key, title, summary, tags, content_hash, hidden, created_at, updated_at)
-- UNIQUE(workspace_id, source_key) — 保证 source_key 幂等

kg_edges (id, workspace_id, from_id, to_id, relation, weight, auto, created_at)
-- auto=1 自动推断，auto=0 手动添加；UNIQUE(from_id, to_id, relation)
```

- `hidden` 列通过 `ALTER TABLE kg_nodes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0` 迁移（try/catch 保证幂等）

#### 节点类型 & source_key 规则
| type | source_key 格式 |
|------|---------------|
| rule | `rule:{rule.id}` |
| metric / ref_file | `standard:{standard.id}` |
| biz_ctx | `biz_ctx:{ctx.id}` |
| report | `report:{absoluteFilePath}` |

#### 边推断算法（Phase A）
- keyword 重叠 ≥ 2 个显著词 → `related_to`（weight = 0.5 + shared*0.15）
- rule 的 title+summary 包含 metric/ref_file 的 title → `references`（weight=1.5）
- biz_ctx + rule → `supports`（weight=1.0）
- report summary 包含其他节点 title → `references`（weight=1.2）

#### `buildKgPrompt()` 注入内容
- 最近 10 篇 report 节点（summary 前 150 字）
- 前 30 条强关联边（relation=references 或 supports，weight≥1.0）
- 格式：`<xanthil-knowledge-graph>` XML 块，置于 `buildMemoryPrompt()` 最末

#### 新增 API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspaces/:id/kg/nodes?includeHidden=true` | 列出节点（含隐藏） |
| GET | `/api/workspaces/:id/kg/edges` | 列出边 |
| POST | `/api/workspaces/:id/kg/sync` | 触发同步 |
| GET | `/api/workspaces/:id/kg-prompt` | 获取注入内容及计数 |
| PATCH | `/api/kg/nodes/:id` | 设置 hidden |
| POST | `/api/workspaces/:id/kg/edges` | 添加手动边 |
| DELETE | `/api/kg/edges/:id` | 删除边 |

#### 可视化
- 依赖：`@xyflow/react ^12.11.0`（已安装，与 WorkflowDagEditor 共享）
- 5 类节点按聚类布局（固定中心点 + 小圆排列），非 force-directed
- 搜索高亮：匹配节点 opacity=1，其余 0.15，通过 `setRfNodes` effect 更新
- 手动连边：`onConnect` → ConnectionModal 选 relation → `POST /kg/edges`
- 边删除：`onEdgeClick` → 顶栏出现「删除所选边」按钮
- 隐藏节点从 ReactFlow 渲染列表过滤，不影响 DB 中的节点数据

#### 注意事项
- `upsertKgNode` 的 UPDATE 不写 `hidden` 字段，确保同步后隐藏状态不被重置
- `deleteKgData(workspaceId)` 在 workspace 删除时串联清理 KG 数据
- `buildKgPrompt` 只注入 report 节点的独特内容（rules/standards/biz_ctx 已由各自 builder 注入，避免重复）
- 报告扫描范围：每个 flow 的最近 5 次 run 的 outputDir，每个 outputDir 最多 30 个 .md 文件

### 6. 未完成事项与下一步

- [ ] **Phase B: LightRAG AI 语义提取** — 优先级 P1
  - 上下文: Phase A 的 keyword overlap 推断边精度有限；LightRAG 可从报告正文提取实体关系，显著提升图谱质量
  - 输入: 用户确认 Python 环境接受度；LightRAG 推荐 Kuzu 作为图存储后端（嵌入式，类 SQLite）
  - 完成标准: UI 中「更新图谱」调用 LightRAG sidecar REST API，图谱新增 LLM 提取的节点和边
  - 潜在难点: Python sidecar 安装引导；本地模型 vs 调用 API 的 token 成本

- [ ] **rules 编辑/删除** — 优先级 P1
  - 上下文: 当前 rules 只能创建 + 启停，不支持编辑 title/evidence/severity 或删除
  - 输入: `RulesPane.tsx`，`PATCH /rules/:id`，`DELETE /rules/:id`
  - 完成标准: 列表行内可编辑，有删除确认弹窗

- [ ] **分析案例库 tab** — 优先级 P1
  - 上下文: 目前仍是 placeholder；与 trace 失败和 rules 形成闭环的重要模块
  - 输入: 建议方向 — 存储案例（输入/过程/输出/适用场景），与 trace 规则提炼联动
  - 完成标准: 可创建/浏览案例，支持从 trace 规则建议一键转为案例

- [ ] **trace 规则去重** — 优先级 P2
  - 上下文: 当前 trace 写入 rules 时未做去重，同 title 会重复插入
  - 输入: `db.ts createRuleMemory()`，加 `WHERE title = ?` 查询
  - 完成标准: 同 workspace 下 title 完全相同时跳过插入，返回已有规则

- [ ] **知识图谱 Phase A 增强** — 优先级 P2
  - 上下文: 当前聚类布局不够灵活；可以加 force-directed 布局（纯前端用 D3 力模拟计算位置传给 ReactFlow）
  - 完成标准: 节点分布更自然，关联紧密的节点聚在一起

### 7. 开放问题与待确认事项

- ❓ **Phase B LightRAG 时机**
  - 当前倾向: 先把 rules 编辑/删除和分析案例库补齐，再上 LightRAG
  - 阻塞了什么: Phase B 不阻塞其他任务
  - 需要谁解决: 用户决策是否接受 Python 环境依赖

- ❓ **知识图谱注入粒度是否合适**
  - 当前策略: 注入最近 10 篇报告 + 30 条强关联边，每报告截取前 150 字
  - 待验证 [未验证]: 实际 token 占用是否在合理范围；用户使用后看效果
  - 需要谁解决: 跑几次实际执行后观察 token 消耗

### 8. 上下文与约定

本 session 新增约定：
- **知识图谱同步后需手动开启顶栏 `injectRulesPrompt` 开关**（显示为 `rules on · N`）才能让 AI 读到知识图谱内容；N 包含 rules + standards + biz_ctx + KG（reportCount + edgeCount）的合计
- **手动边用虚线蓝色显示**，自动边用实线灰色，便于区分
- **LightRAG 推荐后端**：Kuzu（嵌入式图数据库，无独立进程，类 SQLite），非 Neo4j

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」和「未完成事项」两节。
> 知识图谱 Phase 1 已全部完成（DB + API + UI + 记忆注入）；下一步优先选择：规则编辑删除、分析案例库、或 Phase B LightRAG，请先与用户确认方向。
> 注意：`buildKgPrompt` 只注入 report 节点的独特内容，rules/standards/biz_ctx 由各自 builder 注入，不要在 KG builder 里重复注入这三类。
> 注意：`upsertKgNode` 的 UPDATE 语句不覆盖 `hidden` 字段，这是故意为之，下次修改时不要加进去。

---

## Session 1 — 2026-06-03（历史）

## 目的
记录 `规则记忆` 模块当前实现状态、关键文件、已完成能力与后续开发建议，便于后续接手继续开发。

## 当前模块结构
`规则记忆` 顶层 tab 下已有二级 tab：

1. `rules`
2. `指标体系`
3. `分析案例库`
4. `trace`
5. `token统计`

定义位置：
- `web/src/App.tsx`
- `web/src/components/MainHeader.tsx`

## 已完成能力

### 1. token统计
已完成 `token统计` 看板：

- 汇总 token / cost / cacheRead / cacheWrite / cacheHitRate
- 按 session 展示明细
- 后端新增 workspace token stats by session API

相关文件：
- `web/src/components/TokenStatsPane.tsx`
- `web/src/lib/api.ts`
- `server/src/db.ts`
- `server/src/index.ts`
- `web/src/types.ts`
- `server/src/types.ts`

### 2. trace 看板
已完成 `trace` tab 的运行追踪看板：

- KPI：今日 sessions / workflow runs / failed events / recent activity
- 最近事件流
- 失败分析
- Session / Flow Timeline 下钻
- Trace 趋势视图
- 搜索 / 过滤
- 规则提炼模块

相关文件：
- `web/src/components/TracePane.tsx`
- `web/src/lib/api.ts`
- `web/src/types.ts`
- `server/src/db.ts`
- `server/src/index.ts`
- `server/src/types.ts`

### 3. trace 数据持久化
新增 `trace_events` 表，用于持久化运行事件。

已采集事件包括：

- `run_start`
- `run_end`
- `error`
- `message_error`
- `agent_step_start`
- `agent_step_end`
- `blackboard_update`

写入函数：
- `addTraceEvent()` in `server/src/db.ts`

事件来源主要在：
- `server/src/index.ts` WebSocket 执行链路

### 4. Timeline 下钻
已完成事件点击下钻：

- `TraceEvent` 增加 `targetKind` / `targetId`
- 新增 `TraceTimelineItem`
- API：`GET /api/workspaces/:id/trace/timeline`

支持目标：

- `session`
- `flow`
- `flow_run`
- `runtime`
- `message`

### 5. 失败分类体系
新增 `TraceErrorType`：

- `validation`
- `path_missing`
- `stream_interrupt`
- `dependency_missing`
- `model_config`
- `runtime`
- `aborted`
- `unknown`

分类函数：
- `classifyTraceError()` in `server/src/db.ts`

失败聚合函数：
- `listTraceFailures()`

### 6. trace 规则提炼
已完成手动规则提炼：

- 用户点击"更新规则提炼"后调用后端生成规则建议
- 规则必须基于真实 trace failures/events
- 返回：`TraceRuleSuggestion`
- API：`POST /api/workspaces/:id/trace/rule-suggestions`

规则建议包含：

- `title`
- `evidence`
- `severity`
- `sourceEventIds`
- `createdAt`

### 7. rules tab 落地
`rules` tab 已从 placeholder 替换为规则管理界面。

已完成：

- 规则列表
- 启用 / 停用
- trace 暂存规则写入 rules
- system prompt 片段预览
- 复制 prompt

相关文件：
- `web/src/components/RulesPane.tsx`
- `server/src/db.ts`
- `server/src/index.ts`
- `web/src/lib/api.ts`

### 8. rule_memories 表
新增 `rule_memories` 表：

字段：

- `id`
- `workspace_id`
- `title`
- `evidence`
- `source`
- `severity`
- `enabled`
- `created_at`
- `updated_at`

相关函数：

- `listRuleMemories()`
- `createRuleMemory()`
- `updateRuleMemoryEnabled()`
- `buildEnabledRulesPrompt()`

### 9. 规则 prompt 输出 API
已完成规则注入准备，但未自动注入执行链路。

API：

- `GET /api/workspaces/:id/rules-prompt`

返回：

```ts
{
  prompt: string;
  count: number;
  updatedAt: number | null;
}
```

prompt 格式：

```xml
<xanthil-rules>
以下规则来自 pi-xanthil 规则记忆，请在执行任务时遵守：
1. ...
   - evidence: ...
   - severity: ...
</xanthil-rules>
```

### 10. 业务环境（第三类记忆注入，2026-06-03）
新增 `业务环境` 模块 —— 补齐 "agent 不知道、但做决策必须知道" 的真实业务背景。与 `rules`（约束）、`指标体系`（口径定义）并列，是第三类记忆注入源。

**Tab 位置（注意）**：不在 `规则记忆` tab 下，而是作为二级 tab 挂在 `探索` 与 `工作流` 两个顶层 tab 下，插入「工作视图」和「原始数据」之间（`web/src/lib/constants.ts` 的 `SUB_TABS`）。机制属记忆注入，故文档记于此。

**内容结构**：固定 6 个分类（引导填全关键维度 + 利于结构化注入）：
- `org` 组织/主体、`status` 业务现状、`glossary` 术语/口径、`constraint` 约束/红线、`history` 历史/背景、`goal` 目标/期望

每条 = `{ category, title, content, enabled }`（比 rules 更简，无 severity/source）。

**注入链路**：`buildEnabledBusinessContextPrompt()` 生成 `<xanthil-business-context>` 块，经 `buildMemoryPrompt()` 与 rules / standards 合并，**置于三者最前**（让 agent 先读业务背景再读规则口径），复用同一个 `injectRulesPrompt` 开关注入。注入文案带强引导语：「做任何分析、判断与决策前都必须纳入考虑，不得凭空假设」。

**关键集成修复**：顶栏 "rules" 注入开关原先在 `rulesPromptCount === 0`（仅数 rules）时被 `disabled`，但该开关实际控制 rules+指标+业务环境三者。已改 `refreshRulesPromptInfo()`（`web/src/App.tsx`）为三者 prompt 计数合计驱动开关 —— 否则「只填业务环境、无 rules」时开关锁死、业务环境永远注入不进去（顺带修复「只有指标体系」的同类潜在缺陷）。

**作用域**：workspace 级（跨 session/flow 共享，与 rules/standards 一致）。

相关文件：
- `server/src/db.ts`（`business_contexts` 建表 + CRUD + `buildEnabledBusinessContextPrompt`）
- `server/src/index.ts`（`/business-contexts` CRUD + `/business-context-prompt` + 接入 `buildMemoryPrompt` / audit）
- `server/src/types.ts` / `web/src/types.ts`（`BusinessContext` / `BusinessContextCategory`）
- `web/src/lib/api.ts`、`web/src/components/BusinessContextPane.tsx`、`web/src/lib/constants.ts`、`web/src/App.tsx`

后续可做：从 pi 对话/导入文件自动沉淀业务环境（v1 仅人工录入）；per-flow 级特定背景（v1 仅 workspace 级）。

## 当前主要 API

### Trace

- `GET /api/workspaces/:id/trace/overview`
- `GET /api/workspaces/:id/trace/recent-events?limit=30`
- `GET /api/workspaces/:id/trace/failures?limit=10`
- `GET /api/workspaces/:id/trace/timeline?targetKind=...&targetId=...`
- `GET /api/workspaces/:id/trace/trend?days=14`
- `POST /api/workspaces/:id/trace/rule-suggestions`

### Rules

- `GET /api/workspaces/:id/rules`
- `POST /api/workspaces/:id/rules`
- `PATCH /api/rules/:id`
- `GET /api/workspaces/:id/rules-prompt`

### 业务环境

- `GET /api/workspaces/:id/business-contexts`
- `POST /api/workspaces/:id/business-contexts`
- `PATCH /api/business-contexts/:id`（含单条启停）
- `PATCH /api/workspaces/:id/business-contexts`（批量启停）
- `DELETE /api/business-contexts/:id`
- `GET /api/workspaces/:id/business-context-prompt`

### Token stats

- `GET /api/workspaces/:id/token-stats`
- `GET /api/workspaces/:id/token-stats-by-session`

## 当前未完成模块

### 1. 自动注入开关
下一步建议做：

- 给 Chat / Workflow 执行链路加"启用 rules prompt"开关
- 默认关闭
- 开启时把 `rules-prompt` 拼接到 system prompt / user context 前
- 需要 UI 预览和明确状态提示

涉及位置：

- `web/src/App.tsx`
- `server/src/index.ts`
- `handleSend()`
- `handleSendFlow()`
- `handleExecuteFlow()`
- `handleExecuteMultiAgent()`

### 2. rules 编辑 / 删除
当前 rules 只支持创建、启用、停用。

待补：

- 编辑 title/evidence/severity
- 删除 rule
- 批量启停

### 3. 指标体系 tab（已完成）
已从 placeholder 替换为 `IndicatorsPane`。

定位：分析标准资产库，统一一张表 `analysis_standards`，`kind` 区分两类资产，UI 分区展示：

- `metric`（指标口径）：name/category/description/formula/caliber/unit，启用即全文注入。
- `reference_file`（参照标准文件）：仅注入 filePath + description（token 友好，策略 A），agent 按需用工具读取文件内容；创建/编辑时算 `file_hash` 检测可读性。

注入链路：`buildEnabledStandardsPrompt()` 生成 `<xanthil-standards>` 块，经 `buildMemoryPrompt()` 与 rules 合并，复用 `injectRulesPrompt` 开关注入（`withRulesPrompt` + flow 的 `systemPromptPrefix`）。

相关文件：
- `server/src/db.ts`（建表 + list/create/update/updateEnabled/delete/buildEnabledStandardsPrompt）
- `server/src/index.ts`（`/standards` CRUD + `/standards-prompt` + `buildMemoryPrompt`）
- `server/src/types.ts` / `web/src/types.ts`（`AnalysisStandard` / `AnalysisStandardKind` / `AnalysisStandardInput`）
- `web/src/lib/api.ts`、`web/src/components/IndicatorsPane.tsx`、`web/src/App.tsx`

后续可做：reference_file 内容变更检测（对比 file_hash 提示过期）、表格型清单导入 SQLite 做 join（策略 C 增强）、与分析案例库 / rules 关联。

### 4. 分析案例库 tab
目前仍是 placeholder。

建议方向：

- 存储分析案例
- 存储输入、过程、输出、适用场景
- 与 trace 失败和 rules 形成闭环

### 5. trace 规则去重
当前 trace 写入 rules 时未做语义去重。

建议：

- 同 workspace 下 title 完全相同则避免重复插入
- 后续可做相似度去重

### 6. trace events 清理策略
当前 `trace_events` 会持续增长。

建议：

- 保留最近 N 天
- 或按 workspace 配置保留策略
- 增加 prune API / 后台任务

## 验证状态
最近一次验证：

```bash
cd web && npx tsc --noEmit
cd server && npx tsc --noEmit
```

前后端 TypeScript 均通过。

## 注意事项

- `token统计` 已独立负责 token / cost / cache 命中率，不应在 trace 中重复建设。
- trace 只追踪 pi-xanthil 自身 DB / API / WebSocket 数据，不接 Pi JSONL、OpenCode SQLite 或外部 ptk DB。
- 规则提炼必须基于 trace evidence，不能无依据生成。
- 记忆注入已落地：顶栏 `injectRulesPrompt` 开关统一控制 rules + 指标体系 + 业务环境三源，经 `buildMemoryPrompt()` 合并注入到 chat/workflow 执行链路（非仅复制/API）。开关是否可点取决于三源启用条目总数（`refreshRulesPromptInfo` 合计），任一源有内容即可开启。
