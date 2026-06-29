# harness-packs 项目记忆与工作约定

> 本文件是 pi-xanthil 子项目 `harness-packs` 的项目级记忆与系统提示词。后续关于 Industry Harness Pack 的讨论、决策、边界、待办与阶段性结论，优先更新到本文件或本目录下的专题文档。

## 1. 项目定位

`harness-packs` 是 pi-xanthil 的行业能力包子项目。

核心方向：

```text
pi-xanthil Core = 免费、本地运行的数据分析 Agent 工作台
Industry Harness Packs = 付费、可安装、可运行、可评估的行业专家能力包
Enterprise = 私有化、定制、培训、审计、协作增强
```

本项目不把 Harness Pack 做成 Prompt 合集或模板包，而是把行业数据分析师的工作方式封装为 pi-xanthil 可识别、可安装、可运行、可审查、可复用、可持续进化的行业分析能力包。

一句话定义：

```text
免费版给工具，付费 Harness Pack 给行业判断力。
```

## 2. 商业化理解

pi-xanthil 的早期商业化不应优先卖软件本体，而应先让 Core 成为本地数据分析 Agent 工作台入口。

基础版免费的目的：

```text
降低安装门槛
降低试用门槛
建立本地安全感
形成真实使用习惯
积累案例与行业样板
验证数据分析工作流
```

后续收费重点：

```text
行业 Ontology
行业指标口径库
行业 Workflow
行业 Skill
行业 Eval
行业报告模板
行业失败模式库
行业 Demo 项目
企业定制与私有化服务
```

不采用一开始按 SaaS 座位收费的思路，而是优先采用：

```text
Free Core + Paid Industry Harness
```

## 3. 产品分层

建议产品分为四层：

```text
第一层：pi-xanthil Core
免费，本地运行，基础数据分析工作台。

第二层：pi-xanthil Industry Harness Packs
付费，行业分析能力包，是核心收入来源。

第三层：pi-xanthil Pro
付费，团队协作、高级审计、批量任务、版本管理、权限管理。

第四层：pi-xanthil Enterprise
私有化、定制 Ontology、行业数据适配、企业培训、专属支持。
```

## 4. pi-xanthil 大架构拆分

pi-xanthil 的产品骨架不是单一 Chat，而是：

```text
前台四个数据分析工具模块：
监测 / 日常 / 专题 / 重复

后台一台四库：
控制台 / 记忆库 / 数据库 / 知识库 / 本体库
```

四个前台模块的定位：

```text
监测 = 持续发现经营风险和目标偏差。
日常 = 一次性轻量分析闭环。
专题 = 深度问题的假设验证与专项分析。
重复 = 可复跑、可门禁、可参数化的工作流 DAG。
```

一台四库的定位：

```text
控制台 = AI 工程基元管理，管 tools / hooks / skills / commands / subagents / LLM / prompts。
记忆库 = 长期上下文中枢，管规则、经验、指标口径、业务环境、trace、知识图谱。
数据库 = 结构化数据与外部数据资产，管 SQL 连接、行业 / 竞品 / 商圈 / 本品等数据面。
知识库 = 非结构化参考资料库，管文档、SOP、方法论、RAG 检索。
本体库 = 数据语义层，管对象、关系、指标、逻辑、动作、图谱。
```

基础免费版不应砍掉这套骨架，而应保留通用容器和通用能力；Harness Pack 作为行业资产层安装到这套骨架里。

产品心智：

```text
pi-xanthil Core 是本地数据分析 Agent OS。
Harness Pack 是装进 OS 的行业能力包。
四个前台模块是用户的工作场景。
一台四库是能力包运行所依赖的底层系统。
```

详细拆分见：

```text
harness-packs/free-core-vs-harness-pack.md
```

## 5. Core 与 Harness 的边界

免费 Core 负责：

```text
跑得起来
通用分析闭环
本地安全
工作区与文件管理
基础数据接入
基础 AI 工程基元
基础记忆 / 知识 / 本体容器
基础监测 / 日常 / 专题 / 重复模块
```

Harness Pack 负责：

```text
跑得专业
行业判断力
行业 Ontology
行业指标口径
行业 Workflow
行业 Skill
行业 Eval
行业报告模板
行业失败模式
行业 Demo 项目
```

Pro / Enterprise 负责：

```text
多人协作
治理审计
权限与版本管理
批量任务
私有化部署
企业定制
培训与支持
```

关键边界：

```text
免费 Core = 通用分析闭环 + 本地安全 + 运行底座
付费 Harness = 行业判断力 + 行业可交付标准
Pro / Enterprise = 协作治理 + 私有化定制 + 审计支持
```

## 6. Harness Pack 标准结构

一个完整行业 Harness Pack 应包含：

```text
AGENTS.industry.md
data_requirements/
ontology/
workflows/
skills/
commands/
hooks/
evals/
rag_docs/
report_templates/
demo_data/
examples/
memory_seeds/
README.md
```

这些资产共同构成：

```text
角色规则
行业语义
指标体系
分析流程
工具约束
质量审查
报告模板
案例样本
失败经验
复用 Skill
```

## 7. Harness Pack 的护城河

真正壁垒不在 Prompt，而在以下资产的持续积累：

```text
行业对象关系
指标口径与误用边界
分析路径库
失败模式库
Eval 评分器
真实案例迭代
Memory Seeds
```

每服务一个真实客户，应把可泛化经验沉淀回 Harness Pack。

## 8. 第一阶段行业包选择

第一阶段优先做三个包：

```text
1. Retail Operation Harness Pack
   零售经营分析包。

2. Brand Consumer Insight Harness Pack
   品牌消费者画像包。

3. Trade Area & Site Selection Harness Pack
   商圈人群画像与选址包。
```

当前第一颗钉子：

```text
Retail Operation Harness Pack v0.1
```

## 9. Retail Operation Harness Pack 定位

第一版不做全零售，先聚焦：

```text
连锁零售
电商零售
品牌私域运营
```

v1.0 目标覆盖五个高频问题：

```text
1. 销售为什么涨跌？
2. 哪些商品、品类、门店、渠道贡献最大？
3. 会员复购出了什么问题？
4. 活动到底有没有效果？
5. 下个月经营动作应该优先做什么？
```

v0.1 只打穿一个核心场景：

```text
销售为什么下降？
```

v0.1 必须形成完整闭环：

```text
上传数据
字段映射
数据侦察
指标口径确认
销售下降诊断计划
SQL / Python 分析
图表与证据链
高管经营诊断报告
Eval 自动评分
归档为经验 / Memory
```

Retail Harness Pack 安装后，应该覆盖四个前台模块和一台四库：

```text
监测：
零售经营指标体系、销售异常 finding 分类、复购预警规则、活动后留存监测规则。

日常：
零售字段映射向导、销售下滑诊断 Skill、经营月报模板、零售报告评分器。

专题：
销售下滑根因流水线、会员复购假设库、活动复盘 gate、商品结构诊断路径。

重复：
sales_decline_diagnosis workflow
member_repurchase_diagnosis workflow
campaign_effectiveness_review workflow
monthly_operation_review workflow

控制台：
包内 skill / command / hook / eval / workflow manifest。

记忆库：
零售指标口径、失败模式、报告风格、分析纪律。

数据库：
orders / order_items / products / customers / stores / campaigns 标准数据要求与 demo_data。

知识库：
零售方法论、指标解释手册、常见业务问题库、常见错误库。

本体库：
零售对象、关系、指标、逻辑规则、行动映射。
```

## 10. Retail v0.1 最小资产集

Retail Operation Harness Pack v0.1 至少包含：

```text
AGENTS.retail.md
required_tables.md
field_mapping_guide.md
retail_business_objects.md
retail_metrics_dictionary.md
sales_decline_diagnosis.md
executive_report_template.md
retail_report_eval.md
demo_data/
sales_decline_example_report.md
```

第一版只解决一个问题：

```text
销售为什么下降？
```

但必须做到：

```text
指标口径清楚
数据证据充分
根因拆解合理
建议可执行
报告可交付
Eval 可评分
Memory / Skill 可沉淀
```

## 11. 销售下滑诊断核心路径

销售下滑诊断必须遵循以下拆解逻辑：

```text
销售额 = 订单数 × 客单价
订单数 = 购买用户数 × 人均购买次数
购买用户数 = 新客购买用户 + 老客购买用户
销售贡献 = 商品贡献 + 渠道贡献 + 门店贡献 + 活动贡献 + 时间贡献
```

Agent 必须按顺序分析：

```text
1. 确认下降是否真实存在。
2. 判断下降发生在哪个时间段。
3. 拆销售额：订单数问题还是客单价问题。
4. 拆用户：新客、老客、高价值会员。
5. 拆商品：爆品、腰部商品、长尾商品、价格带、品类。
6. 拆渠道：线上、线下、私域、平台。
7. 拆门店/区域：是否局部问题。
8. 拆活动：活动节奏、优惠力度、触达不足、透支效应。
9. 检查异常：缺货、退款、测试订单、数据延迟、渠道迁移。
10. 输出根因优先级、行动建议和验证计划。
```

## 12. 销售诊断禁止行为

零售包必须显式禁止以下行为：

```text
不得在未确认指标口径时直接给结论。
不得只用销售额趋势图判断根因。
不得只看 GMV，不看实付销售额、净销售额、毛利和退款。
不得把活动期间增长直接等同于活动有效。
不得把相关性写成因果。
不得忽略缺货、退款、渠道迁移、活动节奏和数据延迟。
不得输出无法执行的建议。
```

## 13. Retail 数据要求初稿

第一版支持：

```text
CSV
Excel
SQLite
```

最小必需表：

```text
orders
order_items
products
customers
```

可选增强表：

```text
stores
campaigns
inventory
refunds
```

字段映射应尽量通过自然语言向导完成，避免要求用户长期手写 JSON。

## 14. Retail Eval 初稿

零售分析报告评分建议总分 100 分：

```text
问题定义：10 分
数据可信度：15 分
指标口径：15 分
分析拆解：20 分
洞察质量：15 分
行动建议：15 分
表达交付：10 分
```

交付门槛：

```text
90 分以上：可作为高质量报告交付
80-89 分：可交付，但建议优化
70-79 分：需要返工
70 分以下：不得正式交付
```

Eval 是 Harness Pack 区别于普通模板包的关键资产。

## 15. 初始待办

### 15.1 讨论与定义

- [x] 明确 `harness-packs` 在 pi-xanthil 中的产品边界。
- [ ] 明确 Harness Pack 的安装、加载、运行、评分、归档机制。
- [x] 明确 Core 免费版与 Harness Pack 付费版的能力边界。
- [ ] 明确 Lite / Pro / Enterprise 的资产拆分。
- [ ] 明确第一个 Retail v0.1 的交付标准。

### 15.2 Retail v0.1 文档资产

- [ ] 创建 Retail Pack 目录结构。
- [ ] 编写 `AGENTS.retail.md`。
- [ ] 编写 `required_tables.md`。
- [ ] 编写 `field_mapping_guide.md`。
- [ ] 编写 `retail_business_objects.md`。
- [ ] 编写 `retail_metrics_dictionary.md`。
- [ ] 编写 `sales_decline_diagnosis.md`。
- [ ] 编写 `executive_report_template.md`。
- [ ] 编写 `retail_report_eval.md`。
- [ ] 设计 `demo_data` 数据结构与业务问题。
- [ ] 编写 `sales_decline_example_report.md`。

### 15.3 pi-xanthil 产品机制

- [ ] 设计 Harness Pack manifest。
- [ ] 设计能力包安装目录与版本规则。
- [ ] 设计 Pack 加载顺序与 AGENTS 合并规则。
- [ ] 设计 Workflow / Skill / Command 在 UI 中的暴露方式。
- [ ] 设计 Eval 执行与评分结果展示方式。
- [ ] 设计 Memory Seeds 导入和项目记忆沉淀机制。

### 15.4 商业化

- [x] 定义 Free Core 能力清单。
- [ ] 定义 Retail Lite 免费样例包能力清单。
- [ ] 定义 Retail Pro 付费包能力清单。
- [ ] 定义价格与授权方式初稿。
- [ ] 定义企业定制服务边界。

## 16. 后续更新规则

后续讨论中，如果形成稳定结论，应更新到本文件或拆分到本目录专题文档。

更新原则：

```text
结论优先
保留产品边界
保留待办状态
不要把临时想法直接当成已决策
重要变更记录原因
```

建议后续专题文档：

```text
retail-operation-pack-plan.md
harness-pack-manifest-spec.md
free-core-vs-harness-pack.md
retail-v0.1-delivery-checklist.md
commercialization-notes.md
```
