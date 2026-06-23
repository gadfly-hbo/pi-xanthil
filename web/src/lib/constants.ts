import type { Tab } from '@/components/MainHeader';

export type SubTab = 'view' | 'business_requirement' | 'business_context' | 'readme' | 'hypothesis' | 'extraction' | 'aggregate_compute' | 'draw_data' | 'clean_data' | 'data_exploration' | 'report' | 'presentation_version' | 'report_review' | 'golden_strategy' | 'decision_tree' | 'toc' | 'skill' | 'tool' | 'rules' | 'indicators' | 'cases' | 'trace' | 'token_stats' | 'the-crowd' | 'weather' | 'business_district' | 'industry' | 'competitor' | 'own_product' | 'kb_docs' | 'kb_search' | 'sql_connect' | 'operational_model' | 'change_mgmt' | 'knowledge_graph' | 'dlf' | 'quick_notes' | 'tool_use' | 'failure_memory' | 'process_memory' | 'anax_view' | 'anax_chat' | 'hooks_mgmt' | 'skills_mgmt' | 'command_mgmt' | 'plugin_mgmt' | 'subagents_mgmt' | 'llm_mgmt' | 'prompts_mgmt' | 'hooks_lab' | 'command_lab' | 'subagents_lab' | 'prompts_lab' | 'lab_overview' | 'lab_regression' | 'onto_readme' | 'onto_objects' | 'onto_links' | 'onto_metrics' | 'onto_logic' | 'onto_actions' | 'onto_graph' | 'onto_import' | 'actions' | 'health_data' | 'health_dashboard' | 'health_report' | 'health_trend';

export const SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'extraction', label: '数据提取' }, { id: 'aggregate_compute', label: '聚合计算' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'dlf', label: 'DLF' }];

// 日常(explore) tab 专用排序：view 改名「数据分析」并移至数据探索之后（重复(multi) 仍用 SUB_TABS，工作视图保持首位）。
export const EXPLORE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'extraction', label: '数据提取' }, { id: 'aggregate_compute', label: '聚合计算' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'view', label: '数据分析' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'dlf', label: 'DLF' }, { id: 'readme', label: 'readme' }];

// 重复(multi) tab 专用：在 SUB_TABS 基础上追加「readme」操作说明二级 tab（结合案例讲解重复模块；其产物仍称工作流）。
export const MULTI_SUB_TABS: { id: SubTab; label: string }[] = [...SUB_TABS, { id: 'readme', label: 'readme' }];

export const VIEW_ONLY_TABS = new Set<Tab>(['aggregate']);

// onto-xanthil 数据语义层二级 tab（详见 docs/onto-xanthil-design.md）。导入(import)为 P3。
export const ONTO_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'onto_readme', label: '说明' }, { id: 'onto_objects', label: '对象' }, { id: 'onto_links', label: '关系' }, { id: 'onto_metrics', label: '指标' }, { id: 'onto_logic', label: '逻辑' }, { id: 'onto_actions', label: '动作' }, { id: 'onto_graph', label: '图谱' }, { id: 'onto_import', label: '导入' }];

// 「实验场」= 二级 tab（顶部代表 id 复用首个子项 'skill'），其子项以左侧竖栏呈现（仿 onto/AnaX 两级嵌套，复用单一 activeSubTab）。
export const AGGREGATE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'tool_use', label: 'tool-use' }, { id: 'hooks_mgmt', label: 'hooks管理' }, { id: 'skills_mgmt', label: 'skills管理' }, { id: 'command_mgmt', label: 'command管理' }, { id: 'plugin_mgmt', label: '插件管理' }, { id: 'subagents_mgmt', label: 'subagents管理' }, { id: 'llm_mgmt', label: 'LLM管理' }, { id: 'prompts_mgmt', label: 'prompts管理' }, { id: 'skill', label: '实验场' }, { id: 'readme', label: 'readme' }];

// 实验场三级子 tab（左侧竖栏）。标签不带「实验场」尾缀。两个跨 lab 元视图：「总览」(lab_overview·P5-1)只读聚合六类评测、「回归」(lab_regression·P5-2)回归时间线+门禁；其后六 lab 均已实装。
export const LAB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'lab_overview', label: '总览' }, { id: 'lab_regression', label: '回归' }, { id: 'skill', label: 'skill' }, { id: 'tool', label: 'tool' }, { id: 'hooks_lab', label: 'hooks' }, { id: 'command_lab', label: 'command' }, { id: 'subagents_lab', label: 'subagents' }, { id: 'prompts_lab', label: 'prompts' }];
export const LAB_SUB_IDS = new Set<SubTab>(['lab_overview', 'lab_regression', 'skill', 'tool', 'hooks_lab', 'command_lab', 'subagents_lab', 'prompts_lab']);

// 专题(zhuanti) = AnaX 提升为一级 tab，做成「对话探索 + 流水线」双模并列、互相 seed，并对齐探索的数据/报告链路。
// 全部二级 tab（供 getSubTabsForTab / 可见性 / 默认 subtab）。
// 混合导航(2026-06-18，用户方案C)：左侧竖栏 = ZHUANTI_SIDEBAR_TABS(核心 5 项)；顶部横条 = 其余项数据/报告链路(= 全集排除 ZHUANTI_SIDEBAR_IDS)。
export const ZHUANTI_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'anax_chat', label: '对话探索' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'extraction', label: '数据提取' }, { id: 'aggregate_compute', label: '聚合计算' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'anax_view', label: '流水线' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'dlf', label: 'DLF' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }, { id: 'readme', label: 'readme' }];
// 专题左侧竖栏：核心 5 项（对话探索/流水线/假设库/变更管理/readme）。
export const ZHUANTI_SIDEBAR_TABS: { id: SubTab; label: string }[] = [{ id: 'anax_chat', label: '对话探索' }, { id: 'anax_view', label: '流水线' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }, { id: 'readme', label: 'readme' }];
export const ZHUANTI_SIDEBAR_IDS = new Set<SubTab>(['anax_chat', 'anax_view', 'hypothesis', 'change_mgmt', 'readme']);

// 记忆模块二级 tab：统一记忆 / onto-knowhow / 业务环境 / trace / 知识图谱 / readme。
export const RULE_MEMORY_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'rules', label: '统一记忆' }, { id: 'indicators', label: 'onto-knowhow' }, { id: 'business_context', label: '业务环境' }, { id: 'trace', label: 'trace' }, { id: 'knowledge_graph', label: '知识图谱' }, { id: 'readme', label: 'readme' }];

export const XAN_DB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'the-crowd', label: 'the-crowd' }, { id: 'weather', label: '天气' }, { id: 'business_district', label: '商圈' }, { id: 'industry', label: '行业' }, { id: 'competitor', label: '竞品' }, { id: 'own_product', label: '本品' }, { id: 'sql_connect', label: 'SQL连接' }, { id: 'readme', label: 'readme' }];

// 知识库二级 tab：资料库(上传/分类/标签) / 检索(全文+语义召回) / readme。面板与检索由 Agent-D 实装。
export const KNOWLEDGE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'kb_docs', label: '资料库' }, { id: 'kb_search', label: '检索' }, { id: 'readme', label: 'readme' }];

// 监测模块二级 tab：初始化 / 观星台 / 行动环 / readme。趋势并入观星台，不再作为独立 tab 展示。
export const HEALTH_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'health_data', label: '初始化' }, { id: 'health_dashboard', label: '观星台' }, { id: 'health_report', label: '行动环' }, { id: 'readme', label: 'readme' }];

export function getSubTabsForTab(tab: Tab): { id: SubTab; label: string }[] {
  if (tab === 'aggregate') return AGGREGATE_SUB_TABS;
  if (tab === 'rule_memory') return RULE_MEMORY_SUB_TABS;
  if (tab === 'xan_db') return XAN_DB_SUB_TABS;
  if (tab === 'knowledge_base') return KNOWLEDGE_SUB_TABS;
  if (tab === 'onto_xanthil') return ONTO_SUB_TABS;
  if (tab === 'explore') return EXPLORE_SUB_TABS;
  if (tab === 'multi') return MULTI_SUB_TABS;
  if (tab === 'zhuanti') return ZHUANTI_SUB_TABS;
  if (tab === 'health') return HEALTH_SUB_TABS;
  if (VIEW_ONLY_TABS.has(tab)) return SUB_TABS.slice(0, 1);
  return SUB_TABS;
}
