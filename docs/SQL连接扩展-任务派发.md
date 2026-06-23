# SQL 连接扩展 · 任务派发书

> 总控生成 · 2026-06-23。目标：把「数据库 → SQL连接」从只读查询增强为可产品化的数据管理入口，补齐导出、创建库表、导入表能力，同时保留 LLM / workflow 链路只读边界。

---

## 0. 现状结论

- 已有能力：SQLite / PostgreSQL / MySQL 连接管理、schema 浏览、安全查询、查询结果预览、CSV 导出、watermark 增量导出。
- 当前限制：`validateSql()` 把 `CREATE` / `INSERT` / `UPDATE` / `DELETE` / `DROP` / `ALTER` 等 DDL / DML 判为危险操作，普通 query/export 接口会拒绝。
- 缺口：没有独立的「表管理 / 导入 / 建库建表」产品入口，导出也只有 query → CSV。

---

## 1. 安全口径

1. 普通查询框继续只允许 SELECT，不放开危险 SQL。
2. 写操作必须走单独 API 和单独 UI，不允许从 query 接口绕过。
3. DROP / 覆盖导入 / 清空表等破坏性动作必须二次确认。
4. LLM / workflow / subagent 链路只能调用现有只读 query 能力，不得调用导入、建表、写入 API。
5. 导入来源必须是用户显式选择的本地文件或已登记路径，不自动读取 `draw_data` 明细给 LLM。
6. SQLite 新建库文件必须限制为用户显式选择路径；导入过程事务化，失败回滚。

---

## 2. 卡片与依赖

```
X-SQL0 契约与红线
  ├─ D-SQL1 后端能力
  │    └─ D-SQL2 前端产品化
  └─ E-SQL3 安全回归 / agent 只读边界
```

---

## 3. 任务卡

### X-SQL0 · 契约与红线

- 审定新增 API 签名、风险等级、确认策略。
- 审定导入 preview / commit 两阶段协议。
- 审定普通 query 接口保持只读，写接口独立。
- 审定 LLM / workflow 不可触达写接口的边界。

验收：types / API 契约明确，D/E 可据此实现。

### D-SQL1 · 后端能力

- SQLite：创建 `.db` 文件、创建表、导入 CSV / Excel / JSON 为新表或追加表。
- PostgreSQL / MySQL：创建表、追加导入，危险覆盖动作先保守不做或强确认。
- 导出：支持 query/table 导出 CSV / JSON，Excel 视现有依赖情况决定是否第一版纳入。
- schema：写操作后刷新 schema。
- trace：写入导入、建表、导出事件。

验收：server typecheck + 单测；SQLite 本地 smoke 跑通。

### D-SQL2 · 前端产品化

- `SqlConnectPane` 拆为「查询 / 导出 / 导入建表」三块。
- 查询保留现状，不放开 DDL/DML。
- 导入建表支持文件选择、字段类型推断、预览、表名校验、导入模式选择。
- 高风险动作二次确认，错误明确展示。

验收：web typecheck + build；浏览器跑通 SQLite 导入新表、追加导入、导出。

### E-SQL3 · 安全回归 / agent 只读边界

- 确认 workflow / multi-agent / subagent 现有 SQL 调用仍走只读 query。
- 增加回归测试或 grep 门禁，确保 LLM 相关链路不调用导入、建表、写入 API。
- 给 SQL loop / workflow 场景补充「危险 SQL 被拒」用例。

验收：engine 相关测试绿；危险 SQL 在自动链路中仍被拒。

---

## 4. 第一版建议范围

第一版优先 SQLite：

- 新建 SQLite DB 文件
- CSV / Excel / JSON 导入为新表
- 追加导入
- 表 / 查询结果导出 CSV / JSON
- 前端导入预览与风险确认
- 自动链路只读边界测试

PostgreSQL / MySQL 第一版保留查询与导出，导入写入可作为 follow-up，除非 D-SQL1 实现成本低且有明确事务保护。
