# pi-xanthil · 论文→backlog→wiki 卡 SOP（研究摄取通道，通用 prompt）

你正在把一份「论文链接 / 论文编号 / 论文相关信息 / 研究综述」摄取进 pi-xanthil 的演进规划。产物链路固定：**查读论文 → 理解与 pi-xanthil 的关系 → 生成 backlog → 拆 wiki 任务卡（补充原卡或新建）→ 沉淀 reference 记忆并入索引**。

铁律先记牢：
- **证据优先，禁脑补**。论文（尤其 arxiv 编号晚于知识截止的）一律**实抓后再讲**；抓不到就如实说，绝不凭记忆复述论文内容。
- **重叠必查、delta 必提**。新论文常与已落 backlog/wiki 卡重叠——必须先查已有，提炼"真正的新增量"，不重复造。
- **全程不做任何 git 操作**。

依次执行，每步简述结果：

## 1. 取证 · 读论文
1. 输入可能是 URL / arxiv 编号 / 标题 / 一段综述文本。
2. 抓取（可多篇并行）：
   - 摘要级：`WebFetch https://arxiv.org/abs/<id>`；
   - 精读级：`WebFetch https://arxiv.org/html/<id>`（要公式/算法/数据结构时用全文）。
3. 编号对不上 / 信息只是综述 → `WebSearch` 定位原始论文。**对不到单篇时**，改以"主题最贴合的真实论文"为依据，并**在产物里如实标注此替代**（例：综述疑为产品报道，落地依据改用 XXX 论文）。
4. 提炼每篇：核心机制、关键公式/算法/数据结构、实测增益数字（用于卡里量化收益）。

## 2. 理解 · 对位 pi-xanthil
1. 读 `MEMORY.md` + 相关 reference 记忆 + `docs/backlog/README.md` + `docs/wiki.html` 现有卡，**判重叠**：新论文与已落 backlog / 未执行卡是否覆盖？逐条提炼 delta（哪些已有、哪些是新增量）。
2. 对位域与模块：依 `Orchestration.md`——D 数据基座 / E 智能引擎(Eval/Harness/skill/multi-agent 全归 E) / V 已并入 D / X 总控接缝(types.ts/db migration/cache 契约)。落点用真实文件名（先 grep/读确认，勿凭记忆）。
3. 给「拿来优先级」：性价比 + 依赖关系（谁是谁的前置）+ 风险（红线/无 git/规模门槛）。

## 3. 生成 backlog（`docs/backlog/`）
1. 每个值得落地的主题一份 `<中文名>.md`，遵循 `docs/backlog/README.md` 格式：来源 / 为什么 / 机制对位（论文骨架→pi-xanthil）/ 与现有模块边界（**零残留**）/ 将来开发要点（捞出指引）/ 关联（`[[记忆名]]` + 同批 backlog 路径）。
2. **重叠声明置顶**：若与现有 backlog/卡重叠，显式写"本条不重复 XX，仅沉淀新增量 YY"，并 `[[链接]]`。
3. 登记 `docs/backlog/README.md` 在池索引表一行（需求 / 文件 / 入池日期 / 状态=暂缓 / 一句话）。

## 4. 拆 wiki 任务卡（`docs/wiki.html` 的 `TASKS`）
> **落卡 = 从 backlog 池捞出转「开发中」，影响派发板**。范围较大（多篇/多卡）时**先用 AskUserQuestion 问用户**落多大范围；遵循章程「派发区只放还要做的、看板永不膨胀」。

以**总控身份**按域拆：
1. **补充 vs 新建**：与某张未执行卡重叠 → **增补进该卡 brief**（不新增卡，防膨胀）；全新能力 → **新建卡**。
2. **X 契约先行**：跨域共享类型 / db 新表 / 接缝改动归 X（总控自做，brief 内写死口径），再解锁 E/D 按图施工。跨域读取走 HTTP，不直接 import 他域。
3. **红线**：碰 `draw_data` / 数据探索的卡归 D 域，brief 写明守 `AGENTS.md` 数据安全 + 改完跑隔离 grep。
4. 卡格式（与现有卡一致）：
   `{ dom: "X|E|D", status: "todo", created: "YYYY-MM-DD HH:MM", title: "【模块·阶段】CARD-ID：标题（执行方）", brief: \`来源/范围(文件边界)/验收/约束/跨域依赖\` }`
   - 同主题多卡前加 `// ──` 注释块说明专题、波次、依赖、重叠处理。
   - 未就绪卡在 title 标「冻结待解冻」+ brief 写解冻条件（依赖谁跑通），不假装就绪。
5. **写后校验**（必做）：
   ```
   node -e 'const fs=require("fs");const h=fs.readFileSync("docs/wiki.html","utf8");
   const b=[...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(x=>x.includes("const TASKS"));
   try{new Function(b);console.log("TASKS parse OK, 卡数",(b.match(/\{ dom:/g)||[]).length)}catch(e){console.log("PARSE ERR",e.message)}'
   ```
   确认解析 OK + 新卡 ID 在位（`grep` 新 CARD-ID）。brief 用反引号模板，内容里禁出现裸反引号 / `${`。

## 5. 沉淀 reference 记忆
1. 先查 `MEMORY.md` 有无可更新的同主题卡（**能更新就不新建**）。
2. 写 `~/.claude/projects/-Users-huangbo-Dev-Projects-pi-xanthil/memory/<topic>.md`，frontmatter `type: reference`，正文记：论文核实结论（注明"实抓非记忆"）+ 与 pi-xanthil 对位 + 重叠判断 + 落地产物（backlog 路径 + 卡 ID）+ 优先级。用 `[[名]]` 链相关记忆。
3. `MEMORY.md` 加一行索引（`- [标题](file.md) — 钩子`）。

## 6. 收尾汇报
结论优先列：① 论文核实结论（含替代标注）② 重叠/delta 判断 ③ 落地产物清单（backlog 文件 + 卡 ID + 增补卡）④ 校验结果 ⑤ 红线提示与需用户拍板项。

⛔ 不执行任何 git 操作。落卡范围、是否提交，全由用户定。
