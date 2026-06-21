import re
import argparse
import json

def parse_tmall_markdown(file_path):
    """
    解析天猫人群画像Markdown文件，提取“行业策略人群”数据。
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 正则匹配 行业策略人群 表格
    match = re.search(r'### \d+\.\s*行业策略人群(.*?)(?:###|$)', content, re.DOTALL)
    if not match:
        match = re.search(r'行业策略人群(.*?)(?:###|$)', content, re.DOTALL)
        
    data = {}
    if match:
        table = match.group(1)
        for line in table.split('\n'):
            if '|' in line and '标签' not in line and '---' not in line:
                parts = [p.strip() for p in line.split('|') if p.strip()]
                if len(parts) >= 2:
                    k, v = parts[0], parts[1]
                    try:
                        v = float(v.replace('%', '')) / 100.0
                        data[k] = v
                    except ValueError:
                        continue
    return data

def calc_3_major_groups(data):
    """
    根据《森马品牌三大人群算法v2.0.2》，利用天猫六大行业特色人群计算三大人群占比。
    """
    weights = {
        '潮流人群': {'A': 1.0, 'B': 0.0, 'C': 0.0},
        '高阶时尚': {'A': 0.4, 'B': 0.6, 'C': 0.0},
        '品质生活': {'A': 0.0, 'B': 1.0, 'C': 0.0},
        '大众实用': {'A': 0.0, 'B': 0.25, 'C': 0.75},
        '低价实惠': {'A': 0.0, 'B': 0.0, 'C': 1.0},
        '低价有颜': {'A': 0.0, 'B': 0.0, 'C': 1.0}
    }
    
    raw = {'A': 0, 'B': 0, 'C': 0}
    coverage = 0.0
    
    for k, w in weights.items():
        if k in data:
            val = data[k]
            coverage += val
            for group in raw:
                raw[group] += val * w[group]
                
    shares = {'A': 0, 'B': 0, 'C': 0}
    if coverage > 0:
        shares = {k: v / coverage for k, v in raw.items()}
        
    return shares, coverage, raw

def main():
    parser = argparse.ArgumentParser(description="根据天猫行业策略人群计算线下门店三大人群预测占比")
    parser.add_argument("input_file", help="输入的天猫人群画像Markdown文件路径")
    parser.add_argument("--format", choices=['text', 'json'], default='text', help="输出格式")
    args = parser.parse_args()
    
    data = parse_tmall_markdown(args.input_file)
    if not data:
        print(f"未能从 {args.input_file} 中提取到'行业策略人群'数据，请检查文件格式。")
        return
        
    shares, coverage, raw = calc_3_major_groups(data)
    
    if args.format == 'json':
        output = {
            "shares": shares,
            "coverage": coverage,
            "raw_data": data
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print("====== 天猫线下门店三大人群预测占比 ======")
        print(f"覆盖率 (Coverage): {coverage * 100:.2f}%")
        print(f"A类 (质感流行派): {shares['A'] * 100:.2f}%")
        print(f"B类 (都市体面家): {shares['B'] * 100:.2f}%")
        print(f"C类 (百搭优选客): {shares['C'] * 100:.2f}%")
        print("==========================================")

if __name__ == "__main__":
    main()
