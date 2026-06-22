import argparse
import json
import os
import sys
import traceback

import script

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    parser.add_argument("--param-account_file", type=str, required=True)
    args, _ = parser.parse_known_args()

    try:
        os.makedirs(args.output, exist_ok=True)
        output_csv = os.path.join(args.output, "similarity_results.csv")
        
        script.main(args.input, args.param_account_file, output_csv)

        summary_data = {
            "success": 1,
            "failed": 0,
            "results": [
                {
                    "file": "号货匹配度结果",
                    "outputs": [output_csv]
                }
            ]
        }
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary_data, f, ensure_ascii=False, indent=2)

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
        sys.exit(1)

if __name__ == "__main__":
    main()
