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

### Adapter Boundary 设计原则
- **先验证再转换**：adapter boundary 对输入做格式转换（如 namespace、hash、encode）前，必须先按原始契约验证输入合法性。禁止将非法输入转换为合法格式后通过校验（如将任意字符串 hash 为 UUID v4 绕过 UUID 校验）。
- **无法证明归属时 fail closed**：当 endpoint 无法 verifiably 证明请求的资源属于当前上下文（如 workspace）时，返回 404 而非可能泄漏的数据。
- **Express Router 挂载路径重建**：Express Router 挂载在子路径时，`req.url` 是相对路径。委托给匹配完整路径的内部 router 前，必须用 `req.baseUrl + req.url` 重建完整路径。

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

### 连续推进与下一任务提示

- 对有明确总目标或 batch 的工作，Controller 必须维护覆盖完整目标的 checklist，并在每个任务 approved 后立即刷新完成状态。
- 每个任务完成或 review 收口后的用户回复必须同时说明：当前完成项，以及下一个任务的 ID、目标、assignee、依赖状态和领取动作；禁止只报告当前任务完成后结束回复。
- 若依赖已满足且下一个任务尚未创建，Controller 必须在同一收口流程中创建该 Task Bus 任务；若暂时无法创建，必须明确 blocker、解除条件和解除后要创建的任务。
- 只有 checklist 全部验收，或用户明确暂停、终止时，才可以说明“无下一任务”。batch 中仍有 planned 项时，不得以“当前无可领取任务”作为最终结论。
- WorkCanger 吸收批次只有在迁移、全量验收和退役 gate 全部完成后才算结束；单个 Task Bus 任务获批不代表总目标完成。

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

## AgentOps 墓碑代码治理标准

### 目的

防止已经完成短期使命的临时代码进入长期维护或正式交付，同时保护正式回归测试、生产诊断能力和可复用工程资产。

### 强制规则

- “墓碑代码”是已经完成短期使命、但仍遗留在项目中的临时代码，包括一次性测试、调试打印、临时测试接口、写死的假数据和一次性脚本。
- 功能实现并通过正式验证后，必须盘点本轮新增的临时代码，列出所在文件、原用途和删留建议；清理动作必须等待用户确认，并继续遵守目标项目的操作安全规则。
- 应清理已经失去用途的临时代码，但不得误删正式回归测试、生产诊断日志、审计日志，以及具有长期复用价值且用途明确的工具脚本。
- 临时测试接口、绕过权限或校验的入口、可能写入假数据的逻辑，必须作为高风险项优先报告，不得带入正式交付。
- 无法确认代码用途、调用关系或生命周期时，不得猜测或擅自删除；应提供文件、引用或运行证据，说明风险并请求确认。
- 默认只盘点和清理当前任务产生的墓碑代码；历史遗留内容必须作为独立范围进行全局扫描、列清单并单独确认。
- 清理完成后，必须重新运行相关正式测试、typecheck、lint 或最小 smoke 验证，并报告结果和未验证项。

### 使用方式

1. 在功能实现和正式验证完成后，检查本轮 diff、未跟踪文件和运行产物。
2. 按“删除、保留、待确认”分类列出临时代码及证据。
3. 获得用户确认后执行清理，不扩大到未授权的历史遗留范围。
4. 重跑相关正式验证，并在 handoff 或最终回复中报告清理与验证结果。

### 示例

为排查接口问题新增的无鉴权调试路由在问题解决后属于高风险墓碑代码，应先列出文件、用途和删除建议，获得确认后移除并重跑接口回归测试。覆盖该问题的正式回归测试应保留。

### 注意事项

- 目标项目可以设置更严格的删除、验证和审批 gate；更严格的项目规则优先。
- 测试、日志或脚本不能仅凭名称判定为墓碑代码，应根据用途、调用关系、生命周期和维护价值判断。
- 读取其他仓库进行排查不等于获得该仓库的清理权限。

# AgentOps 产品功能前端先行开发标准

## 目的

让业务负责人通过可操作、可视觉验收的前端尽早澄清产品功能，再用真实后端验证数据、规则和技术链路，降低先完成后端后才发现业务理解偏差的返工风险。

核心准则：前端帮助业务负责人想清楚，真实后端帮助证明产品成立；先用前端表达，但不要长时间停留在假数据阶段。

## 强制规则

- 产品功能开发默认先实现可操作、可视觉验收的前端流程，再开发对应后端；不得仅因工程习惯默认后端先行。
- 前端先行阶段必须覆盖核心用户任务、关键页面状态、操作反馈和异常表现，使业务负责人能够通过实际操作确认功能含义与流程。
- 前端流程确认后，必须优先打通一条最小真实数据闭环，不得在真实数据链路尚未验证时继续大范围扩展 mock 页面。
- mock 数据必须明确标注，并遵守目标项目的数据与契约规则；不得捏造业务 ID、枚举值、指标口径、标签或默认值。
- 开发前可以先澄清业务对象、字段语义、输入输出、错误状态和最小 contract；这些是前端开发所需的契约澄清，不视为后端先行。
- 纯后端、基础设施、安全修复、数据迁移或其他没有用户界面的任务，可以不执行前端先行。
- 当数据可得性、算法可行性、性能上限或外部集成是产品能否成立的首要风险时，可以建议后端先行；计划必须列出证据、原因和验证方式，并在实施前获得业务负责人确认。
- 用户或已批准的任务 brief 明确指定后端先行时，按已批准顺序执行。

## 使用方式

1. 在功能计划中先描述可操作的前端验收路径，并列出支撑页面所需的数据、状态和操作。
2. 实现最小前端流程，使用已确认或明确标注的临时数据完成业务验收。
3. 前端流程获确认后，立即实现对应的最小真实后端链路，并用真实数据重新验收。
4. 按同一节奏逐个扩展功能闭环，避免先完成整套前端或整套后端。
5. 如需后端先行，在计划中显式记录适用例外及批准证据。

## 示例

开发运营分析功能时，先提供可操作的筛选、指标卡片、列表、详情和异常状态，让业务负责人确认信息结构与操作路径；确认后立即接入一个真实指标和一条真实查询链路，核对数据来源与计算结果，再扩展其他指标。若首要问题是外部数据源能否访问，则先提交后端可行性验证计划并获得业务负责人确认。

## 注意事项

- 前端先行不是前端全部完成后再启动后端，而是以前端确认业务、以最小真实闭环验证成立。
- 页面展示正确不代表数据正确；接入真实后端后必须抽样核对来源、口径、权限和状态流转。
- 页面字段不要求与数据库字段一一对应；业务负责人确认业务语义，工程实现仍应遵守目标项目的架构和数据契约。
- 目标项目更严格的安全、数据、contract 和审批规则继续生效。

# Worker Delivery Governance

目的：定义所有 AgentOps worker 在开工、实现、验证、handoff 前必须满足的交付硬规则。该策略适用于所有 assignee，不替代产品仓库自己的 `AGENTS.md`、contract、schema 或 domain memory；产品规则更严格时按更严格规则执行。

## 开工前约束矩阵

- 任务涉及 contract、persistence、API、read model、并发或审计时，worker 必须先在工作记录或 `handoff.md` 草稿中写出 constraint matrix，再开始编码。
- constraint matrix 至少包含：brief bullet、invariant family、权威来源、实现位置、正向证据、负向证据、waiver 或 blocker。
- 如果任务同时跨越 schema、application、read model、HTTP、audit、concurrency、UI 等多个 invariant family，worker 必须先反馈“建议拆分”或列出分阶段 acceptance；不得直接把大范围交付合并成一个不可审查 handoff。

## 证据映射

- 每个 brief bullet 必须对应至少一个可验证证据：正向测试、负向测试、命令输出、源码路径或明确 waiver。
- `handoff.md` 中每个“已完成”“已覆盖”“已验证” claim 都必须能 grep 到 test name、源码实现、命令输出或 waiver；grep 不到就不要 claim。
- changes_requested 后，worker 必须先整理完整 blocker checklist，再统一闭环；不得一轮只补一个 reviewer 点名项就重新 handoff。

## Durable Read Model

- Durable read model 必须写 corruption tests，覆盖缺行、多行、错 FK、错 workspace、错 sequence、错 checksum、错数值、非法 JSON。
- read model corruption 必须 fail closed；不得用 fallback、过滤、默认值或 best-effort 映射掩盖 contract drift。
- corruption test 的 fixture 必须真实触发目标 validator 或 mapper；不得被上游 guard 短路后仍宣称覆盖。

## Transaction 与 Idempotency

- transaction、idempotency、retry、locking 或 queue claim 相关任务必须包含 rollback tests。
- 并发相关任务必须包含真实 race-window tests；不得用顺序可见性测试冒充并发测试。
- 外部数据、持久化、HTTP、模型、跨域 adapter 边界默认 fail closed；contract drift 必须作为 blocker 或 `CONTRACT_CHANGE_REQUEST` 暴露。

## Audit 与 Logging

- audit/logging 证据必须断言 exactly-one、`reason_code`、workspace、actor、request、run 以及脱敏字段。
- 只断言“有 audit”“有 log”“写入成功”不算覆盖审计要求。
- audit/logging 的负向路径必须证明失败事务不会留下误导性成功审计；若产品 contract 要求失败审计，则必须断言失败审计的 reason 和上下文。

## Handoff Gate

- `/agentops-handoff-self-audit` 是交付 gate，不是文案步骤；要求执行时，worker 必须把 PASS 证据写进 `handoff.md`。
- self-audit PASS 必须引用可复查证据：test name、文件路径、命令输出摘录或明确 waiver。
- blocked 或 failed handoff 也必须列出已验证项、未验证项、blocker checklist 和下一步所需决策。

## Waiver

- waiver 必须明确说明：对应 brief bullet、无法验证原因、风险、替代证据、谁可以解除 waiver。
- “时间不够”“未执行”“待后续”不是有效 waiver，除非同时给出可复现 blocker 和可执行下一步。
<!-- AGENTOPS:END -->
