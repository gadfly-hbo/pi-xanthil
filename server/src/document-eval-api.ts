import type { DocumentEvalCase } from "./types.ts";

// X-QEVAL0 契约：文档质量评测的 HTTP 签名（请求解析 + 响应 shape）。
// 路由接 routes/（由 D-QEVAL1/E-QEVAL2 落地），runner=document-evaluation-runner.ts（D-QEVAL1）。
// 本文件只定义契约与入参校验，不实现评测逻辑、不注册路由（不改现有业务代码）。

// POST /workspaces/:id/document-eval/run
export interface DocumentEvaluationRunRequest {
  cases: DocumentEvalCase[];
  model: string;
}

export interface DocumentEvaluationRunResponse {
  resultId: string;
}

// GET /workspaces/:id/document-eval/results/:resultId → DocumentEvalResult[]（见 types.ts）

export type ParsedDocumentEvaluationRunRequest =
  | { ok: true; value: DocumentEvaluationRunRequest }
  | { ok: false; error: string };

export function parseDocumentEvaluationRunRequest(body: unknown): ParsedDocumentEvaluationRunRequest {
  const raw = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  const cases = parseDocumentEvaluationCases(raw.cases);

  if (cases.length === 0) return { ok: false, error: "cases must not be empty" };
  if (!model) return { ok: false, error: "model required" };

  return { ok: true, value: { cases, model } };
}

export function parseDocumentEvaluationCases(value: unknown): DocumentEvalCase[] {
  if (!Array.isArray(value)) return [];
  const cases: DocumentEvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? `case_${index + 1}`).trim();
    if (!id || seen.has(id)) continue;
    const name = String(raw.name ?? id).trim() || id;
    const domain = typeof raw.domain === "string" && raw.domain.trim() ? raw.domain.trim() : "mall";
    const reportPath = typeof raw.reportPath === "string" ? raw.reportPath.trim() : "";
    if (!reportPath) continue;
    const rubrics = parseDocumentEvalRubrics(raw.rubrics);
    seen.add(id);
    cases.push({ id, name, domain, reportPath, rubrics });
  }
  return cases;
}

function parseDocumentEvalRubrics(value: unknown): DocumentEvalCase["rubrics"] {
  if (!Array.isArray(value)) return [];
  const rubrics: DocumentEvalCase["rubrics"] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const criterion = typeof raw.criterion === "string" ? raw.criterion.trim() : "";
    if (!criterion) continue;
    const weight = Number(raw.weight ?? 1);
    const anchors = typeof raw.anchors === "string" && raw.anchors.trim() ? raw.anchors.trim() : undefined;
    rubrics.push({
      criterion,
      weight: Number.isFinite(weight) ? weight : 1,
      ...(anchors ? { anchors } : {}),
    });
  }
  return rubrics;
}
