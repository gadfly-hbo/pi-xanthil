import { useCallback, useEffect, useMemo, useState } from "react";
import { SquareTerminal, RefreshCw, Plus, Save, Trash2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import type { ExtractionTool, RiskLevel, XanCommand, XanCommandParam, XanCommandParamType, SkillRegistryEntry } from "@/types";

/**
 * 计算工具·command 管理（pi-xanthil 自有的「斜杠命令注册表」）。
 *
 * 真源 = commands.json（server COMMANDS_CONFIG_PATH）；展开器 server/src/command-expand.ts。
 * 占位语法：{{args}} | {{1}} {{2}} … | {{param.key}}（key 来自 params[].key）。
 *
 * server coerceCommand 同步约束（违反则保存时被丢弃）：
 *   - name / param.key / skillSlug：^[A-Za-z0-9][A-Za-z0-9_-]*$
 *   - param.label 必填；type==="select" 必须有 options；param.source(file) 仅 "clean_data"
 *   - source 仅 "custom"；id / name 唯一
 *
 * 仿 HooksManagementPane 的左列表 + 右表单 + 整体覆盖式 PUT。
 */

const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const RISK_BADGE: Record<RiskLevel, string> = {
  L0: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  L1: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  L2: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  L3: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function isAiExposedTool(tool: ExtractionTool): boolean {
  return tool.category === "analysis";
}

const PARAM_TYPE_OPTIONS: { value: XanCommandParamType; label: string }[] = [
  { value: "select", label: "select · 下拉" },
  { value: "file", label: "file · 文件" },
];

function newCommandId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blankCommand(): XanCommand {
  return {
    id: newCommandId(),
    name: "new-cmd",
    enabled: true,
    template: "请描述任务：{{args}}",
    source: "custom",
  };
}

interface ValidationIssue {
  level: "error" | "warn";
  msg: string;
}

function validateCommand(cmd: XanCommand | null, all: XanCommand[]): ValidationIssue[] {
  if (!cmd) return [];
  const out: ValidationIssue[] = [];
  if (!cmd.name) out.push({ level: "error", msg: "name 必填" });
  else if (!SAFE_NAME_RE.test(cmd.name))
    out.push({ level: "error", msg: "name 仅允许 [A-Za-z0-9_-]，首字符为字母或数字" });
  if (!cmd.template.trim()) out.push({ level: "error", msg: "template 必填" });
  const dup = all.find((c) => c.id !== cmd.id && c.name === cmd.name);
  if (dup) out.push({ level: "error", msg: `name 与另一条命令重复（id=${dup.id}）` });
  if (cmd.params && cmd.params.length) {
    const seen = new Set<string>();
    cmd.params.forEach((p, i) => {
      if (!p.key) out.push({ level: "error", msg: `params[${i}].key 必填` });
      else if (!SAFE_NAME_RE.test(p.key))
        out.push({ level: "error", msg: `params[${i}].key 命名非法（${p.key}）` });
      else if (seen.has(p.key)) out.push({ level: "error", msg: `params[${i}].key 重复（${p.key}）` });
      else seen.add(p.key);
      if (!p.label) out.push({ level: "error", msg: `params[${i}].label 必填` });
      if (p.type === "select" && (!p.options || p.options.length === 0))
        out.push({ level: "error", msg: `params[${i}] type=select 必须给 options` });
    });
  }
  if (cmd.skillSlugs) {
    cmd.skillSlugs.forEach((s, i) => {
      if (!SAFE_NAME_RE.test(s)) out.push({ level: "error", msg: `skillSlugs[${i}] 命名非法（${s}）` });
    });
  }
  if (cmd.toolParamMap) {
    for (const [key, target] of Object.entries(cmd.toolParamMap)) {
      if (!SAFE_NAME_RE.test(key)) out.push({ level: "error", msg: `toolParamMap key 非法（${key}）` });
      if (!SAFE_NAME_RE.test(target)) out.push({ level: "error", msg: `toolParamMap target 非法（${target}）` });
    }
  }
  return out;
}

interface Props {
  workspaceId?: string | null;
}

export function CommandManagementPane({ workspaceId }: Props) {
  const [commands, setCommands] = useState<XanCommand[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [skills, setSkills] = useState<SkillRegistryEntry[]>([]);
  const [tools, setTools] = useState<ExtractionTool[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listCommands()
      .then((list) => {
        setCommands(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
        setDirty(false);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  useEffect(() => {
    let cancelled = false;
    api
      .listExtractionTools()
      .then((list) => {
        if (!cancelled) setTools(list.filter(isAiExposedTool));
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    return () => { cancelled = true; };
  }, []);

  // skill 多选数据源：workspace 级 active skill；无 workspace 时退化为纯文本输入。
  useEffect(() => {
    if (!workspaceId) {
      setSkills([]);
      return;
    }
    let cancelled = false;
    api
      .listSkillRegistry(workspaceId, "active")
      .then((list) => { if (!cancelled) setSkills(list); })
      .catch(() => { if (!cancelled) setSkills([]); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const selected = useMemo(
    () => commands.find((c) => c.id === selectedId) ?? null,
    [commands, selectedId],
  );

  const updateSelected = (patch: Partial<XanCommand>) => {
    if (!selected) return;
    setCommands((list) => list.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)));
    setDirty(true);
  };

  const updateParams = (params: XanCommandParam[]) => {
    updateSelected({ params: params.length ? params : undefined });
  };

  const updateSkillSlugs = (slugs: string[]) => {
    const dedup = Array.from(new Set(slugs.map((s) => s.trim()).filter(Boolean)));
    updateSelected({ skillSlugs: dedup.length ? dedup : undefined });
  };

  const updateToolIds = (ids: string[]) => {
    const dedup = Array.from(new Set(ids.map((s) => s.trim()).filter(Boolean)));
    updateSelected({ toolIds: dedup.length ? dedup : undefined });
  };

  const updateToolParamMap = (map: Record<string, string>) => {
    const cleaned = Object.fromEntries(
      Object.entries(map)
        .map(([key, value]) => [key.trim(), value.trim()])
        .filter(([key, value]) => key && value),
    );
    updateSelected({ toolParamMap: Object.keys(cleaned).length ? cleaned : undefined });
  };

  const addCommand = () => {
    const c = blankCommand();
    setCommands((list) => [...list, c]);
    setSelectedId(c.id);
    setDirty(true);
  };

  const removeSelected = () => {
    if (!selected) return;
    setCommands((list) => list.filter((c) => c.id !== selected.id));
    setSelectedId(null);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await api.saveCommands(commands);
      setCommands(saved);
      setDirty(false);
      if (selectedId && !saved.find((c) => c.id === selectedId)) {
        setSelectedId(saved[0]?.id ?? null);
      }
      if (saved.length !== commands.length) {
        setError(`server 丢弃了 ${commands.length - saved.length} 条非法命令（请检查 name/param.key/skillSlug 命名规则）`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const issues = useMemo(() => validateCommand(selected, commands), [selected, commands]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <SquareTerminal className="h-4 w-4 text-neutral-500" />
        <h2 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">计算工具 · command 管理</h2>
        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          斜杠命令注册表
        </span>
      </div>

      <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-900">
        <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] gap-3 p-4">
          <CommandList
            commands={commands}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={addCommand}
            onReload={reload}
            onSave={save}
            loading={loading}
            saving={saving}
            dirty={dirty}
          />
          <CommandEditor
            selected={selected}
            issues={issues}
            error={error}
            skills={skills}
            tools={tools}
            workspaceId={workspaceId ?? null}
            onUpdate={updateSelected}
            onUpdateParams={updateParams}
            onUpdateSkillSlugs={updateSkillSlugs}
            onUpdateToolIds={updateToolIds}
            onUpdateToolParamMap={updateToolParamMap}
            onRemove={removeSelected}
          />
        </div>
      </div>
    </div>
  );
}

interface CommandListProps {
  commands: XanCommand[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onReload: () => void;
  onSave: () => void;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
}

function CommandList({
  commands,
  selectedId,
  onSelect,
  onAdd,
  onReload,
  onSave,
  loading,
  saving,
  dirty,
}: CommandListProps) {
  return (
    <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">Commands</h3>
        <span className="text-[11px] text-neutral-400">{commands.length} 条</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onAdd}
            className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </button>
          <button
            onClick={onReload}
            disabled={loading}
            className="rounded border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="刷新"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {commands.length === 0 && (
          <div className="px-3 py-8 text-center text-[12px] text-neutral-400">尚无命令，点「新建」开始</div>
        )}
        {commands.map((c) => {
          const active = c.id === selectedId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-[12px] transition dark:border-neutral-800 ${
                active ? "bg-neutral-50 dark:bg-neutral-900" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono font-medium text-neutral-700 dark:text-neutral-200">/{c.name}</div>
                <div className="truncate text-[11px] text-neutral-400">
                  {c.description || c.argumentHint || "—"}
                </div>
              </div>
              {c.params && c.params.length > 0 && (
                <span className="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[9.5px] text-sky-600 dark:bg-sky-900/40 dark:text-sky-300">
                  {c.params.length}p
                </span>
              )}
              {c.skillSlugs && c.skillSlugs.length > 0 && (
                <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9.5px] text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                  {c.skillSlugs.length}s
                </span>
              )}
              {c.toolIds && c.toolIds.length > 0 && (
                <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[9.5px] text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                  {c.toolIds.length}t
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="flex items-center gap-1 rounded bg-neutral-900 px-3 py-1 text-[11.5px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中…" : dirty ? "保存到 commands.json" : "已保存"}
        </button>
        {dirty && <span className="text-[11px] text-amber-600">有未保存改动</span>}
      </div>
    </div>
  );
}

interface CommandEditorProps {
  selected: XanCommand | null;
  issues: ValidationIssue[];
  error: string;
  skills: SkillRegistryEntry[];
  tools: ExtractionTool[];
  workspaceId: string | null;
  onUpdate: (patch: Partial<XanCommand>) => void;
  onUpdateParams: (params: XanCommandParam[]) => void;
  onUpdateSkillSlugs: (slugs: string[]) => void;
  onUpdateToolIds: (ids: string[]) => void;
  onUpdateToolParamMap: (map: Record<string, string>) => void;
  onRemove: () => void;
}

function CommandEditor({
  selected,
  issues,
  error,
  skills,
  tools,
  workspaceId,
  onUpdate,
  onUpdateParams,
  onUpdateSkillSlugs,
  onUpdateToolIds,
  onUpdateToolParamMap,
  onRemove,
}: CommandEditorProps) {
  return (
    <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
          选择一条命令进行编辑，或点「新建」
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">编辑命令</h3>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {selected.id}
            </code>
            <button
              onClick={onRemove}
              className="ml-auto flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11.5px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="命令名 /name">
              <input
                value={selected.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                placeholder="如 analyze-orders（^[A-Za-z0-9][A-Za-z0-9_-]*$）"
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </Field>
            <Field label="启用">
              <label className="flex items-center gap-2 text-[12px] text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => onUpdate({ enabled: e.target.checked })}
                />
                enabled
              </label>
            </Field>
            <Field label="描述（可选）" className="col-span-2">
              <input
                value={selected.description ?? ""}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="如：分析订单数据并生成 RFM 报告"
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </Field>
            <Field label="参数提示 argumentHint（可选）" className="col-span-2">
              <input
                value={selected.argumentHint ?? ""}
                onChange={(e) => onUpdate({ argumentHint: e.target.value })}
                placeholder='如 "<数据集> [口径]"'
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </Field>
            <Field label="模板 template（占位 {{args}} {{1}} {{param.key}}）" className="col-span-2">
              <textarea
                value={selected.template}
                onChange={(e) => onUpdate({ template: e.target.value })}
                rows={6}
                placeholder="请描述任务：{{args}}"
                className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </Field>
          </div>

          <div className="mt-3 rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
              具名参数 params
              <span className="font-normal text-neutral-400">驱动向导表单 + {`{{param.key}}`} 展开</span>
            </div>
            <ParamsEditor params={selected.params ?? []} onChange={onUpdateParams} />
          </div>

          <div className="mt-3 rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
              skillSlugs
              <span className="font-normal text-neutral-400">触发该命令时一并启用的 skill</span>
            </div>
            <SkillSlugsEditor
              value={selected.skillSlugs ?? []}
              skills={skills}
              workspaceId={workspaceId}
              onChange={onUpdateSkillSlugs}
            />
          </div>

          <div className="mt-3 rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
              场景工具 toolIds
              <span className="font-normal text-neutral-400">仅预填 @工具卡，仍需人工确认运行</span>
            </div>
            <ToolIdsEditor value={selected.toolIds ?? []} tools={tools} onChange={onUpdateToolIds} />
            <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <ToolParamMapEditor
                params={selected.params ?? []}
                value={selected.toolParamMap ?? {}}
                tools={tools}
                toolIds={selected.toolIds ?? []}
                onChange={onUpdateToolParamMap}
              />
            </div>
          </div>

          {issues.length > 0 && (
            <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <div className="mb-1 flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                校验问题（保存时 server 会丢弃非法项）
              </div>
              <ul className="ml-5 list-disc space-y-0.5">
                {issues.map((it, i) => (
                  <li key={i}>{it.msg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
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

// ── ParamsEditor：行编辑 key/label/required/type/options/source ──────────────

function ParamsEditor({
  params,
  onChange,
}: {
  params: XanCommandParam[];
  onChange: (params: XanCommandParam[]) => void;
}) {
  const update = (idx: number, patch: Partial<XanCommandParam>) => {
    onChange(params.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const remove = (idx: number) => onChange(params.filter((_, i) => i !== idx));
  const add = () =>
    onChange([
      ...params,
      { key: `arg${params.length + 1}`, label: `字段 ${params.length + 1}` },
    ]);

  const updateType = (idx: number, type: XanCommandParamType | "") => {
    const cur = params[idx];
    if (!cur) return;
    const next: XanCommandParam = { key: cur.key, label: cur.label };
    if (cur.required) next.required = true;
    if (type) {
      next.type = type;
      if (type === "select") next.options = cur.options ?? [];
      if (type === "file") next.source = cur.source ?? "clean_data";
    }
    onChange(params.map((p, i) => (i === idx ? next : p)));
  };

  return (
    <div className="flex flex-col gap-2">
      {params.length === 0 && (
        <p className="text-[11px] text-neutral-400">无具名参数。无参数时仅能用 {`{{args}}`} / {`{{1}}`} 等占位。</p>
      )}
      {params.map((p, idx) => (
        <div
          key={idx}
          className="rounded border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-start gap-2">
            <div className="grid flex-1 grid-cols-[1fr_1fr_auto_auto] gap-2">
              <input
                value={p.key}
                onChange={(e) => update(idx, { key: e.target.value })}
                placeholder="key"
                className="rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <input
                value={p.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                placeholder="label"
                className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <select
                value={p.type ?? ""}
                onChange={(e) => updateType(idx, (e.target.value || "") as XanCommandParamType | "")}
                className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <option value="">type · text(默认)</option>
                {PARAM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={p.required === true}
                  onChange={(e) => update(idx, { required: e.target.checked || undefined })}
                />
                required
              </label>
            </div>
            <button
              onClick={() => remove(idx)}
              className="rounded border border-neutral-200 p-1 text-neutral-400 hover:bg-white hover:text-red-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {p.type === "select" && (
            <div className="mt-2">
              <label className="mb-1 block text-[10.5px] text-neutral-500 dark:text-neutral-400">
                options（逗号分隔，必须至少 1 项）
              </label>
              <input
                value={(p.options ?? []).join(", ")}
                onChange={(e) =>
                  update(idx, {
                    options: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="如 daily, weekly, monthly"
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </div>
          )}

          {p.type === "file" && (
            <div className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              source ={" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono dark:bg-neutral-800">clean_data</code>
              （向导前端按此目录拉取候选文件名；当前 server 仅允许此值）
            </div>
          )}
        </div>
      ))}
      <button
        onClick={add}
        className="self-start rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 添加参数
      </button>
    </div>
  );
}

// ── SkillSlugsEditor：workspace 级 active skill 多选 + 文本回退 ──────────────

function SkillSlugsEditor({
  value,
  skills,
  workspaceId,
  onChange,
}: {
  value: string[];
  skills: SkillRegistryEntry[];
  workspaceId: string | null;
  onChange: (slugs: string[]) => void;
}) {
  const [text, setText] = useState("");

  // 当前已选 slug → 用于多选下拉中标记勾选
  const selectedSet = useMemo(() => new Set(value), [value]);

  const toggle = (slug: string) => {
    if (selectedSet.has(slug)) onChange(value.filter((s) => s !== slug));
    else onChange([...value, slug]);
  };

  const remove = (slug: string) => onChange(value.filter((s) => s !== slug));

  const addFromText = () => {
    const slug = text.trim();
    if (!slug) return;
    if (!value.includes(slug)) onChange([...value, slug]);
    setText("");
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 已选 chip */}
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-[11px] text-neutral-400">未关联 skill</span>}
        {value.map((slug) => (
          <span
            key={slug}
            className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[11px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          >
            {slug}
            <button
              onClick={() => remove(slug)}
              className="text-violet-500 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-200"
              title="移除"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* 数据源：workspace 有 skill 时给下拉清单；否则纯文本输入 */}
      {workspaceId && skills.length > 0 ? (
        <details className="rounded border border-neutral-200 bg-white text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900">
          <summary className="cursor-pointer select-none px-2 py-1 text-neutral-600 dark:text-neutral-300">
            从已注册的 active skill 中选择（{skills.length}）
          </summary>
          <div className="max-h-48 overflow-auto border-t border-neutral-100 dark:border-neutral-800">
            {skills.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(s.slug)}
                  onChange={() => toggle(s.slug)}
                />
                <code className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200">{s.slug}</code>
                <span className="truncate text-[11px] text-neutral-400">{s.name}</span>
              </label>
            ))}
          </div>
        </details>
      ) : (
        <p className="text-[11px] text-neutral-400">
          {workspaceId
            ? "当前 workspace 暂无 active skill，使用下方文本输入手填 slug。"
            : "未选 workspace，使用下方文本输入手填 slug。"}
        </p>
      )}

      {/* 始终保留文本输入（兼容外部 skill / 未注册 slug） */}
      <div className="flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addFromText();
            }
          }}
          placeholder="手填 slug（^[A-Za-z0-9_-]+$），回车添加"
          className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        />
        <button
          onClick={addFromText}
          className="rounded border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          添加
        </button>
      </div>
    </div>
  );
}

function ToolIdsEditor({
  value,
  tools,
  onChange,
}: {
  value: string[];
  tools: ExtractionTool[];
  onChange: (ids: string[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(value), [value]);
  const byId = useMemo(() => new Map(tools.map((tool) => [tool.id, tool])), [tools]);
  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter((item) => item !== id));
    else onChange([...value, id]);
  };
  const remove = (id: string) => onChange(value.filter((item) => item !== id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-[11px] text-neutral-400">未关联 tool</span>}
        {value.map((id) => (
          <span
            key={id}
            className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            title={byId.get(id)?.name ?? id}
          >
            {id}
            <button
              onClick={() => remove(id)}
              className="text-emerald-500 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-200"
              title="移除"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {tools.length > 0 ? (
        <details className="rounded border border-neutral-200 bg-white text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900">
          <summary className="cursor-pointer select-none px-2 py-1 text-neutral-600 dark:text-neutral-300">
            从 analysis tools 中选择（{tools.length}）
          </summary>
          <div className="max-h-56 overflow-auto border-t border-neutral-100 dark:border-neutral-800">
            {tools.map((tool) => (
              <label
                key={tool.id}
                className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(tool.id)}
                  onChange={() => toggle(tool.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <code className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200">{tool.id}</code>
                    <span className="truncate text-[11px] text-neutral-400">{tool.name}</span>
                    {tool.riskLevel && <span className={`rounded px-1 py-0.5 text-[9.5px] ${RISK_BADGE[tool.riskLevel]}`}>{tool.riskLevel}</span>}
                  </div>
                  {tool.tags && tool.tags.length > 0 && <div className="truncate text-[10px] text-neutral-400">tags: {tool.tags.join(", ")}</div>}
                </div>
              </label>
            ))}
          </div>
        </details>
      ) : (
        <p className="text-[11px] text-neutral-400">当前没有可绑定的 analysis tool。</p>
      )}
    </div>
  );
}

function ToolParamMapEditor({
  params,
  value,
  tools,
  toolIds,
  onChange,
}: {
  params: XanCommandParam[];
  value: Record<string, string>;
  tools: ExtractionTool[];
  toolIds: string[];
  onChange: (map: Record<string, string>) => void;
}) {
  const boundTools = useMemo(() => tools.filter((tool) => toolIds.includes(tool.id)), [tools, toolIds]);
  const targetOptions = useMemo(() => {
    const names = new Set<string>(["inputPath"]);
    for (const tool of boundTools) {
      for (const param of tool.parameters ?? []) names.add(param.name);
    }
    return Array.from(names);
  }, [boundTools]);

  const setTarget = (key: string, target: string) => {
    const next = { ...value };
    if (target) next[key] = target;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
        参数映射
        <span className="ml-2 font-normal text-neutral-400">command param.key → tool 参数名 / inputPath</span>
      </div>
      {params.length === 0 && <p className="text-[11px] text-neutral-400">当前命令没有具名参数，无需映射。</p>}
      {params.length > 0 && toolIds.length === 0 && <p className="text-[11px] text-neutral-400">先绑定 tool 后再配置映射。</p>}
      {params.length > 0 && toolIds.length > 0 && (
        <div className="grid gap-2">
          {params.map((param) => (
            <label key={param.key} className="grid grid-cols-[minmax(120px,180px)_1fr] items-center gap-2 text-[11.5px]">
              <code className="truncate rounded bg-neutral-100 px-1.5 py-1 font-mono text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {param.key}
              </code>
              <select
                value={value[param.key] ?? ""}
                onChange={(event) => setTarget(param.key, event.target.value)}
                className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <option value="">不映射</option>
                {targetOptions.map((target) => (
                  <option key={target} value={target}>{target}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
