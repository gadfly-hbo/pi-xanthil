"""audience_cluster: 基于抖音/电商单品画像的人群分簇工具

业务规则分簇（来自森马抖音官旗 TOP100 分析实战）：
  if 商品名含 '男'         → E_男装独立款
  elif GenZ% >= 20        → A_GenZ主导
  elif GenZ% >= 13        → B_年轻白领
  elif (资深中产+小镇中老年)% >= 9 → D_成熟偏好
  else                    → C_精致妈妈底盘

提供两个核心函数：
  - cluster_portraits(portrait_dir, top100_xlsx=None) -> (DataFrame, DataFrame, DataFrame)
  - cluster_from_long_df(long_df, top100_xlsx=None) -> (DataFrame, DataFrame, DataFrame)

CLI 用法见 cli.py。
"""

from __future__ import annotations

import glob
import os
import pickle
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import pandas as pd

EIGHT_GROUPS = [
    "新锐白领", "都市银发", "精致妈妈", "都市蓝领",
    "genz", "小镇青年", "资深中产", "小镇中老年",
]

# 默认分簇阈值
DEFAULT_THRESHOLDS = {
    "genz_a_min": 0.20,         # A 簇 GenZ 下限
    "genz_b_min": 0.13,         # B 簇 GenZ 下限
    "mature_d_min": 0.09,       # D 簇 (资深中产+小镇中老年) 下限
    "male_keyword": "男",       # E 簇商品名包含此关键字
}

# 维度画像类型映射
DIMENSION_TYPES = {
    "年龄段": "预测年龄段",
    "城市等级": "城市等级",
    "消费能力": "预测消费能力",
    "人生阶段": "预测人生阶段",
    "美妆人群": "美妆行业特色人群",
    "抖音兴趣": "抖音视频观看兴趣分类v2",
    "手机价格": "手机价格",
}


def _to_num(s: str) -> float:
    """将画像字段的字符串占比/TGI 转为数值。"""
    if s is None:
        return float("nan")
    s = str(s).strip().strip('"')
    if s.endswith("%"):
        try:
            return float(s[:-1]) / 100.0
        except ValueError:
            return float("nan")
    if s in ("-", ""):
        return float("nan")
    try:
        return float(s)
    except ValueError:
        return float("nan")


def load_one_portrait(fp: str) -> pd.DataFrame:
    """读取一份单品画像 CSV。

    源文件格式（长表）：标签类型,标签,占比,tgi
    偶发数据行会包含多余列（如 "3818847126885106012-占比"），
    容错策略：取第 1 列为标签类型，第 2 列为标签，倒数第 2 列为占比，倒数第 1 列为 tgi。
    """
    rows = []
    with open(fp, "r", encoding="utf-8-sig") as f:
        f.readline()  # 跳过表头
        for ln in f:
            parts = ln.rstrip("\n").split(",")
            if len(parts) < 4:
                continue
            tag_type = parts[0]
            tag = parts[1]
            ratio = _to_num(parts[-2])
            tgi = _to_num(parts[-1])
            rows.append((tag_type, tag, ratio, tgi))
    return pd.DataFrame(rows, columns=["标签类型", "标签", "占比", "tgi"])


def load_portraits_from_dir(portrait_dir: str) -> dict[str, pd.DataFrame]:
    """从目录加载所有单品画像 CSV。

    文件名约定：{商品ID}画像数据.csv 或 {商品ID}.csv；
    取文件名前 19 位（抖音商品 ID）作为商品 ID。

    Returns
    -------
    dict[商品ID, DataFrame]
    """
    profiles = {}
    for fp in glob.glob(os.path.join(portrait_dir, "*.csv")):
        pid = os.path.basename(fp)[:19]
        profiles[pid] = load_one_portrait(fp)
    return profiles


def load_top100_meta(top100_xlsx: str) -> pd.DataFrame:
    """读取 TOP100 总表，返回包含商品ID、商品名称、品类、GMV 等的 DataFrame。"""
    df = pd.read_excel(top100_xlsx, sheet_name=None)
    sheet = next(iter(df.values()))
    sheet["商品ID"] = sheet["商品ID"].astype(str)
    sheet["商品名称"] = sheet["商品名称"].astype(str).str.replace("|", "｜", regex=False)
    return sheet


def _get_ratio(df: pd.DataFrame, tag_type: str, tag: str) -> float:
    """从单款画像中取某标签的占比数值，未找到返回 NaN。"""
    sub = df[(df["标签类型"] == tag_type) & (df["标签"] == tag)]
    if len(sub) == 0:
        return float("nan")
    return float(sub.iloc[0]["占比"])


def assign_cluster(
    product_id: str,
    product_name: str,
    profile: pd.DataFrame,
    thresholds: Optional[dict] = None,
) -> Tuple[str, dict]:
    """根据业务规则给一款商品打簇标签。

    Returns
    -------
    (segment_label, debug_info)
    """
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}

    genz = _get_ratio(profile, "八大消费群体", "genz")
    senior = _get_ratio(profile, "八大消费群体", "资深中产")
    elderly = _get_ratio(profile, "八大消费群体", "小镇中老年")
    mature = (
        (senior if not np.isnan(senior) else 0.0)
        + (elderly if not np.isnan(elderly) else 0.0)
    )

    debug = {"genz": genz, "mature": mature}

    # E 簇：男装独立款（按商品名关键字）
    if th["male_keyword"] in product_name:
        return "E_男装独立款", debug

    if not np.isnan(genz) and genz >= th["genz_a_min"]:
        return "A_GenZ主导", debug
    if not np.isnan(genz) and genz >= th["genz_b_min"]:
        return "B_年轻白领", debug
    if mature >= th["mature_d_min"]:
        return "D_成熟偏好", debug
    return "C_精致妈妈底盘", debug


def _build_eight_groups_row(profile: pd.DataFrame) -> dict:
    """提取某款商品的 8 大人群占比。"""
    row = {}
    for g in EIGHT_GROUPS:
        row[g] = _get_ratio(profile, "八大消费群体", g)
    return row


def _build_dimension_row(profile: pd.DataFrame, dim_name: str) -> dict:
    """提取某款商品某画像维度的占比分布（标签 → 占比）。"""
    type_ = DIMENSION_TYPES.get(dim_name, dim_name)
    sub = profile[profile["标签类型"] == type_].dropna(subset=["占比"])
    return dict(zip(sub["标签"], sub["占比"]))


def _hhi(values: list[float]) -> float:
    """HHI = sum(占比^2)，反映 8 大人群集中度。"""
    arr = np.array([v for v in values if not np.isnan(v)], dtype=float)
    if arr.sum() <= 0:
        return float("nan")
    arr = arr / arr.sum()
    return float((arr ** 2).sum())


def cluster_portraits(
    portrait_dir: str,
    top100_xlsx: Optional[str] = None,
    thresholds: Optional[dict] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """主入口：聚类入口。

    Parameters
    ----------
    portrait_dir : str
        单品画像 CSV 目录
    top100_xlsx : str, optional
        TOP100 总表 xlsx，提供商品名称、GMV 等信息
    thresholds : dict, optional
        自定义阈值，键见 DEFAULT_THRESHOLDS

    Returns
    -------
    df_clusters : DataFrame
        每款商品的簇标签 + 8 大人群占比 + 关键画像维度
    df_baseline : DataFrame
        大盘基线（8 大人群 + 关键维度的均值）
    df_segment_summary : DataFrame
        簇画像均值（按 segment 聚合）
    """
    profiles = load_portraits_from_dir(portrait_dir)
    if not profiles:
        raise FileNotFoundError(f"目录 {portrait_dir} 中未发现画像 CSV")

    # 商品元数据
    if top100_xlsx and os.path.exists(top100_xlsx):
        meta = load_top100_meta(top100_xlsx)
        id2name = dict(zip(meta["商品ID"], meta["商品名称"]))
        id2meta = {row["商品ID"]: row for _, row in meta.iterrows()}
    else:
        id2name = {pid: pid for pid in profiles}
        id2meta = {}

    rows = []
    for pid, profile in profiles.items():
        name = id2name.get(pid, pid)
        segment, debug = assign_cluster(pid, name, profile, thresholds)
        row = {
            "商品ID": pid,
            "商品名称": name,
            "segment": segment,
            "genz_ratio": debug["genz"],
            "mature_ratio": debug["mature"],
        }
        # 8 大人群占比
        row.update(_build_eight_groups_row(profile))
        # HHI
        eight_vals = [row[g] for g in EIGHT_GROUPS]
        row["HHI_8人群"] = _hhi(eight_vals)
        # 业务指标（如果有 TOP100 元数据）
        meta_row = id2meta.get(pid)
        if meta_row is not None:
            row["成交金额"] = meta_row.get("成交金额", np.nan)
            row["成交订单数"] = meta_row.get("成交订单数", np.nan)
            row["曝光点击率"] = meta_row.get("曝光点击率（人数）", np.nan)
            row["点击支付率"] = meta_row.get("点击支付率（人数）", np.nan)
        rows.append(row)

    df_clusters = pd.DataFrame(rows)
    df_clusters["商品ID"] = df_clusters["商品ID"].astype(str)

    # 大盘基线
    baseline_data = {g: df_clusters[g].mean() for g in EIGHT_GROUPS}
    baseline_data["HHI_8人群"] = df_clusters["HHI_8人群"].mean()
    df_baseline = pd.DataFrame([baseline_data], index=["baseline"]).T
    df_baseline.columns = ["大盘均值"]

    # 簇画像摘要
    summary_rows = []
    for seg, sub in df_clusters.groupby("segment"):
        row = {"segment": seg, "款数": len(sub)}
        if "成交金额" in sub.columns:
            row["总GMV"] = sub["成交金额"].sum()
            row["平均GMV"] = sub["成交金额"].mean()
            row["GMV占比"] = sub["成交金额"].sum() / df_clusters["成交金额"].sum()
        for g in EIGHT_GROUPS:
            row[f"簇均值_{g}"] = sub[g].mean()
        row["簇均值_HHI"] = sub["HHI_8人群"].mean()
        summary_rows.append(row)
    df_segment_summary = pd.DataFrame(summary_rows)

    return df_clusters, df_baseline, df_segment_summary


def cluster_from_long_df(
    long_df: pd.DataFrame,
    product_names: Optional[dict] = None,
    thresholds: Optional[dict] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """从已合并的画像长表 DataFrame 聚类。

    Parameters
    ----------
    long_df : DataFrame
        必须包含列：商品ID, 标签类型, 标签, 占比, tgi
    product_names : dict, optional
        商品ID → 商品名称 映射
    """
    profiles = {}
    for pid, sub in long_df.groupby("商品ID"):
        profiles[str(pid)] = sub.reset_index(drop=True)

    id2name = product_names or {}

    rows = []
    for pid, profile in profiles.items():
        name = id2name.get(pid, pid)
        segment, debug = assign_cluster(pid, name, profile, thresholds)
        row = {
            "商品ID": pid,
            "商品名称": name,
            "segment": segment,
            "genz_ratio": debug["genz"],
            "mature_ratio": debug["mature"],
        }
        row.update(_build_eight_groups_row(profile))
        eight_vals = [row[g] for g in EIGHT_GROUPS]
        row["HHI_8人群"] = _hhi(eight_vals)
        rows.append(row)

    df_clusters = pd.DataFrame(rows)
    baseline_data = {g: df_clusters[g].mean() for g in EIGHT_GROUPS}
    baseline_data["HHI_8人群"] = df_clusters["HHI_8人群"].mean()
    df_baseline = pd.DataFrame([baseline_data], index=["baseline"]).T
    df_baseline.columns = ["大盘均值"]

    summary_rows = []
    for seg, sub in df_clusters.groupby("segment"):
        row = {"segment": seg, "款数": len(sub)}
        for g in EIGHT_GROUPS:
            row[f"簇均值_{g}"] = sub[g].mean()
        row["簇均值_HHI"] = sub["HHI_8人群"].mean()
        summary_rows.append(row)
    df_segment_summary = pd.DataFrame(summary_rows)

    return df_clusters, df_baseline, df_segment_summary


def compute_strong_prefer(df_clusters: pd.DataFrame, baseline: pd.DataFrame, top_n: int = 2) -> pd.DataFrame:
    """为每款商品计算"强偏好人群"（占比偏离大盘 Top N）。"""
    rows = []
    for _, r in df_clusters.iterrows():
        diffs = []
        for g in EIGHT_GROUPS:
            ratio = r.get(g, np.nan)
            base = baseline.loc[g, "大盘均值"] if g in baseline.index else np.nan
            if pd.isna(ratio) or pd.isna(base):
                continue
            diff = (ratio - base) * 100  # 百分点
            if diff > 0:
                diffs.append((g, diff))
        diffs.sort(key=lambda x: -x[1])
        rows.append({
            "商品ID": r["商品ID"],
            "强偏好人群": "、".join(["{} +{:.1f}pp".format(g, d) for g, d in diffs[:top_n]]) or "-",
        })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    # 自检：加载森马数据验证
    import sys
    portrait_dir = "/Users/huangbo/.pi-xanthil/workspaces/76bc1a51-5278-4144-9c3a-b643ca786643/sessions/5bbf5613-1e27-4eb3-babe-e7e86cddc5d1/020_clean/21-抖音官旗TOP100商品画像"
    top100 = "/Users/huangbo/.pi-xanthil/workspaces/76bc1a51-5278-4144-9c3a-b643ca786643/sessions/5bbf5613-1e27-4eb3-babe-e7e86cddc5d1/020_clean/21-抖音官旗TOP100商品画像/森马抖音官旗top100款商品数据.xlsx"

    if os.path.exists(portrait_dir) and os.path.exists(top100):
        clusters, baseline, summary = cluster_portraits(portrait_dir, top100)
        print("簇分布:")
        print(clusters["segment"].value_counts().to_string())
        print("\n大盘基线:")
        print(baseline.round(4).to_string())
        print("\n簇画像摘要:")
        print(summary[["segment", "款数", "总GMV", "平均GMV", "GMV占比"]].round(2).to_string())
    else:
        print("未找到森马数据，请指定 portrait_dir 和 top100_xlsx", file=sys.stderr)
