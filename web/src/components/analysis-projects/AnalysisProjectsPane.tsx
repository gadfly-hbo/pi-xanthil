import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type {
  ProjectListReadModel,
  ProjectDetailReadModel,
  CapabilitiesResponse,
  ProjectListItem,
} from "@/types/analysis-projects";
import { ProjectListPanel } from "./ProjectListPanel";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { CapabilitiesPanel } from "./CapabilitiesPanel";
import { ClosurePanel } from "./ClosurePanel";

type ViewMode = "list" | "detail" | "capabilities" | "closure";

interface Props {
  workspaceId: string | null;
}

export function AnalysisProjectsPane({ workspaceId }: Props) {
  const [view, setView] = useState<ViewMode>("list");
  const [listData, setListData] = useState<ProjectListReadModel | null>(null);
  const [detailData, setDetailData] = useState<ProjectDetailReadModel | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listAnalysisProjects(workspaceId);
      setListData(data);
      setView("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadDetail = useCallback(async (projectId: string) => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnalysisProjectDetail(workspaceId, projectId);
      setDetailData(data);
      setSelectedProjectId(projectId);
      setView("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnalysisProjectCapabilities();
      setCapabilities(data);
      setView("capabilities");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const handleSelectProject = useCallback((item: ProjectListItem) => {
    void loadDetail(item.projectId);
  }, [loadDetail]);

  const handleBackToList = useCallback(() => {
    setView("list");
    setDetailData(null);
    setSelectedProjectId(null);
    void loadList();
  }, [loadList]);

  const handleNavigateToClosure = useCallback(() => {
    setView("closure");
  }, []);

  const handleBackFromClosure = useCallback(() => {
    if (selectedProjectId) {
      void loadDetail(selectedProjectId);
    } else {
      setView("list");
    }
  }, [selectedProjectId, loadDetail]);

  if (!workspaceId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="text-center text-neutral-400">
          <FolderOpen className="mx-auto mb-2 h-8 w-8" />
          <p className="text-sm">请先选择工作区</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <button
          onClick={handleBackToList}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
            view === "list"
              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/40",
          )}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          项目列表
        </button>
        <button
          onClick={loadCapabilities}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
            view === "capabilities"
              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/40",
          )}
        >
          <Settings2 className="h-3.5 w-3.5" />
          能力
        </button>
        {selectedProjectId && view === "detail" && (
          <span className="ml-2 text-[11px] text-neutral-400 truncate">
            {detailData?.data.project.title ?? selectedProjectId}
          </span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          </div>
        )}
        {!loading && view === "list" && listData && (
          <ProjectListPanel
            data={listData}
            onSelect={handleSelectProject}
            onRefresh={loadList}
          />
        )}
        {!loading && view === "detail" && detailData && (
          <ProjectDetailPanel
            data={detailData}
            onBack={handleBackToList}
            onNavigateToClosure={handleNavigateToClosure}
          />
        )}
        {!loading && view === "capabilities" && capabilities && (
          <CapabilitiesPanel data={capabilities} />
        )}
        {!loading && view === "closure" && workspaceId && selectedProjectId && (
          <ClosurePanel
            workspaceId={workspaceId}
            projectId={selectedProjectId}
            lockedReportId={detailData?.data.lockedReportId ?? null}
            onBack={handleBackFromClosure}
          />
        )}
      </div>
    </div>
  );
}
