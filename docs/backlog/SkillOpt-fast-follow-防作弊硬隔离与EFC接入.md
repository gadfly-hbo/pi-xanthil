# SkillOpt fast-follow：防作弊硬隔离 + EFC 真接入

> 入池日期：2026-06-27 · 状态：暂缓（fast-follow）· 来源：E-SKILLOPT1 终审点名的两处设计边界（非阻塞）
> 铁律：入池=产品代码零残留。本文件**不删** E-SKILLOPT1 已交付能力，只沉淀其两处「可硬化」边界的方案，待捞出时增强。
> 关联：[[SkillOpt-skill受控回写器]]（已落地主体）、[[SkillHone-技能打磨决策史与防作弊隔离]]、[[EFC-反馈效率度量]]、[[安全红线-skill沙箱与session敞口]]

## 背景

E-SKILLOPT1（2026-06-27 终审通过）交付了 skill 受控回写器（slow-update 守门 + 严格接受门 + rejected buffer + Creator/Evaluator 沙箱）。终审点名两处**非阻塞但可硬化**的边界，剥离为 fast-follow：

---

## 一、防作弊沙箱：行为级 → 硬隔离

### 现状（E-SKILLOPT1 交付）
`server/src/skill-sandbox.ts` 的隔离 = **行为级 system prompt 红线 + 事后 verify-checker**：
- `buildCreatorSystemPrompt` / `buildEvaluatorSystemPrompt`：往 session prompt 注入「禁止访问 golden_strategy/validator/trace」「禁止写 .pi/skills」文字约束。
- `verifyCreatorIsolation(workspaceRoot, accessedPaths)` / `verifyEvaluatorIsolation(...)`：对 **调用方传入的** `accessedPaths`/`writtenPaths` 做红线路径比对。

### 缺口
1. **无运行时强制**：systemPromptSuffix 只是行为约束，pi session 物理上仍可读 golden_strategy/validator（同 §五.2 draw_data「保护非硬沙箱」姿态）。
2. **verify 是名义的**：`accessedPaths` 由 HTTP 调用方手填（`POST /skill-sandbox/verify` 的 `body.paths`），**没有真实访问日志来源**——若没人喂真实访问记录，checker 永远返回 isolated=true。
3. SkillHone（2606.08671）防作弊的核心诉求是「Creator **物理上看不到** golden/validator，Evaluator **物理上写不了** skill 库」以防测试集过拟合/自证自演——当前未达到。

### 方案（捞出时做）
- **(a) 运行时强制**：给 Creator session 接 `pi-sandbox` 扩展 / 工具限权——denylist 文件读取到 `golden_strategy`/`validator`/`trace` 目录；Evaluator session denywrite `.pi/skills`。复用「数据分析 session 内建工具敞口」同一单点守卫（与 [[安全红线-skill沙箱与session敞口]] 的「给 pi 执行环境装统一单点守卫」合并最划算）。
- **(b) 真实 access log 喂 verify**：从 pi 事件流 / px-hook-runner 轨迹抽 Creator 实际访问的文件路径，喂 `verifyCreatorIsolation`，而非调用方手填——让 checker 成为真实事后审计而非纸面。
- **(c) 兜底**：若硬隔离暂不做，至少把 `verify` 的 paths 来源从「调用方手填」改成「从该 sandbox session 的工具调用 trace 自动抽取」，并在违规时阻断采纳（accept 路由加 verify 门）。

### 触发条件
- 当 skill 自进化要**真自动化**（去掉人工在环、Creator 自动改 skill）时，防作弊从「nice-to-have」升级为「必须」——彼时优先做 (a)。
- 或 [[安全红线-skill沙箱与session敞口]] 的「统一单点守卫」立项时，把本项 Creator/Evaluator 限权一并纳入。

---

## 二、EFC 真接入严格接受门

### 现状（E-SKILLOPT1 交付）
`skill-rewrite-gate.ts:resolveSkillScore` 的 `scoreMetric:"efc"` 分支是 **no-op stub**：

```ts
export function resolveSkillScore(metrics, config): number | null {
  if (config.scoreMetric === "efc") return metrics.score;  // ← 与 evaluation 分支同返回，未用 EFC
  return metrics.score;
}
```

即严格接受门当前永远用 evaluation 综合分判 candidate>current，`scoreMetric:"efc"` 形同虚设。

### 缺口
- E-EFC1（已 done）已给 6 个 runner 的 summary 加了可选 `efc?: EfcScoreDetail`（含 `normalized`/`efc`/`eta`）。held-out 评测 `runSkillEvaluation` 的 `variantSummaries[*].efc` 已可拿到候选的反馈效率分，但 gate 没消费它。
- SkillOpt 论文与 AHE attribute 的接缝本意正是「用 EFC 质量分而非纯 pass/score 判改动好坏」——当前断了。

### 方案（捞出时做，小改）
- `evaluateCandidateSkill` / `evaluateCurrentSkill` 的 metrics 扩展读 `summary.variantSummaries[candidate].efc?.normalized`（或 `efc`）。
- `resolveSkillScore` 的 efc 分支真正返回该 EFC 分；缺失（历史无 efc 字段）时回退 evaluation 分（向后兼容）。
- 严格门逻辑不变（仍「严格大于」），只是换了打分口径。可加单测覆盖「同 evaluation 分、不同 EFC → 接受/拒绝不同」。
- **软依赖** E-EFC1（已满足）。规模：单文件小改 + 1~2 单测。

### 触发条件
- 与「一」(b)/(c) 或下一次 skill 闭环迭代顺手一起做；本项独立、风险低，可随时捞出。

---

## 关联与边界
- 两项都**不改** E-SKILLOPT1 已交付的 MVP 行为（验证门 + 严格接受堵漂移照常工作）；是叠加的「硬化」增强。
- 「一」偏安全（与 [[安全红线-skill沙箱与session敞口]] 同源，建议合并单点守卫一起立项）；「二」偏度量精度（与 [[EFC-反馈效率度量]] / [[AHE-可证伪编辑契约]] 的 attribute-用-EFC 同脉络）。
- 捞出顺序建议：先「二」（小、独立、低风险）→ 后「一」（随统一守卫立项）。
