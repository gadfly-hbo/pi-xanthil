import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CircleAlert,
  Database,
  FileText,
  Folder,
  Languages,
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { EMPTY_EXPLORE_OUTPUT_STATUS, listExploreScopePaths, loadExploreOutputStatus, type ExploreOutputStatus } from "@/lib/exploreResources";
import type { SubTab } from "@/lib/constants";
import type { FolderScope } from "@/tabs/types";
import type { WorkspacePath } from "@/types";

export type ExploreDrawerKind = "data" | "outputs";

interface Props {
  kind: ExploreDrawerKind;
  scope: FolderScope;
  refreshKey: number;
  isVisible: (key: string) => boolean;
  onClose: () => void;
  onNavigate: (subTab: SubTab) => void;
}

interface DataState {
  drawData: WorkspacePath[];
  cleanData: WorkspacePath[];
}

const EMPTY_DATA: DataState = { drawData: [], cleanData: [] };

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function pathStatus(path: WorkspacePath): { label: string; tone: string } {
  if (path.status === "missing" || path.exists === false) return { label: "缺失", tone: "text-rose-500" };
  if (path.status === "kind_mismatch") return { label: "类型异常", tone: "text-amber-600 dark:text-amber-400" };
  return { label: path.kind === "dir" ? "目录" : "文件", tone: "text-neutral-400" };
}

function DataSection({
  title,
  paths,
  subTab,
  alert,
  onNavigate,
}: {
  title: string;
  paths: WorkspacePath[];
  subTab: SubTab;
  alert?: boolean;
  onNavigate: (subTab: SubTab) => void;
}) {
  const visiblePaths = paths.slice(0, 6);
  return (
    <section className="border-b border-neutral-200 py-3 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => onNavigate(subTab)}
        className="flex h-8 w-full items-center gap-2 px-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
      >
        {alert ? <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} /> : <Database className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.75} />}
        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200">{title}</span>
        <span className="text-[11px] tabular-nums text-neutral-400">{paths.length} 项</span>
        <ArrowRight className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
      </button>
      <div className="mt-1 px-4">
        {visiblePaths.length === 0 ? (
          <p className="py-2 pl-6 text-[11.5px] text-neutral-400">暂无登记数据</p>
        ) : visiblePaths.map((path) => {
          const status = pathStatus(path);
          const PathIcon = path.kind === "dir" ? Folder : FileText;
          return (
            <button
              key={path.id}
              type="button"
              onClick={() => onNavigate(subTab)}
              className="flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              title={path.path}
            >
              <PathIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-neutral-600 dark:text-neutral-300">{basename(path.path)}</span>
              <span className={cn("shrink-0 text-[10.5px]", status.tone)}>{status.label}</span>
            </button>
          );
        })}
        {paths.length > visiblePaths.length && (
          <p className="px-2 pt-1 text-[10.5px] text-neutral-400">另有 {paths.length - visiblePaths.length} 项</p>
        )}
      </div>
    </section>
  );
}

function OutputRow({ icon: Icon, label, count, subTab, onNavigate }: {
  icon: LucideIcon;
  label: string;
  count: number;
  subTab: SubTab;
  onNavigate: (subTab: SubTab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(subTab)}
      className="flex h-10 w-full items-center gap-2 px-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
    >
      <Icon className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 dark:text-neutral-200">{label}</span>
      <span className={cn("text-[11px] tabular-nums", count > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
        {count > 0 ? `${count} 项` : "暂无"}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
    </button>
  );
}

export function ExploreResourceDrawer({ kind, scope, refreshKey, isVisible, onClose, onNavigate }: Props) {
  const [data, setData] = useState<DataState>(EMPTY_DATA);
  const [outputs, setOutputs] = useState<ExploreOutputStatus>(EMPTY_EXPLORE_OUTPUT_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);
  const title = kind === "data" ? "数据" : "产物";

  const load = useCallback(async () => {
    const requestId = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      if (kind === "data") {
        const [drawData, cleanData] = await Promise.all([
          listExploreScopePaths(scope, "draw_data"),
          listExploreScopePaths(scope, "clean_data"),
        ]);
        if (requestId !== requestSeq.current) return;
        setData({ drawData, cleanData });
        return;
      }

      const counts = await loadExploreOutputStatus(scope);
      if (requestId !== requestSeq.current) return;
      setOutputs(counts);
    } catch (err) {
      if (requestId !== requestSeq.current) return;
      setError(String(err));
      if (kind === "data") setData(EMPTY_DATA);
      else setOutputs(EMPTY_EXPLORE_OUTPUT_STATUS);
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  }, [kind, scope]);

  useEffect(() => {
    void load();
    return () => {
      requestSeq.current += 1;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const navigate = (subTab: SubTab) => {
    onClose();
    onNavigate(subTab);
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭资源抽屉"
        onClick={onClose}
        className="fixed inset-x-0 bottom-0 top-[5.75rem] z-40 bg-black/15 md:bg-transparent"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${title}抽屉`}
        className="fixed bottom-0 right-0 top-[5.75rem] z-50 flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <span className="min-w-0 flex-1 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{title}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title={`刷新${title}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={`关闭${title}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {!scope ? (
            <p className="px-4 py-8 text-center text-[12px] text-neutral-400">请先选择工作区或会话</p>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在载入
            </div>
          ) : error ? (
            <div className="mx-4 mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          ) : kind === "data" ? (
            <>
              {isVisible("explore:draw_data") && <DataSection title="原始数据" paths={data.drawData} subTab="draw_data" onNavigate={navigate} />}
              {isVisible("explore:clean_data") && <DataSection title="聚合数据" paths={data.cleanData} subTab="clean_data" alert onNavigate={navigate} />}
              {isVisible("explore:data_exploration") && (
                <button
                  type="button"
                  onClick={() => navigate("data_exploration")}
                  className="flex h-11 w-full items-center gap-2 border-b border-neutral-200 px-4 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                >
                  <BarChart3 className="h-4 w-4 text-neutral-400" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 dark:text-neutral-200">数据探索</span>
                  <ArrowRight className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
                </button>
              )}
            </>
          ) : (
            <>
              <div className="border-b border-neutral-200 px-4 py-2 text-[10.5px] text-neutral-400 dark:border-neutral-800">
                {outputs.roots} 个报告输出位置
                {outputs.unavailableRoots > 0 && <span className="ml-2 text-rose-500">{outputs.unavailableRoots} 个不可用</span>}
              </div>
              {isVisible("explore:report") && <OutputRow icon={FileText} label="报告输出" count={outputs.report} subTab="report" onNavigate={navigate} />}
              {isVisible("explore:report_review") && <OutputRow icon={ShieldCheck} label="报告审核" count={outputs.review} subTab="report_review" onNavigate={navigate} />}
              {isVisible("explore:presentation_version") && <OutputRow icon={Languages} label="业务语言" count={outputs.presentation} subTab="presentation_version" onNavigate={navigate} />}
              {isVisible("explore:golden_strategy") && <OutputRow icon={Lightbulb} label="黄金策" count={outputs.golden} subTab="golden_strategy" onNavigate={navigate} />}
              {isVisible("explore:actions") && <OutputRow icon={ListChecks} label="执行反馈" count={outputs.actions} subTab="actions" onNavigate={navigate} />}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
