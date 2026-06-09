# pi-xanthil · 快修通道 SOP（跨域小修小补，通用 prompt，适用任意 agent）

你正在为 pi-xanthil 做一次**快修（hotfix）**：小 bug / 小修小补，**不**走「需求拆解 → 按域 brief → 分发」重流程。前提：单一工作目录 + 顺序开发（无并发），故可临时让**任一** agent 跨域改文件——owner 制度防的是并行撞车，对一次性顺序修改不构成硬约束。

依次执行，每步简述结果：

1. **判红线（不可破）**：先确定本次要改哪些文件。若命中**数据安全敏感域** → 立即停下，转交总控（Claude）或懂 `AGENTS.md §一` LLM 隔离铁律的 agent，**不要自行快修**：
   - `web/src/components/DataExplorationPane.tsx` 及 `data-exploration/` 整棵子树
   - 任何读写 `draw_data`（原始数据）/ `clean_data`（聚合数据）的路径与逻辑
   原因：不熟该域约束的 agent 修"小 bug"时极易顺手 import LLM API = 数据泄漏。
2. **最小改动修复**：先读相关文件 + grep 确认结构，**只改 bug 涉及的代码**——不顺手优化、不扩大范围、不碰接缝层骨架（`index.ts` `db.ts` `App.tsx` `api.ts` `types.ts` `constants.ts`）。需动这些 → 停下提交总控。
3. **校验**：跑 `npm run typecheck` + `npm run build`，必须全绿。若改动触及数据探索子树，**额外**跑隔离 grep（见 `AGENTS.md`），应无任何匹配。任一不绿 → 停下修复，不进入下一步。
4. **不自行写他域 notes**：快修执行者通常不是该域 owner。若修复中发现**新踩坑 / 新约束 / 新决策** → **不要**自己改 `docs/notes-<域>.md`，而是在回报里单列「建议总控补进 `notes-<域>` 的内容」，由总控落地。
5. **列改动清单 + 回流终审**：列出改了哪些文件、各一句话说明 bug 与 fix；声明已回流总控终审。总控代码复核 + 集成校验是质量关口，快修**不跳过**（快修未经该域 owner 领域校验，终审更重要）。

⛔ **不要执行任何 git 操作**（add / commit / push / PR）。提交时机 / 粒度由用户手动决定。最后提示用户："快修已就绪并通过自检，待总控终审后可自行提交。"
