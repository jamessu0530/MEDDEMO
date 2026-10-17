"""IT 儀表板與 Grafana 使用同一份 Cloud Metrics、查詢視窗與五秒更新節奏。"""

import datetime as dt
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field

from app.config import settings

MetricsWindow = Literal["15m", "1h", "6h", "24h"]
WINDOWS = {"15m": (900, 5), "1h": (3600, 15), "6h": (21600, 60), "24h": (86400, 300)}
RATE_SECONDS = 60
_locks = {window: threading.Lock() for window in WINDOWS}
_cached: dict[str, tuple[tuple, float, "CloudMetrics"]] = {}


class MetricPoint(BaseModel):
    timestamp: float
    value: float | None


class RouteMetric(BaseModel):
    method: str
    route: str
    requests: float | None = None
    requests_per_second: float | None = None
    server_errors: float | None = None
    client_errors: float | None = None
    p95_seconds: float | None = None


class StatusMetric(BaseModel):
    status: str
    requests: float


class InstanceMetric(BaseModel):
    instance: str
    up: float | None = None
    cpu_cores: float | None = None
    memory_bytes: float | None = None
    in_progress: float | None = None
    uptime_seconds: float | None = None


class CloudMetrics(BaseModel):
    status: Literal["ready", "no_data", "unconfigured", "error"]
    message: str | None = None
    environment: str
    dashboard_url: str
    window: MetricsWindow = "1h"
    window_seconds: int = 3600
    step_seconds: int = 15
    refresh_seconds: int = 5
    rate_window_seconds: int = RATE_SECONDS
    range_start: float
    range_end: float
    fetched_at: dt.datetime
    last_scraped_at: dt.datetime | None = None
    scrape_up: float | None = None
    instances_up: float | None = None
    instances_total: float | None = None
    requests_per_second: float | None = None
    requests_in_range: float | None = None
    success_percent: float | None = None
    error_percent: float | None = None
    client_error_percent: float | None = None
    p50_seconds: float | None = None
    p95_seconds: float | None = None
    p99_seconds: float | None = None
    average_seconds: float | None = None
    cpu_cores: float | None = None
    memory_bytes: float | None = None
    in_progress: float | None = None
    history: dict[str, list[MetricPoint]] = Field(default_factory=dict)
    routes: list[RouteMetric] = Field(default_factory=list)
    status_codes: list[StatusMetric] = Field(default_factory=list)
    instances: list[InstanceMetric] = Field(default_factory=list)


def _queries(environment: str, window: MetricsWindow = "1h") -> tuple[dict[str, str], dict[str, str]]:
    selector = f'job="meddemo/api",environment={json.dumps(environment)}'
    requests = f"meddemo_http_requests_total{{{selector}}}"
    histogram = f"meddemo_http_request_duration_seconds_bucket{{{selector}}}"
    rate = f"sum(rate({requests}[1m]))"

    def percent(status: str) -> str:
        selected = f'sum(rate(meddemo_http_requests_total{{{selector},status=~"{status}"}}[1m]))'
        # 沒有請求時比率維持缺值；確實有流量、沒有該類狀態時才是 0%。
        return f"100 * (({selected}) or (0 * {rate})) / ({rate} > 0)"

    summary = {
        "scrape_up": f"min(up{{{selector}}})",
        "instances_up": f"sum(up{{{selector}}})",
        "instances_total": f"count(up{{{selector}}})",
        "last_scraped_at": f"max(timestamp(up{{{selector}}}))",
        "requests_per_second": rate,
        "requests_in_range": f"sum(increase({requests}[{window}]))",
        "success_percent": percent("[23].."),
        "error_percent": percent("5.."),
        "client_error_percent": percent("4.."),
        **{f"p{q}_seconds": f"histogram_quantile({q / 100}, sum by (le) (rate({histogram}[1m])))"
           for q in (50, 95, 99)},
        "average_seconds": f"sum(rate(meddemo_http_request_duration_seconds_sum{{{selector}}}[1m])) / "
        f"sum(rate(meddemo_http_request_duration_seconds_count{{{selector}}}[1m]))",
        "cpu_cores": f"sum(rate(process_cpu_seconds_total{{{selector}}}[1m]))",
        "memory_bytes": f"sum(process_resident_memory_bytes{{{selector}}})",
        "in_progress": f"sum(meddemo_http_requests_in_progress{{{selector}}})",
    }
    breakdown = {
        "route_requests": f"sum by (method,route) (increase({requests}[{window}]))",
        "route_rate": f"sum by (method,route) (rate({requests}[1m]))",
        "route_server_errors": f'sum by (method,route) (increase(meddemo_http_requests_total{{{selector},status=~"5.."}}[{window}]))',
        "route_client_errors": f'sum by (method,route) (increase(meddemo_http_requests_total{{{selector},status=~"4.."}}[{window}]))',
        "route_p95": f"histogram_quantile(0.95, sum by (le,method,route) (rate({histogram}[1m])))",
        "status_requests": f"sum by (status) (increase({requests}[{window}]))",
        "instance_up": f"min by (instance) (up{{{selector}}})",
        "instance_cpu": f"sum by (instance) (rate(process_cpu_seconds_total{{{selector}}}[1m]))",
        "instance_memory": f"sum by (instance) (process_resident_memory_bytes{{{selector}}})",
        "instance_in_progress": f"sum by (instance) (meddemo_http_requests_in_progress{{{selector}}})",
        "instance_uptime": f"min by (instance) (time() - process_start_time_seconds{{{selector}}})",
    }
    return summary, breakdown


def _combined(queries: dict[str, str]) -> str:
    return " or ".join(
        f'label_replace(({query}), "meddemo_stat", "{name}", "", "")'
        for name, query in queries.items()
    )


def _finite(value: object) -> float | None:
    number = float(value)
    return number if math.isfinite(number) else None


def _result(response: httpx.Response, kind: str) -> list[dict]:
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict) or body.get("status") != "success":
        raise ValueError("Invalid Cloud Metrics response")
    if not isinstance(body.get("data"), dict) or body["data"].get("resultType") != kind:
        raise ValueError("Invalid Cloud Metrics result")
    result = body["data"]["result"]
    if not isinstance(result, list):
        raise ValueError("Invalid Cloud Metrics series")
    return result


def overview(window: MetricsWindow = "1h") -> CloudMetrics:
    config = settings()
    key = (
        config.grafana_cloud_query_url.rstrip("/"), config.grafana_cloud_prometheus_username,
        config.grafana_cloud_read_token, config.grafana_cloud_environment,
        config.grafana_cloud_dashboard_url, config.grafana_cloud_refresh_seconds,
    )
    # 依五秒時鐘分段，避免每次讀取把快取延後，拖慢 Cloud 的新樣本。
    with _locks[window]:
        started = time.time()
        cached = _cached.get(window)
        if cached and cached[0] == key and started < cached[1]:
            return cached[2]
        result = _fetch(*key, window)
        interval = config.grafana_cloud_refresh_seconds
        _cached[window] = (key, (int(started) // interval + 1) * interval, result)
        return result


def _breakdowns(series: list[dict]) -> tuple[list[RouteMetric], list[StatusMetric], list[InstanceMetric]]:
    routes: dict[tuple[str, str], RouteMetric] = {}
    observed_route_fields: set[tuple[tuple[str, str], str]] = set()
    instances: dict[str, InstanceMetric] = {}
    statuses = []
    route_fields = {"route_requests": "requests", "route_rate": "requests_per_second",
                    "route_server_errors": "server_errors", "route_client_errors": "client_errors", "route_p95": "p95_seconds"}
    instance_fields = {"instance_up": "up", "instance_cpu": "cpu_cores", "instance_memory": "memory_bytes",
                       "instance_in_progress": "in_progress", "instance_uptime": "uptime_seconds"}
    for item in series:
        labels = item["metric"]
        name = labels["meddemo_stat"]
        value = _finite(item["value"][1])
        if name in route_fields:
            key = (labels["method"], labels["route"])
            route = routes.setdefault(key, RouteMetric(method=key[0], route=key[1]))
            observed_route_fields.add((key, route_fields[name]))
            setattr(route, route_fields[name], value)
        elif name in instance_fields:
            key = labels["instance"]
            instance = instances.setdefault(key, InstanceMetric(instance=key))
            setattr(instance, instance_fields[name], value)
        elif name == "status_requests" and value is not None:
            statuses.append(StatusMetric(status=labels["status"], requests=value))
    # 狀態碼從未出現過時可確定該類錯誤數是零；請求總量缺值仍保留缺值。
    for key, route in routes.items():
        if route.requests is not None:
            if (key, "server_errors") not in observed_route_fields:
                route.server_errors = 0
            if (key, "client_errors") not in observed_route_fields:
                route.client_errors = 0
    return (
        sorted(routes.values(), key=lambda route: route.requests or 0, reverse=True),
        sorted(statuses, key=lambda item: item.status),
        sorted(instances.values(), key=lambda item: item.instance),
    )


def _fetch(url: str, username: str, token: str, environment: str, dashboard_url: str,
           refresh_seconds: int, window: MetricsWindow) -> CloudMetrics:
    now = dt.datetime.now(dt.timezone.utc)
    seconds, step = WINDOWS[window]
    end = int(now.timestamp()) // step * step
    base = dict(environment=environment, dashboard_url=dashboard_url, fetched_at=now,
                window=window, window_seconds=seconds, step_seconds=step, refresh_seconds=refresh_seconds,
                range_start=end - seconds, range_end=end)
    if not all((url, username, token)):
        return CloudMetrics(**base, status="unconfigured", message="尚未連接 Cloud Metrics，請設定具 metrics:read 權限的讀取金鑰。")
    try:
        parsed = urlsplit(url)
    except ValueError:
        return CloudMetrics(**base, status="error", message="Grafana Cloud 查詢網址格式不正確。")
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return CloudMetrics(**base, status="error", message="Grafana Cloud 查詢網址必須是完整的 HTTPS 端點。")

    summary, breakdown = _queries(environment, window)
    trends = {name: summary[name] for name in (
        "requests_per_second", "error_percent", "client_error_percent", "p50_seconds", "p95_seconds", "p99_seconds",
        "cpu_cores", "memory_bytes", "in_progress",
    )}
    instant_params = {"time": now.timestamp(), "timeout": "4s"}
    try:
        # 三個固定查詢同時送出；頁面不接受任意 PromQL 或上游 URL。
        with httpx.Client(auth=(username, token), timeout=5, follow_redirects=False) as client:
            def query(path, params, kind):
                return _result(client.post(f"{url}/api/v1/{path}", data=params), kind)
            with ThreadPoolExecutor(max_workers=3) as pool:
                summary_future = pool.submit(query, "query", {**instant_params, "query": _combined(summary)}, "vector")
                history_future = pool.submit(query, "query_range", {
                    "query": _combined(trends), "start": end - seconds, "end": end, "step": step, "timeout": "4s",
                }, "matrix")
                breakdown_future = pool.submit(query, "query", {**instant_params, "query": _combined(breakdown)}, "vector")
                current, history, details = summary_future.result(), history_future.result(), breakdown_future.result()
        values = {}
        for series in current:
            name = series["metric"]["meddemo_stat"]
            if name in summary:
                values[name] = _finite(series["value"][1])
        last_scrape = values.pop("last_scraped_at", None)
        last_scraped_at = dt.datetime.fromtimestamp(last_scrape, dt.timezone.utc) if last_scrape is not None else None
        points = {}
        for series in history:
            name = series["metric"]["meddemo_stat"]
            if name in trends:
                points[name] = [MetricPoint(timestamp=float(t), value=_finite(v)) for t, v in series["values"]]
        routes, statuses, instances = _breakdowns(details)
        message = None
        if last_scraped_at is None:
            message = "這個環境還沒有近期樣本，請確認 Alloy 已開始傳送資料。"
        elif (now - last_scraped_at).total_seconds() > max(20, refresh_seconds * 4):
            message = "Cloud 的最新樣本尚未更新，請確認收集與傳送狀態。"
        return CloudMetrics(**base, status="ready" if last_scraped_at else "no_data", message=message,
                            last_scraped_at=last_scraped_at, history=points, routes=routes, status_codes=statuses,
                            instances=instances, **values)
    except httpx.HTTPStatusError as exc:
        message = (
            "Grafana Cloud 拒絕讀取，請確認金鑰有效且具有 metrics:read 權限。"
            if exc.response.status_code in (401, 403)
            else "Grafana Cloud 暫時無法提供指標，請稍後重試。"
        )
    except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError, OSError):
        message = "暫時讀不到 Grafana Cloud，請稍後重試。"
    return CloudMetrics(**base, status="error", message=message)
