# pi-xanthil · Session 收尾 SOP（通用 prompt，适用任意 agent）

你正在为 pi-xanthil 收尾本次开发 session。目标域 ∈ {data, engine, viz, infra}（按本次所改内容确定；不确定就问用户）。

依次执行，每步简述结果：

1. **校验**：跑 `npm run typecheck` 与 `npm run build`；若目标域=data，另跑数据探索 LLM 隔离 grep（见 `AGENTS.md`）。任一不绿 → 停下修复，不进入下一步。
2. **覆盖状态**：用最新内容**覆盖** `docs/notes-<域>.md` 的「## 0. 当前状态」区（最近更新日期 / 进度 / 下一步 / 阻塞 / 开放问题）——覆盖旧内容，**不堆叠历史**。这是下个 session 接续的唯一可靠依据，务必写充分（尤其"下一步"和未完成点）。
3. **沉淀长效知识**：若本次产生新踩坑 / 新决策（含"为什么/否决了什么"）/ 新约束 → 追加或修订到 `docs/notes-<域>.md` 正文对应小节。
4. **上报开放问题**：需总控（Claude）拍板的事项写进 notes §0「开放问题」。
5. **列改动清单**：列出本次改动/新增的文件，逐条一句话说明改了什么。

⛔ **不要执行任何 git 操作**（add / commit / push / PR 等）。是否提交、何时提交、提交粒度——全部由用户在合适节点手动决定。最后提示用户："改动已就绪，可自行 review 后提交。"

约束：只改本域文件；不碰他域文件 / 接缝层骨架（`index.ts` `db.ts` `App.tsx` `api.ts` `types.ts` `constants.ts`）/ `.claude/settings.local.json` / `.understand-anything/*`。涉及这些先停下问用户。
