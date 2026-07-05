#!/usr/bin/env python3
import argparse
import json
import os
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

REQUIRED_COLS = ["日期", "指标"]
DATE_ALIASES = {"date", "时间", "day", "ds", "period"}
METRIC_ALIASES = {"value", "销售", "销量", "销售额", "流量", "访客", "gmv", "sales", "volume"}


def detect_column(df):
    date_col = None
    metric_col = None
    for col in df.columns:
        col_lower = str(col).lower().strip()
        if date_col is None and (col_lower in DATE_ALIASES or any(k in col_lower for k in ["日期", "date", "时间"])):
            date_col = col
        if metric_col is None and (col_lower in METRIC_ALIASES or any(k in col_lower for k in ["销售", "销量", "value", "指标"])):
            metric_col = col
        if date_col is not None and metric_col is not None:
            break
    if date_col is None:
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                continue
            try:
                parsed = pd.to_datetime(df[col], errors="coerce")
                if parsed.notna().sum() >= max(1, len(df) // 2):
                    date_col = col
                    break
            except (ValueError, TypeError):
                continue
    return date_col, metric_col


def process_file(file_path, opts):
    df = pd.read_csv(file_path, encoding="utf-8")
    if df.empty:
        return {"error": "CSV 文件为空", "results": {}}

    date_col, metric_col = detect_column(df)

    missing = []
    if date_col is None or date_col not in df.columns:
        missing.append("日期")
    if metric_col is None or metric_col not in df.columns:
        missing.append("指标")
    if missing:
        return {"error": f"缺少必需字段: {', '.join(missing)}", "results": {}}

    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col]).sort_values(date_col).reset_index(drop=True)
    df[metric_col] = pd.to_numeric(df[metric_col], errors="coerce").fillna(0)

    if len(df) < 4:
        return {"error": f"数据点过少 ({len(df)}), 至少需要 4 个数据点", "results": {}}

    seasonal_period = int(opts.get("seasonal_period", 7))
    forecast_horizon = int(opts.get("forecast_horizon", 14))
    values = df[metric_col].values.astype(float)
    n = len(values)
    period = min(seasonal_period, max(2, n // 2))

    from statsmodels.tsa.seasonal import STL
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    trend = None
    seasonal = None
    residual = None
    try:
        stl = STL(values, period=period, robust=True)
        stl_result = stl.fit()
        trend = stl_result.trend
        seasonal = stl_result.seasonal
        residual = stl_result.resid
    except Exception:
        trend = pd.Series(values).rolling(window=period, min_periods=1, center=True).mean().values
        trend = np.where(np.isnan(trend), values, trend)
        seasonal = values - trend
        residual = np.zeros_like(values)

    decomposed = {
        "actual": [round(float(v), 4) for v in values],
        "trend": [round(float(v), 4) for v in trend] if trend is not None else [],
        "seasonal": [round(float(v), 4) for v in seasonal] if seasonal is not None else [],
        "residual": [round(float(v), 4) for v in residual] if residual is not None else [],
        "dates": [str(d.date()) for d in df[date_col]],
    }

    forecast_values = []
    forecast_lower = []
    forecast_upper = []
    try:
        model = ExponentialSmoothing(
            values, seasonal_periods=period, trend="add", seasonal="add",
            initialization_method="estimated",
        ).fit()
        forecast = model.forecast(forecast_horizon)
        forecast_values = [round(float(v), 4) for v in forecast]
        sigma = float(np.std(model.resid)) if len(model.resid) > 1 else 0.0
        for h, v in enumerate(forecast, start=1):
            band = 1.96 * sigma * np.sqrt(h)
            forecast_lower.append(round(float(v) - band, 4))
            forecast_upper.append(round(float(v) + band, 4))
    except Exception:
        last_val = values[-1] if len(values) > 0 else 0
        for i in range(forecast_horizon):
            forecast_values.append(round(float(last_val), 4))
            forecast_lower.append(round(float(last_val * 0.8), 4))
            forecast_upper.append(round(float(last_val * 1.2), 4))

    last_date = df[date_col].iloc[-1]
    forecast_dates = []
    delta = (df[date_col].iloc[-1] - df[date_col].iloc[-2]) if len(df) >= 2 else pd.Timedelta(days=1)
    for i in range(1, forecast_horizon + 1):
        forecast_dates.append(str((last_date + i * delta).date()))

    return {
        "results": {
            "dataPoints": n,
            "seasonalPeriod": period,
            "forecastPeriods": forecast_horizon,
            "decomposed": decomposed,
            "forecast": {
                "dates": forecast_dates,
                "values": forecast_values,
                "lower95": forecast_lower,
                "upper95": forecast_upper,
            },
        }
    }


def format_md(result):
    lines = []
    lines.append("# 季节性分解与预测报告\n")
    r = result.get("results", {})
    if not r:
        lines.append("（无有效分析结果）\n")
        return "\n".join(lines)

    lines.append(f"- 数据点数: {r.get('dataPoints', '-')}")
    lines.append(f"- 季节周期: {r.get('seasonalPeriod', '-')}")
    lines.append(f"- 预测期数: {r.get('forecastPeriods', '-')}\n")

    dec = r.get("decomposed", {})
    if dec.get("dates"):
        lines.append("## STL 季节分解（最近 10 期）\n")
        lines.append("| 日期 | 实际值 | 趋势 | 季节 | 残差 |")
        lines.append("|------|--------|------|------|------|")
        dates = dec["dates"]
        actual = dec.get("actual", [])
        trend = dec.get("trend", [])
        seasonal = dec.get("seasonal", [])
        residual = dec.get("residual", [])
        for i in range(max(0, len(dates) - 10), len(dates)):
            a = round(actual[i], 2) if i < len(actual) else "-"
            t = round(trend[i], 2) if i < len(trend) else "-"
            s = round(seasonal[i], 2) if i < len(seasonal) else "-"
            r_ = round(residual[i], 2) if i < len(residual) else "-"
            lines.append(f"| {dates[i]} | {a} | {t} | {s} | {r_} |")
        lines.append("")

    fc = r.get("forecast", {})
    if fc.get("dates"):
        lines.append("## 预测值\n")
        lines.append("| 日期 | 预测值 | 下限(95%) | 上限(95%) |")
        lines.append("|------|--------|-----------|-----------|")
        for i in range(len(fc["dates"])):
            v = fc["values"][i] if i < len(fc["values"]) else "-"
            lo = fc["lower95"][i] if i < len(fc["lower95"]) else "-"
            hi = fc["upper95"][i] if i < len(fc["upper95"]) else "-"
            lines.append(f"| {fc['dates'][i]} | {v} | {lo} | {hi} |")
        lines.append("")

    return "\n".join(lines)


def run(input_path, output_path, opts):
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
            file_result = process_file(file_path, opts)
            file_result["file"] = os.path.basename(file_path)
            if "error" in file_result:
                results.append(file_result)
            else:
                base = os.path.splitext(os.path.basename(file_path))[0]
                md_path = os.path.join(output_path, f"{base}_seasonal_forecast_report.md")
                json_path = os.path.join(output_path, f"{base}_seasonal_forecast_report.json")
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(format_md(file_result))
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(file_result["results"], f, ensure_ascii=False, indent=2)
                file_result["outputs"] = [md_path, json_path]
                results.append(file_result)
        except Exception as e:
            results.append({"file": os.path.basename(file_path), "error": str(e), "outputs": []})

    return {
        "success": sum(1 for r in results if "error" not in r or not r.get("error")),
        "failed": sum(1 for r in results if r.get("error")),
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="季节性分解与预测")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-summary", required=True)
    parser.add_argument("--param-seasonal_period", type=int, default=7)
    parser.add_argument("--param-forecast_horizon", type=int, default=14)
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)
    opts = {"seasonal_period": args.param_seasonal_period, "forecast_horizon": args.param_forecast_horizon}

    try:
        summary = run(input_path, output_path, opts)
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        print(f"[OK] 分析完成: 成功 {summary['success']} 个, 失败 {summary['failed']} 个")
    except Exception as e:
        with open(args.json_summary, "w", encoding="utf-8") as f:
            json.dump({"success": 0, "failed": 1, "error": str(e), "results": []}, f, ensure_ascii=False, indent=2)
        print(f"[ERROR] {e}")
        raise


if __name__ == "__main__":
    main()
