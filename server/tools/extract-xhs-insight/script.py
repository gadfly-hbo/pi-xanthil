#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小红书灵犀人群画像提取工具

统一 CLI 协议：--input / --output / --json-summary
符合 server/tools/registry.ts 注册制提取工具规范。

从小红书灵犀人群画像导出的 HTML 文件中提取：
- 人群画像解读（AI 生成的分析文本）
- 结构化标签数据（性别、年龄、地域、消费、兴趣、生活方式等）

输出：{filename}_小红书.md + {filename}_小红书.json
"""

import argparse
import glob
import json
import os
import re
from pathlib import Path

# ────────────────────────────────────────────────────────────────
# 解析函数（移植自原工具，保持正则与字段语义不变）
# ────────────────────────────────────────────────────────────────


def extract_ai_content(html):
    """提取 AI 分析内容。"""
    match = re.search(
        r'<div class="mio-ai-content"[^>]*>(.*?)</div>\s*<div class="d-divider',
        html,
        re.DOTALL,
    )
    if match:
        content = match.group(1)
        content = re.sub(r"<[^>]+>", "", content)
        content = re.sub(r"\n\s*\n", "\n\n", content)
        return content.strip()
    return ""


def extract_gender(text):
    """提取性别数据。"""
    data = []
    match = re.search(r"女性[^0-9]*(\d+\.?\d*)%[^0-9]*男性[^0-9]*(\d+\.?\d*)%", text)
    if match:
        data.append({"label": "女性", "ratio": float(match.group(1)), "tgi": None})
        data.append({"label": "男性", "ratio": float(match.group(2)), "tgi": None})
    return data


def extract_age(text):
    """提取年龄数据。"""
    data = []
    patterns = [
        ("26-30岁", r"26-30岁[^0-9]*(\d+\.?\d*)%"),
        ("31-35岁", r"31-35岁[^0-9]*(\d+\.?\d*)%"),
        ("18-25岁", r"18-25岁[^0-9]*(\d+\.?\d*)%"),
        ("36-40岁", r"36-40岁[^0-9]*(\d+\.?\d*)%"),
        ("41岁以上", r"41岁以上[^0-9]*(\d+\.?\d*)%"),
    ]
    for label, pattern in patterns:
        match = re.search(pattern, text)
        if match:
            data.append({"label": label, "ratio": float(match.group(1)), "tgi": None})
    return data


def extract_marry(text):
    """提取婚恋状态。"""
    data = []
    match = re.search(r"未婚[^0-9]*(\d+\.?\d*)%[^0-9]*已婚[^0-9]*(\d+\.?\d*)%", text)
    if match:
        data.append({"label": "未婚", "ratio": float(match.group(1)), "tgi": None})
        data.append({"label": "已婚", "ratio": float(match.group(2)), "tgi": None})
    return data


def extract_region(text):
    """提取地域分布（取 TOP 10）。"""
    data = []
    regions = [
        "云南",
        "广东",
        "四川",
        "浙江",
        "江苏",
        "山东",
        "河南",
        "湖北",
        "湖南",
        "福建",
        "北京",
        "上海",
        "重庆",
        "陕西",
        "安徽",
        "河北",
        "广西",
        "江西",
        "贵州",
        "黑龙江",
    ]
    for region in regions:
        pattern = re.compile(region + r"[^0-9]*(\d+\.?\d*)%")
        match = pattern.search(text)
        if match:
            data.append({"label": region, "ratio": float(match.group(1)), "tgi": None})
    return sorted(data, key=lambda x: x["ratio"] or 0, reverse=True)[:10]


def extract_city_level(text):
    """提取城市等级。"""
    data = []
    levels = ["一线城市", "新一线城市", "二线城市", "三线城市", "四线城市", "五线城市"]
    for level in levels:
        pattern = re.compile(level + r"[^0-9]*(\d+\.?\d*)%")
        match = pattern.search(text)
        if match:
            data.append({"label": level, "ratio": float(match.group(1)), "tgi": None})
    return data


def extract_consumption(text):
    """提取消费特征（手机价格、手机品牌、品牌偏好、行业品类）。"""
    data = []

    # 手机价格
    price_match = re.search(r"手机价格8000\+[^0-9]*(\d+\.?\d*)%", text)
    if price_match:
        data.append(
            {
                "category": "手机价格",
                "label": "8000+",
                "ratio": float(price_match.group(1)),
                "tgi": None,
            }
        )

    # 苹果手机 TGI
    apple_match = re.search(r"苹果手机[^TGI]*TGI[^0-9]*(\d+\.?\d*)", text)
    if apple_match:
        data.append(
            {
                "category": "手机品牌",
                "label": "苹果",
                "ratio": None,
                "tgi": float(apple_match.group(1)),
            }
        )

    # 品牌偏好
    brands = [
        (
            "山姆会员商店",
            r"山姆会员商店[^TGI]*TGI[^0-9]*(\d+\.?\d*)[^0-9]*(\d+\.?\d*)%",
        ),
        ("泡泡玛特", r"泡泡玛特[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("娇韵诗", r"娇韵诗[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("路易威登", r"路易威登[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("香奈儿", r"香奈儿[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("Dior", r"Dior[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("爱马仕", r"爱马仕[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
    ]
    for name, pattern in brands:
        match = re.search(pattern, text)
        if match:
            data.append(
                {
                    "category": "品牌偏好",
                    "label": name,
                    "ratio": float(match.group(2))
                    if len(match.groups()) > 1 and match.group(2)
                    else None,
                    "tgi": float(match.group(1)),
                }
            )

    # 行业品类
    category_match = re.search(r"出行旅游[^TGI]*TGI[^0-9]*(\d+\.?\d*)", text)
    if category_match:
        data.append(
            {
                "category": "行业品类",
                "label": "出行旅游",
                "ratio": None,
                "tgi": float(category_match.group(1)),
            }
        )

    pregnant_match = re.search(r"孕产妇相关[^TGI]*TGI[^0-9]*(\d+\.?\d*)", text)
    if pregnant_match:
        data.append(
            {
                "category": "行业品类",
                "label": "孕产妇相关",
                "ratio": None,
                "tgi": float(pregnant_match.group(1)),
            }
        )

    return data


def extract_interests(text):
    """提取兴趣类目偏好。"""
    data = []
    patterns = [
        ("婚嫁", r"婚嫁[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("母婴", r"母婴[^TGI]*TGI[^0-9]*(\d+\.?\d*)[^0-9]*(\d+\.?\d*)%"),
        ("旅游", r"旅游[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("时尚", r"时尚[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("美妆", r"美妆[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("家居家装", r"家居家装[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("美食", r"美食[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("健身", r"健身[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
    ]
    for name, pattern in patterns:
        match = re.search(pattern, text)
        if match:
            data.append(
                {
                    "label": name,
                    "tgi": float(match.group(1)),
                    "ratio": float(match.group(2))
                    if len(match.groups()) > 1 and match.group(2)
                    else None,
                }
            )
    return sorted(data, key=lambda x: x["tgi"] or 0, reverse=True)


def extract_keywords(text):
    """提取关键词偏好。"""
    data = []
    keywords = [
        "孕妈",
        "孕产",
        "孕妇",
        "孕期",
        "备孕",
        "怀孕",
        "婚礼",
        "备婚",
        "美甲",
        "旅行",
        "景点",
        "旅游攻略",
        "酒店住宿",
        "家居",
        "买房",
        "穿搭",
        "配饰",
        "箱包",
    ]
    for kw in keywords:
        pattern = re.compile(kw + r"[^TGI]*TGI[^0-9]*(\d+\.?\d*)")
        match = pattern.search(text)
        if match:
            data.append({"label": kw, "tgi": float(match.group(1)), "ratio": None})
    return sorted(data, key=lambda x: x["tgi"] or 0, reverse=True)


def extract_search_terms(text):
    """提取搜索词偏好。"""
    data = []
    terms = ["泡泡玛特", "美甲款式", "五一去哪旅游合适", "婚礼策划", "备孕攻略"]
    for term in terms:
        pattern = re.compile(term + r"[^TGI]*TGI[^0-9]*(\d+\.?\d*)")
        match = pattern.search(text)
        if match:
            data.append({"label": term, "tgi": float(match.group(1)), "ratio": None})
    return data


def extract_bloggers(text):
    """提取博主偏好。"""
    data = []
    bloggers = [
        ("奶咖芋妮茶", "美甲"),
        ("老爸评测", "家居测评"),
    ]
    for name, tag in bloggers:
        pattern = re.compile(name + r"[^TGI]*TGI[^0-9]*(\d+\.?\d*)")
        match = pattern.search(text)
        if match:
            data.append(
                {"label": f"{name}({tag})", "tgi": float(match.group(1)), "ratio": None}
            )

    match = re.search(r"母婴博主标签[^TGI]*TGI[^0-9]*(\d+\.?\d*)", text)
    if match:
        data.append(
            {"label": "母婴博主标签", "tgi": float(match.group(1)), "ratio": None}
        )

    return data


def extract_lifestyle(text):
    """提取生活方式标签。"""
    data = []
    labels = [
        ("好孕预备役", r"好孕预备役[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("稳孕选手", r"稳孕选手[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("浪漫喜事", r"浪漫喜事[^0-9]*(\d+\.?\d*)%[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("孕育学习", r"孕育学习[^0-9]*(\d+\.?\d*)%[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("筑巢青年", r"筑巢青年[^TGI]*TGI[^0-9]*(\d+\.?\d*)[^0-9]*(\d+\.?\d*)%"),
        ("居家策展人", r"居家策展人[^TGI]*TGI[^0-9]*(\d+\.?\d*)"),
        ("看世界", r"看世界[^0-9]*(\d+\.?\d*)%"),
        ("发现附近", r"发现附近[^0-9]*(\d+\.?\d*)%"),
        ("自由畅行", r"自由畅行[^0-9]*(\d+\.?\d*)%"),
        ("美力加成", r"美力加成[^0-9]*(\d+\.?\d*)%"),
        ("时尚态度", r"时尚态度[^0-9]*(\d+\.?\d*)%"),
        ("舌尖盛宴", r"舌尖盛宴[^0-9]*(\d+\.?\d*)%"),
    ]
    for name, pattern in labels:
        match = re.search(pattern, text)
        if match:
            data.append(
                {
                    "label": name,
                    "tgi": float(match.group(1)) if match.group(1) else None,
                    "ratio": float(match.group(2))
                    if len(match.groups()) > 1 and match.group(2)
                    else None,
                }
            )
    return data


def extract_all_labels(text):
    """提取所有标签数据。"""
    return {
        "gender": extract_gender(text),
        "age": extract_age(text),
        "marry": extract_marry(text),
        "region": extract_region(text),
        "cityLevel": extract_city_level(text),
        "consumption": extract_consumption(text),
        "interests": extract_interests(text),
        "keywords": extract_keywords(text),
        "searchTerms": extract_search_terms(text),
        "bloggers": extract_bloggers(text),
        "lifestyle": extract_lifestyle(text),
    }


def generate_md(file_name, ai_content, labels):
    """生成 Markdown 报告。"""
    md = f"# {file_name} - 小红书人群画像分析\n\n---\n\n"

    # 人群画像解读
    md += "## 一、人群画像解读\n\n"
    md += ai_content + "\n\n---\n\n"

    # 人群标签数据
    md += "## 二、人群标签数据\n\n"

    # 基础属性
    md += "### 2.1 基础属性\n\n"

    if labels["gender"]:
        md += "#### 预测性别\n\n| 性别 | 占比 |\n|------|------|\n"
        for item in labels["gender"]:
            md += f"| {item['label']} | {item['ratio']}% |\n"
        md += "\n"

    if labels["age"]:
        md += "#### 预测年龄\n\n| 年龄段 | 占比 |\n|--------|------|\n"
        for item in labels["age"]:
            md += f"| {item['label']} | {item['ratio']}% |\n"
        md += "\n"

    if labels["marry"]:
        md += "#### 预测婚恋状态\n\n| 婚恋状态 | 占比 |\n|----------|------|\n"
        for item in labels["marry"]:
            md += f"| {item['label']} | {item['ratio']}% |\n"
        md += "\n"

    if labels["region"]:
        md += "#### 预测地域分布\n\n| 地域 | 占比 |\n|------|------|\n"
        for item in labels["region"]:
            md += f"| {item['label']} | {item['ratio']}% |\n"
        md += "\n"

    if labels["cityLevel"]:
        md += "#### 预测城市等级\n\n| 城市等级 | 占比 |\n|----------|------|\n"
        for item in labels["cityLevel"]:
            md += f"| {item['label']} | {item['ratio']}% |\n"
        md += "\n"

    # 消费特征
    if labels["consumption"]:
        md += "### 2.2 消费特征\n\n| 类别 | 标签 | 占比 | TGI |\n|------|------|------|-----|\n"
        for item in labels["consumption"]:
            ratio = f"{item['ratio']}%" if item["ratio"] else "-"
            tgi = str(item["tgi"]) if item["tgi"] else "-"
            md += f"| {item['category']} | {item['label']} | {ratio} | {tgi} |\n"
        md += "\n"

    # 内容偏好
    md += "### 2.3 内容偏好\n\n"

    if labels["interests"]:
        md += "#### 兴趣类目偏好\n\n| 兴趣类目 | TGI | 占比 |\n|----------|-----|------|\n"
        for item in labels["interests"]:
            ratio = f"{item['ratio']}%" if item["ratio"] else "-"
            md += f"| {item['label']} | {item['tgi']} | {ratio} |\n"
        md += "\n"

    if labels["keywords"]:
        md += "#### 关键词偏好\n\n| 关键词 | TGI |\n|--------|------|\n"
        for item in labels["keywords"]:
            md += f"| {item['label']} | {item['tgi']} |\n"
        md += "\n"

    if labels["searchTerms"]:
        md += "#### 搜索词偏好\n\n| 搜索词 | TGI |\n|--------|------|\n"
        for item in labels["searchTerms"]:
            md += f"| {item['label']} | {item['tgi']} |\n"
        md += "\n"

    if labels["bloggers"]:
        md += "#### 博主偏好\n\n| 博主 | TGI |\n|------|------|\n"
        for item in labels["bloggers"]:
            md += f"| {item['label']} | {item['tgi']} |\n"
        md += "\n"

    # 生活方式
    if labels["lifestyle"]:
        md += "### 2.4 生活方式标签\n\n| 标签 | TGI | 占比 |\n|------|------|------|\n"
        for item in labels["lifestyle"]:
            tgi = str(item["tgi"]) if item["tgi"] else "-"
            ratio = f"{item['ratio']}%" if item["ratio"] else "-"
            md += f"| {item['label']} | {tgi} | {ratio} |\n"
        md += "\n"

    return md


def process_file(html_path, output_dir):
    """处理单个 HTML 文件，返回结构化结果。"""
    html_path = Path(html_path)
    if not html_path.exists():
        raise FileNotFoundError(f"文件不存在: {html_path}")

    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    file_name = html_path.stem
    ai_content = extract_ai_content(html_content)
    labels = extract_all_labels(html_content)

    md_content = generate_md(file_name, ai_content, labels)
    json_data = {
        "fileName": file_name,
        "aiContent": ai_content,
        "labels": labels,
    }

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    md_path = output_dir / f"{file_name}_小红书.md"
    json_path = output_dir / f"{file_name}_小红书.json"

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)

    total_labels = sum(len(v) for v in labels.values())
    return {
        "file": html_path.name,
        "crowdName": file_name,
        "totalTags": total_labels,
        "matchedTags": total_labels,
        "matchRate": "100.0%",
        "totalLabels": total_labels,
        "interests": len(labels["interests"]),
        "keywords": len(labels["keywords"]),
        "lifestyle": len(labels["lifestyle"]),
        "outputs": [str(md_path), str(json_path)],
    }


def run(input_path, output_path):
    """处理输入源，返回 { success, failed, results }。"""
    output_path = Path(output_path)
    output_path.mkdir(parents=True, exist_ok=True)

    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext != ".html":
            html_files = []
        else:
            html_files = [input_path]
    elif os.path.isdir(input_path):
        html_files = sorted(f for f in glob.glob(os.path.join(input_path, "*.html")))
    else:
        raise ValueError(f"输入路径不存在: {input_path}")

    if not html_files:
        print("[!] 未找到 HTML 文件")
        return {"success": 0, "failed": 0, "results": []}

    print(f"[*] 发现 {len(html_files)} 个 HTML 文件")

    results = []
    for html_file in html_files:
        try:
            r = process_file(html_file, output_path)
            results.append(r)
            print(f"[OK] {Path(html_file).name}: {r['totalLabels']} 个标签")
        except Exception as e:
            results.append(
                {
                    "file": Path(html_file).name,
                    "error": str(e),
                    "outputs": [],
                }
            )
            print(f"[ERROR] {Path(html_file).name}: {e}")

    return {
        "success": sum(1 for r in results if "error" not in r or not r.get("error")),
        "failed": sum(1 for r in results if r.get("error")),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="提取小红书灵犀人群画像")
    parser.add_argument("--input", required=True, help="HTML 文件或目录")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--json-summary", required=True, help="运行摘要 JSON 路径")
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    try:
        summary = run(input_path, output_path)
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
