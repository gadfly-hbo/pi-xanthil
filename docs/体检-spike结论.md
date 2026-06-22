# V-HEALTH-SPIKE 数据可行性验证结论

> 执行：2026-06-22 · Agent-D (opencode) · 只读/调研，零产品代码
> 真实运行环境：dev server (8787) + 工作区「会员」(76bc1a51) + 2 本体 + 1 SQL 连接 (xanthil.db)
> 回流总控定稿 X-HEALTH0

---

## 结论速览

| 验证点 | 结论 | 关键证据 |
|---|---|---|
| ① 行数据通道 | ✅ **可行** | 真实聚合集24行级数据可读，cohort_month 确认月粒度 Excel 序列号 |
| ② 数据形态二分 | ✅ **可行，规则草案已出** | 三态清晰：时序/快照/维度主数据，启发式可区分 |
| ③ 聚合数据入口 | ✅ **可行**，但需注意路由分布 | SQL 连接 + extraction-tools + bi-dataset 三条复用通道，切路由在 legacy |
| ④ 本体填充度+缺口 | ⚠️ **可行**，但零售本体偏概念(46/+0)，会员本体稀疏(~20)，from-aggregation 产 dataset/property 但无法链接已有 concept | 缺口可记——列名 vs 本体 concept nameCn 无匹配即为 gap |

**时间粒度支撑现状（当前工作区内）：月 ✅ 已确认**；日/周/季/年当前零数据，但体检引擎可做通用频率探测（无须硬编码粒度白名单）。

---

## ① 行数据通道

**结论**：✅ 可行。总控静态确认的 `BiAggregationData.rows[]` 在真实环境实跑验证通过。

### 实跑记录

```
GET /api/bi/aggregations/24/data

columns(12): [
  "cohort_month", "member_tier", "cohort_size",
  "active_30d_rate", "active_90d_rate", "churn_rate_6m",
  "avg_purchase_interval_days", "avg_order_value_rmb",
  "purchase_frequency_annual", "ltv_12m_rmb",
  "new_member_pct", "repurchase_pct_90d"
]

row sample:
{
  "cohort_month": 45658,          → 2025-01-01 (Excel serial)
  "member_tier": "普通会员",
  "cohort_size": 12450,
  "active_30d_rate": 18.2,
  "ltv_12m_rmb": 599.8,
  ...
}

cohort_month stride (6 distinct values):
  45658→Jan2025, 45689→Feb2025, 45717→Mar2025,
  45748→Apr2025, 45778→May2025, 45809→Jun2025
  stride: 31d, 28d, 31d, 30d, 31d → 月粒度
```

- 通道 OK：`BiCell = string | number | boolean | null`，行数据原样可达
- cohort_month 是 Excel 序列日期（非时间字符串或 ISO），体检引擎需做解析归一化
- 有限制：`limit 缺省 5000, 上限 100000`；/draw_data 403 拒绝

### X-HEALTH0 数据面定稿建议

- `GET /api/bi/aggregations/:pathId/data` 作为体检「选数据集→读行数据」的终端 API，无需新增路由
- 引擎侧加一个 `normalizeTimeColumn(values)` 工具函数，处理 Excel 序列号 / ISO 字符串 / 时间戳 三种格式

---

## ② 数据形态二分

**结论**：✅ 可行。真实数据集呈现清晰的三种形态，启发式规则可可靠区分。

### 真实样本

| pathId | 形态 | 特征 |
|---|---|---|
| 24 | **时序** | 含 time column (cohort_month)，6 个不同值，月间距 |
| 37 | **快照(列名嵌入)** | 无 time column，但列名含 `25.5.1-5.31` 期段标记 |
| 40 | 同 37，但期段为 26.5.1-5.31（2026年） | 说明跨期对比靠两文件+文件命名段 |
| 64 | **维度主数据** | 无 time column，无期段列名；含 static attributes (商品ID/款号/品类) |

### 探测规则草案

```ts
function classifyAggregation(columns: string[], rows: Record<string, unknown>[]):
  'timeseries' | 'snapshot' | 'dimension'
```

按序判定（短路）：

1. **时序探测**：任一列名匹配 `/cohort|date|day|month|quarter|year|period|week|账期|周期|月份|日期|年|季|周|hour|时间/i`，且该列不同值 > 1
   - 频率推断（stride 检测）：取前 N 个排序后的唯一值 → `(v[i+1]-v[i]).days` → 取众数：
     - 28–31 → 月
     - 7 → 周
     - 365 → 年
     - 90–92 → 季
     - 无规律 → 自定义周期
2. **快照检测**：无 time column 但任一列名匹配 `/\d{2,4}[.\-/]\d{1,2}/` 提取期段
3. **否则**：dimension（静态主数据）

> 体检引擎只关心形态标签 vs 具体列找法——试探时按 `classifyAggregation` 的结论走不同画像分支。

### X-HEALTH0 数据面定稿建议

- 引擎侧 `# ponytail: 基本启发式，将来可升级到列值分布+semanticType` ——当前够用
- 时序频率不硬编码白名单，用 stride 众数推导 → 答「日周月季年哪些有数据」由实际数据说了算

---

## ③ 聚合数据入口可行性

**结论**：✅ 可行。三条可复用入口通道均可用，但路由分布在 legacy index.ts，需注意调用风格。

### 可用通道

| 通道 | 端点 | 归属 | 复用方式（体检 V-HEALTH2） |
|---|---|---|---|
| BI aggregations（已有 clean_data） | `GET /api/bi/aggregations` + `/:pathId/data` | routes/data.ts ✅ | 直接 fetch（跨域走 HTTP） |
| SQL export（外部 DB → clean_data CSV） | `POST /api/sql-connections/:id/export` | **legacy index.ts** 🔶 | 截调用方：fetch 调用，不可直接 import |
| extraction-tools（加工→聚合） | `POST /api/extraction-tools/:id/run` | **legacy index.ts** 🔶 | 同上，根据类型和参数工具，方可 |
| bi-datasets upload（直接上传） | `POST /api/bi-datasets/upload` | legacy index.ts 🔶 | 同上 |

### 注意事项

- SQL 查询 `POST /api/sql-connections/:id/query` 返回 `{columns, rows}` 格式——与 aggregation data 几乎相同，是体检最直接的「读即时数据」通道
- extraction-tools 当前 22 个（aarrr-flow/cohort-retention/rfm-segmentation/duckdb-aggregate 等）——可驱动「SQL → 聚合计算 → clean_data」流水线
- **路由分布问题**：多个关键端点还在 legacy index.ts，V-HEALTH2 不应该直接 import 这些函数。按 Orchestration §五.3 —— 跨域走 HTTP fetch 而非直接 import。建议：
  - V-HEALTH2 用 `fetch('http://localhost:8787/api/sql-connections/'${id}'/query', ...)` 在服务端调用 D 域端点
  - 或等总控迁移到 routes/data.ts 后再接（推荐：SPIKE 结论定稿后，由总控在 X-HEALTH0 阶段迁移）

### X-HEALTH0 数据面定稿建议

- 体检「聚合数据入口」子 tab 的数据集源 = `GET /api/bi/aggregations`（已有 clean_data）
- 体检运行时的「入口编排」：选数据集 → `GET .../data` 读行 → `classifyAggregation()` 定形态 → `profileFromRows()` 画像 → `health-check-engine` → 落 findings
- SQL/明细→聚合计算链路：前端在 V-HEALTH3 中调 D 端已有的 SQL export/extraction-run 端点，V-HEALTH2 不重造

---

## ④ 本体填充度 + 缺口机制

**结论**：⚠️ 可行，但实际填充度偏低。`from-aggregation` 可行，缺口可被记录。

### 本体现状

| 本体 | 概念数 | link | logic-rule | property(中粒度) |
|---|---|---|---|---|
| 零售（75a9518a） | 46 concept | 4 links | 2 rules | **无**（concept 不挂 property） |
| 会员（677034f9） | ~20 concept | 0 | 0 | 同上 |

两个 ontology 当前全是 `status: draft`。

### from-aggregation 实测

对 pathId 24 调用 `POST /api/ontologies/:oid/objects/from-aggregation`：

- ✅ 成功创建 dataset object `会员留存聚合2025H1` (kind=dataset, confidence=1.0)
- ✅ 每个 column → property（12 个）：`cohort_month`(number)/`member_tier`(string)/`active_30d_rate`(number)/...
- ❌ **未建立任何到已有 concept 的 link**：`ltv_12m_rmb` → 应连到零售概念"客单价"？会员概念"会员人均贡献"? 无自动匹配
- ❌ 创建的 dataset 作为独立 `kind: dataset`，不继承 `kind: concept` 上已建的 link/rule

### 缺口机制方案

在 from-aggregation 产物后加一步「缺口检测」：

```ts
function detectOntologyGaps(
  datasetName: string,
  columns: string[],
  existingConcepts: ObjectType[],
): OntologyGap[]
```

- 每列 `col.name` → 用拼音/fuzzy 匹配已有 `concept.nameCn` / `nameEn`
- 匹配成功（相似度 > 阈值）→ 记录建议 link `{ datasetProperty, targetConcept, confidence }`
- 匹配失败 → 记录 gap `{ column: col.name, reason: "无匹配本体概念" }`
- gap 可落 defect 或 standalone `ontology_gaps` 表（体检 stage 的事，非本 SPIKE）

检测样例（从真实数据）：

| dataset property | 已有 concept nameCn | 匹配 | 建议 |
|---|---|---|---|
| `ltv_12m_rmb` | 无精确匹配 → 建议「LTV 12月」 | ❌ 缺 | 新 concept |
| `active_30d_rate` | 无 → 建议「月活跃率」 | ❌ 缺 | 新 concept |
| `churn_rate_6m` | 无 → 建议「6月流失率」 | ❌ 缺 | 新 concept |
| `member_tier` | 有"会员"→ 弱匹配(同主题) | ⚠️ 弱 | 建议 link |
| `cohort_month` | 无 → 建议「群组月份」(dimension) | ❌ 缺 | 新 concept |

### 当前本体覆盖度对体检的影响

- 可用 concept 足够支撑「数据质量」类规则（null 率/格式/范围），因为这类规则只依赖数据类型
- 严重不足支撑「业务语义」类规则（比如"LTV 下降 30% → 风险"），因为 LTV 概念已存在但没挂 property/bound Column，也连不到数据集中的列

### X-HEALTH0 数据面定稿建议

- 体检引擎第一阶段只跑「数据质量」规则（零本体依赖），产出缺口清单
- 缺口清单 = 本体积累的第一驱动力（落到 `docs/backlog/本体持续积累机制.md` 的正循环）
- `from-aggregation` + `detectOntologyGaps` 做成一键「提议补本体」UI 动作（非体检阶段），由 X-HEALTH0 向后移到独立功能

---

## 汇总：X-HEALTH0 数据面定稿建议

```yaml
# 体检数据面口径定稿
data_read:
  - source: "GET /api/bi/aggregations?workspaceId="  # 列出可选数据集
  - source: "GET /api/bi/aggregations/:pathId/data"   # 读行数据
  input_security:
    - 只读 clean_data (draw_data 403)
    - 读取后前端/引擎不送 LLM
  shape:
    - columns: string[]  # 用于启发式分类
    - rows: Array<Record<string, BiCell>>  # 喂引擎

classification:
  rules:
    - timeseries  # 有时序列 + 多周期
    - snapshot    # 单期快照（含列名嵌入期段）
    - dimension   # 静态主数据
  freq_detection: stride_mode  # 不硬编码，从数据推导
  
time_granularity_support:
  monthly: true
  weekly: false    # 当前零数据，引擎可处理
  daily: false     # 当前零数据，引擎可处理
  quarterly: false # 当前零数据，引擎可处理
  yearly: false    # 当前零数据（只有单值年份属性，非时序）

data_entry_upstream:
  - sql_connection/export    → clean_data (POST)
  - extraction-tool/run     → clean_data (POST)  
  - bi-datasets/upload      → clean_data/POST
  # 体检只消费，不重现造聚合

ontology_gaps:
  capture: feasible
  current_coverage: low (~46 concept in retail, ~20 in member)
  first_phase: 体检引擎先零本体依赖（数据质量规则）
    → 产出 gap list → 驱动本体积累正循环
```