# 横切基础设施 · 领域笔记（总控持有）

> **活文档**：总控持有的横切基础设施知识（缓存 harness / prompt 契约 / 接缝层指针）。
> 蒸馏自旧 handoff：`缓存命中`。原文已 `git rm`，完整历史见 commit 95528cd 之前版本。
> 接缝重构（routes/db/api/tabs 拆分）记录见 `Orchestration.md §四`。

---

## 0. 当前状态（总控维护，覆盖式）

- 最近更新：2026-06-09 · 总控
- 进度：P0 推进中 —— 接缝重构✅ · 文档治理✅ · 连续性 SOP+`/px-*`(resume/wrapup/hotfix)✅ · 协作闭环(机制A)+归档✅ · wiki(5 tab：派发/快修/随手记/prompts/版本历史)✅ · 快修通道固化于 `Orchestration §六`✅ · 随手记 localStorage+导出导入✅ · 缓存 harness 三层闭环(回填未验证) · **P0-A(D 上传即用)✅终审** · **P0-B(V 看板画布)⚠️实跑打回**(路由漏 `/api`→404，已生成 V 修复任务)
- 下一步：**仅剩 P0-C E2E 验证(E)** 待进场。P0-A(D)✅ · P0-B(V 看板重做)✅ · P0-D(D 聚合数据源)✅ 均终审+实跑通过；总控契约前置✅(`types.ts` `BiAggregation*` + `bi-dataset-parser.ts`)。P0 齐活后归档 changelog(v2.1) + 定义 `MetricDefinition` 双侧契约
- 开放问题：缓存回填效果待真实双 session 验证
- **终审教训**：仅 typecheck/build 绿 ≠ 功能可用；后续终审一律加运行时端到端实跑门禁

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

---

## 三、本机已知坑（pi 侧，非本项目 bug）

- 扩展 `ptk-memory-inject` 的 better-sqlite3 NODE_MODULE_VERSION 不匹配 → 本项目选 `node:sqlite` 免疫原生编译坑。
- 默认 model `volcengine-plan/deepseek-v4-flash` 报 `developer` role 400 → 跑真实对话前需切模型。
- `runPiPrompt` 用 `--no-skills`，**勿用 `--no-extensions`**（禁用 provider 扩展致 LLM 调用失败）。
