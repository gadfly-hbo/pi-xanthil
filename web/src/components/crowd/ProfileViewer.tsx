import { useState, useEffect, useCallback } from "react";
import {
  History,
  RotateCcw,
  MessageSquare,
  CheckCircle2,
  XCircle,
  GitBranch,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Send,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type {
  CrowdProfile,
  CrowdProfileVersion,
  CrowdProfileFeedback,
  CrowdSubAgentDraft,
  SubAgentTemplate,
} from "@/types";

interface Props {
  workspaceId: string;
  profile: CrowdProfile;
  onUpdated: (profile: CrowdProfile) => void;
  onClose: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SOURCE_LABELS: Record<string, string> = {
  generated: "系统生成",
  manual_edit: "人工修改",
  simulation_feedback: "模拟反馈",
};

export function ProfileViewer({ workspaceId, profile, onUpdated, onClose }: Props) {
  const [versions, setVersions] = useState<CrowdProfileVersion[]>([]);
  const [feedback, setFeedback] = useState<CrowdProfileFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishDraft, setPublishDraft] = useState<CrowdSubAgentDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, f] = await Promise.all([
        api.listCrowdProfileVersions(workspaceId, profile.id),
        api.listCrowdProfileFeedback(workspaceId, profile.id),
      ]);
      setVersions(v);
      setFeedback(f);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, profile.id]);

  useEffect(() => { void load(); }, [load]);

  const handleRollback = useCallback(async (versionId: string) => {
    if (!window.confirm("确认回滚到此版本？当前版本将被替换。")) return;
    try {
      const updated = await api.rollbackCrowdProfile(workspaceId, profile.id, versionId);
      onUpdated(updated);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rollback failed");
    }
  }, [workspaceId, profile.id, onUpdated, load]);

  const handleAdopt = useCallback(async (feedbackId: string) => {
    setAdopting(feedbackId);
    setError(null);
    try {
      const result = await api.adoptCrowdProfileFeedback(workspaceId, profile.id, feedbackId);
      onUpdated(result.profile);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "adopt failed");
    } finally {
      setAdopting(null);
    }
  }, [workspaceId, profile.id, onUpdated, load]);

  const handleReject = useCallback(async (feedbackId: string) => {
    setRejecting(feedbackId);
    setError(null);
    try {
      await api.updateCrowdProfileFeedbackStatus(workspaceId, profile.id, feedbackId, "rejected");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "reject failed");
    } finally {
      setRejecting(null);
    }
  }, [workspaceId, profile.id, load]);

  const currentVersion = versions.find((v) => v.id === profile.currentVersionId);

  const handlePublishDraft = useCallback(async () => {
    if (!currentVersion) return;
    setPublishing(true);
    setError(null);
    try {
      const draft = await api.createCrowdSubAgentDraft(workspaceId, profile.id, currentVersion.id);
      setPublishDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成 draft 失败");
    } finally {
      setPublishing(false);
    }
  }, [workspaceId, profile.id, currentVersion]);

  const handleConfirmPublish = useCallback(async () => {
    if (!publishDraft) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = await api.listSubAgents();
      const newTemplate: SubAgentTemplate = {
        id: `sa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: publishDraft.name,
        enabled: true,
        persona: publishDraft.persona,
        toolIds: [],
        dataScope: "clean_data",
        maxRetries: 0,
        source: "custom",
        origin: "crowd_profile",
        crowdProfileId: publishDraft.crowdProfileId,
        crowdProfileVersionId: publishDraft.crowdProfileVersionId,
      };
      await api.saveSubAgents([...existing, newTemplate]);
      const updatedProfile = await api.updateCrowdProfile(workspaceId, profile.id, {
        publishedSubAgentTemplateId: newTemplate.id,
      });
      onUpdated(updatedProfile);
      setPublishDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存到 subagents.json 失败");
    } finally {
      setPublishing(false);
    }
  }, [publishDraft, profile, onUpdated]);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{profile.name}</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium",
              profile.status === "active" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
              profile.status === "draft" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
              profile.status === "archived" && "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
            )}>
              {profile.status}
            </span>
            {currentVersion && <span>v{currentVersion.version}</span>}
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted text-muted-foreground">
          <XCircle className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* publish action */}
          {currentVersion && !profile.publishedSubAgentTemplateId && (
            <div className="rounded-md border border-dashed border-emerald-300 bg-emerald-50/50 p-3 dark:border-emerald-700 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <Send className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">发布为子 agent 模板</span>
                </div>
                <button
                  onClick={handlePublishDraft}
                  disabled={publishing}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 text-white px-2.5 py-1 text-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {publishing ? "生成中..." : "发布"}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-600/70 dark:text-emerald-400/70">
                <Shield className="h-3 w-3" />
                仅发布 persona，不挂载工具，不继承数据读取权限
              </div>
            </div>
          )}

          {profile.publishedSubAgentTemplateId && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>已发布为子 agent 模板</span>
              <code className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-mono dark:bg-emerald-900/40">
                {profile.publishedSubAgentTemplateId}
              </code>
            </div>
          )}

          {/* publish confirmation dialog */}
          {publishDraft && (
            <div className="rounded-md border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Send className="h-3.5 w-3.5 text-emerald-600" />
                确认发布到 subagents 管理
              </div>
              <div className="rounded bg-muted/50 p-2 text-xs space-y-1">
                <div><span className="text-muted-foreground">名称：</span>{publishDraft.name}</div>
                <div><span className="text-muted-foreground">来源：</span>crowd_profile · v{currentVersion?.version}</div>
                <div className="whitespace-pre-wrap text-muted-foreground max-h-24 overflow-auto">
                  <span className="text-foreground">persona：</span>{publishDraft.persona.slice(0, 200)}{publishDraft.persona.length > 200 ? "..." : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                dataScope=clean_data · toolIds=[] · 不继承 dataset 访问能力
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleConfirmPublish}
                  disabled={publishing}
                  className="flex items-center gap-1 rounded bg-emerald-600 text-white px-2.5 py-1 text-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  确认发布
                </button>
                <button
                  onClick={() => setPublishDraft(null)}
                  className="rounded border border-input px-2.5 py-1 text-xs hover:bg-muted"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* current version content */}
          {currentVersion && (
            <div className="rounded-md border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                <span>当前版本 v{currentVersion.version}</span>
                <span>·</span>
                <span>{SOURCE_LABELS[currentVersion.source] ?? currentVersion.source}</span>
                <span>·</span>
                <span>{formatTime(currentVersion.createdAt)}</span>
              </div>
              {currentVersion.content.persona && (
                <div className="text-sm whitespace-pre-wrap">{currentVersion.content.persona}</div>
              )}
              {currentVersion.content.traits.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {currentVersion.content.traits.map((t, i) => (
                    <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* version history */}
          <details className="group">
            <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
              <History className="h-3 w-3" />
              <span>版本历史 ({versions.length})</span>
              <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
              {versions.map((v) => {
                const isCurrent = v.id === profile.currentVersionId;
                return (
                  <div
                    key={v.id}
                    className={cn(
                      "flex items-center justify-between rounded-md border px-3 py-1.5 text-xs",
                      isCurrent ? "border-primary/30 bg-primary/5" : "bg-card",
                    )}
                  >
                    <button
                      onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    >
                      {expandedVersion === v.id ? (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      )}
                      <span className="font-medium">v{v.version}</span>
                      <span className="text-muted-foreground">{SOURCE_LABELS[v.source] ?? v.source}</span>
                      <span className="text-muted-foreground">{formatTime(v.createdAt)}</span>
                      {isCurrent && (
                        <span className="rounded bg-primary/10 text-primary px-1 py-0 text-[10px] font-medium">当前</span>
                      )}
                    </button>
                    {!isCurrent && (
                      <button
                        onClick={() => handleRollback(v.id)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="回滚到此版本"
                      >
                        <RotateCcw className="h-3 w-3" />
                        回滚
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </details>

          {/* expanded version detail */}
          {expandedVersion && (() => {
            const v = versions.find((x) => x.id === expandedVersion);
            if (!v) return null;
            return (
              <div className="rounded-md border bg-muted/20 p-3 space-y-1.5 text-xs">
                <div className="font-medium">v{v.version} · {SOURCE_LABELS[v.source] ?? v.source}</div>
                {v.content.persona && <div className="whitespace-pre-wrap text-muted-foreground">{v.content.persona}</div>}
                {v.content.traits.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.content.traits.map((t, i) => <span key={i} className="rounded bg-muted px-1.5 py-0.5">{t}</span>)}
                  </div>
                )}
                {v.content.motivations.length > 0 && (
                  <div className="text-muted-foreground">动机: {v.content.motivations.join(" · ")}</div>
                )}
                {v.content.objections.length > 0 && (
                  <div className="text-muted-foreground">反对点: {v.content.objections.join(" · ")}</div>
                )}
                {v.content.evidenceSummary.length > 0 && (
                  <div className="text-muted-foreground">证据: {v.content.evidenceSummary.join(" · ")}</div>
                )}
              </div>
            );
          })()}

          {/* feedback */}
          <details className="group">
            <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
              <MessageSquare className="h-3 w-3" />
              <span>模拟反馈 ({feedback.length})</span>
              <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="mt-2 space-y-2">
              {feedback.length === 0 && (
                <div className="text-xs text-muted-foreground py-2">暂无反馈</div>
              )}
              {feedback.map((fb) => (
                <div key={fb.id} className={cn(
                  "rounded-md border p-2.5 text-xs space-y-1.5",
                  fb.status === "pending" ? "bg-card" : "bg-muted/30 opacity-60",
                )}>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "rounded px-1.5 py-0 text-[10px] font-medium",
                      fb.status === "pending" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      fb.status === "adopted" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                      fb.status === "rejected" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                    )}>
                      {fb.status === "pending" ? "待审" : fb.status === "adopted" ? "已采纳" : "已拒绝"}
                    </span>
                    {fb.sourceRunId && <span className="text-muted-foreground">run: {fb.sourceRunId.slice(0, 8)}</span>}
                    <span className="text-muted-foreground">{formatTime(fb.createdAt)}</span>
                  </div>
                  {fb.objections.length > 0 && (
                    <div>
                      <span className="font-medium text-red-600 dark:text-red-400">反对点：</span>
                      {fb.objections.map((o, i) => <div key={i} className="text-muted-foreground ml-2">· {o}</div>)}
                    </div>
                  )}
                  {fb.acceptanceConditions.length > 0 && (
                    <div>
                      <span className="font-medium text-amber-600 dark:text-amber-400">接受条件：</span>
                      {fb.acceptanceConditions.map((c, i) => <div key={i} className="text-muted-foreground ml-2">· {c}</div>)}
                    </div>
                  )}
                  {fb.suggestions.length > 0 && (
                    <div>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">建议：</span>
                      {fb.suggestions.map((s, i) => <div key={i} className="text-muted-foreground ml-2">· {s}</div>)}
                    </div>
                  )}
                  {fb.status === "pending" && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleAdopt(fb.id)}
                        disabled={adopting === fb.id}
                        className="flex items-center gap-1 rounded bg-emerald-100 text-emerald-700 px-2 py-0.5 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-900/30 dark:text-emerald-300"
                      >
                        {adopting === fb.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        采纳
                      </button>
                      <button
                        onClick={() => handleReject(fb.id)}
                        disabled={rejecting === fb.id}
                        className="flex items-center gap-1 rounded bg-red-100 text-red-700 px-2 py-0.5 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-300"
                      >
                        {rejecting === fb.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
