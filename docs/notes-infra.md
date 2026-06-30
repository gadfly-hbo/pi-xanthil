# 横切基础设施 · 领域笔记（总控持有）

> **活文档**：总控持有的横切基础设施知识（缓存 harness / prompt 契约 / 接缝层指针）。
> 蒸馏自旧 handoff：`缓存命中`。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> 接缝重构（routes/db/api/tabs 拆分）记录见 `Orchestration.md §四`。

---

## 0. 当前状态（总控维护，覆盖式）

> 📌 **v2.3 已发布（2026-06-26，总控）·「零幻觉·数据可信地基」**：交付已归档进 `docs/wiki.html` CHANGELOG v2.3（current），v2.2 归档、2.3 阶段进行中。2.3 发布后增量（Harness 全专题等）见 `Orchestration.md §八「2.3 阶段进展」`。详见发布节点。

- 最近更新：2026-06-30 · 总控（tool-use 治理中枢 v1 全链验收收口）
- 本批（2026-06-30 · tool-use 治理中枢专题，总控终审）：
  - ✅ **X-TOOLUSE0 / D-TOOLUSE1 / E-TOOLUSE2 / V-TOOLUSE3 / E-TOOLUSE4 / E-TOOLUSE5 / X-TOOLUSE6 全部 done**：tool-use v1 可作为“治理中枢”归档；唯一注册源仍为 `server/tools/<id>/tool.json`，唯一执行网关仍为 `POST /api/extraction-tools/:id/run`。
  - ✅ **Registry 收口**：当前 25 个工具、18 个 `analysis`、7 个 `ingestion`；18/18 analysis 均含 `python-analysis`；ingestion 工具不补 tags，避免误导 AI 暴露；所有工具经 registry 返回稳定 `tags/category/riskLevel`。总控补齐 3 个旧 ingestion 工具 `riskLevel` 元数据：`extract-sycm-member=L1`、`extract-xhs-insight=L1`、`phone-cleaner=L2`。
  - ✅ **跨模块暴露策略收口**：`server/src/tool-policy.ts` 统一 server 侧 analysis 暴露口径；MCP tools/list 与 tools/call、command coerce、subagent server coerce 均复用或对齐 analysis-only 策略；前端 command/subagent/workflow 候选只展示 analysis；workflow 定义只保存 `toolId + params`。
  - ✅ **运行台账与质量闭环收口**：继续复用 `trace_events` 作为过渡 Tool Run Ledger，记录成功、失败、validation failure、row guard failure 的脱敏 metadata；`GET /api/workspaces/:id/tool-runs` 支持 toolId/caller/source/status/limit 过滤；ToolUsePane 展示搜索、tags/category/risk 筛选、能力矩阵和运行台账；ToolLab 展示 cases 覆盖、L1+ 边界 case 提示、policy 缺失提示与最近 eval 状态。
  - ✅ **验证**：tool-policy/command-tool-policy/tool-run-ledger 6/6；tool-evaluation-api/tool-evaluation-runner 16/16；row guard/metricSnapshots/MetricVerification 39/39；`npm run typecheck` 通过；`npm run build` 通过，仅既有 ECharts dynamic import/chunk warning；数据探索隔离 grep 无匹配。
  - 📌 **红线继续有效**：数据探索子树永不接 LLM/tool-use 自动调用；`ingestion` 永不进入 AI/MCP/subagent/command/workflow 自动候选；`analysis` 工具可处理已登记数据路径，但输出不得含原始行级明细；run ledger/trace/eval case 不保存文件正文、样本行、SQL 明细或 draw_data 原始内容。
  - 📌 **残留 / 下一步**：失败 run 转 candidate case 首版仅明确安全路径（ledger metadata + artifact basename，经用户确认生成草稿），真正草稿生成确认流放入 X-TOOLUSE7 后续增强；独立 `tool_runs` 表、manifest v2 完整字段、标准输出契约、工具推荐器均留待 X-TOOLUSE7 解冻后再拆；浏览器点击级 smoke 未自动化，保留用户手动点检。
- 历史批次（2026-06-29 · trace/业务环境/onto-knowhow 专题收口）：
- 本批（2026-06-29 · trace 迭代专题，总控终审）：
  - ✅ **X-TRACE8 全链验收通过**：trace 专题 `X-TRACE0 / V-TRACE1 / D-TRACE2 / V-TRACE3 / D-TRACE4 / V-TRACE5 / E-TRACE6 / V-TRACE7 / X-TRACE8` 全部 done。TracePane 已具备运行、失败、记忆注入、规则提炼、巡检建议、说明六分面；事件详情抽屉、failure 状态闭环、纯规则巡检建议已接入。
  - ✅ **验证**：`node --experimental-strip-types --test server/src/trace-detail.test.ts server/src/trace-failure-state.test.ts server/src/trace-inspection.test.ts server/src/metric-injection-trace.test.ts` 30/30 通过；`npm run typecheck` 通过；`npm run build` 通过，仅既有 Echarts dynamic-import 与 chunk-size warning。
  - ✅ **安全红线**：trace detail 经后端脱敏，inspection finding 只含聚合计数、target、errorType、status、omittedReason 等元数据；自动巡检零 LLM 调用，不读取 `draw_data` / `clean_data` 文件正文；failure 状态更新只写 `trace_failure_states` metadata，不删除 `trace_events`。
  - 📌 **残留风险 / 下一波建议**：真实长周期 trace 数据量性能未压测；detail 脱敏覆盖率需随真实日志样本扩充；巡检阈值是否需要 workspace 级配置待观察。另 failure status 前端本地过滤超量不完整、巡检 API 失败保留旧列表，后续可小修。
- 本批（2026-06-29 · 业务环境迭代专题，总控规划/派发）：
  - ✅ **X-BC0 已完成拆卡**：围绕业务环境说明页列出的 4 个优化方向，拆为 `X-BC0`（契约/派发，done）→ `D-BC1`（元数据字段、冲突检测、CSV/JSON 导入导出、过期过滤）→ `E-BC2`（business_context 注入痕迹采集）→ `D-BC3`（BusinessContextPane 工作台 UI）→ `X-BC4`（全链验收）。
  - ✅ **D-BC1 已回流并通过总控复核**：后端已接入 `source` / `owner` / `validFrom` / `validUntil`、旧库幂等迁移、create/update 校验、prompt 过期过滤、确定性冲突检测、CSV/JSON import preview/commit/export API、双侧类型/API client 与治理单测；导入导出 UI 未做，留给 `D-BC3`。
  - ✅ **D-BC1 验证**：`XANTHIL_DATA_DIR=/tmp/pi-xanthil-bc1-review node --test server/src/business-context-governance.test.ts` 6/6，通过；`npm run typecheck` 通过；`npm run build` 通过，仅既有 `echarts` dynamic-import 与 chunk-size warning；数据探索隔离 grep 无输出。
  - ✅ **E-BC2 已回流并通过总控复核**：已新增/接通 `business_context_injection_traces`，从 `MemoryInjectionSnapshot.sources(kind='businessContext')` 提取当前工作区启用/可见条目，记录 title/category/targetScope/targetKind/targetId/injected/tokenEstimate/omittedReason，并在日常 chat、workflow chat、multi-agent run 三处注入点接线；查询 API 为 `GET /api/workspaces/:id/business-contexts/traces`。
  - ✅ **E-BC2 验证**：`XANTHIL_DATA_DIR=/tmp/pi-xanthil-ebc2-review node --experimental-strip-types --test server/src/metric-injection-trace.test.ts` 17/17，通过；`npm run typecheck` 通过；`npm run build` 通过，仅既有 `echarts` dynamic-import 与 chunk-size warning；数据探索隔离 grep 无输出。
  - ✅ **D-BC3 已回流并通过总控静态复核**：`BusinessContextPane` 升级为管理、冲突治理、导入导出、使用痕迹、说明五视图；管理表单接入 `source/owner/validFrom/validUntil`；冲突页接 D-BC1 API；导入导出支持 CSV/JSON preview→commit 与 export；使用痕迹页接 E-BC2 trace 数据并提供空态/有数据态。另新增 `vizApi.listBusinessContextInjectionTraces` 与 `/api/workspaces/:id/business-context-injection-traces` 便于 viz 域前端消费。
  - ✅ **D-BC3 验证**：`npm run typecheck` 通过；`npm run build` 通过，仅既有 `echarts` dynamic-import 与 chunk-size warning；数据探索隔离 grep 无输出；回归复跑 `XANTHIL_DATA_DIR=/tmp/pi-xanthil-dbc3-bc1-review node --test server/src/business-context-governance.test.ts` 6/6、`XANTHIL_DATA_DIR=/tmp/pi-xanthil-dbc3-ebc2-review node --experimental-strip-types --test server/src/metric-injection-trace.test.ts` 17/17。
  - ✅ **X-BC4 已完成总控收口**：专题状态为 `X-BC0 / D-BC1 / E-BC2 / D-BC3 / X-BC4` 全部 done；静态门禁、治理/痕迹回归、数据探索红线与 wiki/notes 收口已完成。浏览器 smoke 原计划覆盖新增 source/owner/validUntil、过期过滤、冲突治理、导入 preview/commit/export 与使用痕迹；按用户指示跳过，由用户后续自行点检。
  - ✅ **X-BC4 验证**：`XANTHIL_DATA_DIR=/tmp/pi-xanthil-xbc4-bc1 node --test server/src/business-context-governance.test.ts` 6/6，通过；`XANTHIL_DATA_DIR=/tmp/pi-xanthil-xbc4-ebc2 node --experimental-strip-types --test server/src/metric-injection-trace.test.ts` 17/17，通过；`npm run typecheck` 通过；`npm run build` 通过，仅既有 `echarts` dynamic-import 与 chunk-size warning；数据探索隔离 grep 无输出。
  - 📌 **总控口径**：业务环境会进入 LLM prompt，只能保存可共享业务背景；禁止 draw_data 原始行、个人敏感信息、订单样本、客户明细或未脱敏日志。冲突检测、导入校验、痕迹采集全部确定性，不新增 LLM 调用。
  - 📌 **残留风险 / 下一波建议**：浏览器点击级验收由用户手动执行；trace 查询存在 `business-contexts/traces` 与 `business-context-injection-traces` 两个入口，功能不阻断，后续可收敛到 canonical 路径。下一波增强维持三项：Markdown 导入、冲突处理 workflow、基于使用痕迹/反馈/老化信号的评分降权。
- 本批（2026-06-29 · onto-knowhow 迭代专题，总控终审）：
  - ✅ **X-OKH8 全链验收通过**：新增 `server/src/okh-full-acceptance.test.ts`，一条确定性验收覆盖 6 个用户场景：空工作区启用 member 模板、同名指标冲突检测、缺失标准文件体检、metric injection trace 记录、CSV preview/commit/export、metric ↔ ontology object 关联与反查。
  - ✅ **专题状态**：X-OKH0 / D-OKH1 / D-OKH2 / E-OKH3 / D-OKH4 / V-OKH5 / D-OKH6 / V-OKH7 / X-OKH8 全部 done；`docs/wiki.html` OKH 专题已收口。
  - ✅ **长期口径**：OKH API 只处理指标口径、标准文件元数据、启用关系、痕迹和 ontology 关联；标准文件体检只做 `stat/access` 与路径元数据判断，不读取正文、不走 LLM；本体联动首版全部人工选择，不做自动抽取/自动匹配。
  - ✅ **验证**：OKH 相关测试串行 20/20（OKH8 1、import/export 4、ontology link 4、metric injection trace 11）、`npm run typecheck`、`npm run build` 通过；数据探索隔离 grep 无匹配。build 仅既有 `echarts` dynamic-import 与 chunk-size warning。
  - ⚠️ **残留风险**：真实浏览器点击级验收未自动化；真实 LLM 日常对话触发痕迹未实跑，当前用 deterministic `recordMetricInjectionTraces` 覆盖存储与查询闭环。下一波建议优先补 Playwright 冒烟与真实对话 smoke，再考虑用户自定义模板、冲突处理工作流、Excel/Markdown 导入。
- 历史批次（2026-06-27 · 监测目标测算专题，总控规划/派发）：
- 本批（2026-06-27 · 监测目标测算专题，总控规划/派发）：
  - ✅ **X-MONITOR-TARGET0 总控契约完成**：双侧 `types.ts` 镜像新增 `TargetScenarioKind`/`TargetMetricKind`/`TargetCase`/`TargetPlanStatus` + `TargetAssumptions`/`TargetCalculationInput`/`TargetCaseResult`/`TargetBreakdownItem`/`TargetCalculationResult`/`TargetPlan`。详见 §十三。
  - ✅ **E-MONITOR-TARGET1 终审通过（含总控两处收口）**：`web/src/lib/monitor-target-calculator.ts:calculateTarget()` 纯函数 + 9 个 node:test 用例。总控收口：① 改从 `@/types` import X 契约类型，避免 calculator 本地重声明；② `upliftFactor` 接入 GMV/订单链路并补回归测试。因工作树已提前接入 `health_target` 但缺组件，总控补 `HealthTargetPane.tsx` 最小编译占位（仅为恢复门禁，不代表 F 卡完成）。
  - ✅ **F-MONITOR-TARGET2 终审通过（含总控一处收口）**：`HealthTargetPane` 完整页面落地，接 `calculateTarget()`，含场景/指标选择、11 个参数输入、三情景结果卡、周期拆解表、禁用保存按钮；接缝 `health_target` 已挂入监测二级 tab。总控收口：默认 `upliftFactor` 从 0.1 改为 1，避免基准 GMV 被默认压成 10%。
  - ✅ **D-MONITOR-TARGET3 终审通过（含总控两处收口）**：新增 `target_plans` 表与 create/list/get/adopt CRUD，新增 4 个 target-plans API 与 web client。总控收口：① adopt 写入 `clean_data/monitor/` 的目标数据集由 JSON 改为 CSV（`period/case/scenarioKind/metric/targetValue/value/planId/planName`），确保进入现有 `/api/bi/aggregations` 与观星台数据读取链路；② 已有 `role="goal"` 绑定时后端返回 409，必须显式传 `replaceExisting: true` 才替换，避免静默覆盖。
  - ✅ **F-MONITOR-TARGET4 终审通过（含总控一处收口）**：`HealthTargetPane` 保存接 `createTargetPlan` + `adoptTargetPlan`，成功后绿色状态条 + 跳观星台；`HealthDashboardPane` 拉取 adopted target plan 并显示目标绑定状态/目标测算快捷入口；`HealthTabs` 透传 `setActiveSubTab`。总控收口：补齐 D 卡 `replaceExisting` 契约，已有 goal 时首次 adopt 409 后显示替换确认条，确认后用同一 draft plan 传 `{ replaceExisting: true }`，避免重复创建与静默覆盖。
  - ✅ **QA-MONITOR-TARGET5 总控全链验收通过**：临时服务 HTTP smoke 覆盖 create/adopt target plan、goal CSV 进入 `/api/bi/aggregations`、409 + `replaceExisting:true` 替换策略、monitor config 单 goal、最小 metric system 运行观星台产出 `R-GAP-TARGET` finding（`gmv_actual 落后目标 30.0%`）、无目标工作区旧流程为空列表不回归。公式侧复跑 9/9。
  - ✅ **wiki 新增 6 张任务卡并推进全专题 done**：`X-MONITOR-TARGET0`（契约/红线，done）→ `E-MONITOR-TARGET1`（确定性测算纯函数，done）→ `F-MONITOR-TARGET2`（HealthTargetPane + 二级 tab，done）→ `D-MONITOR-TARGET3`（目标计划 API + adopt 写入 monitor goal，done）→ `F-MONITOR-TARGET4`（保存后跳转观星台/目标状态，done）→ `QA-MONITOR-TARGET5`（全链验收，done）。
  - ✅ **总控口径**：目标测算定位为“监测前生成/推演/拆解目标”，不是观星台差距发现；首版确定性测算，零 LLM，零 raw row；用户确认后写入 `clean_data/monitor/` 作为 `goal` 数据集，复用现有 `R-GAP-TARGET` actual vs target 监测。
  - 📌 **派发顺序**：先 X 契约；E 纯函数与 F 页面可并行；D 持久化/绑定接公式稳定后做；最后 F 联动与 QA 终审。
- 本批（2026-06-27 · Harness 自进化 + 产品 Agent 自进化专题，总控自做 + 多卡终审）：
  - ✅ **X-HARNESS0（总控自做·契约+回滚预研）**：双侧 `types.ts` 加 EFC 度量（`FeedbackEvent`/`EFC_KAPPA`/`TaskDemand`/`EfcScore`）+ AHE 契约（`HarnessComponent`/`ChangeOutcome`/`ChangeManifest`/`EditVerdict`/`HarnessVariant`/`ScopedRevision`）；`cache.ts` 加 C_raw 只读 getter（`RawComputeUsage`+`getRawComputeForSession/Run`，纯读既有 token 统计、toolCalls 由 E 回填）；§九 记录 + 回滚底座审定（typed scoped revision）。
  - ✅ **E-EFC1 终审通过（含总控收口契约漂移）**：EFC scorer + 6 runner 接入 + 6 Pane 加 EFC/η 列。终审发现 E 本地重声明 `EfcScore`/`EFC_KAPPA` 绕过 X-HARNESS0 单一真源 → **总控收口 9 文件**：`efc-scoring` import 契约 `EFC_KAPPA`、本地超集改 `EfcScoreDetail extends EfcScore`；6 runner rename；web `EfcScoreView extends` 契约。收口后 EFC 2/2 + runner 45/45 复跑绿。
  - ✅ **E-AHE1 终审通过（含全局表裁决 + tool lab 补齐）**：`ahe-attribute` 对照器（fix/reg 精确召回 + seesaw 无回归门 + 冲突 fork variant，quality 用 EFC `normalized`）+ 3 表（`change_manifests`/`harness_edits`/`harness_variants`）+ 6 harness 路由 + `AheManifestPanel`。**裁决**：E 把三表设计成「全局」（无 `workspace_id`）偏离 §九 原审定 per-workspace → **追认**（harness=项目级资产更正确、天然规避 §二·五 脆弱性），§九 订正。补 tool lab 接入（5/6→**6/6**）。
  - ✅ **X-EVOLVE0（总控自做·契约）**：双侧 `types.ts` 加 `AgentTrajectory`/`AgentTrajectoryStep`/`AgentTrajectoryModule` + `EvalRecord`/`EvalAnnotationStatus`（脱敏轨迹→eval 沉淀，`sourceFindingId` 复用 `HealthFinding.id`）；bounded-change **复用 AHE `ChangeManifest` 不新造**；§十 记录 + 审定（EVOLVE 轨迹/eval 应 per-workspace，区别于 §九 harness 全局表）。
  - ✅ **E-SKILLOPT1 终审通过**：skill 受控回写器（slow-update 守门 + 严格接受门「平手也拒」+ rejected buffer + Creator/Evaluator 沙箱）+ `skill_rejected_edits` 表（per-workspace）+ 6 路由。**契约卫生达标**（`SkillRewrite*` 为 api/engine E 域内部类型、不污染 `@/types`，E-EFC1 教训已吸取）。新测 20/20。点名 4 设计边界（防作弊行为级非硬隔离 / 未复用 subagent-core / `resolveSkillScore` efc 分支 no-op stub / accept 不服务端复检严格门），均非阻塞。
  - ✅ **E-EVOLVE1 终审通过（含总控红线脱敏硬化）**：`evolve-engine.ts`（finding→脱敏 trajectory→candidate EvalRecord→AHE ChangeManifest package）+ `agent_trajectories`/`eval_records` 两表（**per-workspace + 硬 FK + ON DELETE CASCADE**，source_finding_id UNIQUE 去重；优于 §九 harness 全局表）+ EVOLVE 路由（monitor run 后 recurring/worsening 自动沉淀 / flow·AnaX 失败存脱敏轨迹）。契约全 import 无重声明、ChangeManifest 复用、human gate 硬编码 `outcome:"defer"`。**总控收口红线**：E 原 `redactSensitive` 精确键匹配漏复合键（`sampleRows`/`rawValue`/`topRecords`）+ `010_raw` 裸路径 → 改大小写不敏感**子串匹配** + regex 加 `\d{3}_raw`，补复合键测试。复跑 evolve+monitor+ahe **22/22**、typecheck/build 绿。
  - ✅ **D-EVOLVE2 终审通过（含总控两处红线收口）·EVOLVE 链闭环**：3 入口（`HealthReportPane`/`ReportReviewPane`/`GoldenStrategyPane`）加「提为 eval 候选」按钮 + `engineApi.createEvalRecord`（跨域调 E 端点 HTTP）。**收口 2 处红线**：① **D 偏离自卡脱敏 spec**——`HealthReportPane` output 含 `evidence: finding.evidence` 原值（卡只允许 kind/severity/comparisons/suggestion）→ 去原值改发衍生字段；② **服务端 ingress 不脱敏**——`POST /evolve/eval-records` 的 `parseAgentTrajectory` 只校验形状、手动路径绕过 `sanitizeTrajectoryText` → 入站 input/output 一律再脱敏（抓 draw_data/`0NN_raw` + 2400 截断），不信任客户端、与自动路径同口径。验证 evolve 7/7、typecheck/build 绿、数据探索隔离 grep 净。
  - ✅ **解冻链推进**：X-EVOLVE0/E-SKILLOPT1（前置满足）→ E-EVOLVE1/D-EVOLVE2 解冻并**全部 done**。**产品 Agent 自进化 EVOLVE 链全闭环**（X-EVOLVE0 契约 → E-EVOLVE1 引擎沉淀 ↔ D-EVOLVE2 注释入口；D 标注→eval 候选→E 持久化/AHE bounded change·human gate）。AgingBench(P1)/HarnessAudit(P2) 维持冻结。
  - ✅ **wiki 7 卡转 done**：X-HARNESS0 / E-EFC1 / E-AHE1 / X-EVOLVE0 / E-SKILLOPT1 / E-EVOLVE1 / D-EVOLVE2。
  - ✅ **剩余冻结卡全解冻（用户授意·暂不开发）**：AgingBench P1（X-AGING0/E-AGING1/D-AGING2）+ HarnessAudit P2（X-AUDIT0/E-AUDIT1）去【冻结】标记、状态保持 `todo`，待排期捞出。**wiki 已无任何冻结卡**。卡面留语境提示：AGING 前置=X-AGING0 契约先行；AUDIT 原冻结理由=「待多 agent 协作规模上来」（非技术前置，捞出前先评估价值）。注：line 560/714 两处分组 `//` 注释含历史「冻结」语境，已 stale 但属注释非卡状态，未动。
  - ✅ **fast-follow backlog 开卡**（§十一 零残留）：`docs/backlog/SkillOpt-fast-follow-防作弊硬隔离与EFC接入.md`（#1 防作弊硬隔离=接 pi-sandbox/真实 access log；#2 EFC 真接 `resolveSkillScore`）+ README 登记。捞出建议先 EFC（小独立）后硬隔离（随「安全红线·统一单点守卫」立项）。
  - ✅ **AgingBench 全链 + 去重 + 测试隔离**（§十一）：X-AGING0 契约 → E-AGING1（Dream Worker 巡检，含脱敏直读裁决）→ D-AGING2（memory 老化信号 GET，红线净）→ **X-AGING-DEDUP**（总控抽 `memory-aging-core.ts` 共享核消两套重复算法）→ §二·五 测试隔离收口（3 memory test 文件设临时 XANTHIL_DATA_DIR）。
  - ✅ **HarnessAudit**（§十二）：X-AUDIT0 契约（Π/Φ/Σ + 四类违规 V-OT/OR/IC/ID + SAR + YAML 策略规约 schema）→ E-AUDIT1（`harness-audit.ts` 确定性 checker + SAR 报表 + multi-agent auditLogPath opt-in + px-hook-runner PX_TRAJECTORY_LOG）。终审守住 px-hook-runner 门控 return 完整（opt-in best-effort，无 execSync/self-HTTP/越权门控）。
  - ✅ **技能工程子波（3 卡终审通过）**：**E-SKILLINJECT1**（运行时瘦-context 动态注入：`skill-retrieval` 选授权集子集 + utility/diversity，**显式 skillPaths:[] 守卫——只选已授权子集绝不自主引入**，四模块红线完整）+ **E-SUBSKILL1**（`skill-distillation` additive 加 `distillSubSkillsFromTraces` 2-5 切片，无重叠）+ **D-SAFEDISTILL1**（红线·`safe-distiller.ts`：`assertSafeInput` 递归守门 + SQL skeleton 字面量全剥 + topology 元数据零 payload + report 仅路径名；`skill_proposals` per-workspace；RulesPane「💡提案」人审）。**flag**：① D-SAFEDISTILL1 approve 用 self-HTTP（`await fetch` async 非 execSync，避开 V-OBS 死锁；user-triggered；smell 待改 E 经 GET 消费）② `skill_proposals` 无 CASCADE（归档政策下无碍）。
  - 📌 **Harness 全专题完成**：五篇论文（EFC/AHE/产品自进化/AgingBench/HarnessAudit）+ 技能工程子波 全部 done；wiki 已无冻结/待派 harness 卡。
  - ✅ **验证**：每卡 server+web `typecheck`/`build` 绿；EFC 2/2、6 runner 45/45、AHE 2/2、SkillOpt 新 20/20；红线 grep（draw_data/data-exploration 隔离）全净；双侧 types 镜像对齐、无本地重声明（E-EFC1 收口后）。
  - 待用户提交：`server/src/{types,cache,efc-scoring(.test),ahe-attribute(.test),evolve-engine(.test),skill-rewrite-gate(.test),skill-rejected-buffer,skill-sandbox(.test)}`、6 `*-evaluation-runner`、`db/engine`、`skill-curator`、`routes/engine`、`web/src/{types,lib/api/engine,lib/efc,components/{6×LabPane,AheManifestPanel,SkillManagementPane,HealthReportPane,ReportReviewPane,GoldenStrategyPane}}`、`docs/{notes-infra §九/§十,wiki(7 卡 done+4 卡解冻),backlog 2 文件}`（+ E 自维护 `notes-engine`）。
- 历史批次（2026-06-27 · subagents 体系 readme，总控自做）：
  - ✅ **subagents 说明 readme**：梳理 subagents 全貌（三种委派形态/模板/黑板/回流/Save as Skill/自愈/运行看板/红线/存储表/入口）成产品内 readme，挂为「控制·subagents 管理」第三个**内层 tab「说明」**，与运行看板/模板管理并列。
  - **改动（3 文件，全 additive、未碰接缝骨架）**：🆕 `web/src/docs/subagents-readme.md`（正文 9 节）、🆕 `web/src/components/SubAgentsReadmePane.tsx`（仿 `AggregateReadmePane` 范式）、`SubAgentManagementPane.tsx`（`view` 加 `readme` 态 + 内层 tab 按钮 + 内容区分支 + badge 文案）。未改 constants/types/App/api——内层 tab 非新 subtab，零接缝改动。
  - ✅ **验证**：web `typecheck` 绿、`build` 绿。
  - 📌 小注：`SubAgentManagementPane.tsx` 渲染在 DataTabs（D 域分发），本次由总控加内层 readme tab（文档+内层 tab 微调，低风险，非接缝骨架）。
- 历史批次（2026-06-27 · subagents 管理进阶 4 卡终审，E 代笔回流）：
  - ✅ **进阶 A·复合单元（Planner→Coder→Reviewer）**：`index.ts:runCompositeSubAgentUnit` 串行编排，每角色起独立 `SubAgentTask`（复用 `runDelegatedSubAgent`），`taskDigest`(summary+report+error) 串接上下文；Reviewer 输出 `REVIEW_DECISION: pass/revise`，`reviewerPassed` 判定，耗尽 `maxReviewRounds`(1–5，默认2) 转 `waiting_for_help`。builtin 模板 `COMPOSITE_SUBAGENT_TEMPLATES`(subagent-core.ts) `dataScope` 全锁 clean_data、persona 强制禁输出明细，`source:"builtin"`，`resolveSubAgentTemplate` 先查 builtin。契约 `CompositeSubAgentRun` 双侧 types + `composite_subagent_runs` 表(db/shared)。端点 `POST /sessions/:id/delegate-composite`·`GET /composite-subagent-runs`。
  - ✅ **进阶 B·共享黑板（parent_session 作用域）**：`subagent_blackboard_entries` 表 + `SubAgentBlackboardEntry/Kind` 双侧 types(`scope` 编译期锁 `parent_session`)。写入走 `validateBlackboardContent` 启发式护栏(长度4000/表格行>8/JSON 数组/rows·records 键/`row N:` 模式 → 400)，符合"只存聚合口径/衍生结论、禁原始明细"行为级红线。`subAgentSystemPromptWithBlackboard` 把黑板注入**所有** runDelegatedSubAgent/resume 的 systemPrompt(限 12 条 + "禁扩写明细"声明)。端点 `GET/POST /sessions/:id/subagent-blackboard`。
  - ✅ **进阶 C·Save as Skill（不绕人审门）**：`POST /subagent-tasks/:id/save-skill` 仅 `status==="success"` 可保存，复用 `distillSkillCandidate()`(engine.ts)，产物硬编码 `status:"candidate"/source:"distilled"`，active distilled 需 `confirmed=true`(:1850) → **不自动 active**。transcript = brief + clean_data 路径名 + summary + report 摘录(`latestTaskReportText` 经 basename+resolve+startsWith 路径守卫，report 是绿衍生物)。**按用户裁决：先只固化 Skill、不自动生成 ExtractionTool**(避免工具目录写入+安全审计扩大)。前端按钮提示"去实验场 Skill Registry 评测后再采纳"。
  - ✅ **看板·方案 C·节点级落库**：`flow_node_runs` 表(无硬 FK，JOIN flows 取 workspace/name) + `FlowNodeRun` 双侧 types。`multi-agent-runner` 加 **optional `nodeRunWriter`** DI hook(start→INSERT running / finish→UPDATE 终态 success·failed·blocked·aborted)，**纯观测不改执行路径**；`routes/engine.ts handleExecuteMultiAgent` 接线 `startFlowNodeRun/finishFlowNodeRun`。`GET /api/workflow-agents` 返回加 `nodeRuns`，`SubAgentBoard` 下钻 node 粒度(老历史 `nodeRuns ?? []` 向后兼容)。
  - ✅ **验证**：server+web `typecheck` 绿、`build` 绿(仅既有 chunk 警告)、数据探索 LLM 隔离 grep 空、新链路未引用 draw_data。双侧 types.ts 字面对齐、无本地重声明；三新表无硬 FK 不撞他域。
  - 📌 **范围外顺手改（已追认）**：`skills.ts` 移除 `~/.agents/skills` 扫描(全局+项目两处)——防 arkcli connect 装的外部 skill 混入 pi 选择器，与 Save as Skill 走 `.pi/skills` 自洽，合理收口。
  - ⚠️ **记一笔（非阻断，3 项）**：① `composite_subagent_runs` 表无 `workspace_id` 列但 Row 接口/parse 读 `r.workspace_id`(恒 undefined)、create 也不存 → composite run 无法按 workspace 过滤，后续补列或删字段；② 三新表无硬 FK、`deleteWorkspace` 未纳入(已登记进 §二·五 清单，按现政策归档替代物理删除，无待办)；③ 黑板护栏为 best-effort 启发式可绕过，靠 prompt 约束兜底(同既有行为级红线姿态)。
  - 待用户提交：本批改 `db/shared.ts`·`index.ts`·`multi-agent-runner.ts`·`routes/engine.ts`·`skills.ts`·`subagent-core.ts`·双侧 `types.ts`·`DelegateSubAgentCard.tsx`·`SubAgentBoard.tsx`·`lib/api/engine.ts`(+ E 自维护 `notes-engine.md`)。
- 历史批次（2026-06-26 · 记忆 v2.0 缺口1/3/4 收尾 UI+闭环）：
  - ✅ **缺口1·chat dataPaths boost（X，总控自做 index.ts）**：chat 注入点(`index.ts` handleSend)原 query-only，本批补 `dataPaths` boost 与 flow 侧一致。把 `forkBranch`/`pathScopeSessionId` 提前到 `buildMemoryInjectionSnapshot` 前计算（供记忆注入 + 下方输出路径作用域**单源共用**，删原 5011-5012 重复），构造带 `dataPaths` 的 `chatRetrievalCtx`（`listWorkspacePaths(ws,"clean_data",pathScopeSessionId)` 的 file 项 path），`buildMemoryInjectionSnapshot` 与 `withRulesPrompt` 两处 ctx 同步带 dataPaths。守 `RetrievalContext` 既定语义（dataPaths→`boostTags` 仅加权、`deriveTags` 不硬过滤、untagged 不清空）；fork 作用域回退父任务与输出路径同源；缓存稳定前缀不回退（仅影响检索打分）。
  - ✅ **缺口3·维护 UI / 缺口4·升级 Skill UI（D）**：两张面板接线卡（RulesPane「立即维护」+ dryRun 预览 / 「从记忆升级 Skill」+ dryRun 列簇），已审核通过转 done。
  - ✅ **缺口4·评测闭环（E，回流终审通过·一次过）**：仅改 `SkillLabPane.tsx`（E slot）——「Registry 候选」勾选区(`listSkillRegistry candidate`)→载入为 eval variant(`registry_<id>`)→baseline vs candidate 对照→评测后「采纳(PATCH status=active,confirmed=true)/弃用(DELETE=archive，保留 SKILL.md)」决策区(pairwise+Δ+activation)。复用既有 `api/engine.ts` 三方法（本会话无改动）+ 后端 10 条 skill-registry 路由，**零接缝零新后端**；三道人工在环不自动启用；红线净。**注：此即开场标记的 `SkillLabPane.tsx +175` 改动，归属已坐实。**
  - ✅ **验证**：`npm run typecheck` 绿；`npm run build` 绿；全量记忆测试 **83/83**。
  - 📌 **记忆 v2.0 缺口1/3/4 全部完成**；缺口2（向量层）按既定暂缓。
- 历史批次（2026-06-26 · 零幻觉·数据可信地基 v2.3 终审归档）：
  - ✅ **产品边界声明**：本系统验证 LLM 输出是否忠实于已登记数据、来源与计算结果；不保证原始数据、业务口径或因果解释天然正确，重要结论仍需人工复核。
  - ✅ **四模块红线矩阵**：监测/日常/专题 web_search 硬禁；重复仅 workflow.allowWeb=true 显式授权放行。主对话/专题/flow chat 默认 `skillPaths=[]` 禁自主 skill；显式白名单仍可审计。collect 是独立联网窗口，不混入四模块口径。
  - ✅ **证据与核验闭环**：EvidenceLevel/MetricSourceRef/renderSourceLabel + fabricated/label_mismatch + causal layering + coverage check + C-mini + reconciliation 已完成并经 X-ZH9 终审。
  - ✅ **验证**：关键回归 110/110；`npm run typecheck`；`npm run build`；数据探索 LLM 隔离 grep 全绿。
  - ⚠️ **边界外风险**：GIGO（源数据/ETL 错）、选择性叙事、实质因果谬误、common-mode failure（两条路径共享同一错误逻辑）仍需人工审查或外部真源。
- 历史批次（2026-06-25 · 数字锁产出侧校验）：
  - ✅ **X-MLOCK0 契约 + 校验核心**：双侧 `types.ts` 新增 `MetricVerification` / `MetricVerificationHit`；新增 `server/src/metric-verification.ts:verifyMetricUsage()` 纯函数，支持千分位、小数、`万`/`亿`、百分比归一；容差常量 `ε_ok=0.5%`、`ε_suspect=20%`；`matched/suspect/unreferenced` 明细 + `verdict` 聚合。新增 `metric-verification.test.ts` 覆盖 matched/suspect/unreferenced/万亿/百分比/verdict。
  - ✅ **X-MLOCK1 tool-use 链路接入 + ChatPane 告警**：新增 `server/src/metric-verification-events.ts` 从 `tool_result` / `turn_end.toolResults` / MCP 文本块中 best-effort 提取本轮 `MetricSnapshot[]`，在 `handleSend`(`index.ts`) 与 `handleSendFlow`(`routes/engine.ts`) 的 assistant `message_end` 后跑 `verifyMetricUsage()`；仅 `verdict="mismatch"` 时追加 `{type:"metric_verification"}` content block。前端 `ContentBlock` 增加该 block，`MessageRow` 默认可见地渲染琥珀色告警条（列 suspect 的 name/expected/foundInText）。无 snapshot 或正常引用零变化；不自动重试、不阻断、不改写。
  - ✅ **验证**：`node --experimental-strip-types --test server/src/metric-verification.test.ts server/src/metric-verification-events.test.ts` 8/8 通过；`npm run typecheck` 绿；`npm run build` 绿（仅既有 Vite chunk/dynamic import 警告）；红线 grep 无 `draw_data` / `dataset.rows` / raw path / 文件读取命中。未跑真实 LLM tool-use 端到端（需可用 analysis 工具 + 模型实跑环境）。
- 仍待提交的既有批次（本批未处理）：
  - **全局池池化扩展（2026-06-23）**：prompts + 知识库从「工作区独占」升级「全局池 + 按工作区启用」，X-POOL0/D-POOL1/X-POOL2 已 done，门禁记录为全绿，待用户提交。关键踩坑：依赖新列的 `CREATE INDEX` 必须在 idempotent `ALTER` 之后，schema 终审需旧库 boot 实测。
  - **知识库新模块**：`knowledge-injection/retrieval(.ts/.test)`、`system-prompts(.ts/.test)`、前端 `KnowledgeBasePane`/`KnowledgeBaseReadmePane`/`MemoryReadmePane` 已存在；wiki 标 done，但总控尚未逐卡运行时实跑终审。
  - 汇报可视化 / prompts 管理 / 规则记忆重构 / 知识库等跨批改动仍处于工作区未提交状态，本批未清理、不回滚。
- 下一步：
  - **监测·目标测算专题全链完成**：当前无代码阻塞。可选后续为浏览器点击级 Playwright 点检，以及用真实业务 metric system/actual 数据跑一次人工验收；工程闭环已通过 HTTP/API smoke 与门禁。
  - **Harness 全专题已完成**（五论文 + 技能工程子波，wiki 无冻结/待派 harness 卡）；后续皆可选增强，非阻塞按需排期：
    - **D-SAFEDISTILL1 self-HTTP 清理**（flag）：approve 现 `await fetch` 自调 E skill-registry 端点（async 安全、非 V-OBS 死锁，但 smell）；更净=E 经 GET 消费 approved 提案 + 自写 registry，消自调。
    - EVOLVE：eval 候选→AHE attribute 实跑、注释→confirmed 复核 UI、bounded change 应用（守 human gate）。
    - 技能工程：动态注入/子技能蒸馏的真实 pi/browser smoke（当前仅 deterministic runner 测试覆盖）。
    - HarnessAudit/AgingBench 均 P1/P2，实跑验证按规模/需要再排。
  - **SkillOpt fast-follow 可随时捞**：`docs/backlog/SkillOpt-fast-follow-*` 的 #2 EFC 真接入（小、独立、软依赖 E-EFC1 已满足）可优先；#1 防作弊硬隔离待「安全红线·统一单点守卫」立项一起做。
  - **command 场景调用框收口**（工作树未提交，§六-外的在飞批）：`command-expand`/`routes/engine.ts`/双侧 `types.ts`(toolIds/toolParamMap)/`CommandManagementPane`/`ChatPane`/`ManualAnalysisToolCard`。backlog 标已落地，但需总控核 §0 未记的这批：跑 command 单测 + typecheck/build，并核 `ChatPane`/`ManualAnalysisToolCard` 仍走 `@工具`/`/api/extraction-tools/:id/run` 的 `source=ai` 闸门、不绕 clean_data 红线。
  - 优先做 **数字锁真实 tool-use smoke**：准备一个 `analysis` 工具返回 `metricSnapshots`，让模型故意把注入值改写，确认 `ChatPane` 出现“模型引用数值与代码计算值不符”；再跑正常引用确认无告警。也要覆盖 `send_flow` 的 flow chat 消费侧是否能看到同一 block。
  - 继续补 **知识库新模块运行时终审**：API/DB/前端逐卡实跑，尤其全局/专属 scope、enablement、检索注入、系统 prompt 聚合与旧库迁移。
  - LLM 管理补测：`llm-config.ts` 三处脱敏链路逐行终审 + node:test 覆盖 key 保留/OAuth 不写 key/settings 局部写。
- 阻塞：无代码阻塞；真实数字锁 smoke 依赖本机可用模型与 analysis 工具运行环境。
- 开放问题（待总控/后续拍板）：
  - `metric_verification` block 当前随消息 content 持久化；是否需要后续在 DB/trace 中单独索引为可筛选的质量信号，待 X 后续拍板。
  - 数字锁目前只对 tool-use 链路自由文本做 best-effort 告警；是否要做自动纠偏/重试，需要结合预算上限与误报风险另行设计。
  - 工作区大量跨批次 untracked/modified 累积未提交；§0 与历史里程碑的对齐依赖 `Orchestration §八`。

---

## 一、缓存命中 Harness（降 token 消耗）

**核心约束（必读）**：pi-xanthil **不直接调模型**，所有请求经 `pi` CLI（`runPiTurn` spawn 子进程 + `--session-id` 复用会话 + `--system-prompt` 注入）。因此**无法直接设 `cache_control` 断点**，只能靠「稳定字节前缀」让 provider 的 prompt/prefix cache 自动命中——所有优化围绕这一点。

三层设计（均已闭环）：

| 层 | 机制 | 位置 |
|---|---|---|
| ① Token/缓存监控 | 钩入 `observeSessionEvent` 累计用量 | `cache.ts` · `session_token_stats` 表 · MainHeader `↩XX%` |
| ② Prompt 前缀稳定化 | 稳定块前置、role/workflow prompt 后置；块内容改动须 bump `PROMPT_SCHEMA_VERSION` | `prompt-blocks.ts:assembleSystemPrompt` |
| ③ 文件 hash + 分析缓存 | SHA-256 `file_hash` 为 key，跨 session 复用字段字典 | `file-hash.ts` · `setFileAnalysis` |

**关键决策**：
- 缓存命中率口径统一 = `cacheRead / (input + cacheRead + cacheWrite)`。
- 文件分析缓存以 SHA-256 为 key 跨 session 复用。
- **语义缓存（embedding）不做**——与 local-first/隐私冲突。
- 文件分析**自动回填**：`extractFieldDicts`（正则提取 ` ```field-dict:/path ``` ` 块）+ `backfillAnalysisFromMessage`（路径→hash 查表→`setFileAnalysis`），钩在 `handleSend` 的 `message_end` 后。`BLOCK_FILE_ANALYSIS` 为 Block 03。

**未验证**：真实对话验证回填效果（session A 分析 CSV → session B 检查 contextPrefix 是否含字段说明）。

---

## 二、接缝层（绞杀者重构，第 0 步已完成）

详见 `Orchestration.md`。要点：
- legacy `index.ts`/`db.ts` 冻结归总控；新功能进各域 slot（`routes/<域>.ts` · `db/<域>.ts` · `lib/api/<域>.ts` · `tabs/<域>Tabs.tsx`）。
- `db` 实例已从 `db.ts` 导出；各域 `db/<域>.ts:init*Tables` 在 base schema 后调用。
- `api.ts` = `legacyApi` + 域片段 spread；`App.tsx` render 委派给 `DataTabs/EngineTabs/VizTabs`，共享 `TabContext` 契约（总控持有）。
- 跨域类型（`MetricDefinition` 等）由总控在 `types.ts` 定义（双侧 server + web）。
- **onto-xanthil 数据语义层**（总控持有，V 域同源）：表在 `db/viz.ts`(ontologies/object_types/property_types/link_types/metric_definitions)、路由在 `routes/viz.ts`、抽取在 `onto-extract.ts`(经 pi)、前端 `OntologyPane`/`GraphCanvas`(KG 与 onto 共用的通用图渲染层)。详见 `docs/onto-xanthil-design.md`。
- **metric 真源 = `metric_definitions`**（P2b' 完全切源）：`buildEnabledStandardsPrompt`/`memory-injection`/`knowledge-graph` 的 metric 均读此表；`analysis_standards` 仅留 `reference_file`。改 metric 注入勿再碰 analysis_standards。
- **数据分析对话 fork 分支 + 委派子 agent 契约**（总控持有，infra/接缝层；E 域消费）：解决 pi session(ChatPane「数据分析」)多轮上下文撑爆。**统一心智 = 开子 pi session 干重活，只把结论回流主 session，主上下文只吃精炼结论**。
  - **契约**：`ForkBranch`/`SubAgentTask`/`SubAgentTaskInput`(types.ts 双侧)；表 `fork_branches`/`subagent_tasks`(db/shared.ts，总控)。E 引用类型 import 自 @/types，勿本地重声明(参 actions 收敛教训)。
  - **Fork 分支 = 一个真实 session**：`POST /api/sessions/:id/fork` 建分支 session(createSession)+fork_branches 行；分支 mini-chat 直接**复用现有 send/messages/abort**(对 branchSessionId)。`pi-adapter.RunPiOptions.forkFrom` → `runPiTurn` 加 `--fork <父>`；`handleSend` 检测"未播种分支"(getForkBranchByBranchSession && !seeded)→首轮播种、之后正常多轮、markForkBranchSeeded。**分支 session 从主任务列表排除**(`GET /api/workspaces/:id/sessions` 用 listBranchSessionIds 过滤——分支是子产物非独立任务)。
  - **委派子 agent = REST 起后台 + DB 轮询(非 WS)**：`POST /api/sessions/:id/delegate{brief,dataFiles,model}` → subagent_tasks 行 + 后台 `runDelegatedSubAgent`(index.ts)：全新聚焦子 session(`subagent-<taskId>`)、systemPrompt 硬约束(只读指定 020_clean 数据/报告写 060_reports/末条给结论摘要)、`pi -p` 单轮自主跑完(读数据→分析→写报告→摘要)。完成存 summary(末条 assistant 文本)+reportPath(060_reports 按 mtime 取最新)。`GET /api/sessions/:id/subagent-tasks`(轮询) · `GET /api/subagent-tasks/:id` · `POST /api/subagent-tasks/:id/abort`(subagentRuns map kill)。
  - **回流 = 无后端**：前端把"可编辑摘要+060_reports 报告链接"作为一条**普通消息发给主 session**(现有 onSend/gateway send)，主当 user turn 整合。这是"主只吃结论不吃过程"的关键，也是为何无需 reflux 端点/WS。
  - **标准目录**：fork/子 agent 同属当前任务 → 读 `standardDirIn(sessionDir(root,主sessionId),"clean_data")`、写 `...,"report"`(060_reports)；产物自动进右侧成果面板。注意 standardDirIn 的 folder 名是 `clean_data`/`report`(非 clean/reports)。
  - **⚠ 未运行时实跑(待 X+E 联调点检)**：① pi `--fork <父> --session-id <分支>` 组合是否把父历史播种进指定分支 id(若 pi 自生成 id 则偏差) ② 子 agent `-p` 单轮是否如期用工具读数据/写报告到 060_reports、末条摘要捕获是否命中 ③ 分支 messages/runtime 复用顺滑度。
- **actions 行动闭环契约**（总控持有，V 域同源）：表在 `db/viz.ts`(action_items/action_tasks/action_feedback，FK CASCADE)、路由在 `routes/viz.ts`(`/api/actions/extract` 经 pi + `/api/action-items`·`/api/action-tasks`·`.../:id/feedback` CRUD)、前端 `ActionsPane`(探索「行动」subtab)。**契约单一真源铁律**：`ActionItem/ActionTask/ActionFeedback/ActionItemDraft` 等只在 `types.ts` 定义(双侧)，`db/viz.ts` 与 `lib/api/viz.ts` 一律 import 引用、**禁止本地重声明**（V 首版曾各自重声明致漂移，已收敛）；api/viz.ts 用 `export type {...} from "@/types"` re-export 供 ActionsPane 消费。**enum = 中文规范标签**：`ActionScene="开业"|"日常"|"假日"|"大促"`(单店模型场景)、`ActionLifecycle="A获取"|"A激活"|"R培育"|"R复购"|"R裂变"`(会员 AARRR SOP)——直接用中文字面量做 union，LLM 返中文即 enum、UI 直接渲染，**省掉 label 映射层**；后端 extract 须约束 LLM 取值 + 归一化(非法→省略)，三表 scene/lifecycle 为 `TEXT NOT NULL`→空值存 `""`、parse 回 `undefined`。**未来接入点**：`ActionItem.metricRef` 关联 `metric_definitions`(D 语义层，P2)、行动项↔`onto_actions` 可执行动作目录桥接(下轮)。

---

## 二·五、deleteWorkspace 漏删子表 + 测试污染真实库（2026-06-13 修）

> 🚫 **「deleteWorkspace 全量补齐」已放弃（2026-06-27）**：对应 wiki 卡已删除、不再做。「侧边栏清爽」诉求改由**工作区归档**满足（归档=标记位隐藏、不删任何数据、零风险，X-ARCHIVE0/E-ARCHIVE1 已上线，见 §八之后归档实现 / wiki CHANGELOG）。下方的缺口重盘点（53 表/漏 27 硬 FK + origin 语义三选项）**仅留作 schema 参考**：若将来确实要做物理删除（如清理磁盘/合规删档），这份盘点是起点，但当前**无对应待办**，勿当 TODO 误读。

- **症状**：UI 删工作区报错/删不掉（删除按钮在行 hover 才显示，但点了也 500）。根因 = `deleteWorkspace` 抛 `FOREIGN KEY constraint failed`：它没清掉所有带 `workspace_id` 外键的子表。**已补 `token_usage_stats` + `token_usage_daily_stats`**（每个用过的工作区都会累积 token 统计，不补则任何用过的工作区都删不掉）。
- **⚠ 仍不完整（2026-06-27 重新盘点，原"11 张"清单已严重过时）**：当前 schema 共 **53 张**带 `workspace_id` 列的表，其中 **43 张有硬 FK `REFERENCES workspaces(id)`**（真正阻断删除）。`deleteWorkspace` 现仅处理 16 类，**仍漏 27 张硬 FK 表 + 7 张孤儿表**。
  - **现已删（16）**：sessions·workspace_paths·workflow/memory/skill/tool_evaluations(+results)·skill_eval_sets·tool_case_sets·skill_curation_proposals·memory_proposals·memory_usage_stats·rule_conflicts·memory_failure_attributions·flows(经 deleteFlow→flow_messages/flow_runs)·token_usage_stats/daily。
  - **缺口 A·硬 FK 阻断（27 张，真 bug「删不掉/500」）**：
    - ⚠️ **记忆重构(新)**：`memory_items`(核心记忆库)、`memory_reviews` —— **原笔记"memory_* 已处理"是 clean-slate 重建前的过时说法**；这俩是重建后主表，FK 阻断 → **任何存过记忆的工作区现在都删不掉**（最普遍的现行阻塞，可先热修止血）。
    - **数据/语义(卡内)**：analysis_cases·analysis_standards·business_contexts·metric_definitions·ontologies(+嵌套 object_types/property_types/link_types/logic_rules/onto_actions)·onto_prompts·rule_memories·hypothesis_library·dashboards·change_proposals·trace_events。
    - **监测/体检(新)**：monitor_configs·monitor_runs·monitor_metric_systems（monitor_findings 已 `ON DELETE CASCADE` 随 runs 走）·health_runs。
    - **知识库(新)**：knowledge_docs(+ knowledge_chunks 子表，无 cascade，须先删)。
    - **prompts 池(新)**：prompt_templates。
    - **4 类新 eval(新)**：command/hook/prompt/subagent_evaluations（各带 `*_results` 子表，须 results 先删）+ 对应 command_case_sets/hook_eval_sets/prompt_eval_sets/subagent_eval_sets。
  - **缺口 B·孤儿行（7 张，无硬 FK 不阻断删除但留垃圾）**：anax_gate_config·kg_nodes·kg_edges·skill_registry·skill_registry_eval_history·workflow_favorites·**workspace_memory_enablements**（无 FK 但 origin 语义**必须**清，否则留下指向已删工作区的启用记录）。
    - **缺口 B·补登（subagents 进阶 2026-06-27，3 张，无硬 FK）**：`composite_subagent_runs`（parent_session_id 关联，**无 workspace_id 列**）·`flow_node_runs`（flow_run/flow 关联，无 workspace_id）·`subagent_blackboard_entries`（有 workspace_id 列但无 FK）——删 workspace 连带删 session/flow 后均留孤儿；按现政策（归档替代物理删除）**无待办**，仅备登。
  - **三个结构性难点**：① 嵌套删除顺序（ontologies 子表 / 4 类 eval 的 results / knowledge_chunks 须子表先删）；② `deleteWorkspace` **无事务包裹**（裸 DELETE 串，中途 FK 失败留半删状态）→ 补全须 `db.exec("BEGIN"/"COMMIT"/"ROLLBACK")`（node:sqlite 无 `.transaction()`）；③ **枚举式天然脆弱**——每新增一张 `workspace_id` 表就静默重现此 bug（本次过时即明证），更耐久修法待评估：建表统一 `ON DELETE CASCADE` / 维护"工作区级表"中央清单做通用 `DELETE WHERE workspace_id=?` / 加 schema 自检测试遍历断言覆盖。
  - **P0 阻塞·全局池 origin 语义（仍未拍板，范围由 6→8 张）**：池化表现为 metric_definitions·rule_memories·memory_items·analysis_standards·analysis_cases·business_contexts·ontologies·**prompt_templates·knowledge_docs**（后两张卡后新池化）。删 origin 工作区时三选一须先定：(a) 连带删全局定义(他工作区会丢内容) / (b) 仅删 enablement 保定义为孤儿 / (c) 改派 origin 给其他工作区；无论哪个都要同步清 `workspace_memory_enablements`。**勿盲目补 DELETE，先定语义。**
- **测试污染真实库（已修）**：`multi-agent-runner.test.ts` 预算用例 `createWorkspace("runner budget stop")` 曾静态 import db.ts、未隔离 → 多次跑测试在真实 `~/.pi-xanthil` 堆了 12 个测试工作区。**已按 memory-injection.test.ts 范式修**：import 任何经 cache→db 的模块前先 `process.env.XANTHIL_DATA_DIR = mkdtempSync(...)` + 动态 import。**铁律：任何 *.test.ts 在碰 db.ts 前必须先设临时 XANTHIL_DATA_DIR，否则污染真实库**（db.ts 在 import 期即按 env 打开 DB_PATH）。已清掉 12 个污染工作区（经 API/直连，保留森马会员）。
- **测试污染真实库再发（2026-06-29 已清理）**：`metric-injection-trace.test.ts` / `okh-metric-import.test.ts` / `okh-metric-ontology-link.test.ts` / `business-context-governance.test.ts` / `okh-full-acceptance.test.ts` 因 ESM static import 在设置 env 前加载 `db.ts`，在真实库写入 337 个 archived 测试工作区及其 metric/businessContext/ontology/trace/enablement 子记录。已改成 `process.env.XANTHIL_DATA_DIR = mkdtempSync(...)` 后 `await import("./db.ts")` / `await import("./db/data.ts")` / `await import("./db/viz.ts")`，并清理真实 `~/.pi-xanthil/xanthil.db` 污染记录，保留 `会员` 与 `收集（全局）`。**补充铁律**：凡测试会 import `db.ts` 或调用 `createWorkspace()`，必须在动态 import 之前设置临时 `XANTHIL_DATA_DIR`；ESM static import 不能保证隔离生效，禁止用于会触发 `db.ts` runtime 初始化的模块。

## 三、本机已知坑（pi 侧，非本项目 bug）

- 扩展 `ptk-memory-inject` 的 better-sqlite3 NODE_MODULE_VERSION 不匹配 → 本项目选 `node:sqlite` 免疫原生编译坑。
- 默认 model `volcengine-plan/deepseek-v4-flash` 报 `developer` role 400 → 跑真实对话前需切模型。
- `runPiPrompt` 用 `--no-skills`，**勿用 `--no-extensions`**（禁用 provider 扩展致 LLM 调用失败）。
- **`runPiPrompt` 超时根因（2026-06-11 实测取证）**：一次性纯文本补全若不带 `--no-tools`，pi 每次都加载完整 agent 环境（工具 schema + MCP + 扩展）——极简 "回复ok" 就吃 **28738 input tokens**；叠加文档正文 + thinking 模型（如 `minimax-cn/MiniMax-M3` 的 `<think>` 长推理）→ 真实抽取轻松 >90s 触发 `pi prompt timed out`。**修复 = 加 `--no-tools --no-context-files`**（保留 provider，input ↓92% 至 ~2.3k）+ 放宽超时（默认 180s）。已落地于 `pi-adapter.ts:runPiPrompt`；调用方按需传 `timeoutMs`（抽取类建议 ≥120s）。坑：`--thinking off` 对 MiniMax-M3 实测**无效**（模型仍输出 `<think>`），故解析侧需 `text.replace(/<think>[\s\S]*?<\/think>/gi,"")` 再扫 JSON（见 `onto-extract.ts:parseExtractJson`）。
- `node:sqlite` 的 `DatabaseSync` **无 `.transaction()`**（那是 better-sqlite3 API）→ 事务一律用 `db.exec("BEGIN")` / `"COMMIT"` / `"ROLLBACK"`（db.ts 既有范式）。
- **循环 import 下模块级 const TDZ 坑（2026-06-12 实遇）**：`db/shared.ts` ←→ `db.ts` 互相 import；`db.ts` boot 期(顶层)调 `backfillMemoryEnablements()`。若 `index.ts` 在 `db.ts` import **之前** 直接 import `db/shared.ts`（如我加 fork/subagent 函数时），会让 `db/shared.ts` 先开始求值、在 `import db.ts` 处暂停 → `db.ts` boot 调用早于 `db/shared.ts` 的模块级 `const` 初始化 → `ReferenceError: Cannot access 'X' before initialization`（typecheck/build 全绿，仅运行时炸）。**规避**：被 boot 期跨模块调用的函数，其依赖的数据**用函数内局部 const**（非模块级 const），与 import 求值序解耦。教训同「终审须加运行时实跑」——纯静态检查抓不到。

---

## 四、UI 导航台账（接缝层归总控，2026-06-10 快修批）

导航 = 接缝层，改动只在总控 slot：一级 tab `MainHeader.TABS`（`Tab` 类型）；二级 tab `lib/constants.ts` 各 `*_SUB_TABS` + `getSubTabsForTab`；渲染分发 `tabs/{DataTabs,EngineTabs,VizTabs}.tsx`；布局/二级条/侧栏在 `App.tsx`。

**一级 tab 现序**：探索 · 工作流 · 计算工具 · 规则记忆 · **实验室** · **Xan数据库** · Dashboard · **onto-xanthil**。
- `anax` 一级 tab 已**移除**（并入实验室）；`onto_xanthil` 已落地（**已移出 `VIEW_ONLY_TABS`**，`ONTO_SUB_TABS` **8 子tab：说明/对象/关系/指标/逻辑/动作/图谱/导入**；pane=`OntologyPane`，渲染分发在 VizTabs；默认子tab `onto_readme` 在 `App.tsx handleTabChange`）。
  - **二级 tab 全部以左侧竖栏呈现**（2026-06-10，仿 AnaX 范式）：`App.tsx` 顶部二级条对 `onto_xanthil` 隐藏（`activeTab !== "onto_xanthil"` 守卫），改在内容区左侧渲染 `ONTO_SUB_TABS` 竖栏（`isVisible` 过滤，与 AnaX `LAB_ANAX_SUB_TABS` 同款样式）。`onto_logic`/`onto_actions`(P6) + `onto_readme`(说明页，纯静态文档，无需 workspace/本体即可看) 三子tab 后加。
  - **⚠ 坑：内容区 pane 必须自带 `overflow-y-auto`**。内容容器是 `min-h-0 flex-1`（弹性高度），pane 根若无滚动样式，超出视口的内容会被**直接裁切**（无滚动条）。`OntologyPane` 曾因此 readme 长内容看不到下半屏 → 根包一层 `h-full min-h-0 flex-1 overflow-y-auto` 修复。新建长内容 pane 一律加此外壳。

**实验室（research_lab）= 两级嵌套**：
- 顶部横向 `LAB_SUB_TABS` = workflow/skill/tool/model/DLF/**AnaX**（AnaX 顶部 tab id 复用 `anax_view`）。
- 仅当 `activeSubTab ∈ LAB_ANAX_SUB_IDS`（anax_view/hypothesis/change_mgmt/readme）时，`App.tsx` 在内容区左侧渲染 `LAB_ANAX_SUB_TABS` 竖栏；顶部 AnaX tab 在任一子项激活时保持高亮。复用单一 `activeSubTab`，无额外状态。AnaX 4 pane 渲染条件已迁到 `research_lab + 上述子 id`（EngineTabs）。
- **`document_eval`「文档评测」第 7 个测评台（E-QEVAL2，2026-06-26 接缝追认）**：E 卡接线时在 `constants.ts`（接缝层·总控 slot）加了 `document_eval` 到 `SubTab` union + `LAB_SUB_TABS` + `LAB_SUB_IDS`。**总控裁决：追认**——足迹严格遵循既有 lab-subtab 范式（与 prompts_lab/command_lab 同构、三处同步），是接 lab 子栏的唯一方式，回滚等于删能跑接线再原样重写（纯 churn）。同模板库前端接缝追认先例（§六）。渲染分发在 `EngineTabs`（`aggregate + document_eval` → `DocumentEvalPane`），`App.tsx` 左竖栏靠 `LAB_SUB_IDS` 既有泛型逻辑自动拾取、无需改。**后续同类「pane→后端」接线 E 仍应先报口径由总控加 constants enum。**

**规则记忆（rule_memory）9 项**：6 大记忆模块（`rules`偏好 / `indicators`指标 / `cases`项目 / `failure_memory`失败 / `field_memory`字段 / `process_memory`流程）+ 业务环境/trace/知识图谱并列。`token_stats`/`quick_notes`（随手记）为 header 按钮跳转的隐藏子页，不入二级条（沿用 token_stats 既有范式）。

**新增占位 subtab**（脚手架，后端待补）：`tool_use` `failure_memory` `field_memory` `process_memory`；均用 `Placeholder` 组件。

**已实现（2026-06-10 快修）**：`quick_notes` 随手记 = `components/QuickNotesPane.tsx`，仿 `wiki.html` 随手记的纯前端 localStorage 实现（key `xanthil-quick-notes`，笔记 `{id,text,ts}`）——保存 / ⌘·Ctrl+Enter / 勾选合并复制（未勾选则全部）/ 删除 / 导出导入(按 id 去重合并)。零后端、零 LLM。

**探索·工作视图红线只读栏**：`App.tsx` 在 `explore + view` 内容区左侧挂 `CleanDataDocsColumn`（聚合数据只读+复制，详见 `notes-data` 红线范式）。

**探索 subtab 序（2026-06-12）= 独立 `EXPLORE_SUB_TABS`**：业务需求·原始数据·聚合数据·数据探索·**数据分析**(=`view`,原名「工作视图」)·报告输出·汇报版本·报告审核·黄金策·**行动**(`actions`)。**关键：explore 与 multi 曾共用 `SUB_TABS`(getSubTabsForTab fallthrough)，但 `view` 在两 tab 渲染不同**(explore=`CleanDataDocsColumn`聚合文档列；multi=`FlowListColumn`工作流列表) → 改名/重排只对 explore：新增 `EXPLORE_SUB_TABS` + `getSubTabsForTab` 加 `if(tab==='explore')` 分支；**multi/工作流仍用 `SUB_TABS`**(view=「工作视图」保持首位不变)。`actions` 已加入 `SubTab` union + 两份列表。`App.tsx handleTabChange` 探索默认子 tab 仍为 `view`(现「数据分析」)。改探索 subtab 改名/排序走 `EXPLORE_SUB_TABS`，勿动 `SUB_TABS`(会波及工作流)。

**左侧主栏改造（2026-06-11）**：`Sidebar.tsx` 现仅 工作区 / **任务**（原「探索」会话区重命名，一个会话=一个任务）两区。① **精选收藏下线**：删侧栏区块 + 工作流行收藏星标按钮 + `App.tsx` 的 favorites state/handler/bootstrap（`noUnusedLocals` 要求）；后端 favorites 表/路由/api 方法**保留休眠**（未删，可恢复）。② **工作流列表移出主栏** → 迁入「工作流·工作视图」内容区左竖栏 `components/FlowListColumn.tsx`（选择/新建/重命名/删除，可收起，排除 AnaX 模板派生 flow），在 `App.tsx` `multi + view` 渲染。Sidebar 的 flows/favorites 相关 props 已删。"跑工作流也建任务" 暂为人工约定（用户定，未做 flow↔task 自动联动）。

**decision 一级 tab（接缝层占位，2026-06-11）**：`MainHeader.Tab` 含 `"decision"`、`constants.SubTab` 含 `decision_board/workbench/assistant/review`（仅类型字面量，为 `DecisionTabs.tsx` 转绿）。**但 `TABS` 数组未加 decision 项、无 `DECISION_SUB_TABS`/`getSubTabsForTab` 分支、`App.tsx` 未渲染 `DecisionTabs`** → 该 tab 当前不可达。导航/渲染接线 = 已派卡（wiki TASKS dom=X），owner 总控续做；功能落地 P2–P5 见 `docs/decision-intelligence-plan.md`。

**已知小回归（非阻断）**：AnaX 内层子项（假设库/变更管理/readme）不在 `getSubTabsForTab(research_lab)` 中 → SettingsModal 不能单独隐藏（AnaX 已降为二级，可接受）。

---

## 五、数据分析 tool-use spike 结论（Phase 2a，2026-06-12 取证）

> 目标：让数据分析 pi 对话（ChatPane）能调用已注册 `ExtractionTool`。spike 先行（wiki X 卡要求），结论如下，**改变了原卡「skill+bash」的暂定机制**。

**1 · pi 工具模型（`pi --help` 取证）**：内建工具 `read/bash/edit/write`；另支持 extension/custom tools + **MCP**（`pi list` 显示已装 `pi-mcp-adapter`）+ skill（`--skill <SKILL.md>`，纯指令非工具）。工具开关：`--no-tools` / `--no-builtin-tools`（禁内建保扩展/custom）/ `--tools`(allowlist) / `--exclude-tools`(denylist)。已装 `pi-sandbox` 扩展（可约束文件访问）。

**2 · 数据分析 session 现状红线姿态（`handleSend` index.ts:5536 取证）** ⚠️：
- `runPiTurn({ workspaceRoot: ws_.rootPath })` → **cwd = workspace 根**；内建工具**全开**（未传 `--no-tools`）。draw_data 物理在 `<root>/sessions/<id>/010_raw`（见 `workspace-dirs.ts:FOLDER_DIRS`）。
- 红线保护 = **路径不披露（behavioral）**：`buildRegisteredPathContext`(output-paths.ts:98/101) 显式排除 draw_data 路径、只给 clean_data/report **路径**；pi 靠内建 `read` 读这些路径来分析、写报告。
- 推论：保护**非硬沙箱**——pi 有 bash/read + cwd=root，理论上能 `ls`/`find`/`cat` 到 `sessions/*/010_raw`（draw_data）。属**既有潜在敞口**，靠"不告诉 pi 路径 + 不指示读"维持。**session 离不开内建 read/write**（读 clean_data、写报告），故不能简单 `--no-builtin-tools`。

**3 · 桥机制结论**：
- ❌ **skill+bash 不安全**：skill 让 pi 用 bash 跑工具二进制，且 bash 本就能读 draw_data。否决。
- ✅ **推荐 MCP**（`pi-mcp-adapter` 已装）：建一个 server 侧 MCP server，把 AI 可调 `ExtractionTool` 暴露为 MCP tool；handler 走既有 `/api/extraction-tools/:id/run` 并带 `source=ai` 来源标记。pi 经 MCP 调用；tool_call/tool_result 走 MCP 事件（PiEvent catch-all `{type:string;...}` + `turn_end.toolResults` + content `tool_use/tool_result` 可渲染）。
- **2026-06-13 更新**：原后端 clean_data 守卫已按用户红线政策移除；当前红线是禁止原始行/明细直接进 LLM，工具聚合/衍生产物可回流。

**4 · 决策（2026-06-12 用户拍板）**：① 桥机制 = **MCP**（确认，非原卡 skill+bash）；② 既有内建工具潜在敞口 = **单列独立红线卡**（wiki TASKS 已开「红线硬化·独立议题」，与本卡解耦）。

**5 · pi-mcp-adapter 接口取证（实现地基）**：
- 读 `.mcp.json`(cwd) / `~/.pi/agent/mcp.json`(全局) / `~/.config/mcp/mcp.json`；格式 `{mcpServers:{<name>:{command,args,env?,url?,directTools?}}}`(标准 MCP)。提供 proxy tool(~200 tokens)按需发现，server 用时才启。
- 全局 `~/.pi/agent/mcp.json` 已有多 server（context-mode/minimax/sqlite/filesystem→/Users/huangbo/Dev 等）。**注**：那个 `filesystem` MCP(directTools) 也能读 ~/Dev 任意文件 → 同属上述独立红线卡范围。
- **MCP SDK 不在本项目依赖**（pi 全局有，项目树无）。stdio MCP 协议仅 `initialize`/`tools/list`/`tools/call` 三 JSON-RPC 方法 → **决策：手写零依赖 stdio MCP server**（不加 `@modelcontextprotocol/sdk`，契合 onto-export 零依赖先例 + §十 不装未确认依赖）。

**6 · 实现（✅ 已落地 2026-06-12，总控自做+自检；server typecheck + web build + 隔离 grep 全绿）**：
- (a) ✅ `server/src/mcp/extraction-tools-mcp.ts`：手写**零依赖** stdio MCP server（JSON-RPC initialize/tools-list/tools-call/ping，newline-delimited）。纯 stdio→HTTP 代理，自身不读数据文件；`tools/call` → POST `/api/extraction-tools/:id/run` 带 `source=ai`。冒烟测 initialize/ping 通过；tools/list·call 需活体 API + pi 实跑。
- (b) ✅ `index.ts` `/run` 曾加 `source=ai` clean_data 守卫；2026-06-13 红线政策已反转，当前 `/run` 不再按 clean_data 白名单拦输入，`source=ai` 仅作来源标记，详见 §五.7。
- (c) ✅ 注册 = **每工作区 .mcp.json**（用户决策）：`server/src/mcp/register.ts:ensureWorkspaceMcpConfig`（合并写、保留他 server）在 `createWorkspace` 调 + 启动 `registerAllWorkspaceMcp()` 回填既有工作区。pi-mcp-adapter 读 cwd=workspaceRoot/.mcp.json → 工具仅在该工作区数据分析 session(handleSend cwd=ws.rootPath) 可见。
- (d) ✅ 契约：tool 事件走 PiEvent catch-all `{type:string;...}` + `turn_end.toolResults`，**未改 types.ts**（无新 WS union）。
- (e) ✅ E helper skill（Phase 2b）：`skills.ts:ensureExtractionToolSkill` 生成 `.pi/skills/xanthil-extraction-tools/SKILL.md`（列工具 + Contract「经 workspace MCP server 调、入参 cleanDataPath」），**指向 MCP 的引导 skill，非竞争桥、不教 bash**。**总控决策：不自动注入 runPiTurn**（MCP proxy 已可按需发现），保持 SkillSelector 可选；E 当前「可发现、未自动注入」即正确。小注：写文件在 listSkills 读路径(幂等+try/catch，可接受)。
- (f) ✅ **AI-safe 工具分类契约（2026-06-12 E 代笔，总控口径）**：`ExtractionTool.category?: "ingestion" | "analysis"` 双侧同义；缺省/非法值保守归一为 `ingestion`。`ingestion`=吃原始源文件的摄取型工具（如 .html/原始 Excel/PII 清洗），永不进 AI/tool-use；`analysis`=只读已备好的 clean_data 聚合数据，可被 AI 调用。MCP `tools/list` 和 `tools/call` 统一走 `isAiExposed(tool)`，当前条件仅 `category === "analysis"`；D 卡若接入 `enabled`，只把该函数改成 `category === "analysis" && enabled`。`GET /api/extraction-tools` 不过滤，消费方各自按 category 决策。
- **待实跑点检**（typecheck/build≠功能）：pi↔MCP 活体握手(pi-mcp-adapter 起 server / tools 发现) + AI 调工具经 `/run source=ai` 放行 draw_data 路径 + E 卡 ChatPane tool 渲染。

**7 · I4 决策更新：AI 可调工具输入放开，禁原始行直进 LLM（2026-06-13 用户红线政策决策）**——原“守卫单点拦 draw_data”已被政策反转。结论：
- **AI 路径**：MCP → `/run source=ai` 仍作为来源标记，但 `/run` 不再按 clean_data 白名单拦输入；AI 可调工具可读取已登记数据路径。
- **新红线**：`draw_data` 原始行级内容/明细禁止直接进 LLM；经注册工具处理后的聚合/衍生产物（不含原始行）允许进 LLM。
- **工具责任**：工具对其产物是否含原始行负责；禁止把 `draw_data` 原始行/明细整体回灌 LLM。`validateExtractionInput()` 仍保留格式与工具输入契约校验。
- **不变边界**：数据探索模块（`DataExplorationPane` 及其子树）纯前端零 LLM 的硬约束不变，绝不可动。

**8 · ExtractionTool registry 加载策略（2026-06-13 用户实跑发现 + E 代笔）**：
- **坑**：`server/tools/registry.ts` 原先模块级 `const tools = loadTools()` / `toolsById` 只在服务启动时加载一次；`tool.json` / `.py` 是 `readdirSync` 读取而非 import，`node --watch` 不会因工具目录增删自动重启；tool-use 控制台“刷新”只重发 GET，后端仍返回旧快照。
- **决策**：工具数量个位数，扫盘成本可忽略；registry 不做模块级缓存，`listExtractionTools()` 与 `getExtractionTool(id)` 每次调用实时 `loadTools()`。
- **影响面**：函数签名/返回类型不变，`index.ts`、MCP server、ToolLab、tool-use 控制台无需改；刷新按钮自然拿到最新工具列表。
- **验收口径**：不重启服务，新增/删除 `server/tools/<id>/` 后点击控制台“刷新”应反映最新工具与分类计数；MCP 经 HTTP 调 `/api/extraction-tools` 同样受益。

**9 · ChatPane `@工具` 人工触发 analysis 工具（2026-06-13）**：
- **定位**：补齐“用户手动指定调哪个工具”的空档，区别于 pi-agent 经 MCP 自主调工具。用户在探索「数据分析」对话中手动选择 `analysis` 工具、已登记数据文件和参数，运行后把结果作为普通消息回流当前 session。
- **实现边界**：E 侧最小闭环，新增 `ManualAnalysisToolCard` 并挂到 `ChatPane` 辅助面板；不改 `index.ts`/`types.ts`/`App.tsx`/`api.ts` 等接缝层骨架，不碰数据探索红线子树。
- **安全路径**：前端只展示 `category === "analysis"` 工具；专用 API 方法 `runAnalysisTool()` 调 `/api/extraction-tools/:id/run` 时强制带 `source: "ai"` 作为来源标记。不要用普通 `runExtractionTool()` 实现该入口，因为它默认是 manual 模式。
- **输入路径决策（2026-06-13 红线政策同步）**：输入选择不再 clean_data-only；`ManualAnalysisToolCard` 读取 workspace 已登记路径并只展示 `draw_data` / `clean_data` 文件，analysis 工具筛选仍不变。
- **输出路径决策**：`outputPath` 固定取当前任务 session 的 `report` 目录（标准 060_reports），UI 只读显示，不再提供多选下拉。复用现有 `api.listSessionPaths(sessionId, "report")`，无需新增后端 output-dir/session-reports 端点，不自动创建 `tool_runs`。
- **回流决策**：先做文本 summary + outputs 路径，可编辑后“发送到对话”；暂不做结构化结果卡、JSON viewer 或产物预览。pi 后续负责解释、整合、写作、下一步规划，不重复工具的确定性计算。

**10 · 数字锁产出侧校验 MetricVerification（2026-06-25，总控）**：
- **问题来源**：D-METRIC1/E-METRIC2/D-METRIC3 把工具/监测的确定性 `MetricSnapshot.value` 注入 LLM，并用 prompt 要求“只解读、不重新推导”。这只是输入侧软约束；若模型把 `12500` 复述成 `12000`，系统原先没有产出侧信号。
- **适用范围决策**：只打 **tool-use 链路**。tool-use 的 `MetricSnapshot[]` 经 MCP tool result 注入，assistant 会在自由文本里复述/解读数值，适合在 `message_end` 后回校。监测链路 `draftMetricSystem` 输出是结构化指标体系设计（metrics/dependencies/monitorRules），不复述 snapshot 数值，无可校数字，本期不碰。
- **契约与核心**：双侧 `types.ts` 增 `MetricVerification{verdict,hits}` / `MetricVerificationHit{name,expected,foundInText,status,relDiff}`；`server/src/metric-verification.ts:verifyMetricUsage()` 只读 `MetricSnapshot[] + answerText`，正则提数并归一千分位/小数/`万`/`亿`/百分比。容差首版固定：`relDiff <= 0.5%` → `matched`；`0.5% < relDiff <= 20%` 且同量级 → `suspect`；其他数字视为无关；没出现 → `unreferenced`；任一 suspect → `verdict="mismatch"`。
- **接入方式**：`server/src/metric-verification-events.ts` 从 `tool_result` / `turn_end.toolResults` / MCP 文本块中 best-effort 抽取本轮 snapshots；`index.ts:handleSend` 与 `routes/engine.ts:handleSendFlow` 在同一 turn 局部数组留存，assistant `message_end` 后校验。只有 mismatch 时在同条 assistant message 的 `content` 追加 `{type:"metric_verification", verification}`；前端 `MessageRow` 渲染琥珀色告警。无 snapshot 或 verdict ok 时完全不回传，向后兼容。
- **为什么用 content block**：不新增 `ClientMessage` 字段，不改 WS 顶层协议；沿用 pi content block 的宽松结构，历史消息持久化后也能复现告警。注意 `ChatPane` 的 business/trace 过滤要把 `metric_verification` 视为业务可见 block，否则会被折叠到“执行详情”。
- **安全与行为边界**：校验器不碰 `draw_data`、不读文件、不看 dataset rows；只消费 LLM 已产生文本和已注入的衍生 snapshot。首版只告警，不阻断、不改写、不自动重试；自动纠偏需另设预算和最大迭代，避免误报导致死循环。

---

## 六、工作流改造接缝层（0→1→2，2026-06-13 总控）

**背景**：把工作流模块从「三套重叠执行栈 + 孤儿代码」收敛为「单引擎 + 闭环」。方案 `docs/工作流模块改造方案.md`、派发书 `docs/工作流改造-任务派发.md`、闭环契约 `docs/工作流-onblock契约.md`、backlog `docs/backlog/agent-loop-工作流闭环.md`。闭环全貌见 `notes-engine.md §0`。

**核心铁律（迁路由时必守，已被本轮验证）**：`routes/<域>.ts` **只 import 共享模块**（db/flow-fs/cache/…），**绝不 import index.ts 本地 helper**。否则与 index.ts→engineRouter 形成循环依赖。故迁 flow handler 前，先把它依赖的 index.ts 本地 helper 按"跨域 vs flow-only"分流：
- **跨域 helper**（留下的代码 + 迁走的 handler 都用）→ **抽到共享模块**：`runtime.ts`(send/active-run maps/getActiveChatRun/abortChatRun) · `cache.ts`(trackUsageEvent) · `flow-trace.ts`(traceFlowEvent) · `message-text.ts`(flowMessageText) · `memory-injection.ts`(withRulesPrompt) · `workflow-config.ts`(normalizeWorkflow*) · `workspace-path-status.ts`。
- **flow-only helper**（仅 handler 用）→ 随 handler **搬进 engine.ts**（captureWorkflowFromText/parseWorkflowCandidate/backfill*）。

**接缝模块清单（本轮新建，server/src/）**：
- `runtime.ts` — WS 运行时句柄；**`wss` 不上移**（依赖 http server、仅 index.ts bootstrap 用，YAGNI）。
- `flow-trace.ts` / `message-text.ts` / `workflow-config.ts` / `workspace-path-status.ts` — 纯函数共享。
- `cache.ts` 加 `getRunTokenUsage`/`evaluateRunBudget`/`RunBudgetLimits`（run 级预算原语，读既有 flow_run token 统计，不改累计口径）。
- `sql-loop-template.ts` — SQL 修复 loop 预置模板（E 域内容，但 toolId 常量 `RUN_SQL_QUERY_TOOL_ID` 被 runner 引用）。

**flow 路由/handler 归位**：全部 flow REST + 3 个流式 WS handler 迁入 `routes/engine.ts`；`wss.on("connection")` 派发分支留 index.ts、反向 `import { handleSendFlow, handleExecuteMultiAgent, handleAnaxPrecheck, abortAnaxPrecheck } from "./routes/engine.ts"`。**engine.ts 不 import index.ts → 无循环依赖**。

**execute_flow 双侧解耦发现**：server 与 web 各有独立 `types.ts`，`execute_flow`(死单 agent 路径)的消费(server)与发送(web 孤儿文件)分处两侧 → 删除无需原子同批，各自独立可绿。

**run 预算接线（成本停止条件落地）**：`config.ts` `RUN_BUDGET_LIMITS` 读 env `XANTHIL_RUN_MAX_TOKENS`/`XANTHIL_RUN_MAX_COST_USD`（>0 生效，未设=null 即不限、行为不变）；`routes/engine.ts` handleExecuteMultiAgent 传 `runBudget`。**决策**：env 可选优于硬编码魔法上限（避免误伤大 run）优于 DB 配置（过重）；per-workspace 限额 + UI 留待按需。

**flows/:id/import(multer) 迁移（2026-06-13 完成）**：原以为 multer 基建多路由共用、需先抽共享；核查发现 `upload`/`uploadDirs`/`_uploadId` **仅该路由用**（`/api/bi-datasets/upload` 用自己内联的 `multer({...}).single`）→ 直接随路由整块搬进 `routes/engine.ts`（engine.ts 加 `import express, { Router }` + `import multer` + UPLOAD_TMP_ROOT/moveAllFiles）。端到端上传冒烟通过。**教训：迁移前先 grep 确认"基建是否真共用"，别想当然。**

**收官（2026-06-13）**：`anax-gate-config`(GET/PUT) 也已迁入 routes/engine.ts。**至此 index.ts 已无任何 flow/anax 业务路由**——工作流改造接缝迁移彻底完成。index.ts 仅余 legacy 非工作流路由(session/workspace/onto/bi/eval 等)与 wss.on bootstrap。

**模板库前端接缝·总控追认（2026-06-14，总控亲核）**：工作流模板库入口（wiki E 卡）上线时 E 接线碰了接缝层骨架。**总控 grep 核实**实际足迹**仅 2 处**，且评审点名的 `constants.ts/EngineTabs/DataTabs` 确未动（越界被高估）——证据：① `web/src/App.tsx:423` `instantiateWorkflowTemplate` handler（按 `template.id` 分发到 3 个 api 方法）+ `:837` 传 `onInstantiateTemplate` 给 `FlowListColumn`，与同处 `onNewFlow`/`onRenameFlow`/`onDeleteFlow` 同构；② `web/src/lib/api.ts:346-359` `legacyApi` 加 3 个 REST wrapper（`instantiateAnax`/`instantiateAnaxQuick`/`instantiateSqlLoop`），与既有 instantiate 方法同模式；③ `grep "template" constants.ts`=空、`EngineTabs/DataTabs` 无 template 渲染（未加 subtab/pane，模板实例化走 FlowListColumn 按钮）。**总控裁决：追认，不回滚**——足迹最小且严格遵循既有 seam 惯例，回滚等于删能跑的接线再原样重写（纯 churn）。后续同类「pane→后端」接线 E 仍应先报口径由总控加，但本次既成事实合规，正式归入接缝台账。（注：本段原由 D 在 hooks 卡2 工作中顺手写入，内容属实，已由总控核验并改以总控名义持有。）

---

## 七、LLM 管理后端真源（2026-06-16）

**归属与边界**：`/api/llm*` 属 shared/infra 总控 slot，后端落 `server/src/routes/shared.ts` + `server/src/llm-config.ts`。该能力直写 pi 全局真源 `~/.pi/agent/{models.json,settings.json}`，读取 `auth.json` 授权态；不得下沉到 data 路由，也不得绕过 `llm-config.ts` 直接写 pi 全局文件。

**真源结构**：
- `models.json`：`providers.<id>` 为 provider 配置，兼容 provider 级 `baseUrl/api/apiKey` 与 model 级 `baseUrl/api/apiKey` 两态。
- `settings.json`：本模块只维护 `enabledModels/defaultProvider/defaultModel`，`packages` 等其他键必须保留。
- `auth.json`：只读；OAuth 凭证归 `pi auth`，控制台不写 access/refresh/accountId，也不向 OAuth provider 写新 key。

**apiKey 安全铁律**：
- GET provider view 只出 `hasApiKey:boolean`，永不返回 `apiKey`。
- PUT provider 时 `apiKey` 为空、缺省或 `"****"` 均保留旧值；非 OAuth provider 的非空新值才覆盖；OAuth provider 忽略新 key。
- `testProvider()` 只在 server 内取有效 key 调 `/models`，返回 message 前必须 `replaceAll(key, "****")`。
- auth view 只返回 `{providerId,type,authorized:true}`，禁止返回 access/refresh/accountId。

**写入约束**：
- 所有 `models.json` / `settings.json` 写入必须经 `atomicWriteJson()`，即 temp 文件 + rename；写 `models.json` 后还原旧权限位。
- provider/model unknown fields 以旧 raw 为基底浅展开保留，避免前端表单往返误删 pi/OAuth/provider 扩展字段。
- provider 校验：当前 `LlmApiKind` 只允许 `"openai-completions"`；provider 级无 `baseUrl` 时，每个 model 必须有自己的 `baseUrl`，否则该 model 没有有效测试/调用地址。
- settings 校验：`enabledModels` 必须形如 `provider/model`；default provider/model 必须成对出现，且存在于 `models.json`，否则 400。

**测试/验收口径**：
- `npm run typecheck` 与 `npm run build` 必须绿。
- HTTP smoke 用 `XANTHIL_PI_MODELS/XANTHIL_PI_SETTINGS/XANTHIL_PI_AUTH` 指向 `/tmp` 隔离文件，避免碰真实 `~/.pi/agent`。
- 必测：providers/auth 无明文 key；PUT 往返保留旧 key/未知字段/model 级 `baseUrl`；settings 只改三键；错误 baseUrl 的 test 返回失败且不含 key。

**未来扩展**：新增 api 类型时，`types.ts` 的 `LlmApiKind`、`llm-config.ts` 的 `SUPPORTED_API_KINDS`、`coerceApiKind()`、`testProvider()` 分支必须同步扩；否则会出现 UI 能保存但 testProvider 不会测的漂移。

---

## 八、文档质量评测契约（X-QEVAL0，2026-06-26 总控自做）

**背景**：eval_plugin 盘点（2026-06-25）→ Python `eval_plugin` 移植为 TS。本卡=接缝契约先行，解锁 **D-QEVAL1**(runner) / **E-QEVAL2**(lab)。与现有六类评测（prompt/command/hook/skill/subagent/tool）并列，**不破坏、不混入**任何现有 `*-evaluation-runner.ts`。

**已交付（仅加法，不改现有业务代码）**：
- **双侧 `types.ts`** 4 类型（`HookEvaluationDetail` 后、`EvaluationArchiveResult` 前，字面一致）：`DocumentEvalRuleResult`{ruleName,passed,score,detail} · `DocumentEvalCase`{id,name,domain,reportPath,rubrics[]} · `DocumentSessionMetrics`{totalTokens,totalCost,subagentCount,wordCount,costPer1kWords} · `DocumentEvalResult`{caseId,ruleResults[],ruleTotalScore,judgeScore,judgeDetails[],combinedScore,consistencyAlerts[],sessionMetrics?}。`domain` 取 `"mall"|"return_profile"|string`（开放域）。
- **`server/src/document-eval-api.ts`**（HTTP 签名 + 入参校验，对齐 `command-evaluation-api.ts` 范式）：`DocumentEvaluationRunRequest`{cases,model} / `DocumentEvaluationRunResponse`{resultId} / `parseDocumentEvaluationRunRequest()` / `parseDocumentEvaluationCases()`（去重、reportPath 必填、rubric criterion 必填、weight 非有限回退 1）。**只定契约，不注册路由、不实现评测。**
  - `POST /workspaces/:id/document-eval/run {cases,model}` → `{resultId}`
  - `GET /workspaces/:id/document-eval/results/:resultId` → `DocumentEvalResult[]`

**接缝审定（D-QEVAL1/E-QEVAL2 必守）**：
1. **复用 `evaluation-common.ts:runJudge`**（单次 LLM judge）。**3 次取中位数逻辑在 runner 层实现**，勿改 runJudge 本身。
2. **新建 `document-evaluation-runner.ts`** 与现有 `*-evaluation-runner.ts` 并列，独立文件，不混入现有 runner。
3. **不新增 lab 类型枚举**——lab 落点（实验场 subtab/范式 A or B）归 E-QEVAL2 自行判断。
4. 路由落 `routes/`（engine 域），前端 api 方法落 `api/engine.ts`（E slot）——本契约卡均**未碰**，留给下游。

**验证**：server + web typecheck 绿、build 绿，现有业务代码零改动。

---

## 九、Harness 自进化接缝契约（X-HARNESS0，2026-06-27 总控自做）

**背景**：harness 论文集精读两条 backlog —— `EFC-反馈效率度量.md`（arxiv 2605.29682）+ `AHE-可证伪编辑契约.md`（2604.25850）—— 落地。本卡=**接缝契约 + 无-git 回滚预研**，仅定单一真源 + 定签名 + 审定口径，**不实装打分/对照/回滚逻辑**（归 E）。解锁两张 E 卡：**E-EFC1**（EFC 打分器）/ **E-AHE1**（manifest 对照器 + 组件级回滚）。

**已交付（仅加法，零业务改动）**：
- **双侧 `types.ts`**（镜像，插在 `EvaluationArchiveResult` 后、跨 lab 回归看板前，字面一致）：
  - `HarnessComponent`（7 类组件 prompt/command/subagent/hook/skill/memory/tool）—— **刻意独立于既有 `LabKind`**：LabKind=6 个测评台；HarnessComponent=AHE 组件动作空间，**含 memory（非 lab）**，语义不同，禁合并复用。
  - **EFC 侧**：`FeedbackEvent{I,V,R,M∈[0,1],raw}` + `EFC_KAPPA=10`（值导出）+ `TaskDemand{L,H_tool,S_state,N_obs,V_oracle}`（D_task 归一化输入）+ `EfcScore{efc,normalized,eta}`（三视角：原始/EFC÷D_task/EFC÷C_raw）。
  - **AHE 侧**：`ChangeOutcome`（accept/revise/reject/defer，SkillHone 四态升级，原 AHE 只有 verdict）+ `ChangeManifest`（含 `outcomeReason?`/`createdAt`——决策史 ℋ_{<t} 检索需「为何被拒」+ 时序排序）+ `EditVerdict`（四率 + `regressedSolvedTasks`——HarnessX seesaw 无回归门可校验字段）+ `HarnessVariant{variantId,baseEditId,perTaskRouting}`（冲突编辑 fork 变体）+ `ScopedRevision`（typed scoped revision 回滚底座）。
- **`cache.ts` C_raw 只读 getter（总控持有签名）**：`RawComputeUsage{totalTokens,toolCalls}` + `getRawComputeForSession()` / `getRawComputeForRun()`。**纯读既有 token 统计、不改累计口径**；`toolCalls` cache 不采集，由 E 从 trace 传入回填（缺省 0），避免新起采集管线。`prompt-blocks.ts` 本卡未碰（无 block 内容改动 → `PROMPT_SCHEMA_VERSION` 不 bump）。

**对原 brief 字段的两处增补（总控自审，已写死供 E 施工）**：
1. `ChangeManifest` 加 `createdAt:number` + `outcomeReason?:string` —— 把单轮对照升级为可检索经验库（按 createdAt 排序取 ℋ_{<t}，按 outcomeReason 复用「上个方案为何被拒」）。
2. `EditVerdict` 加 `regressedSolvedTasks:string[]` —— HarnessX「确定性 seesaw 无回归门」做成可校验字段（非空=候选回归了已解任务=未过门，比纯回滚严）。

**回滚底座审定（无-git 难点结论，E-AHE1 必守）**：
- **不用 git**：实验场编辑流程无 git（见 px-hotfix/px-wrapup），AHE 的「组件级回滚 / 可证伪提交」缺底座。
- **方案 = typed scoped revision（SkillHone 取向）**，非整体快照回滚：每次编辑落一条 `ScopedRevision`，回退时按 `scope` 定位 offending part 精准还原，**保留同次编辑里其他 useful edits**。`beforeSnapshot/afterSnapshot` 提供精准还原内容，`manifestEditId` 关联根因。
- **持久化落点 = `db/engine.ts`（E slot），schema 实装如下**（按 §四/§五：engine 域表、总控审 schema、注册进 `initEngineTables`）：
  - `harness_edits`（存 `ScopedRevision`）：`edit_id TEXT PK · component TEXT NOT NULL · resource_id TEXT NOT NULL · scope TEXT NOT NULL · before_snapshot TEXT NOT NULL · after_snapshot TEXT NOT NULL · manifest_edit_id TEXT NOT NULL · created_at INTEGER NOT NULL`。索引 `(component, resource_id)` 便于按组件回退、`(manifest_edit_id)`。
  - `change_manifests`（存 `ChangeManifest`，决策史经验库）：`edit_id TEXT PK · component TEXT NOT NULL · failure_evidence/root_cause/targeted_fix TEXT NOT NULL DEFAULT '' · predicted_fix/predicted_regression TEXT NOT NULL DEFAULT '[]'(JSON) · outcome TEXT NOT NULL · outcome_reason TEXT · created_at INTEGER NOT NULL`。索引 `created_at DESC` + `(component, created_at DESC)` 供 ℋ_{<t} 时序/按组件检索。
  - `harness_variants`（存 `HarnessVariant`，E-AHE1 新增）：`variant_id TEXT PK · base_edit_id TEXT NOT NULL · per_task_routing TEXT NOT NULL(JSON) · created_at INTEGER NOT NULL`。索引 `(base_edit_id)`。
  - **⚠ 总控订正审定（2026-06-27，E-AHE1 终审）：三表落地为「全局」表（无 `workspace_id`/无硬 FK），而非我原审定的 per-workspace。** 裁决采纳 E 的全局设计——harness（prompt/skill/tool/hook/subagent/memory 组件）是**项目级资产**（AHE「harness 资产模型无关」本意），change manifest 的 verdict 跨整个测评套件聚合、决策史 ℋ 要跨轮跨任务，绑工作区会割裂经验库。路由亦端到端无 `workspaceId`，设计自洽。原「记得登记 `deleteWorkspace`」**作废**：① 三表无 `workspace_id` 无需删；② 物理删除已于 2026-06-27 放弃改用归档（见 §二·五 开头）。**流程提醒：E 偏离总控审定 schema（per-workspace→全局）未在回报中显式标注，下次改审定 schema 须先报总控复核（§五.1）——本次因纠偏正确予以追认。**
- **E-AHE1 边界**：建表 + manifest 对照器 + scoped 回滚执行；**不碰接缝层骨架**（types/cache 已由本卡定死，引用即可）。**E-EFC1 边界**：四因子打分 + 估计器 ÊFC + η 标量合成；C_raw 经 `getRawCompute*` 取数。

**验证**：server + web typecheck 绿、build 绿，现有业务代码零改动。

---

## 十、产品 Agent 自进化接缝契约（X-EVOLVE0，2026-06-27 总控自做）

**背景**：backlog `生产失败驱动的产品Agent自进化闭环.md`（OpenAI 税务 Agent「失败→eval→约束修改」闭环）落地。前置 E-AHE1 P0 跑通后解冻。本卡=接缝契约，仅定单一真源，**不实装**轨迹持久化/eval 沉淀/注释入口。解锁 **E-EVOLVE1**（引擎：失败轨迹持久化 + eval 自动沉淀，复发 finding 触发）/ **D-EVOLVE2**（监测行动环/report-review 加「采纳·标注失败环节→eval 候选」入口·红线卡）。

**已交付（双侧 `types.ts` 镜像，插在 X-HARNESS0 块后、跨 lab 回归看板前）**：
- `AgentTrajectoryModule`（'monitor'|'anax'|'flow'|'chat'）+ `AgentTrajectoryStep{stage,input,output,citation?}` + `AgentTrajectory{runId,module,steps,outcome:'pass'|'fail'}` —— 失败/对照轨迹，**脱敏后存**（input/output 为聚合/衍生文本，不含 draw_data 原始明细，沿用 E-MONITOR8 口径）。
- `EvalAnnotationStatus`（candidate/confirmed/rejected）+ `EvalRecord{id,sourceFindingId?,failingTrace,expectedOutput,passCondition,annotationStatus,createdAt}` —— failing trace 沉淀的 eval 目标；`sourceFindingId` 关联既有 `HealthFinding.id`（监测真源，string 引用无前向依赖）。
- **bounded-change 规格复用 AHE `ChangeManifest`（§九 X-HARNESS0），不新造。**

**总控增补**：`EvalRecord` 加 `createdAt:number`（原 brief 字段表未列）——持久化排序 + 按 `sourceFindingId` 去重所需，对齐 ChangeManifest/ScopedRevision 范式。

**接缝审定（E-EVOLVE1/D-EVOLVE2 必守）**：
- 表落 `db/engine.ts`（E slot）。轨迹与 eval 记录持久化是否 per-workspace 由 E 按语义定——**注意区别于 §九 harness 表**：EVOLVE 轨迹/eval 绑具体 workspace 的生产运行（monitor/anax/flow/chat run），**应 per-workspace**（与 harness 全局资产不同）；若加 `workspace_id`，按 §二·五 现政策**无需补 deleteWorkspace**（物理删除已弃用改归档），但表设计须自洽。
- **红线（D-EVOLVE2）**：注释入口在监测行动环/report-review，**只读衍生物**（findings/报告/聚合），轨迹 input/output 已脱敏；绝不把 draw_data 原始明细写入 `AgentTrajectoryStep`。
- 路由落 `routes/engine.ts`，前端 api 落 `api/engine.ts`；本契约卡均未碰，留下游。

**验证**：server + web typecheck 绿、build 绿（双侧各 9 处类型引用对齐），现有业务代码零改动。

---

## 十一、记忆老化度量接缝契约（X-AGING0，2026-06-27 总控自做）

**背景**：backlog `AgingBench-记忆老化巡检.md`（arxiv 2605.26302）落地。AgingBench 结论：**即使权重冻结，记忆运营态会随时间退化**，且「行为测试通过≠事实准确」（老化对常规行为测试不可见）。本卡=接缝契约，仅定单一真源，**不实装**探针执行/度量/修复。解锁 **E-AGING1**（Dream Worker 夜间巡检：干扰卡冲突 + 修订回扫 + 反事实探针 + 定向修复建议）/ **D-AGING2**（memory-injection 老化信号：卡冲突检测 + 事实更新回扫）。

**已交付（双侧 `types.ts` 镜像，接在 X-EVOLVE0 块后、跨 lab 回归看板前，字面一致）**：
- `AgingKind`（compression/interference/revision/maintenance = 写 W/读 R/用 U/存 S 四阶段老化）。
- `CounterfactualProbe{id,write,read}`——oracle 替换探针；**论文三档 util 恒 agent，仅 write/read 在 agent↔oracle 间变**（P1=agent/agent · P2=agent/oracle · P3=oracle/oracle），故契约无 util 字段。
- `AgingMetric{halfLife,decaySlope,finalScore + accumulatorError?/interferenceResistance?/forgetAccuracy?/shockDelta?}`——曲线三项必填、按类诊断项可选（仅对应老化类填）。
- `ErrorAttribution{writeErr,readErr,utilErr}`——由 P1/P2/P3 的 Acc 差算（util=1−Acc_P3 · write=Acc_P3−Acc_P2 · read=Acc_P2−Acc_P1）。

**接缝审定（E-AGING1/D-AGING2 必守）**：
- 与 **EFC M_t 记忆信号互补**（X-HARNESS0 §九）：老化巡检可反哺 EFC 的记忆更新质量信号。
- E-AGING1 落记忆 eval/Dream Worker（新建 `memory-aging-inspector.ts`，E-MEM2-DREAM 同源）；D-AGING2 落记忆 store/注入（`memory-injection.ts`、`db/data.ts`、`RulesPane`）。
- **红线（D-AGING2）**：守 AGENTS.md 数据安全，老化信号产出走数据探索隔离 grep。
- **方法论锚点**：修订老化是**表征问题非容量问题**——靠显式状态维护（Typed-State Overlay）而非堆模型规模；先做最痛的「干扰 + 修订」巡检即有价值，反事实探针初期可小验证集人工标 oracle。

**✅ E-AGING1 终审通过（2026-06-27）**：`memory-aging-inspector.ts`（纯函数：干扰检测 similarity≥0.35 / 修订检测 supersedes 链 + 旧引用回扫 / P1-P3 反事实归因 / 老化曲线 halfLife·OLS decaySlope）+ 只读端点 `POST /memory/aging-inspect`（不落库、不调 LLM）+ 前端 `inspectMemoryAging()`。归因公式精确（util=1−Acc_P3 等）、`CounterfactualProbeRun extends CounterfactualProbe`（E 域扩展非重声明）、纯函数无 LLM/draw_data/self-HTTP。测试 18/18（aging 4 + maintenance 11 + eval 3）、typecheck/build 绿。
- **⚠ 总控订正审定**：原写「卡冲突走 D 的 GET、不被 E import」过于理想化。实际 E-AGING1 直接 `import { listMemoryItems } from "./db/data.ts"`，**裁决追认**——① 与既有 `memory-maintenance.ts:12` 同款先例一致（记忆治理 E 侧本就直读 store）；② **老化巡检语义上必须读完整 store（含已退役/superseded 条目）**，走 `memory-injection.ts` 检索过滤反而隐藏巡检要查的失效卡，故直读比走检索 facade 更正确（区别于 notes-engine.md:264「评测走 memory-injection」——那是检索保真口径，不适用老化扫描）。D-AGING2 的 GET 用于前端/跨进程消费，非服务端内巡检。

**✅ D-AGING2 终审通过（2026-06-27）**：`memory-aging-signals.ts`（纯算法：干扰对检测 similarity≥0.35 + reason enum + pairId 稳定排序 + MAX_ITEMS=600 防 O(N²) / 修订回扫 supersedes 链 + 旧引用）+ 只读 GET `/api/workspaces/:id/memory/aging-signals`（routes/data.ts·D slot）+ `RulesPane`「查看老化信号」面板。零 LLM、显式数据安全文档（只读 memory_items 衍生字段、不碰 draw_data/clean_data）、本域消费类型不上提接缝、未碰 E 域。测试 8/8、数据探索隔离 grep 净、typecheck/build 绿。

**⚠ 重叠裁决（D 开放问题⑧ → 总控，2026-06-27）**：E-AGING1 `memory-aging-inspector.ts` 与 D-AGING2 `memory-aging-signals.ts` **各自实现了一套干扰/修订检测算法**（similarity/referencesMemory/isActive/conflict/staleRef ~100 行重复），违反单一真源。**根因**=总控先终审 E-AGING1 时 D-AGING2 未回流，追认了 E 自实现+直读，没预见与 D 本职重叠。**裁决**：D 的检测算法是正源（X-AGING0「D 真源」设计），收敛方案=**总控抽共享核 `memory-aging-core.ts`**（§四 shared helper 归总控），D-signals + E-inspector 同 import、删本地副本、各自只加域层。

**✅ X-AGING-DEDUP done（2026-06-27，总控自做·纯重构）**：新建 `server/src/memory-aging-core.ts`（总控持有，type-only 依赖 `MemoryItem`、零 runtime 副作用），导出 6 原语 `isMemoryActive`/`memorySimilarity`/`sharedMemoryTags`/`memoryReferences`/`memoryTokens`/`jaccard`。E-inspector + D-signals 删各自本地副本、改 import 共享核；E 保留 `hasConflictingSignals`/反事实/曲线/建议，D 保留 `severityRank`/reason enum/截断（域层各自留）。`similarity` 共享版返回未 round（D 口径，E 失去内部 round3 但展示处仍 round3、检测阈值碰撞≈0 行为等价）。**验证**：去重 grep（原语只在 core）、各 test 文件单独全绿（signals 8/8 · inspector 4/4 · maintenance 11/11）、server+web typecheck/build 绿。AgingBench 全链干净收口。
- **✅ 顺带收口预存测试隔离缺陷（§二·五 铁律，2026-06-27）**：`memory-aging-signals.test.ts` / `memory-aging-inspector.test.ts` 原未在 import 前设临时 `XANTHIL_DATA_DIR`——两文件用注入 `items`（纯函数、runtime 不查 DB），但 import 链触发 `db.ts` boot 开真实 `~/.pi-xanthil` 库，**多文件同进程合并跑时 `initSharedTables` 报 `database is locked`**（单文件跑无碍）。已按 `collect-db.test.ts` 范式修：`import type` 保留静态（编译期擦除不触发 runtime）+ `process.env.XANTHIL_DATA_DIR=mkdtempSync(tmpdir/...)` 后 `await import` 被测模块。验证：合并跑 23/23（signals 8+inspector 4+maintenance 11）+ 12/12 稳定无 locked、typecheck/build 绿。同款修 `memory-maintenance.test.ts`（原同样未自设隔离），三个 memory test 文件现各自独立隔离、不靠加载顺序兜底，任意组合合并跑均无 locked（复验 23/23）。

**验证**：server + web typecheck 绿、build 绿（双侧各 4 处 export 对齐）。

---

## 十二、Harness 轨迹级安全审计契约（X-AUDIT0，2026-06-27 总控自做·P2）

**背景**：backlog `HarnessAudit-轨迹级安全审计.md`（arxiv 2605.14271）落地。核心警示「任务完成≠执行安全」——harness 能返回正确答案，途中却越权访问资源/把私有 context 泄漏给错的 agent；违规中途发生、终审查不出；多 agent 放大风险面（SAR 0.91→0.58）。**P2**：随多 agent 协作规模扩大才紧迫（用户授意先解冻、契约先行，捞出前先评估价值是否随规模显现）。本卡=接缝契约，仅定单一真源，**不实装**轨迹日志/checker/SAR 报表。解锁 **E-AUDIT1**（结构化轨迹日志 px-hook-runner + 确定性 access checker Judge + SAR 报表）。

**已交付（双侧 `types.ts` 镜像，接在 X-AGING0 块后、跨 lab 回归看板前，字面一致·8 export）**：
- **harness 形式化 Π/Φ/Σ**：`HarnessPolicy{permissions:Π, infoFlow:Φ, coordination:Σ}` + `RolePermission`（Π·工具三层 required/forbidden/unnecessary + 资源参数白名单 resourceWhitelist）+ `InfoFlowPolicy`（Φ·allowPairs/denyPairs + defaultTopology hub-spoke + leakRules 数据泄露规则）+ `CoordinationPolicy`（Σ·hubRole + requireResultCheck）。**= YAML 策略规约 schema**（E-AUDIT1 将 YAML 解析为此结构）。
- **四类违规 + 度量**：`ViolationClass`（V-OT 工具/V-OR 资源/V-IC 路由/V-ID 泄露）+ `Violation{class,severity:'low'|'high',actingRole,evidence}` + `SafetyAdherence{tool,resource,flow}` 三通道 SAR + `SAR_WEIGHTS{low:0.15,high:0.3}` 常量。

**接缝审定（E-AUDIT1 必守）**：
- 落点 multi-agent/hooks（E：`multi-agent-runner.ts`、px-hook-runner、`health-check-engine.ts` 扩 Judge 钩子）。
- **后验审计、非在线拦截起步**：先记结构化轨迹（append-only JSONL）+ 事后判 SAR 出报表，验证「完成≠安全」真实存在，再谈在线门禁；与多 agent 总控终审互补（终审看产出对错，本机制看途中越权）。
- **先做 V-IC/V-ID（信息流）**：多 agent 跌最狠是信息流(0.58)/资源(0.63)；先审 D/E/V handoff 是否把不该传的产物传给不该收的域；**默认 hub-spoke**（三域不直连经总控中转）。
- 与 Orchestration「冲突协议」互补——冲突协议管冲突，本机制管信息流越权与资源越界。

**验证**：server + web typecheck 绿、build 绿（双侧各 8 export 对齐），现有业务代码零改动。

---

## 十三、监测目标测算接缝契约（X-MONITOR-TARGET0，2026-06-27 总控自做）

**背景**：用户要求监测模块新增“目标测算”，用于全年 KPI（销售/利润等）与大促活动销售测算。总控裁决：目标测算不是观星台的差距发现，而是**监测前的目标生成/推演/拆解**；用户确认后写回监测目标，复用现有 `R-GAP-TARGET` actual vs target 监测。

**已交付（仅契约，未实现 UI/API/公式）**：
- **双侧 `types.ts` 镜像**（放在监测契约块内、`MonitorDatasetBinding` 前）：
  - `TargetScenarioKind = "yearly_kpi" | "campaign" | "rolling_monthly"`
  - `TargetMetricKind = "gmv" | "revenue" | "gross_profit" | "profit" | "orders"`
  - `TargetCase = "conservative" | "baseline" | "stretch"`
  - `TargetPlanStatus = "draft" | "adopted" | "archived"`
  - `TargetAssumptions`：`traffic/conversionRate/aov/refundRate/grossMarginRate/marketingCost/fixedCost/upliftFactor`，均为可选 number。
  - `TargetCalculationInput`：`scenarioKind/metric/periodStart/periodEnd/targetValue/assumptions`。
  - `TargetCaseResult`：三情景结果，含 `requiredTraffic/requiredOrders/requiredAov/requiredConversionRate/gmv/revenue/grossProfit/profit/roi`，可为 `number | null`，避免除零产生 `Infinity`。
  - `TargetBreakdownItem`：`period/case/targetValue`。
  - `TargetCalculationResult`：`cases + breakdown`。
  - `TargetPlan`：`id/workspaceId/name/input/result/status/goalDatasetPathId?/createdAt/updatedAt/adoptedAt?`。

**红线与边界（下游卡必守）**：
- 首版只做确定性测算，**零 LLM**：不得调用 `chat*` / `generate*` / `extract*` / `clarify*` / `runPiPrompt`。
- **零 raw row**：不得读取 `draw_data` 原始行；目标计划只保存用户输入参数、测算结果与聚合目标值。
- 目标测算结果是可复算的衍生产物，adopt 后允许写入 `clean_data/monitor/` 并绑定 `MonitorSourceRole="goal"`。
- adopt 不得静默覆盖既有 `monitor_configs`：必须保留 `suite/ontologyId/metricSystemId/thresholds/source` 等既有配置；已有 goal 绑定时需显式策略（追加/选择/替换确认）。

**下游分工审定**：
- `E-MONITOR-TARGET1`：实现纯函数目标测算与单测；无 IO、无 fetch、无 LLM。
- `F-MONITOR-TARGET2`：新增 `HealthTargetPane` 与 `health_target` 二级 tab；可先本地计算，公式稳定后切 E 真源。
- `D-MONITOR-TARGET3`：目标计划持久化 + adopt 写 `clean_data/monitor/` + 更新 `monitor_configs.datasetBindings(role="goal")`。
- `F-MONITOR-TARGET4`：保存成功后跳转观星台、观星台显示目标绑定状态；不改 `monitor-engine`。
- `QA-MONITOR-TARGET5`：全链验收 + 红线核查。

**建议 API 签名（D 卡落地前仍为契约，不代表已实现）**：
- `POST /api/workspaces/:id/monitor/target-plans`
- `GET /api/workspaces/:id/monitor/target-plans`
- `GET /api/workspaces/:id/monitor/target-plans/:planId`
- `POST /api/workspaces/:id/monitor/target-plans/:planId/adopt`

**验证**：X 卡仅新增双侧类型 + wiki/notes 契约；未注册路由、未接 UI、未改监测引擎。

---

## 十四、行动闭环模拟实验接缝契约（X-DLF0，2026-06-28 总控自做）

**背景**：用户要求在日常/专题/重复模块的「行动闭环 → 模拟实验」中，对分析报告产出的行动策略、活动方案、新品方案、增长方案等，用数字生命体进行模拟预测。典型用例：门店零售活动方案的目标客群接受度、新品概念测款、用户增长方案专家投票。

**首版定位**：
- 模拟实验是**行动前预测 / 方案试压**，不是统计预测模型，不承诺真实市场结果。
- 输入是报告/方案/行动项等衍生产物 + persona 假设；输出是可解释的接受度、反对点、接受条件、修改建议和下一步验证实验。
- 数字生命体首版是 **SubAgentTemplate persona 复用层**：可以选择 subagents 管理中已有模板，也可以手填 manual persona。
- **不启动真实 subagent runner**：不调用 `runSubAgentTurn` / 委派任务，不继承 `toolIds`，不产生子 agent trace。v2 再考虑独立 runner、多轮辩论、历史校准。

**已交付（仅契约，未实现 API/UI）**：
- 双侧 `types.ts` 镜像新增：
  - `SimulationScenario = "consumer_campaign" | "product_concept" | "expert_panel"`
  - `DigitalLifeFormSource = "subagent_template" | "manual_persona"`
  - `SimulationVerdict = "go" | "revise" | "hold" | "reject"`
  - `SimulationStance = "support" | "conditional" | "oppose" | "uncertain"`
  - `DigitalLifeForm{id,name,source,persona,templateId?}`：`templateId` 仅指向 `SubAgentTemplate.id`，只复用 persona。
  - `SimulationRunInput{pathId,relPath?,scenario,model,lifeForms,prompt?,businessContext?}`
  - `SimulationRoleAssessment{lifeFormId,name,stance,score,rationale,acceptanceConditions,objections,evidenceQuotes,suggestions}`
  - `SimulationRunResult{scenario,verdict,overallScore,summary,roleAssessments,risks,recommendedChanges,validationExperiments,artifactPaths?,model}`

**数据红线（下游卡必守）**：
- 允许进入 LLM：`report`、`business_requirements/`、`golden_strategy/`、`actions` 等衍生产物。
- 禁止进入 LLM：`draw_data` 原始行级内容、数据探索模块中的数据内容/列名/字段值/剖析样本、错误日志样本片段。
- `clean_data` 如后续接入，必须另立卡并用户知情；首版不接聚合数据选择器。
- `DigitalLifeForm.persona` 是 prompt 文本，不是执行权限；`SubAgentTemplate.toolIds` 不得进入 simulation API payload，不得被后端解释为工具授权。

**下游分工审定**：
- `E-DLF1`：实现 `POST /api/simulation-lab/run`，只读 report 登记路径；严格 JSON + repair；产物落 `simulation_lab/*.json` 和 `*.md`。
- `V-DLF2`：新增 `SimulationLabPane` 替换 `dlf` placeholder；因 V-agent 已停用，委派 Agent-D 代笔，回流总控终审。
- `D/V-DLF3`：读取 `/api/subagents` 作为数字生命体候选，只取 `id/name/persona`，不展示/不传递 `toolIds`。
- `E-DLF4`：补后端 API 单测 + 数据红线核查，确认不读 `draw_data`、不调 subagent runner。
- `X-DLF5`：补产品说明与 v2 演进路线。

**建议 API 签名（E-DLF1 落地前仍为契约，不代表已实现）**：
- `POST /api/simulation-lab/run`
- body = `SimulationRunInput`
- response = `SimulationRunResult`

**验证**：X-DLF0 仅新增双侧类型 + notes 契约；未注册路由、未接 UI、未改 subagent runner。

**✅ E-DLF1 终审通过（2026-06-28）**：新增 `server/src/simulation-lab.ts` 与 `routes/engine.ts` 端点 `POST /api/simulation-lab/run`。实现读取 report 登记路径文本、构造 DLF persona 模拟 prompt、JSON parse + repair、产物落 `simulation_lab/*.json` 与 `*.md`。总控收口：① 返回值对齐 X-DLF0，为完整 `SimulationRunResult`，`artifactPaths` 嵌入结果；② 路径改走 `readFlowFile/writeFlowFile` + `validateReportRelPath`，禁止 hidden/`..` 段，file path 不接受 `relPath`，返回相对 artifact path，不泄漏本地绝对路径；③ `businessContext` 纳入 prompt，并对 `summary/model/scenario/roleAssessments` 做后端归一化。红线核查：不调用 subagent runner，不继承 `toolIds`，不读 `draw_data`。验证：`npm run typecheck`、`npm run build`、数据探索隔离 grep 全通过。

**✅ V-DLF2 + D/V-DLF3 终审通过（2026-06-28，Agent-D 代笔）**：新增 `SimulationLabPane`，dlf 占位替换为真实工作台；日常/重复/专题均可进入。页面支持报告选择、三类 scenario、subagent template 多选、显示停用模板、手填 persona、模拟重点输入、运行与结构化结果展示。新增 `api.runSimulationLab()`。SubAgentTemplate 只作为 persona 候选：前端只组装 `id/name/persona/source/templateId`，不展示/不传 `toolIds`，UI 明示“仅 persona 模拟 · 不挂载工具 · 不读取 draw_data”。总控收口：专题 dlf scope 改用 `zhuantiChatFolderScope` / `zhuantiChatFlow`，对齐黄金策与行动，避免误扫 workspace 报告。验证：`npm run typecheck`、`npm run build`、数据探索隔离 grep 全通过；grep 确认 `SimulationLabPane` 无 `chat/generate/extract/clarify` 类 API 调用。

**✅ E-DLF4 终审通过（2026-06-28）**：新增 `server/src/simulation-lab.test.ts` 26 个 node:test 用例；`simulation-lab.ts` 抽出 `parseSimulationRunRequest()` / `buildSimulationPrompts()` 纯函数，导出 `validateReportRelPath` / `extractJsonObject` / `normalizeSimulationResult`，并给 `runSimulationLab(input, { runPi? })` 增加 fake runner 注入点。路由改走 `parseSimulationRunRequest()`，避免路由层重复硬编码 enum。测试覆盖：请求 shape 守卫、路径守卫、prompt 不含 `toolIds/templateId`、JSON loose repair、artifact 相对路径落盘、fake runPi 单次调用、源码级 subagent/autonomous runner 黑名单、`folder !== "report"` 守卫。读取范围固定为 report folder 下 `.md/.markdown/.txt`；禁止 `draw_data` / `clean_data` / `knowledge`、非文本报告、hidden/`..` 段、`toolIds/templateId` 入 prompt。验证：`node --experimental-strip-types --test server/src/simulation-lab.test.ts` 26/26、`npm run typecheck`、`npm run build`、数据探索隔离 grep 全通过。

**✅ X-DLF5 专题收尾（2026-06-28）**：模拟实验首版产品说明已定稿。目的：在行动闭环执行前，对报告产出的策略、活动方案、新品方案、增长方案做“方案试压”，输出可解释的接受度、反对点、接受条件、风险、修改建议和下一步验证实验。使用方式：在日常/重复/专题的 `dlf` 子 tab 选择一份 report 文本，选择 `consumer_campaign` / `product_concept` / `expert_panel` 场景，从 subagents 管理中选择 persona 模板或手填 manual persona，补充模拟重点后运行；结果落到报告同目录 `simulation_lab/*.json` 与 `*.md`，供后续行动方案修订与人工复核。典型示例：① 门店零售活动方案用目标客群 persona 检查利益点、门槛和活动方式是否可接受；② 新品开发方案用消费者生命体测款，找购买阻碍、接受条件和需验证假设；③ 用户增长方案用专家阵容模拟投票，指出增长逻辑漏洞、执行风险和优化建议。

**注意事项 / 边界**：模拟实验不是统计预测模型，不输出真实市场销量、转化率或财务承诺；结论只代表“基于当前报告文本与 persona 假设的 LLM 推演”。首版 DLF 只复用 `SubAgentTemplate.persona`，不继承 `toolIds`，不启动真实 subagent runner，不读取 `draw_data`、数据探索样本、`clean_data` 或 `knowledge`。如用户需要把聚合数据纳入判断，必须另立卡并在 UI 明示 clean_data 知情使用。

**v2 演进路线**：① 生命体独立 runner：每个 DLF 可独立上下文、多轮记忆和 trace，但必须重新设计权限，不得默认继承 subagent 工具；② 多轮辩论 / 交叉质询：支持消费者互评、专家 challenge、主持人归纳，输出分歧与收敛条件；③ 历史模拟库：保存不同方案、persona、模型和结果，支持横向对比与复盘；④ 执行反馈校准：将真实行动反馈、A/B test、复盘结论沉淀为校准集，用于修正 persona 和评估口径；⑤ clean_data 聚合接入：只允许用户知情选择聚合指标，禁止原始行级内容进入 LLM。

---

## 十五、tool-use 治理中枢契约（X-TOOLUSE0，2026-06-30 总控自做）

**定位**：tool-use 是 pi-xanthil 的受控计算能力层，承载数据摄取工具、数据分析 Python 固化代码、MCP/Chat/command/subagent/workflow/eval 的计算能力引用。它不是单一工具列表页；治理重点是注册源、执行网关、暴露策略、运行证据与质量闭环统一。

**单一真源与网关**：
- 工具唯一注册源：`server/tools/<id>/tool.json`，由 `server/tools/registry.ts` 实时扫盘加载；不要在 Chat、MCP、command、subagent、workflow 里复制工具 schema。
- 工具唯一执行网关：`POST /api/extraction-tools/:id/run`。人工、Chat `@工具`、MCP、command、subagent、workflow、eval 的真实执行最终都必须回到这个端点。
- AI/MCP 路径必须带 `source:"ai"`。`source` 是来源标记，不是授权本体；授权裁决仍由 manifest 分类、调用方候选过滤、row guard、工具输出契约共同完成。

**manifest v2 最小口径**：
- 已审定字段：`category?: "ingestion" | "analysis"`、`tags?: string[]`、`riskLevel?: "L0"|"L1"|"L2"|"L3"`、`allowedUse?`、`forbiddenUse?`、`failureHandling?`、`input`、`output`、`parameters?`、`resultColumns?`、`metricHints?`。
- `category` 缺省或非法值一律归一为 `ingestion`，保守不暴露给 AI。
- `tags` 只用于搜索、筛选、治理和候选理解，不代表权限；加载时 trim、去重、过滤空字符串。数据分析 Python 工具建议至少包含 `python-analysis`，并补业务域/任务/算法标签，如 `membership`、`retention`、`rfm`、`forecast`。
- 预留但本轮不实现：`owner`、`deprecated`、`replacementToolId`、`aiExposure`、`outputContract`。这些字段需要另立卡，不要由 D/E/V 私自扩展语义。

**工具分类与能力矩阵**：

| 能力入口 | 暴露规则 | 执行规则 |
|---|---|---|
| manual | ingestion / analysis 均可人工运行 | 仍走 `/api/extraction-tools/:id/run` |
| AI / MCP | 仅 `analysis` | MCP `tools/list` 过滤；`tools/call` 走 `/run source=ai` |
| Chat `@工具` | 仅 `analysis` | 前端装配，后端网关执行 |
| command | 只绑定 `analysis toolIds` | 不自动绕过用户确认；可预填 `@工具` 卡 |
| subagent | 只进入 template `toolIds` 白名单 | scoped MCP allowlist 仍只按白名单注入 |
| workflow | 只保存 `toolId + params` | 不复制工具描述或参数 schema |
| eval / ToolLab | 复用 `tests/cases.json` | 可用于准入、回归、失败样本候选 |

**当前实现基线（2026-06-30 X-TOOLUSE6 终审核实）**：
- `registry.ts` 已支持 `tags`、`category`、`metricHints` 归一化，且 `listExtractionTools()` / `getExtractionTool()` 每次实时 `loadTools()`，新增/删除工具后刷新即可生效。
- `server/src/tool-policy.ts` 统一 server 侧 analysis 暴露策略；MCP tools/list 与 tools/call、command coerce、subagent server coerce 均复用或对齐该口径。
- `ToolUsePane` 已具备 tags/search/filter、risk/category 筛选、跨模块能力矩阵、test cases 读取和运行台账视图；`ToolLab` 已接 category/risk/tags/query 过滤、cases/eval 状态与 policy 缺失提示。
- 运行看板当前基于 `trace_events(target_kind='extraction_tool', type='tool_run')` 的脱敏字段生成 `ToolRunRecord`，不是独立 `tool_runs` 表；payload 记录 basename、路径分类、artifact basename、计数、耗时、caller/source/status、rowGuard、metricSnapshotsCount、errorCode 等 metadata，不保存绝对输入路径、文件正文、样本行或 SQL 明细。
- `/run` 已接 row guard 与 `MetricSnapshot` 数字锁；Chat/MCP 路径经 `source:"ai"` 触发 AI 行级输出守卫与 MetricVerification 后续链路。

**安全红线**：
- 数据探索模块（`DataExplorationPane.tsx` 及其子树）永久禁止接 LLM/tool-use 自动调用；相关改动必须跑 AGENTS.md 中的数据探索隔离 grep。
- `ingestion` 工具永不进入 AI/MCP/command/subagent/workflow 自动候选；只允许人工摄取路径。
- `analysis` 工具可以经 `source:"ai"` 处理已登记数据路径，但产物必须是聚合/衍生结果，不得包含 draw_data 原始行级明细、客户明细、订单样本、错误日志样本片段。
- run ledger / trace / eval case 沉淀只记录元数据、artifact 路径和脱敏摘要，不保存文件正文、样本行或原始 SQL 结果明细。
- 前端只负责展示和装配，不承担安全裁决；安全裁决集中在 registry 分类、后端网关、MCP 过滤、row guard 与工具输出契约。

**后续卡边界**：
- **D-TOOLUSE1**：完善 tags/SOP 与现有 analysis 工具标签，不改网关语义。
- **E-TOOLUSE2**：统一 Tool Run Ledger；可先复用 trace_events，也可提出 `tool_runs` schema 给总控审。
- **V-TOOLUSE3**：完善 ToolUsePane 治理视图与运行台账筛选，不自行扩大 AI 暴露规则。
- **E-TOOLUSE4**：MCP/command/subagent/workflow 统一从 manifest 派生候选和参数说明。
- **E-TOOLUSE5**：ToolLab 准入、cases 回归、失败 run 转候选 case；不得复制原始数据内容。
- **X-TOOLUSE6**：全链验收、安全红线、wiki/notes 收口。
