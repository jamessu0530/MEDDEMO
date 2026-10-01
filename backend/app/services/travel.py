"""兩點之間開車要多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

設了 GOOGLE_MAPS_SERVER_KEY 就問 Google Routes API 的道路車程（services/google_routes.py，不看即時路況）；
沒設、Google 回錯或逾時（5 秒）就用直線估算，Matrix.estimated 是 True，畫面註明「估計」。開發與測試一律走估算。
"""

import logging
import math
from dataclasses import dataclass

from app.config import settings
from app.services import google_routes

log = logging.getLogger(__name__)

Point = tuple[float, float]  # (緯度, 經度)

EARTH_RADIUS_KM = 6371.0
# 市區道路比直線長的倍數、平均車速、每到一站找車位的時間：估算用的經驗值
DETOUR_FACTOR = 1.4
SPEED_KMH = 30
PARKING_MINUTES = 5


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
    key = settings().google_maps_server_key
    if not key:
        return fill(points, {}, google=False)
    if len(points) < 2:
        return fill(points, {}, google=True)
    try:
        cells = google_routes.route_matrix(key, points, points)
    except google_routes.RoutesError:
        log.warning("Google 路線矩陣沒有拿到，改用直線估算", exc_info=True)
        return fill(points, {}, google=False)
    return fill(points, {index: road(cell) for index, cell in cells.items()}, google=True)


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
