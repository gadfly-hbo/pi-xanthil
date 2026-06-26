# 数字锁输出端校验（MetricVerification · 产出侧防漂移）

> **入池日期**：2026-06-25 · **状态**：开发中（P1 · wiki 已拆卡）· 总控持有
> **来源**：指标标准层 MetricSnapshot 专题（X-METRIC0/D-METRIC1/E-METRIC2/D-METRIC3）交付后暴露的后续候选。
> **零残留**：本需求从未在产品代码起头，入池不涉及清理；wiki 卡负责派发，本文件为方案底稿（沿用 EFC/AHE 范式）。
> **关联记忆**：`metric-snapshot-initiative`。

---

## 0. 一句话结论

给数字锁补上**产出侧闭环**：E-METRIC2 在 system prompt 注入数字锁是**输入侧软约束**，若模型仍篡改了 MetricSnapshot 数值，系统当前**检测不到**。本需求在模型产出后，把回答文本中引用的关键数字与本轮注入的 MetricSnapshot 做**数值回校**，verdict≠ok 时告警——把数字锁从「叮嘱」升级为「可观测」。

---

## 1. 背景：现有数字锁只覆盖输入侧

| 环节 | 现状 | 卡 |
|---|---|---|
| 输入侧 · 工具结果结构化 | ExtractionTool→`MetricSnapshot[]`，MCP 返回数字锁前缀+JSON | D-METRIC1 |
| 输入侧 · prompt 软约束 | system prompt「禁止重新推导代码计算值」 | E-METRIC2 |
| 输入侧 · 监测链路对齐 | 监测 finding→MetricSnapshot 注入 draft | D-METRIC3 |
| **产出侧 · 数值回校** | **❌ 无**——模型真改了数也无人发现 | **本需求** |

数字锁本质是 prompt 指令层约束（best-effort）。LLM 偶发把 `12500` 复述成 `12000`、或自行重算环比算错，纯靠指令无法 100% 杜绝，也无任何信号告知用户/系统「这次没遵守」。

---

## 2. 关键设计发现：只打 tool-use 链路（监测链路不适用）

交付复核时核证两条链路的产出形态（证据见 `monitor-llm.ts:199` / `index.ts:4710`）：

- **tool-use 链路（适用 ✅）**：snapshot 经 MCP 返回 pi，模型在**自由文本**里复述/解读数值。产出可在 `message_end` 事件捕获（已有 `backfillAnalysisFromMessage`@`index.ts:4842` 同款钩子范式）→ 回校有意义。
- **监测链路（不适用 ❌）**：`draftMetricSystem` 产出是 `parseDraftJson` 解析的**结构化指标体系设计**（metrics/dependencies/monitorRules），LLM 设计新指标、**不复述 snapshot 数值**，没有「应等于某 snapshot.value 的数字」可校。

**结论**：本需求主战场是 tool-use 链路（ChatPane 数据分析对话 + flow chat）；监测链路本期不做。

---

## 3. 核心机制（含架构决策，总控自留）

### 3.1 校验核心（纯函数）
1. **留存**本轮注入的 `MetricSnapshot[]`（已知代码确定性数值）。
2. **提数**：正则扫 assistant 文本，识别千分位 / 小数 / 万·亿单位 / 百分比。
3. **匹配**（带容差，避免误报）：对每个 `snapshot.value`，单位归一后——
   - 相对差 ≤ `ε_ok`（默认 **0.5%**，容忍四舍五入展示）→ 正确引用。
   - `ε_ok` < 相对差 ≤ `ε_suspect`（默认 **20%**）且同量级 → **疑似篡改/重算**。
   - 超 `ε_suspect` → 视为无关数字，不报（防误报）。
   - 文本未出现该值 → `unreferenced`（正常，不算错）。
4. **verdict**：任一 snapshot 落入疑似带 → `mismatch`；否则 `ok`。

### 3.2 定位（重要边界）
- **best-effort 告警，非硬门**：不阻断对话、不自动改写、不自动重试（首版）。数字匹配存在单位换算/口径转述歧义，强阻断会误伤。
- verdict + 命中明细回传前端，由用户判断。

### 3.3 安全红线
- 校验器只读 assistant 文本 + 已注入 snapshot（衍生值），**不碰 draw_data / dataset.rows**。grep 验证。

---

## 4. 拆卡（已进 wiki TASKS）

| 卡 | 域 | 内容 |
|---|---|---|
| **X-MLOCK0** | X（总控自做） | `MetricVerification` 契约（双侧 types.ts）+ `metric-verification.ts` 纯函数校验核心（提数/单位归一/容差匹配/verdict）+ 单测。架构决策（容差 ε_ok/ε_suspect、verdict 枚举、匹配策略）写死。无 UI、无链路接入，纯地基。 |
| **X-MLOCK1** | X（总控持有，前端展示可委派 D） | tool-use 链路接入：handleSend/handleSendFlow turn 内留存本轮注入 snapshot[]，`message_end` 后跑 `verifyMetricUsage`，verdict=mismatch 时 ChatPane 标注告警。先告警，不自动重试。 |

---

## 5. 将来开发要点 / 重启指引

- 先读 X-METRIC0 契约（`MetricSnapshot`）+ `extraction-tool-metric.ts:buildMetricSnapshotsFromHints`（注入侧）+ `index.ts:4710`（/run 附加点）+ `index.ts:4842 backfillAnalysisFromMessage`（message_end 钩子范式，本需求挂载点同款）。
- 容差阈值（ε_ok/ε_suspect）首版用常量，后续可按 snapshot.unit / 量级自适应。
- 若后续要做**自动重试**：在 verdict=mismatch 时重发一轮「请严格引用以下数值」纠偏，需接预算约束（参 agent-loop 闭环的 maxIterations 思路），避免死循环。
