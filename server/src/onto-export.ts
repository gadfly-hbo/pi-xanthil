/**
 * onto-xanthil 本体导出（P5）。
 * 对齐参考产品 nano-ontoprompt `services/export_service.py` 的 5 格式（JSON/YAML/CSV/Turtle/HTML），
 * 但**纯字符串构建、零新依赖**（不引 rdflib/pyyaml，符合「做轻」取向）。
 * 适配 onto 数据模型：objects(+properties) / links / 绑定 metrics（Logic/Action 待 P6 落地后并入）。
 */

import {
  getOntology, listObjectTypes, listProperties, listLinks, listMetrics,
  listLogicRules, listOntoActions,
} from "./db/viz.ts";
import type { Ontology, ObjectType, PropertyType, LinkType, MetricDefinition, LogicRule, OntoAction } from "./types.ts";

export type ExportFormat = "json" | "yaml" | "csv" | "html" | "ttl";

export interface ExportArtifact { filename: string; mime: string; content: string }

export interface CollectedData {
  ontology: Ontology;
  objects: Array<ObjectType & { properties: PropertyType[] }>;
  links: LinkType[];
  metrics: MetricDefinition[];
  logicRules: LogicRule[];
  actions: OntoAction[];
  nameById: Map<string, string>; // objectId/ruleId → 名称（解析 link 端点 / linked 引用）
}

function collect(oid: string): CollectedData | null {
  const ontology = getOntology(oid);
  if (!ontology) return null;
  const rawObjects = listObjectTypes(oid);
  const objects = rawObjects.map((o) => ({ ...o, properties: listProperties(o.id) }));
  const links = listLinks(oid);
  const objIds = new Set(rawObjects.map((o) => o.id));
  // metric 为 workspace 级语义层；本体导出仅纳入「绑定到本体内对象」的 metric，保证自洽
  const metrics = listMetrics(ontology.workspaceId).filter((m) => m.objectTypeId && objIds.has(m.objectTypeId));
  const logicRules = listLogicRules(oid);
  const actions = listOntoActions(oid);
  const nameById = new Map<string, string>(rawObjects.map((o) => [o.id, o.nameCn]));
  for (const r of logicRules) nameById.set(r.id, r.nameCn);
  return { ontology, objects, links, metrics, logicRules, actions, nameById };
}

// ─── JSON ──────────────────────────────────────────────────────────────
function toJson(d: CollectedData): string {
  return JSON.stringify({
    ontology: { id: d.ontology.id, name: d.ontology.name, domain: d.ontology.domain, version: d.ontology.version, status: d.ontology.status },
    objects: d.objects.map((o) => ({
      id: o.id, kind: o.kind, nameCn: o.nameCn, nameEn: o.nameEn, description: o.description,
      boundPathId: o.boundPathId, confidence: o.confidence,
      properties: o.properties.map((p) => ({ name: p.name, dataType: p.dataType, boundColumn: p.boundColumn, semanticType: p.semanticType, description: p.description })),
    })),
    links: d.links.map((l) => ({
      source: d.nameById.get(l.sourceObjectId) ?? l.sourceObjectId,
      target: d.nameById.get(l.targetObjectId) ?? l.targetObjectId,
      kind: l.kind, joinKeys: l.joinKeys, confidence: l.confidence,
    })),
    metrics: d.metrics.map((m) => ({ name: m.name, category: m.category, formula: m.formula, caliber: m.caliber, unit: m.unit, boundColumns: m.boundColumns, enabled: m.enabled })),
    logicRules: d.logicRules.map((r) => ({ nameCn: r.nameCn, nameEn: r.nameEn, formula: r.formula, description: r.description, linkedObjects: r.linkedObjectIds.map((id) => d.nameById.get(id) ?? id), confidence: r.confidence })),
    actions: d.actions.map((a) => ({ nameCn: a.nameCn, nameEn: a.nameEn, executionRule: a.executionRule, functionCode: a.functionCode, linkedObjects: a.linkedObjectIds.map((id) => d.nameById.get(id) ?? id), linkedLogic: a.linkedLogicIds.map((id) => d.nameById.get(id) ?? id), confidence: a.confidence })),
  }, null, 2);
}

// ─── YAML（极简发射器，仅覆盖导出结构：嵌套对象/数组/标量）──────────────
function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  // 含特殊字符或前后空白则加引号并转义
  if (s === "" || /[:#\-?&*!|>'"%@`{}\[\],\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}
function yamlEmit(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return " []\n";
    let out = "\n";
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        const block = yamlEmit(item, indent + 1).replace(/^\n/, "");
        // 把第一行的缩进改为 "- "
        const lines = block.split("\n").filter((l) => l.length);
        if (lines.length === 0) { out += `${pad}- {}\n`; continue; }
        out += `${pad}- ${lines[0]!.trimStart()}\n`;
        for (const l of lines.slice(1)) out += `${pad}  ${l.trimStart()}\n`;
      } else {
        out += `${pad}- ${yamlScalar(item)}\n`;
      }
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    let out = "\n";
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null && typeof v === "object") {
        out += `${pad}${k}:${yamlEmit(v, indent + 1)}`;
      } else {
        out += `${pad}${k}: ${yamlScalar(v)}\n`;
      }
    }
    return out;
  }
  return ` ${yamlScalar(value)}\n`;
}
function toYaml(d: CollectedData): string {
  const obj = JSON.parse(toJson(d));
  return yamlEmit(obj, 0).replace(/^\n/, "");
}

// ─── CSV ───────────────────────────────────────────────────────────────
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(d: CollectedData): string {
  const rows: string[] = [["kind", "name", "detail", "extra", "confidence"].join(",")];
  for (const o of d.objects) {
    rows.push([o.kind === "dataset" ? "object(dataset)" : "object(concept)", o.nameCn, o.description, o.boundPathId ?? "", o.confidence].map(csvField).join(","));
    for (const p of o.properties) {
      rows.push(["property", `${o.nameCn}.${p.name}`, p.dataType, p.semanticType ?? p.boundColumn ?? "", ""].map(csvField).join(","));
    }
  }
  for (const l of d.links) {
    const src = d.nameById.get(l.sourceObjectId) ?? l.sourceObjectId;
    const tgt = d.nameById.get(l.targetObjectId) ?? l.targetObjectId;
    rows.push(["link", `${src} → ${tgt}`, l.kind, (l.joinKeys ?? []).map((k) => `${k.source}=${k.target}`).join(";"), l.confidence].map(csvField).join(","));
  }
  for (const m of d.metrics) {
    rows.push(["metric", m.name, m.formula, m.unit, ""].map(csvField).join(","));
  }
  for (const r of d.logicRules) {
    rows.push(["logic_rule", r.nameCn, r.formula, r.linkedObjectIds.map((id) => d.nameById.get(id) ?? id).join(";"), r.confidence].map(csvField).join(","));
  }
  for (const a of d.actions) {
    rows.push(["action", a.nameCn, a.executionRule, a.linkedLogicIds.map((id) => d.nameById.get(id) ?? id).join(";"), a.confidence].map(csvField).join(","));
  }
  return rows.join("\n");
}

// ─── HTML ──────────────────────────────────────────────────────────────
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function toHtml(d: CollectedData): string {
  let rows = "";
  for (const o of d.objects) {
    rows += `<tr><td>对象·${esc(o.kind)}</td><td>${esc(o.nameCn)}</td><td>${esc(o.nameEn ?? "")}</td><td>${esc(o.description)}</td><td>${esc(o.confidence)}</td></tr>`;
    for (const p of o.properties) {
      rows += `<tr><td class="sub">属性</td><td>${esc(o.nameCn)}.${esc(p.name)}</td><td>${esc(p.dataType)}</td><td>${esc(p.semanticType ?? p.boundColumn ?? "")}</td><td></td></tr>`;
    }
  }
  for (const l of d.links) {
    const src = d.nameById.get(l.sourceObjectId) ?? l.sourceObjectId;
    const tgt = d.nameById.get(l.targetObjectId) ?? l.targetObjectId;
    rows += `<tr><td>关系</td><td>${esc(src)} → ${esc(tgt)}</td><td>${esc(l.kind)}</td><td>${esc((l.joinKeys ?? []).map((k) => `${k.source}=${k.target}`).join("; "))}</td><td>${esc(l.confidence)}</td></tr>`;
  }
  for (const m of d.metrics) {
    rows += `<tr><td>指标</td><td>${esc(m.name)}</td><td>${esc(m.formula)}</td><td>${esc(m.unit)}</td><td></td></tr>`;
  }
  for (const r of d.logicRules) {
    rows += `<tr><td>逻辑规则</td><td>${esc(r.nameCn)}</td><td>${esc(r.formula)}</td><td>${esc(r.linkedObjectIds.map((id) => d.nameById.get(id) ?? id).join("、"))}</td><td>${esc(r.confidence)}</td></tr>`;
  }
  for (const a of d.actions) {
    rows += `<tr><td>动作</td><td>${esc(a.nameCn)}</td><td>${esc(a.executionRule)}</td><td>${esc(a.linkedLogicIds.map((id) => d.nameById.get(id) ?? id).join("、"))}</td><td>${esc(a.confidence)}</td></tr>`;
  }
  const p = d.ontology;
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${esc(p.name)}</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;color:#1a1a1a}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #e2e2e2;padding:6px 10px;text-align:left}th{background:#f6f6f6}td.sub{color:#999}</style></head>
<body><h1>${esc(p.name)}</h1><p>领域：${esc(p.domain)} ｜ 版本：${esc(p.version)} ｜ 状态：${esc(p.status)}</p>
<table><thead><tr><th>类型</th><th>名称</th><th>类型/英文/公式</th><th>说明/语义/连接</th><th>置信度</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}

// ─── Turtle（极简 OWL，手写、零依赖；对齐 nano export_ttl 思路）────────────
const LINK_PRED: Record<string, string> = { "is-a": "rdfs:subClassOf", "part-of": "onto:partOf", "fk": "onto:foreignKey", "join": "onto:joinsWith", "related": "onto:relatedTo" };
function safeLocal(s: string): string {
  // 转为合法 Turtle local name：非字母数字下划线替为 _，首字符若为数字则前缀 _
  const cleaned = s.trim().replace(/[^\p{L}\p{N}_]/gu, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return /^\d/.test(cleaned) || cleaned === "" ? `_${cleaned || "x"}` : cleaned;
}
function ttlStr(s: string): string { return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`; }
function toTurtle(d: CollectedData): string {
  const lines: string[] = [
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    `@prefix onto: <http://onto-xanthil.local/ontologies/${safeLocal(d.ontology.id)}#> .`,
    "",
    `onto:${safeLocal(d.ontology.name)} a owl:Ontology ; rdfs:label ${ttlStr(d.ontology.name)} .`,
    "",
  ];
  const localById = new Map<string, string>();
  for (const o of d.objects) {
    const local = safeLocal(o.nameEn || o.nameCn);
    localById.set(o.id, local);
    const parts = [`onto:${local} a owl:Class`, `rdfs:label ${ttlStr(o.nameCn)}@zh`];
    if (o.nameEn) parts.push(`rdfs:label ${ttlStr(o.nameEn)}@en`);
    if (o.description) parts.push(`rdfs:comment ${ttlStr(o.description)}`);
    lines.push(parts.join(" ;\n    ") + " .");
    for (const p of o.properties) {
      lines.push(`onto:${local}_${safeLocal(p.name)} a owl:DatatypeProperty ;\n    rdfs:domain onto:${local} ;\n    rdfs:label ${ttlStr(p.name)} .`);
    }
  }
  for (const l of d.links) {
    const s = localById.get(l.sourceObjectId), t = localById.get(l.targetObjectId);
    if (!s || !t) continue;
    const pred = LINK_PRED[l.kind] ?? "onto:relatedTo";
    lines.push(`onto:${s} ${pred} onto:${t} .`);
  }
  return lines.join("\n") + "\n";
}

const FORMATTERS: Record<ExportFormat, { fn: (d: CollectedData) => string; mime: string; ext: string }> = {
  json: { fn: toJson, mime: "application/json", ext: "json" },
  yaml: { fn: toYaml, mime: "text/yaml", ext: "yaml" },
  csv: { fn: toCsv, mime: "text/csv", ext: "csv" },
  html: { fn: toHtml, mime: "text/html", ext: "html" },
  ttl: { fn: toTurtle, mime: "text/turtle", ext: "ttl" },
};

/** 纯渲染：CollectedData → 指定格式产物（脱离 db，可独立测试）。 */
export function renderOntology(data: CollectedData, format: ExportFormat): ExportArtifact | null {
  const fmt = FORMATTERS[format];
  if (!fmt) return null;
  const safeName = data.ontology.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "ontology";
  return { filename: `${safeName}.${fmt.ext}`, mime: fmt.mime, content: fmt.fn(data) };
}

export function exportOntology(oid: string, format: ExportFormat): ExportArtifact | null {
  const data = collect(oid);
  if (!data) return null;
  return renderOntology(data, format);
}
