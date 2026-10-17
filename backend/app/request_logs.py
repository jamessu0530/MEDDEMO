"""Bounded, allowlisted HTTP diagnostics for Alloy/Loki; never export request data."""

import json
import logging
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from traceback import extract_tb


class _SafeRotatingHandler(RotatingFileHandler):
    warned = False

    def handleError(self, record: logging.LogRecord) -> None:
        # A full/unwritable log volume must not break an API response. Do not print
        # the record or exception: ordinary logging handlers may expose payloads.
        if not self.warned:
            self.warned = True
            logging.getLogger(__name__).warning("API diagnostic log unavailable; check the log volume")


class RequestLog:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.handler = _SafeRotatingHandler(
            path, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8", delay=True,
        )
        self.handler.setFormatter(logging.Formatter("%(message)s"))

    def write(
        self, *, method: str, route: str, status: int, duration: float,
        request_id: str, response_complete: bool, error: Exception | None,
    ) -> None:
        level = (
            "error" if error is not None or status >= 500 or not response_complete
            else "warn" if status >= 400 else "info"
        )
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "http_request", "level": level, "method": method,
            "route": route, "status": status, "duration_ms": round(duration * 1000, 3),
            "request_id": request_id, "response_complete": response_complete,
        }
        if error is not None:
            # Exception messages, source lines and locals may contain credentials,
            # SQL parameters or user text. Keep only code locations and the type.
            event["error_type"] = type(error).__name__
            event["error_frames"] = [
                {"file": Path(frame.filename).name, "function": frame.name, "line": frame.lineno}
                for frame in extract_tb(error.__traceback__)[-8:]
            ]
        record = logging.LogRecord(
            "meddemo.http", logging.INFO, "", 0,
            json.dumps(event, ensure_ascii=False, separators=(",", ":")), (), None,
        )
        self.handler.handle(record)

    def close(self) -> None:
        self.handler.close()
