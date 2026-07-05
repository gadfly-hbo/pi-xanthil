#!/usr/bin/env python3
"""
会员手机号批量清洗与多平台人群包导出工具

统一 CLI 协议：--input / --output / --json-summary
符合 server/tools/registry.ts 注册制提取工具规范。
"""

import argparse
import glob
import hashlib
import json
import os
import re
import zipfile

import pandas as pd

# ── 手机号清洗 ───────────────────────────────────────────────────
PHONE_PATTERN = re.compile(r"^1\d{10}$")


def clean_phone(val):
    """清洗并校验中国大陆手机号。"""
    if pd.isna(val):
        return None
    if isinstance(val, float):
        if val.is_integer():
            val = int(val)
        else:
            val = str(val)
    val_str = str(val).strip()
    if val_str.endswith(".0"):
        val_str = val_str[:-2]
    digits_only = re.sub(r"\D", "", val_str)
    if PHONE_PATTERN.match(digits_only):
        return digits_only
    return None


def md5_encrypt(val):
    """32 位小写 MD5。"""
    return hashlib.md5(val.encode("utf-8")).hexdigest()


def find_phone_column(df):
    """通过关键字自动定位手机号列，默认回退第一列。"""
    keywords = ["手机", "电话", "号码", "mobile", "phone", "tel", "mobl"]
    for col in df.columns:
        col_str = str(col).lower()
        if any(kw in col_str for kw in keywords):
            return col
    return df.columns[0]


# ── 单文件处理 ───────────────────────────────────────────────────


def process_file(file_path, output_dir, opts):
    """处理单个文件，生成各平台输出，返回结构化结果字典。"""
    file_name = os.path.basename(file_path)
    base_name = os.path.splitext(file_name)[0]
    ext = os.path.splitext(file_name)[1].lower()

    # 读取
    try:
        if ext in (".xlsx", ".xls"):
            df = pd.read_excel(file_path)
        elif ext == ".csv":
            try:
                df = pd.read_csv(file_path, encoding="utf-8")
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding="gbk")
        else:
            return {
                "file": file_name,
                "error": f"不支持的文件格式: {ext}",
                "outputs": [],
            }
    except Exception as e:
        return {"file": file_name, "error": f"读取失败: {e}", "outputs": []}

    total_rows = len(df)
    if total_rows == 0:
        return {"file": file_name, "error": "文件为空", "outputs": []}

    # 定位手机号列并清洗
    phone_col = find_phone_column(df)
    raw_phones = df[phone_col]
    cleaned = []
    invalid_count = 0
    for raw_val in raw_phones:
        p = clean_phone(raw_val)
        if p:
            cleaned.append(p)
        else:
            invalid_count += 1

    valid_count = len(cleaned)
    if valid_count == 0:
        return {
            "file": file_name,
            "error": "无有效手机号",
            "totalRows": total_rows,
            "validPhones": 0,
            "outputs": [],
        }

    # 去重（保持原序）
    unique_phones = list(dict.fromkeys(cleaned))
    unique_count = len(unique_phones)

    # MD5
    md5_values = [md5_encrypt(p) for p in unique_phones]

    # 输出子目录
    xhs_dir = os.path.join(output_dir, "小红书")
    tmall_jd_dir = os.path.join(output_dir, "天猫和京东")
    dy_dir = os.path.join(output_dir, "抖音")
    for d in (xhs_dir, tmall_jd_dir, dy_dir):
        os.makedirs(d, exist_ok=True)

    # ———— 生成平台文件 ————
    outputs = []
    redbook = opts.get("redbook", True)
    tmall_jd = opts.get("tmall_jd", True)
    douyin = opts.get("douyin", True)

    if redbook:
        rb_df = pd.DataFrame(
            {
                "用户ID（必填）": md5_values,
                "行为时间（选填）": [opts.get("rb_time", "2024/11/11 22:33")]
                * unique_count,
                "行为类型（选填）": [opts.get("rb_type", "购买")] * unique_count,
                "样本渠道（选填）": [opts.get("rb_channel", "淘宝")] * unique_count,
                "实付金额（选填）": [opts.get("rb_amount", 90)] * unique_count,
                "额外信息（选填）": [""] * unique_count,
            }
        )
        rb_path = os.path.join(xhs_dir, f"{base_name}_小红书.csv")
        rb_df.to_csv(rb_path, index=False, encoding="utf-8-sig")
        outputs.append(rb_path)

    if tmall_jd:
        tj_df = pd.DataFrame({"手机号码": md5_values})
        tj_path = os.path.join(tmall_jd_dir, f"{base_name}.csv")
        tj_df.to_csv(tj_path, index=False, encoding="utf-8-sig")
        outputs.append(tj_path)

    if douyin:
        dy_csv_name = f"{base_name}.csv"
        dy_csv_path = os.path.join(dy_dir, dy_csv_name)
        dy_df = pd.DataFrame({"手机号码": md5_values})
        dy_df.to_csv(dy_csv_path, index=False, encoding="utf-8-sig")
        dy_zip_name = f"{base_name}.zip"
        dy_zip_path = os.path.join(dy_dir, dy_zip_name)
        with zipfile.ZipFile(dy_zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(dy_csv_path, arcname=dy_csv_name)
        os.remove(dy_csv_path)
        outputs.append(dy_zip_path)

    # 生成处理日志
    log_path = os.path.join(output_dir, "数据清洗日志.txt")
    mode = "a" if os.path.exists(log_path) else "w"
    with open(log_path, mode, encoding="utf-8") as f:
        if mode == "w":
            f.write("=" * 60 + "\n")
            f.write("      会员手机号清洗及导出工具处理日志\n")
            f.write("=" * 60 + "\n")
            f.write(
                f"{'文件名':<35} | {'原始':<8} | {'清洗有效':<8} | {'去重唯一':<8}\n"
            )
            f.write("-" * 75 + "\n")
        f.write(
            f"{file_name:<35} | {total_rows:<8} | {valid_count:<8} | {unique_count:<8}\n"
        )

    # 结构化结果（ExtractionRunResult 兼容字段）
    match_rate = f"{valid_count / total_rows * 100:.1f}%" if total_rows else "0.0%"
    return {
        "file": file_name,
        "crowdName": base_name,
        "totalTags": total_rows,
        "matchedTags": valid_count,
        "matchRate": match_rate,
        "totalRows": total_rows,
        "validPhones": valid_count,
        "uniquePhones": unique_count,
        "invalidCount": invalid_count,
        "outputs": outputs,
    }


# ── 入口运行函数（符合提取工具 CLI 协议） ─────────────────────


def run(input_path, output_path, opts):
    """处理输入源，返回 { success, failed, results }。"""
    os.makedirs(output_path, exist_ok=True)

    # 收集待处理文件
    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext not in (".xlsx", ".xls", ".csv"):
            files = []
        else:
            files = [input_path]
    elif os.path.isdir(input_path):
        files = sorted(
            f
            for f in glob.glob(os.path.join(input_path, "*"))
            if os.path.splitext(f)[1].lower() in (".xlsx", ".xls", ".csv")
        )
    else:
        raise ValueError(f"输入路径不存在: {input_path}")

    if not files:
        print("[!] 未找到 Excel/CSV 文件")
        return {"success": 0, "failed": 0, "results": []}

    print(f"[*] 发现 {len(files)} 个待处理文件")

    results = []
    for file_path in files:
        r = process_file(file_path, output_path, opts)
        results.append(r)
        if "error" in r and r.get("error"):
            print(f"[ERROR] {os.path.basename(file_path)}: {r['error']}")
        else:
            print(
                f"[OK] {os.path.basename(file_path)}: "
                f"原始 {r['totalRows']} 行, "
                f"有效 {r['validPhones']} 个, "
                f"去重 {r['uniquePhones']} 个"
            )

    return {
        "success": sum(1 for r in results if "error" not in r or not r.get("error")),
        "failed": sum(1 for r in results if r.get("error")),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="会员手机号清洗与多平台人群包导出")
    parser.add_argument("--input", required=True, help="Excel/CSV 文件或所在目录")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--json-summary", required=True, help="运行摘要 JSON 路径")

    # 平台导出开关
    parser.add_argument("--no-redbook", action="store_true", help="不导出小红书格式")
    parser.add_argument(
        "--no-tmall-jd", action="store_true", help="不导出天猫和京东格式"
    )
    parser.add_argument("--no-douyin", action="store_true", help="不导出抖音格式")

    # 小红书模板字段
    parser.add_argument("--rb-time", default="2024/11/11 22:33")
    parser.add_argument("--rb-type", default="购买")
    parser.add_argument("--rb-channel", default="淘宝")
    parser.add_argument("--rb-amount", type=int, default=90)

    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    opts = {
        "redbook": not args.no_redbook,
        "tmall_jd": not args.no_tmall_jd,
        "douyin": not args.no_douyin,
        "rb_time": args.rb_time,
        "rb_type": args.rb_type,
        "rb_channel": args.rb_channel,
        "rb_amount": args.rb_amount,
    }

    try:
        summary = run(input_path, output_path, opts)
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(
            f"[✔] 处理完成: 成功 {summary['success']} 个, 失败 {summary['failed']} 个"
        )
    except Exception as e:
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(
                {"success": 0, "failed": 1, "error": str(e), "results": []},
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(f"[ERROR] {e}")
        raise


if __name__ == "__main__":
    main()
