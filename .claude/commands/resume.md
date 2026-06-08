---
description: pi-xanthil Session 开场：拉取→读状态/背景/任务→定位上次改动→给起步计划
argument-hint: "[域 data|engine|viz|infra，留空按分支推断]"
allowed-tools: Bash(git branch:*), Bash(git log:*), Bash(git pull:*)
---
你正在为 **pi-xanthil** 执行【Session 开场 SOP】（依据 `Orchestration.md §十`）。

目标域：**$1**（留空则据下方分支推断；推断不出就先问我；总控自身用 `infra`）。

当前 git 上下文：
- 分支：!`git branch --show-current`
- 最近提交：!`git log --oneline -8`

按顺序执行：

1. **拉取与读状态**：（如有远端）`git pull`。读 `docs/notes-<域>.md` 的 `## 0. 当前状态`（上次进度 + 下一步 + 阻塞）与 `Orchestration.md §八`（全局里程碑）。
2. **读背景与任务**：读 `docs/notes-<域>.md` 正文（领域约束/决策/踩坑）+ `KICKOFF-P0.md`（当前阶段任务）+ `AGENTS.md`（数据安全/工程约定）。
3. **定位上次改动**：`git log --oneline -10 -- <本域文件>` 看上次具体改了什么；必要时 `git diff` 关键文件。
4. **先汇报，不要立刻写代码**：用 5–8 行向我说明 ① 本域当前状态（来自 §0）② 上次最后改了什么 ③ 本次建议的「下一步」与第一步动作 ④ 任何阻塞 / 待我确认的点。**我确认后再开干。**
