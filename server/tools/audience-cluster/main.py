import argparse
import json
import os
import sys
import traceback

from audience_cluster import cluster_portraits

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    # optional top100 parameter
    parser.add_argument("--param-top100_xlsx", type=str, default="")
    # Threshold params
    parser.add_argument("--param-genz_a_min", type=float, default=0.20)
    parser.add_argument("--param-genz_b_min", type=float, default=0.13)
    parser.add_argument("--param-mature_d_min", type=float, default=0.09)
    parser.add_argument("--param-male_keyword", type=str, default="男")
    args = parser.parse_args()

    try:
        os.makedirs(args.output, exist_ok=True)
        thresholds = {
            "genz_a_min": args.param_genz_a_min,
            "genz_b_min": args.param_genz_b_min,
            "mature_d_min": args.param_mature_d_min,
            "male_keyword": args.param_male_keyword,
        }
        top100 = args.param_top100_xlsx if args.param_top100_xlsx else None

        df_clusters, df_baseline, df_summary = cluster_portraits(
            portrait_dir=args.input,
            top100_xlsx=top100,
            thresholds=thresholds
        )

        clusters_csv = os.path.join(args.output, "clusters.csv")
        baseline_csv = os.path.join(args.output, "baseline.csv")
        summary_csv = os.path.join(args.output, "summary.csv")

        df_clusters.to_csv(clusters_csv, index=False, encoding="utf-8-sig")
        df_baseline.to_csv(baseline_csv, index=True, encoding="utf-8-sig")
        df_summary.to_csv(summary_csv, index=False, encoding="utf-8-sig")

        # Also output a markdown report
        report_md = os.path.join(args.output, "audience_cluster_report.md")
        with open(report_md, "w", encoding="utf-8") as f:
            f.write("# 人群分簇分析报告\n\n")
            f.write("## 簇画像摘要\n```text\n")
            cols = ["segment", "款数"]
            if "总GMV" in df_summary.columns:
                cols.extend(["总GMV", "GMV占比"])
            f.write(df_summary[cols].to_string(index=False) + "\n```\n\n")
            f.write("## 大盘基线\n```text\n")
            f.write(df_baseline.round(4).to_string() + "\n```\n\n")

        summary_data = {
            "success": 1,
            "failed": 0,
            "results": [
                {
                    "file": "全体画像聚类",
                    "outputs": [clusters_csv, baseline_csv, summary_csv, report_md]
                }
            ]
        }
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary_data, f, ensure_ascii=False, indent=2)
        
        print(f"[OK] 人群分簇执行成功")

    except Exception as e:
        traceback.print_exc()
        summary_data = {
            "success": 0,
            "failed": 1,
            "error": str(e),
            "results": []
        }
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary_data, f, ensure_ascii=False, indent=2)
        print(f"[ERROR] {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
