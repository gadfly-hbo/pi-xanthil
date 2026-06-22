# 记忆老化巡检（AgingBench）

> 入池日期：2026-06-22 · 状态：暂缓（方案）· 来源：harness 论文集精读（arxiv 2605.26302《Your Agents Are Aging Too: Agent Lifespan Engineering for Deployed Systems》）
> 铁律：入池=产品代码零残留。本机制是给记忆模块补的**老化诊断与定向修复**，先沉淀方案，待 Dream Worker 需要「记忆健康巡检」时捞出。

## 1. 为什么有这条需求

[[记忆模块 v2.0 补齐]] 已规划「治理 + 可观测 + Dream Worker」，但治理目前是被动式（删错的、更新旧的）。AgingBench 给出系统化结论：**即使权重冻结，记忆运营态会随时间退化**，且「行为测试通过≠事实准确」——老化对常规行为测试不可见。pi-xanthil 的文件式记忆（MEMORY.md + 各卡）正暴露这些老化：卡冲突、事实更新后引用不一致（CLAUDE.md 已警示「recalled memory 反映写入时状态，需验证 file/flag 仍存在」）、压缩丢值。

## 2. 四类老化（论文骨架 → pi-xanthil 对位）

记忆建模成循环数据流：`History →[写 W] 记忆S →[读 R] Context →[用 U] Answer`。四类老化各发生在不同阶段：

| 老化 | 阶段 | 定义 | pi-xanthil 现象 | 度量 |
|---|---|---|---|---|
| **压缩老化** | 写 W | 写时摘要丢信息（写时不知未来会问啥），低频细节(金额/专名)被丢 | 记忆卡压缩时丢精确值 | `chain_recall(d)`、`keyword_m(t)` |
| **干扰老化** | 读 R | 相似/冗余条目挤掉目标事实 | 多张相近记忆卡互相干扰检索 | `interference_resistance` |
| **修订老化** | 用 U | 变更/派生态没正确更新（如累加值 budget=初值+Σdelta） | 事实更新后旧卡仍被引用 | `accumulator_error(t)=|v_agent−v_gold|`、`forget_accuracy` |
| **维护老化** | 存 S/生命周期 | 重压缩/prompt 更新/日志清理悄改行为，造成性能悬崖 | MEMORY.md 重整、prompt 改版 | `shock_delta(e)=m_F(shock)−m_F(control)` |

## 3. 诊断法（**最该拿的核心：反事实探针**）

「同样的错答，修复方式不同」——同等总错误率(0.60~0.82)下，U/W/R 成分天差地别。靠三个 oracle 探针把错误**归因到具体阶段**：

| 探针 | 写 W | 读 R | 用 U |
|---|---|---|---|
| P1 | agent | agent | agent |
| P2 | agent | **oracle** | agent |
| P3 | **oracle** | **oracle** | agent |

```
Utilization 错 = 1 − Acc_P3   （给了正确事实还是答错 → 用的环节坏）
Write 错       = Acc_P3 − Acc_P2（写时就没存全）
Read 错        = Acc_P2 − Acc_P1（检索混淆）
找「换 oracle 后性能恢复最多」的阶段 = 老化定位
```

老化曲线统计：半衰期 `t_1/2`（首个 m(t)≤0.5·m(0) 的 session）、衰减斜率(OLS)、hazard、终值 `m_F`。

## 4. 定向修复（按诊断 profile 对症）

| 诊断 | 修复 |
|---|---|
| 压缩失败 | 写时保留精确值（value-preserving compaction prompt + 显式 spec 清单） |
| 干扰失败 | 改善混淆条目检索（消歧 / typed entity tagging） |
| 修订失败 | 强制用检索到的 context / 显式更新派生态（Typed-State Overlay 维护累加值） |
| 维护失败 | 生命周期事件后跑回归检查（轻量 runtime controller 监控 post-event 表现） |

**关键发现**：修订老化是**表征问题非容量问题**——accumulator 错误不随模型变大而改善，得靠「显式状态维护」而非堆规模。

## 5. 与现有模块的边界（关键）

- **不改记忆 MVP**：现有读写/治理照常；本机制是 Dream Worker 的一个**夜间巡检任务**，叠加诊断+定向修复建议，非替换。
- **复用而非新建**：记忆读写管线、Dream Worker 框架已规划；新增集中在「反事实探针执行器 + 四类老化度量 + 修复建议生成」。
- **零残留**：入池前产品无 AgingBench 痕迹；捞出时作为记忆模块可观测层的一组探针。

## 6. 将来开发要点（捞出指引）

1. **先做最便宜的「干扰 + 修订」巡检**：pi-xanthil 文件式记忆最痛的是卡冲突(干扰)和事实更新后引用过期(修订)。Dream Worker 夜间扫：① 相近卡冲突告警；② 事实更新后回扫引用它的卡(对接 CLAUDE.md 的「验证 file/flag 仍存在」)。无需全套探针即有价值。
2. **反事实探针做轻量版**：P1/P2/P3 需 oracle，初期可在小验证集上人工标 oracle 答案，验证「错误归因到 W/R/U」是否真能指导不同修复，再谈规模化。
3. **行为测试之外加事实探针**：论文 Finding II——行为合规可全过而事实准确性已跌。记忆健康不能只看「读写是否成功」，要看事实是否正确存活。
4. **维护老化加回归门**：MEMORY.md 重整 / prompt 改版后，跑一组 `shock_delta` 回归，防悄无声息的性能悬崖。
5. **勿堆模型规模治修订老化**：修订是表征问题，靠显式状态维护(Typed-State Overlay)，非换大模型。

## 7. 关联

- [[记忆模块 v2.0 补齐]]（Dream Worker / 治理 / 可观测）+ [[规则记忆模块重建]]——本机制的需求来源与落点。
- `docs/backlog/EFC-反馈效率度量.md` 的 M_t(记忆更新)——老化巡检可反哺 EFC 的记忆信号质量。
- [[Harness 论文集精读]]——九篇总览；与 M★(记忆按任务分化)同属「记忆」族，可一起捞。
