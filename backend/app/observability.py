"""Prometheus metrics for Alloy. Labels never contain account IDs or query strings."""

from secrets import compare_digest
from time import perf_counter
from uuid import uuid4

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
from app.request_logs import RequestLog

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
    def __init__(self, app: ASGIApp, metrics: HttpMetrics, request_log: RequestLog | None = None):
        self.app = app
        self.metrics = metrics
        self.request_log = request_log

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        # Health probes and scrapes must not dominate application latency and traffic.
        if scope["type"] != "http" or scope["path"] in ("/health", "/metrics"):
            return await self.app(scope, receive, send)
        started = perf_counter()
        status = 500  # Includes exceptions before response headers have been sent.
        response_complete = False
        error = None
        request_id = uuid4().hex if self.request_log is not None else ""
        self.metrics.in_progress.inc()

        async def observed_send(message: Message):
            nonlocal status, response_complete
            if message["type"] == "http.response.start":
                status = message["status"]
                if request_id:
                    message = dict(message)
                    message["headers"] = [
                        (key, value) for key, value in message.get("headers", [])
                        if key.lower() != b"x-request-id"
                    ] + [(b"x-request-id", request_id.encode("ascii"))]
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                response_complete = True

        try:
            await self.app(scope, receive, observed_send)
        except Exception as exc:
            error = exc
            raise
        finally:
            self.metrics.in_progress.dec()
            route = getattr(scope.get("route"), "path", "unmatched")
            method = scope["method"] if scope["method"] in METHODS else "OTHER"
            self.metrics.requests.labels(method, route, str(status)).inc()
            duration = perf_counter() - started
            self.metrics.duration.labels(method, route).observe(duration)
            if self.request_log is not None:
                self.request_log.write(
                    method=method, route=route, status=status, duration=duration,
                    request_id=request_id, response_complete=response_complete, error=error,
                )


def install_metrics(app: FastAPI) -> None:
    metrics = HttpMetrics()
    app.state.http_metrics = metrics
    path = settings().request_log_path
    request_log = RequestLog(path) if path else None
    app.state.request_log = request_log
    app.add_middleware(MetricsMiddleware, metrics=metrics, request_log=request_log)

    @app.get("/metrics", include_in_schema=False)
    def prometheus_metrics(request: Request) -> Response:
        token = settings().metrics_token
        if not token:
            raise HTTPException(404, "Not found")
        authorization = request.headers.get("authorization", "")
        if not compare_digest(authorization.encode(), f"Bearer {token}".encode()):
            raise HTTPException(401, "Invalid metrics token", headers={"WWW-Authenticate": "Bearer"})
        return Response(generate_latest(metrics.registry), headers={"Content-Type": CONTENT_TYPE_LATEST})
