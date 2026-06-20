import { Markdown } from "@/components/Markdown";
import readmeContent from "@/docs/memory-readme.md?raw";

export function MemoryReadmePane() {
  return (
    <div className="flex min-h-0 flex-1 overflow-auto bg-neutral-50/60 p-5 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <Markdown>{readmeContent}</Markdown>
        </div>
      </div>
    </div>
  );
}
