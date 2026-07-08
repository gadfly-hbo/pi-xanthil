# Tool-use v2: explicit exposure policy and run output contracts

## Status

Accepted

## Context

pi-xanthil 的 tool-use 层需要同时支持：

1. 受控的自动化入口（MCP、command、subagent、workflow、eval）。
2. 人工确认入口（控制台、Chat `@工具`）。
3. 数据摄取与数据分析两类不同性质的工具。

在 v1 中，工具权限被隐式绑定到 `category`：`category === "analysis"` 的工具被默认可经所有自动化入口调用，而 `category === "ingestion"` 的工具不暴露给 AI。这带来两个问题：

- `category` 同时描述“工具性质”和“权限边界”，职责不单一。
- 风险等级（`riskLevel`）、输出形态（`row_level` / `aggregate`）、退役状态（`deprecated`）无法对入口做精细阻断。

因此 v2 引入显式 `aiExposure` 和 `outputContract`，把分类与权限拆开。

## Decision

### 1. `category` 只表达工具性质，`aiExposure` 表达权限策略

- `category` 取值 `"ingestion" | "analysis"`。
- `aiExposure` 是多值能力集合：
  - `manual_confirmed`：人工确认入口。
  - `mcp`：经 MCP 暴露给 pi-agent。
  - `command`：可作为自定义 command 的场景工具。
  - `subagent`：可进入子 agent 模板白名单。
  - `workflow`：可作为 workflow 计算节点。
  - `eval`：可进入 ToolLab 评测。
- 显式 `aiExposure` 完全覆盖推导；缺省时按 `category` 保守推导：
  - `analysis` 推导为 v1 等价集合 `manual_confirmed/mcp/command/subagent/workflow/eval`。
  - `ingestion` 推导为空集合。
- 显式 `aiExposure=[]` 表示不进入任何自动化候选。

### 2. `riskLevel` 是 `aiExposure` 的硬安全上限

| riskLevel | 效果 |
|---|---|
| L0 / L1 | 不额外限制 |
| L2 | 从自动化候选中移除 `mcp` |
| L3 | 仅保留 `manual_confirmed` 与 `eval` |

`riskLevel` 与 `aiExposure` 写出冲突组合时，保守过滤并给治理 warning。

### 3. `deprecated` 对自动化入口生效

- `deprecated=true` 的工具从自动化候选中移除，仅保留 `manual_confirmed` 与 `eval`。
- 自动化入口尝试调用时，后端拒绝并返回 `replacementToolId`。
- 控制台人工运行保留迁移期兼容，但 UI 强提示退役与替代工具。
- `replacementToolId` 指向缺失或也已 deprecated 时，registry / 治理 UI 给出 warning。

### 4. `outputContract` 是运行强契约

`outputContract` 字段：

- `tableShape`: `"aggregate" | "row_level" | "unknown"`。
- `llmSafeSummary?: boolean`：显式声明 summary 不含原始行，可被 LLM 安全引用。
- `rowLimit?: number`：行级输出建议上限。

网关行为：

- `row_level` 工具可落盘明细 artifact，但禁止作为 MCP/Chat tool result 正文，也不得被推荐器当成可直接解释的 LLM-safe 输出。
- `unknown` 是迁移期合法状态，但 MCP/autonomous 入口默认不允许，除非 `llmSafeSummary=true` 且非 `row_level`。
- command/subagent/workflow 可绑定但只能自动传递 artifact 元数据，不得把正文注入后续 LLM。

### 5. 标准运行输出 `ToolRunOutput`

`/api/extraction-tools/:id/run` 通过 adapter 把旧 `summary.json` 或试点工具原生输出统一转换为 `ToolRunOutput`：

- `runId`, `toolId`, `toolName`, `status`, `summary`, `metrics`, `artifacts`, `rowGuard`, `errorCode`, `durationMs`。
- `summary` 为 LLM-safe 短摘要，禁止含原始行/明细。
- `metrics` 为确定性 `MetricSnapshot[]`。
- `artifacts` 只暴露 id/title/basename/relPath/kind，不暴露绝对路径，且必须落在本次 run 的 output/report 目录内。

## Consequences

### Positive

- 权限边界从“按工具性质”升级为“显式策略 + 风险上限 + 退役状态”，支持更细粒度的入口控制。
- `outputContract` 成为网关可校验的强契约，row-level 输出不再意外进入 LLM/MCP。
- 旧 `summary.json` 通过 adapter 继续兼容，不一次性迁移全部工具。
- 标准输出结构支持数字锁、运行看板、ToolLab 评测共用同一套元数据。

### Negative

- 早期 manifest 需要逐步补全 `aiExposure` / `outputContract`，否则缺省行为可能偏保守（`unknown` 会阻断 MCP）。
- 前端 ToolUsePane 为展示实时治理状态，复现了后端 `tool-policy.ts` 的过滤逻辑，存在两端同步成本。
- 标准输出摘要的 LLM-safe 约束需要工具开发者遵循，网关只能做 best-effort 校验。

## References

- `server/src/tool-policy.ts`
- `server/src/tool-run-output.ts`
- `server/src/tool-recommendation.ts`
- `server/src/types.ts` / `web/src/types.ts`（`ToolAiExposure`, `ToolOutputContract`, `ToolRunOutput`）
- `docs/backlog/tool-use-治理中枢.md`
- `docs/notes-infra.md` §十五

## Date

2026-07-08
