#!/usr/bin/env python3
"""AARRR / consumer-relationship stage-flow analysis (period x stage)."""
import sys
import os

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool


PERIOD_ALIASES = ["period", "date", "week", "month", "期数", "周期", "日期", "期"]

STAGE_ORDER = [
    ("awareness", ["awareness", "认知", "曝光", "acquisition"]),
    ("interest", ["interest", "兴趣", "engagement"]),
    ("consideration", ["consideration", "考虑", "种草"]),
    ("purchase", ["purchase", "购买", "转化", "成交", "conversion"]),
    ("retention", ["retention", "留存", "复购"]),
    ("loyalty", ["loyalty", "忠诚", "活跃"]),
    ("advocacy", ["advocacy", "推荐", "referral", "分享"]),
]


def detect_stages(df):
    """Return ordered list of (canonical_name, source_column)."""
    found = []
    used_cols = set()
    for canonical, aliases in STAGE_ORDER:
        col = find_col(df, aliases)
        if col is not None and col not in used_cols:
            found.append((canonical, col))
            used_cols.add(col)
    if len(found) >= 2:
        return found
    fallback = []
    for c in df.columns:
        cl = str(c).strip().lower()
        if cl.startswith("stage") and c not in used_cols:
            fallback.append((cl, c))
    return fallback if len(fallback) >= 2 else found


def safe_ratio(numer, denom):
    return float(numer) / float(denom) if denom and denom > 0 else 0.0


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "时序数据为空", "results": {}}

    period_col = find_col(df, PERIOD_ALIASES)
    if period_col is None:
        return {"error": "缺少必需字段: period 列", "results": {}}

    stages = detect_stages(df)
    if len(stages) < 2:
        return {"error": "缺少必需字段: 至少需要 2 个阶段人数列", "results": {}}

    work = pd.DataFrame()
    work["period"] = df[period_col].astype(str)
    for canonical, col in stages:
        work[canonical] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    work = work.dropna(subset=["period"])
    if work.empty:
        return {"error": "时序数据为空", "results": {}}

    stage_names = [s[0] for s in stages]
    n_periods = len(work)

    per_period_rows = []
    for _, row in work.iterrows():
        rates = {}
        for i in range(len(stage_names) - 1):
            a, b = stage_names[i], stage_names[i + 1]
            rates[f"{a}_to_{b}"] = round(safe_ratio(row[b], row[a]), 6)
        first = stage_names[0]
        last = stage_names[-1]
        deep = round(safe_ratio(row[last], row[first]), 6)
        per_period_rows.append({
            "period": row["period"],
            "counts": {s: float(row[s]) for s in stage_names},
            "stageRates": rates,
            "endToEndRate": deep,
        })

    period_over_period = []
    for i in range(1, n_periods):
        prev = work.iloc[i - 1]
        cur = work.iloc[i]
        change = {}
        for s in stage_names:
            change[s] = round(safe_ratio(cur[s] - prev[s], prev[s]), 6)
        period_over_period.append({
            "period": cur["period"],
            "previousPeriod": prev["period"],
            "stageDelta": change,
        })

    totals = {s: float(work[s].sum()) for s in stage_names}
    funnel = []
    for i, s in enumerate(stage_names):
        if i == 0:
            funnel.append({
                "stage": s,
                "total": totals[s],
                "rateFromPrev": 1.0,
                "rateFromFirst": 1.0,
            })
        else:
            prev_total = totals[stage_names[i - 1]]
            first_total = totals[stage_names[0]]
            funnel.append({
                "stage": s,
                "total": totals[s],
                "rateFromPrev": round(safe_ratio(totals[s], prev_total), 6),
                "rateFromFirst": round(safe_ratio(totals[s], first_total), 6),
            })

    deepening_curve = [row["endToEndRate"] for row in per_period_rows]
    overall_deepening = round(safe_ratio(totals[stage_names[-1]], totals[stage_names[0]]), 6)
    deepening_trend = "stable"
    if len(deepening_curve) >= 2:
        first_half = float(np.mean(deepening_curve[: max(1, len(deepening_curve) // 2)]))
        second_half = float(np.mean(deepening_curve[len(deepening_curve) // 2 :]))
        if second_half > first_half * 1.05:
            deepening_trend = "improving"
        elif second_half < first_half * 0.95:
            deepening_trend = "declining"

    overall = {
        "periods": n_periods,
        "stages": len(stage_names),
        "stageNames": stage_names,
        "stageColumns": {s: c for s, c in stages},
        "stageTotals": {k: round(v, 4) for k, v in totals.items()},
        "overallDeepening": overall_deepening,
        "deepeningTrend": deepening_trend,
    }

    return {"results": {
        "overall": overall,
        "funnel": funnel,
        "perPeriod": per_period_rows,
        "periodOverPeriod": period_over_period,
        "deepeningCurve": [
            {"period": per_period_rows[i]["period"], "endToEndRate": deepening_curve[i]}
            for i in range(n_periods)
        ],
    }}


def format_md(result):
    lines = ["# AARRR / 关系流转分析报告\n"]
    r = result.get("results", {})
    if not r:
        lines.append("(无有效分析结果)\n")
        return "\n".join(lines)

    o = r.get("overall", {})
    lines.append(f"- 期数: {o.get('periods', '-')}")
    lines.append(f"- 阶段数: {o.get('stages', '-')}")
    lines.append(f"- 阶段顺序: {' -> '.join(o.get('stageNames', []))}")
    lines.append(f"- 整段关系加深率 (末/首): {o.get('overallDeepening', 0):.4%}")
    lines.append(f"- 加深趋势: {o.get('deepeningTrend', '-')}")
    lines.append("")

    funnel = r.get("funnel", [])
    if funnel:
        lines.append("## 整段漏斗 (阶段累计)\n")
        lines.append("| 阶段 | 累计人数 | 上一阶段转化 | 相对首阶段 |")
        lines.append("|---|---|---|---|")
        for row in funnel:
            lines.append(
                f"| {row['stage']} | {row['total']:.0f} | "
                f"{row['rateFromPrev']:.4%} | {row['rateFromFirst']:.4%} |"
            )
        lines.append("")

    per_period = r.get("perPeriod", [])
    if per_period:
        stages = o.get("stageNames", [])
        lines.append("## 每期阶段间转化率\n")
        rate_keys = [f"{stages[i]}_to_{stages[i+1]}" for i in range(len(stages) - 1)]
        header = "| 期 | " + " | ".join(rate_keys) + " | 末/首 |"
        sep = "|---|" + "---|" * (len(rate_keys) + 1)
        lines.append(header)
        lines.append(sep)
        for row in per_period:
            cells = [str(row["period"])]
            for k in rate_keys:
                cells.append(f"{row['stageRates'].get(k, 0):.4%}")
            cells.append(f"{row['endToEndRate']:.4%}")
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")

    pop = r.get("periodOverPeriod", [])
    if pop:
        stages = o.get("stageNames", [])
        lines.append("## 各阶段环比变化 (相对上一期)\n")
        header = "| 期 | (上一期) | " + " | ".join(stages) + " |"
        sep = "|---|---|" + "---|" * len(stages)
        lines.append(header)
        lines.append(sep)
        for row in pop:
            cells = [str(row["period"]), str(row["previousPeriod"])]
            for s in stages:
                cells.append(f"{row['stageDelta'].get(s, 0):.4%}")
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="AARRR / 关系流转分析",
        param_defs=[],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="aarrr_flow",
    )
