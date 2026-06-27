# pi-xanthil 文档索引（docs/）

> 本目录文档较多，按性质归类导航。**所有文件均被代码/SOP/notes 引用，路径稳定不迁移**——
> 整理只做认知归类（本索引），不做物理移动，避免断链。
>
> 维护：新增文档时在本索引登记一行（标注「活/档案」）。

---

## 一、活文档·真源（持续维护，多处引用）

跨 session 连续性与协同的权威载体，**改动频繁、勿当一次性文档**。

| 文件 | 持有 | 内容 |
|---|---|---|
| [wiki.html](wiki.html) | 总控 | 任务派发板（TASKS：todo/doing/done）+ CHANGELOG 版本历史 + 🔧 快修任务 + 随手记。**唯一派发/版本真源** |
| [notes-infra.md](notes-infra.md) | 总控 | 横切基础设施：缓存 harness / 接缝层指针 / 各 X 契约审定（§九–§十二）/ §0 当前状态快照 |
| [notes-engine.md](notes-engine.md) | E | 工作流 / AnaX / 实验室 / 对话 / Eval-Harness（§0 域状态 + 长效知识） |
| [notes-data.md](notes-data.md) | D | 计算工具 / Xan数据库 / 规则记忆 / 数据探索（§0 域状态 + 长效知识） |
| [notes-viz.md](notes-viz.md) | D（原 V） | Dashboard / 报告·汇报·审核·黄金策 / trace / 知识图谱（§0 域状态 + 长效知识） |
| [harness-etclovg-coverage.md](harness-etclovg-coverage.md) | 总控 | 把 pi-xanthil 当 agent harness 做 ETCLOVG 七层覆盖度自检（发版/harness 变动顺手更新） |

> 调度基线见仓库根 `Orchestration.md`（总控章程）+ `AGENTS.md`（数据安全/工程约定）。

## 二、模块设计方案

某模块的架构设计文档，落地后转为长效参考。

| 文件 | 模块 |
|---|---|
| [onto-xanthil-design.md](onto-xanthil-design.md) | onto-xanthil 数据语义层（对象/关系/指标/逻辑/动作/图谱/导入 · P1–P8） |
| [LLM管理模块设计方案.md](LLM管理模块设计方案.md) | LLM 管理（provider/model/auth，直写 pi 全局真源） |
| [subagents管理模块设计方案.md](subagents管理模块设计方案.md) | subagents（委派形态/模板/黑板/回流/看板/红线） |
| [工作流模块改造方案.md](工作流模块改造方案.md) | 工作流从三套重叠栈收敛为单引擎 + 闭环 |

## 三、契约 / schema

| 文件 | 内容 |
|---|---|
| [工作流-onblock契约.md](工作流-onblock契约.md) | 工作流闭环 onBlock 契约（gate 失败→带证据回跳） |
| [workflow-schema-compat.md](workflow-schema-compat.md) | workflow.json schema 兼容口径 |

## 四、任务派发书（历史档案）

各专题拆解为按域 brief 的派发记录。**专题完成后即历史档案**，主要被 notes 的「详见派发书」指针引用；保留供追溯，不再增改。

- [工作流改造-任务派发.md](工作流改造-任务派发.md)
- [记忆重构-任务派发.md](记忆重构-任务派发.md)
- [实验场改造-任务派发.md](实验场改造-任务派发.md)
- [SQL连接扩展-任务派发.md](SQL连接扩展-任务派发.md)

## 五、SPIKE 结论

- [体检-spike结论.md](体检-spike结论.md) — 体检模块数据面口径定稿（解锁 X-HEALTH0 等）

---

## 六、子目录（各有自己的 README）

| 目录 | 内容 |
|---|---|
| [backlog/](backlog/README.md) | **需求池**：探讨过但暂不开发的需求方案（零产品残留），含索引 README |
| [onto-prompts/](onto-prompts/README.md) | **本体抽取 prompt 库**：9 大零售行业领域 prompt + README |
| [prompts/](prompts/) | **Session SOP 通用 prompt**：px-resume / px-wrapup / px-hotfix / px-paper2cards（被 `.claude/commands/` 引用） |

---

## 导航速查

- **接手开发** → 读 `Orchestration.md` + 对应 `notes-<域>.md §0` + `AGENTS.md`（或走 `/px-resume <域>`）
- **看任务/版本** → `wiki.html`（派发板 + CHANGELOG）
- **找某模块设计** → 第二节「模块设计方案」
- **找暂缓需求** → `backlog/README.md`
