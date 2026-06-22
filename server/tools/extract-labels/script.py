import pandas as pd
import numpy as np
import os
import argparse
import re

def clean_ratio(x):
    if isinstance(x, str) and '%' in x:
        return float(x.replace('%', '')) / 100.0
    try:
        return float(x)
    except ValueError:
        return np.nan

def clean_tgi(x):
    try:
        return float(x)
    except ValueError:
        return np.nan

def process_single_file(data_csv):
    """处理单个CSV文件，返回提取的字典列表"""
    try:
        df_data = pd.read_csv(data_csv, on_bad_lines='skip')
    except Exception as e:
        print(f"读取文件 {os.path.basename(data_csv)} 失败: {e}")
        return []
        
    col_ratio = [c for c in df_data.columns if '占比' in c]
    col_tgi = [c for c in df_data.columns if 'tgi' in c.lower()]
    
    if not col_ratio or not col_tgi:
        print(f"文件 {os.path.basename(data_csv)} 未找到包含'占比'或'tgi'的列。跳过...")
        return []
        
    col_ratio = col_ratio[0]
    col_tgi = col_tgi[0]
    
    df_data['ratio_val'] = df_data[col_ratio].apply(clean_ratio)
    df_data['tgi_val'] = df_data[col_tgi].apply(clean_tgi)
    
    # 提取商品款号
    basename = os.path.basename(data_csv)
    match = re.search(r'\d+', basename)
    product_id = match.group() if match else basename.replace('.csv', '')
    
    file_results = []
    label_types = df_data['标签类型'].dropna().unique()
    
    for l_type in label_types:
        df_subset = df_data[df_data['标签类型'] == l_type].copy()
        if df_subset.empty:
            continue
            
        total_labels = len(df_subset)
        if total_labels <= 3:
            top_n = 1
            top_req = "top1"
        else:
            top_n = 3
            top_req = "top3"
            
        # 1. 占比的 TOP N
        df_sorted_ratio = df_subset.sort_values(by='ratio_val', ascending=False)
        top_rows_ratio = df_sorted_ratio.head(top_n)
        
        top_items_ratio = [f"{row['标签']}({row[col_ratio]})" for _, row in top_rows_ratio.iterrows()]
        str_ratio = "、".join(top_items_ratio)
        
        # 2. TGI 的 TOP N (独立排序，要求 TGI >= 100)
        df_tgi_filtered = df_subset[df_subset['tgi_val'] >= 100]
        df_sorted_tgi = df_tgi_filtered.sort_values(by='tgi_val', ascending=False)
        top_rows_tgi = df_sorted_tgi.head(top_n)
        
        if top_rows_tgi.empty:
            str_tgi = "无满足条件(TGI>=100)的标签"
        else:
            top_items_tgi = [f"{row['标签']}({int(round(row['tgi_val']))})" for _, row in top_rows_tgi.iterrows()]
            str_tgi = "、".join(top_items_tgi)
        
        file_results.append({
            '商品款号': f"{product_id}\t",
            '标签字段': l_type,
            '标签选项总数': total_labels,
            '取数要求': top_req,
            '提取结果(占比)': str_ratio,
            '提取结果(TGI)': str_tgi
        })
        
    return file_results

def extract_labels_batch(input_path, output_file):
    all_results = []
    
    # 判断是单文件还是文件夹
    if os.path.isfile(input_path):
        files = [input_path]
    elif os.path.isdir(input_path):
        # 遍历文件夹下所有的CSV文件，排除之前脚本的各种生成结果
        files = [
            os.path.join(input_path, f) for f in os.listdir(input_path) 
            if f.endswith('.csv') and '结果' not in f and '汇总' not in f
        ]
    else:
        print(f"无效的输入路径: {input_path}")
        return
        
    print(f"共发现 {len(files)} 个待处理的商品源文件。")
    
    for idx, f in enumerate(files, 1):
        print(f"[{idx}/{len(files)}] 正在处理: {os.path.basename(f)}")
        res = process_single_file(f)
        all_results.extend(res)
        
    if all_results:
        df_out = pd.DataFrame(all_results)
        df_out.to_csv(output_file, index=False, encoding='utf-8-sig')
        print(f"\n=================================")
        print(f"提取完成！共生成 {len(all_results)} 条提取记录。")
        print(f"批量提取结果已保存至: {output_file}")
    else:
        print("未生成任何有效数据。")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="动态提取标签：支持批量处理文件夹，自动按条件提取占比和TGI")
    default_dir = r"E:\opendata-os\Projects\24-抖音商品人群画像项目\模型工具开发\本品TOP3"
    parser.add_argument("--input", type=str, default=default_dir, help="商品CSV文件或文件夹路径")
    parser.add_argument("--output", type=str, default=os.path.join(default_dir, "标签提取批量结果.csv"), help="输出结果CSV的路径")
    
    args = parser.parse_args()
    extract_labels_batch(args.input, args.output)
