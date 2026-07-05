#!/usr/bin/env python3
"""客户终身价值预测：BG/NBD + Gamma-Gamma 纯算法实现。

期望客户级 RFM-T 列：customer_id, frequency (重复购买次数), recency (末购-首购间隔), T (观察期), monetary (客户均订单金额)。
参考: Fader, Hardie & Lee (2005) BG/NBD; Fader & Hardie (2013) Gamma-Gamma。
"""
import sys
import os
import warnings
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln, hyp2f1

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool

warnings.filterwarnings("ignore")

CUSTOMER_ALIASES = ["customer_id", "customerid", "customer", "顾客id", "用户id", "客户id", "member_id", "user_id", "uid"]
FREQUENCY_ALIASES = ["frequency", "freq", "x", "购买频次", "重复购买次数", "复购次数"]
RECENCY_ALIASES = ["recency", "t_x", "tx", "首末购间隔", "首末间隔"]
T_ALIASES = ["t", "age", "观察期", "客户年龄"]
MONETARY_ALIASES = ["monetary", "monetary_value", "avg_order_value", "客单价", "均订单金额", "均额"]


def detect_columns(df):
    return {
        "customer": find_col(df, CUSTOMER_ALIASES),
        "frequency": find_col(df, FREQUENCY_ALIASES),
        "recency": find_col(df, RECENCY_ALIASES),
        "T": find_col(df, T_ALIASES),
        "monetary": find_col(df, MONETARY_ALIASES),
    }


def _bgnbd_neg_loglik(params, x, t_x, T):
    """Eq. (5) from Fader, Hardie & Lee (2005)."""
    log_r, log_alpha, log_a, log_b = params
    r = np.exp(log_r); alpha = np.exp(log_alpha); a = np.exp(log_a); b = np.exp(log_b)
    A1 = gammaln(r + x) - gammaln(r) + r * np.log(alpha)
    A2 = gammaln(a + b) + gammaln(b + x) - gammaln(b) - gammaln(a + b + x)
    A3 = -(r + x) * np.log(alpha + T)
    log_term1 = A1 + A2 + A3
    log_term2 = np.where(
        x > 0,
        np.log(a) - np.log(b + x - 1) - (r + x) * np.log(alpha + t_x) + (r + x) * np.log(alpha + T),
        -np.inf,
    )
    log_lik = np.where(
        x > 0,
        log_term1 + np.log1p(np.exp(np.minimum(log_term2 - log_term1, 50))),
        log_term1,
    )
    if not np.isfinite(log_lik).all():
        return 1e10
    return -float(np.sum(log_lik))


def fit_bgnbd(x, t_x, T):
    x = np.asarray(x, dtype=float); t_x = np.asarray(t_x, dtype=float); T = np.asarray(T, dtype=float)
    best = None
    for seed in [np.array([0.0, 0.0, 0.0, 0.0]), np.array([0.5, 1.0, 0.5, 1.0]), np.array([-0.5, 0.5, -0.5, 0.5])]:
        try:
            res = minimize(_bgnbd_neg_loglik, seed, args=(x, t_x, T), method="Nelder-Mead",
                           options={"xatol": 1e-5, "fatol": 1e-5, "maxiter": 2000})
            if best is None or res.fun < best.fun:
                best = res
        except Exception:
            continue
    if best is None or not np.isfinite(best.fun):
        return None
    r, alpha, a, b = np.exp(best.x)
    return {"r": float(r), "alpha": float(alpha), "a": float(a), "b": float(b)}


def bgnbd_expected_purchases(params, x, t_x, T, t_future):
    r, alpha, a, b = params["r"], params["alpha"], params["a"], params["b"]
    x = np.asarray(x, dtype=float); t_x = np.asarray(t_x, dtype=float); T = np.asarray(T, dtype=float)
    hyp = np.nan_to_num(hyp2f1(r + x, b + x, a + b + x - 1, t_future / (alpha + T + t_future)), nan=1.0)
    numer = (a + b + x - 1) / (a - 1) * (1 - ((alpha + T) / (alpha + T + t_future)) ** (r + x) * hyp)
    log_denom = (
        np.log(a) - np.log(b + x - 1)
        - (r + x) * np.log(alpha + t_x) + (r + x) * np.log(alpha + T)
    )
    denom = 1 + np.where(x > 0, np.exp(np.clip(log_denom, -50, 50)), 0.0)
    expected = numer / denom
    return np.where(np.isfinite(expected) & (expected >= 0), expected, 0.0)


def _gamma_gamma_neg_loglik(params, x, m):
    log_p, log_q, log_v = params
    p = np.exp(log_p); q = np.exp(log_q); v = np.exp(log_v)
    log_lik = (
        gammaln(p * x + q) - gammaln(p * x) - gammaln(q)
        + q * np.log(v) + (p * x - 1) * np.log(m) + (p * x) * np.log(x)
        - (p * x + q) * np.log(v + x * m)
    )
    if not np.isfinite(log_lik).all():
        return 1e10
    return -float(np.sum(log_lik))


def fit_gamma_gamma(x, m):
    mask = (x > 0) & (m > 0)
    x = np.asarray(x[mask], dtype=float); m = np.asarray(m[mask], dtype=float)
    if len(x) < 5:
        return None
    best = None
    for seed in [np.array([0.0, 0.0, np.log(np.mean(m))]), np.array([0.5, 0.5, np.log(np.mean(m))]),
                 np.array([-0.5, 1.0, np.log(np.mean(m))])]:
        try:
            res = minimize(_gamma_gamma_neg_loglik, seed, args=(x, m), method="Nelder-Mead",
                           options={"xatol": 1e-5, "fatol": 1e-5, "maxiter": 2000})
            if best is None or res.fun < best.fun:
                best = res
        except Exception:
            continue
    if best is None or not np.isfinite(best.fun):
        return None
    p, q, v = np.exp(best.x)
    return {"p": float(p), "q": float(q), "v": float(v)}


def gamma_gamma_predict_avg(params, x, m, fallback_m):
    if params is None or params["q"] <= 1:
        return np.where(x > 0, m, fallback_m)
    p, q, v = params["p"], params["q"], params["v"]
    pop_mean = (p * v) / (q - 1)
    weight = (q - 1) / (p * x + q - 1)
    weight = np.where(x > 0, weight, 1.0)
    individual = (p * x) / (p * x + q - 1) * np.where(x > 0, m, 0)
    return weight * pop_mean + individual


def quantile_tier(values):
    s = pd.Series(values)
    try:
        ranks = pd.qcut(s.rank(method="first"), q=4, labels=["低价值", "中价值", "高价值", "顶级价值"])
        return ranks.astype(str).values
    except (ValueError, TypeError):
        return np.array(["中价值"] * len(values))


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    cols = detect_columns(df)
    missing = [k for k in ["customer", "frequency", "recency", "T", "monetary"] if cols[k] is None]
    if missing:
        label_map = {"customer": "customer_id", "frequency": "frequency", "recency": "recency",
                     "T": "T(观察期)", "monetary": "monetary"}
        return {"error": f"缺少必需字段: {', '.join(label_map[k] for k in missing)}", "results": {}}

    work = pd.DataFrame()
    work["customer_id"] = df[cols["customer"]].astype(str)
    work["frequency"] = pd.to_numeric(df[cols["frequency"]], errors="coerce")
    work["recency"] = pd.to_numeric(df[cols["recency"]], errors="coerce")
    work["T"] = pd.to_numeric(df[cols["T"]], errors="coerce")
    work["monetary"] = pd.to_numeric(df[cols["monetary"]], errors="coerce").fillna(0)
    work = work.dropna(subset=["frequency", "recency", "T"])
    work = work[(work["frequency"] >= 0) & (work["recency"] >= 0) & (work["T"] > 0) & (work["recency"] <= work["T"])]

    if len(work) < 10:
        return {"error": f"有效客户数过少 ({len(work)}), 至少需要 10 个客户进行 BG/NBD 拟合", "results": {}}

    horizon = float(opts.get("horizon_days", 365))
    discount = float(opts.get("discount_rate", 0))

    bgnbd = fit_bgnbd(work["frequency"].values, work["recency"].values, work["T"].values)
    fallback = False
    if bgnbd is None:
        fallback = True
        rate = work["frequency"].sum() / work["T"].sum() if work["T"].sum() > 0 else 0
        expected = np.full(len(work), rate * horizon)
    else:
        expected = bgnbd_expected_purchases(bgnbd, work["frequency"].values, work["recency"].values, work["T"].values, horizon)

    gg = fit_gamma_gamma(work["frequency"].values, work["monetary"].values)
    fallback_m = float(work[work["monetary"] > 0]["monetary"].mean()) if (work["monetary"] > 0).any() else 0.0
    if np.isnan(fallback_m):
        fallback_m = 0.0
    avg_value = gamma_gamma_predict_avg(gg, work["frequency"].values, work["monetary"].values, fallback_m)

    if discount > 0:
        years = horizon / 365.0
        discount_factor = 1.0 / ((1 + discount) ** (years / 2))
    else:
        discount_factor = 1.0
    clv = expected * avg_value * discount_factor

    work["expected_purchases"] = np.round(expected, 4)
    work["predicted_avg_value"] = np.round(avg_value, 2)
    work["clv"] = np.round(clv, 2)
    work["tier"] = quantile_tier(clv)

    tier_summary = []
    total = len(work)
    for tier_name, group in work.groupby("tier"):
        tier_summary.append({
            "tier": tier_name,
            "size": int(len(group)),
            "ratio": round(float(len(group) / total), 4),
            "avg_clv": round(float(group["clv"].mean()), 2),
            "avg_expected_purchases": round(float(group["expected_purchases"].mean()), 4),
            "avg_predicted_value": round(float(group["predicted_avg_value"].mean()), 2),
            "total_clv": round(float(group["clv"].sum()), 2),
        })
    tier_order = {"顶级价值": 0, "高价值": 1, "中价值": 2, "低价值": 3}
    tier_summary.sort(key=lambda x: tier_order.get(x["tier"], 99))

    overall = {
        "customers": total,
        "horizonDays": int(horizon),
        "discountRate": discount,
        "totalCLV": round(float(work["clv"].sum()), 2),
        "avgCLV": round(float(work["clv"].mean()), 2),
        "avgExpectedPurchases": round(float(work["expected_purchases"].mean()), 4),
        "avgPredictedValue": round(float(work["predicted_avg_value"].mean()), 2),
        "fallback": fallback,
        "bgnbdParams": bgnbd if bgnbd else None,
        "gammaGammaParams": gg if gg else None,
    }

    return {"results": {
        "overall": overall,
        "tiers": tier_summary,
        "topCustomers": work.nlargest(min(20, total), "clv")[["customer_id", "expected_purchases", "predicted_avg_value", "clv", "tier"]].to_dict(orient="records"),
    }}


def format_md(result):
    lines = ["# 客户终身价值预测报告 (BG/NBD + Gamma-Gamma)\n"]
    r = result.get("results", {})
    if not r:
        lines.append("（无有效分析结果）\n")
        return "\n".join(lines)
    o = r.get("overall", {})
    lines.append(f"- 客户数: {o.get('customers', '-')}")
    lines.append(f"- 预测期: {o.get('horizonDays', '-')} 天")
    lines.append(f"- 贴现率: {o.get('discountRate', 0)}")
    lines.append(f"- CLV 合计: {o.get('totalCLV', '-')}")
    lines.append(f"- 平均 CLV: {o.get('avgCLV', '-')}")
    lines.append(f"- 平均期望交易数: {o.get('avgExpectedPurchases', '-')}")
    lines.append(f"- 平均预测客单价: {o.get('avgPredictedValue', '-')}")
    if o.get("fallback"):
        lines.append("- ⚠ BG/NBD 拟合失败，已回退为均值估计")
    if o.get("bgnbdParams"):
        p = o["bgnbdParams"]
        lines.append(f"- BG/NBD 参数: r={p['r']:.4f}, α={p['alpha']:.4f}, a={p['a']:.4f}, b={p['b']:.4f}")
    if o.get("gammaGammaParams"):
        p = o["gammaGammaParams"]
        lines.append(f"- Gamma-Gamma 参数: p={p['p']:.4f}, q={p['q']:.4f}, v={p['v']:.4f}")
    lines.append("")

    tiers = r.get("tiers", [])
    if tiers:
        lines.append("## 价值分层\n")
        lines.append("| 分层 | 规模 | 占比 | 均CLV | 总CLV | 均期望交易 | 均预测客单 |")
        lines.append("|------|------|------|-------|-------|-----------|-----------|")
        for t in tiers:
            lines.append(
                f"| {t['tier']} | {t['size']} | {t['ratio']:.2%} | {t['avg_clv']} | {t['total_clv']} | {t['avg_expected_purchases']} | {t['avg_predicted_value']} |"
            )
        lines.append("")

    top = r.get("topCustomers", [])
    if top:
        lines.append("## TOP 客户预测（脱敏 ID）\n")
        lines.append("| customer_id | 期望交易 | 预测客单 | CLV | 分层 |")
        lines.append("|-------------|---------|---------|-----|------|")
        for c in top:
            lines.append(f"| {c['customer_id']} | {c['expected_purchases']} | {c['predicted_avg_value']} | {c['clv']} | {c['tier']} |")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="客户终身价值预测 (BG/NBD + Gamma-Gamma)",
        param_defs=[
            {"name": "horizon_days", "type": float, "default": 365},
            {"name": "discount_rate", "type": float, "default": 0},
        ],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="clv",
    )
