// LLM_FORBIDDEN: this module must never call any LLM API.
// Draggable field list, categorized by inferred kind (number / category / datetime / text / id).

import { useDraggable } from "@dnd-kit/core";
import type { FieldSchema } from "@/lib/profiling";

interface Props {
  fields: FieldSchema[];
}

const KIND_ICON: Record<string, string> = {
  number: "#",
  datetime: "📅",
  boolean: "○",
  category: "Aa",
  text: "T",
  id: "🔑",
};

const KIND_ORDER: Record<string, number> = {
  number: 0,
  datetime: 1,
  category: 2,
  text: 3,
  boolean: 4,
  id: 5,
};

function DraggableField({ field }: { field: FieldSchema }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `field:${field.name}`,
    data: { field },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-1.5 rounded px-2 py-1 text-[12px] ${
        isDragging
          ? "opacity-50 shadow-sm"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-neutral-200 text-[9px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-400">
        {KIND_ICON[field.kind] ?? "?"}
      </span>
      <span className="truncate">{field.name}</span>
      <span className="ml-auto text-[9px] text-neutral-400">{field.kind}</span>
    </div>
  );
}

export function FieldList({ fields }: Props) {
  const groups: Record<string, FieldSchema[]> = {};
  for (const field of fields) {
    const key = field.kind;
    if (!groups[key]) groups[key] = [];
    groups[key].push(field);
  }
  const sortedKeys = Object.keys(groups).sort((a, b) => (KIND_ORDER[a] ?? 99) - (KIND_ORDER[b] ?? 99));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
        字段列表
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {fields.length === 0 && (
          <div className="px-2 py-4 text-[11px] text-neutral-500">加载中...</div>
        )}
        {sortedKeys.map((kind) => (
          <div key={kind} className="mb-2">
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              {kind}
            </div>
            {groups[kind]!.map((field) => (
              <DraggableField key={field.name} field={field} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}