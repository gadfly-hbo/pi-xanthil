# skill 受控回写器（SkillOpt）

> 入池日期：2026-06-22 · 状态：暂缓（方案）· 来源：harness 论文集精读（arxiv 2605.23904《SkillOpt: Executive Strategy for Self-Evolving Agent Skills》）
> 铁律：入池=产品代码零残留。本机制是给「记忆→skill」补的**受控回写器**，先沉淀方案，待 paradigm A(skill) 需要「评分自动反哺 skill 文档」时捞出。

## 1. 为什么有这条需求

[[记忆模块 v2.0 补齐]] 缺口 4「记忆→skill」+ [[实验场改造]] paradigm A 已有「skill 沉淀」和「6 测评台评分」，但**缺一座把评分闭环回写进 skill 文档的桥**。手工迭代 skill 文档容易越改越漂、退化无人察觉。SkillOpt 给的正是这座桥：把 skill 当「冻结 agent 的外部状态」，用和权重优化一样的纪律去训练文本——**只接受严格变好的有界编辑**，部署期零额外推理成本。

实测：52 组配置（6 基准×7 模型×3 环境）一致提升 +19~+24.8 分，胜过人工 skill、一次性 LLM 生成、既有 skill 优化法。

## 2. 机制（论文骨架 → pi-xanthil 对位）

### 2.1 skill 文档结构
skill = 执行前插入 context 的自然语言策略文档，含三块：
- **主体内容**（可被 patch 编辑）
- **受保护的 slow-update 字段**（仅 epoch 级元更新可写）
- 可选初始指令短语

产物紧凑：best_skill.md 仅 379~1995 token。→ 对位 pi-xanthil 的 skill 文件（如 px-* skill）。

### 2.2 优化器（独立 frontier 模型，三阶段流水线）
`打分轨迹 → 有界 add/delete/replace 编辑`：
1. **Minibatch Reflection**：轨迹分成功/失败两组，各切 minibatch，优化器逐批分析提编辑；
2. **Hierarchical Merge**：失败侧/成功侧分别合并，再以「失败修正优先」合并；
3. **Ranking & Budget Clipping**：按预期效用排序，裁到 top `L_t` 条。

无梯度，**验证集是唯一门禁**。打分：`(τ(s), r(s)) = h(M,x,s)`，`r∈[0,1]`，harness 记录元数据/消息/工具调用/输出/verifier 反馈——pi-xanthil 测评台已产这些。

### 2.3 三个稳定性机制（按消融重要性排序，**这是该拿的核心**）

| 机制 | 作用 | 去掉的代价(消融) |
|---|---|---|
| **slow/meta 更新** | epoch 末对比新旧 skill 表现，把「哪些编辑有效/被拒/失败持续」写进受保护字段，保住长程规律 | **−22.5 分（最大跌幅）** |
| **rejected-edit buffer** | 被拒编辑入 epoch 本地缓冲，作为负反馈喂下一轮反思 | −1.6~4.6 分 |
| **有界学习率 L_t** | 每步最多应用的编辑数，cosine 衰减（先大改后小巩固） | 无界→−1.8，动态 lr→−5.7 |

**严格接受准则**（Eq.2-3）：候选 skill 只有 selection-split 分数**严格大于**当前才接受，平手也拒：
```
s*_sel = argmax_{s∈C(D_tr)} (1/|D_sel|) Σ r(s)
```

### 2.4 训练循环（Algorithm 1）
```
init s_cur, s_best, caches, rejected-buffer B
for epoch e=1..E:
  从冻结目标模型 M 采 rollout 批 → 切成功/失败 minibatch
  优化器逐批提编辑 → merge & rank → 留 top L_t
  应用候选 s~ → 在 D_sel 评分
  仅当 score_cand > score_cur 接受;否则编辑入 B
  if e≥2: 跑 slow/meta 更新 + 更新优化器记忆
return s_best, test 分
```
批大小鲁棒（rollout 8~整 epoch、minibatch 1~32 仅 ±2 分），增益来自「够多打分证据」而非调参。

## 3. 与现有模块的边界（关键）

- **不改 paradigm A MVP**：现有 skill 沉淀/编辑照常；本机制是叠加的「评分→受控回写」可选管线。
- **复用而非新建**：打分/轨迹/verifier 反馈测评台已产；新增集中在「优化器调用 + 有界编辑应用 + 验证门 + buffer/slow-update 字段」。
- **零残留**：入池前产品无 SkillOpt 痕迹；捞出时作为 hook-eval-core 评分之上的 skill 回写适配器。

## 4. 将来开发要点（捞出指引）

1. **先做验证门 + 严格接受**：最便宜起步——人/LLM 提 skill 编辑，但**强制过 held-out 测评集，平手也拒**。先堵住「skill 越改越漂」，再谈自动优化器。
2. **slow-update 受保护字段不能省**：消融里去掉它跌 22.5 分（最大）。pi-xanthil skill 文件应划出一块「跨 epoch 长程经验」只允许元更新写入，与主体编辑分离。
3. **rejected-edit buffer**：被拒编辑别丢，记成负反馈喂下一轮——低成本、防重复踩坑。
4. **有界编辑预算**：每轮限 top L_t 条编辑（cosine 衰减），防一次性大改炸掉 skill。
5. **与 EFC/AHE 接缝**：SkillOpt 的「打分」可换成 EFC 质量分；其「接受/拒绝」可纳入 AHE 的 change manifest 作为一类编辑的 verdict。三条 backlog 共用同一套测评台证据。

## 5. 关联

- [[实验场改造]]（paradigm A=skill）+ [[记忆模块 v2.0 补齐]]（缺口 4 记忆→skill）——本机制的需求来源与落点。
- `docs/backlog/AHE-可证伪编辑契约.md` / `docs/backlog/EFC-反馈效率度量.md`——同批 harness 论文，共用测评台证据；SkillOpt 管「skill 文档怎么受控演化」，AHE 管「编辑怎么证伪」，EFC 管「用什么分」。
- [[Harness 论文集精读]]——九篇总览与拿来优先级。
