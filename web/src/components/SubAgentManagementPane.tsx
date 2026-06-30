import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Plus, Save, Trash2, AlertTriangle, Lock, RefreshCw, Database, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { SubAgentBoard } from "@/components/SubAgentBoard";
import { SubAgentsReadmePane } from "@/components/SubAgentsReadmePane";
import type {
  ExtractionTool,
  ExtractionToolCategory,
  RiskLevel,
  SubAgentTemplate,
} from "@/types";

/**
 * 计算工具·subagents 管理（子 agent 模板的图形化 CRUD）。
 *
 * 真源 = subagents.json（server SUBAGENTS_CONFIG_PATH）。
 * server coerceSubAgentTemplate 同步约束（违反则保存时被丢弃）：
 *   - id / name / persona 必填；persona 含非 localhost 外链时整条拒收
 *   - dataScope 恒为 "clean_data"（编译期 + 运行期双锁，禁止 draw_data；AGENTS.md §一红线）
 *   - source 恒为 "custom"
 *   - maxRetries clamp 到 0~5（耗尽 → waiting_for_help）
 *   - toolIds 去重；引擎层只按 analysis ExtractionTool 白名单挂载
 *
 * 仿 HooksManagementPane / CommandManagementPane 的左列表 + 右表单 + 整体覆盖式 PUT。
 */

const EXTERNAL_URL_RE = /https?:\/\/[^\s"'<>）)]+/gi;
const LOCAL_HOST_SET = new Set(["localhost", "127.0.0.1", "::1"]);

function newSubAgentId(): string {
  return `sa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blankSubAgent(): SubAgentTemplate {
  return {
    id: newSubAgentId(),
    name: "新子 agent",
    enabled: true,
    persona: "你是数据分析子 agent，独立完成一项被委派的分析子任务，不依赖主对话历史。",
    toolIds: [],
    dataScope: "clean_data",
    maxRetries: 0,
    source: "custom",
  };
}

function personaSummary(persona: string): string {
  const trimmed = persona.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60)}…`;
}

function hasExternalUrl(text: string): boolean {
  // 与 server coerceSubAgentTemplate 的 hasExternalUrl 保持同步；仅前端校验用，最终裁决在 server。
  const urls = text.match(EXTERNAL_URL_RE) ?? [];
  return urls.some((raw) => {
    try {
      return !LOCAL_HOST_SET.has(new URL(raw).hostname);
    } catch {
      return true;
    }
  });
}

interface ValidationIssue {
  level: "error" | "warn";
  msg: string;
}

function validateTemplate(
  t: SubAgentTemplate | null,
  all: SubAgentTemplate[],
  tools: ExtractionTool[],
): ValidationIssue[] {
  if (!t) return [];
  const out: ValidationIssue[] = [];
  if (!t.id.trim()) out.push({ level: "error", msg: "id 必填（保存时会被 server 丢弃）" });
  if (!t.name.trim()) out.push({ level: "error", msg: "name 必填" });
  if (!t.persona.trim()) out.push({ level: "error", msg: "persona 必填" });
  if (hasExternalUrl(t.persona))
    out.push({ level: "error", msg: "persona 含非 localhost 外链，server 会整条拒收" });
  const dup = all.find(
    (x) => x.id !== t.id && x.name.trim() && x.name.trim() === t.name.trim(),
  );
  if (dup) out.push({ level: "warn", msg: `name 与另一条模板重名（id=${dup.id}）` });
  if (t.maxRetries < 0 || t.maxRetries > 5)
    out.push({ level: "error", msg: "maxRetries 必须在 0~5 之间，超界 server 会 clamp" });
  const knownIds = new Set(tools.map((tool) => tool.id));
  const unknown = t.toolIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0)
    out.push({
      level: "warn",
      msg: `toolIds 含 ${unknown.length} 个当前不存在的工具（${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}），引擎挂载时会被忽略`,
    });
  return out;
}

function isAiExposedTool(tool: ExtractionTool): boolean {
  return tool.category === "analysis";
}

const RISK_BADGE: Record<RiskLevel, string> = {
  L0: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  L1: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  L2: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  L3: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const CATEGORY_LABEL: Record<ExtractionToolCategory, string> = {
  ingestion: "采集",
  analysis: "分析",
};

const ORIGIN_LABEL: Record<string, string> = {
  manual: "手动",
  crowd_profile: "人群画像",
  system: "系统",
};

export function SubAgentManagementPane() {
  const [templates, setTemplates] = useState<SubAgentTemplate[]>([]);
  const [tools, setTools] = useState<ExtractionTool[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [view, setView] = useState<"board" | "templates" | "readme">("board");

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    setInfo("");
    api
      .listSubAgents()
      .then((list) => {
        setTemplates(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
        setDirty(false);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const reloadTools = useCallback(() => {
    setToolsLoading(true);
    api
      .listExtractionTools()
      .then((items) => setTools(items.filter(isAiExposedTool)))
      .catch((err) => setError(String(err)))
      .finally(() => setToolsLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);
  useEffect(() => reloadTools(), [reloadTools]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const updateSelected = (patch: Partial<SubAgentTemplate>) => {
    if (!selected) return;
    setTemplates((list) =>
      list.map((t) =>
        t.id === selected.id
          ? { ...t, ...patch, dataScope: "clean_data" as const, source: "custom" as const }
          : t,
      ),
    );
    setDirty(true);
  };

  const updateToolIds = (toolIds: string[]) => {
    const dedup = Array.from(new Set(toolIds.map((s) => s.trim()).filter(Boolean)));
    updateSelected({ toolIds: dedup });
  };

  const addTemplate = () => {
    const t = blankSubAgent();
    setTemplates((list) => [...list, t]);
    setSelectedId(t.id);
    setDirty(true);
  };

  const removeSelected = () => {
    if (!selected) return;
    setTemplates((list) => list.filter((t) => t.id !== selected.id));
    setSelectedId(null);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const saved = await api.saveSubAgents(templates);
      const dropped = templates.length - saved.length;
      setTemplates(saved);
      setDirty(false);
      if (selectedId && !saved.find((t) => t.id === selectedId)) {
        setSelectedId(saved[0]?.id ?? null);
      }
      if (dropped > 0) {
        setError(
          `server 丢弃了 ${dropped} 条非法模板（请检查 id/name/persona 必填、persona 不能含外链、maxRetries 需为 0~5 整数）`,
        );
      } else {
        setInfo("已保存到 subagents.json");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const issues = useMemo(
    () => validateTemplate(selected, templates, tools),
    [selected, templates, tools],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <Bot className="h-4 w-4 text-neutral-500" />
        <h2 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
          计算工具 · subagents 管理
        </h2>
        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {view === "board" ? "全局运行看板" : view === "readme" ? "体系说明" : "子 agent 模板（subagents.json）"}
        </span>
        <span className="ml-1 flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <Lock className="h-3 w-3" />
          dataScope 锁定 clean_data
        </span>
        <div className="ml-auto inline-flex rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setView("board")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "board" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            运行看板
          </button>
          <button
            type="button"
            onClick={() => setView("templates")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "templates" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            模板管理
          </button>
          <button
            type="button"
            onClick={() => setView("readme")}
            className={cn("rounded px-2.5 py-1 text-[12px]", view === "readme" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500")}
          >
            说明
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-900">
        {view === "board" ? (
          <SubAgentBoard templates={templates} />
        ) : view === "readme" ? (
          <SubAgentsReadmePane />
        ) : (
          <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] gap-3 p-4">
            <TemplateList
              templates={templates}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAdd={addTemplate}
              onReload={reload}
              onSave={save}
              loading={loading}
              saving={saving}
              dirty={dirty}
            />
            <TemplateEditor
              selected={selected}
              issues={issues}
              error={error}
              info={info}
              tools={tools}
              toolsLoading={toolsLoading}
              onReloadTools={reloadTools}
              onUpdate={updateSelected}
              onUpdateToolIds={updateToolIds}
              onRemove={removeSelected}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── TemplateList：左列表（启停指示 + persona 摘要 + tool 计数） ──────────────

interface TemplateListProps {
  templates: SubAgentTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onReload: () => void;
  onSave: () => void;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
}

function TemplateList({
  templates,
  selectedId,
  onSelect,
  onAdd,
  onReload,
  onSave,
  loading,
  saving,
  dirty,
}: TemplateListProps) {
  return (
    <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <h3 className="text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">SubAgents</h3>
        <span className="text-[11px] text-neutral-400">{templates.length} 条</span>
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
        {templates.length === 0 && (
          <div className="px-3 py-8 text-center text-[12px] text-neutral-400">
            尚无子 agent 模板，点「新建」开始
          </div>
        )}
        {templates.map((t) => {
          const active = t.id === selectedId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`flex w-full items-start gap-2 border-b border-neutral-100 px-3 py-2 text-left text-[12px] transition dark:border-neutral-800 ${
                active ? "bg-neutral-50 dark:bg-neutral-900" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${t.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-neutral-700 dark:text-neutral-200">{t.name}</span>
                  {t.origin === "crowd_profile" && (
                    <span className="shrink-0 flex items-center gap-0.5 rounded bg-emerald-100 px-1 py-0 text-[9px] text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <Database className="h-2.5 w-2.5" />
                      画像
                    </span>
                  )}
                  {t.origin === "system" && (
                    <span className="shrink-0 flex items-center gap-0.5 rounded bg-violet-100 px-1 py-0 text-[9px] text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                      <Sparkles className="h-2.5 w-2.5" />
                      系统
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-neutral-400">{personaSummary(t.persona) || "—"}</div>
              </div>
              {t.toolIds.length > 0 && (
                <span className="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[9.5px] text-sky-600 dark:bg-sky-900/40 dark:text-sky-300">
                  {t.toolIds.length}t
                </span>
              )}
              {t.maxRetries > 0 && (
                <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9.5px] text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                  r{t.maxRetries}
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
          {saving ? "保存中…" : dirty ? "保存到 subagents.json" : "已保存"}
        </button>
        {dirty && <span className="text-[11px] text-amber-600">有未保存改动</span>}
      </div>
    </div>
  );
}

// ── TemplateEditor：右表单 ──────────────────────────────────────────────

interface TemplateEditorProps {
  selected: SubAgentTemplate | null;
  issues: ValidationIssue[];
  error: string;
  info: string;
  tools: ExtractionTool[];
  toolsLoading: boolean;
  onReloadTools: () => void;
  onUpdate: (patch: Partial<SubAgentTemplate>) => void;
  onUpdateToolIds: (ids: string[]) => void;
  onRemove: () => void;
}

function TemplateEditor({
  selected,
  issues,
  error,
  info,
  tools,
  toolsLoading,
  onReloadTools,
  onUpdate,
  onUpdateToolIds,
  onRemove,
}: TemplateEditorProps) {
  return (
    <div className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {!error && info && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {info}
        </div>
      )}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-neutral-400">
          选择一个模板进行编辑，或点「新建」
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">编辑模板</h3>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {selected.id}
            </code>
            {selected.origin && (
              <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                selected.origin === "crowd_profile"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : selected.origin === "system"
                    ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              }`}>
                {selected.origin === "crowd_profile" && <Database className="h-3 w-3" />}
                {ORIGIN_LABEL[selected.origin] ?? selected.origin}
              </span>
            )}
            {selected.origin === "crowd_profile" && selected.crowdProfileId && (
              <code className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-mono text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                profile: {selected.crowdProfileId.slice(0, 8)}…
                {selected.crowdProfileVersionId && ` v${selected.crowdProfileVersionId.slice(0, 6)}`}
              </code>
            )}
            <button
              onClick={onRemove}
              className="ml-auto flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11.5px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="名称 / name">
              <input
                value={selected.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                placeholder="如 趋势分析子 agent"
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </Field>
            <Field label="启用">
              <label className="flex items-center gap-2 text-[12px] text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => onUpdate({ enabled: e.target.checked })}
                />
                enabled（被 runner 选中后生效）
              </label>
            </Field>

            <Field label="persona（角色 prompt，会替换 runner 中硬编码的角色段）" className="col-span-2">
              <textarea
                value={selected.persona}
                onChange={(e) => onUpdate({ persona: e.target.value })}
                rows={6}
                placeholder="你是 …… 的子 agent，专注 ……"
                className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <p className="mt-1 text-[10.5px] text-neutral-400">
                引擎红线尾注（数据域、不可外发等）由 runner 恒定追加，不会被 persona 覆盖。
              </p>
            </Field>

            <Field label="maxRetries（自愈重试上限，0~5；耗尽 → waiting_for_help）">
              <input
                type="number"
                min={0}
                max={5}
                value={selected.maxRetries}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onUpdate({
                    maxRetries: Number.isFinite(v) ? Math.max(0, Math.min(5, Math.trunc(v))) : 0,
                  });
                }}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </Field>
            <Field label="数据域 dataScope（只读 · 锁死 clean_data）">
              <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Lock className="h-3.5 w-3.5" />
                <code className="font-mono">clean_data</code>
                <span className="text-[10.5px] text-emerald-600/80 dark:text-emerald-400/80">
                  · 编译期 + server 双锁，不允许 draw_data
                </span>
              </div>
            </Field>
          </div>

          <div className="mt-3 rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300">
              toolIds（挂载的 analysis 计算工具白名单）
              <span className="font-normal text-neutral-400">
                空 = 不挂任何工具；ingestion 工具不会进入子 agent 候选或 scoped MCP
              </span>
              <button
                onClick={onReloadTools}
                disabled={toolsLoading}
                className="ml-auto rounded border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                title="刷新工具清单"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${toolsLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <ToolPicker value={selected.toolIds} tools={tools} onChange={onUpdateToolIds} />
          </div>

          {issues.length > 0 && (
            <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <div className="mb-1 flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                校验问题（保存时 server 会丢弃非法项）
              </div>
              <ul className="ml-5 list-disc space-y-0.5">
                {issues.map((it, i) => (
                  <li key={i} className={it.level === "warn" ? "text-amber-700 dark:text-amber-400" : ""}>
                    [{it.level}] {it.msg}
                  </li>
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

// ── ToolPicker：按 category 分组 + risk 徽章 + 文本兜底 ─────────────────────

function ToolPicker({
  value,
  tools,
  onChange,
}: {
  value: string[];
  tools: ExtractionTool[];
  onChange: (ids: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");

  const selectedSet = useMemo(() => new Set(value), [value]);
  const knownIdSet = useMemo(() => new Set(tools.map((t) => t.id)), [tools]);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? tools.filter(
          (t) =>
            t.id.toLowerCase().includes(f) ||
            t.name.toLowerCase().includes(f) ||
            (t.description ?? "").toLowerCase().includes(f) ||
            (t.tags ?? []).join(" ").toLowerCase().includes(f) ||
            (t.allowedUse ?? "").toLowerCase().includes(f) ||
            (t.forbiddenUse ?? "").toLowerCase().includes(f),
        )
      : tools;
    const map = new Map<string, ExtractionTool[]>();
    for (const t of filtered) {
      const key = t.category ?? "analysis";
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools, filter]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const remove = (id: string) => onChange(value.filter((x) => x !== id));

  const addFromText = () => {
    const id = text.trim();
    if (!id) return;
    if (!value.includes(id)) onChange([...value, id]);
    setText("");
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 已选 chip */}
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-[11px] text-neutral-400">未挂任何计算工具</span>}
        {value.map((id) => {
          const tool = tools.find((t) => t.id === id);
          const unknown = !knownIdSet.has(id);
          return (
            <span
              key={id}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] ${
                unknown
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              }`}
              title={tool?.description ?? (unknown ? "当前工具清单中不存在该 id（保存仍会保留）" : "")}
            >
              {tool?.name ?? id}
              {unknown && <span className="text-[10px]">·未知</span>}
              <button
                onClick={() => remove(id)}
                className={
                  unknown
                    ? "text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
                    : "text-sky-500 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-200"
                }
                title="移除"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      {/* 工具清单（按 category 分组） */}
      {tools.length > 0 ? (
        <details className="rounded border border-neutral-200 bg-white text-[11.5px] dark:border-neutral-700 dark:bg-neutral-900">
          <summary className="cursor-pointer select-none px-2 py-1 text-neutral-600 dark:text-neutral-300">
            从已注册的计算工具中选择（{tools.length}）
          </summary>
          <div className="border-t border-neutral-100 dark:border-neutral-800">
            <div className="px-2 py-1">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="按 id / name / 描述过滤…"
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              />
            </div>
            <div className="max-h-72 overflow-auto">
              {grouped.length === 0 && (
                <div className="px-2 py-3 text-center text-[11px] text-neutral-400">无匹配工具</div>
              )}
              {grouped.map(([category, list]) => (
                <div key={category}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-2 py-1 text-[10.5px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-400">
                    {CATEGORY_LABEL[category as ExtractionToolCategory] ?? category}
                    <span className="text-[10px] font-normal text-neutral-400">({list.length})</span>
                  </div>
                  {list.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(tool.id)}
                        onChange={() => toggle(tool.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200">{tool.id}</code>
                          <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">{tool.name}</span>
                          {tool.riskLevel && (
                            <span className={`shrink-0 rounded px-1 py-0.5 text-[9.5px] font-medium ${RISK_BADGE[tool.riskLevel]}`}>
                              {tool.riskLevel}
                            </span>
                          )}
                        </div>
                        {tool.description && (
                          <div className="truncate text-[10.5px] text-neutral-400">{tool.description}</div>
                        )}
                        {tool.tags && tool.tags.length > 0 && (
                          <div className="truncate text-[10px] text-neutral-400">tags: {tool.tags.join(", ")}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : (
        <p className="text-[11px] text-neutral-400">暂未读取到工具清单（GET /api/extraction-tools 为空）。</p>
      )}

      {/* 文本兜底：兼容尚未注册或外部 id */}
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
          placeholder="手填 toolId（回车添加），保存后引擎会按 id 与清单求交集"
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
