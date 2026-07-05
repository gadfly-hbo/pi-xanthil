#!/usr/bin/env python3
"""Pure-numpy K-means clustering with elbow + silhouette model selection."""
import sys
import os

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool


ID_ALIASES = ["entity_id", "id", "customer_id", "customerid", "user_id", "uid", "sku", "product_id", "member_id", "顾客id", "用户id", "客户id", "实体id"]


def detect_id_column(df):
    """Pick id column: alias match, else fallback to first non-numeric, else first column."""
    found = find_col(df, ID_ALIASES)
    if found is not None:
        return found
    for c in df.columns:
        if df[c].dtype == object:
            return c
    return df.columns[0]


def select_numeric_features(df, id_col):
    feats = []
    for c in df.columns:
        if c == id_col:
            continue
        col = pd.to_numeric(df[c], errors="coerce")
        if col.notna().sum() >= max(5, int(0.5 * len(df))):
            feats.append((c, col.fillna(col.median())))
    if not feats:
        return [], pd.DataFrame()
    feat_names = [c for c, _ in feats]
    feat_df = pd.DataFrame({c: vals.values for c, vals in feats})
    return feat_names, feat_df


def standardize(X):
    mu = X.mean(axis=0)
    sigma = X.std(axis=0, ddof=0)
    sigma = np.where(sigma == 0, 1.0, sigma)
    return (X - mu) / sigma, mu, sigma


def kmeans_pp_init(X, k, rng):
    n = X.shape[0]
    centers = np.empty((k, X.shape[1]), dtype=float)
    first = rng.integers(0, n)
    centers[0] = X[first]
    closest_sq = np.sum((X - centers[0]) ** 2, axis=1)
    for i in range(1, k):
        total = closest_sq.sum()
        if total <= 0:
            centers[i] = X[rng.integers(0, n)]
        else:
            probs = closest_sq / total
            idx = rng.choice(n, p=probs)
            centers[i] = X[idx]
        new_dist = np.sum((X - centers[i]) ** 2, axis=1)
        closest_sq = np.minimum(closest_sq, new_dist)
    return centers


def kmeans_single(X, k, max_iter, rng):
    centers = kmeans_pp_init(X, k, rng)
    labels = np.zeros(X.shape[0], dtype=int)
    for _ in range(max_iter):
        dists = np.empty((X.shape[0], k), dtype=float)
        for j in range(k):
            dists[:, j] = np.sum((X - centers[j]) ** 2, axis=1)
        new_labels = dists.argmin(axis=1)
        if np.array_equal(new_labels, labels):
            labels = new_labels
            break
        labels = new_labels
        for j in range(k):
            mask = labels == j
            if mask.any():
                centers[j] = X[mask].mean(axis=0)
            else:
                centers[j] = X[rng.integers(0, X.shape[0])]
    inertia = float(np.sum((X - centers[labels]) ** 2))
    return centers, labels, inertia


def kmeans(X, k, n_init, max_iter, seed):
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(n_init):
        centers, labels, inertia = kmeans_single(X, k, max_iter, np.random.default_rng(rng.integers(0, 2**31 - 1)))
        if best is None or inertia < best[2]:
            best = (centers, labels, inertia)
    return best


def silhouette_sample(X, labels, max_samples=1500, seed=42):
    n = X.shape[0]
    rng = np.random.default_rng(seed)
    if n > max_samples:
        idx = rng.choice(n, size=max_samples, replace=False)
        Xs = X[idx]; ls = labels[idx]
    else:
        Xs = X; ls = labels
    unique = np.unique(ls)
    if len(unique) < 2:
        return 0.0
    scores = np.zeros(len(Xs))
    for i in range(len(Xs)):
        own = ls[i]
        same = ls == own
        same[i] = False
        if same.sum() == 0:
            scores[i] = 0.0
            continue
        a = float(np.mean(np.linalg.norm(Xs[same] - Xs[i], axis=1)))
        b = np.inf
        for cl in unique:
            if cl == own:
                continue
            other = ls == cl
            if other.any():
                d = float(np.mean(np.linalg.norm(Xs[other] - Xs[i], axis=1)))
                if d < b:
                    b = d
        if b == np.inf:
            scores[i] = 0.0
        else:
            scores[i] = (b - a) / max(a, b) if max(a, b) > 0 else 0.0
    return float(np.mean(scores))


def select_k(inertias, silhouettes, ks):
    """Combine elbow improvement ratio with silhouette to pick k."""
    if len(ks) == 1:
        return ks[0]
    sil_arr = np.array(silhouettes)
    inertia_arr = np.array(inertias)
    sil_norm = (sil_arr - sil_arr.min()) / (sil_arr.max() - sil_arr.min() + 1e-12)
    drops = np.zeros_like(inertia_arr)
    drops[0] = 0.0
    for i in range(1, len(inertia_arr)):
        prev = inertia_arr[i - 1]
        drops[i] = (prev - inertia_arr[i]) / prev if prev > 0 else 0.0
    drop_norm = (drops - drops.min()) / (drops.max() - drops.min() + 1e-12)
    score = 0.6 * sil_norm + 0.4 * drop_norm
    return int(ks[int(np.argmax(score))])


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    id_col = detect_id_column(df)
    feat_names, feat_df = select_numeric_features(df, id_col)
    if len(feat_names) < 2:
        return {"error": f"可用数值特征过少 ({len(feat_names)}), 至少需要 2 个数值列", "results": {}}

    k_min = max(2, int(float(opts.get("k_min", 2))))
    k_max = min(20, int(float(opts.get("k_max", 8))))
    if k_max < k_min:
        k_max = k_min
    n_init = max(1, int(float(opts.get("n_init", 10))))
    max_iter = max(50, int(float(opts.get("max_iter", 300))))
    seed = int(float(opts.get("random_state", 42)))

    n_samples = len(feat_df)
    if n_samples < k_max:
        return {"error": f"样本数过少 ({n_samples}), 小于 k_max={k_max}", "results": {}}

    X_raw = feat_df.values.astype(float)
    X_std, mu, sigma = standardize(X_raw)

    ks = list(range(k_min, k_max + 1))
    inertias = []
    silhouettes = []
    fits = {}
    fallback = False
    fallback_reasons = []
    for k in ks:
        try:
            centers, labels, inertia = kmeans(X_std, k, n_init=n_init, max_iter=max_iter, seed=seed + k)
            unique_labels = np.unique(labels)
            if len(unique_labels) < k:
                fallback = True
                fallback_reasons.append(f"k={k} 退化: 仅 {len(unique_labels)} 个非空簇")
            sil = silhouette_sample(X_std, labels, max_samples=1500, seed=seed)
        except (ValueError, RuntimeError) as e:
            fallback = True
            fallback_reasons.append(f"k={k}: {e}")
            inertia = float("inf")
            labels = np.zeros(n_samples, dtype=int)
            centers = np.zeros((k, X_std.shape[1]))
            sil = 0.0
        inertias.append(inertia)
        silhouettes.append(sil)
        fits[k] = (centers, labels, inertia, sil)

    chosen_k = select_k(inertias, silhouettes, ks)
    centers, labels, inertia, sil = fits[chosen_k]

    cluster_summary = []
    for cl in range(chosen_k):
        mask = labels == cl
        size = int(mask.sum())
        if size == 0:
            continue
        std_means = centers[cl].tolist()
        raw_means = (centers[cl] * sigma + mu).tolist()
        cluster_summary.append({
            "cluster": int(cl),
            "size": size,
            "ratio": round(float(size / n_samples), 4),
            "standardized_mean": {feat_names[i]: round(float(std_means[i]), 4) for i in range(len(feat_names))},
            "raw_mean": {feat_names[i]: round(float(raw_means[i]), 4) for i in range(len(feat_names))},
        })
    cluster_summary.sort(key=lambda c: c["size"], reverse=True)

    overall = {
        "samples": n_samples,
        "features": len(feat_names),
        "featureNames": feat_names,
        "idColumn": id_col,
        "k": chosen_k,
        "kRange": [k_min, k_max],
        "inertia": round(float(inertia), 4),
        "silhouette": round(float(sil), 4),
        "fallback": fallback,
        "fallbackReasons": fallback_reasons if fallback else [],
    }

    search_table = [
        {"k": k, "inertia": round(float(inertias[i]), 4), "silhouette": round(float(silhouettes[i]), 4)}
        for i, k in enumerate(ks)
    ]

    return {"results": {
        "overall": overall,
        "search": search_table,
        "clusters": cluster_summary,
    }}


def format_md(result):
    lines = ["# 聚类分群报告 (K-means + 肘部 + 轮廓)\n"]
    r = result.get("results", {})
    if not r:
        lines.append("(无有效分析结果)\n")
        return "\n".join(lines)

    o = r.get("overall", {})
    lines.append(f"- 样本数: {o.get('samples', '-')}")
    lines.append(f"- 数值特征数: {o.get('features', '-')}")
    lines.append(f"- 特征列: {', '.join(o.get('featureNames', []))}")
    lines.append(f"- ID 列: {o.get('idColumn', '-')}")
    lines.append(f"- 选定 k: {o.get('k', '-')} (搜索范围 {o.get('kRange', [])})")
    lines.append(f"- 轮廓系数: {o.get('silhouette', 0):.4f}")
    lines.append(f"- 总 SSE: {o.get('inertia', 0)}")
    if o.get("fallback"):
        lines.append("- 注意: 部分 k 退化, 已自动回退")
    lines.append("")

    search = r.get("search", [])
    if search:
        lines.append("## k 搜索表\n")
        lines.append("| k | inertia | silhouette |")
        lines.append("|---|---|---|")
        for row in search:
            lines.append(f"| {row['k']} | {row['inertia']} | {row['silhouette']:.4f} |")
        lines.append("")

    clusters = r.get("clusters", [])
    if clusters:
        feats = o.get("featureNames", [])
        lines.append("## 各群规模与画像 (原始空间均值)\n")
        header = "| 群 | 规模 | 占比 | " + " | ".join(feats) + " |"
        sep = "|---|---|---|" + "---|" * len(feats)
        lines.append(header)
        lines.append(sep)
        for c in clusters:
            cells = [str(c["cluster"]), str(c["size"]), f"{c['ratio']:.2%}"]
            for f in feats:
                cells.append(str(c["raw_mean"].get(f, "-")))
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")

        lines.append("## 各群标准化空间均值 (z-score)\n")
        header = "| 群 | " + " | ".join(feats) + " |"
        sep = "|---|" + "---|" * len(feats)
        lines.append(header)
        lines.append(sep)
        for c in clusters:
            cells = [str(c["cluster"])]
            for f in feats:
                cells.append(str(c["standardized_mean"].get(f, "-")))
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="聚类分群 (K-means + 肘部 + 轮廓)",
        param_defs=[
            {"name": "k_min", "type": float, "default": 2},
            {"name": "k_max", "type": float, "default": 8},
            {"name": "n_init", "type": float, "default": 10},
            {"name": "max_iter", "type": float, "default": 300},
            {"name": "random_state", "type": float, "default": 42},
        ],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="clustering",
    )
