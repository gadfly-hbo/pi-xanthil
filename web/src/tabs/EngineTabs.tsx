import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Placeholder } from "@/components/Placeholder";
import { ChatPane } from "@/components/ChatPane";
import { BusinessRequirementPane } from "@/components/BusinessRequirementPane";
import { MultiAgentExecutionPane } from "@/components/MultiAgentExecutionPane";
import { SkillLabPane } from "@/components/SkillLabPane";
import { ToolLabPane } from "@/components/ToolLabPane";
import { AnaXPane } from "@/components/AnaXPane";
import { HypothesisPane } from "@/components/HypothesisPane";
import { ChangeManagementPane } from "@/components/ChangeManagementPane";
import { ZhuantiReadmePane } from "@/components/ZhuantiReadmePane";
import { WorkflowReadmePane } from "@/components/WorkflowReadmePane";
import { ExploreReadmePane } from "@/components/ExploreReadmePane";
import type { TabContext } from "./types";
import { textOf } from "@/types";

function buildZhuantiSeedDraft(ctx: TabContext): string {
  const turns = ctx.zhuantiChatMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const text = textOf(message.content).trim();
      return text ? `${message.role === "user" ? "用户" : "分析"}：${text}` : "";
    })
    .filter(Boolean)
    .slice(-6);
  const source = turns.join("\n\n").trim();
  return [
    "问题陈述：",
    source || "（请补充本次要验证的商务问题）",
    "",
    "初始假设：",
    "1. （请把对话中已经形成的初始假设写在这里）",
  ].join("\n");
}

function ZhuantiChatPane({ ctx }: { ctx: TabContext }) {
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const defaultDraft = useMemo(() => buildZhuantiSeedDraft(ctx), [ctx.zhuantiChatMessages]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => {
            setDraft(defaultDraft);
            setDraftOpen(true);
          }}
          disabled={ctx.zhuantiChatMessages.length === 0}
          className="inline-flex h-7 items-center rounded-md border border-neutral-200 px-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          启动假设验证流水线
        </button>
        <span className="text-[11px] text-neutral-400">确认问题与初始假设后，将填入流水线 brief；不会自动运行。</span>
      </div>
      <ChatPane
        messages={ctx.zhuantiChatMessages}
        running={ctx.zhuantiChatRunning}
        disabled={!ctx.zhuantiChatSessionId}
        workspaceId={ctx.activeWorkspaceId}
        folderScope={ctx.zhuantiChatFolderScope}
        sessionId={ctx.zhuantiChatSessionId ?? undefined}
        model={ctx.model}
        models={ctx.models}
        onModelChange={ctx.setModel}
        onSend={ctx.onZhuantiChatSend}
        onStop={ctx.onZhuantiChatStop}
        runtime={ctx.zhuantiChatRuntime}
        compacting={ctx.zhuantiChatCompacting}
        runtimeNotice={ctx.zhuantiChatRuntimeNotice}
        onCompact={() => void ctx.compactZhuantiChatContext()}
        onRefreshRuntime={() => void ctx.refreshZhuantiChatRuntime()}
      />
      {draftOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
              <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">确认流水线 seed</div>
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="rounded-md px-2 py-1 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="h-72 w-full resize-none rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-[12.5px] leading-5 text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const task = draft.trim();
                  if (!task) return;
                  ctx.setZhuantiSeed({ task });
                  ctx.setActiveSubTab("anax_view");
                  setDraftOpen(false);
                }}
                disabled={!draft.trim()}
                className="h-8 rounded-md bg-sky-500 px-3 text-[12px] font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                填入流水线
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 【Agent-E · 智能引擎域】tab 渲染模块 —— owner: codex(GPT-5.5)
 * 覆盖：日常→对话/业务需求 · 重复(含 workflow 三级 tab，复用原 ResearchLabPane) · 专题(AnaX 对话探索/流水线/假设库/变更管理/readme) · 控制→skill/tool 实验场。
 * 新增/调整本域 pane 渲染只改本文件；需要的上下文字段从 TabContext 读取。
 */
export function EngineTabs({ ctx }: { ctx: TabContext }) {
  const { activeTab, activeSubTab } = ctx;
  return (
    <>
      {activeTab === "zhuanti" && activeSubTab === "anax_chat" && (
        <ZhuantiChatPane ctx={ctx} />
      )}

      {activeTab === "explore" && activeSubTab === "view" && (
        <ChatPane
          messages={ctx.messages}
          running={ctx.running}
          disabled={!ctx.activeSessionId}
          workspaceId={ctx.activeWorkspaceId}
          folderScope={ctx.folderScope}
          model={ctx.model}
          models={ctx.models}
          onModelChange={ctx.setModel}
          onSend={ctx.onSend}
          onStop={ctx.onStop}
          runtime={ctx.runtime}
          compacting={ctx.compacting}
          runtimeNotice={ctx.runtimeNotice}
          onCompact={() => void ctx.compactContext()}
          onRefreshRuntime={() => void ctx.refreshRuntime()}
        />
      )}
      {(activeTab === "explore" || activeTab === "multi" || activeTab === "zhuanti") && activeSubTab === "business_requirement" && (
        <BusinessRequirementPane
          scope={ctx.folderScope}
          model={ctx.model}
          onGenerated={() => ctx.setArtifactRefreshKey((current) => current + 1)}
          onBusinessContextChanged={() => void ctx.refreshRulesPromptInfo()}
          onExploreFields={(fieldHints, source) => { ctx.setExploreSeed({ fieldHints, source }); ctx.setActiveSubTab("data_exploration"); }}
        />
      )}

      {activeTab === "multi" && activeSubTab === "readme" && <WorkflowReadmePane />}

      {activeTab === "explore" && activeSubTab === "readme" && <ExploreReadmePane />}

      {activeTab === "multi" && activeSubTab === "view" && (
        <MultiAgentExecutionPane
          flow={ctx.activeFlow?.kind === "multi" ? ctx.activeFlow : null}
          flows={ctx.flows}
          workspaceId={ctx.activeWorkspaceId}
          models={ctx.models}
          model={ctx.model}
          onModelChange={ctx.setModel}
          rulesPromptEnabled={ctx.rulesPromptEnabled}
          knowledgePromptEnabled={ctx.knowledgePromptEnabled}
        />
      )}

      {activeTab === "aggregate" && activeSubTab === "skill" && (
        <SkillLabPane workspaceId={ctx.activeWorkspaceId} model={ctx.model} models={ctx.models} onModelChange={ctx.setModel} />
      )}
      {activeTab === "aggregate" && activeSubTab === "tool" && (
        <ToolLabPane workspaceId={ctx.activeWorkspaceId} model={ctx.model} models={ctx.models} />
      )}
      {activeTab === "aggregate" && activeSubTab === "hooks_lab" && (
        <Placeholder icon={FlaskConical} title="hooks 实验场" hint="hooks 试运行实验场，即将推出" />
      )}
      {activeTab === "aggregate" && activeSubTab === "command_lab" && (
        <Placeholder icon={FlaskConical} title="command 实验场" hint="command 试运行实验场，即将推出" />
      )}
      {activeTab === "aggregate" && activeSubTab === "subagents_lab" && (
        <Placeholder icon={FlaskConical} title="subagents 实验场" hint="subagents 试运行实验场，即将推出" />
      )}
      {activeTab === "aggregate" && activeSubTab === "prompts_lab" && (
        <Placeholder icon={FlaskConical} title="prompts 实验场" hint="prompts 试运行实验场，即将推出" />
      )}
      {(activeTab === "explore" || activeTab === "multi" || activeTab === "zhuanti") && activeSubTab === "dlf" && (
        <Placeholder icon={FlaskConical} title="DLF" hint="DLF 模块管理，即将推出" />
      )}

      {activeTab === "zhuanti" && activeSubTab === "anax_view" && (
        <AnaXPane
          workspaceId={ctx.activeWorkspaceId}
          model={ctx.model}
          models={ctx.models}
          rulesPromptEnabled={ctx.rulesPromptEnabled}
          knowledgePromptEnabled={ctx.knowledgePromptEnabled}
          seed={ctx.zhuantiSeed}
          onSeedConsumed={() => ctx.setZhuantiSeed(null)}
          onBackflowSummary={ctx.pushZhuantiChatSummary}
        />
      )}
      {activeTab === "zhuanti" && activeSubTab === "hypothesis" && (
        <HypothesisPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "zhuanti" && activeSubTab === "change_mgmt" && (
        <ChangeManagementPane workspaceId={ctx.activeWorkspaceId} />
      )}
      {activeTab === "zhuanti" && activeSubTab === "readme" && <ZhuantiReadmePane />}
    </>
  );
}
