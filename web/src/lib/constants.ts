import type { Tab } from '@/components/MainHeader';

export type SubTab = 'view' | 'business_requirement' | 'business_context' | 'readme' | 'hypothesis' | 'extraction' | 'draw_data' | 'clean_data' | 'data_exploration' | 'report' | 'presentation_version' | 'report_review' | 'golden_strategy' | 'decision_tree' | 'toc' | 'skill' | 'tool' | 'model' | 'rules' | 'indicators' | 'cases' | 'trace' | 'token_stats' | 'the-crowd' | 'weather' | 'business_district' | 'industry' | 'competitor' | 'sql_connect' | 'operational_model' | 'change_mgmt' | 'knowledge_graph' | 'model_history' | 'report_history' | 'dlf' | 'quick_notes' | 'tool_use' | 'failure_memory' | 'process_memory' | 'anax_view' | 'anax_chat' | 'hooks_mgmt' | 'skills_mgmt' | 'command_mgmt' | 'plugin_mgmt' | 'subagents_mgmt' | 'llm_mgmt' | 'onto_readme' | 'onto_objects' | 'onto_links' | 'onto_metrics' | 'onto_logic' | 'onto_actions' | 'onto_graph' | 'onto_import' | 'actions';

export const SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }];

// 日常(explore) tab 专用排序：view 改名「数据分析」并移至数据探索之后（重复(multi) 仍用 SUB_TABS，工作视图保持首位）。
export const EXPLORE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'view', label: '数据分析' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'readme', label: 'readme' }];

// 重复(multi) tab 专用：在 SUB_TABS 基础上追加「readme」操作说明二级 tab（结合案例讲解重复模块；其产物仍称工作流）。
export const MULTI_SUB_TABS: { id: SubTab; label: string }[] = [...SUB_TABS, { id: 'readme', label: 'readme' }];

export const VIEW_ONLY_TABS = new Set<Tab>(['aggregate', 'research_lab', 'dashboard']);

// onto-xanthil 数据语义层二级 tab（详见 docs/onto-xanthil-design.md）。导入(import)为 P3。
export const ONTO_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'onto_readme', label: '说明' }, { id: 'onto_objects', label: '对象' }, { id: 'onto_links', label: '关系' }, { id: 'onto_metrics', label: '指标' }, { id: 'onto_logic', label: '逻辑' }, { id: 'onto_actions', label: '动作' }, { id: 'onto_graph', label: '图谱' }, { id: 'onto_import', label: '导入' }];

export const AGGREGATE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '聚合计算' }, { id: 'extraction', label: '数据提取' }, { id: 'sql_connect', label: 'SQL连接' }, { id: 'tool_use', label: 'tool-use' }, { id: 'hooks_mgmt', label: 'hooks管理' }, { id: 'skills_mgmt', label: 'skills管理' }, { id: 'command_mgmt', label: 'command管理' }, { id: 'plugin_mgmt', label: '插件管理' }, { id: 'subagents_mgmt', label: 'subagents管理' }, { id: 'llm_mgmt', label: 'LLM管理' }, { id: 'readme', label: 'readme' }];

// 实验室 = research_lab：workflow/skill/tool/model/DLF。
// AnaX 已于 2026-06-18 提升为一级「专题」tab（ZHUANTI_SUB_TABS），迁出实验室。
export const LAB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: 'workflow' }, { id: 'skill', label: 'skill' }, { id: 'tool', label: 'tool' }, { id: 'model', label: 'model' }, { id: 'dlf', label: 'DLF' }];

// 专题(zhuanti) = AnaX 提升为一级 tab，做成「对话探索 + 流水线」双模并列、互相 seed，并对齐探索的数据/报告链路。
// 全部 14 个二级 tab（供 getSubTabsForTab / 可见性 / 默认 subtab）。
// 混合导航(2026-06-18，用户方案C)：左侧竖栏 = ZHUANTI_SIDEBAR_TABS(核心 5 项)；顶部横条 = 其余 9 项数据/报告链路(= 全集排除 ZHUANTI_SIDEBAR_IDS)。
export const ZHUANTI_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'anax_chat', label: '对话探索' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'anax_view', label: '流水线' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }, { id: 'readme', label: 'readme' }];
// 专题左侧竖栏：核心 5 项（对话探索/流水线/假设库/变更管理/readme）。
export const ZHUANTI_SIDEBAR_TABS: { id: SubTab; label: string }[] = [{ id: 'anax_chat', label: '对话探索' }, { id: 'anax_view', label: '流水线' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }, { id: 'readme', label: 'readme' }];
export const ZHUANTI_SIDEBAR_IDS = new Set<SubTab>(['anax_chat', 'anax_view', 'hypothesis', 'change_mgmt', 'readme']);

// 规则记忆二级 tab：Persona / Knowhow / 项目记忆 / 失败记忆 / 思维模式 + 业务环境 / trace / 知识图谱。
export const RULE_MEMORY_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'rules', label: 'Persona' }, { id: 'indicators', label: 'Knowhow' }, { id: 'cases', label: '项目记忆' }, { id: 'failure_memory', label: '失败记忆' }, { id: 'process_memory', label: '思维模式' }, { id: 'business_context', label: '业务环境' }, { id: 'trace', label: 'trace' }, { id: 'knowledge_graph', label: '知识图谱' }];

export const XAN_DB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'the-crowd', label: 'the-crowd' }, { id: 'weather', label: '天气' }, { id: 'business_district', label: '商圈' }, { id: 'industry', label: '行业' }, { id: 'competitor', label: '竞品' }];

export const DASHBOARD_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: 'BI' }, { id: 'report_history', label: '报告历史' }, { id: 'model_history', label: '模型历史' }];

export function getSubTabsForTab(tab: Tab): { id: SubTab; label: string }[] {
  if (tab === 'aggregate') return AGGREGATE_SUB_TABS;
  if (tab === 'research_lab') return LAB_SUB_TABS;
  if (tab === 'rule_memory') return RULE_MEMORY_SUB_TABS;
  if (tab === 'xan_db') return XAN_DB_SUB_TABS;
  if (tab === 'dashboard') return DASHBOARD_SUB_TABS;
  if (tab === 'onto_xanthil') return ONTO_SUB_TABS;
  if (tab === 'explore') return EXPLORE_SUB_TABS;
  if (tab === 'multi') return MULTI_SUB_TABS;
  if (tab === 'zhuanti') return ZHUANTI_SUB_TABS;
  if (VIEW_ONLY_TABS.has(tab)) return SUB_TABS.slice(0, 1);
  return SUB_TABS;
}
