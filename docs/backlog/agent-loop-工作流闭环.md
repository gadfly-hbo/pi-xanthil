# agent-loop 工作流闭环（候选 · runner 执行语义扩展）

> **状态**：暂缓 · 入池 2026-06-13 · 总控持有（runner 契约改动，需 Agent-E 实现）
> **来源**：《Agent Loop Engineering 白皮书》对照工作流模块现状的差距分析（2026-06-13 会话）。
> **零残留**：本需求从未在产品代码起头，入池不涉及清理。

---

## 0. 一句话结论

让"工作流"从 **DAG 单向前向一遍** 升级为 **带预算的反馈闭环**——核心只补一件事：**验证器（gate）失败时，能带着结构化失败证据路由回上游节点重跑，被 `maxIterations` / token / cost 预算约束住，耗尽才升级人工。** 其余 loop 器官工作流已具备。

**落点判断：植入工作流模块，不另开并行模块。** loop ≈ "给 DAG 加一条带预算的反馈回边"，是工作流执行语义的自然扩展；另起模块会重复造 runner/持久化/trace/eval，并制造第二个共享文件冲突黑洞。

---

## 1. 背景：工作流已是 agent-loop 的 ~80%

把白皮书的 loop 能力骨架逐项映射到现有代码：

| Loop 器官 | 现状 | 证据 |
|---|---|---|
| 目标契约 | flow `inputs` | `MultiAgentRunOptions.inputs`（`multi-agent-runner.ts:98`） |
| 执行器/工具 | `kind:"agent"/"tool"` 节点 + 每节点独立 pi session | `multi-agent-runner.ts:385` |
| 产物存储 | blackboard + `specs/` + `gates/` + `FlowRun` 持久化 + runDir | `runMultiAgent` 主循环（:349） |
| **验证器** | `kind:"gate"`：LLM 裁决 + **确定性红线重算** | `anax-gate.ts` `evaluateGate` / `deterministicRedLineCheck` |
| 记忆/上下文 | blackboard（nodeId→输出）+ memory-injection | `memory-injection.ts` |
| 人工闸门 | gate `blocked` → 中断；**手动** `resumeFromNodeId` 续跑 | `multi-agent-runner.ts:429` / AnaX 节点重跑 |
| 评估基建 | `WorkflowEvaluation`（rubric + judge model + repeat） | `types.ts:292` |
| 并行扇出 | `FanOutSpec`：一节点 fan-out 成 N 个并发子 session | `multi-agent-runner.ts:37,558` |

**结论**：目标/执行/工具/产物/验证/记忆/人工闸门/评估/扇出 —— 全有。AnaX 已端到端证明 gate-as-verifier 在工作流里跑得通。

---

## 2. 缺口 = "loop 之所以是 loop" 的那 20%

1. **❌ 反馈回边 / 收敛迭代**：`runMultiAgent` 是 `topoOrder()` 的**单向前向一遍**（`multi-agent-runner.ts:364` `for (const node of order.slice(resumeIdx))`）。gate 只能 **halt-or-pass**——blocked 直接 `return { code:1 }`（:430），**不能**"把 blocker 证据回注 → 回到上游节点重跑直到通过"。
2. **❌ 循环控制器 / 预算**：没有 `maxIterations` / token / cost / time 的收敛守卫。`WorkflowEvaluation.repeat` 是**评估用的独立重跑**，不是收敛迭代。
3. **❌ 决策策略**：没有任何东西决定 continue / retry / switch / escalate。

> 这三项正是白皮书第 1、10、11 节强调的 loop 核心。补齐它们，工作流就成了真正的闭环系统。

---

## 3. 设计草案（最小改动，复用既有三件套）

> **权威口径已落地**：`docs/工作流-onblock契约.md`（T-C3，2026-06-13）。本节为最初草案，边界细节以契约文档为准。

核心思路：**不新建引擎**，复用 `resumeFromNodeId` + `initialBlackboard` + gate verdict，给 gate 节点加一条可选的反馈回边。

### 3.1 类型扩展（`WorkflowNode`，`multi-agent-runner.ts:50`）

```ts
// gate 节点新增可选字段；不配置时行为与现在完全一致（halt-or-pass）
interface GateOnBlock {
  /** blocked 时回退到的上游节点 id（须在本节点之前的 topo 序）。 */
  retryFromNodeId: string;
  /** 收敛上限；达到后不再重跑，按 blocked 真正中断 → 升级人工。默认 3。 */
  maxIterations?: number;
  /** 把 verdict.reasons 写进 blackboard 的哪个 key，供上游节点 prompt 引用。 */
  feedbackVar?: string; // 默认 `${node.id}__feedback`
}
interface WorkflowNode {
  // ...现有字段...
  onBlock?: GateOnBlock; // 仅 kind:"gate" 生效
}
```

### 3.2 runner 主循环改造（`multi-agent-runner.ts:415-432` gate 分支）

blocked 时不再无条件 `return`，而是：

```
gate blocked:
  if node.onBlock && iter[node.id] < maxIterations:
     iter[node.id]++
     blackboard[feedbackVar] = 格式化(verdict.reasons + blockers)   // 结构化失败证据回注
     重置 retryFromNodeId..node 之间节点的 blackboard 条目（避免脏读旧产物）
     跳回 retryFromNodeId 继续执行                                   // ← 反馈回边
  else:
     return { code:1, blackboard }   // 预算耗尽 → 真正中断 → 升级人工（白皮书原则 6/7）
```

实现层面：把当前的 `for (const node of order.slice(resumeIdx))` 顺序遍历，改造成**带"回跳指针"的索引循环**——blocked 且预算未尽时把游标拨回 `retryFromNodeId` 的 index。每个 loop 头节点的 prompt 用 `{{<feedbackVar>}}` 占位读上一轮失败证据（`renderPrompt` 已支持 blackboard 占位，:285）。

### 3.3 预算与停止条件（白皮书第 11 节五类停止）

| 停止类型 | 实现 |
|---|---|
| 成功 | gate `pass` 且无下游 → `code:0`（现状已有） |
| 失败上限 | `onBlock.maxIterations` 耗尽 |
| 成本预算 | 复用 `cache.ts` 的 `trackSessionUsage`，run 级累计 token/cost 超阈值 → abort |
| 风险 | 命中 `deterministicRedLineCheck` 红线 → 直接中断不重试（不允许 loop 绕过数据安全） |
| 人工 | blocked 真中断后落 `gates/<id>.json` + WS `agent_gate`，前端给人工续跑入口（已有 resume 机制） |

### 3.4 trace / 可恢复

- 每轮迭代的产物落 `runDir/<nodeId>/iter-<n>/`，verdict 落 `gates/<id>-iter<n>.json`，保留完整迭代谱系（白皮书第 9/22.4 节"上下文生命周期"）。
- 断线恢复沿用 `FlowRun` + specs/gates 重建（AnaXPane 已有此逻辑）。

---

## 4. MVP 切片（捞出后第一刀）

**SQL 修复 loop**（白皮书 5.1 / 15.3 模板 1，最易体现价值）：

```
plan(生成分析计划) → sql(生成 SQL) → run_sql(tool 节点·执行)
   → sql_gate(kind:gate·校验执行成功/结果非空/字段完整)
        ├─ pass → insight(生成结论) → ...
        └─ blocked → onBlock{ retryFromNodeId:"sql", maxIterations:5, feedbackVar:"sql_error" }
                     （sql 节点 prompt 读 {{sql_error}} 只修复失败部分，不改业务逻辑）
```

只需：① `WorkflowNode.onBlock` 类型 + validate；② runner 回跳逻辑；③ `sql_gate` 的确定性校验器（执行码/行数/字段存在，复用 anax-gate 的确定性范式）；④ 一个预置 flow 模板（仿 `anax-template.ts` 的 `buildAnaxWorkflow`）。

---

## 5. 明确区分：流程内迭代 (A) vs 周期调度 (B) —— 本需求只做 A

白皮书把两类东西都叫 agent-loop，但**正交**：

- **(A) 流程内迭代收敛**（test/SQL/evidence/plan-execute loop）= **执行语义** → 本需求范围，进 runner。UI 落在 `AgentFlowPane` 已有的 `chat | workflow` 二级视图里的**节点编辑器**（给 gate 配 retry+预算），**不需要新 tab、不需要新模块**。
- **(B) 周期巡检 / 后台常驻**（monitor loop / `/loop` / Routines）= **调度维度**（反复触发 vs 一次跑完即止）→ **本需求不做**。将来若做，作为工作流的"运行模式"扩展（手动跑 / 定时跑 / 监控跑），而非独立模块；除非要做跨全产品的统一调度中枢才独立。

---

## 6. 明确不做（捞出时若要做需先推翻）

- **任意 DAG 自由回边 / 通用循环图**：只支持"gate→上游"这一种受控回边，不开放任意 cycle（topo 排序与可终止性会失守）。
- **LLM 自宣布胜利**：停止必须由验证器判定，gate 的确定性重算优先级 > 模型自报 verdict（沿用 anax-gate 现状，白皮书原则 5）。
- **loop 绕过数据安全**：红线（原始数据禁读等）命中即硬中断，不进重试环。
- **B 类调度 / 后台常驻 / cron**（见 §5）。

---

## 7. 将来开发要点（捞出时按此接入）

1. **契约归总控**：`WorkflowNode.onBlock` 字段 + `validateWorkflow` 校验（`retryFromNodeId` 必须在本节点前的 topo 序、`maxIterations≥1`）—— runner 契约改动，总控定义后 Agent-E 实现（遵 `Orchestration.md` §五）。
2. **runner 是 Agent-E 的域**：`multi-agent-runner.ts` / `anax-template.ts` 属 E 域 slot；改 runner 主循环须 E 实现 + 总控终审。
3. **向后兼容**：不配 `onBlock` 的 gate 行为零变化（halt-or-pass），现有 AnaX flow 不受影响。
4. **测试先行**：`multi-agent-runner.test.ts` 已有 fake adapter 注入（`runTurn`/`runTool` 覆盖）—— 用它写"blocked→回跳→第二轮 pass"与"预算耗尽→中断"的确定性单测，无需真实 pi。
5. **预算复用 cache.ts**：token/cost 累计已有，接 run 级阈值即可，勿另造统计。
6. **实跑门禁**：MVP SQL loop 需真实可执行的 SQL 工具节点 + 真实聚合数据验证收敛（吸取 AnaX "fake adapter 跑通≠E2E 验证" 的教训，见 [[anax-integration]]）。

---

## 8. 参考

- 白皮书原文：本次会话输入（§1 定义 / §5 四种 loop / §10 验证器 / §11 停止条件 / §19 设计原则 / §22.4 上下文生命周期）。
- 现有底座：`multi-agent-runner.ts`（runner 主循环 + WorkflowNode + fan-out + resume）、`anax-gate.ts`（gate 验证器范式）、`anax-template.ts`（预置 flow 模板范式）、`cache.ts`（token/cost 追踪）。
- 相关记忆：[[anax-integration]]（gate-as-verifier 已验证 + E2E 未验证的教训）、[[multi-agent-orchestration]]（域归属与接缝契约）。
