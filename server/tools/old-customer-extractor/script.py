import pandas as pd
import os
import hashlib

# ==========================================
# 变量配置区 (每次使用前请修改以下路径)
# ==========================================

# 1. 整体手机号源文件 (需要被扣减的总池子)
ALL_CUSTOMERS_FILE = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\合并提取\整体_2025-06_12_30_2025-07_2025-08_2025-09_2025-10_1_2025-10_2_2025-11_2025-12_2026-01_2026-02_1_2026-02_2_2026-03_2026-04_2026-05_1_2026-05_2_2026-06_11.csv"

# 2. 新客手机号源文件 (需要剔除的人群)
NEW_CUSTOMERS_FILE = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\合并提取\新客_2025-06_12-07_2025-08-09_2025-10-11_2025-12_2026-01_2026-02-03_2026-04-05-06_11.csv"

# 3. 最终输出成品文档的文件夹位置
OUTPUT_DIR = r"E:\opendata-os\Projects\23-近1年森马品牌人群画像洞察\合并提取"

# ==========================================
# 以下为程序核心处理逻辑，通常不需要修改
# ==========================================

def extract_phones(df):
    """
    从数据框的第一列提取清洗后的手机号集合。
    """
    phone_col = df.columns[0]
    phones = df[phone_col].dropna().astype(str).tolist()
    clean_phones = set()
    for p in phones:
        if p.endswith('.0'):
            p = p[:-2]
        p_str = p.strip()
        if p_str and p_str.lower() != 'nan':
            clean_phones.add(p_str)
    return clean_phones, phone_col

def main():
    print("-" * 50)
    print("开始处理: 整体手机号 - 新客手机号 = 老客手机号")
    print("-" * 50)
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # 1. 读取整体客户
    if not os.path.exists(ALL_CUSTOMERS_FILE):
        print(f"[!] 错误：找不到整体源文件 {ALL_CUSTOMERS_FILE}")
        return
    print(f"[*] 正在读取整体手机号: {os.path.basename(ALL_CUSTOMERS_FILE)}")
    df_all = pd.read_csv(ALL_CUSTOMERS_FILE, low_memory=False)
    all_phones, all_col_name = extract_phones(df_all)
    print(f"    -> 提取到整体有效手机号数量: {len(all_phones)}")
    
    # 2. 读取新客
    if not os.path.exists(NEW_CUSTOMERS_FILE):
        print(f"[!] 错误：找不到新客源文件 {NEW_CUSTOMERS_FILE}")
        return
    print(f"[*] 正在读取新客手机号: {os.path.basename(NEW_CUSTOMERS_FILE)}")
    df_new = pd.read_csv(NEW_CUSTOMERS_FILE, low_memory=False)
    new_phones, _ = extract_phones(df_new)
    print(f"    -> 提取到新客有效手机号数量: {len(new_phones)}")
    
    # 3. 计算老客 (集合差集)
    print("\n[*] 正在剔除相同的新客手机号...")
    old_phones = all_phones - new_phones
    print(f"[*] 剔除完成！剩余老客手机号数量: {len(old_phones)}")
    
    if len(old_phones) == 0:
        print("[!] 警告：没有剩余的老客手机号，不生成输出文件。")
        return
        
    # 4. 生成输出文件名
    # 规则：同整体手机号命名规则，把“整体”改为“老客” 
    # （注：你在要求中写的是改为新客，但逻辑上剩余的应该叫老客，此处严格按逻辑替换为"老客"）
    base_name = os.path.basename(ALL_CUSTOMERS_FILE).replace('.csv', '').replace('.xlsx', '')
    if "整体" in base_name:
        out_name = base_name.replace("整体", "老客")
    else:
        out_name = "老客_" + base_name
        
    out_csv_path = os.path.join(OUTPUT_DIR, f"{out_name}.csv")
    out_md5_path = os.path.join(OUTPUT_DIR, f"{out_name}_手机号_MD5.csv")
    
    old_phones_list = list(old_phones)
    
    # 5. 保存 MD5 CSV (只输出加密结果)
    print(f"\n[*] 正在转换 MD5 并保存...")
    md5_phones = [hashlib.md5(p.encode('utf-8')).hexdigest() for p in old_phones_list]
    pd.DataFrame({f"{all_col_name}_MD5": md5_phones}).to_csv(out_md5_path, index=False, encoding='utf-8-sig')
    print(f"    -> {out_md5_path}")
    
    print("-" * 50)
    print("处理完成！请前往输出目录查看结果。")

if __name__ == "__main__":
    main()
