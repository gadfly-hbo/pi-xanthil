import type { Tab } from '@/components/MainHeader';

export type SubTab = 'view' | 'business_requirement' | 'business_context' | 'readme' | 'hypothesis' | 'extraction' | 'draw_data' | 'clean_data' | 'data_exploration' | 'report' | 'presentation_version' | 'golden_strategy' | 'decision_tree' | 'toc' | 'skill' | 'tool' | 'model' | 'rules' | 'indicators' | 'cases' | 'trace' | 'token_stats' | 'the-crowd' | 'digital_life' | 'sql_connect' | 'operational_model' | 'change_mgmt' | 'knowledge_graph' | 'run_history';

export const SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'golden_strategy', label: '黄金策' }];

export const VIEW_ONLY_TABS = new Set<Tab>(['aggregate', 'research_lab', 'anax', 'dashboard']);

export const AGGREGATE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '聚合计算' }, { id: 'extraction', label: '数据提取' }, { id: 'sql_connect', label: 'SQL连接' }];

export const LAB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: 'workflow' }, { id: 'skill', label: 'skill' }, { id: 'tool', label: 'tool' }, { id: 'model', label: 'model' }];

export const RULE_MEMORY_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'rules', label: 'rules' }, { id: 'business_context', label: '业务环境' }, { id: 'indicators', label: '指标体系' }, { id: 'cases', label: '分析案例库' }, { id: 'trace', label: 'trace' }, { id: 'knowledge_graph', label: '知识图谱' }];

export const XAN_DB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'the-crowd', label: 'the-crowd' }, { id: 'digital_life', label: '数字生命体' }];

export const ANAX_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }, { id: 'readme', label: 'readme' }];

export const DASHBOARD_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: 'BI' }, { id: 'run_history', label: '运行历史' }];

export function getSubTabsForTab(tab: Tab): { id: SubTab; label: string }[] {
  if (tab === 'aggregate') return AGGREGATE_SUB_TABS;
  if (tab === 'research_lab') return LAB_SUB_TABS;
  if (tab === 'rule_memory') return RULE_MEMORY_SUB_TABS;
  if (tab === 'xan_db') return XAN_DB_SUB_TABS;
  if (tab === 'anax') return ANAX_SUB_TABS;
  if (tab === 'dashboard') return DASHBOARD_SUB_TABS;
  if (VIEW_ONLY_TABS.has(tab)) return SUB_TABS.slice(0, 1);
  return SUB_TABS;
}
