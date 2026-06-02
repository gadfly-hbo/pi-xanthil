import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronDown, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PiSkill } from "@/types";

type Scope =
  | { type: "workspace"; workspaceId: string }
  | { type: "flow"; flowId: string };

interface Props {
  scope: Scope | null;
  selectedPaths: string[];
  onChange: (paths: string[]) => void;
}

export function SkillSelector({ scope, selectedPaths, onChange }: Props) {
  const [skills, setSkills] = useState<PiSkill[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onChange([]);
    setSkills([]);
    setError("");
    if (!scope) return;
    let cancelled = false;
    setLoading(true);
    const request = scope.type === "workspace"
      ? api.listWorkspaceSkills(scope.workspaceId)
      : api.listFlowSkills(scope.flowId);
    request
      .then((items) => {
        if (!cancelled) setSkills(items);
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
    <div className="relative">
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
        <div className="absolute bottom-9 left-0 z-30 w-80 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
              <span className="block text-[12px] font-medium text-neutral-800 dark:text-neutral-100">自动选择</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">使用 pi 默认 discovery，由模型按任务选择 skill。</span>
            </span>
          </button>
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <div className="max-h-64 overflow-y-auto">
            {loading && <p className="px-2 py-2 text-[11px] text-neutral-400">正在读取 skill...</p>}
            {error && <p className="px-2 py-2 text-[11px] text-red-500">{error}</p>}
            {!loading && !error && skills.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-neutral-400">没有发现可用 skill。</p>
            )}
            {skills.map((skill) => {
              const checked = selectedPaths.includes(skill.path);
              return (
                <button
                  key={skill.path}
                  type="button"
                  disabled={!skill.available}
                  onClick={() => toggle(skill)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
                  title={skill.error || skill.path}
                >
                  <span className={cn("mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", checked && "border-neutral-700 bg-neutral-700 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900")}>
                    {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">{skill.name}</span>
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
        <div className="absolute bottom-8 left-0 flex max-w-[420px] gap-1 overflow-hidden">
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
