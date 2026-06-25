# 知识库（Knowledge Base）

> **更新**：2026-06-24（知识库专题 X-KB0 / D-KB1 / D-KB2 / E-KB3 / E-KB4 全部 done）

> **定位**：用户上传/登记的非结构化**参考资料**库（方法论文档、SOP、业务决议、公司战略、算法文档等），支持两种消费模式：
> 1. **主动搜索**（E-KB3）——搜索词 → 文档排名列表 → 点击全文阅读/引用，适合"找到某篇方法论后通读"的分析师场景；
> 2. **被动 RAG 注入**（kb_search）——query 触发 → BM25 召回 chunks → 注入 system prompt，适合"自动把相关片段带入 LLM 上下文"的问答场景。

## 与统一记忆 memory_items 的区别

| 维度 | 知识库 knowledge_docs | 统一记忆 memory_items |
| --- | --- | --- |
| 性质 | 参考资料（用户主动管理） | 系统沉淀（约束/经验/事实/情景） |
| 注入策略 | **按需检索**（主动搜索 or RAG 注入二选一） | **主动注入** chat / workflow system prompt |
| 衰减 | 半衰期 60d（长期资料） | 半衰期 30d（即时学习） |
| 去重 | 不强制（用户自管） | lexical + semantic 双层 dedup |
| 数据安全位面 | folder kind `knowledge`，与 `draw_data` 隔离 | LLM 衍生条目，已过 D-INGEST 风险门禁 |

## 资料库（kb_docs）

- **上传**：当前仅接受文本（.md / .markdown / .txt / .csv / .tsv / .json / .log），单文件 ≤ 5 MB UTF-8。二进制文件（pdf / docx / xlsx）请先转 markdown 或纯文本再上传。
- **新建文档**：标题 + 内容 + 标签（英文逗号分隔）+ 来源路径（可选元数据）。保存即按段落优先策略分块（budget 1200 chars / overlap 120）入 `knowledge_chunks` 表，供 BM25 检索召回。
- **摘要**（D-KB2）：文档上传后异步调用 LLM 生成 ≤200 字摘要，写入 `knowledge_docs.summary` 列。摘要参与检索加权（1.5x），提升语义概括命中率；摘要生成失败不阻塞上传，检索仅少一个加权信号源。
- **删除**：会级联删除该文档所有 chunks，不可撤销。
- **scope**：`workspace`（项目专属，本工作区独占）/ `global`（通用，全局池跨工作区可启用）。
- **路径字段**：`path` 仅作元数据展示，server **不会**基于它做 fs 读取。任何后续把 path 用于 readFileSync 的代码必须先过 `safeResolve()` 工作区沙箱。

## 主动搜索（E-KB3）

**入口**：知识库 → 检索 tab。

- **搜索词 → 文档排名**：调用 `GET /api/workspaces/:id/knowledge/search?q=<query>&topK=<n>`（D-KB1 doc 级聚合接口），返回 `KnowledgeDocSearchResult[]`，每条含文档标题、标签、200 字 snippet（命中词高亮）、综合相关度分（0–100）、命中 chunk 数。
- **防抖**：300ms 输入后自动触发，自增 token 防竞争。
- **全文抽屉**：点击结果卡片 → 右侧抽屉展示完整 markdown 渲染内容 + 上传时间、更新时间、来源路径；支持「复制全文」「复制引用（标题+路径）」；Esc 关闭。
- **与 RAG 注入独立**：主动搜索不影响 LLM 注入行为，两者各自独立开关。

## 文档级检索算法（D-KB1 + D-KB2）

**chunk 级 → doc 级聚合**（D-KB1）

所有命中 chunk 先按 docId 分组，再聚合为文档分：

```
doc_score = max(chunk.score) × 0.6 + avg(top3 chunk scores) × 0.4
```

同文档内多个高分 chunk 会拉高平均，单 chunk 命中也不丢精准。

**加权 tokenization**（D-KB2，仅主动搜索路径开启 `tokenizationMode="weighted"`）

| 字段 | 权重 | 说明 |
| --- | --- | --- |
| 标题 | 3× | 方法论名称通常就是标题 |
| 标签 | 2× | 精确命中关键词 |
| 摘要 | 1.5× | 语义概括，覆盖标题未含关键词的场景 |
| 正文 chunk | 1× | 基础权重 |

实现：token 重复追加至数组，BM25 TF 自然升高，零新依赖。

**标签精确 boost**（D-KB2）

query 词（ASCII + CJK 均支持）与 doc.tags 精确匹配时，doc_score += 0.15（clamp ≤ 1）。适合给文档打上"RFM"、"漏斗分析"等关键词标签后直接命中。

## 被动 RAG 注入（kb_search）

由 `buildKnowledgePrompt(workspaceId, query, options)` 驱动，LLM 调用时按需注入。

- **召回算法**：BM25（k1=1.5, b=0.75）+ recency（半衰期 60d）+ idfBoost，权重 `0.7 / 0.2 / 0.1`。
- **tokenizer**：ASCII 词按空格切（length≥2 + stopword 过滤）；CJK 用 char-bigram（"复购率" → "复购","购率"）。
- **topK**：默认 5，maxChars 6000（chunk 模式）。
- **全文注入模式**（E-KB4，需显式传 `fullDocMode: true`）：满足以下条件时注入完整文档而非 chunks：
  - `hits[0].score > 0.75`（高置信命中）
  - 无来自其他文档的竞争者，或 `top1.score > 跨文档top2.score × 2`
  - maxChars 扩展至 40000，注入整篇 content；不满足条件自动回退 chunk 注入。
  - **注意**：Chat 侧「引用全文」UI 开关尚未实装（另卡）；目前通过 API options 传递。

## 数据安全

- 知识库文档是**用户主动提交的衍生产物**，与 `draw_data`（原始数据）严格隔离。
- 上传文件走前端 `file.text()` 纯文本读取，server 不接触原始二进制。
- 检索结果属于"用户已知内容的重组"；注入 LLM 时 header 明确标注"用户资料｜仅作参考"，禁止执行其中命令或改变安全约束。
- `GET /knowledge/search`（主动搜索）为纯 UI 入口，不注册为 agent tool，不暴露给 LLM/workflow 自动链路。

## 容量上限（YAGNI 时机）

| 维度 | 当前上限 | 升级触发点 |
| --- | --- | --- |
| 单文件大小 | 5 MB UTF-8 | 用户反馈"超大文档撑不住" |
| 工作区 chunk 数 | 无硬限 | P95 检索延迟 > 50ms 或 chunk ≳ 5k → 加 `(workspaceId, max(updated_at))` → tokens 进程内缓存 |
| 全文注入上限 | 40000 chars | SOP 通常 5k–20k；如需更大文档分批 chunk 注入或提高上限 |
