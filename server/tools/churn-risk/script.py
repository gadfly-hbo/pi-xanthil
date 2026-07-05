#!/usr/bin/env python3
"""Member churn risk: Kaplan-Meier + composite risk scoring (pure numpy/scipy)."""
import sys
import os

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool


CUSTOMER_ALIASES = ["customer_id", "customerid", "customer", "member_id", "user_id", "uid", "顾客id", "用户id", "客户id"]
RECENCY_ALIASES = ["recency", "last_purchase_days", "days_since_last", "距今天数", "最近购买天数", "天数"]
FREQUENCY_ALIASES = ["frequency", "freq", "购买次数", "购买频次", "复购次数", "订单次数"]
MONETARY_ALIASES = ["monetary", "monetary_value", "amount", "总金额", "累计金额", "客单价", "金额"]


def detect_columns(df):
    return {
        "customer": find_col(df, CUSTOMER_ALIASES),
        "recency": find_col(df, RECENCY_ALIASES),
        "frequency": find_col(df, FREQUENCY_ALIASES),
        "monetary": find_col(df, MONETARY_ALIASES),
    }


def kaplan_meier(durations, events):
    """KM survival function: returns (times[0..], surv[0..]) with S(0)=1."""
    durations = np.asarray(durations, dtype=float)
    events = np.asarray(events, dtype=bool)
    order = np.argsort(durations)
    durations = durations[order]
    events = events[order]
    n = len(durations)
    if n == 0:
        return np.array([0.0]), np.array([1.0])

    unique_times = np.unique(durations)
    surv = 1.0
    times_out = [0.0]
    surv_out = [1.0]
    at_risk = n
    for t in unique_times:
        mask_t = durations == t
        d = int(events[mask_t].sum())
        if at_risk > 0 and d > 0:
            surv *= max(0.0, 1.0 - d / at_risk)
        at_risk -= int(mask_t.sum())
        times_out.append(float(t))
        surv_out.append(float(surv))
    return np.array(times_out), np.array(surv_out)


def km_lookup(times, surv, query):
    query = np.asarray(query, dtype=float)
    idx = np.searchsorted(times, query, side="right") - 1
    idx = np.clip(idx, 0, len(surv) - 1)
    return surv[idx]


def quantile_tier(values, labels=("低风险", "中风险", "高风险", "极高风险")):
    s = pd.Series(values)
    try:
        return pd.qcut(s.rank(method="first"), q=4, labels=list(labels)).astype(str).values
    except (ValueError, TypeError):
        return np.array(["中风险"] * len(values))


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    cols = detect_columns(df)
    missing = [k for k in ["customer", "recency", "frequency"] if cols[k] is None]
    if missing:
        label_map = {"customer": "customer_id", "recency": "recency", "frequency": "frequency"}
        return {"error": f"缺少必需字段: {', '.join(label_map[k] for k in missing)}", "results": {}}

    work = pd.DataFrame()
    work["customer_id"] = df[cols["customer"]].astype(str)
    work["recency"] = pd.to_numeric(df[cols["recency"]], errors="coerce")
    work["frequency"] = pd.to_numeric(df[cols["frequency"]], errors="coerce")
    if cols["monetary"] is not None:
        work["monetary"] = pd.to_numeric(df[cols["monetary"]], errors="coerce").fillna(0)
    else:
        work["monetary"] = 0.0
    work = work.dropna(subset=["recency", "frequency"])
    work = work[(work["recency"] >= 0) & (work["frequency"] >= 0)]

    if len(work) < 10:
        return {"error": f"客户数过少 ({len(work)}), 至少需要 10 个客户", "results": {}}

    threshold = float(opts.get("churn_threshold_days", 90))
    top_n = int(float(opts.get("top_n", 30)))

    durations = work["recency"].values
    events = durations > threshold
    fallback = False
    fallback_reason = None

    try:
        times, surv = kaplan_meier(durations, events)
        if not np.isfinite(surv).all() or len(times) < 2:
            raise ValueError("KM degenerate")
        km_churn = 1.0 - km_lookup(times, surv, durations)
    except (ValueError, RuntimeError) as e:
        fallback = True
        fallback_reason = str(e)
        km_churn = events.astype(float)
        times, surv = np.array([0.0]), np.array([1.0])

    freq_pct = work["frequency"].rank(pct=True, ascending=True).values
    if work["monetary"].sum() > 0:
        mon_pct = work["monetary"].rank(pct=True, ascending=True).values
    else:
        mon_pct = freq_pct
    feat_risk = 1.0 - 0.5 * (freq_pct + mon_pct)
    feat_risk = np.clip(feat_risk, 0.0, 1.0)

    composite = 0.7 * km_churn + 0.3 * feat_risk
    work["km_churn_prob"] = np.round(km_churn, 4)
    work["feature_risk"] = np.round(feat_risk, 4)
    work["risk_score"] = np.round(composite, 4)
    work["churned"] = events
    work["risk_tier"] = quantile_tier(composite)

    tier_summary = []
    total = len(work)
    high_risk = 0
    for tier_name, group in work.groupby("risk_tier"):
        size = int(len(group))
        if tier_name in ("高风险", "极高风险"):
            high_risk += size
        tier_summary.append({
            "tier": tier_name,
            "size": size,
            "ratio": round(float(size / total), 4),
            "avg_recency": round(float(group["recency"].mean()), 2),
            "avg_frequency": round(float(group["frequency"].mean()), 4),
            "avg_monetary": round(float(group["monetary"].mean()), 2),
            "avg_risk_score": round(float(group["risk_score"].mean()), 4),
            "churned_ratio": round(float(group["churned"].mean()), 4),
        })
    tier_order = {"极高风险": 0, "高风险": 1, "中风险": 2, "低风险": 3}
    tier_summary.sort(key=lambda x: tier_order.get(x["tier"], 99))

    sample_points = []
    if not fallback:
        for q in (30, 60, 90, 180, 365):
            s_val = float(km_lookup(times, surv, np.array([q]))[0])
            sample_points.append({"days": q, "survival": round(s_val, 4)})

    overall = {
        "customers": total,
        "churnThreshold": threshold,
        "churnedCount": int(events.sum()),
        "churnedRatio": round(float(events.mean()), 4),
        "highRiskRatio": round(float(high_risk / total), 4),
        "fallback": fallback,
        "fallbackReason": fallback_reason,
        "kmSamplePoints": sample_points,
    }

    top_high = work.sort_values("risk_score", ascending=False).head(min(top_n, total))
    top_records = top_high[[
        "customer_id", "recency", "frequency", "monetary",
        "km_churn_prob", "feature_risk", "risk_score", "risk_tier",
    ]].to_dict(orient="records")

    return {"results": {
        "overall": overall,
        "tiers": tier_summary,
        "topHighRisk": top_records,
    }}


def format_md(result):
    lines = ["# 会员流失风险预警报告 (Kaplan-Meier + 风险打分)\n"]
    r = result.get("results", {})
    if not r:
        lines.append("(无有效分析结果)\n")
        return "\n".join(lines)

    o = r.get("overall", {})
    lines.append(f"- 客户数: {o.get('customers', '-')}")
    lines.append(f"- 流失判定阈值: {o.get('churnThreshold', '-')} 天")
    lines.append(f"- 已流失客户: {o.get('churnedCount', '-')} ({o.get('churnedRatio', 0):.2%})")
    lines.append(f"- 高/极高风险占比: {o.get('highRiskRatio', 0):.2%}")
    if o.get("fallback"):
        lines.append("- 注意: KM 拟合失败, 已回退为阈值硬分类")
    lines.append("")

    sp = o.get("kmSamplePoints", [])
    if sp:
        lines.append("## KM 群体存活率\n")
        lines.append("| 距上次购买(天) | 存活率 S(t) |")
        lines.append("|---|---|")
        for p in sp:
            lines.append(f"| {p['days']} | {p['survival']:.4f} |")
        lines.append("")

    tiers = r.get("tiers", [])
    if tiers:
        lines.append("## 风险分层\n")
        lines.append("| 分层 | 规模 | 占比 | 均recency | 均frequency | 均monetary | 均风险分 | 已流失占比 |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for t in tiers:
            lines.append(
                f"| {t['tier']} | {t['size']} | {t['ratio']:.2%} | {t['avg_recency']} | "
                f"{t['avg_frequency']} | {t['avg_monetary']} | {t['avg_risk_score']} | {t['churned_ratio']:.2%} |"
            )
        lines.append("")

    top = r.get("topHighRisk", [])
    if top:
        lines.append("## Top 高风险客户 (脱敏 ID)\n")
        lines.append("| customer_id | recency | frequency | monetary | KM流失概率 | 特征风险 | 综合风险分 | 分层 |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for c in top:
            lines.append(
                f"| {c['customer_id']} | {c['recency']} | {c['frequency']} | {c['monetary']} | "
                f"{c['km_churn_prob']} | {c['feature_risk']} | {c['risk_score']} | {c['risk_tier']} |"
            )
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="会员流失预警 (KM + 风险打分)",
        param_defs=[
            {"name": "churn_threshold_days", "type": float, "default": 90},
            {"name": "top_n", "type": float, "default": 30},
        ],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="churn_risk",
    )
