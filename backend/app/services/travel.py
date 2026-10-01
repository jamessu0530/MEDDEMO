"""兩點之間開車要多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

設了 GOOGLE_MAPS_SERVER_KEY 就問 Google Routes API 的道路車程（services/google_routes.py，不看即時路況）；
沒設、Google 回錯或逾時（5 秒）就用直線估算，Matrix.estimated 是 True，畫面註明「估計」。開發與測試一律走估算。

車程的分鐘數與公里數不快取：Google 的條款只允許快取經緯度（docs/superpowers/plans/2026-10-01-itinerary-stage4.md）。
所以分兩種問法：要排順序才問整份矩陣（matrix，按格計價）；照存著的順序算時間只要相鄰兩站（along，
computeRoutes 按請求計價，一次拿到全部路段），讀行程、主管頁、調整清單的試算都走這條。
主管頁沿路的線（經緯度）例外，可以快取，見 lines()。
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
from app.tasks import redis

log = logging.getLogger(__name__)

Point = tuple[float, float]  # (緯度, 經度)

EARTH_RADIUS_KM = 6371.0
# 市區道路比直線長的倍數、平均車速、每到一站找車位的時間：估算用的經驗值
DETOUR_FACTOR = 1.4
SPEED_KMH = 30
PARKING_MINUTES = 5

# Google 失敗之後這麼久之內直接用估算：Google 掛掉或金鑰設錯時，不讓每次讀行程都等 5 秒、log 也不洗版。
# 只記「剛失敗過」，不存 Google 的任何內容
GOOGLE_RETRY_SECONDS = 60
_google_paused_until = 0.0  # time.monotonic()

# 沿路的線（主管頁的地圖）：折線就是一串經緯度，Google 的條款允許快取（最多 30 天）。
# 同一串點畫出來的線一樣，放 Redis 一天；車程的分鐘、公里不放
LINES_CACHE_PREFIX = "meddemo:route-lines:"
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
    minutes: list[list[int]]  # minutes[i][j]：從第 i 點開到第 j 點
    km: list[list[float]]
    estimated: bool  # 有任何一格是直線估算的就是 True，畫面要註明「估計」


def straight_km(a: Point, b: Point) -> float:
    """地表上兩點的直線距離（半正矢公式）。"""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def estimate(a: Point, b: Point) -> tuple[int, float]:
    """(分鐘, 公里)。同一點是 0：同一棟樓裡換一家不用開車，也不用再找車位。"""
    if a == b:
        return 0, 0.0
    km = straight_km(a, b) * DETOUR_FACTOR
    return round(km / SPEED_KMH * 60) + PARKING_MINUTES, round(km, 1)


def matrix(points: list[Point]) -> Matrix:
    """每兩點之間開車要多久。設了伺服器金鑰就問 Google；沒設或 Google 失敗就整份用直線估算。"""
    key = _server_key()
    if not key:
        return fill(points, {}, google=False)
    if len(points) < 2:
        return fill(points, {}, google=True)
    try:
        cells = google_routes.route_matrix(key, points, points)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 路線矩陣沒有拿到，改用直線估算：%s", exc)
        return fill(points, {}, google=False)
    return fill(points, {index: road(cell) for index, cell in cells.items()}, google=True)


def along(points: list[Point]) -> Matrix:
    """照這個順序開過去，相鄰兩點（points[i] → points[i + 1]）的車程。設了伺服器金鑰就用 Google 的
    computeRoutes 一次問完；其他格子用直線估算補上，所以這份只能照同一個順序算時間（route_planner.schedule），
    不能拿去排順序。沒設金鑰或 Google 失敗就整份用估算。"""
    key = _server_key()
    if not key:
        return fill(points, {}, google=False)
    if len(points) < 2:
        return fill(points, {}, google=True)
    try:
        legs = google_routes.route_legs(key, points, polylines=False)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 路線沒有拿到，改用直線估算：%s", exc)
        return fill(points, {}, google=False)
    cells = {(n, n + 1): road(google_routes.Cell(leg.seconds, leg.meters)) for n, leg in enumerate(legs)}
    # 不相鄰的格子本來就是估算的、也用不到；相鄰的每一段都是 Google 給的，所以不算估計
    return dataclasses.replace(fill(points, cells, google=True), estimated=False)


def lines(points: list[Point]) -> list[str] | None:
    """照這個順序開過去，每一段沿路的線（Google 的編碼折線，共 len(points) - 1 段），主管頁的地圖畫路線用。
    沒設金鑰就回 None，地圖改畫直線；暫停中（Google 剛失敗過）也不是直接回 None——折線快取 30 天都有效，
    先看快取有沒有命中，命中就照樣回，只有真的要問 Google 時才看暫停中要不要擋下來。"""
    if len(points) < 2:
        return []
    if not settings().google_maps_server_key:
        return None
    cache_key = LINES_CACHE_PREFIX + hashlib.sha256(json.dumps(points).encode()).hexdigest()
    try:
        cached = redis().get(cache_key)
    except RedisError:
        cached = None
    if cached:
        return json.loads(cached)
    key = _server_key()
    if not key:
        return None
    try:
        legs = google_routes.route_legs(key, points)
    except google_routes.RoutesError as exc:
        _pause_google()
        log.warning("Google 沿路的線沒有拿到，地圖改畫直線：%s", exc)
        return None
    found = [leg.polyline for leg in legs]
    try:
        redis().set(cache_key, json.dumps(found), ex=LINES_TTL_SECONDS)
    except RedisError:
        log.warning("沿路的線沒有存進 Redis，下次再問 Google", exc_info=True)
    return found


def road(cell: google_routes.Cell) -> tuple[int, float]:
    """Google 的一格換成 (分鐘, 公里)。Google 只算開車，跟估算一樣再加找車位的時間。"""
    return round(cell.seconds / 60) + PARKING_MINUTES, round(cell.meters / 1000, 1)


def fill(points: list[Point], road_cells: dict[tuple[int, int], tuple[int, float]], google: bool) -> Matrix:
    """組成矩陣：同一點是 0；Google 給了的格子用 Google 的，其他用估算。
    只要有一格是估算的（沒問 Google，或 Google 開不到那一格），整份就標成估計。"""
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
                cell = estimate(a, b)
                estimated = True
            row_minutes.append(cell[0])
            row_km.append(cell[1])
        minutes.append(row_minutes)
        km.append(row_km)
    return Matrix(minutes=minutes, km=km, estimated=estimated)
