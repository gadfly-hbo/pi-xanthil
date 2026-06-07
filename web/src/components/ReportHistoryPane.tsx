import { useMemo, useState, useRef, useEffect, lazy, Suspense } from "react";
import { Search, Star, RefreshCw, FileText, Folder, Database, Eye, Loader2, Calendar, Activity, FolderOpen, Tag as TagIcon, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useReportHistory } from "@/lib/useReportHistory";
import { ReportPreviewDrawer } from "@/components/ReportPreviewDrawer";
import type { ReportEntry, ReportFileType } from "@/types";
import {
  REPORT_TYPE_LABELS,
  REPORT_TYPE_COLORS,
  REPORT_TYPE_ORDER,
  formatSize,
  formatDateShort,
  formatDayKey,
} from "@/lib/reportTypeClassifier";

const ReactECharts = lazy(() => import("echarts-for-react"));

const ChartFallback = () => (
  <div className="flex h-[180px] items-center justify-center text-neutral-300">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
);

const TYPE_COLOR_HEX: Record<ReportFileType, string> = {
  final_summary: "#10b981",
  research_report: "#6366f1",
  presentation: "#f43f5e",
  draft: "#f59e0b",
  supplement: "#3b82f6",
  handoff_log: "#a855f7",
  sample_report: "#737373",
  other: "#a3a3a3",
};

export function ReportHistoryPane() {
  const { entries, loading, refreshing, error, scannedAt, allTags, refresh, toggleFavorite, addTag, removeTag } = useReportHistory();
  const [query, setQuery] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<ReportFileType | "all">("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [previewEntry, setPreviewEntry] = useState<ReportEntry | null>(null);

  // workspaces 列表 (空 workspace 不参与统计)
  const workspaces = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (!map.has(e.workspaceId)) {
        map.set(e.workspaceId, e.workspaceName ?? e.workspaceId.slice(0, 8));
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entries]);

  // 过滤
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (favoriteOnly && !e.isFavorite) return false;
      if (workspaceFilter !== "all" && e.workspaceId !== workspaceFilter) return false;
      if (typeFilter !== "all" && e.reportType !== typeFilter) return false;
      if (selectedTags.size > 0) {
        // OR 语义: 报告含有任一选中 tag 即匹配
        const hit = e.tags.some((t) => selectedTags.has(t));
        if (!hit) return false;
      }
      if (q && !e.filename.toLowerCase().includes(q) && !e.relativePath.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, query, workspaceFilter, typeFilter, favoriteOnly, selectedTags]);

  // KPI
  const totalCount = entries.length;
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekCount = entries.filter((e) => e.createdAt >= weekStart).length;
  const workspaceCount = workspaces.length;
  const favoriteCount = entries.filter((e) => e.isFavorite).length;

  // 时间轴: 最近 30 天按日聚合
  const timelineOption = useMemo(() => {
    const days: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      days.push(formatDayKey(d.getTime()));
    }
    const counts = new Map<string, number>();
    days.forEach((d) => counts.set(d, 0));
    for (const e of filtered) {
      const k = formatDayKey(e.createdAt);
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return {
      grid: { left: 40, right: 12, top: 16, bottom: 36 },
      tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
      xAxis: {
        type: "category" as const,
        data: days.map((d) => d.slice(5)),
        axisLabel: { fontSize: 10, color: "#737373", interval: 4 },
        axisLine: { lineStyle: { color: "#e5e5e5" } },
      },
      yAxis: {
        type: "value" as const,
        minInterval: 1,
        axisLabel: { fontSize: 10, color: "#737373" },
        splitLine: { lineStyle: { color: "#f5f5f5" } },
      },
      series: [{
        type: "bar" as const,
        data: days.map((d) => counts.get(d) ?? 0),
        itemStyle: { color: "#3b82f6", borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 16,
      }],
    };
  }, [filtered]);

  // 类型饼图
  const typePieOption = useMemo(() => {
    const counts = new Map<ReportFileType, number>();
    for (const e of filtered) counts.set(e.reportType, (counts.get(e.reportType) ?? 0) + 1);
    const data = REPORT_TYPE_ORDER
      .filter((t) => (counts.get(t) ?? 0) > 0)
      .map((t) => ({
        name: REPORT_TYPE_LABELS[t],
        value: counts.get(t) ?? 0,
        itemStyle: { color: TYPE_COLOR_HEX[t] },
        _typeId: t,
      }));
    return {
      tooltip: { trigger: "item" as const, formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, left: "center", textStyle: { fontSize: 10 }, itemWidth: 10, itemHeight: 8 },
      series: [{
        type: "pie" as const,
        radius: ["38%", "62%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data,
      }],
    };
  }, [filtered]);

  const onPieClick = (params: { data?: { _typeId?: ReportFileType } }) => {
    const t = params?.data?._typeId;
    if (t) setTypeFilter(typeFilter === t ? "all" : t);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-[13px]">扫描报告中…</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-neutral-500">
        <FileText className="h-12 w-12 text-neutral-300" strokeWidth={1.25} />
        <div>
          <div className="text-[14px] font-medium text-neutral-700 dark:text-neutral-300">还没有产出报告</div>
          <div className="mt-1 text-[12px]">运行一个工作流后,这里会自动收集 .md / .html 报告</div>
        </div>
        <button
          onClick={refresh}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          重新扫描
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50/70 dark:bg-neutral-950">
      {/* KPI 行 */}
      <div className="grid shrink-0 grid-cols-4 gap-3 px-5 pt-5">
        <KpiCard label="报告总数" value={totalCount} icon={FileText} accent="text-blue-600" />
        <KpiCard label="本周新增" value={weekCount} icon={Activity} accent="text-emerald-600" />
        <KpiCard label="参与项目" value={workspaceCount} icon={Folder} accent="text-violet-600" />
        <KpiCard label="收藏数" value={favoriteCount} icon={Star} accent="text-amber-600" />
      </div>

      {/* 图表区 */}
      <div className="grid shrink-0 grid-cols-3 gap-3 px-5 pt-3">
        <div className="col-span-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              <Calendar className="mr-1 inline h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
              最近 30 天产出
            </div>
            <div className="text-[11px] text-neutral-400">{filtered.length} / {totalCount} 份(已过滤)</div>
          </div>
          <Suspense fallback={<ChartFallback />}>
            <ReactECharts option={timelineOption} style={{ height: 180 }} notMerge lazyUpdate />
          </Suspense>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              <Database className="mr-1 inline h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
              类型分布
            </div>
            {typeFilter !== "all" && (
              <button onClick={() => setTypeFilter("all")} className="text-[10.5px] text-blue-600 hover:underline">清除</button>
            )}
          </div>
          <Suspense fallback={<ChartFallback />}>
            <ReactECharts
              option={typePieOption}
              style={{ height: 180 }}
              notMerge
              lazyUpdate
              onEvents={{ click: onPieClick }}
            />
          </Suspense>
        </div>
      </div>

      {/* 筛选条 */}
      <div className="flex shrink-0 items-center gap-2 border-y border-neutral-200 bg-white/60 px-5 py-2.5 mt-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件名 / 路径"
            className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-[12.5px] text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          />
        </div>
        <select
          value={workspaceFilter}
          onChange={(e) => setWorkspaceFilter(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="all">全部项目</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ReportFileType | "all")}
          className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="all">全部类型</option>
          {REPORT_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <button
          onClick={() => setFavoriteOnly((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
            favoriteOnly
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", favoriteOnly && "fill-current")} strokeWidth={1.75} />
          仅收藏
        </button>
        <TagFilter
          allTags={allTags}
          selected={selectedTags}
          onChange={setSelectedTags}
        />
        <div className="ml-auto flex items-center gap-2">
          {scannedAt && <span className="text-[11px] text-neutral-400">扫描于 {new Date(scannedAt).toLocaleTimeString()}</span>}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} strokeWidth={1.75} />
            重新扫描
          </button>
        </div>
      </div>

      {/* 卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-neutral-400">
            <FileText className="h-8 w-8" strokeWidth={1.25} />
            <span className="text-[12.5px]">无符合条件的报告</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((e) => (
              <ReportCard
                key={e.id}
                entry={e}
                onPreview={() => setPreviewEntry(e)}
                onToggleFavorite={() => toggleFavorite(e.id)}
              />
            ))}
          </div>
        )}
      </div>

      <ReportPreviewDrawer
        entry={previewEntry}
        allTags={allTags}
        onClose={() => setPreviewEntry(null)}
        onToggleFavorite={(id) => {
          void toggleFavorite(id);
          if (previewEntry) setPreviewEntry({ ...previewEntry, isFavorite: !previewEntry.isFavorite });
        }}
        onAddTag={(id, tag) => {
          void addTag(id, tag);
          if (previewEntry && previewEntry.id === id && !previewEntry.tags.includes(tag)) {
            setPreviewEntry({ ...previewEntry, tags: [...previewEntry.tags, tag] });
          }
        }}
        onRemoveTag={(id, tag) => {
          void removeTag(id, tag);
          if (previewEntry && previewEntry.id === id) {
            setPreviewEntry({ ...previewEntry, tags: previewEntry.tags.filter((t) => t !== tag) });
          }
        }}
      />
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof FileText; accent: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium uppercase tracking-wider text-neutral-400">{label}</span>
        <Icon className={cn("h-3.5 w-3.5", accent)} strokeWidth={1.75} />
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-tight text-neutral-900 dark:text-neutral-100">{value}</div>
    </div>
  );
}

function ReportCard({ entry, onPreview, onToggleFavorite }: { entry: ReportEntry; onPreview: () => void; onToggleFavorite: () => void }) {
  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium", REPORT_TYPE_COLORS[entry.reportType])}>
          {REPORT_TYPE_LABELS[entry.reportType]}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-neutral-400">{entry.extension}</span>
        <button
          onClick={onToggleFavorite}
          className={cn(
            "ml-auto rounded p-1 transition-colors",
            entry.isFavorite ? "text-amber-500" : "text-neutral-300 hover:text-amber-500",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", entry.isFavorite && "fill-current")} strokeWidth={1.75} />
        </button>
      </div>
      <button onClick={onPreview} className="text-left">
        <div className="line-clamp-2 text-[12.5px] font-medium leading-snug text-neutral-900 hover:text-blue-600 dark:text-neutral-100 dark:hover:text-blue-400" title={entry.filename}>
          {entry.filename}
        </div>
      </button>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-neutral-500 dark:text-neutral-400">
        <FolderOpen className="h-3 w-3" strokeWidth={1.75} />
        <span className="truncate" title={entry.workspaceName ?? entry.workspaceId}>{entry.workspaceName ?? entry.workspaceId.slice(0, 8)}</span>
        {entry.flowId && <span className="text-neutral-300">·</span>}
        {entry.flowId && (
          <span className="truncate max-w-[140px]" title={`flow: ${entry.flowName ?? entry.flowId}`}>
            flow {entry.flowName ?? entry.flowId.slice(0, 6)}
          </span>
        )}
      </div>
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {entry.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 py-px text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
            >
              {tag}
            </span>
          ))}
          {entry.tags.length > 3 && (
            <span className="text-[10px] text-neutral-400">+{entry.tags.length - 3}</span>
          )}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between text-[10.5px] text-neutral-400">
        <span>{formatDateShort(entry.createdAt)} · {formatSize(entry.sizeBytes)}</span>
        <button
          onClick={onPreview}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-neutral-500 opacity-0 hover:bg-neutral-100 group-hover:opacity-100 dark:hover:bg-neutral-800"
        >
          <Eye className="h-3 w-3" strokeWidth={1.75} />
          预览
        </button>
      </div>
    </div>
  );
}

function TagFilter({
  allTags,
  selected,
  onChange,
}: {
  allTags: Array<{ tag: string; count: number }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.tag.toLowerCase().includes(q));
  }, [allTags, query]);

  const toggle = (tag: string) => {
    const next = new Set(selected);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(next);
  };

  const clear = () => onChange(new Set());

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
          selected.size > 0
            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
        )}
      >
        <TagIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
        标签{selected.size > 0 && <span className="ml-0.5">· {selected.size}</span>}
        <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-1.5 flex items-center gap-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标签…"
              className="flex-1 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[11.5px] outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-800"
            />
            {selected.size > 0 && (
              <button
                onClick={clear}
                className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                title="清空"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-1 py-3 text-center text-[11px] text-neutral-400">暂无标签</div>
            ) : (
              filtered.map((t) => {
                const on = selected.has(t.tag);
                return (
                  <button
                    key={t.tag}
                    onClick={() => toggle(t.tag)}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11.5px]",
                      on
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn(
                        "inline-flex h-3 w-3 items-center justify-center rounded border",
                        on ? "border-blue-500 bg-blue-500 text-white" : "border-neutral-300 dark:border-neutral-600",
                      )}>
                        {on && <span className="text-[9px] leading-none">✓</span>}
                      </span>
                      {t.tag}
                    </span>
                    <span className="text-[10px] text-neutral-400">{t.count}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
