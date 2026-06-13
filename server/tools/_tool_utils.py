#!/usr/bin/env python3
"""共享工具函数：find_col / run_tool / main_tool。"""
import argparse
import json
import os
import sys


def find_col(df, aliases):
    cols_lower = {str(c).strip().lower(): c for c in df.columns}
    for a in aliases:
        if a.lower() in cols_lower:
            return cols_lower[a.lower()]
    for c in df.columns:
        cl = str(c).strip().lower()
        for a in aliases:
            if a.lower() in cl:
                return c
    return None


def run_tool(input_path, output_path, opts, process_fn, format_fn, report_suffix):
    os.makedirs(output_path, exist_ok=True)
    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext != ".csv":
            return {"success": 0, "failed": 1, "error": f"不支持的文件格式: {ext}", "results": []}
        files = [input_path]
    elif os.path.isdir(input_path):
        files = sorted(f for f in os.listdir(input_path) if f.endswith(".csv"))
        files = [os.path.join(input_path, f) for f in files]
    else:
        raise ValueError(f"输入路径不存在: {input_path}")
    if not files:
        return {"success": 0, "failed": 0, "results": []}

    results = []
    for file_path in files:
        try:
            file_result = process_fn(file_path, opts)
            file_result["file"] = os.path.basename(file_path)
            if file_result.get("error"):
                results.append(file_result)
            else:
                base = os.path.splitext(os.path.basename(file_path))[0]
                md_path = os.path.join(output_path, f"{base}_{report_suffix}_report.md")
                json_path = os.path.join(output_path, f"{base}_{report_suffix}_report.json")
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(format_fn(file_result))
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(file_result["results"], f, ensure_ascii=False, indent=2)
                file_result["outputs"] = [md_path, json_path]
                results.append(file_result)
        except Exception as e:
            results.append({"file": os.path.basename(file_path), "error": str(e), "outputs": []})

    return {
        "success": sum(1 for r in results if not r.get("error")),
        "failed": sum(1 for r in results if r.get("error")),
        "results": results,
    }


def main_tool(description, param_defs, process_fn, format_fn, report_suffix):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    for pd_ in param_defs:
        parser.add_argument(f"--param-{pd_['name']}", type=pd_.get("type", str), default=pd_.get("default"))
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)
    opts = {pd_["name"]: getattr(args, f"param_{pd_['name']}") for pd_ in param_defs}

    try:
        summary = run_tool(input_path, output_path, opts, process_fn, format_fn, report_suffix)
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[OK] {description}: 成功 {summary['success']} 个, 失败 {summary['failed']} 个")
    except Exception as e:
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump({"success": 0, "failed": 1, "error": str(e), "results": []}, f, ensure_ascii=False, indent=2)
        print(f"[ERROR] {e}")
        raise
