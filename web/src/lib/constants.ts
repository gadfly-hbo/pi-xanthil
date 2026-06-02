import type { Tab } from '@/components/MainHeader';

export type SubTab = 'view' | 'extraction' | 'draw_data' | 'clean_data' | 'report' | 'decision_tree' | 'toc' | 'skill' | 'tool' | 'rules' | 'indicators' | 'cases' | 'trace' | 'token_stats' | 'the-crowd' | 'digital_life';

export const SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'report', label: '报告输出' }, { id: 'decision_tree', label: '决策树' }, { id: 'toc', label: 'TOC' }];

export const VIEW_ONLY_TABS = new Set<Tab>(['aggregate', 'research_lab', 'anax']);

export const AGGREGATE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '聚合计算' }, { id: 'extraction', label: '数据提取' }];

export const LAB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: 'workflow' }, { id: 'skill', label: 'skill' }, { id: 'tool', label: 'tool' }];

export const RULE_MEMORY_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'rules', label: 'rules' }, { id: 'indicators', label: '指标体系' }, { id: 'cases', label: '分析案例库' }, { id: 'trace', label: 'trace' }, { id: 'token_stats', label: 'token统计' }];

export const XAN_DB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'the-crowd', label: 'the-crowd' }, { id: 'digital_life', label: '数字生命体' }];

export function getSubTabsForTab(tab: Tab): { id: SubTab; label: string }[] {
  if (tab === 'aggregate') return AGGREGATE_SUB_TABS;
  if (tab === 'research_lab') return LAB_SUB_TABS;
  if (tab === 'rule_memory') return RULE_MEMORY_SUB_TABS;
  if (tab === 'xan_db') return XAN_DB_SUB_TABS;
  if (VIEW_ONLY_TABS.has(tab)) return SUB_TABS.slice(0, 1);
  return SUB_TABS;
}
