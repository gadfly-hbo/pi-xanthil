import type { Tab } from '@/components/MainHeader';

export type SubTab = 'view' | 'business_requirement' | 'business_context' | 'readme' | 'hypothesis' | 'extraction' | 'draw_data' | 'clean_data' | 'data_exploration' | 'report' | 'presentation_version' | 'report_review' | 'golden_strategy' | 'decision_tree' | 'toc' | 'skill' | 'tool' | 'model' | 'rules' | 'indicators' | 'cases' | 'trace' | 'token_stats' | 'the-crowd' | 'weather' | 'business_district' | 'industry' | 'competitor' | 'sql_connect' | 'operational_model' | 'change_mgmt' | 'knowledge_graph' | 'model_history' | 'report_history' | 'dlf' | 'quick_notes' | 'tool_use' | 'failure_memory' | 'field_memory' | 'process_memory' | 'anax_view' | 'onto_readme' | 'onto_objects' | 'onto_links' | 'onto_metrics' | 'onto_logic' | 'onto_actions' | 'onto_graph' | 'onto_import' | 'actions';

export const SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }];

// 探索 tab 专用排序：view 改名「数据分析」并移至数据探索之后（multi/工作流 仍用 SUB_TABS，工作视图保持首位）。
export const EXPLORE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'view', label: '数据分析' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'readme', label: 'readme' }];

// 工作流(multi) tab 专用：在 SUB_TABS 基础上追加「readme」操作说明二级 tab（结合案例讲解工作流模块）。
export const MULTI_SUB_TABS: { id: SubTab; label: string }[] = [...SUB_TABS, { id: 'readme', label: 'readme' }];

export const VIEW_ONLY_TABS = new Set<Tab>(['aggregate', 'research_lab', 'dashboard']);

// onto-xanthil 数据语义层二级 tab（详见 docs/onto-xanthil-design.md）。导入(import)为 P3。
export const ONTO_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'onto_readme', label: '说明' }, { id: 'onto_objects', label: '对象' }, { id: 'onto_links', label: '关系' }, { id: 'onto_metrics', label: '指标' }, { id: 'onto_logic', label: '逻辑' }, { id: 'onto_actions', label: '动作' }, { id: 'onto_graph', label: '图谱' }, { id: 'onto_import', label: '导入' }];

export const AGGREGATE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '聚合计算' }, { id: 'extraction', label: '数据提取' }, { id: 'sql_connect', label: 'SQL连接' }, { id: 'tool_use', label: 'tool-use' }, { id: 'readme', label: 'readme' }];

// 实验室 = 原 research_lab 模块 + AnaX 整体并入（AnaX 一级 tab 已移除）。
// 顶部横向 tab：workflow/skill/tool/model/DLF/AnaX；点开 AnaX 时其 4 个二级以左侧竖栏呈现（LAB_ANAX_SUB_TABS）。
export const LAB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: 'workflow' }, { id: 'skill', label: 'skill' }, { id: 'tool', label: 'tool' }, { id: 'model', label: 'model' }, { id: 'dlf', label: 'DLF' }, { id: 'anax_view', label: 'AnaX' }];

// AnaX 在实验室内的二级导航（左侧竖栏），仅当 activeSubTab ∈ LAB_ANAX_SUB_IDS 时显示。
export const LAB_ANAX_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'anax_view', label: '工作视图' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }, { id: 'readme', label: 'readme' }];
export const LAB_ANAX_SUB_IDS = new Set<SubTab>(['anax_view', 'hypothesis', 'change_mgmt', 'readme']);

// 6 大规则记忆模块 + 业务环境 / trace / 知识图谱（保留并列）。
export const RULE_MEMORY_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'rules', label: '偏好记忆' }, { id: 'indicators', label: '指标记忆' }, { id: 'cases', label: '项目记忆' }, { id: 'failure_memory', label: '失败记忆' }, { id: 'field_memory', label: '字段记忆' }, { id: 'process_memory', label: '流程记忆' }, { id: 'business_context', label: '业务环境' }, { id: 'trace', label: 'trace' }, { id: 'knowledge_graph', label: '知识图谱' }];

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
  if (VIEW_ONLY_TABS.has(tab)) return SUB_TABS.slice(0, 1);
  return SUB_TABS;
}
