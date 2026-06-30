import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Database,
  RefreshCw,
  Trash2,
  Tags,
  Users,
  ChevronRight,
  Plus,
  Loader2,
  User,
  Eye,
  Shield,
  Sparkles,
  BookOpen,
  X,
  Download,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { DatasetImporter } from "@/components/crowd/DatasetImporter";
import { TagDictionaryEditor } from "@/components/crowd/TagDictionaryEditor";
import { SegmentBuilder } from "@/components/crowd/SegmentBuilder";
import { ProfileViewer } from "@/components/crowd/ProfileViewer";
import readmeContent from "@/docs/the-crowd-readme.md?raw";
import type {
  CrowdDataset,
  CrowdTagDictionaryEntry,
  CrowdSegment,
  CrowdProfile,
} from "@/types";

interface Props {
  workspaceId: string;
}

const DEFAULT_CROWD_PROFILE_MODEL = "minimax-cn/MiniMax-M3";

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function canUseLlmAggregate(dataset: CrowdDataset): boolean {
  if (dataset.fieldProfiles.length === 0) return false;
  return !dataset.fieldProfiles.some((profile) => {
    const field = profile.field.trim().replace(/^\uFEFF/, "").toLowerCase();
    return field === "标签类型"
      || field === "标签"
      || field === "占比"
      || field === "tgi"
      || field.includes("占比")
      || field.includes("tgi")
      || /^col_\d+$/.test(field);
  });
}

function ZoneHeader({ icon: Icon, title, count, action }: {
  icon: typeof Tags;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {title}
        {count !== undefined && <span className="text-muted-foreground/60">({count})</span>}
      </h3>
      {action}
    </div>
  );
}

export function CrowdPane({ workspaceId }: Props) {
  const profileDocInputRef = useRef<HTMLInputElement>(null);
  const profileTemplateInputRef = useRef<HTMLInputElement>(null);
  const [datasets, setDatasets] = useState<CrowdDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDataset, setSelectedDataset] = useState<CrowdDataset | null>(null);
  const [tagDict, setTagDict] = useState<CrowdTagDictionaryEntry[]>([]);
  const [segments, setSegments] = useState<CrowdSegment[]>([]);
  const [profiles, setProfiles] = useState<CrowdProfile[]>([]);
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false);
  const [editingSegment, setEditingSegment] = useState<CrowdSegment | undefined>(undefined);
  const [viewingProfile, setViewingProfile] = useState<CrowdProfile | null>(null);
  const [showReadme, setShowReadme] = useState(false);
  const [uploadingProfileDoc, setUploadingProfileDoc] = useState(false);
  const [generatingProfileSegmentId, setGeneratingProfileSegmentId] = useState<string | null>(null);
  const [profileTemplate, setProfileTemplate] = useState("");
  const [profileTemplateName, setProfileTemplateName] = useState("");

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    try {
      setDatasets(await api.listCrowdDatasets(workspaceId));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void loadDatasets(); }, [loadDatasets]);

  const selectDataset = useCallback(async (dataset: CrowdDataset) => {
    setSelectedDataset(dataset);
    setShowSegmentBuilder(false);
    setEditingSegment(undefined);
    setViewingProfile(null);
    try {
      const [tags, segs, profs] = await Promise.all([
        api.listCrowdTagDictionary(workspaceId, dataset.id),
        api.listCrowdSegments(workspaceId, dataset.id),
        api.listCrowdProfiles(workspaceId),
      ]);
      setTagDict(tags);
      setSegments(segs);
      setProfiles(profs.filter((p) => segs.some((s) => s.id === p.segmentId)));
    } catch { /* ignore */ }
  }, [workspaceId]);

  const deselectDataset = useCallback(() => {
    setSelectedDataset(null);
    setTagDict([]);
    setSegments([]);
    setProfiles([]);
    setShowSegmentBuilder(false);
    setEditingSegment(undefined);
    setViewingProfile(null);
  }, []);

  const handleDelete = useCallback(async (datasetId: string) => {
    if (!window.confirm("确认删除此数据集？所有关联的标签字典、分群、画像将一并删除。")) return;
    await api.deleteCrowdDataset(workspaceId, datasetId);
    if (selectedDataset?.id === datasetId) deselectDataset();
    await loadDatasets();
  }, [workspaceId, selectedDataset, deselectDataset, loadDatasets]);

  const handleImported = useCallback((dataset: CrowdDataset) => {
    setDatasets((prev) => [dataset, ...prev]);
    selectDataset(dataset);
  }, [selectDataset]);

  const handleSegmentSaved = useCallback(async () => {
    setShowSegmentBuilder(false);
    setEditingSegment(undefined);
    if (selectedDataset) {
      setSegments(await api.listCrowdSegments(workspaceId, selectedDataset.id));
    }
  }, [workspaceId, selectedDataset]);

  const handleProfileDocUpload = useCallback(async (file: File | undefined) => {
    if (!file || !selectedDataset || segments.length === 0) return;
    if (file.size > 512 * 1024) {
      window.alert("侧写文档超过 512KB，请精简后再上传。");
      return;
    }
    setUploadingProfileDoc(true);
    try {
      const persona = (await file.text()).trim();
      if (!persona) throw new Error("侧写文档为空");
      const segment = segments[0];
      if (!segment) throw new Error("请先创建分群");
      const name = file.name.replace(/\.[^.]+$/, "") || `${segment.name} 侧写`;
      const profile = await api.createCrowdProfile(workspaceId, {
        segmentId: segment.id,
        name,
        status: "draft",
      });
      const version = await api.createCrowdProfileVersion(workspaceId, profile.id, {
        source: "manual_edit",
        content: {
          persona,
          traits: [],
          motivations: [],
          decisionTriggers: [],
          objections: [],
          tone: "",
          contentPreference: [],
          riskNotes: ["用户上传侧写文档，未经过 LLM 生成。"],
          evidenceSummary: ["来源：用户上传的人群侧写文档。"],
        },
      });
      const updated = await api.updateCrowdProfile(workspaceId, profile.id, { currentVersionId: version.id });
      setProfiles((prev) => [updated, ...prev]);
      setViewingProfile(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "侧写文档上传失败");
    } finally {
      setUploadingProfileDoc(false);
    }
  }, [workspaceId, selectedDataset, segments]);

  const handleDownloadLlmAggregate = useCallback(async () => {
    if (!selectedDataset) return;
    const resp = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/crowd/datasets/${encodeURIComponent(selectedDataset.id)}/llm-aggregate.csv`,
    );
    if (!resp.ok) {
      window.alert("聚合结果下载失败");
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedDataset.name}-llm-aggregate.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [workspaceId, selectedDataset]);

  const handleProfileTemplateUpload = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) {
      window.alert("侧写提示词/模板超过 256KB，请精简后再上传。");
      return;
    }
    try {
      setProfileTemplate(await file.text());
      setProfileTemplateName(file.name);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "侧写提示词/模板读取失败");
    }
  }, []);

  const handleGenerateProfile = useCallback(async (segment: CrowdSegment) => {
    setGeneratingProfileSegmentId(segment.id);
    try {
      const result = await api.generateCrowdProfile(workspaceId, {
        segmentId: segment.id,
        model: DEFAULT_CROWD_PROFILE_MODEL,
        businessContext: "",
        ...(profileTemplate.trim() ? { profileTemplate: profileTemplate.trim() } : {}),
      });
      const updated = await api.getCrowdProfile(workspaceId, result.profile.id);
      setProfiles((prev) => {
        const exists = prev.some((profile) => profile.id === updated.id);
        return exists
          ? prev.map((profile) => (profile.id === updated.id ? updated : profile))
          : [updated, ...prev];
      });
      setViewingProfile(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "画像生成失败");
    } finally {
      setGeneratingProfileSegmentId(null);
    }
  }, [workspaceId, profileTemplate]);

  const overview = useMemo(() => ({
    datasetCount: datasets.length,
    segmentCount: segments.length,
    profileCount: profiles.length,
    publishedCount: profiles.filter((p) => p.publishedSubAgentTemplateId).length,
  }), [datasets, segments, profiles]);
  const selectedDatasetCanUseLlmAggregate = selectedDataset ? canUseLlmAggregate(selectedDataset) : false;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Zone 1: Overview Stats ── */}
      <div className="shrink-0 border-b bg-muted/30 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">the-crowd · 人群画像资产库</h2>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              {overview.datasetCount} 数据集
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {overview.segmentCount} 分群
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {overview.profileCount} 画像
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {overview.publishedCount} 已发布
            </span>
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <Shield className="h-3 w-3" />
              零原始行
            </span>
            <button
              onClick={() => setShowReadme((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-0.5 transition-colors",
                showReadme
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-input hover:bg-muted",
              )}
              title="使用说明"
            >
              <BookOpen className="h-3 w-3" />
              使用说明
            </button>
          </div>
        </div>
      </div>

      {/* ── Readme Drawer ── */}
      {showReadme && (
        <div className="shrink-0 max-h-[55%] overflow-auto border-b bg-neutral-50/60 dark:bg-neutral-950">
          <div className="mx-auto w-full max-w-4xl p-5">
            <div className="relative rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
              <button
                onClick={() => setShowReadme(false)}
                className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
              <Markdown>{readmeContent}</Markdown>
            </div>
          </div>
        </div>
      )}

      {/* ── Scrollable Content ── */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* ── Zone 2: Data Import ── */}
        <ZoneHeader
          icon={Database}
          title="数据导入"
          count={datasets.length}
          action={
            <button onClick={loadDatasets} disabled={loading} className="rounded-md p-1 hover:bg-muted text-muted-foreground">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          }
        />
        <DatasetImporter workspaceId={workspaceId} onImported={handleImported} />

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : datasets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-muted-foreground/25 p-8 text-center">
            <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">暂无数据集</p>
            <p className="text-xs text-muted-foreground/60 mt-1">拖拽 CSV/Excel 文件到上方区域开始导入</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {datasets.map((ds) => (
              <div
                key={ds.id}
                onClick={() => selectDataset(ds)}
                className={cn(
                  "flex items-center justify-between rounded-lg border p-2.5 cursor-pointer transition-colors",
                  selectedDataset?.id === ds.id
                    ? "border-primary/40 bg-primary/5"
                    : "bg-card hover:border-ring",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{ds.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatCount(ds.rowCount)} 行 · {ds.fieldCount} 字段 · {ds.source}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleDelete(ds.id); }}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Zones 3–6: Detail (only when dataset selected) ── */}
        {selectedDataset && (
          <>
            {/* Dataset context bar */}
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{selectedDataset.name}</span>
                <span className="text-muted-foreground text-xs">
                  {formatCount(selectedDataset.rowCount)} 行 · {selectedDataset.fieldCount} 字段
                </span>
              </div>
              <button onClick={deselectDataset} className="text-xs text-muted-foreground hover:text-foreground">
                返回列表
              </button>
            </div>

            {!selectedDataset.isAggregate && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                      <Shield className="h-3.5 w-3.5" />
                      聚合结果检查
                    </div>
                    <div className="text-muted-foreground">
                      {selectedDatasetCanUseLlmAggregate
                        ? "原始明细行不会传给 LLM。请先下载检查聚合 CSV，确认无误后再使用聚合结果生成画像。"
                        : "当前数据集是旧解析结果，不能传送 LLM。请重新上传包含「标签类型 / 标签 / 占比 / tgi」的明细文件。"}
                    </div>
                    <div className="text-muted-foreground/80">
                      标签类型 {selectedDataset.fieldProfiles.length} 个 · 聚合标签 {selectedDataset.fieldProfiles.reduce((sum, profile) => sum + profile.topValues.length, 0)} 条
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      ref={profileTemplateInputRef}
                      type="file"
                      accept=".txt,.md,.markdown"
                      className="hidden"
                      onChange={(event) => {
                        void handleProfileTemplateUpload(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      onClick={() => profileTemplateInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-background px-2.5 py-1.5 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                      title="上传人群侧写提示词或模板；生成时优先遵循模板"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      {profileTemplateName ? `模板：${profileTemplateName}` : "上传侧写模板"}
                    </button>
                    {profileTemplateName && (
                      <button
                        onClick={() => { setProfileTemplate(""); setProfileTemplateName(""); }}
                        className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-emerald-100 hover:text-foreground dark:hover:bg-emerald-950/40"
                      >
                        清除
                      </button>
                    )}
                    <button
                      onClick={() => void handleDownloadLlmAggregate()}
                      disabled={!selectedDatasetCanUseLlmAggregate}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-background px-2.5 py-1.5 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载聚合 CSV
                    </button>
                    {segments[0] && (
                      <button
                        onClick={() => void handleGenerateProfile(segments[0]!)}
                        disabled={!selectedDatasetCanUseLlmAggregate || generatingProfileSegmentId === segments[0]!.id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {generatingProfileSegmentId === segments[0]!.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        使用聚合结果生成画像
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Zone 3: Tag Dictionary ── */}
            <details className="group rounded-md border bg-card p-3">
              <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <Tags className="h-3.5 w-3.5" />
                <span>标签字典（高级，可选）</span>
                <span className="text-muted-foreground/60">({tagDict.length})</span>
              </summary>
              <div className="mt-3">
                <TagDictionaryEditor
                  workspaceId={workspaceId}
                  dataset={selectedDataset}
                  entries={tagDict}
                  onSaved={setTagDict}
                />
              </div>
            </details>

            {/* ── Zone 4: Segments ── */}
            <div className="space-y-2">
              <ZoneHeader
                icon={Users}
                title="人群分群"
                count={segments.length}
                action={
                  <button
                    onClick={() => { setShowSegmentBuilder(true); setEditingSegment(undefined); }}
                    className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3 w-3" /> 新建分群
                  </button>
                }
              />

              {showSegmentBuilder && (
                <div className="rounded-md border bg-card p-3">
                  <SegmentBuilder
                    workspaceId={workspaceId}
                    datasetId={selectedDataset.id}
                    fieldProfiles={selectedDataset.fieldProfiles}
                    rowCount={selectedDataset.rowCount}
                    existingSegment={editingSegment}
                    onSave={handleSegmentSaved}
                    onCancel={() => { setShowSegmentBuilder(false); setEditingSegment(undefined); }}
                  />
                </div>
              )}

              {segments.length === 0 && !showSegmentBuilder && (
                <div className="rounded-lg border border-dashed border-muted-foreground/25 py-6 text-center">
                  <Users className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">暂无分群，点击「新建分群」创建规则</p>
                </div>
              )}

              {segments.map((seg) => (
                <div key={seg.id} className="rounded-md border bg-card p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{seg.name}</span>
                      {seg.autoGenerated && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" title="自动生成，可手工补充提升画像质量">
                          auto
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditingSegment(seg); setShowSegmentBuilder(true); }}
                        className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        编辑
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm("确认删除此分群？")) return;
                          await api.deleteCrowdSegment(workspaceId, seg.id);
                          setSegments((prev) => prev.filter((s) => s.id !== seg.id));
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {seg.description && <div className="text-xs text-muted-foreground mb-1">{seg.description}</div>}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>样本: {formatCount(seg.sampleCount)}</span>
                    <span>覆盖率: {(seg.coverageRatio * 100).toFixed(1)}%</span>
                    <span>条件: {seg.rule.conditions.length} ({seg.rule.logic.toUpperCase()})</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Zone 5: Profiles + DLF Publish ── */}
            <div className="space-y-2">
              <ZoneHeader
                icon={User}
                title="画像侧写"
                count={profiles.length}
                action={segments.length > 0 ? (
                  <>
                    <input
                      ref={profileDocInputRef}
                      type="file"
                      accept=".txt,.md,.markdown"
                      className="hidden"
                      onChange={(event) => {
                        void handleProfileDocUpload(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      onClick={() => profileDocInputRef.current?.click()}
                      disabled={uploadingProfileDoc}
                      className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      title="直接上传已经写好的人群侧写文档，不调用 LLM"
                    >
                      {uploadingProfileDoc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      上传侧写文档
                    </button>
                  </>
                ) : undefined}
              />

              {viewingProfile ? (
                <ProfileViewer
                  workspaceId={workspaceId}
                  profile={viewingProfile}
                  onUpdated={(p) => {
                    setProfiles((prev) => prev.map((x) => (x.id === p.id ? p : x)));
                    setViewingProfile(p);
                  }}
                  onClose={() => setViewingProfile(null)}
                />
              ) : (
                <>
                  {profiles.length === 0 && (
                    <div className="rounded-lg border border-dashed border-muted-foreground/25 py-6 text-center">
                      <User className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">暂无画像，先创建分群再生成画像</p>
                    </div>
                  )}
                  {profiles.map((p) => {
                    const seg = segments.find((s) => s.id === p.segmentId);
                    return (
                      <div key={p.id} className="flex items-center justify-between rounded-md border bg-card p-2.5">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span className={cn(
                              "rounded px-1.5 py-0 text-[10px] font-medium",
                              p.status === "active" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                              p.status === "draft" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                              p.status === "archived" && "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
                            )}>
                              {p.status}
                            </span>
                            {seg && <span>分群: {seg.name}</span>}
                            {p.publishedSubAgentTemplateId && (
                              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                                <Sparkles className="h-3 w-3" />
                                已发布
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setViewingProfile(p)}
                          className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted transition-colors"
                        >
                          <Eye className="h-3 w-3" /> 查看
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
