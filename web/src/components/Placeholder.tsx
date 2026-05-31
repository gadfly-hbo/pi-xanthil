import type { LucideIcon } from "lucide-react";

export function Placeholder({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Icon className="h-10 w-10 text-neutral-300 dark:text-neutral-700" strokeWidth={1.25} />
      <p className="mt-3 text-[14px] font-medium text-neutral-600 dark:text-neutral-300">{title}</p>
      <p className="mt-1 text-[12.5px] text-neutral-400 dark:text-neutral-500">{hint}</p>
      <span className="mt-3 rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        Phase 2
      </span>
    </div>
  );
}
