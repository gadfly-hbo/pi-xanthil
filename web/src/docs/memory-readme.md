# 记忆模块（rule_memory）

记忆模块是 pi-Xanthil 的「跨会话长期记忆」中枢——把多次分析中沉淀下来的规则、指标、业务环境、调用轨迹与图谱关系组织起来，按需注入到后续 LLM 调用中，避免每次都从零开始解释上下文。

## 子 tab 速查

| 子 tab | 作用 | 关键文件 |
|---|---|---|
| 统一记忆 | 跨工作区的规则记忆主面板：编写/启用/禁用规则、按 source 与命中条件筛选、批量管理 | `RulesPane.tsx` |
| onto-knowhow | 业务指标 / 行业 know-how 的结构化沉淀（替代旧名「Knowhow」），与 onto-xanthil 本体库联动 | `IndicatorsPane.tsx` |
| 业务环境 | 业务环境画像（行业、品牌、客群、目标等）：注入 LLM 上下文时与规则一并下发 | `BusinessContextPane.tsx` |
| trace | LLM 调用轨迹回放与失败归因；可由轨迹反向沉淀新规则/记忆 | `TracePane.tsx` |
| 知识图谱 | 工作区级知识图谱视图：节点 / 关系 / 同步状态 | `KnowledgeGraphPane.tsx` |
| readme | 本说明文档 | `MemoryReadmePane.tsx` |

## 数据流

```
trace（LLM 调用轨迹）
   │  反向沉淀
   ▼
统一记忆（规则）  ←  onto-knowhow（指标）  ←  业务环境（画像）
   │                       │                      │
   └──── 拼装为 system prompt ──── 注入下次 LLM 调用 ────►
                              │
                              ▼
                         知识图谱（节点/关系）
```

- **统一记忆**是"硬规则"层：明确的 do/don't、命中条件、注入开关
- **onto-knowhow** 是"软知识"层：行业指标、定义、计算口径，受本体库约束
- **业务环境**是"画像"层：每个工作区独立的业务背景
- 三者共同构成顶部「rules」开关注入的内容；trace 是回看与反哺源头
- 知识图谱是规则/指标/对象关系的可视化层，写入由 onto-xanthil 与同步任务驱动

## 与 onto-xanthil 的关系

`onto-knowhow` 子 tab（旧名 Knowhow）是 onto-xanthil 本体库在记忆模块的入口：在这里维护的指标会进入本体库的 metrics 集合，反过来本体库 schema 变更也会回影响这里的字段约束。改 schema 走 `onto-xanthil` 一级 tab，改具体指标值走这里。

## 注意事项

- 顶栏右上「rules on/off」开关控制本模块输出的 system prompt 是否注入下一次 LLM 调用，关闭后所有子 tab 内容仅作沉淀不影响推理
- 启用规则数显示为「rules · N」，N=0 时按钮禁用
- trace 中"沉淀为规则"操作会写入"统一记忆"，注入开关默认沿用当前状态
- 数据探索（draw_data / data_exploration 子树）从不向本模块写入任何数据样本，仅写字段名等结构信息
