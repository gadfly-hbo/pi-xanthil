# 安全红线·待办池（skill 脚本沙箱 + session 内建工具敞口 + pandas 计算工具沙箱）

> **状态**：暂缓 · 入池 2026-06-27（从 wiki 派发板撤下沉淀）· 总控持有（dom X，安全红线）
> **性质**：三项**既有/潜在安全敞口**的评估与收口议题，均不阻塞当前功能，但属数据安全红线范畴，**后续备查、条件成熟可重启**。
> **为何撤下入池**：当前无人领、无紧迫触发；留在派发板易被当活跃 TODO 误读。沉淀于此，原文完整保留、零信息损失。
>
> **重启触发条件（任一命中即应捞出）**：
> - 项① → 一旦 skill 引入「自带可执行脚本（scripts/）+ pi 可执行」形态，或开放 skill 导入外来脚本（见记忆 [[skill-engineering-2026]] / [[self-improving-product-agent-2026]] 的动态技能/导入缺口）。**必须在「可执行」落地之前先定红线**，否则出现「先能跑后补防护」窗口。
> - 项② → 计划放开数据分析 session 的工具面（如接 pandas-sandbox、放宽 cwd），或一次安全审计要求把「行为性不披露」升级为「硬沙箱」。
> - 项③ → duckdb-aggregate 工具落地、积累真实使用后，确实需要「SQL 表达不了的命令式 Python 计算」；其前置 = 先做「run 端点硬锁 clean_data」（与项①/项② 同源）。

---

## 项① 代码执行类 skill 的沙箱安全（原 wiki「skill 自进化·缺口3·安全红线」）

> 来源：2026-06-15 用户 +「skill 管理 vs 行业趋势」对照（缺口 3/3）。原卡 dom=X、委派 E 代笔、总控加重终审。

**缺口**：现有 skill 多为「提示型」；唯一执行链路 ExtractionTool 桥靠后端 `/run` 的 `source=ai` + clean_data 白名单兜底（notes-engine §一），**无通用脚本执行沙箱**。一旦引入 skill 内 `scripts/` 且 pi 可执行，导入/蒸馏来的 skill 携带脚本将能在本机跑——属安全红线，须沙箱（资源限额 / 文件系统范围 / 网络禁用 / 命令白名单）或显式禁用。

**口径待总控裁（核心，先定再落）**：
- **A. 是否允许 skill 自带可执行脚本？** 若**否** → 在导入/激活层显式拒绝并提示（零沙箱成本、最稳）。
- **B. 若是** → 沙箱方案：进程隔离 / cwd 限定到 skill 目录 + 登记 clean_data、网络默认禁用、超时与内存上限、解释器/命令白名单；执行入口收口到**单点**（类比 ExtractionTool `/run` 单点守卫）。
- **C. 与数据安全红线对齐**：脚本绝不可读 draw_data/原始数据，复用既有 clean_data 边界。

**改动范围（初判，待口径定）**：`pi-adapter.ts` 执行注入点 / 新增 skill-exec 守卫单点 / 安全文档 `AGENTS.md §一` + notes-engine。

**依赖**：skill 脚本形态、skill 导入外来脚本——本项须在两者落地「可执行」**之前**先定红线。

**验收**：红线口径成文（AGENTS.md + notes）；选 A 禁用 → 导入/激活携脚本 skill 被显式拦截有测试；选 B 沙箱 → 脚本无法读 draw_data/越界文件/联网、超时被杀，有 focused test。

---

## 项② 数据分析 pi session 内建工具可达 draw_data 评估 + 收口（原 wiki「红线硬化·独立议题」）

> 来源：tool-use Phase 2a spike 取证（2026-06-12，详见 `notes-infra.md §五`）发现的**既有潜在敞口**，用户决策「单列为独立红线议题」，与 tool-use 解耦单独评估。

**问题**：数据分析对话 `handleSend`（index.ts，runPiTurn）cwd=workspace 根、内建 read/bash/edit/write 全开，draw_data 物理在 `sessions/*/010_raw`。当前红线保护**仅靠「路径不披露」(behavioral)**：`output-paths.ts` 不把 draw_data 路径给 pi。但 pi 有 bash+read，理论上能 find/cat 到原始数据 → **非硬沙箱**。

**评估范围（先评估，不急实现）—— 三方案代价/有效性对比**：
1. **pi-sandbox 扩展**：限定 pi 仅可访问任务 020_clean/060_reports（不含 010_raw）。
2. **物理隔离**：把 draw_data 移出 session cwd（彻底但动目录标准、影响面大）。
3. **工具收窄**：`--exclude-tools` / `--tools` allowlist（但 session 依赖 read/write 读 clean_data、写 060_reports，不能全禁）。

**硬约束**：session 离不开内建 read/write（读 clean_data 路径分析、写 060_reports），方案不能破坏该能力。

**验收（评估阶段）**：产出方案对比 + 推荐 + 是否实施结论，写入 `notes-infra`；若实施则另立实现子项。

**约束**：纯接缝层（index.ts / pi-adapter），总控自留。

---

## 项③ 受限 Python 计算工具（pandas-sandbox）的沙箱（原 wiki「subagents 管理·pandas-sandbox·暂缓」，dom=E）

> 来源：subagents 管理 P1 范围收窄（用户裁决 2026-06-17：S4 暂不做 pandas-sandbox，先只上 duckdb-aggregate）。**不立即开发**，待 duckdb-aggregate 落地、积累真实使用后再判断是否做、做到哪个安全级别。

**作用（设计意图）**：受限 Python 计算原语，给 subagent 做 duckdb/SQL 表达不了的复杂逻辑清洗与统计（命令式分组变换、字符串/日期处理、reshape、统计算法）。与 duckdb-aggregate 分工：SQL 能写的聚合走 duckdb，需命令式 Python 走 pandas。结果（聚合产物）经 S3 护栏回喂 LLM。

**暂缓主因——「sandbox」在现有 ExtractionTool 体系下名不副实**：
① python3 以完整 stdlib 运行，能 import 任意库、发网络、读被给到的任意文件路径，真正的硬边界是外层围栏（输出路径围栏 + S3 行数护栏 + `buildSanitizedEnv` env 白名单 + execFile timeout）而非解释器能力限制；
② **输入路径目前没硬锁 clean_data**——`validateExtractionInput`（registry.ts:114）只查 mode+扩展名，MCP 的 cleanDataPath 在 run 端点无「必须 resolve 在 clean_data 内」硬校验；pandas 能跑任意 Python，理论上可在代码里读别处文件绕过。duckdb-aggregate 只接 SQL、攻击面小得多，故先上。

**将来开发要点（捞出时判断）**：
1. **是否采用严格模式（硬锁 clean_data）**——给 run 端点加 `source==="ai"` 时 inputPath 必须 resolve 在该 workspace clean_data 内的硬校验（**与项① 沙箱单点守卫、项② session 工具收口同源，可一并做**）；这是 pandas 能否安全开放的前置。
2. 真沙箱选型（按风险取舍）：RestrictedPython / 子进程 namespace+seccomp / 容器；或退而限定为「只允许 import pandas/numpy 白名单 + 禁网络 + chroot 到输入输出目录」。
3. 复用：`server/tools/_tool_utils.py`、loadTools 自动注册、S3 行数护栏（继承，无需重做）。

**依赖**：duckdb-aggregate 卡先落地（确立服务端工具+护栏的真实使用基线）。

**验收（捞出后）**：严格模式选定并实现；pandas 工具仅服务端、输入受限 clean_data、产物不含明细行经 S3 护栏；tool-evaluation 可评测；回流总控终审。

**约束**：**入池暂缓，产品代码零起头**（捞出前不建 `server/tools/pandas-sandbox/`、不接 UI）；不碰数据探索子树。

---

## 三项的关系与共性

- 都是「LLM/执行链路触达不安全数据面」的红线问题：项① 是**未来**引入 skill 脚本执行的新攻击面；项② 是**既有**数据分析 session 内建工具的潜在敞口；项③ 是**计划中**的 pandas 计算工具（比 duckdb 攻击面大，故 SQL 先行、Python 暂缓）。
- 共同的硬边界 = **draw_data 原始数据绝不可进 LLM / 不可被脚本读**（AGENTS.md §一）；三项收口都应复用既有 clean_data 边界与单点守卫思路。
- **强收敛点**：项①（skill-exec 守卫单点）、项②（session 工具收口）、项③（run 端点硬锁 clean_data）本质是同一件事——**给 pi 执行环境装统一的「输入硬锁 clean_data + 禁 draw_data + 网络/越界防护」单点守卫**。若将来做安全硬化批，三项应**一并设计**，避免分散补丁与重复守卫。
