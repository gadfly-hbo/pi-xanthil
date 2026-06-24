# 生产失败驱动的产品 Agent 自进化闭环（专家注释 → eval → 约束修改）

> 入池日期：2026-06-23 · 状态：暂缓（方案）· 来源：OpenAI《Building self-improving tax agents with Codex》博客（openai.com/index/building-self-improving-tax-agents-with-codex，2026-05-27）+ Runloop `codex-tax-man` 仓库 + OpenAI Symphony/Harness Engineering 文档 + 用户综述
> 取证说明：**无独立论文**；OpenAI 博客为一手源（站点 403 反爬，经多镜像 + 仓库 + 搜索实证，非脑补）。
> ⚠️ **与现有卡重叠声明**：本条**不重复** [[可证伪编辑契约 (AHE)]]（manifest 约束编辑）/[[skill 受控回写器 (SkillOpt)]]/[[反馈效率度量 (EFC)]]。delta = 把同一套「真实失败→约束修改」纪律从**实验场 harness 自进化（meta 层）**迁到**产品 task agent 自进化（监测/AnaX/工作流）**，并补两个 OpenAI 特有环节：① 生产失败轨迹→eval 数据集自动沉淀 ② 专家注释工作流；bounded-change 部分**复用 AHE**。

## 1. 为什么有这条需求

pi-xanthil 的产品 agent（监测 / AnaX 8 阶段 / 工作流 runner / 数据分析对话）目前**缺「用真实生产失败约束自身改进」的闭环**。现有 report-review / golden_strategy / action feedback / 监测行动环是**离散的专家纠正点**——既没沉淀成 eval，也没驱动 agent 改动。

OpenAI/Thrive 证明：**用真实失败沉淀的测试来约束 Codex 改动，避免无监督优化的不确定性**。实测 7000 returns / 30+ firms，字段完成 **25%→86%（6 周）**，准备时间 -1/3，准确率 up to 97%，吞吐 +50%，攒了 **200+ 专家注释轨迹**。其「bounded change + human gate」正契合 pi-xanthil 红线/可控哲学。

**关键利好（2026-06-23 核对代码）**：监测模块已落位，恰好把闭环前三段都备齐了——**本条只缺最后一段**「纠正→eval 沉淀→约束修改」。

## 2. OpenAI 闭环机制（→ pi-xanthil 监测对位）

1. **完整轨迹记录**：source doc → 带 citation 的抽取字段 → tax engine 映射 → 会计师编辑 → 最终申报值，每步可审计。
   → 对位：监测 run 的 findings **已落库**（`monitor-engine.ts` 纯函数产出，evidence/comparisons 自解释可手工复算）；AnaX/工作流 runner 已发事件。需补**失败轨迹持久化**（findings 已有，agent 轨迹待持久化）。
2. **专家纠正→eval**：重复修正同一字段 → 自动成 targeted eval 数据集（"corrections become gold"），非被动接受。
   → 对位：**监测 finding 生命周期(new/recurring/worsening) = 现成的「重复失败」信号**（`findPriorMonitorFindings` 跨 run 比对）；**监测行动环已复用 actions 三表**（`HealthReportPane`，finding→行动项→采纳→反馈，`reportPath="monitor:${runId}"`）= 现成的专家纠正/采纳捕获点。补「采纳/复发 → eval 候选」。
3. **Codex 收精确 package**：failing trace + new eval set + full codebase + relevant skills + production data samples + expected outputs + eval-runner commands。
   → 对位：复用 AHE 的 ChangeManifest（失败证据/根因/目标修复/预期 delta）作为 package 规格，不重造。
4. **只自动应用 clear/bounded，棘手 edge case 路由人**（human gate）。
   → 对位：pi-xanthil 红线哲学天然契合；风险改动回流总控终审。
5. **四个就绪度问题**（自进化就绪度自检）：① 是否记录完整轨迹 ② 专家能否明确错误环节 ③ 错误能否转测试 ④ Codex 能否在测试约束下稳定修改。
6. **适用面**：边界清晰、错误可专家判定的垂直任务（税务/合规/财务审核）→ **监测正是 pi-xanthil 里最契合的模块**（经营指标偏差/勾稽一致，错误可由分析师判定，finding 结构化）。

## 3. 落到 pi-xanthil（域划分）

| 环节 | 现状 | 改造 | 域 |
|---|---|---|---|
| 失败轨迹 | 监测 findings 已落库；AnaX/工作流已发事件 | agent run 失败轨迹持久化（findings 已就绪） | E |
| 重复失败信号 | **监测 finding 生命周期已有** new/recurring/worsening | 直接消费，无需新建 | E（复用）|
| 专家纠正捕获 | **监测行动环已复用 actions 三表** + report-review/golden_strategy | 加「采纳/标注失败环节 → eval 候选」入口 | D |
| eval 自动沉淀 | 无 | 复发 finding/重复纠正阈值触发 → targeted eval（对接 `*-evaluation-*.ts`） | E |
| bounded 约束修改 | 无 | **复用 AHE manifest + attribute**（E-AHE1），只自动应用 bounded，风险路由人 | E（复用）|
| 契约 | 无 | 生产轨迹 schema + EvalRecord(failing trace→eval target) + 注释状态 | X 总控 |

## 4. 与现有模块的边界（关键）

- **复用而非另起**：bounded-change 复用 AHE manifest；eval 复用现有 evaluation 框架；纠正捕获复用**监测行动环（actions 三表）**+ report-review/golden_strategy；重复信号复用监测 finding 生命周期。本条只补「失败轨迹持久化 + eval 自动沉淀 + 纠正→eval 入口 + 就绪度 gate」。
- **红线❗**：监测已严守 monitor-llm 不碰 rows/draw_data（E-MONITOR8 口径）。本条的轨迹捕获/eval 数据同样**须脱敏**——对接 [[skill-engineering-2026]] 的 Safe Distiller 边界（query skeleton/期望输出，慎留 `draw_data` 原值）。eval 库绝不进真实行级数据。这是最大红线点。
- **vs agent-loop 工作流闭环**（已在池）：那是**运行时** gate 失败回跳重跑（intra-run）；本条是**跨 run** 的 eval-set 驱动改进（OpenAI loop），互补不冲突。
- **零残留**：入池前产品无痕迹。

## 5. 将来开发要点（捞出指引）

1. **首选监测模块试点（已落位，无需等建成）**：监测已备齐 finding 生命周期（重复失败信号）+ 行动环（专家纠正捕获），边界最清晰、错误最易分析师判定——正对 OpenAI「垂直边界清晰任务」结论。监测跑通再推 AnaX/工作流。**真正前置 = AHE manifest(E-AHE1) P0**，而非监测（监测已 done）。
2. **专家纠正复用监测行动环**：在 `HealthReportPane`（行动环）+ report-review 加「采纳/标注错误环节 → eval 候选」轻量入口，勿另造审核台（actions 三表已承接）。
3. **eval 沉淀接现有 evaluation 框架**：复发 finding（recurring/worsening）/重复纠正阈值触发——监测 finding 生命周期已给现成触发信号。
4. **bounded change 复用 AHE**：manifest 作 package 规格 + human gate（只自动应用 bounded，风险路由总控终审）。
5. **红线先做死**：轨迹/eval 脱敏边界（对接 Safe Distiller）先于自动化，杜绝真实数据进 eval 库泄漏。沿用 E-MONITOR8 安全回归口径。
6. **四个问题做成「自进化就绪度」自检清单**：模块满足 4 条才上这套闭环（监测已达标：轨迹有 findings、错误分析师可判、recurring 易转 eval）。

## 6. 关联

- [[可证伪编辑契约 (AHE)]]——bounded-change 纪律基座，本条复用其 manifest，迁到产品 agent（真正前置）。
- [[反馈效率度量 (EFC)]]——eval 质量信号可复用。
- `docs/backlog/动态技能注入与子技能蒸馏.md` / [[skill-engineering-2026]]——Safe Distiller 脱敏边界，本条红线复用。
- `docs/backlog/agent-loop-工作流闭环.md`——运行时回跳（互补，非本条）。
- **监测模块**（wiki『监测』X-MONITOR0~9 / E-MONITOR2 引擎 / `monitor-engine.ts` / `HealthReportPane` 行动环复用 actions 三表，**均 done**）——本条首选试点宿主，finding 生命周期 + 行动环=现成的重复失败源 + 专家纠正捕获点。
- [[Harness 论文集精读]] / [[技能工程落地]]——本条与之同属 agent 自进化大主题，但面向**产品 agent**而非实验场 harness。
