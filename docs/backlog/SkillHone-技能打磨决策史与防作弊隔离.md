# 技能打磨：决策史 + Creator/Evaluator 防作弊隔离（SkillHone）

> 入池日期：2026-06-23 · 状态：暂缓（方案）· 来源：腾讯 SkillHone（arxiv 2606.08671《SkillHone: A Harness for Continual Agent Skill Evolution Through Persistent Decision History》）+ 桌面文档《skill技能打磨与动态技能研究》
> 铁律：入池=产品代码零残留。
> ⚠️ **与现有卡重叠声明**：本条**不重复** [[可证伪编辑契约 (AHE)]]（change-manifest 决策记录）和 [[skill 受控回写器 (SkillOpt)]]（受控编辑+验证门）。SkillHone 的三大支柱里，前两支柱已被 AHE/SkillOpt 覆盖，**本 backlog 只沉淀第三个真正的新增量：Creator/Evaluator 防作弊隔离 + 决策史可检索 + typed 局部修复**。

## 1. 为什么有这条需求

文档「技能打磨系统」= 把技能从一次性工具变成「带避坑记忆、可持续打磨的资产」。SkillHone 实测在 GAIA 比 Skill-Creator 基线 **+20.5 点**（64.6% vs 44.1%）、比商用 deep-research agent +15.8 点。其方法对 pi-xanthil 的增量价值集中在一个现有专题没覆盖的点：**防止 skill 优化在测试集上「自证自演/过拟合作弊」**——这是 [[实验场改造]] paradigm A(skill) 自动迭代一旦上规模就会踩的坑。

## 2. SkillHone 三支柱（标注 pi-xanthil 覆盖状态）

### 2.1 决策史 meta-memory ✅ 已被 AHE 覆盖（本条仅补「可检索」）
决策记录 `h_t=(q_t 诊断, r_t 候选修订, e_t 脱敏证据, o_t 结果)`，累积 `ℋ_t={h_1..h_t}`。
> "A decision record is more than a version diff... links that change to the problem it targeted, the evidence used, and the final decision."
- **vs AHE**：AHE 的 ChangeManifest 已含「失败证据/根因/目标修复/预期 delta」。SkillHone 多出两点值得补进 AHE：① **outcome 四态** `accept|revise|reject|defer`（AHE 只有 verdict 对照，无 defer/revise 语义）；② **可检索历史**——新失败来时检索 `ℋ_{<t}`，判断「失败是否新 / 类似修复是否已试过 / 上个方案为何被拒」。这把 AHE 从「单轮对照」升级为「跨轮经验库」。

### 2.2 typed 局部修复 / 版本控制 ✅ 部分被 X-HARNESS0 覆盖
> "when a change regresses performance, the following iteration can target the offending part while preserving useful edits."
对比 baseline「按标量信号整体接受/跳过 candidate」。
- **vs X-HARNESS0**：其「无-git 组件级回滚预研」已涉及局部回退。SkillHone 补的是「**typed scoped revision**」——修订带诊断上下文的结构化类型，回退时按类型定位 offending part 而非整体回滚。可作为 X-HARNESS0 预研的输入。

### 2.3 Creator/Evaluator 权限隔离防作弊 ❌ **现有卡完全没有——这是本条核心新增量**
权限边界的 subagent 双队：

| 队 | 能读 | 不能 |
|---|---|---|
| **优化队 𝒯_opt（Creator）** | 脱敏报告 + 历史决策 ℋ | ❌ 看不到未脱敏 probe 目标/validator/执行 trace；可写 skill 库 |
| **评估队 𝒯_eval（Evaluator）** | oracle 目标/validator/trace | ❌ 不能写 skill 库；只产**脱敏**问题报告 |
| **dispatcher 𝒟** | 路由脱敏证据 + 记录结果 | — |

> "This separation prevents practice feedback from becoming a direct memorization target."

**harness 定义** `M=(𝒯_opt, 𝒯_eval, 𝒟)`，评估函数 `m_k=φ_k(A(x_k;S_t), y_k)`。

## 3. 算法（Algorithm 1，对位 pi-xanthil 实验场闭环）
```
for t=0..T-1:
  1 评估队在 probe 上跑当前 skill A(·;S_t)
  2 导出脱敏证据 Ẽ_t
  3 优化队检索历史 ℋ_t，提 (q_t 诊断, r_t 修订)
  4 评估队回脱敏证据 e_t
  5 定 o_t ∈ {accept,revise,reject,defer}
  6 accept→更新 S_{t+1}；否则保留 S_t
  7 记录 ℋ_{t+1}=ℋ_t∪{(q,r,e,o)}
```

## 4. 落到 pi-xanthil（仅新增量）

- **Creator/Evaluator 隔离**：[[实验场改造]] 已有 subagent-core；可用其权限边界跑「优化 subagent 看不到 golden/validator、评估 subagent 不能写 skill 库」。文档建议落在 `research_lab` 测试流，评估用 `golden_strategy` 盲测，结果写回 skill 的 successRate/pitfalls。
- **决策史可检索**：在 AHE 的 manifest 库上加 outcome 四态 + 历史检索接口（「类似修复是否试过」）。
- **typed 局部修复**：喂给 X-HARNESS0 的组件回滚预研作为类型化方案。

## 5. 与现有模块的边界

- **不新造 skill 演化框架**：复用 SkillOpt（受控编辑）+ AHE（决策记录）+ subagent-core（隔离）。本条是「防作弊隔离 + 决策史检索 + typed 修复」三个增量补丁，叠加在已排期的 P1 skill 卡上。
- **零残留**：入池前产品无痕迹。落点=E（skill 闭环/memory eval）+ X（manifest 增字段）。

## 6. 将来开发要点（捞出指引）

1. **优先做 Creator/Evaluator 隔离**——这是唯一现有卡没有、且自动迭代上规模必踩的防作弊坑。用 subagent-core 权限边界即可起步。
2. **决策史加 outcome 四态 + 检索**：增强 AHE manifest，低成本高价值（避免重复踩坑）。
3. **typed 局部修复**：并入 X-HARNESS0 回滚预研，勿单独造。
4. **盲测口径**：评估队用 golden_strategy 盲测，证据脱敏后回写，防记忆化作弊。

## 7. 关联

- [[可证伪编辑契约 (AHE)]]——决策记录基座，本条增强其 outcome+检索。
- [[skill 受控回写器 (SkillOpt)]]——受控编辑基座，本条加防作弊隔离。
- `docs/backlog/动态技能注入与子技能蒸馏.md`——文档另一半（动态技能解锁），与本条同属「技能工程」。
- [[实验场改造]]（subagent-core）——Creator/Evaluator 隔离的载体。
- [[Harness 论文集精读]]——SkillHone 与 SkillOpt 同属 skill 自进化族。
