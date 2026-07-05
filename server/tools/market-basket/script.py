#!/usr/bin/env python3
"""购物篮关联规则分析：纯 numpy/pandas 实现 Apriori。

期望订单-商品级 CSV：
  - 长表: order_id, item (每行 order×item，一对多)
  - 宽表: order_id, items (items 为分隔符串)

输出频繁项集与关联规则 (support / confidence / lift) 聚合产物。
"""
import sys
import os
import re
from itertools import combinations

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _tool_utils import find_col, main_tool


ORDER_ALIASES = ["order_id", "orderid", "order", "transaction_id", "tx_id", "订单号", "订单id", "交易号"]
ITEM_ALIASES = ["item", "sku", "product_id", "product", "商品", "商品id", "商品编码", "商品名称", "品名"]
ITEMS_LIST_ALIASES = ["items", "item_list", "products", "商品列表", "商品集合"]

ITEM_SPLIT_RE = re.compile(r"[,，;；|\s]+")


def detect_columns(df):
    return {
        "order": find_col(df, ORDER_ALIASES),
        "item": find_col(df, ITEM_ALIASES),
        "items_list": find_col(df, ITEMS_LIST_ALIASES),
    }


def _is_wide_column(df, col):
    """Check if column values contain delimiters, indicating wide format."""
    sample = df[col].dropna().astype(str).head(20)
    if sample.empty:
        return False
    return any(ITEM_SPLIT_RE.search(v) for v in sample)


def build_transactions(df, cols):
    """Return list[set[str]] of transactions (deduped per order)."""
    if cols["order"] is None:
        raise ValueError("缺少必需字段: order_id")

    same_col = cols["item"] is not None and cols["item"] == cols["items_list"]
    use_wide = cols["items_list"] is not None and (
        cols["item"] is None or same_col and _is_wide_column(df, cols["items_list"])
    )

    if not use_wide and cols["item"] is not None:
        long_df = df[[cols["order"], cols["item"]]].copy()
        long_df.columns = ["order_id", "item"]
        long_df["order_id"] = long_df["order_id"].astype(str)
        long_df["item"] = long_df["item"].astype(str).str.strip()
        long_df = long_df[long_df["item"] != ""]
        return [set(items) for _, items in long_df.groupby("order_id")["item"]]

    if cols["items_list"] is not None:
        wide_df = df[[cols["order"], cols["items_list"]]].copy()
        wide_df.columns = ["order_id", "items"]
        transactions = []
        for _, row in wide_df.iterrows():
            raw = str(row["items"] or "").strip()
            if not raw:
                continue
            parts = {p.strip() for p in ITEM_SPLIT_RE.split(raw) if p.strip()}
            if parts:
                transactions.append(parts)
        return transactions

    raise ValueError("缺少必需字段: item 或 items 列")


def _encode(transactions):
    """Encode transactions as boolean DataFrame (orders × items)."""
    items = sorted({i for txn in transactions for i in txn})
    item_index = {item: idx for idx, item in enumerate(items)}
    matrix = np.zeros((len(transactions), len(items)), dtype=bool)
    for row, txn in enumerate(transactions):
        for it in txn:
            matrix[row, item_index[it]] = True
    return matrix, items


def apriori(transactions, min_support, max_len):
    """Pure-numpy Apriori. Returns list of (frozenset, support)."""
    matrix, items = _encode(transactions)
    n = matrix.shape[0]
    if n == 0 or not items:
        return []

    counts = matrix.sum(axis=0)
    supports = counts / n
    keep_mask = supports >= min_support
    if not keep_mask.any():
        return []

    keep_idx = np.where(keep_mask)[0]
    one_itemsets = [(frozenset([items[i]]), float(supports[i])) for i in keep_idx]
    all_itemsets = list(one_itemsets)

    prev_idx_sets = [(i,) for i in keep_idx]

    for k in range(2, max(2, int(max_len)) + 1):
        if not prev_idx_sets:
            break
        candidate_set = set()
        prev_set_keys = {tuple(sorted(s)) for s in prev_idx_sets}
        for i in range(len(prev_idx_sets)):
            for j in range(i + 1, len(prev_idx_sets)):
                a = prev_idx_sets[i]
                b = prev_idx_sets[j]
                if k > 2 and a[:-1] != b[:-1]:
                    continue
                merged = tuple(sorted(set(a) | set(b)))
                if len(merged) != k:
                    continue
                if all(tuple(sorted(set(merged) - {x})) in prev_set_keys for x in merged):
                    candidate_set.add(merged)
        if not candidate_set:
            break

        next_idx_sets = []
        for cand in candidate_set:
            sub = matrix[:, list(cand)]
            count = int(sub.all(axis=1).sum())
            sup = count / n
            if sup >= min_support:
                next_idx_sets.append(cand)
                all_itemsets.append((frozenset(items[i] for i in cand), float(sup)))
        prev_idx_sets = sorted(next_idx_sets)

    return all_itemsets


def derive_rules(itemsets, min_confidence):
    """Generate (antecedent, consequent, support, confidence, lift) tuples."""
    sup_lookup = {fs: sup for fs, sup in itemsets}
    rules = []
    for itemset, sup in itemsets:
        if len(itemset) < 2:
            continue
        items = list(itemset)
        for r in range(1, len(items)):
            for ante in combinations(items, r):
                ante_fs = frozenset(ante)
                cons_fs = itemset - ante_fs
                if not cons_fs or ante_fs not in sup_lookup or cons_fs not in sup_lookup:
                    continue
                sup_a = sup_lookup[ante_fs]
                sup_c = sup_lookup[cons_fs]
                conf = sup / sup_a if sup_a > 0 else 0.0
                if conf < min_confidence:
                    continue
                lift = conf / sup_c if sup_c > 0 else 0.0
                rules.append({
                    "antecedent": sorted(ante_fs),
                    "consequent": sorted(cons_fs),
                    "support": round(float(sup), 6),
                    "confidence": round(float(conf), 6),
                    "lift": round(float(lift), 6),
                })
    rules.sort(key=lambda r: (r["lift"], r["confidence"], r["support"]), reverse=True)
    return rules


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    cols = detect_columns(df)
    if cols["order"] is None:
        return {"error": "缺少必需字段: order_id", "results": {}}
    if cols["item"] is None and cols["items_list"] is None:
        return {"error": "缺少必需字段: item 或 items 列", "results": {}}

    try:
        transactions = build_transactions(df, cols)
    except ValueError as e:
        return {"error": str(e), "results": {}}

    transactions = [t for t in transactions if t]
    if len(transactions) < 5:
        return {"error": f"订单数过少 ({len(transactions)}), 至少需要 5 个订单", "results": {}}

    min_support = float(opts.get("min_support", 0.02))
    min_confidence = float(opts.get("min_confidence", 0.3))
    max_len = int(float(opts.get("max_len", 3)))
    top_n = int(float(opts.get("top_n", 30)))

    itemsets = apriori(transactions, min_support=min_support, max_len=max_len)
    rules = derive_rules(itemsets, min_confidence=min_confidence)

    sorted_itemsets = sorted(itemsets, key=lambda x: (x[1], len(x[0])), reverse=True)
    top_itemsets = [
        {"items": sorted(fs), "size": len(fs), "support": round(float(sup), 6)}
        for fs, sup in sorted_itemsets[:top_n]
    ]

    unique_items = sorted({i for txn in transactions for i in txn})
    overall = {
        "orders": len(transactions),
        "uniqueItems": len(unique_items),
        "minSupport": min_support,
        "minConfidence": min_confidence,
        "maxLen": max_len,
        "frequentItemsets": len(itemsets),
        "rules": len(rules),
    }

    return {"results": {
        "overall": overall,
        "itemsets": top_itemsets,
        "topRules": rules[:top_n],
    }}


def format_md(result):
    lines = ["# 购物篮关联规则分析报告 (Apriori)\n"]
    r = result.get("results", {})
    if not r:
        lines.append("（无有效分析结果）\n")
        return "\n".join(lines)

    o = r.get("overall", {})
    lines.append(f"- 订单数: {o.get('orders', '-')}")
    lines.append(f"- 商品数: {o.get('uniqueItems', '-')}")
    lines.append(f"- 频繁项集数: {o.get('frequentItemsets', '-')}")
    lines.append(f"- 规则数: {o.get('rules', '-')}")
    lines.append(f"- 参数: min_support={o.get('minSupport')} · min_confidence={o.get('minConfidence')} · max_len={o.get('maxLen')}")
    lines.append("")

    itemsets = r.get("itemsets", [])
    if itemsets:
        lines.append("## Top 频繁项集\n")
        lines.append("| 项集 | 长度 | 支持度 |")
        lines.append("|------|------|--------|")
        for it in itemsets:
            items_str = " + ".join(it["items"])
            lines.append(f"| {items_str} | {it['size']} | {it['support']:.4f} |")
        lines.append("")

    rules = r.get("topRules", [])
    if rules:
        lines.append("## Top 关联规则 (按 lift 排序)\n")
        lines.append("| 前件 | → | 后件 | 支持度 | 置信度 | lift |")
        lines.append("|------|---|------|--------|--------|------|")
        for ru in rules:
            ante = " + ".join(ru["antecedent"])
            cons = " + ".join(ru["consequent"])
            lines.append(f"| {ante} | → | {cons} | {ru['support']:.4f} | {ru['confidence']:.4f} | {ru['lift']:.4f} |")
        lines.append("")
    else:
        lines.append("## Top 关联规则\n")
        lines.append("（未发现满足 min_confidence 的规则，可适当降低 min_support / min_confidence）\n")

    return "\n".join(lines)


if __name__ == "__main__":
    main_tool(
        description="购物篮关联规则分析 (Apriori)",
        param_defs=[
            {"name": "min_support", "type": float, "default": 0.02},
            {"name": "min_confidence", "type": float, "default": 0.3},
            {"name": "max_len", "type": float, "default": 3},
            {"name": "top_n", "type": float, "default": 30},
        ],
        process_fn=process_file,
        format_fn=format_md,
        report_suffix="market_basket",
    )
