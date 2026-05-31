import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { WorkspaceFolderName, WorkspacePath } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "session"; sessionId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  folder: WorkspaceFolderName;
}

const META: Record<WorkspaceFolderName, { title: string; hint: string }> = {
  draw_data: { title: "原始数据", hint: "填入待分析的原始数据文件路径" },
  clean_data: { title: "清洗数据", hint: "填入已清洗处理的数据文件路径" },
  report: { title: "报告", hint: "填入报告输出目录或文件路径" },
};



export function FolderPathsPane({ scope, folder }: Props) {
  const [paths, setPaths] = useState<WorkspacePath[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    if (!scope) return;
    switch (scope.type) {
      case "workspace":
        api.listWorkspacePaths(scope.workspaceId, folder).then(setPaths).catch(() => setPaths([]));
        break;
      case "session":
        api.listSessionPaths(scope.sessionId, folder).then(setPaths).catch(() => setPaths([]));
        break;
      case "flow":
        api.listFlowPaths(scope.flowId, folder).then(setPaths).catch(() => setPaths([]));
        break;
    }
  }, [scope, folder]);

  useEffect(() => {
    load();
  }, [load]);

  const startAdding = () => {
    setDraft("");
    setAdding(true);
  };

  const confirm = async () => {
    const p = draft.trim();
    if (!scope || !p) return;
    switch (scope.type) {
      case "workspace":
        await api.addWorkspacePath(scope.workspaceId, folder, p);
        break;
      case "session":
        await api.addSessionPath(scope.sessionId, folder, p);
        break;
      case "flow":
        await api.addFlowPath(scope.flowId, folder, p);
        break;
    }
    setDraft("");
    setAdding(false);
    load();
  };

  const pick = async () => {
    setPicking(true);
    try {
      const { path } = await api.pickLocalPath("file");
      setDraft(path);
    } catch {
      // user cancelled — no-op
    } finally {
      setPicking(false);
    }
  };

  const remove = async (id: number) => {
    if (!scope) return;
    switch (scope.type) {
      case "workspace":
        await api.removeWorkspacePath(scope.workspaceId, id);
        break;
      case "session":
        await api.removeSessionPath(scope.sessionId, id);
        break;
      case "flow":
        await api.removeFlowPath(scope.flowId, id);
        break;
    }
    setPaths((cur) => cur.filter((p) => p.id !== id));
  };

  const { title, hint } = META[folder];

  if (!scope) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
        请先选择工作区
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">{hint}</p>
        </div>
        <button
          onClick={startAdding}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-[12.5px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          添加路径
        </button>
      </div>

      {/* inline add row */}
      {adding && (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirm();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="/path/to/file"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
          <button
            onClick={pick}
            disabled={picking}
            title="选取本地文件"
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            选取
          </button>
          <button
            onClick={() => void confirm()}
            className="inline-flex h-7 items-center rounded px-2 text-[11px] font-medium text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            确认
          </button>
          <button
            onClick={() => setAdding(false)}
            className="inline-flex h-7 items-center rounded px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            取消
          </button>
        </div>
      )}

      {/* path list */}
      <div className="space-y-1">
        {paths.map((p) => (
          <div
            key={p.id}
            className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-neutral-800 dark:text-neutral-200">
              {p.path}
            </span>
            <button
              onClick={() => void remove(p.id)}
              title="移除"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        {paths.length === 0 && !adding && (
          <p className="px-3 py-6 text-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
            还没有路径，点「添加路径」填入{title}文件路径。
          </p>
        )}
      </div>
    </div>
  );
}
