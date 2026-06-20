# 知识库（Knowledge Base）

> **定位**：用户上传/登记的非结构化**参考资料**库（口径文档、SOP、行业研报、术语表等），用于按需检索而非主动注入对话上下文。

## 与统一记忆 memory_items 的区别

| 维度 | 知识库 knowledge_docs | 统一记忆 memory_items |
| --- | --- | --- |
| 性质 | 参考资料（用户主动管理） | 系统沉淀（约束/经验/事实/情景） |
| 注入策略 | **按需检索**（kb_search） | **主动注入** chat / workflow system prompt |
| 衰减 | 半衰期 60d（长期资料） | 半衰期 30d（即时学习） |
| 去重 | 不强制（用户自管） | lexical + semantic 双层 dedup |
| 数据安全位面 | folder kind `knowledge`，与 `draw_data` 隔离 | LLM 衍生条目，已过 D-INGEST 风险门禁 |

## 资料库（kb_docs）

- **上传**：当前仅接受文本（.md / .markdown / .txt / .csv / .tsv / .json / .log），单文件 ≤ 5 MB UTF-8。二进制文件（pdf / docx / xlsx）请先转 markdown 或纯文本再上传。
- **新建文档**：标题 + 内容 + 标签（英文逗号分隔）+ 来源路径（可选元数据）。保存即按段落优先策略分块（budget 1200 chars / overlap 120）入 `knowledge_chunks` 表，供 BM25 检索召回。
- **删除**：会级联删除该文档所有 chunks，不可撤销。
- **路径字段**：`path` 仅作元数据展示，server **不会**基于它做 fs 读取。任何后续把 path 用于 readFileSync 的代码必须先过 `safeResolve()` 工作区沙箱。

## 检索（kb_search）

- **召回算法**：BM25（k1=1.5, b=0.75）+ recency（半衰期 60d）+ idfBoost，权重 `0.7 / 0.2 / 0.1`。
- **tokenizer**：ASCII 词按空格切（length≥2 + stopword 过滤）；CJK 用 char-bigram（"复购率" → "复购","购率"）——比单字 / 全句切分召回更准。
- **限定文档**：可选若干文档作为检索范围，未选则全工作区。
- **topK**：默认 10，上限 50。
- **打分透明**：每条命中显示 `score / rel / rec / idf` 四个数值，便于调试 ranking。命中 chunk 中的查询 token 会被高亮。

## 数据安全

- 知识库文档是**用户主动提交的衍生产物**，与 `draw_data`（原始数据）严格隔离。
- 上传文件走前端 `file.text()` 纯文本读取，server 不接触原始二进制。
- 检索结果属于"用户已知内容的重组"，可参与 LLM 调用；如未来要把 chunk 自动注入 chat / workflow system prompt，需总控决议接缝（按需 tool 调用 vs 主动注入合并）。

## 容量上限（YAGNI 时机）

| 维度 | 当前上限 | 升级触发点 |
| --- | --- | --- |
| 单文件大小 | 5 MB UTF-8 | 用户反馈"超大文档撑不住" |
| 工作区 chunk 数 | 无硬限 | P95 检索延迟 > 50ms 或 chunk ≳ 5k → 加 `(workspaceId, max(updated_at))` → tokens 进程内缓存 |
| 文档级权重 | 同等权重 | 若需 pinned/精排诉求 → 按 tags 加 boost |
