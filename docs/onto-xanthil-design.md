# onto-xanthil 产品开发方案（数据语义层）

> **目的**：为 pi-xanthil 补充「数据分析场景的 ontology」能力，作为多期开发基线。总控持有。
> **取向**：走 Palantir「object/link 绑数据」心智，借 nano-ontoprompt 数据模型骨架与工程精华（置信度校准 / 分级质检），砍其重型设施（Celery/JWT/文档上传后台/Cytoscape/prompt·model 后台）。
> **定位**：onto-xanthil = 数据语义层「数据是什么」；现有规则记忆·知识图谱 = 知识记忆层「我们怎么分析」。两层并立，共底座。

---

## 0. 当前状态（覆盖式）

- 最近更新：2026-06-10 · 总控
- 进度：**P1 ✅ + P2 ✅ + P3 ✅ + P2b' ✅**（均实跑通过）。P1=契约/db/路由/前端骨架/聚合集生成。P2a=抽 `GraphCanvas` 共享 + onto 图谱 + `KnowledgeGraphPane` 改用共享底座；P2b=metric 非破坏式 backfill。P3=文档导入 + pi LLM 抽取。**P2b'=metric 完全切源**：3 条注入管线(standards-prompt/memory-injection/KG)全改读 `metric_definitions` + 启动迁移(先拷后删旧行) + IndicatorsPane metric 段切源
- **差距对齐期（2026-06-10，总控逐项开发）✅ 全部完成**：对照参考产品 `nano-ontoprompt` 全量代码核查，发现 5 项「本体完整性」差距，列为 **P4~P8**（详见 §9），均 typecheck/build 绿 + 运行时实跑通过（P4=8/P5=20/P6=11/P7=16/P8=8 项）
- 下一步：onto-xanthil 已对齐参考产品「本体完整性」全维度。剩可选项：① 浏览器端实跑点检新 UI（逻辑/动作子tab、导出下拉、文件上传、prompt 编辑）② Turtle 导出对 logic/action 暂未映射（OWL 语义有限，按需）③ function_code 仅启发式校验（TS 侧无法 ast.parse Python，按需接 pi 做语法校验）
- 阻塞：无
- 决策已定：①融合策略 B ②**metric 收敛止于 backfill**（完全切源推后，见下「重要发现」）③~~Action 层不做~~ **改为做（P6，2026-06-10 用户决策推翻原推迟，要求对齐 nano 的 Logic/Action 层）** ④文档导入手工为主 + pi CLI 抽取为辅

> **⚠️ 重要发现（P2 期间）**：`analysis_standards(kind='metric')` 耦合**三条 live 注入管线**——`index.ts:1340 standards-prompt`(注入 system prompt，legacy 冻结)、`memory-injection.ts:79`(记忆注入收集 enabled 标准)、`knowledge-graph.ts:88`(KG metric/ref_file 节点)。原设计低估此耦合。**完全切源**(改这三处读 `metric_definitions` + 删旧 metric 行) 风险高，已决定单开 P2b' 谨慎处理；本次止于 backfill，两侧暂并存（onto 真源 / 指标记忆旧源，**不双重注入**，因注入仍只读 analysis_standards）。

---

## 1. 决策背景

### 1.1 现有「知识图谱」评估

规则记忆 › 知识图谱 = **分析记忆/治理图谱**，非数据 schema：

| 维度 | 现状 |
|---|---|
| 入口 | `rule_memory` › `knowledge_graph`，渲染于 V 域 `VizTabs` → `KnowledgeGraphPane`(611行) |
| 节点 | `rule`·`metric`/`ref_file`·`biz_ctx`·`report`·`concept` |
| 边 | `related_to`·`references`·`supports`·`derived_from` |
| 存储 | `kg_nodes`/`kg_edges`（workspace 维度，`db.ts`） |
| 同步 | `syncKnowledgeGraph` 从 rules/standards/biz_ctx/flow报告聚合；`extractKgEntitiesFromReports` LLM 抽 concept；`buildKgPrompt` 注入 prompt |

结论：服务于 prompt 注入的知识沉淀，不绑数据集字段。

### 1.2 融合策略：B 共底座·双视图

两层有真实重叠（metric 概念 / 图可视化 / 手工+LLM 建模）。选 B：抽共享图引擎 + metric 真源收敛；onto 做数据视图，记忆 KG 复用同引擎；不重复造轮子。

---

## 2. 契约（`types.ts` 双侧，总控持有）

```ts
export interface Ontology {
  id: string; workspaceId: string;
  name: string; domain: string;
  version: string; status: 'draft' | 'active' | 'archived';
  createdAt: number; updatedAt: number;
}

export type ObjectKind = 'dataset' | 'concept';
export interface ObjectType {
  id: string; ontologyId: string;
  kind: ObjectKind;
  nameCn: string; nameEn?: string;
  description: string;
  boundPathId?: string;        // kind=dataset → BiAggregationDataset.pathId
  confidence: number;
  createdAt: number; updatedAt: number;
}

export type PropertyDataType = 'string' | 'number' | 'boolean' | 'date' | 'unknown';
export interface PropertyType {
  id: string; objectTypeId: string;
  name: string; dataType: PropertyDataType;
  boundColumn?: string;        // dataset-kind → 聚合集列名
  semanticType?: string;       // '金额'/'主键'/'外键' 等
  description?: string;
}

export type LinkKind = 'join' | 'fk' | 'is-a' | 'part-of' | 'related';
export interface LinkType {
  id: string; ontologyId: string;
  sourceObjectId: string; targetObjectId: string;
  kind: LinkKind;
  joinKeys?: Array<{ source: string; target: string }>;
  confidence: number;
  createdAt: number;
}

export interface MetricDefinition {     // AnalysisStandard(kind=metric) 超集 + onto 绑定
  id: string; workspaceId: string;
  name: string; category: string;
  description: string; formula: string; caliber: string; unit: string;
  objectTypeId?: string; boundColumns?: string[];
  enabled: boolean;
  createdAt: number; updatedAt: number;
}
```

绑定点真实字段（已核准）：
- `BiAggregationDataset { pathId, name, columns: string[], rowCount }` — dataset-Object 绑 `pathId`，Property 绑 `columns`。
- `AnalysisStandard { kind:'metric'|'reference_file', name, category, description, formula, caliber, unit, filePath, ... }` — metric 收敛源。

## 3. 共享图引擎（R1，接缝层重构）

**组件级共底座，不强行合表**（onto 对象结构比 KgNode 富）：

```
kg_nodes/kg_edges(记忆层·不动)        onto_*(数据层·新建)
              ↘                    ↙
       统一投影 GraphNode/GraphEdge 视图契约
              ↓
   <GraphCanvas>（纯展示：力导向图 + 列表 + 详情面板 + 连边/隐藏回调）
        ↙                          ↘
KnowledgeGraphPane(喂kg)      OntoGraphView(喂onto)
```

```ts
interface GraphNode { id: string; type: string; title: string; subtitle?: string; group?: string; meta?: Record<string, unknown>; }
interface GraphEdge { id: string; from: string; to: string; label?: string; kind: string; }
```

跨层边（onto metric ↔ 指标记忆节点）用同一 edge 概念表达。

## 4. db slot（`server/src/db/viz.ts`）

新表：`ontologies` · `object_types` · `property_types` · `link_types` · `metric_definitions`，均 `workspace_id` 维度，`init` 钩在 base schema 后（沿用 `initVizTables` 模式）。

**metric 收敛迁移（非破坏式）**：建 `metric_definitions` → 一次性 backfill `analysis_standards where kind='metric'` → 验证通过后清旧 metric 行；`analysis_standards` 此后只留 `reference_file`。

## 5. 后端路由（`server/src/routes/viz.ts`，前缀 `/api`）

```
GET/POST/PATCH/DELETE  /api/workspaces/:id/ontologies
GET/POST/PATCH/DELETE  /api/ontologies/:oid/objects            // ?kind 过滤
POST                   /api/ontologies/:oid/objects/from-aggregation   // 聚合集→object+properties(零LLM)
GET/POST/PATCH/DELETE  /api/objects/:objId/properties
GET/POST/DELETE        /api/ontologies/:oid/links
GET                    /api/ontologies/:oid/graph              // 投影 GraphNode/Edge
POST                   /api/ontologies/:oid/extract            // P3 文档导入,pi CLI 抽取
GET/POST/PATCH/DELETE  /api/workspaces/:id/metrics             // metric 真源
```

文档抽取走 `runPiTurn`（**不直接调模型**），借 nano `_calibrate_confidence` + `PostHarnessValidator` 思路做校准与分级门禁。

## 6. 前端结构（V 域 slot）

- **二级 tab**（`constants.ts` 新增 `ONTO_SUB_TABS`）：`对象` · `关系` · `指标` · `图谱` · `导入`(P3)。`onto_xanthil` 从 `VIEW_ONLY_TABS` 移出（需交互建模）。
- **新组件**：`OntologyPane`(壳) · `ObjectTypeList/Editor` · `LinkEditor` · `MetricPane`(与指标记忆共享) · `OntoGraphView` · `GraphCanvas`(抽出共享组件)。
- **VizTabs**：替换占位按子tab 分发；`KnowledgeGraphPane` 改用 `<GraphCanvas>`。
- **指标记忆联动**：`IndicatorsPane`(D域) metric 段切到 `/api/workspaces/:id/metrics`，`reference_file` 段仍读 `analysis_standards`。

## 7. 分期 + 改动文件清单

| 期 | 内容 | 主要改动 | 状态 |
|---|---|---|---|
| **P1** | 契约 + db + 路由 + 前端骨架（手工建模 + 聚合集一键生成 object，零 LLM） | `types.ts`双侧 · `db/viz.ts` · `routes/viz.ts` · `constants.ts` · `VizTabs.tsx` · `OntologyPane` · `lib/api/viz.ts` | ✅ |
| **P2a** | `GraphCanvas` 抽出 + onto 图谱接入 + `KnowledgeGraphPane` 改用共享底座 | 新 `GraphCanvas.tsx` · `OntologyPane` GraphSection · 重构 `KnowledgeGraphPane` | ✅ |
| **P2b** | metric 真源 **非破坏式 backfill**（止于此） | `db/viz.ts` `backfillMetricsFromStandards` · 路由 · onto 「从指标记忆导入」按钮 | ✅ |
| **P2b'** | metric **完全切源**（3 注入管线改读 metric_definitions + 启动迁移删旧行） | `db.ts`(buildEnabledStandardsPrompt+listEnabledMetricDefinitions+迁移) · `memory-injection.ts` · `knowledge-graph.ts` · `IndicatorsPane` 切源 | ✅ |
| **P3** | 文档导入 + pi LLM 抽取（置信度校准 + 质检门禁） | 新 `onto-extract.ts`(runPiPrompt) · `routes/viz.ts` extract · OntologyPane ImportSection · 导入子tab | ✅ |
| **P4** | **质检 validator 深度对齐**（2→5 类，对齐 nano `PostHarnessValidator`；语法/语义引用待 P6/P7） | 新 `onto-validator.ts`(结构/字段/引用/去重/kind 白名单) · `onto-extract.ts` 接入消费去重数组 · 8/8 实跑 | ✅ |
| **P5** | **导出能力**（JSON/YAML/CSV/HTML/**Turtle** 五格式，纯字符串构建零新依赖，超 nano 无需 rdflib/pyyaml） | `onto-export.ts`(collect+renderOntology 拆分) · `routes/viz.ts` `/ontologies/:oid/export?format=` · OntologyPane 导出下拉 · 20 项实跑 | ✅ |
| **P6** | **Logic Rule + Action 层**（本体完整性两缺层） | `types.ts`双侧 `LogicRule`/`OntoAction`(+Input) · `db/viz.ts` `logic_rules`/`onto_actions` 两表+CRUD · `routes/viz.ts` 8 路由 · `api/viz.ts` 8 方法 · `constants` ONTO_SUB_TABS+2(逻辑/动作) · `VizTabs` 分发 · OntologyPane LogicSection/ActionsSection · 导出并入 logic/action · 11 项 db 实跑 | ✅ |
| **P7** | **抽取覆盖增强**（抽 logic/action + 校准四类 + richness 去重 + 补 validator ⑥⑦） | `onto-extract.ts` prompt+norm+落库扩展 logic/action(名称→id 解析) · `calibrate` 四类 · `onto-validator` ⑥function_code启发式+⑦linked语义引用(nano 7 检查全覆盖) · 拆出 `processExtractionOutput` 可测 · 16 项实跑 | ✅ |
| **P8** | **文档上传解析 + Prompt 管理**（抽取入口工程化） | ImportSection 文件上传(.md/.txt/.csv 客户端 FileReader) · `onto_prompts` 表+CRUD+版本化 · 抽取支持 `promptTemplate`({{content}} 占位，缺占位回退默认) · `DEFAULT_PROMPT_TEMPLATE` 导出 · 8 项实跑 | ✅ |

## 8. 注意事项 / 红线

- **metric 收敛动到 D 域**（`IndicatorsPane` + `analysis_standards`）：跨域，由总控做契约 + 迁移；backfill 非破坏式（建新表→回填→验证→清旧）。
- 接缝层文件（`types.ts`/`db.ts` 实例/`tabs` 契约）总控持有，符合分工。
- 不碰他域 slot 既有功能；P1 纯加法，风险最低。
- ~~Action 层本期不做，`LinkType`/路由预留扩展位。~~ **P6 起开发 Logic/Action 层（2026-06-10 决策更新）。**
- 全程不碰 git（提交由用户手动）。

---

## 9. 对照 nano-ontoprompt 差距分析 + 对齐分期（2026-06-10）

**核查方法**：通读参考产品 `/Users/huangbo/Dev/Projects/onto-xanthil/nano-ontoprompt` 全量后端代码（models/ · engine/post_harness/validator.py · tasks/extraction.py · services/export_service.py · routers/）逐项对齐。

### 9.1 三类结论

- **✅ 已达到/超越**：核心建模（对象/属性/关系）、**dataset 列绑定**（Palantir 取向，nano 无）、**`PropertyType` 独立属性表**（nano 仅 entity 上 JSON）、**`LinkType` join/fk+joinKeys**（表关系，nano 无）、**`MetricDefinition` 指标语义层**（nano 完全无）、图可视化共底座（KG/onto 复用 `GraphCanvas`）、模糊解析 `resolveId`。
- **🔵 有意砍掉（设计取舍，非缺口，不补）**：Celery 异步队列、JWT 用户/角色系统、Model 配置后台（走 pi CLI 顶栏切）、Cytoscape 依赖（自研力导向替代）—— 符合 local-first + 走 pi CLI + 做轻。
- **❌ 真实未达水平（→ P4~P8 逐项对齐）**：见下表。

### 9.2 差距项 → 分期（按价值密度排序）

| # | 差距项 | nano 现状 | onto-xanthil 现状 | 期 |
|---|---|---|---|---|
| 1 | **质检 validator 深度** | `PostHarnessValidator` **7 检查**：结构/字段(含 action `function_code`、properties 空告警)/引用完整性/去重原地改/**type 白名单(28 类+自定义比例告警)**/**Python 语法检查(`ast.parse`)**/语义引用完整性 | `onto-extract.ts:validate` **仅 2 检查**(`EMPTY_ENTITIES`+`DANGLING_RELATION`)；Severity 四级框架已抄但规则是零头 | **P4** |
| 2 | **导出能力** | `export_service` 五格式：JSON/YAML/CSV/**Turtle(RDF)**/HTML | ❌ 无任何导出 | **P5** |
| 3 | **Logic Rule + Action 层** | `LogicRule`(formula/linked_entities) + `Action`(**`function_code` 可执行 Python**/execution_rule/linked_logic) 两张表+路由+前端 | ❌ 两层完全缺失（本体只有 object/property/link） | **P6** |
| 4 | **抽取覆盖** | 抽 entity+relation+**logic+action** 四类；`_calibrate_confidence` 覆盖四类(relation 断引→0.30/action 看代码语法)；`_dedup_existing` 按 `_richness` 保最富 | 仅抽 concept entity+语义 relation；`calibrate` 仅 entity；去重仅按名跳过 | **P7** |
| 5 | **文档上传解析 + Prompt 管理** | 多格式文件解析(md/txt/csv 实测分支) + `Prompt` 表(版本化+模板生成) | ImportSection 仅粘贴文本；抽取 prompt 硬编码 `buildPrompt` | **P8** |

### 9.3 对齐原则

- **逐项独立交付 + 实跑门禁**：每期 typecheck/build 绿 + 运行时实跑后再进下一期（吸取 P0-C 终审教训）。
- **借 nano 逻辑、不照抄设施**：validator/calibrate/export 直接移植 nano 的判定逻辑到 TS，但落在 onto-xanthil 既有 slot（`db/viz.ts`/`routes/viz.ts`/`onto-extract.ts`/`OntologyPane.tsx`），不引入 Celery/rdflib 等重依赖（Turtle 导出视 TS 侧轻量实现可行性按需）。
- **P6 Logic/Action 为最重项**：涉及新表+新契约+新前端+抽取扩展（与 P7 强相关），放在 P4/P5 两个低风险项之后。
- 全程总控独立开发、不碰他域 slot、不碰 git。

---

## 参考

- nano-ontoprompt 源码：`/Users/huangbo/Dev/Projects/onto-xanthil/nano-ontoprompt`（数据模型 entity/relation/logic/action；抽取流水线 `tasks/extraction.py`；质检 `engine/post_harness/validator.py`）。
- Palantir Ontology：object=数据集、property=列、link=表间关系、action=结构化修改；语义层+动力学层=组织 digital twin。
- 现有 KG：`server/src/knowledge-graph.ts` · `web/src/components/KnowledgeGraphPane.tsx` · `kg_nodes`/`kg_edges`。
