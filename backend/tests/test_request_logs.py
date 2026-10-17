"""Loki diagnostics preserve useful failures without exporting user data."""

import asyncio
import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.observability import HttpMetrics, MetricsMiddleware, install_metrics
from app.request_logs import RequestLog


@pytest.fixture
def logged(env, tmp_path):
    path = tmp_path / "logs" / "api.jsonl"
    env(REQUEST_LOG_PATH=str(path), METRICS_TOKEN="private-metrics-token")
    app = FastAPI()
    install_metrics(app)

    @app.post("/customers/{customer_id}")
    async def customer(customer_id: str, request: Request):
        await request.body()
        return {"id": customer_id}

    @app.get("/limited")
    def limited():
        raise HTTPException(429, "private-rate-limit-detail")

    @app.get("/broken")
    def broken():
        raise RuntimeError("private-database-password-and-customer-text")

    @app.get("/stream/{broken}")
    async def stream(broken: bool):
        async def chunks():
            yield b"private-response-body"
            if broken:
                raise RuntimeError("private-stream-error")
        return StreamingResponse(chunks())

    @app.get("/health")
    def health():
        return {"status": "ok"}

    with TestClient(app, raise_server_exceptions=False) as client:
        yield app, client, path
    app.state.request_log.close()


def entries(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_logs_allowlist_and_server_generated_request_id(logged):
    _, client, path = logged
    response = client.post(
        "/customers/private-customer-id?token=private-query-token",
        json={"text": "private-request-body"},
        headers={"Authorization": "Bearer private-auth-token", "X-Request-ID": "private-client-id"},
    )
    assert response.status_code == 200
    event, = entries(path)
    assert set(event) == {
        "timestamp", "event", "level", "method", "route", "status", "duration_ms", "request_id", "response_complete",
    }
    assert event["route"] == "/customers/{customer_id}"
    assert event["method"] == "POST"
    assert event["status"] == 200
    assert event["level"] == "info"
    assert event["response_complete"] is True
    assert event["duration_ms"] >= 0
    assert datetime.fromisoformat(event["timestamp"]).tzinfo is not None
    assert event["request_id"] == response.headers["x-request-id"]
    assert len(event["request_id"]) == 32
    assert "private-" not in path.read_text()


def test_health_metrics_and_unknown_paths_do_not_leak(logged):
    _, client, path = logged
    assert client.get("/health").status_code == 200
    assert client.get("/metrics", headers={"Authorization": "Bearer private-metrics-token"}).status_code == 200
    assert not path.exists()
    assert client.get("/private-unknown-path?secret=private-query").status_code == 404
    event, = entries(path)
    assert event["route"] == "unmatched"
    assert event["level"] == "warn"
    assert "private-" not in path.read_text()


def test_error_types_and_code_locations_without_exception_messages(logged):
    _, client, path = logged
    assert client.get("/limited").status_code == 429
    assert client.get("/broken").status_code == 500
    limited, broken = entries(path)
    assert limited["level"] == "warn"
    assert broken["status"] == 500
    assert broken["level"] == "error"
    assert broken["error_type"] == "RuntimeError"
    assert broken["response_complete"] is False
    assert 1 <= len(broken["error_frames"]) <= 8
    assert broken["error_frames"][-1]["function"] == "broken"
    assert all(set(frame) == {"file", "function", "line"} for frame in broken["error_frames"])
    assert all("/" not in frame["file"] for frame in broken["error_frames"])
    assert "private-" not in path.read_text()


def test_stream_failures_keep_sent_status_and_mark_incomplete(logged):
    _, client, path = logged
    assert client.get("/stream/false").content == b"private-response-body"
    client.get("/stream/true")
    complete, incomplete = entries(path)
    assert complete["response_complete"] is True
    assert incomplete["status"] == 200  # Headers were already sent.
    assert incomplete["response_complete"] is False
    assert incomplete["level"] == "error"
    assert incomplete["error_type"] == "RuntimeError"
    assert "private-" not in path.read_text()


def test_disabled_logging_does_not_add_headers(env, tmp_path):
    env(REQUEST_LOG_PATH="")
    app = FastAPI()
    install_metrics(app)

    @app.get("/ok")
    def ok():
        return {"ok": True}

    with TestClient(app) as client:
        response = client.get("/ok")
    assert app.state.request_log is None
    assert "x-request-id" not in response.headers


def test_log_io_failure_does_not_fail_requests(logged, monkeypatch, caplog):
    app, client, _ = logged

    def unavailable():
        raise OSError("private-disk-error")

    monkeypatch.setattr(app.state.request_log.handler, "_open", unavailable)
    for _ in range(2):
        assert client.post("/customers/one").status_code == 200
    warnings = [record for record in caplog.records if "diagnostic log unavailable" in record.message]
    assert len(warnings) == 1
    assert "private-disk-error" not in caplog.text


def test_log_rotation_bounds_disk_usage(tmp_path):
    path = tmp_path / "api.jsonl"
    log = RequestLog(str(path))
    log.handler.maxBytes = 500
    for _ in range(30):
        log.write(
            method="GET", route="/ok", status=200, duration=0.1,
            request_id="a" * 32, response_complete=True, error=None,
        )
    log.close()
    files = list(tmp_path.glob("api.jsonl*"))
    assert len(files) == 3
    assert all(file.stat().st_size <= 500 for file in files)
    assert all(entries(file) for file in files)


async def test_cancelled_stream_is_logged_and_cancellation_propagates(tmp_path):
    path = tmp_path / "api.jsonl"
    log = RequestLog(str(path))
    metrics = HttpMetrics()

    async def cancelled(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise asyncio.CancelledError()

    async def ignore(message=None):
        pass

    middleware = MetricsMiddleware(cancelled, metrics=metrics, request_log=log)
    with pytest.raises(asyncio.CancelledError):
        await middleware({"type": "http", "path": "/stream", "method": "GET", "route": SimpleNamespace(path="/stream")}, ignore, ignore)
    log.close()
    event, = entries(path)
    assert event["level"] == "error"
    assert event["status"] == 200
    assert event["response_complete"] is False
    assert metrics.registry.get_sample_value("meddemo_http_requests_in_progress") == 0
