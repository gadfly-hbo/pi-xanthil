import { useEffect, useState } from "react";
import { vizApi } from "@/lib/api/viz";
import { getHealthSelectedRunId } from "@/lib/health-ui-state";
import type { HealthFinding, OntologyGap, HealthRun } from "@/types";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-600 bg-red-50 border-red-200",
  warn: "text-amber-600 bg-amber-50 border-amber-200",
  info: "text-blue-600 bg-blue-50 border-blue-200",
};
const LIFECYCLE_LABEL: Record<string, string> = {
  new: "🆕 新发",
  recurring: "🔄 复现",
  worsening: "⬆️ 恶化",
  resolved: "✅ 已修复",
};

export function HealthReportPane({ workspaceId }: { workspaceId: string | null }) {
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [gaps, setGaps] = useState<OntologyGap[]>([]);
  const [runs, setRuns] = useState<HealthRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(getHealthSelectedRunId());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    // 跨 workspace 切换时重置：清旧 runId/findings/gaps，避免显示上一 ws 数据
    setFindings([]);
    setGaps([]);
    setSelectedRunId(null);
    let cancelled = false;
    vizApi.listHealthRuns(workspaceId).then((rs) => {
      if (cancelled) return; // 旧 ws 请求晚返回，丢弃
      setRuns(rs);
      const storeId = getHealthSelectedRunId();
      if (storeId && rs.some((r) => r.id === storeId)) {
        setSelectedRunId(storeId);
      } else if (rs.length > 0) {
        setSelectedRunId(rs[0]!.id);
      }
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !selectedRunId) return;
    let cancelled = false;
    setLoading(true);
    vizApi.listHealthFindings(workspaceId, selectedRunId)
      .then((r) => {
        if (cancelled) return; // 旧 run/ws 请求晚返回，丢弃
        setFindings(r.findings);
        setGaps(r.gaps);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, selectedRunId]);

  const problems = findings.filter((f) => f.kind === "问题");
  const risks = findings.filter((f) => f.kind === "风险");
  const byCategory = (items: HealthFinding[]) => {
    const m = new Map<string, HealthFinding[]>();
    for (const f of items) {
      const arr = m.get(f.category) ?? [];
      arr.push(f);
      m.set(f.category, arr);
    }
    return m;
  };

  const buildMarkdown = () => [
    `# 体检报告`,
    ``,
    `run: ${selectedRunId}  问题: ${problems.length}  风险: ${risks.length}`,
    ``,
    `## 问题 (${problems.length})`,
    ...problems.map((f) => `- **[${f.severity}]** ${f.title} (${LIFECYCLE_LABEL[f.lifecycle] ?? f.lifecycle})\n  - evidence: \`${JSON.stringify(f.evidence)}\`\n  - 建议: ${f.suggestion}`),
    ``,
    `## 风险 (${risks.length})`,
    ...risks.map((f) => `- **[${f.severity}]** ${f.title} (${LIFECYCLE_LABEL[f.lifecycle] ?? f.lifecycle})\n  - 建议: ${f.suggestion}`),
    ``,
    `## 本体缺口 (${gaps.length})`,
    ...gaps.map((g) => `- ${g.column}: ${g.reason}`),
  ].join("\n");

  const download = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = () => download(buildMarkdown(), `health-report-${selectedRunId}.md`, "text/markdown");

  const exportHtml = async () => {
    if (!workspaceId) return;
    try {
      const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/health/export-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: buildMarkdown() }),
      });
      if (!resp.ok) throw new Error(`export failed: ${resp.status}`);
      const { html } = await resp.json() as { html: string };
      download(html, `health-report-${selectedRunId}.html`, "text/html");
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">体检报告</h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedRunId ?? ""}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleString()} · {r.problemCount}问题/{r.riskCount}风险
              </option>
            ))}
          </select>
          <button onClick={exportMarkdown} disabled={!findings.length} className="text-sm px-3 py-1 border rounded hover:bg-neutral-50 disabled:opacity-40">
            导出 MD
          </button>
          <button onClick={exportHtml} disabled={!findings.length} className="text-sm px-3 py-1 border rounded hover:bg-neutral-50 disabled:opacity-40">
            导出 HTML
          </button>
        </div>
      </div>
      {loading && <p className="text-sm text-neutral-400">加载中…</p>}
      {!loading && findings.length === 0 && <p className="text-sm text-neutral-400">暂无报告，请先在体检台执行体检。</p>}
      {findings.length > 0 && (
        <>
          <div className="flex gap-4 text-sm">
            <span className="text-red-600 font-medium">🔴 问题 {problems.length}</span>
            <span className="text-amber-600 font-medium">🟡 风险 {risks.length}</span>
          </div>
          {(["问题", "风险"] as const).map((kind) => {
            const items = findings.filter((f) => f.kind === kind);
            if (items.length === 0) return null;
            const cats = byCategory(items);
            return (
              <div key={kind} className="space-y-3">
                <h3 className="font-medium text-sm">{kind === "问题" ? "🔴 问题" : "🟡 风险"}</h3>
                {Array.from(cats.entries()).map(([cat, fs]) => (
                  <div key={cat} className="space-y-2">
                    <p className="text-xs text-neutral-400">{cat}</p>
                    {fs.map((f) => (
                      <div key={f.id} className={`border rounded-lg p-3 ${SEVERITY_COLOR[f.severity] ?? ""}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{f.title}</span>
                          <span className="text-xs">{LIFECYCLE_LABEL[f.lifecycle]}</span>
                        </div>
                        <details className="mt-2 text-xs text-neutral-500">
                          <summary className="cursor-pointer">evidence</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(f.evidence, null, 2)}</pre>
                          {f.suggestion && <p className="mt-1">建议: {f.suggestion}</p>}
                        </details>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
          {gaps.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium text-sm">📋 本体缺口（驱动补本体）</h3>
              {gaps.map((g, i) => (
                <div key={i} className="text-xs text-neutral-500 border rounded p-2">
                  <span className="font-mono">{g.column}</span> — {g.reason}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
