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
