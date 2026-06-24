# HarnessX：变体隔离 + 可组合 processor harness（AHE 增量）

> 入池日期：2026-06-23 · 状态：暂缓（方案）· 来源：HarnessX（arxiv 2606.14249《HarnessX: A Composable, Adaptive, and Evolvable Agent Harness Foundry》）
> ⚠️ **与现有卡重叠声明**：HarnessX 的 AEGIS 演化闭环（Digester/Planner/Evolver+change manifest/Critic&Gate + 3 RL 病理防御）**与 [[可证伪编辑契约 (AHE)]] 高度重叠**——本条**不重复 AHE**，仅沉淀 AHE 未覆盖的三个新增量：① 变体隔离/ensemble routing ② processor-on-lifecycle-hooks 可组合基座 ③ 确定性 seesaw 无回归门。**co-evolution（cross-harness GRPO + 模型 RL）超范围**（pi-xanthil 守「改接口不改模型」、无模型训练 infra）。

## 1. 为什么有这条需求

AHE（`E-AHE1`）的接受准则是「无效编辑回滚/拒绝」——当一个编辑**改好 A 任务却回归 B 任务**时只能拒，陷入「顾此失彼」。HarnessX 证明更优解：**fork 成变体、按任务路由到最佳变体**（变体隔离消融 +13.6% 且非降级）。这正解实验场 harness 自进化上规模后的真实痛点。整体 +14.5% avg（15 配置），inverse-scaling（弱 agent 收益最大 +44%）。

## 2. 三个新增量（AHE 未覆盖）

### 2.1 变体隔离 / ensemble routing ❗核心新增量
冲突时维护至多 K 个 harness 变体 `{ℋ_t^(1)..ℋ_t^(V)}`；每个任务路由到**估计成功率最高的变体**；改好部分/回归部分的编辑 → **fork 新变体而非拒绝**，per-variant scoping 防跨任务干扰。
→ pi-xanthil：实验场 AHE 接受准则增强——`E-AHE1` 现为「manifest+attribute+回滚」，补「冲突编辑 fork 变体 + per-task 路由」，告别顾此失彼。

### 2.2 processor-on-lifecycle-hooks 可组合基座
harness `ℋ=(ℳ,𝒞)`，`𝒞=(𝐏,𝐒)`：
- **𝐏**：8 生命周期 hook（`task_start/step_start/before_model/after_model/before_tool/after_tool/step_end/task_end`）→ 有序 processor 列表。
- **𝐒**：共享 slot（tool registry / tracer / workspace / sandbox / plugins）。
- **Processor**：typed atomic（`async process(event)→AsyncIterator[Event]`），组合语义 `singleton_group`(互斥) / `_order`(PRE/NORMAL/POST) / `_after`(软依赖)，5 结果（pass/transform/split/intercept/interrupt）。
→ pi-xanthil **已有 user-defined hooks**（`px-hook-runner`，生命周期 guardrail+传感器，见 [[hooks-vs-plugins]]）。HarnessX 的 8 hook + processor 组合语义 = 把 pi-xanthil hooks 升级为「**可组合 harness 基座**」的现成蓝图：实验场 harness 编辑可落到 **processor 粒度**，与 hooks lab 接。

### 2.3 确定性 seesaw 无回归门
AEGIS 更新门：**候选编辑不得回归任何已解任务**（deterministic seesaw），比 AHE 的「回滚无效编辑」更严更稳。3 RL 病理防御：reward hacking→critic 核 manifest 声明；灾难遗忘→确定性门；欠探索→planner 构造 adaptation landscape 防局部修复收敛。
→ pi-xanthil：作 `E-AHE1` 的接受准则升级（attribute 之上加 seesaw 硬门）。

## 3. 超范围（明确不做）

- **harness-model co-evolution**：AEGIS + 模型 RL 共享 replay buffer、**Cross-Harness GRPO**（按任务身份跨 harness 版本分组、group-relative advantage）。+4.7% over harness-only。**需模型权重训练**——pi-xanthil 守 [[harness-papers-2026]] 的 Life-Harness「改接口不改模型」，无训练 infra，**不做**。
- 9 维 taxonomy（D1-D9）与 ETCLOVG 重叠，已有 `docs/harness-etclovg-coverage.md`，不另立。

## 4. 与现有模块的边界

- **复用而非另起**：演化闭环复用 AHE；processor 基座复用 hooks（`px-hook-runner`）；变体隔离/seesaw 是 AHE 接受准则增强。本条只补三增量。
- **零残留**：入池前产品无痕迹。落点=E（实验场 harness 演化）+ hooks lab。

## 5. 将来开发要点（捞出指引）

1. **先补 seesaw 无回归门到 `E-AHE1`**：最便宜——候选不得回归任何已解任务，比纯回滚稳。
2. **变体隔离**：冲突编辑 fork 变体 + per-task 路由（消融 +13.6% 非降级），解顾此失彼。依赖 AHE 已建。
3. **processor-on-hooks 基座**（中长期架构）：把实验场 harness 编辑落到 `px-hook-runner` 8 生命周期 hook + processor 粒度，与 hooks lab 接缝。
4. **co-evolution 不做**：守「改接口不改模型」，无模型训练。

## 6. 关联

- [[可证伪编辑契约 (AHE)]]——增量主体，本条三项均为其增强（`E-AHE1`/`X-HARNESS0`）。
- [[hooks≠插件管理]]——processor 基座复用 `px-hook-runner` 生命周期 hooks。
- [[实验场改造]]——hooks lab / hook-eval-core，processor 基座落点。
- `docs/harness-etclovg-coverage.md`——9 维 taxonomy 已并入 ETCLOVG。
- [[harness-papers-2026]]——AHE/Life-Harness（co-evolution 超范围的依据）所在。
