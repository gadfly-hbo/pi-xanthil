import { ArrowDown, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";

// User-facing documentation for the AnaX商业分析 methodology. Kept in sync with
// server/src/anax-template.ts (the actual runnable workflow). This pane exists
// because the BADIR + 门禁 model is unfamiliar to most users — it explains what
// each stage does and, crucially, why some stages can block the whole flow.

interface Stage {
  step: string;
  id: string;
  label: string;
  role: string;
  icon: string;
  kind: "agent" | "gate";
  what: string;
  out?: string;
  why: string;
}

const STAGES: Stage[] = [
  {
    step: "B", id: "business", label: "商务问题", role: "协调官", icon: "🎯", kind: "agent",
    what: "把模糊诉求结构化为「时间 + 对象 + 指标 + 变化幅度 + 目的」，并提出至少 3 个可证伪假设。",
    out: "01-brief.md",
    why: "问题定义错了，后面每一步都白做。这一步逼你把“感觉不太对”变成能被验证的命题。",
  },
  {
    step: "A", id: "plan", label: "分析规范", role: "规范官", icon: "📐", kind: "agent",
    what: "选匹配问题的统计方法，把假设写成可验证形式，列出聚合数据需求，并预先声明局限性。",
    out: "02-spec.md",
    why: "方法与问题错配（如归因问题用描述统计）是最常见的翻车点，规范阶段提前锁定。",
  },
  {
    step: "D", id: "data", label: "数据质量", role: "数据策展官", icon: "🗂️", kind: "agent",
    what: "对已登记的聚合数据做 6 维度评分（完整性 / 准确性 / 时效性 / 一致性 / 有效性 / 唯一性），给出综合分。",
    out: "03-data-quality.md",
    why: "数据不合格，再漂亮的分析也是沙上建塔。注意：本工作台只评估聚合数据，不读取原始明细。",
  },
  {
    step: "门禁", id: "data_gate", label: "数据质量门禁", role: "复核官", icon: "🚦", kind: "gate",
    what: "在进入假设验证前，检查数据综合评分、是否披露局限性、置信度与证据是否达标。",
    why: "拦住“数据 4.5 分但先用着”的侥幸。不达标会在这里红灯停车，逼你补数据而非硬着头皮往下走。",
  },
  {
    step: "I", id: "insight", label: "假设验证与洞察", role: "假设分析师", icon: "🔬", kind: "agent",
    what: "逐一检验假设，报告 p 值 + 效应量 + 置信区间，给出 ✅成立 / ❌不成立 / ⚠️部分 的明确结论，并对高影响假设交叉验证。",
    out: "04-insights.md",
    why: "统计显著 ≠ 业务显著、相关 ≠ 因果。这一步把假设变成有证据的洞察，连被推翻的也要如实报告。",
  },
  {
    step: "R", id: "recommend", label: "决策建议", role: "战略官", icon: "🧭", kind: "agent",
    what: "把洞察转成建议包，每条建议含 7 要素：做什么 / 为什么 / 负责人 / 时间 / 成功标准 / 验证方案 / 收益与风险。",
    out: "05-recommendations.md",
    why: "“建议加强 XX”不是建议。这一步强制每条建议可落地、可验证，并显式回应最初的商务问题。",
  },
  {
    step: "门禁", id: "review_gate", label: "两阶段复核门禁", role: "复核官", icon: "🚦", kind: "gate",
    what: "方法论审查（结论是否有证据、高影响假设是否交叉验证、置信度是否匹配）+ 业务审查（是否回应核心问题、四要素是否齐全）。",
    why: "汇报前的最后一道闸。两轴都通过才放行——避免把没站稳的结论端到决策桌上。",
  },
  {
    step: "X", id: "verify", label: "执行验证", role: "验证官", icon: "✅", kind: "agent",
    what: "建议落地后收集实际效果，与成功标准对比，回算 ROI，给出 ✅达标 / ⚠️部分 / ❌未达标 结论。",
    out: "08-verify.md",
    why: "把“一份报告”升级成“一个决策闭环”。没有这一步，你永远不知道建议到底有没有用。",
  },
  {
    step: "Arch", id: "archive", label: "归档与沉淀", role: "协调官", icon: "📦", kind: "agent",
    what: "归档全流程结论，沉淀哪些假设被证实 / 证伪，标注对应业务场景供日后复用。",
    out: "09-archive-summary.md",
    why: "让每次分析都给下一次提速——证实过的因果链可以直接复用，不必从零再猜一遍。",
  },
];

const RED_LINES: { id: string; desc: string }[] = [
  { id: "RL01", desc: "结论无数据证据支撑" },
  { id: "RL02", desc: "假设未经验证直接采纳" },
  { id: "RL03", desc: "数据质量综合评分 < 5 仍继续" },
  { id: "RL04", desc: "建议未回应原始商务问题" },
  { id: "RL05", desc: "关键局限性未披露" },
  { id: "RL06", desc: "高影响假设（>¥500K/月）未交叉验证" },
  { id: "RL07", desc: "建议缺少负责人 / 时间 / 成功标准 / 验证方案" },
];

export function AnaXReadmePane() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* intro */}
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">AnaX 商业分析是什么</h2>
        <p className="mt-2 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">
          AnaX 把一次严肃的商业数据分析拆成 <strong>8 个阶段（BADIR + 执行验证 + 归档）</strong>，
          并在关键节点设置<strong>质量门禁</strong>。你只需要在「工作视图」里写清楚商务诉求，AI 会按这条流水线逐阶段产出，
          每个阶段都有明确的交付物。和普通对话最大的不同是：<strong>不合格的中间结果会被门禁拦下，流程在该处停止</strong>，
          而不是带着问题一路滑到最终建议。
        </p>

        {/* flow diagram */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">分析流程</h3>
        <div className="mt-3 flex flex-col items-stretch gap-0">
          {STAGES.map((s, i) => (
            <div key={s.id}>
              <div
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2.5",
                  s.kind === "gate"
                    ? "border-amber-300 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/20"
                    : "border-neutral-200 bg-neutral-50/60 dark:border-neutral-700 dark:bg-neutral-800/30",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[15px]">{s.icon}</span>
                <span
                  className={cn(
                    "w-12 shrink-0 text-center text-[10px] font-bold",
                    s.kind === "gate" ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400",
                  )}
                >
                  {s.step}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">{s.label}</span>
                    <span className="shrink-0 rounded-full bg-neutral-200/70 px-1.5 py-0.5 text-[9px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      {s.role}
                    </span>
                    {s.out && (
                      <span className="shrink-0 font-mono text-[9.5px] text-neutral-400">{s.out}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">{s.what}</p>
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div className="flex justify-start py-0.5 pl-[26px]">
                  <ArrowDown className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* why each stage matters */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">每个阶段为什么重要</h3>
        <div className="mt-3 flex flex-col gap-2">
          {STAGES.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-neutral-200 px-3 py-2.5 dark:border-neutral-700"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px]">{s.icon}</span>
                <span className="text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
                  {s.step} · {s.label}
                </span>
                {s.kind === "gate" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    <ShieldAlert className="h-2.5 w-2.5" strokeWidth={2.5} />
                    门禁
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-neutral-600 dark:text-neutral-400">{s.why}</p>
            </div>
          ))}
        </div>

        {/* gate mechanism */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">门禁是怎么工作的</h3>
        <p className="mt-2 text-[12.5px] leading-6 text-neutral-600 dark:text-neutral-300">
          门禁节点会让 AI 对上游产出做一次结构化审查，系统再按<strong>固定阈值确定性判定</strong>，AI 自己说“通过”不算数：
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-[12px] text-neutral-600 dark:text-neutral-300">
          <li>· 置信度需 ≥ <strong>medium</strong></li>
          <li>· 每个结论的证据数需 ≥ <strong>2</strong></li>
          <li>· 数据质量综合分需 ≥ <strong>7</strong>（满分 10）</li>
        </ul>
        <p className="mt-2 text-[12.5px] leading-6 text-neutral-600 dark:text-neutral-300">
          只要命中任意一条<strong>质量红线</strong>，或上述阈值不达标，门禁就亮 <span className="font-semibold text-rose-600 dark:text-rose-400">🔴 BLOCKED</span>，
          流程在该节点停下——你会在「工作视图」看到红色裁决卡和具体原因，修正后再重跑即可。
        </p>

        {/* red lines */}
        <h3 className="mt-8 text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">7 条质量红线</h3>
        <div className="mt-3 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
          {RED_LINES.map((rl, i) => (
            <div
              key={rl.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                i > 0 && "border-t border-neutral-100 dark:border-neutral-800",
              )}
            >
              <span className="shrink-0 font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400">{rl.id}</span>
              <span className="text-[12px] text-neutral-700 dark:text-neutral-300">{rl.desc}</span>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[11.5px] leading-5 text-neutral-400">
          提示：门禁是为了挡住“看起来对、其实没站稳”的结论。被拦下不是出错，而是流程在保护你的决策质量。
        </p>
      </div>
    </div>
  );
}
