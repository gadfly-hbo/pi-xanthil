import pandas as pd
import os
import zipfile
import sys

# 确保输出为 UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# ==========================================
# 变量配置区 (每次使用前请修改以下路径)
# ==========================================

# 1. 包含已加密MD5数据的源文件夹路径 (程序会自动处理该目录下的所有CSV/Excel文件)
INPUT_DIR = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\draw_data\4-手机号导出-EZR\天猫和京东"

# 2. 最终输出抖音和小红书人群包的文件夹路径 (程序会自动在其下创建"抖音"和"小红书"子文件夹)
OUTPUT_DIR = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\draw_data\4-手机号导出-EZR\转换输出"

# ==========================================
# 以下为程序核心处理逻辑，通常不需要修改
# ==========================================

def process_file(file_path, output_dir):
    """处理包含已加密MD5数据的单文件，转成抖音和小红书格式。"""
    file_name = os.path.basename(file_path)
    base_name = os.path.splitext(file_name)[0]
    
    print(f"\n[+] 正在处理文件: {file_name}")
    
    # 按照扩展名读取文件
    try:
        if file_name.lower().endswith(('.xlsx', '.xls')):
            df = pd.read_excel(file_path)
        elif file_name.lower().endswith('.csv'):
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding='gbk')
        else:
            print(f"[-] 不支持的文件格式: {file_name}")
            return False
    except Exception as e:
        print(f"[-] 读取文件失败: {e}")
        return False
        
    if df.empty:
        print("    - 文件为空，跳过。")
        return False

    # 默认认为第一列就是MD5数据
    col = df.columns[0]
    # 清洗掉空值并转为字符串
    md5_values = df[col].dropna().astype(str).str.strip().tolist()
    
    # 保持原本顺序去重
    unique_md5 = list(dict.fromkeys(md5_values))
    unique_count = len(unique_md5)
    
    print(f"    - 读取到 {len(md5_values)} 行数据，去重后唯一MD5数: {unique_count}")
    
    if unique_count == 0:
        print("    - 无有效数据，跳过保存。")
        return False
    
    # 平台输出目录
    xhs_dir = os.path.join(output_dir, "小红书")
    dy_dir = os.path.join(output_dir, "抖音")
    
    os.makedirs(xhs_dir, exist_ok=True)
    os.makedirs(dy_dir, exist_ok=True)
    
    # 1. 导出小红书
    rb_df = pd.DataFrame({
        '用户ID（必填）': unique_md5,
        '行为时间（选填）': ['2024/11/11 22:33'] * unique_count,
        '行为类型（选填）': ['购买'] * unique_count,
        '样本渠道（选填）': ['淘宝'] * unique_count,
        '实付金额（选填）': [90] * unique_count,
        '额外信息（选填）': [''] * unique_count
    })
    rb_path = os.path.join(xhs_dir, f"{base_name}_小红书.csv")
    rb_df.to_csv(rb_path, index=False, encoding='utf-8-sig')
    print(f"    -> [已保存] 小红书格式: {os.path.basename(rb_path)}")
    
    # 2. 导出抖音
    dy_csv_name = f"{base_name}.csv"
    dy_csv_path = os.path.join(dy_dir, dy_csv_name)
    
    dy_df = pd.DataFrame({
        '手机号码': unique_md5
    })
    dy_df.to_csv(dy_csv_path, index=False, encoding='utf-8-sig')
    
    dy_zip_path = os.path.join(dy_dir, f"{base_name}.zip")
    try:
        with zipfile.ZipFile(dy_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(dy_csv_path, arcname=dy_csv_name)
        # 打包后删除临时CSV
        os.remove(dy_csv_path)
        print(f"    -> [已保存] 抖音格式(ZIP): {os.path.basename(dy_zip_path)}")
    except Exception as e:
        print(f"    [-] 抖音ZIP打包失败: {e}")
        
    return {
        'file_name': file_name,
        'total': len(md5_values),
        'unique': unique_count
    }

def main():
    print("-" * 50)
    print("开始处理: 批量将已包含MD5手机号的文件转为小红书/抖音平台格式")
    print("-" * 50)
    
    if not os.path.exists(INPUT_DIR):
        print(f"[!] 错误: 输入路径不存在 '{INPUT_DIR}'")
        return
        
    if not os.path.isdir(INPUT_DIR):
        print(f"[!] 错误: 输入必须是一个文件夹路径")
        return
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    files = [f for f in os.listdir(INPUT_DIR) if f.lower().endswith(('.xlsx', '.xls', '.csv'))]
    if not files:
        print(f"[!] 警告: 未在目录 '{INPUT_DIR}' 中找到任何 Excel/CSV 文件。")
        return
        
    print(f"[*] 找到 {len(files)} 个待处理数据文件。开始批量处理...")
    
    results = []
    for file_name in files:
        file_path = os.path.join(INPUT_DIR, file_name)
        res = process_file(file_path, OUTPUT_DIR)
        if res:
            results.append(res)
            
    print("\n" + "="*60)
    print("                       处理结果汇总")
    print("="*60)
    print(f"{'文件名':<35} | {'原始读取':<8} | {'去重唯一':<8}")
    print("-" * 60)
    for r in results:
        fn = r['file_name']
        if len(fn) > 32:
            fn = fn[:29] + "..."
        print(f"{fn:<35} | {r['total']:<8} | {r['unique']:<8}")
    print("=" * 60)
    print(f"[✔] 所有任务已完成！输出文件已保存在: \n    {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
