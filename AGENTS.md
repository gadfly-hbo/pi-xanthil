# pi-Xanthil 项目约定（AGENTS.md）

> 本文件汇总跨 session 必须遵守的工程与数据安全约定。任何 agent 在动手前必须先读本文件。

---

## 一、数据安全分级 ⭐

**这是项目的核心安全契约，违反等同于数据泄漏。**

| 路径类型 / 模块 | 数据敏感度 | LLM 可读 | UI 标识 |
|---|---|---|---|
| `draw_data`（原始数据） | 🔴 最高 | ⚠️ **原始行级内容禁直接进 LLM；经注册工具处理后的聚合/衍生产物（不含原始行）允许进 LLM** | 无需特殊提示（默认不读） |
| `clean_data`（聚合数据） | 🟡 受控 | ⚠️ 允许但需用户知情 | `App.tsx` 中 `CircleAlert` 琥珀色提示 |
| `report`（报告输出） | 🟢 衍生产物 | ✅ 允许 | 无 |
| `business_requirements/`（业务需求） | 🟢 衍生产物 | ✅ 允许 | 无 |
| `presentation_versions/`（汇报版本） | 🟢 衍生产物 | ✅ 允许 | 无 |
| `golden_strategy/`（黄金策） | 🟢 衍生产物 | ✅ 允许 | 无 |
| **「数据探索」tab（`data_exploration`）** | 🔴 最高（直接处理原始数据） | ❌ **永久禁止** | UI 顶部红色安全条 |

工具调用经 `/api/extraction-tools/:id/run`，工具对其产物是否含原始行负责；禁止把 `draw_data` 原始行/明细整体回灌 LLM。

### 数据探索模块硬约束

数据探索模块（`web/src/components/DataExplorationPane.tsx` 及其子树）：

1. **绝对禁止** import 任何 LLM 相关 API：
   - 禁止 `web/src/lib/api.ts` 中 `chat*` / `generate*` / `extract*` / `clarify*` 等任何会触发 server LLM 调用的方法
   - 禁止直接 fetch `/api/*` 中任何会经 LLM provider 的端点
2. **绝对禁止** 把数据内容、列名、字段值、剖析结果、错误日志中的样本片段发送给任何 LLM
3. **永远不要**新增"AI 推荐图表 / AI 解读数据 / 自然语言问数据"等需要把数据送 LLM 的功能
4. 数据计算**纯前端**（duckdb-wasm）；server 端仅提供二进制文件流，零 LLM 调用
5. 后续 Layer 2「自动洞察」如果实现，**只能用纯算法**（相关系数 / IQR / cramer's V 等），不能用 LLM 生成文案
6. 后续 Layer 3「探索 → 业务需求/Chat 联动」**只能单向**：业务需求 → 跳转到探索模块（不带数据回 LLM），**禁止反向**

### 校验方式

完成任何探索模块改动后，必须执行：

```bash
# 校验整棵子树无 LLM API 调用
grep -rE "(generate|chat|extract|clarify|sink|distill).*api\." web/src/components/DataExplorationPane.tsx web/src/components/data-exploration/ 2>&1
# 应无任何匹配
```

---

## 二、通用开发约定

### 回复与代码风格
- 默认中文回复；代码 / 变量 / 注释用英文；技术术语保留英文（prompt / token / workflow）
- 结论优先，不把推理过程放结论前
- TypeScript 优先；避免 `any`；错误处理显式不吞异常
- 只写有意义的注释；不主动添加文件头大段说明

### 操作安全
- 删除 / 覆盖 / 重命名文件前必须先与用户确认
- `rm` `mv` 执行前说明影响
- 新建文件、只读操作直接执行
- 不主动重构整个项目；不安装未确认的依赖
- 不回滚仓库脏工作区中非本任务的改动（视为他人成果）

### 修改前必做
- 先读相关文件、grep 确认结构，不靠记忆假设
- 多文件并行读取，不串行猜测
- 大范围改动前先列变更清单再执行

### 完成标准
- 改动后主动运行 `npm run typecheck` 与 `npm run build`
- 完成后简明说明：改了什么、验证了什么
- Commit 遵循 Conventional Commits（`feat:` `fix:` `chore:`）

### Handoff 流程
- 跨 session 工作通过 `handoff-*.md` 文件交接
- 当前模块 handoff：`handoff-探索.md`、`handoff-规则记忆.md` 等
- session 结束时使用 `handoff-generate` skill 追加新内容到 handoff 顶部

---

## 三、模块边界速查

| 模块 | 入口 tab | 主要文件 |
|---|---|---|
| 探索（含数据探索 / 业务需求 / 黄金策 / 汇报版本） | explore / multi | `App.tsx` + `components/*Pane.tsx` |
| 工作流 | multi | `MultiAgentExecutionPane.tsx` |
| 聚合计算 | aggregate | `AggregatePane.tsx` / `ExtractionPane.tsx` / `SqlConnectPane.tsx` |
| 规则记忆 | rule_memory | `RulesPane.tsx` 等 |
| 实验室 / Anax / Model Lab | research_lab / anax / model_lab | 对应 Pane |

---

## 四、当前活跃约束（2026-06-07）

- 仓库存在大量 modified/untracked 文件，**不要清理或回滚**他人成果
- 全局 `git diff --check` 可能因无关 trailing whitespace 失败（用户已明确跳过），**不要主动修无关文件**
- 业务需求字段级来源引用采用 `sourceRefs` 字段路径 + quote 最小闭环，**不要擅自升级**为字符 offset 定位
- **pi CLI 调用陷阱**：`runPiPrompt()` 不要用 `--no-extensions`（会禁用模型 provider 扩展导致 LLM 调用失败），用 `--no-skills`。`server/src/pi-adapter.ts:165` 已修复。

## 五、AgentOps Task Bus 规则

- `docs/wiki.html` 已被 AgentOps Task Bus 替代，后续不再作为任务真源、任务派发入口、任务状态看板或 session 收尾必更新文档。
- AgentOps/CDI 工作流的任务创建、派发、review、状态流转与收口记录以 `.agentops/tasks/` Task Bus 为准。
- 除非用户明确点名要求修改 `docs/wiki.html`，否则不要在 product iteration、task create/review、session end、commit/push 等流程中读取、更新或校验它。

<!-- AGENTOPS:BEGIN -->
## AgentOps Product Entry

This product is registered in the multi-agent coding system.

- System root: `/Users/huangbo/Dev/AgentOps/coding-system`
- Product overlay: `/Users/huangbo/Dev/AgentOps/coding-system/products/pi-xanthil/AGENTS.overlay.md`
- Routing guide: `/Users/huangbo/Dev/AgentOps/coding-system/docs/agent-routing.md`
- Domain memory guide: `/Users/huangbo/Dev/AgentOps/coding-system/docs/agent-domain-memory.md`
- Cross-project prompt template: `/Users/huangbo/Dev/AgentOps/coding-system/templates/CROSS_PROJECT_IMPLEMENTATION_PROMPT.template.md`

This section does not replace the rules above. Existing product rules remain authoritative for local product behavior. The standard below defines the minimum handoff and approval gates for changes requested across repository boundaries.

## AgentOps 跨项目协调标准

### 目的

当一个项目依赖另一个仓库的持久化变更时，保留目标项目的自治权，同时提供一份可以直接交给目标项目、且不丢失证据、范围、契约、验证和依赖 gate 的实施 brief。

### 强制规则

- 当请求项目需要另一个项目实施代码、配置、schema、模型、contract 或其他持久化变更时，请求项目 Controller 不得代替目标项目直接实施，也不得只给出口头摘要。
- 请求项目 Controller 必须使用 AgentOps 跨项目实施 prompt 模板，输出一段可直接转发给目标项目 Controller 或开发者 agent 的完整 prompt。Prompt 至少包含请求仓库与目标仓库、建议的目标 `domain` 与 `assignee`、权威证据与已批准决定、目标与 non-goals、建议的 `allowed_paths`、约束与执行顺序、验证要求、handoff 格式、contract gate、依赖关系和阻塞处理。
- 请求项目可以建议目标 `domain`、`assignee` 和 `allowed_paths`，但无权替目标项目批准。目标项目 Controller 必须根据目标仓库自身的 `AGENTS.md`、`Orchestration.md`、contracts、路由规则和当前仓库证据确认或调整。
- 目标项目必须使用自身的 Controller 与 worker 生命周期。适用 AgentOps Task Bus 时，任务创建、领取、handoff 和 review 必须发生在目标仓库的 Task Bus。ModelEvol experiment state machine 等项目专属生命周期保持权威，不得被通用 Task Bus 流程替代。
- 请求项目不得把目标项目尚未批准的输出视为可消费 contract。依赖目标变更的下游任务必须保持显式阻塞，直到目标项目 Controller 批准上游 handoff，并明确可供下游消费的 contract、artifact、version、path 或其他证据。
- 如果证据缺失、项目规则冲突、请求超出批准范围、出现 contract drift、验证失败，或目标项目无法采用建议路由，目标 agent 必须停止扩张范围，并把 blocker 交回目标项目与请求项目 Controller 决策。

### 使用方式

1. 确认当前仓库之外确实需要实施变更；建议路由或路径前先读取目标仓库规则。
2. 使用 `templates/CROSS_PROJECT_IMPLEMENTATION_PROMPT.template.md`，填写已验证证据，并显式标记未知项。
3. 通过目标项目 Controller intake 交付 prompt。最终任务拆解、路由、批准和 handoff review 由目标项目 Controller 负责。
4. 把跨项目执行顺序记录为显式依赖。只有目标 handoff 与 contract gate 获批后，请求项目的下游工作才能开始。

### 示例

某产品需要 AgentHarness 新增字段。产品 Controller 引用现有 consumption contract，提出 AgentHarness 目标 domain 与路径建议，并阻塞产品集成任务。AgentHarness Controller 按本项目规则确认路由，完成实施与验证并批准 handoff。产品 Controller 随后记录已批准的 contract 证据，再释放下游集成任务。

### 注意事项

- 读取其他仓库获取证据，不等于获得该仓库的写权限。
- 可转发 prompt 是 intake artifact，不是绕过目标项目 Controller 的授权。
- 项目规则可以设置更严格的 gate；目标仓库规则和项目专属生命周期对其实施保持权威。
<!-- AGENTOPS:END -->
