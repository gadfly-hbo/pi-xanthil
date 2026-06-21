import pandas as pd
from pathlib import Path
from itertools import permutations

ROOT = Path(r"E:\opendata-os\Projects\22-哈尔滨3家店铺人群画像")
CATEGORY_FILE = ROOT / "draw_data" / "2-品类结构-森马数据" / "1-品类结构-森马数据4084-2026-06-19-18-15-30.xlsx"
LINKAGE_FILE = ROOT / "draw_data" / "3-品类连带-EZR" / "哈尔滨3家店_会员订单明细_1_457975_628.xlsx"
OUTPUT_DIR = ROOT / "clean_data" / "4-会员购买商品分析"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def num(v, default=0.0):
    try:
        if pd.isna(v) or str(v).strip() == "":
            return default
        return float(v)
    except Exception:
        return default

def category_from_name(name):
    s = str(name)
    if not s or s.lower() == "nan":
        return "未识别"
    rules = [
        ("羽绒服", ["羽绒"]),
        ("茄克", ["茄克", "夹克"]),
        ("牛仔裤", ["牛仔裤"]),
        ("休闲裤", ["休闲裤", "阔腿裤", "长裤", "裤女", "裤男", "裙裤"]),
        ("短裤", ["短裤"]),
        ("T恤", ["T恤", "短袖", "针织衫"]),
        ("衬衫", ["衬衫"]),
        ("卫衣", ["卫衣"]),
        ("毛衫", ["毛衫", "毛衣", "针织开衫"]),
        ("连衣裙", ["连衣裙", "裙"]),
        ("内搭", ["背心", "吊带"]),
        ("鞋袜配", ["袜", "帽", "包", "鞋"]),
    ]
    for cat, kws in rules:
        if any(kw in s for kw in kws):
            return cat
    return "其他"

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

def process_category(df_cat, store_name):
    d = df_cat[df_cat["店铺"].astype(str).str.strip() == store_name].copy()
    if d.empty:
        return None

    d["零售额"] = d["零售额本期值"].map(num)
    total = d["零售额"].sum()
    cat = d.groupby("中类", as_index=False)["零售额"].sum().sort_values("零售额", ascending=False)
    cat["占比"] = cat["零售额"] / total if total else 0
    
    top10 = cat.head(10).copy()
    top10.insert(0, "排名", range(1, len(top10) + 1))
    top10["零售额"] = top10["零售额"].map(lambda x: f"{x:,.2f}")
    top10["占比"] = top10["占比"].map(lambda x: f"{x*100:.2f}%")
    
    if len(cat) == 0:
        return None

    top1 = cat.iloc[0]
    top3_share = cat.head(3)["零售额"].sum() / total if total else 0
    
    sku_top = d.groupby(["款号", "中类"], as_index=False)["零售额"].sum().sort_values("零售额", ascending=False).head(5)
    sku_top.insert(0, "排名", range(1, len(sku_top) + 1))
    sku_top["零售额"] = sku_top["零售额"].map(lambda x: f"{x:,.2f}")
    
    overview = pd.DataFrame([
        ["总零售额", f"{total:,.2f}"],
        ["覆盖中类数", int(cat["中类"].nunique())],
        ["TOP1中类", f"{top1['中类']}（{top1['零售额']/total*100:.2f}%）"],
        ["TOP3合计占比", f"{top3_share*100:.2f}%"],
    ], columns=["指标", "数值"])

    return f"""## 3.1 商品结构分析

### 数据概览

{md_table(overview)}

#### TOP10品类结构

{md_table(top10)}

#### 核心压舱石单品

{md_table(sku_top)}

### 结构诊断
- [内容待补充]

### 关键发现
- [内容待补充]

### 动作建议
- [内容待补充]
"""

def process_linkage(df_link, store_name):
    # 根据店铺名称映射连带表名称
    store_map = {
        "森马哈尔滨中央大街三店": "黑龙江省哈尔滨市道里区中央大街三森马店", # 根据常见情况推测, 这里用匹配包含词
        "森马哈尔滨中央大街五店": "黑龙江省哈尔滨市道里区中央大街五森马店",
        "森马哈尔滨哈西服装城MALL": "黑龙江省哈尔滨市南岗区哈西服装城森马MALL店"
    }
    
    d = df_link[df_link["订单销售门店名称"].str.contains(store_name.replace("森马","").replace("MALL",""), na=False)].copy()
    if d.empty:
        # 尝试直接等于
        d = df_link[df_link["订单销售门店名称"].astype(str).str.strip() == store_name].copy()

    if d.empty:
        return f"""## 3.2 商品连带分析\n\n- [暂无对应连带明细数据]\n"""

    d = d.drop_duplicates(subset=["订单编号", "手机", "商品名称"])
    d["中类"] = d["商品名称"].map(category_from_name)
    valid = d[(d["手机"].astype(str).str.strip() != "") & (d["中类"] != "未识别")].copy()
    user_cats = valid.groupby("手机")["中类"].apply(lambda x: sorted(set(x))).to_dict()
    
    effective_users = len(user_cats)
    category_users = valid.groupby("中类")["手机"].nunique().sort_values(ascending=False)
    if len(category_users) == 0:
        return f"""## 3.2 商品连带分析\n\n- [暂无可计算品类连带组合]\n"""
        
    top_cats = list(category_users.head(8).index)
    matrix = []
    for a in top_cats:
        row = {"A品类": a, "A品类用户数": int(category_users[a])}
        users_a = {u for u, cats in user_cats.items() if a in cats}
        for b in top_cats:
            if a == b:
                row[b] = "-"
            else:
                users_b = {u for u, cats in user_cats.items() if b in cats}
                row[b] = f"{(len(users_a & users_b) / len(users_a) * 100 if users_a else 0):.2f}%"
        matrix.append(row)
    
    matrix_df = pd.DataFrame(matrix)
    pairs = []
    for a, b in permutations(top_cats, 2):
        users_a = {u for u, cats in user_cats.items() if a in cats}
        users_b = {u for u, cats in user_cats.items() if b in cats}
        if not users_a:
            continue
        both = len(users_a & users_b)
        prob = both / len(users_a)
        if both > 0:
            pairs.append((a, b, len(users_a), both, prob))
            
    pair_df = pd.DataFrame(sorted(pairs, key=lambda x: (-x[4], -x[3]))[:5], columns=["A品类", "B品类", "A品类用户数", "同时购买用户数", "P(B|A)"])
    if not pair_df.empty:
        pair_df["P(B|A)"] = pair_df["P(B|A)"].map(lambda x: f"{x*100:.2f}%")
        
    overview = pd.DataFrame([
        ["有效用户数", f"{effective_users:,}"],
        ["有效订单数", f"{valid['订单编号'].nunique():,}"],
        ["覆盖品类数", f"{valid['中类'].nunique():,}"],
        ["品类识别口径", "根据商品名称关键词归类"],
    ], columns=["指标", "数值"])

    return f"""## 3.2 商品连带分析

### 数据概览

{md_table(overview)}

#### 连带概率矩阵 P(B|A)

{md_table(matrix_df)}

#### 高连带组合TOP5

{md_table(pair_df) if not pair_df.empty else '[暂无连带数据]'}

### 结构诊断
- [内容待补充]

### 关键发现
- [内容待补充]

### 动作建议
- [内容待补充]
"""

def main():
    if not CATEGORY_FILE.exists() or not LINKAGE_FILE.exists():
        print("未找到输入文件！")
        return
        
    df_cat = pd.read_excel(CATEGORY_FILE).fillna("")
    df_link = pd.read_excel(LINKAGE_FILE).fillna("")

    stores = df_cat["店铺"].unique()
    for store in stores:
        store_name = str(store).strip()
        if not store_name:
            continue
            
        cat_report = process_category(df_cat, store_name)
        if not cat_report:
            continue
            
        link_report = process_linkage(df_link, store_name)
        
        content = f"""# {store_name} 会员购买商品分析

{cat_report}
{link_report}
"""
        output_path = OUTPUT_DIR / f"{store_name}_会员购买商品分析.md"
        output_path.write_text(content, encoding="utf-8")
        print(f"已生成报告: {output_path}")

if __name__ == "__main__":
    main()
