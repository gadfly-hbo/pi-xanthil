import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, Settings2, Plus, BookOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type {
  ProjectListReadModel,
  ProjectDetailReadModel,
  CapabilitiesResponse,
  ProjectListItem,
  ClosureCommandResult,
} from "@/types/analysis-projects";
import { ProjectListPanel } from "./ProjectListPanel";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { CapabilitiesPanel } from "./CapabilitiesPanel";
import { ClosurePanel } from "./ClosurePanel";
import { InstructionsPanel } from "./InstructionsPanel";
import { CreateProjectDialog } from "./CreateProjectDialog";

type ViewMode = "list" | "detail" | "instructions" | "capabilities" | "closure";

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

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  const refreshDetail = useCallback(async () => {
    if (!workspaceId || !selectedProjectId) return;
    try {
      const data = await api.getAnalysisProjectDetail(workspaceId, selectedProjectId);
      setDetailData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId, selectedProjectId]);

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
    void api.getAnalysisProjectCapabilities().then(setCapabilities).catch(() => {});
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

  const handleOpenCreateDialog = useCallback(() => {
    setCreateDialogOpen(true);
    setCreateError(null);
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
    setCreateError(null);
  }, []);

  const handleOpenInstructions = useCallback(() => {
    setView("instructions");
  }, []);

  const handleCreateProject = useCallback(async (title: string, slug: string, requirement: string) => {
    if (!workspaceId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result: ClosureCommandResult = await api.createAnalysisProject(workspaceId, { title, slug });
      if (result.kind === "executed" || result.kind === "replayed_success") {
        const data = await api.listAnalysisProjects(workspaceId);
        setListData(data);
        const newItem = data.data.items.find((item) => item.slug === slug);
        const projectId = newItem?.projectId ?? (result.resultResourceId ?? null);

        if (projectId && requirement.trim()) {
          const textBlob = new Blob([requirement], { type: "text/plain" });
          let uploadRes: ClosureCommandResult;
          try {
            uploadRes = await api.uploadEvidence(
              workspaceId,
              projectId,
              {
                displayName: `业务需求文本 - ${title}`,
                declaredDataScope: "业务问题/分析需求文本",
                usageConstraints: ["analysis_request_context"],
                safetyHandlingPolicy: "controlled_or_derived_allowed",
                safetyClass: "controlled",
                declaredMediaType: "text/plain",
                declaredByteSize: textBlob.size,
              },
              textBlob,
            );
          } catch (uploadErr) {
            setCreateError(`工单已创建，但需求材料上传失败: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
            setCreating(false);
            return;
          }
          if (uploadRes.kind !== "executed" && uploadRes.kind !== "replayed_success") {
            setCreateError(`工单已创建，但需求材料上传失败: ${uploadRes.errorSummary ?? "未知错误"}`);
            setCreating(false);
            return;
          }
          const uploadData = uploadRes.data as { evidenceArtifactId?: string } | undefined;
          const evidenceId = uploadData?.evidenceArtifactId;
          if (!evidenceId) {
            setCreateError("工单已创建，但需求材料上传未返回证据 ID");
            setCreating(false);
            return;
          }
          const locale = navigator.language || "zh-CN";
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
          let submitRes: ClosureCommandResult;
          try {
            submitRes = await api.submitAnalysisRequest(workspaceId, projectId, {
              rawRequestText: requirement,
              contextEvidenceArtifactIds: [evidenceId],
              locale,
              timezone,
            });
          } catch (submitErr) {
            setCreateError(`工单已创建，但需求提交失败: ${submitErr instanceof Error ? submitErr.message : String(submitErr)}`);
            setCreating(false);
            return;
          }
          if (submitRes.kind !== "executed" && submitRes.kind !== "replayed_success") {
            setCreateError(`工单已创建，但需求提交失败: ${submitRes.errorSummary ?? "未知错误"}`);
            setCreating(false);
            return;
          }
        }

        setCreateDialogOpen(false);
        setView("list");
        if (newItem) {
          void loadDetail(newItem.projectId);
        }
      } else if (result.kind === "failed") {
        setCreateError(result.errorSummary ?? "创建失败");
      } else if (result.kind === "conflict") {
        setCreateError("标识冲突，请使用不同的技术标识");
      } else {
        setCreateError("创建请求未成功，请重试");
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [workspaceId, loadDetail]);

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

  const isEmpty = !loading && view === "list" && listData && listData.data.items.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <button
          onClick={handleBackToList}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
            view === "list" || view === "detail"
              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/40",
          )}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          项目列表
        </button>
        <button
          onClick={handleOpenInstructions}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
            view === "instructions"
              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/40",
          )}
        >
          <BookOpen className="h-3.5 w-3.5" />
          使用说明
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
          <span className="ml-2 truncate text-[11px] text-neutral-400">
            {detailData?.data.project.title ?? selectedProjectId}
          </span>
        )}
        {(view === "list" || view === "instructions") && (
          <button
            onClick={handleOpenCreateDialog}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            新建分析工单
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          </div>
        )}
        {!loading && view === "instructions" && <InstructionsPanel />}
        {!loading && isEmpty && view === "list" && (
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <div className="text-center">
              <FolderOpen className="mx-auto mb-2 h-8 w-8 text-neutral-300 dark:text-neutral-600" />
              <p className="text-[13px] text-neutral-500 dark:text-neutral-400">暂无分析工单</p>
              <p className="mt-1 text-[11px] text-neutral-400">
                点击「新建分析工单」创建第一张工单，或查看使用说明了解流程
              </p>
            </div>
          </div>
        )}
        {!loading && view === "list" && listData && listData.data.items.length > 0 && (
          <ProjectListPanel
            data={listData}
            onSelect={handleSelectProject}
            onRefresh={loadList}
          />
        )}
        {!loading && view === "detail" && detailData && (
          <ProjectDetailPanel
            data={detailData}
            workspaceId={workspaceId}
            capabilities={capabilities}
            onRefresh={refreshDetail}
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

      <CreateProjectDialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        onSubmit={handleCreateProject}
        creating={creating}
        createError={createError}
      />
    </div>
  );
}
