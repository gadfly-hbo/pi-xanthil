# T0002 Handoff — tool-use v2 cross-domain contract and policy skeleton (rework)

## What Changed

按 review 要求拆分 `eval` 与自动化候选语义，并补充测试：

1. **语义拆分**（`server/src/tool-policy.ts`）：
   - `AUTOMATION_CANDIDATE_EXPOSURES` 仅包含 `mcp` / `command` / `subagent` / `workflow`，不再包含 `eval`。
   - `hasAutomationCandidateExposure` 替代 `hasAutonomousExposure`，`eval` 不再使工具进入自动化候选。
   - `isAiExposedTool` / `isToolBindable` / `listAiExposedToolIds` / `filterAiExposedTools` 均只认 automation candidate 集合；`deprecated` 与 `L3` 工具因此不再出现在自动化候选列表中。
   - `canExposeTo(tool, "eval")` 仍正常工作：`eval` 是合法 exposure，只是不属于自动化候选。

2. **测试补充**（`server/src/tool-policy.test.ts` / `server/src/tool-contract.test.ts`）：
   - 修正 `deprecated` / `L3` 用例：断言 `isAiExposedTool` / `isToolBindable` 为 `false`。
   - 新增 `eval-only` 工具测试：可暴露到 `eval`，但不是自动化候选。
   - 新增 `listAiExposedToolIds` / `filterAiExposedTools` 测试：排除 `deprecated` 和 `L3` 工具。
   - `hasAutomationCandidateExposure` 测试明确 `eval` 返回 `false`。

## Files Changed

- `server/src/tool-policy.ts`
- `server/src/tool-policy.test.ts`
- `server/src/tool-contract.test.ts`

## Validation

- `node --experimental-strip-types --test server/src/tool-policy.test.ts server/src/tool-contract.test.ts` → 24/24 pass。
- `npm run typecheck` → server + web 无错误。
- `npm run build` → 成功。

## Risks

- 旧行为兼容：所有现有 `category=analysis` 且未声明 `riskLevel`/`deprecated` 的工具仍会被 `isAiExposedTool` 选中；仅当 `riskLevel=L3` 或 `deprecated=true` 时才会从自动化候选中排除。
- `eval` 现在被明确排除在自动化候选之外，如果后续有逻辑把 `eval` 当作“可自动调用”入口使用，需要单独检查 `canExposeTo(tool, "eval")`。
- 常量 `AUTONOMOUS_AI_EXPOSURES` 已重命名为 `AUTOMATION_CANDIDATE_EXPOSURES`；如果存在外部引用，需要同步更新（当前仓库内无其他引用）。

## Open Questions

- 后续实现 `/run` adapter 时，是否需要在入口调用 `checkToolPolicy(tool, "eval")` 来显式允许评测调用？
- `web` 侧工具卡片是否需要为 `deprecated` / `L3` 工具显示“不可自动调用”的 visual indicator？
