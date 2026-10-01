"""兩點之間開車要多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉）。

這一版只有直線估算。之後接 Google 的路線矩陣時呼叫端不用改，只換 matrix() 裡面，
Google 連不上或沒設金鑰時再退回這裡的估算。
"""

import math
from dataclasses import dataclass

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
    estimated: bool  # 直線估算的是 True，畫面要註明「估計」


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
    pairs = [[estimate(a, b) for b in points] for a in points]
    return Matrix(
        minutes=[[m for m, _ in row] for row in pairs],
        km=[[k for _, k in row] for row in pairs],
        estimated=True,
    )
