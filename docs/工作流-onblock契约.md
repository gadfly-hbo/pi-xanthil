# WorkflowNode.onBlock 契约（权威口径 · T-C3）

> **总控持有 · 2026-06-13** · 口径只读权归总控,Agent-E 在 T-E1/T-E2 按此实现,**不得改口径**。
> 本文是 onBlock 的**唯一权威定义**;`docs/backlog/agent-loop-工作流闭环.md §3` 与 `docs/工作流模块改造方案.md §4` 的草案以本文为准。

---

## 1. 字段定义

`onBlock` 是 `WorkflowNode`(`server/src/multi-agent-runner.ts`)的可选字段,**仅 `kind:"gate"` 节点生效**:

```ts
interface GateOnBlock {
  /** 回跳目标节点 id。blocked 时执行游标拨回此节点重跑。必须在本 gate 之前的 topo 序。 */
  retryFromNodeId: string;
  /** loop 体最大总执行轮数（含首轮）。默认 3 = 首轮 + 最多 2 次回跳。 */
  maxIterations?: number;
  /** 失败证据回注的 blackboard key。默认 `<gateId>__feedback`。 */
  feedbackVar?: string;
}
```

不配 `onBlock` 时,gate 行为与现状**完全一致**(halt-or-pass),向后兼容。

---

## 2. loop 体与回跳区间

- **loop 体** = topo 序中 `[retryFromNodeId, gateNode]` 闭区间内的所有节点。
- 回跳即重新执行整个 loop 体(从 retryFromNodeId 到 gate)。
- loop 体**之前**的节点不重跑,其 blackboard 产物保留。

---

## 3. 迭代计数与停止

每个 gate 节点维护独立计数器 `iter`(从 1 计,首轮即 1),**不跨 run 持久化**(resume 重启的 run 计数清零)。

blocked 时的判定顺序(**严格按此序**):

1. **红线硬停**:若 `deterministicRedLineCheck` 返回任何 reasons(数据安全红线被触发)→ 立即 `return code:1`,**绝不重试**。红线不可被 loop 绕过。
2. **预算硬停**:若本 run 已超预算(调用 `evaluateRunBudget`,见 T-C4)→ 立即 `return code:1`,不重试。
3. **可重试 block**:verdict 为 blocked(非红线)且 `onBlock` 已配置且 `iter < maxIterations` → `iter++`、回注证据、回跳 retryFromNodeId。
4. **重试耗尽 / 无 onBlock**:`return code:1`,升级人工(沿用现有 gate 中断语义)。

> 对应白皮书五类停止:成功(pass 且无下游)/ 失败上限(maxIterations 耗尽)/ 成本(预算)/ 风险(红线)/ 人工(中断后 resume)。

---

## 4. 失败证据回注（feedbackVar）

回跳前,把本轮 verdict 写入 `blackboard[feedbackVar]`,供 loop 体头节点的 prompt 用 `{{<feedbackVar>}}` 占位读取(`renderPrompt` 已支持 blackboard 占位)。

**格式约定**(E 实现须包含,可微调措辞):

```
## 上一轮门禁未通过（第 N 轮 / 共 M 轮）
- <reason 1>
- <reason 2>
请仅针对以上问题修正，不要改动其他无关部分。
```

`feedbackVar` 是独立于节点 id 的 key,**不参与第 5 节的脏产物重置**(它要跨轮携带)。

---

## 5. 脏产物重置（回跳时）

回跳前,清理 loop 体在上一轮留下的、会污染重跑的产物:

- **blackboard**:删除 `blackboard[nodeId]`,nodeId ∈ loop 体每个节点(让其 prompt 以全新上游重渲染)。**保留** `blackboard[feedbackVar]` 与 loop 体之外节点的条目。
- **specs/**:loop 体节点的 `runDir/specs/<spec>` 在重跑时被新输出覆盖(现有 `writeFileSync` 行为),保留"最新一轮"语义即可,无需手动删。
- **gates/**:gate 裁决按轮存档为 `runDir/gates/<gateId>-iter<n>.json`;`gates/<gateId>.json` 始终为最终轮(终态)。

---

## 6. trace 迭代谱系

- 每轮 loop 体节点产物落 `runDir/<nodeId>/iter-<n>/`(n=该 gate 的 iter 值)。
- gate 裁决按 §5 落 `gates/<gateId>-iter<n>.json`。
- 现有 WS 事件(`agent_step_*` / `agent_gate` / `blackboard_update`)照常发,前端据 iter 展示轮次(T-E3)。

---

## 7. 与既有机制的交互

- **fan-out**:retryFromNodeId 可指向 fan-out 节点;回跳时该节点按现有逻辑重新扇出。若 fanOut.source 在 loop 体之外,其 item 数组 blackboard 保留,重跑读同一批 items(符合预期)。
- **resume**(`resumeFromNodeId`/`initialBlackboard`):允许 resume 进入含 loop 的 flow;计数器随新 run 清零。**约束**:`retryFromNodeId` 应 ≥ resume 起点;若指向 resume 起点之前的节点,回跳会重跑这些节点(覆盖 initialBlackboard),E 实现按 topo index 直跳即可,不做特殊保护(校验期不强制,留作已知边界)。
- **tool / agent 节点**:loop 体内可含 tool 节点(如 MVP 的 run_sql),回跳时正常重跑。

---

## 8. validateWorkflow 校验规则（T-E1 实现）

- `onBlock` 仅当节点 `kind === "gate"` 允许;否则报错。
- `retryFromNodeId` 必须是存在的节点 id,且在本 gate 之前的 topo 序(回边只能向上游)。
- `maxIterations` 若提供须为 ≥1 的整数。
- `feedbackVar` 若提供须为非空字符串。

---

## 9. 明确不做（捞出/扩展前需先推翻）

- **跨多 gate 的嵌套 loop / 任意 cycle**:只支持"单 gate → 单上游"的受控回边,不开放任意循环图(topo 可终止性会失守)。
- **LLM 自宣布收敛**:停止由确定性判定(verdict.blockers / 红线 / 预算 / iter),不靠模型自报已修复。
- **跨 run 持久化迭代计数**:计数器仅本 run 内有效。

---

## 10. 验收（实现侧）

- 不配 onBlock:行为零变化,现有 AnaX flow 不受影响(T-E1 验收)。
- 单测覆盖:① blocked→回跳→次轮 pass;② maxIterations 耗尽→中断;③ 红线命中→不进重试环(T-E5)。
- 参考实现底座:`anax-gate.ts`(verdict/红线)、`cache.ts evaluateRunBudget`(预算,T-C4)、`renderPrompt`(占位)。
