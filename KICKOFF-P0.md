# P0 开工任务书（三域并行）

> 配套 `Orchestration.md`（分工/契约/协议）与 `AGENTS.md`（数据安全/工程约定）。**开工前必读这两份。**
> 第 0 步接缝重构已完成（commit 95528cd）——每个域有独占 slot，可并行。本文件把各域 P0 拆成可领取、可验收的任务。

## 通用规则（三域共同遵守）

- **分支**：`feat/data-*`（D）/ `feat/engine-*`（E）/ `feat/viz-*`（V）。总控 rebase 集成 + 终审 merge → master。
- **只改自己的 slot**：见 `Orchestration.md §三/§四`。**禁止**触碰接缝层骨架（`index.ts` legacy / `db.ts` legacy / `App.tsx` / `api.ts` / `types.ts` / `constants.ts`）——需改这些 → 提 PR 给总控。
- **每次提交必跑**：`npm run typecheck`（server+web）+ `npm run build`，必须全绿（当前 baseline 已清零，不允许引入新错误）。
- **db 新表/改列**：先把 schema 提给总控审，再在 `db/<域>.ts` 的 `init*Tables` 里 `CREATE TABLE IF NOT EXISTS`。**禁止 ALTER 他域表**。
- **新 API**：写在 `routes/<域>.ts`，路径不得与 legacy 冲突；前端方法加入 `lib/api/<域>.ts` 域片段（组件继续用 `api.<name>()`）。
- **完成定义**：功能闭环 + typecheck/build 绿 + 关键路径自测 + 一句话验证说明。

---

## 🟦 Agent-D · P0-A「上传即用」

**目标**：把数据接入从"路径登记式"升级为**拖拽上传 Excel/CSV → 直接 duckdb 画像**，让用户拖入文件即看到字段画像/质量报告，无需先手动登记路径。这是方案 V1 的第一句话，也是当前最高摩擦点。

**范围与文件**（均 D 域 slot）：
- `web/src/components/data-exploration/FileSelector.tsx`：增加拖拽上传区（`@dnd-kit` 或原生 drop），接受 `.csv/.tsv/.xlsx/.xls`。
- `web/src/lib/duckdb.ts` + `profiling.ts` + `insights.ts`：用 `xlsx` 解析 Excel、duckdb-wasm 建表，复用 `inferKind` / `detectDataQualityFlags` 出画像。
- `web/src/components/DataExplorationPane.tsx`：拖入后直接渲染 `ProfileReport` + `InsightsReport`。
- 上传文件落盘登记到 `draw_data`/`clean_data`：调用**现有** workspace-path 写入端点（不新增 server 路由；如确需新端点走总控）。

**铁律（不可破）**：
- 纯前端 duckdb-wasm，**零 LLM 调用**；原始数据/列名/样本值**绝不送 LLM**。
- 改完必须跑隔离校验，**应无任何匹配**：
  ```bash
  grep -rE "(generate|chat|extract|clarify|sink|distill).*api\." \
    web/src/components/DataExplorationPane.tsx web/src/components/data-exploration/
  ```

**验收**：拖入一个 CSV 和一个 XLSX → 1 秒内看到字段类型/缺失率/质量标记，且原始数据未离开浏览器。

**P1 预告（本 P0 不做，先知悉接口走向）**：指标语义层 `MetricDefinition`，契约由总控在 P0 收尾后定义（shape 见文末），D 负责实现 metric store（`db/data.ts` 建 `metrics`/`metric_lineage` 表 + `routes/data.ts` CRUD）。

---

## 🟩 Agent-E · P0-C「E2E 验证补课」

**目标**：把"从未真实跑通"的核心链路真跑一遍并修复——这是当前**头号产品风险**（大量功能停在 build 绿但端到端未验证）。

**任务清单**：
1. **AnaX 8 阶段真跑**：起 dev server → 准备**真实留存聚合数据**（综合评分 ≥7）登记到 `clean_data` → 一句话诉求跑完 `business→…→archive`，重点观察：insight **fan-out**（concurrency:3）、假设库 **flywheel 写入**、各 **gate 裁决**是否正确（不再卡在 `data_gate`）。
2. **skill 蒸馏全链路 smoke**：对话 → 「沉淀 skill」→ 选范围 → 提炼 → 预览/改名 → 保存 → 确认 `listSkills` 识别为 project skill、SkillSelector 出现。重点验证 LLM frontmatter 稳定性。
3. **SQL 连接真实库**：连 PostgreSQL/MySQL 实测取数 → 导出 → 注册路径（与 D 协作验证数据落地）。

**范围与文件**：主要在 engine 域现有文件 + `routes/engine.ts`/`db/engine.ts` slot 内修 bug；不新增大功能。

**产出**：① 修复清单（每个链路遇到的 bug + fix）；② 一份验证报告（每条链路截图/日志结论）。**这是验证型任务，交付的是"可信的绿"，不是新代码量。**

**验收**：AnaX 喂真实数据能跑完并归档；skill 蒸馏落盘可复用；SQL 连接真实取数成功。

---

## 🟪 Agent-V · P0-B「看板画布」

**目标**：Dashboard 从固定会员表 → **可拖拽多图看板画布** + **字段类型自动推荐图表** + **图表点击联动**。补齐方案"出图/看板"端的最大短板。这是首个用上批 3 db 扩展点的功能。

**范围与文件**（均 V 域 slot）：
- `web/src/components/BiDashboardPane.tsx`：画布布局（`@dnd-kit` 拖拽 + 网格），添加/删除/排列图表卡。
- 新增图表组件（`echarts-for-react` 封装）：指标卡/折线/柱状/饼/表格起步；按 `profiling.ts` 的 `FieldKind` 做**图表自动推荐**。
- **看板配置持久化**（用批 3 扩展点）：
  - `server/src/db/viz.ts` → `initVizTables` 建表 `dashboards(id, workspace_id, name, layout_json, created_at, updated_at)`（schema 先报总控审）。
  - `server/src/routes/viz.ts` → CRUD：`GET/POST/PUT/DELETE /api/dashboards`。
  - `web/src/lib/api/viz.ts` → 对应 `vizApi` 方法。
  - `web/src/tabs/VizTabs.tsx` → 接入（dashboard/view 分支已在 V 手里）。
- 数据源：消费聚合数据（与 D 的 BI dataset/clean_data 对接），**报告/数据原文不送 LLM**。

**验收**：用户能在 Dashboard 拖拽添加图表、配置维度/指标、保存看板、刷新后恢复、点击图表联动其它图。

---

## 总控（Claude）本阶段交付

- P0 期间：评审三域 PR、做集成 merge、解跨域接口分歧。
- **P1 前置**：定义指标语义层契约 `MetricDefinition`（双侧 `server/src/types.ts` + `web/src/types.ts`），shape 草案如下，供 D 提前对齐：

```ts
// 指标语义层契约（草案，最终以总控提交版为准）
interface MetricDefinition {
  id: string;
  name: string;            // 业务名，如「销售额」
  expression: string;      // 口径表达式，如 sum(order_amount) - sum(refund_amount)
  grain: string[];         // 维度粒度，如 ["date","region","channel"]
  caliber: string;         // 口径说明（含不含退款、去重与否）
  unit?: string;
  lineage: { sourceTable: string; sourceColumns: string[] }[]; // 血缘
  version: number;         // 口径版本，变更可追溯/回滚
  ownerId?: string;
  updatedAt: number;
}
```
agent 写 SQL（E）/ 看板取数（V）均**强制引用** metric，不各自造口径——根治方案警告的"同一指标 5 种口径"。

---

## 启动顺序

```
现在 ─→ D/E/V 并行领取上方 P0  ─→ 总控集成+终审  ─→ 总控定 MetricDefinition 契约  ─→ P1 并行
```
