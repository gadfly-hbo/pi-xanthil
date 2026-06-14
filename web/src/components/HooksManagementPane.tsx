import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Webhook,
  ListTree,
  Activity,
  RefreshCw,
  Plus,
  Save,
  Trash2,
  ShieldAlert,
  ShieldX,
  Wand2,
  Bell,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Hook, HookAction, HookActionKind, HookEvent, HookTriggerRecord } from "@/types";

/**
 * 计算工具·hooks 管理（护栏 + 传感器）。
 *
 * pi 的 hook = 生命周期节点的确定性「护栏」与「传感器」：
 *   - block （Pre-action 护栏，仅 tool_call）：命中即拒绝工具执行。
 *   - mutate（仅 tool_call）：改写工具参数（字段覆盖）。
 *   - command（Post-action 传感器）：跑本地 shell（格式化/测试/记 trace）。
 *   - notify（Notification）：本地系统通知。
 *   - log：仅记一条触发。
 *
 * 数据安全（AGENTS.md §一 等同红线对待）：外发(HTTP)动作 UI 灰掉 + server 类型层不暴露；
 * 看板只展示 px-hook-runner 已脱敏字段，不读 message/tool 原文，不调任何 LLM。
 *
 * 注：pi 已加载扩展/包的浏览已拆到「插件管理」(PluginManagementPane)，本模块只管 hooks。
 */

const HOOK_EVENT_OPTIONS: { value: HookEvent; label: string }[] = [
  { value: "session_start", label: "session_start · 会话启动" },
  { value: "session_shutdown", label: "session_shutdown · 会话结束" },
  { value: "before_agent_start", label: "before_agent_start · agent 启动前" },
  { value: "agent_start", label: "agent_start · agent 启动" },
  { value: "agent_end", label: "agent_end · agent 结束" },
  { value: "turn_start", label: "turn_start · 一轮开始" },
  { value: "turn_end", label: "turn_end · 一轮结束" },
  { value: "tool_execution_start", label: "tool_execution_start · 工具执行前" },
  { value: "tool_execution_end", label: "tool_execution_end · 工具执行后" },
  { value: "tool_call", label: "tool_call · 工具调用（护栏点：可拦截 / 改参）" },
  { value: "message_end", label: "message_end · 消息结束" },
];

const ACTION_OPTIONS: { kind: HookActionKind; label: string; guardOnly?: boolean }[] = [
  { kind: "log", label: "记日志" },
  { kind: "command", label: "本地 shell 命令" },
  { kind: "notify", label: "通知（本地）" },
  { kind: "block", label: "拦截（护栏）", guardOnly: true },
  { kind: "mutate", label: "改写参数", guardOnly: true },
];

const ACTION_LABEL: Record<HookActionKind, string> = {
  log: "记日志",
  command: "命令",
  block: "拦截",
  mutate: "改写",
  notify: "通知",
};

type SubView = "hooks" | "triggers";

const SUBVIEWS: { id: SubView; label: string; icon: typeof ListTree }[] = [
  { id: "hooks", label: "Hook 管理", icon: ListTree },
  { id: "triggers", label: "运行看板", icon: Activity },
];

function newHookId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blankHook(): Hook {
  return {
    id: newHookId(),
    name: "新 hook",
    enabled: true,
    event: "tool_execution_start",
    match: {},
    action: { kind: "log" },
  };
}

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function HooksManagementPane() {
  const [view, setView] = useState<SubView>("hooks");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <Webhook className="h-4 w-4 text-neutral-500" />
        <h2 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">计算工具 · hooks 管理</h2>
        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          护栏 + 传感器
        </span>
        <div className="ml-auto flex items-center gap-1">
          {SUBVIEWS.map((s) => {
            const Icon = s.icon;
            const active = view === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setView(s.id)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-900">
        {view === "hooks" && <HooksView />}
        {view === "triggers" && <TriggersView />}
      </div>
    </div>
  );
}

// ── 视图 1：Hook 管理（左列表 + 右表单） ────────────────────────────────────

function HooksView() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listHooks()
      .then((list) => {
        setHooks(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
        setDirty(false);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const selected = useMemo(() => hooks.find((h) => h.id === selectedId) ?? null, [hooks, selectedId]);

  const updateSelected = (patch: Partial<Hook>) => {
    if (!selected) return;
    setHooks((list) => list.map((h) => (h.id === selected.id ? { ...h, ...patch } : h)));
    setDirty(true);
  };

  const updateSelectedMatch = (patch: Partial<NonNullable<Hook["match"]>>) => {
    if (!selected) return;
    const nextMatch = { ...(selected.match ?? {}), ...patch };
    if (!nextMatch.toolName) delete nextMatch.toolName;
    if (!nextMatch.pattern) delete nextMatch.pattern;
    setHooks((list) =>
      list.map((h) => (h.id === selected.id ? { ...h, match: Object.keys(nextMatch).length ? nextMatch : {} } : h)),
    );
    setDirty(true);
  };

  // 切换动作类型：构造一个只保留相关字段的全新 action（避免脏字段被 server 丢弃后状态不一致）。
  const setActionKind = (kind: HookActionKind) => {
    if (!selected) return;
    let next: HookAction;
    if (kind === "command") next = { kind, command: selected.action.command ?? "" };
    else if (kind === "block" || kind === "notify") next = { kind, reason: selected.action.reason ?? "" };
    else if (kind === "mutate") next = { kind, set: selected.action.set ?? {} };
    else next = { kind: "log" };
    updateSelected({ action: next });
  };

  const patchAction = (patch: Partial<HookAction>) => {
    if (!selected) return;
    updateSelected({ action: { ...selected.action, ...patch } });
  };

  const addHook = () => {
    const h = blankHook();
    setHooks((list) => [...list, h]);
    setSelectedId(h.id);
    setDirty(true);
  };

  const removeSelected = () => {
    if (!selected) return;
    setHooks((list) => list.filter((h) => h.id !== selected.id));
    setSelectedId(null);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await api.saveHooks(hooks);
      setHooks(saved);
      setDirty(false);
      if (selectedId && !saved.find((h) => h.id === selectedId)) {
        setSelectedId(saved[0]?.id ?? null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const isToolCall = selected?.event === "tool_call";
  const isToolEvent = selected?.event.startsWith("tool_") ?? false;
  // 护栏 block/mutate 仅 tool_call 有效；若被选中却非 tool_call，保存会被 server 丢弃。
  const guardMismatch = selected != null && (selected.action.kind === "block" || selected.action.kind === "mutate") && !isToolCall;

  return (
    <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] gap-3 p-4">
      <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">Hooks</h3>
          <span className="text-[11px] text-neutral-400">{hooks.length} 条</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={addHook}
              className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
            <button
              onClick={reload}
              disabled={loading}
              className="rounded border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title="刷新"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {hooks.length === 0 && (
            <div className="px-3 py-8 text-center text-[12px] text-neutral-400">尚无 hook，点「新建」开始</div>
          )}
          {hooks.map((h) => {
            const active = h.id === selectedId;
            const isGuard = h.action.kind === "block" || h.action.kind === "mutate";
            return (
              <button
                key={h.id}
                onClick={() => setSelectedId(h.id)}
                className={`flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-[12px] transition dark:border-neutral-800 ${
                  active ? "bg-neutral-50 dark:bg-neutral-900" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${h.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-neutral-700 dark:text-neutral-200">{h.name}</div>
                  <div className="truncate text-[11px] text-neutral-400">
                    {h.event} · {ACTION_LABEL[h.action.kind]}
                  </div>
                </div>
                {isGuard && (
                  <span className="shrink-0 rounded bg-rose-100 px-1 py-0.5 text-[9.5px] text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                    护栏
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1 rounded bg-neutral-900 px-3 py-1 text-[11.5px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "保存中…" : dirty ? "保存到 hooks.json" : "已保存"}
          </button>
          {dirty && <span className="text-[11px] text-amber-600">有未保存改动</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
            选择一条 hook 进行编辑，或点「新建」
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-auto p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">编辑 hook</h3>
              <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {selected.id}
              </code>
              <button
                onClick={removeSelected}
                className="ml-auto flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11.5px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="名称">
                <input
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />
              </Field>
              <Field label="启用">
                <label className="flex items-center gap-2 text-[12px] text-neutral-600 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) => updateSelected({ enabled: e.target.checked })}
                  />
                  enabled
                </label>
              </Field>
              <Field label="事件" className="col-span-2">
                <select
                  value={selected.event}
                  onChange={(e) => updateSelected({ event: e.target.value as HookEvent })}
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {HOOK_EVENT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="匹配 · toolName（仅 tool_* 事件）">
                <input
                  value={selected.match?.toolName ?? ""}
                  onChange={(e) => updateSelectedMatch({ toolName: e.target.value })}
                  disabled={!isToolEvent}
                  placeholder={isToolEvent ? "如 bash / read / write，留空则不限" : "本事件不支持 toolName 匹配"}
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] disabled:bg-neutral-50 disabled:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:disabled:bg-neutral-900/50"
                />
              </Field>
              <Field label="匹配 · pattern（正则，作用于 argsPreview）">
                <input
                  value={selected.match?.pattern ?? ""}
                  onChange={(e) => updateSelectedMatch({ pattern: e.target.value })}
                  placeholder="如 rm\\s+-rf"
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />
              </Field>
            </div>

            <div className="mt-3 rounded border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">动作</div>
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                {ACTION_OPTIONS.map((opt) => {
                  const disabled = opt.guardOnly && !isToolCall;
                  return (
                    <label
                      key={opt.kind}
                      className={`flex items-center gap-1.5 ${disabled ? "cursor-not-allowed text-neutral-300 dark:text-neutral-600" : "text-neutral-700 dark:text-neutral-200"}`}
                      title={disabled ? "护栏动作仅 tool_call 事件可用" : undefined}
                    >
                      <input
                        type="radio"
                        name={`action-kind-${selected.id}`}
                        checked={selected.action.kind === opt.kind}
                        disabled={disabled}
                        onChange={() => setActionKind(opt.kind)}
                      />
                      {opt.guardOnly && (opt.kind === "block" ? <ShieldX className="h-3 w-3" /> : <Wand2 className="h-3 w-3" />)}
                      {opt.kind === "notify" && <Bell className="h-3 w-3" />}
                      {opt.label}
                    </label>
                  );
                })}
                <span
                  className="ml-2 inline-flex cursor-not-allowed items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-600 line-through opacity-70 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
                  title="数据安全：外发(HTTP)动作类型层不暴露，UI 永久禁用"
                >
                  <ShieldAlert className="h-3 w-3" />
                  外发 HTTP（已禁用）
                </span>
              </div>

              {guardMismatch && (
                <div className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  ⚠️ 护栏动作（拦截 / 改写）仅在 <code>tool_call</code> 事件生效，当前事件为 <code>{selected.event}</code>，保存时会被丢弃。请把事件改为 tool_call，或换用记日志 / 命令 / 通知。
                </div>
              )}

              {selected.action.kind === "command" && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    Shell 命令（可读取环境变量 $HOOK_EVENT / $HOOK_TOOL_NAME / $HOOK_SESSION_ID / $HOOK_ARGS_PREVIEW）
                  </label>
                  <textarea
                    value={selected.action.command ?? ""}
                    onChange={(e) => patchAction({ command: e.target.value })}
                    rows={3}
                    placeholder='echo "$HOOK_EVENT $HOOK_TOOL_NAME" >> /tmp/pi-hook.log'
                    className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                  />
                </div>
              )}

              {(selected.action.kind === "block" || selected.action.kind === "notify") && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    {selected.action.kind === "block" ? "拒绝原因（返回给 agent，留空用默认）" : "通知文案（本地系统通知）"}
                  </label>
                  <input
                    value={selected.action.reason ?? ""}
                    onChange={(e) => patchAction({ reason: e.target.value })}
                    placeholder={selected.action.kind === "block" ? "如：禁止删除生产数据" : "如：危险命令已拦截"}
                    className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                  />
                </div>
              )}

              {selected.action.kind === "mutate" && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    参数覆盖（浅合并进 tool input；如把 bash 的 timeout 强制为 30000）
                  </label>
                  <SetEditor
                    value={selected.action.set ?? {}}
                    onChange={(set) => patchAction({ set })}
                  />
                </div>
              )}
            </div>

            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
              hook 涉对话观测，按 AGENTS.md 数据红线对待：UI 仅展示已脱敏的触发流水（事件/参数预览/结果），
              不读 message/tool 原文；外发动作永久禁用。护栏（拦截/改写）为确定性规则、本地生效，无数据外流。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// mutate 的 set 键值编辑器。
function SetEditor({ value, onChange }: { value: Record<string, string>; onChange: (set: Record<string, string>) => void }) {
  const rows = Object.entries(value);
  const update = (idx: number, key: string, val: string) => {
    const next: Record<string, string> = {};
    rows.forEach(([k, v], i) => {
      if (i === idx) {
        if (key) next[key] = val;
      } else {
        next[k] = v;
      }
    });
    onChange(next);
  };
  const add = () => onChange({ ...value, "": "" });
  const remove = (idx: number) => {
    const next: Record<string, string> = {};
    rows.forEach(([k, v], i) => {
      if (i !== idx) next[k] = v;
    });
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && <p className="text-[11px] text-neutral-400">无覆盖字段，点「添加」</p>}
      {rows.map(([k, v], idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <input
            value={k}
            onChange={(e) => update(idx, e.target.value, v)}
            placeholder="字段名"
            className="w-1/3 rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <span className="text-neutral-400">=</span>
          <input
            value={v}
            onChange={(e) => update(idx, k, e.target.value)}
            placeholder="值（字符串）"
            className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <button
            onClick={() => remove(idx)}
            className="rounded border border-neutral-200 p-1 text-neutral-400 hover:bg-neutral-50 hover:text-red-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="self-start rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 添加字段
      </button>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11.5px] text-neutral-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

// ── 视图 2：运行看板（实时流水 + 计数） ────────────────────────────────────

const TRIGGER_REFRESH_MS = 5000;

function TriggersView() {
  const [records, setRecords] = useState<HookTriggerRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [limit, setLimit] = useState(200);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listHookTriggers({ limit })
      .then((list) => setRecords(list))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    reload();
    if (!auto) return;
    const id = window.setInterval(reload, TRIGGER_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reload, auto]);

  const counts = useMemo(() => {
    const map = new Map<string, { hookId: string; event: string; total: number; ok: number; failed: number; blocked: number }>();
    for (const r of records) {
      const key = `${r.hookId}__${r.event}`;
      const cur = map.get(key) ?? { hookId: r.hookId, event: r.event, total: 0, ok: 0, failed: 0, blocked: 0 };
      cur.total += 1;
      if (r.blocked) cur.blocked += 1;
      if (r.ok) cur.ok += 1;
      else cur.failed += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [records]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">运行看板</h3>
        <span className="text-[11px] text-neutral-400">读 hooks-triggers.jsonl · 仅展示已脱敏字段</span>
        <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          自动刷新（5s）
        </label>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value={100}>最近 100</option>
          <option value={200}>最近 200</option>
          <option value={500}>最近 500</option>
          <option value={2000}>最近 2000</option>
        </select>
        <button
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-white disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div className="border-b border-neutral-200 px-3 py-2 text-[11.5px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            实时流水（{records.length} 条）
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">时间</th>
                  <th className="px-2 py-1.5 text-left font-normal">hookId</th>
                  <th className="px-2 py-1.5 text-left font-normal">事件</th>
                  <th className="px-2 py-1.5 text-left font-normal">动作</th>
                  <th className="px-2 py-1.5 text-left font-normal">结果</th>
                  <th className="px-2 py-1.5 text-right font-normal">耗时</th>
                  <th className="px-2 py-1.5 text-left font-normal">原因 / argsPreview</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-2 py-8 text-center text-neutral-400">
                      暂无触发记录。跑一次 agent 对话后回到此处刷新。
                    </td>
                  </tr>
                )}
                {records.map((r, i) => (
                  <tr
                    key={`${r.ts}-${i}`}
                    className={`border-t border-neutral-100 dark:border-neutral-800 ${
                      r.blocked ? "bg-rose-50 dark:bg-rose-950/20" : !r.ok ? "bg-amber-50 dark:bg-amber-950/20" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-neutral-500">{fmtTime(r.ts)}</td>
                    <td className="px-2 py-1.5 font-mono text-neutral-700 dark:text-neutral-200">{r.hookId}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-300">{r.event}</td>
                    <td className="px-2 py-1.5">
                      {ACTION_LABEL[r.actionKind] ?? r.actionKind}
                      {r.blocked && (
                        <span className="ml-1 rounded bg-rose-100 px-1 py-0.5 text-[9.5px] text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                          已拦截
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.ok ? (
                        <span className="text-emerald-600 dark:text-emerald-400">ok</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">
                          fail{typeof r.exitCode === "number" ? `(${r.exitCode})` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-neutral-500">{r.durationMs}ms</td>
                    <td className="max-w-[280px] truncate px-2 py-1.5 font-mono text-[11px] text-neutral-400" title={r.reason ?? r.argsPreview ?? ""}>
                      {r.reason ? `「${r.reason}」 ` : ""}
                      {r.argsPreview ?? (r.reason ? "" : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div className="border-b border-neutral-200 px-3 py-2 text-[11.5px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            按 hook · 事件计数（趋势聚合 P1 接 trace-kernel）
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">hook</th>
                  <th className="px-2 py-1.5 text-left font-normal">事件</th>
                  <th className="px-2 py-1.5 text-right font-normal">总</th>
                  <th className="px-2 py-1.5 text-right font-normal">成功</th>
                  <th className="px-2 py-1.5 text-right font-normal">失败</th>
                  <th className="px-2 py-1.5 text-right font-normal">拦截</th>
                </tr>
              </thead>
              <tbody>
                {counts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-8 text-center text-neutral-400">
                      —
                    </td>
                  </tr>
                )}
                {counts.map((c) => (
                  <tr key={`${c.hookId}-${c.event}`} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-2 py-1.5 font-mono text-neutral-700 dark:text-neutral-200">{c.hookId}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-300">{c.event}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{c.total}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{c.ok}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-red-600 dark:text-red-400">{c.failed}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rose-600 dark:text-rose-400">{c.blocked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
