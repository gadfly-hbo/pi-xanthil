import { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  MessageSquarePlus,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Trash2,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";
import type { Flow, Session, Workspace } from "@/types";

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  sessions: Session[];
  activeSessionId: string | null;
  flows: Flow[];
  activeFlowId: string | null;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (id: string) => void;
  onSelectFlow: (id: string) => void;
  onNewWorkspace: (name: string) => void;
  onNewSession: () => void;
  onNewFlow: (kind: "single" | "multi") => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameFlow: (id: string, name: string) => void;
  onDeleteFlow: (id: string) => void;
  onCollapse: () => void;
}

const ICON = 1.75;
const MIN_W = 220;
const MAX_W = 420;

const iconBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
const rowActionBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200";

const editInput =
  "w-full rounded-sm border border-neutral-300 bg-white px-1.5 py-0.5 text-[12.5px] text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

function SectionHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center px-3 pb-1">
      <span className="flex-1 text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500/90 dark:text-neutral-400/80">
        {label}
      </span>
      {children}
    </div>
  );
}

export function Sidebar(p: Props) {
  const [theme, toggleTheme] = useTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ kind: "ws" | "session" | "flow"; id: string; value: string } | null>(null);

  const [width, setWidth] = useState(() => Number(localStorage.getItem("xanthil-sidebar-w")) || 264);
  const dragging = useRef(false);

  const onDragStart = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.max(MIN_W, Math.min(MAX_W, e.clientX)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem("xanthil-sidebar-w", String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function commitEdit() {
    if (!editing) return;
    const v = editing.value.trim();
    if (v) {
      if (editing.kind === "ws") p.onRenameWorkspace(editing.id, v);
      else if (editing.kind === "session") p.onRenameSession(editing.id, v);
      else p.onRenameFlow(editing.id, v);
    }
    setEditing(null);
  }

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-950"
    >
      {/* header */}
      <div className="flex h-16 items-center justify-between pl-4 pr-3">
        <div className="flex min-w-0 items-center gap-2 select-none">
          <span className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Pi-Xanthil</span>
        </div>
        <button onClick={p.onCollapse} title="收起侧栏" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100">
          <PanelLeftClose className="h-4 w-4" strokeWidth={ICON} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* workspaces */}
        <section className="pt-2">
          <SectionHeader label="工作区">
            <button className={iconBtn} title="新建工作区" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" strokeWidth={ICON} />
            </button>
          </SectionHeader>
          <div className="space-y-0.5">
            {p.workspaces.map((w) =>
              editing?.kind === "ws" && editing.id === w.id ? (
                <div key={w.id} className="px-2 py-0.5">
                  <input
                    autoFocus
                    value={editing.value}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={commitEdit}
                    className={editInput}
                  />
                </div>
              ) : (
                <div
                  key={w.id}
                  className={cn(
                    "group flex items-center rounded-md",
                    w.id === p.activeWorkspaceId
                      ? "bg-neutral-200/70 dark:bg-neutral-800"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                  )}
                >
                  <button onClick={() => p.onSelectWorkspace(w.id)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={ICON} />
                    <span className="truncate">{w.name}</span>
                  </button>
                  <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button className={rowActionBtn} title="重命名" onClick={() => setEditing({ kind: "ws", id: w.id, value: w.name })}>
                      <Pencil className="h-3.5 w-3.5" strokeWidth={ICON} />
                    </button>
                    <button
                      className={rowActionBtn}
                      title="删除"
                      onClick={() => {
                        if (confirm(`删除工作区「${w.name}」及其全部会话记录？（磁盘文件保留）`)) p.onDeleteWorkspace(w.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={ICON} />
                    </button>
                  </div>
                </div>
              ),
            )}
            {adding && (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    p.onNewWorkspace(name.trim());
                    setName("");
                    setAdding(false);
                  }
                  if (e.key === "Escape") setAdding(false);
                }}
                onBlur={() => setAdding(false)}
                placeholder="名称，回车创建"
                className={cn(editInput, "mx-2 w-[calc(100%-1rem)]")}
              />
            )}
            {p.workspaces.length === 0 && !adding && (
              <div className="px-3 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">还没有工作区，点 + 新建。</div>
            )}
          </div>
        </section>

        {/* sessions */}
        {p.activeWorkspaceId && (
          <section className="pt-3">
            <SectionHeader label="探索">
              <button className={iconBtn} title="新建会话" onClick={p.onNewSession}>
                <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={ICON} />
              </button>
            </SectionHeader>
            <div className="space-y-0.5">
              {p.sessions.map((s) =>
                editing?.kind === "session" && editing.id === s.id ? (
                  <div key={s.id} className="px-2 py-0.5">
                    <input
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={commitEdit}
                      className={editInput}
                    />
                  </div>
                ) : (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex items-center rounded-md",
                      s.id === p.activeSessionId ? "bg-neutral-200/70 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                    )}
                  >
                    <button onClick={() => p.onSelectSession(s.id)} className="block min-w-0 flex-1 px-2 py-1 text-left">
                      <div className="truncate text-[12.5px] text-neutral-900 dark:text-neutral-100">{s.title}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        {new Date(s.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button className={rowActionBtn} title="重命名" onClick={() => setEditing({ kind: "session", id: s.id, value: s.title })}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                      <button
                        className={rowActionBtn}
                        title="删除"
                        onClick={() => {
                          if (confirm(`删除会话「${s.title}」？`)) p.onDeleteSession(s.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                    </div>
                  </div>
                ),
              )}
              {p.sessions.length === 0 && (
                <div className="px-3 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">还没有会话，点上方 + 新建。</div>
              )}
            </div>
          </section>
        )}

        {/* single-agent flows */}
        {p.activeWorkspaceId && (
          <section className="pt-3">
            <SectionHeader label="单智能体">
              <button className={iconBtn} title="新建单智能体" onClick={() => p.onNewFlow("single")}>
                <Plus className="h-3.5 w-3.5" strokeWidth={ICON} />
              </button>
            </SectionHeader>
            <div className="space-y-0.5">
              {p.flows.filter((f) => f.kind === "single" || !f.kind).map((f) =>
                editing?.kind === "flow" && editing.id === f.id ? (
                  <div key={f.id} className="px-2 py-0.5">
                    <input
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={commitEdit}
                      className={editInput}
                    />
                  </div>
                ) : (
                  <div
                    key={f.id}
                    className={cn(
                      "group flex items-center rounded-md",
                      f.id === p.activeFlowId
                        ? "bg-neutral-200/70 dark:bg-neutral-800"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                    )}
                  >
                    <button onClick={() => p.onSelectFlow(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200">
                      <Workflow className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={ICON} />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      {f.sourceName && (
                        <span className="ml-1 shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{f.sourceName}</span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button className={rowActionBtn} title="重命名" onClick={() => setEditing({ kind: "flow", id: f.id, value: f.name })}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                      <button
                        className={rowActionBtn}
                        title="删除"
                        onClick={() => {
                          if (confirm(`删除工作流「${f.name}」？（磁盘文件保留）`)) p.onDeleteFlow(f.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                    </div>
                  </div>
                ),
              )}
              {p.flows.filter((f) => f.kind === "single" || !f.kind).length === 0 && (
                <div className="px-3 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">还没有单智能体，点上方 + 新建。</div>
              )}
            </div>
          </section>
        )}

        {/* multi-agent flows */}
        {p.activeWorkspaceId && (
          <section className="pt-3">
            <SectionHeader label="多智能体">
              <button className={iconBtn} title="新建多智能体" onClick={() => p.onNewFlow("multi")}>
                <Plus className="h-3.5 w-3.5" strokeWidth={ICON} />
              </button>
            </SectionHeader>
            <div className="space-y-0.5">
              {p.flows.filter((f) => f.kind === "multi").map((f) =>
                editing?.kind === "flow" && editing.id === f.id ? (
                  <div key={f.id} className="px-2 py-0.5">
                    <input
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={commitEdit}
                      className={editInput}
                    />
                  </div>
                ) : (
                  <div
                    key={f.id}
                    className={cn(
                      "group flex items-center rounded-md",
                      f.id === p.activeFlowId
                        ? "bg-neutral-200/70 dark:bg-neutral-800"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
                    )}
                  >
                    <button onClick={() => p.onSelectFlow(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[12.5px] text-neutral-800 dark:text-neutral-200">
                      <Workflow className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={ICON} />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      {f.sourceName && (
                        <span className="ml-1 shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{f.sourceName}</span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button className={rowActionBtn} title="重命名" onClick={() => setEditing({ kind: "flow", id: f.id, value: f.name })}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                      <button
                        className={rowActionBtn}
                        title="删除"
                        onClick={() => {
                          if (confirm(`删除工作流「${f.name}」？（磁盘文件保留）`)) p.onDeleteFlow(f.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={ICON} />
                      </button>
                    </div>
                  </div>
                ),
              )}
              {p.flows.filter((f) => f.kind === "multi").length === 0 && (
                <div className="px-3 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">还没有多智能体，点上方 + 新建。</div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center gap-1 border-t border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <button className="flex h-9 flex-1 items-center justify-start gap-2 rounded-lg px-3 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100">
          <SettingsIcon className="h-4 w-4" strokeWidth={ICON} />
          <span>设置</span>
        </button>
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" strokeWidth={ICON} /> : <Moon className="h-4 w-4" strokeWidth={ICON} />}
        </button>
      </div>

      {/* resize handle */}
      <div
        onMouseDown={onDragStart}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-neutral-300 dark:hover:bg-neutral-700"
      />
    </aside>
  );
}
