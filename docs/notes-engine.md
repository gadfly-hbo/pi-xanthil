# 智能引擎域 · 领域笔记（Agent-E）

> **活文档**：长效领域知识，由 E 持续维护。蒸馏自旧 handoff：`工作流` `AnaX` `实验室` `探索`(对话/skill/业务需求部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

- 最近更新：2026-06-12 · ChatPane fork 分支 + 委派子 agent 前端接入收尾
- 进度：
  - **ChatPane 双能力入口已接入**：输入区上方新增「Fork 分支」「委派子 agent」按钮，禁用态绑定活跃 session；通过 `folderScope.type === "session"` 获取 `sessionId`，未改 `App.tsx`。
  - **fork 分支前端可用**：新增 `ForkBranchPanel`，支持 `POST /api/sessions/:id/fork` 创建分支、`GET /api/sessions/:id/fork-branches` 恢复列表、分支 mini-chat 复用现有 gateway `send` + `GET /api/sessions/:branchSessionId/messages` + `pi_event/run_start/run_end/error` 订阅；分支对话只维护本地 message state，不注入主线 transcript。
  - **fork 回流已接入**：回流弹可编辑摘要框，默认预填分支末条 assistant 文本；可从分支 artifact tree 选择报告路径，只把路径作为文本链接附加；提交后调用主线 `onSend`，作为普通消息进入主 session。
  - **委派子 agent 前端可用**：新增 `DelegateSubAgentCard`，支持 brief、`020_clean` 文件路径勾选、模型选择、`POST /api/sessions/:id/delegate` 后台起跑、`GET /api/sessions/:id/subagent-tasks` 每 3 秒轮询 running 任务、多任务列表、`POST /api/subagent-tasks/:id/abort` 中止、成功结果卡展示 summary/reportPath。
  - **委派结果回流/预览已接入**：reportPath 使用 `GET /api/sessions/:id/artifacts/file?path=...` 文本预览；回流弹预填 summary + 报告路径，提交仍走主线普通 `onSend`。
  - **client API 已补齐**：`web/src/lib/api/engine.ts` 新增 fork/delegate/task 方法，类型只从 `@/types` import，未本地重声明。
- 校验：
  - `npm run typecheck`：✅ 全绿。
  - `npm run build`：✅ 全绿；仅 Vite 既有 chunk size / echarts 动静混合 import 警告。
  - 本次目标域为 engine，未改 data 域；额外执行数据探索 LLM 隔离 grep：✅ 无匹配。
- 下一步：
  - ① 需要在总控/真实后端环境做一次 UI 冒烟：创建 fork → 分支首轮自动 `--fork` 播种 → 分支多轮 → 回流主线，确认主线 transcript 未出现分支中间轮次。
  - ② 需要真实跑一次委派：选择 `020_clean` 路径 → delegate → running 轮询 → success summary/reportPath → 预览报告 → 回流主线；同时确认切 tab / panel 收起后再次打开仍能从 REST 恢复任务列表。
  - ③ 若真实 fork 分支会产出大量 artifacts，后续可考虑在报告选择器里过滤文本/报告扩展名；当前实现读取 artifact tree 全部 file path，只附加路径文本，不读内容。
  - ④ 若需要更强的 UX，可补 mini-chat 运行中 stop 按钮；当前分支发送按钮运行中只显示停止图标但未绑定 abort，避免未经需求扩大行为。
- 阻塞 / 待总控：无代码阻塞；真实 LLM/后端冒烟是否由总控统一执行、是否需要把 fork/delegate 纳入自动化 smoke，需要总控拍板。
- 开放问题：
  - fork 回流的“报告链接”是否要求只允许 `060_reports` / `report` 标准目录下的文件，还是 artifact tree 内全部文件都可选？当前保守实现为“只附加路径文本，不读取内容”，但未做扩展名/目录过滤。
  - 委派任务列表轮询目前只在 `DelegateSubAgentCard` 挂载且存在 running 任务时运行；若要求切到其他 tab 时仍后台刷新 UI 状态，需要总控确认是否把轮询提升到更高层状态管理。

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| 探索·对话 | `ChatPane` `MessageRow` | session 路由(legacy) |
| 业务需求 | `BusinessRequirementPane` `useBusinessRequirementContexts` | `routes/engine.ts`(新) |
| 工作流 | `MultiAgentExecutionPane` `CreationPane` `FlowEditorPane` `WorkflowDagEditor` `DecisionTreePane` `TocPane` `FlowChatPane` `RunOutputPanel` | `multi-agent-runner.ts` `flow-fs.ts` |
| AnaX | `AnaXPane` `HypothesisPane` `ChangeManagementPane` `AnaXReadmePane` | `anax-template.ts` `anax-gate.ts` |
| 实验室 | `SkillLabPane` `ToolLabPane` `ModelLabPane` `ModelBuilder` `OperationalModelPane` | `*-evaluation-runner.ts` `skill-{curator,distillation,retrieval,activation}.ts` `model-lab.ts` `web/src/data/models.ts` |

db 新表建 `db/engine.ts:initEngineTables`；HTTP 走 `routes/engine.ts`；前端方法进 `lib/api/engine.ts`。

> **导航变更（2026-06-10 快修）**：AnaX **一级 tab 已撤销，整体并入「实验室」(research_lab)**。实验室顶部横向 = workflow/skill/tool/model/DLF/**AnaX**；点开 AnaX 时其 4 个二级（工作视图/假设库/变更管理/readme）以**左侧竖栏**呈现。AnaX 4 pane 渲染条件已从 `anax` 改为 `research_lab + {anax_view,hypothesis,change_mgmt,readme}`（见 `EngineTabs.tsx`）；pane 本身与 `anax-template/anax-gate` 后端**逻辑未动**。导航接缝细节见 `notes-infra §四`。

---

## 二、领域约束 / 架构契约

- **每节点 = 独立 pi turn**（spawn 子进程隔离，可重试/可追溯）；节点间数据通过 prompt 里 `{{nodeId}}` 占位符（黑板）传递。
- **WorkflowDef 扩展字段全 optional**（role/icon/color/desc/inputs/layout），默认值由渲染/执行层兜底，向后兼容已有 `workflow.json`。
- **模型硬约束后端统一校验**：`normalizeWorkflowModels` 在 GET/PUT/执行入口校验，前端 prompt 仅辅助。
- **数据文件夹 scope 化**：`workspace_paths` 带 `session_id`/`flow_id`，三级 scope（workspace/session/flow）。
- **强制停止双层**：active handle 优先 + `pgrep`/`lsof` 兜底杀孤儿进程。
- **AnaX 数据安全适配**：data-curator 不读原始数据，改为基于已登记 `clean_data` 聚合数据做 6 维评分（与 `BLOCK_SAFETY` 一致）。
- **skill 落盘项目级** `<workspace>/.pi/skills/<slug>/SKILL.md`（被 `listSkills` 识别为 project skill），不落全局。
- **ChatPane fork/delegate 前端边界**：ChatPane 不能为此改 `App.tsx` 接线；从 `folderScope.type === "session"` 取活跃 session。fork 分支是一个真实 session，前端只复用现有 gateway `send`、`listMessages` 和 `pi_event` 订阅；delegate 子 agent 只走 REST + 轮询。回流一律作为主 session 普通 `onSend` 消息注入，不新增旁路写 transcript。
- **委派数据安全**：子 agent 选择 `020_clean` 文件时，前端只传 `WorkspacePath.path`，不读取文件内容，不把数据样本/列名/剖析结果送入任何前端 LLM 功能。

---

## 三、关键决策沉淀

**工作流**
- Flow `kind: single|multi`（DB 自动迁移 ALTER+DEFAULT）→ 后删单智能体，只留 multi；**更名仅改 label，内部 id `multi`/DB kind 不动**（零迁移）。
- 画布**纯预览只读**（`nodesDraggable=false` 等），所有变更经「pi 对话」自然语言完成。
- `workflow.json` 不存在时从**目录树自动推断节点**（数字前缀排序/单目录包裹展开，标 `inferred:true`）。
- 创建视图三区（架构+进度+对话）；黑板**正名融合**——把唯一真实价值（`{{id}}` 传递关系）显示在执行流节点卡，删重复输出汇总。
- run 文件读写用 **DB run.id**；客户端 `makeRunId` 经 `outputDir` basename 映射。
- 决策树/TOC 图保存为 **HTML**（SVG 无法内嵌系统 CJK 字体 → 字体变形）。
- 流程图库 = `@xyflow/react`（React Flow v12）。

**AnaX**（详见记忆 anax-integration）
- = 预置 flow 模板 `buildAnaxWorkflow()` 9 节点线性 DAG（business→plan→data→data_gate→insight→recommend→review_gate→verify→archive），懒加载物化复用现有 flow 引擎。
- **gate = 节点**：产出 ` ```anax-verdict ``` ` JSON；`evaluateGate` 抽 JSON 后按硬阈值（置信度≥medium/证据≥2/数据质量≥7）**确定性重算 blockers**，模型自报仅参考；缺裁决块=阻断。
- 并行假设 **fan-out**（`FanOutSpec`，concurrency:3 maxItems:12，与 plan 最多 12 假设一致）；假设库飞轮 + 剪枝（>20 条按关键词评分取 top-10）。

**实验室**
- Model Lab 模型定义解耦到 `web/src/data/models.ts`；101 模型 11 分类（**39 个 `auto_gen_model_*` 是模板凑数**，可逐步替换）。
- skill 检索 = **BM25 纯 TS 零依赖**；自主完成用 `--no-skills` + **检索路径注入**（非 system prompt 注入）。
- Archive 导出 = **零依赖内联 TS ZIP 构建器**（存储模式），Blob 下载。
- Workflow 编辑：表单式最小设计器 → ReactFlow 全屏 overlay + 保留表单；节点变更实时同步父状态，无「保存」按钮。
- Pairwise judge repeat 用**多数票聚合**；DB schema 自愈不清理旧 `/tmp` 数据。
- Tool 进 Workflow = 最小 `tool-run` step；tool node 输出进 blackboard，不接 Session artifacts tree。

**探索·对话/skill/业务需求**
- skill 提炼**压成单次 LLM 调用**（A 解构→B 提炼→C 写 SKILL.md 内嵌进一个 prompt），不做链式三次往返；**先预览可编辑再保存**（两个 API）。
- 业务需求来源引用 = 字段级 `sourceRefs` + quote 最小闭环，**不做字符 offset 定位**；业务需求上下文抽成前端共享 hook（Chat/报告版本/Golden Strategy 复用）。
- fork 分支/委派子 agent 的**回流不是特殊消息类型**：前端弹可编辑摘要框，用户确认后调用主线 `onSend`，保持主 transcript 只有用户主动回流的摘要/报告路径；分支中间多轮和子 agent 运行细节不污染主线。
- fork 前端不要回到旧 WebSocket 方案重新设计协议：后端契约已交付为 `POST /api/sessions/:id/fork` + 分支真实 session + 现有 gateway send/messages/pi_event；委派契约已交付为 REST delegate/task/abort + 轮询。

---

## 四、踩坑 / 陷阱

- **pi CLI 调用**：`runPiPrompt()` 用 `--no-skills`，**不要用 `--no-extensions`**（会禁用模型 provider 扩展导致 LLM 调用失败）。见 `pi-adapter.ts`。
- **AnaX 结构块解析必须容忍真实 LLM 格式漂移**：MiniMax 真跑会输出 ````anax-verdict{...}` / ````anax-hypotheses-plan[...]`（marker 后无换行），也可能先在 `<think>` 中复述一个无效示例块，再在末尾输出有效块。解析器必须扫描所有同名 fenced block，跳过无效 JSON，取最后一个有效 JSON；只取第一个 block 会误判 gate/fan-out 失败。
- **AnaX data_gate 不应把分项风险当整体质量硬阻断**：真实数据报告可出现综合评分 8/10，但时效性/口径清晰度等分项 6/10。硬阈值只应卡整体数据质量 stage；分项风险通过 summary/下游硬约束透传，否则会把“可分析但有约束”的数据误杀。
- **AnaX fan-out 上限必须和 plan 假设数量一致**：plan 真跑可能生成 12 个假设；若 `maxItems` 仍是 8，H9-H12 永远不验证，review_gate 会因 evidence=0 / confidence=low 必然阻断。
- **AnaX archive flywheel 只读本轮回复会漏写**：真实 archive 可能把完整 `anax-hypotheses` 写进 `09-archive-summary.md`，但本轮回复只输出摘要，导致 `onBlackboardUpdate("archive")` backfill=0。prompt 已要求本轮回复末尾原样输出结构块；若仍不稳，下一步考虑 runner 从 `specs/09-archive-summary.md` 兜底读取。
- **skill distillation frontmatter 提取不能取第一个 `---`**：真实 LLM 可能在 `<think>` 中输出自查清单、fenced YAML 示例和最终 SKILL.md。`extractSkillMarkdown()` 应优先找最后一个 `--- + name:` frontmatter；否则保存后 `listSkills()` 会识别为 project source 但 `available:false`（缺 description）。
- `scope` 对象字面量每次渲染新引用 → `useCallback([scope])` 重建 → effect 清空画布。根治：Pane 内提取稳定原始值（scopeType/scopeSessionId/scopeFlowId）作 deps，不改 App.tsx 内联写法（项目惯例）。
- 流式响应中断（`Stream ended without finish_reason`）：建议切 MiniMax-M3 重试，长报告分块写文件。
- **onto-extract 文档抽取的两层硬上限**（2026-06-11 hotfix 已调）：①`CONTENT_LIMIT`（字符截断，原 6000 → 现 24000）是真正决定"能不能看到文档后半段"的开关；②prompt 配额（实体/关系/逻辑/动作 ≤N）是次级限制，长文档若超配额会被模型自行裁掉。**所有抽取调优必须双层一起看**，只调一层都不够。
- **onto-extract 分块抽取的"合并几乎免费"**：`processExtractionOutput` 是纯函数 + 已有同名去重（entity nameCn / logic nameCn / link `src|tgt|kind`）+ `resolveId` 模糊匹配，对同一 `ontologyId` 多次调用可天然合并落库。未来要做分块只需在 `extractOntologyFromText` 外层切分 + 串行多次跑 `runPiPrompt` + 逐次喂 `processExtractionOutput`，**不必动质检流水线**。但分块切分本身是难点：按段落边界（双换行/标题）切 + ~200 字 overlap，不要 `slice(0, N)`。
- **onto-extract "按名去重"对编辑不友好**：line 233-241 已存在则 `continue`，后入块即便 description 更富也不会更新。未来要做"以新换旧/取富者"需改这段逻辑；这是分块上线前要先解决的 TODO。

---

## 五、已接入缝变更（时间倒序）

### 2026-06-11：工作流与任务栏正式分离（A 方案）
- **总控主导**。`server/src/db.ts:859` — `listSessions` SQL 加 `AND workflow_id IS NULL`，任务栏不再返回带 workflowId 的 session。
- POST 端点 `workflowId` 参数透传、前端 `api.createSession` 的 `workflowId` 参数、sessions 表 `workflow_id` 列均**休眠保留**（不拆除）。
- `docs/wiki.html:511` done brief 备注同步更新。
- 验收：`typecheck` 绿（仅后端改动）。验证方法：工作流运行后 `/api/workspaces/:id/sessions` 应无 workflow 会话；无 `git` 操作。
- **红线检查**：未碰 `draw_data`/`clean_data`，未删表/列。

---

## 六、未验证 / 历史待办（真实优先级见 KICKOFF-P0）

- ⚠️ **AnaX 8 阶段链路从未真实 E2E 执行**（fan-out/flywheel/gate 全在 fake adapter 下跑通）；喂真实留存聚合数据（综合评分≥7）才跑得出价值，否则必卡 `data_gate` → **KICKOFF P0-C 核心**。
- skill 蒸馏全链路 smoke（提炼→预览→保存→listSkills 出现）未实跑，需验证 LLM frontmatter 稳定性 → P0-C。
- 全量 28/101 模型端到端验证未做；AnaX P3 变更管理 propose/apply + DAG cascade 按需。

---

## 七、P1：Notebook + 语义层消费

- Notebook（SQL/Python/MD 混排）为 E 域 P1。
- 指标语义层 `MetricDefinition`（总控定契约、D 实现）：E 生成 SQL 时**强制引用 metric 口径**，不自造。
