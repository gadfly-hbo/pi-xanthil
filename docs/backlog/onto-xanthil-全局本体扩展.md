# onto-xanthil 全局本体扩展（候选 P9+）

> **状态**：暂缓 · 入池 2026-06-11 · 总控持有
> **来源**：对照 `~/Downloads/pi-web-mini-palantir-ontology方案.html`（「全产品本体操作系统」愿景，16 节）与现有 onto-xanthil 实现的差距分析。
> **零残留**：本需求从未在产品代码起头，入池不涉及清理。

---

## 0. 背景：两份方案不是同一颗粒度

- **onto-xanthil 现状** = 「**数据语义层**」（数据是什么）。对齐基准 `nano-ontoprompt`。已交付 P1~P8：对象（dataset/concept）/属性（列绑定）/关系（join/fk/is-a/part-of/related）/指标（`MetricDefinition` 唯一真源）/逻辑规则/动作定义 + 文档抽取 + 五格式导出 + 7 项质检 validator。**数据侧本体比该 HTML 方案更细。**
- **HTML 方案野心** = 「**全产品本体操作系统**」（把分析全生命周期对象化）。要求把数据集→任务→洞察→报告→AgentRun→评测→审批**全部对象化并纳入一张可追溯、可审计、可回滚的全局对象图**。

> **核心差距 = 范围**：HTML 方案的「另一半」——**分析运行时制品对象化 + 全局血缘 + Action 治理 + 对象级 Trace/Eval**——目前散落在 AnaX / 报告 / trace / eval 各模块，**未统一进本体**。本需求即补这半边。

---

## 1. 候选范围（按价值密度排序）

### 🥇 P9-A · Search Around / Lineage 血缘追溯（HTML 方案称「灵魂能力」§10.3）
- **要做**：从任一对象出发遍历相邻对象的查询能力——「这份报告的结论从哪来」一键展开：报告→洞察→指标→字段→数据集→AgentRun→Eval。
- **现状缺口**：onto 图谱只在单个 ontology 内投影 object/link，无跨制品血缘遍历。
- **依赖**：需先有 P9-B（制品入对象图）才有东西可追。

### 🥈 P9-B · 分析运行时制品对象化（HTML §4 的 12 类对象补齐）
- **要做**：把已存在但游离于本体之外的制品纳入对象图——`AnalysisTask`（AnaX 任务）/ `Insight`（洞察）/ `Report`（报告历史）/ `AgentRun`（runs）/ `ActionRecord`，以及 `Segment`（人群包，**当前完全缺失**）。
- **关键设计抉择**：**不重复造数据**。任务/洞察/报告/run 已在 AnaX、报告历史、runs 表里——应做**投影 / 引用**（在 `object_types` 里建轻量「外部对象」类型 + 指向原表的 ref），而非复制实体。否则会与现有模块双源不一致。
- **新增对象关系**（HTML §5 的业务血缘 link）：`uses`(任务→数据集) / `produces`(任务→洞察) / `supports`(洞察→报告) / `cites`(报告→数据集) / `executes`(run→任务) / `evaluates`(eval→对象)。

### 🥉 P9-C · Action 治理运行时（HTML §6，区别于已做的 OntoAction 建模）
- **要做**：所有状态变更 → 落 `ActionRecord`（input 校验 / 权限 / 审批 / 回滚 soft-delete）。HTML 12 类 Action（RegisterDataset…PublishReport），高风险动作进审批。
- **现状缺口**：P6 的 `OntoAction`(function_code/execution_rule) 是**建模产物**，不是运行时治理层；AnaX 有 gate 但不落 ActionRecord。
- **与现有融合**：AnaX 的 gate/review 逻辑可作为 Action 审批的第一个落点。

### P9-D · 对象级 Trace / Eval 绑定（HTML §8）
- **要做**：`EvalResult evaluates Object`、`trace_events` 挂 run + object，形成对象级审计链。
- **现状缺口**：产品有 trace/token 面板、eval harness、AnaX review_gate，但**不挂在本体对象上**。

### P9-E · ContextPack 受控上下文（HTML §7.2）
- **要做**：agent 从 ontology 取 datasets/entities/metrics/`allowed_actions`/`allowed_tools`/`sensitive_fields` 构造结构化上下文包，而非裸喂文件。
- **现状缺口**：仅 metric 经 standards-prompt 注入；agent 不从本体取受控上下文。

### P9-F · 字段敏感分级（HTML §13.2）
- **要做**：`PropertyType` 加 `pii_level`（public/internal/confidential/restricted），注入时按级过滤。
- **现状缺口**：`PropertyType` 只有 `semanticType`；红线靠 folder（draw_data/clean_data）粗粒度。

### P9-G（可选）· Vector store 语义召回（HTML §9）
- 报告片段 / 字段说明 / 历史洞察的向量检索召回。本地优先方案需评估（LanceDB / sqlite-vss）。

---

## 2. 明确不做（HTML 方案有、但本项目刻意取舍 —— 捞出时若要做需先推翻）

- **RBAC / 角色系统 / 审批中心多角色**（Admin/Analyst/Operator/Reviewer）—— local-first 单用户，对齐 nano 时已砍 JWT/用户。P9-C 的审批做成**单用户确认门**即可，不引角色体系。
- **通用 generic object store**（`ontology_objects` + `properties_json` 大表）—— onto-xanthil 反向选 typed 表（强类型 + 列绑定），P9-B 的制品对象沿用 typed/ref 模式，不回退 generic JSON。
- **局域网多用户协作 / 对象版本对比**（HTML §14 阶段 4）。
- **独立 Tool Sandbox / Docker**—— 走 pi CLI。

---

## 3. 将来开发要点（捞出时按此接入）

1. **先 P9-B 再 P9-A**：没有制品对象就没有血缘可追。P9-B 用「外部对象引用」模式接 AnaX/报告/runs，严禁复制数据。
2. **契约归总控**：新 Object Kind（task/insight/report/run/action/segment）、新 LinkKind（uses/produces/supports/cites/executes/evaluates）、`ActionRecord` 表 —— 全在 `types.ts` 双侧 + `db/viz.ts` 定义，先提 migration 审。
3. **复用既有底座**：图谱走 `GraphCanvas`（已共享）；血缘遍历在 `routes/viz.ts` 加 `/objects/:id/search-around?depth=` + `/lineage`。
4. **跨域接通**：AnaX（E 域）/ 报告（V 域）/ runs 的制品投影是跨域读取——走对方已暴露 GET，不直接 import 他域 db（遵 Orchestration §五契约）。
5. **实跑门禁**：每子期 typecheck/build 绿 + 运行时实跑后再进下一项（吸取 P0-C 教训）。

---

## 4. 参考

- HTML 方案原文：`~/Downloads/pi-web-mini-palantir-ontology方案.html`（§4 对象模型 / §5 关系 / §6 Action / §8 Trace-Eval / §10.3 Search Around / §13 安全）。
- onto-xanthil 已交付基线：`docs/onto-xanthil-design.md`（P1~P8 + §9 nano 对齐）。
- 现有制品所在：AnaX `anax-template.ts`/`anax-gate.ts`（E）、报告 `reports.ts`（V）、runs `multi-agent-runner.ts`（E）、trace/eval `evaluation-*.ts`（E）。
