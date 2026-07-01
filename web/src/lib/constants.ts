import type { Tab } from '@/components/MainHeader';

export type SubTab = 'view' | 'business_requirement' | 'business_context' | 'readme' | 'hypothesis' | 'extraction' | 'tool_compute' | 'aggregate_compute' | 'draw_data' | 'clean_data' | 'data_exploration' | 'report' | 'presentation_version' | 'report_review' | 'golden_strategy' | 'decision_tree' | 'toc' | 'skill' | 'tool' | 'rules' | 'indicators' | 'cases' | 'trace' | 'token_stats' | 'the-crowd' | 'weather' | 'business_district' | 'industry' | 'competitor' | 'own_product' | 'kb_docs' | 'kb_search' | 'sql_connect' | 'operational_model' | 'change_mgmt' | 'knowledge_graph' | 'dlf' | 'quick_notes' | 'kb_collect' | 'tool_use' | 'failure_memory' | 'process_memory' | 'anax_view' | 'anax_chat' | 'hooks_mgmt' | 'skills_mgmt' | 'command_mgmt' | 'plugin_mgmt' | 'subagents_mgmt' | 'llm_mgmt' | 'prompts_mgmt' | 'hooks_lab' | 'command_lab' | 'subagents_lab' | 'prompts_lab' | 'document_eval' | 'lab_overview' | 'lab_regression' | 'onto_readme' | 'onto_objects' | 'onto_links' | 'onto_metrics' | 'onto_logic' | 'onto_actions' | 'onto_graph' | 'onto_import' | 'actions' | 'health_overview' | 'health_data' | 'health_target' | 'health_dashboard' | 'health_report' | 'health_trend';

export const SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'view', label: '工作视图' }, { id: 'business_requirement', label: '业务需求' }, { id: 'draw_data', label: '原始数据' }, { id: 'extraction', label: '数据提取' }, { id: 'tool_compute', label: '工具计算' }, { id: 'aggregate_compute', label: '聚合计算' }, { id: 'clean_data', label: '聚合数据' }, { id: 'data_exploration', label: '数据探索' }, { id: 'report', label: '报告输出' }, { id: 'presentation_version', label: '汇报版本' }, { id: 'report_review', label: '报告审核' }, { id: 'golden_strategy', label: '黄金策' }, { id: 'actions', label: '行动' }, { id: 'dlf', label: 'DLF' }];

// ── L2 分组（横向二级 tab）→ L3 子项以左侧竖栏呈现（2026-06-26 二级 tab 梳理，复用 lab/onto 范式）。
// 叶子组直接指向单个 subtab（业务需求/readme，无 L3 竖栏）；分组组用 children 列出 L3 子项。
// subtab id 全部保留不变，仅分组 + 改名（汇报版本→业务语言、行动→执行反馈、DLF→模拟实验），故 pane 分发与可见性持久化不受影响。
export interface L2Group {
  id: string;                                  // 顶部横条标识
  label: string;
  leaf?: SubTab;                               // 叶子组：直接指向单个 subtab
  children?: { id: SubTab; label: string }[];  // 分组组：L3 子项
}

export function flattenL2Groups(groups: L2Group[]): { id: SubTab; label: string }[] {
  return groups.flatMap((g) => (g.leaf ? [{ id: g.leaf, label: g.label }] : g.children ?? []));
}

export function getActiveL2Group(groups: L2Group[], sub: SubTab): L2Group | undefined {
  return groups.find((g) => g.leaf === sub || g.children?.some((c) => c.id === sub));
}

export function getDefaultSubTab(group: L2Group): SubTab {
  return group.leaf ?? group.children![0]!.id;
}

// 日常(explore) L2 分组：业务需求 / 数据准备 / 分析报告 / 报告解读 / 行动闭环 / readme。
export const EXPLORE_L2_GROUPS: L2Group[] = [
  { id: 'business_requirement', label: '业务需求', leaf: 'business_requirement' },
  { id: 'data_prep', label: '数据准备', children: [{ id: 'draw_data', label: '原始数据' }, { id: 'extraction', label: '数据提取' }, { id: 'tool_compute', label: '工具计算' }, { id: 'aggregate_compute', label: '聚合计算' }, { id: 'clean_data', label: '聚合数据' }] },
  { id: 'analysis_report', label: '分析报告', children: [{ id: 'data_exploration', label: '数据探索' }, { id: 'view', label: '数据分析' }, { id: 'report', label: '报告输出' }, { id: 'report_review', label: '报告审核' }] },
  { id: 'report_interpret', label: '报告解读', children: [{ id: 'presentation_version', label: '业务语言' }, { id: 'golden_strategy', label: '黄金策' }] },
  { id: 'action_loop', label: '行动闭环', children: [{ id: 'actions', label: '执行反馈' }, { id: 'dlf', label: '模拟实验' }] },
  { id: 'readme', label: 'readme', leaf: 'readme' },
];
// 扁平表由分组派生（供默认 subtab 纠偏 + SettingsModal 可见性列表）。
export const EXPLORE_SUB_TABS: { id: SubTab; label: string }[] = flattenL2Groups(EXPLORE_L2_GROUPS);

// 重复(multi) tab 专用：在 SUB_TABS 基础上追加「readme」操作说明二级 tab（结合案例讲解重复模块；其产物仍称工作流）。
export const MULTI_SUB_TABS: { id: SubTab; label: string }[] = [...SUB_TABS, { id: 'readme', label: 'readme' }];

export const VIEW_ONLY_TABS = new Set<Tab>(['aggregate']);

// onto-xanthil 数据语义层二级 tab（详见 docs/onto-xanthil-design.md）。导入(import)为 P3。
export const ONTO_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'onto_readme', label: '说明' }, { id: 'onto_objects', label: '对象' }, { id: 'onto_links', label: '关系' }, { id: 'onto_metrics', label: '指标' }, { id: 'onto_logic', label: '逻辑' }, { id: 'onto_actions', label: '动作' }, { id: 'onto_graph', label: '图谱' }, { id: 'onto_import', label: '导入' }];

// 「实验场」= 二级 tab（顶部代表 id 复用首个子项 'skill'），其子项以左侧竖栏呈现（仿 onto/AnaX 两级嵌套，复用单一 activeSubTab）。
export const AGGREGATE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'tool_use', label: 'tool-use' }, { id: 'hooks_mgmt', label: 'hooks管理' }, { id: 'skills_mgmt', label: 'skills管理' }, { id: 'command_mgmt', label: 'command管理' }, { id: 'plugin_mgmt', label: '插件管理' }, { id: 'subagents_mgmt', label: 'subagents管理' }, { id: 'llm_mgmt', label: 'LLM管理' }, { id: 'prompts_mgmt', label: 'prompts管理' }, { id: 'skill', label: '实验场' }, { id: 'readme', label: 'readme' }];

// 实验场三级子 tab（左侧竖栏）。标签不带「实验场」尾缀。两个跨 lab 元视图：「总览」(lab_overview·P5-1)只读聚合六类评测、「回归」(lab_regression·P5-2)回归时间线+门禁；其后六 lab 均已实装。
export const LAB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'lab_overview', label: '总览' }, { id: 'lab_regression', label: '回归' }, { id: 'skill', label: 'skill' }, { id: 'tool', label: 'tool' }, { id: 'hooks_lab', label: 'hooks' }, { id: 'command_lab', label: 'command' }, { id: 'subagents_lab', label: 'subagents' }, { id: 'prompts_lab', label: 'prompts' }, { id: 'document_eval', label: '文档评测' }];
export const LAB_SUB_IDS = new Set<SubTab>(['lab_overview', 'lab_regression', 'skill', 'tool', 'hooks_lab', 'command_lab', 'subagents_lab', 'prompts_lab', 'document_eval']);

// 专题(zhuanti) = AnaX 提升为一级 tab，对齐探索的数据/报告链路。
// 混合导航(2026-06-26 二级 tab 梳理)：顶部横条 = ZHUANTI_L2_GROUPS(6 组，与日常一致)；
//   左竖栏上区 = 当前 L2 组的 L3 子项（叶子组上区为空）；左竖栏下区 = ZHUANTI_SIDEBAR_TABS(专题专属 3 项：流水线/假设库/变更管理)。
// 「数据分析」(view) 在专题指向主对话(ZhuantiChatPane)，与日常 view=主 ChatPane 对齐；原独立「对话探索」入口已去除（与数据分析重叠）。readme 上移至 L2 横条叶子组。
export const ZHUANTI_L2_GROUPS: L2Group[] = [
  { id: 'business_requirement', label: '业务需求', leaf: 'business_requirement' },
  { id: 'data_prep', label: '数据准备', children: [{ id: 'draw_data', label: '原始数据' }, { id: 'extraction', label: '数据提取' }, { id: 'tool_compute', label: '工具计算' }, { id: 'aggregate_compute', label: '聚合计算' }, { id: 'clean_data', label: '聚合数据' }] },
  { id: 'analysis_report', label: '分析报告', children: [{ id: 'data_exploration', label: '数据探索' }, { id: 'view', label: '数据分析' }, { id: 'report', label: '报告输出' }, { id: 'report_review', label: '报告审核' }] },
  { id: 'report_interpret', label: '报告解读', children: [{ id: 'presentation_version', label: '业务语言' }, { id: 'golden_strategy', label: '黄金策' }] },
  { id: 'action_loop', label: '行动闭环', children: [{ id: 'actions', label: '执行反馈' }, { id: 'dlf', label: '模拟实验' }] },
  { id: 'readme', label: 'readme', leaf: 'readme' },
];
// 专题左竖栏专属项（下区）：流水线/假设库/变更管理（对话探索已去除，readme 已上移至 L2 横条叶子组）。
export const ZHUANTI_SIDEBAR_TABS: { id: SubTab; label: string }[] = [{ id: 'anax_view', label: '流水线' }, { id: 'hypothesis', label: '假设库' }, { id: 'change_mgmt', label: '变更管理' }];
export const ZHUANTI_SIDEBAR_IDS = new Set<SubTab>(['anax_view', 'hypothesis', 'change_mgmt']);
// 全集：供 getSubTabsForTab 默认纠偏 + SettingsModal 可见性列表。
export const ZHUANTI_SUB_TABS: { id: SubTab; label: string }[] = [...flattenL2Groups(ZHUANTI_L2_GROUPS), ...ZHUANTI_SIDEBAR_TABS];

// 记忆模块二级 tab：统一记忆 / onto-knowhow / 业务环境 / trace / 知识图谱 / readme。
export const RULE_MEMORY_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'rules', label: '统一记忆' }, { id: 'indicators', label: 'onto-knowhow' }, { id: 'business_context', label: '业务环境' }, { id: 'trace', label: 'trace' }, { id: 'knowledge_graph', label: '知识图谱' }, { id: 'readme', label: 'readme' }];

export const XAN_DB_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'the-crowd', label: 'the-crowd' }, { id: 'weather', label: '天气' }, { id: 'business_district', label: '商圈' }, { id: 'industry', label: '行业' }, { id: 'competitor', label: '竞品' }, { id: 'own_product', label: '本品' }, { id: 'sql_connect', label: 'SQL连接' }, { id: 'readme', label: 'readme' }];

// 知识库二级 tab：收集(联网聊天·收集专题) / 资料库(上传/分类/标签) / 检索(全文+语义召回) / readme。
// 「收集」置顶为第一个 tab：绑定专属 pi session 的联网聊天，挑回复「存为资料」入库（CollectPane=E-COLLECT2）。
export const KNOWLEDGE_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'kb_collect', label: '收集' }, { id: 'kb_docs', label: '资料库' }, { id: 'kb_search', label: '检索' }, { id: 'readme', label: 'readme' }];

// 监测模块二级 tab：总览 / 初始化 / 目标测算 / 观星台 / 行动环 / readme。趋势并入观星台，不再作为独立 tab 展示。
export const HEALTH_SUB_TABS: { id: SubTab; label: string }[] = [{ id: 'health_overview', label: '总览' }, { id: 'health_data', label: '初始化' }, { id: 'health_target', label: '目标测算' }, { id: 'health_dashboard', label: '观星台' }, { id: 'health_report', label: '行动环' }, { id: 'readme', label: 'readme' }];

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

// 采用 L2 分组（横条 L2 + 左竖栏 L3）的 tab 返回其分组定义；其余 tab 返回 null（走扁平横条）。
export function getL2GroupsForTab(tab: Tab): L2Group[] | null {
  if (tab === 'explore') return EXPLORE_L2_GROUPS;
  if (tab === 'zhuanti') return ZHUANTI_L2_GROUPS;
  return null;
}
