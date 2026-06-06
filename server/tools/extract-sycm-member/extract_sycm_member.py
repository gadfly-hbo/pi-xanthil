# -*- coding: utf-8 -*-
"""
生意参谋 - 会员分析 HTML 数据提取与清洗工具
作者: Antigravity
创建时间: 2026-06-04
"""

import os
import re
import glob
import json
import argparse
from bs4 import BeautifulSoup

def clean_percent_trends(val):
    """
    清洗数值中的正负号趋势。
    将形如 '47-6.00%' 转换为 '47 (↓ 6.00%)'
    将形如 '12+100.00%' 转换为 '12 (↑ 100.00%)'
    将形如 '1.00+0.00%' 转换为 '1.00 (0.00%)'
    """
    val = val.strip()
    # 匹配 数字 + 符号(-/+) + 百分比或数字
    m = re.match(r"^([\d,.]+)([-+])([\d.]+%?)$", val)
    if m:
        num, sign, percent = m.groups()
        if percent == "0.00%":
            return f"{num} (0.00%)"
        trend = "↑" if sign == "+" else "↓"
        return f"{num} ({trend} {percent})"
    return val

def format_goods_cell(val):
    """
    格式化商品名称与商品ID，使其在 Markdown 中展示更美观。
    同时转义管道符 `|`，避免在 Markdown 表格中被误识别为列分隔符。
    """
    val = val.strip().replace("|", "\\|")
    if "商品ID:" in val:
        val = val.replace("商品ID:", "<br>_商品ID: ")
    return val

def extract_ai_analysis(soup, text_chunks):
    """
    提取 AI 经营分析与优化建议。
    逻辑：根据关键词定位，并抓取随后的分析段落。
    """
    ai_diag = []
    ai_opt = []
    
    # 1. 尝试基于纯文本 chunks 抓取（最稳妥，不易受 DOM 深度嵌套影响）
    try:
        # 寻找包含“经营分析”的位置
        diag_idx = -1
        opt_idx = -1
        for idx, chunk in enumerate(text_chunks):
            if "经营分析" in chunk and len(chunk) < 15:
                # 排除长句子，寻找标题性质的 chunk
                diag_idx = idx
            if "优化建议" in chunk and len(chunk) < 15:
                opt_idx = idx
                
        if diag_idx != -1:
            # 经营分析通常跟在后面 3 个 chunk 中，且含有冒号 “：”
            for i in range(diag_idx + 1, min(diag_idx + 10, len(text_chunks))):
                chunk = text_chunks[i]
                if "：" in chunk or ":" in chunk:
                    # 避免抓到“优化建议”标题
                    if "优化建议" in chunk:
                        break
                    ai_diag.append(chunk)
                if len(ai_diag) == 3:
                    break
                    
        if opt_idx != -1:
            # 优化建议跟在后面 3 个 chunk 中
            for i in range(opt_idx + 1, min(opt_idx + 10, len(text_chunks))):
                chunk = text_chunks[i]
                if "：" in chunk or ":" in chunk:
                    if "注意：" in chunk: # 排除免责声明
                        break
                    ai_opt.append(chunk)
                if len(ai_opt) == 3:
                    break
    except Exception as e:
        print(f"[Warning] 提取 AI 经营分析文字时发生错误: {e}")
        
    # 回退机制，如果没抓够，用默认或空
    while len(ai_diag) < 3:
        ai_diag.append("未提取到诊断数据")
    while len(ai_opt) < 3:
        ai_opt.append("未提取到优化建议")
        
    return ai_diag, ai_opt

def extract_core_metrics(soup):
    """
    提取会员核心看板指标。
    """
    metrics = {}
    
    # 指标卡片中通常包含 index-name 相关的 class
    names = soup.find_all(class_=lambda x: x and "index-name" in x)
    
    current_metric = None
    for name_div in names:
        name = name_div.get_text(strip=True)
        if not name:
            continue
            
        parent = name_div.parent
        if not parent:
            continue
            
        # 寻找对应的数值
        val_div = parent.find(class_=lambda x: x and "index-value" in x)
        if not val_div:
            continue
        
        val = val_div.get_text(strip=True)
        
        # 核心指标中有“较前1日”
        if name == "较前1日":
            if current_metric:
                # 查看是 up 还是 down
                span_trend = val_div.find("span", class_=lambda x: x and any(trend in x for trend in ["up", "down"]))
                trend_prefix = ""
                if span_trend:
                    if "up" in span_trend.get('class', []):
                        trend_prefix = "↑ "
                    elif "down" in span_trend.get('class', []):
                        trend_prefix = "↓ "
                metrics[current_metric]["crc"] = f"{trend_prefix}{val}"
                # 寻找日期，通常日期在外层或兄弟节点
                # 页面上通常有 03-19 这种格式
                date_match = re.search(r"(\d{2}-\d{2})", parent.get_text())
                if date_match:
                    metrics[current_metric]["date"] = date_match.group(1)
        else:
            # 这是一个新指标名称
            current_metric = name
            metrics[name] = {"val": val, "crc": "-", "date": ""}
            
    return metrics

def extract_asset_distribution(soup, text_chunks):
    """
    提取会员资产结构分布（高频复购、2单复购、首购、活跃未购、沉默会员）。
    根据页面纯文本段落与 low-grid-item 组合解析。
    """
    assets = []
    asset_types = ["高频复购会员", "2单复购会员", "首购会员", "活跃未购会员", "沉默会员"]
    
    for a_type in asset_types:
        asset_info = {
            "type": a_type,
            "asset_cnt": "-",
            "shop_ratio": "-",
            "crc": "-",
            "peer_ratio": "-",
            "pay_amt": "-",
            "pay_ratio": "-",
            "unit_price": "-",
            "other_features": "-",
            "tools": "-"
        }
        
        # 1. 寻找资产总数和占比
        try:
            # 在 text_chunks 中定位
            for idx, chunk in enumerate(text_chunks):
                if chunk == a_type:
                    # 紧随其后的往往是资产数量，例如 217,330
                    if idx + 1 < len(text_chunks):
                        # 判断是不是纯数字/逗号
                        cnt_str = text_chunks[idx + 1].replace(",", "")
                        if cnt_str.isdigit():
                            asset_info["asset_cnt"] = text_chunks[idx + 1]
                            
                    # 寻找“本店占比”等关键字
                    # 往下搜寻 30 个 chunk 查找它的属性
                    limit = min(idx + 40, len(text_chunks))
                    for k in range(idx + 1, limit):
                        c = text_chunks[k]
                        if "本店占比" in c:
                            # 提取占比数值，通常是紧随其后的 chunk 或者是同一句中
                            ratio_match = re.search(r"(\d+\.\d+%)", text_chunks[k+1] if k+1 < limit else "")
                            if ratio_match:
                                asset_info["shop_ratio"] = ratio_match.group(1)
                        if "较前1日" in c:
                            # 较前1日后面的数值
                            ratio_match = re.search(r"(\d+\.\d+%)", text_chunks[k+1] if k+1 < limit else "")
                            if ratio_match:
                                # 去 HTML 里定位这个“较前1日”的升降
                                # 在 BeautifulSoup 里搜索“较前1日”附近的 class
                                crc_val = ratio_match.group(1)
                                # 默认是 up，可通过 DOM 辅助验证
                                trend = "↑"
                                trend_elem = soup.find(string=re.compile(a_type))
                                if trend_elem:
                                    parent_container = trend_elem.find_parent(class_=lambda x: x and any(kw in x for kw in ["card", "item", "cell", "asset"]))
                                    if parent_container:
                                        down_span = parent_container.find(class_="down")
                                        if down_span and crc_val in down_span.get_text():
                                            trend = "↓"
                                asset_info["crc"] = f"{trend} {crc_val}"
                        if "同行占比" in c:
                            ratio_match = re.search(r"(\d+\.\d+%)", text_chunks[k+1] if k+1 < limit else "")
                            if ratio_match:
                                asset_info["peer_ratio"] = ratio_match.group(1)
                        if "成交金额" in c and "成交金额占比" not in c:
                            amt_match = re.search(r"([\d,]+\.\d+)", text_chunks[k+1] if k+1 < limit else "")
                            if amt_match:
                                asset_info["pay_amt"] = amt_match.group(1)
                        if "成交金额占比" in c:
                            ratio_match = re.search(r"(\d+\.\d+%)", text_chunks[k+1] if k+1 < limit else "")
                            if ratio_match:
                                asset_info["pay_ratio"] = ratio_match.group(1)
                        if "客单价" in c:
                            price_match = re.search(r"([\d,]+\.\d+)", text_chunks[k+1] if k+1 < limit else "")
                            if price_match:
                                asset_info["unit_price"] = price_match.group(1)
                        if "工具推荐" in c:
                            # 工具推荐后面紧跟的工具
                            if k + 1 < limit:
                                asset_info["tools"] = text_chunks[k+1]
                        
                        # 针对活跃未购等特殊字段
                        if a_type == "活跃未购会员" and "访问人数" in c:
                            asset_info["other_features"] = c
                            
                    break
        except Exception as e:
            print(f"[Warning] 提取资产结构 {a_type} 失败: {e}")
            
        assets.append(asset_info)
        
    return assets

def extract_overview_metrics(soup):
    """
    提取复购拉新数据概览的各项波动指标。
    """
    overview_metrics = []
    
    # 查找包含复购拉新概览部分的 table 或者是指标卡片
    # 我们可以通过定位“数据概览”后面的指标，或是具有 index-name 且属于复购模块的指标
    # 我们知道复购概览包含：复购会员数、会员复购金额、复购订单数、复购会员客单价、复购周期、会员复购率、人均复购笔数
    target_names = ["复购会员数", "会员复购金额", "复购订单数", "复购会员客单价", "复购周期", "会员复购率", "人均复购笔数"]
    
    # 查找所有 index-name
    names = soup.find_all(class_=lambda x: x and "index-name" in x)
    
    # 因为页面上可能有多处相同的指标，我们选取排在后面的（数据概览板块通常在核心指标看板后面）
    found_map = {}
    for name_div in names:
        name = name_div.get_text(strip=True)
        if name in target_names:
            parent = name_div.parent
            if parent:
                val_div = parent.find(class_=lambda x: x and "index-value" in x)
                if val_div:
                    val = val_div.get_text(strip=True)
                    
                    # 寻找较前1日的波动
                    crc_val = "-"
                    # 找同级或者子集里的较前1日
                    crc_div = parent.find_next_sibling(class_=lambda x: x and "level-cycleCrc" in x)
                    if not crc_div:
                        # 尝试在同一个 parent 里找
                        crc_div = parent.find(class_=lambda x: x and "index-cycleCrc" in x)
                        
                    if crc_div:
                        span_trend = crc_div.find("span", class_=lambda x: x and any(trend in x for trend in ["up", "down"]))
                        trend_prefix = ""
                        if span_trend:
                            if "up" in span_trend.get('class', []):
                                trend_prefix = "↑ "
                            elif "down" in span_trend.get('class', []):
                                trend_prefix = "↓ "
                            crc_val = f"{trend_prefix}{span_trend.get_text(strip=True)}"
                    
                    found_map[name] = {"val": val, "crc": crc_val}
                    
    for target in target_names:
        if target in found_map:
            overview_metrics.append({
                "name": target,
                "val": found_map[target]["val"],
                "crc": found_map[target]["crc"]
            })
        else:
            overview_metrics.append({
                "name": target,
                "val": "-",
                "crc": "-"
            })
            
    return overview_metrics

def extract_goods_table(soup):
    """
    提取商品排行表格并进行清洗。
    """
    tables = soup.find_all("table")
    if not tables:
        return [], []
        
    table = tables[0]
    headers = [th.get_text(strip=True) for th in table.find_all("tr")[0].find_all(["th", "td"])]
    
    rows = []
    for idx, tr in enumerate(table.find_all("tr")[1:]):
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(cells) == len(headers):
            # 填充缺失的排名
            if not cells[0]:
                cells[0] = str(idx + 1)
            # 格式化与清洗
            formatted_cells = []
            for col_idx, cell in enumerate(cells):
                if col_idx == 1:
                    formatted_cells.append(format_goods_cell(cell))
                else:
                    formatted_cells.append(clean_percent_trends(cell))
            rows.append(formatted_cells)
            
    return headers, rows

def process_html_file(html_path, output_md_path, output_json_path=None):
    """
    主处理逻辑：解析 HTML，写出 Markdown 报告，可选写出 JSON 结构化数据，
    并返回包含解析摘要的字典。
    """
    if not os.path.exists(html_path):
        raise FileNotFoundError(f"找不到输入的 HTML 文件: {html_path}")
        
    with open(html_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
        
    # 提取纯文本块，用于辅助分析
    # 移除 script 和 style
    text_soup = BeautifulSoup(soup.prettify(), "html.parser")
    for script in text_soup(["script", "style"]):
        script.decompose()
    text = text_soup.get_text()
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    text_chunks = [c for c in chunks if c]
    
    # 1. 标题与时间
    page_title = soup.title.string.strip() if soup.title else "生意参谋数据报告"
    # 从 text_chunks 中提取分析时间
    analysis_time = "未知时间"
    for chunk in text_chunks:
        if "数据分析时间：" in chunk or "数据分析时间:" in chunk or "时间：" in chunk:
            time_match = re.search(r"(\d{4}-\d{2}-\d{2}.*)", chunk)
            if time_match:
                analysis_time = time_match.group(1)
                break
                
    # 2. 提取 AI 经营分析与诊断
    ai_diag, ai_opt = extract_ai_analysis(soup, text_chunks)
    
    # 3. 提取核心指标大盘
    core_metrics = extract_core_metrics(soup)
    
    # 4. 提取会员资产结构分布
    asset_distribution = extract_asset_distribution(soup, text_chunks)
    
    # 5. 提取复购概览数据
    overview_metrics = extract_overview_metrics(soup)
    
    # 6. 提取商品排行榜表格
    headers, rows = extract_goods_table(soup)
    
    # 写入 Markdown 文件
    os.makedirs(os.path.dirname(os.path.abspath(output_md_path)), exist_ok=True)
    with open(output_md_path, "w", encoding="utf-8") as f:
        f.write(f"# 生意参谋会员分析报告 - {page_title}\n\n")
        f.write(f"> **数据分析时间**：{analysis_time}  \n")
        f.write(f"> **提取源文件**：{os.path.basename(html_path)}  \n\n")
        
        # 一、经营分析与诊断
        f.write("## 一、经营分析与诊断 (AI 助手总结)\n\n")
        f.write("> [!NOTE]\n")
        for idx, diag in enumerate(ai_diag):
            f.write(f"> **{idx + 1}. {diag}**\n")
        f.write("\n")
        
        f.write("### 优化建议：\n")
        for opt in ai_opt:
            f.write(f"- {opt}\n")
        f.write("\n")
        
        # 二、核心数据看板
        f.write("## 二、会员核心数据看板\n\n")
        f.write("| 指标名称 | 本期数值 | 对比口径 (全店/较前一日) |\n")
        f.write("| :--- | :--- | :--- |\n")
        
        # 按常用顺序输出核心指标
        ordered_metrics = [
            ("会员总数", "会员总数"),
            ("新增会员数", "新增会员数"),
            ("招募转化率", "招募转化率"),
            ("会员成交人数", "会员成交人数"),
            ("成交会员占比全店", "成交会员占比全店"),
            ("复购会员数", "复购会员数"),
            ("会员成交金额", "会员成交金额"),
            ("成交金额占比全店", "成交金额占比全店"),
            ("会员复购金额", "会员复购金额"),
            ("会员客单价", "会员客单价"),
            ("全店客单价", "全店客单价"),
            ("复购会员客单价", "复购会员客单价"),
            ("会员复购率", "会员复购率"),
            ("全店复购率", "全店复购率"),
            ("人均复购笔数", "人均复购笔数")
        ]
        
        for m_key, m_name in ordered_metrics:
            if m_key in core_metrics:
                info = core_metrics[m_key]
                val = info["val"]
                crc = info["crc"]
                date = info["date"]
                
                # 格式化对比口径
                compare_str = "-"
                if crc != "-":
                    compare_str = f"较前一日"
                    if date:
                        compare_str += f" ({date})"
                    compare_str += f" {crc}"
                elif "占比" in m_name:
                    compare_str = "全店占比"
                elif "全店" in m_name:
                    compare_str = "全店对比"
                    
                # 附加单位
                unit = " 元" if "金额" in m_name or "客单价" in m_name else ""
                f.write(f"| **{m_name}** | {val}{unit} | {compare_str} |\n")
        f.write("\n\n")
        
        # 三、会员资产结构分布
        f.write("## 三、会员资产结构分布\n\n")
        f.write("| 会员类型 | 资产数量 | 本店占比 | 较前一日 | 同行占比 | 近30天成交金额 | 成交金额占比 | 重点客单价 / 特征 | 推荐运营工具 |\n")
        f.write("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n")
        for asset in asset_distribution:
            other = asset["other_features"]
            if other == "-" and asset["unit_price"] != "-":
                other = f"{asset['unit_price']} 元"
            
            pay_amt_str = asset["pay_amt"]
            if pay_amt_str != "-" and pay_amt_str != "":
                pay_amt_str += " 元"
                
            f.write(f"| **{asset['type']}** | {asset['asset_cnt']} | {asset['shop_ratio']} | {asset['crc']} | {asset['peer_ratio']} | {pay_amt_str} | {asset['pay_ratio']} | {other} | {asset['tools']} |\n")
        f.write("\n\n")
        
        # 四、会员复购运营概览
        if overview_metrics:
            f.write("## 四、会员复购运营概览\n\n")
            f.write("| 复购分析指标 | 本期数值 | 较前一日波动 |\n")
            f.write("| :--- | :---: | :---: |\n")
            for m in overview_metrics:
                f.write(f"| {m['name']} | {m['val']} | {m['crc']} |\n")
            f.write("\n\n")
            
        # 五、商品排行榜
        if headers and rows:
            f.write(f"## 五、会员复购商品 TOP {len(rows)} 排行榜\n\n")
            f.write("| " + " | ".join(headers) + " |\n")
            f.write("| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n")
            for r in rows:
                f.write("| " + " | ".join(r) + " |\n")
            f.write("\n\n")
            
        f.write(f"> **说明**：本报告使用 extract_sycm_member.py 自动清洗并提取。\n")

    if output_json_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_json_path)), exist_ok=True)
        with open(output_json_path, "w", encoding="utf-8") as jf:
            json.dump(
                {
                    "pageTitle": page_title,
                    "analysisTime": analysis_time,
                    "sourceFile": os.path.basename(html_path),
                    "aiAnalysis": {"diagnoses": ai_diag, "suggestions": ai_opt},
                    "coreMetrics": core_metrics,
                    "assetDistribution": asset_distribution,
                    "overviewMetrics": overview_metrics,
                    "goodsRanking": {"headers": headers, "rows": rows},
                },
                jf,
                ensure_ascii=False,
                indent=2,
            )

    print(f"解析成功！报告已保存至: {output_md_path}")
    return {
        "pageTitle": page_title,
        "analysisTime": analysis_time,
        "coreMetricCount": len(core_metrics),
        "assetCount": len(asset_distribution),
        "overviewMetricCount": len(overview_metrics),
        "goodsRowCount": len(rows),
    }


def run(input_path, output_path):
    os.makedirs(output_path, exist_ok=True)
    if os.path.isfile(input_path):
        html_files = [input_path]
    elif os.path.isdir(input_path):
        html_files = sorted(glob.glob(os.path.join(input_path, "*.html")))
    else:
        raise ValueError(f"输入路径不存在: {input_path}")
    print(f"发现 HTML 文件: {len(html_files)} 个")
    results = []
    for html_file in html_files:
        stem = os.path.splitext(os.path.basename(html_file))[0] + "_会员分析"
        md_path = os.path.join(output_path, stem + ".md")
        json_path = os.path.join(output_path, stem + ".json")
        try:
            summary = process_html_file(html_file, md_path, json_path)
            results.append({
                "file": os.path.basename(html_file),
                "pageTitle": summary["pageTitle"],
                "analysisTime": summary["analysisTime"],
                "coreMetricCount": summary["coreMetricCount"],
                "assetCount": summary["assetCount"],
                "overviewMetricCount": summary["overviewMetricCount"],
                "goodsRowCount": summary["goodsRowCount"],
                "outputs": [md_path, json_path],
            })
            print(f"[OK] {os.path.basename(html_file)}")
        except Exception as error:
            results.append({
                "file": os.path.basename(html_file),
                "error": str(error),
                "outputs": [],
            })
            print(f"[ERROR] {os.path.basename(html_file)}: {error}")
    return {
        "success": sum(1 for item in results if "error" not in item),
        "failed": sum(1 for item in results if "error" in item),
        "results": results,
    }


def write_json(path, content):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(content, file, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description="提取生意参谋会员分析 HTML 数据")
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
