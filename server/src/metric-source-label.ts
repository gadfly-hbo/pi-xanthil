import type { EvidenceLevel, MetricSnapshot } from "./types.ts";

const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  A: "实测A",
  B: "衍生B",
  C: "引用C",
  D: "估计D",
};

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function evidenceLabel(snapshot: MetricSnapshot): string {
  return EVIDENCE_LABELS[snapshot.evidenceOverride ?? snapshot.evidenceLevel];
}

function sourceName(snapshot: MetricSnapshot): string {
  const ref = snapshot.sourceRef;
  if (ref?.kind === "extraction_tool") {
    const tool = clean(ref.toolName) ?? clean(ref.toolId) ?? "工具";
    const key = clean(ref.summaryKey);
    const id = clean(snapshot.metricId);
    const base = id ? `${id}(${key ?? tool})` : (key ? `${tool}/${key}` : tool);
    return base;
  }
  if (ref?.kind === "bi_aggregation") {
    const id = clean(snapshot.metricId) ?? clean(ref.metricId);
    const metric = id ?? clean(snapshot.name) ?? "指标";
    const window = clean(ref.window);
    return window ? `${metric}/${window}` : metric;
  }
  return snapshot.source === "extraction_tool" ? "工具产物" : "聚合计算";
}

export function renderSourceLabel(snapshot: MetricSnapshot): string {
  const period = snapshot.sourceRef?.kind === "extraction_tool"
    ? clean(snapshot.sourceRef.period) ?? clean(snapshot.period)
    : clean(snapshot.period);
  const periodText = period ? `·${period}` : "";
  return `[来源:${sourceName(snapshot)}${periodText}·${evidenceLabel(snapshot)}]`;
}
