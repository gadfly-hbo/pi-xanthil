#!/usr/bin/env python3
"""共享工具函数：find_col / run_tool / main_tool / main_tool_native。"""
import argparse
import json
import os
import re
import sys
import uuid


def _infer_period_from_filename(filename):
    """从文件名推断 period（YYYY-MM / YYYY-MM-DD / YYYYMM / YYYYMMDD）；无命中返回空字符串。"""
    name = os.path.basename(filename)
    dash = re.search(r"(\d{4}-\d{2}(?:-\d{2})?)", name)
    if dash:
        return dash.group(1)
    compact = re.search(r"(\d{4})(\d{2})(\d{2})?", name)
    if compact:
        y, m, d = compact.groups()
        return f"{y}-{m}-{d}" if d else f"{y}-{m}"
    return ""


def make_metric_snapshot(name, value, tool_id, summary_key, source_file="", period="", unit="", metric_id=""):
    """构造符合 server/src/types.ts MetricSnapshot 的确定性指标对象。"""
    snapshot = {
        "name": name,
        "value": float(value) if isinstance(value, (int, float)) else 0.0,
        "period": period or _infer_period_from_filename(source_file) or "",
        "status": "normal",
        "source": "extraction_tool",
        "evidenceLevel": "A",
        "sourceRef": {
            "kind": "extraction_tool",
            "toolId": tool_id,
            "summaryKey": summary_key,
        },
    }
    if unit:
        snapshot["unit"] = unit
    if source_file:
        snapshot["sourceRef"]["sourceFile"] = os.path.basename(source_file)
    if metric_id:
        snapshot["metricId"] = metric_id
    return snapshot


def make_artifact_metadata(absolute_path, output_path, kind="other"):
    """把绝对路径转换为本工具 run 目录下的受控 artifact 元数据。"""
    rel = os.path.relpath(os.path.abspath(absolute_path), os.path.abspath(output_path))
    base = os.path.basename(absolute_path)
    return {
        "id": str(uuid.uuid4()),
        "title": base,
        "basename": base,
        "relPath": rel,
        "kind": kind,
    }


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


def run_tool_native(input_path, output_path, opts, process_fn, format_fn, report_suffix, tool_id):
    """试点工具原生输出 ToolRunOutput 的 runner。process_fn 返回原生 ToolRunOutput 字典。"""
    os.makedirs(output_path, exist_ok=True)
    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext != ".csv":
            return {
                "status": "failed",
                "summary": f"不支持的文件格式: {ext}",
                "metrics": [],
                "artifacts": [],
                "rowGuard": {"blocked": False},
                "errorCode": "validation_error",
            }
        files = [input_path]
    elif os.path.isdir(input_path):
        files = sorted(f for f in os.listdir(input_path) if f.endswith(".csv"))
        files = [os.path.join(input_path, f) for f in files]
    else:
        raise ValueError(f"输入路径不存在: {input_path}")

    if not files:
        return {
            "status": "success",
            "summary": "未找到可处理文件",
            "metrics": [],
            "artifacts": [],
            "rowGuard": {"blocked": False},
        }

    if len(files) > 1:
        # 试点工具暂不支持单批次多文件；如需扩展，可在后续批次聚合。
        return {
            "status": "failed",
            "summary": "原生输出模式暂不支持多文件目录输入",
            "metrics": [],
            "artifacts": [],
            "rowGuard": {"blocked": False},
            "errorCode": "unsupported_input",
        }

    file_path = files[0]
    try:
        file_result = process_fn(file_path, opts)
        if file_result.get("error"):
            return {
                "status": "failed",
                "summary": str(file_result["error"]),
                "metrics": [],
                "artifacts": [],
                "rowGuard": {"blocked": False},
                "errorCode": "tool_error",
            }

        base = os.path.splitext(os.path.basename(file_path))[0]
        md_path = os.path.join(output_path, f"{base}_{report_suffix}_report.md")
        json_path = os.path.join(output_path, f"{base}_{report_suffix}_report.json")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(format_fn(file_result))
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(file_result.get("results", {}), f, ensure_ascii=False, indent=2)

        output = dict(file_result.get("toolRunOutput", {}))
        output.setdefault("status", "success")
        output.setdefault("summary", "工具执行完成")
        output.setdefault("metrics", [])
        output.setdefault("artifacts", [])
        output.setdefault("rowGuard", {"blocked": False})

        # 自动把 report artifact 元数据补入（如果 process_fn 没提供）。
        existing_relpaths = {a.get("relPath") for a in output["artifacts"]}
        if md_path and json_path:
            for path, kind in [(md_path, "report"), (json_path, "data")]:
                meta = make_artifact_metadata(path, output_path, kind)
                if meta["relPath"] not in existing_relpaths:
                    output["artifacts"].append(meta)
        return output
    except Exception as e:
        return {
            "status": "failed",
            "summary": str(e),
            "metrics": [],
            "artifacts": [],
            "rowGuard": {"blocked": False},
            "errorCode": "tool_error",
        }


def main_tool_native(description, param_defs, process_fn, format_fn, report_suffix, tool_id):
    """试点工具入口：直接输出标准 ToolRunOutput 结构到 summary.json。"""
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
        summary = run_tool_native(input_path, output_path, opts, process_fn, format_fn, report_suffix, tool_id)
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[OK] {description}: status={summary.get('status')}")
    except Exception as e:
        summary = {
            "status": "failed",
            "summary": str(e),
            "metrics": [],
            "artifacts": [],
            "rowGuard": {"blocked": False},
            "errorCode": "tool_error",
        }
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[ERROR] {e}")
        raise
