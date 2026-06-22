# 可证伪编辑契约（AHE · Agentic Harness Engineering）

> 入池日期：2026-06-22 · 状态：暂缓（方案）· 来源：harness 论文集精读（arxiv 2604.25850《Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses》）
> 铁律：入池=产品代码零残留。本机制是给实验场/编排加的**编辑纪律**，先沉淀方案，待实验场需要「让改动可累积」时捞出。
> 与 [[反馈效率度量 (EFC)]] 互补：AHE 管「每次改动配预测、事后证伪」，EFC 管「用什么指标证伪」。

## 1. 为什么有这条需求

实验场现在的改动（prompt / command / subagent / hook）大多是「试一试→看分数→留下感觉好的」，**改动与效果之间没有可累积的因果记录**，换个人/换个时间就得重判。AHE 的核心主张：把每次 harness 编辑变成**对下一轮评测可证伪的契约**——用「预测 vs 实测」替代「事后自我辩护」。代价极低（每次改动多写一段预测），收益是实验场从「试错」升级成「可累积的因果账本」。

AHE 实测：Terminal-Bench 2 十轮迭代 69.7%→77.0%，且冻结后跨模型/跨基准迁移（cross-family +5~10pp、token 反降 12~32%）——印证 harness 资产模型无关，呼应 Life-Harness「改接口不改模型」。

## 2. 三类可观测性（论文骨架 → pi-xanthil 对位）

### 2.1 组件可观测（Component Observability）
论文把 harness 拆成**七类可独立编辑的组件**，每类失败映射到单一组件类，给进化 agent 干净的 action space，每次 pass-rate 变化定位到单文件：

| AHE 七类组件 | pi-xanthil 已有对应 |
|---|---|
| system prompt | 实验场 prompts lab |
| tool description / implementation | [[工具注册流程]]（tool-use 注册） |
| middleware（执行护栏/控制流） | hooks lab · [[hooks-vs-plugins]] px-hook-runner |
| skill | 记忆→skill（[[实验场改造]] paradigm A） |
| sub-agent config | subagents lab · subagent-core |
| long-term memory | 记忆模块（[[记忆模块 v2.0 补齐]]） |

→ **pi-xanthil 的组件拆分已基本到位**（4 lab + 记忆 + 工具）。AHE 补的是「每个编辑=一次可回滚提交、单文件 diff」的粒度。**接入难点**：AHE 靠 git commit 做提交/回滚粒度，而 pi-xanthil 工作流**无 git**（见 px-hotfix/px-wrapup）——需要自有的编辑版本与按组件回滚粒度，这是本机制最大的工程缺口。

### 2.2 经验可观测（Experience Observability）
Agent Debugger 把原始轨迹蒸馏成**分层证据库**：每任务根因分析报告 → 基准级汇总 → 原始 trace 作为文件（progressive disclosure 省 token）。
→ 对位实验场测评台 + hook-eval-core 的轨迹数据。pi-xanthil 已采轨迹，缺「自动根因报告 + 分层渐进披露」。

### 2.3 决策可观测（Decision Observability）— **本条最该拿的**
每个编辑附一份 **change manifest（变更清单）**：

```
{ 失败证据(哪些任务+症状), 推断根因, 目标修复(组件+改动),
  预期修好的任务集 (predicted-fix),
  预期回归风险的任务集 (predicted-regression) }
```

下一轮把 `predicted-fix / predicted-regression` 与**实测的任务级 delta 取交集**，给每个编辑一个 verdict（fix 精确率/召回、regression 精确率/召回）。

⚠️ **别迷信预测精度**：论文 fix precision 仅 33.7%、regression precision 11.8%（但分别为随机的 5×/2×）。价值在「强制预测 + 事后对照累积因果」，不在预测多准。

## 3. 闭环算法（Algorithm 1，六阶段）

```
1 Rollout      每任务跑 k≥2 条 trace
2 Clean        归一化轨迹
3 Attribute&Rollback  拿上轮 manifest 预测 对照 实测；无效编辑按组件粒度回滚
4 Distill      Agent Debugger 产证据库
5 Evolve       编辑 harness + 记录新 manifest
6 Commit       版本化
接受准则：Pass@1(Hₜ) > Pass@1(H_best) ⇒ H_best ← Hₜ （无显式停机，跑 N=10 轮取最优）
```

`pass@1 = (1/k|D|) Σ_i Σ_j r_{i,j}`，`r∈{0,1}`，基建失败计 r=0 不丢弃。

**护栏（防作弊）**：进化 agent 只能写 harness 工作区；runs 目录、tracer、verifier、模型配置只读；seed system prompt 不可删——防止「关掉 verifier / 换模型」式抄近路。

**Attribute 阶段正是 EFC 的落点**：用 [[反馈效率度量 (EFC)]] 给 delta 打质量分，而非只看 pass@1 二值，是两条 backlog 的接缝。

## 4. 与现有模块的边界（关键）

- **不改实验场 MVP**：现有 4 lab 编辑流程照常；本机制是**叠加的纪律层**（每次编辑多产一份 manifest + 下轮对照），非替换。
- **复用而非新建**：组件拆分、轨迹采集、测评台评分多数已在；新增集中在「manifest 数据结构 + attribute 对照器 + 组件级回滚」。
- **零残留**：入池前产品无任何 AHE 痕迹；捞出时作为 hook-eval-core/subagent-core 之上的编辑治理层接入。

## 5. 将来开发要点（捞出指引）

1. **先只做 manifest，不做自动进化**：最便宜起步——人改 harness 时**手填一份变更清单**（预期修好/回归哪些测评任务），下一轮跑测评台自动对照出 verdict。验证「强制预测」是否真提升改动质量，再谈自动 Evolve Agent。
2. **解决无 git 的回滚粒度**：pi-xanthil 工作流无 git，需先给实验场编辑设计自有版本/按组件回滚机制（最大缺口，建议第一步技术预研）。
3. **attribute 用 EFC 升级**：把对照从 pass@1 二值升级为「带 EFC 质量分的 delta」，与 `EFC-反馈效率度量.md` 合并落地。
4. **经验可观测分层**：测评台失败轨迹→自动根因报告→渐进披露，复用 hook-eval-core 数据，省 token。
5. **勿全自动改源码**：AHE 让 agent 自动编辑 harness 偏激进；pi-xanthil 先取「人改 + 契约对照」半自动形态，与 MOSS 观望结论一致（见 [[Harness 论文集精读]]）。

## 6. 关联

- [[实验场改造]]（`docs/实验场改造-任务派发.md`）——4 lab + hook-eval-core/subagent-core，本机制的落点。
- `docs/backlog/EFC-反馈效率度量.md`——互补：AHE 出闭环+契约，EFC 出 attribute 度量。
- [[多 agent 总控分工]]（Orchestration.md）——D/E/V 编辑同样可套 manifest 契约，让三域改动可对照。
- [[hooks≠插件管理]]——middleware≈hooks，是七类组件里 pi-xanthil 最成熟的一类。
