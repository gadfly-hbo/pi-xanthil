import type { ReactNode } from "react";

export interface ExportAction {
  key: string;
  label: ReactNode;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ExportActions({ actions, trailing }: { actions: ExportAction[]; trailing?: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center gap-2">
    {actions.map((action) => <button
      type="button"
      key={action.key}
      title={action.title}
      disabled={action.disabled}
      onClick={action.onClick}
      className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >{action.label}</button>)}
    {trailing}
  </div>;
}
