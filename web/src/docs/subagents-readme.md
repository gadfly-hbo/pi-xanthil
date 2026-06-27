# subagents · 子 agent 体系说明

> **一句话**：把"主对话不该亲自干的重活"派给独立的子 agent 去做，主对话只接收**精炼后的结论**，不被中间过程撑爆上下文。本页讲清它有哪些形态、怎么用、红线在哪。

---

## 1. 为什么要有子 agent

数据分析对话（探索 →「数据分析」）一旦让主 pi session 反复读数据、试 SQL、写长报告，多轮上下文会迅速膨胀、变慢、易跑偏。

统一心智：**开一个聚焦的子 session 干重活，只把结论回流主 session**。主对话上下文始终只吃精炼结论，不吃过程。

入口在「数据分析」对话右侧的 **委派子 agent 卡片**（`DelegateSubAgentCard`）；本模块（控制 · subagents 管理）则提供**模板管理**与**全局运行看板**。

---

## 2. 三种委派形态

| 形态 | 适用场景 | 机制要点 |
|---|---|---|
| **委派单 agent** | 一次性把某个分析子任务整包丢出去 | 全新聚焦 session（无主历史），`pi -p` 单轮自主跑：读数据 → 分析 → 写报告 → 末条作摘要 |
| **复合单元** | 重要/易错的分析，要"先规划、再执行、有人复核" | Planner → Coder → Reviewer 串行；Reviewer 可打回 Coder 重做，带轮次预算防死循环 |
| **fork 分支** | 主对话已经很长，想就地开一条支线深挖 | 分支是一个**真实 session**，复用主对话的多轮收发；结论再回流主 session |

### 2.1 委派单 agent
- 子 agent 只读当前任务的 **020_clean（聚合数据）** 中你勾选的文件，报告写入 **060_reports**。
- 跑法是后台异步（REST 发起 + 看板/卡片轮询进度），完成后落 `summary`（末条结论）与报告路径。
- 可在卡片里选**子 agent 模板**（见第 3 节）与挂载的计算工具。

### 2.2 复合单元（Planner / Coder / Reviewer）
- **Planner**：把 brief 拆成目标 / 可用数据 / 口径假设 / 计算步骤 / 交付清单，不执行计算。
- **Coder**：按计划写 SQL/计算逻辑、产出可审查报告；只输出聚合结果与结论，**禁输出原始明细行**。
- **Reviewer**：按业务规则审查口径、字段、限制条件、是否泄露明细，末尾给出 `REVIEW_DECISION: pass | revise`。
- Reviewer 判 `revise` 则把意见回灌 Coder 重做；`maxReviewRounds`（1–5，默认 2）轮内仍未通过 → 状态转 **waiting_for_help**，交人工。
- 三个角色用**内置模板**（`source: builtin`），不在"模板管理"里编辑。

### 2.3 fork 分支
- 从主对话一键 fork 出分支 session，在小窗里多轮深挖；满意后把结论作为一条普通消息回流主对话。
- 分支不进主任务列表（是子产物，不是独立任务）。

---

## 3. 模板管理（本模块「模板管理」tab）

子 agent 的**角色与权限配置**，真源是 `subagents.json`，图形化增删改：

| 字段 | 说明 |
|---|---|
| `name` / `enabled` | 名称；是否可被 runner 选中 |
| `persona` | 角色 prompt，替换 runner 内硬编码的角色段（引擎红线尾注仍恒定追加，不被覆盖） |
| `toolIds` | 挂载的计算工具白名单；空 = 不挂工具。引擎按 id 与已注册工具求交集 |
| `maxRetries` | 自愈重试上限 0–5；耗尽 → `waiting_for_help` |
| `dataScope` | **只读锁死 `clean_data`**（编译期 + server 双锁，永不放开 draw_data） |
| `source` | `custom`（自建）/ `builtin`（复合单元内置角色，不可编辑） |

保存时 server 二次校验：`id/name/persona` 必填、`persona` 含非 localhost 外链整条拒收、`maxRetries` clamp 0–5、`toolIds` 去重。非法模板会被丢弃并提示。

---

## 4. 共享黑板（Shared Context Blackboard）

同一主 session 下多个子 agent 的**只读共享记忆区**，实现口径复用与业务串联。

- **作用域**：`parent_session`（按当前任务 session 隔离）。
- **存什么**：聚合口径（如"高净值用户=消费>500"）、业务规则、衍生结论、假设、备注——**只存聚合/衍生，禁原始明细行**。
- **怎么用**：黑板条目会自动注入后续子 agent 的 system prompt（限量 + "禁扩写为明细"声明）；成功任务可一键把摘要写入黑板。
- **写入护栏**：超长、像表格行、像 rows/records 数组的内容会被拦下（best-effort，配合 prompt 约束兜底）。

---

## 5. 任务收尾的三个动作

成功的子 agent 任务，在卡片上可做三件事：

- **回流**：把可编辑的摘要 + 报告链接作为一条普通消息发回主对话，由主对话整合、写作、规划下一步。这是"主只吃结论"的关键。
- **写黑板**：把结论沉淀进共享黑板，供同 session 后续子 agent 复用。
- **Save as Skill**：把这次成功的上下文蒸馏为一个 **Skill candidate**（`source: distilled` / `status: candidate`）。**不自动启用、不绕过人审门**——需到「实验场 · Skill Registry」评测后再采纳；当前只固化为 Skill，不自动生成计算工具（ExtractionTool）。

> **自愈重试**：任务因报错/不达标进入 `waiting_for_help` 时，可带「纠正意见 / 修正结果」让子 agent resume 续跑（受 `maxRetries` 约束）。

---

## 6. 运行看板（本模块「运行看板」tab）

只读可观测，纯前端零 LLM、零 draw_data：

- **全局子 agent 任务**：按工作区/状态筛选所有委派任务（running / success / failed / aborted / waiting_for_help）+ trace。
- **工作流 agent 花名册**：把各 flow 的 workflow.json 节点（agent / gate / tool）聚合展示。
- **节点级运行**：`flow_node_runs` 落库后，统计可下钻到"单个 agent 节点跑了几次 / 成没成"，到真 agent 粒度（仅新跑的工作流有此明细，历史补不回）。

---

## 7. 数据安全红线（必读）

- **dataScope 永远锁 `clean_data`**：子 agent 只读聚合数据，编译期 + server 双锁堵死 `draw_data`。
- **禁原始明细进 LLM**：复合单元的 Coder、黑板写入、Save as Skill 蒸馏，一律只允许聚合/衍生内容，禁止把原始行整体回灌。
- **persona 禁外链**：含非 localhost URL 的模板被 server 拒收。
- **回流总控终审**：子 agent 体系的产物变更经总控代码终审后才提交。

---

## 8. 数据存储（db/shared.ts）

| 表 | 存什么 |
|---|---|
| `subagent_tasks` | 单 agent / 复合各角色的委派任务 |
| `composite_subagent_runs` | 复合单元一次编排的整体状态（当前角色、review 轮次、汇总） |
| `subagent_blackboard_entries` | 共享黑板条目 |
| `fork_branches` | fork 分支与父 session 的关联 |
| `flow_node_runs` | 工作流节点级运行明细（看板下钻用） |

---

## 9. 入口速查

- **发起委派 / fork / 复合 / 写黑板 / 回流 / Save as Skill**：探索 →「数据分析」对话 → 右侧委派子 agent 卡片。
- **配置子 agent 模板**：本模块 →「模板管理」。
- **看运行情况**：本模块 →「运行看板」。
</content>
</invoke>
