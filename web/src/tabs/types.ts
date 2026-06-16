import type { Dispatch, SetStateAction } from "react";
import type { Tab } from "@/components/MainHeader";
import type { SubTab } from "@/lib/constants";
import type { UiMessage } from "@/components/MessageRow";
import type { ExploreSeed, Flow, PiModel, SessionRuntime, WorkspacePath } from "@/types";

/**
 * 域渲染模块的共享上下文契约 —— owner: Claude(总控)。
 *
 * App.tsx 装配 tabCtx 后传给 DataTabs / EngineTabs / VizTabs。
 * 各域模块按需读取字段；新增字段须由总控在此声明（agent 不在此新增跨域字段）。
 */
export type FolderScope =
  | { type: "session"; sessionId: string }
  | { type: "workspace"; workspaceId: string }
  | { type: "flow"; flowId: string }
  | null;

export interface TabContext {
  activeTab: Tab;
  activeSubTab: SubTab;
  setActiveSubTab: (sub: SubTab) => void;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  folderScope: FolderScope;
  model: string;
  models: PiModel[];
  setModel: (model: string) => void;
  refreshModels: () => void;   // LLM 管理保存启用/默认后重拉 /api/models，ModelSelect 即时反映

  // explore 对话
  messages: UiMessage[];
  running: boolean;
  runtime: SessionRuntime | null;
  compacting: boolean;
  runtimeNotice: string;
  onSend: (text: string, skillPaths?: string[], businessRequirementContext?: { pathId: number; markdownPath: string; jsonPath?: string }) => void;
  onStop: () => void;
  compactContext: () => void;
  refreshRuntime: () => void;
  canPromoteToWorkflow: boolean;
  openPromote: () => void;
  openDistill: () => void;

  // 业务需求 → 数据探索 单向 seed
  exploreSeed: ExploreSeed | null;
  setExploreSeed: (seed: ExploreSeed | null) => void;

  // 报告 / 产物刷新
  handleReportPathsChange: (paths: WorkspacePath[]) => void;
  setArtifactRefreshKey: Dispatch<SetStateAction<number>>;
  refreshRulesPromptInfo: () => void;

  // 工作流 / 引擎
  activeFlow: Flow | null;
  flows: Flow[];
  rulesPromptEnabled: boolean;

  // 模型工坊
  pendingRestoreRunId: string | null;
  handleRestoreConsumed: () => void;
  handleRequestRestoreRun: (runId: string) => void;
}
