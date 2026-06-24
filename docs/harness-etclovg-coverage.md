# pi-xanthil Harness 七层覆盖度自检（ETCLOVG）

> 治理活文档 · 框架来源：《Agent Harness Engineering: A Survey》(CMU/Yale 等 20 作者，picrew.github.io/LLM-Harness) 的 **ETCLOVG 七层分类法**。
> 用途：把 pi-xanthil 当作一个 agent harness 来体检——逐层盘点已实现/在途/缺口，确保演进不偏科。
> 记忆索引：[[harness-taxonomy-2026]]。相关机制沉淀见 [[harness-papers-2026]] / [[skill-engineering-2026]] / [[self-improving-product-agent-2026]]。

## 更新约定

- **何时更新**：① 每次发版（同步 Orchestration §八 里程碑）；② 每次「harness 相关」交付落地或 backlog 捞出/入池时，改对应层的覆盖度与「在途/缺口」列。
- **覆盖度图例**：✅ 已落地 · ⚠️ 偏薄（有基础、关键能力在 backlog）· 🔲 规划中（仅 backlog/卡，未建）。
- **谁更新**：总控（与 wiki TASKS / backlog README 同源维护，勿与之冲突）。
- **快照锚点**：每次更新覆盖度表顶部「最近核对」日期 + 版本。

---

## 覆盖度总表

> 最近核对：**2026-06-23 · v2.2**

| 层 | 含义 | pi-xanthil 实现（真实模块/文件） | 覆盖度 | 在途 / 缺口（backlog · wiki 卡） |
|---|---|---|---|---|
| **E** Execution | 沙箱/运行时隔离 | `subagent-core.ts`(沙箱 + `.mcp.json`)、`pi-adapter.ts`(本地执行)、`autonomous-runner.ts` | ✅ | — |
| **T** Tooling | 工具接口/协议/发现 | tool-use 注册表（[[tool-registration-workflow]]）、hooks(`px-hook-runner`)、command 注册表、MCP 注入(helper)、skills | ✅ | command 场景调用框（backlog）、动态技能注入 `E-SKILLINJECT1`（瘦 context 工具/技能按需加载） |
| **C** Context | 记忆/上下文管理 | 记忆模块 v2（`memory-injection.ts`/RulesPane/多信号检索）、缓存 harness(`cache.ts`/`prompt-blocks.ts`，infra/X) | ✅ | 记忆老化巡检 `AgingBench`(P1)、记忆按任务族选策略(M★)、动态瘦 context `E-SKILLINJECT1` |
| **L** Lifecycle | 控制流/编排 | `multi-agent-runner.ts`、工作流(`flow-fs.ts`/workflow)、AnaX(`anax-template/gate`)、`Orchestration.md`(D/E/V/X 多 agent 编排) | ✅ | agent-loop 工作流闭环（backlog，运行时回跳）、subagents 节点级落库（backlog） |
| **O** Observability | 追踪/成本/监控 | TracePane、TokenStatsPane、ProcessTrace、KnowledgeGraphPane | ⚠️ | **EFC 反馈效率度量（P0 开发中 `X-HARNESS0`/`E-EFC1`）**——把「比分数」升级为「比反馈效率」η=EFC/C_raw |
| **V** Verification | 评测/基准/失败归因 | 6 测评台(`*-evaluation-runner.ts`)、监测引擎(`monitor-engine.ts` finding 生命周期)、体检(`health-check-engine.ts`) | ✅ | AHE 可证伪编辑契约（P0 `E-AHE1`）、产品 agent 自进化（`X/E/D-EVOLVE` 冻结待 AHE）、SkillOpt 受控回写器(P1) |
| **G** Governance | 安全/权限/合规 | `AGENTS.md` 数据安全红线（`draw_data` 403 / 数据探索零 LLM / 隔离 grep）、记忆治理(防 poison/dedup/supersede)、hooks 作 guardrail | ⚠️ | **HarnessAudit 轨迹级安全审计（P2 `X/E-AUDIT`）**——多 agent 信息流/权限轨迹审计、SAR 度量 |

## 缺口小结（核心提炼）

**最薄两层 = O（Observability）与 G（Governance）**，与 Survey「开源项目中 O/G 最被低估」的发现**完全吻合**。pi-xanthil 的对症补强**已在 backlog/派发板**，无需新增需求，只需按序推进：

1. **O 补强 → EFC**（P0 开发中）：度量底座，`η=EFC/C_raw`，其余自进化项皆插它。
2. **G 补强 → HarnessAudit**（P2，待多 agent 规模）：轨迹级权限/信息流审计 + SAR。

> 结论：harness 分类法这批资料对 pi-xanthil 的价值=**交叉验证既有优先级**，非新增需求。

## 三张力在 pi-xanthil 的取舍（Survey）

| 张力 | pi-xanthil 当前立场 |
|---|---|
| cost–quality–speed | 缓存 harness(稳定前缀/文件分析缓存) + EFC(质量优先于算力) 主动管理 |
| capability–control | **偏 control**：红线/human-gate/总控终审优先于全自动（见 T4 自检） |
| harness coupling | 接缝层(types/db/cache 契约)归 X 总控，域 slot 物理隔离，降耦合 |

## T1–T4 充要自检（《What makes a harness a harness》arxiv 2606.10106）

pi-xanthil 作为 harness 四条均过，且 **T4 控制层是差异化强项**（论文称 T4 是学界最少共识的开放前沿）：

- **T1 Loop** ✅ AnaX 8 阶段 / 工作流 runner / 多 agent reasoning-action-observation 循环。
- **T2 Tools** ✅ 能改环境（文件/SQL/工具调用），非只读。
- **T3 Context** ✅ 按任务内容管理进出（记忆多信号检索 + 缓存前缀 + 计划动态注入），非机械截断。
- **T4 Control** ✅✅ **强项**：`AGENTS.md` 红线、`draw_data` 403、human-gate（监测行动环/总控终审）、hooks guardrail、工具调用约束——均不依赖模型自愿配合。
- 术语澄清：**Guardrail 在 harness 之内**（guardrail 限制、harness 赋能）——对位 [[hooks-vs-plugins]]：hooks=harness 内的生命周期 guardrail。

## 关联

- backlog 索引：`docs/backlog/README.md`（EFC/AHE/SkillOpt/AgingBench/HarnessAudit/SkillHone/动态技能/产品 agent 自进化）。
- 派发板：`docs/wiki.html` 『Harness 自进化专题』+『技能工程子波』+『产品 Agent 自进化专题』。
- 总控章程：`Orchestration.md`（域划分与接缝纪律）。
