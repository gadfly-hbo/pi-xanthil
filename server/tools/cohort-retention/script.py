#!/usr/bin/env python3
"""同期群 (cohort) 留存/复购分析: 期望事件级 (customer_id, purchase_date) 表。"""
import sys
import os
import warnings
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool

warnings.filterwarnings("ignore")

CUSTOMER_ALIASES = ["customer_id", "customerid", "customer", "顾客id", "用户id", "客户id", "member_id", "user_id", "uid"]
DATE_ALIASES = ["purchase_date", "order_date", "event_date", "transaction_date", "date", "购买日期", "下单日期", "订单日期", "交易日期"]


def to_period(series, granularity):
    if granularity == "weekly":
        return series.dt.to_period("W")
    return series.dt.to_period("M")


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    cust_col = find_col(df, CUSTOMER_ALIASES)
    date_col = find_col(df, DATE_ALIASES)
    missing = []
    if cust_col is None:
        missing.append("customer_id")
    if date_col is None:
        missing.append("purchase_date 或 购买日期")
    if missing:
        return {"error": f"缺少必需字段: {', '.join(missing)}", "results": {}}

    work = pd.DataFrame()
    work["customer_id"] = df[cust_col].astype(str)
    work["purchase_date"] = pd.to_datetime(df[date_col], errors="coerce")
    work = work.dropna(subset=["purchase_date"])
    if len(work) < 10:
        return {"error": f"有效事件行过少 ({len(work)}), 至少需要 10 行", "results": {}}

    n_rows = len(work)
    n_customers = work["customer_id"].nunique()
    if n_rows < n_customers * 1.2:
        return {"error": f"数据粒度不符: 期望事件级表（同一客户多行），当前 {n_rows} 行 / {n_customers} 客户，重复购买记录过少；客户级单行汇总表无法做 cohort 留存", "results": {}}

    granularity = str(opts.get("granularity", "monthly")).lower()
    if granularity not in {"weekly", "monthly"}:
        granularity = "monthly"
    max_periods = int(opts.get("max_periods", 12))
    if max_periods < 2:
        max_periods = 12

    work["period"] = to_period(work["purchase_date"], granularity)
    first_period = work.groupby("customer_id")["period"].min().rename("cohort")
    work = work.merge(first_period, on="customer_id")
    # pandas Period subtraction yields an Offset object; .n gives the number of periods
    work["period_offset"] = (work["period"] - work["cohort"]).apply(lambda x: x.n)
    work = work[work["period_offset"] >= 0]

    cohort_sizes = work.drop_duplicates("customer_id").groupby("cohort").size()
    if len(cohort_sizes) < 2:
        return {"error": f"可识别的 cohort 过少 ({len(cohort_sizes)}), 数据时间跨度不足以做留存分析", "results": {}}

    cohort_table = (
        work.drop_duplicates(["customer_id", "cohort", "period_offset"])
        .groupby(["cohort", "period_offset"])
        .size()
        .unstack(fill_value=0)
        .sort_index()
    )

    max_offset = min(max_periods - 1, int(cohort_table.columns.max()))
    cols_keep = [c for c in cohort_table.columns if c <= max_offset]
    cohort_table = cohort_table[cols_keep]

    retention = cohort_table.div(cohort_sizes, axis=0).fillna(0)
    max_cohort = cohort_table.index.max()

    cohort_labels = [str(p) for p in cohort_table.index]
    retention_matrix = []
    customer_matrix = []
    for cohort_idx in cohort_table.index:
        row_ret = []
        row_cust = []
        delta = max_cohort - cohort_idx
        cohort_age = delta.n if hasattr(delta, "n") else int(delta)
        for offset in cols_keep:
            if offset <= cohort_age:
                row_ret.append(round(float(retention.loc[cohort_idx, offset]), 4))
                row_cust.append(int(cohort_table.loc[cohort_idx, offset]))
            else:
                row_ret.append(None)
                row_cust.append(None)
        retention_matrix.append(row_ret)
        customer_matrix.append(row_cust)

    avg_curve = []
    for j, _ in enumerate(cols_keep):
        valid = [retention_matrix[i][j] for i in range(len(retention_matrix)) if retention_matrix[i][j] is not None]
        avg_curve.append(round(float(np.mean(valid)), 4) if valid else None)

    overall = {
        "cohorts": len(cohort_labels),
        "customers": int(n_customers),
        "events": int(n_rows),
        "granularity": granularity,
        "maxPeriods": len(cols_keep),
        "avgRetentionPeriod1": avg_curve[1] if len(avg_curve) > 1 else None,
    }

    return {"results": {
        "overall": overall,
        "cohortLabels": cohort_labels,
        "periodOffsets": [int(c) for c in cols_keep],
        "cohortSizes": [int(cohort_sizes.loc[c]) for c in cohort_table.index],
        "retentionMatrix": retention_matrix,
        "customerMatrix": customer_matrix,
        "averageCurve": avg_curve,
    }}


def format_md(result):
    lines = ["# 同期群留存分析报告\n"]
    r = result.get("results", {})
    if not r:
        lines.append("（无有效分析结果）\n")
        return "\n".join(lines)
    o = r.get("overall", {})
    lines.append(f"- cohort 数: {o.get('cohorts', '-')}")
    lines.append(f"- 客户数: {o.get('customers', '-')}")
    lines.append(f"- 事件行数: {o.get('events', '-')}")
    lines.append(f"- 时间粒度: {o.get('granularity', '-')}")
    lines.append(f"- period 1 平均留存率: {o.get('avgRetentionPeriod1', '-')}\n")

    labels = r.get("cohortLabels", [])
    offsets = r.get("periodOffsets", [])
    sizes = r.get("cohortSizes", [])
    matrix = r.get("retentionMatrix", [])
    if labels and matrix:
        lines.append("## 留存率矩阵 (%)\n")
        header = "| cohort | size | " + " | ".join(f"P{o}" for o in offsets) + " |"
        sep = "|" + "---|" * (len(offsets) + 2)
        lines.append(header)
        lines.append(sep)
        for i, lab in enumerate(labels):
            row = matrix[i]
            cells = []
            for v in row:
                cells.append("-" if v is None else f"{v*100:.1f}%")
            lines.append(f"| {lab} | {sizes[i]} | " + " | ".join(cells) + " |")
        lines.append("")

    avg = r.get("averageCurve", [])
    if avg:
        lines.append("## 平均留存曲线\n")
        lines.append("| period | avg_retention |")
        lines.append("|--------|---------------|")
        for off, v in zip(offsets, avg):
            lines.append(f"| P{off} | {'-' if v is None else f'{v*100:.1f}%'} |")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="同期群留存/复购分析",
        param_defs=[
            {"name": "granularity", "type": str, "default": "monthly"},
            {"name": "max_periods", "type": int, "default": 12},
        ],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="cohort_retention",
    )
