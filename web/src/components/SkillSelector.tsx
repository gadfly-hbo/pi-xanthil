import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronDown, X, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { sharedApi } from "@/lib/api/shared";
import { cn } from "@/lib/cn";
import type { PiSkill, SkillRegistryEntry } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  selectedPaths: string[];
  onChange: (paths: string[]) => void;
  align?: "left" | "right";
  direction?: "up" | "down";
}

export function SkillSelector({ scope, selectedPaths, onChange, align = "left", direction = "up" }: Props) {
  const [skills, setSkills] = useState<PiSkill[]>([]);
  const [registryEntries, setRegistryEntries] = useState<SkillRegistryEntry[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onChange([]);
    setSkills([]);
    setRegistryEntries([]);
    setEnabledIds(new Set());
    setError("");
    if (!scope) return;
    let cancelled = false;
    setLoading(true);
    const skillsRequest = scope.type === "workspace"
      ? api.listWorkspaceSkills(scope.workspaceId)
      : api.listFlowSkills(scope.flowId);
    const registryRequest = scope.type === "workspace"
      ? Promise.all([
        api.listSkillRegistry(scope.workspaceId).catch(() => [] as SkillRegistryEntry[]),
        sharedApi.listMemoryEnablements(scope.workspaceId, "skill").catch(() => [] as { itemId: string; enabled: boolean }[]),
      ])
      : Promise.resolve<[SkillRegistryEntry[], { itemId: string; enabled: boolean }[]]>([[], []]);
    Promise.all([skillsRequest, registryRequest])
      .then(([items, [entries, enablements]]) => {
        if (cancelled) return;
        setSkills(items);
        setRegistryEntries(entries);
        setEnabledIds(new Set(enablements.filter((e) => e.enabled).map((e) => e.itemId)));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope?.type, scope?.type === "workspace" ? scope.workspaceId : scope?.flowId]);

  const sortedRows = useMemo(() => {
    const bySlug = new Map(registryEntries.map((entry) => [entry.slug, entry]));
    const rows = skills.map((skill) => {
      const match = skill.path.match(/\.pi\/skills\/([^/]+)\/SKILL\.md$/);
      const slug = match ? match[1] : null;
      const registryEntry = slug ? bySlug.get(slug) ?? null : null;
      const isEnabled = registryEntry ? enabledIds.has(registryEntry.id) : false;
      return { skill, isEnabled, registryEntry };
    });
    return rows.sort((a, b) => {
      const aArchived = a.registryEntry?.status === "archived" ? 1 : 0;
      const bArchived = b.registryEntry?.status === "archived" ? 1 : 0;
      if (aArchived !== bArchived) return aArchived - bArchived;
      const aPriority = a.isEnabled ? 0 : a.registryEntry ? 1 : 2;
      const bPriority = b.isEnabled ? 0 : b.registryEntry ? 1 : 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.skill.name.localeCompare(b.skill.name, "zh");
    });
  }, [skills, registryEntries, enabledIds]);

  const enabledCount = useMemo(
    () => sortedRows.filter((row) => row.isEnabled).length,
    [sortedRows],
  );

  const selected = useMemo(
    () => skills.filter((skill) => selectedPaths.includes(skill.path)),
    [selectedPaths, skills],
  );

  const toggle = (skill: PiSkill) => {
    if (!skill.available) return;
    onChange(
      selectedPaths.includes(skill.path)
        ? selectedPaths.filter((path) => path !== skill.path)
        : [...selectedPaths, skill.path],
    );
  };

  return (
    <div className={cn("relative", direction === "down" && selected.length > 0 && "pb-6")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        title="选择本轮允许 pi 使用的 skill"
      >
        <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>{selected.length > 0 ? `Skill ${selected.length}` : "Skill 自动"}</span>
        <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
      </button>
      {open && (
        <div className={cn(
          "absolute z-30 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900",
          direction === "up" ? "bottom-9" : "top-9",
          align === "left" ? "left-0" : "right-0",
        )}>
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
              selected.length === 0 && "bg-neutral-100 dark:bg-neutral-800",
            )}
          >
            <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", selected.length === 0 ? "opacity-100" : "opacity-0")} />
            <span>
              <span className="block text-[12px] font-medium text-neutral-800 dark:text-neutral-100">自动选择（retrieval）</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">pi 自动按任务 + 工作区已启用项目池（{enabledCount} 条）召回。</span>
            </span>
          </button>
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <div className="max-h-64 overflow-y-auto">
            {loading && <p className="px-2 py-2 text-[11px] text-neutral-400">正在读取 skill...</p>}
            {error && <p className="px-2 py-2 text-[11px] text-red-500">{error}</p>}
            {!loading && !error && sortedRows.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-neutral-400">没有发现可用 skill。</p>
            )}
            {sortedRows.map(({ skill, isEnabled, registryEntry }) => {
              const checked = selectedPaths.includes(skill.path);
              const isArchived = registryEntry?.status === "archived";
              return (
                <button
                  key={skill.path}
                  type="button"
                  disabled={!skill.available || isArchived}
                  onClick={() => toggle(skill)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
                  title={isArchived ? "项目池中已归档" : (skill.error || skill.path)}
                >
                  <span className={cn("mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", checked && "border-neutral-700 bg-neutral-700 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900")}>
                    {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="block truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{skill.name}</span>
                      {isEnabled && <Sparkles className="h-3 w-3 shrink-0 text-amber-500" strokeWidth={1.75} aria-label="项目池已启用" />}
                      {registryEntry && (
                        <span className="shrink-0 rounded bg-neutral-100 px-1 text-[9.5px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">v{registryEntry.version}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-neutral-400">{skill.description || skill.error}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <p className="mt-1 border-t border-neutral-200 px-2 pt-2 text-[10.5px] leading-4 text-amber-600 dark:border-neutral-800 dark:text-amber-400">
              指定模式：本轮仅加载已勾选 skill。
            </p>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className={cn(
          "absolute flex max-w-[min(26.25rem,calc(100vw-2rem))] gap-1 overflow-hidden",
          direction === "up" ? "bottom-8" : "top-8",
          align === "left" ? "left-0" : "right-0",
        )}>
          {selected.map((skill) => (
            <span key={skill.path} className="inline-flex shrink-0 items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {skill.name}
              <button type="button" onClick={() => toggle(skill)} title={`移除 ${skill.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
