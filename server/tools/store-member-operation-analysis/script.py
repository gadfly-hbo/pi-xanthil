import pandas as pd
from pathlib import Path
import re

ROOT = Path(r"E:\opendata-os\Projects\22-哈尔滨3家店铺人群画像")
INPUT_FILE = ROOT / "draw_data" / "1-会员运营核心指标-森马数据" / "2-会员运营核心指标-森马数据3827-2026-06-19-18-11-33.xlsx"
OUTPUT_DIR = ROOT / "clean_data" / "3-门店会员运营分析"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def num(v, default=0.0):
    try:
        if pd.isna(v) or str(v).strip() == "":
            return default
        return float(v)
    except Exception:
        return default

def money(v):
    return f"{num(v):,.2f}"

def intfmt(v):
    return f"{int(round(num(v))):,}"

def pct_ratio(v):
    return f"{num(v) * 100:.2f}%"

def yoy_text(v):
    value = num(v)
    if value == 0:
        return "无可比同期数据"
    return f"{value * 100:+.2f}%"

def md_table(df):
    if df is None or df.empty:
        return ""
    cols = [str(c) for c in df.columns]
    lines = [
        "| " + " | ".join(cols) + " |",
        "| " + " | ".join(["---"] * len(cols)) + " |",
    ]
    for _, row in df.iterrows():
        vals = [str(row[c]).replace("\n", " ") for c in df.columns]
        lines.append("| " + " | ".join(vals) + " |")
    return "\n".join(lines)

def generate_report(row):
    store_name = str(row["店铺"]).strip()
    
    # 获取指标字典的辅助函数
    def get_metrics(base_name):
        return [
            money(row.get(f"{base_name}本期值", 0)) if "额" in base_name or "价" in base_name or "贡献" in base_name else
            pct_ratio(row.get(f"{base_name}本期值", 0)) if "率" in base_name or "比" in base_name else
            intfmt(row.get(f"{base_name}本期值", 0)) if "人数" in base_name or "数" in base_name else
            f"{num(row.get(f'{base_name}本期值', 0)):.2f}",
            
            money(row.get(f"{base_name}同期值", 0)) if "额" in base_name or "价" in base_name or "贡献" in base_name else
            pct_ratio(row.get(f"{base_name}同期值", 0)) if "率" in base_name or "比" in base_name else
            intfmt(row.get(f"{base_name}同期值", 0)) if "人数" in base_name or "数" in base_name else
            f"{num(row.get(f'{base_name}同期值', 0)):.2f}" if row.get(f"{base_name}同期值") else "-",
            
            yoy_text(row.get(f"{base_name}同比")) if "率" not in base_name and "比" not in base_name else
            f"{num(row.get(f'{base_name}同比', 0))*100:+.4f}pts" if pd.notna(row.get(f"{base_name}同比")) else "-"
        ]

    table_data = [
        ["会员零售额"] + get_metrics("会员零售额"),
        ["整体零售额"] + get_metrics("零售额"),
        ["会员购买人数"] + get_metrics("会员购买人数"),
        ["会员购买订单数"] + get_metrics("会员购买订单数"),
        ["会员购买件数"] + get_metrics("会员购买件数"),
        ["会员购买频次"] + get_metrics("会员购买频次"),
        ["会员客单价"] + get_metrics("会员客单价"),
        ["会员人均贡献"] + get_metrics("会员人均贡献"),
        ["会员复购人数"] + get_metrics("会员复购人数"),
        ["会员复购率"] + get_metrics("会员复购率"),
        ["存量会员人数"] + get_metrics("存量会员人数"),
        ["开卡人数"] + get_metrics("开卡人数"),
        ["开卡购买人数"] + get_metrics("开卡购买人数"),
        ["开卡购买转化率"] + get_metrics("会员开卡购买转化率"),
        ["入会率"] + get_metrics("入会率"),
        ["会员销售占比"] + get_metrics("会销比"),
    ]

    table = pd.DataFrame(table_data, columns=["指标", "本期", "同期", "同比/变化"])

    content = f"""# {store_name} 会员及零售对比分析报告

## 关键指标对比

{md_table(table)}

## 结构诊断
- [内容待补充]

## 关键发现
- [内容待补充]

## 动作建议
- [内容待补充]
"""
    output_path = OUTPUT_DIR / f"{store_name}_门店会员运营分析.md"
    output_path.write_text(content, encoding="utf-8")
    print(f"已生成报告: {output_path}")

def main():
    if not INPUT_FILE.exists():
        print(f"未找到输入文件: {INPUT_FILE}")
        return
        
    df = pd.read_excel(INPUT_FILE).fillna("")
    for _, row in df.iterrows():
        store_name = str(row.get("店铺", "")).strip()
        if not store_name:
            continue
        generate_report(row)

if __name__ == "__main__":
    main()
