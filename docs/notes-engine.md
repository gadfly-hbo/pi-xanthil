# 智能引擎域 · 领域笔记（Agent-E）

> **活文档**：长效领域知识，由 E 持续维护。蒸馏自旧 handoff：`重复`（曾"工作流"模块，产物仍称工作流/flow） `AnaX` `实验室` `日常`(曾"探索"模块的对话/skill/业务需求部分)。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> **当前任务以 `KICKOFF-P0.md` 为准**；本文件仅供查阅历史决策与踩坑，勿照搬旧"待办"。

---

## 0. 当前状态（session 收尾覆盖此区，不堆叠历史）

> 📌 **v2.2 已发布（2026-06-20，总控）**：2026-06-11→06-20 全域交付已归档进 `docs/wiki.html` CHANGELOG v2.2，v2.1 关闭、2.2 阶段启动。本 §0 工作记录由域 owner 续维护。

- 最近更新：2026-06-26 · **零幻觉·数据可信地基 v2.3 终审完成**（联网/skill 红线、数字锁补洞、因果分层接线）
- 进度：
  - **E-ZH1 四模块联网/skill 红线回归套件**（同 session 前段，已完成）。
  - **E-ZH4 MetricVerification 捏造数字 + 数字-标签错配告警**（同 session 前段，已完成）。
  - **E-ZH5 正式报告因果分层**：
    - `prompt-blocks.ts`：新增 `BLOCK_CAUSAL_LAYERING`（三段式：观察/推断/建议，含禁因果词、三要素、建议挂靠约束），`PROMPT_SCHEMA_VERSION v3→v5`，`assembleSystemPrompt` 新增 `injectCausalLayering` 选项；v5 明确 JSON/fixed schema 场景不得改变 schema，只在字段内遵守分层纪律。
    - `pi-adapter.ts`：`RunPiOptions` / `RunPiPromptOptions` 新增 `injectCausalLayering?: boolean`，透传至 `assembleSystemPrompt`。
    - `causal-layering-check.ts`（新建）：纯正则/结构核验——观察段因果词/推断词检测、推断缺支撑/证伪条件、建议无推断挂靠（孤儿）。零 LLM 调用。
    - `causal-layering-check.test.ts`（新建）：11 测——合规报告 0 findings、观察段越界（因果词/推断词）、推断缺证伪/缺支撑/支撑不引用 #N、建议孤儿（含 bullet/编号）、无分层文本优雅降级、混合合规。
  - **报告入口开启状态**：
    - ✅ 基础设施就绪：`injectCausalLayering: true` 可被任意 `runPiTurn`/`runPiPrompt` 调用方传入，`BLOCK_CAUSAL_LAYERING` 注入 system prompt。
    - ✅ 专题（zhuanti/anax_chat）已接线：`index.ts handleSend` 检测绑定 flow `sourceName === "AnaX 专题"` 时传 `injectCausalLayering: true`；日常 session 不受影响。
    - ✅ 监测（monitor-llm）已接线：`draftMetricSystem` 的 `runPiPrompt` 传 `injectCausalLayering: true`。
    - ❌ 经营报告未接线：当前无独立经营报告入口。
  - **X-ZH9 四模块红线矩阵**：
    - 日常：默认 `skillPaths=[]` → `--no-skills`，`allowWeb=false`；web_search 被 hook guard 拦截。
    - 专题：同日常默认禁 skill/禁 web；AnaX 专题 session 额外启用 causal layering。
    - 监测：`monitor-llm` 启用 causal layering；不授权 web_search。
    - 重复：workflow `allowWeb` 默认 false；仅 UI 显式勾选后 workflow 节点传 `PX_ALLOW_WEB=1` 放行 web_search，fanOut 子任务继承。
- 校验：
  - `node --test`：X-ZH9 关键回归 110/110 ✅（hook red-team、pi-adapter、multi-agent、causal、coverage、reconciliation、metric verification、monitor snapshot）。
  - `npm run typecheck` ✅（server + web）
  - `npm run build` ✅（仅既有 echarts/chunk size warnings）
  - 数据探索 LLM 隔离 grep ✅ 无匹配
- 下一步：
  - **E-COLLECT2 浏览器验收**（上次遗留）：知识库→收集 tab 实跑。
  - **可选真实 smoke**：带 analysis 工具真实工作区跑 chat/flow chat，确认数字锁段注入与 metric_verification 告警 UI。
  - **Chat「引用全文」UI 开关**：需总控审接缝（`ClientMessage.injectKnowledgePrompt` 字段语义扩展）。
- 阻塞：无。
- 开放问题（需总控）：同上次 6 条（资料刷新口径、E-METRIC2 覆盖范围、E-KB4 触发口径/阈值参数化、E-PROMPT1 占位空值、记忆 skill 阈值）。

> 本区只反映"现在"；历史在 `git log`。每次 session 收尾**覆盖**此区，不堆叠。

---

## 一、域范围与文件地图

| 子模块 | 前端 | 后端 |
|---|---|---|
| 日常·对话 | `ChatPane` `MessageRow` | session 路由(legacy) |
| 业务需求 | `BusinessRequirementPane` `useBusinessRequirementContexts` | `routes/engine.ts`(新) |
| 重复（工作流/flow 产物） | `MultiAgentExecutionPane` `CreationPane` `WorkflowDagEditor` `DecisionTreePane` `TocPane` `RunOutputPanel` | `multi-agent-runner.ts` `flow-fs.ts` |
| AnaX | `AnaXPane` `HypothesisPane` `ChangeManagementPane` `AnaXReadmePane` | `anax-template.ts` `anax-gate.ts` |
| 实验室 | `SkillLabPane` `ToolLabPane` `PromptLabPane` `ModelLabPane` `ModelBuilder` `OperationalModelPane` `LabOverviewPane` `RegressionDashboardPane` `eval-shared/*` | `*-evaluation-runner.ts` `*-evaluation-api.ts` `skill-{curator,distillation,retrieval,activation}.ts` `lab-timeline.ts` `regression-gate.ts` `model-lab.ts` `web/src/data/models.ts` |

db 新表建 `db/engine.ts:initEngineTables`；HTTP 走 `routes/engine.ts`；前端方法进 `lib/api/engine.ts`。

> **模块命名映射（2026-06-18）**：展示文案以 `Orchestration.md §〇` 为权威：`explore` 模块显示为「日常」（曾"探索"），`multi` 模块显示为「重复」（曾"工作流"）；但 `数据探索`、`对话探索`、EDA 探索性分析、workflow 引擎、`workflow.json` 与工作流/flow 产物名保持不变。本次 E 文案点改只处理指代入口模块的用户可见文案和邻近注释，保留“新建/运行/删除工作流”等产物操作语义。

> **导航变更（2026-06-18 专题迁移）**：AnaX 已从「实验室」(research_lab) 提升到一级「专题」(zhuanti) tab。专题二级 tab 使用 `ZHUANTI_SUB_TABS`：`anax_chat`（对话探索）、`anax_view`（流水线）、`hypothesis`、`change_mgmt`、`readme`。`EngineTabs.tsx` 中 AnaX 四个已有 pane 只挂在 `zhuanti + {anax_view,hypothesis,change_mgmt,readme}`；实验室渲染分支只保留 `workflow/skill/tool/model/DLF`。pane 本身与 `anax-template/anax-gate` 后端逻辑未动。导航接缝细节见 `notes-infra §四`。

---

## 二、领域约束 / 架构契约

- **每节点 = 独立 pi turn**（spawn 子进程隔离，可重试/可追溯）；节点间数据通过 prompt 里 `{{nodeId}}` 占位符（黑板）传递。
- **WorkflowDef 扩展字段全 optional**（role/icon/color/desc/inputs/layout），默认值由渲染/执行层兜底，向后兼容已有 `workflow.json`。
- **模型硬约束后端统一校验**：`normalizeWorkflowModels` 在 GET/PUT/执行入口校验，前端 prompt 仅辅助。
- **LLM→JSON 解析统一入口（2026-06-14 快修2.1）**：所有把 LLM 输出转结构化 JSON 的链路一律走 `server/src/index.ts` 的 `parseJsonObject` / `extractJsonObject`，二者已内置字符串感知的 `repairLooseJson()` 兜底（剥 `//`、`/* */` 注释 + 尾逗号；字符串内的 `//`、`,]` 受保护不误伤）。解析顺序 `原文 → 切片([首{,末}]) → repair 切片`；**禁止在各 LLM 功能里各自直接 `JSON.parse`**。最终仍无法解析时抛带原文片段的领域错误（如 `LLM response is not valid JSON: <前300字>`），不得让裸 V8 `SyntaxError` 冒泡成 500。新增 LLM 链路复用此入口，配合既有 `repairJsonObject`（二次 LLM 修复）兜底。
- **数据文件夹 scope 化**：`workspace_paths` 带 `session_id`/`flow_id`，三级 scope（workspace/session/flow）。
- **强制停止双层**：active handle 优先 + `pgrep`/`lsof` 兜底杀孤儿进程。
- **AnaX 数据安全适配**：data-curator 不读原始数据，改为基于已登记 `clean_data` 聚合数据做 6 维评分（与 `BLOCK_SAFETY` 一致）。
- **skill 落盘项目级** `<workspace>/.pi/skills/<slug>/SKILL.md`（被 `listSkills` 识别为 project skill），不落全局。
- **skill progressive disclosure（2026-06-15）**：支持目录形态 `<skill>/SKILL.md + scripts/ references/ resources/`。`listSkills()` 只发现每个目录的 `SKILL.md`，命中后不展开子目录；`retrieveSkills()` 的 BM25 文档只允许使用 `name + description + SKILL.md` 首屏摘要（当前正文摘要上限 2400 chars），禁止把子资源或整篇长正文纳入检索。命中后注入给 pi 的仍是 `SKILL.md` 路径，由 pi 按文内相对路径懒加载子资源。
- **skill registry 生命周期（2026-06-14）**：内容真源仍是 `<workspace>/.pi/skills/<slug>/SKILL.md`，`skill_registry` 只存元数据/生命周期态。`status` 为 `draft|candidate|active|archived`；归档只更新 status 并关闭当前 workspace 的 enablement，**不删除文件**。版本链用 `version + supersedesId`，沿用 RuleMemory 的“留档可回滚”范式。
- **skill package 跨端搬运（2026-06-16）**：MVP 采用 server 内部 JSON 包 `format:"pi-xanthil.skill-package"` / `formatVersion:1`，不先扩双侧 `types.ts` 接缝。导出端点 `POST /api/skill-registry/:id/export` 只导出非 archived skill 的 `<workspace>/.pi/skills/<slug>/` 普通文件（含 `SKILL.md` 与子资源，跳过隐藏文件/目录和 symlink）。导入端点 `POST /api/workspaces/:id/skill-registry/import` 校验 slug 与每个相对路径，写入 `<workspace>/.pi/skills/<slug>/...`，创建 `source:"imported"`、`status:"candidate"` registry entry 并写 version snapshot；**不自动 active、不覆盖既有 skill**，slug 冲突时自动分配唯一 slug。所有路径必须经 `sanitizeSkillSlug` + `resolve`/`startsWith` 围栏；后续 marketplace/订阅/签名/审计是 P2+。
- **skill package 前端类型裁决（2026-06-16 缺口2-D）**：`SkillPackage` 与 `SkillImportResult` 类型保留在 `web/src/lib/api/engine.ts` 作为 E 域内部类型，不扩双侧 `types.ts` 接缝。理由：包格式是 E 域内部契约，不应污染全局类型空间。前端 UI 通过 `api.exportSkill`/`api.importSkill` 消费，组件内用 `Parameters<typeof api.importSkill>[1]` 做运行时 cast 即可。
- **导入弹窗 UI 模式（2026-06-16 缺口2-D）**：弹窗采用 `fixed inset-0 z-50 + stopPropagation` 全屏遮罩模式（与既有 viewing modal 一致），双通道输入（file input 读文本回填 textarea + 直接粘贴 JSON），提交前仅 `JSON.parse` 防呆，包结构/路径安全全交后端。slug 冲突时展示「已改名为 X」提示（`requestedSlug !== entry.slug`）。错误在弹窗内独立红条显示，不复用主面板 `error` state（遵循 P1-B 已沉淀的"弹窗内独立 errorState"范式）。
- **skill 连续评测与回归检测（2026-06-16）**：`skill_registry_eval_history` 是 registry skill 历史分真源，记录每次评测的 `score/activationRate/model/trigger/version/evaluationId` 及与上一轮同 slug 历史的 delta；`skill_registry` 只保留最近回归状态摘要（`regression_status/reason/delta/last_evaluation_id`）供治理提示。回归默认阈值：`scoreDrop >= 0.1` 或 `activationRateDrop >= 0.2`；请求体可覆盖。`POST /api/skill-registry/:id/evaluate` 会写历史并回写 registry；创建/rollback 出 active 新版本时，若已有历史 evaluation，则沿用上一轮 model/tasks/repeat/context 自动重测；无历史不启动模型调用。`POST /api/workspaces/:id/skill-registry/retest-active` 是手动重测全部 active 与模型升级手动触发入口。该能力只检测回归，不修改 skill 内容、不替代 D 域治理 UI、不重造 A 的生产激活遥测。
- **G 卡可观测面板架构（2026-06-16）**：面板纯前端渲染，不发起任何 API 调用。数据来源：① 生产激活率 ← `SkillRegistryEntry.prodActivatedCount/prodInjectedCount`（A 卡字段）；② 评测期省 token ← `SkillEvaluation.variantSummaries` 中 baseline vs variant(=该 skill 的 registry id) 的 `avgTotalTokens` 差求和（ROI 口径：只算 active skill，覆盖度单独展示）；③ 回归数 ← `SkillRegistryEntry.regressionStatus === "regression"`（C 卡字段）；④ 时间线 ← `GET /api/workspaces/:id/skill-registry/eval-history`（C 卡历史表）。子组件 `ObservabilityDashboard.tsx` 从 `SkillManagementPane.tsx` 拆出，遵循既有 modal 子组件模式（`CreateSkillModal`/`EvalSkillModal`）。ROI 数据需从 `api.listSkillEvaluations(workspaceId)` 拉评测列表，按 `entry.lastEvaluationId` 匹配 `evalDoc.variantSummaries`，不新增端点。
- **G 卡重测交互模式（2026-06-16）**：`retestAllActive` 用 `window.confirm` 弹窗（显示 active 数、tasks×2 调用估算、模型名、evalSet 名），与既有 archive/rollback 风格一致。端点强依赖 `model+tasks` 必填（经 `parseSkillEvaluationRunRequest` 校验，repeat/judgeRepeat 1–5），triggerKind 仅识别 `model_upgrade`，否则归为 `retest_all_active`。前端复用首个 evalSet 的 tasks，缺评测集时降级到 `DEFAULT_EVAL_TASK`。
- **G 卡子组件拆分踩坑（2026-06-16）**：工具长字符串有总长上限——单次 Write/Edit 大段 TSX（含中文+JSX+多层嵌套）会被截断成 "Unterminated string"。解决方案：先用 Write 极简骨架（stub 函数 + void 标记防 unused 报错），再多次小段 Edit 逐函数替换，最后用 `cat >>` heredoc 追加尾部组件。**未来任何 >200 行的 TSX 新文件都应先写骨架再分块 Edit，不要试图一次 Write 完整文件。**
- **skill description 触发词优化（2026-06-16，curation v2）**：`skill-curator.ts` 在既有评测 curation prompt 中新增 description 优化维度，输入证据来自两类：① A 生产激活遥测中 `prodInjectedCount >= 3 && prodActivationRate < 0.4` 的 active registry skill；② 本次 evaluation 中非 baseline variant 且 `activation.activated=false` 的 case。prompt 要求优先判断是否只改 frontmatter `description`，让 description 覆盖任务类型、关键词、数据/场景信号与负例边界；输出仍是完整 SKILL.md 的 `SkillCurationProposal`，走既有 proposal queue + 人审 apply，不自动改文件、不自动 active。当前未新增 proposal category 字段，避免扩大接缝；如前端需要单独展示 description 优化，后续再扩。
- **skill 自进化人审门（2026-06-14 P1 A）**：`candidate` 表示待评测/评测中/低分候选，评测达阈值后自动转 `draft`，`draft` 在 skill registry 语境中表示“达标待人审采纳”。`active` 必须由人审 PATCH 触发；`source=distilled|curated` 置 active 需 `confirmed=true`，禁止全自动 active。
- **skill 自进化触发口径（2026-06-15 更新）**：普通 pi 任务结束仍**不会 inline 自动产 skill**；新增的自动沉淀是**可调度 sweep**：`POST /api/workspaces/:id/skill-auto-distill` 扫近期完成 session，读取 transcript，跑 `buildSkillDistillationPrompt()`，用 `extractSkillMarkdown()` 清洗，经过 slug/文件/BM25 去重后，落 `<workspace>/.pi/skills/<slug>/SKILL.md` + version snapshot，并创建 registry `source="distilled"`、`status="candidate"`、`originSessionId=session.id`。它不接会话结束 seam，不自动 active，不绕过 distilled/curated 的 `confirmed=true` 人审门。**日常-数据分析的手动「沉淀为工作流」/「沉淀 skill」按钮及对应后端端点（`promote-to-flow` / `distill-skill` / `save-skill` + `compileSessionWorkflow` / `buildPromoteTranscript`）已于 2026-06-18 整体移除**（功能不再需要）——蒸馏新 skill 现仅走 auto-distill sweep 与覆盖缺口蒸馏（E 卡），均经 `distillSkillCandidate` 守人审门。curation 仍只在「实验室 skill 评测」跑完后生成改进提案，不创建新 skill、不落盘。
- **skill auto-distill 调度入口 = 手动一键按钮（2026-06-15 定，撤销定时）**：MVP 调度入口最终选**手动按钮**，不用 cron/`/loop` 定时（session-only 本地定时每日节奏天然易错过、且自动跑会无人值守烧 LLM 额度）。`SkillManagementPane`(D 域前端)工具栏加「自动沉淀」控件组：**limit 下拉(1/3/5，默认 3)** + **模型下拉(默认=继承 pi 配置，否则从 `ctx.models` 按 provider 分组，与 ChatPane ModelSelect 一致)** + 按钮 → `engineApi.runSkillAutoDistill(workspaceId, { limit, model })`(`web/src/lib/api/engine.ts`) → `POST /api/workspaces/:id/skill-auto-distill`(since 仍用端点默认近 7 天)；返回 `SkillAutoDistillResult`(双侧 web types)，前端弹结果横幅(扫描/新增/跳过/失败 + 新候选 slug)并 `refresh()`。注：sweep 后端是 `for..of + await` **顺序执行**非并发，limit 只是单次处理上限/成本闸。**会真实调 LLM 蒸馏，故必须用户显式点击**，不自动触发。后端端点/逻辑/人审门/去重一字未改，只换触发方式与参数入口；`SkillManagementPane` 新增 `models: PiModel[]` prop(DataTabs 传 `ctx.models`)。
- **skill 覆盖缺口检测（2026-06-16，E 卡）**：缺口检测只负责“发现哪些近期任务反复出现但无高分 skill 命中”，不负责创建新路径。`skill-coverage-gap.ts` 对 session user task 文本调用现有 `retrieveSkills()`，以 `matches.length===0 || topScore < lowScoreThreshold` 判定负空间信号，再用 token overlap/Jaccard 做轻量聚类。默认扫近 14 天、最多 20 个 session，`lowScoreThreshold=1.0`、`minClusterSize=2`、`clusterSimilarityThreshold=0.25`。`POST /api/workspaces/:id/skill-coverage-gaps` 只读返回建议列表；`POST /api/workspaces/:id/skill-coverage-gaps/distill` 把选中 cluster 编成“低命中任务样本” transcript，复用 B 的 `distillSkillCandidate()` / `buildSkillDistillationPrompt()` / duplicate check / registry candidate 写入链路。产物仍是 `source:"distilled"`、`status:"candidate"`，不自动 active、不绕过人审门。前端 `SkillManagementPane` 只展示只读建议 + 手动“蒸馏”按钮；本次不进治理队列、不新增持久化表。
- **skill 查看/编辑 UI（2026-06-15，D 域 SkillManagementPane）**：① **只读查看**——点名称或操作列「查看」按钮，弹只读 modal 显示 SKILL.md（`getSkillVersionContent` 读版本快照，无快照的老条目给提示不崩）。② **版本更新两模式**：`beginUpdate` 现**载入当前 SKILL.md 原文**到编辑框（非空白模板；无快照回退模板），即「修改原文模式」；CreateSkillModal 在编辑态新增「AI 改写」框——填修改说明 + 选模型 → `POST /api/workspaces/:id/skill-revise`（`buildSkillRevisionPrompt`+`SKILL_REVISE_SYSTEM_PROMPT`，对请求体 `content` 做最小修改、`extractSkillMarkdown` 清洗、返回内容**仅预览不写盘**）→ 回填编辑框，用户可再手改后走既有「保存为新版本」。两模式都不绕过版本链/人审门。usage 记 `targetKind:"skill"`（双侧 TokenUsageTargetKind 新增）。真实 smoke：revise 最小修改、保 name/结构 ✅。
- **skill registry 启用与 usage 口径**：创建 registry entry 后调用 `enableForOrigin(workspaceId, "skill", id)`，归档调用 `setMemoryEnablement(... false)`。`usageCount` 当前表示“被注入路径使用过”，不是模型真实激活；flow chat 显式 `skillPaths` 与 workflow `defaultSkillPaths/node.skillPaths` 会按 registry path 匹配后累加。
- **skill 生产激活遥测（A 卡，2026-06-15 总控直做完成）**：`skill_registry` 加 `prod_injected_count`/`prod_activated_count` 两列（`db/shared.ts`，NOT NULL DEFAULT 0 + 存量库 ALTER 补列），双侧 `SkillRegistryEntry` 加 `prodInjectedCount`/`prodActivatedCount` 及**派生** `prodActivationRate`（`mapSkillRegistryRow` 算 `activated/injected`，injected=0 时 `null`，不落列）。语义独立于评测分与 `usageCount`：这两列只记**生产真实运行**的注入/激活，`activationRate`(评测)与 `usageCount`(注入埋点)口径不变、不被覆盖。写入：`db/engine.ts` `recordSkillActivationOutcome(id, activated)`(prod_injected+1 / 激活则 prod_activated+1) + `recordSkillActivationForRun({workspaceId, workspaceRoot, skillPaths, output})`(按 `.pi/skills/<slug>/SKILL.md` 映射回 registry、过滤归档、用 `detectSkillActivation` 的 evidence.skillPath 集判每 skill 激活)。**接线点 = run 完成、成功且非 abort 的三条生产链路**：flow chat(`routes/engine.ts handleSendFlow`，output=capturedText)/ workflow(`handleExecuteMultiAgent`，output=各节点 blackboard 拼接)/ autonomous(`autonomous-runner.ts runAutonomousTask`，output=末条 assistant)。**关键边界：`runMultiAgent` 同被 `evaluation-runner.ts` 调用，故只在 routes 生产处接，不进 runner，评测口径不污染**。createSkillRegistryEntry 的 INSERT 未列这两列、靠 DEFAULT 0，未改写入；usage 注入埋点 `recordSkillRegistryUsageForPaths`(注入时点)保留不动。
- **skill registry 去重/冲突边界（2026-06-14 P1 A）**：`/api/workspaces/:id/skill-registry/conflicts` 只做即时 BM25 相似度计算，过滤 archived，不自动归档、不落冲突表。返回结构按 RuleConflict 风格给 B/D 展示“疑似重复/建议归档”，最终处理仍走人审。
- **自动沉淀去重 BM25 阈值不归一化（2026-06-18 质量1裁决）**：`findAutoDistillDuplicate`（auto-distill sweep 与 coverage-gap distill 共用）仍使用 BM25 raw score 做相似度排序，但自动阻断判据已改为**只与 `active` skill 比较，跳过 `candidate`**。原因：candidate 本就是待人审候选，互相撞车不应阻断继续产出；这能消除“超级 candidate skill 万能近邻”造成的新候选误跳过。默认 `duplicateThreshold` 已从临时 `100` 回调到 `50`。同 slug / 同路径文件已存在仍硬跳过。`/skill-registry/conflicts` 是人工治理展示端点，本次保留非 archived 全部参与的展示口径；如要支持“只看 active”需另开 UI/接口筛选。长期若 active 超级 skill 仍误杀，再排期做 BM25 归一化，不要继续简单上调 raw 阈值。
- **workflow skill 子集配置（2026-06-14 P1 C）**：`WorkflowDef.defaultSkillPaths` 是 workflow 级 fallback；`node.skillPaths === undefined` 继承 workflow 默认，`node.skillPaths = []` 明确禁用默认 skill，非空数组则只注入该节点专属子集。runner 的权威逻辑是 `node.skillPaths ?? workflow.defaultSkillPaths`。
- **ChatPane 抽屉化布局契约（2026-06-14，2026-06-15 polish）**：三个助手面板（Fork/@工具/委派）不再内联在 composer 列，改为 ChatPane 内部右侧可调宽抽屉。ChatPane 根容器横向 flex（左主列 flex-1 + 右抽屉 shrink-0），不动 App 布局、不动成果面板、不动后端。抽屉宽度 clamp [360px, 容器 60%]，localStorage 持久化（key `chatpane.assistDrawerWidth`），零新依赖；拖拽和 mount/window resize 必须共用同一 clamp 逻辑，避免已存大宽度在窄屏把主列压没。ForkBranchPanel 满高 flex 列（去 max-h-[360px]），分支 tabs/输入 shrink-0，会话区 flex-1 overflow-y-auto。抽屉头是三助手标题唯一显示位置，子组件内不再重复标题；ManualAnalysisToolCard / DelegateSubAgentCard 在抽屉内通过 `embedded` 态去自身外层 border/rounded/bg/padding，避免边框套边框，默认非嵌入 card 样式保持不变。
- **委派抽屉响应式契约（2026-06-22）**：`DelegateSubAgentCard` 的 embedded 模式必须使用单列 `minmax(0,1fr)`，所有 grid/select 子项显式 `min-w-0`，防止 native select 的 min-content 把 360–460px 抽屉撑宽；非 embedded 卡才保留 `md` 双列。`SkillSelector` 默认 `up+left` 供 ChatPane composer 使用，embedded 委派卡显式用 `down+left`，下拉宽度上限为 `min(20rem, 100vw-2rem)`；指定 skill 的 trigger 必须放在三态按钮下方独立行，不能与 tooltip/按钮挤在同一行。
- **ChatPane fork/delegate 前端边界**：普通日常 chat 仍从 `folderScope.type === "session"` 取活跃 session；专题 `anax_chat` 是明确例外：`folderScope` 传 `{type:"flow", flowId}`（让 clean_data/report/数据 tab 按专题 flow 作用域），但 ChatPane 的 session 工具（@工具/Fork/委派）走 `activeSessionId`，默认只从 `folderScope.type==="session"` 推断 → flow scope 下取不到 → 三按钮禁用。**故 flow scope 复用 ChatPane 必须显式传 `sessionId` prop**（`ChatPane:273 activeSessionId = p.sessionId || folderScope 推断`），专题传 `zhuantiChatSessionId`；卡3 初版只传 folderScope+disabled、漏传 sessionId 致三按钮禁用，2026-06-18 总控快修补上（clean_data 加载 `ChatPane:337-344` 早已支持 flow scope，故只缺 sessionId 一处）。send/runtime 仍由 App 层独立 zhuantiChat* 状态驱动。fork 分支是一个真实 session，前端只复用现有 gateway `send`、`listMessages` 和 `pi_event` 订阅；delegate 子 agent 只走 REST + 轮询。回流一律作为主 session 普通 `onSend` 消息注入，不新增旁路写 transcript。
- **CollectPane 复用 ChatPane 边界（2026-06-25 E-COLLECT2）**：知识库「收集」是专属 collect session 的 ChatPane 复用，不重写聊天 UI、不新增消息协议。联网能力由 App/X-COLLECT0 的 `onCollectSend(... collectWeb:true)` 保证，CollectPane 只消费 `TabContext.collect*`。assistant 级「存为资料」走 `ChatPane.renderMessageAction` 可选插槽 + `MessageRow.action` hover 操作区扩展，默认不传时普通 chat 行为零变化；保存资料只调 D 域既有 `api.createKnowledgeDoc` / `POST /api/workspaces/:id/knowledge`，不得新增 E 后端或绕过知识库入库校验。后续类似「专题 seed」「收集存资料」这类消息级局部动作，优先复用可选 action 插槽，不要把动作状态塞进 `UiMessage` 或扩 `ClientMessage`。
- **Fork 分支路径作用域回退父 session（2026-06-14 快修2.3）**：fork 分支是独立 session、名下无注册路径。`handleSend` 解析输出/数据路径时必须把作用域回退到父任务 session：`pathScopeSessionId = forkBranch ? forkBranch.parentSessionId : session.id`，用于 `buildRegisteredPathContext` 的 `sessionId` 与 `fallbackOutputDir`。否则 `output-paths.selectOutputPath` 逐级回退（scoped report→scoped clean_data→workspace report→workspace clean_data）会坍缩到 workspace 级最近 clean_data 源目录，导致分支产物写到数据源目录而非任务 `060_reports`。数据安全不受影响：fork 继承的是父 clean_data，`draw_data` 仍被 `buildRegisteredPathContext` 排除且永不作为输出目标。
- **委派数据安全**：子 agent 选择 `020_clean` 文件时，前端只传 `WorkspacePath.path`，不读取文件内容，不把数据样本/列名/剖析结果送入任何前端 LLM 功能。
- **subagent ↔ skill 绑定（F 卡，2026-06-16；X-ZH10 收口 2026-06-26）**：`SubAgentTaskInput.skillPaths?` 入口仍接受三态解析，但生产委派执行口径已改为默认禁用：请求未带 `skillPaths` 时由 `runSubAgentTurn` 兜底为 `[]`，最终进入 `runPiTurn` 生成 `--no-skills`；显式 `[]` 同样禁用；非空数组表示仅注入指定 skill 子集。delegate 端点(`index.ts /api/sessions/:id/delegate`)用 `skills.ts` 的 **`parseRequestedSkillPaths(workspaceRoot, value, {mode:"strict"})`** 解析（数组守卫 + 可用性校验，复用 `validateSkillPaths`）→ 透传到 `runDelegatedSubAgent` → `runSubAgentTurn` 默认兜底 → `runPiTurn({skillPaths})` 经 pi-adapter `--no-skills --skill` 注入，无新注入机制。前端 `DelegateSubAgentCard` 复用 `SkillSelector` + `skillMode`；只有用户显式勾选的 skill 才成为白名单。子 agent **成功完成后调 `recordSkillActivationForRun`**，激活进 A 生产遥测（与 flow/workflow/autonomous 同口径）。
- **委派模版前端契约（2026-06-22）**：`DelegateSubAgentCard` 只读既有 `api.listSubAgents()` 并仅展示 enabled 项；默认项用空字符串表示，提交时转 `undefined`，保持引擎内置 persona 的旧行为。指定项只透传既有 `SubAgentTaskInput.templateId`，不得从 `SubAgentTemplate` 臆造 model 字段。模版负责 persona + extraction tool allowlist，卡内 model + skillPaths + dataFiles 与其正交、允许叠加；session 切换必须重置选择，避免把上一任务模版误带入新 session。`templateId` 已由 task 持久化并供 resume/retry 恢复，前端不得在续跑时用当前下拉值覆盖原任务模版。
- **ChatPane ExtractionTool 展示边界**：前端只展示 X 透传的 tool event / pi content block，不直接触发工具执行；`tool_call` 映射为 running `tool_use`，`tool_result` 回填同 id 卡片，最终 `message_end` 再带同一 tool block 时按 `id/tool_use_id` 去重。真实红线仍在后端 `source=ai` 守卫，前端不得把 `draw_data` 内容或样本送入 LLM。
- **ExtractionTool skill 桥落盘策略**：生成到 `<workspace>/.pi/skills/xanthil-extraction-tools/SKILL.md`，带 `xanthil-generated-extraction-tool-skill` 标记；只更新带生成标记的文件，遇到用户手写同路径 skill 不覆盖。skill 只描述 MCP 工具契约与 clean_data 限制，不承担安全校验。
- **MetricSnapshot 数字锁（2026-06-25 E-METRIC2）**：凡 pi turn 可能启用 analysis ExtractionTool，必须在 system prompt 层通过 `assembleSystemPrompt(..., { injectExtractionToolSystem:true })` 注入 `[数据指标约束]`，明确 MetricSnapshot「代码计算值」禁止模型重新推导、修改或自行算术，只可引用展示、解读业务现象、推断根因、提供策略建议。普通 chat 在 `index.ts`、flow chat 在 `routes/engine.ts` 由 server 端 `listExtractionTools().some(category==="analysis")` 自判，不新增 `ClientMessage` 字段；默认不传 flag 行为零变化。MCP `toMcpTool()` description 和 `cleanDataPath` 参数说明也必须保留同口径。当前未覆盖 multi-agent execute，若节点级 MCP 工具调用也要数字锁，需总控扩范围。
- **工作流活跃前端路径唯一化**：legacy `ExecutionPane` / `AgentFlowPane` / `FlowChatPane` / `FlowWorkflowPane` / `FlowEditorPane` 已删除；新功能只接入 `MultiAgentExecutionPane` 真路径。`execute_flow` WebSocket client message 已从 web types 移除，不得为兼容旧组件重新引入。
- **WorkflowNode.onBlock 权威契约**：唯一口径见 `docs/工作流-onblock契约.md`。仅 `kind:"gate"` 生效；blocked 时红线硬停优先于预算、预算优先于重试；可重试时回跳 `[retryFromNodeId, gate]` 闭区间，feedback 写入独立 blackboard key 并跨轮保留，loop 体节点 blackboard 需清理。
- **onBlock trace 兼容原则**：不配 `onBlock` 的 workflow 行为零变化，普通 gate 仍只写 `gates/<id>.json`。只有配置 `onBlock` 的 loop 体节点写 `runDir/<nodeId>/iter-<n>/`，gate 额外写 `gates/<id>-iter<n>.json`；`gates/<id>.json` 始终是最终轮。
- **onBlock 预算守卫边界**：runner 只消费 T-C4 `cache.ts evaluateRunBudget(workspaceId, runId, limits)`，不自造 token/cost 统计；生产预算是否启用取决于接缝层传入 `runBudget`。预算停止当前写 `blackboard["__run_budget_stop"]` 并调用 `onBlackboardUpdate`，通过既有 blackboard trace/WS 链路可见；gate blocked 时预算原因也写入 gate verdict reasons。
- **onBlock 前端接缝边界**：T-E3 按任务约束未改 `web/src/types.ts` / `server/src/types.ts` / WS 消息契约；`WorkflowDagEditor` 和 `MultiAgentExecutionPane` 用局部扩展类型读写 `node.onBlock`。执行面板轮次展示当前以本 run 内 `agent_gate` 事件计数推导，不能等同于刷新后可恢复的权威 trace 字段；若要精确恢复，需要后续接缝层显式携带 iter 或读取 run artifact。
- **SQL loop gate 边界**：`sql_gate` 是 deterministic gate，不启动 pi turn，不读取模型自报；只从 `run_sql` 结构化 JSON 判定 `code===0`、`success===true`、`rowCount>0`、`requiredFields ⊆ columns`。模板字段当前约定为 `input.sql_connection_id`、`input.required_fields`、`input.schema_context`、`input.task`。
- **SQL tool 节点失败语义**：内置 `run-sql-query` 的 SQL 执行失败必须保留为 tool output 内部失败，而不是 workflow node 非零退出；否则 runner 会在 tool 节点处直接停止，`sql_gate.onBlock` 无法拿到错误反馈并回跳修复。
- **工作流模板库当前边界（2026-06-13）**：模板库入口在重复左栏，不新增 `templates` 二级 tab；当前清单前端硬编码 3 项并调用既有 instantiate API。若模板继续扩容，再补 `GET /api/workflow-templates`，避免现在为了 3 个模板过早扩展后端 schema。
- **工作流设计入口（2026-06-13）**：重复内 tab 收敛为“设计 / 执行”。“设计”是表单式 workflow compiler，不是自由聊天；首次生成靠目标/输入/步骤/gate/输出表单约束，后续“迭代修改”才允许自然语言 patch，且必须最小修改当前 flow 的 `workflow.json`。
- **设计运行态恢复边界（2026-06-13）**：`GET /api/flows/:id/chat-runtime` 只读取内存 `activeFlowRuns`，用于切换 flow 后恢复 UI running 状态；这不是 checkpoint，也不保证 server 重启、pi 进程异常、WebSocket 断开后的断点续跑。
- **AnaX 与工作流主栈前端解耦**：AnaX 定位独立产品/后台系统（白皮书 type-B）。不要为了消除重复把 AnaXPane 的 WS 订阅/恢复逻辑抽到主栈共享 hook；`web/src/components/multi-agent/useMultiAgentRun.ts` 是 MultiAgentExecutionPane 私有 hook，不对 AnaX 承诺复用。
- **skill 冲突 API 客户端调用规范（2026-06-14 P1-B）**：D slot 通过 `engineApi.listSkillConflicts(workspaceId, {slug?, content?})` 调用。`content` 走 GET querystring 有 URL 长度上限（浏览器/反向代理通常 8KB），客户端层在 `engine.ts` 内置 `truncateConflictContent`（4KB 上限），任何新增冲突调用方必须复用同一方法、不绕开截断；A 域如未来支持 POST body，前端可移除截断但保持同名方法。
- **skill 信任门 `confirmed` 字段语义边界（2026-06-14 P1-B）**：A 域 `hasConfirmedReview` 仅在 `source ∈ {distilled, curated}` 且 `status → active` 时强校验 `confirmed=true`。前端 PATCH 必须**仅在敏感来源传 `confirmed: true`**，其他来源不带该字段；不可"反正传上无副作用"地一律传 true，否则未来若 A 域扩展信任门到所有来源，前端会静默旁路。
- **command 管理契约（2026-06-16，X 接缝卡 / 详见 docs/wiki.html「command 管理」卡）**：实证 pi 在 `-p` positional 模式**不展开** prompt 里的 `/command`（slash 是交互式 TUI/RPC 特性、`ctx.hasUI` 在 `-p` 为 false），故 command = **pi-xanthil 自有注册表 + 服务端 prompt 展开器**，不依赖 pi 扩展。真源 `COMMANDS_CONFIG_PATH=commands.json`（与 hooks.json 同为单文件、不进 `ensureDirs`、缺失=无命令安全降级）。双侧 `types.ts` 契约：`XanCommand{id,name,enabled,description?,argumentHint?,template,params?,skillSlugs?,source:"custom"}` + `XanCommandParam{key,label,required?,type?,options?,source?}`。**展开占位语法（注册表UI/展开器/向导前端三方共用，不得各拍）**：`{{args}}`=参数原文、`{{1}}{{2}}`=位置参（空白切分、引号整体）、`{{param.key}}`=具名参；**具名参数命令行编码** `/name --key=value`（值含空格用双引号），未提供占位替换为空串。**接缝边界**：向导传参走现有 `text` 通道编码、**不新增 `ClientMessage` 字段**；展开在服务端单点（`command-expand.ts`，E 后端卡），前端不自行展开。下游：E 后端卡（展开器+`/api/commands`+`index.ts:4900` 集成）、D 注册表卡（`CommandManagementPane`）、E 向导卡（ChatPane `/` 补全+表单）。
- **command 后端实现边界（2026-06-16，E 卡）**：`command-expand.ts` 是展开唯一纯函数；普通 chat 与 flow chat 都必须在拼接 context 后的用户原文位置替换为 `expandedText`，但 transcript/trace 继续保存原始 `/cmd`，保持 UI 行为可追溯。`skillSlugs` 不是 pi 参数，必须先解析为 workspace project skill 路径 `<workspace>/.pi/skills/<slug>/SKILL.md`，再和显式 `skillPaths` 合并走 `validateSkillPaths`；禁止把 slug 直接传给 pi。`/api/commands` 写入端只收 `source:"custom"` 和白名单字段，`template` 只作为 prompt 文本存储，不执行 shell；`PUT` 限 localhost 来源。
- **command 向导前端边界（2026-06-16，E 卡）**：ChatPane `/` 补全只能消费 `GET /api/commands` 的 enabled commands，不在前端构造/展开 prompt。无 `params` 命令只插入 `/${name} `；有 `params` 命令弹 React 表单并在提交时编码为现有 text：`/name --key=value`。`type:"file" + source:"clean_data"` 只拉登记路径列表并提交 `WorkspacePath.path`，不读取文件内容、不发送数据样本/列名/剖析结果给任何 LLM。表单 required 校验是用户体验层，权威展开仍是 server `command-expand.ts`。
- **跨域数据查询隔离规范（2026-06-19）**：为了避免子系统之间相互引用 DB 文件导致的循环依赖与类型接缝污染，D 域等其他域查询 E 域的记忆特征（如 `knowledge-graph` 的打分与 Prompt）时，**禁止跨域 import** `server/src/knowledge-graph.ts` 的底层读写函数。统一规范通过暴露内网 GET API 接口（如 `/api/workspaces/:id/kg/relevance`）并通过 `fetch` 进行跨域通信，这确保了各域可独立测试，且边界坚固。
- **监测/agent 安全回归口径（E-MONITOR8，2026-06-23）**：D-MONITOR6 在 D 域 slot 新增监测专用 SQL 导入单入口（`POST /api/workspaces/:id/monitor/import-sql` + `GET /monitor/imports`）后，E 域负责回归验证 LLM/agent/workflow 不获得写库或原始行级数据通道。审查口径（无新代码、仅静态 + 单测 + grep）：① **agent runner 文件**（`multi-agent-runner.ts` / `autonomous-runner.ts` / `subagent-core.ts` / `skill-*.ts` / `memory-injection.ts` / `pi-adapter.ts`）grep 必须无 `monitor/import-sql`、`monitor/imports`、`import/commit`、`create-table`、`addWorkspacePath`、`exportTableQuery` 任意一个。② 工作流 SQL 工具节点（`multi-agent-runner.ts:741`）必须经 `validateSql` → `executeQuery`，**只读 SELECT**。③ **monitor-llm prompt 安全红线**：`buildDraftPrompt`/`actions/draft` prompt 只能拼 `BiAggregationDataset.columns/rowCount/name` + ontology 元数据 + findings 衍生字段（`kind/severity/lifecycle/category/title/suggestion/comparisons/diagnosis`），**绝禁** rows/cells/draw_data。④ monitor `/runs` 端点必须在 `insertMonitorRun` 前差集校验 metric-system bindings 的全部 datasetPathId 属当前 workspace `/api/bi/aggregations` 返回集，非法即 400 且**不落空 run**；ontologyId 同口径。⑤ run 数据流：`fetch /api/bi/aggregations/:pathId/data` → `runMonitorChecks`（纯函数零 LLM）→ findings 落库，rows 永不进入 LLM。⑥ `subagent-core.ts` 的 `writeFileSync` 仅限模板配置 + 沙箱 `.mcp.json`，不得扩散为数据写入通道。后续监测相关改动如新增 LLM 调用或新接缝端点，必须按本口径重做回归。

---

## 三、关键决策沉淀

**日常 / chat prompt 调用（E-PROMPT1）**
- 2026-06-22：Prompt 调用使用 composer 工具行的独立「Prompt 库」按钮，不复用 `/` command 菜单。原因是 prompt 是可编辑文本模板，command 是服务端展开的执行入口；混用会模糊用户心智并增加现有 command 补全回归风险。
- 2026-06-22：选择模板只负责把渲染后的 body 插入当前 textarea 光标/选区，**不自动发送**。用户必须能在发送前复核和继续编辑；否决“选中即发送”与“覆盖整个输入框”两种行为。
- 2026-06-22：变量识别以 body 中实际 `{{var}}` 为准，局部复用 prompts 管理页同口径正则；本卡没有抽共享 utility，因为那会为一个很小的纯函数跨改 D 域 `PromptsManagementPane`。后续若第三处调用也需变量解析，再由总控裁决抽到共享 lib，避免过早扩大改动面。

**日常 / chat prompt 沉淀（E-PROMPT2）**
- 2026-06-22：沉淀范围严格绑定**最新 user turn**，只收集该 turn 后无 error 的 assistant 文本。若最新 turn 失败或尚未完成，返回 `draft:null`；否决“向前寻找最近成功轮次”，否则用户点击当前任务时可能误存旧任务 prompt。
- 2026-06-22：模型原始输出使用 frontmatter + body，而不是 JSON。原因是项目约定 LLM→JSON 必须走 `index.ts` 统一 parser，但该 parser 位于冻结接缝且未导出；本卡不触碰 `index.ts`、也不复制第二套 JSON parser。HTTP 响应仍严格转换为 X-PROMPT0 `PromptDraft`。
- 2026-06-22：E server 只负责生成草稿和 usage/trace，不通过 self-HTTP 调 D 写库。真正写入由 `PromptDistillDialog` 人审确认后，浏览器调用既有 `createPromptTemplate`；这样取消操作零副作用，也保持 D 为 prompt_templates 唯一写入边界。
- 2026-06-22：草稿 `variables` 以 body 实际 `{{var}}` 占位为真源，LLM 声明但正文未使用的变量会被丢弃；Dialog 中仍允许用户同时修改 body 与 variables，最终以用户确认内容入库。

**实验场 / prompt 评测**
- 2026-06-20 E-LAB1：prompts lab 沿用 per-module runner，不为六类实验场提前抽统一泛型基类。`PromptVariant` 的第一个元素即 baseline；`role="system"` 通过 `RunPiOptions.systemPrompt` 注入，`role="prefix"` 只前置到当次 task user text。两种注入都继续经过 pi adapter 的稳定安全前缀，不能自行直拼并绕过 `assembleSystemPrompt()`。
- 2026-06-20 E-LAB1：prompt eval 新表与路由全部落 E slot（`db/engine.ts` / `routes/engine.ts`），不复制 skill/tool 的 legacy `db.ts` / `index.ts` 落点。评测数据采用 evaluation 主表 + result 明细表，task 集独立表；列表不带 results，detail 才加载结果，避免历史页放大响应体。
- 2026-06-20 E-LAB1：pairwise 逐字复用 skill 的 majority verdict、分数/置信度均值和 `judgeRuns` 留痕口径；没有为 prompt 自造新评分标准。prompt lab 去掉 skill 特有的 activation/retrieval/contextPrefix 字段，防止不同评测对象的指标语义混用。

**实验场 / command 评测（E-LAB2）**
- 2026-06-20 E-LAB2 case 输入口径：command case 输入用 **`argsText`**（命令名之后的参数串），不用结构化 paramValues。原因：`expandCommand(text, commands)` 吃完整 slash 行做真实 parse，positional/`{{args}}` 无法由结构化键值表达；runner 内 `composeLine = /${command.name}${argsText? " "+argsText : ""}` 拼回完整行再展开，最忠实地复用生产展开路径，零旁路。
- 2026-06-20 E-LAB2 一 case 一 expectation：沿用 tool 模型，5 类 expectation（expand-contains/expand-golden/skill-attached 纯确定性无模型消耗；run-contains/run-llm-judge 才起 pi turn）。要同时验「展开 + 实跑」必须拆两 case，不在单 case 内叠加多断言。
- 2026-06-20 E-LAB2 model 必填边界：`parseCommandEvaluationRunRequest` 只在「任一 case 为 run-*」时强制 `request.model` 必填；纯确定性评测不传 model 不报错。run-* 的 turn 注入沿用 prompt runner 既有 `runTurn?: (RunPiOptions)=>PiRun` 注入点（单测/smoke mock），run-llm-judge 复用 `evaluation-common.runJudge`，不自造执行通道（无 execSync/self-HTTP）。
- 2026-06-20 E-LAB2 落点同 Phase1：三表落 `db/engine.ts`、8 路由落 `routes/engine.ts`，不碰冻结的 `index.ts`/`db.ts`。run handler 读全局 `commands.json`（经本文件已导出的 `readCommandsFile()`），按 `commandId` 找 enabled 命令，缺/禁用→400。command 是 workspace 无关的全局注册表，case-set/evaluation 仍按 workspace 归集。
- 2026-06-20 E-LAB2 archive kind 三处同改：扩 `"command"` 需同时改 `EvaluationArchiveIndexItem.kind` 类型、`archiveEvaluation` 内部签名、`listEvaluationArchives` 的 baseName 前缀识别（`command-evaluation-` → kind）。web 侧 `types.ts` 的 `EvaluationArchiveIndexItem.kind` 也要同步加 `"command"`（双侧镜像）。`web/src/lib/evaluation-export.ts` 的 `downloadEvaluationJson` prefix union 暂未含 `"command"`，CommandLabPane 用局部 `downloadJson` 规避，未改共享导出库（避免外溢）；若总控要统一 web archive 导出再扩。
- 2026-06-20 E-LAB2 大 TSX 写入踩坑复现：写 CommandLabPane（~459 行）时，单次 Write/Edit 工具调用的入参在传输层约 ~10KB 即被截断成 Unterminated string。最终方案=先 Write 极简骨架（imports + 纯函数 helpers + `inputCls` 常量），再用多次 `cat >> heredoc`（每段 <200 行）分块追加组件主体 / CaseEditor / ResultPanel。**重申既有约定：>200 行新 TSX 一律先骨架后分块追加，不要一次性 Write/Edit 整文件。**

**实验场 / hooks 评测（E-LAB4，范式 B 护栏单测）**
- 2026-06-21 E-LAB4 纯确定性范式：hooks lab = 护栏单测，**无 LLM / 无 judge / 无 model**；`repeat` 仅为 schema parity（确定性下重跑结果恒同），默认 1。run handler **同步**（非 async），无 pi turn。5 类 expectation：must-block(reasonPattern 正则可选)/must-allow/golden-mutation(mutatedInput 深等)/match(matchedHookIds 集合等、顺序无关)/trigger-count。
- 2026-06-21 E-LAB4 verdict 唯一真源 = 接缝纯函数：runner 一律调 `pi-extensions/px-hook-runner/hook-eval-core.ts` 的 `evaluateHookFixture`（D.4 owner=总控抽出，扩展运行时与 eval 共用同一判定），**不复刻** block/mutate/match 语义。runner 暴露 `evaluate?` 注入点供单测，默认真实纯函数。
- 2026-06-21 E-LAB4 ★安全红线（等同 AGENTS.md §一）：eval **绝不执行 hook 副作用**。command/notify/log 只枚举进 `verdict.sideEffectKinds`，runner 内零 spawn/exec/写 hooks-triggers.jsonl。**必须有测试坐实**——构造 `command` action hook + 命中 fixture，跑完断言其 shell 命令的 sentinel 文件不存在（`hook-evaluation-runner.test.ts` 已含此红线 case）。
- 2026-06-21 E-LAB4 跨 rootDir import 接缝踩坑：runner/route import `../../pi-extensions/px-hook-runner/hook-eval-core.ts` 时，server `tsc`（`include:["src"]` + strict）会把扩展文件拉进 program，暴出该文件自身的 TS7022（`cloneInput` 缺显式返回类型→`base` 自引用 any）+ 跨 rootDir 的 TS2307 解析失败。**该文件是接缝层（owner=总控），E 不擅改**——回总控修（加显式返回类型 + tsconfig 解析）。`node --test --experimental-strip-types` 因只剥类型不 typecheck，运行期不受此阻，故逻辑验证可先行。
- 2026-06-21 E-LAB4 落点同前期：三表 `hook_eval_sets`/`hook_evaluations`/`hook_evaluation_results` 落 `db/engine.ts`，verdict 列 matched_hook_ids/blocked/block_reason/mutated_input/side_effect_kinds/trigger_count；8 路由落 `routes/engine.ts`，run handler 用**本地** `readHooksForEval`（读全局 hooks.json，与 dataRouter `GET /api/hooks` 同源但不跨域复用其私有 `readHooksFile`），按 `case.hookIds` 过滤子集、缺省全 enabled。archive kind 扩 `"hook"`（双侧 `EvaluationArchiveIndexItem.kind` + `archiveEvaluation` 签名 + `listEvaluationArchives` 前缀识别三处同改）。
- 2026-06-21 E-LAB4 HookLabPane 前端：无 model/models props（确定性）；payload/expectedInput 用 JSON 文本框 + 提交前 `JSON.parse` 防呆（`built.error` 在面板内提示，不发后端）；hooks 子集用 `api.listHooks()`（data 域端点）勾选；顶部常驻红线提示「仅评判 verdict，绝不执行副作用」。

**实验场 / red-team 套件（P5-3，prompt 注入 / 护栏绕过；安全相关→总控加重终审）**
- 2026-06-21 P5-3 hooks 护栏绕过决策：red-team 护栏选 **content-keyed**（按命令内容正则匹配 `match.pattern`），**不绑 toolName**。理由——攻击者最容易的绕过手法就是改 toolName（`bash`→`shell-exec-v2`→`exec`…），toolName 型护栏天然脆弱；content 护栏对变形 toolName 免疫。预置集特意含一个「弱 toolName 护栏被改名绕过 vs content 护栏仍拦」对照 case 把这点坐实。另含 2 个良性阴性对照（`ls`/`curl -o 下载不管道执行`）防全拦过拟合。
- 2026-06-21 P5-3 ★正则陷阱（务必记）：`matchesHook` 用 `new RegExp(m.pattern)` **无 flag**，JS 不支持内联 `(?i)` —— 写 `(?i)...` 会抛 SyntaxError 被 catch 成「不命中」，护栏静默失效、绕过 case 反而"通过"。故危险 token 一律按命令惯例**小写直配**，不依赖大小写无关。后续任何 hooks pattern 写法同此约束。
- 2026-06-21 P5-3 hooks red-team **不扩 expectation**：现有 `must-block`(+reasonPattern)/`must-allow` 已足够表达「变形仍被拦/良性放行」，无需新增 expectation kind。"must-resist 类断言"在 hooks 侧即等价于 `must-block`，复用即可，零接缝增量。
- 2026-06-21 P5-3 hooks red-team 下发形态：hooks lab 无 DB 预置 case 表，red-team case 集以 **builder 函数** `buildHookRedTeamCases()` 下发（前端可调它生成后写入 `hook_eval_sets`，或文档/产品示例直接展示）。否决了「为 red-team 单独建预置表/路由」——当前只需一组固定模板，builder + 文档示例最轻；若将来要多套可管理的 red-team 模板再补端点。
- 2026-06-21 P5-3 prompts 注入鲁棒性落点（用户拍板「task 级 resist 标注 + 复用 pairwise judge」）：在 `PromptEvalTask` 加可选 `mustResist`/`attackKind`，`mustResist` task 在 `buildPairwiseJudgePrompt` 顶部**早返回**路由到 `buildResistJudgePrompt`，把评分语义**倒转为「守约束者胜」**（守住=高分 win / 顺从注入失守=低分 loss），其余 JSON 协议 + majority/均值聚合一字不改。**否决了**新增独立 resist-judge 判定通道（单变体绝对 pass/fail + minScore 硬门禁）——那要扩 `PromptEvalTask` 更多字段 + runner 判定分支 + 可能 DB 列，接缝远大于复用 pairwise；用户选最小接缝方案。代价：注入鲁棒性仍是「相对 baseline 谁更稳健」，不是绝对 pass/fail；若将来要绝对门禁再单开通道。
- 2026-06-21 P5-3 接缝裁断：本次给双侧 `types.ts` 的 `PromptEvalTask` 加可选 `mustResist`/`attackKind` + 新增 `PromptAttackKind` union。判定为**符合 E-LAB 既有惯例**（prompt eval 契约本就落双侧 types，见 E-LAB1 决策）且为**纯增量可选字段**（向后兼容、不改既有结构、旧 task 不带这两字段行为零变化），故按惯例镜像两侧而非另立位置。已写入 §0 开放问题待总控确认。
- 2026-06-21 P5-3 ★安全（等同 AGENTS.md §一）：① hooks red-team 仍守 E-LAB4 零执行铁律——危险命令是 sentinel 占位（`/tmp/__redteam_sentinel__` 等），评测路径零 spawn，测试 sentinel-not-exist 坐实；② prompts 注入样本不含真实敏感数据——「系统提示/密钥」全是占位文案，judge 纯判定不触发危险执行。两侧均待总控加重终审核这两条红线。

**监测引擎（E-MONITOR2，2026-06-23）**
- 架构决策：监测引擎与 V 域 health-check-engine 同范式但独立——监测 = 经营指标"偏差/差距"分析，体检 = 数据集自身"质量/健康"巡检。监测落 E slot（新表 `monitor_*` + E 域路由），体检落 V slot（既存 `health_*` 表 + V 域路由），E 和 V 在前端可分别展示或后续合流。纯函数核心零 LLM 零 IO，LLM 只在指标体系草案生成阶段使用且严格遵守安全约束（不限原始行级数据）。
- 指标关联契约：`MonitorMetricBinding` 的 `targetMetricId/benchmarkMetricId/competitorMetricId` 指向本体系的另一个 `MonitorMetricDraft.name`，engine 通过 lookup 找到目标 metric 的 `bindings[0]` 读值做差距计算。无 `role` 字段，不混用 dataset bindings。跨域读 clean_data/ontology 走 HTTP fetch，不直接 import 他域 db 函数。
- 差距规则口径：
  - R-GAP-TARGET：source 最新值 vs target metric 最新值，正 delta=超出/负=落后
  - R-GAP-HISTORY：环比(上期)/同比(去年同月)/移动均值偏离(maWindow=3 期)，取最严重 severity
  - R-GAP-INDUSTRY：source vs benchmarkMetricId，落后=问题/领先=info
  - R-GAP-COMPETITOR：source vs competitorMetricId，口径同 industry
  - lifecycle 复用 health-check-engine 的 4 态（new/recurring/worsening/resolved）+ 同 signature 匹配 + resolved 补丁
- LLM 草案安全约束：prompt 只送 `BiAggregationDataset.columns/rowCount + ontology 元数据`，不送原始行、不送 `draw_data`、不送行级明细。无聚合/ontology 时降级返回 `missingData` 不调 LLM。JSON 解析参 `onto-extract.ts` 范式。

**重复 / 工作流产物**
- Flow `kind: single|multi`（DB 自动迁移 ALTER+DEFAULT）→ 后删单智能体，只留 multi；**更名仅改 label，内部 id `multi`/DB kind 不动**（零迁移）。
- 2026-06-13 前端清理确认：server 与 web 各有独立 `types.ts`，两侧解耦、可各自独立变绿；`execute_flow` 删除不需要与 server 同批。删 legacy 前端时先做精确引用扫描，确认每个文件除自身定义外引用链只指向同样无人渲染的组件。
- 2026-06-13 T-E1：onBlock 在 runner 内做成**可选 runner 能力**，未改 `routes/engine.ts` 接线；`runBudget` 也作为 `MultiAgentRunOptions` 可选项接入，避免本卡越界修改路由骨架。生产预算硬停是否启用取决于后续总控接线。
- 2026-06-13 T-E2：预算检查从 gate blocked 分支扩展到每个非 gate 节点成功后和 gate 裁决后；红线硬停优先级最高，不检查预算、不回跳。maxIterations 耗尽会追加明确 reason 到最终 gate verdict，以便失败上限通过现有 `agent_gate` trace 可见。
- 2026-06-13 T-E3：gate onBlock UI 同时接入 DAG overlay 与执行面板表单视图，避免“字段只能在一处配置”的双入口不一致；`retryFromNodeId` 选项按 topo 序限当前 gate 之前节点，删除/重命名回跳目标时同步清理/更新引用。
- 2026-06-13 T-E4：SQL loop 选择 runner 内置 `run-sql-query`，而不是注册到 `server/tools` 的 Python extraction tool。原因是 SQL 查询需要直接复用本地 `sql-connections.ts` 的连接存储、安全校验和查询执行；外部 extraction tool 无法自然访问该连接契约，且会把“工具进程执行失败”和“SQL 可修复失败”混在一起。
- 2026-06-13 T-E4：`sql_gate` 复用 `anax-verdict` 输出格式和既有 gate 文件/trace 链路，但 verdict 由 `evaluateSqlGate()` 确定性生成。这样不扩展 WS/types 接缝，也能让 `onBlock` 使用同一套 feedbackVar 回流。
- 2026-06-13 T-E5：SQL loop 的“真实实跑”不等于真 pi；T-E5 只要求真实 SQL tool 与真实数据收敛。因此测试允许 fake `runTurn` 生成两轮 SQL，但 `run_sql` 必须走真实 `run-sql-query`、真实 `sql-connections`、真实 SQLite 数据表。为避免 `sql-connections.ts` 模块级 `SQL_CONNECTIONS_PATH` 固定到默认数据目录，实跑测试用子进程传临时 `XANTHIL_DATA_DIR`。
- 2026-06-13 T-E6：拆 `MultiAgentExecutionPane` 时优先做“搬迁式拆分”，先抽私有 hook、纯工具、执行控制面板和 tool 配置；保留节点编辑主体在原文件，避免低优先卡引入大范围 JSX 行为变动。`useMultiAgentRun` 明确放在 `components/multi-agent/`，不是全局 `hooks/`，用于防止后续误解为跨 AnaX 共享能力。
- 2026-06-13 预算生产接线（总控补，闭合 T-E1/T-E2 遗留的“取决于后续总控接线”）：`config.ts` `RUN_BUDGET_LIMITS` 读 env `XANTHIL_RUN_MAX_TOKENS`/`XANTHIL_RUN_MAX_COST_USD`（>0 生效，未设=null 即不限、行为不变），`routes/engine.ts` handleExecuteMultiAgent 传 `runBudget`。决策：env 可选 > 硬编码魔法上限（误伤大 run）> DB 配置（过重）；per-workspace 限额 + UI 留待按需。接缝细节见 `notes-infra.md §六`。
- 2026-06-13 模板库入口决策：没有新增 `SubTab` 字面量和 `MULTI_SUB_TABS`，而是在重复的工作流列表栏加“从模板新建”。理由：满足“一键实例化”需求，同时避开接缝层 tab 骨架变更；当前模板数量少，前端硬编码清单比新增列表端点更轻。
- 2026-06-13 设计入口决策：否决“创建”和“搭建”并行长期存在。两者对用户的视觉差异不明显，且都像对话框；最终合并为“设计”表单，要求用户先填写目标、输入、步骤、gate、回跳、输出，降低自由自然语言的不精确性。自然语言保留在“迭代修改”区，只用于已有 workflow 的局部 patch。
- 2026-06-13 运行态恢复决策：短期只做 active run UI 恢复，不做真正断点续跑。理由：`activeFlowRuns` 已有内存态，可低成本解决“切 flow 后回来不知道是否还在跑”；真正断点续跑需要 DB 持久化设计 run 与阶段状态，属于后续较大改造。
- 2026-06-14 skill registry 后端决策：只在 E slot 新增 `db/engine.ts` CRUD 与 `routes/engine.ts` registry 路由，不迁移 `index.ts` 中既有 skill-evaluation legacy 端点。原因是用户约束“仅 E slot、不碰接缝骨架”，而 runner/db 保存函数已经可复用；registry evaluate 端点直接调用现有 runner 与保存函数即可闭环。
- 2026-06-14 skill registry 评测回写口径：registry evaluate 端点临时构造 baseline + skill variant，复用 `runSkillEvaluation()` 与 `saveSkillEvaluation()`。score 暂定为 pairwise `0.5 + avgScoreDelta/20` 截断到 0..1；无 pairwise 时用 successRate 与 activationRate 均值。该口径是工程接线默认值，不是最终实验室评分标准。
- 2026-06-14 skill 采纳写文件决策：POST registry 端点负责写 `<workspace>/.pi/skills/<slug>/SKILL.md`，并限制 slug/path，拒绝路径逃逸。没有新增全局 skill 写入，也不写 `.agents/skills`，避免影响用户全局环境。
- 2026-06-14 P1 A 阈值状态机决策：不新增 SkillStatus，复用卡1契约中的 `candidate/draft/active/archived`。原因是表/类型归卡1/总控，E 卡不能扩接缝；因此把 `draft` 明确定义为“达标待采纳”，由 UI 文案解释，而不是改 schema。
- 2026-06-14 P1 A 信任门决策：用 `confirmed=true` 作为 distilled/curated 采纳的人审轻量标记。它只防止后端被无意直接置 active，不记录 reviewer；若未来要审计，需要总控扩表或新增审计事件。
- 2026-06-14 P1 C 前端落点决策：节点 skill 子集配置先放 `MultiAgentExecutionPane` 表单视图，不放 `WorkflowDagEditor`。原因是 DAG 已提示高级字段到表单视图编辑，且表单视图能同时编辑 workflow/default 与 node override，避免两个编辑入口状态漂移。
- 2026-06-14 P1-B Modal 拆分决策：`AdoptConfirmModal` 抽到独立文件而非内联在 `SkillManagementPane.tsx`。原因是 D slot 既有惯例（`CreateSkillModal.tsx`/`EvalSkillModal.tsx` 都是平级独立文件），且采纳确认 modal 自身 ~150 行逻辑足够独立；同时弹窗内引入独立 `adoptError` state，避免错误显示在主面板被遮住。
- 2026-06-14 P1-B 共享 utility 决策：`severityLabel` / `severityTone` / `truncateConflictContent` 抽到 `web/src/lib/skillConflict.ts`，被 `CreateSkillModal` 与 `AdoptConfirmModal` 同时复用。否决了在每个 modal 内本地复制实现的方案——本次 code-review 已踩到一处实现漂移（行内复制）。utility 模块小（~20 行）但能消除"两份实现一改一漏"的隐患。
- 2026-06-14 P1-B race 防护决策：`AdoptConfirmModal` 不用 `AbortController`，而是用 `adoptRequestTokenRef` 自增 token。原因是冲突 API 是非幂等查询、无副作用，简单 token 即足以丢弃旧回调；`AbortController` 会让 `fetch` 抛 AbortError，反而需要在 catch 内额外区分 abort 与真错。token-ref 范式可在后续类似场景复用（弹窗预查询 + 用户连续切换目标）。
- 2026-06-16 command 管理后端决策：`GET/PUT /api/commands` 放在 E 域 `routes/engine.ts`，因为 command 的第一消费者是 chat/pi turn 展开；注册表 UI 可跨域调用该 E 路由。没有把读写函数放进 `config.ts` 或 `types.ts`，避免接缝层继续膨胀；后续若总控要求 D 域托管注册表，迁移路由即可，`command-expand.ts` 纯函数与 `COMMANDS_CONFIG_PATH` 真源不变。
- 2026-06-16 command 发送入口决策：除了普通 session chat，flow chat 也接入 command 展开，防止同一个 `/cmd` 在不同聊天入口行为分叉。历史消息仍保存用户原文，原因是 command 是用户输入意图，展开 prompt 是 pi 执行细节；如果后续 UI 要展示展开结果，应新增显式 preview/trace，不应覆盖 transcript。
- 2026-06-16 command 向导前端决策：参数表单提交后直接发送 `/cmd --key=value`，而不是先回填输入框等待二次点击。原因是“口径2”价值核心是直奔结构化向导、降低 prompt 工程学习成本；服务端仍会保存原始 command text 并单源展开，前端没有新增协议字段。无参命令保留为插入输入框，是为了兼容位置参数/自由补充文本。
- 2026-06-16 覆盖缺口检测决策：缺口建议先做**只读列表 + 手动蒸馏**，不进治理队列。原因是本卡目标是“where to evolve”的发现层，填补由 B 蒸馏链路负责；若直接持久化治理状态，会扩大到队列表、状态机、审计和 UI 分类，超出 E 卡最小闭环。后续如总控要求治理化，应新增 gap proposal 表或复用既有治理队列，但不得绕过 B 的 distilled candidate 与人审门。
- 2026-06-16 subagents 管理 P0 决策：`GET/PUT /api/subagents` 暂放在 legacy `index.ts` 的委派 runner 邻近位置，而不是先拆到 `routes/engine.ts`。原因是本卡直接改 `runDelegatedSubAgent`，路由与 runner 共享 `coerce/read/write/resolvePersona` helper 最小改动；是否迁移到 E router 留给总控统一裁决。P0 初版曾不持久化 `templateId`；该限制已被后续契约取代，当前 `SubAgentTask.templateId` 已持久化并由 resume/retry 恢复，勿按初版实现回退。
- 画布**纯预览只读**（`nodesDraggable=false` 等），所有变更经「pi 对话」自然语言完成。
- `workflow.json` 不存在时从**目录树自动推断节点**（数字前缀排序/单目录包裹展开，标 `inferred:true`）。
- 创建视图三区（架构+进度+对话）；黑板**正名融合**——把唯一真实价值（`{{id}}` 传递关系）显示在执行流节点卡，删重复输出汇总。
- run 文件读写用 **DB run.id**；客户端 `makeRunId` 经 `outputDir` basename 映射。
- 决策树/TOC 图保存为 **HTML**（SVG 无法内嵌系统 CJK 字体 → 字体变形）。
- 流程图库 = `@xyflow/react`（React Flow v12）。

**AnaX**（详见记忆 anax-integration）
- 2026-06-18 专题迁移 E 卡决策：AnaX 提升为一级「专题」tab 时，E 域只迁移 `EngineTabs.tsx` 的四个 pane 渲染条件，不改 pane 内部逻辑、不改 `anax-template/anax-gate`、不扩接缝层。原因是本卡目标是先让“提升为一级”落地可见，保证 `anax_view/hypothesis/change_mgmt/readme` 的 subtab id、props 和行为与迁移前一致；`anax_chat` 等专题新能力必须另开卡处理。
- 2026-06-18 专题对话探索决策：`anax_chat` 复用 `ChatPane`，但不复用 `handleSendFlow`。原因：`handleSendFlow` 的语义是 workflow 设计/迭代修改，会写 `flow_messages` 并以 flow id 作为 pi session；专题对话要的是开放式数据分析能力，必须保留真实 `sessions/messages/session_runtime`，这样 fork/委派/compact/工具抽屉都可复用。绑定方式采用 `sessions.workflow_id = flow.id`，后端 `handleSend` 在该 session 上切换到 flow-scoped `workspace_paths` 和 flow report 输出目录；这是最小无 schema 接线。
- 2026-06-18 专题任务多实例决策：专题任务已从 workspace 单例升级为多实例，任务真源仍是 `sourceName="AnaX 专题"` 的 `multi` flow + 一条 `workflow_id=flow.id` 的真实 session。`GET /api/workspaces/:id/zhuanti/tasks` 列全部专题任务并按 `updated_at DESC, created_at DESC` 排序；`POST /api/workspaces/:id/zhuanti/tasks` 每次创建新专题 flow/session；旧 `ensureZhuantiAnaxChat` 只负责默认进入专题模块时取最新，无则创建。日常任务列表不改 `listSessions()`，继续以 `workflow_id IS NULL` 排除专题 session。后续如果要“当前选中专题”跨刷新持久化，需要另扩 UI/状态，不应把 ensure 重新改回单例。
- 2026-06-18 工作区任务区分决策：Sidebar 中“日常任务”展示 `sessions`（`workflow_id IS NULL`），“专题任务”展示 `zhuantiTasks`（AnaX 专题 flow + 绑定 session），两组各自选择后强制切到对应模块。App 中 `zhuantiChatFlowId/zhuantiChatSessionId` 表示当前专题任务，切到 `zhuanti` 默认选 `zhuantiTasks[0]`，切到 `explore` 默认选 `sessions[0]`。专题删除当前由前端组合执行 `deleteFlow(flowId, deleteFiles)` + `deleteSession(sessionId, false)`；这不是后端原子事务，若要更强一致性需另开后端删除端点。
- 2026-06-18 专题 seed 闭环决策：对话与流水线 MVP 不共享同一条 flow，采用 App/TabContext 的文本 seed 中介。原因：`AnaXPane` 自治选择 `sourceName==="AnaX v3.0"` / Quick flow，run 恢复、历史、gate verdict 恢复都绑定它自己选的 flow；强行复用专题 chat flow 会扩大为高风险重构。对话 → 流水线只把用户确认后的“问题陈述 + 初始假设”写入 `brief`，不自动 run；流水线 → 对话只回流一条本地 assistant 摘要，不自动触发 LLM turn。后续若要产物同目录/单 run 历史，需另开卡参数化 `AnaXPane` flow 选择。
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

**日常·对话/skill/业务需求**
- skill 提炼**压成单次 LLM 调用**（A 解构→B 提炼→C 写 SKILL.md 内嵌进一个 prompt），不做链式三次往返。源模板 `~/.pi/agent/prompts/skill-distillation-prompts.md`（用户维护的 4-prompt 链式库 A/B/C/D），单次版是其 A+B+C 的折叠；D（多案例融合）对应 curator/版本融合、不在此。**注：旧的日常「沉淀 skill」手动两段式（distill-skill 预览 + save-skill 保存）已于 2026-06-18 移除**；该 prompt 现仅由 auto-distill / 覆盖缺口蒸馏调用。
- **distillation prompt 增强（2026-06-15）**：`buildSkillDistillationPrompt`（`server/src/skill-distillation.ts`，由 auto-distill sweep 与覆盖缺口蒸馏共用；手动 `/distill-skill` 入口已于 2026-06-18 移除）第三步与自查清单新增两节**必需输出**——① 「关键变量清单」表格（`变量名 | 含义 | 典型取值范围`，逐个列正文 `{变量}`）；② 「常见陷阱与对策」章节（从对话提炼隐性经验/坑→对策，复用价值最高；**有坑才写、无坑省略，禁止硬编占位**）。这两块从用户 prompt 库的 A-E/B 回灌，旧版只在内部思考里提及、不进输出。架构不变（仍单次调用）。真实 smoke 验证（MiniMax-M3，`/distill-skill` 预览）：两节均稳定产出且质量达标（变量表含取值范围、6 条带现象/对策的真实陷阱）。
- 业务需求来源引用 = 字段级 `sourceRefs` + quote 最小闭环，**不做字符 offset 定位**；业务需求上下文抽成前端共享 hook（Chat/报告版本/Golden Strategy 复用）。
- 2026-06-18 专题业务需求接入决策：`BusinessRequirementPane` 在 `explore` / `multi` / `zhuanti` 三个入口复用同一组件和 props，不 fork pane 逻辑；专题下的作用域由 App 层 `folderScope={type:"flow", flowId:<专题 flow>}` 提供，`EngineTabs.tsx` 只负责把 `business_requirement` 渲染条件加上 `zhuanti`。`onExploreFields` 仍跳 `data_exploration`，不向数据探索子树注入数据或 LLM 链路。
- 业务需求版本恢复依赖 `structured.version.requirementInput`：后端生成版本必须写入原始 draft 输入，手动编辑 markdown 时必须保留已有 requirementInput；前端打开历史版本/刷新恢复左侧 draft 时只读该字段，旧 JSON 缺字段时不应臆造完整业务背景。
- fork 分支/委派子 agent 的**回流不是特殊消息类型**：前端弹可编辑摘要框，用户确认后调用主线 `onSend`，保持主 transcript 只有用户主动回流的摘要/报告路径；分支中间多轮和子 agent 运行细节不污染主线。
- fork 前端不要回到旧 WebSocket 方案重新设计协议：后端契约已交付为 `POST /api/sessions/:id/fork` + 分支真实 session + 现有 gateway send/messages/pi_event；委派契约已交付为 REST delegate/task/abort + 轮询。
- **memory evaluation runner 检索上下文单一真源（2026-06-18 E-EVAL）**：baseline vs memory 评估必须用同一 evaluation prompt 构造 `RetrievalContext`（当前 `query = prompt.trim()`），并把同一个 ctx 同时传给 `buildMemoryInjectionSnapshot(..., {}, ctx)` 与 `buildMemoryPrompt(..., {}, ctx)`。否则 snapshot 中看到的候选/命中可能与实际 pi system prompt 不一致，评估数据会失真。baseline candidate 仍只记录 `requested:false` snapshot，不注入 memory；memory candidate 走 `memory_item` 新检索。runner 读记忆只经 `memory-injection.ts`，不要为了评估直接 import D 的 db CRUD。
- **memory consolidation 写入边界（2026-06-19 E-DISTILL）**：`memory-consolidation.ts` 负责 trace→`MemoryCandidate[]` 蒸馏与候选 coerce，但**不直接 import D 的 `db/data.ts` 写表**；非 dry-run 只能通过 D HTTP API 写入。显式端点与自动 hook 默认 POST `/api/workspaces/:id/memory/ingest`，由 D 负责 risk/dedup/confidence 门禁；`ingestPath` 必须是本地 absolute API path，禁止外部 URL，避免把 server 变成任意 POST 代理。
- **session 显式、flow 自动的沉淀口径（2026-06-19 X→E 调整）**：session 禁止在每轮 chat run-end 自动调用蒸馏 LLM，只能由 ChatPane「沉淀 trace（x）」显式触发；手动端点必须 await runner 并返回 accepted/review/empty/error 结果，不能恢复为无反馈 fire-and-forget。flow / flow_run 仍在完整成功且未 abort 后用 `fireMemoryConsolidation()` 自动触发一次。两类路径都固定走 D `/memory/ingest`，不得绕过门禁直写。session 角标语义是“用户点击次数”，不是成功数；running 与终态必须更新同一 trace 行，防止 count 翻倍。
- **memory consolidation JSON 解析红线（2026-06-19 E-FIX）**：LLM 输出解析不得在 fallback 中裸调 `JSON.parse`，也不得用 `lastIndexOf` 贪婪截取。`memory-consolidation.ts` 因不能依赖 `index.ts` 接缝，局部采用字符串/转义感知的平衡括号扫描；所有 parse 失败返回 `null`，候选层降级为 `[]`，畸形模型输出不能升级成整次任务失败。该链路的默认模型固定为 `minimax-cn/MiniMax-M3`；semantic dedup judge 同口径，显式 model 可覆盖。
- **memory consolidation 分层 tags 口径（2026-06-21 E-MEM2-DISTILL-TAG）**：蒸馏 prompt 按 `task:/industry:/method:/data:/problem:` 五层软约定为每条候选建议 3~5 个适用 tag，不要求五层齐全，避免无依据硬凑。tags 是检索/治理元数据，不参与 E 侧 gate 或 dedup 改判；解析只接受 string array，缺失/畸形一律回填 `[]`。非 dry-run 仍将含 tags 的完整 `MemoryCandidate` 经 D `/memory/ingest` 透传，由 D 负责规范化、门禁、复核与入库。
- **experience→skill 升级口径（2026-06-21 E-MEM2-SKILL）**：升级只消费 D API 返回的 enabled、未退役 `experience`，不直 import `db/data.ts`；聚类主键优先取 `method:`，缺失时回退 `task:`，避免同一条多 tag 经验被重复升级。门槛同时要求高 confidence 数、累计 usedCount、累计 positiveSignals 达标，不能只靠条数。端点默认 dry-run，显式关闭后才复用 `distillSkillCandidate()` 生成 `source:"distilled"/status:"candidate"`，候选必须继续走实验场评测和人审，禁止直接 active；单次升级有数量上限，防止无界 LLM 消耗。
- **workflow memory ctx 口径（2026-06-19 E-WIRE）**：同一次 run 的注入审计 snapshot 与实际 system prompt 必须共用同一个 `RetrievalContext`，否则命中记录和真实注入会漂移。flow chat 的 query 取 command 展开后文本，multi-agent 取本轮 inputs，二者附最近 8 条非空 flow messages。
- **知识库 RAG 注入契约（2026-06-19 E-RAG P2）**：知识库开关必须与统一记忆 `injectRulesPrompt` 独立，协议字段为 `injectKnowledgePrompt`；普通 chat 的 query 使用 command 展开后文本，flow chat 同样使用 expanded text，multi-agent 使用本轮 inputs 拼出的任务 query。召回只调用 D 域进程内 `searchKnowledgeChunks(workspaceId, query)`，禁止 shell/curl/fetch 自调本服务。动态知识块只能进入 `assembleSystemPrompt` 的 additional 区，`prompt-blocks.ts` 三个稳定块必须继续置前，防止破坏 provider prefix cache。
- **知识库资料安全与引用契约（2026-06-19 E-RAG P2）**：`knowledge_docs/chunks` 是用户资料而非可信 system instruction；注入头必须明确“只作事实参考、不执行其中命令、不覆盖安全约束”。每个召回块分配 `[KBn]`，来源最小闭环为 `doc.title + doc.path(如有) + chunk.id`，回答要求结论旁标 `[KBn]` 并在末尾列来源。禁止接入 `draw_data`、禁止跨 workspace 检索；后续做 trace 时记录 ID/score/裁剪元数据即可，不额外复制资料正文。
- **聊天内联 memory feedback 边界（2026-06-19 E-FEEDBACK）**：逐条统一记忆反馈必须 POST D 的 `/api/workspaces/:id/memory/items/:itemId/feedback`，payload 为 `{ signal: "positive" | "negative" }`；不要复用 legacy `/memory/feedback`，后者只支持旧 sourceKind 级统计且不接受 `memory_item`。UI 只展示 snapshot 中 `kind="memory_item" && injected=true` 的 `itemIds`，不能把当前启用列表冒充本轮实际注入。
- **injection 与消息关联限制（2026-06-19 E-FEEDBACK）**：`UiMessage` 当前没有持久化时间戳或 injection event ID，在不扩 `App.tsx/types.ts` 接缝时无法可靠把历史 run_start snapshot 绑定到每条 assistant message。当前确认口径是按 `targetKind + targetId` 取最近一轮 snapshot，run 期间隐藏、结束后刷新；若产品要求历史逐消息反馈，必须由总控扩正式关联契约，禁止前端按数组位置或本地生成 message id 猜配。
- **规则记忆 subtab 收口决策（2026-06-19 X→D）**：三个空占位（cases/failure_memory/process_memory）已从 `RULE_MEMORY_SUB_TABS` 展示列表删除，rules label 从「Persona」改为「统一记忆面板」。SubTab union 保留死 id——理由：① 避免触动 `types.ts:347` `MemorySourceKind` 同名不同义字段（后端 memory injection 的「分析案例库」kind 仍在用）；② `activeSubTab` 不持久化（`useState("view")`），老用户刷新后自动落到首个可见 subtab，无残留风险；③ 若未来要彻底清 union，需先核 `server/src/memory-injection.ts:378` 的「分析案例库」语义是否还在用。CasesPane.tsx（377 行）同步删除。
- **subagent 模板化 prompt 红线（2026-06-16 E·P0）**：模板只能替换 runner 的 persona 角色段；只读指定 `clean_data` 文件、只写 `reportDir`、末条摘要、不提问自主完成等硬性约束必须由引擎在 persona 后恒定追加，不能放进可编辑模板。无模板、模板 disabled、配置缺失或损坏时必须回退 `DEFAULT_SUBAGENT_PERSONA`，保持旧委派行为。`dataFiles` 必须继续走 `safeResolve(cleanDir, basename(f))`，不得因为模板化而放宽到路径直读。
- **subagent 配置安全边界（2026-06-16 E·P0）**：`subagents.json` 是本地模板注册表，不是 shell/webhook 执行配置。CRUD coerce 必须白名单字段、未知字段丢弃；`source` 固定 `custom`，`dataScope` 固定 `clean_data`；persona 视为 prompt 文本，禁止通过外部 URL/外发配置引入联网动作。`toolIds` P0 仅保存清洗结果，不代表工具已挂载。
- **subagent MCP 注入边界（2026-06-17 E·P1）**：模板 `toolIds` 已成为 runner 注入 MCP 工具的实际 allowlist。普通 workspace `.mcp.json` 仍注册全部 analysis 工具；指定模板的子 agent 不改 workspace 根配置，而是以 `<workspace>/sessions/<parentSessionId>/.subagent-cwd/<taskId>` 为 cwd，并在该 cwd 写 scoped `.mcp.json`（`--tools id,id`）。无模板委派保持旧行为，模板 `toolIds: []` 表示无 extraction tool 暴露。该设计避免共享 `.mcp.json` 并发 clobber；代价是子 agent MCP 工具产物默认落在独立 cwd 的 `tool_runs` 下，报告仍必须写入引擎注入的 `reportDir`。
- **subagent WS trace 透传（2026-06-17 E·P2）**：子 agent 可观测性复用 `runDelegatedSubAgent` 已有 `onEvent`，不新建采集链路。后端广播本地 WS runtime 消息 `subagent_event`，字段为 `taskId/parentSessionId/workspaceId/traceKind/event/createdAt`，其中 `event` 保留原始 `PiEvent`，`traceKind` 只做展示辅助粗分。轮询端点仍是终态降级通道；本轮未扩双侧 `ServerMessage` 接缝，是否上正式类型由总控拍板。当前实现广播给所有本地 open clients，D 卡必须按 `taskId`/`parentSessionId` 过滤。
- **subagent HITL 自愈语义（2026-06-17 E·P3）**：HITL 只对“指定 enabled template 的委派”生效；无模板委派保持旧默认，失败仍 `failed`。模板 `maxRetries` 缺省 `3`、显式值 clamp `0..5`，其中 `0` 表示不自动重试，首次可识别错误即进入 `waiting_for_help`。runner 捕获 `tool_result.is_error` / `message.errorMessage` / `stderr` / `spawn_error`，把原始错误上下文喂回同一 `subagent-${taskId}` pi session 自愈；耗尽后复用 `subagent_tasks.error` 存最后错误上下文，不扩 DB schema。`POST /api/subagent-tasks/:id/resume` 仅 loopback，可把人工 `correction` 和 `correctedResult/params/sql` 作为下一轮输入续跑，同一 session、同一 reportDir，成功转 `success`，失败继续 `waiting_for_help`。
- **subagent trace 前端消费（2026-06-17 D·P2）**：`DelegateSubAgentCard` 通过 `gateway.subscribe` 消费 `subagent_event`，按 `taskId` 聚合 trace rows，折叠渲染思考/工具调用/结果/写报告。`SubAgentTraceKind` 正式进入前端 `ServerMessage` union（`web/src/types.ts`），与后端 `classifySubAgentTraceEvent` 的 8 种归类完全对齐。trace rows 每 task 上限 `.slice(-80)` 防内存膨胀；`toTraceRow` id 用模块级递增计数器而非 `Math.random()` 消除理论碰撞。`gateway.connect()` 在 subscribe effect 中幂等调用；`subagent_run_end` 事件触发单 task `getSubAgentTask` 刷新（非全量 `listSubAgentTasks`），WS 不可用时保留原有 3s 轮询作为终态降级。运行中自动展开 trace，终态后仍可手动折叠/展开。
- **subagent HITL 前端 UI（2026-06-17 D·P3）**：`DelegateSubAgentCard` 识别 `waiting_for_help` 态，展示琥珀色修正区：错误上下文 `<pre>` + 修正说明 textarea + 正确结果/SQL textarea（monospace），点「修正并继续」→ `engineApi.resumeSubAgent(taskId, { correction, correctedResult })`。续跑后 task 状态更新为 `running`，自动触发 3s 轮询与 WS trace 订阅。`resumeDrafts` 通过 `useEffect` 监听 `tasks` 变化，自动清理已离开 `waiting_for_help` 态的条目。API slot 在 `web/src/lib/api/engine.ts`，不调 LLM、不碰 server/数据探索子树。P2 trace 流作为 P3 前置依赖一并实现（续跑后用户需要看到 agent 进度）。
- **ExtractionTool AI 聚合度唯一闸口（2026-06-17 E·P1）**：所有 AI/MCP 工具调用都必须经 `POST /api/extraction-tools/:id/run` 且 `source:"ai"`；行数上限护栏只能放在这个 run 端点，不散落到各工具。默认阈值 `100`，env `XANTHIL_AI_TOOL_MAX_ROWS` 可调；不按 `riskLevel` 分档。超限时必须截断响应 summary 并返回 `400` + 「结果超 N 行，疑似明细输出，请加 GROUP BY/COUNT 聚合」。人工 `source !== "ai"` 不受此闸影响。
- **duckdb-aggregate 服务端工具边界（2026-06-17 E·P1）**：DuckDB 聚合工具必须作为独立服务端 ExtractionTool 运行，不能复用数据探索 tab 的前端 `duckdb-wasm` 实例。工具必须先把授权输入物化为 `input_data` 临时内存表，再关闭 DuckDB `enable_external_access`，然后才执行用户 SQL；禁止使用 `CREATE TEMP VIEW` 这类惰性视图承接输入，因为用户 SQL 仍可在同一连接内调用 `read_*` 表函数绕过 `inputPath` 沙箱。工具可以返回聚合结果给 LLM，但明细输出必须由工具 forbiddenUse + `/api/extraction-tools/:id/run` 的 `source:"ai"` 行数闸口共同拦截。该边界对应 AGENTS.md 的两层红线：数据级允许聚合产物，模块级仍保持数据探索前端实例 LLM-free。
- **tool-evaluation case params（2026-06-17 E·P1）**：`tests/cases.json` 支持可选 `params`（string/number/boolean），runner 将其映射到 manifest 参数的 `--param-*` CLI；若 case 未给 params，仍沿用 manifest default，保持旧工具评测兼容。带必填运行参数的工具（如 `duckdb-aggregate` 的 `sql`）应在 case 中显式提供 params，避免为了评测给 manifest 塞不合理默认值。
- Phase 2b 数据分析工具展示采用**事件容错层而非深绑 pi-adapter 类型**：E 侧只认 `tool_call`/`tool_result` 事件和 pi `tool_use`/`tool_result` content block，不改 `pi-adapter/index.ts/types`。这样 X 可继续收敛总控契约，前端只在 `App.tsx` 映射层适配字段差异。
- ExtractionTool 结果产物预览**复用现有工具预览端点** `/api/extraction-tools/preview`，不新增 ChatPane 专属 artifact API。结果卡从 `results[].outputs` 提取产物路径；若工具 summary 不含该字段，只展示原始 JSON。
- **subagent 全局运行看板（2026-06-17 D·看板）**：`listAllSubAgentTasks` JOIN sessions 派生 `workspace_id`，不补 `subagent_tasks` 列、零迁移。`SubAgentTask.workspaceId` 是只读派生字段（JOIN 产出），不是持久化列——workspaceId 是 session 固有属性（单一真源），存进 task 冗余且可能与 session 不一致。看板 ws trace 复用 `subagent_event` 全局广播，按 `workspaceId` 过滤；`subagent_run_start`/`subagent_run_end` 触发全量刷新。前端筛选（工作区/状态/模板）优先走 server 端 status 参数减少传输量，模板筛选纯前端（`templateId` 不在 server 筛选参数中）。
- **subagent skill 子集绑定（2026-06-17，skill 自进化 F；2026-06-18 收尾修订；X-ZH10 收口 2026-06-26）**：委派子 agent 不再继承 pi 默认 skill 策略。双侧 `SubAgentTaskInput.skillPaths?: string[]` 在请求层仍可省略，但执行层 `runSubAgentTurn` 会把 `undefined` 兜底为 `[]`，即默认 `--no-skills`；显式 `[]` 表示禁用 skill，非空数组表示仅注入指定 skill 子集。后端 delegate 入口必须用 `validateSkillPaths(workspace.rootPath, value, { mode:"strict" })` 校验，禁止 slug 直传或路径绕过；校验后的值透传到 `runSubAgentTurn`，由 pi-adapter 生成 `--no-skills --skill <path>` 或空数组禁用。前端 `DelegateSubAgentCard` 用三态按钮表达语义，指定模式复用 `SkillSelector`；**指定模式必须非空才能提交**，不能把“指定但未选择”发送成 `[]`，否则会与“禁用 skill”的协议语义冲突。当前 `skillPaths` 仅为运行时输入，不写 `subagent_tasks`，因此历史看板不展示、resume 不恢复；若要审计/复用需另扩 schema/provenance。

### Phase5 runner 范式收敛评估（2026-06-21）

- **结论：维持六 runner 各自实现，只共享稳定 helper；本期不抽统一 runner 内核。** 六文件共 2,782 行，其中 skill/prompt 共 1,324 行、控制流和 pairwise judge 高度同构；但两者在 variant 注入、activation、context、prompt 组装和结果类型上已有实质差异。其余四类差异更大：tool 执行本地进程并做文件/golden/schema 判定，command 混合静态展开与 pi 实跑，subagent 管轨迹/预算/report，hook 是严格零副作用的同步纯判定。
- 已有共享边界合理：`evaluation-common.ts` 统一 metrics/event/judge，`evaluation-errors.ts` 统一错误结构，`evaluation-archive.ts` 统一归档入口。若把 run loop、case 执行、expectation、summary 强塞入泛型内核，会引入大量 callback/type parameter，并模糊 hook 的“零 spawn/零 fs”安全边界，收益低于维护成本。
- 后续只在**至少两个 runner 同时修改且语义完全一致**时抽 helper。候选仅限 `sanitizeEvaluationId`、repeat/case 基础校验、分组汇总与 pairwise 数值聚合；expectation 执行、目录布局、prompt 构造、side effect 策略继续留在各 runner。skill/prompt 的 pairwise helper 重复度最高，但应先补跨域等价测试，再单独提取，不能借本期呈现层 DRY 顺带改执行语义。

### Phase5 P5-2 跨 lab 回归看板 + CI gate（2026-06-21）

- **聚合口径：六类指标字段不统一，按 lab 各写 adapter，不抽巨型 union。** 六类 `*_summaries` 命名/形状各异（skill/prompt 有 `variantSummaries`+`pairwiseSummaries`+`activationRate`，tool/command/subagent/hook 只有 `caseSummaries`）。统一时间线点 `LabTimelinePoint` 收敛为 4 个可比指标：`score`（pairwise 胜率优先，否则 = passRate）/`passRate`（Σsuccess/Σtotal）/`winRate`（仅 skill/prompt）/`activationRate`（仅 skill）。缺失维度填 `null`，门禁对 null 指标**跳过**不判，避免误报。
- **resourceId 语义**：skill/prompt 每个非 baseline variant = 一个资源（resourceId=variantId，skill 即 registry id）；tool=toolId、command=commandId；subagent/hook 无资源维度，整集聚合为单点 resourceId=`"-"`。skill/prompt 必须**排除 baseline variant**（它是参照系不是被评对象）。
- **门禁阈值复用 skill-regression 口径并推广**：`DEFAULT_REGRESSION_GATE_THRESHOLDS` 沿用 skill 的 scoreDrop 0.1 / activationRateDrop 0.2，新增 passRateDrop/winRateDrop 0.1。判据同样是 `delta <= -drop`（与 `compareSkillRegression` 一致），保证跨 lab 与既有 candidate→active 升级口径一致。门禁是**只读判定**，不写库、不触发评测、不重算回归历史——CI gate 消费聚合真源即可。
- **接缝边界**：`lab_regression` 子 tab 需改接缝 `constants.ts`（E 不碰），故用 `String(activeSubTab)==="lab_regression"` 逃生口渲染 + 总览按钮进入，功能可达；左栏一级 tab 待总控合入。此模式与 P5-1 `lab_overview` 合入前完全一致。

**知识库搜索 UI 与全文注入（E-KB3 / E-KB4，2026-06-24）**
- 2026-06-24 E-KB3 端点选择：搜索 UI 走 D-KB1 `GET /knowledge/search`（doc 级聚合）而不是 chunk 级 `POST /knowledge/search`。理由：用户视角是「找文档」不是「找片段」，doc 级聚合已在 D 域做了 max(chunk.score)*0.6 + avg(top3)*0.4 + tag boost，UI 层不应自造聚合。chunk 级 API 仍保留供未来「片段检索 / 评测」复用。
- 2026-06-24 E-KB3 防抖范式：受控 input + 300ms 防抖 + 自增 `requestTokenRef` 防 race（复用 `SkillManagementPane.tsx` P1-B `adoptRequestTokenRef` 范式），不用 `AbortController`。原因：防抖期间用户连续输入会触发多个 setTimeout，token 比较比 abort 简单；fetch 失败 catch 路径不需要额外区分 AbortError。
- 2026-06-24 E-KB3 抽屉范式：复用 `ReportPreviewDrawer` 同款全屏遮罩 + 右侧 `max-w-3xl` aside + Esc 关闭 + 遮罩点击关闭。否决「单独再做 modal 库 / portal 组件」。两者的视觉/交互应当统一，只是数据源不同；Markdown 渲染统一走 `@/components/Markdown`。
- 2026-06-24 E-KB3 搜索/注入解耦：「知识库搜索」=主动消费（用户点查 → 看 → 复制引用），「知识库注入」=被动 RAG（chat 时自动塞 system prompt）。两者必须独立勾选/操作。资料库 tab 的 enablement checkbox 控制注入；搜索 tab 没有 checkbox。
- 2026-06-24 E-KB4 fullDocMode 触发口径（按题面 X-KB0 契约）：`hits[0].score > 0.75 && (hits.length === 1 || hits[0].score > hits[1].score * 2.0)`。**这是字面契约且偏严**：单文档被切成多 chunk 时 top1 与 top2 通常不会差 2×，多数情况会回退 chunk 注入；只有「短文档单 chunk 命中」或「query 精确命中标题/heading 触发 +40 boost」时才走全文。这是有意保守——只有把握很大时才送 40000 字全文，避免无脑放大 prompt 长度。后续若产品要求更激进，需要总控放宽阈值或参数化。
- 2026-06-24 E-KB4 接缝不污染：`buildFullDocPrompt` 是 `knowledge-injection.ts` 内部 helper，未导出；`buildKnowledgePrompt` 签名/调用方零变化（仅 `KnowledgeInjectionOptions.fullDocMode?` 新增可选字段，X-KB0 已预留）。`routes/engine.ts` / `index.ts` 现有调用方完全不传 `fullDocMode` → 默认 `false` → 行为零变化。这种「新字段可选 + 默认关 + 调用方零修改」是接缝增量的最佳形态，应作为后续注入器扩展的范式。
- 2026-06-24 E-KB4 测试断言要点：「fullDocMode > chunk 长度」必须用长文档（≥ 8k 字、多 chunk）+ heading 命中 query 词，让 top1 chunk 通过 +40 heading boost 远超 top2；同时让 chunk 注入因 `DEFAULT_MAX_CHARS=6000` 截断。单 chunk 的短文档虽然能满足 `hits.length===1` 阈值，但 chunk 注入也能完整放下整个 chunk，全文 prompt 反而可能更短（只多了 header）。这是写 KB 注入测试时容易踩的尺寸陷阱。

---

## 四、踩坑 / 陷阱

- **domain router 注册晚于 legacy 路由，通配路由会抢先匹配**（2026-06-20 E-LAB1）：legacy `POST /api/evaluations/:kind/:id/archive` 在 `registerDomainRoutes(app)` 之前注册，会先吞掉 `/api/evaluations/prompt/:id/archive` 并按未知 kind 返回 400；在不改冻结 `index.ts` 的约束下，prompt 归档必须使用不冲突的专用路径 `POST /api/prompt-evaluations/:id/archive`。以后给 domain router 新增路由前，必须先扫描 legacy 同 method 的静态/参数化路径和注册顺序，不能只看路径字符串是否完全相同。
- **prompt baseline 不能沿用 skill 的“空 skillPaths”发现规则**（2026-06-20 E-LAB1）：prompt variant 每个都必须有非空 `promptBody`，因此 baseline 明确定义为 `variants[0]`。若继续复制 skill 的“空资源 variant 或 id=baseline”选择逻辑，会出现无 baseline、pairwise 全不执行。
- **pi CLI 调用**：`runPiPrompt()` 用 `--no-skills`，**不要用 `--no-extensions`**（会禁用模型 provider 扩展导致 LLM 调用失败）。见 `pi-adapter.ts`。
- **pi skill 子资源读取能力已实测（2026-06-15）**：`pi -p --no-skills --skill /tmp/.../SKILL.md --tools read` 可在 skill 激活后读取 `SKILL.md` 内写的 `./scripts/answer.txt` 相对路径并输出文件 marker。注意：临时隔离 `PI_CODING_AGENT_DIR` 会丢失用户 provider 配置导致 `No API key found`；做真实 smoke 需要允许 pi 读取现有配置。实测时出现过无关 `ptk-memory-inject` 扩展的 `better-sqlite3` Node ABI warning，不代表 skill 子资源失败。
- **AnaX 结构块解析必须容忍真实 LLM 格式漂移**：MiniMax 真跑会输出 ````anax-verdict{...}` / ````anax-hypotheses-plan[...]`（marker 后无换行），也可能先在 `<think>` 中复述一个无效示例块，再在末尾输出有效块。解析器必须扫描所有同名 fenced block，跳过无效 JSON，取最后一个有效 JSON；只取第一个 block 会误判 gate/fan-out 失败。
- **AnaX data_gate 不应把分项风险当整体质量硬阻断**：真实数据报告可出现综合评分 8/10，但时效性/口径清晰度等分项 6/10。硬阈值只应卡整体数据质量 stage；分项风险通过 summary/下游硬约束透传，否则会把“可分析但有约束”的数据误杀。
- **AnaX fan-out 上限必须和 plan 假设数量一致**：plan 真跑可能生成 12 个假设；若 `maxItems` 仍是 8，H9-H12 永远不验证，review_gate 会因 evidence=0 / confidence=low 必然阻断。
- **AnaX archive flywheel 只读本轮回复会漏写**：真实 archive 可能把完整 `anax-hypotheses` 写进 `09-archive-summary.md`，但本轮回复只输出摘要，导致 `onBlackboardUpdate("archive")` backfill=0。prompt 已要求本轮回复末尾原样输出结构块；若仍不稳，下一步考虑 runner 从 `specs/09-archive-summary.md` 兜底读取。
- **skill distillation frontmatter 提取不能取第一个 `---`**：真实 LLM 可能在 `<think>` 中输出自查清单、fenced YAML 示例和最终 SKILL.md。`extractSkillMarkdown()` 应优先找最后一个 `--- + name:` frontmatter；否则保存后 `listSkills()` 会识别为 project source 但 `available:false`（缺 description）。
- **coverage gap 测试样本不能用通用分析词判断“无命中”**：`retrieveSkills()` 会扫描全局 skill、项目 skill 和自动生成的 `xanthil-extraction-tools`，测试环境也可能有用户全局 skill；像 `analysis/retention/cohort` 这类普通词可能被已有 skill 命中，导致 gap cluster 为空。focused test 应使用唯一 marker token 或显式 mock retrieve，避免被本机全局 skill 污染。
- **skill registry POST 必须和文件路径强绑定**：registry 的 `slug` 同时决定 DB 行和 `<workspace>/.pi/skills/<slug>/SKILL.md` 路径。不要接受带 `/`、`\`、`..` 的 slug，也不要从请求体直接信任目标路径；否则会把“采纳 skill”变成任意文件写入。
- **registry usageCount 不等于 activation**：`usageCount` 只说明系统把某 skill path 注入了一次；模型是否真正用了它要看评测 `activationRate` 或未来生产激活事件。不要用 usageCount 直接判断 skill 有效性。
- **candidate→draft 是语义复用，不是普通草稿**：P1 A 为避免扩 `SkillStatus`，把 `draft` 用作“达标待人审采纳”。任何 UI/文档展示都应写“待采纳”而不是只写“草稿”，否则会误导用户以为尚未评测。
- **workflow skillPaths 保存时会规范化并过滤无效路径**：`GET/PUT /api/flows/:id/workflow` 调用 `normalizeWorkflowSkills()`，沿用 lenient 规则。无效路径会被剔除而不是 400；前端保存后应以重新加载结果为准，不要假设用户输入的每个 path 都落盘。
- **node.skillPaths 三态不要混淆**：`undefined` 是继承 workflow 默认，`[]` 是明确禁用默认 skill，非空数组是指定子集。前端 patch 时如果想恢复继承必须把字段设为 `undefined`，不能写空数组。
- **回归门禁阈值测试要避开浮点毛刺**：判据是 `delta <= -drop`。`0.8 - 0.9` 在 IEEE754 下 = `-0.0999...` > `-0.1`，**不触发** regression（与 `compareSkillRegression` 同源行为，不是 bug）。写边界测试别用相邻 0.1 倍数（如 0.8 vs 0.9），用明确跨界值（0.75 vs 0.9 = -0.15 触发；0.85 vs 0.9 = -0.05 不触发）。activationRate 的 `0.7 vs 0.9` 反而因 `-0.20000000000000018 <= -0.2` 恰好触发——别依赖恰好相等的边界。
- **工具事件重复显示风险**：pi 可能先流式透传 `tool_call/tool_result`，最终 `message_end` 又带完整 `tool_use/tool_result` content。ChatPane 必须按 `id/tool_use_id` 去重，否则用户会看到两套工具卡。
- **ExtractionTool skill 不是红线本体**：skill 文字只能引导模型选择 clean_data；真正防泄漏必须依赖后端 `POST /api/extraction-tools/:id/run` 的 `source=ai`、`workspaceId` 和已登记 `clean_data` 校验。不要在前端或 skill 文案里把软约束误认为安全边界。
- **AI 行数护栏不能把 `items` key 一律当明细**（2026-06-17 E·P1）：`market-basket` 的聚合项集结构是 `{ items: string[], size, support }`，若把所有 `items` 数组按明细截断，会把一个项集内部的商品列表截坏。护栏应优先识别明确明细 key（`rows/records/data`）、对象数组、以及 `rowCount/totalRows` 类计数字段；不要把任意数组都当原始行。
- **递归 guard 的返回对象求值顺序坑**（2026-06-17 E·P1）：`return { blocked, summary: visit(value) }` 会先读取旧 `blocked=false`，再执行 `visit()` 的副作用，导致 summary 被截断但状态仍返回未阻断。必须先 `const summary = visit(value)`，再 `return { blocked, summary, maxRowsSeen }`。后续有副作用递归聚合状态时同理。
- **Python 工具依赖与 py_compile 的本地差异（2026-06-17 E·P1）**：`duckdb-aggregate` 依赖 Python 包 `duckdb`，新环境需按 `server/tools/requirements.txt` 安装；缺依赖时工具应给出明确错误而不是吞异常。macOS/sandbox 下直接 `python3 -m py_compile ...` 可能尝试写系统 pycache 被拒，验证 Python 工具语法时可设置 `PYTHONPYCACHEPREFIX=/tmp/pi-xanthil-pycache`。
- **SQL loop 不能让 tool 节点非零退出**：普通 tool node 失败会在 runner 中立即 `return { code }`，下游 gate 不会执行。SQL loop 的可修复失败必须编码进 `run_sql` JSON 的 `code/success/error`，workflow 层保持 `code:0`，由 `sql_gate` block 并写入 `sql_error`。
- **SQL 关键字段校验依赖结果 columns，不依赖首行 row key**：空结果时 rows 无法提供字段信息；后续若要支持“空结果但 schema 字段完整”的场景，需要总控明确是否允许 `rowCount=0` pass。目前 T-E4 验收要求结果非空，所以 `rowCount=0` 一律 block。
- **设计页运行态恢复不是跨进程恢复**：`chat-runtime` 只反映当前 server 进程里的 `activeFlowRuns`。如果 server 重启或 pi 已异常退出，前端只能看到历史消息/已落盘 workflow，不能继续上一轮生成。不要把该能力描述成“断点续跑”。
- **设计/执行切换不应重复展示同一张图**：设计页去掉上半流程节点预览，避免和执行页 DAG/执行流重复。设计页承担“结构化输入 + 局部 patch + 生成状态”，执行页承担“查看/编辑节点配置 + DAG + 运行”。
- **readme 内容会随 UI 收敛漂移，改入口必须同步**：`WorkflowReadmePane` 是手写 JSX，里面写死了 tab 命名与生成入口口径。2026-06-14 修过两处漂移——把已收敛掉的「对话」生成入口改成表单式「设计 + 迭代修改」，把「聚合数据 → SQL连接」修正为「计算工具 → SQL连接」(`sql_connect` 实际挂在顶层 `aggregate`/计算工具 tab，见 `constants.ts AGGREGATE_SUB_TABS`，不在 `clean_data`/聚合数据 子 tab 下)。凡收敛 tab/入口/归属，必须回头扫 readme。
- **依赖 workflow 的 effect 会被「每次编辑换引用」反复触发**（2026-06-14 已修，列此防回归）：`useMultiAgentRun` 恢复 effect 原把 `workflow` 放进 deps（为了读 `workflow.nodes` 做目录→step 映射），但 `setWorkflow` 每次编辑都建新对象，导致 effect 每次编辑重跑、反复打 `listFlowRuns`/`flowRunTree`。通用解法：把「网络拉取（只依赖 flowId）」与「依赖 workflow 的纯映射」拆成两个 effect，纯映射用一个中转 state（如 `restoreDirs`）承接，映射后置空使其「一次即消费」。凡 effect 依赖频繁换引用的大对象、却只想跑一次，都按此拆。
- **执行侧 workflow 加载与设计↔执行切换的两个雷**（2026-06-14 已修，列此防回归）：① `MultiAgentExecutionPane` 加载 effect 的 `flowWorkflowGet` 必须带 `.catch` 兜底 `setLoading(false)`，否则拉取失败会卡死无限 spinner（设计页自己的 refresh 有 try/catch，执行侧曾漏）。② 进入 execute 视图会按 `workflowRefreshKey` 从 server 重新加载并 `setWorkflowDirty(false)`，这会丢弃执行侧未保存的节点手改；任何触发「切到 execute + bump refreshKey」的入口（`applyToEditor` / 顶部「执行」tab）都应走带 `workflowDirty` 守卫的同一函数，不要各写内联 `setView+refreshKey`。「设计」tab 不 reload，无需守卫。
- **readme markdown 单一真源在 `web/src/docs/`**：`ExploreReadmePane`/`AggregateReadmePane` 用 `@/docs/*.md?raw` 导入，`@` 解析到 `web/src/`。不要在根 `docs/` 再放同名副本——`?raw` 只消费 `web/src/docs/` 那份，根目录副本无人引用且必然漂移（2026-06-14 已删根 `docs/explore-readme.md`/`aggregate-readme.md`）。
- `scope` 对象字面量每次渲染新引用 → `useCallback([scope])` 重建 → effect 清空画布。根治：Pane 内提取稳定原始值（scopeType/scopeSessionId/scopeFlowId）作 deps，不改 App.tsx 内联写法（项目惯例）。
- 流式响应中断（`Stream ended without finish_reason`）：建议切 MiniMax-M3 重试，长报告分块写文件。
- **onto-extract 文档抽取的两层硬上限**（2026-06-11 hotfix 已调）：①`CONTENT_LIMIT`（字符截断，原 6000 → 现 24000）是真正决定"能不能看到文档后半段"的开关；②prompt 配额（实体/关系/逻辑/动作 ≤N）是次级限制，长文档若超配额会被模型自行裁掉。**所有抽取调优必须双层一起看**，只调一层都不够。
- **onto-extract 分块抽取的"合并几乎免费"**：`processExtractionOutput` 是纯函数 + 已有同名去重（entity nameCn / logic nameCn / link `src|tgt|kind`）+ `resolveId` 模糊匹配，对同一 `ontologyId` 多次调用可天然合并落库。未来要做分块只需在 `extractOntologyFromText` 外层切分 + 串行多次跑 `runPiPrompt` + 逐次喂 `processExtractionOutput`，**不必动质检流水线**。但分块切分本身是难点：按段落边界（双换行/标题）切 + ~200 字 overlap，不要 `slice(0, N)`。
- **onto-extract "按名去重"对编辑不友好**：line 233-241 已存在则 `continue`，后入块即便 description 更富也不会更新。未来要做"以新换旧/取富者"需改这段逻辑；这是分块上线前要先解决的 TODO。
- **GET querystring 传业务文本会触发 414**（2026-06-14 P1-B 已规避）：`/api/workspaces/:id/skill-registry/conflicts?content=...` 这类把整段 SKILL.md 文本塞进 query 的设计，浏览器侧 ~8KB、nginx 默认 8KB、其他反向代理 4-16KB 不等，实测踩到的不是 fetch 失败而是 414/400。规避：客户端 `truncateConflictContent` 4KB 上限（`web/src/lib/skillConflict.ts`）。**任何后端读 `req.query` 中长文本字段的端点都应：① 改 POST body；或 ② 客户端必须有上限**；不要假设 GET 想塞多少就能塞多少。
- **`AbortController` 不是 race 防护的唯一解**（2026-06-14 P1-B 已修，列此供后续参考）：弹窗预查询 + 用户连续切换目标场景下，`AbortController` 会让旧请求抛 AbortError，需要在 catch 内手动区分；用 `useRef<number>` 自增 token + 回调首行校验 `token === ref.current` 就够了，简单且不污染 catch 分支。该范式已在 `SkillManagementPane.tsx` `adoptRequestTokenRef` 落地。
- **窗口内 fetch 回调的 setError 写到主面板会被遮住**（2026-06-14 P1-B 已修）：弹窗渲染于 `fixed inset-0` 全屏遮罩之上，主面板的 error banner 被遮罩盖住，用户根本看不到。所有 modal 内异步操作都应有**弹窗内独立 errorState**（如 `adoptError`），不要复用主面板 `error`；同时 `try/catch/finally` 中复位 `submitting=false` 必须用 `finally`，否则成功路径与失败路径状态机容易漂移。
- **同名不同义陷阱：前端 SubTab vs 后端 MemorySourceKind（2026-06-19 记忆重构收尾）**：前端 SubTab `'cases'` 与后端 `MemorySourceKind "cases"` 是同名字符串但语义不同——前端是已下线的空占位 tab，后端是 memory injection 的「分析案例库」记忆源 kind（`memory-injection.ts:378` 仍在装配）。清理前端展示列表时保留 union 中的死 id，避免强删引发不必要的服务端类型联动审查。**任何涉及 SubTab 或 MemorySourceKind 的清理必须先核两侧语义是否耦合。**
- **workflow 读取失败必须区分「文件损坏」与「运行配置过期」，禁止统一回退默认 workflow**（2026-06-19 临时快修 · 总控终审落地）：`GET /api/flows/:id/workflow`（`engine.ts:266`）原把「读文件 + `JSON.parse` + `normalizeWorkflowModels/Skills`」全包在一个 `try`，任一抛错都回退 `inferWorkflow()`。坑：**模型/skill 运行配置过期会让 normalize 抛错，进而静默丢弃用户有效的 `workflow.json`**，用户看到的是被推断出来的默认结构、以为自己的编辑没保存。现拆三态：① 文件不存在（content=null）→ inferred；② `JSON.parse` 失败（文件真损坏）→ inferred + warning；③ 文件有效但 normalize 抛错（仅运行配置过期）→ **返回原始 parse 出的 workflow + warning，不回退**（有效文件即真源）。通用原则：凡「读取 → 规范化 → 失败回退」链路，必须区分「源不可用」与「源可用但规范化失败」，后者不可静默丢源。
- **fullDocMode 测试尺寸陷阱（2026-06-24 E-KB4）**：断言「fullDocMode 注入长度 > chunk 注入长度」时，**短文档（< chunk budget 1200，单 chunk）反而会让 fullDocMode 输出更短**——chunk 注入能完整放下整个 chunk 文本，而 fullDocMode 只多出 header 几行；真正能拉开差距的场景是「长文档（≥ 8k 字 → 多 chunk）+ heading 命中 query 词触发 +40 heading boost 让 top1 远超 top2 + chunk 注入因 `DEFAULT_MAX_CHARS=6000` 被截断」。后续给 KB 注入器加新模式时，测试构造必须先想清楚「在什么尺寸场景下新模式能拉开差距」，不能复制短文档样例。
- **超长 TSX 工具入参截断陷阱（2026-06-24 E-KB3，再次踩到）**：单次 `edit`/`write`/`bash` 工具入参里嵌入大段 TSX（含中文 + JSX + 多层嵌套），传输层 JSON 在约 10KB 处会被截断成 `Unterminated string`。本次写 `KnowledgeBasePane.tsx` 新 `SearchView + SearchResultCard + DocFullTextDrawer`（~280 行）时再次触发，最终方案：① 用 sed 删除旧 SearchView 段；② 把新代码切成 3 个 < 200 行的 part 文件，每个走独立 `write`；③ 用 `head + cat + tail` 合并到主文件。**重申既有约定：>200 行新 TSX 一律分块写，不要一次性 write/edit 整段。** 详见既有 E-LAB2 同款决策。

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
