"""Cloud 同步、查詢範圍、細項聚合、缺值與憑證隔離。上游 HTTP 使用 mock。"""

import datetime as dt
import json
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest

from app.services import cloud_metrics


def params(request):
    return {key: values[0] for key, values in parse_qs(request.content.decode()).items()}


@pytest.fixture

def cloud(env, monkeypatch):
    env(GRAFANA_CLOUD_QUERY_URL="https://metrics.example.grafana.net/api/prom/",
        GRAFANA_CLOUD_PROMETHEUS_USERNAME="12345", GRAFANA_CLOUD_READ_TOKEN="private-read-token",
        GRAFANA_CLOUD_ENVIRONMENT="production", GRAFANA_CLOUD_REFRESH_SECONDS="5")
    monkeypatch.setattr(cloud_metrics, "_cached", {})
    original_client = httpx.Client
    calls = []

    def install(handler):
        def record(request):
            calls.append(request)
            return handler(request)
        monkeypatch.setattr(cloud_metrics.httpx, "Client", lambda **kwargs: original_client(
            transport=httpx.MockTransport(record), **kwargs,
        ))
    return install, calls


def reply(kind, values):
    return httpx.Response(200, json={"status": "success", "data": {"resultType": kind, "result": values}})


def sample(name, value, **labels):
    return {"metric": {"meddemo_stat": name, **labels}, "value": [dt.datetime.now(dt.timezone.utc).timestamp(), str(value)]}


def snapshot(values, age=5):
    values = {"last_scraped_at": dt.datetime.now(dt.timezone.utc).timestamp() - age, **values}
    return reply("vector", [sample(name, value) for name, value in values.items()])


def empty_details_or_history(request):
    return reply("matrix" if request.url.path.endswith("query_range") else "vector", [])


def summary_request(request):
    return request.url.path.endswith("query") and '"last_scraped_at"' in params(request)["query"]


def test_cloud_values_history_and_clock_aligned_cache(cloud, monkeypatch):
    install, calls = cloud
    monkeypatch.setattr(cloud_metrics.time, "time", lambda: 1001.0)
    now = dt.datetime.now(dt.timezone.utc).timestamp()

    def handler(request):
        if request.url.path.endswith("query_range"):
            return reply("matrix", [{"metric": {"meddemo_stat": "requests_per_second"}, "values": [[now - 15, "2.4"], [now, "NaN"]]}])
        if summary_request(request):
            return snapshot({"scrape_up": 1, "requests_per_second": 2.4, "error_percent": 0,
                             "p95_seconds": 0.15, "cpu_cores": 0.2, "memory_bytes": 104857600})
        return reply("vector", [])

    install(handler)
    result = cloud_metrics.overview()
    assert result.status == "ready"
    assert result.refresh_seconds == 5
    assert result.error_percent == 0
    assert result.p95_seconds == 0.15
    assert result.memory_bytes == 104857600
    assert result.in_progress is None
    assert result.history["requests_per_second"][1].value is None
    assert cloud_metrics.overview() is result
    assert len(calls) == 3
    assert all(request.method == "POST" and request.url.path.startswith("/api/prom/api/v1/") for request in calls)
    assert all('environment="production"' in params(request)["query"] for request in calls)
    history = next(request for request in calls if request.url.path.endswith("query_range"))
    assert params(history)["step"] == "15"
    assert "Authorization" in calls[0].headers
    assert "private-read-token" not in result.model_dump_json()
    assert "12345" not in result.model_dump_json()
    # 新的五秒時鐘邊界可立即讀到 Cloud；沒有沿用舊的三十秒快取。
    monkeypatch.setattr(cloud_metrics.time, "time", lambda: 1005.0)
    cloud_metrics.overview()
    assert len(calls) == 6


def test_window_switch_has_independent_cache_and_bounded_resolution(cloud, monkeypatch):
    install, calls = cloud
    monkeypatch.setattr(cloud_metrics.time, "time", lambda: 1001.0)
    install(empty_details_or_history)
    for window, (seconds, step) in cloud_metrics.WINDOWS.items():
        result = cloud_metrics.overview(window)
        assert result.window_seconds == seconds
        assert result.step_seconds == step
        assert result.range_end - result.range_start == seconds
        assert seconds // step <= 360
    assert len(calls) == 12
    cloud_metrics.overview("15m")
    assert len(calls) == 12
    for request in calls:
        if request.url.path.endswith("query_range"):
            query = params(request)
            assert (float(query["end"]) - float(query["start"])) / int(query["step"]) <= 360


def test_route_status_and_instance_details_merge_without_identifier_leaks(cloud):
    install, _ = cloud
    route = {"method": "GET", "route": "/api/customers/{customer_id}"}
    details = [
        sample("route_requests", 40, **route), sample("route_rate", 0.7, **route), sample("route_p95", 0.25, **route),
        sample("route_requests", 20, method="POST", route="/api/asks"), sample("route_server_errors", 2, method="POST", route="/api/asks"),
        sample("status_requests", 58, status="200"), sample("status_requests", 2, status="500"),
        sample("instance_up", 1, instance="api-1"), sample("instance_cpu", 0.1, instance="api-1"),
        sample("instance_memory", 104857600, instance="api-1"), sample("instance_uptime", 7200, instance="api-1"),
    ]
    install(lambda request: snapshot({"scrape_up": 1, "instances_up": 1, "instances_total": 1}) if summary_request(request)
            else reply("vector", details) if request.url.path.endswith("query") else reply("matrix", []))
    result = cloud_metrics.overview()
    assert result.routes[0].route == route["route"]
    assert result.routes[0].server_errors == 0
    assert result.routes[0].p95_seconds == 0.25
    assert result.routes[1].server_errors == 2
    assert result.status_codes[1].status == "500"
    assert result.instances[0].memory_bytes == 104857600
    assert result.instances[0].in_progress is None
    assert result.instances[0].uptime_seconds == 7200


def test_missing_read_token_never_calls_cloud(cloud, env):
    install, calls = cloud
    install(lambda _: pytest.fail("Must not contact Cloud without credentials"))
    env(GRAFANA_CLOUD_READ_TOKEN="")
    assert cloud_metrics.overview().status == "unconfigured"
    assert not calls


def test_missing_samples_and_nonfinite_values_are_not_zero(cloud):
    install, _ = cloud
    install(lambda request: snapshot({"scrape_up": 1, "p95_seconds": "NaN", "requests_per_second": 0})
            if summary_request(request) else empty_details_or_history(request))
    result = cloud_metrics.overview()
    assert result.status == "ready"
    assert result.p95_seconds is None
    assert result.requests_per_second == 0
    assert result.cpu_cores is None
    assert result.success_percent is None
    assert result.error_percent is None


def test_no_recent_scrapes_are_reported_as_no_data(cloud):
    install, _ = cloud
    install(empty_details_or_history)
    result = cloud_metrics.overview()
    assert result.status == "no_data"
    assert result.scrape_up is None
    assert result.requests_in_range is None


def test_old_scrape_is_marked_as_delayed(cloud):
    install, _ = cloud
    install(lambda request: snapshot({"scrape_up": 1}, age=25) if summary_request(request) else empty_details_or_history(request))
    result = cloud_metrics.overview()
    assert result.status == "ready"
    assert "尚未更新" in result.message


@pytest.mark.parametrize("status_code", [401, 403, 429, 500])
def test_cloud_errors_are_sanitized_and_cached(cloud, status_code, monkeypatch):
    install, calls = cloud
    monkeypatch.setattr(cloud_metrics.time, "time", lambda: 1001.0)
    install(lambda _: httpx.Response(status_code, text="private-read-token upstream error"))
    result = cloud_metrics.overview()
    assert result.status == "error"
    assert "private-read-token" not in result.model_dump_json()
    if status_code in (401, 403):
        assert "metrics:read" in result.message
    assert cloud_metrics.overview() is result
    assert len(calls) == 3


@pytest.mark.parametrize("body", [[], {"status": "error"}, {"status": "success", "data": []}])
def test_invalid_payloads_do_not_escape(cloud, body):
    install, _ = cloud
    install(lambda _: httpx.Response(200, json=body))
    assert cloud_metrics.overview().status == "error"


def test_connection_failure_does_not_escape(cloud):
    install, _ = cloud
    def fail(_):
        raise httpx.ReadTimeout("private-read-token")
    install(fail)
    result = cloud_metrics.overview()
    assert result.status == "error"
    assert "private-read-token" not in result.model_dump_json()


def test_config_change_invalidates_cache_and_environment_is_escaped(cloud, env):
    install, calls = cloud
    install(empty_details_or_history)
    cloud_metrics.overview()
    env(GRAFANA_CLOUD_ENVIRONMENT='local-"validation')
    result = cloud_metrics.overview()
    assert len(calls) == 6
    assert 'environment="local-\\"validation"' in params(calls[-1])["query"]
    assert result.environment == 'local-"validation'


def test_never_sends_credentials_over_http(cloud, env):
    install, calls = cloud
    install(lambda _: pytest.fail("Must not transmit credentials"))
    env(GRAFANA_CLOUD_QUERY_URL="http://metrics.example.grafana.net/api/prom")
    assert cloud_metrics.overview().status == "error"
    assert not calls


def test_grafana_dashboard_uses_same_cadence_and_rate_window():
    dashboard = json.loads((Path(__file__).resolve().parents[2] / "deploy/observability/grafana-dashboard.json").read_text())
    assert dashboard["refresh"] == "5s"
    queries, _ = cloud_metrics._queries("production")
    assert all("[5m]" not in query for query in queries.values())
    for panel in dashboard["panels"]:
        assert all("$__rate_interval" not in target["expr"] for target in panel.get("targets", []))


def test_slow_cloud_request_does_not_extend_old_snapshot_into_next_sync_slot(cloud, monkeypatch):
    install, calls = cloud
    clock = [1001.0]
    monkeypatch.setattr(cloud_metrics.time, "time", lambda: clock[0])
    def handler(request):
        clock[0] = 1006.0
        return empty_details_or_history(request)
    install(handler)
    cloud_metrics.overview()
    cloud_metrics.overview()
    assert len(calls) == 6


def test_nonfinite_route_error_samples_stay_missing():
    route = {"method": "POST", "route": "/api/asks"}
    routes, _, _ = cloud_metrics._breakdowns([sample("route_requests", 20, **route), sample("route_server_errors", "NaN", **route)])
    assert routes[0].server_errors is None
    assert routes[0].client_errors == 0
