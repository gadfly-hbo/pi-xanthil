#!/usr/bin/env python3
import argparse
import json
import os
import re
import pandas as pd
import numpy as np


REQUIRED_COLS = ["价格", "吊牌价", "销量", "库存"]
OPTIONAL_COLS = ["入库数量", "订单数", "件数", "商品编号", "SKU编号"]


def parse_price_bands(band_str):
    bands = []
    for part in band_str.split(","):
        part = part.strip()
        m = re.match(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)", part)
        if m:
            bands.append((float(m.group(1)), float(m.group(2))))
        else:
            m2 = re.match(r"(\d+(?:\.\d+)?)\s*\+", part)
            if m2:
                bands.append((float(m2.group(1)), float("inf")))
            else:
                m3 = re.match(r"(\d+(?:\.\d+)?)", part)
                if m3:
                    bands.append((float(m3.group(1)), float(m3.group(1))))
    return bands


def price_band_distribution(df, price_bands):
    bands = parse_price_bands(price_bands)
    results = []
    for low, high in bands:
        if high == float("inf"):
            mask = df["价格"] >= low
            label = f"{int(low)}+"
        else:
            mask = (df["价格"] >= low) & (df["价格"] < high)
            label = f"{int(low)}-{int(high)}"
        subset = df[mask]
        results.append({
            "band": label,
            "skuCount": int(len(subset)),
            "skuRatio": round(len(subset) / max(len(df), 1), 4),
            "totalSales": int(subset["销量"].sum()),
            "salesRatio": round(float(subset["销量"].sum()) / max(float(df["销量"].sum()), 1), 4),
        })
    return results


def calculate_upt(df):
    if "订单数" not in df.columns or "件数" not in df.columns:
        return None
    total_orders = df["订单数"].sum()
    total_qty = df["件数"].sum()
    if total_orders == 0:
        return 0.0
    return round(float(total_qty) / float(total_orders), 2)


def motion_rate(df):
    total_skus = len(df)
    active_skus = int((df["销量"] > 0).sum())
    rate = round(active_skus / max(total_skus, 1), 4)
    return {"totalSkus": total_skus, "activeSkus": active_skus, "motionRate": rate}


def sell_through_rate(df):
    if "入库数量" not in df.columns:
        return None
    total_in = df["入库数量"].sum()
    total_sales = df["销量"].sum()
    if total_in == 0:
        return 0.0
    return round(float(total_sales) / float(total_in), 4)


def inventory_to_sales_ratio(df, window_days=30):
    total_inv = df["库存"].sum()
    total_sales = df["销量"].sum()
    if total_sales == 0:
        return None
    daily_avg_sales = float(total_sales) / max(window_days, 1)
    if daily_avg_sales == 0:
        return None
    return round(float(total_inv) / daily_avg_sales, 2)


def sku_breadth_depth(df):
    if "商品编号" not in df.columns:
        return None
    unique_products = df["商品编号"].nunique()
    total_skus = len(df)
    breadth = unique_products
    depth = round(total_skus / max(unique_products, 1), 2)
    return {"breadth": int(breadth), "depth": depth, "totalSkus": total_skus}


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        return {"error": f"缺少必需字段: {', '.join(missing)}", "results": {}}

    for c in ["价格", "吊牌价", "销量", "库存"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    for c in ["入库数量", "订单数", "件数"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    results = {}

    results["priceBandDistribution"] = price_band_distribution(df, opts.get("price_bands", "0-99,100-199,200-399,400-699,700-999,1000+"))

    upt_val = calculate_upt(df)
    if upt_val is not None:
        results["upt"] = upt_val

    results["motionRate"] = motion_rate(df)

    str_val = sell_through_rate(df)
    if str_val is not None:
        results["sellThroughRate"] = str_val

    inv_ratio = inventory_to_sales_ratio(df, int(opts.get("inventory_window_days", 30)))
    if inv_ratio is not None:
        results["inventoryToSalesRatio"] = inv_ratio

    sd_val = sku_breadth_depth(df)
    if sd_val is not None:
        results["skuBreadthDepth"] = sd_val

    price_stats = df["价格"].describe()
    tag_price_stats = df["吊牌价"].describe()
    results["priceStats"] = {
        "minPrice": round(float(price_stats["min"]), 2),
        "maxPrice": round(float(price_stats["max"]), 2),
        "avgPrice": round(float(price_stats["mean"]), 2),
        "medianPrice": round(float(price_stats["50%"]), 2),
        "avgTagPrice": round(float(tag_price_stats["mean"]), 2),
        "avgDiscountRate": round(float(price_stats["mean"]) / max(float(tag_price_stats["mean"]), 0.01), 4),
    }

    return {"results": results}


def format_md(results):
    lines = []
    lines.append("# 服饰商品结构分析报告\n")

    r = results.get("results", {})
    if not r:
        lines.append("（无有效分析结果）\n")
        return "\n".join(lines)

    ps = r.get("priceStats", {})
    if ps:
        lines.append("## 价格概览\n")
        lines.append(f"| 指标 | 值 |")
        lines.append(f"|------|-----|")
        lines.append(f"| 最低价 | {ps.get('minPrice', '-')} |")
        lines.append(f"| 最高价 | {ps.get('maxPrice', '-')} |")
        lines.append(f"| 均价 | {ps.get('avgPrice', '-')} |")
        lines.append(f"| 中位价 | {ps.get('medianPrice', '-')} |")
        lines.append(f"| 平均吊牌价 | {ps.get('avgTagPrice', '-')} |")
        lines.append(f"| 平均折扣率 | {ps.get('avgDiscountRate', '-')} |")
        lines.append("")

    pb = r.get("priceBandDistribution", [])
    if pb:
        lines.append("## 价格带分布\n")
        lines.append(f"| 价格带 | SKU 数 | SKU 占比 | 销量 | 销量占比 |")
        lines.append(f"|--------|--------|----------|------|----------|")
        for b in pb:
            lines.append(f"| {b['band']} | {b['skuCount']} | {b['skuRatio']:.1%} | {b['totalSales']} | {b['salesRatio']:.1%} |")
        lines.append("")

    if "upt" in r:
        lines.append(f"**连带率 (UPT)**：{r['upt']} 件/单\n")

    mr = r.get("motionRate", {})
    if mr:
        lines.append(f"**动销率**：{mr.get('motionRate', 0):.1%}（{mr.get('activeSkus', 0)}/{mr.get('totalSkus', 0)}）\n")

    if "sellThroughRate" in r:
        lines.append(f"**售罄率**：{r['sellThroughRate']:.1%}\n")

    if "inventoryToSalesRatio" in r:
        lines.append(f"**库销比**：{r['inventoryToSalesRatio']}（天）\n")

    sd = r.get("skuBreadthDepth", {})
    if sd:
        lines.append(f"**SKU 宽度**：{sd.get('breadth', 0)}   **SKU 深度**：{sd.get('depth', 0)}（平均每商品 SKU 数）\n")

    return "\n".join(lines)


def run(input_path, output_path, opts):
    os.makedirs(output_path, exist_ok=True)

    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext != ".csv":
            return {"success": 0, "failed": 1, "error": f"不支持的文件格式: {ext}", "results": []}
        files = [input_path]
    elif os.path.isdir(input_path):
        files = sorted(f for f in os.listdir(input_path) if f.endswith(".csv"))
        files = [os.path.join(input_path, f) for f in files]
    else:
        raise ValueError(f"输入路径不存在: {input_path}")

    if not files:
        return {"success": 0, "failed": 0, "results": []}

    results = []
    for file_path in files:
        try:
            file_result = process_file(file_path, opts)
            file_result["file"] = os.path.basename(file_path)
            if "error" in file_result:
                results.append(file_result)
            else:
                base = os.path.splitext(os.path.basename(file_path))[0]
                md_path = os.path.join(output_path, f"{base}_apparel_structure_report.md")
                json_path = os.path.join(output_path, f"{base}_apparel_structure_report.json")
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(format_md(file_result))
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(file_result["results"], f, ensure_ascii=False, indent=2)
                file_result["outputs"] = [md_path, json_path]
                results.append(file_result)
        except Exception as e:
            results.append({"file": os.path.basename(file_path), "error": str(e), "outputs": []})

    return {
        "success": sum(1 for r in results if "error" not in r or not r.get("error")),
        "failed": sum(1 for r in results if r.get("error")),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="服饰商品结构分析")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    parser.add_argument("--param-price_bands", default="0-99,100-199,200-399,400-699,700-999,1000+")
    parser.add_argument("--param-inventory_window_days", type=int, default=30)
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)
    opts = {"price_bands": args.param_price_bands, "inventory_window_days": args.param_inventory_window_days}

    try:
        summary = run(input_path, output_path, opts)
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[✔] 分析完成: 成功 {summary['success']} 个, 失败 {summary['failed']} 个")
    except Exception as e:
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump({"success": 0, "failed": 1, "error": str(e), "results": []}, f, ensure_ascii=False, indent=2)
        print(f"[ERROR] {e}")
        raise


if __name__ == "__main__":
    main()