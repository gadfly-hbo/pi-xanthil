# handoff-规则记忆

## 目的
记录 `规则记忆` 模块当前实现状态、关键文件、已完成能力与后续开发建议，便于后续接手继续开发。

## 当前模块结构
`规则记忆` 顶层 tab 下已有二级 tab：

1. `rules`
2. `指标体系`
3. `分析案例库`
4. `trace`
5. `token统计`

定义位置：
- `web/src/App.tsx`
- `web/src/components/MainHeader.tsx`

## 已完成能力

### 1. token统计
已完成 `token统计` 看板：

- 汇总 token / cost / cacheRead / cacheWrite / cacheHitRate
- 按 session 展示明细
- 后端新增 workspace token stats by session API

相关文件：
- `web/src/components/TokenStatsPane.tsx`
- `web/src/lib/api.ts`
- `server/src/db.ts`
- `server/src/index.ts`
- `web/src/types.ts`
- `server/src/types.ts`

### 2. trace 看板
已完成 `trace` tab 的运行追踪看板：

- KPI：今日 sessions / workflow runs / failed events / recent activity
- 最近事件流
- 失败分析
- Session / Flow Timeline 下钻
- Trace 趋势视图
- 搜索 / 过滤
- 规则提炼模块

相关文件：
- `web/src/components/TracePane.tsx`
- `web/src/lib/api.ts`
- `web/src/types.ts`
- `server/src/db.ts`
- `server/src/index.ts`
- `server/src/types.ts`

### 3. trace 数据持久化
新增 `trace_events` 表，用于持久化运行事件。

已采集事件包括：

- `run_start`
- `run_end`
- `error`
- `message_error`
- `agent_step_start`
- `agent_step_end`
- `blackboard_update`

写入函数：
- `addTraceEvent()` in `server/src/db.ts`

事件来源主要在：
- `server/src/index.ts` WebSocket 执行链路

### 4. Timeline 下钻
已完成事件点击下钻：

- `TraceEvent` 增加 `targetKind` / `targetId`
- 新增 `TraceTimelineItem`
- API：`GET /api/workspaces/:id/trace/timeline`

支持目标：

- `session`
- `flow`
- `flow_run`
- `runtime`
- `message`

### 5. 失败分类体系
新增 `TraceErrorType`：

- `validation`
- `path_missing`
- `stream_interrupt`
- `dependency_missing`
- `model_config`
- `runtime`
- `aborted`
- `unknown`

分类函数：
- `classifyTraceError()` in `server/src/db.ts`

失败聚合函数：
- `listTraceFailures()`

### 6. trace 规则提炼
已完成手动规则提炼：

- 用户点击“更新规则提炼”后调用后端生成规则建议
- 规则必须基于真实 trace failures/events
- 返回：`TraceRuleSuggestion`
- API：`POST /api/workspaces/:id/trace/rule-suggestions`

规则建议包含：

- `title`
- `evidence`
- `severity`
- `sourceEventIds`
- `createdAt`

### 7. rules tab 落地
`rules` tab 已从 placeholder 替换为规则管理界面。

已完成：

- 规则列表
- 启用 / 停用
- trace 暂存规则写入 rules
- system prompt 片段预览
- 复制 prompt

相关文件：
- `web/src/components/RulesPane.tsx`
- `server/src/db.ts`
- `server/src/index.ts`
- `web/src/lib/api.ts`

### 8. rule_memories 表
新增 `rule_memories` 表：

字段：

- `id`
- `workspace_id`
- `title`
- `evidence`
- `source`
- `severity`
- `enabled`
- `created_at`
- `updated_at`

相关函数：

- `listRuleMemories()`
- `createRuleMemory()`
- `updateRuleMemoryEnabled()`
- `buildEnabledRulesPrompt()`

### 9. 规则 prompt 输出 API
已完成规则注入准备，但未自动注入执行链路。

API：

- `GET /api/workspaces/:id/rules-prompt`

返回：

```ts
{
  prompt: string;
  count: number;
  updatedAt: number | null;
}
```

prompt 格式：

```xml
<xanthil-rules>
以下规则来自 pi-xanthil 规则记忆，请在执行任务时遵守：
1. ...
   - evidence: ...
   - severity: ...
</xanthil-rules>
```

## 当前主要 API

### Trace

- `GET /api/workspaces/:id/trace/overview`
- `GET /api/workspaces/:id/trace/recent-events?limit=30`
- `GET /api/workspaces/:id/trace/failures?limit=10`
- `GET /api/workspaces/:id/trace/timeline?targetKind=...&targetId=...`
- `GET /api/workspaces/:id/trace/trend?days=14`
- `POST /api/workspaces/:id/trace/rule-suggestions`

### Rules

- `GET /api/workspaces/:id/rules`
- `POST /api/workspaces/:id/rules`
- `PATCH /api/rules/:id`
- `GET /api/workspaces/:id/rules-prompt`

### Token stats

- `GET /api/workspaces/:id/token-stats`
- `GET /api/workspaces/:id/token-stats-by-session`

## 当前未完成模块

### 1. 自动注入开关
下一步建议做：

- 给 Chat / Workflow 执行链路加“启用 rules prompt”开关
- 默认关闭
- 开启时把 `rules-prompt` 拼接到 system prompt / user context 前
- 需要 UI 预览和明确状态提示

涉及位置：

- `web/src/App.tsx`
- `server/src/index.ts`
- `handleSend()`
- `handleSendFlow()`
- `handleExecuteFlow()`
- `handleExecuteMultiAgent()`

### 2. rules 编辑 / 删除
当前 rules 只支持创建、启用、停用。

待补：

- 编辑 title/evidence/severity
- 删除 rule
- 批量启停

### 3. 指标体系 tab
目前仍是 placeholder。

建议方向：

- 维护指标定义
- 维护指标口径
- 与分析案例库 / rules 关联

### 4. 分析案例库 tab
目前仍是 placeholder。

建议方向：

- 存储分析案例
- 存储输入、过程、输出、适用场景
- 与 trace 失败和 rules 形成闭环

### 5. trace 规则去重
当前 trace 写入 rules 时未做语义去重。

建议：

- 同 workspace 下 title 完全相同则避免重复插入
- 后续可做相似度去重

### 6. trace events 清理策略
当前 `trace_events` 会持续增长。

建议：

- 保留最近 N 天
- 或按 workspace 配置保留策略
- 增加 prune API / 后台任务

## 验证状态
最近一次验证：

```bash
cd web && npx tsc --noEmit
cd server && npx tsc --noEmit
```

前后端 TypeScript 均通过。

## 注意事项

- `token统计` 已独立负责 token / cost / cache 命中率，不应在 trace 中重复建设。
- trace 只追踪 pi-xanthil 自身 DB / API / WebSocket 数据，不接 Pi JSONL、OpenCode SQLite 或外部 ptk DB。
- 规则提炼必须基于 trace evidence，不能无依据生成。
- 当前 rules prompt 只支持复制和 API 输出，尚未自动注入执行链路。
