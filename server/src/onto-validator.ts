/**
 * onto-xanthil 抽取结果质检（P4）。
 * 对齐参考产品 nano-ontoprompt 的 `PostHarnessValidator`（engine/post_harness/validator.py），
 * 移植其判定逻辑为 TS 并适配 onto 抽取形状（entities:{nameCn,...} / relations:{source,target,kind}）。
 *
 * nano 原 7 检查全部落地（P4 建 5 类，P7 补 ⑥⑦，对应 Logic/Action 层）：
 *   ① 结构  ② 字段  ③ 引用完整性  ④ 去重（原地改）  ⑤ kind 白名单
 *   ⑥ function_code 启发式（TS 侧无法 ast.parse Python，降级为非空/长度启发）
 *   ⑦ linked 语义引用完整性（logic.linkedEntities / action.linkedEntities / action.linkedLogic）
 */

export type Severity = "fatal" | "error" | "warning" | "info";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  location?: Record<string, unknown>;
}

export interface ValidationReport {
  hasFatal: boolean;
  hasErrors: boolean;
  totalIssues: number;
  issues: ValidationIssue[];
}

// 抽取归一化后的待校验形状（与 onto-extract.ts 的 Raw* 结构兼容）
export interface ValidatableEntity { nameCn?: string; nameEn?: string; description?: string; confidence?: number }
export interface ValidatableRelation { source?: string; target?: string; kind?: string }
export interface ValidatableLogic { nameCn?: string; formula?: string; linkedEntities?: string[] }
export interface ValidatableAction { nameCn?: string; functionCode?: string; linkedEntities?: string[]; linkedLogic?: string[] }
export interface ValidatableData {
  entities: ValidatableEntity[];
  relations: ValidatableRelation[];
  logicRules?: ValidatableLogic[]; // P7：可选，缺省则不校验逻辑/动作层
  actions?: ValidatableAction[];
}

// onto 关系合法 kind（= onto-extract DOC_LINK_KINDS；保持单一真源由调用方传入，默认与之一致）
const DEFAULT_ALLOWED_KINDS = ["is-a", "part-of", "related"];

function makeReport(): { issues: ValidationIssue[]; add: (s: Severity, code: string, message: string, location?: Record<string, unknown>) => void } {
  const issues: ValidationIssue[] = [];
  return {
    issues,
    add: (severity, code, message, location) => { issues.push({ severity, code, message, location }); },
  };
}

// 子串包含模糊匹配（与 onto-extract resolveId 一致口径）：抽取落库会模糊解析，故引用检查须同口径，避免误报
function fuzzyMatches(name: string, pool: Set<string>): boolean {
  if (pool.has(name)) return true;
  for (const n of pool) { if (n.includes(name) || name.includes(n)) return true; }
  return false;
}

/**
 * 校验抽取结果，**就地去重**（mutate data.entities / data.relations），返回分级报告。
 * 仅 `hasFatal` 阻断落库（沿用既有门禁语义）；error/warning/info 仅上报。
 */
export function validateExtraction(
  data: ValidatableData,
  allowedKinds: string[] = DEFAULT_ALLOWED_KINDS,
): ValidationReport {
  const r = makeReport();

  // ── ① 结构 ──────────────────────────────────────────────
  if (!Array.isArray(data.entities)) {
    r.add("fatal", "MISSING_ENTITIES", "缺少 entities 字段或类型错误（应为数组）");
    return finalize(r.issues);
  }
  if (data.entities.length === 0) {
    r.add("fatal", "EMPTY_ENTITIES", "未抽取到任何实体，请检查文档内容或模型");
    return finalize(r.issues);
  }
  if (!Array.isArray(data.relations)) {
    r.add("error", "INVALID_RELATIONS", "relations 字段类型错误，应为数组");
    data.relations = [];
  }

  // ── ② 字段 ──────────────────────────────────────────────
  data.entities.forEach((e, i) => {
    const name = e.nameCn || `#${i}`;
    if (!e.nameCn) r.add("error", "ENTITY_MISSING_NAME", `实体 #${i} 缺少 nameCn`, { index: i });
    if (!(e.description || "").trim()) {
      r.add("warning", "ENTITY_MISSING_DESC", `实体「${name}」缺少描述，置信度已下调`, { name });
    }
  });
  data.relations.forEach((rel, i) => {
    if (!rel.source || !rel.target) {
      r.add("error", "RELATION_MISSING_ENDPOINT", `关系 #${i} 缺少 source/target`, { index: i });
    }
    if (!rel.kind) {
      r.add("warning", "RELATION_MISSING_KIND", `关系 #${i} 缺少 kind，将默认 related`, { index: i });
    }
  });

  // ── ③ 引用完整性（同 onto 落库口径用模糊匹配，真悬空才告警）──
  const names = new Set(data.entities.map((e) => e.nameCn).filter((n): n is string => !!n));
  data.relations.forEach((rel, i) => {
    if (!rel.source || !rel.target) return;
    const srcOk = fuzzyMatches(rel.source, names);
    const tgtOk = fuzzyMatches(rel.target, names);
    if (!srcOk || !tgtOk) {
      const miss = !srcOk ? rel.source : rel.target;
      r.add("warning", "DANGLING_RELATION", `关系「${rel.source}→${rel.target}」端点「${miss}」未匹配到实体，将跳过`, { index: i, missing: miss });
    }
  });

  // ── ④ 去重（就地改 data，落库前先收敛）──
  const seenEnt = new Set<string>();
  const dedupEnt: ValidatableEntity[] = [];
  for (const e of data.entities) {
    const key = e.nameCn ?? "";
    if (key && seenEnt.has(key)) {
      r.add("warning", "ENTITY_DUPLICATE", `实体「${key}」重复，自动保留第一条`, { nameCn: key });
    } else {
      if (key) seenEnt.add(key);
      dedupEnt.push(e);
    }
  }
  data.entities = dedupEnt;

  const seenRel = new Set<string>();
  const dedupRel: ValidatableRelation[] = [];
  for (const rel of data.relations) {
    const key = `${rel.source}|${rel.kind ?? "related"}|${rel.target}`;
    if (seenRel.has(key)) {
      r.add("warning", "RELATION_DUPLICATE", `关系 (${rel.source})-[${rel.kind ?? "related"}]→(${rel.target}) 重复，自动去重`);
    } else {
      seenRel.add(key);
      dedupRel.push(rel);
    }
  }
  data.relations = dedupRel;

  // ── ⑤ kind 白名单（onto 版「type 白名单」）──
  for (const rel of data.relations) {
    if (rel.kind && !allowedKinds.includes(rel.kind)) {
      r.add("info", "UNKNOWN_LINK_KIND", `关系 kind「${rel.kind}」不在预设（${allowedKinds.join("/")}），将归一为 related`, { kind: rel.kind });
    }
  }

  // ── ⑥ function_code 启发式 + 逻辑/动作字段（P7）──
  const entityNames = names; // 复用已构建的实体名集合
  const logicNames = new Set((data.logicRules ?? []).map((l) => l.nameCn).filter((n): n is string => !!n));
  (data.logicRules ?? []).forEach((l, i) => {
    if (!l.nameCn) r.add("error", "LOGIC_MISSING_NAME", `逻辑规则 #${i} 缺少 nameCn`, { index: i });
    if (!l.linkedEntities || l.linkedEntities.length === 0) {
      r.add("warning", "LOGIC_NO_LINKED", `逻辑规则「${l.nameCn ?? `#${i}`}」未关联任何对象，双向关联将缺失`, { index: i });
    }
  });
  (data.actions ?? []).forEach((a, i) => {
    const name = a.nameCn ?? `#${i}`;
    if (!a.nameCn) r.add("error", "ACTION_MISSING_NAME", `动作 #${i} 缺少 nameCn`, { index: i });
    const code = (a.functionCode ?? "").trim();
    if (!code) r.add("warning", "ACTION_NO_CODE", `动作「${name}」缺少 function_code`, { index: i });
    else if (code.length < 20) r.add("warning", "ACTION_CODE_TOO_SHORT", `动作「${name}」的 function_code 过短，疑似无效（无法 ast 解析 Python，启发式判定）`, { index: i });
    if ((!a.linkedLogic || a.linkedLogic.length === 0)) {
      r.add("warning", "ACTION_NO_LOGIC_LINK", `动作「${name}」未关联任何逻辑规则`, { index: i });
    }
  });

  // ── ⑦ linked 语义引用完整性 ──
  for (const l of data.logicRules ?? []) {
    for (const en of l.linkedEntities ?? []) {
      if (en && !fuzzyMatches(en, entityNames)) {
        r.add("warning", "LOGIC_BROKEN_ENTITY_REF", `逻辑规则「${l.nameCn ?? "?"}」关联对象「${en}」不存在于实体`, { missing: en });
      }
    }
  }
  for (const a of data.actions ?? []) {
    for (const en of a.linkedEntities ?? []) {
      if (en && !fuzzyMatches(en, entityNames)) {
        r.add("warning", "ACTION_BROKEN_ENTITY_REF", `动作「${a.nameCn ?? "?"}」关联对象「${en}」不存在于实体`, { missing: en });
      }
    }
    for (const ln of a.linkedLogic ?? []) {
      if (ln && !logicNames.has(ln)) {
        r.add("warning", "ACTION_BROKEN_LOGIC_REF", `动作「${a.nameCn ?? "?"}」关联逻辑「${ln}」不存在于逻辑规则`, { missing: ln });
      }
    }
  }

  return finalize(r.issues);
}

function finalize(issues: ValidationIssue[]): ValidationReport {
  return {
    hasFatal: issues.some((i) => i.severity === "fatal"),
    hasErrors: issues.some((i) => i.severity === "error"),
    totalIssues: issues.length,
    issues,
  };
}
