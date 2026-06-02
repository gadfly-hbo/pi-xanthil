# Handoff Log — 苍耳 pi-Xanthil（数据分析 AI 工作台）

---

## 📌 Session 12（探索模块最新） — 2026-06-02

### 0. 本次更新摘要（Changelog）

**本次推进**: 探索模块从“原始 pi 对话壳”升级为面向数据分析任务的工作台：统一输出目录治理、成果中心、对话降噪、对话沉淀工作流、session 级上下文可观测与手动 compact，并修复 compact 被 RPC EOF 提前中止的问题。

1）**默认 model 固定为 MiniMax-M3** ✅ — 探索 composer 默认优先选择 `minimax-cn/MiniMax-M3`；不存在时才回退到 pi 配置默认或模型列表首项。长报告流式中断提示也明确建议切换到 MiniMax-M3。

2）**统一内容输出路径规则** ✅ — 所有 agent 与对话生成内容统一遵循：
   - 优先写入当前 scope（session / flow）在「报告输出」tab 登记的路径；
   - 未登记报告路径时，写入最近加载的聚合数据源所在目录；
   - 再无聚合数据路径时，才回退当前工作目录；
   - 原始数据路径不会注入 LLM context。
   后端集中实现于 `server/src/output-paths.ts`，每轮探索对话、flow 对话、单/多节点执行都复用 `buildRegisteredPathContext()`。

3）**「报告输出」路径警示** ✅ — 子 tab 未登记报告路径时持续显示琥珀色警示图标；添加路径后消失。`FolderPathsPane` 文案同步说明未配置时的 fallback 策略。

4）**探索对话可沉淀为工作流** ✅ — 工作视图顶部新增「沉淀为工作流」。任务完成后可选择“最近一次任务”或“完整对话”，服务端创建 multi flow，并通过 workflow compiler 将方法、步骤、判断规则和输出格式提炼为参数化 `workflow.json` + `README.md`。硬约束：不得复制本机绝对路径；输入统一使用 `{{input.data_path}}`，报告目录统一使用 `{{input.report_dir}}`。

5）**工作视图降噪** ✅ — 默认业务视图只显示用户消息、agent 纯文本答复和错误；`thinking`、`tool_use`、`tool_result` 仍完整保存在 SQLite，但折叠到「查看执行详情」中，避免套壳产品把 agent 内部执行过程当成主界面。

6）**右侧「产物预览」改为「成果」** ✅ — 不再镜像最后一条 assistant 正文。现在展示：
   - 任务状态、成果根目录、文件数；
   - 未配置报告目录时的 fallback 警示；
   - 最新结论摘要；
   - 当前输出目录内的报告、表格、图表文件树；
   - 点击文件后 Markdown / 文本预览；
   - 运行中每 4s 刷新，run 完成后立即刷新。
   服务端成果文件 API 强制限制在解析后的输出根目录内，拒绝 `../`、隐藏路径和内部 `flows` 路径。

7）**上下文治理** ✅ — 保留原有 `pi -p --mode json --session-id` 单轮执行模型，同时新增短生命周期 RPC 控制通道：
   - `get_session_stats` 查询权威 `contextUsage.tokens/contextWindow/percent`；
   - `compact` 手动整理上下文；
   - JSON 流继续监听 pi 原生 `compaction_start` / `compaction_end` 自动整理事件；
   - SQLite 新增 `session_runtime`，持久化状态、context 占用、compact 次数、最近整理时间和错误；
   - UI 展示上下文占用、整理按钮和重新检测按钮；
   - session turn、stats 查询、compact 共用控制锁，避免多个 pi 进程同时操作同一 session。

8）**compact EOF bug 修复** ✅ — 初版 RPC client 使用 `child.stdin.end(command)`，但 pi RPC 把 stdin EOF 视为 shutdown；`get_session_stats` 较快通常成功，耗时 compact 会被提前中止并返回 `Compaction cancelled`。现改为 `stdin.write(command)`，等待响应后才关闭控制通道。`Compaction cancelled`、`Nothing to compact`、`Already compacted` 同时降级为正常 no-op，不再污染 runtime 为 error。

9）**token / cache 统计补充** ✅ — SQLite 新增 `session_token_stats`，服务端暴露 session / workspace token stats；顶部显示累计 token、累计成本和 provider cache 命中率 `cacheRead / (input + cacheRead + cacheWrite)`。注意：累计 token 与当前 context 占用是两个不同指标。

**验证结果**:
- `npm run typecheck` ✅
- `npm run build` ✅（仅保留 Vite bundle 超过 500 kB 的 warning）
- `git diff --check` ✅
- 输出目录策略 smoke test ✅：未配置报告路径时落到最近聚合数据源目录，配置后切换到报告目录。
- 成果路径安全 smoke test ✅：`../etc/passwd` 与 `.pi-sessions/*` 均返回 400。
- RPC stats smoke test ✅：本机 pi 返回真实 `contextWindow` 与 `contextUsage.percent`。
- 延迟 RPC smoke test ✅：模拟 300ms 响应时可正常等待，不再被 EOF 中止。
- compact no-op smoke test ✅：返回 `compacted:false` 和“当前上下文较短，暂无可整理的历史内容”，runtime 保持 `idle`、`lastError=null`。
- runtime refresh smoke test ✅：模拟历史 error 后重新检测，状态恢复 `idle` 并清除旧错误。

### 1. 当前架构快照

```text
探索工作视图
├── 中央：任务对话（业务消息默认可见，执行详情折叠）
├── 顶栏：上下文占用 / 重新检测 / 整理上下文 / 沉淀为工作流
└── 右栏：成果（摘要 + 输出目录 + 受限文件树 + 文件预览）

Node BFF
├── turn：pi -p --mode json --session-id <sessionId>
├── control：pi --mode rpc --session-id <sessionId>
│   ├── get_session_stats
│   └── compact
├── SQLite：messages / session_runtime / session_token_stats / workspace_paths
└── output policy：报告路径 > 最近聚合数据源目录 > 当前工作目录 fallback
```

### 2. 关键文件

| 文件 | 作用 |
|---|---|
| `server/src/output-paths.ts` | 统一解析输出根目录，构造所有 agent 复用的输出路径 prompt |
| `server/src/pi-adapter.ts` | JSON turn runner + 短生命周期 RPC 控制通道；注意 RPC stdin 不得提前 EOF |
| `server/src/index.ts` | runtime / compact / token-stats / artifacts / promote-to-flow API；session 控制锁 |
| `server/src/db.ts` | `session_runtime`、`session_token_stats`、scoped `workspace_paths` 持久化 |
| `server/src/cache.ts` | token usage 累积与 cache hit rate 聚合 |
| `web/src/components/ChatPane.tsx` | 业务对话投影、执行详情折叠、context 工具栏 |
| `web/src/components/PreviewPane.tsx` | 右侧成果中心 |
| `web/src/components/FolderPathsPane.tsx` | 原始数据 / 聚合数据 / 报告输出路径登记 |
| `web/src/App.tsx` | 探索页 orchestration、runtime 刷新、compact 操作、工作流沉淀弹窗 |

### 3. 关键决策与边界 ⭐

**决策 10: 保留 JSON turn runner，只用短生命周期 RPC 做控制面**
- 选择: turn 继续使用 `-p --mode json`；stats 与 compact 使用独立 RPC 进程。
- 理由: 先获得 context 可观测与手动整理能力，不一次性重写成熟的 turn 执行链。
- 约束: RPC stdin 必须保持开启直到响应返回；session 控制锁必须覆盖 turn / stats / compact。

**决策 11: 原始消息完整保存，默认 UI 只做业务投影**
- 选择: SQLite 保留 user / assistant / tool content blocks；UI 默认隐藏 trace。
- 理由: 用户无需阅读 agent 思考过程，但排错仍需原始证据。
- 边界: 当前纯文本 assistant 回复直接显示；后续可进一步识别“澄清问题 / 最终摘要 / 状态事件”并使用结构化卡片。

**决策 12: 成果中心按受限输出根目录读取，不扫描任意文件系统**
- 选择: 右栏成果 API 复用统一 output policy，并以 `safeResolve()` 阻断路径逃逸。
- 理由: 去除重复正文，同时避免预览接口成为任意本机文件读取入口。
- 边界: 该限制仅作用于 Xanthil 成果预览 API，不等价于约束外部 pi 内置工具。

**决策 13: compact no-op 不是错误**
- 选择: `Compaction cancelled`、`Nothing to compact`、`Already compacted` 返回 `compacted:false` 和用户提示。
- 理由: 短会话、已经整理过的会话或无可压缩历史都属于正常状态。
- 注意: 真正 provider / RPC / session 文件错误仍返回 500，并显示“上下文维护失败”。

### 4. 已知问题与下一步（Action Items）

- [ ] **接入 tool 级文件权限扩展或 OS sandbox** — P0 安全加固
  - 当前状态: prompt 已禁止原始数据访问，成果预览 API 已限制根目录，但 pi 内置 `read/bash/edit/write` 仍运行在宿主权限下。
  - 可选方案: 使用 pi `tool_call` extension 对路径和 bash 命令 fail-closed；更强方案是引入可信 sandbox runtime。
  - 完成标准: 原始数据目录无法被 pi 工具读取；写操作只能落在解析后的报告输出目录；bash 受到命令与 cwd 限制。
  - 注意: 这涉及安全策略和潜在新增依赖，实施前需单独审阅。

- [ ] **用真实长 session 验证成功 compact** — P1
  - 当前已验证: RPC 延迟等待、stats 查询、no-op 映射和 refresh 清错。
  - 未验证: 使用真实 provider 对足够长历史生成 summary 后，contextPercent 实际下降。
  - 完成标准: compact 返回 `compacted:true`，`compactCount + 1`，后续对话能继承目标、路径、结论和待办。

- [ ] **成果中心继续结构化** — P1
  - 当前状态: 文件树 + 摘要 + 文本 / Markdown 预览已可用。
  - 下一步: 增加 artifact metadata、表格专用预览、图表预览、文件更新时间与来源 turn。

- [ ] **业务消息投影继续细化** — P2
  - 当前状态: 默认隐藏 tool / thinking，保留纯文本回复。
  - 下一步: 结构化区分 agent 澄清问题、阶段状态、最终摘要和错误，进一步减少长报告正文占据中央对话。

- [ ] **流式增量渲染** — P2
  - 当前状态: `message_update` delta 已观测，但探索页仍主要按 `message_end` 追加。
  - 完成标准: assistant 文本逐块出现，且不重复持久化。

### 5. 开放问题

- ❓ **tool 级安全策略**
  - 是否仅限制原始数据目录，还是默认 deny、只允许登记的聚合数据读取路径和报告写入路径？
  - 建议: 默认 deny + allowlist，避免 prompt injection 绕过。

- ❓ **成果中心优先展示规则**
  - 当前展示输出根目录完整文件树。
  - 待确认: 是否默认只展示本次 turn 新增 / 修改产物，并将历史文件折叠。

- ❓ **context 自动整理阈值**
  - pi 自带 auto-compaction，默认阈值由 pi settings 管理。
  - 待确认: Xanthil 是否在 contextPercent 达到 80% 时主动提示，或在发送前自动执行 compact。

### 6. 重要陷阱

- `pi --mode rpc` 的 stdin EOF 会触发 shutdown。耗时命令必须使用 `stdin.write()` 并等待 response 后再 `end()`。
- 累计 token、provider cache 命中率、当前 contextPercent 是三个不同指标，UI 和文案不可混用。
- compact no-op 不应标记为 runtime error。
- 原始数据路径禁止注入 LLM context；`draw_data` 仅供本地工具处理。
- Xanthil 成果预览目录限制不等于 pi tool 权限限制。
- 工作区已有大量并行开发改动；不要回滚未确认的 dirty worktree 内容。

### 7. 下一个 Session 启动指令

> 先读本 Session 的「本次更新摘要」「已知问题与下一步」「重要陷阱」，再运行 `npm run typecheck` 和 `npm run build` 确认现状。
> 探索模块下一优先级是：**审阅并落地 tool 级文件权限策略**。优先采用默认 deny + allowlist：只允许读取登记的聚合数据路径，只允许写入统一解析后的报告输出目录；bash 需要额外约束。
> compact 继续调试时，务必使用足够长的真实 session，并区分 `compacted:true` 与正常 no-op。
> 工作流模块的详细演进记录见 `handoff-工作流.md`；缓存命中专题见 `handoff-缓存命中.md`。

---

## 📌 Session 2 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 诊断并解决了 P0 阻塞——pi 默认 model 报 400 的根因，新增了 UI 端的模型选择器，用户现在可直接在 composer 下拉选择可用模型，对话首次跑通。
- **关键决策**: ①不修改 pi 全局配置，而是在每轮 spawn 时通过 `--model provider/id` 注入所选 model（无副作用，与全局 pi 设置隔离）；②`GET /api/models` 直接读 `~/.pi/agent/settings.json` 的 `enabledModels` 列表，不解析 `pi --list-models` 文本表（更稳定）。
- **已解决阻塞**: `volcengine-plan` 全系 model 不支持 pi 发出的 `developer` role → 改用 `openai-codex` 或 `minimax-cn` 的 model 即可跑通。
- **下一步重点**: Phase 2 数据分析实体（文件上传 + ECharts + TanStack 数据网格 + Excel 预览）；先确认图表库选型（ECharts）。

### 1. 项目元信息

```
Session 编号: 第 2 次交接
本次 Session 起止: P0 model 诊断 + 模型选择器 UI
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
```

### 2. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 项目脚手架（npm workspaces） | ✅完成 | 根 `package.json`，`server/` + `web/` | `npm run dev` 同起两端 |
| Node BFF（Express+ws+sqlite） | ✅完成 | `server/src/{index,db,config,pi-adapter,types}.ts` | gateway :8787 |
| pi 适配器（spawn+NDJSON） | ✅完成 | `server/src/pi-adapter.ts` | 已实测事件流贯通 |
| 工作区/会话 CRUD | ✅完成 | REST + `web/src/lib/api.ts` | 增删改查均实测 |
| 会话持久化（user/assistant/tool） | ✅完成 | `server/src/db.ts` | `node:sqlite` |
| 前端三栏布局 + PilotDeck 视觉 | ✅完成 | `web/src/components/*` | zinc/neutral 设计系统 |
| **模型选择器** | **✅完成** | `web/src/components/ChatPane.tsx` | 按 provider 分组下拉；默认选 list[0] |
| **GET /api/models** | **✅完成** | `server/src/index.ts` | 读 `~/.pi/agent/settings.json` |
| **P0 model 修复** | **✅完成** | — | 改用 minimax-cn/openai-codex，对话已跑通 |
| ProcessTrace 工具调用渲染 | 🚧待验证 | `web/src/components/ProcessTrace.tsx` | 防御式实现，需触发真实 tool_use 观测 |
| 明暗主题/复制/侧栏拖拽/重命名删除 | ✅完成 | `Sidebar.tsx` `lib/theme.ts` | 实测通过 |
| 流式增量渲染 | ⏳待启动 | — | `-p` 模式观测到 `message_update` 事件，含 delta |
| Phase 2 数据实体（上传/图表/表格/Excel） | ⏳待启动 | tab 已占位 | 见 Action Items |

### 3. 关键决策与权衡 ⭐

**决策 5: spawn 时注入 `--model`，不修 pi 全局配置**
- 选择: 每轮 `runPiTurn()` 将 UI 选中的 `provider/modelId` 传为 `--model` 参数。
- 备选: 改写 `~/.pi/agent/settings.json` 的 `defaultModel`（被否决）。
- 理由: 全局配置改动影响用户日常 pi 使用；spawn 注入无副作用，scope 仅限 Xanthil。
- 影响范围: `server/src/pi-adapter.ts`（已有 `model?` 参数），`server/src/index.ts`（ws send 透传）。
- 可逆性: 高。

**决策 6: `/api/models` 读 `settings.json`，不解析 `pi --list-models` 文本输出**
- 选择: 直接 `readFileSync(~/.pi/agent/settings.json)` 取 `enabledModels` 列表。
- 备选: 解析 `pi --list-models` 文本表（被否决）。
- 理由: 文本表格格式脆弱、依赖 pi 版本；`settings.json` 结构固定、无网络调用。
- 影响范围: `server/src/index.ts` 加 3 个 import + 25 行 endpoint。
- 可逆性: 高。

### 4. pi model 诊断结论（⭐ 重要存档）

**根因**: pi 内部将 system prompt 发送为 `role:"developer"`（OpenAI Responses API 格式），而 `volcengine-plan` 的 Volces API 仅支持 `system/user/assistant/tool`，遂报：
```
400 The parameter `messages.role` specified in the request are not valid: invalid value: `developer`
```

**受影响 provider**: `volcengine-plan`（deepseek-v4-flash、deepseek-v4-pro、glm-5.1、kimi-k2.6）——这是 pi 侧 bug，非本项目可修。

**可用 provider**（已实测）:
- `openai-codex/gpt-5.4-mini` ✅（OAuth，`api:"openai-codex-responses"`）
- `minimax-cn/MiniMax-M2.7` ✅（API Key，`api:"anthropic-messages"`）

**处理策略**: UI 下拉默认选中 `enabledModels[0]`（当前为 `minimax-cn/MiniMax-M2.7`），每轮对话都通过 `--model` 显式指定，绕过 pi 全局默认。

### 5. 技术/方案细节快照（增量，与 Session 1 合并阅读）

**新增文件/关键改动**
- `server/src/index.ts:1-3` — 新增 `readFileSync`、`homedir`、`join` import。
- `server/src/index.ts:29-54` — `GET /api/models` endpoint，读 `~/.pi/agent/settings.json`，返回 `{id,provider,model,isDefault}[]`。
- `web/src/types.ts:3-8` — 新增 `PiModel` interface（`id/provider/model/isDefault`）。
- `web/src/lib/api.ts` — 新增 `listModels(): Promise<PiModel[]>`。
- `web/src/App.tsx` — bootstrap 时并发加载 models，预选 `list[0].id`；传 `models` prop 给 `ChatPane`。
- `web/src/components/ChatPane.tsx` — 新增 `ModelSelect` 子组件（provider `<optgroup>` 分组 `<select>`），有 models 时替换原自由文本 input；无 models 时降级显示 "加载中…" input。

**`pi --list-models` 实测可用模型（2026-05-30）**
```
provider         model                   thinking  images
minimax-cn       MiniMax-M2.7            yes       no    ✅
minimax-cn       MiniMax-M2.7-highspeed  yes       no    (未测)
openai-codex     gpt-5.2                 yes       yes   (未测)
openai-codex     gpt-5.3-codex           yes       yes   (未测)
openai-codex     gpt-5.4-mini            yes       yes   ✅
openai-codex     gpt-5.5                 yes       yes   (未测)
volcengine-plan  deepseek-v4-flash       yes       no    ❌ developer role
volcengine-plan  deepseek-v4-pro         yes       no    ❌ developer role
volcengine-plan  glm-5.1                 no        no    ❌ developer role（推测）
volcengine-plan  kimi-k2.6               no        yes   ❌ developer role（推测）
```

**观测到新事件类型**（Session 2 实测，补充 Session 1 事件清单）
- `message_update`：pi 在 `-p` 模式下也会吐 delta 事件（含 `assistantMessageEvent.type:"text_delta"` 和 `"text_end"`），可用于流式渲染。结构：`{type:"message_update", assistantMessageEvent:{type:"text_delta"|"text_end", contentIndex, delta?, content?}, message:{...}}`。

### 6. 未完成事项与下一步（Action Items）

- [x] ~~**修复 pi 侧以跑通真实对话**~~ — P0 ✅ 已解决
- [ ] **验证 ProcessTrace 真实 tool_use 渲染** — P0（次优先）
  - 上下文: ProcessTrace 防御式实现未经真实数据验证；现在 model 可用，触发一个带工具调用的任务即可观测。
  - 完成标准: `tool_use`（工具名+输入参数）和 `tool_result`（输出/is_error）均正确渲染。
  - 步骤: 发一个会触发文件读写的任务（如"列出当前目录文件"），观测 `message_end` 的 content blocks 实际结构，按需微调 `ProcessTrace.tsx`。
- [ ] **Phase 2：文件上传 + 数据网格 + 图表 + Excel 预览** — P1
  - 上下文: 数据分析工作台核心价值在右侧预览区；当前 tab（文件/数据表/仪表盘）是占位。
  - 输入: react-dropzone + multer（升 2.x）；ECharts（待用户确认）；TanStack Table；SheetJS(xlsx)。
  - 完成标准: 能拖拽上传 Excel/CSV 到工作区、在数据表 tab 预览、在仪表盘 tab 出图。
- [ ] **流式增量渲染** — P2
  - 上下文: Session 2 实测确认 `-p` 模式也会吐 `message_update` delta 事件，可直接做流式。
  - 完成标准: assistant 文本逐块出现（接 `text_delta` 事件叠加到当前 message）。
- [ ] **composer 工具栏扩展**（thinking 级别下拉 + CircleGauge 用量）— P2

### 7. 开放问题与待确认事项

- ❓ **Phase 2 图表库选型 ECharts vs Recharts**
  - 当前倾向: ECharts（中文生态、报表能力强）。
  - 需要: 用户确认后开始实现。
- ❓ **volcengine-plan 的 `developer` role 问题是否有解**
  - 如 pi 后续版本修复了该 bug，volcengine 系 model 即可正常使用；届时无需 Xanthil 侧改动（spawn 已透传 `--model`）。

### 8. 上下文与约定

- 用户偏好（全局 CLAUDE.md）: 中文回答、代码英文、最小改动、先思考后动手、删除/覆盖前确认、证据优先（先读再改）。
- 项目记忆已落盘: `~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/pi-xanthil-overview.md`。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」与「未完成事项」两节，并跑 `npm run dev`（gateway:8787 + web:5173）确认现状。
> 最紧迫任务：**验证 ProcessTrace 真实 tool_use 渲染**——在 UI 中选 minimax-cn/MiniMax-M2.7 或 openai-codex 任意 model，发一个会触发工具调用的任务，观测 content blocks 实际结构，按需微调 `ProcessTrace.tsx`。
> 然后与用户确认图表库选型（倾向 ECharts），再开始 Phase 2。
> 注意陷阱（沿用）：①判别联合的开放成员会破坏类型收窄，用 `as Extract` 处理；②`node:sqlite` 返回需 `as unknown as T`。

---

## 📌 Session 1 — 2026-05-30

### 0. 本次更新摘要（Changelog）

- **本次推进**: 从零搭建并端到端验证了 `pi` cli 套壳的数据分析 Web 工作台骨架（Phase 0–1），随后按 PilotDeck 真实 UI 源码做了高保真视觉重写。
- **关键决策**: ①每轮 `spawn pi -p --mode json --session-id` 而非常驻 rpc 进程；②用 Node 内置 `node:sqlite` 规避 better-sqlite3 原生编译坑；③借鉴而非 fork PilotDeck（AGPL），用同栈干净重写。
- **新增阻塞/问题**: 本机 `pi` 默认 model（`volcengine-plan/deepseek-v4-flash`）报 400、扩展 `ptk-memory-inject` 的 better-sqlite3 版本不匹配——导致**无法跑通真实对话**，因此 ProcessTrace 工具调用渲染仅类型层验证、未见真实数据。
- **下一步重点**: ①修复 pi 侧 model/扩展以跑通真实对话；②Phase 2 数据分析实体（文件上传 + ECharts + TanStack 数据网格 + Excel 预览）。

### 1. 项目元信息

```
项目名称: 苍耳 pi-Xanthil
项目类型: 代码开发（Web 前端 + Node BFF，套壳 pi cli）
Session 编号: 第 1 次交接
本次 Session 起止: 从「空目录 + 一份产品理念草稿」推进到「可运行的工作台骨架 + PilotDeck 风格 UI + 会话/工作区 CRUD」
最后更新: 2026-05-30
工作目录: /Users/huangbo/Dev/Projects/pi-xanthil（非 git 仓库）
```

### 2. 项目目标（North Star）

- **一句话目标**: 把本地 `pi` cli 包成一个以 WorkSpace 为单位组织的数据分析 AI 工作台 Web 应用。
- **成功标准**:
  1. 浏览器内创建工作区/会话，与 pi 多轮对话，流式看到任务过程与产物。
  2. 右侧预览区能渲染报告 / 图表 / 数据表（Excel、CSV、Markdown）。
  3. 数据隔离按工作区组织，会话可持久化、可回看。
- **明确的非目标**: 不 fork/分发 PilotDeck 代码（AGPL）；当前不做多用户鉴权（本地单人工具）；不替 pi 重新实现 agent 逻辑。

### 3. 当前进度全景

| 模块/任务 | 状态 | 关键产出/位置 | 备注 |
|---|---|---|---|
| 项目脚手架（npm workspaces） | ✅完成 | 根 `package.json`，`server/` + `web/` | `npm run dev` 同起两端 |
| Node BFF（Express+ws+sqlite） | ✅完成 | `server/src/{index,db,config,pi-adapter,types}.ts` | gateway :8787 |
| pi 适配器（spawn+NDJSON） | ✅完成 | `server/src/pi-adapter.ts` | 已实测事件流贯通 |
| 工作区/会话 CRUD | ✅完成 | REST + `web/src/lib/api.ts` | 增删改查均实测 |
| 会话持久化（user/assistant/tool） | ✅完成 | `server/src/db.ts` | `node:sqlite` |
| 前端三栏布局 + PilotDeck 视觉 | ✅完成 | `web/src/components/*` | zinc/neutral 设计系统 |
| ProcessTrace 工具调用渲染 | 🚧进行中 | `web/src/components/ProcessTrace.tsx` | 防御式实现，**未见真实数据** |
| 明暗主题/复制/侧栏拖拽/重命名删除 | ✅完成 | `Sidebar.tsx` `lib/theme.ts` | 实测通过 |
| 流式增量渲染 | ⏳待启动 | — | 需先跑通 pi model 观察 delta 事件 |
| Phase 2 数据实体（上传/图表/表格/Excel） | ⏳待启动 | tab 已占位 | 见 Action Items |
| 跑通真实对话 | ⚠️阻塞 | — | pi 侧 model/扩展问题 |

### 4. 关键决策与权衡 ⭐

**决策 1: 每轮 `spawn` + `--session-id`，而非常驻 rpc 进程**
- 选择: 用户每次发言执行一次 `pi -p --mode json --session-id <我方sessionId> --session-dir <工作区>/.pi-sessions`，由 pi 自身持久化会话。
- 备选: `pi --mode rpc` 常驻双向进程（被否决）。
- 理由: 服务端无状态、最简、最稳；会话连续性交给 pi。rpc 协议未知、需维护长连接生命周期。
- 影响范围: server 不需进程池管理；多轮上下文依赖 pi 的 session 文件。
- 可逆性: 中（未来要真流式可切 rpc）。

**决策 2: 用 Node 内置 `node:sqlite`，不用 better-sqlite3**
- 选择: `node:sqlite`（Node 22+ 内置）。
- 备选: better-sqlite3（被否决）。
- 理由: 本机 Node 26（NODE_MODULE_VERSION 147）下 better-sqlite3 需重编译；用户的 pi 扩展正因此报错。内置模块零编译、免疫该坑。
- 影响范围: `db.ts` 用 `DatabaseSync`；`.all()/.get()` 返回 `Record`，需 `as unknown as T` 转换。
- 可逆性: 中。

**决策 3: 借鉴 PilotDeck，不 fork（AGPL 规避）**
- 选择: 读其 `ui/` 源码提取设计系统（zinc/neutral 令牌、布局、组件类名），用同栈（React18+Vite7+Tailwind3.4+Radix/shadcn 模式）干净重写。
- 备选: 整仓复制 UI（被否决）。
- 理由: PilotDeck 是 AGPL-3.0，复制并部署为网络服务义务重；底层库均 MIT，重写产物可保持私有。
- 影响范围: 所有 UI 自写；视觉对齐其真实 token（见第 5 节）。
- 可逆性: 低（已成既定路线）。

**决策 4: 消息模型用 pi content blocks，而非纯文本 [修正 Session 内早期实现]**
- 选择: 端到端保留 pi 的 content blocks（text/tool_use/tool_result/thinking），server 持久化 user/assistant/**tool** 全角色。
- 推翻原因: 初版把消息拍平成纯文本，无法渲染工具调用过程（ProcessTrace）。
- 影响范围: `MessageRow.tsx` 按块渲染；server `index.ts` 改为按 `role` 持久化（跳过 pi 的 user 回显避免与 send 时持久化重复）。
- 可逆性: 中。

### 5. 技术/方案细节快照

**架构**
```
浏览器(React18+Vite7+Tailwind3.4+Radix) ──WS(/ws)+HTTP(/api)──> Node BFF(Express+ws+node:sqlite)
                                                                      │ 每轮 spawn
                                                              pi 0.77 (-p --mode json)
数据根: ~/.pi-xanthil/（XANTHIL_DATA_DIR 可覆盖）；每工作区: <root>/workspaces/<id>/{files,.pi-sessions}
```

**pi `--mode json` 事件（实测，NDJSON）**: `session{id,cwd}` → `agent_start` → `turn_start` → `message_start{message}` → `message_end{message}` → `turn_end` → `agent_end`。assistant 消息带 `usage{input,output,totalTokens,cost{total,...}}`、`model/provider`、`errorMessage`。适配器对非 JSON 行（扩展报错）静默忽略，stderr 转 `{type:"stderr"}` 事件。

**关键文件**
- `server/src/pi-adapter.ts`: `runPiTurn()` spawn + readline 逐行解析。
- `server/src/index.ts`: REST（workspaces/sessions CRUD + messages history）+ ws gateway（`send` → spawn → 转发事件 + 持久化）。
- `server/src/db.ts`: schema `workspaces/sessions/messages`；删工作区只清 DB 行，**磁盘文件保留**。
- `web/src/index.css` + `tailwind.config.js`: PilotDeck **zinc/neutral 令牌**（hue 0、饱和 0%；如 dark `--background:0 0% 4%`、`--border:0 0% 15%`、`--radius:0.5rem`），InterVariable 字体，`@tailwindcss/typography`。
- `web/src/components/`: `Sidebar`（项目中心、可拖拽宽度、hover 重命名/删除、主题切换）、`MainHeader`（h-12 面包屑 + 标签条 对话/文件/数据表/仪表盘）、`ChatPane`（消息列 + composer）、`MessageRow` + `ProcessTrace`（content blocks 渲染）、`PreviewPane`（右侧产物预览，可折叠）。

**视觉签名（务必沿用）**: lucide 图标统一 `strokeWidth={1.75}`；小密排版 11/12.5/13/14px；用户消息=右侧 `rounded-[22px]` pill 气泡；助手消息=裸 prose 无头像。

**已踩的坑**
- 判别联合里加了开放式 `{type:string;[k]:unknown}` 成员，会**破坏 `message_end` 类型收窄** → 用 `as Extract<PiEvent,{type:"message_end"}>` 或对 block 字段 `as {text?:string}` 显式转换。
- `node:sqlite` 的 `.all()/.get()` 返回类型需 `as unknown as T`。
- `db.ts` 在模块导入时即 `new DatabaseSync`，必须在其前调用 `ensureDirs()`（否则 "unable to open database file"）。
- macOS 无 `timeout` 命令（测试脚本注意）。

**依赖提醒**: `multer@1.x` 有漏洞告警，Phase 2 接文件上传时升 2.x。

### 6. 未完成事项与下一步（Action Items）

- [ ] **修复 pi 侧以跑通真实对话** — P0
  - 上下文: 默认 model 报 `developer` role 400；`ptk-memory-inject` 扩展 better-sqlite3 版本不匹配。不修则看不到真实 assistant 输出与工具调用。
  - 输入: 在 pi 顶栏 model 框填可用 model，或修 pi 配置 / `npm rebuild` 扩展。
  - 完成标准: 一轮对话能看到非空 assistant 文本 + 至少一次 tool_use 在 ProcessTrace 中渲染。
  - 潜在难点: tool_use/tool_result 真实结构未观测，可能需按真实数据微调 `ProcessTrace.tsx`。
- [ ] **Phase 2：文件上传 + 数据网格 + 图表 + Excel 预览** — P1
  - 上下文: 数据分析工作台核心价值在右侧预览区；当前 tab（文件/数据表/仪表盘）是占位。
  - 输入: react-dropzone + multer（升 2.x）；ECharts；TanStack Table；SheetJS(xlsx)。
  - 完成标准: 能拖拽上传 Excel/CSV 到工作区、在数据表 tab 预览、在仪表盘 tab 出图。
- [ ] **流式增量渲染** — P2
  - 上下文: 当前按 `message_end` 整段渲染；`-p` 模式是否吐 delta 未知。
  - 输入: 跑通 model 后观察 NDJSON 是否有 content delta 事件名。
  - 完成标准: assistant 文本逐字/逐块出现。
- [ ] **composer 工具栏下拉**（run-mode/thinking、权限、用量 CircleGauge）— P2
  - 完成标准: thinking 级别下拉能映射到 pi `--thinking` 并生效。

### 7. 开放问题与待确认事项

- ❓ **pi 的 tool_use/tool_result content block 真实字段结构**
  - 当前倾向: 按 `{name,input}` / `{content,is_error,tool_use_id}` 防御式解析。
  - 阻塞了什么: ProcessTrace 真实渲染保真度。
  - 需要谁/什么解决: 跑通一次带工具调用的真实对话后观测。
- ❓ **Phase 2 图表库选型 ECharts vs Recharts**
  - 当前倾向: ECharts（中文生态、报表能力强）。
  - 需要: 用户确认。

### 8. 上下文与约定

- 用户偏好（全局 CLAUDE.md）: 中文回答、代码英文、最小改动、先思考后动手、删除/覆盖前确认、证据优先（先读再改）。
- 项目记忆已落盘: `~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/pi-xanthil-overview.md`。
- 产品命名草稿: `产品名称及理念.txt`（苍耳 / pi-Xanthil，理念/功能两节待补）。

### 9. 下一个 Session 启动指令

> 请先读本 Session 顶部的「本次更新摘要」与「未完成事项」两节，并跑 `npm run dev`（gateway:8787 + web:5173）确认现状。
> 当前最紧迫的是 **P0：修复 pi 侧 model/扩展以跑通真实对话**——否则看不到真实 assistant 输出与工具调用，无法验证 ProcessTrace 保真度。
> 注意两个关键陷阱：①判别联合的开放成员会破坏 `message_end` 类型收窄，按既有 `as Extract` 写法处理；②`node:sqlite` 返回需 `as unknown as T`。
> 开始 Phase 2 前，请先与用户确认图表库选型（ECharts vs Recharts）。
