"""兩點之間要走多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉〈交通方式〉）。

每位業務選自己的交通方式（開車、機車、大眾運輸），每個函式都照它算；沒指定就是開車。
設了 GOOGLE_MAPS_SERVER_KEY 就問 Google Routes API（services/google_routes.py，不看即時路況）；
沒設、Google 回錯或逾時（5 秒）就用直線估算，Matrix.estimated 是 True，畫面註明「估計」。開發與測試一律走估算。

車程的分鐘數與公里數不快取：Google 的條款只允許快取經緯度（docs/superpowers/plans/2026-10-01-itinerary-stage4.md）。
所以分兩種問法：要排順序才問整份矩陣（matrix，按格計價）；照存著的順序算時間只要相鄰兩站（along，
computeRoutes 按請求計價，一次拿到全部路段），讀行程、主管頁、調整清單的試算都走這條。
地圖上沿路的線（經緯度）例外，可以快取，見 lines()。
"""

import dataclasses
import hashlib
import json
import logging
import math
import time
from dataclasses import dataclass

from redis.exceptions import RedisError

from app.config import settings
from app.services import google_routes
from app.services.google_routes import TravelMode
from app.tasks import redis

log = logging.getLogger(__name__)

Point = tuple[float, float]  # (緯度, 經度)

EARTH_RADIUS_KM = 6371.0


@dataclass(frozen=True)
class Pace:
    """估算用的經驗值。"""

    detour: float  # 路比直線長的倍數
    kmh: float  # 平均速度
    arrive_minutes: int  # 每到一站另外花的時間


PACES: dict[TravelMode, Pace] = {
    # 市區道路比直線長 1.4 倍、時速 30，每到一站找車位 5 分鐘
    "drive": Pace(1.4, 30, 5),
    # 機車鑽得進小路、停車快
    "scooter": Pace(1.3, 28, 2),
    # 捷運、公車加上走路：走到站、等車、轉乘平均 10 分鐘
    "transit": Pace(1.3, 20, 10),
}
# Google 給的時間另外加：開車找車位、機車停好車；大眾運輸的走路與等車 Google 已經算進去了
GOOGLE_EXTRA_MINUTES: dict[TravelMode, int] = {"drive": 5, "scooter": 2, "transit": 0}

# Google 失敗之後這麼久之內直接用估算：Google 掛掉或金鑰設錯時，不讓每次讀行程都等 5 秒、log 也不洗版。
# 只記「剛失敗過」，不存 Google 的任何內容
GOOGLE_RETRY_SECONDS = 60
_google_paused_until = 0.0  # time.monotonic()

# 沿路的線（地圖）：折線就是一串經緯度，Google 的條款允許快取（最多 30 天）。
# 同一串點、同一種交通方式畫出來的線一樣，放 Redis 一天；時間的分鐘、公里不放
LINES_CACHE_PREFIX = "meddemo:route-lines:v2:"
LINES_TTL_SECONDS = 24 * 3600


def _server_key() -> str:
    """伺服器金鑰；沒設，或 Google 剛失敗過還在暫停中，就回空字串（呼叫端當作沒有金鑰）。"""
    key = settings().google_maps_server_key
    if not key or time.monotonic() < _google_paused_until:
        return ""
    return key


def _pause_google() -> None:
    global _google_paused_until
    _google_paused_until = time.monotonic() + GOOGLE_RETRY_SECONDS


@dataclass(frozen=True)
class Matrix:
    minutes: list[list[int]]  # minutes[i][j]：從第 i 點到第 j 點
    km: list[list[float]]
    estimated: bool  # 有任何一格是直線估算的就是 True，畫面要註明「估計」


@dataclass(frozen=True)
class Line:
    """地圖上沿路的一段：Google 的編碼折線；大眾運輸再分成走路與搭車的幾小段（走路畫虛線）。"""

    polyline: str
    steps: tuple[google_routes.Step, ...] = ()


def straight_km(a: Point, b: Point) -> float:
    """地表上兩點的直線距離（半正矢公式）。"""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def estimate(a: Point, b: Point, mode: TravelMode = "drive") -> tuple[int, float]:
    """(分鐘, 公里)。同一點是 0：同一棟樓裡換一家不用再出發。"""
    if a == b:
        return 0, 0.0
    pace = PACES[mode]
    km = straight_km(a, b) * pace.detour
    return round(km / pace.kmh * 60) + pace.arrive_minutes, round(km, 1)


def matrix(points: list[Point], mode: TravelMode = "drive") -> Matrix:
    """每兩點之間要多久。設了伺服器金鑰就問 Google；沒設或 Google 失敗就整份用直線估算。"""
    key = _server_key()
    if not key:
        return fill(points, {}, google=False, mode=mode)
    if len(points) < 2:
        return fill(points, {}, google=True, mode=mode)
    try:
        cells = google_routes.route_matrix(key, points, points, mode=mode)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 路線矩陣沒有拿到，改用直線估算：%s", exc)
        return fill(points, {}, google=False, mode=mode)
    return fill(points, {index: road(cell, mode) for index, cell in cells.items()}, google=True, mode=mode)


def along(points: list[Point], mode: TravelMode = "drive") -> Matrix:
    """照這個順序走過去，相鄰兩點（points[i] → points[i + 1]）要多久。設了伺服器金鑰就用 Google 的
    computeRoutes 問（開車、機車一次問完；大眾運輸一段一段問）；其他格子用直線估算補上，所以這份只能照同一個順序
    算時間（route_planner.schedule），不能拿去排順序。沒設金鑰或 Google 失敗就整份用估算；
    大眾運輸搭不到車的那一段也用估算，整份標成估計。"""
    key = _server_key()
    if not key:
        return fill(points, {}, google=False, mode=mode)
    if len(points) < 2:
        return fill(points, {}, google=True, mode=mode)
    try:
        legs = google_routes.route_legs(key, points, polylines=False, mode=mode)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 路線沒有拿到，改用直線估算：%s", exc)
        return fill(points, {}, google=False, mode=mode)
    cells = {
        (n, n + 1): road(google_routes.Cell(leg.seconds, leg.meters), mode)
        for n, leg in enumerate(legs) if leg is not None
    }
    # 不相鄰的格子本來就是估算的、也用不到；相鄰的每一段都是 Google 給的才不算估計
    return dataclasses.replace(fill(points, cells, google=True, mode=mode), estimated=None in legs)


def lines(points: list[Point], mode: TravelMode = "drive") -> list[Line | None] | None:
    """照這個順序走過去，每一段沿路的線（共 len(points) - 1 段），地圖畫路線用；大眾運輸搭不到車的那一段是 None。
    沒設金鑰就回 None，地圖改畫直線；暫停中（Google 剛失敗過）也不是直接回 None——折線快取 30 天都有效，
    先看快取有沒有命中，命中就照樣回，只有真的要問 Google 時才看暫停中要不要擋下來。"""
    if len(points) < 2:
        return []
    if not settings().google_maps_server_key:
        return None
    cache_key = LINES_CACHE_PREFIX + hashlib.sha256(json.dumps([mode, points]).encode()).hexdigest()
    try:
        cached = redis().get(cache_key)
    except RedisError:
        cached = None
    if cached:
        return [_line_from_cache(item) for item in json.loads(cached)]
    key = _server_key()
    if not key:
        return None
    try:
        legs = google_routes.route_legs(key, points, mode=mode)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 沿路的線沒有拿到，地圖改畫直線：%s", exc)
        return None
    found = [Line(leg.polyline, leg.steps) if leg is not None else None for leg in legs]
    try:
        redis().set(cache_key, json.dumps([_line_to_cache(line) for line in found]), ex=LINES_TTL_SECONDS)
    except RedisError:
        log.warning("沿路的線沒有存進 Redis，下次再問 Google", exc_info=True)
    return found


def _line_to_cache(line: Line | None) -> dict | None:
    if line is None:
        return None
    return {"polyline": line.polyline, "steps": [[step.walk, step.polyline] for step in line.steps]}


def _line_from_cache(item: dict | None) -> Line | None:
    if item is None:
        return None
    return Line(item["polyline"], tuple(google_routes.Step(walk, polyline) for walk, polyline in item["steps"]))


def road(cell: google_routes.Cell, mode: TravelMode = "drive") -> tuple[int, float]:
    """Google 的一格換成 (分鐘, 公里)：開車、機車跟估算一樣再加停車的時間。"""
    return round(cell.seconds / 60) + GOOGLE_EXTRA_MINUTES[mode], round(cell.meters / 1000, 1)


def fill(
    points: list[Point], road_cells: dict[tuple[int, int], tuple[int, float]], google: bool,
    mode: TravelMode = "drive",
) -> Matrix:
    """組成矩陣：同一點是 0；Google 給了的格子用 Google 的，其他用估算。
    只要有一格是估算的（沒問 Google，或 Google 到不了那一格），整份就標成估計。"""
    estimated = not google
    minutes: list[list[int]] = []
    km: list[list[float]] = []
    for i, a in enumerate(points):
        row_minutes, row_km = [], []
        for j, b in enumerate(points):
            if a == b:
                cell = (0, 0.0)
            elif (i, j) in road_cells:
                cell = road_cells[(i, j)]
            else:
                cell = estimate(a, b, mode)
                estimated = True
            row_minutes.append(cell[0])
            row_km.append(cell[1])
        minutes.append(row_minutes)
        km.append(row_km)
    return Matrix(minutes=minutes, km=km, estimated=estimated)
