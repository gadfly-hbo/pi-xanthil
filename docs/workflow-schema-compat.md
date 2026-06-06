# workflow.json Schema 兼容策略

## 目的

`workflow.json` 是工作流模块和实验室评测模块共享的用户可见配置。评测改造期间，schema 演进采用 schema-on-read：新增字段优先写入 `workflow.json`，不新增 DB 列，不迁移历史数据。

目标是让旧 workflow 可以继续读取和运行，同时让新能力逐步通过可选字段启用。

## 使用方式

读取入口必须先调用 `validateWorkflow()` 或通过 `readWorkflow()` 间接校验。执行入口 `runMultiAgent()` 会再次校验，避免无效 workflow 进入半执行状态。

当前必需字段：

- `nodes`: array
- `edges`: array
- 每个 node 必须有非空 `id`
- 每个 node 必须提供非空 `prompt` 或 `label`
- 每条 edge 的 `source` / `target` 必须引用已存在 node

当前兼容字段：

- `version`: optional number
- `defaultModel`: optional string
- `defaultSkillPaths`: optional string array
- `layout`: optional `"sequential"` 或 `"dag"`
- `node.model`: optional string
- `node.role`: optional string
- `node.inputs`: optional string array
- `node.skillPaths`: optional string array
- `node.spec`: optional string
- `node.kind`: optional `"agent"` 或 `"gate"`

旧 workflow 若只有 `label` 没有 `prompt`，执行时继续使用 `label` 作为 prompt fallback。

Skill 字段采用两层 fallback：`node.skillPaths` 优先；未配置时使用 `defaultSkillPaths`。`node.skillPaths: []` 表示该节点显式禁用 workflow 默认 skill。运行入口会用 lenient 模式过滤已删除或不可用 skill，避免旧 workflow 因本地 skill 变化无法执行。

## 示例

```json
{
  "version": 1,
  "defaultModel": "minimax-cn/MiniMax-M3",
  "nodes": [
    {
      "id": "data_review",
      "label": "数据检查",
      "prompt": "检查 {{input.data_path}} 的数据质量",
      "kind": "agent"
    },
    {
      "id": "quality_gate",
      "label": "质量门",
      "prompt": "审查 {{data_review}} 是否满足证据要求",
      "kind": "gate"
    }
  ],
  "edges": [
    { "id": "data_review-quality_gate", "source": "data_review", "target": "quality_gate" }
  ]
}
```

## 注意事项

新增能力必须优先设计为 optional 字段，并在 runner 或 UI 层提供 fallback。只有当旧 workflow 无法明确解释或会导致错误执行时，才允许校验失败。

不把临时评测字段写入 SQL schema。需要回滚 P0/P1 改造时，应保证 `workflow.json` 中未知 optional 字段可被旧版本忽略或手工删除。

涉及破坏性 schema 变化前，必须先增加版本字段处理策略、迁移说明和回滚方案。
