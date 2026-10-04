"""Google Routes API 的呼叫（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

整個專案只有這支知道 Google 的格式：網址、要哪些欄位、回來的 JSON 長什麼樣、怎樣算失敗。
其他地方拿到的是秒數、公尺與編碼過的折線；Google 連不上、逾時、回錯或格式不對一律丟 RoutesError，
由呼叫端退回直線估算。

交通方式（業務自己選的，見設計文件〈交通方式〉）：
- 開車（DRIVE）與機車（TWO_WHEELER）：不看即時路況、不送出發時間；computeRoutes 一次最多 10 個中間點，
  超過就拆成好幾次送——多一個中間點就整個請求算 Pro，貴一倍（價格與規定見 docs/superpowers/plans/2026-10-01-itinerary-stage4.md）。
  Google 的機車路線還是測試版，畫面要註明。
- 大眾運輸（TRANSIT）：Google 不接受中間點，一段一段問（同時送出）；要出發時間才排得出班次，一律用今天早上 10 點。
  回來的每一段再分成走路與搭車的幾小段，地圖上走路畫虛線。搭不到車的那一段是 None，由呼叫端估算。
"""

from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.timeutil import TAIPEI

Point = tuple[float, float]  # (緯度, 經度)
TravelMode = Literal["drive", "scooter", "transit"]

MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
# 等 Google 最多 5 秒，超過就退回估算：首頁不能因為 Google 慢就一直轉圈
# httpx 是分段算逾時（連線、送出、等回應各自最多這麼久），不是整個請求的總時間
TIMEOUT_SECONDS = 5
# computeRoutes 一次最多幾個中間點還算 Essentials
MAX_INTERMEDIATES = 10
# computeRouteMatrix 一次最多幾格（起點數 × 終點數；不看路況時的上限，大眾運輸另有上限）
MAX_ELEMENTS = 625
MAX_TRANSIT_ELEMENTS = 100
# 大眾運輸一段一段問時，同時送出幾個請求
MAX_PARALLEL = 8
# 大眾運輸的出發時間：今天台北這個時候（白天的班次；Google 接受過去 7 天內的時間）
TRANSIT_DEPARTURE = dt.time(10, 0)

MATRIX_FIELDS = "originIndex,destinationIndex,duration,distanceMeters,status,condition"
ROUTE_FIELDS = "routes.legs.duration,routes.legs.distanceMeters,routes.legs.polyline.encodedPolyline"
ROUTE_FIELDS_NO_POLYLINE = "routes.legs.duration,routes.legs.distanceMeters"
TRANSIT_FIELDS = f"{ROUTE_FIELDS},routes.legs.steps.travelMode,routes.legs.steps.polyline.encodedPolyline"
# 開車與機車都不看即時路況（Essentials）；大眾運輸不能帶 routingPreference
TRAVEL: dict[TravelMode, dict[str, str]] = {
    "drive": {"travelMode": "DRIVE", "routingPreference": "TRAFFIC_UNAWARE"},
    "scooter": {"travelMode": "TWO_WHEELER", "routingPreference": "TRAFFIC_UNAWARE"},
    "transit": {"travelMode": "TRANSIT"},
}


class RoutesError(Exception):
    """Google 連不上、逾時、回錯或格式不對。"""


@dataclass(frozen=True)
class Cell:
    seconds: int
    meters: int


@dataclass(frozen=True)
class Step:
    """大眾運輸的一小段：走路，或搭車（捷運、公車…）。"""

    walk: bool
    polyline: str


@dataclass(frozen=True)
class Leg:
    seconds: int
    meters: int
    polyline: str  # Google 的編碼折線（Encoded Polyline Algorithm Format）
    steps: tuple[Step, ...] = ()  # 只有大眾運輸有：走路與搭車的幾小段


def _now() -> dt.datetime:
    return dt.datetime.now(TAIPEI)


def _travel(mode: TravelMode) -> dict[str, str]:
    """請求裡的交通方式；大眾運輸再加出發時間。"""
    if mode != "transit":
        return TRAVEL[mode]
    departure = dt.datetime.combine(_now().date(), TRANSIT_DEPARTURE, TAIPEI).astimezone(dt.UTC)
    return {**TRAVEL[mode], "departureTime": departure.strftime("%Y-%m-%dT%H:%M:%SZ")}


def route_matrix(
    key: str, origins: list[Point], destinations: list[Point], http: httpx.Client | None = None,
    mode: TravelMode = "drive",
) -> dict[tuple[int, int], Cell]:
    """每個起點到每個終點的時間與距離，鍵是 (起點第幾個, 終點第幾個)。到不了的格子不在結果裡。"""
    limit = MAX_TRANSIT_ELEMENTS if mode == "transit" else MAX_ELEMENTS
    if len(origins) * len(destinations) > limit:
        raise RoutesError(f"一次最多 {limit} 格，這次要 {len(origins) * len(destinations)} 格")
    data = _post(key, MATRIX_URL, MATRIX_FIELDS, {
        "origins": [{"waypoint": _waypoint(p)} for p in origins],
        "destinations": [{"waypoint": _waypoint(p)} for p in destinations],
        **_travel(mode),
    }, http)
    if not isinstance(data, list):
        raise RoutesError("路線矩陣的回應不是一串格子")
    try:
        cells = {}
        for element in data:
            if element.get("status", {}).get("code") or element.get("condition") != "ROUTE_EXISTS":
                continue
            # proto3 預設值的欄位 Google 可能省略：沒有 originIndex／destinationIndex 就當 0，
            # 沒有 distanceMeters 也當 0（不代表一定是第 0 個起點或同一點）
            index = (int(element.get("originIndex", 0)), int(element.get("destinationIndex", 0)))
            cells[index] = Cell(_seconds(element.get("duration")), int(element.get("distanceMeters", 0)))
        return cells
    except (AttributeError, TypeError, ValueError) as exc:
        raise RoutesError(f"看不懂路線矩陣的回應：{exc}") from exc


def route_legs(
    key: str, points: list[Point], http: httpx.Client | None = None, polylines: bool = True,
    mode: TravelMode = "drive",
) -> list[Leg | None]:
    """照給的順序走過這幾點，每一段的時間、距離（`polylines=True` 時還有沿路的折線，共 len(points) - 1 段）。
    開車與機車：中間點超過 Essentials 的上限就拆成好幾次送，下一次從上一次的終點出發，每一段都一定有。
    大眾運輸：一段一段問，搭不到車的那一段是 None。"""
    if mode == "transit":
        return _transit_legs(key, points, http, polylines)
    legs: list[Leg | None] = []
    step = MAX_INTERMEDIATES + 1  # 一次最多幾段
    for start in range(0, len(points) - 1, step):
        legs += _legs(key, points[start:start + step + 1], http, polylines, mode)
    return legs


def _transit_legs(key: str, points: list[Point], http: httpx.Client | None, polylines: bool) -> list[Leg | None]:
    pairs = list(zip(points, points[1:]))
    if not pairs:
        return []
    client = http or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(pairs))) as pool:
            return list(pool.map(lambda pair: _transit_leg(key, *pair, client, polylines), pairs))
    finally:
        if http is None:
            client.close()


def _transit_leg(key: str, origin: Point, destination: Point, http: httpx.Client, polylines: bool) -> Leg | None:
    if origin == destination:
        return Leg(0, 0, "")
    body = {"origin": _waypoint(origin), "destination": _waypoint(destination), **_travel("transit")}
    data = _post(key, ROUTES_URL, TRANSIT_FIELDS if polylines else ROUTE_FIELDS_NO_POLYLINE, body, http)
    try:
        routes = data.get("routes") or []
        if not routes:
            return None
        (leg,) = routes[0].get("legs", [])
        steps = tuple(
            Step(step.get("travelMode") == "WALK", step["polyline"]["encodedPolyline"])
            for step in leg.get("steps", [])
            if polylines and step.get("polyline", {}).get("encodedPolyline")
        )
        return Leg(
            _seconds(leg.get("duration")), int(leg.get("distanceMeters", 0)),
            leg.get("polyline", {}).get("encodedPolyline", "") if polylines else "", steps,
        )
    except (AttributeError, TypeError, ValueError, KeyError) as exc:
        raise RoutesError(f"看不懂大眾運輸路線的回應：{exc}") from exc


def _legs(key: str, points: list[Point], http: httpx.Client | None, polylines: bool, mode: TravelMode) -> list[Leg]:
    origin, *middle, destination = points
    body: dict[str, Any] = {"origin": _waypoint(origin), "destination": _waypoint(destination), **_travel(mode)}
    if middle:
        body["intermediates"] = [_waypoint(p) for p in middle]
    fields = ROUTE_FIELDS if polylines else ROUTE_FIELDS_NO_POLYLINE
    data = _post(key, ROUTES_URL, fields, body, http)
    try:
        routes = data.get("routes") or []
        legs = routes[0].get("legs", []) if routes else []
        if len(legs) != len(points) - 1:
            raise RoutesError(f"要 {len(points) - 1} 段路線，Google 回了 {len(legs)} 段")
        return [
            Leg(_seconds(leg.get("duration")), int(leg.get("distanceMeters", 0)),
                leg.get("polyline", {}).get("encodedPolyline", "") if polylines else "")
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
    except httpx.HTTPStatusError as exc:
        # response.text 是 Google 回的錯誤內容（無效金鑰、API 沒開、IP 限制、沒設帳單…各自不同），金鑰只在
        # 送出去的標頭裡，不會出現在回應內文或網址上，這裡不會洩漏金鑰
        raise RoutesError(f"Google Routes API 回 {exc.response.status_code}：{exc.response.text[:300]}") from exc
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
