import argparse
import json
import os
import sys
import traceback
from pathlib import Path

# Add current dir to sys path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    # Add any extra params that might be passed
    args, unknown = parser.parse_known_args()

    try:
        os.makedirs(args.output, exist_ok=True)
        
        # We can dynamically set the globals of the script module
        import script
        
        if hasattr(script, 'INPUT_DIR'): script.INPUT_DIR = args.input
        if hasattr(script, 'SOURCE_DIR'): script.SOURCE_DIR = args.input
        if hasattr(script, 'BASE_DIR'): script.BASE_DIR = args.input
        if hasattr(script, 'base_dir'): script.base_dir = args.input
        
        if hasattr(script, 'OUTPUT_DIR'): 
            if type(script.OUTPUT_DIR) is type(Path()):
                script.OUTPUT_DIR = Path(args.output)
            else:
                script.OUTPUT_DIR = args.output
        if hasattr(script, 'output_dir'): script.output_dir = args.output
        
        # Execute the script's main
        if hasattr(script, 'main'):
            script.main()
            
        summary_data = {
            "success": 1,
            "failed": 0,
            "results": [
                {
                    "file": "MD5平台格式转换工具",
                    "outputs": [os.path.join(args.output, f) for f in os.listdir(args.output)]
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
