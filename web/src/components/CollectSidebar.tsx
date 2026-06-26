import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { CollectFolder, CollectSession } from "@/types";
import type { TabContext } from "@/tabs/types";

type EditTarget =
  | { kind: "folder"; id: string; value: string }
  | { kind: "session"; id: string; value: string };

const ICON = 1.75;
const iconBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
const rowActionBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200";
const editInput =
  "w-full rounded-sm border border-neutral-300 bg-white px-1.5 py-0.5 text-[12px] text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function groupSessions(sessions: CollectSession[], folders: CollectFolder[]): Array<{ folder: CollectFolder | null; sessions: CollectSession[] }> {
  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  return [
    ...folders.map((folder) => ({
      folder,
      sessions: sessions.filter((session) => session.collectFolderId === folder.id),
    })),
    {
      folder: null,
      sessions: sessions.filter((session) => !session.collectFolderId || !knownFolderIds.has(session.collectFolderId)),
    },
  ];
}

function SessionRow({
  session,
  active,
  folders,
  editing,
  setEditing,
  commitEdit,
  ctx,
}: {
  session: CollectSession;
  active: boolean;
  folders: CollectFolder[];
  editing: EditTarget | null;
  setEditing: (target: EditTarget | null) => void;
  commitEdit: () => void;
  ctx: TabContext;
}) {
  if (editing?.kind === "session" && editing.id === session.id) {
    return (
      <div className="px-2 py-0.5">
        <input
          autoFocus
          value={editing.value}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitEdit();
            if (event.key === "Escape") setEditing(null);
          }}
          onBlur={commitEdit}
          className={editInput}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md",
        active ? "bg-neutral-200/70 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
      )}
    >
      <button type="button" onClick={() => ctx.setActiveCollectSessionId(session.id)} className="block min-w-0 flex-1 px-2 py-1 text-left">
        <div className="truncate text-[12.5px] text-neutral-900 dark:text-neutral-100">{session.title}</div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatTime(session.updatedAt)}</div>
      </button>
      <select
        value={session.collectFolderId ?? ""}
        onChange={(event) => void ctx.setCollectSessionFolder(session.id, event.target.value || null)}
        title="归入文件夹"
        className="mr-1 hidden h-6 max-w-24 rounded-md border border-neutral-200 bg-white px-1 text-[11px] text-neutral-500 outline-none group-hover:block dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
      >
        <option value="">未分类</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>{folder.name}</option>
        ))}
      </select>
      <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button className={rowActionBtn} title="重命名" onClick={() => setEditing({ kind: "session", id: session.id, value: session.title })}>
          <Pencil className="h-3.5 w-3.5" strokeWidth={ICON} />
        </button>
        <button className={rowActionBtn} title="删除" onClick={() => {
          if (window.confirm(`删除收集会话「${session.title}」？`)) void ctx.deleteCollectSession(session.id);
        }}>
          <Trash2 className="h-3.5 w-3.5" strokeWidth={ICON} />
        </button>
      </div>
    </div>
  );
}

export function CollectSidebar({ ctx }: { ctx: TabContext }) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => groupSessions(ctx.collectSessions, ctx.collectFolders), [ctx.collectSessions, ctx.collectFolders]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    await api.createCollectFolder(name);
    setFolderName("");
    setAddingFolder(false);
    ctx.refreshCollectFolders();
  }

  async function deleteFolder(folder: CollectFolder) {
    if (!window.confirm(`删除文件夹「${folder.name}」？其下收集会话会移到未分类。`)) return;
    await api.deleteCollectFolder(folder.id);
    ctx.refreshCollectFolders();
    void ctx.refreshCollectSessions();
  }

  function commitEdit() {
    if (!editing) return;
    const value = editing.value.trim();
    if (value) {
      if (editing.kind === "folder") {
        api.renameCollectFolder(editing.id, value)
          .then(() => ctx.refreshCollectFolders())
          .catch(() => undefined);
      } else {
        ctx.renameCollectSession(editing.id, value);
      }
    }
    setEditing(null);
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
        <div className="text-[12px] font-semibold text-neutral-800 dark:text-neutral-100">收集历史</div>
        <div className="flex items-center gap-1">
          <button className={iconBtn} title="新建文件夹" onClick={() => setAddingFolder(true)}>
            <FolderPlus className="h-3.5 w-3.5" strokeWidth={ICON} />
          </button>
          <button className={iconBtn} title="新建收集会话" onClick={() => void ctx.createCollectSession(null)}>
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={ICON} />
          </button>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {addingFolder && (
          <input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createFolder();
              if (event.key === "Escape") setAddingFolder(false);
            }}
            onBlur={() => {
              if (folderName.trim()) void createFolder();
              else setAddingFolder(false);
            }}
            placeholder="文件夹名称，回车创建"
            className={cn(editInput, "mb-2")}
          />
        )}

        <div className="space-y-2">
          {groups.map(({ folder, sessions }) => {
            const id = folder?.id ?? "__unfiled__";
            const isCollapsed = collapsed.has(id);
            return (
              <section key={id}>
                <div className="group flex items-center rounded-md">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left" onClick={() => toggle(id)}>
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-neutral-500" strokeWidth={ICON} /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-500" strokeWidth={ICON} />}
                    <Folder className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={ICON} />
                    <span className="truncate text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">{folder?.name ?? "未分类"}</span>
                    <span className="text-[11px] text-neutral-400">{sessions.length}</span>
                  </button>
                  {folder && (
                    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <button className={rowActionBtn} title="重命名文件夹" onClick={() => setEditing({ kind: "folder", id: folder.id, value: folder.name })}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                      <button className={rowActionBtn} title="删除文件夹" onClick={() => void deleteFolder(folder)}>
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                    </div>
                  )}
                </div>
                {editing?.kind === "folder" && folder?.id === editing.id && (
                  <div className="px-2 pb-1">
                    <input
                      autoFocus
                      value={editing.value}
                      onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitEdit();
                        if (event.key === "Escape") setEditing(null);
                      }}
                      onBlur={commitEdit}
                      className={editInput}
                    />
                  </div>
                )}
                {!isCollapsed && (
                  <div className="space-y-0.5 pl-2">
                    {sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        active={session.id === ctx.activeCollectSessionId}
                        folders={ctx.collectFolders}
                        editing={editing}
                        setEditing={setEditing}
                        commitEdit={commitEdit}
                        ctx={ctx}
                      />
                    ))}
                    {sessions.length === 0 && (
                      <div className="px-2 py-1 text-[11px] text-neutral-400">暂无会话</div>
                    )}
                    <button
                      type="button"
                      onClick={() => void ctx.createCollectSession(folder?.id ?? null)}
                      className="ml-1 inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={ICON} />
                      新建会话
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
