import pandas as pd
import argparse
import os

def get_intersection(row):
    str_ratio = str(row.get('提取结果(占比)', ''))
    str_tgi = str(row.get('提取结果(TGI)', ''))
    
    if "无满足条件" in str_tgi or not str_ratio or not str_tgi:
        return ""
        
    ratio_dict = {}
    for x in str_ratio.split('、'):
        if x and '(' in x:
            name = x[:x.rfind('(')]
            val = x[x.rfind('(')+1 : x.rfind(')')]
            ratio_dict[name] = val
            
    tgi_dict = {}
    for x in str_tgi.split('、'):
        if x and '(' in x:
            name = x[:x.rfind('(')]
            val = x[x.rfind('(')+1 : x.rfind(')')]
            tgi_dict[name] = val
            
    intersection = []
    for name in ratio_dict:
        if name in tgi_dict:
            # 取交集，同时保留占比和TGI的值，格式如 "浙江(9.24%, 165)"
            intersection.append(f"{name}({ratio_dict[name]}, {tgi_dict[name]})")
            
    return "、".join(intersection)

def generate_summary(input_csv, output_csv):
    print(f"正在加载提取结果长表: {input_csv}")
    try:
        df = pd.read_csv(input_csv)
    except Exception as e:
        print(f"读取文件失败: {e}")
        return
        
    if '提取结果(占比)' not in df.columns or '提取结果(TGI)' not in df.columns:
        print("错误：输入表必须包含 '提取结果(占比)' 和 '提取结果(TGI)' 列。")
        return
        
    # 计算交集：占比TOP3 与 TGI TOP3（且TGI不低于100）的交集
    value_col = '最终合并结果'
    df[value_col] = df.apply(get_intersection, axis=1)
    
    try:
        df_pivot = df.pivot(index='商品款号', columns='标签字段', values=value_col)
    except ValueError as e:
        df_pivot = df.pivot_table(index='商品款号', columns='标签字段', values=value_col, aggfunc=lambda x: '、'.join(x.dropna()))
        
    df_pivot = df_pivot.reset_index()
    
    # 强制将商品款号转换为带有制表符的纯文本
    df_pivot['商品款号'] = df_pivot['商品款号'].astype(str).apply(lambda x: x if x.endswith('\t') else f"{x}\t")
    
    df_pivot.to_csv(output_csv, index=False, encoding='utf-8-sig')
    print(f"=================================")
    print(f"宽表生成完毕！共汇总了 {len(df_pivot)} 个单品的数据。")
    print(f"汇总表已保存至: {output_csv}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="将提取的长表转换为横向单品优质特征汇总宽表（取占比与TGI的交集）")
    default_input = r"E:\opendata-os\Projects\24-抖音商品人群画像项目\模型工具开发\本品TOP3\extract_labels\样例_标签提取批量结果.csv"
    default_output = r"E:\opendata-os\Projects\24-抖音商品人群画像项目\模型工具开发\本品TOP3\generate_summary_table\样例_单品优质特征横向汇总表.csv"
    
    parser.add_argument("--input", type=str, default=default_input, help="输入的批量提取长表CSV路径")
    parser.add_argument("--output", type=str, default=default_output, help="输出的横向宽表CSV路径")
    
    args = parser.parse_args()
    generate_summary(args.input, args.output)
