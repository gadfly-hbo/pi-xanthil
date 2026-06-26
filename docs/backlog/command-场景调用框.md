# command 场景调用框（已落地 · command = {tools+skills+prompts} 定制集合，一键装配）

> **状态**：已完成 · 入池 2026-06-22 · 捞出落地 2026-06-26 · 总控持有（接缝契约 XanCommand 扩字段 + 跨 D/E 实现）
> **来源**：chat 框接入 prompts/command 改造（2026-06-22）收尾讨论。先澄清「command 与 bash/脚本无关」，再由用户校准定位：**command 应能调用三类东西——tools、skills、prompts；command 调用框 = 把它们按场景打成定制集合，特定数据分析场景下一键调用，免去分别找。**
> **零残留**：本需求从未在产品代码起头，入池不涉及清理。

---

## 0. 一句话结论

把 `XanCommand` 升级为**场景包（scenario pack）**：一条命令可绑定一套定制化的 **{prompt + skills + tools}** 组合。2026-06-26 已落地甜点档：command 管理面可绑定 analysis tools 与参数映射；ChatPane 选择带 tools 的 command 时预填并打开 `@工具`，由用户确认后运行。

**仍不做的部分**：不做独立重型 command 调用框，不做全自动 tool run。tools 仍走 `@工具` 卡和 `/api/extraction-tools/:id/run`，保留人工确认在环。

**落地记录（2026-06-26）**：
- `XanCommand` 双侧新增 `toolIds?: string[]`、`toolParamMap?: Record<string,string>`。
- server `coerceCommand()` 只接受当前已注册的 `analysis` tools；`expandCommand()` 向后兼容返回 tool 绑定。
- `CommandManagementPane` 新增“场景工具 toolIds”与参数映射编辑。
- `ChatPane` 对带 tools 的 command 预填 `ManualAnalysisToolCard`；无 tools 的旧命令行为不变。
- 验证：command 单测、command evaluation 单测、`npm run typecheck`、`npm run build` 通过。

---

## 1. 背景：三类零件在 chat 框已各自可用

| 零件 | chat 现状入口 | 本质 | 证据 |
|---|---|---|---|
| **tool** | @工具按钮（`ManualAnalysisToolCard`） | 服务端受控可执行单元（python 子进程 + 数据安全闸门） | `server/tools/*/tool.json`、`/api/extraction-tools/:id/run` |
| **skill** | SkillSelector | SKILL.md 能力包，本轮附加 | `.pi/skills/<slug>/SKILL.md` |
| **prompt** | Prompt 库按钮（2026-06-22 接入） | 带 `{{var}}` 的可复用 prompt body | `prompt_templates` 表 / `PromptSelector.tsx` |
| **command** | 输入 `/` 菜单 | prompt 宏 + 斜杠语法 + 已可绑 skill（`skillSlugs`） | `command-expand.ts`（纯文本展开）、`XanCommand` |

**关键观察**：`XanCommand` 现已 = prompt（`template`）+ skills（`skillSlugs`）的二合一；**缺的第三条腿是 tools**。补上 tool 绑定，command 天然就成了 {prompt+skills+tools} 三合一的场景包。

---

## 2. 目标形态：command = 场景包 + chat 调用框

**数据模型**：一条 command 绑定一套场景化集合
- prompt：既有 `template`（场景的指令骨架，含 `{{var}}`/`{{param.key}}`）
- skills：既有 `skillSlugs`（场景要附加的能力包）
- tools：**新增** `toolIds`（场景常用的工具，可预配参数映射）

**chat 调用框（新 UI）**：一个面板列出这些场景包，选中即一键装配——把 prompt 注入输入框、勾上对应 skills、把绑定的 tools 备好（或预填 @工具卡）。把"分别找三处"压缩成"选一个场景"。

---

## 3. 三档 tool 关联（评估留档，决定 tool 那条腿怎么接）

| 档 | 机制 | 成本 | 性质 | 取舍 |
|---|---|---|---|---|
| 1·已可用·零开发 | command `template` 里写「用 X 工具对 {{file}} 跑…」+ 绑 skill → pi 自主调 tool | 0 | LLM 中介、非确定性 | 现在就能用，先验证心智 |
| **2·轻量·确定性** | command 绑 `toolId` + 参数映射；选中直接预填 @工具卡，人确认后跑 | 中，复用 `ManualAnalysisToolCard` | 半自动、保人工 + 安全闸门 | **甜点** |
| 3·重·全自动 | command 直接触发 tool run 并回灌，零人工 | 高 | 绕过 LLM + 直怼数据安全闸门 | **不做**，碰红线 |

---

## 4. 将来开发要点（捞出时按此接入）

**接缝契约（总控持有）**
- `XanCommand` 扩可选字段：`toolIds?: string[]`（绑定的 tools）、可选 `paramToToolInput?: Record<string, string>`（命令 param.key → tool 参数名映射，给档 2 预填用）。**向后兼容**：不带这些字段的命令行为完全不变。
- 双侧 `types.ts` 对齐；`coerceCommand`（server 保存校验）补 toolIds 合法性校验（必须是已注册 tool）。

**注册表 / 管理面板（D · CommandManagementPane + 命令注册表 API）**
- 编辑命令时增「场景集合」区：选 prompt 骨架（或直接编 template）+ 勾 skillSlugs + 选 toolIds + 配 param→tool 参数映射。
- CRUD 走既有 `listCommands`/`saveCommands`（`/api/commands`，全局单注册表、覆盖式 PUT）。

**chat 调用框（E · ChatPane）**
- 新增 command 调用框（场景包列表）：选中一个场景 → 注入 template 到输入框 + 合并 skillSlugs 进本轮 skillPaths + 按 tool 关联档位处理 tools（档 1=随 prompt 文本指示；档 2=预填 @工具卡）。
- 复用现成零件：PromptSelector 的列表/搜索范式、SkillSelector 的勾选合并、ManualAnalysisToolCard 的运行链路。
- 与现有 `/` 命令菜单的关系：`/` 仍是快速文本调用；调用框是"场景浏览 + 一键装配"，两者并存不冲突。

**红线（务必守）**
- tool 那条腿必须仍走 @工具卡的数据安全闸门（clean_data only、禁 draw_data、聚合层输出），**不得**因"命令触发"绕过 `/api/extraction-tools/:id/run` 的 source/闸口校验。
- 保持人确认在环（档 2），不滑向档 3 全自动。

**依赖 / 顺序**：chat 改造 1-1/1-2 已 done（Prompt 库 + 沉淀 prompt），命令文本调用侧（`/` 菜单 + 参数向导）已闭环。本需求是其上的增量。捞出时独立成卡：X 契约先行（XanCommand 扩 toolIds）→ D 面板（场景集合编辑）→ E（chat 调用框装配 + tool 档位接入）。

---

## 5. 为什么暂缓

三类零件在 chat 框已各自可用，单独调用无缺口；档 1 也已能零开发拼出"场景化命令"的雏形。先让用户用 `/` 命令 + 三个选择器跑出真实高频场景，沉淀出"哪些 tools/skills/prompts 常一起用"，再决定场景包的数据模型与调用框形态——避免过早把组合方式写死。
