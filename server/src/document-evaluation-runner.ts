import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { safeResolve } from "./flow-fs.ts";
import { FOLDER_DIRS } from "./workspace-dirs.ts";
import { runJudge } from "./evaluation-common.ts";
import type {
  DocumentEvalCase,
  DocumentEvalResult,
  DocumentEvalRuleResult,
} from "./types.ts";

// D-QEVAL1: 文档质量评测 runner（X-QEVAL0 契约落地）。
//
// 设计原则：
// 1. 规则引擎数据驱动 —— RulePack(domain -> RuleSpec[]) 通过 8 个原语 kind 描述任意规则；
//    用户可经 ruleConfigs 注入，或 <workspaceRoot>/.pi/document-eval-rules/<domain>.json
//    全量覆盖。默认 pack(mall / return_profile) 按 prompt 语义实现 R01-R15，非 1:1 移植
//    eval_plugin/doc_eval.py（源文件不在仓库，首版关键词包待用户后续校准）。
// 2. LLM judge 复用 evaluation-common.runJudge，每个 criterion 跑 3 次取分数中位数。
// 3. 文档过长（> sampleThreshold）做前/中/后段 3 段抽样拼接送 judge。
// 4. combined_score = 0.6 * ruleTotalScore + 0.4 * judgeScore（均 0..100）。
// 5. consistencyAlerts: 同名 rule ⇄ rubric criterion 偏差 ≥ 35 分时告警。
// 6. 红线：仅读 reportPath 指向 md 文件；零新表、不落库；不读 draw_data。

export type RuleKind =
  | "section-coverage"
  | "subsection-coverage"
  | "keyword-presence"
  | "keyword-hit-ratio"
  | "list-coverage"
  | "numeric-consistency"
  | "derivation-chain"
  | "freshness";

export interface RuleSpec {
  name: string;
  kind: RuleKind;
  params: Record<string, unknown>;
  /** rule 通过阈值（0..1）。默认 0.6 */
  passThreshold?: number;
}

export interface RulePack {
  domain: string;
  rules: RuleSpec[];
}

export type JudgeFn = (params: {
  judgeDir: string;
  workspaceId: string;
  resultId: string;
  task: string;
  rubric: string;
  output: string;
  model: string;
}) => Promise<{ score: number | null; details: string }>;

export interface DocumentEvaluationRunnerOptions {
  workspaceRoot: string;
  workspaceId: string;
  evaluationId: string;
  model: string;
  cases: DocumentEvalCase[];
  /** 注入的 rule pack 覆盖（domain -> pack），优先级最高 */
  ruleConfigs?: Record<string, RulePack>;
  /** judge 重复次数（默认 3 次取中位数）；测试时可设 1 */
  judgeRepeat?: number;
  /** judge 替身（测试用） */
  judgeFn?: JudgeFn;
  /** 文档抽样触发阈值（默认 10000） */
  sampleThreshold?: number;
  /** 单段抽样长度（默认 3200） */
  sampleSize?: number;
  /** 文档加载替身（测试用） */
  loadDocument?: (reportPath: string) => string;
  /** 规则覆盖文件查找根；默认 workspaceRoot */
  rulesOverrideRoot?: string;
}

// ========== Default rule packs (语义实现 R01-R15) ==========

const MALL_CORE_SECTIONS = ["核心客群", "次核心客群", "潜力客群"];
const CURRENT_YEAR = new Date().getFullYear();

const DEFAULT_MALL_PACK: RulePack = {
  domain: "mall",
  rules: [
    { name: "R01_structure", kind: "section-coverage", params: { sections: ["核心客群", "次核心客群", "潜力客群", "弱相关", "商圈", "竞品", "策略"], threshold: 0.8 } },
    { name: "R02_subsection", kind: "subsection-coverage", params: { sections: MALL_CORE_SECTIONS, subsections: ["画像", "消费偏好", "触达"], threshold: 0.7 } },
    { name: "R03_evidence_discipline", kind: "keyword-presence", params: { keywords: ["官方", "已验证", "推断", "样本", "抽样", "权威", "公开", "内部数据", "调研"], min: 3 } },
    { name: "R04_estimation_source", kind: "keyword-hit-ratio", params: { antecedent: ["推断", "估计", "预计", "约", "大约", "保守估计"], antecedentRequiresNumber: true, consequent: ["来源", "参考", "引用", "根据", "依据", "数据来自"], threshold: 0.3 } },
    { name: "R05_conflict_disclosure", kind: "keyword-presence", params: { keywords: ["不一致", "冲突", "差异", "口径不同", "存在偏差", "数据分歧"], min: 1 } },
    { name: "R06_competitor_analysis", kind: "keyword-presence", params: { keywords: ["竞品", "竞争对手", "对比", "横向比较", "对标"], min: 2 } },
    { name: "R07_audience_layering", kind: "section-coverage", params: { sections: ["核心客群", "次核心客群", "潜力客群", "弱相关"], threshold: 1.0 } },
    { name: "R08_persona_depth", kind: "list-coverage", params: { dimensions: ["年龄", "职业", "收入", "消费", "兴趣", "生活方式", "家庭"], min: 3 } },
    { name: "R09_strategy_executability", kind: "keyword-presence", params: { keywords: ["数据", "可测", "KPI", "指标", "分群", "差异化", "实施", "路径", "优先级", "落地"], min: 4 } },
    { name: "R10_time_period", kind: "keyword-presence", params: { keywords: ["工作日", "周末", "夜间", "晚间", "高峰", "时段", "午间", "早高峰", "晚高峰"], min: 3 } },
    { name: "R11_freshness", kind: "freshness", params: { freshYear: CURRENT_YEAR - 2, oldYearMax: CURRENT_YEAR - 5, oldShareThreshold: 0.5 } },
    { name: "R12_quantitative_support", kind: "keyword-hit-ratio", params: { antecedent: ["说明", "表明", "意味着", "代表", "反映", "体现", "证明"], antecedentRequiresNumber: false, consequent: ["%", "亿", "万", "千"], consequentRegex: "[0-9]+(?:\\.[0-9]+)?", threshold: 0.5 } },
    { name: "R13_derivation_chain", kind: "derivation-chain", params: { sections: MALL_CORE_SECTIONS, summaryKeywords: ["综上", "小结", "总结", "因此", "由此", "可见", "结论"], minTailChars: 80 } },
    { name: "R14_numeric_consistency", kind: "numeric-consistency", params: { keywords: ["停车位", "建筑面积", "投资金额", "总面积", "总投资", "营业面积"] } },
    { name: "R15_strategy_specificity", kind: "keyword-presence", params: { keywords: ["Q1", "Q2", "Q3", "Q4", "短期", "中期", "长期", "责任人", "负责人", "owner", "KPI", "指标", "优先级", "P0", "P1", "洞察"], min: 5 } },
  ],
};

const DEFAULT_RETURN_PROFILE_PACK: RulePack = {
  domain: "return_profile",
  rules: [
    { name: "R01_structure", kind: "section-coverage", params: { sections: ["退货画像", "退货原因", "退货客群", "策略"], threshold: 0.8 } },
    { name: "R03_evidence_discipline", kind: "keyword-presence", params: { keywords: ["官方", "已验证", "推断", "样本", "抽样", "数据来源"], min: 2 } },
    { name: "R04_estimation_source", kind: "keyword-hit-ratio", params: { antecedent: ["推断", "估计", "预计", "约", "大约"], antecedentRequiresNumber: true, consequent: ["来源", "参考", "引用", "根据", "依据"], threshold: 0.3 } },
    { name: "R09_strategy_executability", kind: "keyword-presence", params: { keywords: ["KPI", "指标", "实施", "路径", "优先级", "落地", "可测"], min: 3 } },
    { name: "R12_quantitative_support", kind: "keyword-hit-ratio", params: { antecedent: ["说明", "表明", "意味着", "反映"], consequent: ["%"], consequentRegex: "[0-9]+(?:\\.[0-9]+)?", threshold: 0.5 } },
    { name: "R14_numeric_consistency", kind: "numeric-consistency", params: { keywords: ["退货率", "退款金额", "客单价"] } },
  ],
};

const DEFAULT_PACKS: Record<string, RulePack> = {
  mall: DEFAULT_MALL_PACK,
  return_profile: DEFAULT_RETURN_PROFILE_PACK,
};

// 暴露给测试/UI 兜底展示
export function getDefaultRulePack(domain: string): RulePack | undefined {
  return DEFAULT_PACKS[domain];
}

// ========== Public entry ==========

export async function runDocumentEvaluation(
  options: DocumentEvaluationRunnerOptions,
): Promise<DocumentEvalResult[]> {
  if (!options.model.trim()) throw new Error("model required");
  if (!options.cases.length) throw new Error("cases required");

  const results: DocumentEvalResult[] = [];
  for (const c of options.cases) {
    results.push(await evaluateCase(c, options));
  }
  return results;
}

async function evaluateCase(
  c: DocumentEvalCase,
  options: DocumentEvaluationRunnerOptions,
): Promise<DocumentEvalResult> {
  const text = loadReportText(c.reportPath, options);
  const pack = resolveRulePack(c.domain, options);
  const ruleResults = pack.rules.map((spec) => evaluateRule(spec, text));
  const ruleTotalScore = aggregateRuleScore(ruleResults);

  const { judgeScore, judgeDetails } = await evaluateJudge(c, text, options);
  const consistencyAlerts = detectConsistencyAlerts(ruleResults, judgeDetails);
  const combinedScore = round1(0.6 * ruleTotalScore + 0.4 * judgeScore);

  return {
    caseId: c.id,
    ruleResults,
    ruleTotalScore,
    judgeScore,
    judgeDetails,
    combinedScore,
    consistencyAlerts,
  };
}

// ========== Document loading ==========

function loadReportText(reportPath: string, options: DocumentEvaluationRunnerOptions): string {
  if (options.loadDocument) return options.loadDocument(reportPath);
  // 红线·路径穿越守护：绝对/相对统一经 resolve 归一化（吃掉 .. 段），再用 relative 判定是否真在
  // workspaceRoot 内——不可用裸 startsWith（"/ws" 会误放行 "/ws-evil"，且 "/ws/../etc" 字符串也 startsWith）。
  const abs = resolve(options.workspaceRoot, reportPath);
  const rel = relative(options.workspaceRoot, abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("reportPath escapes workspaceRoot");
  }
  // 兜底红线：禁止指向 draw_data 原始目录（010_raw），防把原始明细喂给 judge LLM。
  if (rel.split(sep).includes(FOLDER_DIRS.draw_data)) {
    throw new Error("reportPath points into draw_data (forbidden)");
  }
  if (!existsSync(abs)) throw new Error(`report not found: ${reportPath}`);
  return readFileSync(abs, "utf-8");
}

// ========== Rule pack resolution ==========
// 优先级：options.ruleConfigs > <workspaceRoot>/.pi/document-eval-rules/<domain>.json > 默认 pack
//        缺省 domain 兜底 mall。

function resolveRulePack(domain: string, options: DocumentEvaluationRunnerOptions): RulePack {
  if (options.ruleConfigs && options.ruleConfigs[domain]) {
    return normalizeRulePack(options.ruleConfigs[domain], domain);
  }
  const overrideRoot = options.rulesOverrideRoot ?? options.workspaceRoot;
  try {
    const overridePath = safeResolve(overrideRoot, `.pi/document-eval-rules/${domain}.json`);
    if (existsSync(overridePath)) {
      const raw = readFileSync(overridePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return normalizeRulePack(parsed, domain);
    }
  } catch {
    // 覆盖文件解析失败回退默认 pack，不抛错（避免一份坏 json 阻断整批评估）
  }
  return DEFAULT_PACKS[domain] ?? DEFAULT_MALL_PACK;
}

function normalizeRulePack(input: unknown, domain: string): RulePack {
  if (typeof input !== "object" || input === null) return DEFAULT_PACKS[domain] ?? DEFAULT_MALL_PACK;
  const raw = input as Record<string, unknown>;
  const rulesRaw = Array.isArray(raw.rules) ? raw.rules : [];
  const rules: RuleSpec[] = [];
  for (const item of rulesRaw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const kind = typeof r.kind === "string" ? r.kind.trim() as RuleKind : "";
    if (!name || !kind) continue;
    if (!isKnownRuleKind(kind)) continue;
    const params = typeof r.params === "object" && r.params !== null ? r.params as Record<string, unknown> : {};
    const passThreshold = typeof r.passThreshold === "number" ? clamp01(r.passThreshold) : undefined;
    rules.push({ name, kind, params, ...(passThreshold !== undefined ? { passThreshold } : {}) });
  }
  return { domain, rules };
}

function isKnownRuleKind(kind: string): kind is RuleKind {
  return (
    kind === "section-coverage" ||
    kind === "subsection-coverage" ||
    kind === "keyword-presence" ||
    kind === "keyword-hit-ratio" ||
    kind === "list-coverage" ||
    kind === "numeric-consistency" ||
    kind === "derivation-chain" ||
    kind === "freshness"
  );
}

// ========== Rule evaluation ==========

export function evaluateRule(spec: RuleSpec, text: string): DocumentEvalRuleResult {
  const passThreshold = spec.passThreshold ?? 0.6;
  try {
    const { score, detail } = dispatchRule(spec, text);
    const normalized = clamp01(score);
    return {
      ruleName: spec.name,
      passed: normalized >= passThreshold,
      score: round3(normalized),
      detail,
    };
  } catch (err) {
    return {
      ruleName: spec.name,
      passed: false,
      score: 0,
      detail: `rule_error: ${(err as Error).message}`,
    };
  }
}

function dispatchRule(spec: RuleSpec, text: string): { score: number; detail: string } {
  switch (spec.kind) {
    case "section-coverage":
      return ruleSectionCoverage(spec, text);
    case "subsection-coverage":
      return ruleSubsectionCoverage(spec, text);
    case "keyword-presence":
      return ruleKeywordPresence(spec, text);
    case "keyword-hit-ratio":
      return ruleKeywordHitRatio(spec, text);
    case "list-coverage":
      return ruleListCoverage(spec, text);
    case "numeric-consistency":
      return ruleNumericConsistency(spec, text);
    case "derivation-chain":
      return ruleDerivationChain(spec, text);
    case "freshness":
      return ruleFreshness(spec, text);
    default:
      return { score: 0, detail: `unknown rule kind: ${(spec as RuleSpec).kind}` };
  }
}

// --- section-coverage: 命中章节比例 / 阈值 (clamp 1) ---
function ruleSectionCoverage(spec: RuleSpec, text: string): { score: number; detail: string } {
  const sections = readStringArray(spec.params.sections);
  const threshold = readNumber(spec.params.threshold, 0.8);
  if (!sections.length) return { score: 0, detail: "no sections configured" };
  const hits = sections.filter((s) => text.includes(s));
  const coverage = hits.length / sections.length;
  const score = threshold > 0 ? Math.min(1, coverage / threshold) : coverage;
  return { score, detail: `命中 ${hits.length}/${sections.length} 节：${hits.join("、") || "无"}` };
}

// --- subsection-coverage: 每个 section heading 之后切片，统计 subsection 关键词命中率 ---
function ruleSubsectionCoverage(spec: RuleSpec, text: string): { score: number; detail: string } {
  const sections = readStringArray(spec.params.sections);
  const subsections = readStringArray(spec.params.subsections);
  const threshold = readNumber(spec.params.threshold, 0.7);
  if (!sections.length || !subsections.length) return { score: 0, detail: "no sections / subsections" };
  let totalHits = 0;
  const expected = sections.length * subsections.length;
  const perSection: string[] = [];
  for (const s of sections) {
    const slice = sliceFromSection(text, s);
    const hitNames: string[] = [];
    for (const sub of subsections) {
      if (slice.includes(sub)) { totalHits += 1; hitNames.push(sub); }
    }
    perSection.push(`${s}(${hitNames.length}/${subsections.length})`);
  }
  const coverage = expected > 0 ? totalHits / expected : 0;
  const score = threshold > 0 ? Math.min(1, coverage / threshold) : coverage;
  return { score, detail: `子节命中 ${totalHits}/${expected}：${perSection.join(" / ")}` };
}

// --- keyword-presence: 命中关键词数 ≥ min ---
function ruleKeywordPresence(spec: RuleSpec, text: string): { score: number; detail: string } {
  const keywords = readStringArray(spec.params.keywords);
  const min = readNumber(spec.params.min, 1);
  if (!keywords.length) return { score: 0, detail: "no keywords" };
  const hits = keywords.filter((k) => text.includes(k));
  const score = min > 0 ? Math.min(1, hits.length / min) : (hits.length > 0 ? 1 : 0);
  return { score, detail: `命中 ${hits.length} 个（要求 ≥${min}）：${hits.slice(0, 12).join("、") || "无"}` };
}

// --- keyword-hit-ratio: antecedent 句中含 consequent 的比率 ≥ threshold ---
function ruleKeywordHitRatio(spec: RuleSpec, text: string): { score: number; detail: string } {
  const antecedent = readStringArray(spec.params.antecedent);
  const consequent = readStringArray(spec.params.consequent);
  const consequentRegex = typeof spec.params.consequentRegex === "string" ? new RegExp(spec.params.consequentRegex) : null;
  const requiresNumber = spec.params.antecedentRequiresNumber === true;
  const threshold = readNumber(spec.params.threshold, 0.3);
  if (!antecedent.length) return { score: 0, detail: "no antecedent" };
  const sentences = splitSentences(text);
  const matchAntecedent = sentences.filter((s) => antecedent.some((k) => s.includes(k)) && (!requiresNumber || /\d/.test(s)));
  if (!matchAntecedent.length) return { score: 1, detail: "无 antecedent 句（vacuous pass）" };
  const matchBoth = matchAntecedent.filter((s) =>
    consequent.some((k) => s.includes(k)) || (consequentRegex !== null && consequentRegex.test(s)),
  );
  const ratio = matchBoth.length / matchAntecedent.length;
  const score = threshold > 0 ? Math.min(1, ratio / threshold) : ratio;
  return { score, detail: `${matchBoth.length}/${matchAntecedent.length} 句满足（要求比率 ≥${threshold}）` };
}

// --- list-coverage: 描述维度命中数 ≥ min ---
function ruleListCoverage(spec: RuleSpec, text: string): { score: number; detail: string } {
  const dimensions = readStringArray(spec.params.dimensions);
  const min = readNumber(spec.params.min, 3);
  if (!dimensions.length) return { score: 0, detail: "no dimensions" };
  const hits = dimensions.filter((d) => text.includes(d));
  const score = min > 0 ? Math.min(1, hits.length / min) : (hits.length > 0 ? 1 : 0);
  return { score, detail: `维度命中 ${hits.length}/${dimensions.length}（要求 ≥${min}）：${hits.join("、") || "无"}` };
}

// --- numeric-consistency: 关键数字在全文中只出现一种数值 ---
function ruleNumericConsistency(spec: RuleSpec, text: string): { score: number; detail: string } {
  const keywords = readStringArray(spec.params.keywords);
  if (!keywords.length) return { score: 0, detail: "no keywords" };
  const conflicts: string[] = [];
  const seen: string[] = [];
  for (const kw of keywords) {
    const re = new RegExp(`${escapeRegExp(kw)}[^\\n]{0,20}?(\\d+(?:\\.\\d+)?)`, "g");
    const values = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const v = m[1];
      if (typeof v === "string") values.add(v);
    }
    if (values.size > 1) conflicts.push(`${kw}=[${[...values].join(",")}]`);
    else if (values.size === 1) seen.push(kw);
  }
  if (!seen.length && !conflicts.length) return { score: 1, detail: "无关键数字命中（vacuous pass）" };
  const total = seen.length + conflicts.length;
  const score = total > 0 ? seen.length / total : 1;
  return { score, detail: conflicts.length ? `冲突：${conflicts.join("；")}` : `一致：${seen.join("、")}` };
}

// --- derivation-chain: 核心章节尾部含小结/推导词 + 最少字符数 ---
function ruleDerivationChain(spec: RuleSpec, text: string): { score: number; detail: string } {
  const sections = readStringArray(spec.params.sections);
  const summaryKeywords = readStringArray(spec.params.summaryKeywords);
  const minTailChars = readNumber(spec.params.minTailChars, 80);
  if (!sections.length) return { score: 0, detail: "no sections" };
  let pass = 0;
  const detail: string[] = [];
  for (const s of sections) {
    const slice = sliceFromSection(text, s);
    if (!slice) { detail.push(`${s}:缺`); continue; }
    const tail = slice.slice(-Math.max(minTailChars * 2, 200));
    const hasSummary = summaryKeywords.some((k) => tail.includes(k));
    const enoughLen = slice.length >= minTailChars;
    if (hasSummary && enoughLen) { pass += 1; detail.push(`${s}:✓`); }
    else { detail.push(`${s}:${hasSummary ? "" : "无小结词 "}${enoughLen ? "" : "正文过短"}`.trim()); }
  }
  const score = sections.length > 0 ? pass / sections.length : 0;
  return { score, detail: `${pass}/${sections.length} 章节具备推导链：${detail.join(" / ")}` };
}

// --- freshness: 最新年份足够新 & 过旧年份占比 < 阈值 ---
function ruleFreshness(spec: RuleSpec, text: string): { score: number; detail: string } {
  const freshYear = readNumber(spec.params.freshYear, CURRENT_YEAR - 2);
  const oldYearMax = readNumber(spec.params.oldYearMax, CURRENT_YEAR - 5);
  const oldShareThreshold = readNumber(spec.params.oldShareThreshold, 0.5);
  const years = [...text.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));
  if (!years.length) return { score: 0, detail: "无可识别年份" };
  const maxYear = Math.max(...years);
  const oldCount = years.filter((y) => y <= oldYearMax).length;
  const oldShare = oldCount / years.length;
  const hasFresh = maxYear >= freshYear;
  const tooOld = oldShare >= oldShareThreshold;
  let score = 1;
  if (!hasFresh) score -= 0.5;
  if (tooOld) score -= 0.5;
  return {
    score: Math.max(0, score),
    detail: `maxYear=${maxYear}（要求≥${freshYear}）, 过旧占比=${(oldShare * 100).toFixed(0)}%（阈值<${(oldShareThreshold * 100).toFixed(0)}%）`,
  };
}

// ========== Score aggregation ==========

function aggregateRuleScore(rules: DocumentEvalRuleResult[]): number {
  if (!rules.length) return 0;
  const avg = rules.reduce((acc, r) => acc + r.score, 0) / rules.length;
  return round1(avg * 100);
}

// ========== LLM judge ==========

async function evaluateJudge(
  c: DocumentEvalCase,
  text: string,
  options: DocumentEvaluationRunnerOptions,
): Promise<{ judgeScore: number; judgeDetails: DocumentEvalResult["judgeDetails"] }> {
  if (!c.rubrics.length) return { judgeScore: 0, judgeDetails: [] };

  const repeat = Math.max(1, options.judgeRepeat ?? 3);
  const sampleThreshold = options.sampleThreshold ?? 10000;
  const sampleSize = options.sampleSize ?? 3200;
  const sample = text.length > sampleThreshold ? sampleDocument(text, sampleSize) : text;

  const judgeFn: JudgeFn = options.judgeFn ?? defaultJudgeFn;

  const judgeDetails: DocumentEvalResult["judgeDetails"] = [];
  for (const rubric of c.rubrics) {
    const scores: number[] = [];
    const reasons: string[] = [];
    for (let i = 0; i < repeat; i += 1) {
      const res = await judgeFn({
        judgeDir: options.workspaceRoot,
        workspaceId: options.workspaceId,
        resultId: `${options.evaluationId}:${c.id}:${rubric.criterion}:${i}`,
        task: `评估文档「${c.name}」(domain=${c.domain}) 在维度「${rubric.criterion}」上的质量。${rubric.anchors ? `\n锚点说明：${rubric.anchors}` : ""}`,
        rubric: `仅就「${rubric.criterion}」一维打分（0..100），不评其他维度。`,
        output: sample,
        model: options.model,
        // weight 不进入 judge prompt：weight 是聚合层超参，judge 只给单维分。
      });
      if (typeof res.score === "number") {
        scores.push(res.score);
        reasons.push(res.details || "");
      } else {
        reasons.push(`[run#${i}] ${res.details || "score null"}`);
      }
    }
    const median = scores.length > 0 ? medianOf(scores) : 0;
    const reason = reasons.filter(Boolean).slice(0, repeat).join(" | ");
    judgeDetails.push({ criterion: rubric.criterion, score: round1(median), reason });
  }

  // weighted overall = Σ(score × weight) / Σ(weight)
  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < c.rubrics.length; i += 1) {
    const rubric = c.rubrics[i];
    const detail = judgeDetails[i];
    if (!rubric || !detail) continue;
    const w = rubric.weight > 0 ? rubric.weight : 1;
    totalWeight += w;
    weightedSum += detail.score * w;
  }
  const judgeScore = totalWeight > 0 ? round1(weightedSum / totalWeight) : 0;
  return { judgeScore, judgeDetails };
}

const defaultJudgeFn: JudgeFn = (params) =>
  runJudge(params.judgeDir, params.workspaceId, params.resultId, params.task, params.rubric, params.output, params.model);

function sampleDocument(text: string, sampleSize: number): string {
  const len = text.length;
  if (len <= sampleSize * 3) return text;
  const head = text.slice(0, sampleSize);
  const midStart = Math.floor(len / 2 - sampleSize / 2);
  const mid = text.slice(midStart, midStart + sampleSize);
  const tail = text.slice(len - sampleSize);
  return `${head}\n\n... [中段] ...\n\n${mid}\n\n... [尾段] ...\n\n${tail}`;
}

// ========== Consistency alerts ==========
// rule.name 与 rubric.criterion 完全相同时比较：偏差 ≥ 35 分告警。
// 设计上保守——只匹配显式同名，不做模糊匹配防误告。

function detectConsistencyAlerts(
  rules: DocumentEvalRuleResult[],
  judgeDetails: DocumentEvalResult["judgeDetails"],
): string[] {
  const alerts: string[] = [];
  for (const j of judgeDetails) {
    const r = rules.find((x) => x.ruleName === j.criterion);
    if (!r) continue;
    const ruleScore100 = r.score * 100;
    const delta = Math.abs(ruleScore100 - j.score);
    if (delta >= 35) {
      alerts.push(`${j.criterion}: rule=${round1(ruleScore100)} vs judge=${round1(j.score)}（Δ=${round1(delta)}）`);
    }
  }
  return alerts;
}

// ========== Helpers ==========

function sliceFromSection(text: string, section: string): string {
  const idx = text.indexOf(section);
  if (idx < 0) return "";
  // 取到下一个 markdown heading 或 4000 字止；近似一个 section 的正文范围。
  const remaining = text.slice(idx);
  const nextHeading = remaining.slice(section.length).search(/\n#{1,3}\s/);
  if (nextHeading < 0) return remaining.slice(0, 4000);
  return remaining.slice(0, section.length + nextHeading);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function readNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}
