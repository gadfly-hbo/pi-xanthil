# subagents 看板 · 节点级运行落库（候选 · 工作流 agent 真粒度统计）

> **状态**：暂缓 · 入池 2026-06-20 · 总控持有（runner 写路径改动，需 Agent-E 实现）
> **来源**：2026-06-20 会话——「subagents 管理看板无数据」根因排查。用户实测看板空，定性为口径太窄（只统计 `subagent_tasks`，工作流多 agent 走 `flow_runs` 不入此表）。当场定方案 A（流水线级聚合，先落地）+ 本条 C（节点级落库，排后续）。
> **零残留**：本需求从未在产品代码起头，入池不涉及清理。

---

## 0. 一句话结论

工作流里「单个 agent 跑了一次」这个粒度的历史，数据库里**根本没存**——`multi-agent-runner` 的节点运行态只经 `onStepStart/onStepEnd` 流式广播，跑完即逝（产出落 `output_dir` 文件）。要让 subagents 看板/花名册展示**每个工作流 agent 的真实运行次数/成功率/trace**，必须新建 `flow_node_runs` 表并在 runner 落库每个节点运行。

**先做方案 A（已确认）**：读 `workflow.json` 的 `nodes[]` 列花名册 + 聚合 `flow_runs` 流水线级统计，不动表结构、立刻有数据；本条 C 是其治本增强，等确实需要单节点粒度时再做。

---

## 1. 数据现实（排查证据，2026-06-20）

| 维度 | 数据在哪 | 现状 |
|---|---|---|
| Agent 静态定义 | 每个 flow 的 `folder_path/workflow.json` → `nodes[]`（`kind:"agent"`，带 id/label/role），`WorkflowNode`（`multi-agent-runner.ts:69`） | 可读文件解析 |
| 流水线运行记录 | `flow_runs` 表（id/flow_id/inputs/status/started_at/ended_at/output_dir） | 已落库（实测 41 行） |
| **节点级运行状态** | 仅运行时回调 `onStepStart`/`onStepEnd`/`onStepGate`（`MultiAgentRunOptions`，`multi-agent-runner.ts:125-131`） | **不落库**（grep 无 node_status/step_status 表） |

对照：`subagent_tasks` 表（委派子 agent）0 行；`fork_branches` 3 行；`flow_runs` 41 行——用户「用过」的是工作流与 Fork，从没走过 ChatPane 的「委派子 agent」按钮（唯一写 `subagent_tasks` 的路径，`index.ts:1849 /delegate`）。

---

## 2. 缺口 = 节点级运行未持久化

方案 A 只能到流水线粒度（该 flow 跑了 N 次/成功 M），点不到「这个 agent 节点单独跑了几次/成没成」。要真 agent 粒度，缺一张 per-node 运行表。

---

## 3. 候选方案（C·治本）

1. **新表 `flow_node_runs`**：`id / flow_run_id(FK flow_runs) / flow_id / node_id / role / kind / status('running'|'success'|'failed'|'blocked'|'aborted') / started_at / ended_at / output_path?`。索引 `(flow_id, node_id)`、`(flow_run_id)`。
2. **runner 落库**：`multi-agent-runner` 在 `onStepStart` → INSERT running，`onStepEnd`/`onStepGate` → UPDATE 终态。落库走注入式（同 DI 风格，测试可注入假 writer），不在 runner 内直连 db（跨域边界由 index.ts 接线 writer）。
3. **看板数据源**：`listAllSubAgentTasks` 旁增 `listFlowNodeRuns`（只读、JOIN flows 取 workspace_id/flow 名）；前端 `SubAgentBoard` 工作流 agent 卡的运行统计改下钻到 node 粒度 + trace 下钻。

---

## 4. 代价 / 边界

- 改 **E 域核心写路径**（`multi-agent-runner` + index.ts 接线）+ 加表 + 迁移（`db/shared.ts` `CREATE TABLE IF NOT EXISTS` + `PRAGMA` 兼容旧库）。
- **历史补不回**：仅新跑的工作流有节点记录，已有 41 次 flow_run 无 per-node 数据。
- 红线不变：看板纯只读、零 LLM、零 draw_data、不碰数据探索子树。

---

## 5. 触发再启动的条件

当方案 A 上线后，用户确实需要「某个工作流 agent 单独的成功率/趋势/失败 trace」级别的可观测时，再从池中取出本条开发。
