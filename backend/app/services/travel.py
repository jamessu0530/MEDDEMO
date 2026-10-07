"""兩點之間要走多久（docs/superpowers/specs/2026-10-01-itinerary-planning-design.md〈車程與地圖〉〈交通方式〉）。

每位業務選自己的交通方式當整天的預設（開車、機車、大眾運輸）；每一段還可以另外選，多了走路
（docs/superpowers/specs/2026-10-07-ride-vehicles-design.md〈車程〉）。沒指定就是開車。
設了 GOOGLE_MAPS_SERVER_KEY 就問 Google Routes API（services/google_routes.py，不看即時路況）；
沒設、Google 回錯或逾時（5 秒）就用直線估算，Matrix.estimated 是 True，畫面註明「估計」。開發與測試一律走估算。

車程的分鐘數與公里數不快取：Google 的條款只允許快取經緯度（docs/superpowers/plans/2026-10-01-itinerary-stage4.md）。
所以分兩種問法：要排順序才問整份矩陣（matrix，按格計價，照整天的預設）；照存著的順序算時間只要相鄰兩站（along，
computeRoutes 按請求計價，一次拿到好幾段），讀行程、主管頁、調整清單的試算都走這條。
along 與地圖的線（lines）照每一段自己的交通方式問：Google 一次只能問一種，所以相鄰、交通方式相同的段合成一組，
各組同時送出（_ask）；哪一組失敗就只有那幾段用估算、地圖畫直線。一段的四種交通方式各要多久見 options()。
地圖上沿路的線（經緯度）例外，可以快取，見 lines()。
"""

import dataclasses
import hashlib
import json
import logging
import math
import time
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from redis.exceptions import RedisError

from app.config import settings
from app.services import google_routes
from app.services.google_routes import TravelMode
from app.tasks import redis

log = logging.getLogger(__name__)

Point = tuple[float, float]  # (緯度, 經度)
# 一種（整條都用它），或每段一種：第 n 個是第 n 點到第 n + 1 點那一段的（長度 = 點數 − 1）
Modes = TravelMode | Sequence[TravelMode]

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
    # 走路：時速 4.5，不用停車
    "walk": Pace(1.3, 4.5, 0),
}
# Google 給的時間另外加：開車找車位、機車停好車；大眾運輸的走路與等車 Google 已經算進去了
GOOGLE_EXTRA_MINUTES: dict[TravelMode, int] = {"drive": 5, "scooter": 2, "transit": 0, "walk": 0}

# Google 失敗之後這麼久之內直接用估算：Google 掛掉或金鑰設錯時，不讓每次讀行程都等 5 秒、log 也不洗版。
# 只記「剛失敗過」，不存 Google 的任何內容
GOOGLE_RETRY_SECONDS = 60
_google_paused_until = 0.0  # time.monotonic()

# 沿路的線（地圖）：折線就是一串經緯度，Google 的條款允許快取（最多 30 天）。
# 同一串點、每段同一種交通方式畫出來的線一樣，放 Redis 一天；時間的分鐘、公里不放
LINES_CACHE_PREFIX = "meddemo:route-lines:v3:"
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
    estimated: bool  # 有任何一格是直線估算的就是 True，畫面要註明「估計」（along 只看相鄰的段）
    # 第 n 段（第 n 點到第 n + 1 點）是不是估算的；同一點不算。畫面每段各自決定要不要加「約」
    estimated_legs: tuple[bool, ...] = ()


@dataclass(frozen=True)
class Option:
    """一段路用某種交通方式要多久（選單）。found：Google 找得到路線；找不到（大眾運輸搭不到車）時分鐘是估算的。"""

    mode: TravelMode
    minutes: int
    km: float
    estimated: bool
    found: bool


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


def along(points: list[Point], modes: Modes = "drive") -> Matrix:
    """照這個順序走過去，相鄰兩點（points[i] → points[i + 1]）要多久。modes 是一種（整條都用它）或每段一種。
    設了伺服器金鑰就用 Google 的 computeRoutes 問：相鄰、交通方式相同的段合成一組，各組同時送出（_ask）。
    哪一組失敗就只有那幾段用估算（並暫停問 Google）；大眾運輸搭不到車的段也用估算，但不暫停；估算照那一段的交通方式。
    沒設金鑰（或暫停中）就整份用估算。不相鄰的格子都是估算的，所以這份只能照同一個順序算時間
    （route_planner.schedule），不能拿去排順序。"""
    per_leg = _per_leg(points, modes)
    # 不相鄰的格子用不到：只給一種時照它估算（跟以前一樣），每段各一種時當開車
    mode = modes if isinstance(modes, str) else "drive"
    key = _server_key()
    if not key:
        return fill(points, {}, google=False, mode=mode, modes=per_leg)
    found, _ = _ask(key, points, per_leg, polylines=False)
    cells = {
        (n, n + 1): road(google_routes.Cell(leg.seconds, leg.meters), per_leg[n])
        for n, leg in found.items() if leg is not None
    }
    result = fill(points, cells, google=True, mode=mode, modes=per_leg)
    # 不相鄰的格子本來就是估算的、也用不到；相鄰的每一段都是 Google 給的才不算估計
    return dataclasses.replace(result, estimated=any(result.estimated_legs))


def lines(points: list[Point], modes: Modes = "drive") -> list[Line | None] | None:
    """照這個順序走過去，每一段沿路的線（共 len(points) - 1 段），地圖畫路線用。modes 跟 along 一樣，
    每段照自己的交通方式問、分組也一樣（_ask）。兩點相同的段沒有線（Line("")）；大眾運輸搭不到車的段是 None。
    哪一組失敗，那幾段是 None（地圖畫直線）、這份不放快取，下次再問；全部都失敗就回 None，整條畫直線。
    沒設金鑰就回 None，地圖改畫直線；暫停中（Google 剛失敗過）也不是直接回 None——折線快取 30 天都有效，
    先看快取有沒有命中，命中就照樣回，只有真的要問 Google 時才看暫停中要不要擋下來。"""
    per_leg = _per_leg(points, modes)
    if len(points) < 2:
        return []
    if not settings().google_maps_server_key:
        return None
    cache_key = LINES_CACHE_PREFIX + hashlib.sha256(json.dumps([per_leg, points]).encode()).hexdigest()
    try:
        cached = redis().get(cache_key)
    except RedisError:
        cached = None
    if cached:
        return [_line_from_cache(item) for item in json.loads(cached)]
    key = _server_key()
    if not key:
        return None
    found, failed = _ask(key, points, per_leg, polylines=True)
    if failed and not found:
        return None
    result: list[Line | None] = []
    for n in range(len(per_leg)):
        leg = found.get(n)
        if points[n] == points[n + 1]:
            result.append(Line(""))
        else:
            result.append(Line(leg.polyline, leg.steps) if leg is not None else None)
    if failed:
        return result
    try:
        redis().set(cache_key, json.dumps([_line_to_cache(line) for line in result]), ex=LINES_TTL_SECONDS)
    except RedisError:
        log.warning("沿路的線沒有存進 Redis，下次再問 Google", exc_info=True)
    return result


def options(a: Point, b: Point) -> list[Option]:
    """這一段四種交通方式各要多久，照 google_routes.TRAVEL 的順序（選單用）；四種同時問 Google（_send）。
    同一點都是 0 分鐘、不算估計；沒設金鑰（或暫停中）全部用估算；大眾運輸搭不到車用估算、found 是 False；
    Google 失敗的那幾種用估算（found 照舊是 True，並暫停問 Google）。"""
    modes = list(google_routes.TRAVEL)
    if a == b:
        return [Option(mode, 0, 0.0, estimated=False, found=True) for mode in modes]
    key = _server_key()
    if not key:
        return [Option(mode, *estimate(a, b, mode), estimated=True, found=True) for mode in modes]
    answers = _send(key, [(mode, [a, b]) for mode in modes], polylines=False)
    found = []
    for mode, legs in zip(modes, answers):
        if legs is None:  # Google 失敗
            found.append(Option(mode, *estimate(a, b, mode), estimated=True, found=True))
        elif legs[0] is None:  # 大眾運輸搭不到車
            found.append(Option(mode, *estimate(a, b, mode), estimated=True, found=False))
        else:
            cell = google_routes.Cell(legs[0].seconds, legs[0].meters)
            found.append(Option(mode, *road(cell, mode), estimated=False, found=True))
    return found


def _per_leg(points: list[Point], modes: Modes) -> list[TravelMode]:
    """每段的交通方式：給一種就每段都用它；每段一種時要剛好 len(points) - 1 個。"""
    legs = max(len(points) - 1, 0)
    if isinstance(modes, str):
        return [modes] * legs
    if len(modes) != legs:
        raise ValueError(f"{legs} 段要 {legs} 種交通方式，給了 {len(modes)} 種")
    return list(modes)


def _groups(points: list[Point], modes: list[TravelMode]) -> list[tuple[TravelMode, int, int]]:
    """相鄰、交通方式相同的段合成一組 (交通方式, 第一段, 最後一段)：Google 一次只能問一種交通方式。
    大眾運輸也合成一組（google_routes 自己會一段一段問）。兩點相同的段（同一棟樓、區處沒有位置時的第一段）
    0 分鐘、沒有線，不問 Google，在那裡把組切開。"""
    groups: list[tuple[TravelMode, int, int]] = []
    for n, mode in enumerate(modes):
        if points[n] == points[n + 1]:
            continue
        if groups and groups[-1][0] == mode and groups[-1][2] == n - 1:
            groups[-1] = (mode, groups[-1][1], n)
        else:
            groups.append((mode, n, n))
    return groups


def _ask(
    key: str, points: list[Point], modes: list[TravelMode], polylines: bool,
) -> tuple[dict[int, google_routes.Leg | None], bool]:
    """along 與 lines 共用：分組（_groups）之後各組同時問 Google（_send）。回 ({第幾段: Google 給的那一段}, 有沒有哪組失敗)：
    大眾運輸搭不到車的段是 None；失敗的組與兩點相同的段不在裡面。"""
    groups = _groups(points, modes)
    answers = _send(key, [(mode, points[first:last + 2]) for mode, first, last in groups], polylines)
    found: dict[int, google_routes.Leg | None] = {}
    for (_, first, last), legs in zip(groups, answers):
        if legs is not None:
            found.update(zip(range(first, last + 1), legs))
    return found, None in answers


def _send(
    key: str, requests: list[tuple[TravelMode, list[Point]]], polylines: bool,
) -> list[list[google_routes.Leg | None] | None]:
    """同時送出好幾個 route_legs（每個一種交通方式、一串點），照請求的順序回各自的段；丟 RoutesError 的是 None，
    各記一行 warning。全部問完才暫停問 Google 一次：暫停的時間只在呼叫的這條執行緒改，送請求的執行緒不碰。"""
    if not requests:
        return []
    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        futures = [
            pool.submit(google_routes.route_legs, key, path, polylines=polylines, mode=mode) for mode, path in requests
        ]
    answers: list[list[google_routes.Leg | None] | None] = []
    for (mode, _), future in zip(requests, futures):
        try:
            answers.append(future.result())
        except google_routes.RoutesError as exc:
            log.warning("Google 路線沒有拿到（%s），改用直線：%s", mode, exc)
            answers.append(None)
    if None in answers:
        _pause_google()
    return answers


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
    mode: TravelMode = "drive", modes: Sequence[TravelMode] = (),
) -> Matrix:
    """組成矩陣：同一點是 0；Google 給了的格子用 Google 的，其他用估算——相鄰的格子（第 i 點到第 i + 1 點）照 modes[i]，
    其他格子（或沒給 modes）照 mode。只要有一格是估算的（沒問 Google，或 Google 到不了那一格），整份就標成估計；
    estimated_legs 記相鄰的每一段是不是估算的。"""
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
                cell = estimate(a, b, modes[i] if j == i + 1 and i < len(modes) else mode)
                estimated = True
            row_minutes.append(cell[0])
            row_km.append(cell[1])
        minutes.append(row_minutes)
        km.append(row_km)
    legs = tuple(points[n] != points[n + 1] and (n, n + 1) not in road_cells for n in range(len(points) - 1))
    return Matrix(minutes=minutes, km=km, estimated=estimated, estimated_legs=legs)
