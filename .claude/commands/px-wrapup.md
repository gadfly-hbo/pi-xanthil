---
description: pi-xanthil Session 收尾：跑校验→commit/PR→覆盖 notes §0→沉淀长效知识
argument-hint: "[域 data|engine|viz|infra，留空按分支推断]"
allowed-tools: Bash(git branch:*), Bash(git status:*), Bash(git log:*), Bash(git diff:*)
---
你正在为 **pi-xanthil** 执行【Session 收尾 SOP】（依据 `Orchestration.md §十`）。

目标域：**$1**（留空则据下方当前分支推断 `feat/data-*→data`、`engine→engine`、`viz→viz`，推断不出就先问我；总控自身收尾用 `infra`）。

当前 git 上下文：
- 分支：!`git branch --show-current`
- 工作区改动：!`git status --short`
- 改动概览：!`git diff --stat`

按顺序执行，每步做完简述结果：

1. **校验**：跑 `npm run typecheck` 和 `npm run build`；若目标域=`data`，另跑数据探索 LLM 隔离 grep（见 `AGENTS.md` 一节）。**任一不绿就停下报告，不要提交。**
2. **提交**：全绿后按 Conventional Commits 提交，message 写清「做了什么 + 验证了什么」。若在 `feat/*` 分支则 push 并开/更新 PR（描述 = 本次范围 + 验证结论）。**只暂存本域相关文件**——不碰他域文件、接缝层骨架（`index.ts`/`db.ts`/`App.tsx`/`api.ts`/`types.ts`/`constants.ts`）、`.claude/settings.local.json`、`.understand-anything/*`。涉及这些 → 停下问我。
3. **覆盖状态**：用最新内容**覆盖** `docs/notes-<域>.md` 的 `## 0. 当前状态` 区（最近更新日期 / 进度 / 下一步 / 阻塞 / 开放问题）——覆盖旧内容，**不堆叠历史**。
4. **沉淀长效知识**：若本次产生新踩坑 / 新决策（含"为什么/否决了什么"）/ 新约束，追加或修订到 `docs/notes-<域>.md` 正文对应小节。
5. **上报开放问题**：需总控（Claude）拍板的事项写进 notes §0「开放问题」或 PR 评论。

最后用 3–5 行汇报：commit hash、§0 的新「下一步」、以及留给下个 session 的关键提醒。
