import { useState, useEffect, useMemo, useCallback } from "react";
import { 
  Plus, 
  Trash2, 
  Edit2, 
  GripVertical, 
  BarChart2, 
  LineChart, 
  PieChart, 
  CreditCard, 
  Table, 
  RefreshCw, 
  X, 
  Info,
  TrendingUp,
  LayoutGrid,
  Database
} from "lucide-react";
import { DndContext, DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import ReactECharts from "echarts-for-react";
import { cn } from "@/lib/cn";
import { useBiDataset } from "@/lib/useBiDataset";
import { api } from "@/lib/api";
import { BiImportDialog } from "@/components/BiImportDialog";
import type { BiDatasetSlot, BiAggregationDataset, BiAggregationData } from "@/types";
import type { Dashboard } from "@/lib/api/viz";
import type { FieldKind } from "@/lib/profiling";

// Interfaces
interface ChartConfig {
  id: string;
  title: string;
  datasetSlot?: "member_retention" | "member_recall";
  datasetPathId?: string;
  datasetName?: string;
  chartType: "card" | "line" | "bar" | "pie" | "table";
  w: 1 | 2; // grid column span
  dimension?: string;
  metric?: string;
  aggType: "sum" | "avg" | "count";
}

interface FieldInfo {
  name: string;
  kind: FieldKind;
}

// Inferred dataset fields based on sample rows
function inferDatasetFields(columns: string[], rows: Array<Record<string, unknown>>): FieldInfo[] {
  if (!rows || rows.length === 0) {
    return columns.map(c => ({ name: c, kind: "text" }));
  }

  return columns.map(colName => {
    const sampleValues = rows
      .slice(0, 100)
      .map(r => r[colName])
      .filter(v => v !== null && v !== undefined);

    if (sampleValues.length === 0) {
      return { name: colName, kind: "text" };
    }

    const colNameLower = colName.toLowerCase();
    const isIdName = colNameLower.endsWith("id") || colNameLower.startsWith("id") || colNameLower.includes("_id");
    const uniqueCount = new Set(sampleValues).size;
    const isAllUnique = uniqueCount === sampleValues.length;
    
    if (isIdName || (isAllUnique && typeof sampleValues[0] === "string" && sampleValues[0].length > 5)) {
      return { name: colName, kind: "id" };
    }

    const isAllBoolean = sampleValues.every(v => typeof v === "boolean" || v === 0 || v === 1 || String(v).toLowerCase() === "true" || String(v).toLowerCase() === "false");
    if (isAllBoolean && sampleValues.some(v => typeof v === "boolean" || String(v).toLowerCase() === "true")) {
      return { name: colName, kind: "boolean" };
    }

    const isAllNumeric = sampleValues.every(v => {
      if (typeof v === "number") return true;
      if (typeof v === "string") {
        const num = Number(v.replace(/%/g, ""));
        return !isNaN(num);
      }
      return false;
    });
    if (isAllNumeric) {
      return { name: colName, kind: "number" };
    }

    const isAllDatetime = sampleValues.every(v => {
      if (v instanceof Date) return true;
      if (typeof v === "string") {
        const dateRegex = /^\d{4}[-/]\d{2}([-/]\d{2})?$/;
        if (dateRegex.test(v)) return true;
        const time = Date.parse(v);
        return !isNaN(time);
      }
      return false;
    });
    if (isAllDatetime) {
      return { name: colName, kind: "datetime" };
    }

    if (uniqueCount <= 15 || uniqueCount / sampleValues.length <= 0.2) {
      return { name: colName, kind: "category" };
    }

    return { name: colName, kind: "text" };
  });
}

// Convert cell to number safely
function parseCellValue(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).trim().replace(/%/g, "").replace(/,/g, "");
  const n = Number(s);
  if (isNaN(n)) return 0;
  if (String(val).includes("%")) return n / 100;
  return n;
}

// Perform simple client-side aggregation for charts
function aggregateData(
  rows: Array<Record<string, unknown>>,
  dimension: string | undefined,
  metric: string | undefined,
  aggType: "sum" | "avg" | "count"
): Array<{ name: string; value: number }> {
  if (!metric) return [];
  
  if (!dimension) {
    const values = rows.map(r => parseCellValue(r[metric]));
    if (values.length === 0) return [{ name: "总计", value: 0 }];
    if (aggType === "avg") {
      const sum = values.reduce((a, b) => a + b, 0);
      return [{ name: "总计", value: sum / values.length }];
    }
    if (aggType === "count") {
      return [{ name: "总计", value: rows.length }];
    }
    const sum = values.reduce((a, b) => a + b, 0);
    return [{ name: "总计", value: sum }];
  }

  const groups: Record<string, number[]> = {};
  rows.forEach(row => {
    const dimVal = String(row[dimension] ?? "未知");
    const metVal = parseCellValue(row[metric]);
    if (!groups[dimVal]) {
      groups[dimVal] = [];
    }
    groups[dimVal].push(metVal);
  });

  return Object.entries(groups).map(([name, values]) => {
    let value = 0;
    if (aggType === "avg") {
      const sum = values.reduce((a, b) => a + b, 0);
      value = values.length ? sum / values.length : 0;
    } else if (aggType === "count") {
      value = values.length;
    } else {
      value = values.reduce((a, b) => a + b, 0);
    }
    return { name, value };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Echarts Palette
const ECHARTS_COLOR_PALETTE = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6"];

// Sub-component: Sortable Chart Card
function DraggableChartCard({
  chart,
  datasetRows,
  isLoading,
  isMissing,
  activeFilters,
  onEdit,
  onDelete,
  onFilterClick,
  onImportClick,
}: {
  chart: ChartConfig;
  datasetRows: Array<Record<string, any>>;
  isLoading: boolean;
  isMissing: boolean;
  activeFilters: Record<string, any>;
  onEdit: (chart: ChartConfig) => void;
  onDelete: (id: string) => void;
  onFilterClick: (dimension: string, value: string) => void;
  onImportClick: (slot: BiDatasetSlot) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: chart.id,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: chart.id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : undefined,
      }
    : undefined;

  // Filter rows using global activeFilters (exclude self dimension to allow filter-back highlighting)
  const filteredRows = useMemo(() => {
    return datasetRows.filter((row: any) => {
      for (const [key, value] of Object.entries(activeFilters)) {
        if (key === chart.dimension) continue; // Skip filtering self dimension
        if (row[key] !== undefined && row[key] !== null && String(row[key]) !== String(value)) {
          return false;
        }
      }
      return true;
    });
  }, [datasetRows, activeFilters, chart.dimension]);

  // Aggregate data for Echarts
  const chartData = useMemo(() => {
    if (!chart.metric) return [];
    return aggregateData(filteredRows, chart.dimension, chart.metric, chart.aggType);
  }, [filteredRows, chart.dimension, chart.metric, chart.aggType]);

  // ECharts click handler integration
  const onEvents = useMemo(() => {
    return {
      click: (params: any) => {
        if (chart.dimension && params && params.name) {
          onFilterClick(chart.dimension, params.name);
        }
      },
    };
  }, [chart.dimension, onFilterClick]);

  // Formatted value for Card KPI
  const cardKPI = useMemo(() => {
    if (chart.chartType !== "card" || chartData.length === 0) return "—";
    const val = chartData[0]?.value ?? 0;
    if (val > 0 && val < 1 && (chart.metric?.toLowerCase().includes("retention") || chart.metric?.toLowerCase().includes("rate") || chart.metric?.toLowerCase().includes("recall"))) {
      return `${(val * 100).toFixed(1)}%`;
    }
    return Math.round(val).toLocaleString();
  }, [chart.chartType, chartData, chart.metric]);

  // Echarts Option Builder
  const echartsOption = useMemo(() => {
    if (chartData.length === 0) return {};
    const xData = chartData.map(d => d.name);
    const yData = chartData.map(d => d.value);

    // Apply active highlight to selected filter item
    const activeValue = chart.dimension ? activeFilters[chart.dimension] : null;

    const baseSeriesOptions = {
      color: ECHARTS_COLOR_PALETTE,
      grid: { top: 30, right: 10, bottom: 30, left: 50, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    };

    if (chart.chartType === "line") {
      return {
        ...baseSeriesOptions,
        xAxis: { type: "category", data: xData, axisLine: { lineStyle: { color: "#9ca3af" } } },
        yAxis: { type: "value", splitLine: { lineStyle: { type: "dashed", color: "#e5e7eb" } } },
        series: [
          {
            data: yData,
            type: "line",
            smooth: true,
            symbolSize: 8,
            lineStyle: { width: 3 },
            itemStyle: {
              color: (params: any) => {
                if (activeValue && params && String(params.name) === String(activeValue)) {
                  return "#ef4444"; // Highlight active filter
                }
                return "#6366f1";
              }
            }
          },
        ],
      };
    }

    if (chart.chartType === "bar") {
      return {
        ...baseSeriesOptions,
        xAxis: { type: "category", data: xData, axisLine: { lineStyle: { color: "#9ca3af" } } },
        yAxis: { type: "value", splitLine: { lineStyle: { type: "dashed", color: "#e5e7eb" } } },
        series: [
          {
            data: yData,
            type: "bar",
            barMaxWidth: 30,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: (params: any) => {
                if (activeValue && params && String(params.name) === String(activeValue)) {
                  return "#ef4444"; // Highlight active filter
                }
                return "#06b6d4";
              },
            },
          },
        ],
      };
    }

    if (chart.chartType === "pie") {
      return {
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        legend: { bottom: 0, left: "center", itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
        series: [
          {
            type: "pie",
            radius: ["40%", "70%"],
            avoidLabelOverlap: false,
            itemStyle: {
              borderRadius: 6,
              borderColor: "#fff",
              borderWidth: 2,
            },
            label: { show: false },
            emphasis: { label: { show: true, fontSize: 12, fontWeight: "bold" } },
            data: chartData.map(d => ({
              name: d.name,
              value: d.value,
              itemStyle: activeValue && String(d.name) === String(activeValue) ? { color: "#ef4444" } : undefined
            })),
          },
        ],
      };
    }

    return {};
  }, [chart.chartType, chartData, chart.dimension, activeFilters]);

  const isConfigured = chart.metric;

  return (
    <div
      ref={setDropRef}
      style={style}
      className={cn(
        "group relative flex flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-all dark:border-neutral-800 dark:bg-neutral-900/50",
        isOver && "ring-2 ring-indigo-500 border-transparent",
        chart.w === 2 ? "col-span-2" : "col-span-1"
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors"
            title="拖拽排列"
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-50 truncate" title={chart.title}>
            {chart.title || "未命名图表"}
          </span>
          {chart.datasetSlot ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {chart.datasetSlot === "member_retention" ? "留存" : "召回"}
            </span>
          ) : chart.datasetName ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400 truncate max-w-[120px]">
              {chart.datasetName}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(chart)}
            className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded text-neutral-500 hover:text-indigo-600 dark:text-neutral-400"
            title="配置"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(chart.id)}
            className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded text-neutral-500 hover:text-red-600 dark:text-neutral-400"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filter indicator */}
      {chart.dimension && activeFilters[chart.dimension] && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded-md">
          <Info className="h-3 w-3" />
          <span>当前图表已应用筛选: {activeFilters[chart.dimension]}</span>
        </div>
      )}

      {/* Body Content */}
      <div className="flex-1 min-h-[200px] flex flex-col justify-center">
        {!isConfigured ? (
          <div className="flex flex-col items-center justify-center text-center p-6 text-neutral-400 dark:text-neutral-500">
            <LayoutGrid className="h-10 w-10 mb-2 stroke-[1.5]" />
            <p className="text-xs">未配置维度和指标</p>
            <button
              onClick={() => onEdit(chart)}
              className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              点击配置
            </button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center text-center text-neutral-400 py-6">
            <RefreshCw className="h-6 w-6 animate-spin mb-2" />
            <p className="text-xs">加载数据源中...</p>
          </div>
        ) : isMissing ? (
          <div className="flex flex-col items-center justify-center text-center text-neutral-400 py-6">
            <Database className="h-6 w-6 mb-2 opacity-50" />
            <p className="text-xs">暂无关联数据</p>
            {chart.datasetSlot && (
              <button
                onClick={() => onImportClick(chart.datasetSlot!)}
                className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                点击导入数据 ({chart.datasetSlot === "member_retention" ? "数据源 A" : "数据源 B"})
              </button>
            )}
          </div>
        ) : (
          <>
            {chart.chartType === "card" && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
                  {cardKPI}
                </div>
                <div className="mt-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {chart.metric}
                  <span className="ml-1 text-[10px] text-neutral-400">
                    ({chart.aggType === "sum" ? "合计" : chart.aggType === "avg" ? "平均" : "计数"})
                  </span>
                </div>
              </div>
            )}

            {(chart.chartType === "line" || chart.chartType === "bar" || chart.chartType === "pie") && (
              <div className="w-full h-48">
                {chartData.length === 0 ? (
                  <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
                    无可用数据 (筛选条件下无匹配行)
                  </div>
                ) : (
                  <ReactECharts
                    option={echartsOption}
                    onEvents={onEvents}
                    style={{ width: "100%", height: "100%" }}
                  />
                )}
              </div>
            )}

            {chart.chartType === "table" && (
              <div className="w-full max-h-48 overflow-y-auto border border-neutral-100 rounded-lg dark:border-neutral-800 text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800 text-neutral-500">
                      <th className="p-2 font-semibold">{chart.dimension || "明细行"}</th>
                      <th className="p-2 font-semibold text-right">{chart.metric || "指标"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((d, i) => {
                      const isRowFiltered = chart.dimension && String(activeFilters[chart.dimension]) === String(d.name);
                      return (
                        <tr
                          key={i}
                          onClick={() => {
                            if (chart.dimension) {
                              onFilterClick(chart.dimension, d.name);
                            }
                          }}
                          className={cn(
                            "border-b border-neutral-100 dark:border-neutral-850 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors",
                            isRowFiltered && "bg-red-50/70 hover:bg-red-50 dark:bg-red-950/20 text-red-600 font-semibold"
                          )}
                        >
                          <td className="p-2 truncate max-w-[150px]">{d.name}</td>
                          <td className="p-2 text-right">
                            {chart.metric?.toLowerCase().includes("retention") || chart.metric?.toLowerCase().includes("rate") || chart.metric?.toLowerCase().includes("recall")
                              ? `${(d.value * 100).toFixed(1)}%`
                              : Math.round(d.value).toLocaleString()
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// MAIN COMPONENT
export function BiDashboardPane({ workspaceId }: { workspaceId?: string }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeDashboard, setActiveDashboard] = useState<Dashboard | null>(null);
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  
  // Datasets
  const retentionDataset = useBiDataset("member_retention");
  const recallDataset = useBiDataset("member_recall");

  // Global linkage filter state
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});

  // Loading/saving state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modals / Editors state
  const [isEditingChart, setIsEditingChart] = useState<ChartConfig | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [activeImportSlot, setActiveImportSlot] = useState<BiDatasetSlot | null>(null);

  const [aggDatasets, setAggDatasets] = useState<BiAggregationDataset[]>([]);
  const [aggDataCache, setAggDataCache] = useState<Record<string, BiAggregationData>>({});
  const [aggDataLoading, setAggDataLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (workspaceId) {
      api.getBiAggregations(workspaceId).then(setAggDatasets).catch(err => {
        alert("加载聚合数据源失败：" + err.message);
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    const pathIds = [...new Set(charts.map(c => c.datasetPathId).filter(Boolean) as string[])];
    pathIds.forEach(pathId => {
      if (!aggDataCache[pathId] && !aggDataLoading[pathId]) {
        setAggDataLoading(prev => ({ ...prev, [pathId]: true }));
        api.getBiAggregationData(pathId).then(data => {
          setAggDataCache(prev => ({ ...prev, [pathId]: data }));
        }).catch(err => {
          alert(`加载图表数据失败: ${err.message}`);
        }).finally(() => {
          setAggDataLoading(prev => ({ ...prev, [pathId]: false }));
        });
      }
    });
  }, [charts, aggDataCache, aggDataLoading]);


  // Fields mapping
  const retentionFields = useMemo(() => {
    if (!retentionDataset.dataset) return [];
    return inferDatasetFields(retentionDataset.dataset.columns, retentionDataset.dataset.rows);
  }, [retentionDataset.dataset]);

  const recallFields = useMemo(() => {
    if (!recallDataset.dataset) return [];
    return inferDatasetFields(recallDataset.dataset.columns, recallDataset.dataset.rows);
  }, [recallDataset.dataset]);

  // Fetch dashboards for the workspace
  const fetchDashboards = useCallback(async (selectId?: string) => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const list = await api.listDashboards(workspaceId);
      setDashboards(list);

      if (list.length > 0) {
        const toSelect = selectId ? list.find(d => d.id === selectId) : list[0];
        const selected = toSelect || list[0];
        if (selected) {
          setActiveDashboard(selected);
          try {
            setCharts(JSON.parse(selected.layout_json));
          } catch {
            setCharts([]);
          }
        }
      } else {
        // 用户列表为空时不自动建表，避免误导
        setActiveDashboard(null);
        setCharts([]);
      }
    } catch (err) {
      console.error("Failed to list dashboards", err);
      alert("加载看板列表失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchDashboards();
  }, [fetchDashboards]);

  // Create default dashboard with preset charts
  const handleCreateDefaultDashboard = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const defaultLayout: ChartConfig[] = [
        {
          id: "default-retention-trend",
          title: "新客规模趋势",
          datasetSlot: "member_retention",
          chartType: "line",
          w: 2,
          dimension: "cohort",
          metric: "new_users",
          aggType: "sum"
        },
        {
          id: "default-m1-retention",
          title: "新客首期(M+1)复购留存率",
          datasetSlot: "member_retention",
          chartType: "line",
          w: 1,
          dimension: "cohort",
          metric: "M+1",
          aggType: "avg"
        },
        {
          id: "default-recall-repurchase",
          title: "老客复购规模",
          datasetSlot: "member_recall",
          chartType: "bar",
          w: 1,
          dimension: "month",
          metric: "repurchase_users",
          aggType: "sum"
        }
      ];

      const created = await api.createDashboard({
        workspaceId,
        name: "默认运营看板",
        layoutJson: JSON.stringify(defaultLayout),
      });

      setDashboards([created]);
      setActiveDashboard(created);
      setCharts(defaultLayout);
    } catch (err) {
      console.error("Failed to create default dashboard", err);
      alert("生成默认看板失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  // Switch Active Dashboard
  const handleSelectDashboard = (db: Dashboard) => {
    setActiveDashboard(db);
    setActiveFilters({});
    try {
      setCharts(JSON.parse(db.layout_json));
    } catch {
      setCharts([]);
    }
  };

  // Create Dashboard
  const handleCreateDashboard = async () => {
    if (!workspaceId || !newDashboardName.trim()) return;
    setSaving(true);
    try {
      const created = await api.createDashboard({
        workspaceId,
        name: newDashboardName.trim(),
        layoutJson: "[]",
      });
      setNewDashboardName("");
      setShowCreateModal(false);
      await fetchDashboards(created.id);
    } catch (err) {
      console.error(err);
      alert("新建看板失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Delete Dashboard
  const handleDeleteDashboard = async (id: string) => {
    if (!confirm("确定要删除该看板吗？")) return;
    try {
      await api.deleteDashboard(id);
      setActiveDashboard(null);
      setCharts([]);
      setActiveFilters({});
      await fetchDashboards();
    } catch (err) {
      console.error(err);
      alert("删除看板失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Save layout & chart configs to database
  const handleSaveLayout = async (updatedCharts: ChartConfig[]) => {
    if (!activeDashboard) return;
    setSaving(true);
    try {
      const updated = await api.updateDashboard(activeDashboard.id, {
        layoutJson: JSON.stringify(updatedCharts),
      });
      setActiveDashboard(updated);
      setDashboards(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch (err) {
      console.error("Failed to save layout", err);
      alert("保存布局失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Drag End Handler for DND
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = charts.findIndex((c) => c.id === active.id);
      const newIndex = charts.findIndex((c) => c.id === over.id);
      
      const updated = [...charts];
      const [moved] = updated.splice(oldIndex, 1);
      if (moved) {
        updated.splice(newIndex, 0, moved);
        setCharts(updated);
        void handleSaveLayout(updated);
      }
    }
  };

  // Add new blank chart config
  const handleAddChart = () => {
    const newChart: ChartConfig = {
      id: `chart-${Date.now()}`,
      title: "新图表",
      // If we have clean_data, default to the first one, else preset
      ...(aggDatasets.length > 0 
        ? { datasetPathId: aggDatasets[0]?.pathId, datasetName: aggDatasets[0]?.name }
        : { datasetSlot: "member_retention" as const }),
      chartType: "bar",
      w: 1,
      aggType: "sum",
    };
    const updated = [...charts, newChart];
    setCharts(updated);
    void handleSaveLayout(updated);
    setIsEditingChart(newChart);
  };

  // Delete specific chart
  const handleDeleteChart = (id: string) => {
    const updated = charts.filter(c => c.id !== id);
    setCharts(updated);
    void handleSaveLayout(updated);
  };

  // Edit chart config update
  const handleSaveChartConfig = (updated: ChartConfig) => {
    const nextCharts = charts.map(c => c.id === updated.id ? updated : c);
    setCharts(nextCharts);
    void handleSaveLayout(nextCharts);
    setIsEditingChart(null);
  };

  // Interactive Click Linkage Filters handler
  const handleFilterClick = useCallback((dimension: string, value: string) => {
    setActiveFilters(prev => {
      if (prev[dimension] === value) {
        const next = { ...prev };
        delete next[dimension];
        return next;
      }
      return {
        ...prev,
        [dimension]: value,
      };
    });
  }, []);

  const handleClearFilters = () => {
    setActiveFilters({});
  };

  return (
    <div className="flex min-h-0 flex-1 bg-neutral-50/70 dark:bg-neutral-950">
      {!workspaceId ? (
        <div className="flex flex-col items-center justify-center flex-1 p-12 text-center text-neutral-400">
          <LayoutGrid className="h-16 w-16 mb-4 stroke-[1.25] text-neutral-300 dark:text-neutral-700" />
          <h3 className="font-semibold text-neutral-700 dark:text-neutral-400">未选择工作空间</h3>
          <p className="text-xs mt-1 text-neutral-500 max-w-xs">
            请先在工作区选择或创建一个工作空间，以便加载和管理多图看板。
          </p>
        </div>
      ) : (
        <>
          {/* Sidebar: Dashboard list */}
          <aside className="hidden w-72 shrink-0 border-r border-neutral-200 bg-white/80 p-5 dark:border-neutral-800 dark:bg-neutral-950 lg:block flex flex-col justify-between">
        <div className="overflow-y-auto flex-1">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">BI Dashboard</div>
              <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">多图看板</h1>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 transition-colors"
              title="新建看板"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-8 text-neutral-400">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              <span className="text-xs">加载看板列表...</span>
            </div>
          ) : (
            <div className="space-y-1.5 mt-4">
              {dashboards.map((db) => {
                const active = activeDashboard?.id === db.id;
                return (
                  <div
                    key={db.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all border border-transparent",
                      active
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 shadow-sm"
                        : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
                    )}
                  >
                    <button
                      onClick={() => handleSelectDashboard(db)}
                      className="flex-1 text-left min-w-0 font-medium text-xs truncate mr-2"
                    >
                      {db.name}
                    </button>
                    <button
                      onClick={() => handleDeleteDashboard(db.id)}
                      className={cn(
                        "p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-850 text-neutral-400 hover:text-red-500 opacity-100"
                      )}
                      title="删除看板"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Main Canvas Area */}
      <div className="min-w-0 flex-1 overflow-y-auto flex flex-col">
        {activeDashboard ? (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 bg-white/60 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950/60 sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <LayoutGrid className="h-5 w-5 text-neutral-500" />
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                    {activeDashboard.name}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    拖拽把手可以重新排列卡片，点击图表内扇区/柱子可多图联动筛选。
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {Object.keys(activeFilters).length > 0 && (
                  <button
                    onClick={handleClearFilters}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    清除过滤 ({Object.keys(activeFilters).length})
                  </button>
                )}

                <button
                  onClick={handleAddChart}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增图表
                </button>

                <div className="flex items-center gap-1.5 ml-2 border-l border-transparent dark:border-transparent pl-1">
                  {/* Empty placeholder for alignment, or we can just remove the div */}
                </div>

                {saving && (
                  <span className="text-xs text-neutral-400 flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    自动保存中...
                  </span>
                )}
              </div>
            </div>

            {/* Active Linkage Filter Chips Bar */}
            {Object.keys(activeFilters).length > 0 && (
              <div className="bg-neutral-100/50 dark:bg-neutral-900/30 px-6 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">当前过滤条件:</span>
                {Object.entries(activeFilters).map(([dim, val]) => (
                  <div
                    key={dim}
                    className="inline-flex items-center gap-1.5 text-xs bg-indigo-50 border border-indigo-150 text-indigo-700 dark:bg-indigo-950/30 dark:border-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded-full"
                  >
                    <span className="font-semibold">{dim}:</span>
                    <span>{val}</span>
                    <button
                      onClick={() => handleFilterClick(dim, val)}
                      className="hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Canvas Grid */}
            <div className="p-6">
              {charts.length === 0 ? (
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl p-16 text-center text-neutral-400 min-h-[400px]">
                  <LayoutGrid className="h-16 w-16 mb-4 stroke-[1.25] text-neutral-300 dark:text-neutral-700" />
                  <h3 className="font-semibold text-neutral-700 dark:text-neutral-350">看板里还没有图表</h3>
                  <p className="text-xs mt-1 text-neutral-400 max-w-xs mb-4">
                    该看板目前是空的，请点击下方按钮或右上角“新增图表”开始配置数据面板。
                  </p>
                  
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleAddChart}
                      className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      添加我的第一个图表
                    </button>
                  </div>
                </div>
              ) : (
                <DndContext onDragEnd={handleDragEnd}>
                  <div className="grid grid-cols-2 gap-6">
                    {charts.map((chart) => {
                      let rows: Array<Record<string, any>> = [];
                      let isLoading = false;
                      let isMissing = false;

                      if (chart.datasetPathId) {
                        const data = aggDataCache[chart.datasetPathId];
                        rows = data?.rows || [];
                        isLoading = aggDataLoading[chart.datasetPathId] || false;
                        isMissing = !data && !isLoading;
                      } else if (chart.datasetSlot) {
                        const datasetInfo = chart.datasetSlot === "member_retention" ? retentionDataset : recallDataset;
                        rows = datasetInfo.dataset?.rows || [];
                        isLoading = datasetInfo.loading;
                        isMissing = !datasetInfo.dataset && !isLoading;
                      }

                      return (
                        <DraggableChartCard
                          key={chart.id}
                          chart={chart}
                          datasetRows={rows}
                          isLoading={isLoading}
                          isMissing={isMissing}
                          activeFilters={activeFilters}
                          onEdit={setIsEditingChart}
                          onDelete={handleDeleteChart}
                          onFilterClick={handleFilterClick}
                          onImportClick={setActiveImportSlot}
                        />
                      );
                    })}
                  </div>
                </DndContext>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 p-12 text-center text-neutral-400">
            <TrendingUp className="h-16 w-16 mb-4 stroke-[1.25] text-neutral-300" />
            <h3 className="font-semibold text-neutral-700 dark:text-neutral-400">未选择或新建看板</h3>
            <p className="text-xs mt-1 text-neutral-500 max-w-xs">
              点击左上角的加号创建一个新的多图看板画布，或选择已有的运营看板。
            </p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900 transition-colors"
              >
                <Plus className="h-4 w-4" />
                新建空白看板
              </button>
              <button
                onClick={handleCreateDefaultDashboard}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:hover:bg-neutral-900 dark:text-neutral-300 transition-colors disabled:opacity-50"
              >
                <LayoutGrid className="h-4 w-4" />
                从预置模板新建(留存/召回)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Create New Dashboard */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <span className="font-semibold text-neutral-900 dark:text-neutral-50">新建多图看板</span>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1.5">看板名称</label>
                <input
                  type="text"
                  value={newDashboardName}
                  onChange={(e) => setNewDashboardName(e.target.value)}
                  placeholder="例如: 2026年Q2运营复盘看板"
                  className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700"
                  autoFocus
                />
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2 text-xs">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-2 rounded-lg border border-neutral-250 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                onClick={handleCreateDashboard}
                disabled={saving || !newDashboardName.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50"
              >
                {saving ? "创建中..." : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Chart Config Editor Drawer */}
      {isEditingChart && (
        <ChartConfigDrawer
          chart={isEditingChart as ChartConfig}
          retentionFields={retentionFields}
          recallFields={recallFields}
          aggDatasets={aggDatasets}
          aggDataCache={aggDataCache}
          fetchAggData={async (pathId) => {
            const data = await api.getBiAggregationData(pathId);
            setAggDataCache(prev => ({ ...prev, [pathId]: data }));
            return data;
          }}
          onClose={() => setIsEditingChart(null)}
          onSave={handleSaveChartConfig}
        />
      )}

      {/* MODAL: BiImportDialog */}
      {activeImportSlot === "member_retention" && (
        <BiImportDialog
          open={true}
          onClose={() => setActiveImportSlot(null)}
          onImport={retentionDataset.importFile}
          onSwitch={retentionDataset.switchTo}
          onDelete={retentionDataset.remove}
          currentId={retentionDataset.dataset?.id}
          history={retentionDataset.history}
          importing={retentionDataset.importing}
        />
      )}
      {activeImportSlot === "member_recall" && (
        <BiImportDialog
          open={true}
          onClose={() => setActiveImportSlot(null)}
          onImport={recallDataset.importFile}
          onSwitch={recallDataset.switchTo}
          onDelete={recallDataset.remove}
          currentId={recallDataset.dataset?.id}
          history={recallDataset.history}
          importing={recallDataset.importing}
        />
      )}
      </>
      )}
    </div>
  );
}

// Sub-component: Chart Config Editor Drawer
function ChartConfigDrawer({
  chart,
  retentionFields,
  recallFields,
  aggDatasets,
  aggDataCache,
  fetchAggData,
  onClose,
  onSave,
}: {
  chart: ChartConfig;
  retentionFields: FieldInfo[];
  recallFields: FieldInfo[];
  aggDatasets: BiAggregationDataset[];
  aggDataCache: Record<string, BiAggregationData>;
  fetchAggData: (pathId: string) => Promise<BiAggregationData>;
  onClose: () => void;
  onSave: (updated: ChartConfig) => void;
}) {
  const [title, setTitle] = useState(chart.title);
  const [datasetMode, setDatasetMode] = useState<"preset" | "clean_data">(chart.datasetPathId ? "clean_data" : "preset");
  const [datasetSlot, setDatasetSlot] = useState<BiDatasetSlot | undefined>(chart.datasetSlot);
  const [datasetPathId, setDatasetPathId] = useState<string | undefined>(chart.datasetPathId);
  const [dimension, setDimension] = useState(chart.dimension || "");
  const [metric, setMetric] = useState(chart.metric || "");
  const [chartType, setChartType] = useState<ChartConfig["chartType"]>(chart.chartType);
  const [aggType, setAggType] = useState<ChartConfig["aggType"]>(chart.aggType);
  const [w, setW] = useState<1 | 2>(chart.w);

  const [cleanDataFields, setCleanDataFields] = useState<FieldInfo[]>([]);
  const [loadingCleanData, setLoadingCleanData] = useState(false);

  useEffect(() => {
    if (datasetMode === "clean_data" && datasetPathId) {
      const cached = aggDataCache[datasetPathId];
      if (cached) {
        setCleanDataFields(inferDatasetFields(cached.columns, cached.rows));
      } else {
        setLoadingCleanData(true);
        fetchAggData(datasetPathId)
          .then(data => {
            setCleanDataFields(inferDatasetFields(data.columns, data.rows));
          })
          .catch(err => {
             alert("拉取字段失败: " + err.message);
          })
          .finally(() => setLoadingCleanData(false));
      }
    }
  }, [datasetMode, datasetPathId, aggDataCache, fetchAggData]);

  const activeFields = useMemo(() => {
    if (datasetMode === "preset") {
      return datasetSlot === "member_retention" ? retentionFields : recallFields;
    } else {
      return cleanDataFields;
    }
  }, [datasetMode, datasetSlot, retentionFields, recallFields, cleanDataFields]);

  const handleDatasetChange = (mode: "preset" | "clean_data", val: string) => {
    setDimension("");
    setMetric("");
    if (mode === "preset") {
      setDatasetMode("preset");
      setDatasetSlot(val as BiDatasetSlot);
      setDatasetPathId(undefined);
    } else {
      setDatasetMode("clean_data");
      setDatasetSlot(undefined);
      setDatasetPathId(val);
    }
  };

  // Smart recommender logic
  const recommendedChartType = useMemo<ChartConfig["chartType"] | null>(() => {
    if (!metric) return null;
    if (!dimension) {
      const field = activeFields.find(f => f.name === metric);
      if (field?.kind === "number") return "card";
      return "table";
    }

    const dimField = activeFields.find(f => f.name === dimension);
    if (dimField) {
      if (dimField.kind === "datetime") return "line";
      if (dimField.kind === "category" || dimField.kind === "boolean") return "pie";
      if (dimField.kind === "id" || dimField.kind === "text") return "bar";
    }
    return "table";
  }, [dimension, metric, activeFields]);

  // Apply auto recommended chart type
  const handleApplyRecommendation = () => {
    if (recommendedChartType) {
      setChartType(recommendedChartType);
    }
  };

  // Auto trigger recommended type when fields change for the first time
  useEffect(() => {
    if (recommendedChartType && !chart.metric) {
      setChartType(recommendedChartType);
    }
  }, [recommendedChartType, chart.metric]);

  const handleSubmit = () => {
    const dName = datasetMode === "clean_data" ? aggDatasets.find(d => d.pathId === datasetPathId)?.name : undefined;
    onSave({
      ...chart,
      title: title.trim() || "未命名图表",
      datasetSlot: datasetMode === "preset" ? datasetSlot : undefined,
      datasetPathId: datasetMode === "clean_data" ? datasetPathId : undefined,
      datasetName: dName,
      dimension: dimension || undefined,
      metric: metric || undefined,
      chartType,
      aggType,
      w,
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 p-6 flex flex-col justify-between">
      <div className="overflow-y-auto flex-1 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-50">配置图表卡片</span>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">图表标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700"
            placeholder="例如: 留存漏斗"
          />
        </div>

        {/* Dataset Selection */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">关联数据源</label>
          <select
            value={datasetMode === "clean_data" ? `clean_data:${datasetPathId || ""}` : `preset:${datasetSlot || "member_retention"}`}
            onChange={(e) => {
              const [mode, val] = e.target.value.split(":");
              handleDatasetChange(mode as "preset" | "clean_data", val || "");
            }}
            className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 bg-white dark:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700"
          >
            <optgroup label="聚合数据集 (推荐)">
              {aggDatasets.map(ds => (
                <option key={ds.pathId} value={`clean_data:${ds.pathId}`}>{ds.name}</option>
              ))}
              {aggDatasets.length === 0 && <option value="" disabled>暂无可用聚合数据</option>}
            </optgroup>
            <optgroup label="预置模板兼容">
              <option value="preset:member_retention">数据源 A (兼容留存结构)</option>
              <option value="preset:member_recall">数据源 B (兼容召回结构)</option>
            </optgroup>
          </select>
          {loadingCleanData && <span className="text-[10px] text-neutral-400 mt-1 block">拉取字段中...</span>}
        </div>

        {/* Dimension */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">
            维度 (Dimension)
            <span className="text-[10px] text-neutral-400 font-normal ml-1">(折线/柱状/饼图的X轴或分类)</span>
          </label>
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
            className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 bg-white dark:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700"
          >
            <option value="">-- 无维度 (展示单一汇总值) --</option>
            {activeFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({f.kind})
              </option>
            ))}
          </select>
        </div>

        {/* Metric */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">
            指标 (Metric)
            <span className="text-[10px] text-neutral-400 font-normal ml-1">(所计算的数值字段)</span>
          </label>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="w-full text-xs rounded-lg border border-neutral-300 px-3 py-2 bg-white dark:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700"
          >
            <option value="">-- 选择指标字段 --</option>
            {activeFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({f.kind})
              </option>
            ))}
          </select>
        </div>

        {/* Aggregation Type */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">聚合方式</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "sum", name: "合计 (SUM)" },
              { id: "avg", name: "平均 (AVG)" },
              { id: "count", name: "计数 (COUNT)" },
            ].map((agg) => (
              <button
                key={agg.id}
                type="button"
                onClick={() => setAggType(agg.id as any)}
                className={cn(
                  "py-2 px-1 text-center rounded-lg border text-xs transition-colors",
                  aggType === agg.id
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                )}
              >
                {agg.name}
              </button>
            ))}
          </div>
        </div>

        {/* Chart Type Selection & Recommendation */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold text-neutral-500">显示图表类型</label>
            {recommendedChartType && recommendedChartType !== chartType && (
              <button
                onClick={handleApplyRecommendation}
                className="text-[10px] text-indigo-600 hover:underline flex items-center gap-1 dark:text-indigo-400"
              >
                <span>推荐类型:</span>
                <span className="font-semibold font-mono">
                  {recommendedChartType === "card"
                    ? "指标卡"
                    : recommendedChartType === "line"
                    ? "折线图"
                    : recommendedChartType === "bar"
                    ? "柱状图"
                    : recommendedChartType === "pie"
                    ? "饼图"
                    : "表格"}
                </span>
                <span>(应用)</span>
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-5 gap-2">
            {[
              { id: "card", name: "指标卡", icon: CreditCard },
              { id: "line", name: "折线图", icon: LineChart },
              { id: "bar", name: "柱状图", icon: BarChart2 },
              { id: "pie", name: "饼图", icon: PieChart },
              { id: "table", name: "数据表", icon: Table },
            ].map((item) => {
              const Icon = item.icon;
              const isRecommended = item.id === recommendedChartType;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setChartType(item.id as any)}
                  className={cn(
                    "relative py-3 px-1 flex flex-col items-center justify-center rounded-lg border text-[10px] gap-1 transition-all",
                    chartType === item.id
                      ? "bg-indigo-50 border-indigo-600 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800",
                    isRecommended && chartType !== item.id && "border-indigo-300 ring-1 ring-indigo-200 dark:border-indigo-850"
                  )}
                  title={isRecommended ? "智能推荐此图表" : ""}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.name}</span>
                  {isRecommended && (
                    <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Card Grid Size (w: 1 or 2 columns) */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">卡片占用宽度</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { val: 1 as const, name: "窄型 (1/2 宽)" },
              { val: 2 as const, name: "宽型 (全宽)" },
            ].map((size) => (
              <button
                key={size.val}
                type="button"
                onClick={() => setW(size.val)}
                className={cn(
                  "py-2 text-center rounded-lg border text-xs transition-colors",
                  w === size.val
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                )}
              >
                {size.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="pt-4 border-t border-neutral-100 dark:border-neutral-850 flex items-center justify-end gap-2 text-xs">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-neutral-250 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={!metric}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow disabled:opacity-50"
        >
          保存配置
        </button>
      </div>
    </div>
  );
}
