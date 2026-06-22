import pandas as pd
import numpy as np
from scipy.spatial.distance import cosine
from scipy.stats import pearsonr
import os
import re
import argparse

def load_and_preprocess(file1, file2):
    # 读取数据并忽略格式错误的行
    df1 = pd.read_csv(file1, on_bad_lines='skip')
    df2 = pd.read_csv(file2, on_bad_lines='skip')
    
    # 获取“占比”列名
    col1_ratio = [c for c in df1.columns if '占比' in c][0]
    col2_ratio = [c for c in df2.columns if '占比' in c][0]
    
    # 根据标签维度合并数据
    df = pd.merge(df1, df2, on=['标签类型', '标签'], how='inner')
    
    # 预处理占比数据（去除 '%' 并转为浮点数）
    def clean_ratio(x):
        if isinstance(x, str) and '%' in x:
            return float(x.replace('%', '')) / 100.0
        try:
            return float(x)
        except ValueError:
            return np.nan
        
    df['ratio1'] = df[col1_ratio].apply(clean_ratio)
    df['ratio2'] = df[col2_ratio].apply(clean_ratio)
    
    # 剔除含有空值的行（如果有）
    df = df.dropna(subset=['ratio1', 'ratio2'])
    
    return df['ratio1'].values, df['ratio2'].values, len(df)

def process_single_match(product_file, account_file):
    """处理单个商品文件并返回最终匹配度"""
    try:
        vec1, vec2, n_samples = load_and_preprocess(product_file, account_file)
        if n_samples == 0:
            return None
            
        # 1. 计算余弦相似度
        cos_sim = 1 - cosine(vec1, vec2)
        
        # 2. 计算皮尔逊相关系数
        pearson_corr, _ = pearsonr(vec1, vec2)
        
        # 3. 最终综合相似度（算术平均值）
        final_score = (cos_sim + pearson_corr) / 2.0
        return final_score
    except Exception as e:
        print(f"处理文件 {product_file} 时出错: {e}")
        return None

def main(product_input, account_file, output_csv):
    results = []
    
    # 判断 product_input 是单文件还是目录
    if os.path.isfile(product_input):
        product_files = [product_input]
    elif os.path.isdir(product_input):
        # 遍历目录下的所有 CSV，并排除账号基准文件
        account_basename = os.path.basename(account_file)
        product_files = [
            os.path.join(product_input, f) for f in os.listdir(product_input)
            if f.endswith('.csv') and f != account_basename and "结果" not in f
        ]
    else:
        print(f"无效的输入路径: {product_input}")
        return

    for p_file in product_files:
        # 提取文件名称的数字部分作为商品款号
        basename = os.path.basename(p_file)
        match = re.search(r'\d+', basename)
        if match:
            product_id = match.group()
        else:
            product_id = basename.replace('.csv', '') # 如果没有数字则默认用文件名
            
        print(f"正在计算商品 [{product_id}] 与账号的匹配度 ...")
        score = process_single_match(p_file, account_file)
        
        if score is not None:
            results.append({
                # 附加制表符 \t 强制让 Excel 将大数字识别为文本，防止科学计数法或丢失精度
                '商品款号': f"{product_id}\t",
                '号货匹配度': round(score, 4)
            })
            
    # 输出为 CSV 文件
    if results:
        df_out = pd.DataFrame(results)
        # 使用 utf-8-sig 编码以防止在 Excel 中打开时中文乱码
        df_out.to_csv(output_csv, index=False, encoding='utf-8-sig')
        print(f"\n======================================")
        print(f"执行完毕！共成功处理 {len(results)} 个商品文件。")
        print(f"结果已保存至: {output_csv}")
    else:
        print("未生成任何有效结果。")

if __name__ == "__main__":
    # 可以通过命令行参数指定，如果未指定则使用默认路径
    parser = argparse.ArgumentParser(description="批量计算商品人群与账号人群的匹配度")
    parser.add_argument("--input", type=str, help="商品文件或包含商品文件的文件夹路径", 
                        default=r"E:\opendata-os\Projects\24-抖音商品人群画像项目\模型工具开发\号货匹配")
    parser.add_argument("--account", type=str, help="账号基准人群文件路径", 
                        default=r"E:\opendata-os\Projects\24-抖音商品人群画像项目\模型工具开发\号货匹配\森马官方旗舰店账号26年5月画像数据.csv")
    parser.add_argument("--output", type=str, help="输出结果CSV的路径", 
                        default=r"E:\opendata-os\Projects\24-抖音商品人群画像项目\模型工具开发\号货匹配\号货匹配度结果.csv")
    
    args = parser.parse_args()
    
    main(args.input, args.account, args.output)
