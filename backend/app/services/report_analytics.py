"""以完整日期桶作等距線性迴歸；只供描述與基準外推，沒有自動因果解讀。"""
import calendar
import datetime as dt
import math


def bucket_bounds(key: str, dimension: str) -> tuple[dt.date, dt.date]:
    if dimension == "year":
        year = int(key)
        return dt.date(year, 1, 1), dt.date(year, 12, 31)
    if dimension == "quarter":
        year, quarter = key.replace("-Q", "-").split("-")
        year, month = int(year), (int(quarter) - 1) * 3 + 1
        return dt.date(year, month, 1), dt.date(year, month + 2, calendar.monthrange(year, month + 2)[1])
    year, month = map(int, key.split("-"))
    return dt.date(year, month, 1), dt.date(year, month, calendar.monthrange(year, month)[1])


def analysis(points, dimension: str, start: dt.date, end: dt.date, today: dt.date, forecast_periods: int = 0) -> dict:
    complete = [(index, point) for index, point in enumerate(points) if point.value is not None and bucket_bounds(point.key, dimension)[0] >= start and bucket_bounds(point.key, dimension)[1] <= min(end, today)]
    empty = {"trend": [], "forecast": [], "note": "線性迴歸至少需要 3 個完整且有可計算數值的日期區間；預測需要 6 個連續完整區間。"}
    if len(complete) < 3:
        return empty
    # 不跨過空值或缺少的區間；資料源明確返回的零值桶可以參與。
    if any(b[0] != a[0] + 1 for a, b in zip(complete, complete[1:])):
        return {**empty, "note": "日期區間含缺值，無法建立連續序列；請先調整資料或期間。"}
    mean_x = sum(i for i, _ in complete) / len(complete)
    mean_y = sum(p.value for _, p in complete) / len(complete)
    variance = sum((i - mean_x) ** 2 for i, _ in complete)
    slope = sum((i - mean_x) * (p.value - mean_y) for i, p in complete) / variance
    intercept = mean_y - slope * mean_x
    trend = [{"key": p.key, "label": p.label, "value": intercept + slope * i} for i, p in complete]
    forecast = []
    if forecast_periods and len(complete) >= 6:
        last_index, last = complete[-1]
        first, _ = bucket_bounds(last.key, dimension)
        months = {"year": 12, "quarter": 3, "month": 1}[dimension]
        for offset in range(1, forecast_periods + 1):
            index = first.year * 12 + first.month - 1 + offset * months
            year, month = divmod(index, 12)
            month += 1
            if year > 9999:
                break
            key = str(year) if dimension == "year" else f"{year}-Q{(month - 1) // 3 + 1}" if dimension == "quarter" else f"{year}-{month:02d}"
            value = intercept + slope * (last_index + offset)
            if math.isfinite(value):
                forecast.append({"key": key, "label": key, "value": value})
    note = f"以 {len(complete)} 個完整日期區間進行最小平方法線性迴歸；未完成的首尾區間與未來空桶不參與。"
    if forecast_periods:
        note += " 虛線為線性外推，未建模季節性、活動或外部因素，可能出現負值，僅供情境參考。" if forecast else " 預測需要至少 6 個連續完整日期區間。"
    return {"trend": trend, "forecast": forecast, "note": note}
