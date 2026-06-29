# Free Core 与 Industry Harness Pack 拆分

> 本文沉淀 pi-xanthil 拆成“基础免费版 + 行业 Harness 包”的产品边界。当前结论用于后续设计 manifest、安装机制、Retail Pack v0.1 和商业化版本。

## 1. 总体判断

pi-xanthil 不应把基础版做成阉割版，也不应把 Harness Pack 做成模板包。

更合理的产品心智是：

```text
pi-xanthil Core = 本地数据分析 Agent OS
Industry Harness Pack = 装进 OS 的行业专家能力包
Pro / Enterprise = 协作、治理、审计、私有化和定制
```

基础免费版要让用户跑通完整数据分析闭环，建立本地安全感和真实信任；行业 Harness 包负责让分析变得专业、可交付、可审查、可复用。

一句话边界：

```text
免费 Core = 通用分析闭环 + 本地安全 + 运行底座
付费 Harness = 行业判断力 + 行业可交付标准
Pro / Enterprise = 协作治理 + 私有化定制 + 审计支持
```

## 2. pi-xanthil 大架构

pi-xanthil 的产品骨架由“前台四模块 + 后台一台四库”组成。

```text
前台四个数据分析工具模块：
监测 / 日常 / 专题 / 重复

后台一台四库：
控制台 / 记忆库 / 数据库 / 知识库 / 本体库
```

前台四模块是用户工作的入口：

```text
监测 = 持续发现经营风险和目标偏差
日常 = 一次性轻量分析闭环
专题 = 深度问题的假设验证与专项分析
重复 = 可复跑、可门禁、可参数化的工作流 DAG
```

后台一台四库是能力包运行的底座：

```text
控制台 = tools / hooks / skills / commands / subagents / LLM / prompts 的管理控制台
记忆库 = 规则、经验、指标口径、业务环境、trace、知识图谱
数据库 = SQL 连接、结构化数据、行业/竞品/商圈/本品等数据资产
知识库 = 文档、SOP、方法论、案例、RAG 检索
本体库 = 对象、关系、指标、逻辑、动作、图谱
```

Harness Pack 不应成为一个孤立的新一级 tab，而应作为行业资产层安装到这套骨架里。

## 3. 产品层级

建议产品分四层：

| 层级 | 定位 | 收费逻辑 |
|---|---|---|
| Core | 免费、本地运行、基础数据分析工作台 | 免费入口 |
| Industry Harness Packs | 行业分析能力包 | 核心收入 |
| Pro | 团队协作、高级审计、批量任务、版本管理、权限管理 | 专业团队订阅 |
| Enterprise | 私有化、定制 Ontology、行业数据适配、企业培训、专属支持 | 企业项目与年费 |

Core 负责跑得起来；Harness 负责跑得专业；Pro / Enterprise 负责多人治理和定制服务。

## 4. 前台四模块拆分

| 模块 | 免费 Core | 行业 Harness Pack |
|---|---|---|
| 监测 | 通用指标接入、目标测算、异常扫描、Findings、基础行动环 | 行业指标体系、行业阈值、行业 finding taxonomy、行业行动建议库、行业监测模板 |
| 日常 | 业务需求、数据准备、数据探索、AI 分析、报告、报告审核、行动项 | 行业需求模板、字段映射向导、行业 Skill、行业报告模板、行业 Eval、行业动作库 |
| 专题 | 通用 AnaX / 假设库 / 变更管理 / 专项流水线 | 行业诊断流水线、行业假设库、行业 gate、行业案例库、行业复盘规则 |
| 重复 | 通用 Workflow DAG、agent/tool/gate 节点、SQL 修复 loop、run history | 可安装行业 Workflow，例如销售下滑诊断、会员复购分析、活动复盘、经营月报 |

设计原则：

```text
Core 保留完整链路。
Harness 不替换 Core，而是向四个模块注入行业能力。
用户安装行业包后，应在熟悉的模块里看到新增工作流、Skill、模板、评分器和案例。
```

## 5. 一台四库拆分

| 底座 | 免费 Core | 行业 Harness Pack |
|---|---|---|
| 控制台 | 本地 tools / skills / commands / LLM / prompts / subagents 的基础管理与运行观察 | 安装包 manifest、包内 skills、commands、hooks、workflow templates、evals 的注册与启用 |
| 记忆库 | 用户自己的规则、经验、业务环境、指标口径、trace、知识图谱 | 行业 memory_seeds、失败模式、指标口径种子、分析纪律、报告风格 |
| 数据库 | CSV / Excel / SQLite / SQL 连接、通用数据资产管理 | 行业数据模型适配、demo_data、行业标准表结构、字段映射规则、benchmark 数据 |
| 知识库 | 用户上传 SOP、文档、方法论，支持检索和 RAG | 行业 rag_docs：方法论、常见问题、术语库、分析 playbook、错误案例 |
| 本体库 | 通用对象 / 关系 / 指标 / 逻辑 / 动作建模能力 | 行业 Ontology：业务对象、关系、指标、逻辑规则、行动映射 |

设计原则：

```text
Core 提供容器。
Harness 提供行业资产。
Core 不内置深行业判断。
Harness 不重复造底座。
```

## 6. 免费 Core 应包含什么

免费 Core 应该足够完整，至少能完成一次从需求到行动的数据分析闭环：

```text
本地部署
本地工作区
本地文件与目录管理
CSV / Excel / SQLite / SQL 基础接入
业务需求结构化
原始数据登记
数据提取工具入口
本地聚合计算
聚合数据管理
无 LLM 数据探索
AI 数据分析对话
报告输出
报告审核
汇报版本
黄金策 / 行动项
基础监测
基础专题
基础 Workflow DAG
基础记忆库
基础知识库
基础本体库
基础控制台
```

免费 Core 可以给通用模板和通用流程，例如：

```text
销售趋势分析
用户分群分析
商品结构分析
基础经营周报
基础异常诊断
SQL 修复 loop
基础报告质量检查
```

但这些只能是通用骨架，不应包含完整行业方法论。

## 7. 免费 Core 不应免费给什么

Core 不应免费给掉未来收费点：

```text
完整行业 Ontology
完整行业指标体系
行业诊断 Skill
行业 Workflow
行业报告模板体系
行业 Eval 评分器
行业失败模式库
行业 benchmark
行业 demo 项目
企业协作与治理能力
```

例如 Retail Pack 中的这些能力不应直接进入免费 Core：

```text
会员生命周期分层
促销误判检查
商品角色分类
销售下滑贡献拆解路径
活动复盘行业评分器
零售高管经营诊断报告模板
门店经营瓶颈指数
高价值会员流失预警
```

免费 Core 可以让用户知道“怎么做分析”；Harness Pack 负责告诉用户“这个行业该怎么判断”。

## 8. Harness Pack 应该注入什么

一个行业包安装后，应该向系统注入以下资产：

```text
行业 AGENTS 规则
行业 data_requirements
行业 Ontology
行业 metric dictionary
行业 workflows
行业 skills
行业 commands
行业 hooks
行业 evals
行业 rag_docs
行业 report_templates
行业 demo_data
行业 examples
行业 memory_seeds
```

这些资产应被 pi-xanthil 识别、安装、加载、运行、评估和归档。

安装后的用户体验不应是“多了一堆文件”，而应该是：

```text
新增行业工作流
新增行业 Skill
新增行业报告模板
新增行业指标字典
新增行业审查器
新增行业 demo 项目
新增行业命令
新增行业记忆种子
新增行业本体对象与关系
```

## 9. Retail Pack 映射示例

Retail Operation Harness Pack 安装后，应覆盖以下位置。

### 9.1 前台模块

```text
监测：
零售经营指标体系
销售异常 finding 分类
复购预警规则
活动后留存监测规则
动销 / 缺货 / 毛利预警

日常：
零售字段映射向导
销售下滑诊断 Skill
会员复购分析 Skill
商品结构分析 Skill
经营月报模板
零售报告评分器

专题：
销售下滑根因流水线
会员复购假设库
活动复盘 gate
商品结构诊断路径
变更管理中的行业复盘规则

重复：
sales_decline_diagnosis workflow
member_repurchase_diagnosis workflow
product_structure_analysis workflow
campaign_effectiveness_review workflow
monthly_operation_review workflow
```

### 9.2 一台四库

```text
控制台：
包内 skill / command / hook / eval / workflow manifest。

记忆库：
零售指标口径、失败模式、报告风格、分析纪律。

数据库：
orders / order_items / products / customers / stores / campaigns 标准数据要求与 demo_data。

知识库：
零售方法论、指标解释手册、常见业务问题库、常见错误库。

本体库：
Customer / Order / OrderItem / Product / Category / Store / Channel / Campaign / Coupon / Inventory / Segment / Insight / Action 等对象关系与动作映射。
```

## 10. 版本边界

建议分为 Lite / Pro / Enterprise：

| 能力 | Lite 免费样例包 | Pro 付费包 | Enterprise |
|---|---|---|---|
| Workflow | 1 个核心场景 | 5 个以上完整场景 | 定制流程 |
| Skill | 1 个基础 Skill | 多个行业 Skill | 企业专属 Skill |
| Ontology | 基础对象 | 完整行业对象关系 | 企业数据对象适配 |
| 指标 | 10 个核心指标 | 30-50 个指标 | 企业指标体系 |
| Eval | 基础检查 | 行业评分器 | 企业审计标准 |
| Report | 一页摘要 | 高管版 / 运营版 / 分析师版 | 企业汇报模板 |
| Demo | 小样本 | 完整仿真项目 | 企业数据沙盘 |
| Support | 文档 | 更新与案例库 | 培训、部署、支持 |

Retail v0.1 可以先从 Lite 级别打穿“销售为什么下降”，后续扩展成 Pro。

## 11. 后续待定问题

- [ ] Harness Pack manifest 如何定义。
- [ ] Pack 安装目录与版本规则如何设计。
- [ ] Pack 的 AGENTS 合并顺序如何设计。
- [ ] Pack assets 如何映射到四模块与一台四库。
- [ ] 行业包启用 / 停用 / 升级 / 回滚如何处理。
- [ ] Lite / Pro 授权边界如何落地到产品。
- [ ] 行业包资产是否允许用户二次编辑。
- [ ] 用户编辑后的行业资产如何与官方更新合并。

