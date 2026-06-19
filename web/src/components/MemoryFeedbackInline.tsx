import { useEffect, useState } from "react";
import { Check, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { MemoryItem } from "@/types";

interface Props {
  workspaceId: string | null;
  targetKind: "session" | "flow";
  targetId: string;
  refreshKey: string;
  hidden?: boolean;
}

type FeedbackSignal = "positive" | "negative";

export function MemoryFeedbackInline({ workspaceId, targetKind, targetId, refreshKey, hidden = false }: Props) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [votes, setVotes] = useState<Record<string, FeedbackSignal>>({});
  const [pendingId, setPendingId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setVotes({});
    setErrors({});
    setLoadError("");
    if (!workspaceId || !targetId || hidden) return () => { cancelled = true; };

    api.listLatestInjectedMemoryItems(workspaceId, { targetKind, targetId })
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setItems([]);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => { cancelled = true; };
  }, [hidden, refreshKey, targetId, targetKind, workspaceId]);

  async function submit(itemId: string, signal: FeedbackSignal) {
    if (!workspaceId || pendingId || votes[itemId]) return;
    setPendingId(itemId);
    setErrors((current) => ({ ...current, [itemId]: "" }));
    try {
      const updated = await api.recordInjectedMemoryFeedback(workspaceId, itemId, signal);
      setItems((current) => current.map((item) => item.id === itemId ? updated : item));
      setVotes((current) => ({ ...current, [itemId]: signal }));
    } catch (error) {
      setErrors((current) => ({ ...current, [itemId]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setPendingId("");
    }
  }

  if (hidden) return null;
  if (loadError) {
    return <div className="mt-2 text-[10.5px] text-red-500" title={loadError}>记忆反馈加载失败</div>;
  }
  if (items.length === 0) return null;

  return (
    <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
      <div className="mb-1 text-[10.5px] font-medium text-neutral-400 dark:text-neutral-500">本轮使用的记忆</div>
      <div className="space-y-1">
        {items.map((item) => {
          const vote = votes[item.id];
          const pending = pendingId === item.id;
          return (
            <div key={item.id} className="flex min-w-0 items-center gap-2 py-1">
              <div className="min-w-0 flex-1" title={item.body}>
                <div className="truncate text-[11.5px] text-neutral-600 dark:text-neutral-300">{item.title}</div>
              </div>
              <span className="shrink-0 font-mono text-[9.5px] text-neutral-400">+{item.positiveSignals}/-{item.negativeSignals}</span>
              <div className="flex shrink-0 items-center gap-0.5">
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void submit(item.id, "positive")}
                      disabled={Boolean(vote) || Boolean(pendingId)}
                      title="Helpful"
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-default dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400",
                        vote === "positive" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
                      )}
                    >
                      {vote === "positive" ? <Check className="h-3.5 w-3.5" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submit(item.id, "negative")}
                      disabled={Boolean(vote) || Boolean(pendingId)}
                      title="Wrong"
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-default dark:hover:bg-red-950/40 dark:hover:text-red-400",
                        vote === "negative" && "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
                      )}
                    >
                      {vote === "negative" ? <Check className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
                    </button>
                  </>
                )}
              </div>
              {errors[item.id] && <span className="max-w-40 truncate text-[10.5px] text-red-500" title={errors[item.id]}>提交失败</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
