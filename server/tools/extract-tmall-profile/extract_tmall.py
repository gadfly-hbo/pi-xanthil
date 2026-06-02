#!/usr/bin/env python3
import argparse
import glob
import html
import json
import os
import re
from datetime import datetime
from urllib.parse import unquote

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAPPING_PATH = os.path.join(SCRIPT_DIR, "天猫标签分类对应表.md")
MAX_TAGS_PER_CATEGORY = 20

DAKUAIXIAO_LABELS = {
    "资深白领", "新锐白领", "都市蓝领", "精致妈妈", "小镇中年",
    "Z时代人群", "都市银发族", "小镇青年", "小镇老年",
}
HANGYE_LABELS = {"大众实用", "低价实惠", "品质生活", "低价有颜", "高阶时尚"}
HANGYE_REPORT_LABELS = ["潮流人群", "大众实用", "低价实惠", "品质生活", "低价有颜", "高阶时尚"]
FASHION_SPLIT_LABELS = {"潮流人群", "平价实惠者", "主流时尚者", "品质实用者", "购物热衷者", "奢华风格人群"}
REPORT_ORDER = [
    "1. 预测性别", "2. 预测年龄", "3. 预测常驻城市", "4. 预测城市等级",
    "5. 预测职业", "6. 预测人生阶段", "7. 预测教育程度", "8. 折扣敏感度",
    "9. 天猫通用人群_生活方式", "10. 一级类目高偏好", "11. 二级类目高偏好",
    "12. 大快消策略人群", "13. 行业策略人群", "14. 大服饰策略人群",
    "15. 女装女鞋人群分类", "16. 男装男鞋人群分类",
]


def load_mapping():
    with open(MAPPING_PATH, "r", encoding="utf-8") as file:
        mapping_md = file.read()
    tag_to_category = {}
    current_category = None
    for line in mapping_md.splitlines():
        if line.startswith("### ") and not line.startswith("### 分类"):
            current_category = line[4:].strip()
        elif line.startswith("- ") and current_category:
            tag_to_category[line[2:].strip()] = current_category
    return tag_to_category


def extract_from_html(html_file, tag_to_category):
    with open(html_file, "r", encoding="utf-8") as file:
        content = file.read()
    crowd_name_match = re.search(r"crowdName=([^&]+)", content)
    crowd_id_match = re.search(r"crowdId=(\d+)", content)
    date_match = re.search(r"date=(\d{4}-\d{2}-\d{2})", content)
    crowd_name = unquote(crowd_name_match.group(1)) if crowd_name_match else os.path.splitext(os.path.basename(html_file))[0]
    crowd_id = crowd_id_match.group(1) if crowd_id_match else "Unknown"
    date_str = date_match.group(1) if date_match else datetime.now().strftime("%Y-%m-%d")
    rows = re.findall(r'<tr[^>]*class="[^"]*next-table-row[^"]*"[^>]*>(.*?)</tr>', content, re.DOTALL)
    all_data = []
    for row in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL)
        values = [html.unescape(re.sub(r"<[^>]+>", "", cell).strip()) for cell in cells]
        if any(values):
            all_data.append(values)
    grouped = {}
    unmatched = []
    new_cities = []
    matched_tags = 0
    hangye_chaoliu_assigned = False
    for row in all_data:
        if len(row) < 2:
            continue
        label, value = row[0], row[1]
        if label in DAKUAIXIAO_LABELS:
            category = "12. 大快消策略人群"
        elif label == "潮流人群" and not hangye_chaoliu_assigned:
            category = "13. 行业策略人群"
            hangye_chaoliu_assigned = True
        elif label in FASHION_SPLIT_LABELS:
            continue
        elif label in HANGYE_LABELS:
            category = "13. 行业策略人群"
        elif label in tag_to_category:
            category = tag_to_category[label]
        elif any(marker in label for marker in ("市", "州", "地区", "县")):
            category = "3. 预测常驻城市"
            new_cities.append(label)
        else:
            unmatched.append((label, value))
            continue
        grouped.setdefault(category, []).append((label, value))
        matched_tags += 1
    existing_hangye = dict(grouped.get("13. 行业策略人群", []))
    if existing_hangye:
        grouped["13. 行业策略人群"] = [(label, existing_hangye.get(label, "0.00%")) for label in HANGYE_REPORT_LABELS]
    for category in list(grouped):
        grouped[category] = grouped[category][:MAX_TAGS_PER_CATEGORY]
    total_tags = len(all_data)
    return {
        "crowd_name": crowd_name,
        "crowd_id": crowd_id,
        "date_str": date_str,
        "grouped": grouped,
        "unmatched": unmatched,
        "new_cities": new_cities,
        "total_tags": total_tags,
        "matched_tags": matched_tags,
        "match_rate": matched_tags / total_tags * 100 if total_tags else 0.0,
    }


def safe_filename(name):
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip() or "unnamed"


def md_cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def generate_md_report(data):
    lines = [
        "# 天猫人群画像分析报告", "", "## 基本信息", "",
        f"- **人群名称**: {data['crowd_name']}",
        f"- **人群ID**: {data['crowd_id']}",
        f"- **数据日期**: {data['date_str']}",
        "- **数据来源**: 天猫数据银行",
        "- **标签对应表**: 天猫标签分类对应表.md", "", "---", "", "## 人群画像标签数据", "",
    ]
    for category in REPORT_ORDER:
        if category not in data["grouped"]:
            continue
        lines.extend([f"### {category}", "", "| 标签 | 占比 |", "| --- | --- |"])
        for label, value in data["grouped"][category]:
            suffix = " (新增)" if label in data["new_cities"] else ""
            lines.append(f"| {md_cell(label)}{suffix} | {md_cell(value)} |")
        lines.append("")
    lines.extend([
        "---", "", "## 统计信息", "",
        f"- 已匹配分类标签数: {data['matched_tags']}",
        f"- 未匹配标签数: {len(data['unmatched'])}",
        f"- 新增城市标签数: {len(data['new_cities'])}",
        f"- 总标签数: {data['total_tags']}",
        f"- 标签匹配率: {data['match_rate']:.1f}%",
        f"- 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", "",
    ])
    return "\n".join(lines)


def json_report(data):
    return {
        "基本信息": {
            "人群名称": data["crowd_name"], "人群ID": data["crowd_id"], "数据日期": data["date_str"],
            "数据来源": "天猫数据银行", "标签对应表": "天猫标签分类对应表.md",
            "生成时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        "人群画像标签数据": {
            category: [{"标签": label, "占比": value, "是否新增": label in data["new_cities"]} for label, value in tags]
            for category, tags in data["grouped"].items()
        },
        "统计信息": {
            "已匹配分类标签数": data["matched_tags"], "未匹配标签数": len(data["unmatched"]),
            "新增城市标签数": len(data["new_cities"]), "总标签数": data["total_tags"],
            "标签匹配率": f"{data['match_rate']:.1f}%",
        },
        "新增城市列表": data["new_cities"],
        "未匹配标签": [{"标签": label, "占比": value} for label, value in data["unmatched"]],
    }


def write_json(path, content):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(content, file, ensure_ascii=False, indent=2)


def run(input_path, output_path):
    os.makedirs(output_path, exist_ok=True)
    if os.path.isfile(input_path):
        html_files = [input_path]
    elif os.path.isdir(input_path):
        html_files = sorted(glob.glob(os.path.join(input_path, "*.html")))
    else:
        raise ValueError(f"输入路径不存在: {input_path}")
    tag_to_category = load_mapping()
    print(f"标签对应表加载完成: {len(tag_to_category)} 个标签")
    print(f"发现 HTML 文件: {len(html_files)} 个")
    results = []
    for html_file in html_files:
        try:
            data = extract_from_html(html_file, tag_to_category)
            stem = safe_filename(data["crowd_name"]) + "_人群画像"
            md_path = os.path.join(output_path, stem + ".md")
            json_path = os.path.join(output_path, stem + ".json")
            with open(md_path, "w", encoding="utf-8") as file:
                file.write(generate_md_report(data))
            write_json(json_path, json_report(data))
            result = {
                "file": os.path.basename(html_file), "crowdName": data["crowd_name"],
                "totalTags": data["total_tags"], "matchedTags": data["matched_tags"],
                "newCities": len(data["new_cities"]), "matchRate": f"{data['match_rate']:.1f}%",
                "outputs": [md_path, json_path],
            }
            results.append(result)
            print(f"[OK] {result['file']}: {result['totalTags']} 标签, 匹配率 {result['matchRate']}")
        except Exception as error:
            results.append({"file": os.path.basename(html_file), "error": str(error), "outputs": []})
            print(f"[ERROR] {os.path.basename(html_file)}: {error}")
    return {
        "success": sum(1 for item in results if "error" not in item),
        "failed": sum(1 for item in results if "error" in item),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="提取天猫人群画像")
    parser.add_argument("--input", required=True, help="HTML 文件或目录")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--json-summary", required=True, help="运行摘要 JSON 路径")
    args = parser.parse_args()
    try:
        summary = run(os.path.abspath(args.input), os.path.abspath(args.output))
        write_json(args.json_summary, summary)
        print(f"处理完成: 成功 {summary['success']} 个, 失败 {summary['failed']} 个")
    except Exception as error:
        write_json(args.json_summary, {"success": 0, "failed": 1, "error": str(error), "results": []})
        print(f"[ERROR] {error}")
        raise


if __name__ == "__main__":
    main()
