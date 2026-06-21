import pandas as pd
import os
import re
import hashlib

# ==========================================
# 变量配置区 (每次使用前请修改以下路径)
# ==========================================

# 1. 需要合并提取的源文档所在文件夹路径 (会自动读取该文件夹下所有的 .xlsx 和 .csv 文件)
SOURCE_DIR = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\database\近1年-整体"

# 2. 最终输出成品文档的文件夹位置
OUTPUT_DIR = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\合并提取"

# ==========================================
# 以下为程序核心处理逻辑，通常不需要修改
# ==========================================

def get_merged_filename(file_paths):
    """
    根据输入的文件路径生成合并后的文件名，去重中文字符。
    """
    names = [os.path.basename(f).replace('.xlsx', '').replace('.csv', '').replace('.xls', '') for f in file_paths]
    if not names:
        return "merged_output"
        
    final_name = names[0]
    # 从第一个文件名中提取所有的中文词汇
    chinese_words = re.findall(r'[\u4e00-\u9fa5]+', final_name)
    
    for name in names[1:]:
        filtered_name = name
        for word in chinese_words:
            filtered_name = filtered_name.replace(word, '')
        # 清除因删除中文而产生的连续下划线或首尾下划线
        filtered_name = re.sub(r'_+', '_', filtered_name).strip('_')
        if filtered_name:
            final_name += f"_{filtered_name}"
            
    # 防止因文件过多导致文件名超过Windows系统限制(通常255个字符)，这里进行适当截断
    if len(final_name) > 200:
        final_name = final_name[:200] + "_等多个文件合并"
            
    return final_name

def main():
    print("-" * 50)
    print("开始处理文件夹内的文件合并与MD5提取...")
    print("-" * 50)
    
    # 检查输出目录是否存在，不存在则创建
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    if not os.path.isdir(SOURCE_DIR):
        print(f"[!] 错误：源文件夹路径不存在 {SOURCE_DIR}")
        return
        
    # 获取文件夹下所有 csv 和 excel
    file_paths = []
    # 这里使用 os.listdir 而不是 walk，仅读取当前文件夹层级，避免读取到子文件夹中不想合并的文件
    for f in os.listdir(SOURCE_DIR):
        if f.endswith('.xlsx') or f.endswith('.csv') or f.endswith('.xls'):
            file_paths.append(os.path.join(SOURCE_DIR, f))
                
    if not file_paths:
        print(f"[!] 错误：文件夹 {SOURCE_DIR} 中没有找到任何 Excel 或 CSV 文件！")
        return
        
    print(f"[*] 共找到 {len(file_paths)} 个待处理文件。")
    
    df_list = []
    for file in file_paths:
        print(f"[+] 正在读取文件: {os.path.basename(file)}")
        try:
            if file.endswith('.xlsx') or file.endswith('.xls'):
                df = pd.read_excel(file)
            elif file.endswith('.csv'):
                df = pd.read_csv(file, low_memory=False)
            df_list.append(df)
        except Exception as e:
            print(f"[-] 读取文件 {file} 时出错: {e}")
        
    if not df_list:
        print("\n[!] 错误：没有成功加载任何数据。")
        return
        
    print("\n[*] 正在合并数据...")
    merged_df = pd.concat(df_list, ignore_index=True)
    
    merged_name = get_merged_filename(file_paths)
    merged_csv_path = os.path.join(OUTPUT_DIR, f"{merged_name}.csv")
    phones_csv_path = os.path.join(OUTPUT_DIR, f"{merged_name}_手机号_MD5.csv")
    
    # 1. 保存完整合并数据
    print(f"[*] 正在保存合并后的完整数据...")
    try:
        merged_df.to_csv(merged_csv_path, index=False, encoding='utf-8-sig')
        print(f"  -> {merged_csv_path}")
    except Exception as e:
        print(f"[-] 保存合并数据时出错: {e}")
    
    # 2. 提取手机号转MD5并保存
    print("[*] 正在提取首列手机号并转换为MD5...")
    try:
        phone_col = merged_df.columns[0]
        phones = merged_df[phone_col].dropna().astype(str).tolist()
        
        md5_phones = []
        for p in phones:
            # 清除因读取引起的浮点数 .0 后缀
            if p.endswith('.0'):
                p = p[:-2]
            p_str = p.strip()
            if p_str and p_str.lower() != 'nan':
                # 计算MD5
                md5_hash = hashlib.md5(p_str.encode('utf-8')).hexdigest()
                md5_phones.append(md5_hash)
            
        phones_df = pd.DataFrame({f"{phone_col}_MD5": md5_phones})
        print(f"[*] 正在保存单独的MD5手机号数据...")
        phones_df.to_csv(phones_csv_path, index=False, encoding='utf-8-sig')
        print(f"  -> {phones_csv_path}")
    except Exception as e:
        print(f"[-] 提取手机号转MD5时出错: {e}")
    
    print("-" * 50)
    print("处理完成！请前往输出目录查看结果。")

if __name__ == "__main__":
    main()
