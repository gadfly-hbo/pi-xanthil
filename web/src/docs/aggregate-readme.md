# 计算工具模块 操作手册

> 「计算工具」（顶部 tab `aggregate`）是 pi-Xanthil 的**本地数据加工与工具管理中枢**。所有重计算、敏感数据处理、对接外部数据库的环节都集中在这里——通过一个明确的「不进 LLM 的本地通道」补足探索模块的短板。
>
> 本文按 4 个二级 tab 的顺序，逐一讲解功能、操作步骤与典型案例。

---

## 0. 总览

进入路径：顶部主导航选中「**计算工具**」（`activeTab === "aggregate"`）。

二级 tab 共 4 个：

| # | 二级 tab | 一句话定位 | 数据流向 |
|---|---|---|---|
| 1 | **聚合计算**（`view`） | 浏览器内对单文件做 group-by 聚合 / 数据探查 / Python 高级模式 | 文件留在浏览器，可选择性把聚合结果发 LLM |
| 2 | **数据提取**（`extraction`） | 触发已注册的本地 Python 工具（如 HTML → Markdown） | 原文件本地处理，产物落到指定输出目录 |
| 3 | **SQL 连接**（`sql_connect`） | 连接 PG / MySQL / SQLite，写 SQL 跑查询，可保存为参数化模板 | 数据库原始结果在前端展示，**不自动进 LLM** |
| 4 | **tool-use**（`tool_use`） | 工具注册表的**管理控制台**：查看/筛选/试评所有 server/tools 工具 | 只读元数据，工具运行另在 ① / ② / 实验室 |

> 🟡 数据敏感度：本模块处理的多为 `draw_data` 级原始/半结构化数据。所有 LLM 调用都是**用户显式触发**的（如「发到 LLM」按钮），而非 AI 自主索取。模块顶部均有绿色「本地执行边界」提示。

---

## 1. 聚合计算（`view`）

### 功能

- **本地文件加载**：从硬盘选 csv / xlsx / xls，浏览器内解析（`readLocalDataset`），不上传服务端。
- **三种工作模式**：
  - **数据探查**（`profile`）：自动给出总行数、列数、重复行、缺失率、主键候选字段、每列类型 / 空值率 / 唯一值数 / 基数（高/中/低）/ 数值范围 / Top 值。
  - **DSL 本地计算**（`dsl`）：可视化配置 group-by + 时间粒度 + 度量（sum/avg/min/max/count），浏览器内当场跑出聚合结果，支持「最小分组阈值」隐去小样本。
  - **Python 高级模式**（`python`）：根据数据列结构自动生成 Python 分析提示词（pandas 模板 + 你的诉求 + 最小分组约束），可一键复制到外部 IDE 跑或贴给 LLM 写脚本。
- **结果操作**：
  - **下载 CSV**：把 DSL 聚合结果导出。
  - **发到 LLM**：把聚合结果（不是原始明细）发给指定模型做洞察解读，结果以 Markdown 渲染。
- **隐私边界**：UI 顶部绿色提示「原始文件与明细行不会发送到 BFF 或 LLM。字段名也可能敏感。」

### 操作步骤

1. 点右上角「选择 CSV / Excel」选本地文件。
2. 文件加载后看到字段表 + 三个模式 tab。
3. 先切到「数据探查」看数据健康度（缺失率 / 重复行 / 主键候选）。
4. 切「DSL 本地计算」配 group-by + 度量，结果实时计算。
5. 满意后选「下载 CSV」或「发到 LLM」拿洞察。
6. 复杂逻辑（多表 join、自定义指标、滑动窗口）切「Python 高级模式」生成提示词，自己跑或交给 AI。

### 案例：销售月报快速汇总

```
文件：sales_2025.csv（24 万行，包含 order_date, region, channel, sku, gmv, qty）
```

1. 数据探查：发现 `region` 列空值率 12%（标黄警告），`order_id` 是主键候选。
2. DSL 配置：
   - group-by：`region, channel`
   - 时间字段：`order_date`，粒度 `month`
   - 度量：`sum:gmv`、`count:`
   - 最小分组阈值：50
3. 实时得到 `region × channel × month` 的 GMV 透视，过滤掉了 17 个低样本组合。
4. 输入问题「华东地区直播渠道 GMV 12 月环比为何下降，给出 3 条解释假设」，点「发到 LLM」→ 拿到 Markdown 洞察。
5. 同样数据如需做新客 / 老客拆分（DSL 不支持），切到「Python 高级模式」生成 pandas 脚本模板，复制到本地 jupyter 跑。

> 💡 与「数据探索（duckdb-wasm）」的差别：聚合计算偏**单文件 + 配置式聚合 + 一键发 LLM**；数据探索偏**多表 + 拖拽式 BI + 永久无 LLM**。两者互补。

---
## 2. 数据提取（`extraction`）

### 功能

- **已注册工具列表**（左栏）：从 `server/tools/` 加载的所有 ingestion / analysis 工具。每条显示工具名、版本、可接受的输入扩展名。
- **执行配置**（右栏）：
  - 选择**输入路径**（文件 / 目录）和**输出目录**（必须本地路径）。
  - 工具自定义参数：每个工具在 `tool.json` 声明的 string / boolean / select / number 参数，UI 自动渲染为表单。
  - **风险标识**：L0（绿）/L1（蓝）/L2（黄）/L3（红）。L2/L3 工具点「执行」会先弹二次确认。
  - **使用边界**：`allowedUse` / `forbiddenUse` 字段直接展示，避免误用。
- **执行运行时**：
  - 点击「执行」→ 后端 `runExtractionTool(toolId, inputPath, outputPath, params)` 启动 Python 子进程。
  - 完成后展示产物清单（`ExtractionRun.outputs`）：每个产物可点击预览（md 渲染 / csv 表格 / json 高亮 / 其它纯文本，均**仅前端渲染**，不进 LLM）。
- **隐私边界**：UI 顶部绿色提示「原始文档不会发送到 LLM。后端只允许运行注册表中的工具，输入与输出路径均由你明确选择。」

### 操作步骤

1. 左栏选工具（如 `extract-tmall-profile` 把天猫人群画像 HTML 转 markdown 报告）。
2. 阅读工具卡片：风险等级、适用 / 禁止说明、参数清单。
3. 点「选择文件 / 选择目录」拾取**输入**；再选**输出目录**。
4. 配参数（按需）。
5. 点「执行」（L2/L3 二次确认）。
6. 等待运行，产物清单出现后点击预览。

### 案例：天猫人群画像批量提取

```
工具：extract-tmall-profile（v1.x，输入 .html，输出 .md / .csv）
输入：~/Downloads/tmall-export/   （20 个 .html）
输出：~/Projects/Q4-recall/clean_data/tmall-profiles/
```

1. 左栏选 `extract-tmall-profile`，看风险 L1（蓝）。
2. 输入选目录，输出指向 `clean_data/tmall-profiles/`。
3. 默认参数（保持「按人群名生成单 md」勾选）。
4. 点「执行」→ 1 分钟后产物清单：
   - `tmall-profiles/index.md`（汇总）
   - `tmall-profiles/<crowdName>.md`（每人群一份）
   - `tmall-profiles/summary.csv`（人群名 / 标签数 / 匹配率）
5. 点预览 `index.md` 在右栏看 markdown 渲染，确认数据无误。
6. 接下来切到「探索 → 聚合数据」登记此目录，AI 即可在「数据分析」tab 通过路径访问这些聚合产物。

> 📌 重要边界：本面板触发的是 ingestion 类工具（不暴露给 AI）。analysis 类工具（如 churn-risk / clustering）设计为**由 LLM 在对话中调用**，不在本面板执行——但你可以在「tool-use」tab 查看它们的配置与试评。

---

## 3. SQL 连接（`sql_connect`）

### 功能

- **多库支持**：SQLite（本地文件）/ PostgreSQL / MySQL / MariaDB。
- **连接管理**：
  - 新建 / 编辑 / 删除连接配置（host / port / database / 用户名 / 密码 / SSL）。
  - 测试连接（返回延迟 ms）。
  - 配置加密保存在 server 端 workspace。
- **Schema 浏览器**：
  - 拉取数据库 schema → 按 schema/database 分组展示表。
  - 点击表展开列定义（字段名 / 类型 / 是否主键）。
- **SQL 编辑器**：
  - 写 SQL，**支持 `{{param}}` 模板参数**（自动从 SQL 提取，UI 渲染为输入框）。
  - 「校验 SQL」（`validateSql`）做语法 + 安全检查（如禁止 DDL/DML 误执行）。
  - 「运行」拿到 `SqlQueryResult`：列定义 + 行数据 + 执行耗时。
  - 结果表格分页 / 排序 / 列宽自适应。
  - 「导出 CSV」一键下载。
- **Saved Query**（保存查询）：
  - 把当前 SQL + 参数定义存为命名查询，挂在该连接下。
  - 切换连接时显示该连接的所有 saved queries。
  - 编辑 / 删除已保存查询。
  - **可被 LLM 调用**：保存的查询可暴露给 AI 作为「动态参数化数据源」，但执行结果默认不自动回灌（用户决定是否粘贴或推送）。
- **隐私边界**：UI 标识「数据库原始结果在前端展示，不自动进 LLM」（与「聚合计算」一样：要发 LLM 你得显式操作）。

### 操作步骤

1. 点「+ 新建连接」，选数据库类型，填配置（SQLite 选文件即可）。
2. 保存后点「测试连接」，确认绿色 ✓。
3. 点「拉取 Schema」展开表列表。
4. 在 SQL 编辑器写查询，可用 `{{start_date}}` 占位。
5. 输入参数值，点「校验」→「运行」。
6. 看结果，导出 CSV 或保存为命名查询模板。

### 案例：从生产 PG 拉日销数据

```
连接：prod-pg-readonly（host=db-prod.internal, db=app, user=ro_analyst, ssl=on）
查询：
  SELECT DATE_TRUNC('day', order_at) AS d,
         channel,
         SUM(gmv) AS gmv,
         COUNT(*) AS orders
  FROM orders
  WHERE order_at BETWEEN {{start_date}} AND {{end_date}}
    AND status = 'paid'
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2;
```

1. 新建 PG 连接，测试通过（latency 38ms）。
2. 写上面 SQL，参数 `start_date='2025-12-01'`、`end_date='2025-12-31'`。
3. 校验 SQL ✓，点运行 → 拿到 124 行 × 4 列。
4. 保存为「12 月日销 by 渠道」命名查询，参数 `start_date / end_date` 标记为 `date` 类型。
5. 导出 CSV → 落到 `clean_data/12月日销.csv`。
6. 在「探索 → 数据分析」tab 让 AI 读取该 csv 做归因分析。

> ⚠️ 安全实践：生产库连接强烈建议使用**只读账号**；密码以加密形式存于 server，但仍建议限制 IP 白名单。

---
## 4. tool-use（`tool_use`，工具管理控制台）

### 功能

- **统一工具清单**：列出 `server/tools/` 下所有已注册工具（当前 13 个：9 个 analysis + 4 个 ingestion）。
- **分类筛选**（左栏顶部三键）：全部 / 摄取（ingestion）/ 分析（analysis）。
  - **摄取（amber 标签）**：只在「数据提取」面板手动触发，**不暴露给 AI**（避免原始 PII / 半结构化数据落入模型）。
  - **分析（emerald 标签 + Bot 图标）**：经 MCP 暴露给 pi-agent，AI 可按需调用；产物聚合后才回灌 LLM。
- **工具详情卡**：
  - 基本信息：id / version / runtime（python / node）/ 输入输出扩展名。
  - 风险等级 + 适用 / 禁止描述。
  - **参数定义**：name / type / required / default / description。
  - **结果列**（resultColumns）：声明产物 csv 的列结构。
  - **失败处理**（failureHandling）：声明常见错误与建议处理。
- **测试用例查看**（loadCases）：
  - 点「加载测试用例」拉取 `server/tools/<id>/tests/cases.json`。
  - 每个 case 包含输入数据 fixture + 预期输出（field-presence + must-fail 断言）。
  - 用于核对工具行为，**不在本面板真跑**——深度评测请打开「实验室 → tool」。
- **边界声明**（emerald banner）：
  - 分析类工具产物不得包含原始行级明细（由工具自身保证）。
  - 摄取类工具不暴露 AI，避免原始 PII 进模型。
  - 分类是 manifest 内禀属性（在 `server/tools/<id>/tool.json` 编辑）。
- **只读控制台**：本面板不写代码、不跑用户数据。新增 / 修改工具仍由开发者编辑 `server/tools/`。

### 操作步骤

1. 进入面板，看顶部统计「共 X · 摄取 Y · 分析 Z」。
2. 用 `全部 / 摄取 / 分析` 切换筛选。
3. 点击工具进入详情页，阅读：
   - 风险 / 适用 / 禁止
   - 参数清单
   - 结果列定义
4. 点「加载测试用例」看 fixture + 断言。
5. 决定「这个工具能不能用 / 该用哪个版本 / 是否需要扩展」，然后：
   - 实际触发：摄取类去「数据提取」；分析类在「探索 → 数据分析」让 AI 调。
   - 修改代码：去 IDE 编辑 `server/tools/<id>/`，重启 server 后点本面板「刷新」即可重新加载。

### 案例：审计当前工具栈

业务方问：「我们能做关联规则挖掘吗？」

1. 打开 tool-use，筛「分析」。
2. 看到 `market-basket`（emerald + AI 标签）→ 点开。
3. 详情：v1.0 · 输入 csv · runtime python · 风险 L1。
   - 适用：长表（order×item）或宽表（order + items 字符串）双格式。
   - 参数：`min_support=0.01, min_confidence=0.3, format=auto`。
   - 结果列：`itemset, support, confidence, lift`。
4. 加载测试用例：5 个 case，含 `wide.csv` / 长表 / must-fail（缺列）。
5. 结论：能做。在「探索 → 数据分析」让 AI：
   > 用 `market-basket` 工具分析 `clean_data/orders_long.csv`，min_support=0.005，找出 lift>3 的关联规则。

   AI 经 MCP 调用工具，拿到聚合产物（频繁项集 + 规则表），写入报告。

> 📌 当前工具清单（截至 2026-06-13）：
>
> **Analysis（9 个）**：`profile-builder`、`metric-calculator`、`anomaly-detector`、`rfm-segmenter`、`cohort-retention`、`market-basket`、`churn-risk`、`clustering`、`aarrr-flow`
>
> **Ingestion（4 个）**：`extract-tmall-profile`、`extract-xhs-insight`、`extract-douyin-profile`、`extract-wechat-profile`
>
> 详细列表以 `tool-use` 面板「刷新」后实时显示为准。

---

## 端到端最佳实践流（结合「探索」模块全链路）

> 假设场景：业务方甩来一份 `订单原始数据.csv`（70 万行）+ 一段需求「找出可能流失的高价值客户，给召回策略」。

```
1. 计算工具 → 聚合计算
   - 加载 csv → 数据探查（缺失率 / 主键候选 / Top 值）。
   - DSL 配 group-by user_id + sum:gmv + count → 得到客单画像 → 下载 CSV。

2. 计算工具 → SQL 连接（如有补充数据）
   - 连生产 PG，写 SQL 拉用户行为日志（最近 90 天登录 / 加购 / 客服会话）。
   - 保存为「90 天行为补全」查询模板，导出 CSV。

3. 探索 → 聚合数据
   - 把上面两份 CSV 登记到 `clean_data/`。
   - 顺手写一份 `复购口径.md`、`高价值定义.md` 落档。

4. 探索 → 数据探索（duckdb-wasm，零 LLM）
   - 多表 JOIN + 拖拽 BI 探查 GMV vs 频次散点，目视识别「高价值低频次」象限的疑似流失人群。

5. 探索 → 数据分析（AI 对话）
   - 注入 `consumer-insight-analyst` skill。
   - 让 AI 调 `rfm-segmenter` + `churn-risk` 两个 analysis 工具
     （pi-agent 经 MCP 调用 → 经 tool-use 注册 → 路径解析 `draw_data` / `clean_data`）。
   - AI 拼出报告写到 `report/高价值流失分析-v1.md`。

6. 探索 → 报告审核 + 汇报版本 + 黄金策 + 行动
   - 同探索 readme 后段流程。
```

每个环节的产物都明确分级，不污染红线域；analysis 类工具的产物被 AI 看到的是聚合结果而非原始行。

---

## 数据安全 · 速查清单

| 操作 | 允许吗？ |
|---|---|
| 在「聚合计算」加载本地 csv 浏览 / 探查 | ✅ 浏览器内，零上传 |
| 在「聚合计算」点「发到 LLM」把聚合结果发给模型 | ✅ 用户显式触发，且只发聚合产物（非原始行） |
| 在「聚合计算」直接把原始明细发给 LLM | ❌ UI 不提供该路径，等同绕过红线 |
| 在「数据提取」运行 ingestion 工具处理原始 HTML | ✅ 本地 Python 子进程，产物落到指定目录 |
| 让 AI 主动调用 ingestion 工具 | ❌ 仅 analysis 工具经 MCP 暴露给 AI |
| 在「SQL 连接」用只读账号查生产库 | ✅ 推荐 |
| 让 AI 直接连生产库执行 SQL | ❌ 当前架构不支持，须由用户在面板查询并选择性发送 |
| 在「tool-use」改工具代码 | ❌ 面板只读，代码请编辑 `server/tools/` |

---

## 故障排查（FAQ）

- **聚合计算文件加载失败**：检查 csv 编码（推荐 UTF-8 with BOM）；超大文件（>200MB）建议先在外部工具拆分；xls 旧格式建议另存为 xlsx。
- **DSL 聚合结果为空**：检查最小分组阈值是否过高；group-by 字段是否含大量缺失。
- **数据提取 L2/L3 工具点击执行无反应**：是要二次确认弹窗，再点一次「确认执行」。
- **数据提取产物预览为空**：检查输出目录权限；点「打开输出目录」直接用 Finder 看物理文件。
- **SQL 连接测试失败**：检查 host 可达 / 端口 / 凭据；PG 检查 `pg_hba.conf` 是否允许此 IP；MySQL 检查 user@host 授权；SQLite 检查文件路径绝对正确。
- **SQL 校验报错「dangerous statement」**：默认禁止 DDL/DML，改 `validateSql` 行为需在后端修改白名单。
- **tool-use 工具列表为空**：点「刷新」；检查 `server/tools/` 是否有 `tool.json`；server 启动日志看 registry 是否报错。

---

## 文件地图（开发者参考）

| 二级 tab | 主要源文件 |
|---|---|
| 聚合计算 | `web/src/components/AggregatePane.tsx` + `web/src/lib/aggregate.ts` |
| 数据提取 | `web/src/components/ExtractionPane.tsx` |
| SQL 连接 | `web/src/components/SqlConnectPane.tsx`（含 ConnForm / SchemaPanel / SQL 编辑器 / Saved Query） |
| tool-use | `web/src/components/ToolUsePane.tsx`（管理控制台，只读元数据） |
| Tab 路由 | `web/src/lib/constants.ts`（`AGGREGATE_SUB_TABS`） + `web/src/tabs/DataTabs.tsx` |
| 工具运行时 | `server/tools/<id>/tool.json` + `server/tools/<id>/main.py` + `tests/cases.json` |
| 工具注册 | server 端 registry 自动加载 `server/tools/*/tool.json` |
| MCP 暴露 | analysis 类工具经 MCP 协议给 pi-agent；ingestion 类不暴露 |

> 进一步背景见 `docs/notes-data.md`（数据基座域 · 领域笔记）。
