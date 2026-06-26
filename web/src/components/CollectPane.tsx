import { useState } from "react";
import { BookmarkPlus, Check, Globe2, X } from "lucide-react";
import { ChatPane } from "@/components/ChatPane";
import { CollectSidebar } from "@/components/CollectSidebar";
import type { UiMessage } from "@/components/MessageRow";
import { api } from "@/lib/api";
import { textOf } from "@/types";
import type { TabContext } from "@/tabs/types";

const SAVED_DOCS_KEY = "xanthil.collect.savedDocs";

function defaultTitleFromText(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return `收集资料 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
}

function hashText(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function readSavedDocs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_DOCS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveKey(sessionId: string | null, content: string): string {
  return `${sessionId ?? "none"}:${hashText(content)}`;
}

export function CollectPane({ ctx }: { ctx: TabContext }) {
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedDocs, setSavedDocs] = useState<Record<string, string>>(() => readSavedDocs());

  async function saveDraft() {
    if (!ctx.activeWorkspaceId || !draft || saving) return;
    const title = draft.title.trim();
    if (!title) {
      setError("标题不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const doc = await api.createKnowledgeDoc(ctx.activeWorkspaceId, {
        title,
        content: draft.content,
        tags: ["收集"],
        scope: "global",
      });
      setSavedDocs((current) => {
        const next = { ...current, [saveKey(ctx.activeCollectSessionId, draft.content)]: doc.id };
        localStorage.setItem(SAVED_DOCS_KEY, JSON.stringify(next));
        return next;
      });
      setDraft(null);
      setNotice("已存入知识库");
      ctx.refreshKnowledgePromptInfo();
      window.setTimeout(() => setNotice(""), 2400);
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function renderMessageAction(message: UiMessage) {
    if (message.role !== "assistant" || message.error) return null;
    const content = textOf(message.content).trim();
    if (!content) return null;
    const saved = Boolean(savedDocs[saveKey(ctx.activeCollectSessionId, content)]);
    return (
      <button
        type="button"
        onClick={() => {
          setDraft({ title: defaultTitleFromText(content), content });
          setError("");
        }}
        disabled={!ctx.activeWorkspaceId || saved}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        title={saved ? "已存入知识库" : "存为资料"}
      >
        {saved ? <Check className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
        {saved ? "已保存" : "存为资料"}
      </button>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <CollectSidebar ctx={ctx} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <Globe2 className="h-4 w-4 text-sky-500" />
          <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">联网收集</span>
          <span className="text-[11px] text-neutral-400">仅本窗口可联网，回复请核对来源链接</span>
          {notice && <span className="ml-auto text-[11px] text-emerald-600 dark:text-emerald-400">{notice}</span>}
        </div>
        <ChatPane
          messages={ctx.collectMessages}
          running={ctx.collectRunning}
          disabled={!ctx.collectSessionId}
          workspaceId={ctx.activeWorkspaceId}
          folderScope={ctx.collectFolderScope}
          sessionId={ctx.collectSessionId ?? undefined}
          model={ctx.model}
          models={ctx.models}
          onModelChange={ctx.setModel}
          onSend={ctx.onCollectSend}
          onStop={ctx.onCollectStop}
          runtime={ctx.collectRuntime}
          compacting={ctx.collectCompacting}
          runtimeNotice={ctx.collectRuntimeNotice}
          onCompact={() => void ctx.compactCollectContext()}
          onRefreshRuntime={() => void ctx.refreshCollectRuntime()}
          renderMessageAction={renderMessageAction}
          hideSediment
          hideSkill
          hidePromptLib
          hideBizReq
          hideToolPanel
          hideDelegate
        />
      </div>
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex w-full max-w-lg flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
              <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">存为资料</div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-[12px] text-neutral-600 dark:text-neutral-300">
                标题
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-[12px] text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </label>
              <div className="max-h-40 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-[11.5px] leading-5 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
                {draft.content.slice(0, 1200)}
                {draft.content.length > 1200 ? "\n..." : ""}
              </div>
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={saving || !draft.title.trim()}
                className="h-8 rounded-md bg-neutral-900 px-3 text-[12px] font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
