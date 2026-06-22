# 反馈效率度量（EFC · Effective Feedback Compute）

> 入池日期：2026-06-22 · 状态：暂缓（方案）· 来源：harness 论文集精读（arxiv 2605.29682《Scaling Laws for Agent Harnesses via Effective Feedback Compute》）
> 铁律：入池=产品代码零残留。本度量**不得**与现有测评台实现绑死，先沉淀方案，待测评台需要「比反馈效率」时捞出。

## 1. 为什么有这条需求

实验场的 6 个测评台目前主要在测**产出对错 / 分数**。论文给出的反直觉结论：agent 表现随**反馈质量**扩展，而非算力数量——

- raw compute（token / tool 调用数）预测成功率，R²≈0.33；
- normalized EFC 预测，R² 达 0.92~0.99；
- **同等预算**（等 token、等 tool 调用、等 wall-clock）下，反馈质量从低到高，成功率 0.27 → 0.90。

对 pi-xanthil 的直接含义：评一个 harness 改动（prompt / hook / command / subagent）好不好，不该只看最终分，要看它**每一轮反馈是否被后续决策真正用上**。这同时回答 [[cache-harness]] 的核心问题——该缓存什么（保留高 EFC 的稳定前缀，丢冗余反馈）。

## 2. EFC 是什么（论文定义）

一个反馈事件只有同时满足四条才记分，四个因子各取 `[0,1]`，**乘积**结构（任一项低则整体低）：

| 因子 | 含义 | pi-xanthil 已有的可观测信号 |
|---|---|---|
| **I_t 信息量** | 揭示任务相关信息：新约束 / 降不确定性 / 诊断出失败模式 / 子目标进展 | 工具返回、hook 传感器输出、报错诊断 |
| **V_t 有效性** | 有可靠证据支撑：确定性 checker / 执行结果 / 单测 / 一致的工具观测 | `typecheck`+`build` 门禁、health-check-engine、工具结果 |
| **R_t 非冗余相关** | 命中**当前**子目标，且信息超出轨迹里已有的 | 轨迹去重、是否重复同一报错 |
| **M_t 记忆更新** | 改变了 plan / state / memory，能影响后续动作 | **直接对接记忆模块**：该反馈是否写入 memory / 改了计划 |

**事件级**（κ=10 为固定尺度常数）：

```
EFC_t = κ · I_t · V_t · R_t · M_t
```

**轨迹级**（Tfb = 反馈事件数）：

```
EFC(τ) = κ · Σ_t  I_t · V_t · R_t · M_t
```

**任务难度归一化**（跨任务可比）：

```
D_task = L · H_tool · S_state · (1 + N_obs) · (1 − V_oracle)
X = EFC / D_task        # normalized EFC，跨任务比较口径
```

其中 L=最小步数、H_tool=选工具的歧义度、S_state=状态跟踪需求、N_obs=观测噪声、V_oracle=验证信号可见度。

**Harness 效率**（pi-xanthil 最该报的一条）：

```
η = EFC / C_raw         # C_raw = 原始算力(token/tool 调用)，cache-harness 已在监控
```

## 3. 落到 pi-xanthil 的工程化（论文 §C 的估计器路径）

无 oracle 状态时，论文用一个**学习出来的估计器** ÊFC，而非靠 LLM 主观打分：

```
ÊFC_t = max(0, exp(θ_0 + θ·φ(e_t)) − 1)
```

特征向量 `φ(e_t)` 全是**可观测信号**（pi-xanthil 基本都已采集或可低成本采集）：checker 是否触发及范围、是否引用了工具结果、plan/memory 是否更新、是否避免重复报错、观测一致性、子目标进展、在轨迹中的位置。

**状态质量门**（代码执行场景，直接可用于 px-hotfix / 工作流 runner）：

```
passing=1.0 · assertion error=0.42 · runtime error=0.12 · timeout=0.06
```

**标定路径**：① 在有 oracle/可控反馈的任务上监督学习 θ → ② 把估计器套到真实轨迹（无 oracle）→ ③ 从任务元数据算 D_task → ④ 同时报 raw EFC 与 EFC/D_task。

## 4. 与现有模块的边界（关键）

- **不改测评台 MVP**：测评台现有「比分数」逻辑照常跑；EFC 是**新增一栏度量**，作为分数之外的第二视角，不替换。
- **复用而非新建采集**：M_t 直接读记忆模块写入信号，V_t 直接读 typecheck/build/health-check-engine 结果，C_raw 直接读 [[cache-harness]] 的 token 监控。多数信号已在，工程量集中在「事件级打分 + 估计器标定」。
- **零残留**：本条入池前产品无任何 EFC 痕迹；捞出时作为 hook-eval-core / subagent-core 之上的一层度量适配器接入。

## 5. 将来开发要点（捞出指引）

1. **先做最便宜的 η = EFC/C_raw**：用规则版四因子（不学 θ，先用状态质量门 + 二值 I/R/M）跑通一个测评台，验证「同分不同 EFC」现象在 pi-xanthil 真实存在，再决定是否上估计器。
2. **M_t 接记忆模块**：把「反馈是否写入/改变 memory」做成记忆模块对外的一个事件信号，是四因子里 pi-xanthil 最独特、最易拿分的一项。
3. **特征采集对齐 px-hook-runner**：φ(e_t) 的 checker/工具结果/重复报错信号，多数能从 hook 传感器轨迹直接抽，避免另起采集管线。
4. **D_task 标注**：先给实验场各测评任务人工标 L/H_tool/S_state 等 5 个量，量小可手填，跑通归一化对比再谈自动估计。
5. **勿过早追 R²=0.99**：论文的高 R² 靠 oracle-EFC + 大量标定；pi-xanthil 先要的是**排序正确**（哪个 harness 改动反馈效率更高），不是精确拟合失败率。

## 6. 关联

- [[实验场改造]]（`docs/实验场改造-任务派发.md`）——6 测评台 + hook-eval-core/subagent-core 接缝，本度量的落点。
- [[缓存命中 harness]]——η=EFC/C_raw 的 C_raw 来源；EFC 反过来指导「缓存什么」。
- `docs/backlog/agent-loop-工作流闭环.md`——其「gate 失败→带证据回跳」正是高 EFC 反馈的典型场景，可作 EFC 度量的首个验证场。
- 同批 harness 论文：AHE「编辑即可证伪契约」（2604.25850）与本度量互补——AHE 管「每次改动配预测」，EFC 管「用什么指标证伪」。
