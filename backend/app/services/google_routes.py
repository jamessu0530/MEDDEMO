"""Google Routes API 的呼叫（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

整個專案只有這支知道 Google 的格式：網址、要哪些欄位、回來的 JSON 長什麼樣、怎樣算失敗。
其他地方拿到的是秒數、公尺與編碼過的折線；Google 連不上、逾時、回錯或格式不對一律丟 RoutesError，
由呼叫端退回直線估算。

只用 Essentials 計價的功能（價格與規定見 docs/superpowers/plans/2026-10-01-itinerary-stage4.md）：
開車、不看即時路況、不送出發時間；computeRoutes 一次最多 10 個中間點，超過就拆成好幾次送——
多一個中間點就整個請求算 Pro，貴一倍。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

Point = tuple[float, float]  # (緯度, 經度)

MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
# 等 Google 最多 5 秒，超過就退回估算：首頁不能因為 Google 慢就一直轉圈
TIMEOUT_SECONDS = 5
# computeRoutes 一次最多幾個中間點還算 Essentials
MAX_INTERMEDIATES = 10
# computeRouteMatrix 一次最多幾格（起點數 × 終點數；不看路況時的上限）
MAX_ELEMENTS = 625

MATRIX_FIELDS = "originIndex,destinationIndex,duration,distanceMeters,status,condition"
ROUTE_FIELDS = "routes.legs.duration,routes.legs.distanceMeters,routes.legs.polyline.encodedPolyline"
DRIVING = {"travelMode": "DRIVE", "routingPreference": "TRAFFIC_UNAWARE"}


class RoutesError(Exception):
    """Google 連不上、逾時、回錯或格式不對。"""


@dataclass(frozen=True)
class Cell:
    seconds: int
    meters: int


@dataclass(frozen=True)
class Leg:
    seconds: int
    meters: int
    polyline: str  # Google 的編碼折線（Encoded Polyline Algorithm Format）


def route_matrix(
    key: str, origins: list[Point], destinations: list[Point], http: httpx.Client | None = None
) -> dict[tuple[int, int], Cell]:
    """每個起點開到每個終點的時間與距離，鍵是 (起點第幾個, 終點第幾個)。開不到的格子不在結果裡。"""
    if len(origins) * len(destinations) > MAX_ELEMENTS:
        raise RoutesError(f"一次最多 {MAX_ELEMENTS} 格，這次要 {len(origins) * len(destinations)} 格")
    data = _post(key, MATRIX_URL, MATRIX_FIELDS, {
        "origins": [{"waypoint": _waypoint(p)} for p in origins],
        "destinations": [{"waypoint": _waypoint(p)} for p in destinations],
        **DRIVING,
    }, http)
    if not isinstance(data, list):
        raise RoutesError("路線矩陣的回應不是一串格子")
    try:
        cells = {}
        for element in data:
            if element.get("status", {}).get("code") or element.get("condition") != "ROUTE_EXISTS":
                continue
            # 數字是 0 的欄位 Google 會省略：第 0 個起點沒有 originIndex、同一點沒有 distanceMeters
            index = (int(element.get("originIndex", 0)), int(element.get("destinationIndex", 0)))
            cells[index] = Cell(_seconds(element.get("duration")), int(element.get("distanceMeters", 0)))
        return cells
    except (AttributeError, TypeError, ValueError) as exc:
        raise RoutesError(f"看不懂路線矩陣的回應：{exc}") from exc


def route_legs(key: str, points: list[Point], http: httpx.Client | None = None) -> list[Leg]:
    """照給的順序開過這幾點，每一段的時間、距離與沿路的折線（共 len(points) - 1 段）。
    中間點超過 Essentials 的上限就拆成好幾次送，下一次從上一次的終點出發。"""
    legs: list[Leg] = []
    step = MAX_INTERMEDIATES + 1  # 一次最多幾段
    for start in range(0, len(points) - 1, step):
        legs += _legs(key, points[start:start + step + 1], http)
    return legs


def _legs(key: str, points: list[Point], http: httpx.Client | None) -> list[Leg]:
    origin, *middle, destination = points
    body: dict[str, Any] = {"origin": _waypoint(origin), "destination": _waypoint(destination), **DRIVING}
    if middle:
        body["intermediates"] = [_waypoint(p) for p in middle]
    data = _post(key, ROUTES_URL, ROUTE_FIELDS, body, http)
    try:
        routes = data.get("routes") or []
        legs = routes[0].get("legs", []) if routes else []
        if len(legs) != len(points) - 1:
            raise RoutesError(f"要 {len(points) - 1} 段路線，Google 回了 {len(legs)} 段")
        return [
            Leg(_seconds(leg.get("duration")), int(leg.get("distanceMeters", 0)),
                leg.get("polyline", {}).get("encodedPolyline", ""))
            for leg in legs
        ]
    except (AttributeError, TypeError, ValueError) as exc:
        raise RoutesError(f"看不懂路線的回應：{exc}") from exc


def _post(key: str, url: str, fields: str, body: dict, http: httpx.Client | None) -> Any:
    client = http or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = client.post(url, json=body, headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": fields})
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RoutesError(f"Google Routes API 沒有回應或回錯：{exc}") from exc
    finally:
        if http is None:
            client.close()


def _waypoint(point: Point) -> dict:
    return {"location": {"latLng": {"latitude": point[0], "longitude": point[1]}}}


def _seconds(duration: str | None) -> int:
    """Google 的時間長度是 "123s"、"630.4s" 這種字串；0 秒時整個欄位可能省略。"""
    return round(float(duration.removesuffix("s"))) if duration else 0
