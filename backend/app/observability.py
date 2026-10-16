"""Prometheus metrics for Alloy. Labels never contain account IDs or query strings."""

from secrets import compare_digest
from time import perf_counter

from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    GCCollector,
    Gauge,
    Histogram,
    PlatformCollector,
    ProcessCollector,
    generate_latest,
)
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings

METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"})


class HttpMetrics:
    def __init__(self):
        self.registry = CollectorRegistry()
        ProcessCollector(registry=self.registry)
        PlatformCollector(registry=self.registry)
        GCCollector(registry=self.registry)
        self.requests = Counter(
            "meddemo_http_requests_total", "Completed HTTP requests.",
            ("method", "route", "status"), registry=self.registry,
        )
        self.duration = Histogram(
            "meddemo_http_request_duration_seconds", "Time until the response body completes.",
            ("method", "route"),
            buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120),
            registry=self.registry,
        )
        self.in_progress = Gauge(
            "meddemo_http_requests_in_progress", "HTTP requests currently being served.",
            registry=self.registry,
        )


class MetricsMiddleware:
    def __init__(self, app: ASGIApp, metrics: HttpMetrics):
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        # Health probes and scrapes must not dominate application latency and traffic.
        if scope["type"] != "http" or scope["path"] in ("/health", "/metrics"):
            return await self.app(scope, receive, send)
        started = perf_counter()
        status = 500  # Includes exceptions before response headers have been sent.
        self.metrics.in_progress.inc()

        async def observed_send(message: Message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, observed_send)
        finally:
            self.metrics.in_progress.dec()
            route = getattr(scope.get("route"), "path", "unmatched")
            method = scope["method"] if scope["method"] in METHODS else "OTHER"
            self.metrics.requests.labels(method, route, str(status)).inc()
            self.metrics.duration.labels(method, route).observe(perf_counter() - started)


def install_metrics(app: FastAPI) -> None:
    metrics = HttpMetrics()
    app.state.http_metrics = metrics
    app.add_middleware(MetricsMiddleware, metrics=metrics)

    @app.get("/metrics", include_in_schema=False)
    def prometheus_metrics(request: Request) -> Response:
        token = settings().metrics_token
        if not token:
            raise HTTPException(404, "Not found")
        authorization = request.headers.get("authorization", "")
        if not compare_digest(authorization.encode(), f"Bearer {token}".encode()):
            raise HTTPException(401, "Invalid metrics token", headers={"WWW-Authenticate": "Bearer"})
        return Response(generate_latest(metrics.registry), headers={"Content-Type": CONTENT_TYPE_LATEST})
