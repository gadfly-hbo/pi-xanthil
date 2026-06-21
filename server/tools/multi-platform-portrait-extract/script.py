import os
import re
import csv
import pandas as pd

base_dir = r'E:\opendata-os\Projects\22-哈尔滨3家店铺人群画像\draw_data\5-三大平台画像导出\26年'
output_dir = r'E:\opendata-os\Projects\22-哈尔滨3家店铺人群画像\clean_data\2-会员人群画像分析'

stores = ['哈尔滨中央大街三店', '哈尔滨中央大街五店', '哈尔滨哈西服装城MALL']

def get_file_for_store(plat_folder, store_name):
    folder_path = os.path.join(base_dir, plat_folder)
    if not os.path.exists(folder_path):
        return None
    for fname in os.listdir(folder_path):
        if store_name in fname and not fname.startswith('~$'):
            return os.path.join(folder_path, fname)
    return None

def extract_tmall(file_path):
    if not file_path: return "无数据"
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return "读取失败"
        
    sections_to_extract = [
        '预测性别', '预测年龄', '预测城市等级', '预测职业', '预测人生阶段',
        '折扣敏感度', '行业策略人群', '大快消策略人群', '天猫通用人群_生活方式'
    ]
    out_text = []
    
    for sec in sections_to_extract:
        match = re.search(rf'### \d+\.\s*{sec}(.*?)(?:###|$)', content, re.DOTALL)
        if match:
            table = match.group(1)
            lines = [line.strip() for line in table.split('\n') if '|' in line and '---' not in line and '标签' not in line]
            parsed = []
            for line in lines:
                parts = [p.strip() for p in line.split('|') if p.strip()]
                if len(parts) >= 2:
                    parsed.append((parts[0], parts[1]))
            parsed.sort(key=lambda x: float(x[1].replace('%', '')) if '%' in x[1] else 0, reverse=True)
            top = " | ".join([f"{k} {v}" for k, v in parsed[:6]])
            out_text.append(f"- **{sec}**: {top}")
            
    return "\n".join(out_text) if out_text else "暂无核心标签解析"

def extract_douyin(file_path):
    if not file_path: return "无数据"
    data_dict = {}
    try:
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 3:
                    cat = row[0].strip()
                    tag = row[1].strip()
                    val = row[2].strip()
                    if cat not in data_dict:
                        data_dict[cat] = []
                    data_dict[cat].append((tag, val))
    except Exception as e:
        return f"读取失败: {str(e)}"
        
    cats_to_extract = [
        '八大消费群体', '预测性别', '预测年龄段', '预测消费能力', '城市等级',
        '预测职业', '预测人生阶段', '电商消费金额', '电商消费频次',
        '手机价格', '抖音视频观看兴趣分类v2', '美妆行业特色人群'
    ]
    out_text = []
    for cat in cats_to_extract:
        check_cat = cat
        if cat not in data_dict and cat == '预测年龄段' and '预测年龄' in data_dict:
            check_cat = '预测年龄'
            
        if check_cat in data_dict:
            parsed = data_dict[check_cat]
            parsed.sort(key=lambda x: float(x[1].replace('%', '')) if '%' in x[1] else 0, reverse=True)
            top = " | ".join([f"{k} {v}" for k, v in parsed[:8]])
            out_text.append(f"- **{cat}**: {top}")
            
    return "\n".join(out_text) if out_text else "暂无核心标签解析"

def extract_jd(file_path):
    if not file_path: return "无数据"
    data_dict = {}
    try:
        df = pd.read_excel(file_path, sheet_name=0)
        for index, row in df.iterrows():
            cat = str(row.iloc[0]).strip()
            tag = str(row.iloc[1]).strip()
            val_str = str(row.iloc[2]).strip().replace('%', '')
            try:
                val = float(val_str)
            except ValueError:
                continue
            if cat not in data_dict:
                data_dict[cat] = []
            data_dict[cat].append((tag, val))
    except Exception as e:
        return f"读取失败: {str(e)}"
        
    cats_to_extract = [
        '十大靶群', '性别', '年龄', '城市线级', '购买力',
        '职业', '婚姻状况', 'PLUS会员', '促销敏感度',
        '商品折扣率偏好', '热衷使用优惠券用户', '冲动购买', 
        '有车一族', '有房人群', '女装用户'
    ]
    out_text = []
    for cat in cats_to_extract:
        if cat in data_dict:
            parsed = data_dict[cat]
            parsed.sort(key=lambda x: x[1], reverse=True)
            top = " | ".join([f"{k} {v*100:.2f}%" if v <= 1 else f"{k} {v:.2f}%" for k, v in parsed[:8]])
            out_text.append(f"- **{cat}**: {top}")
            
    return "\n".join(out_text) if out_text else "暂无核心标签解析"

def extract_xhs(file_path):
    if not file_path: return "无数据"
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return f"读取失败: {str(e)}"
        
    match = re.search(r'## 一、人群画像解读(.*?)## 二、人群标签数据', content, re.DOTALL)
    if match:
        text = match.group(1).strip()
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text
    return "暂无画像解读内容"

def main():
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    for store in stores:
        print(f"处理店铺: {store}")
        tmall_file = get_file_for_store('0-天猫', store)
        douyin_file = get_file_for_store('0-抖音', store)
        jd_file = get_file_for_store('0-京东', store)
        xhs_file = get_file_for_store('0-小红书', store)
        
        tmall_data = extract_tmall(tmall_file)
        douyin_data = extract_douyin(douyin_file)
        jd_data = extract_jd(jd_file)
        xhs_data = extract_xhs(xhs_file)
        
        md_content = f"""# {store} - 2026年四大平台核心画像数据聚合

## 1. 天猫平台画像核心特征
{tmall_data}

## 2. 抖音平台画像核心特征
{douyin_data}

## 3. 京东平台画像核心特征
{jd_data}

## 4. 小红书平台画像核心解读
{xhs_data}
"""
        out_filename = os.path.join(output_dir, f"{store}_2026_四大平台核心画像数据聚合.md")
        with open(out_filename, 'w', encoding='utf-8') as f:
            f.write(md_content)
            
    print("各平台聚合数据提取完成！")

if __name__ == '__main__':
    main()
