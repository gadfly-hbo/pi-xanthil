# 需求池（Backlog Pool）

> 探讨过、有方案 / 构思、但决定**暂不开发**的需求，一律先放这里。
> 机制确立：2026-06-11。

## 使用约定

- **位置 / 结构**：本 `README.md`（索引 + 约定）+ 每个需求一份 `<需求名>.md`（完整方案 / 构思 / 重启指引）。
- **铁律（零残留）**：入池需求**不得在产品代码中保留任何残留**——类型字面量 / 导航接线 / 占位文件 / 后端路由全部删干净，`typecheck` + `build` 保持绿。产品维持「该需求从未开始」的状态。
- **生命周期**：
  1. **入池** — 写方案 + 登记本索引 + 清残留。
  2. **捞出** — 读方案按「将来开发要点」接入，状态改「开发中」（进 wiki 任务派发）。
  3. **完成** — 上线后从池移除。
- **为什么**：避免「探讨过的半成品功能空壳长期残留在产品里」——产品干净、方案不丢，两全。

## 在池需求索引

| 需求 | 方案文件 | 入池日期 | 状态 | 一句话 |
|---|---|---|---|---|
| onto-xanthil 全局本体扩展 | [onto-xanthil-全局本体扩展.md](onto-xanthil-全局本体扩展.md) | 2026-06-11 | 暂缓 | 把分析运行时制品（任务/洞察/报告/run/action/eval）对象化并串成 Search Around 血缘 + Action 治理 + 对象级 Trace/Eval 的全局对象图 |
| 安全红线·skill 沙箱 + session 敞口 + pandas 工具 | [安全红线-skill沙箱与session敞口.md](安全红线-skill沙箱与session敞口.md) | 2026-06-27 | 暂缓 | 三项安全红线沉淀：① 代码执行类 skill 的沙箱（A 禁用脚本/B 进程隔离+网络禁用+白名单，须在 skill「可执行」落地前先定红线）；② 数据分析 pi session 内建 bash/read 可达 draw_data 的既有敞口（行为性不披露→评估是否升级硬沙箱）；③ pandas-sandbox 受限 Python 计算工具（攻击面大于 duckdb，待 duckdb-aggregate 落地后判断、前置=run 端点硬锁 clean_data）。三项强收敛=给 pi 执行环境装统一单点守卫；均不阻塞当前功能，重启触发条件见文档 |
| 模拟决策 | （方案待迁入本池） | 2026-06-11 | 暂缓 | 模拟推演 / 决策智能模块（曾设想一级 tab「决策」下 决策看板/工作台/助手/复盘 + `sim/` 推演引擎），已从产品剥离；**2026-06-27 删除 wiki 最后一张「导航/渲染接线」派发卡，代码侧骨架与接缝字面量已无残留（`DecisionTabs.tsx`/Tab `"decision"`/SubTab `decision_board` 等均已移除，仅余无关的 `decision_tree`）**；原方案散见会话与 `decision-intelligence` 记忆，捞出前需补齐方案文件 |
| agent-loop 工作流闭环 | [agent-loop-工作流闭环.md](agent-loop-工作流闭环.md) | 2026-06-13 | 暂缓 | 给工作流 runner 加"gate 失败→带证据回跳上游重跑+预算约束"的反馈闭环，让 DAG 单向流升级为 agent-loop；植入工作流而非另开模块，MVP=SQL 修复 loop。**2026-06-23 增补 §3.5**(Affordance Harness 2605.00663)：诊断式定向纠正(按缺陷类别路由)+benefit/cost 预算路由 |
| subagents 看板 · 节点级运行落库 | [subagents看板-节点级运行落库.md](subagents看板-节点级运行落库.md) | 2026-06-20 | 暂缓 | 工作流节点运行态不落库（只流式广播），新建 `flow_node_runs` 表 + runner 落库，让看板到真 agent 粒度统计；方案 A（流水线级聚合）先做，本条为治本增强排后续 |
| command 场景调用框 | [command-场景调用框.md](command-场景调用框.md) | 2026-06-22 | 已完成 | 2026-06-26 捞出落地甜点档：XanCommand 扩 `toolIds`+`toolParamMap`，command 管理面可绑定 analysis tools，ChatPane 选择带 tools 的 command 时预填并打开 @工具卡；不做独立重型调用框、不自动运行 tool |
| 本体持续积累机制 | [本体持续积累机制.md](本体持续积累机制.md) | 2026-06-22 | 暂缓 | 体检价值 ∝ 本体丰满度，但单开「建本体」任务必烂尾；构思=积累搭已有工作流便车(数据登记 from-aggregation / 分析提条目 / 体检缺口驱动)+正循环(体检产缺口→用户补本体→体检更准)+成熟度治理(draft→active)；不与体检 MVP 绑死，待缺口循环验证后捞出 |
| 反馈效率度量 (EFC) | [EFC-反馈效率度量.md](EFC-反馈效率度量.md) | 2026-06-22 | 开发中(P0·wiki) | harness 论文集精读产出；测评台从「比分数」升级到「比反馈效率」——只给信息量/有效/非冗余/被后续用上的反馈记分(I·V·R·M 乘积)，η=EFC/C_raw 复用 cache-harness token 监控、M_t 接记忆模块；先做规则版 η 验证「同分不同 EFC」，不绑测评台 MVP |
| 可证伪编辑契约 (AHE) | [AHE-可证伪编辑契约.md](AHE-可证伪编辑契约.md) | 2026-06-22 | 开发中(P0·wiki) | harness 论文集精读产出；给实验场每次 harness 编辑附 change manifest(失败证据/根因/预期修好+预期回归任务集)，下轮用实测 delta 取交集打 verdict，把试错升级为可累积因果账本；七类组件对位 4 lab+记忆+工具，attribute 阶段用 EFC 升级；最大缺口=pi-xanthil 无 git 需自有组件级回滚；先只做「人改+手填 manifest+自动对照」半自动，不绑实验场 MVP |
| skill 受控回写器 (SkillOpt) | [SkillOpt-skill受控回写器.md](SkillOpt-skill受控回写器.md) | 2026-06-22 | 已排期(P1·wiki冻结) | harness 论文集精读产出；给「记忆→skill」补受控回写器——优化器把测评打分轨迹转成有界 add/del/replace 编辑，只接受 held-out 严格变好(平手也拒)，三大稳定机制(slow-update 受保护字段去掉跌 22.5 分/rejected-edit buffer/有界学习率 L_t)；先做「验证门+严格接受」堵 skill 漂移，不绑 paradigm A MVP |
| 记忆老化巡检 (AgingBench) | [AgingBench-记忆老化巡检.md](AgingBench-记忆老化巡检.md) | 2026-06-22 | 已排期(P1·wiki冻结) | harness 论文集精读产出；记忆运营态会老化(压缩 W/干扰 R/修订 U/维护 S 四类)且行为测试不可见；用 P1/P2/P3 反事实 oracle 探针归因到写/读/用阶段(同错不同修)，按 profile 定向修复；先做 Dream Worker 夜间「干扰冲突+修订过期」巡检，不绑记忆 MVP |
| 技能打磨·决策史+防作弊隔离 (SkillHone) | [SkillHone-技能打磨决策史与防作弊隔离.md](SkillHone-技能打磨决策史与防作弊隔离.md) | 2026-06-23 | 暂缓 | 腾讯 SkillHone(+20.5pp)；与 AHE/SkillOpt **重叠**，仅沉淀 3 个新增量：①Creator/Evaluator 权限隔离防作弊(现有卡没有,核心)②决策史 outcome 四态+可检索「类似修复是否试过」③typed 局部修复；落 E(skill 闭环)+复用 subagent-core,增强 AHE manifest,不另起框架 |
| 动态技能注入+子技能蒸馏 (Skill Engineering) | [动态技能注入与子技能蒸馏.md](动态技能注入与子技能蒸馏.md) | 2026-06-23 | 暂缓 | 文档「动态技能解锁」+SkillsInjector+技能演化综述；pi-xanthil **全新能力**：胖 context→瘦 context 每步动态注入 2-3 micro-skill(执行效用 Δ 非语义相似+自适应预算+set-aware 渲染)、子技能蒸馏去重多样性(Trace2Skill/SkillX,选技能看 full body)、**Safe Distiller 数据红线**(仅吃 query skeleton/API 拓扑零 draw_data+RulesPane 人审)；落 E(MultiAgentExecutionPane 运行时注入)+D(RulesPane 提案) |
| HarnessX·变体隔离+可组合 harness | [HarnessX-变体隔离与可组合harness.md](HarnessX-变体隔离与可组合harness.md) | 2026-06-23 | 暂缓 | HarnessX(2606.14249)与 AHE 高度重叠；仅沉淀 3 新增量：①**变体隔离/ensemble routing**(冲突编辑 fork 成 per-task 变体而非拒绝,消融+13.6%非降级)②processor-on-8-lifecycle-hooks 可组合基座(对位 px-hook-runner)③确定性 seesaw 无回归门；均为 AHE(E-AHE1)增强；**co-evolution(cross-harness GRPO+模型 RL)超范围**(守改接口不改模型) |
| 生产失败驱动·产品 Agent 自进化 | [生产失败驱动的产品Agent自进化闭环.md](生产失败驱动的产品Agent自进化闭环.md) | 2026-06-23 | 暂缓 | OpenAI 税务 Agent 博客(无独立论文,7000 returns/字段 25%→86%)；把「真实失败→约束修改」纪律从实验场 harness 迁到**产品 task agent(AnaX/工作流/体检)**；delta=①生产失败轨迹→eval 自动沉淀(重复修正成 gold)②专家注释工作流；bounded-change **复用 AHE**、eval 复用现有框架；首选**监测模块**试点(已 done·finding 生命周期=重复失败源·行动环复用 actions 三表=专家纠正捕获点)，真正前置=AHE manifest 而非监测；**红线**=轨迹/eval 须脱敏(对接 Safe Distiller) |
| 轨迹级安全审计 (HarnessAudit) | [HarnessAudit-轨迹级安全审计.md](HarnessAudit-轨迹级安全审计.md) | 2026-06-22 | 已排期(P2·wiki冻结) | harness 论文集精读产出；多 agent 任务完成≠执行安全，违规中途发生且随动作数累积、多 agent SAR 0.91→0.64 集中在信息流/资源；harness 形式化 ℋ(权限 Π/信息流 Φ/协调 Σ)，四类违规 V-OT/OR/IC/ID 后验确定性 checker + YAML 策略规约 + SAR 度量；对位 D/E/V handoff，px-hook-runner 出日志 health-check-engine 做 Judge；先审信息流(V-IC/ID)+默认 hub-spoke，后验非在线，P2 待规模上来捞 |
| 数字锁输出端校验 (MetricVerification) | [数字锁输出端校验-MetricVerification.md](数字锁输出端校验-MetricVerification.md) | 2026-06-25 | 已完成(P1·wiki) | 指标标准层交付后暴露：数字锁(E-METRIC2)只覆盖输入侧 prompt 软约束，模型若篡改 MetricSnapshot 数值系统检测不到；本需求在产出后把回答引用数字与注入 snapshot 做容差回校(ε_ok 0.5%/ε_suspect 20%)，verdict=mismatch 告警；**只打 tool-use 链路**(监测链路是结构化 draft 不复述数值故不适用)，best-effort 非硬门不自动重试；X-MLOCK0(契约+校验核心)+X-MLOCK1(链路接入+ChatPane 告警) 已完成 |
| SkillOpt fast-follow·防作弊硬隔离+EFC 接入 | [SkillOpt-fast-follow-防作弊硬隔离与EFC接入.md](SkillOpt-fast-follow-防作弊硬隔离与EFC接入.md) | 2026-06-27 | 暂缓(fast-follow) | E-SKILLOPT1 终审点名两处非阻塞边界：①**防作弊沙箱=行为级 prompt+事后 verify**(accessedPaths 调用方手填、无运行时强制)，SkillHone「Creator 物理上看不到 validator」未达→方案 接 pi-sandbox/工具限权 + 真实 access log 喂 verify(与「安全红线·统一单点守卫」合并最划算)；②**严格接受门的 efc 分支是 no-op stub**(resolveSkillScore 永远返 evaluation 分)→方案 读 held-out summary.variantSummaries[*].efc.normalized 真接 E-EFC1(小改+单测)；均不改 MVP 行为，捞出建议先②(小独立)后①(随统一守卫立项) |
