#!/usr/bin/env python3
"""RFM 会员分群: 期望客户级聚合 CSV (customer_id, recency, frequency, monetary)。"""
import sys
import os
import warnings
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool

warnings.filterwarnings("ignore")

CUSTOMER_ALIASES = ["customer_id", "customerid", "customer", "顾客id", "用户id", "客户id", "member_id", "memberid", "user_id", "userid", "uid"]
RECENCY_DATE_ALIASES = ["最近购买日期", "末次购买日期", "末购日期", "last_purchase_date", "last_order_date", "recency_date"]
RECENCY_DAYS_ALIASES = ["recency_days", "recency", "最近购买天数", "距今天数"]
FREQUENCY_ALIASES = ["frequency", "购买频次", "购买次数", "orders", "order_count", "下单次数", "购买数"]
MONETARY_ALIASES = ["monetary", "累计金额", "总消费", "总金额", "amount", "sales", "gmv", "消费金额", "总消费额"]


def detect_columns(df):
    customer = find_col(df, CUSTOMER_ALIASES)
    rec_days = find_col(df, RECENCY_DAYS_ALIASES)
    rec_date = find_col(df, RECENCY_DATE_ALIASES) if rec_days is None else None
    freq = find_col(df, FREQUENCY_ALIASES)
    mon = find_col(df, MONETARY_ALIASES)
    return {"customer": customer, "recency_days": rec_days, "recency_date": rec_date, "frequency": freq, "monetary": mon}


def quintile_score(series, reverse=False):
    arr = pd.Series(series.values.astype(float))
    try:
        ranks = pd.qcut(arr.rank(method="first"), q=5, labels=[1, 2, 3, 4, 5])
        scores = ranks.astype(int).values
    except (ValueError, TypeError):
        scores = np.full(len(arr), 3, dtype=int)
    if reverse:
        scores = 6 - scores
    return scores


def assign_segments_vectorized(work):
    R = work["R"].values.astype(int)
    F = work["F"].values.astype(int)
    M = work["M"].values.astype(int)
    segments = np.full(len(work), "中等价值客户", dtype=object)
    segments[(R >= 4) & (F >= 4) & (M >= 4)] = "重要价值客户"
    segments[(R >= 4) & (F <= 2) & (M >= 4)] = "重要发展客户"
    segments[(R <= 2) & (F >= 4) & (M >= 4)] = "重要保持客户"
    segments[(R <= 2) & (F <= 2) & (M >= 4)] = "重要挽留客户"
    segments[(R >= 4) & (F >= 4) & (M <= 3)] = "一般价值客户"
    segments[(R >= 4) & (F <= 2) & (M <= 3)] = "一般发展客户"
    segments[(R <= 2) & (F >= 4) & (M <= 3)] = "一般保持客户"
    segments[(R <= 2) & (F <= 2) & (M <= 3)] = "一般挽留客户"
    return segments


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    cols = detect_columns(df)
    missing = []
    if cols["customer"] is None:
        missing.append("customer_id")
    if cols["recency_days"] is None and cols["recency_date"] is None:
        missing.append("recency 或 最近购买日期")
    if cols["frequency"] is None:
        missing.append("frequency")
    if cols["monetary"] is None:
        missing.append("monetary")
    if missing:
        return {"error": f"缺少必需字段: {', '.join(missing)}", "results": {}}

    work = pd.DataFrame()
    work["customer_id"] = df[cols["customer"]].astype(str)

    if cols["recency_days"] is not None:
        work["recency_days"] = pd.to_numeric(df[cols["recency_days"]], errors="coerce")
    else:
        dates = pd.to_datetime(df[cols["recency_date"]], errors="coerce")
        ref_str = str(opts.get("reference_date", "") or "").strip()
        ref = pd.to_datetime(ref_str) if ref_str else dates.max()
        if pd.isna(ref):
            return {"error": "无法解析 recency 日期列（reference_date 缺失且数据日期全空）", "results": {}}
        work["recency_days"] = (ref - dates).dt.days

    work["frequency"] = pd.to_numeric(df[cols["frequency"]], errors="coerce")
    work["monetary"] = pd.to_numeric(df[cols["monetary"]], errors="coerce")
    work = work.dropna(subset=["recency_days", "frequency", "monetary"])
    work = work[(work["frequency"] >= 0) & (work["monetary"] >= 0) & (work["recency_days"] >= 0)]

    if len(work) < 8:
        return {"error": f"客户数过少 ({len(work)}), 至少需要 8 个客户进行 RFM 5 分位打分", "results": {}}

    work["R"] = quintile_score(work["recency_days"], reverse=True)
    work["F"] = quintile_score(work["frequency"], reverse=False)
    work["M"] = quintile_score(work["monetary"], reverse=False)
    work["segment"] = assign_segments_vectorized(work)

    total = len(work)
    seg_summary = []
    for seg_name, group in work.groupby("segment"):
        seg_summary.append({
            "segment": seg_name,
            "size": int(len(group)),
            "ratio": round(float(len(group) / total), 4),
            "avg_recency_days": round(float(group["recency_days"].mean()), 2),
            "avg_frequency": round(float(group["frequency"].mean()), 2),
            "avg_monetary": round(float(group["monetary"].mean()), 2),
            "avg_R": round(float(group["R"].mean()), 2),
            "avg_F": round(float(group["F"].mean()), 2),
            "avg_M": round(float(group["M"].mean()), 2),
        })
    seg_summary.sort(key=lambda x: x["size"], reverse=True)

    overall = {
        "customers": total,
        "segments": len(seg_summary),
        "topSegment": seg_summary[0]["segment"] if seg_summary else "-",
        "avg_recency_days": round(float(work["recency_days"].mean()), 2),
        "avg_frequency": round(float(work["frequency"].mean()), 2),
        "avg_monetary": round(float(work["monetary"].mean()), 2),
    }

    return {"results": {
        "overall": overall,
        "segments": seg_summary,
        "score_distribution": {
            "R": {int(k): int(v) for k, v in work["R"].value_counts().sort_index().to_dict().items()},
            "F": {int(k): int(v) for k, v in work["F"].value_counts().sort_index().to_dict().items()},
            "M": {int(k): int(v) for k, v in work["M"].value_counts().sort_index().to_dict().items()},
        },
    }}


def format_md(result):
    lines = ["# RFM 会员分群报告\n"]
    r = result.get("results", {})
    if not r:
        lines.append("（无有效分析结果）\n")
        return "\n".join(lines)
    o = r.get("overall", {})
    lines.append(f"- 客户数: {o.get('customers', '-')}")
    lines.append(f"- 分群数: {o.get('segments', '-')}")
    lines.append(f"- 最大群: {o.get('topSegment', '-')}")
    lines.append(f"- 平均最近购买天数: {o.get('avg_recency_days', '-')}")
    lines.append(f"- 平均购买频次: {o.get('avg_frequency', '-')}")
    lines.append(f"- 平均累计金额: {o.get('avg_monetary', '-')}\n")

    segs = r.get("segments", [])
    if segs:
        lines.append("## 群画像\n")
        lines.append("| 分群 | 规模 | 占比 | R均分 | F均分 | M均分 | 平均距今天数 | 平均频次 | 平均金额 |")
        lines.append("|------|------|------|-------|-------|-------|--------------|----------|----------|")
        for s in segs:
            lines.append(
                f"| {s['segment']} | {s['size']} | {s['ratio']:.2%} | {s['avg_R']} | {s['avg_F']} | {s['avg_M']} | {s['avg_recency_days']} | {s['avg_frequency']} | {s['avg_monetary']} |"
            )
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="RFM 会员分群",
        param_defs=[{"name": "reference_date", "type": str, "default": ""}],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="rfm",
    )
