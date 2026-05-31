import { useState } from "react";
import {
  Search,
  X,
  BarChart3,
  Filter,
  TrendingUp,
  PieChart,
  FileText,
  Clock,
  AlertTriangle,
  GitBranch,
  Layers,
  Brain,
  AlignLeft,
  Plus,
  type LucideIcon,
} from "lucide-react";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

const RECOMMENDED: WorkflowTemplate[] = [
  { id: "explore",  name: "数据探查",   description: "快速了解数据集的基本情况、分布与质量",  icon: Search     },
  { id: "clean",    name: "数据清洗",   description: "处理缺失值、异常值与格式问题",            icon: Filter     },
  { id: "eda",      name: "探索性分析", description: "深入挖掘数据规律与变量间关联",            icon: TrendingUp },
  { id: "viz",      name: "数据可视化", description: "生成图表与可视化展示",                    icon: PieChart   },
  { id: "stats",    name: "统计分析",   description: "描述性统计、假设检验与相关性",            icon: BarChart3  },
  { id: "report",   name: "报告生成",   description: "整理分析结论并生成结构化报告",            icon: FileText   },
];

const ALL: WorkflowTemplate[] = [
  ...RECOMMENDED,
  { id: "timeseries",  name: "时序分析",   description: "分析时间序列数据的趋势与周期",         icon: Clock        },
  { id: "anomaly",     name: "异常检测",   description: "识别数据中的异常点与离群值",           icon: AlertTriangle },
  { id: "correlation", name: "相关性分析", description: "量化变量间的关联强度与方向",           icon: GitBranch    },
  { id: "compare",     name: "分组对比",   description: "多组数据的差异分析与对比",             icon: Layers       },
  { id: "modeling",    name: "预测建模",   description: "构建回归或分类预测模型",               icon: Brain        },
  { id: "text",        name: "文本分析",   description: "提取文本特征、情感与关键词",           icon: AlignLeft    },
  { id: "custom",      name: "自定义任务", description: "描述任意数据分析任务",                 icon: Plus         },
];

interface Props {
  onSelectWorkflow: (template: WorkflowTemplate) => void;
}

export function WorkflowPickerPane({ onSelectWorkflow }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = ALL.filter(
    (w) =>
      !query.trim() ||
      w.name.includes(query) ||
      w.description.includes(query),
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12">
      <div className="w-full max-w-2xl">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          选择工作流
        </h2>
        <p className="mb-8 text-[13px] text-neutral-500 dark:text-neutral-400">
          每个工作流是一个单 agent 任务，选择后进入对话
        </p>

        <div className="grid grid-cols-3 gap-3">
          {RECOMMENDED.map((w) => {
            const Icon = w.icon;
            return (
              <button
                key={w.id}
                onClick={() => onSelectWorkflow(w)}
                className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-200/70 dark:bg-neutral-700">
                  <Icon className="h-4 w-4 text-neutral-700 dark:text-neutral-300" strokeWidth={1.75} />
                </span>
                <div>
                  <div className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                    {w.name}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400">
                    {w.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-center">
          <button
            onClick={() => { setQuery(""); setSearchOpen(true); }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            更多
          </button>
        </div>
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
              <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.75} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索工作流…"
                className="flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="scrollbar-thin max-h-80 overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12.5px] text-neutral-400">
                  无匹配工作流
                </div>
              ) : (
                filtered.map((w) => {
                  const Icon = w.icon;
                  return (
                    <button
                      key={w.id}
                      onClick={() => { onSelectWorkflow(w); setSearchOpen(false); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-700">
                        <Icon className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-300" strokeWidth={1.75} />
                      </span>
                      <div>
                        <div className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
                          {w.name}
                        </div>
                        <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                          {w.description}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
