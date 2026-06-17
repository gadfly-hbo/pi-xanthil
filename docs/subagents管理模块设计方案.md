# 计算工具-subagents 管理模块设计方案

> **状态**：方案 · 待排期（2026-06-15）
> **来源**：`pi-xanthil-subagents-management-proposal.md` 对照代码现状的收敛设计。
> **一句话**：把当前硬编码黑盒的 `runDelegatedSubAgent` 重构为「模板化管控 + 复用既有计算工具轨道 + 流式可观测 + 人工可救」的子 agent 引擎；**不新造平行体系，接到三条已有轨道上**。

---

## 0. 总览结论

原 proposal 方向正确，但有三处与 pi-xanthil 现状错位，照搬会造重复轮子或踩数据红线。最适合的做法不是新建体系，而是把子 agent 接到已有的三条轨道：

1. **计算工具** → 复用 `ExtractionTool` 注册表 + MCP 通道（`server/tools/*`、`server/src/mcp/extraction-tools-mcp.ts`）。
2. **模板管控** → 复用 `hooks_mgmt` / `command_mgmt` 同构配置面板模式（`*_CONFIG_PATH` + coerce 白名单 + localhost-only）。
3. **可观测** → 透传已在 `onEvent` 流动的完整 `PiEvent`，经既有 ws 推前端。

---

## 1. 三处必须校正的错位

### 1.1 不能复用「数据探索」前端 duckdb 实例回喂 LLM

proposal 设想「duckdb_query_tool 在前端 Wasm 执行后返回给 Subagent」。这里要分清 AGENTS.md §一的**两层**红线：

- **第一层 · 数据级**：原始明细行禁直接进 LLM；**聚合/衍生产物（不含原始行）允许进 LLM**。即「明细禁、聚合可」——聚合结果回 LLM **本身合法**。
- **第二层 · 模块级**：「数据探索」tab（`web/src/components/DataExplorationPane.tsx` 子树）这个**前端 duckdb 实例**被整体划为 LLM-free 隔离区（它直接握着 `draw_data` 原始明细，用「整模块禁」换零判断成本的安全）。

proposal 的错位**不在「duckdb 算聚合 → 回 LLM」这件事本身**（第一层允许），而在**复用了探索模块那个 LLM-free 前端实例**——那会污染第二层隔离。

**校正**：把 `duckdb_query` 做成一个**独立的服务端 ExtractionTool**（不碰探索模块的前端实例），经既有 `POST /api/extraction-tools/:id/run?source=ai` 执行——这条链路是 AI 工具调用的唯一闸口，配合聚合度护栏（行数上限）在隔离通道里执行第一层「明细禁/聚合可」红线，工具对产物是否含原始行负责。

### 1.2 「计算工具」要新造 —— 底座已存在

proposal 把 `duckdb_query_tool` / `pandas_sandbox_tool` 当新抽象。实际 `ExtractionTool` 已是强类型计算原语（`server/tools/registry.ts:17`）：

- `tool.json` 已带 `riskLevel L0–L3 / allowedUse / forbiddenUse / parameters / resultColumns / traceFields`。
- 已通过 `server/src/mcp/extraction-tools-mcp.ts`（hand-rolled stdio MCP）暴露给 pi session，由 `.mcp.json` + `pi-mcp-adapter` 加载。

**校正**：不要新建并行抽象，把 duckdb / pandas 注册为 2 个新的 ExtractionTool 即可，免费继承风控元数据、trace、评测（`tool-evaluation-runner.ts`）体系。

### 1.3 聚合度拦截散在各工具 —— 应集中在唯一闸口

proposal 想在「任何计算工具输出端」加 >100 行截断。现状 `/api/extraction-tools/:id/run` 没有集中行数护栏，靠「工具自己对产物负责」（AGENTS.md §一）。

**校正**：把行数上限做成该端点 `source==="ai"` 时的**引擎级中间件**——一处改动覆盖所有 AI 工具调用，符合本项目「红线硬编码到引擎底层」偏好，也契合 hooks 哲学（确定性护栏，无需人确认）。超限即截断并回 Agent 强制报错：要求加 `GROUP BY` / `COUNT` 聚合。

---

## 2. 现状基线（proposal 未察觉的存量）

| 现状 | 位置 | 对设计的意义 |
|---|---|---|
| 子 agent 已跑通，痛点属实 | `server/src/index.ts:1675 runDelegatedSubAgent` | 硬编码 systemPrompt（`:1692`）、轮询黑盒、通用 read/write、`failed` 即终止 |
| `onEvent` 已拿到完整 PiEvent 流 | `:1707` | 仅留末条 assistant；可观测=透传已有流，非新建采集 |
| 计算工具 + MCP 闸口已存在 | `registry.ts` / `mcp/extraction-tools-mcp.ts` / `index.ts:4533` | 计算工具直接复用 |
| 配置面板同构模式成熟 | `HooksManagementPane.tsx`(728L)、command_mgmt 设计 | subagents_mgmt 照抄 |
| 技能蒸馏底座已有 | `skill-distillation.ts` / `skill-curator.ts` | proposal「Save as Tool」挂这里 |
| 入口占位待替换 | `web/src/tabs/DataTabs.tsx:67` | `subagents_mgmt` Placeholder |

---

## 3. 产品方案

### 3.1 模板化配置（仿 hooks_mgmt / command_mgmt 同构）

- **配置文件**：`DATA_ROOT/subagents.json`；`config.ts` 加 `SUBAGENTS_CONFIG_PATH`（照抄 `HOOKS_CONFIG_PATH`）。
- **类型**（`types.ts`）：
  ```ts
  interface SubAgentTemplate {
    id: string;
    name: string;
    enabled: boolean;
    persona: string;          // 剥离自 index.ts:1692 的角色 prompt
    toolIds: string[];        // 白名单挂载的 ExtractionTool id
    dataScope: "clean_data";  // 锁死；禁选 draw_data（红线）
    maxRetries: number;       // 自愈上限，默认 3
    source: "custom";
  }
  ```
- **systemPrompt 重构**：`index.ts:1692` 改为「模板 persona + 引擎注入的红线尾注 + 数据域文件清单」三段拼接。**无模板时回退当前默认**，不破坏现状。
- **前端**：`SubAgentManagementPane`（仿 `HooksManagementPane`）替换 `DataTabs.tsx:67` 占位。

### 3.2 计算工具 = 复用 ExtractionTool

- 委派时按模板 `toolIds` 给子 agent 的 `.mcp.json` **只注入选中工具**（细粒度装配，省 token、防越权）。
- 新增 2 个服务端 ExtractionTool：
  - `duckdb-aggregate`：入参仅 `sql`，服务端 duckdb 执行，返回聚合结果。
  - `pandas-sandbox`：受限 Python 片段，复用现有 `python3` runtime + `server/tools/_tool_utils.py`。
- **聚合度护栏**：`/api/extraction-tools/:id/run` 加 `source==="ai"` 行数上限中间件（默认 100），超限截断 + 强制报错文案。

### 3.3 可观测（透传已有事件流）

- `runDelegatedSubAgent` 的 `onEvent` 除留末条外，把 `message_*` / `turn_*` / tool 调用经 ws 推前端（项目已用 Express+ws）。
- 前端卡片（`DelegateSubAgentCard.tsx`）展开为流式 trace：💡思考 / 🛠️工具调用 / 🧮结果 / 📝写报告。**保留轮询作降级**。

### 3.4 HITL 与防跑飞

- `SubAgentTaskStatus`（`types.ts:1133`）加 `waiting_for_help`。
- 工具报错原样喂回触发自愈重试；达 `maxRetries` 不再 `failed`，转 `waiting_for_help`。
- 前端「修正并继续」：人工改 SQL/参数 → 续跑带回正确结果完成后续撰写。

### 3.5 进阶 → 入需求池，产品代码零残留

按需求池约定（`docs/backlog/`），以下先写方案不落产品代码：

- **多 agent 博弈**（Planner/Coder/Reviewer 复合单元）。
- **共享黑板**（口径在并行 agent 间复用）。
- **技能蒸馏 / Save as Tool**（注记可复用 `skill-distillation.ts`）。

---

## 4. 开发计划（P0–P3）

| 阶段 | 交付 | 主要落点 | 验收 |
|---|---|---|---|
| **P0 模板化** | 剥离硬编码 prompt → `subagents.json` + 管控面板 | `config.ts`、`types.ts`、`index.ts:1692,1675`、新 `SubAgentManagementPane.tsx` 替 `DataTabs.tsx:67` | 建模板→委派用其 persona；无模板回退旧默认；typecheck+build 绿 |
| **P1 计算工具挂载 + 聚合护栏** | 按 toolIds 注入 MCP + 行数闸口 | `mcp/extraction-tools-mcp.ts`、`/api/extraction-tools/:id/run` 中间件、新增 `duckdb-aggregate` | 子 agent 只见挂载工具；故意返大结果集被截断报错 |
| **P2 流式可观测** | ws 透传 PiEvent + 卡片 trace | `runDelegatedSubAgent` onEvent、`DelegateSubAgentCard.tsx` | 运行中实时见思考/工具/结果；断流降级轮询 |
| **P3 HITL** | `waiting_for_help` + 自愈重试 + 人工续跑 | `types.ts` status、runner 重试、卡片续跑 UI | 连错达上限转求助；改 SQL 续跑成功 |
| **入池** | 博弈/黑板/蒸馏写 backlog | `docs/backlog/subagents-advanced.md` | 文档存在，产品零残留 |

**红线校验**（每阶段后）：
```bash
# 数据探索子树仍无 LLM API 调用
grep -rE "(generate|chat|extract|clarify|sink|distill).*api\." \
  web/src/components/DataExplorationPane.tsx web/src/components/data-exploration/
# duckdb 计算工具走独立服务端实例、经 source=ai 闸口（人工确认未复用探索模块前端 duckdb 实例）
```

---

## 5. 关键设计取舍

- **为什么 duckdb 走独立服务端通道而非复用探索模块前端实例**：聚合结果回 LLM 本身合法（第一层「明细禁/聚合可」允许）；但探索模块那个前端 duckdb 实例是 LLM-free 隔离区（第二层模块级），复用它会污染隔离。故走独立服务端 ExtractionTool + 聚合护栏，在隔离通道里执行第一层红线。
- **为什么复用 ExtractionTool 而非新抽象**：免费继承 riskLevel/trace/评测/MCP 闸口，最小改动，避免第二套工具治理。
- **为什么护栏放 run 端点而非各工具/各 hook**：唯一 AI 闸口，一处覆盖全部；引擎级硬编码符合项目红线偏好。
- **为什么进阶入池**：博弈/黑板/蒸馏价值未验证、改动面大，按需求池机制保产品干净、方案不丢。
