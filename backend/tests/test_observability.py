"""Metrics security, bounded labels, error handling and streaming responses."""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.observability import install_metrics


@pytest.fixture
def monitored(env):
    env(METRICS_TOKEN="metrics-test-token")
    app = FastAPI()
    install_metrics(app)

    @app.get("/customers/{customer_id}")
    def customer(customer_id: str):
        return {"id": customer_id}

    @app.get("/limited")
    def limited():
        raise HTTPException(429, "limited")

    @app.get("/broken")
    def broken():
        raise RuntimeError("test exception")

    @app.get("/stream")
    async def stream():
        async def chunks():
            yield b"first"
            yield b"second"
        return StreamingResponse(chunks())

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app, TestClient(app, raise_server_exceptions=False)


def scrape(client):
    response = client.get("/metrics", headers={"Authorization": "Bearer metrics-test-token"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    return response.text


def test_scrape_requires_a_separate_token_and_is_disabled_when_unconfigured(monitored, env):
    _, client = monitored
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
    # ProcessCollector exposes /proc metrics on Linux; development also runs on macOS.
    assert "python_info" in scrape(client)
    assert "/metrics" not in client.get("/openapi.json").json()["paths"]
    env(METRICS_TOKEN="")
    assert client.get("/metrics", headers={"Authorization": "Bearer metrics-test-token"}).status_code == 404


def test_labels_use_route_templates_and_group_unmatched_paths(monitored):
    app, client = monitored
    client.get("/customers/private-id-one?query=secret")
    client.get("/customers/private-id-two")
    client.get("/not-found-one")
    client.get("/not-found-two")
    registry = app.state.http_metrics.registry
    assert registry.get_sample_value("meddemo_http_requests_total", {
        "method": "GET", "route": "/customers/{customer_id}", "status": "200",
    }) == 2
    assert registry.get_sample_value("meddemo_http_requests_total", {
        "method": "GET", "route": "unmatched", "status": "404",
    }) == 2
    output = scrape(client)
    for private in ("private-id-one", "private-id-two", "secret", "not-found-one", "not-found-two"):
        assert private not in output


def test_errors_streams_and_health_probe_exclusion(monitored):
    app, client = monitored
    assert client.get("/limited").status_code == 429
    assert client.get("/broken").status_code == 500
    assert client.get("/stream").content == b"firstsecond"
    assert client.get("/health").status_code == 200
    for route, status in (("/limited", "429"), ("/broken", "500"), ("/stream", "200")):
        assert app.state.http_metrics.registry.get_sample_value("meddemo_http_requests_total", {
            "method": "GET", "route": route, "status": status,
        }) == 1
    assert app.state.http_metrics.registry.get_sample_value("meddemo_http_requests_in_progress") == 0
    output = scrape(client)
    assert 'route="/health"' not in output
    assert 'route="/metrics"' not in output
